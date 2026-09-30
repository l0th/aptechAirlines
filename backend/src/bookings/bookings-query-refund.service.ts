import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingDocument, PaymentMethod } from './bookings.schema';
import { UserRole } from '../users/users.schema';
import { formatLocalTime } from '../common/timezone.util';
import {
  assertPayPalRefundExecutionSnapshot,
  classifyPayPalRefundStatus,
} from '../paypal/paypal.service';
import { AllocatedRefundItem } from './refund-allocation.util';
import {
  BookingsLifecycleBridge,
  BookingsLifecycleDependencies,
  BookingsLifecyclePart,
} from './bookings-lifecycle.part';

export class BookingsQueryRefundService extends BookingsLifecyclePart {
  private readonly logger = new Logger(BookingsQueryRefundService.name);

  constructor(deps: BookingsLifecycleDependencies, bridge: BookingsLifecycleBridge) {
    super(deps, bridge);
  }
  async trackTicket(code: string): Promise<any> {
    const booking = await this.bookingModel
      .findOne({
        $or: [
          { blocking_number: code },
          { confirmation_number: code },
          { pnr_code: code },
          { cancellation_number: code },
        ],
      })
      .populate('user_id', '-password_hash -preferred_credit_card')
      .exec();

    if (!booking) {
      throw new NotFoundException(`No booking found with code ${code}`);
    }

    // Enrich with flight real-time status, airport timezones and local wall times
    const enrichedCoupons: any[] = [];
    let hasEmergencyChanges = false;

    const tzCache: Record<string, string | undefined> = {};
    const getTz = async (iata: string): Promise<string | undefined> => {
      if (!iata) return undefined;
      if (iata in tzCache) return tzCache[iata];
      let tz: string | undefined = undefined;
      if (this.airportsService) {
        try {
          const apt = await this.airportsService.findByIata(iata);
          if (apt?.time_zone) {
            new Intl.DateTimeFormat('en-US', { timeZone: apt.time_zone });
            tz = apt.time_zone;
          }
        } catch {}
      } else if (typeof (this.flightsService as any).getAirportTimeZone === 'function') {
        tz = await (this.flightsService as any).getAirportTimeZone(iata);
      }
      tzCache[iata] = tz;
      return tz;
    };

    for (const coupon of booking.ticket_coupons) {
      const flight = await this.flightsService.findById(coupon.flight_id.toString());
      const isAltered = flight.status !== 'SCHEDULED' || !!flight.delay_reason;
      if (isAltered) hasEmergencyChanges = true;

      const originTz = await getTz(flight.origin_iata);
      const destTz = await getTz(flight.dest_iata);
      // Mongoose embedded documents keep schema fields inside `_doc` when
      // spread directly. Convert to a plain object first so consumers such as
      // the reschedule UI receive `leg_type`, cabin/seat fields, etc. at the
      // expected top level without leaking Mongoose internals.
      const plainCoupon = typeof (coupon as any)?.toObject === 'function'
        ? (coupon as any).toObject()
        : { ...(coupon as any) };

      enrichedCoupons.push({
        ...plainCoupon,
        origin_iata: flight.origin_iata,
        dest_iata: flight.dest_iata,
        origin_time_zone: originTz,
        dest_time_zone: destTz,
        departure_date: flight.departure_date,
        scheduled_departure: flight.scheduled_departure,
        scheduled_arrival: flight.scheduled_arrival,
        scheduled_departure_local: formatLocalTime(flight.scheduled_departure, originTz),
        scheduled_arrival_local: formatLocalTime(flight.scheduled_arrival, destTz),
        actual_departure: flight.actual_departure,
        actual_arrival: flight.actual_arrival,
        actual_departure_local: flight.actual_departure ? formatLocalTime(flight.actual_departure, originTz) : undefined,
        actual_arrival_local: flight.actual_arrival ? formatLocalTime(flight.actual_arrival, destTz) : undefined,
        flight_status: flight.status,
        delay_reason: flight.delay_reason,
        is_highlighted_change: isAltered,
      });
    }

    return {
      booking_info: booking,
      has_emergency_changes: hasEmergencyChanges,
      flight_coupons: enrichedCoupons,
    };
  }

  /**
   * Release the seats held by a booking (one release per distinct
   * flight/inventory pair). Public so the scheduler can reuse it when
   * auto-cancelling expired blocked bookings.
   */
  async releaseSeatsForBooking(booking: BookingDocument) {
    await this.bridge.releaseSeatsForCouponsStrict(booking.passengers.length, booking.ticket_coupons);
  }

  /**
   * Release seats for an arbitrary list of coupons (deduplicated by
   * flight/inventory pair).
   */
  async getEarliestDeparture(booking: BookingDocument): Promise<Date> {
    if (!booking.ticket_coupons || booking.ticket_coupons.length === 0) {
      throw new BadRequestException('Booking has no flight coupons to determine departure date.');
    }

    let earliest: Date | null = null;
    const lookupErrors: string[] = [];

    for (const c of booking.ticket_coupons) {
      if (!c.flight_id) continue;
      try {
        const flight = await this.flightsService.findById(c.flight_id.toString());
        if (!flight || !flight.scheduled_departure) {
          lookupErrors.push(`Flight ${c.flight_id} has no valid scheduled_departure`);
          continue;
        }
        const dep = new Date(flight.scheduled_departure);
        if (isNaN(dep.getTime())) {
          lookupErrors.push(`Flight ${c.flight_id} scheduled_departure is invalid date`);
          continue;
        }
        if (!earliest || dep < earliest) {
          earliest = dep;
        }
      } catch (e: any) {
        lookupErrors.push(`Flight ${c.flight_id} lookup failed: ${e?.message || e}`);
      }
    }

    if (!earliest) {
      throw new BadRequestException(
        `Unable to resolve valid departure date for booking: ${lookupErrors.join('; ')}`,
      );
    }

    return earliest;
  }

  /**
   * Ownership pre-check: a CUSTOMER may only manage their own bookings.
   * Staff roles (CLERK/ADMIN/SUPER_ADMIN) bypass the check.
   */
  async assertOwnership(identifier: string, userId: string, role: string): Promise<void> {
    if (role !== UserRole.CUSTOMER) {
      return;
    }
    const booking = await this.bookingModel
      .findOne({
        $or: [
          { blocking_number: identifier },
          { confirmation_number: identifier },
          { pnr_code: identifier },
          { cancellation_number: identifier },
        ],
      })
      .exec();
    // Unknown identifier: let the service layer raise the proper NotFound error
    if (!booking) {
      return;
    }
    if (booking.user_id.toString() !== userId.toString()) {
      throw new ForbiddenException('You do not have permission to manage this booking');
    }
  }

  /**
   * Post-commit PayPal refunds execution with outbox error tracking.
   */
  async executePostCommitRefunds(
    bookingId: any,
    refundAllocations: AllocatedRefundItem[],
    pnrCode: string,
  ): Promise<void> {
    if (!this.paypalService || !refundAllocations || refundAllocations.length === 0) {
      return;
    }

    for (const item of refundAllocations) {
      if (item.payment_method === PaymentMethod.PAYPAL) {
        try {
          assertPayPalRefundExecutionSnapshot({
            payment_reference: item.payment_reference,
            provider_capture_id: item.provider_capture_id || '',
            provider_amount: item.provider_amount || '',
            provider_currency: item.provider_currency || '',
            exchange_rate_vnd_per_unit: item.exchange_rate_vnd_per_unit,
            require_fx: true,
            context: 'executePostCommitRefunds',
          });
        } catch (valErr: any) {
          this.logger.error(
            `Incomplete PayPal refund provenance for booking ${pnrCode}, ref ${item.payment_reference}: ${valErr?.message}`,
          );
          item.status = 'FAILED';
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': 'FAILED',
                  'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
                  'payment_transactions.$.next_retry_at': null,
                },
              },
            );
          }
          continue;
        }

        try {
          const refundRes = await this.paypalService.refundCapture({
            captureId: item.provider_capture_id!,
            providerAmount: item.provider_amount!,
            providerCurrency: item.provider_currency!,
            paypalRequestId: item.payment_reference,
            note: `Refund for PNR ${pnrCode}`,
          });
          const classified = classifyPayPalRefundStatus(refundRes.status);
          const localStatus = classified.local_status;
          const isFailed = classified.is_failed;
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': localStatus,
                  'payment_transactions.$.provider_refund_id': refundRes.refund_id,
                  'payment_transactions.$.provider_status': classified.provider_status,
                  ...(isFailed
                    ? {
                        'payment_transactions.$.failure_reason': `PayPal refund returned status: ${classified.provider_status}`,
                        'payment_transactions.$.next_retry_at': null,
                      }
                    : {}),
                },
              },
            );
          }
          item.status = localStatus;
          (item as any).provider_refund_id = refundRes.refund_id;
          (item as any).provider_status = classified.provider_status;
          if (isFailed) {
            item.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
            (item as any).next_retry_at = null;
          }
        } catch (ppErr: any) {
          this.logger.error(
            `Post-commit PayPal refund failed for booking ${pnrCode}, ref ${item.payment_reference}: ${ppErr?.message || ppErr}`,
          );
          item.status = 'PENDING';
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': 'PENDING',
                  'payment_transactions.$.provider_status': 'FAILED',
                  'payment_transactions.$.failure_reason': ppErr?.message || 'PayPal refund call failed',
                  'payment_transactions.$.next_retry_at': new Date(Date.now() + 60 * 60 * 1000),
                },
              },
            );
          }
        }
      }
    }
  }

  /**
   * Pure, side-effect-free quote calculation for ticket booking.
   * Full validation parity with createBooking without database mutation.
   */

}
