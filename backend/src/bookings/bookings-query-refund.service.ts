import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingDocument, PaymentMethod } from './bookings.schema';
import { UserRole } from '../users/users.schema';
import { formatLocalTime } from '../common/timezone.util';
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
      // Only currently usable coupons determine the refund policy window.
      if (String(c.coupon_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
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
    if (!this.paypalRefundScheduler || !refundAllocations?.length) {
      return;
    }

    const paypalRefunds = refundAllocations.filter((item) => item.payment_method === PaymentMethod.PAYPAL);
    for (const item of paypalRefunds) {
      // The same atomic claim/lease is used by post-commit, hourly cron and
      // admin retry. Only the claim winner is allowed to contact PayPal.
      try {
        await this.paypalRefundScheduler.processPendingRefunds(
          String(bookingId),
          item.payment_reference,
        );
      } catch (err: any) {
        // Booking changes are already committed. The outbox remains PENDING
        // and the scheduled worker can resume the refund later.
        this.logger.error(
          `Post-commit refund processing interrupted for ${pnrCode}, ref ${item.payment_reference}: ${err?.message || err}`,
        );
      }
    }

    // Surface persisted provider results in the booking cancellation response.
    const persisted = await this.bookingModel.findById(bookingId)
      .select('payment_transactions')
      .lean()
      .exec();
    for (const item of paypalRefunds) {
      const tx = persisted?.payment_transactions?.find(
        (row) => row.payment_reference === item.payment_reference,
      );
      if (tx) {
        item.status = tx.status as AllocatedRefundItem['status'];
        item.provider_refund_id = tx.provider_refund_id;
        item.provider_status = tx.provider_status;
        item.failure_reason = tx.failure_reason;
      }
    }
  }

  /**
   * Pure, side-effect-free quote calculation for ticket booking.
   * Full validation parity with createBooking without database mutation.
   */

}
