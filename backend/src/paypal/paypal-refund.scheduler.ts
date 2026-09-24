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
      let modified = false;

      for (const tx of booking.payment_transactions) {
        if (
          tx.payment_method === PaymentMethod.PAYPAL &&
          (tx.transaction_type === 'REFUND' || tx.transaction_type === 'RESCHEDULE_REFUND') &&
          tx.status === 'PENDING'
        ) {
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
            modified = true;
            failed++;
            continue;
          }

          processed++;

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
                const currentRetries = (tx.retry_count || 0) + 1;
                tx.retry_count = currentRetries;
                const delayHours = Math.pow(2, Math.min(currentRetries - 1, 4));
                tx.next_retry_at = new Date(Date.now() + delayHours * 60 * 60 * 1000);
                this.logger.log(
                  `PayPal refund remains PENDING for booking ${booking.confirmation_number}: refundId=${tx.provider_refund_id}. Scheduled next check in ${delayHours} hour(s).`,
                );
              } else {
                tx.status = 'FAILED';
                tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
                tx.next_retry_at = undefined;
                failed++;
              }
              modified = true;
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
              modified = true;
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
              this.logger.log(
                `PayPal refund remains PENDING for booking ${booking.confirmation_number}: refundId=${refundResult.refund_id}`,
              );
            } else {
              tx.status = 'FAILED';
              tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
              tx.next_retry_at = undefined;
              failed++;
            }
            modified = true;
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
            modified = true;
          }
        }
      }

      if (modified) {
        await booking.save();
      }
    }

    return { processed, succeeded, failed };
  }
}
