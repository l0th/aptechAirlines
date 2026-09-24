import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaypalService,
  PayPalPublicConfig,
  assertPayPalRefundExecutionSnapshot,
  classifyPayPalRefundStatus,
} from './paypal.service';
import { PaypalRefundScheduler } from './paypal-refund.scheduler';
import {
  PayPalCheckoutSession,
  PayPalCheckoutSessionDocument,
  PayPalCheckoutStatus,
} from './paypal-checkout.schema';
import { Booking, BookingDocument, PaymentMethod } from '../bookings/bookings.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

@Controller('paypal')
export class PaypalController {
  private readonly logger = new Logger(PaypalController.name);

  constructor(
    private readonly paypalService: PaypalService,
    private readonly paypalRefundScheduler: PaypalRefundScheduler,
    @InjectModel(PayPalCheckoutSession.name)
    private readonly paypalCheckoutModel: Model<PayPalCheckoutSessionDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  /**
   * Public / Authenticated safe endpoint returning only browser-safe PayPal Sandbox settings.
   * NEVER returns client secret, tokens, or credentials.
   */
  @Get('config')
  getPublicConfig(): PayPalPublicConfig {
    return this.paypalService.getPublicConfig();
  }

  /**
   * Admin-only endpoint to trigger retry processing of pending PayPal refunds.
   */
  @Post('admin/refunds/retry-pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async retryPendingRefunds(@Body() body?: { booking_id?: string }) {
    return this.paypalRefundScheduler.processPendingRefunds(body?.booking_id);
  }

  /**
   * Admin-only endpoint to manually retry a specific failed or pending refund transaction (FIX 7 & FIX 9).
   */
  @Post('admin/refunds/:paymentReference/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async retrySpecificRefund(
    @Param('paymentReference') paymentReference: string,
    @Body() body: { booking_id: string; reset_retry_count?: boolean },
  ) {
    if (!body?.booking_id || typeof body.booking_id !== 'string' || !body.booking_id.trim()) {
      throw new BadRequestException('booking_id is required in request body to retry a specific refund.');
    }

    const cleanBookingId = body.booking_id.trim();
    const query: any = {
      _id: cleanBookingId,
      'payment_transactions.payment_reference': paymentReference,
    };

    const booking = await this.bookingModel.findOne(query);

    if (!booking) {
      throw new NotFoundException(
        `No booking found with id ${cleanBookingId} and refund payment reference ${paymentReference}`,
      );
    }

    const tx = booking.payment_transactions.find(
      (t: any) => t.payment_reference === paymentReference,
    );

    if (!tx) {
      throw new NotFoundException(`Transaction ${paymentReference} not found on booking ${booking.confirmation_number}`);
    }

    if (tx.payment_method !== PaymentMethod.PAYPAL) {
      throw new BadRequestException(`Transaction ${paymentReference} is not a PayPal payment.`);
    }

    if (!['REFUND', 'RESCHEDULE_REFUND'].includes(tx.transaction_type)) {
      throw new BadRequestException(`Transaction ${paymentReference} is not a refund transaction.`);
    }

    if (tx.status === 'SUCCESS') {
      return {
        status: 'ALREADY_COMPLETED',
        message: 'Refund was already completed successfully.',
        provider_refund_id: tx.provider_refund_id,
        booking_id: booking._id,
        confirmation_number: booking.confirmation_number,
      };
    }

    // Assert complete provenance snapshot before calling PayPal (FIX 2, FIX 5 & FIX 6)
    assertPayPalRefundExecutionSnapshot({
      payment_reference: tx.payment_reference,
      provider_capture_id: tx.provider_capture_id,
      provider_amount: tx.provider_amount,
      provider_currency: tx.provider_currency,
      exchange_rate_vnd_per_unit: tx.exchange_rate_vnd_per_unit,
      require_fx: true,
      context: 'PaypalController.retrySpecificRefund',
    });

    // Existing provider_refund_id means RECONCILE, NOT RESUBMIT (FIX 7 & FIX 9)
    if (tx.provider_refund_id && tx.provider_refund_id.trim()) {
      try {
        const details = await this.paypalService.getRefundDetails(tx.provider_refund_id, {
          expectedAmount: tx.provider_amount,
          expectedCurrency: tx.provider_currency,
        });
        const classified = classifyPayPalRefundStatus(details.status);
        tx.provider_status = classified.provider_status;

        if (classified.is_success) {
          tx.status = 'SUCCESS';
          tx.failure_reason = undefined;
          tx.next_retry_at = undefined;
          await booking.save();
          return {
            status: 'SUCCESS',
            message: 'Refund confirmed completed via PayPal pre-check.',
            provider_refund_id: tx.provider_refund_id,
            booking_id: booking._id,
            confirmation_number: booking.confirmation_number,
          };
        } else if (classified.is_pending) {
          tx.status = 'PENDING';
          tx.failure_reason = 'Refund remains in PENDING state on PayPal';
          await booking.save();
          return {
            status: 'PENDING',
            message: 'Refund remains PENDING on PayPal. Not resubmitting.',
            provider_refund_id: tx.provider_refund_id,
            booking_id: booking._id,
            confirmation_number: booking.confirmation_number,
          };
        } else {
          tx.status = 'FAILED';
          tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
          tx.next_retry_at = undefined;
          await booking.save();
          return {
            status: 'FAILED',
            message: `Refund has status ${classified.provider_status} on PayPal.`,
            provider_refund_id: tx.provider_refund_id,
            booking_id: booking._id,
            confirmation_number: booking.confirmation_number,
          };
        }
      } catch (checkErr: any) {
        this.logger.warn(`Pre-check of refund ${tx.provider_refund_id} failed: ${checkErr?.message}`);
        throw new BadRequestException(`Reconciliation query failed for refund ${tx.provider_refund_id}: ${checkErr?.message}`);
      }
    }

    // Only if provider_refund_id is completely absent, submit refundCapture
    try {
      const refundResult = await this.paypalService.refundCapture({
        captureId: tx.provider_capture_id,
        providerAmount: tx.provider_amount,
        providerCurrency: tx.provider_currency,
        paypalRequestId: tx.payment_reference,
        note: `Manual admin refund retry for booking ${booking.confirmation_number || booking.pnr_code}`,
      });

      const classified = classifyPayPalRefundStatus(refundResult.status);
      tx.provider_refund_id = refundResult.refund_id;
      tx.provider_status = classified.provider_status;

      if (classified.is_success) {
        tx.status = 'SUCCESS';
        tx.failure_reason = undefined;
        tx.next_retry_at = undefined;
      } else if (classified.is_pending) {
        tx.status = 'PENDING';
        tx.failure_reason = 'Manual retry returned status PENDING';
      } else {
        tx.status = 'FAILED';
        tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
        tx.next_retry_at = undefined;
      }

      if (body?.reset_retry_count) {
        tx.retry_count = 0;
      }

      await booking.save();

      return {
        status: tx.status,
        message: `Refund retry finished with status ${tx.status}`,
        provider_refund_id: tx.provider_refund_id,
        booking_id: booking._id,
        confirmation_number: booking.confirmation_number,
      };
    } catch (err: any) {
      tx.status = 'FAILED';
      tx.failure_reason = `Manual admin retry failed: ${err?.message}`;
      await booking.save();
      throw new BadRequestException(`Manual refund retry failed: ${err?.message}`);
    }
  }

  /**
   * Admin-only endpoint to reconcile a compensation refund for a checkout session in RECONCILE_REQUIRED (FIX 7 & FIX 10).
   */
  @Post('admin/checkouts/:checkoutId/reconcile-compensation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async reconcileCompensationRefund(@Param('checkoutId') checkoutId: string) {
    const session = await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId });

    if (!session) {
      throw new NotFoundException(`Checkout session ${checkoutId} not found.`);
    }

    if (session.status === PayPalCheckoutStatus.REFUNDED) {
      return {
        status: 'ALREADY_REFUNDED',
        checkout_id: checkoutId,
        provider_refund_id: session.provider_refund_id,
      };
    }

    if (session.status !== PayPalCheckoutStatus.RECONCILE_REQUIRED) {
      throw new BadRequestException(
        `Session ${checkoutId} is in status ${session.status}, not RECONCILE_REQUIRED.`,
      );
    }

    const idempotencyKey = `${session.checkout_id}-compensation-refund`;

    // Validate complete snapshot before any operation (FIX 10)
    try {
      assertPayPalRefundExecutionSnapshot({
        payment_reference: idempotencyKey,
        provider_capture_id: session.paypal_capture_id || '',
        provider_amount: session.provider_amount || '',
        provider_currency: session.provider_currency || '',
        exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
        require_fx: true,
        context: 'reconcileCompensationRefund',
      });
    } catch (valErr: any) {
      session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
      session.failure_reason = `Incomplete compensation refund snapshot: ${valErr?.message}`;
      await session.save();
      throw new BadRequestException(session.failure_reason);
    }

    // Existing provider_refund_id means RECONCILE, NOT RESUBMIT (FIX 7 & FIX 10)
    if (session.provider_refund_id && session.provider_refund_id.trim()) {
      try {
        const details = await this.paypalService.getRefundDetails(session.provider_refund_id, {
          expectedAmount: session.provider_amount,
          expectedCurrency: session.provider_currency,
        });
        const classified = classifyPayPalRefundStatus(details.status);
        session.provider_refund_status = classified.provider_status;

        if (classified.is_success) {
          session.status = PayPalCheckoutStatus.REFUNDED;
          session.failure_reason = undefined;
          await session.save();
          return {
            status: 'REFUNDED',
            message: 'Session verified as REFUNDED via PayPal pre-check.',
            checkout_id: checkoutId,
            provider_refund_id: session.provider_refund_id,
          };
        } else if (classified.is_pending) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = `Compensation refund ${session.provider_refund_id} remains PENDING on PayPal. Not resubmitting.`;
          await session.save();
          return {
            status: 'PENDING',
            message: session.failure_reason,
            checkout_id: checkoutId,
            provider_refund_id: session.provider_refund_id,
          };
        } else {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = `PayPal compensation refund returned status: ${classified.provider_status}`;
          await session.save();
          return {
            status: 'FAILED',
            message: session.failure_reason,
            checkout_id: checkoutId,
            provider_refund_id: session.provider_refund_id,
          };
        }
      } catch (checkErr: any) {
        this.logger.warn(`Pre-check of compensation refund ${session.provider_refund_id} failed: ${checkErr?.message}`);
        throw new BadRequestException(`Reconciliation query failed: ${checkErr?.message}`);
      }
    }

    // Only if provider_refund_id does NOT exist, call refundCapture
    try {
      const refundRes = await this.paypalService.refundCapture({
        captureId: session.paypal_capture_id!,
        providerAmount: session.provider_amount!,
        providerCurrency: session.provider_currency!,
        paypalRequestId: idempotencyKey,
        note: `Administrative compensation refund reconciliation for session ${session.checkout_id}`,
      });

      const classified = classifyPayPalRefundStatus(refundRes.status);
      session.provider_refund_id = refundRes.refund_id;
      session.provider_refund_status = classified.provider_status;

      if (classified.is_success) {
        session.status = PayPalCheckoutStatus.REFUNDED;
        session.failure_reason = undefined;
      } else {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.failure_reason = `Reconciliation refund returned non-completed status: ${classified.provider_status}`;
      }

      await session.save();

      return {
        status: session.status,
        checkout_id: checkoutId,
        provider_refund_id: session.provider_refund_id,
        provider_refund_status: session.provider_refund_status,
      };
    } catch (refundErr: any) {
      session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
      session.failure_reason = `Reconciliation refund attempt failed: ${refundErr?.message}`;
      await session.save();
      throw new BadRequestException(`Reconciliation refund failed: ${refundErr?.message}`);
    }
  }

  /**
   * Admin-only overview of checkout sessions and refund transactions requiring reconciliation (FIX 12).
   * Completely excludes secrets, raw payloads, and passenger PII data.
   */
  @Get('admin/reconciliation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getReconciliationOverview() {
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes age threshold

    const sessions = await this.paypalCheckoutModel
      .find({
        $or: [
          { status: PayPalCheckoutStatus.RECONCILE_REQUIRED },
          {
            status: {
              $in: [
                PayPalCheckoutStatus.PENDING,
                PayPalCheckoutStatus.CAPTURING,
                PayPalCheckoutStatus.CAPTURED,
                PayPalCheckoutStatus.FINALIZING,
              ],
            },
            updatedAt: { $lt: staleThreshold },
          },
        ],
      })
      .select('-operation_payload')
      .sort({ updatedAt: -1 })
      .limit(100)
      .exec();

    const bookingsWithTroubledRefunds = await this.bookingModel
      .find({
        payment_transactions: {
          $elemMatch: {
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: { $in: ['REFUND', 'RESCHEDULE_REFUND'] },
            $or: [
              { status: 'FAILED' },
              { status: 'PENDING', retry_count: { $gte: 2 } },
              { payment_reference: { $in: [null, ''] } },
              { provider_capture_id: { $in: [null, ''] } },
              { provider_amount: { $in: [null, ''] } },
              { provider_currency: { $ne: 'USD' } },
            ],
          },
        },
      })
      .select('pnr_code confirmation_number payment_transactions user_id createdAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .exec();

    const troubledRefunds: any[] = [];
    for (const b of bookingsWithTroubledRefunds) {
      for (const tx of b.payment_transactions) {
        const isTroubled =
          tx.status === 'FAILED' ||
          (tx.status === 'PENDING' && (tx.retry_count || 0) >= 2) ||
          !tx.payment_reference ||
          !tx.provider_capture_id ||
          !tx.provider_amount ||
          tx.provider_currency !== 'USD';

        if (
          tx.payment_method === PaymentMethod.PAYPAL &&
          ['REFUND', 'RESCHEDULE_REFUND'].includes(tx.transaction_type) &&
          isTroubled
        ) {
          troubledRefunds.push({
            booking_id: b._id,
            pnr_code: b.pnr_code,
            confirmation_number: b.confirmation_number,
            payment_reference: tx.payment_reference || 'MISSING_PAYMENT_REFERENCE',
            transaction_type: tx.transaction_type,
            amount: tx.amount,
            provider_amount: tx.provider_amount || 'MISSING_PROVIDER_AMOUNT',
            provider_currency: tx.provider_currency || 'MISSING_PROVIDER_CURRENCY',
            provider_capture_id: tx.provider_capture_id || 'MISSING_PROVIDER_CAPTURE_ID',
            provider_refund_id: tx.provider_refund_id,
            status: tx.status,
            retry_count: tx.retry_count || 0,
            next_retry_at: tx.next_retry_at,
            failure_reason: tx.failure_reason || (!tx.payment_reference ? 'MISSING_PAYMENT_REFERENCE' : undefined),
            created_at: tx.created_at,
          });
        }
      }
    }

    return {
      summary: {
        reconcile_required_sessions_count: sessions.filter(
          (s) => s.status === PayPalCheckoutStatus.RECONCILE_REQUIRED,
        ).length,
        stale_unresolved_sessions_count: sessions.filter(
          (s) => s.status !== PayPalCheckoutStatus.RECONCILE_REQUIRED,
        ).length,
        total_troubled_sessions_count: sessions.length,
        troubled_refunds_count: troubledRefunds.length,
        generated_at: new Date(),
      },
      reconcile_required_sessions: sessions.map((s) => ({
        checkout_id: s.checkout_id,
        operation_type: s.operation_type,
        status: s.status,
        paypal_order_id: s.paypal_order_id,
        paypal_capture_id: s.paypal_capture_id,
        provider_refund_id: s.provider_refund_id,
        provider_refund_status: s.provider_refund_status,
        amount_vnd: s.amount_vnd,
        provider_amount: s.provider_amount,
        provider_currency: s.provider_currency,
        failure_reason: s.failure_reason,
        created_at: (s as any).createdAt,
        updated_at: (s as any).updatedAt,
      })),
      troubled_refund_transactions: troubledRefunds,
    };
  }
}

