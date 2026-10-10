import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  PassengerType,
} from './bookings.schema';
import {
  FlightLegSelectionDto,
  QuoteBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { FlightDocument, FlightStatus } from '../flights/flights.schema';
import { applyPricing, inventoryLoadFactor } from '../common/pricing.util';
import { ConvertedPresentmentAmount } from '../paypal/paypal.service';
import { validateRescheduleSeatRequests } from './reschedule-seat-requests.util';
import {
  BookingsQuoteBridge,
  BookingsQuoteDependencies,
  BookingsQuotePart,
} from './bookings-quote.part';

export class BookingsQuoteService extends BookingsQuotePart {
  constructor(deps: BookingsQuoteDependencies, bridge: BookingsQuoteBridge) {
    super(deps, bridge);
  }
  async quoteBooking(
    dto: QuoteBookingDto,
    userId?: string,
  ): Promise<{
    total_fare: number;
    total_seat_fees: number;
    total_amount: number;
    currency: string;
    early_bird_percent: number;
    load_factor_percent: number;
    load_adjustment_percent: number;
    load_adjustment_label: string;
    pricing_profile_id?: string;
    pricing_profile_name?: string;
    ff_tier: string;
    ff_discount_percent: number;
    presentment?: ConvertedPresentmentAmount;
  }> {
    if (!dto.legs || dto.legs.length === 0) {
      throw new BadRequestException('At least one flight leg must be selected.');
    }
    if (!dto.passengers || dto.passengers.length === 0) {
      throw new BadRequestException('At least one passenger must be provided.');
    }

    const user = userId ? await this.usersService.findById(userId) : null;
    const skyMiles = user?.sky_miles || 0;
    const passengerCount = dto.passengers.length;

    const selectedLegs: Array<{ definition: FlightLegSelectionDto; flight: FlightDocument; inventory: any }> = [];
    for (const leg of dto.legs) {
      const flight = await this.flightsService.findById(leg.flight_id);
      this.bridge.assertBookableFlight(flight, 'quote');
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

      selectedLegs.push({ definition: leg, flight, inventory });
    }

    // Validate booking window & itinerary
    if (dto.booking_type === BookingType.CONNECTING) {
      this.bridge.validateConnectingFlights(selectedLegs.map((leg) => leg.flight));
      this.bridge.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Connecting itinerary');
    } else if (dto.booking_type === BookingType.ROUND_TRIP) {
      const { outboundLegs, inboundLegs } = this.bridge.validateRoundTripLegs(selectedLegs);
      this.bridge.validateBookingWindow(outboundLegs.map((leg) => leg.flight), 'Outbound itinerary');
      this.bridge.validateBookingWindow(inboundLegs.map((leg) => leg.flight), 'Return itinerary');
    } else {
      this.bridge.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Flight');
    }

    const earliestDeparture = selectedLegs
      .map((l) => new Date(l.flight.scheduled_departure))
      .filter((d): d is Date => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const now = new Date();
    const daysUntilDeparture = earliestDeparture
      ? (earliestDeparture.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    let totalFare = 0;
    let earlyBirdPercent = 0;
    let loadFactorPercent = 0;
    let loadAdjustmentPercent = 0;
    let loadAdjustmentLabel = '';
    let pricingProfileId: string | undefined;
    let pricingProfileName: string | undefined;
    let ffTier = '';
    let ffDiscountPercent = 0;

    for (const { flight, inventory } of selectedLegs) {
      for (const p of dto.passengers) {
        const pricing = applyPricing(
          inventory.base_price,
          daysUntilDeparture,
          skyMiles,
          (flight as any).pricing_profile_snapshot,
          inventoryLoadFactor(inventory.allocated_seats, inventory.available_seats),
        );
        earlyBirdPercent = pricing.early_bird_percent;
        loadFactorPercent = pricing.load_factor_percent;
        loadAdjustmentPercent = pricing.load_adjustment_percent;
        loadAdjustmentLabel = pricing.load_adjustment_label;
        pricingProfileId = pricing.pricing_profile_id;
        pricingProfileName = pricing.pricing_profile_name;
        ffTier = pricing.ff_tier;
        ffDiscountPercent = pricing.ff_percent;

        let fare = pricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
        totalFare += fare;
      }
    }

    let totalSeatFees = 0;
    if (dto.seat_requests && dto.seat_requests.length > 0) {
      for (const req of dto.seat_requests) {
        if (req.selection_type === 'CHOOSE' && req.seat_code) {
          const leg = selectedLegs.find((l) => l.flight._id.toString() === req.flight_id);
          if (!leg) {
            throw new BadRequestException(`Seat request references flight ${req.flight_id} not found in selected legs.`);
          }
          const aircraftType = leg.flight.aircraft?.model_code;
          if (!aircraftType) {
            throw new BadRequestException(
              `Flight ${leg.flight.flight_number} is missing aircraft model configuration.`,
            );
          }
          if (this.seatAllocationService) {
            await this.seatAllocationService.validateSeatAvailability(
              leg.flight._id,
              req.seat_code,
              aircraftType,
              leg.inventory.cabin_class,
            );
            const fee = await this.seatAllocationService.calculateSeatFee(
              leg.flight._id,
              req.seat_code,
              aircraftType,
              'CHOOSE',
            );
            totalSeatFees += fee;
          }
        }
      }
    }

    const totalAmount = totalFare + totalSeatFees;
    let presentment: ConvertedPresentmentAmount | undefined = undefined;
    if (this.paypalService && this.paypalService.isPayPalActive()) {
      presentment = this.paypalService.convertVndToPresentment(totalAmount);
    }

    return {
      total_fare: totalFare,
      total_seat_fees: totalSeatFees,
      total_amount: totalAmount,
      currency: 'VND',
      early_bird_percent: earlyBirdPercent,
      load_factor_percent: loadFactorPercent,
      load_adjustment_percent: loadAdjustmentPercent,
      load_adjustment_label: loadAdjustmentLabel,
      pricing_profile_id: pricingProfileId,
      pricing_profile_name: pricingProfileName,
      ff_tier: ffTier,
      ff_discount_percent: ffDiscountPercent,
      presentment,
    };
  }

  /**
   * Pure, side-effect-free quote calculation for ticket reschedule.
   * Accurately preserves unchanged legs in round-trip and connecting itineraries.
   */
  async quoteRescheduleTicket(
    dto: RescheduleTicketDto,
    userId?: string,
  ): Promise<{
    price_difference: number;
    old_total: number;
    new_total: number;
    new_fare: number;
    new_seat_fees: number;
    currency: string;
    presentment?: ConvertedPresentmentAmount;
  }> {
    const ident = dto.confirmation_number || dto.pnr_code;
    if (!ident) {
      throw new BadRequestException('Confirmation number or PNR code is required to quote reschedule.');
    }
    const booking = await this.bookingModel.findOne({
      $or: [{ confirmation_number: ident }, { pnr_code: ident }],
    }).exec();
    if (!booking) {
      throw new NotFoundException(`Booking with identifier ${ident} not found.`);
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed tickets can be rescheduled.');
    }

    // Quote and commit must reject the same incomplete/ambiguous replacement payloads.
    const outDirect = Boolean(dto.new_flight_id || dto.new_inventory_id);
    const retDirect = Boolean(dto.new_return_flight_id || dto.new_return_inventory_id);
    const outLegs = dto.new_legs !== undefined;
    const retLegs = dto.new_return_legs !== undefined;
    if (Boolean(dto.new_flight_id) !== Boolean(dto.new_inventory_id) ||
        Boolean(dto.new_return_flight_id) !== Boolean(dto.new_return_inventory_id)) {
      throw new BadRequestException('Both flight and inventory IDs must be provided for each direct direction.');
    }
    if ((outDirect && outLegs) || (retDirect && retLegs)) {
      throw new BadRequestException('Select either a direct flight or a full connecting itinerary for each direction.');
    }
    if ((outLegs && (dto.new_legs!.length < 2 || dto.new_legs!.length > 3)) ||
        (retLegs && (dto.new_return_legs!.length < 2 || dto.new_return_legs!.length > 3))) {
      throw new BadRequestException('A connecting direction must contain 2 or 3 flights.');
    }
    if (!outDirect && !outLegs && !retDirect && !retLegs) {
      throw new BadRequestException('Select at least one complete direction to reschedule.');
    }
    if (booking.booking_type !== BookingType.ROUND_TRIP && (retDirect || retLegs)) {
      throw new BadRequestException('Return direction is only applicable to round-trip bookings.');
    }
    if (booking.booking_type === BookingType.CONNECTING && !outLegs) {
      throw new BadRequestException('A connecting booking requires a complete replacement connecting itinerary.');
    }

    const passengerCount = booking.passengers?.length || 1;
    const user = booking.user_id ? await this.usersService.findById(booking.user_id.toString()) : null;
    const skyMiles = user?.sky_miles || 0;
    const oldTotal = booking.total_amount || 0;

    // Historical RESCHEDULED/CANCELLED coupons must never affect a new quote.
    const activeCoupons = (booking.ticket_coupons || []).filter(
      (c: any) => String(c.coupon_status || 'ACTIVE').toUpperCase() === 'ACTIVE',
    );
    if (!activeCoupons.length) {
      throw new BadRequestException('Booking has no active ticket coupons to reschedule.');
    }
    const isInbound = (lt?: string) => {
      const n = this.bridge.normalizeLegType(lt);
      return n === 'INBOUND' || n.startsWith('INBOUND_');
    };
    const isOutbound = (lt?: string) => {
      const n = this.bridge.normalizeLegType(lt);
      return n === 'OUTBOUND' || n.startsWith('CONNECTING_');
    };

    const isReschedulingOutbound = Boolean(
      (dto.new_flight_id && dto.new_inventory_id) ||
      (dto.new_legs && dto.new_legs.length > 0),
    );
    const shouldRescheduleReturn = Boolean(
      (dto.new_return_flight_id && dto.new_return_inventory_id) ||
      (dto.new_return_legs && dto.new_return_legs.length > 0),
    );

    let newTotalFare = 0;
    let newTotalSeatFees = 0;
    const now = new Date();

    const outboundFlights: FlightDocument[] = [];
    const outboundInventories: any[] = [];
    const returnFlights: FlightDocument[] = [];
    const returnInventories: any[] = [];

    if (dto.new_legs && dto.new_legs.length > 0) {
      for (const legDef of dto.new_legs) {
        const flight = await this.flightsService.findById(legDef.flight_id);
        if (!flight) throw new NotFoundException(`Flight ${legDef.flight_id} not found.`);
        this.bridge.assertBookableFlight(flight, 'quote-reschedule');
        const inv = flight.inventories.find(
          (i: any) => i._id.toString() === legDef.inventory_id || i.id === legDef.inventory_id,
        );
        if (!inv) throw new NotFoundException(`Inventory ${legDef.inventory_id} not found on flight ${flight.flight_number}.`);
        if (inv.available_seats < passengerCount) {
          throw new BadRequestException(
            `Not enough available seats on flight ${flight.flight_number}. Required ${passengerCount}, available ${inv.available_seats}`,
          );
        }
        if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
          throw new BadRequestException(`Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`);
        }
        const dep = new Date(flight.scheduled_departure);
        if (isNaN(dep.getTime()) || dep <= now) {
          throw new BadRequestException(`Flight ${flight.flight_number} departure is invalid or in the past.`);
        }
        outboundFlights.push(flight);
        outboundInventories.push(inv);

        const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        for (const p of booking.passengers) {
          const pricing = applyPricing(
            inv.base_price,
            daysUntilDep,
            skyMiles,
            (flight as any).pricing_profile_snapshot,
            inventoryLoadFactor(inv.allocated_seats, inv.available_seats),
          );
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;
        }
      }
      if (outboundFlights.length > 1) {
        this.bridge.validateConnectingSequence(outboundFlights, 'outbound');
        this.bridge.validateBookingWindow(outboundFlights, 'Outbound connecting itinerary');
      }
    } else if (dto.new_flight_id && dto.new_inventory_id) {
      const flight = await this.flightsService.findById(dto.new_flight_id);
      if (!flight) throw new NotFoundException(`Flight ${dto.new_flight_id} not found.`);
      this.bridge.assertBookableFlight(flight, 'quote-reschedule');
      const inv = flight.inventories.find(
        (i: any) => i._id.toString() === dto.new_inventory_id || i.id === dto.new_inventory_id,
      );
      if (!inv) throw new NotFoundException(`Inventory ${dto.new_inventory_id} not found on flight ${flight.flight_number}.`);
      if (inv.available_seats < passengerCount) {
        throw new BadRequestException(
          `Not enough available seats on flight ${flight.flight_number}. Required ${passengerCount}, available ${inv.available_seats}`,
        );
      }
      if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
        throw new BadRequestException(`Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`);
      }
      const dep = new Date(flight.scheduled_departure);
      if (isNaN(dep.getTime()) || dep <= now) {
        throw new BadRequestException(`Flight ${flight.flight_number} departure is invalid or in the past.`);
      }
      outboundFlights.push(flight);
      outboundInventories.push(inv);
      this.bridge.validateBookingWindow([flight], 'New outbound flight');

      const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      for (const p of booking.passengers) {
        const pricing = applyPricing(
          inv.base_price,
          daysUntilDep,
          skyMiles,
          (flight as any).pricing_profile_snapshot,
          inventoryLoadFactor(inv.allocated_seats, inv.available_seats),
        );
        let fare = pricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
        newTotalFare += fare;
      }
    } else if (booking.booking_type === BookingType.ROUND_TRIP && shouldRescheduleReturn) {
      // Outbound is NOT rescheduled: retain existing outbound coupons fare and seat fees!
      const outboundCoupons = activeCoupons.filter((c: any) => isOutbound(c.leg_type));
      for (const c of outboundCoupons) {
        newTotalFare += (c.fare_paid || 0);
        newTotalSeatFees += (c.seat_fee || 0);
      }
    }

    if (shouldRescheduleReturn) {
      if (dto.new_return_legs && dto.new_return_legs.length > 0) {
        for (const legDef of dto.new_return_legs) {
          const flight = await this.flightsService.findById(legDef.flight_id);
          if (!flight) throw new NotFoundException(`Return flight ${legDef.flight_id} not found.`);
          this.bridge.assertBookableFlight(flight, 'quote-reschedule');
          const inv = flight.inventories.find(
            (i: any) => i._id.toString() === legDef.inventory_id || i.id === legDef.inventory_id,
          );
          if (!inv) throw new NotFoundException(`Return inventory ${legDef.inventory_id} not found on flight ${flight.flight_number}.`);
          if (inv.available_seats < passengerCount) {
            throw new BadRequestException(
              `Not enough available seats on flight ${flight.flight_number}. Required ${passengerCount}, available ${inv.available_seats}`,
            );
          }
          if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
            throw new BadRequestException(`Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`);
          }
          const dep = new Date(flight.scheduled_departure);
          if (isNaN(dep.getTime()) || dep <= now) {
            throw new BadRequestException(`Flight ${flight.flight_number} departure is invalid or in the past.`);
          }
          returnFlights.push(flight);
          returnInventories.push(inv);

          const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          for (const p of booking.passengers) {
            const pricing = applyPricing(
              inv.base_price,
              daysUntilDep,
              skyMiles,
              (flight as any).pricing_profile_snapshot,
              inventoryLoadFactor(inv.allocated_seats, inv.available_seats),
            );
            let fare = pricing.final_price;
            if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
            if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
            newTotalFare += fare;
          }
        }
        if (returnFlights.length > 1) {
          this.bridge.validateConnectingSequence(returnFlights, 'return');
          this.bridge.validateBookingWindow(returnFlights, 'Return connecting itinerary');
        }
      } else if (dto.new_return_flight_id && dto.new_return_inventory_id) {
        const flight = await this.flightsService.findById(dto.new_return_flight_id);
        if (!flight) throw new NotFoundException(`Return flight ${dto.new_return_flight_id} not found.`);
        this.bridge.assertBookableFlight(flight, 'quote-reschedule');
        const inv = flight.inventories.find(
          (i: any) => i._id.toString() === dto.new_return_inventory_id || i.id === dto.new_return_inventory_id,
        );
        if (!inv) throw new NotFoundException(`Return inventory ${dto.new_return_inventory_id} not found on flight ${flight.flight_number}.`);
        if (inv.available_seats < passengerCount) {
          throw new BadRequestException(
            `Not enough available seats on flight ${flight.flight_number}. Required ${passengerCount}, available ${inv.available_seats}`,
          );
        }
        if (flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.COMPLETED) {
          throw new BadRequestException(`Cannot reschedule to flight ${flight.flight_number}: flight is ${flight.status}.`);
        }
        const dep = new Date(flight.scheduled_departure);
        if (isNaN(dep.getTime()) || dep <= now) {
          throw new BadRequestException(`Flight ${flight.flight_number} departure is invalid or in the past.`);
        }
        returnFlights.push(flight);
        returnInventories.push(inv);
        this.bridge.validateBookingWindow([flight], 'New return flight');

        const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        for (const p of booking.passengers) {
          const pricing = applyPricing(
            inv.base_price,
            daysUntilDep,
            skyMiles,
            (flight as any).pricing_profile_snapshot,
            inventoryLoadFactor(inv.allocated_seats, inv.available_seats),
          );
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;
        }
      }
    } else if (booking.booking_type === BookingType.ROUND_TRIP && isReschedulingOutbound) {
      // Inbound is NOT rescheduled: retain existing inbound coupons fare and seat fees!
      const inboundCoupons = activeCoupons.filter((c: any) => isInbound(c.leg_type));
      for (const c of inboundCoupons) {
        newTotalFare += (c.fare_paid || 0);
        newTotalSeatFees += (c.seat_fee || 0);
      }
    }

    // Compare the full journey endpoints, not only the first flight of a connection.
    const oldOutboundCoupons = activeCoupons.filter((c: any) => isOutbound(c.leg_type));
    const oldReturnCoupons = activeCoupons.filter((c: any) => isInbound(c.leg_type));
    const oldOutbound = await this.bridge.loadDistinctCouponFlights(
      oldOutboundCoupons.length ? oldOutboundCoupons : activeCoupons,
    );
    const oldReturn = booking.booking_type === BookingType.ROUND_TRIP
      ? await this.bridge.loadDistinctCouponFlights(oldReturnCoupons) : [];
    const validateEndpoints = (replacement: FlightDocument[], old: FlightDocument[], direction: string) => {
      if (!replacement.length) return;
      if (!old.length || replacement[0].origin_iata !== old[0].origin_iata ||
          replacement[replacement.length - 1].dest_iata !== old[old.length - 1].dest_iata) {
        throw new BadRequestException(`Replacement ${direction} must retain the original departure and arrival airports.`);
      }
    };
    validateEndpoints(outboundFlights, oldOutbound, 'outbound');
    validateEndpoints(returnFlights, oldReturn, 'return');

    // For partial round-trip changes validate against the retained direction too.
    if (booking.booking_type === BookingType.ROUND_TRIP) {
      const effectiveOutbound = outboundFlights.length ? outboundFlights : oldOutbound;
      const effectiveReturn = returnFlights.length ? returnFlights : oldReturn;
      if (!effectiveOutbound.length || !effectiveReturn.length ||
          !effectiveOutbound[effectiveOutbound.length - 1].scheduled_arrival ||
          new Date(effectiveReturn[0].scheduled_departure) <=
            new Date(effectiveOutbound[effectiveOutbound.length - 1].scheduled_arrival)) {
        throw new BadRequestException('Return flight must depart after the outbound itinerary arrives.');
      }
    }

    validateRescheduleSeatRequests(
      dto.seat_requests,
      [...outboundFlights, ...returnFlights].map((f) => f._id.toString()),
      passengerCount,
    );
    if (this.seatAllocationService && dto.seat_requests && dto.seat_requests.length > 0) {
      const allFlights = [...outboundFlights, ...returnFlights];
      const allInventories = [...outboundInventories, ...returnInventories];
      for (const req of dto.seat_requests) {
        if (req.selection_type === 'CHOOSE' && req.seat_code) {
          const legIdx = allFlights.findIndex(
            (f) => f._id.toString() === req.flight_id || (f as any).id === req.flight_id,
          );
          if (legIdx < 0) {
            throw new BadRequestException(
              `Seat request references flight ${req.flight_id} which is not part of the rescheduled itinerary.`,
            );
          }
          const flight = allFlights[legIdx];
          const inv = allInventories[legIdx];
          const aircraftType = flight.aircraft?.model_code || '';
          if (!aircraftType) {
            throw new BadRequestException(
              `Flight ${flight.flight_number} is missing aircraft model configuration.`,
            );
          }
          await this.seatAllocationService.validateSeatAvailability(
            flight._id,
            req.seat_code,
            aircraftType,
            inv?.cabin_class,
          );
          const fee = await this.seatAllocationService.calculateSeatFee(
            flight._id,
            req.seat_code,
            aircraftType,
            'CHOOSE',
          );
          newTotalSeatFees += fee;
        }
      }
    }

    const newTotal = newTotalFare + newTotalSeatFees;
    const priceDiff = newTotal - oldTotal;

    let presentment: ConvertedPresentmentAmount | undefined = undefined;
    if (this.paypalService && this.paypalService.isPayPalActive()) {
      presentment = this.paypalService.convertVndToPresentment(Math.max(0, priceDiff));
    }

    return {
      price_difference: priceDiff,
      old_total: oldTotal,
      new_total: newTotal,
      new_fare: newTotalFare,
      new_seat_fees: newTotalSeatFees,
      currency: 'VND',
      presentment,
    };
  }

}
