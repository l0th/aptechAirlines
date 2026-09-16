import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  BookingType,
  PassengerType,
} from './bookings.schema';
import { FlightDocument } from '../flights/flights.schema';
import {
  CancelTicketDto,
  ConfirmTicketDto,
  CreateBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/users.schema';
import { PoliciesService } from '../policies/policies.service';
import { applyPricing, maxAdvanceBookingDays } from '../common/pricing.util';

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly flightsService: FlightsService,
    private readonly usersService: UsersService,
    private readonly policiesService: PoliciesService,
  ) {}

  private generateCode(prefix: string): string {
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomChars}`;
  }

  async findAll(status?: BookingStatus, userId?: string): Promise<Booking[]> {
    const filter: any = {};
    if (status) filter.status = status;
    if (userId) filter.user_id = new Types.ObjectId(userId);
    return this.bookingModel.find(filter).sort({ createdAt: -1 }).populate('user_id', '-password_hash').exec();
  }

  async findById(id: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }
    const booking = await this.bookingModel.findById(id).populate('user_id', '-password_hash').exec();
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
    return booking;
  }

  /**
   * Requirement 3.4: Make Reservations / Blocking / Direct Buying
   */
  async createBooking(dto: CreateBookingDto): Promise<BookingDocument> {
    const user = await this.usersService.findById(dto.user_id);
    const passengerCount = dto.passengers.length;

    if (passengerCount === 0) {
      throw new BadRequestException('Booking must have at least one passenger');
    }
    if (dto.legs.length === 0) {
      throw new BadRequestException('Booking must have at least one flight leg');
    }

    // 1. Verify all selected flights, calculate total price and distance
    let earliestDeparture: Date | null = null;
    let totalMiles = 0;

    for (const leg of dto.legs) {
      const flight = await this.flightsService.findById(leg.flight_id);
      const inventory = flight.inventories.find(
        (i: any) => i._id.toString() === leg.inventory_id || i.id === leg.inventory_id,
      );
      if (!inventory) {
        throw new NotFoundException(`Inventory ${leg.inventory_id} not found on flight ${flight.flight_number}`);
      }

      if (inventory.available_seats < passengerCount) {
        throw new BadRequestException(
          `Not enough available seats on flight ${flight.flight_number}. Required ${passengerCount}, available ${inventory.available_seats}`,
        );
      }

      const flightDepTime = new Date(flight.scheduled_departure);
      if (!earliestDeparture || flightDepTime < earliestDeparture) {
        earliestDeparture = flightDepTime;
      }
      totalMiles += flight.distance_miles * passengerCount;
    }

    const now = new Date();
    const daysUntilDeparture = (earliestDeparture!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilDeparture > maxAdvanceBookingDays()) {
      throw new BadRequestException(`Ngày bay vượt quá giới hạn đặt vé trước ${maxAdvanceBookingDays()} ngày.`);
    }

    let totalFare = 0;
    const ticketCoupons: any[] = [];
    let earlyBirdPercent = 0;
    let earlyBirdLabel = '';
    let earlyBirdLabelEn = '';
    let ffTier = '';
    let ffDiscountPercent = 0;

    for (const leg of dto.legs) {
      const flight = await this.flightsService.findById(leg.flight_id);
      const inventory = flight.inventories.find(
        (i: any) => i._id.toString() === leg.inventory_id || i.id === leg.inventory_id,
      );

      for (const p of dto.passengers) {
        const pricing = applyPricing(inventory.base_price, daysUntilDeparture, user.sky_miles || 0);
        earlyBirdPercent = pricing.early_bird_percent;
        earlyBirdLabel = pricing.early_bird_label;
        earlyBirdLabelEn = pricing.early_bird_label_en;
        ffTier = pricing.ff_tier;
        ffDiscountPercent = pricing.ff_percent;

        let fare = pricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);

        totalFare += fare;

        ticketCoupons.push({
          coupon_number: this.generateCode('CPN'),
          passenger_name: `${p.first_name} ${p.last_name}`,
          flight_id: flight._id,
          flight_number: flight.flight_number,
          inventory_id: (inventory as any)._id,
          cabin_class: inventory.cabin_class,
          is_smoking: inventory.is_smoking,
          fare_paid: fare,
          seat_code: (p as any).seat_codes?.[leg.leg_type || 'OUTBOUND'] || ((leg.leg_type || 'OUTBOUND') === 'OUTBOUND' ? p.seat_code || '' : ''),
          leg_type: leg.leg_type || 'OUTBOUND',
          coupon_status: 'ACTIVE',
        });
      }
    }

    // Requirement 3.4.2: If <= 2 weeks, CANNOT block, MUST buy!
    if (dto.is_block) {
      if (daysUntilDeparture <= 14) {
        throw new BadRequestException(
          'Departure is within 2 weeks (14 days). Ticket blocking is not permitted. You must buy the ticket directly.',
        );
      }
    }

    // Decrement seats on all flight inventories (atomic)
    const reservedLegs: typeof dto.legs = [];
    for (const leg of dto.legs) {
      const reserved = await this.flightsService.reserveSeats(
        leg.flight_id,
        leg.inventory_id,
        passengerCount,
      );
      if (!reserved) {
        // Rollback already reserved legs
        for (const rLeg of reservedLegs) {
          await this.flightsService.updateAvailableSeats(
            rLeg.flight_id,
            rLeg.inventory_id,
            passengerCount,
          );
        }
        const flight = await this.flightsService.findById(leg.flight_id);
        throw new BadRequestException(`Not enough available seats on flight ${flight.flight_number}`);
      }
      reservedLegs.push(leg);
    }

    const pnrCode = this.generateCode('PNR');
    let status = BookingStatus.CONFIRMED;
    let blockingNumber: string | undefined = undefined;
    let confirmationNumber: string | undefined = undefined;
    let deadline: Date | undefined = undefined;
    const paymentTransactions: any[] = [];

    if (dto.is_block) {
      // Blocking flow: Free of charge now, deadline is 2 weeks before earliest departure
      status = BookingStatus.BLOCKED;
      blockingNumber = this.generateCode('BLK');
      deadline = new Date(earliestDeparture!.getTime() - 14 * 24 * 60 * 60 * 1000);
    } else {
      // Buying flow: Charge card, issue confirmation number, credit Sky Miles!
      status = BookingStatus.CONFIRMED;
      confirmationNumber = this.generateCode('CNF');

      const card = dto.credit_card_number || user.preferred_credit_card || 'CARD-DEFAULT';
      const maskedCard = card.length >= 4 ? `**** **** **** ${card.slice(-4)}` : card;

      paymentTransactions.push({
        transaction_type: 'PAYMENT',
        amount: totalFare,
        card_masked: maskedCard,
        status: 'SUCCESS',
        created_at: new Date(),
      });

      // Requirement 3.4.4: Add mileage of the trip to sky miles in profile
      await this.usersService.addSkyMiles(user._id.toString(), totalMiles);
    }

    const booking = new this.bookingModel({
      pnr_code: pnrCode,
      user_id: user._id,
      booking_type: dto.booking_type,
      status,
      blocking_number: blockingNumber,
      confirmation_number: confirmationNumber,
      time_limit_deadline: deadline,
      total_amount: totalFare,
      total_miles_accrued: dto.is_block ? 0 : totalMiles,
      passengers: dto.passengers,
      ticket_coupons: ticketCoupons,
      payment_transactions: paymentTransactions,
      early_bird_percent: earlyBirdPercent,
      early_bird_label: earlyBirdLabel,
      early_bird_label_en: earlyBirdLabelEn,
      ff_tier: ffTier,
      ff_discount_percent: ffDiscountPercent,
      pricing_note: dto.legs.length > 1 ? 'Applied pricing based on earliest departure leg' : '',
    });

    return booking.save();
  }

  /**
   * Requirement 3.5: Confirm Blocked Ticket (before 2-week cutoff)
   */
  async confirmTicket(dto: ConfirmTicketDto): Promise<BookingDocument> {
    const booking = await this.bookingModel.findOne({ blocking_number: dto.blocking_number }).exec();
    if (!booking) {
      throw new NotFoundException(`No booking found with blocking number ${dto.blocking_number}`);
    }

    if (booking.status !== BookingStatus.BLOCKED) {
      throw new BadRequestException(`This booking is currently ${booking.status}, cannot confirm.`);
    }

    // Check if past deadline
    if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
      // Auto cancel
      booking.status = BookingStatus.CANCELLED;
      await booking.save();
      // Release seats
      await this.releaseSeatsForBooking(booking);
      throw new BadRequestException(
        'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
      );
    }

    const confirmationNumber = this.generateCode('CNF');
    const maskedCard =
      dto.credit_card_number.length >= 4
        ? `**** **** **** ${dto.credit_card_number.slice(-4)}`
        : dto.credit_card_number;

    booking.payment_transactions.push({
      transaction_type: 'PAYMENT',
      amount: booking.total_amount,
      card_masked: maskedCard,
      status: 'SUCCESS',
      created_at: new Date(),
    });

    // Calculate miles
    let totalMiles = 0;
    for (const coupon of booking.ticket_coupons) {
      const flight = await this.flightsService.findById(coupon.flight_id.toString());
      totalMiles += flight.distance_miles;
    }

    booking.status = BookingStatus.CONFIRMED;
    booking.confirmation_number = confirmationNumber;
    booking.total_miles_accrued = totalMiles;
    await booking.save();

    // Requirement 3.5.1: Add mileage to user profile
    await this.usersService.addSkyMiles(booking.user_id.toString(), totalMiles);

    return booking;
  }

  /**
   * Requirement 3.6: Reschedule Confirmed Ticket
   * Requirement 3.6.2.2: For ROUND_TRIP bookings, the optional
   * new_return_flight_id / new_return_inventory_id reschedule the INBOUND
   * leg as well. The price difference covers BOTH rescheduled legs.
   */
  async rescheduleTicket(dto: RescheduleTicketDto): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const booking = await this.bookingModel.findOne({ confirmation_number: dto.confirmation_number }).exec();
    if (!booking) {
      throw new NotFoundException(`Booking with confirmation number ${dto.confirmation_number} not found`);
    }

    // Requirement 3.6.1: ONLY allow confirmed ticket to be rescheduled, NEVER blocked ticket
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed tickets can be rescheduled.');
    }

    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;

    // Split coupons into outbound-side and inbound-side legs
    let outboundCoupons = booking.ticket_coupons.filter((c) => c.leg_type === 'OUTBOUND');
    let inboundCoupons = booking.ticket_coupons.filter((c) => c.leg_type !== 'OUTBOUND');
    if (outboundCoupons.length === 0 && booking.ticket_coupons.length > 0) {
      // Legacy fallback: treat the first coupon as the outbound leg
      outboundCoupons = [booking.ticket_coupons[0]];
      inboundCoupons = booking.ticket_coupons.slice(1);
    }
    if (outboundCoupons.length === 0) {
      throw new BadRequestException('Booking has no ticket coupons to reschedule');
    }

    // ---------- Outbound leg ----------
    const newFlight = await this.flightsService.findById(dto.new_flight_id);
    const newInventory = newFlight.inventories.find(
      (i: any) => i._id.toString() === dto.new_inventory_id || i.id === dto.new_inventory_id,
    );
    if (!newInventory) {
      throw new NotFoundException('Selected new inventory not found on target flight');
    }
    if (newInventory.available_seats < passengerCount) {
      throw new BadRequestException(
        `Not enough seats on new flight ${newFlight.flight_number}. Available: ${newInventory.available_seats}`,
      );
    }

    // Adjust seat inventory: release the old outbound seats, take the new ones
    await this.releaseSeatsForCoupons(passengerCount, outboundCoupons);
    await this.flightsService.updateAvailableSeats(dto.new_flight_id, dto.new_inventory_id, -passengerCount);

    // ---------- Inbound leg (round-trip only, optional) ----------
    const shouldRescheduleReturn =
      booking.booking_type === BookingType.ROUND_TRIP &&
      !!dto.new_return_flight_id &&
      !!dto.new_return_inventory_id;

    let newReturnFlight: FlightDocument | null = null;
    let newReturnInventory: any = null;

    if (shouldRescheduleReturn) {
      newReturnFlight = await this.flightsService.findById(dto.new_return_flight_id!);
      newReturnInventory = newReturnFlight.inventories.find(
        (i: any) =>
          i._id.toString() === dto.new_return_inventory_id || i.id === dto.new_return_inventory_id,
      );
      if (!newReturnInventory) {
        throw new NotFoundException('Selected new return inventory not found on target flight');
      }
      if (newReturnInventory.available_seats < passengerCount) {
        throw new BadRequestException(
          `Not enough seats on new return flight ${newReturnFlight.flight_number}. Available: ${newReturnInventory.available_seats}`,
        );
      }

      // Release the old inbound seats, take the new ones
      await this.releaseSeatsForCoupons(passengerCount, inboundCoupons);
      await this.flightsService.updateAvailableSeats(
        dto.new_return_flight_id!,
        dto.new_return_inventory_id!,
        -passengerCount,
      );
    }

    // ---------- Fare calculation (outbound + inbound) ----------
    let newTotalFare = this.computeLegFare(newInventory.base_price, booking.passengers);
    if (shouldRescheduleReturn) {
      newTotalFare += this.computeLegFare(newReturnInventory.base_price, booking.passengers);
    } else {
      // Keep the existing inbound fares untouched
      newTotalFare += inboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
    }

    const priceDiff = newTotalFare - oldTotalFare;

    // Handle financial adjustment
    const card = dto.credit_card_number || 'SAVED-CARD';
    const maskedCard = card.length >= 4 ? `**** **** **** ${card.slice(-4)}` : card;

    if (priceDiff > 0) {
      booking.payment_transactions.push({
        transaction_type: 'RESCHEDULE_CHARGE',
        amount: priceDiff,
        card_masked: maskedCard,
        status: 'SUCCESS',
        created_at: new Date(),
      });
    } else if (priceDiff < 0) {
      booking.payment_transactions.push({
        transaction_type: 'RESCHEDULE_REFUND',
        amount: Math.abs(priceDiff),
        card_masked: maskedCard,
        status: 'SUCCESS',
        created_at: new Date(),
      });
    }

    // Generate new confirmation number
    const newConfirmationNumber = this.generateCode('CNF');
    booking.confirmation_number = newConfirmationNumber;
    booking.status = BookingStatus.CONFIRMED;
    booking.total_amount = newTotalFare;

    // Update coupons: new outbound coupons, plus either new inbound coupons
    // (round-trip with return rescheduled) or the untouched inbound coupons
    const newOutboundCoupons = booking.passengers.map((p) =>
      this.buildCoupon(p, newFlight, newInventory, 'OUTBOUND'),
    );
    const newInboundCoupons = shouldRescheduleReturn
      ? booking.passengers.map((p) =>
          this.buildCoupon(p, newReturnFlight!, newReturnInventory, 'INBOUND'),
        )
      : inboundCoupons;

    booking.ticket_coupons = [...newOutboundCoupons, ...newInboundCoupons] as any;

    await booking.save();

    const legsMessage = shouldRescheduleReturn ? 'Outbound and return legs' : 'Outbound leg';
    return {
      booking,
      price_difference: priceDiff,
      message: `${legsMessage} rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} USD.`,
    };
  }

  /** Fare for all passengers on one leg (child/senior multipliers applied). */
  private computeLegFare(basePrice: number, passengers: any[]): number {
    let total = 0;
    for (const p of passengers) {
      total += this.computeFareForPassenger(basePrice, p.passenger_type);
    }
    return total;
  }

  private computeFareForPassenger(basePrice: number, passengerType: PassengerType): number {
    if (passengerType === PassengerType.CHILD) return Math.round(basePrice * 0.75);
    if (passengerType === PassengerType.SENIOR) return Math.round(basePrice * 0.85);
    return basePrice;
  }

  private buildCoupon(
    passenger: any,
    flight: FlightDocument,
    inventory: any,
    legType: string,
  ) {
    return {
      coupon_number: this.generateCode('CPN'),
      passenger_name: `${passenger.first_name} ${passenger.last_name}`,
      flight_id: flight._id,
      flight_number: flight.flight_number,
      inventory_id: (inventory as any)._id,
      cabin_class: inventory.cabin_class,
      is_smoking: inventory.is_smoking,
      fare_paid: this.computeFareForPassenger(inventory.base_price, passenger.passenger_type),
      seat_code: (passenger as any).seat_code || '',
      leg_type: legType,
      coupon_status: 'ACTIVE',
    };
  }

  /**
   * Requirement 3.7: Cancel Ticket (Blocked or Confirmed)
   */
  async cancelTicket(dto: CancelTicketDto): Promise<{
    booking: BookingDocument;
    refund_amount: number;
    refund_percentage: number;
    cancellation_number: string;
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

    const cancellationNumber = this.generateCode('CAN');
    let refundAmount = 0;
    let refundPercentage = 0;

    // Release seats for all coupons
    await this.releaseSeatsForBooking(booking);

    if (booking.status === BookingStatus.CONFIRMED) {
      // Requirement 3.7: Calculate refund % based on system date and departure date
      const earliestDeparture = await this.getEarliestDeparture(booking);
      const now = new Date();
      const daysBefore = Math.max(0, (earliestDeparture.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      refundPercentage = await this.policiesService.calculateRefundPercentage(daysBefore);
      refundAmount = Math.round((booking.total_amount * refundPercentage) / 100);

      // Record refund transaction
      booking.payment_transactions.push({
        transaction_type: 'REFUND',
        amount: refundAmount,
        card_masked: 'ORIGINAL-PAYMENT-CARD',
        status: 'SUCCESS',
        created_at: new Date(),
      });

      // Requirement 3.7.3: Deduct mileage from sky miles in user profile
      if (booking.total_miles_accrued > 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), booking.total_miles_accrued);
        booking.total_miles_accrued = 0;
      }
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancellation_number = cancellationNumber;
    await booking.save();

    return {
      booking,
      refund_amount: refundAmount,
      refund_percentage: refundPercentage,
      cancellation_number: cancellationNumber,
      message: `Ticket successfully cancelled. Cancellation number: ${cancellationNumber}. Refund: ${refundAmount} USD (${refundPercentage}%).`,
    };
  }

  /**
   * Requirement 3.9: View Ticket Status (Highlight emergency changes/delays)
   */
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
      .populate('user_id', '-password_hash')
      .exec();

    if (!booking) {
      throw new NotFoundException(`No booking found with code ${code}`);
    }

    // Enrich with flight real-time status and emergency delay reasons
    const enrichedCoupons: any[] = [];
    let hasEmergencyChanges = false;

    for (const coupon of booking.ticket_coupons) {
      const flight = await this.flightsService.findById(coupon.flight_id.toString());
      const isAltered = flight.status !== 'SCHEDULED' || !!flight.delay_reason;
      if (isAltered) hasEmergencyChanges = true;

      enrichedCoupons.push({
        ...coupon,
        origin_iata: flight.origin_iata,
        dest_iata: flight.dest_iata,
        scheduled_departure: flight.scheduled_departure,
        scheduled_arrival: flight.scheduled_arrival,
        actual_departure: flight.actual_departure,
        actual_arrival: flight.actual_arrival,
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
    await this.releaseSeatsForCoupons(booking.passengers.length, booking.ticket_coupons);
  }

  /**
   * Release seats for an arbitrary list of coupons (deduplicated by
   * flight/inventory pair).
   */
  private async releaseSeatsForCoupons(passengerCount: number, coupons: any[]) {
    // Map of flightId:inventoryId to count
    const legMap = new Map<string, { flightId: string; inventoryId: string }>();
    for (const c of coupons) {
      const key = `${c.flight_id.toString()}_${c.inventory_id}`;
      legMap.set(key, { flightId: c.flight_id.toString(), inventoryId: c.inventory_id });
    }
    for (const item of legMap.values()) {
      try {
        await this.flightsService.updateAvailableSeats(item.flightId, item.inventoryId, +passengerCount);
      } catch (err) {
        // Silently continue if already deleted
      }
    }
  }

  async getEarliestDeparture(booking: BookingDocument): Promise<Date> {
    let earliest = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    for (const c of booking.ticket_coupons) {
      try {
        const flight = await this.flightsService.findById(c.flight_id.toString());
        const dep = new Date(flight.scheduled_departure);
        if (dep < earliest) earliest = dep;
      } catch (e) {}
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
}
