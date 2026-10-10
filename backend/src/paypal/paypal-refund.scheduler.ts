import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, PaymentMethod } from '../bookings/bookings.schema';
import { PaypalService, assertPayPalRefundExecutionSnapshot, classifyPayPalRefundStatus } from './paypal.service';

const MAX_REFUND_RETRIES = 5;

@Injectable()
export class PaypalRefundScheduler {
  private readonly logger = new Logger(PaypalRefundScheduler.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly paypalService: PaypalService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyPendingRefunds(): Promise<{ processed: number; succeeded: number; failed: number }> {
    return this.processPendingRefunds();
  }

  /**
   * Processes pending PayPal refunds with idempotency and exponential backoff.
   * Can be executed by background cron or manually triggered by an Administrator.
   */
  async processPendingRefunds(
    targetBookingId?: string,
    targetPaymentReference?: string,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!this.paypalService.isPayPalActive()) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    const now = new Date();
    const query: any = {
      payment_transactions: {
        $elemMatch: {
          payment_method: PaymentMethod.PAYPAL,
          transaction_type: { $in: ['REFUND', 'RESCHEDULE_REFUND'] },
          status: 'PENDING',
          ...(targetPaymentReference ? { payment_reference: targetPaymentReference } : {}),
          $or: [
            { next_retry_at: { $lte: now } },
            { next_retry_at: null },
            { next_retry_at: { $exists: false } },
          ],
        },
      },
    };

    if (targetBookingId) {
      query._id = targetBookingId;
    }

    const bookings = await this.bookingModel.find(query).exec();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const booking of bookings) {
      for (const [index, tx] of booking.payment_transactions.entries()) {
        if (
          tx.payment_method === PaymentMethod.PAYPAL &&
          (tx.transaction_type === 'REFUND' || tx.transaction_type === 'RESCHEDULE_REFUND') &&
          tx.status === 'PENDING' &&
          (!targetPaymentReference || tx.payment_reference === targetPaymentReference) &&
          // A booking can contain multiple refunds with different retry windows.
          // The outer $elemMatch only proves that ONE transaction is due.
          (!tx.next_retry_at || new Date(tx.next_retry_at).getTime() <= now.getTime())
        ) {
          if (!tx.payment_reference?.trim()) {
            // Legacy corrupt rows cannot be claimed by reference. Mark just
            // their array position terminally failed without calling PayPal.
            await this.bookingModel.updateOne(
              { _id: booking._id, [`payment_transactions.${index}.status`]: 'PENDING',
                [`payment_transactions.${index}.payment_reference`]: { $in: [null, ''] } },
              { $set: { [`payment_transactions.${index}.status`]: 'FAILED',
                [`payment_transactions.${index}.failure_reason`]: 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
                [`payment_transactions.${index}.next_retry_at`]: null } },
            );
            processed++;
            failed++;
            continue;
          }

          // Multiple cron instances or an admin retry must not submit the
          // same pending refund concurrently. Reclaim after a bounded lease.
          const leaseUntil = new Date(Date.now() + 30 * 60 * 1000);
          const claim = await this.bookingModel.updateOne(
            { _id: booking._id, payment_transactions: { $elemMatch: {
              payment_reference: tx.payment_reference,
              payment_method: PaymentMethod.PAYPAL,
              transaction_type: { $in: ['REFUND', 'RESCHEDULE_REFUND'] },
              status: 'PENDING',
              $or: [
                { next_retry_at: { $lte: now } },
                { next_retry_at: null },
                { next_retry_at: { $exists: false } },
              ],
            } } },
            { $set: { 'payment_transactions.$.next_retry_at': leaseUntil } },
          );
          if (claim.modifiedCount !== 1) continue;
          processed++;
          try {
          // FIX 6 / FIX 11: Validate snapshot provenance first
          try {
            assertPayPalRefundExecutionSnapshot({
              payment_reference: tx.payment_reference || '',
              provider_capture_id: tx.provider_capture_id || '',
              provider_amount: tx.provider_amount || '',
              provider_currency: tx.provider_currency || '',
              exchange_rate_vnd_per_unit: tx.exchange_rate_vnd_per_unit,
              require_fx: true,
              context: 'PaypalRefundScheduler.processPendingRefunds',
            });
          } catch (valErr: any) {
            this.logger.error(
              `Incomplete PayPal refund provenance for pending refund on booking ${booking.confirmation_number || booking.pnr_code}, ref ${tx.payment_reference}: ${valErr?.message}`,
            );
            tx.status = 'FAILED';
            tx.failure_reason = 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE';
            tx.next_retry_at = undefined;
            failed++;
            continue;
          }

          // FIX 7: Existing provider_refund_id means RECONCILE, NOT RESUBMIT
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
                succeeded++;
                this.logger.log(
                  `Successfully reconciled pending PayPal refund for booking ${booking.confirmation_number}: refundId=${tx.provider_refund_id}`,
                );
              } else if (classified.is_pending) {
                tx.status = 'PENDING';
                // A PayPal PENDING result is not a failed retry. Keep the
                // failure budget for actual provider/network errors.
                const delayHours = 1;
                tx.next_retry_at = new Date(Date.now() + delayHours * 60 * 60 * 1000);
                tx.failure_reason = undefined;
                this.logger.log(
                  `PayPal refund remains PENDING for booking ${booking.confirmation_number}: refundId=${tx.provider_refund_id}. Scheduled next check in ${delayHours} hour(s).`,
                );
              } else {
                tx.status = 'FAILED';
                tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
                tx.next_retry_at = undefined;
                failed++;
              }
            } catch (reconErr: any) {
              failed++;
              const currentRetries = (tx.retry_count || 0) + 1;
              tx.retry_count = currentRetries;
              tx.failure_reason = reconErr?.message || String(reconErr);
              if (currentRetries >= MAX_REFUND_RETRIES) {
                tx.status = 'FAILED';
                tx.next_retry_at = undefined;
                this.logger.error(
                  `PayPal refund reconciliation for ${booking.confirmation_number} reached maximum ${MAX_REFUND_RETRIES} retries. Flagged as FAILED.`,
                );
              } else {
                const delayHours = Math.pow(2, currentRetries - 1);
                tx.next_retry_at = new Date(Date.now() + delayHours * 60 * 60 * 1000);
              }
            }
            continue;
          }

          // Absence of provider_refund_id: call refundCapture
          const idempotencyKey = tx.payment_reference;
          try {
            const refundResult = await this.paypalService.refundCapture({
              captureId: tx.provider_capture_id,
              providerAmount: tx.provider_amount,
              providerCurrency: tx.provider_currency,
              paypalRequestId: idempotencyKey,
              note: `Automated refund retry for booking ${booking.confirmation_number || booking.pnr_code}`,
            });

            const classified = classifyPayPalRefundStatus(refundResult.status);
            tx.provider_refund_id = refundResult.refund_id;
            tx.provider_status = classified.provider_status;

            if (classified.is_success) {
              tx.status = 'SUCCESS';
              tx.failure_reason = undefined;
              tx.next_retry_at = undefined;
              succeeded++;
              this.logger.log(
                `Successfully processed pending PayPal refund for booking ${booking.confirmation_number}: refundId=${refundResult.refund_id}`,
              );
            } else if (classified.is_pending) {
              tx.status = 'PENDING';
              tx.failure_reason = undefined;
              tx.next_retry_at = new Date(Date.now() + 60 * 60 * 1000);
              this.logger.log(
                `PayPal refund remains PENDING for booking ${booking.confirmation_number}: refundId=${refundResult.refund_id}`,
              );
            } else {
              tx.status = 'FAILED';
              tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
              tx.next_retry_at = undefined;
              failed++;
            }
          } catch (err: any) {
            failed++;
            const currentRetries = (tx.retry_count || 0) + 1;
            tx.retry_count = currentRetries;
            tx.failure_reason = err?.message || String(err);

            if (currentRetries >= MAX_REFUND_RETRIES) {
              tx.status = 'FAILED';
              tx.next_retry_at = undefined;
              this.logger.error(
                `PayPal refund for ${booking.confirmation_number} reached maximum ${MAX_REFUND_RETRIES} retries. Flagged as FAILED for manual administrative review.`,
              );
            } else {
              // Exponential backoff: 1h, 2h, 4h, 8h...
              const delayHours = Math.pow(2, currentRetries - 1);
              tx.next_retry_at = new Date(Date.now() + delayHours * 60 * 60 * 1000);
              this.logger.warn(
                `PayPal refund attempt ${currentRetries} failed for ${booking.confirmation_number}. Scheduled next retry in ${delayHours} hour(s).`,
              );
            }
          }
          } finally {
            // Persist each claimed refund immediately, including early returns
            // from provenance validation and reconciliation. A separate worker
            // cannot overwrite it without first acquiring the same lease.
            const persisted = await this.bookingModel.updateOne(
              { _id: booking._id, payment_transactions: { $elemMatch: {
                payment_reference: tx.payment_reference,
                status: 'PENDING',
                next_retry_at: leaseUntil,
              } } },
              { $set: {
                'payment_transactions.$.status': tx.status,
                'payment_transactions.$.provider_refund_id': tx.provider_refund_id || null,
                'payment_transactions.$.provider_status': tx.provider_status || null,
                'payment_transactions.$.retry_count': tx.retry_count || 0,
                'payment_transactions.$.failure_reason': tx.failure_reason || null,
                'payment_transactions.$.next_retry_at': tx.next_retry_at || null,
              } },
            );
            if (persisted.matchedCount !== 1) {
              this.logger.warn(`Skipped stale PayPal refund state for ${booking.confirmation_number || booking.pnr_code}, ref ${tx.payment_reference}.`);
            }
          }
        }
      }
    }

    return { processed, succeeded, failed };
  }
}
