import { Injectable, Logger, BadRequestException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  CheckoutPaymentIntent,
  CaptureStatus,
  RefundStatus,
} from '@paypal/paypal-server-sdk';
import {
  PayPalCheckoutSession,
  PayPalCheckoutSessionDocument,
} from './paypal-checkout.schema';
import {
  assertPayPalRefundExecutionSnapshot,
  PayPalRefundSnapshotInput,
  classifyPayPalRefundStatus,
  ClassifiedPayPalRefundStatus,
  PayPalRefundProviderStatus,
} from './paypal-refund.validator';

export {
  assertPayPalRefundExecutionSnapshot,
  PayPalRefundSnapshotInput,
  classifyPayPalRefundStatus,
  ClassifiedPayPalRefundStatus,
  PayPalRefundProviderStatus,
};

export interface PayPalPublicConfig {
  enabled: boolean;
  environment: 'sandbox';
  client_id: string;
  presentment_currency: string;
  vnd_per_presentment_unit: number;
}

export interface ConvertedPresentmentAmount {
  provider_amount: string;
  provider_currency: string;
  exchange_rate_vnd_per_unit: number;
}

@Injectable()
export class PaypalService implements OnModuleInit {
  private readonly logger = new Logger(PaypalService.name);

  private isEnabled = false;
  private environment: 'sandbox' = 'sandbox';
  private clientId = '';
  private clientSecret = '';
  private presentmentCurrency = '';
  private vndPerUnit = 0;

  private client: Client | null = null;
  private ordersController: OrdersController | null = null;
  private paymentsController: PaymentsController | null = null;

  constructor(
    @Optional()
    @InjectModel(PayPalCheckoutSession.name)
    private readonly paypalCheckoutModel?: Model<PayPalCheckoutSessionDocument>,
  ) {
    this.refreshConfiguration();
  }

  async onModuleInit() {
    this.refreshConfiguration();
    await this.dropLegacyCheckoutTtlIndex();
  }

  /**
   * Safe, idempotent migration to drop the legacy unconditional TTL index on createdAt
   * from the paypal_checkout_sessions collection (FIX 1).
   * Fails closed: throws if index is detected but cannot be dropped.
   * Preserves checkout_id unique index and compound user_id_client_request_id_operation_type unique index.
   */
  public async dropLegacyCheckoutTtlIndex(): Promise<{
    dropped: boolean;
    droppedIndexName?: string;
    preservedIndexes: string[];
  }> {
    if (!this.paypalCheckoutModel || !this.paypalCheckoutModel.collection) {
      return { dropped: false, preservedIndexes: [] };
    }

    const collection = this.paypalCheckoutModel.collection;
    let indexes: any[] = [];
    try {
      indexes = await collection.indexes();
    } catch (err: any) {
      if (
        err.code === 26 ||
        err.codeName === 'NamespaceNotFound' ||
        err.message?.includes('ns does not exist') ||
        err.message?.includes('NamespaceNotFound')
      ) {
        return { dropped: false, preservedIndexes: [] };
      }
      this.logger.error(`Critical failure inspecting checkout indexes: ${err.message}`);
      throw new Error(
        `CRITICAL_FINANCIAL_RETENTION_FAILURE: Failed to inspect checkout indexes: ${err.message}`,
      );
    }

    const preservedIndexes: string[] = [];
    let dropped = false;
    let droppedIndexName: string | undefined = undefined;

    for (const idx of indexes) {
      const isLegacyTtl =
        (idx.key?.createdAt === 1 || idx.name === 'createdAt_1') &&
        idx.expireAfterSeconds !== undefined;

      if (isLegacyTtl) {
        this.logger.warn(
          `Detected legacy unconditional TTL index "${idx.name}" with expireAfterSeconds=${idx.expireAfterSeconds} on ${collection.collectionName}. Dropping to protect financial records...`,
        );
        try {
          await collection.dropIndex(idx.name);
          dropped = true;
          droppedIndexName = idx.name;
          this.logger.log(`Successfully dropped legacy TTL index "${idx.name}".`);
        } catch (dropErr: any) {
          if (
            dropErr.code === 27 ||
            dropErr.codeName === 'IndexNotFound' ||
            dropErr.message?.includes('index not found')
          ) {
            dropped = true;
            droppedIndexName = idx.name;
          } else {
            this.logger.error(`Critical failure dropping legacy checkout TTL index "${idx.name}": ${dropErr.message}`);
            throw new Error(
              `CRITICAL_FINANCIAL_RETENTION_FAILURE: Failed to drop legacy TTL index "${idx.name}" from ${collection.collectionName}: ${dropErr.message}`,
            );
          }
        }
      } else {
        preservedIndexes.push(idx.name);
      }
    }

    return { dropped, droppedIndexName, preservedIndexes };
  }

  /**
   * Refreshes and validates PayPal Sandbox configuration from environment.
   * Fails closed if configured improperly.
   */
  public refreshConfiguration(): void {
    const rawEnabled = process.env.PAYPAL_ENABLED;
    this.isEnabled = rawEnabled === 'true';

    if (this.isEnabled) {
      const rawEnv = process.env.PAYPAL_ENV;
      if (!rawEnv || !rawEnv.trim()) {
        this.isEnabled = false;
        throw new Error('PAYPAL_ENABLED is true but PAYPAL_ENV is missing. Explicit PAYPAL_ENV=sandbox is required.');
      }
      const env = rawEnv.trim().toLowerCase();
      if (env !== 'sandbox') {
        this.isEnabled = false;
        throw new Error(
          `Invalid PAYPAL_ENV: "${rawEnv}". Aptech Airlines Phase 1B strictly supports sandbox environment only.`,
        );
      }
      this.environment = 'sandbox';
    } else {
      this.environment = 'sandbox';
    }

    this.clientId = (process.env.PAYPAL_CLIENT_ID || '').trim();
    this.clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const rawRate = process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT;
    if (this.isEnabled) {
      if (!this.clientId) {
        this.isEnabled = false;
        throw new Error('PAYPAL_ENABLED is true but PAYPAL_CLIENT_ID is missing.');
      }
      if (!this.clientSecret) {
        this.isEnabled = false;
        throw new Error('PAYPAL_ENABLED is true but PAYPAL_CLIENT_SECRET is missing.');
      }

      if (!rawRate || isNaN(Number(rawRate)) || Number(rawRate) <= 0) {
        this.isEnabled = false;
        throw new Error(
          `Invalid PAYPAL_VND_PER_PRESENTMENT_UNIT: "${rawRate}". A positive numeric rate is required when PAYPAL_ENABLED=true.`,
        );
      }
      this.vndPerUnit = Number(rawRate);

      const rawCurrency = process.env.PAYPAL_PRESENTMENT_CURRENCY;
      if (!rawCurrency || rawCurrency.trim().toUpperCase() !== 'USD') {
        this.isEnabled = false;
        throw new Error(
          `Invalid PAYPAL_PRESENTMENT_CURRENCY: "${rawCurrency}". Aptech Airlines Phase 1B strictly requires USD presentment currency when PAYPAL_ENABLED=true.`,
        );
      }
      this.presentmentCurrency = 'USD';

      // Initialize PayPal SDK Client
      this.client = new Client({
        clientCredentialsAuthCredentials: {
          oAuthClientId: this.clientId,
          oAuthClientSecret: this.clientSecret,
        },
        environment: Environment.Sandbox,
        timeout: 30000,
      });

      this.ordersController = new OrdersController(this.client);
      this.paymentsController = new PaymentsController(this.client);
      this.logger.log(
        `PayPal Sandbox initialized successfully (currency: ${this.presentmentCurrency}, rate: 1 ${this.presentmentCurrency} = ${this.vndPerUnit} VND).`,
      );
    } else {
      this.vndPerUnit = 0;
      this.presentmentCurrency = '';
      this.client = null;
      this.ordersController = null;
      this.paymentsController = null;
      this.logger.log('PayPal integration is currently disabled (PAYPAL_ENABLED != true).');
    }
  }

  /**
   * Inject mock controllers for unit/integration testing (never calls external PayPal in Jest).
   */
  public setMockControllers(orders: any, payments: any): void {
    this.ordersController = orders;
    this.paymentsController = payments;
    this.isEnabled = true;
  }

  public isPayPalActive(): boolean {
    return this.isEnabled && (!!this.ordersController || process.env.NODE_ENV === 'test');
  }

  public getPublicConfig(): PayPalPublicConfig {
    return {
      enabled: this.isEnabled,
      environment: 'sandbox',
      client_id: this.isEnabled ? this.clientId : '',
      presentment_currency: this.presentmentCurrency,
      vnd_per_presentment_unit: this.vndPerUnit,
    };
  }

  public getPresentmentCurrency(): string {
    return this.presentmentCurrency;
  }

  public getVndPerUnit(): number {
    return this.vndPerUnit;
  }

  /**
   * Authoritative conversion from internal integer VND to 2-decimal USD presentment.
   * e.g. roundToTwoDecimals(amountVnd / rate)
   */
  public convertVndToPresentment(
    amountVnd: number,
    customRate?: number,
  ): ConvertedPresentmentAmount {
    const rate = customRate && customRate > 0 ? customRate : this.vndPerUnit;
    if (!rate || isNaN(rate) || rate <= 0) {
      throw new BadRequestException('Valid exchange rate is required for VND presentment conversion.');
    }
    if (amountVnd <= 0) {
      return {
        provider_amount: '0.00',
        provider_currency: this.presentmentCurrency,
        exchange_rate_vnd_per_unit: rate,
      };
    }
    const val = Math.round((amountVnd / rate) * 100) / 100;
    return {
      provider_amount: val.toFixed(2),
      provider_currency: this.presentmentCurrency,
      exchange_rate_vnd_per_unit: rate,
    };
  }

  /**
   * Creates a PayPal order server-side with CAPTURE intent.
   */
  public async createOrder(
    paramsOrAmountVnd:
      | {
          amountVnd: number;
          clientRequestId: string;
          description?: string;
        }
      | number,
    clientRequestId?: string,
    description?: string,
  ): Promise<{
    order_id: string;
    provider_amount: string;
    provider_currency: string;
    exchange_rate_vnd_per_unit: number;
  }> {
    if (!this.isPayPalActive() || !this.ordersController) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }

    const amountVnd =
      typeof paramsOrAmountVnd === 'object' ? paramsOrAmountVnd.amountVnd : paramsOrAmountVnd;
    const reqId =
      typeof paramsOrAmountVnd === 'object'
        ? paramsOrAmountVnd.clientRequestId
        : clientRequestId || 'req';
    const desc =
      typeof paramsOrAmountVnd === 'object' ? paramsOrAmountVnd.description : description;

    const conv = this.convertVndToPresentment(amountVnd);

    try {
      const resp = await this.ordersController.createOrder({
        paypalRequestId: `${reqId}-create`,
        prefer: 'return=representation',
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              amount: {
                currencyCode: conv.provider_currency,
                value: conv.provider_amount,
              },
              description: desc || 'Aptech Airlines Booking',
            },
          ],
        },
      });

      const orderId = resp.result.id;
      if (!orderId) {
        throw new Error('PayPal did not return an order ID');
      }

      return {
        order_id: orderId,
        provider_amount: conv.provider_amount,
        provider_currency: conv.provider_currency,
        exchange_rate_vnd_per_unit: conv.exchange_rate_vnd_per_unit,
      };
    } catch (err: any) {
      this.logger.error(`PayPal createOrder failed: ${err.message}`);
      throw new BadRequestException(
        `Failed to create PayPal order: ${err?.result?.message || err?.message || 'Gateway error'}`,
      );
    }
  }

  /**
   * Retrieves order details by order ID.
   */
  public async getOrder(orderId: string): Promise<any> {
    if (!this.isPayPalActive() || !this.ordersController) {
      throw new BadRequestException('PayPal service is unavailable.');
    }
    try {
      const resp = await this.ordersController.getOrder({ id: orderId });
      return resp.result;
    } catch (err: any) {
      this.logger.error(`PayPal getOrder failed for order ${orderId}: ${err?.message}`);
      throw new BadRequestException(`PayPal getOrder failed: ${err?.message || 'Gateway error'}`);
    }
  }


  /**
   * Captures an approved PayPal order server-side.
   */
  public async captureOrder(
    paramsOrOrderId:
      | {
          orderId: string;
          paypalRequestId?: string;
        }
      | string,
    paypalRequestId?: string,
  ): Promise<{
    capture_id: string;
    status: string;
    provider_amount: string;
    provider_currency: string;
  }> {
    if (!this.isPayPalActive() || !this.ordersController) {
      throw new BadRequestException('PayPal service is unavailable.');
    }

    const orderId = typeof paramsOrOrderId === 'object' ? paramsOrOrderId.orderId : paramsOrOrderId;
    const reqId =
      typeof paramsOrOrderId === 'object'
        ? paramsOrOrderId.paypalRequestId
        : paypalRequestId || `${orderId}-capture`;

    try {
      const resp = await this.ordersController.captureOrder({
        id: orderId,
        paypalRequestId: reqId || `${orderId}-capture`,
        prefer: 'return=representation',
      });

      const capture = resp.result.purchaseUnits?.[0]?.payments?.captures?.[0];
      if (!capture) {
        throw new BadRequestException(
          'PayPal capture completed but no payment capture record was returned.',
        );
      }

      if (!capture.id || typeof capture.id !== 'string' || !capture.id.trim()) {
        throw new BadRequestException('PayPal capture returned invalid response: missing capture ID.');
      }
      if (!capture.status || typeof capture.status !== 'string' || !capture.status.trim()) {
        throw new BadRequestException('PayPal capture returned invalid response: missing capture status.');
      }
      if (!capture.amount?.value || typeof capture.amount.value !== 'string' || !capture.amount.value.trim()) {
        throw new BadRequestException('PayPal capture returned invalid response: missing capture amount value.');
      }
      if (
        !capture.amount?.currencyCode ||
        typeof capture.amount.currencyCode !== 'string' ||
        !capture.amount.currencyCode.trim()
      ) {
        throw new BadRequestException('PayPal capture returned invalid response: missing capture currency code.');
      }

      return {
        capture_id: capture.id.trim(),
        status: capture.status.trim(),
        provider_amount: capture.amount.value.trim(),
        provider_currency: capture.amount.currencyCode.trim().toUpperCase(),
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(`PayPal captureOrder failed for order ${orderId}: ${err.message}`);
      throw new BadRequestException(
        `PayPal capture failed: ${err?.result?.message || err?.message || 'Gateway error'}`,
      );
    }
  }

  /**
   * Refunds a captured PayPal payment (FIX 3 & FIX 4).
   * Strictly requires single options object: { captureId, providerAmount, providerCurrency, paypalRequestId, note? }.
   * Never issues an implicit full refund.
   * Validates provider response: requires refund ID, status, and asserts returned amount/currency match requested values.
   */
  public async refundCapture(params: {
    captureId: string;
    providerAmount: string;
    providerCurrency: string;
    paypalRequestId: string;
    note?: string;
  }): Promise<{
    refund_id: string;
    status: string;
    amount: string;
    currency: string;
  }> {
    if (!this.isPayPalActive() || !this.paymentsController) {
      throw new BadRequestException('PayPal service is unavailable for refund.');
    }

    const { captureId, providerAmount, providerCurrency, paypalRequestId, note } = params;

    assertPayPalRefundExecutionSnapshot({
      payment_reference: paypalRequestId,
      provider_capture_id: captureId,
      provider_amount: providerAmount,
      provider_currency: providerCurrency,
      context: 'PaypalService.refundCapture',
    });

    try {
      const resp = await this.paymentsController.refundCapturedPayment({
        captureId,
        paypalRequestId,
        prefer: 'return=representation',
        body: {
          amount: {
            currencyCode: providerCurrency,
            value: providerAmount,
          },
          noteToPayer: note || 'Aptech Airlines Refund',
        },
      });

      const refund = resp?.result;
      const refundId = refund?.id;
      const rawStatus = refund?.status;
      const returnedAmount = refund?.amount?.value;
      const returnedCurrency = refund?.amount?.currencyCode;

      if (!refundId || !rawStatus) {
        throw new BadRequestException(
          'PayPal refund returned invalid response: missing refund ID or status.',
        );
      }

      const classified = classifyPayPalRefundStatus(rawStatus);
      const status = classified.provider_status;

      if (!returnedAmount || returnedAmount !== providerAmount) {
        throw new BadRequestException(
          `PayPal refund response amount mismatch: requested ${providerAmount}, got ${returnedAmount || 'missing'}.`,
        );
      }

      if (!returnedCurrency || returnedCurrency.toUpperCase() !== providerCurrency.toUpperCase()) {
        throw new BadRequestException(
          `PayPal refund response currency mismatch: requested ${providerCurrency}, got ${returnedCurrency || 'missing'}.`,
        );
      }

      return {
        refund_id: refundId,
        status: status,
        amount: returnedAmount,
        currency: returnedCurrency,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const sanitizedMsg = err?.result?.message || err?.message || 'Gateway error';
      this.logger.error(
        `PayPal refundCapturedPayment failed for capture ${captureId} (requestId: ${paypalRequestId}): ${sanitizedMsg}`,
      );
      throw new BadRequestException(`PayPal refund failed: ${sanitizedMsg}`);
    }
  }

  /**
   * Retrieves refund details by refund ID (FIX 2).
   * Fails closed: requires non-empty refundId, asserts returned ID matches requested refund ID.
   * If expectedSnapshot is provided, verifies amount and currency exist and match expected snapshot.
   */
  public async getRefundDetails(
    refundId: string,
    expectedSnapshot?: { expectedAmount?: string; expectedCurrency?: string },
  ): Promise<{
    refund_id: string;
    status: string;
    amount?: string;
    currency?: string;
  }> {
    if (!this.isPayPalActive() || !this.paymentsController) {
      throw new BadRequestException('PayPal service is unavailable for refund query.');
    }
    const cleanRefundId = refundId?.trim();
    if (!cleanRefundId) {
      throw new BadRequestException('PayPal refund query requires non-empty refundId.');
    }

    try {
      const resp = await this.paymentsController.getRefund({ refundId: cleanRefundId });
      const refund = resp?.result;
      const rawStatus = refund?.status;
      if (!refund || !refund.id || !rawStatus) {
        throw new BadRequestException(
          `PayPal getRefund returned invalid response: missing refund ID or status for ${cleanRefundId}.`,
        );
      }

      const classified = classifyPayPalRefundStatus(rawStatus);
      const status = classified.provider_status;

      if (refund.id !== cleanRefundId) {
        throw new BadRequestException(
          `PayPal refund ID mismatch: requested ${cleanRefundId}, got ${refund.id}.`,
        );
      }

      const returnedAmount = refund.amount?.value;
      const returnedCurrency = refund.amount?.currencyCode;

      if (expectedSnapshot) {
        if (!returnedAmount) {
          throw new BadRequestException(
            `PayPal refund response missing amount for ${cleanRefundId}. Expected: ${expectedSnapshot.expectedAmount || 'defined amount'}.`,
          );
        }
        if (!returnedCurrency) {
          throw new BadRequestException(
            `PayPal refund response missing currency for ${cleanRefundId}. Expected: ${expectedSnapshot.expectedCurrency || 'USD'}.`,
          );
        }

        if (expectedSnapshot.expectedAmount && returnedAmount !== expectedSnapshot.expectedAmount) {
          throw new BadRequestException(
            `PayPal refund amount mismatch for ${cleanRefundId}: expected ${expectedSnapshot.expectedAmount}, got ${returnedAmount}.`,
          );
        }
        if (
          expectedSnapshot.expectedCurrency &&
          returnedCurrency.toUpperCase() !== expectedSnapshot.expectedCurrency.toUpperCase()
        ) {
          throw new BadRequestException(
            `PayPal refund currency mismatch for ${cleanRefundId}: expected ${expectedSnapshot.expectedCurrency}, got ${returnedCurrency}.`,
          );
        }
      }

      return {
        refund_id: refund.id,
        status: status,
        amount: returnedAmount,
        currency: returnedCurrency,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const sanitizedMsg = err?.result?.message || err?.message || 'Gateway error';
      this.logger.error(`PayPal getRefund failed for refund ${cleanRefundId}: ${sanitizedMsg}`);
      throw new BadRequestException(`PayPal getRefund failed: ${sanitizedMsg}`);
    }
  }
}

