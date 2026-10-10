import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  ExternalPaymentProof,
  PaymentMethod,
} from './bookings.schema';
import {
  CreateBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { UserRole } from '../users/users.schema';
import {
  assertPayPalRefundExecutionSnapshot,
  classifyPayPalRefundStatus,
} from '../paypal/paypal.service';
import {
  PayPalCheckoutOperationType,
  PayPalCheckoutSessionDocument,
  PayPalCheckoutStatus,
} from '../paypal/paypal-checkout.schema';
import {
  BookingsPayPalBridge,
  BookingsPayPalDependencies,
  BookingsPayPalPart,
} from './bookings-paypal.part';

export class BookingsPayPalCaptureService extends BookingsPayPalPart {
  private readonly logger = new Logger(BookingsPayPalCaptureService.name);

  constructor(deps: BookingsPayPalDependencies, bridge: BookingsPayPalBridge) {
    super(deps, bridge);
  }
  async verifyPreCaptureGate(
    session: PayPalCheckoutSessionDocument,
    expectedOpType: PayPalCheckoutOperationType,
    userId: string,
    orderId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<void> {
    if (session.user_id !== userId && role === UserRole.CUSTOMER) {
      throw new ForbiddenException('You do not have permission to access this checkout session.');
    }
    if (session.operation_type !== expectedOpType) {
      throw new BadRequestException(
        `Operation type mismatch: session is for ${session.operation_type}, attempted capture for ${expectedOpType}.`,
      );
    }
    if (!session.paypal_order_id || session.paypal_order_id !== orderId) {
      throw new BadRequestException(
        `Order ID mismatch: expected ${session.paypal_order_id}, got ${orderId}.`,
      );
    }
    if (session.order_expires_at && new Date() > session.order_expires_at) {
      session.status = PayPalCheckoutStatus.CANCELLED;
      session.error_message = 'Checkout session expired.';
      await session.save();
      throw new BadRequestException('Checkout session has expired. Please create a new checkout.');
    }

    // Recompute presentment BEFORE capture to verify snapshot parity
    const expectedPresentment = this.paypalService.convertVndToPresentment(
      session.amount_vnd,
      session.exchange_rate_vnd_per_unit,
    );
    if (
      expectedPresentment.provider_amount !== session.provider_amount ||
      expectedPresentment.provider_currency !== session.provider_currency
    ) {
      throw new BadRequestException(
        `Provider presentment snapshot mismatch: expected ${expectedPresentment.provider_amount} ${expectedPresentment.provider_currency}, session has ${session.provider_amount} ${session.provider_currency}.`,
      );
    }

    if (expectedOpType === PayPalCheckoutOperationType.CONFIRM_HOLD) {
      const blockingNumber = session.operation_payload?.blocking_number;
      if (!blockingNumber) throw new BadRequestException('Missing blocking number in session payload.');
      const booking = await this.bookingModel.findOne({ blocking_number: blockingNumber }).exec();
      if (!booking) throw new NotFoundException(`Booking with blocking number ${blockingNumber} not found.`);
      if (String(booking.user_id) !== String(session.user_id)) {
        throw new ForbiddenException('This reservation does not belong to the checkout customer.');
      }
      if (booking.status !== BookingStatus.BLOCKED) {
        throw new BadRequestException('This reservation is no longer awaiting hold payment.');
      }
      if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
        await this.bridge.cancelExpiredBlockStrict(booking);
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = 'Hold deadline expired before payment capture.';
        await session.save();
        throw new BadRequestException(
          'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
        );
      }
      if (booking.total_amount !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Hold booking total changed from ${session.amount_vnd} to ${booking.total_amount} VND.`;
        await session.save();
        throw new BadRequestException('Hold booking total has changed. Please start checkout again.');
      }
    } else if (expectedOpType === PayPalCheckoutOperationType.CREATE_BOOKING) {
      const quote = await this.bridge.quoteBooking(session.operation_payload as CreateBookingDto, session.user_id);
      if (quote.total_amount !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Price quote changed from ${session.amount_vnd} to ${quote.total_amount} VND.`;
        await session.save();
        throw new BadRequestException(
          `Price quote changed from ${session.amount_vnd} to ${quote.total_amount} VND. Please review and start checkout again.`,
        );
      }
    } else if (expectedOpType === PayPalCheckoutOperationType.RESCHEDULE) {
      const quote = await this.bridge.quoteRescheduleTicket(session.operation_payload as RescheduleTicketDto, session.user_id);
      if (quote.price_difference !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Reschedule price quote changed from ${session.amount_vnd} to ${quote.price_difference} VND.`;
        await session.save();
        throw new BadRequestException(
          `Reschedule quote changed from ${session.amount_vnd} to ${quote.price_difference} VND. Please review and start checkout again.`,
        );
      }
    }
  }

  /**
   * Create PayPal Order for Ticket Booking.
   */
  async executeCompensationRefund(
    session: PayPalCheckoutSessionDocument,
    bizErr: any,
    contextNote: string,
  ): Promise<void> {
    this.logger.error(
      `${contextNote} after PayPal capture ${session.paypal_capture_id} for session ${session.checkout_id}. Initiating automated compensation refund: ${bizErr?.message || 'Error'}`,
    );
    const reqId = `${session.checkout_id}-compensation-refund`;
    try {
      assertPayPalRefundExecutionSnapshot({
        payment_reference: reqId,
        provider_capture_id: session.paypal_capture_id || '',
        provider_amount: session.provider_amount || '',
        provider_currency: session.provider_currency || '',
        exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
        require_fx: true,
        context: 'executeCompensationRefund',
      });
      const refundRes = await this.paypalService.refundCapture({
        captureId: session.paypal_capture_id!,
        providerAmount: session.provider_amount!,
        providerCurrency: session.provider_currency!,
        paypalRequestId: reqId,
        note: `Automated compensation refund: ${contextNote} (${bizErr?.message})`,
      });
      const classified = classifyPayPalRefundStatus(refundRes.status);
      session.provider_refund_id = refundRes.refund_id;
      session.provider_refund_status = classified.provider_status;

      if (classified.is_success) {
        session.status = PayPalCheckoutStatus.REFUNDED;
      } else {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.failure_reason = `${contextNote}: ${bizErr?.message}. Refund status is ${classified.provider_status}.`;
      }
    } catch (refundErr: any) {
      this.logger.error(
        `CRITICAL: Compensation refund failed for capture ${session.paypal_capture_id} session ${session.checkout_id}: ${refundErr?.message}. Flagging as RECONCILE_REQUIRED.`,
      );
      session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
      session.failure_reason = `${contextNote}: ${bizErr?.message}. Refund failed: ${refundErr?.message}`;
    }
    session.error_message = session.failure_reason || bizErr?.message;
    await session.save();
  }

  /**
   * Prepares and claims PayPal capture:
   * State Machine: CREATED -> CAPTURING -> CAPTURED -> FINALIZING -> COMPLETED
   */
  async prepareAndClaimPayPalCapture(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
    expectedOpType: PayPalCheckoutOperationType,
  ): Promise<{
    session: PayPalCheckoutSessionDocument;
    existingBooking?: any;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal service is unavailable.');
    }

    let session = await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec();
    if (!session) {
      throw new NotFoundException('PayPal checkout session not found.');
    }

    if (session.user_id !== userId && role === UserRole.CUSTOMER) {
      throw new ForbiddenException('You do not have permission to access this checkout session.');
    }

    if (session.status === PayPalCheckoutStatus.COMPLETED && session.result_booking_id) {
      const existingBooking = await this.bridge.findById(session.result_booking_id);
      return { session, existingBooking };
    }

    if (session.operation_type !== expectedOpType) {
      throw new BadRequestException(
        `Operation type mismatch: session is for ${session.operation_type}, attempted capture for ${expectedOpType}.`,
      );
    }
    if (!session.paypal_order_id || session.paypal_order_id !== orderId) {
      throw new BadRequestException(
        `Order ID mismatch: expected ${session.paypal_order_id}, got ${orderId}.`,
      );
    }

    if (session.status === PayPalCheckoutStatus.FAILED) {
      throw new BadRequestException(
        `Checkout session has failed: ${session.error_message || 'Payment capture failed.'}`,
      );
    }
    if (session.status === PayPalCheckoutStatus.CANCELLED) {
      throw new BadRequestException('Checkout session has been cancelled.');
    }
    if (session.status === PayPalCheckoutStatus.REFUNDED) {
      throw new BadRequestException('Checkout session has been refunded.');
    }
    if (session.status === PayPalCheckoutStatus.RECONCILE_REQUIRED) {
      throw new BadRequestException(
        `Checkout session requires manual reconciliation: ${session.failure_reason || session.error_message || 'Discrepancy detected.'}`,
      );
    }
    if (session.status === PayPalCheckoutStatus.PENDING) {
      const order = await this.paypalService.getOrder(session.paypal_order_id);
      const capture =
        order?.purchaseUnits?.[0]?.payments?.captures?.[0] ||
        order?.purchase_units?.[0]?.payments?.captures?.[0];

      if (!capture) {
        if (order?.status === 'VOIDED') {
          session.status = PayPalCheckoutStatus.FAILED;
          session.error_message = 'Order is VOIDED.';
          await session.save();
          throw new BadRequestException(
            'Payment authorization is in status VOIDED. Ticket booking cannot be completed until payment is completed.',
          );
        }
        session.status = PayPalCheckoutStatus.PENDING;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          'Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.',
        );
      }

      const captureId = capture.id;
      const captureStatus = capture.status;
      const providerAmount = capture.amount?.value || capture.amount?.total || '';
      const providerCurrency =
        capture.amount?.currencyCode ||
        capture.amount?.currency_code ||
        '';

      if (!captureId || !captureStatus || !providerAmount || !providerCurrency) {
        if (captureStatus === 'DECLINED' || captureStatus === 'FAILED' || order?.status === 'VOIDED') {
          session.status = PayPalCheckoutStatus.FAILED;
          if (captureId) session.paypal_capture_id = captureId;
          session.error_message = `Payment capture status is ${captureStatus || order?.status || 'FAILED'}.`;
          await session.save();
          throw new BadRequestException(
            `Payment authorization is in status ${captureStatus || order?.status}. Ticket booking cannot be completed until payment is completed.`,
          );
        }
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        if (captureId) {
          session.paypal_capture_id = captureId;
        }
        session.failure_reason = `PayPal capture snapshot is incomplete or missing fields (id: ${captureId || 'missing'}, status: ${captureStatus || 'missing'}, amount: ${providerAmount || 'missing'}, currency: ${providerCurrency || 'missing'}).`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      if (captureStatus === 'COMPLETED') {
        const isAmountMismatch = providerAmount !== session.provider_amount;
        const isCurrencyMismatch = providerCurrency !== session.provider_currency;

        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = isAmountMismatch
            ? `Captured amount ${providerAmount} does not match expected session amount ${session.provider_amount}.`
            : `Captured currency ${providerCurrency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          session.paypal_capture_id = captureId;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }

        session.paypal_capture_id = captureId;
        session.status = PayPalCheckoutStatus.CAPTURED;
        session.error_message = undefined;
        await session.save();
      } else if (captureStatus === 'PENDING') {
        const isAmountMismatch = providerAmount !== session.provider_amount;
        const isCurrencyMismatch = providerCurrency !== session.provider_currency;

        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = isAmountMismatch
            ? `Pending capture amount ${providerAmount} does not match expected session amount ${session.provider_amount}.`
            : `Pending capture currency ${providerCurrency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          session.paypal_capture_id = captureId;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }

        session.paypal_capture_id = captureId;
        session.status = PayPalCheckoutStatus.PENDING;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          'Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.',
        );
      } else if (
        captureStatus === 'DECLINED' ||
        captureStatus === 'FAILED' ||
        order?.status === 'VOIDED'
      ) {
        session.status = PayPalCheckoutStatus.FAILED;
        session.paypal_capture_id = captureId;
        session.error_message = `Payment capture status is ${captureStatus || order?.status || 'FAILED'}.`;
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status ${captureStatus || order?.status}. Ticket booking cannot be completed until payment is completed.`,
        );
      } else {
        // PARTIALLY_REFUNDED, REFUNDED, or any non-standard/unexpected capture status (FIX 9)
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureId;
        session.failure_reason = `Payment capture has non-standard status: ${captureStatus}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }
    }

    // Step 1: Transition CREATED -> CAPTURING
    if (session.status === PayPalCheckoutStatus.CREATED) {
      await this.verifyPreCaptureGate(session, expectedOpType, userId, orderId, role);

      const capturingSession = await this.paypalCheckoutModel.findOneAndUpdate(
        { checkout_id: checkoutId, status: PayPalCheckoutStatus.CREATED },
        { $set: { status: PayPalCheckoutStatus.CAPTURING } },
        { new: true },
      ).exec();

      if (!capturingSession) {
        const current = await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec();
        if (current?.status === PayPalCheckoutStatus.CAPTURING) {
          throw new ConflictException('Payment capture is currently in progress. Please wait.');
        }
        session = current!;
      } else {
        session = capturingSession;
        session.status = PayPalCheckoutStatus.CAPTURING;
      }
    }

    // Step 2: CAPTURING owns provider capture
    if (session.status === PayPalCheckoutStatus.CAPTURING) {
      let captureResult: {
        capture_id: string;
        status: string;
        provider_amount: string;
        provider_currency: string;
      } | null = null;

      try {
        captureResult = await this.paypalService.captureOrder({
          orderId,
          paypalRequestId: `${session.checkout_id}-capture`,
        });
      } catch (capErr: any) {
        this.logger.warn(
          `captureOrder failed for order ${orderId}: ${capErr.message}. Attempting getOrder recovery.`,
        );
        try {
          const order = await this.paypalService.getOrder(orderId);
          const capture =
            order?.purchaseUnits?.[0]?.payments?.captures?.[0] ||
            order?.purchase_units?.[0]?.payments?.captures?.[0];
          if (capture) {
            const capId = capture.id;
            const capStatus = capture.status;
            const capAmt = capture.amount?.value || capture.amount?.total || '';
            const capCur =
              capture.amount?.currencyCode ||
              capture.amount?.currency_code ||
              '';

            if (!capId || !capStatus || !capAmt || !capCur) {
              session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
              if (capId) session.paypal_capture_id = capId;
              session.failure_reason = `PayPal recovery getOrder capture record is incomplete (id: ${capId || 'missing'}, status: ${capStatus || 'missing'}, amount: ${capAmt || 'missing'}, currency: ${capCur || 'missing'}).`;
              session.error_message = session.failure_reason;
              await session.save();
              throw new BadRequestException(session.failure_reason);
            }

            captureResult = {
              capture_id: capId,
              status: capStatus,
              provider_amount: capAmt,
              provider_currency: capCur,
            };
          } else if (order?.status === 'VOIDED') {
            session.status = PayPalCheckoutStatus.FAILED;
            session.error_message = `Order is VOIDED. Capture failed: ${capErr.message}`;
            await session.save();
            throw capErr;
          } else {
            // Ambiguous capture outcome: captureOrder failed and getOrder found no capture
            session.status = PayPalCheckoutStatus.CAPTURING;
            session.error_message = `Ambiguous capture outcome: captureOrder failed (${capErr.message}), no capture found in order state ${order?.status}. Retryable.`;
            await session.save();
            throw capErr;
          }
        } catch (getErr: any) {
          if (getErr === capErr || getErr instanceof BadRequestException) {
            throw getErr;
          }
          // Ambiguous capture outcome: getOrder also failed/timed out
          session.status = PayPalCheckoutStatus.CAPTURING;
          session.error_message = `Ambiguous capture outcome: captureOrder failed (${capErr.message}), getOrder recovery failed (${getErr.message}). Retryable.`;
          await session.save();
          throw capErr;
        }
      }

      if (captureResult.status === 'PENDING') {
        const isAmountMismatch = captureResult.provider_amount !== session.provider_amount;
        const isCurrencyMismatch = captureResult.provider_currency !== session.provider_currency;
        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.paypal_capture_id = captureResult.capture_id;
          session.failure_reason = isAmountMismatch
            ? `Pending capture amount ${captureResult.provider_amount} does not match expected session amount ${session.provider_amount}.`
            : `Pending capture currency ${captureResult.provider_currency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }
        session.status = PayPalCheckoutStatus.PENDING;
        session.paypal_capture_id = captureResult.capture_id;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.`,
        );
      }

      if (captureResult.status === 'DECLINED' || captureResult.status === 'FAILED') {
        session.status = PayPalCheckoutStatus.FAILED;
        session.paypal_capture_id = captureResult.capture_id;
        session.error_message = `Payment capture status is ${captureResult.status}.`;
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status ${captureResult.status}. Ticket booking cannot be completed until payment is completed.`,
        );
      }

      if (captureResult.status === 'PARTIALLY_REFUNDED' || captureResult.status === 'REFUNDED') {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureResult.capture_id;
        session.failure_reason = `Payment capture has non-standard status: ${captureResult.status}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      if (captureResult.status !== 'COMPLETED') {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureResult.capture_id;
        session.failure_reason = `Payment capture has unexpected status: ${captureResult.status}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      session.paypal_capture_id = captureResult.capture_id;
      const isAmountMismatch = captureResult.provider_amount !== session.provider_amount;
      const isCurrencyMismatch = captureResult.provider_currency !== session.provider_currency;
      const isMissingCaptureId = !captureResult.capture_id;

      if (isAmountMismatch || isCurrencyMismatch || isMissingCaptureId) {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.failure_reason = isAmountMismatch
          ? `Captured amount ${captureResult.provider_amount} does not match expected session amount ${session.provider_amount}.`
          : isCurrencyMismatch
          ? `Captured currency ${captureResult.provider_currency} does not match expected session currency ${session.provider_currency}.`
          : 'Capture completed but missing capture ID.';
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      session.status = PayPalCheckoutStatus.CAPTURED;
      await session.save();
    }

    // Step 3: CAS Claim CAPTURED -> FINALIZING
    let isWinnerClaimant = false;
    if (session.status === PayPalCheckoutStatus.CAPTURED) {
      const claimed = await this.paypalCheckoutModel.findOneAndUpdate(
        {
          checkout_id: checkoutId,
          status: PayPalCheckoutStatus.CAPTURED,
        },
        {
          $set: {
            status: PayPalCheckoutStatus.FINALIZING,
            finalizing_started_at: new Date(),
          },
        },
        { new: true },
      ).exec();

      if (claimed) {
        session = claimed;
        session.status = PayPalCheckoutStatus.FINALIZING;
        session.finalizing_started_at = new Date();
        isWinnerClaimant = true;
      } else {
        session = (await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec())!;
      }
    }

    // Step 4: Handle concurrent / non-winner callers in FINALIZING
    if (session.status === PayPalCheckoutStatus.FINALIZING && !isWinnerClaimant) {
      if (session.paypal_capture_id) {
        const existingBooking = await this.bookingModel.findOne({
          'payment_transactions.provider_capture_id': session.paypal_capture_id,
        }).exec();
        if (existingBooking) {
          session.status = PayPalCheckoutStatus.COMPLETED;
          session.result_booking_id = existingBooking._id.toString();
          session.result_confirmation_number = existingBooking.confirmation_number;
          await session.save();
          return { session, existingBooking };
        }
      }

      const startedAt = session.finalizing_started_at
        ? new Date(session.finalizing_started_at).getTime()
        : 0;
      const isStale = Date.now() - startedAt > 60000;

      if (isStale) {
        await this.paypalCheckoutModel.findOneAndUpdate(
          {
            checkout_id: checkoutId,
            status: PayPalCheckoutStatus.FINALIZING,
            finalizing_started_at: session.finalizing_started_at,
          },
          {
            $set: {
              status: PayPalCheckoutStatus.CAPTURED,
              finalizing_started_at: undefined,
            },
          },
        ).exec();
        throw new ConflictException(
          'Checkout finalization timed out or stalled. Recovered to CAPTURED. Please retry to complete finalization.',
        );
      }

      throw new ConflictException('Payment capture is currently finalizing. Please wait.');
    }

    if (session.status === PayPalCheckoutStatus.COMPLETED && session.result_booking_id) {
      const existingBooking = await this.bridge.findById(session.result_booking_id);
      return { session, existingBooking };
    }

    if (session.status !== PayPalCheckoutStatus.FINALIZING) {
      throw new BadRequestException(`Checkout session cannot be captured in status: ${session.status}`);
    }

    return { session };
  }

  /**
   * Capture PayPal Order and create Confirmed Booking.
   */
  async capturePayPalBooking(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ booking: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.CREATE_BOOKING,
    );

    if (claimResult.existingBooking) {
      return { booking: claimResult.existingBooking, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const bookingDto = { ...(session.operation_payload as CreateBookingDto), payment_method: PaymentMethod.PAYPAL };
    bookingDto.user_id = userId;
    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.bridge.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const booking = await this.bridge.createBooking(bookingDto, externalProof);
      session.status = PayPalCheckoutStatus.COMPLETED;
      session.result_booking_id = booking._id.toString();
      session.result_confirmation_number = booking.confirmation_number;
      await session.save();
      return { booking, checkout_id: checkoutId };
    } catch (createErr: any) {
      await this.executeCompensationRefund(session, createErr, 'Booking creation failed');
      throw createErr;
    }
  }

  /**
   * Create PayPal Order for Hold Confirmation.
   */
  async capturePayPalConfirmHold(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ booking: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.CONFIRM_HOLD,
    );

    if (claimResult.existingBooking) {
      return { booking: claimResult.existingBooking, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const blockingNumber = session.operation_payload?.blocking_number;
    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.bridge.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const confirmedBooking = await this.bridge.confirmTicket(
        { blocking_number: blockingNumber, payment_method: PaymentMethod.PAYPAL, paypal_order_id: session.paypal_order_id },
        externalProof,
      );
      session.status = PayPalCheckoutStatus.COMPLETED;
      session.result_booking_id = confirmedBooking._id.toString();
      session.result_confirmation_number = confirmedBooking.confirmation_number;
      await session.save();
      return { booking: confirmedBooking, checkout_id: checkoutId };
    } catch (confErr: any) {
      await this.executeCompensationRefund(session, confErr, 'Confirm hold failed');
      throw confErr;
    }
  }

  /**
   * Create PayPal Order for Ticket Reschedule Surcharge.
   */
  async capturePayPalReschedule(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ result: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.RESCHEDULE,
    );

    if (claimResult.existingBooking) {
      return { result: { booking: claimResult.existingBooking }, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const rescheduleDto = {
      ...(session.operation_payload as RescheduleTicketDto),
      payment_method: PaymentMethod.PAYPAL,
      paypal_order_id: session.paypal_order_id,
    };

    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.bridge.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const res = await this.bridge.rescheduleTicket(rescheduleDto, externalProof);
      session.status = PayPalCheckoutStatus.COMPLETED;
      if (res?.booking?._id) {
        session.result_booking_id = res.booking._id.toString();
        session.result_confirmation_number = res.booking.confirmation_number;
      }
      await session.save();
      return { result: res, checkout_id: checkoutId };
    } catch (resErr: any) {
      await this.executeCompensationRefund(session, resErr, 'Reschedule failed');
      throw resErr;
    }
  }
}
