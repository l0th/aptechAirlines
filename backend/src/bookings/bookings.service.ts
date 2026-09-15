import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  PassengerType,
} from './bookings.schema';
import {
  CancelTicketDto,
  ConfirmTicketDto,
  CreateBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';

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
    let totalFare = 0;
    let totalMiles = 0;
    const ticketCoupons: any[] = [];

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

      // Calculate fare per passenger type
      for (const p of dto.passengers) {
        let fare = inventory.base_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(inventory.base_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(inventory.base_price * 0.85);

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
          seat_code: p.seat_code || '',
          leg_type: leg.leg_type || 'OUTBOUND',
          coupon_status: 'ACTIVE',
        });
      }
    }

    const now = new Date();
    const daysUntilDeparture =
      (earliestDeparture!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    // Requirement 3.4.2: If <= 2 weeks, CANNOT block, MUST buy!
    if (dto.is_block) {
      if (daysUntilDeparture <= 14) {
        throw new BadRequestException(
          'Departure is within 2 weeks (14 days). Ticket blocking is not permitted. You must buy the ticket directly.',
        );
      }
    }

    // Decrement seats on all flight inventories
    for (const leg of dto.legs) {
      await this.flightsService.updateAvailableSeats(
        leg.flight_id,
        leg.inventory_id,
        -passengerCount,
      );
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

    // For simplicity and clarity: Reschedule the primary outbound leg
    const oldCoupon = booking.ticket_coupons[0];
    const oldFlightId = oldCoupon.flight_id.toString();
    const oldInventoryId = oldCoupon.inventory_id;
    const oldTotalFare = booking.total_amount;

    // Calculate new total fare
    let newTotalFare = 0;
    for (const p of booking.passengers) {
      let fare = newInventory.base_price;
      if (p.passenger_type === PassengerType.CHILD) fare = Math.round(newInventory.base_price * 0.75);
      if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(newInventory.base_price * 0.85);
      newTotalFare += fare;
    }

    const priceDiff = newTotalFare - oldTotalFare;

    // Adjust seat inventory: Increment previous flight, decrement new flight
    await this.flightsService.updateAvailableSeats(oldFlightId, oldInventoryId, +passengerCount);
    await this.flightsService.updateAvailableSeats(dto.new_flight_id, dto.new_inventory_id, -passengerCount);

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

    // Update coupons
    booking.ticket_coupons = booking.passengers.map((p) => {
      let fare = newInventory.base_price;
      if (p.passenger_type === PassengerType.CHILD) fare = Math.round(newInventory.base_price * 0.75);
      if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(newInventory.base_price * 0.85);
      return {
        coupon_number: this.generateCode('CPN'),
        passenger_name: `${p.first_name} ${p.last_name}`,
        flight_id: newFlight._id,
        flight_number: newFlight.flight_number,
        inventory_id: (newInventory as any)._id,
        cabin_class: newInventory.cabin_class,
        is_smoking: newInventory.is_smoking,
        fare_paid: fare,
        seat_code: (p as any).seat_code || '',
        leg_type: 'OUTBOUND',
        coupon_status: 'ACTIVE',
      };
    });

    await booking.save();

    return {
      booking,
      price_difference: priceDiff,
      message: `Rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} USD.`,
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

  private async releaseSeatsForBooking(booking: BookingDocument) {
    const passengerCount = booking.passengers.length;
    // Map of flightId:inventoryId to count
    const legMap = new Map<string, { flightId: string; inventoryId: string }>();
    for (const c of booking.ticket_coupons) {
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

  private async getEarliestDeparture(booking: BookingDocument): Promise<Date> {
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
}
