import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  BookingDocument,
  BookingStatus,
  ExternalPaymentProof,
  PaymentMethod,
} from './bookings.schema';
import { ConfirmTicketDto } from './bookings.dto';
import { BookingsCoreBridge, BookingsCoreDependencies, BookingsCorePart } from './bookings-core.part';

export class BookingsConfirmService extends BookingsCorePart {
  private readonly logger = new Logger(BookingsConfirmService.name);

  constructor(deps: BookingsCoreDependencies, bridge: BookingsCoreBridge) {
    super(deps, bridge);
  }
  async confirmTicket(dto: ConfirmTicketDto, externalPaymentProof?: ExternalPaymentProof): Promise<BookingDocument> {
    const booking = await this.bookingModel.findOne({ blocking_number: dto.blocking_number }).exec();
    if (!booking) {
      throw new NotFoundException(`No booking found with blocking number ${dto.blocking_number}`);
    }

    if (booking.status !== BookingStatus.BLOCKED) {
      throw new BadRequestException(`This booking is currently ${booking.status}, cannot confirm.`);
    }

    // Check if past deadline
    if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
      await this.bridge.cancelExpiredBlockStrict(booking);
      throw new BadRequestException(
        'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
      );
    }

    const confirmationNumber = this.bridge.generateCode('CNF');
    const snapshot = {
      status: booking.status,
      confirmation_number: booking.confirmation_number,
      total_miles_accrued: booking.total_miles_accrued,
      payment_transactions: booking.payment_transactions.map((transaction: any) => ({ ...transaction })),
    };

    if (!dto.payment_method) {
      throw new BadRequestException('Payment method is required to confirm reservation.');
    }
    if (dto.payment_method === PaymentMethod.PAYPAL) {
      if (booking.total_amount === 0) {
        booking.payment_transactions.push({
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_provider: 'PAYPAL',
          payment_reference: this.bridge.generateCode('PAY'),
          amount: 0,
          currency: 'VND',
          status: 'SUCCESS',
          created_at: new Date(),
        });
      } else {
        this.bridge.assertPayPalPaymentProof(externalPaymentProof, booking.total_amount, 'confirmTicket');
        booking.payment_transactions.push({
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_provider: 'PAYPAL',
          payment_reference: externalPaymentProof!.payment_reference || this.bridge.generateCode('PAY'),
          amount: booking.total_amount,
          currency: 'VND',
          provider_order_id: externalPaymentProof!.provider_order_id,
          provider_capture_id: externalPaymentProof!.provider_capture_id,
          provider_amount: externalPaymentProof!.provider_amount,
          provider_currency: externalPaymentProof!.provider_currency,
          exchange_rate_vnd_per_unit: externalPaymentProof!.exchange_rate_vnd_per_unit,
          status: 'SUCCESS',
          created_at: new Date(),
        });
      }
    } else if (dto.payment_method === PaymentMethod.PROFILE_CARD) {
      throw new BadRequestException('Saved card payments are no longer supported. Complete PayPal checkout.');
    } else {
      throw new BadRequestException('Unsupported payment method.');
    }

    // Calculate miles
    let totalMiles = 0;
    for (const coupon of booking.ticket_coupons) {
      const flight = await this.flightsService.findById(coupon.flight_id.toString());
      totalMiles += flight.distance_miles;
    }

    const user = await this.usersService.findById(booking.user_id.toString());
    const originalSkyMiles = user?.sky_miles || 0;
    let skyMilesCredited = false;
    let businessCommitted = false;
    try {
      await this.usersService.addSkyMiles(booking.user_id.toString(), totalMiles);
      skyMilesCredited = true;
      booking.status = BookingStatus.CONFIRMED;
      booking.confirmation_number = confirmationNumber;
      booking.total_miles_accrued = totalMiles;
      await booking.save();
      businessCommitted = true;

      if (this.seatAllocationService) {
        await this.seatAllocationService.confirmAllocations(booking._id);
      }
      return booking;
    } catch (error) {
      if (businessCommitted) {
        this.logger.error(
          `Post-commit seat confirmation failure in confirmTicket for booking ${booking._id}; scheduler will recover: ${error?.message || error}`,
        );
        return booking;
      }

      if (skyMilesCredited) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalSkyMiles);
        } catch (_) {}
      }
      booking.status = snapshot.status;
      booking.confirmation_number = snapshot.confirmation_number;
      booking.total_miles_accrued = snapshot.total_miles_accrued;
      booking.payment_transactions = snapshot.payment_transactions as any;
      throw error;
    }
  }

  /**
   * Requirement 3.6: Reschedule Confirmed Ticket
   *
   * Fixes applied:
   * 1. SkyMiles delta computed ONLY on changed legs.
   * 2. Full compensating rollback (try/catch around mutating phase).
   * 3. Itinerary validation: past dates, route match, return>outbound, partial payload.
   * 4. applyPricing() for dynamic pricing.
   * 5. Currency VND in response message.
   */

}
