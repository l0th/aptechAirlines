import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
import { FlightDocument, FlightStatus } from '../flights/flights.schema';
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
import { applyPricing, getBookingWindowLimits, maxAdvanceBookingDays } from '../common/pricing.util';

export function normalizeLegType(legType?: string): string {
  if (!legType) return 'OUTBOUND';
  const upper = legType.trim().toUpperCase();
  const connectingMatch = upper.match(/^CONNECTING[_\s]*(?:LEG[_\s]*)?(\d+)$/);
  if (connectingMatch) {
    return `CONNECTING_${connectingMatch[1]}`;
  }
  const inboundMatch = upper.match(/^INBOUND[_\s]*(?:LEG[_\s]*)?(\d+)$/);
  if (inboundMatch) {
    return `INBOUND_${inboundMatch[1]}`;
  }
  return upper;
}

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
    const selectedLegs: Array<{ definition: CreateBookingDto['legs'][number]; flight: FlightDocument; inventory: any }> = [];

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

      if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
        throw new BadRequestException(`Cannot book flight ${flight.flight_number}: flight is ${flight.status}.`);
      }

      const flightDepTime = new Date(flight.scheduled_departure);
      if (isNaN(flightDepTime.getTime()) || flightDepTime <= new Date()) {
        throw new BadRequestException(`Flight ${flight.flight_number} departure is invalid or in the past.`);
      }
      if (!earliestDeparture || flightDepTime < earliestDeparture) {
        earliestDeparture = flightDepTime;
      }
      totalMiles += flight.distance_miles * passengerCount;
      selectedLegs.push({ definition: leg, flight, inventory });
    }

    // §3.6.2 & §3.3.4.2 Booking window validation using authoritative calendar-date policy
    if (dto.booking_type === BookingType.CONNECTING) {
      this.validateConnectingFlights(selectedLegs.map((leg) => leg.flight));
      this.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Connecting itinerary');
    } else if (dto.booking_type === BookingType.ROUND_TRIP) {
      const { outboundLegs, inboundLegs } = this.validateRoundTripLegs(selectedLegs);
      this.validateBookingWindow(outboundLegs.map((leg) => leg.flight), 'Outbound itinerary');
      this.validateBookingWindow(inboundLegs.map((leg) => leg.flight), 'Return itinerary');
    } else {
      this.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Flight');
    }

    const now = new Date();
    const daysUntilDeparture = (earliestDeparture!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    let totalFare = 0;
    const ticketCoupons: any[] = [];
    let earlyBirdPercent = 0;
    let earlyBirdLabel = '';
    let earlyBirdLabelEn = '';
    let ffTier = '';
    let ffDiscountPercent = 0;

    for (const { definition: leg, flight, inventory } of selectedLegs) {

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

        const normalizedLeg = normalizeLegType(leg.leg_type);
        ticketCoupons.push({
          coupon_number: this.generateCode('CPN'),
          passenger_name: `${p.first_name} ${p.last_name}`,
          flight_id: flight._id,
          flight_number: flight.flight_number,
          inventory_id: (inventory as any)._id,
          cabin_class: inventory.cabin_class,
          is_smoking: inventory.is_smoking,
          fare_paid: fare,
          seat_code:
            (p as any).seat_codes?.[normalizedLeg] ||
            (p as any).seat_codes?.[leg.leg_type || 'OUTBOUND'] ||
            (normalizedLeg === 'OUTBOUND' ? p.seat_code || '' : ''),
          leg_type: normalizedLeg,
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
      let reserved = false;
      try {
        reserved = await this.flightsService.reserveSeats(
          leg.flight_id,
          leg.inventory_id,
          passengerCount,
        );
      } catch (error) {
        for (const reservedLeg of reservedLegs) {
          try {
            await this.flightsService.updateAvailableSeats(
              reservedLeg.flight_id,
              reservedLeg.inventory_id,
              passengerCount,
            );
          } catch (_) {}
        }
        throw error;
      }
      if (!reserved) {
        // Rollback already reserved legs
        for (const rLeg of reservedLegs) {
          try {
            await this.flightsService.updateAvailableSeats(
              rLeg.flight_id,
              rLeg.inventory_id,
              passengerCount,
            );
          } catch (_) {}
        }
        const flight = await this.flightsService.findById(leg.flight_id);
        throw new BadRequestException(`Not enough available seats on flight ${flight.flight_number}`);
      }
      reservedLegs.push(leg);
    }

    const originalSkyMiles = user.sky_miles || 0;
    let skyMilesCredited = false;

    try {
      const pnrCode = this.generateCode('PNR');
      let status = BookingStatus.CONFIRMED;
      let blockingNumber: string | undefined = undefined;
      let confirmationNumber: string | undefined = undefined;
      let deadline: Date | undefined = undefined;
      const paymentTransactions: any[] = [];

      if (dto.is_block) {
        status = BookingStatus.BLOCKED;
        blockingNumber = this.generateCode('BLK');
        deadline = new Date(earliestDeparture!.getTime() - 14 * 24 * 60 * 60 * 1000);
      } else {
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
        await this.usersService.addSkyMiles(user._id.toString(), totalMiles);
        skyMilesCredited = true;
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

      return await booking.save();
    } catch (error) {
      for (const leg of reservedLegs) {
        try {
          await this.flightsService.updateAvailableSeats(leg.flight_id, leg.inventory_id, passengerCount);
        } catch (_) {}
      }
      if (skyMilesCredited) {
        try {
          await this.usersService.setSkyMiles(user._id.toString(), originalSkyMiles);
        } catch (_) {}
      }
      throw error;
    }
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
      await this.cancelExpiredBlockStrict(booking);
      throw new BadRequestException(
        'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
      );
    }

    const confirmationNumber = this.generateCode('CNF');
    const snapshot = {
      status: booking.status,
      confirmation_number: booking.confirmation_number,
      total_miles_accrued: booking.total_miles_accrued,
      payment_transactions: booking.payment_transactions.map((transaction: any) => ({ ...transaction })),
    };
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

    const user = await this.usersService.findById(booking.user_id.toString());
    const originalSkyMiles = user.sky_miles || 0;
    let skyMilesCredited = false;
    try {
      await this.usersService.addSkyMiles(booking.user_id.toString(), totalMiles);
      skyMilesCredited = true;
      booking.status = BookingStatus.CONFIRMED;
      booking.confirmation_number = confirmationNumber;
      booking.total_miles_accrued = totalMiles;
      await booking.save();
      return booking;
    } catch (error) {
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
  async rescheduleTicket(dto: RescheduleTicketDto): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const booking = await this.bookingModel.findOne({ confirmation_number: dto.confirmation_number }).exec();
    if (!booking) {
      throw new NotFoundException(`Booking with confirmation number ${dto.confirmation_number} not found`);
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed tickets can be rescheduled.');
    }

    // CONNECTING reschedule
    if (booking.booking_type === BookingType.CONNECTING) {
      if (!dto.new_legs || dto.new_legs.length < 2) {
        throw new BadRequestException(
          'Connecting itinerary reschedule is not yet supported as a partial leg change because connection validity must be recalculated.',
        );
      }
      return this.rescheduleConnectingTicket(booking, dto);
    }

    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;

    // Direction-aware coupon grouping for mixed ROUND_TRIP bookings
    // Normalize leg types to handle legacy CONNECTING_LEG_X / INBOUND_LEG_X values
    const isOutboundLeg = (lt: string): boolean => {
      const t = normalizeLegType(lt);
      return t === 'OUTBOUND' || /^CONNECTING_\d+$/.test(t);
    };
    const isInboundLeg = (lt: string): boolean => {
      const t = normalizeLegType(lt);
      return t === 'INBOUND' || /^INBOUND_\d+$/.test(t);
    };

    let outboundCoupons: any[];
    let inboundCoupons: any[];

    if (booking.booking_type === BookingType.ROUND_TRIP) {
      outboundCoupons = booking.ticket_coupons.filter((c) => isOutboundLeg(c.leg_type));
      inboundCoupons = booking.ticket_coupons.filter((c) => isInboundLeg(c.leg_type));
    } else {
      outboundCoupons = booking.ticket_coupons.filter((c) => c.leg_type === 'OUTBOUND');
      inboundCoupons = booking.ticket_coupons.filter((c) => c.leg_type !== 'OUTBOUND');
    }
    if (outboundCoupons.length === 0 && booking.ticket_coupons.length > 0) {
      outboundCoupons = [booking.ticket_coupons[0]];
      inboundCoupons = booking.ticket_coupons.slice(1);
    }
    if (outboundCoupons.length === 0) {
      throw new BadRequestException('Booking has no ticket coupons to reschedule');
    }

    // Detect direction types using DISTINCT (flight_id, inventory_id) legs — not raw coupon count
    const distinctLegs = (coupons: any[]): Set<string> => {
      const s = new Set<string>();
      for (const c of coupons) s.add(`${c.flight_id}_${c.inventory_id}`);
      return s;
    };
    const outboundDistinct = distinctLegs(outboundCoupons);
    const returnDistinct = distinctLegs(inboundCoupons);

    const outboundHasConnectingType = outboundCoupons.some((c) => /^CONNECTING_\d+$/.test(normalizeLegType(c.leg_type)));
    const returnHasInboundNType = inboundCoupons.some((c) => /^INBOUND_\d+$/.test(normalizeLegType(c.leg_type)));

    const outboundIsConnecting = outboundDistinct.size > 1 || outboundHasConnectingType;
    const returnIsConnecting = returnDistinct.size > 1 || returnHasInboundNType;

    // ===== §3 PARTIAL RETURN PAYLOAD VALIDATION =====
    const hasReturnFlight = !!dto.new_return_flight_id;
    const hasReturnInventory = !!dto.new_return_inventory_id;
    const hasReturnLegs = !!(dto.new_return_legs && dto.new_return_legs.length >= 2);
    const hasOutboundLegs = !!(dto.new_legs && dto.new_legs.length >= 2);

    if (hasReturnFlight !== hasReturnInventory) {
      throw new BadRequestException(
        'Both new_return_flight_id and new_return_inventory_id must be provided together.',
      );
    }
    // Return fields only valid for ROUND_TRIP
    if ((hasReturnFlight || hasReturnLegs) && booking.booking_type !== BookingType.ROUND_TRIP) {
      throw new BadRequestException(
        'Return leg reschedule is only applicable to ROUND_TRIP bookings.',
      );
    }

    // Mixed ROUND_TRIP: delegate to rescheduleMixedRoundTrip when EITHER direction is connecting
    if (booking.booking_type === BookingType.ROUND_TRIP && (outboundIsConnecting || returnIsConnecting)) {
      return this.rescheduleMixedRoundTrip(
        booking, dto, outboundCoupons, inboundCoupons,
        outboundIsConnecting, returnIsConnecting,
      );
    }

    const shouldRescheduleReturn =
      booking.booking_type === BookingType.ROUND_TRIP && hasReturnFlight;

    if (!dto.new_flight_id || !dto.new_inventory_id) {
      throw new BadRequestException(
        'new_flight_id and new_inventory_id are required for direct and round-trip rescheduling.',
      );
    }

    // ===== §3 LOAD & VALIDATE FLIGHTS =====

    // --- Old outbound flight (for route & miles comparison) ---
    const oldOutboundFlightId = outboundCoupons[0].flight_id.toString();
    const oldOutboundFlight = await this.flightsService.findById(oldOutboundFlightId);

    // --- New outbound flight ---
    const newFlight = await this.flightsService.findById(dto.new_flight_id);
    const newInventory = newFlight.inventories.find(
      (i: any) => i._id.toString() === dto.new_inventory_id || i.id === dto.new_inventory_id,
    );
    if (!newInventory) {
      throw new NotFoundException('Selected new inventory not found on target flight');
    }

    // §3: New outbound must not be in the past
    if (new Date(newFlight.scheduled_departure) <= new Date()) {
      throw new BadRequestException('New outbound flight departure is in the past.');
    }

    // §3.6.2: New outbound must not exceed booking window
    this.validateBookingWindow(newFlight, 'New outbound flight');

    // Reject CANCELLED/COMPLETED target flights
    if (newFlight.status === FlightStatus.CANCELLED || newFlight.status === FlightStatus.COMPLETED) {
      throw new BadRequestException(
        `Cannot reschedule to flight ${newFlight.flight_number}: flight is ${newFlight.status}.`,
      );
    }

    // §3: New outbound must match old outbound route
    if (
      newFlight.origin_iata !== oldOutboundFlight.origin_iata ||
      newFlight.dest_iata !== oldOutboundFlight.dest_iata
    ) {
      throw new BadRequestException(
        `Route mismatch: new outbound ${newFlight.origin_iata}-${newFlight.dest_iata} ` +
        `does not match old outbound ${oldOutboundFlight.origin_iata}-${oldOutboundFlight.dest_iata}.`,
      );
    }

    // --- Return flight validation ---
    let newReturnFlight: FlightDocument | null = null;
    let newReturnInventory: any = null;
    let oldReturnFlight: FlightDocument | null = null;

    if (shouldRescheduleReturn) {
      const oldReturnFlightId = inboundCoupons[0]?.flight_id?.toString();
      if (oldReturnFlightId) {
        oldReturnFlight = await this.flightsService.findById(oldReturnFlightId);
      }

      newReturnFlight = await this.flightsService.findById(dto.new_return_flight_id!);
      newReturnInventory = newReturnFlight.inventories.find(
        (i: any) =>
          i._id.toString() === dto.new_return_inventory_id || i.id === dto.new_return_inventory_id,
      );
      if (!newReturnInventory) {
        throw new NotFoundException('Selected new return inventory not found on target flight');
      }

      // §3: New return must not be in the past
      if (new Date(newReturnFlight.scheduled_departure) <= new Date()) {
        throw new BadRequestException('New return flight departure is in the past.');
      }

      // §3.6.2: New return must not exceed booking window
      this.validateBookingWindow(newReturnFlight, 'New return flight');

      // Reject CANCELLED/COMPLETED target return flights
      if (newReturnFlight.status === FlightStatus.CANCELLED || newReturnFlight.status === FlightStatus.COMPLETED) {
        throw new BadRequestException(
          `Cannot reschedule to return flight ${newReturnFlight.flight_number}: flight is ${newReturnFlight.status}.`,
        );
      }

      // §3: New return must match old return route
      if (
        oldReturnFlight &&
        (newReturnFlight.origin_iata !== oldReturnFlight.origin_iata ||
         newReturnFlight.dest_iata !== oldReturnFlight.dest_iata)
      ) {
        throw new BadRequestException(
          `Route mismatch: new return ${newReturnFlight.origin_iata}-${newReturnFlight.dest_iata} ` +
          `does not match old return ${oldReturnFlight.origin_iata}-${oldReturnFlight.dest_iata}.`,
        );
      }

      // §3: Return must depart AFTER outbound
      // Return must depart after outbound ARRIVAL
      if (!newFlight.scheduled_arrival) {
        throw new BadRequestException(
          'Outbound flight has no scheduled_arrival — cannot validate return chronology.',
        );
      }
      if (new Date(newReturnFlight.scheduled_departure) <= new Date(newFlight.scheduled_arrival)) {
        throw new BadRequestException(
          'Return flight must depart after the outbound flight arrives.',
        );
      }
    } else if (booking.booking_type === BookingType.ROUND_TRIP && !shouldRescheduleReturn) {
      // Validate existing return against new outbound arrival
      const existingReturnFlightId = inboundCoupons[0]?.flight_id?.toString();
      if (existingReturnFlightId) {
        const existingReturnFlight = await this.flightsService.findById(existingReturnFlightId);
        if (!newFlight.scheduled_arrival) {
          throw new BadRequestException(
            'Outbound flight has no scheduled_arrival — cannot validate return chronology.',
          );
        }
        if (new Date(existingReturnFlight.scheduled_departure) <= new Date(newFlight.scheduled_arrival)) {
          throw new BadRequestException(
            'Existing return flight departs before the new outbound arrives. Please also reschedule the return leg.',
          );
        }
      }
    }

    // ===== §1 SKYMILES DELTA: ONLY on changed legs =====
    const oldOutboundMilesPerPax = oldOutboundFlight.distance_miles;
    const newOutboundMilesPerPax = newFlight.distance_miles;
    const outboundDelta = newOutboundMilesPerPax - oldOutboundMilesPerPax;

    let returnDelta = 0;
    if (shouldRescheduleReturn && oldReturnFlight) {
      returnDelta = newReturnFlight!.distance_miles - oldReturnFlight.distance_miles;
    }

    const milesDiff = (outboundDelta + returnDelta) * passengerCount;

    // ===== §2 RESERVE NEW SEATS (atomic, before any release) =====
    const outboundReserved = await this.flightsService.reserveSeats(
      dto.new_flight_id, dto.new_inventory_id, passengerCount,
    );
    if (!outboundReserved) {
      throw new BadRequestException(
        `Not enough seats on new flight ${newFlight.flight_number}.`,
      );
    }

    if (shouldRescheduleReturn) {
      let returnReserved = false;
      try {
        returnReserved = await this.flightsService.reserveSeats(
          dto.new_return_flight_id!, dto.new_return_inventory_id!, passengerCount,
        );
      } catch (err) {
        // Rollback outbound reservation on error
        await this.flightsService.updateAvailableSeats(
          dto.new_flight_id, dto.new_inventory_id, +passengerCount,
        );
        throw err;
      }

      if (!returnReserved) {
        // Rollback outbound reservation
        await this.flightsService.updateAvailableSeats(
          dto.new_flight_id, dto.new_inventory_id, +passengerCount,
        );
        throw new BadRequestException(
          `Not enough seats on new return flight ${newReturnFlight!.flight_number}. Outbound reservation rolled back.`,
        );
      }
    }

    // ===== §2 MUTATING PHASE: try/catch with compensating rollback =====
    // Track state for rollback
    let oldOutboundReleased = false;
    let oldInboundReleased = false;
    let skyMilesAdjusted = false;
    let originalUserSkyMiles = 0;

    // Snapshot booking fields for in-memory rollback
    const bookingSnapshot = {
      confirmation_number: booking.confirmation_number,
      status: booking.status,
      total_amount: booking.total_amount,
      ticket_coupons: booking.ticket_coupons.map((c: any) => ({ ...c })),
      payment_transactions: [...booking.payment_transactions],
      early_bird_percent: booking.early_bird_percent,
      early_bird_label: booking.early_bird_label,
      early_bird_label_en: booking.early_bird_label_en,
      ff_tier: booking.ff_tier,
      ff_discount_percent: booking.ff_discount_percent,
      total_miles_accrued: booking.total_miles_accrued,
    };

    try {
      // Release old seats (strict mode: propagate errors)
      await this.releaseSeatsForCouponsStrict(passengerCount, outboundCoupons);
      oldOutboundReleased = true;

      if (shouldRescheduleReturn) {
        await this.releaseSeatsForCouponsStrict(passengerCount, inboundCoupons);
        oldInboundReleased = true;
      }

      // ===== §4 PRICING using applyPricing() =====
      const user = await this.usersService.findById(booking.user_id.toString());
      originalUserSkyMiles = user.sky_miles || 0;
      const now = new Date();

      const outDaysUntil = Math.max(0,
        (new Date(newFlight.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const outPricing = applyPricing(newInventory.base_price, outDaysUntil, user.sky_miles || 0);

      let newTotalFare = 0;
      const newOutboundCoupons = booking.passengers.map((p) => {
        let fare = outPricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(outPricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(outPricing.final_price * 0.85);
        newTotalFare += fare;
        return this.buildCouponWithFare(p, newFlight, newInventory, 'OUTBOUND', fare);
      });

      let newInboundCouponsResult: any[];
      if (shouldRescheduleReturn) {
        const retDaysUntil = Math.max(0,
          (new Date(newReturnFlight!.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const retPricing = applyPricing(newReturnInventory.base_price, retDaysUntil, user.sky_miles || 0);

        newInboundCouponsResult = booking.passengers.map((p) => {
          let fare = retPricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(retPricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(retPricing.final_price * 0.85);
          newTotalFare += fare;
          return this.buildCouponWithFare(p, newReturnFlight!, newReturnInventory, 'INBOUND', fare);
        });
      } else {
        newTotalFare += inboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
        newInboundCouponsResult = inboundCoupons;
      }

      const priceDiff = newTotalFare - oldTotalFare;

      // Financial adjustment
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

      // Update booking
      const newConfirmationNumber = this.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalFare;
      booking.early_bird_percent = outPricing.early_bird_percent;
      booking.early_bird_label = outPricing.early_bird_label;
      booking.early_bird_label_en = outPricing.early_bird_label_en;
      booking.ff_tier = outPricing.ff_tier;
      booking.ff_discount_percent = outPricing.ff_percent;
      booking.ticket_coupons = [...newOutboundCoupons, ...newInboundCouponsResult] as any;

      // §1: Adjust SkyMiles
      if (milesDiff > 0) {
        await this.usersService.addSkyMiles(booking.user_id.toString(), milesDiff);
      } else if (milesDiff < 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), Math.abs(milesDiff));
      }
      skyMilesAdjusted = true;

      booking.total_miles_accrued = (booking.total_miles_accrued || 0) + milesDiff;
      if (booking.total_miles_accrued < 0) booking.total_miles_accrued = 0;

      await booking.save();

      const legsMessage = shouldRescheduleReturn ? 'Outbound and return legs' : 'Outbound leg';
      return {
        booking,
        price_difference: priceDiff,
        message: `${legsMessage} rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} VND.`,
      };
    } catch (err) {
      // ===== §2 COMPENSATING ROLLBACK =====
      // Rollback SkyMiles if already adjusted
      if (skyMilesAdjusted && milesDiff !== 0) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
        } catch (_) { /* best-effort rollback */ }
      }

      // Restore old seats that were released (deduplicated)
      if (oldOutboundReleased) {
        try {
          await this.restoreSeatsForCouponsStrict(passengerCount, outboundCoupons);
        } catch (_) { /* best-effort */ }
      }
      if (oldInboundReleased) {
        try {
          await this.restoreSeatsForCouponsStrict(passengerCount, inboundCoupons);
        } catch (_) { /* best-effort */ }
      }

      // Release new seats that were reserved
      try {
        await this.flightsService.updateAvailableSeats(
          dto.new_flight_id, dto.new_inventory_id, +passengerCount,
        );
      } catch (_) { /* best-effort */ }

      if (shouldRescheduleReturn) {
        try {
          await this.flightsService.updateAvailableSeats(
            dto.new_return_flight_id!, dto.new_return_inventory_id!, +passengerCount,
          );
        } catch (_) { /* best-effort */ }
      }

      // Restore in-memory booking state
      booking.confirmation_number = bookingSnapshot.confirmation_number;
      booking.status = bookingSnapshot.status as any;
      booking.total_amount = bookingSnapshot.total_amount;
      booking.ticket_coupons = bookingSnapshot.ticket_coupons as any;
      booking.payment_transactions = bookingSnapshot.payment_transactions as any;
      booking.early_bird_percent = bookingSnapshot.early_bird_percent;
      booking.early_bird_label = bookingSnapshot.early_bird_label;
      booking.early_bird_label_en = bookingSnapshot.early_bird_label_en;
      booking.ff_tier = bookingSnapshot.ff_tier;
      booking.ff_discount_percent = bookingSnapshot.ff_discount_percent;
      booking.total_miles_accrued = bookingSnapshot.total_miles_accrued;

      throw err;
    }
  }

  /**
   * Reschedule a ROUND_TRIP booking where one or both directions are connecting.
   * Outbound connecting: CONNECTING_1, CONNECTING_2 coupons replaced via dto.new_legs
   * Return connecting: INBOUND_1, INBOUND_2 coupons replaced via dto.new_return_legs
   * Direct directions use dto.new_flight_id/new_return_flight_id as usual.
   */
  private async rescheduleMixedRoundTrip(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    outboundCoupons: any[],
    inboundCoupons: any[],
    outboundIsConnecting: boolean,
    returnIsConnecting: boolean,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;

    // Determine what to reschedule
    const hasOutboundLegs = !!(dto.new_legs && dto.new_legs.length >= 2);
    const hasOutboundDirect = !!(dto.new_flight_id && dto.new_inventory_id);
    const hasReturnLegs = !!(dto.new_return_legs && dto.new_return_legs.length >= 2);
    const hasReturnDirect = !!(dto.new_return_flight_id && dto.new_return_inventory_id);

    const rescheduleOutbound = outboundIsConnecting ? hasOutboundLegs : hasOutboundDirect;
    const rescheduleReturn = returnIsConnecting ? hasReturnLegs : hasReturnDirect;

    if (!rescheduleOutbound && !rescheduleReturn) {
      throw new BadRequestException(
        'At least one direction (outbound or return) must be provided for rescheduling.',
      );
    }

    // 1. Load and validate all new flights
    const outboundFlights: FlightDocument[] = [];
    const outboundInventories: any[] = [];
    const returnFlights: FlightDocument[] = [];
    const returnInventories: any[] = [];

    if (rescheduleOutbound) {
      if (outboundIsConnecting) {
        for (const legDef of dto.new_legs!) {
          const flight = await this.flightsService.findById(legDef.flight_id);
          const inventory = flight.inventories.find(
            (inv: any) => inv._id.toString() === legDef.inventory_id || inv.id === legDef.inventory_id,
          );
          if (!inventory) {
            throw new NotFoundException(`Selected inventory ${legDef.inventory_id} not found on flight ${flight.flight_number}`);
          }
          outboundFlights.push(flight);
          outboundInventories.push(inventory);
        }
        // Validate connecting direction: 2-3 legs, valid sequence
        if (outboundFlights.length < 2 || outboundFlights.length > 3) {
          throw new BadRequestException('Outbound connecting direction must contain 2 or 3 legs.');
        }
        this.validateBookingWindow(outboundFlights, 'Outbound connecting itinerary');
        this.validateConnectingSequence(outboundFlights, 'outbound');
        // Validate endpoint match
        const oldOutboundLegs = await this.loadDistinctCouponFlights(outboundCoupons);
        if (oldOutboundLegs.length > 0) {
          const oldOrigin = oldOutboundLegs[0].origin_iata;
          const oldDest = oldOutboundLegs[oldOutboundLegs.length - 1].dest_iata;
          if (outboundFlights[0].origin_iata !== oldOrigin ||
              outboundFlights[outboundFlights.length - 1].dest_iata !== oldDest) {
            throw new BadRequestException(
              `Route mismatch: new outbound ${outboundFlights[0].origin_iata}-${outboundFlights[outboundFlights.length - 1].dest_iata} ` +
              `does not match old outbound ${oldOrigin}-${oldDest}.`,
            );
          }
        }
      } else {
        const flight = await this.flightsService.findById(dto.new_flight_id!);
        const inventory = flight.inventories.find(
          (inv: any) => inv._id.toString() === dto.new_inventory_id || inv.id === dto.new_inventory_id,
        );
        if (!inventory) throw new NotFoundException('Selected new outbound inventory not found on target flight');
        if (new Date(flight.scheduled_departure) <= new Date()) {
          throw new BadRequestException('New outbound flight departure is in the past.');
        }
        this.validateBookingWindow(flight, 'New outbound flight');
        if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
          throw new BadRequestException(`Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`);
        }
        const oldOutboundFlight = await this.flightsService.findById(outboundCoupons[0].flight_id.toString());
        if (flight.origin_iata !== oldOutboundFlight.origin_iata || flight.dest_iata !== oldOutboundFlight.dest_iata) {
          throw new BadRequestException(
            `Route mismatch: new outbound ${flight.origin_iata}-${flight.dest_iata} ` +
            `does not match old outbound ${oldOutboundFlight.origin_iata}-${oldOutboundFlight.dest_iata}.`,
          );
        }
        outboundFlights.push(flight);
        outboundInventories.push(inventory);
      }
    } else {
      // Keep existing outbound — load flights for chronology check
      const existingOutboundFlights = await this.loadDistinctCouponFlights(outboundCoupons);
      outboundFlights.push(...existingOutboundFlights);
    }

    if (rescheduleReturn) {
      if (returnIsConnecting) {
        for (const legDef of dto.new_return_legs!) {
          const flight = await this.flightsService.findById(legDef.flight_id);
          const inventory = flight.inventories.find(
            (inv: any) => inv._id.toString() === legDef.inventory_id || inv.id === legDef.inventory_id,
          );
          if (!inventory) {
            throw new NotFoundException(`Selected return inventory ${legDef.inventory_id} not found on flight ${flight.flight_number}`);
          }
          returnFlights.push(flight);
          returnInventories.push(inventory);
        }
        // Validate connecting direction: 2-3 legs, valid sequence
        if (returnFlights.length < 2 || returnFlights.length > 3) {
          throw new BadRequestException('Return connecting direction must contain 2 or 3 legs.');
        }
        this.validateBookingWindow(returnFlights, 'Return connecting itinerary');
        this.validateConnectingSequence(returnFlights, 'return');
        // Validate endpoint match
        const oldReturnLegs = await this.loadDistinctCouponFlights(inboundCoupons);
        if (oldReturnLegs.length > 0) {
          const oldOrigin = oldReturnLegs[0].origin_iata;
          const oldDest = oldReturnLegs[oldReturnLegs.length - 1].dest_iata;
          if (returnFlights[0].origin_iata !== oldOrigin ||
              returnFlights[returnFlights.length - 1].dest_iata !== oldDest) {
            throw new BadRequestException(
              `Route mismatch: new return ${returnFlights[0].origin_iata}-${returnFlights[returnFlights.length - 1].dest_iata} ` +
              `does not match old return ${oldOrigin}-${oldDest}.`,
            );
          }
        }
      } else {
        const flight = await this.flightsService.findById(dto.new_return_flight_id!);
        const inventory = flight.inventories.find(
          (inv: any) => inv._id.toString() === dto.new_return_inventory_id || inv.id === dto.new_return_inventory_id,
        );
        if (!inventory) throw new NotFoundException('Selected new return inventory not found on target flight');
        if (new Date(flight.scheduled_departure) <= new Date()) {
          throw new BadRequestException('New return flight departure is in the past.');
        }
        this.validateBookingWindow(flight, 'New return flight');
        if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
          throw new BadRequestException(`Cannot reschedule to return flight ${flight.flight_number}: flight is ${flight.status}.`);
        }
        const oldReturnFlight = await this.flightsService.findById(inboundCoupons[0]?.flight_id?.toString());
        if (flight.origin_iata !== oldReturnFlight.origin_iata || flight.dest_iata !== oldReturnFlight.dest_iata) {
          throw new BadRequestException(
            `Route mismatch: new return ${flight.origin_iata}-${flight.dest_iata} ` +
            `does not match old return ${oldReturnFlight.origin_iata}-${oldReturnFlight.dest_iata}.`,
          );
        }
        returnFlights.push(flight);
        returnInventories.push(inventory);
      }
    } else {
      // Keep existing return — load flights for chronology check
      const existingReturnFlights = await this.loadDistinctCouponFlights(inboundCoupons);
      returnFlights.push(...existingReturnFlights);
    }

    // 2. Cross-direction chronology: return must depart after outbound arrives
    if (outboundFlights.length > 0 && returnFlights.length > 0) {
      const lastOutbound = outboundFlights[outboundFlights.length - 1];
      const firstReturn = returnFlights[0];
      if (!lastOutbound.scheduled_arrival) {
        throw new BadRequestException('Outbound flight has no scheduled_arrival — cannot validate return chronology.');
      }
      if (new Date(firstReturn.scheduled_departure) <= new Date(lastOutbound.scheduled_arrival)) {
        throw new BadRequestException(
          rescheduleReturn
            ? 'Return flight must depart after the outbound flight arrives.'
            : 'Existing return flight departs before the new outbound arrives. Please also reschedule the return leg.',
        );
      }
    }

    // 3. SkyMiles delta: ONLY on changed directions
    let outboundMilesDelta = 0;
    let returnMilesDelta = 0;
    if (rescheduleOutbound) {
      const oldOutboundFlights = await this.loadDistinctCouponFlights(outboundCoupons);
      const oldMiles = oldOutboundFlights.reduce((s, f) => s + f.distance_miles, 0);
      const newMiles = outboundFlights.reduce((s, f) => s + f.distance_miles, 0);
      outboundMilesDelta = (newMiles - oldMiles) * passengerCount;
    }
    if (rescheduleReturn) {
      const oldReturnFlights = await this.loadDistinctCouponFlights(inboundCoupons);
      const oldMiles = oldReturnFlights.reduce((s, f) => s + f.distance_miles, 0);
      const newMiles = returnFlights.reduce((s, f) => s + f.distance_miles, 0);
      returnMilesDelta = (newMiles - oldMiles) * passengerCount;
    }
    const milesDiff = outboundMilesDelta + returnMilesDelta;

    // 4. Reserve ALL new seats before releasing any old seats
    interface ReservedLeg { flight_id: string; inventory_id: string }
    const reservedLegs: ReservedLeg[] = [];

    const reserveDirection = async (legs: Array<{ flight_id: string; inventory_id: string }>) => {
      for (const leg of legs) {
        let reserved = false;
        try {
          reserved = await this.flightsService.reserveSeats(leg.flight_id, leg.inventory_id, passengerCount);
        } catch (error) {
          // Rollback all previously reserved new legs
          for (const r of reservedLegs) {
            try { await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount); } catch (_) {}
          }
          throw error;
        }
        if (!reserved) {
          for (const r of reservedLegs) {
            try { await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount); } catch (_) {}
          }
          const f = await this.flightsService.findById(leg.flight_id);
          throw new BadRequestException(`Not enough seats on flight ${f.flight_number}. All reservations rolled back.`);
        }
        reservedLegs.push(leg);
      }
    };

    if (rescheduleOutbound) {
      const outLegs = outboundIsConnecting
        ? dto.new_legs!.map(l => ({ flight_id: l.flight_id, inventory_id: l.inventory_id }))
        : [{ flight_id: dto.new_flight_id!, inventory_id: dto.new_inventory_id! }];
      await reserveDirection(outLegs);
    }
    if (rescheduleReturn) {
      const retLegs = returnIsConnecting
        ? dto.new_return_legs!.map(l => ({ flight_id: l.flight_id, inventory_id: l.inventory_id }))
        : [{ flight_id: dto.new_return_flight_id!, inventory_id: dto.new_return_inventory_id! }];
      await reserveDirection(retLegs);
    }

    // 5. Mutating phase with compensating rollback
    const bookingSnapshot = {
      confirmation_number: booking.confirmation_number,
      status: booking.status,
      total_amount: booking.total_amount,
      ticket_coupons: booking.ticket_coupons.map((c: any) => ({ ...c })),
      payment_transactions: [...booking.payment_transactions],
      early_bird_percent: booking.early_bird_percent,
      early_bird_label: booking.early_bird_label,
      early_bird_label_en: booking.early_bird_label_en,
      ff_tier: booking.ff_tier,
      ff_discount_percent: booking.ff_discount_percent,
      total_miles_accrued: booking.total_miles_accrued,
    };

    let outboundReleased = false;
    let returnReleased = false;
    let skyMilesAdjusted = false;
    let originalUserSkyMiles = 0;

    try {
      // Release old seats for changed directions
      if (rescheduleOutbound) {
        await this.releaseSeatsForCouponsStrict(passengerCount, outboundCoupons);
        outboundReleased = true;
      }
      if (rescheduleReturn) {
        await this.releaseSeatsForCouponsStrict(passengerCount, inboundCoupons);
        returnReleased = true;
      }

      // Pricing
      const user = await this.usersService.findById(booking.user_id.toString());
      originalUserSkyMiles = user.sky_miles || 0;
      const now = new Date();

      let newTotalFare = 0;
      const newOutboundCoupons: any[] = [];
      const newReturnCoupons: any[] = [];

      // Build outbound coupons
      if (rescheduleOutbound) {
        for (let i = 0; i < outboundFlights.length; i++) {
          const fl = outboundFlights[i];
          const inv = outboundInventories[i];
          const daysUntil = Math.max(0, (new Date(fl.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const pricing = applyPricing(inv.base_price, daysUntil, user.sky_miles || 0);
          const legType = outboundIsConnecting ? `CONNECTING_${i + 1}` : 'OUTBOUND';
          for (const p of booking.passengers) {
            let fare = pricing.final_price;
            if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
            if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
            newTotalFare += fare;
            newOutboundCoupons.push(this.buildCouponWithFare(p, fl, inv, legType, fare));
          }
        }
      } else {
        newTotalFare += outboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
        newOutboundCoupons.push(...outboundCoupons);
      }

      // Build return coupons
      if (rescheduleReturn) {
        for (let i = 0; i < returnFlights.length; i++) {
          const fl = returnFlights[i];
          const inv = returnInventories[i];
          const daysUntil = Math.max(0, (new Date(fl.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const pricing = applyPricing(inv.base_price, daysUntil, user.sky_miles || 0);
          const legType = returnIsConnecting ? `INBOUND_${i + 1}` : 'INBOUND';
          for (const p of booking.passengers) {
            let fare = pricing.final_price;
            if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
            if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
            newTotalFare += fare;
            newReturnCoupons.push(this.buildCouponWithFare(p, fl, inv, legType, fare));
          }
        }
      } else {
        newTotalFare += inboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
        newReturnCoupons.push(...inboundCoupons);
      }

      const priceDiff = newTotalFare - oldTotalFare;

      // Financial adjustment
      const card = dto.credit_card_number || 'SAVED-CARD';
      const maskedCard = card.length >= 4 ? `**** **** **** ${card.slice(-4)}` : card;
      if (priceDiff > 0) {
        booking.payment_transactions.push({
          transaction_type: 'RESCHEDULE_CHARGE', amount: priceDiff,
          card_masked: maskedCard, status: 'SUCCESS', created_at: new Date(),
        });
      } else if (priceDiff < 0) {
        booking.payment_transactions.push({
          transaction_type: 'RESCHEDULE_REFUND', amount: Math.abs(priceDiff),
          card_masked: maskedCard, status: 'SUCCESS', created_at: new Date(),
        });
      }

      // SkyMiles adjustment
      if (milesDiff > 0) {
        await this.usersService.addSkyMiles(booking.user_id.toString(), milesDiff);
      } else if (milesDiff < 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), Math.abs(milesDiff));
      }
      skyMilesAdjusted = true;

      const newConfirmationNumber = this.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalFare;
      booking.ticket_coupons = [...newOutboundCoupons, ...newReturnCoupons] as any;
      booking.total_miles_accrued = (booking.total_miles_accrued || 0) + milesDiff;
      if (booking.total_miles_accrued < 0) booking.total_miles_accrued = 0;

      await booking.save();

      const legsMessage = rescheduleOutbound && rescheduleReturn
        ? 'Outbound and return legs' : rescheduleOutbound ? 'Outbound leg' : 'Return leg';
      return {
        booking,
        price_difference: priceDiff,
        message: `${legsMessage} rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} VND.`,
      };
    } catch (err) {
      // Compensating rollback
      if (skyMilesAdjusted && milesDiff !== 0) {
        try { await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles); } catch (_) {}
      }
      if (outboundReleased) {
        try { await this.restoreSeatsForCouponsStrict(passengerCount, outboundCoupons); } catch (_) {}
      }
      if (returnReleased) {
        try { await this.restoreSeatsForCouponsStrict(passengerCount, inboundCoupons); } catch (_) {}
      }
      for (const r of reservedLegs) {
        try { await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount); } catch (_) {}
      }
      // Restore booking in memory
      booking.confirmation_number = bookingSnapshot.confirmation_number;
      booking.status = bookingSnapshot.status as any;
      booking.total_amount = bookingSnapshot.total_amount;
      booking.ticket_coupons = bookingSnapshot.ticket_coupons as any;
      booking.payment_transactions = bookingSnapshot.payment_transactions as any;
      booking.early_bird_percent = bookingSnapshot.early_bird_percent;
      booking.early_bird_label = bookingSnapshot.early_bird_label;
      booking.early_bird_label_en = bookingSnapshot.early_bird_label_en;
      booking.ff_tier = bookingSnapshot.ff_tier;
      booking.ff_discount_percent = bookingSnapshot.ff_discount_percent;
      booking.total_miles_accrued = bookingSnapshot.total_miles_accrued;
      throw err;
    }
  }

  /**
   * Reschedule a CONNECTING booking with complete multi-leg itinerary validation,
   * atomic reservation of new legs before releasing old legs, and full compensating rollback.
   */
  private async rescheduleConnectingTicket(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;
    const newLegs = dto.new_legs!;
    const oldCoupons = booking.ticket_coupons.map((coupon: any) => ({ ...coupon }));

    // 1. Load and validate all new flights
    const loadedFlights: FlightDocument[] = [];
    const loadedInventories: any[] = [];

    for (let i = 0; i < newLegs.length; i++) {
      const legDef = newLegs[i];
      const flight = await this.flightsService.findById(legDef.flight_id);
      const inventory = flight.inventories.find(
        (inv: any) => inv._id.toString() === legDef.inventory_id || inv.id === legDef.inventory_id,
      );
      if (!inventory) {
        throw new NotFoundException(`Selected inventory ${legDef.inventory_id} not found on flight ${flight.flight_number}`);
      }

      // Must not be past
      if (new Date(flight.scheduled_departure) <= new Date()) {
        throw new BadRequestException(`New flight ${flight.flight_number} departure is in the past.`);
      }

      // Reject CANCELLED/COMPLETED
      if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
        throw new BadRequestException(
          `Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`,
        );
      }

      loadedFlights.push(flight);
      loadedInventories.push(inventory);
    }

    // §3.6.2: Replacement connecting itinerary must not exceed booking window
    this.validateBookingWindow(loadedFlights, 'Connecting itinerary');

    // 2. Validate the complete itinerary and keep the original journey endpoints.
    this.validateConnectingFlights(loadedFlights);
    const oldLegs = await this.loadDistinctCouponFlights(oldCoupons);
    if (oldLegs.length === 0) {
      throw new BadRequestException('Existing connecting booking has no valid itinerary legs.');
    }
    const oldOrigin = oldLegs[0].origin_iata;
    const oldDestination = oldLegs[oldLegs.length - 1].dest_iata;
    if (
      loadedFlights[0].origin_iata !== oldOrigin ||
      loadedFlights[loadedFlights.length - 1].dest_iata !== oldDestination
    ) {
      throw new BadRequestException(
        `Route mismatch: new connecting itinerary ${loadedFlights[0].origin_iata}-${loadedFlights[loadedFlights.length - 1].dest_iata} ` +
        `does not match original journey ${oldOrigin}-${oldDestination}.`,
      );
    }

    // 3. Atomically reserve seats on all new legs first
    const reservedLegs: typeof newLegs = [];
    for (const legDef of newLegs) {
      let reserved = false;
      try {
        reserved = await this.flightsService.reserveSeats(
          legDef.flight_id,
          legDef.inventory_id,
          passengerCount,
        );
      } catch (error) {
        for (const reservedLeg of reservedLegs) {
          try {
            await this.flightsService.updateAvailableSeats(
              reservedLeg.flight_id,
              reservedLeg.inventory_id,
              passengerCount,
            );
          } catch (_) {}
        }
        throw error;
      }
      if (!reserved) {
        // Rollback already reserved new legs
        for (const r of reservedLegs) {
          try {
            await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount);
          } catch (_) {}
        }
        const f = await this.flightsService.findById(legDef.flight_id);
        throw new BadRequestException(
          `Not enough available seats on flight ${f.flight_number}. Reschedule cancelled and no seats were modified.`,
        );
      }
      reservedLegs.push(legDef);
    }

    // 4. Mutating Phase with compensating rollback
    const bookingSnapshot = {
      confirmation_number: booking.confirmation_number,
      status: booking.status,
      total_amount: booking.total_amount,
      ticket_coupons: booking.ticket_coupons.map((c: any) => ({ ...c })),
      payment_transactions: [...booking.payment_transactions],
      early_bird_percent: booking.early_bird_percent,
      early_bird_label: booking.early_bird_label,
      early_bird_label_en: booking.early_bird_label_en,
      ff_tier: booking.ff_tier,
      ff_discount_percent: booking.ff_discount_percent,
      total_miles_accrued: booking.total_miles_accrued,
    };

    let oldSeatsReleased = false;
    let skyMilesAdjusted = false;
    let milesDiff = 0;
    let originalUserSkyMiles = 0;

    try {
      // Release old seats strictly
      await this.releaseSeatsForCouponsStrict(passengerCount, oldCoupons);
      oldSeatsReleased = true;

      // Price calculation
      const user = await this.usersService.findById(booking.user_id.toString());
      originalUserSkyMiles = user.sky_miles || 0;
      const now = new Date();

      let newTotalFare = 0;
      let newTotalMiles = 0;
      const newCoupons: any[] = [];

      for (let i = 0; i < loadedFlights.length; i++) {
        const fl = loadedFlights[i];
        const inv = loadedInventories[i];
        const daysUntil = Math.max(
          0,
          (new Date(fl.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const pricing = applyPricing(inv.base_price, daysUntil, user.sky_miles || 0);

        newTotalMiles += fl.distance_miles * passengerCount;

        for (const p of booking.passengers) {
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;

          newCoupons.push({
            coupon_number: this.generateCode('CPN'),
            passenger_name: `${p.first_name} ${p.last_name}`,
            flight_id: fl._id,
            flight_number: fl.flight_number,
            inventory_id: inv._id,
            cabin_class: inv.cabin_class,
            is_smoking: inv.is_smoking,
            fare_paid: fare,
            seat_code: '',
            leg_type: `CONNECTING_${i + 1}`,
            coupon_status: 'ACTIVE',
          });
        }
      }

      const priceDiff = newTotalFare - oldTotalFare;

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

      // SkyMiles adjustment
      milesDiff = newTotalMiles - (booking.total_miles_accrued || 0);
      if (milesDiff > 0) {
        await this.usersService.addSkyMiles(booking.user_id.toString(), milesDiff);
        skyMilesAdjusted = true;
      } else if (milesDiff < 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), Math.abs(milesDiff));
        skyMilesAdjusted = true;
      }

      const newConfirmationNumber = this.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalFare;
      booking.ticket_coupons = newCoupons;
      booking.total_miles_accrued = newTotalMiles;

      await booking.save();

      const diffMsg =
        priceDiff > 0
          ? ` Thu thêm: ${priceDiff.toLocaleString()} VND.`
          : priceDiff < 0
          ? ` Hoàn lại: ${Math.abs(priceDiff).toLocaleString()} VND.`
          : ' Không phát sinh chênh lệch giá.';

      return {
        booking,
        price_difference: priceDiff,
        message: `Đổi vé nối chuyến thành công. Mã xác nhận mới: ${newConfirmationNumber}.${diffMsg}`,
      };
    } catch (err) {
      // Compensating rollback
      if (skyMilesAdjusted) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
        } catch (_) {}
      }

      if (oldSeatsReleased) {
        try {
          await this.restoreSeatsForCouponsStrict(passengerCount, oldCoupons);
        } catch (_) {}
      }

      // Release new seats
      for (const r of reservedLegs) {
        try {
          await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount);
        } catch (_) {}
      }

      // Restore booking in memory
      booking.confirmation_number = bookingSnapshot.confirmation_number;
      booking.status = bookingSnapshot.status as any;
      booking.total_amount = bookingSnapshot.total_amount;
      booking.ticket_coupons = bookingSnapshot.ticket_coupons as any;
      booking.payment_transactions = bookingSnapshot.payment_transactions as any;
      booking.early_bird_percent = bookingSnapshot.early_bird_percent;
      booking.early_bird_label = bookingSnapshot.early_bird_label;
      booking.early_bird_label_en = bookingSnapshot.early_bird_label_en;
      booking.ff_tier = bookingSnapshot.ff_tier;
      booking.ff_discount_percent = bookingSnapshot.ff_discount_percent;
      booking.total_miles_accrued = bookingSnapshot.total_miles_accrued;

      throw err;
    }
  }

  /**
   * Like releaseSeatsForCoupons but THROWS on error (for reschedule critical path).
   */
  private async releaseSeatsForCouponsStrict(passengerCount: number, coupons: any[]) {
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
    for (const coupon of coupons) {
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

  async cancelExpiredBlockStrict(booking: BookingDocument): Promise<void> {
    const originalStatus = booking.status;
    const originalCancelNum = booking.cancellation_number;

    await this.releaseSeatsForCouponsStrict(
      booking.passengers.length,
      booking.ticket_coupons,
    );

    booking.status = BookingStatus.CANCELLED;
    booking.cancellation_number = this.generateCode('CAN');

    try {
      await booking.save();
    } catch (saveError) {
      try {
        await this.restoreSeatsForCouponsStrict(
          booking.passengers.length,
          booking.ticket_coupons,
        );
      } catch (_) {}
      booking.status = originalStatus;
      booking.cancellation_number = originalCancelNum;
      throw saveError;
    }
  }

  /**
   * §3.6.2 Booking window validation: Ensure the flight's operating date (YYYY-MM-DD)
   * falls within the authoritative [min_date, max_date] calendar booking window.
   * For connecting itineraries, only the first leg's operating date determines the boundary.
   */
  private validateBookingWindow(flightOrFlights: FlightDocument | FlightDocument[], directionName = 'Flight'): void {
    const flights = Array.isArray(flightOrFlights) ? flightOrFlights : [flightOrFlights];
    if (flights.length === 0) return;
    const firstLeg = flights[0];

    const { min_date, max_date, max_advance_days } = getBookingWindowLimits();

    // 1. Prefer the flight's authoritative local operating date
    let operatingDate: string | undefined;
    const rawDepDate = (firstLeg as any).departure_date;
    if (typeof rawDepDate === 'string' && rawDepDate.trim().length > 0) {
      operatingDate = rawDepDate.trim().split('T')[0];
    } else if (rawDepDate instanceof Date && !isNaN(rawDepDate.getTime())) {
      operatingDate = rawDepDate.toISOString().split('T')[0];
    } else if (firstLeg.scheduled_departure) {
      // 2. Timestamp-derived fallback converted consistently to calendar date (YYYY-MM-DD)
      const depDate = new Date(firstLeg.scheduled_departure);
      if (!isNaN(depDate.getTime())) {
        operatingDate = depDate.toISOString().split('T')[0];
      }
    }

    if (!operatingDate) {
      throw new BadRequestException(`${directionName} has invalid departure date.`);
    }

    // 3. Validation semantics:
    // operating date < min_date -> reject
    // operating date > max_date -> reject
    // operating date === min_date -> allowed (future timestamp check handled separately)
    // operating date === max_date -> allowed regardless of departure time-of-day
    if (operatingDate < min_date) {
      throw new BadRequestException(
        `${directionName} departure date ${operatingDate} is before minimum booking date ${min_date}.`,
      );
    }

    if (operatingDate > max_date) {
      throw new BadRequestException(
        `${directionName} exceeds maximum advance booking window of ${max_advance_days} days.`,
      );
    }
  }

  private validateConnectingSequence(flights: FlightDocument[], label: string): void {
    const now = Date.now();
    for (let index = 0; index < flights.length; index++) {
      const flight = flights[index];
      const departure = new Date(flight.scheduled_departure).getTime();
      const arrival = new Date(flight.scheduled_arrival).getTime();
      if (!Number.isFinite(departure) || !Number.isFinite(arrival) || departure <= now || arrival <= departure) {
        throw new BadRequestException(`Flight ${flight.flight_number} has invalid or non-future chronology.`);
      }
      if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
        throw new BadRequestException(`Cannot use flight ${flight.flight_number}: flight is ${flight.status}.`);
      }
      if (index === flights.length - 1) continue;
      const next = flights[index + 1];
      if (flight.dest_iata !== next.origin_iata) {
        throw new BadRequestException(
          `Connecting airport mismatch in ${label}: leg ${index + 1} arrives at ${flight.dest_iata}, but leg ${index + 2} departs from ${next.origin_iata}.`,
        );
      }
      const layoverMinutes = Math.round(
        (new Date(next.scheduled_departure).getTime() - arrival) / 60000,
      );
      if (layoverMinutes < 45 || layoverMinutes > 720) {
        throw new BadRequestException(
          `Layover between ${flight.flight_number} and ${next.flight_number} in ${label} is ${layoverMinutes} minutes. It must be between 45 and 720 minutes.`,
        );
      }
    }
  }

  private validateConnectingFlights(flights: FlightDocument[]): void {
    if (flights.length < 2 || flights.length > 3) {
      throw new BadRequestException('A connecting itinerary must contain two or three legs.');
    }
    if (flights[0].origin_iata === flights[flights.length - 1].dest_iata) {
      throw new BadRequestException('Connecting itinerary origin and destination must be different.');
    }
    this.validateConnectingSequence(flights, 'connecting itinerary');
  }

  private validateRoundTripLegs(
    selectedLegs: Array<{ definition: CreateBookingDto['legs'][number]; flight: FlightDocument; inventory: any }>,
  ): {
    outboundLegs: Array<{ definition: CreateBookingDto['legs'][number]; flight: FlightDocument; inventory: any }>;
    inboundLegs: Array<{ definition: CreateBookingDto['legs'][number]; flight: FlightDocument; inventory: any }>;
  } {
    const inboundStartIndex = selectedLegs.findIndex((l) => {
      const t = (l.definition.leg_type || '').toUpperCase();
      return t.includes('INBOUND') || t.includes('RETURN');
    });

    let outboundLegs: typeof selectedLegs;
    let inboundLegs: typeof selectedLegs;

    if (inboundStartIndex > 0) {
      outboundLegs = selectedLegs.slice(0, inboundStartIndex);
      inboundLegs = selectedLegs.slice(inboundStartIndex);
    } else if (selectedLegs.length >= 2) {
      const reverseIndex = selectedLegs.findIndex(
        (l, idx) => idx > 0 && l.flight.dest_iata === selectedLegs[0].flight.origin_iata,
      );
      const splitIdx = reverseIndex > 0 ? reverseIndex : Math.floor(selectedLegs.length / 2);
      outboundLegs = selectedLegs.slice(0, splitIdx);
      inboundLegs = selectedLegs.slice(splitIdx);
    } else {
      throw new BadRequestException('Round-trip booking must contain at least outbound and return legs.');
    }

    if (outboundLegs.length === 0 || inboundLegs.length === 0) {
      throw new BadRequestException('Round-trip booking must contain at least one outbound leg and one return leg.');
    }

    if (outboundLegs.length > 1) {
      this.validateConnectingSequence(outboundLegs.map((l) => l.flight), 'outbound');
    }
    if (inboundLegs.length > 1) {
      this.validateConnectingSequence(inboundLegs.map((l) => l.flight), 'return');
    }

    const lastOutboundFlight = outboundLegs[outboundLegs.length - 1].flight;
    const firstInboundFlight = inboundLegs[0].flight;
    const lastOutboundArrival = new Date(lastOutboundFlight.scheduled_arrival).getTime();
    const firstInboundDeparture = new Date(firstInboundFlight.scheduled_departure).getTime();

    if (!Number.isFinite(lastOutboundArrival) || !Number.isFinite(firstInboundDeparture)) {
      throw new BadRequestException('Chuyến bay có lịch trình không hợp lệ.');
    }

    if (firstInboundDeparture <= lastOutboundArrival) {
      throw new BadRequestException(
        'Chuyến bay về phải khởi hành sau khi chuyến bay đi hạ cánh (Return flight departs before outbound arrival).',
      );
    }

    return { outboundLegs, inboundLegs };
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

  /** Like buildCoupon but with a pre-computed fare (from applyPricing). */
  private buildCouponWithFare(
    passenger: any,
    flight: FlightDocument,
    inventory: any,
    legType: string,
    fare: number,
  ) {
    return {
      coupon_number: this.generateCode('CPN'),
      passenger_name: `${passenger.first_name} ${passenger.last_name}`,
      flight_id: flight._id,
      flight_number: flight.flight_number,
      inventory_id: (inventory as any)._id,
      cabin_class: inventory.cabin_class,
      is_smoking: inventory.is_smoking,
      fare_paid: fare,
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
    currency: string;
    refund_card_masked?: string;
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

    if (booking.status === BookingStatus.CONFIRMED) {
      const earliestDeparture = await this.getEarliestDeparture(booking);
      const now = new Date();
      const daysBefore = Math.max(0, (earliestDeparture.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      refundPercentage = await this.policiesService.calculateRefundPercentage(daysBefore);
      refundAmount = Math.round((booking.total_amount * refundPercentage) / 100);

      const user = await this.usersService.findById(booking.user_id.toString());
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

        if (Array.isArray(booking.payment_transactions) && booking.payment_transactions.length > 0) {
          const candidates: Array<{
            tx: any;
            index: number;
            timestamp: number;
            normalizedCard: string;
          }> = [];

          booking.payment_transactions.forEach((tx: any, index: number) => {
            const txType = (tx?.transaction_type || '').toUpperCase();
            const txStatus = (tx?.status || 'SUCCESS').toUpperCase();
            if (txType === 'PAYMENT' && txStatus === 'SUCCESS') {
              const normalized = normalizeCard(tx?.card_masked);
              if (normalized) {
                const rawTime = tx?.created_at ? new Date(tx.created_at).getTime() : NaN;
                const timestamp = isNaN(rawTime) ? -1 : rawTime;
                candidates.push({ tx, index, timestamp, normalizedCard: normalized });
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
          }
        }

        if (!usableCard && user?.preferred_credit_card) {
          const normalized = normalizeCard(user.preferred_credit_card);
          if (normalized) {
            usableCard = normalized;
          }
        }

        if (!usableCard) {
          throw new BadRequestException('Cannot process refund: no valid payment card found for this booking.');
        }

        refundCardMasked = usableCard;
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

    const cancellationNumber = this.generateCode('CAN');
    let seatsReleased = false;
    let skyMilesAdjusted = false;

    try {
      await this.releaseSeatsForCouponsStrict(passengerCount, originalCoupons);
      seatsReleased = true;

      if (booking.status === BookingStatus.CONFIRMED) {
        if (refundAmount > 0) {
          booking.payment_transactions.push({
            transaction_type: 'REFUND',
            amount: refundAmount,
            card_masked: refundCardMasked!,
            currency: 'VND',
            status: 'SUCCESS',
            created_at: new Date(),
          });
        }

        if (booking.total_miles_accrued > 0) {
          await this.usersService.deductSkyMiles(booking.user_id.toString(), booking.total_miles_accrued);
          skyMilesAdjusted = true;
          booking.total_miles_accrued = 0;
        }
      }

      booking.ticket_coupons.forEach((coupon: any) => {
        coupon.coupon_status = 'CANCELLED';
      });

      booking.status = BookingStatus.CANCELLED;
      booking.cancellation_number = cancellationNumber;
      await booking.save();

      const message = `Ticket successfully cancelled. Cancellation number: ${cancellationNumber}. Refund: ${refundAmount.toLocaleString('vi-VN')} VND (${refundPercentage}%).`;

      return {
        booking,
        refund_amount: refundAmount,
        refund_percentage: refundPercentage,
        cancellation_number: cancellationNumber,
        currency: 'VND',
        ...(refundCardMasked ? { refund_card_masked: refundCardMasked } : {}),
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
        departure_date: flight.departure_date,
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
    await this.releaseSeatsForCouponsStrict(booking.passengers.length, booking.ticket_coupons);
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
