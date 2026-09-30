import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingDocument,
  BookingStatus,
  PaymentMethod,
} from './bookings.schema';
import { CancelTicketDto } from './bookings.dto';
import { formatLocalTime } from '../common/timezone.util';
import { ItineraryLegData, isValidMaskedCard } from '../mail/mail.service';
import { FlightDocument } from '../flights/flights.schema';
import { allocateRefundSources, AllocatedRefundItem } from './refund-allocation.util';
import {
  BookingsLifecycleBridge,
  BookingsLifecycleDependencies,
  BookingsLifecyclePart,
} from './bookings-lifecycle.part';

export class BookingsCancellationService extends BookingsLifecyclePart {
  private readonly logger = new Logger(BookingsCancellationService.name);

  constructor(deps: BookingsLifecycleDependencies, bridge: BookingsLifecycleBridge) {
    super(deps, bridge);
  }
  async releaseSeatsForCouponsStrict(passengerCount: number, coupons: any[]) {
    const legs = this.distinctCouponLegs(coupons);
    const released: Array<{ flightId: string; inventoryId: string }> = [];
    try {
      for (const item of legs) {
        await this.flightsService.updateAvailableSeats(item.flightId, item.inventoryId, +passengerCount);
        released.push(item);
      }
    } catch (error: any) {
      const compensationErrors: string[] = [];
      for (const item of released.reverse()) {
        try {
          await this.flightsService.updateAvailableSeats(item.flightId, item.inventoryId, -passengerCount);
        } catch (compErr: any) {
          compensationErrors.push(
            `Failed to re-reserve seats for flight ${item.flightId} inventory ${item.inventoryId}: ${compErr?.message || compErr}`,
          );
        }
      }
      if (compensationErrors.length > 0) {
        throw new InternalServerErrorException(
          `Seat release failed and compensating re-reservation was incomplete: ${compensationErrors.join('; ')}. Original release error: ${error?.message || error}`,
        );
      }
      throw error;
    }
  }

  /**
   * Restore (re-reserve) seats for deduplicated coupons. Used during rollback.
   */
  private async restoreSeatsForCouponsStrict(passengerCount: number, coupons: any[]) {
    for (const item of this.distinctCouponLegs(coupons)) {
      await this.flightsService.updateAvailableSeats(item.flightId, item.inventoryId, -passengerCount);
    }
  }

  private distinctCouponLegs(coupons: any[]): Array<{ flightId: string; inventoryId: string }> {
    const legMap = new Map<string, { flightId: string; inventoryId: string }>();
    for (const coupon of coupons || []) {
      if (!coupon || !coupon.flight_id || !coupon.inventory_id) continue;
      const flightId = coupon.flight_id.toString();
      const inventoryId = coupon.inventory_id.toString();
      legMap.set(`${flightId}_${inventoryId}`, { flightId, inventoryId });
    }
    return [...legMap.values()];
  }

  private async loadDistinctCouponFlights(coupons: any[]): Promise<FlightDocument[]> {
    const flights: FlightDocument[] = [];
    for (const leg of this.distinctCouponLegs(coupons)) {
      flights.push(await this.flightsService.findById(leg.flightId));
    }
    return flights;
  }

  private async buildItineraryLegs(ticketCoupons: any[]): Promise<ItineraryLegData[]> {
    const legs: ItineraryLegData[] = [];
    const seen = new Set<string>();

    for (const coupon of ticketCoupons || []) {
      if (!coupon.flight_id) continue;
      const key = `${coupon.flight_number || ''}_${coupon.flight_id.toString()}_${coupon.inventory_id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const flight = await this.flightsService.findById(coupon.flight_id.toString());
        const originTz = await this.flightsService.getAirportTimeZone(flight.origin_iata);
        const destTz = await this.flightsService.getAirportTimeZone(flight.dest_iata);

        const depLocal = formatLocalTime(flight.scheduled_departure, originTz);
        const arrLocal = formatLocalTime(flight.scheduled_arrival, destTz);

        const depStr = depLocal
          ? `${depLocal} (${originTz || 'UTC'})`
          : `${new Date(flight.scheduled_departure).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;
        const arrStr = arrLocal
          ? `${arrLocal} (${destTz || 'UTC'})`
          : (flight.scheduled_arrival
              ? `${new Date(flight.scheduled_arrival).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`
              : undefined);

        legs.push({
          flightNumber: flight.flight_number,
          origin: flight.origin_iata,
          destination: flight.dest_iata,
          cabinClass: coupon.cabin_class,
          departureTimeFormatted: depStr,
          arrivalTimeFormatted: arrStr,
        });
      } catch (err) {
        if (coupon.flight_number) {
          legs.push({
            flightNumber: coupon.flight_number,
            origin: 'UNKNOWN',
            destination: 'UNKNOWN',
            cabinClass: coupon.cabin_class,
            departureTimeFormatted: 'Schedule unresolvable',
          });
        }
      }
    }
    return legs;
  }

  async cancelExpiredBlockStrict(booking: BookingDocument): Promise<void> {
    const originalStatus = booking.status;
    const originalCancelNum = booking.cancellation_number;

    const passengerCount = booking.passengers?.length ?? 0;
    const coupons = booking.ticket_coupons ?? [];

    await this.releaseSeatsForCouponsStrict(
      passengerCount,
      coupons,
    );

    booking.status = BookingStatus.CANCELLED;
    booking.cancellation_number = this.bridge.generateCode('CAN');

    try {
      await booking.save();
      if (this.seatAllocationService) {
        await this.seatAllocationService.releaseAllocations(booking._id).catch(() => {});
      }
    } catch (saveError) {
      try {
        await this.restoreSeatsForCouponsStrict(
          passengerCount,
          coupons,
        );
      } catch (_) {}
      booking.status = originalStatus;
      booking.cancellation_number = originalCancelNum;
      throw saveError;
    }

    if (this.mailService) {
      try {
        const user = await this.usersService.findById(booking.user_id.toString());
        if (user?.email) {
          const passengerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Customer';
          const itinerary = await this.buildItineraryLegs(booking.ticket_coupons);
          const firstLeg = itinerary[0];

          // Finding F2: Find the actual earliest departure leg to resolve its origin timezone
          let earliestFlight: any = null;
          let minDepTime = Infinity;
          for (const coupon of booking.ticket_coupons || []) {
            if (!coupon.flight_id) continue;
            try {
              const flight = await this.flightsService.findById(coupon.flight_id.toString());
              const depTime = new Date(flight.scheduled_departure).getTime();
              if (depTime < minDepTime) {
                minDepTime = depTime;
                earliestFlight = flight;
              }
            } catch (_) {}
          }

          let originTz: string | undefined;
          if (earliestFlight?.origin_iata) {
            originTz = await this.flightsService.getAirportTimeZone(earliestFlight.origin_iata);
          } else if (firstLeg?.origin && firstLeg.origin !== 'UNKNOWN') {
            originTz = await this.flightsService.getAirportTimeZone(firstLeg.origin);
          }

          let holdDeadlineFormatted = '-';
          if (booking.time_limit_deadline) {
            const localDeadline = formatLocalTime(new Date(booking.time_limit_deadline), originTz);
            holdDeadlineFormatted = localDeadline
              ? `${localDeadline} (${originTz || 'UTC'})`
              : `${new Date(booking.time_limit_deadline).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;
          }

          const primaryLeg = earliestFlight ? {
            flightNumber: earliestFlight.flight_number,
            origin: earliestFlight.origin_iata,
            destination: earliestFlight.dest_iata,
            departureTimeFormatted: formatLocalTime(earliestFlight.scheduled_departure, originTz)
              ? `${formatLocalTime(earliestFlight.scheduled_departure, originTz)} (${originTz || 'UTC'})`
              : undefined,
          } : firstLeg;

          const sent = await this.mailService.sendExpiredHoldCancellationEmail({
            toEmail: user.email,
            passengerName,
            bookingReference: booking.pnr_code,
            blockingNumber: booking.blocking_number,
            cancellationNumber: booking.cancellation_number!,
            holdDeadlineFormatted,
            flightNumber: primaryLeg?.flightNumber,
            origin: primaryLeg?.origin,
            destination: primaryLeg?.destination,
            departureTimeFormatted: primaryLeg?.departureTimeFormatted,
            itinerary,
          });
          if (!sent) {
            this.logger.warn(
              `Expired hold cancellation email delivery returned false for booking ${booking.pnr_code} (${user.email}); booking remains cancelled.`,
            );
          }
        }
      } catch (mailErr: any) {
        this.logger.error(
          `Failed to send expired hold cancellation email for booking ${booking.pnr_code}: ${mailErr?.message || mailErr}`,
        );
      }
    }
  }

  /**
   * §3.6.2 Booking window validation: Ensure the flight's operating date (YYYY-MM-DD)
   * falls within the authoritative [min_date, max_date] calendar booking window.
   * For connecting itineraries, only the first leg's operating date determines the boundary.
   */
  async cancelTicket(dto: CancelTicketDto): Promise<{
    booking: BookingDocument;
    refund_amount: number;
    refund_percentage: number;
    cancellation_number: string;
    currency: string;
    refund_card_masked?: string;
    refund_details?: Array<{
      payment_reference: string;
      payment_method?: PaymentMethod;
      amount: number;
      card_masked?: string;
      provider_amount?: string;
      provider_currency?: string;
      status: string;
    }>;
    message: string;
  }> {
    const booking = await this.bookingModel
      .findOne({
        $or: [
          { blocking_number: dto.identifier },
          { confirmation_number: dto.identifier },
          { pnr_code: dto.identifier },
        ],
      })
      .exec();

    if (!booking) {
      throw new NotFoundException(`Booking with identifier ${dto.identifier} not found`);
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('This booking has already been cancelled.');
    }

    let refundAmount = 0;
    let refundPercentage = 0;
    let originalUserSkyMiles = 0;
    let refundCardMasked: string | undefined = undefined;
    let refundPaymentMethod: PaymentMethod | undefined = undefined;
    let refundAllocations: AllocatedRefundItem[] = [];

    if (booking.status === BookingStatus.CONFIRMED) {
      const earliestDeparture = await this.bridge.getEarliestDeparture(booking);
      const now = new Date();
      const daysBefore = Math.max(0, (earliestDeparture.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      refundPercentage = await this.policiesService.calculateRefundPercentage(daysBefore);
      refundAmount = Math.round((booking.total_amount * refundPercentage) / 100);

      const user = booking.user_id ? await this.usersService.findById(booking.user_id.toString()) : null;
      originalUserSkyMiles = user?.sky_miles || 0;

      if (refundAmount > 0) {
        const placeholders = new Set([
          'ORIGINAL-PAYMENT-CARD',
          'SAVED-CARD',
          'CARD-DEFAULT',
          'UNKNOWN',
        ]);

        const normalizeCard = (val?: string | null): string | null => {
          if (!val || typeof val !== 'string') return null;
          const trimmed = val.trim();
          if (trimmed.length === 0 || placeholders.has(trimmed.toUpperCase())) {
            return null;
          }
          const digits = trimmed.replace(/\D/g, '');
          if (digits.length >= 4) {
            return `**** **** **** ${digits.slice(-4)}`;
          }
          return null;
        };

        let usableCard: string | undefined = undefined;
        let usablePaymentMethod: PaymentMethod | undefined = undefined;

        if (Array.isArray(booking.payment_transactions) && booking.payment_transactions.length > 0) {
          const candidates: Array<{
            tx: any;
            index: number;
            timestamp: number;
            normalizedCard: string;
            paymentMethod?: PaymentMethod;
          }> = [];

          booking.payment_transactions.forEach((tx: any, index: number) => {
            const txType = (tx?.transaction_type || '').toUpperCase();
            const txStatus = (tx?.status || 'SUCCESS').toUpperCase();
            if (txType === 'PAYMENT' && txStatus === 'SUCCESS') {
              const normalized = normalizeCard(tx?.card_masked);
              if (normalized) {
                const rawTime = tx?.created_at ? new Date(tx.created_at).getTime() : NaN;
                const timestamp = isNaN(rawTime) ? -1 : rawTime;
                candidates.push({
                  tx,
                  index,
                  timestamp,
                  normalizedCard: normalized,
                  paymentMethod: (tx.payment_method as PaymentMethod) || undefined,
                });
              }
            }
          });

          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              if (a.timestamp >= 0 && b.timestamp >= 0) {
                if (b.timestamp !== a.timestamp) {
                  return b.timestamp - a.timestamp;
                }
                return b.index - a.index;
              }
              if (a.timestamp >= 0 && b.timestamp < 0) return -1;
              if (a.timestamp < 0 && b.timestamp >= 0) return 1;
              return b.index - a.index;
            });

            usableCard = candidates[0].normalizedCard;
            usablePaymentMethod = candidates[0].paymentMethod;
          }
        }

        if (!usableCard && user?.preferred_credit_card) {
          const normalized = normalizeCard(user.preferred_credit_card);
          if (normalized) {
            usableCard = normalized;
            usablePaymentMethod = PaymentMethod.PROFILE_CARD;
          }
        }

        const hasPaypal = booking.payment_transactions?.some(
          (t) => t.status === 'SUCCESS' && t.payment_method === PaymentMethod.PAYPAL,
        );
        if (!usableCard && !hasPaypal) {
          throw new BadRequestException('Cannot process refund: no valid payment card found for this booking.');
        }

        refundCardMasked = usableCard;
        refundPaymentMethod = usablePaymentMethod || (hasPaypal ? PaymentMethod.PAYPAL : undefined);

        refundAllocations = allocateRefundSources(
          booking.payment_transactions || [],
          refundAmount,
          'REFUND',
          (p) => this.bridge.generateCode(p),
        );

        if (refundAllocations.length > 0) {
          for (const alloc of refundAllocations) {
            if (alloc.payment_method !== PaymentMethod.PAYPAL) {
              const norm = normalizeCard(alloc.card_masked);
              if (norm) {
                alloc.card_masked = norm;
              } else if (usableCard) {
                alloc.card_masked = usableCard;
                if (!alloc.payment_method && usablePaymentMethod) {
                  alloc.payment_method = usablePaymentMethod;
                }
              }
            }
          }
          const cardItem = refundAllocations.find((a) => a.card_masked);
          if (cardItem?.card_masked) {
            refundCardMasked = cardItem.card_masked;
            refundPaymentMethod = cardItem.payment_method || refundPaymentMethod;
          } else {
            const ppItem = refundAllocations.find((a) => a.payment_method === PaymentMethod.PAYPAL);
            if (ppItem) {
              refundPaymentMethod = PaymentMethod.PAYPAL;
            }
          }
        }
      }
    } else if (booking.status === BookingStatus.BLOCKED) {
      refundPercentage = 0;
      refundAmount = 0;
    }

    const passengerCount = booking.passengers.length;
    const originalCoupons = booking.ticket_coupons.map((coupon: any) => ({
      ...(coupon.toObject ? coupon.toObject() : coupon),
    }));

    const snapshot = {
      status: booking.status,
      cancellation_number: booking.cancellation_number,
      total_miles_accrued: booking.total_miles_accrued,
      payment_transactions: booking.payment_transactions.map((transaction: any) => ({
        ...(transaction.toObject ? transaction.toObject() : transaction),
      })),
      ticket_coupons: booking.ticket_coupons.map((coupon: any) => ({
        ...(coupon.toObject ? coupon.toObject() : coupon),
      })),
    };

    const cancellationNumber = this.bridge.generateCode('CAN');
    const wasConfirmed = booking.status === BookingStatus.CONFIRMED;
    let seatsReleased = false;
    let skyMilesAdjusted = false;

    try {
      await this.releaseSeatsForCouponsStrict(passengerCount, originalCoupons);
      seatsReleased = true;

      if (booking.status === BookingStatus.CONFIRMED) {
        if (refundAmount > 0) {
          if (refundAllocations.length > 0) {
            for (const alloc of refundAllocations) {
              booking.payment_transactions.push({
                transaction_type: alloc.transaction_type,
                payment_reference: alloc.payment_reference,
                source_payment_reference: alloc.source_payment_reference,
                payment_method: alloc.payment_method,
                payment_provider: alloc.payment_method === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
                amount: alloc.amount,
                currency: alloc.currency,
                card_masked: alloc.card_masked,
                provider_capture_id: alloc.provider_capture_id,
                provider_order_id: alloc.provider_order_id,
                provider_amount: alloc.provider_amount,
                provider_currency: alloc.provider_currency,
                exchange_rate_vnd_per_unit: alloc.exchange_rate_vnd_per_unit,
                status: alloc.status,
                created_at: new Date(),
              });
            }
          } else {
            booking.payment_transactions.push({
              transaction_type: 'REFUND',
              payment_reference: this.bridge.generateCode('REF'),
              ...(refundPaymentMethod ? { payment_method: refundPaymentMethod } : {}),
              payment_provider: refundPaymentMethod === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
              amount: refundAmount,
              card_masked: refundCardMasked!,
              currency: 'VND',
              status: 'SUCCESS',
              created_at: new Date(),
            });
          }
        }

        if (booking.total_miles_accrued > 0) {
          await this.usersService.deductSkyMiles(booking.user_id.toString(), booking.total_miles_accrued);
          skyMilesAdjusted = true;
          booking.total_miles_accrued = 0;
        }
      }

      if (booking.status === BookingStatus.CONFIRMED && refundAmount > 0) {
        if (refundAllocations.length > 0) {
          const totalAllocated = refundAllocations.reduce((sum, a) => sum + a.amount, 0);
          if (totalAllocated !== refundAmount) {
            throw new BadRequestException(
              `Refund allocation sum mismatch: required ${refundAmount} VND, allocated ${totalAllocated} VND`,
            );
          }
        }
      }

      booking.ticket_coupons.forEach((coupon: any) => {
        coupon.coupon_status = 'CANCELLED';
      });

      booking.status = BookingStatus.CANCELLED;
      booking.cancellation_number = cancellationNumber;
      await booking.save();
      if (this.seatAllocationService) {
        await this.seatAllocationService.releaseAllocations(booking._id).catch(() => {});
      }

      if (this.paypalService && refundAllocations.length > 0) {
        await this.bridge.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
      }

      if (this.mailService) {
        try {
          const user = await this.usersService.findById(booking.user_id.toString());
          if (user?.email) {
            const passengerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Customer';
            const itinerary = await this.buildItineraryLegs(booking.ticket_coupons);
            const firstLeg = itinerary[0];

            const sent = await this.mailService.sendCancellationEmail({
              toEmail: user.email,
              passengerName,
              bookingReference: booking.pnr_code,
              blockingNumber: booking.blocking_number,
              confirmationNumber: booking.confirmation_number,
              cancellationNumber,
              cancellationType: wasConfirmed ? 'MANUAL_CONFIRMED' : 'MANUAL_BLOCKED',
              originalBookingStatus: wasConfirmed ? 'CONFIRMED' : 'BLOCKED',
              flightNumber: firstLeg?.flightNumber,
              origin: firstLeg?.origin,
              destination: firstLeg?.destination,
              departureTimeFormatted: firstLeg?.departureTimeFormatted,
              itinerary,
              refundAmount: wasConfirmed ? refundAmount : 0,
              refundPercentage: wasConfirmed ? refundPercentage : 0,
              currency: 'VND',
              maskedCard: wasConfirmed && isValidMaskedCard(refundCardMasked) ? refundCardMasked : undefined,
              policyDeduction: wasConfirmed ? (100 - refundPercentage) : undefined,
              refundDetails: refundAllocations.length > 0 ? refundAllocations.map((a) => ({
                paymentMethod: a.payment_method,
                payment_method: a.payment_method,
                amountVnd: a.amount,
                amount: a.amount,
                cardMasked: a.card_masked,
                card_masked: a.card_masked,
                providerAmount: a.provider_amount,
                provider_amount: a.provider_amount,
                providerCurrency: a.provider_currency,
                provider_currency: a.provider_currency,
                status: a.status,
              })) : undefined,
            });
            if (!sent) {
              this.logger.warn(
                `Cancellation email delivery returned false for booking ${booking.pnr_code} (${user.email}); transaction remains successfully cancelled.`,
              );
            }
          }
        } catch (mailErr: any) {
          this.logger.error(
            `Failed to send cancellation email for booking ${booking.pnr_code}: ${mailErr?.message || mailErr}`,
          );
        }
      }

      const message = `Ticket successfully cancelled. Cancellation number: ${cancellationNumber}. Refund: ${refundAmount.toLocaleString('vi-VN')} VND (${refundPercentage}%).`;

      return {
        booking,
        refund_amount: refundAmount,
        refund_percentage: refundPercentage,
        cancellation_number: cancellationNumber,
        currency: 'VND',
        ...(refundCardMasked ? { refund_card_masked: refundCardMasked } : {}),
        refund_details: refundAllocations.length > 0 ? refundAllocations.map((a) => ({
          payment_reference: a.payment_reference,
          payment_method: a.payment_method,
          amount: a.amount,
          card_masked: a.card_masked,
          provider_amount: a.provider_amount,
          provider_currency: a.provider_currency,
          provider_refund_id: (a as any).provider_refund_id,
          provider_status: (a as any).provider_status,
          status: a.status,
        })) : undefined,
        message,
      };
    } catch (error: any) {
      const rollbackErrors: string[] = [];
      if (skyMilesAdjusted) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
        } catch (err: any) {
          rollbackErrors.push(`Failed to restore SkyMiles: ${err?.message || err}`);
        }
      }
      if (seatsReleased) {
        try {
          await this.restoreSeatsForCouponsStrict(passengerCount, originalCoupons);
        } catch (err: any) {
          rollbackErrors.push(`Failed to restore released seats: ${err?.message || err}`);
        }
      }

      booking.status = snapshot.status;
      booking.cancellation_number = snapshot.cancellation_number;
      booking.total_miles_accrued = snapshot.total_miles_accrued;
      booking.payment_transactions = snapshot.payment_transactions as any;
      booking.ticket_coupons = snapshot.ticket_coupons as any;
      booking.ticket_coupons.forEach((coupon: any, idx: number) => {
        if (snapshot.ticket_coupons[idx]) {
          coupon.coupon_status = snapshot.ticket_coupons[idx].coupon_status;
        }
      });

      if (rollbackErrors.length > 0) {
        throw new InternalServerErrorException(
          'Cancellation failed and compensating rollback was incomplete: ' +
            rollbackErrors.join('; ') +
            '. Original error: ' +
            (error?.message || error),
        );
      }
      throw error;
    }
  }

  /**
   * Requirement 3.9: View Ticket Status (Highlight emergency changes/delays)
   */

}
