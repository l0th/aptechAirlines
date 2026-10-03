import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingDocument,
  BookingStatus,
  BookingType,
  ExternalPaymentProof,
  PassengerType,
  PaymentMethod,
} from './bookings.schema';
import { RescheduleTicketDto } from './bookings.dto';
import { FlightDocument, FlightStatus } from '../flights/flights.schema';
import { applyPricing, inventoryLoadFactor } from '../common/pricing.util';
import {
  BookingSeatSagaOperationDocument,
  SagaOperationType,
  SagaState,
} from '../seat-allocation/booking-seat-saga-operation.schema';
import { allocateRefundSources, AllocatedRefundItem } from './refund-allocation.util';
import {
  BookingsRescheduleBridge,
  BookingsRescheduleDependencies,
  BookingsReschedulePart,
} from './bookings-reschedule.part';

export class BookingsRescheduleDirectService extends BookingsReschedulePart {
  private readonly logger = new Logger(BookingsRescheduleDirectService.name);

  constructor(deps: BookingsRescheduleDependencies, bridge: BookingsRescheduleBridge) {
    super(deps, bridge);
  }
  async rescheduleTicket(
    dto: RescheduleTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<{
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
      return this.bridge.rescheduleConnectingTicket(booking, dto, externalPaymentProof);
    }

    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;

    // Direction-aware coupon grouping for mixed ROUND_TRIP bookings
    // Normalize leg types to handle legacy CONNECTING_LEG_X / INBOUND_LEG_X values
    const isOutboundLeg = (lt: string): boolean => {
      const t = this.bridge.normalizeLegType(lt);
      return t === 'OUTBOUND' || /^CONNECTING_\d+$/.test(t);
    };
    const isInboundLeg = (lt: string): boolean => {
      const t = this.bridge.normalizeLegType(lt);
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

    const outboundHasConnectingType = outboundCoupons.some((c) => /^CONNECTING_\d+$/.test(this.bridge.normalizeLegType(c.leg_type)));
    const returnHasInboundNType = inboundCoupons.some((c) => /^INBOUND_\d+$/.test(this.bridge.normalizeLegType(c.leg_type)));

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
      return this.bridge.rescheduleMixedRoundTrip(
        booking, dto, outboundCoupons, inboundCoupons,
        outboundIsConnecting, returnIsConnecting, externalPaymentProof,
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
    this.bridge.assertBookableFlight(newFlight, 'reschedule');
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
    this.bridge.validateBookingWindow(newFlight, 'New outbound flight');

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
      this.bridge.assertBookableFlight(newReturnFlight, 'reschedule');
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
      this.bridge.validateBookingWindow(newReturnFlight, 'New return flight');

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

    // SAGA setup
    const sagaOperationId = this.bridge.generateCode('SAGA-RESCHEDULE');
    const refundAllocations: AllocatedRefundItem[] = [];
    let sagaOp: BookingSeatSagaOperationDocument | null = null;
    const oldSeatAllocations: Array<{ flight_id: any; seat_code: string }> = [];
    for (const c of outboundCoupons) {
      if (c.seat_code && c.flight_id) {
        oldSeatAllocations.push({ flight_id: c.flight_id, seat_code: c.seat_code });
      }
    }
    if (shouldRescheduleReturn) {
      for (const c of inboundCoupons) {
        if (c.seat_code && c.flight_id) {
          oldSeatAllocations.push({ flight_id: c.flight_id, seat_code: c.seat_code });
        }
      }
    }

    let businessCommitted = false;
    if (this.sagaModel) {
      try {
        sagaOp = new this.sagaModel({
          operation_id: sagaOperationId,
          operation_type: SagaOperationType.RESCHEDULE,
          booking_id: booking._id,
          state: SagaState.PRECOMMIT,
          new_inventory_reservations: [],
          old_inventory_restorations: [],
          new_seat_allocations: [],
          old_seat_allocations: oldSeatAllocations.map((s) => ({
            flight_id: new Types.ObjectId(s.flight_id),
            seat_code: s.seat_code,
          })),
          last_progress_at: new Date(),
        });
        await sagaOp.save();
      } catch (_) {}
    }

    // ===== §2 RESERVE NEW SEATS (atomic, before any release) =====
    const reservedLegs: Array<{ flight_id: string; inventory_id: string; mutation_key: string }> = [];

    const outMutationKey = `${sagaOperationId}_${dto.new_flight_id}_${dto.new_inventory_id}`;
    if (sagaOp) {
      sagaOp.new_inventory_reservations.push({
        flight_id: new Types.ObjectId(dto.new_flight_id),
        inventory_id: dto.new_inventory_id,
        seat_count: passengerCount,
        mutation_key: outMutationKey,
      });
      sagaOp.last_progress_at = new Date();
      await sagaOp.save();
    }

    const outboundReserved = this.sagaModel
      ? await this.flightsService.reserveSeats(
          dto.new_flight_id,
          dto.new_inventory_id,
          passengerCount,
          { operation_id: sagaOperationId, mutation_key: outMutationKey },
        )
      : await this.flightsService.reserveSeats(
          dto.new_flight_id,
          dto.new_inventory_id,
          passengerCount,
        );

    if (!outboundReserved) {
      if (sagaOp) {
        sagaOp.state = SagaState.ABORTED;
        sagaOp.aborted_at = new Date();
        await sagaOp.save().catch(() => {});
      }
      throw new BadRequestException(
        `Not enough seats on new flight ${newFlight.flight_number}.`,
      );
    }
    reservedLegs.push({ flight_id: dto.new_flight_id, inventory_id: dto.new_inventory_id, mutation_key: outMutationKey });

    if (shouldRescheduleReturn) {
      const retMutationKey = `${sagaOperationId}_${dto.new_return_flight_id}_${dto.new_return_inventory_id}`;
      if (sagaOp) {
        sagaOp.new_inventory_reservations.push({
          flight_id: new Types.ObjectId(dto.new_return_flight_id!),
          inventory_id: dto.new_return_inventory_id!,
          seat_count: passengerCount,
          mutation_key: retMutationKey,
        });
        sagaOp.last_progress_at = new Date();
        await sagaOp.save();
      }

      let returnReserved = false;
      try {
        returnReserved = this.sagaModel
          ? await this.flightsService.reserveSeats(
              dto.new_return_flight_id!,
              dto.new_return_inventory_id!,
              passengerCount,
              { operation_id: sagaOperationId, mutation_key: retMutationKey },
            )
          : await this.flightsService.reserveSeats(
              dto.new_return_flight_id!,
              dto.new_return_inventory_id!,
              passengerCount,
            );
      } catch (err) {
        // Rollback outbound reservation on error
        let allCompensated = true;
        if (this.sagaModel) {
          try {
            const ok = await this.flightsService.compensateInventoryReservation(
              dto.new_flight_id, dto.new_inventory_id, outMutationKey, passengerCount,
            );
            if (!ok) allCompensated = false;
          } catch (compErr) {
            allCompensated = false;
            this.logger.error(`Failed to compensate outbound reservation in reschedule error: ${compErr}`);
          }
        } else {
          await this.flightsService.updateAvailableSeats(
            dto.new_flight_id, dto.new_inventory_id, +passengerCount,
          ).catch(() => {});
        }
        if (sagaOp) {
          if (allCompensated) {
            sagaOp.state = SagaState.ABORTED;
            sagaOp.aborted_at = new Date();
          } else {
            sagaOp.last_progress_at = new Date();
            this.logger.warn(`Saga ${sagaOperationId} return error compensation incomplete. Leaving PRECOMMIT for scheduler retry.`);
          }
          await sagaOp.save().catch(() => {});
        }
        throw err;
      }

      if (!returnReserved) {
        // Rollback outbound reservation
        let allCompensated = true;
        if (this.sagaModel) {
          try {
            const ok = await this.flightsService.compensateInventoryReservation(
              dto.new_flight_id, dto.new_inventory_id, outMutationKey, passengerCount,
            );
            if (!ok) allCompensated = false;
          } catch (compErr) {
            allCompensated = false;
            this.logger.error(`Failed to compensate outbound reservation in reschedule: ${compErr}`);
          }
        } else {
          await this.flightsService.updateAvailableSeats(
            dto.new_flight_id, dto.new_inventory_id, +passengerCount,
          ).catch(() => {});
        }
        if (sagaOp) {
          if (allCompensated) {
            sagaOp.state = SagaState.ABORTED;
            sagaOp.aborted_at = new Date();
          } else {
            sagaOp.last_progress_at = new Date();
            this.logger.warn(`Saga ${sagaOperationId} compensation incomplete. Leaving PRECOMMIT for scheduler retry.`);
          }
          await sagaOp.save().catch(() => {});
        }
        throw new BadRequestException(
          `Not enough seats on new return flight ${newReturnFlight!.flight_number}. Outbound reservation rolled back.`,
        );
      }
      reservedLegs.push({ flight_id: dto.new_return_flight_id!, inventory_id: dto.new_return_inventory_id!, mutation_key: retMutationKey });
    }

    // ===== §2 MUTATING PHASE: try/catch with compensating rollback =====
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
      // NOTE: Per SAGA Order Invariant, old inventory is NOT released here prior to commit!

      // ===== §4 PRICING using applyPricing() =====
      const user = await this.usersService.findById(booking.user_id.toString());
      originalUserSkyMiles = user.sky_miles || 0;
      const now = new Date();

      const outDaysUntil = Math.max(0,
        (new Date(newFlight.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const outPricing = applyPricing(
        newInventory.base_price,
        outDaysUntil,
        user.sky_miles || 0,
        (newFlight as any).pricing_profile_snapshot,
        inventoryLoadFactor(newInventory.allocated_seats, newInventory.available_seats),
      );

      let newTotalFare = 0;
      const newOutboundCoupons = booking.passengers.map((p) => {
        let fare = outPricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(outPricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(outPricing.final_price * 0.85);
        newTotalFare += fare;
        return this.bridge.buildCouponWithFare(p, newFlight, newInventory, 'OUTBOUND', fare);
      });

      let newInboundCouponsResult: any[];
      if (shouldRescheduleReturn) {
        const retDaysUntil = Math.max(0,
          (new Date(newReturnFlight!.scheduled_departure).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const retPricing = applyPricing(
          newReturnInventory.base_price,
          retDaysUntil,
          user.sky_miles || 0,
          (newReturnFlight as any)?.pricing_profile_snapshot,
          inventoryLoadFactor(newReturnInventory.allocated_seats, newReturnInventory.available_seats),
        );

        newInboundCouponsResult = booking.passengers.map((p) => {
          let fare = retPricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(retPricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(retPricing.final_price * 0.85);
          newTotalFare += fare;
          return this.bridge.buildCouponWithFare(p, newReturnFlight!, newReturnInventory, 'INBOUND', fare);
        });
      } else {
        newTotalFare += inboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
        newInboundCouponsResult = inboundCoupons;
      }

      // Physical seat allocations for rescheduled flights
      if (this.seatAllocationService) {
        const outAircraftType = newFlight.aircraft?.model_code;
        if (!outAircraftType) {
          throw new BadRequestException(
            `Flight ${newFlight.flight_number} is missing aircraft model configuration.`,
          );
        }

        const outPassRequests = booking.passengers.map((p, idx) => {
          const explicitRequest = dto.seat_requests?.find(
            (r) => r.passenger_index === idx && r.flight_id === newFlight._id.toString(),
          );
          const selType = explicitRequest?.selection_type || 'AUTO';
          const explicitSeat = selType === 'CHOOSE' && explicitRequest?.seat_code ? explicitRequest.seat_code.trim() : undefined;
          return {
            passenger_name: `${p.first_name} ${p.last_name}`,
            coupon_number: newOutboundCoupons[idx].coupon_number,
            cabin_class: newInventory.cabin_class,
            selection_type: selType,
            seat_code: explicitSeat,
            passenger_index: idx,
          };
        });

        const outAllocResults = await this.seatAllocationService.allocateSeats({
          flight_id: newFlight._id,
          aircraft_type: outAircraftType,
          booking_id: booking._id,
          held_until: new Date(Date.now() + 30 * 60 * 1000),
          saga_operation_id: sagaOperationId,
          passengers: outPassRequests,
        });

        for (let idx = 0; idx < outAllocResults.length; idx++) {
          const res = outAllocResults[idx];
          newOutboundCoupons[idx].seat_code = res.seat_code;
          newOutboundCoupons[idx].seat_selection_type = res.selection_type;
          newOutboundCoupons[idx].seat_fee = res.seat_fee;
          newOutboundCoupons[idx].seat_pricing_snapshot = res.pricing_snapshot;
          if (sagaOp) {
            sagaOp.new_seat_allocations.push({
              flight_id: newFlight._id,
              seat_code: res.seat_code,
              coupon_number: res.coupon_number,
            });
          }
        }

        if (shouldRescheduleReturn && newReturnFlight && newReturnInventory) {
          const retAircraftType = newReturnFlight.aircraft?.model_code;
          if (!retAircraftType) {
            throw new BadRequestException(
              `Flight ${newReturnFlight.flight_number} is missing aircraft model configuration.`,
            );
          }

          const retPassRequests = booking.passengers.map((p, idx) => {
            const explicitRequest = dto.seat_requests?.find(
              (r) => r.passenger_index === idx && r.flight_id === newReturnFlight!._id.toString(),
            );
            const selType = explicitRequest?.selection_type || 'AUTO';
            const explicitSeat = selType === 'CHOOSE' && explicitRequest?.seat_code ? explicitRequest.seat_code.trim() : undefined;
            return {
              passenger_name: `${p.first_name} ${p.last_name}`,
              coupon_number: newInboundCouponsResult[idx].coupon_number,
              cabin_class: newReturnInventory.cabin_class,
              selection_type: selType,
              seat_code: explicitSeat,
              passenger_index: idx,
            };
          });

          const retAllocResults = await this.seatAllocationService.allocateSeats({
            flight_id: newReturnFlight._id,
            aircraft_type: retAircraftType,
            booking_id: booking._id,
            held_until: new Date(Date.now() + 30 * 60 * 1000),
            saga_operation_id: sagaOperationId,
            passengers: retPassRequests,
          });

          for (let idx = 0; idx < retAllocResults.length; idx++) {
            const res = retAllocResults[idx];
            newInboundCouponsResult[idx].seat_code = res.seat_code;
            newInboundCouponsResult[idx].seat_selection_type = res.selection_type;
            newInboundCouponsResult[idx].seat_fee = res.seat_fee;
            newInboundCouponsResult[idx].seat_pricing_snapshot = res.pricing_snapshot;
            if (sagaOp) {
              sagaOp.new_seat_allocations.push({
                flight_id: newReturnFlight._id,
                seat_code: res.seat_code,
                coupon_number: res.coupon_number,
              });
            }
          }
        }
      }

      // Compute total seat fees and authoritative new total amount
      let newTotalSeatFees = 0;
      for (const c of newOutboundCoupons) {
        newTotalSeatFees += (c.seat_fee || 0);
      }
      if (shouldRescheduleReturn) {
        for (const c of newInboundCouponsResult) {
          newTotalSeatFees += (c.seat_fee || 0);
        }
      } else {
        for (const c of inboundCoupons) {
          newTotalSeatFees += (c.seat_fee || 0);
        }
      }

      const newTotalAmount = newTotalFare + newTotalSeatFees;
      const priceDiff = newTotalAmount - booking.total_amount;

      // Financial adjustment
      if (priceDiff > 0) {
        if (dto.payment_method === PaymentMethod.PAYPAL) {
          this.bridge.assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleTicket');
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: PaymentMethod.PAYPAL,
            payment_provider: 'PAYPAL',
            payment_reference: externalPaymentProof!.payment_reference || this.bridge.generateCode('PAY'),
            amount: priceDiff,
            currency: 'VND',
            provider_order_id: externalPaymentProof!.provider_order_id,
            provider_capture_id: externalPaymentProof!.provider_capture_id,
            provider_amount: externalPaymentProof!.provider_amount,
            provider_currency: externalPaymentProof!.provider_currency,
            exchange_rate_vnd_per_unit: externalPaymentProof!.exchange_rate_vnd_per_unit,
            status: 'SUCCESS',
            created_at: new Date(),
          });
        } else {
          const resCard = await this.bridge.resolveRescheduleCard(booking, dto.payment_method, true);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: resCard.paymentMethod,
            payment_provider: resCard.paymentMethod === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
            payment_reference: this.bridge.generateCode('PAY'),
            amount: priceDiff,
            card_masked: resCard.maskedCard,
            currency: 'VND',
            status: 'SUCCESS',
            created_at: new Date(),
          });
        }
      } else if (priceDiff < 0) {
        const refundAmt = Math.abs(priceDiff);
        const allocations = allocateRefundSources(
          booking.payment_transactions || [],
          refundAmt,
          'RESCHEDULE_REFUND',
          (p) => this.bridge.generateCode(p),
        );
        if (allocations.length > 0) {
          const placeholders = new Set(['SAVED-CARD', 'CARD-DEFAULT', 'ORIGINAL-PAYMENT-CARD', 'UNKNOWN']);
          for (const alloc of allocations) {
            if (alloc.payment_method !== PaymentMethod.PAYPAL) {
              const rawMasked = (alloc.card_masked || '').trim();
              if (!alloc.payment_method || !rawMasked || placeholders.has(rawMasked.toUpperCase())) {
                const resCard = await this.bridge.resolveRescheduleCard(booking, dto.payment_method, false);
                if (resCard.maskedCard) alloc.card_masked = resCard.maskedCard;
                if (resCard.paymentMethod) alloc.payment_method = resCard.paymentMethod;
              }
            }
            refundAllocations.push(alloc);
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
          const resCard = await this.bridge.resolveRescheduleCard(booking, dto.payment_method, false);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_REFUND',
            payment_method: resCard.paymentMethod,
            payment_provider: resCard.paymentMethod === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
            payment_reference: this.bridge.generateCode('REF'),
            amount: refundAmt,
            card_masked: resCard.maskedCard,
            currency: 'VND',
            status: 'SUCCESS',
            created_at: new Date(),
          });
        }
      }

      // 4. Update SkyMiles delta
      if (milesDiff > 0) {
        await this.usersService.addSkyMiles(booking.user_id.toString(), milesDiff);
      } else if (milesDiff < 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), Math.abs(milesDiff));
      }
      skyMilesAdjusted = true;

      // Update booking
      const newConfirmationNumber = this.bridge.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalAmount;
      booking.total_fare = newTotalFare;
      booking.total_seat_fees = newTotalSeatFees;
      booking.early_bird_percent = outPricing.early_bird_percent;
      booking.early_bird_label = outPricing.early_bird_label;
      booking.early_bird_label_en = outPricing.early_bird_label_en;
      booking.load_factor_percent = outPricing.load_factor_percent;
      booking.load_adjustment_percent = outPricing.load_adjustment_percent;
      booking.load_adjustment_label = outPricing.load_adjustment_label;
      booking.pricing_profile_id = outPricing.pricing_profile_id;
      booking.pricing_profile_name = outPricing.pricing_profile_name;
      booking.ff_tier = outPricing.ff_tier;
      booking.ff_discount_percent = outPricing.ff_percent;
      booking.ticket_coupons = [...newOutboundCoupons, ...newInboundCouponsResult] as any;
      booking.total_miles_accrued = (booking.total_miles_accrued || 0) + milesDiff;
      if (booking.total_miles_accrued < 0) booking.total_miles_accrued = 0;
      booking.seat_saga_commit = {
        operation_id: sagaOperationId,
        operation_type: 'RESCHEDULE',
        status: 'PENDING_FINALIZATION',
        committed_at: new Date(),
      };

      // Derive and pre-register old_inventory_restorations in sagaOp BEFORE booking.save()
      const oldLegsToRestore: Array<{ flight_id: string; inventory_id: string }> = [];
      for (const c of outboundCoupons) {
        if (!oldLegsToRestore.some((l) => l.flight_id === c.flight_id.toString() && l.inventory_id === c.inventory_id.toString())) {
          oldLegsToRestore.push({ flight_id: c.flight_id.toString(), inventory_id: c.inventory_id.toString() });
        }
      }
      if (shouldRescheduleReturn) {
        for (const c of inboundCoupons) {
          if (!oldLegsToRestore.some((l) => l.flight_id === c.flight_id.toString() && l.inventory_id === c.inventory_id.toString())) {
            oldLegsToRestore.push({ flight_id: c.flight_id.toString(), inventory_id: c.inventory_id.toString() });
          }
        }
      }

      if (sagaOp) {
        sagaOp.old_inventory_restorations = oldLegsToRestore.map((leg) => ({
          flight_id: new Types.ObjectId(leg.flight_id),
          inventory_id: leg.inventory_id,
          seat_count: passengerCount,
          mutation_key: `RESTORE_OLD_${sagaOperationId}_${leg.flight_id}_${leg.inventory_id}`,
        }));
        sagaOp.last_progress_at = new Date();
        await sagaOp.save();
      }

      await booking.save();
      businessCommitted = true;

      // Post-commit progression:
      if (sagaOp) {
        sagaOp.state = SagaState.COMMITTED;
        sagaOp.last_progress_at = new Date();
        await sagaOp.save().catch(() => {});
      }

      let postCommitFinalized = true;

      if (this.seatAllocationService) {
        try {
          await this.seatAllocationService.finalizeRescheduleAllocations(
            booking._id,
            sagaOperationId,
            oldSeatAllocations,
          );
        } catch (allocErr) {
          postCommitFinalized = false;
          this.logger.error(`Failed to finalize reschedule allocations for ${sagaOperationId}: ${allocErr}`);
        }
      }

      // Restore OLD inventory via restoreSeatsWithSaga
      const oldRestorations = sagaOp?.old_inventory_restorations?.length
        ? sagaOp.old_inventory_restorations
        : oldLegsToRestore.map((leg) => ({
            flight_id: leg.flight_id,
            inventory_id: leg.inventory_id,
            seat_count: passengerCount,
            mutation_key: `RESTORE_OLD_${sagaOperationId}_${leg.flight_id}_${leg.inventory_id}`,
          }));
      for (const leg of oldRestorations) {
        try {
          const restored = typeof this.flightsService.restoreSeatsWithSaga === 'function'
            ? await this.flightsService.restoreSeatsWithSaga(
                leg.flight_id.toString(),
                leg.inventory_id,
                leg.seat_count,
                { operation_id: sagaOperationId, mutation_key: leg.mutation_key },
              )
            : true;
          if (!restored) {
            postCommitFinalized = false;
            this.logger.error(`Failed to restore old seat capacity for flight ${leg.flight_id}`);
          }
        } catch (restoreErr) {
          postCommitFinalized = false;
          this.logger.error(`Error restoring old seat capacity for flight ${leg.flight_id}: ${restoreErr}`);
        }
      }

      if (postCommitFinalized) {
        let witnessPersisted = false;
        if (typeof this.bookingModel?.updateOne === 'function') {
          try {
            await this.bookingModel.updateOne(
              { _id: booking._id },
              { $set: { 'seat_saga_commit.status': 'COMPLETED' } },
            );
            witnessPersisted = true;
          } catch (witnessErr) {
            this.logger.error(
              `Failed to persist seat_saga_commit.status=COMPLETED witness on booking ${booking._id}: ${witnessErr}. Saga remains COMMITTED for scheduler retry.`,
            );
          }
        } else {
          witnessPersisted = true;
        }

        if (witnessPersisted) {
          booking.seat_saga_commit.status = 'COMPLETED';

          if (sagaOp) {
            sagaOp.state = SagaState.COMPLETED;
            sagaOp.completed_at = new Date();
            await sagaOp.save().catch(() => {});
          }
        }
      }

      if (this.paypalService && refundAllocations.length > 0) {
        await this.bridge.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
      }

      const legsMessage = shouldRescheduleReturn ? 'Outbound and return legs' : 'Outbound leg';
      return {
        booking,
        price_difference: priceDiff,
        message: `${legsMessage} rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} VND.`,
      };
    } catch (err) {
      if (businessCommitted) {
        this.logger.error(
          `Post-commit error in rescheduleTicket for booking ${booking._id}; leaving in COMMITTED / PENDING_FINALIZATION: ${err}`,
        );
        throw err;
      }

      // ===== §2 COMPENSATING ROLLBACK =====
      let allCompensated = true;

      // A. Release NEW physical allocations by saga_operation_id ONLY
      if (this.seatAllocationService && sagaOperationId) {
        try {
          await this.seatAllocationService.releaseAllocationsBySaga(sagaOperationId);
        } catch (allocErr) {
          allCompensated = false;
          this.logger.error(`Failed to release allocations by saga ${sagaOperationId}: ${allocErr}`);
        }
      }

      if (skyMilesAdjusted && milesDiff !== 0) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
        } catch (_) {}
      }

      // B. Roll back reserved NEW inventory
      for (const leg of reservedLegs) {
        if (this.sagaModel) {
          try {
            const ok = await this.flightsService.compensateInventoryReservation(
              leg.flight_id,
              leg.inventory_id,
              leg.mutation_key,
              passengerCount,
            );
            if (!ok) allCompensated = false;
          } catch (compErr) {
            allCompensated = false;
            this.logger.error(`Failed to compensate reservation in reschedule: ${compErr}`);
          }
        } else {
          try {
            await this.flightsService.updateAvailableSeats(
              leg.flight_id,
              leg.inventory_id,
              +passengerCount,
            );
          } catch (_) {}
        }
      }

      // C. Restore in-memory booking state
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

      // D. Transition sagaOp state
      if (sagaOp) {
        if (allCompensated) {
          sagaOp.state = SagaState.ABORTED;
          sagaOp.aborted_at = new Date();
        } else {
          sagaOp.last_progress_at = new Date();
          this.logger.warn(
            `Saga ${sagaOperationId} compensation incomplete. Leaving PRECOMMIT for scheduler retry.`,
          );
        }
        await sagaOp.save().catch(() => {});
      }



      throw err;
    }
  }

}
