import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingDocument,
  BookingStatus,
  ExternalPaymentProof,
  PassengerType,
  PaymentMethod,
} from './bookings.schema';
import { RescheduleTicketDto } from './bookings.dto';
import { FlightDocument, FlightStatus } from '../flights/flights.schema';
import { applyPricing } from '../common/pricing.util';
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

export class BookingsRescheduleMixedService extends BookingsReschedulePart {
  private readonly logger = new Logger(BookingsRescheduleMixedService.name);

  constructor(deps: BookingsRescheduleDependencies, bridge: BookingsRescheduleBridge) {
    super(deps, bridge);
  }
  async rescheduleMixedRoundTrip(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    outboundCoupons: any[],
    inboundCoupons: any[],
    outboundIsConnecting: boolean,
    returnIsConnecting: boolean,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;
    const refundAllocations: AllocatedRefundItem[] = [];

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
          this.bridge.assertBookableFlight(flight, 'reschedule');
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
        this.bridge.validateBookingWindow(outboundFlights, 'Outbound connecting itinerary');
        this.bridge.validateConnectingSequence(outboundFlights, 'outbound');
        // Validate endpoint match
        const oldOutboundLegs = await this.bridge.loadDistinctCouponFlights(outboundCoupons);
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
        this.bridge.assertBookableFlight(flight, 'reschedule');
        const inventory = flight.inventories.find(
          (inv: any) => inv._id.toString() === dto.new_inventory_id || inv.id === dto.new_inventory_id,
        );
        if (!inventory) throw new NotFoundException('Selected new outbound inventory not found on target flight');
        if (new Date(flight.scheduled_departure) <= new Date()) {
          throw new BadRequestException('New outbound flight departure is in the past.');
        }
        this.bridge.validateBookingWindow(flight, 'New outbound flight');
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
      const existingOutboundFlights = await this.bridge.loadDistinctCouponFlights(outboundCoupons);
      outboundFlights.push(...existingOutboundFlights);
    }

    if (rescheduleReturn) {
      if (returnIsConnecting) {
        for (const legDef of dto.new_return_legs!) {
          const flight = await this.flightsService.findById(legDef.flight_id);
          this.bridge.assertBookableFlight(flight, 'reschedule');
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
        this.bridge.validateBookingWindow(returnFlights, 'Return connecting itinerary');
        this.bridge.validateConnectingSequence(returnFlights, 'return');
        // Validate endpoint match
        const oldReturnLegs = await this.bridge.loadDistinctCouponFlights(inboundCoupons);
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
        this.bridge.assertBookableFlight(flight, 'reschedule');
        const inventory = flight.inventories.find(
          (inv: any) => inv._id.toString() === dto.new_return_inventory_id || inv.id === dto.new_return_inventory_id,
        );
        if (!inventory) throw new NotFoundException('Selected new return inventory not found on target flight');
        if (new Date(flight.scheduled_departure) <= new Date()) {
          throw new BadRequestException('New return flight departure is in the past.');
        }
        this.bridge.validateBookingWindow(flight, 'New return flight');
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
      const existingReturnFlights = await this.bridge.loadDistinctCouponFlights(inboundCoupons);
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
      const oldOutboundFlights = await this.bridge.loadDistinctCouponFlights(outboundCoupons);
      const oldMiles = oldOutboundFlights.reduce((s, f) => s + f.distance_miles, 0);
      const newMiles = outboundFlights.reduce((s, f) => s + f.distance_miles, 0);
      outboundMilesDelta = (newMiles - oldMiles) * passengerCount;
    }
    if (rescheduleReturn) {
      const oldReturnFlights = await this.bridge.loadDistinctCouponFlights(inboundCoupons);
      const oldMiles = oldReturnFlights.reduce((s, f) => s + f.distance_miles, 0);
      const newMiles = returnFlights.reduce((s, f) => s + f.distance_miles, 0);
      returnMilesDelta = (newMiles - oldMiles) * passengerCount;
    }
    const milesDiff = outboundMilesDelta + returnMilesDelta;

    // SAGA setup
    const sagaOperationId = this.bridge.generateCode('SAGA-RESCHEDULE');
    let sagaOp: BookingSeatSagaOperationDocument | null = null;
    const oldSeatAllocations: Array<{ flight_id: any; seat_code: string }> = [];
    if (rescheduleOutbound) {
      for (const c of outboundCoupons) {
        if (c.seat_code && c.flight_id) {
          oldSeatAllocations.push({ flight_id: c.flight_id, seat_code: c.seat_code });
        }
      }
    }
    if (rescheduleReturn) {
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

    // 4. Reserve ALL new seats before releasing any old seats
    interface ReservedLeg { flight_id: string; inventory_id: string; mutation_key: string }
    const reservedLegs: ReservedLeg[] = [];

    const reserveDirection = async (legs: Array<{ flight_id: string; inventory_id: string }>) => {
      for (const leg of legs) {
        let reserved = false;
        const mutKey = `${sagaOperationId}_${leg.flight_id}_${leg.inventory_id}`;
        if (sagaOp) {
          sagaOp.new_inventory_reservations.push({
            flight_id: new Types.ObjectId(leg.flight_id),
            inventory_id: leg.inventory_id,
            seat_count: passengerCount,
            mutation_key: mutKey,
          });
          sagaOp.last_progress_at = new Date();
          await sagaOp.save();
        }
        reservedLegs.push({ ...leg, mutation_key: mutKey });

        try {
          reserved = this.sagaModel
            ? await this.flightsService.reserveSeats(
                leg.flight_id,
                leg.inventory_id,
                passengerCount,
                { operation_id: sagaOperationId, mutation_key: mutKey },
              )
            : await this.flightsService.reserveSeats(leg.flight_id, leg.inventory_id, passengerCount);
        } catch (error) {
          // Rollback all previously reserved new legs
          let allCompensated = true;
          for (const r of reservedLegs) {
            if (this.sagaModel) {
              try {
                const ok = await this.flightsService.compensateInventoryReservation(
                  r.flight_id, r.inventory_id, r.mutation_key, passengerCount,
                );
                if (!ok) allCompensated = false;
              } catch (compErr) {
                allCompensated = false;
                this.logger.error(`Failed to compensate reservation in reschedule error: ${compErr}`);
              }
            } else {
              try { await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount); } catch (_) {}
            }
          }
          if (sagaOp) {
            if (allCompensated) {
              sagaOp.state = SagaState.ABORTED;
              sagaOp.aborted_at = new Date();
            } else {
              sagaOp.last_progress_at = new Date();
              this.logger.warn(`Saga ${sagaOperationId} reservation failure compensation incomplete. Leaving PRECOMMIT for scheduler retry.`);
            }
            await sagaOp.save().catch(() => {});
          }
          throw error;
        }
        if (!reserved) {
          let allCompensated = true;
          for (const r of reservedLegs) {
            if (this.sagaModel) {
              try {
                const ok = await this.flightsService.compensateInventoryReservation(
                  r.flight_id, r.inventory_id, r.mutation_key, passengerCount,
                );
                if (!ok) allCompensated = false;
              } catch (compErr) {
                allCompensated = false;
                this.logger.error(`Failed to compensate reservation in reschedule: ${compErr}`);
              }
            } else {
              try { await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount); } catch (_) {}
            }
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
          const f = await this.flightsService.findById(leg.flight_id);
          throw new BadRequestException(`Not enough seats on flight ${f.flight_number}. All reservations rolled back.`);
        }
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

    let skyMilesAdjusted = false;
    let originalUserSkyMiles = 0;

    try {
      // NOTE: Per SAGA Order Invariant, old inventory is NOT released here prior to commit!

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
            newOutboundCoupons.push(this.bridge.buildCouponWithFare(p, fl, inv, legType, fare));
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
            newReturnCoupons.push(this.bridge.buildCouponWithFare(p, fl, inv, legType, fare));
          }
        }
      } else {
        newTotalFare += inboundCoupons.reduce((sum, c) => sum + (c.fare_paid || 0), 0);
        newReturnCoupons.push(...inboundCoupons);
      }

      // Physical seat allocations for rescheduled flights
      if (this.seatAllocationService) {
        if (rescheduleOutbound) {
          for (let i = 0; i < outboundFlights.length; i++) {
            const fl = outboundFlights[i];
            const inv = outboundInventories[i];
            const legType = outboundIsConnecting ? `CONNECTING_${i + 1}` : 'OUTBOUND';
            const legCoupons = newOutboundCoupons.filter(c => c.flight_id.toString() === fl._id.toString() && c.leg_type === legType);
            const aircraftType = fl.aircraft?.model_code;
            if (!aircraftType) {
              throw new BadRequestException(
                `Flight ${fl.flight_number} is missing aircraft model configuration.`,
              );
            }

            const outPassRequests = booking.passengers.map((p, idx) => {
              const explicitRequest = dto.seat_requests?.find(
                (r) => r.passenger_index === idx && r.flight_id === fl._id.toString(),
              );
              const selType = explicitRequest?.selection_type || 'AUTO';
              const explicitSeat = selType === 'CHOOSE' && explicitRequest?.seat_code ? explicitRequest.seat_code.trim() : undefined;
              return {
                passenger_name: `${p.first_name} ${p.last_name}`,
                coupon_number: legCoupons[idx]?.coupon_number,
                cabin_class: inv.cabin_class,
                selection_type: selType,
                seat_code: explicitSeat,
                passenger_index: idx,
              };
            });

            const allocResults = await this.seatAllocationService.allocateSeats({
              flight_id: fl._id,
              aircraft_type: aircraftType,
              booking_id: booking._id,
              held_until: new Date(Date.now() + 30 * 60 * 1000),
              saga_operation_id: sagaOperationId,
              passengers: outPassRequests,
            });

            for (let idx = 0; idx < allocResults.length; idx++) {
              const res = allocResults[idx];
              if (legCoupons[idx]) {
                legCoupons[idx].seat_code = res.seat_code;
                legCoupons[idx].seat_selection_type = res.selection_type;
                legCoupons[idx].seat_fee = res.seat_fee;
                legCoupons[idx].seat_pricing_snapshot = res.pricing_snapshot;
              }
              if (sagaOp) {
                sagaOp.new_seat_allocations.push({
                  flight_id: fl._id,
                  seat_code: res.seat_code,
                  coupon_number: res.coupon_number,
                });
              }
            }
          }
        }

        if (rescheduleReturn) {
          for (let i = 0; i < returnFlights.length; i++) {
            const fl = returnFlights[i];
            const inv = returnInventories[i];
            const legType = returnIsConnecting ? `INBOUND_${i + 1}` : 'INBOUND';
            const legCoupons = newReturnCoupons.filter(c => c.flight_id.toString() === fl._id.toString() && c.leg_type === legType);
            const aircraftType = fl.aircraft?.model_code;
            if (!aircraftType) {
              throw new BadRequestException(
                `Flight ${fl.flight_number} is missing aircraft model configuration.`,
              );
            }

            const retPassRequests = booking.passengers.map((p, idx) => {
              const explicitRequest = dto.seat_requests?.find(
                (r) => r.passenger_index === idx && r.flight_id === fl._id.toString(),
              );
              const selType = explicitRequest?.selection_type || 'AUTO';
              const explicitSeat = selType === 'CHOOSE' && explicitRequest?.seat_code ? explicitRequest.seat_code.trim() : undefined;
              return {
                passenger_name: `${p.first_name} ${p.last_name}`,
                coupon_number: legCoupons[idx]?.coupon_number,
                cabin_class: inv.cabin_class,
                selection_type: selType,
                seat_code: explicitSeat,
                passenger_index: idx,
              };
            });

            const allocResults = await this.seatAllocationService.allocateSeats({
              flight_id: fl._id,
              aircraft_type: aircraftType,
              booking_id: booking._id,
              held_until: new Date(Date.now() + 30 * 60 * 1000),
              saga_operation_id: sagaOperationId,
              passengers: retPassRequests,
            });

            for (let idx = 0; idx < allocResults.length; idx++) {
              const res = allocResults[idx];
              if (legCoupons[idx]) {
                legCoupons[idx].seat_code = res.seat_code;
                legCoupons[idx].seat_selection_type = res.selection_type;
                legCoupons[idx].seat_fee = res.seat_fee;
                legCoupons[idx].seat_pricing_snapshot = res.pricing_snapshot;
              }
              if (sagaOp) {
                sagaOp.new_seat_allocations.push({
                  flight_id: fl._id,
                  seat_code: res.seat_code,
                  coupon_number: res.coupon_number,
                });
              }
            }
          }
        }
      }

      // Compute total seat fees and authoritative new total amount
      let newTotalSeatFees = 0;
      for (const c of newOutboundCoupons) {
        newTotalSeatFees += (c.seat_fee || 0);
      }
      for (const c of newReturnCoupons) {
        newTotalSeatFees += (c.seat_fee || 0);
      }

      const newTotalAmount = newTotalFare + newTotalSeatFees;
      const priceDiff = newTotalAmount - booking.total_amount;

      // Financial adjustment
      if (priceDiff > 0) {
        if (dto.payment_method === PaymentMethod.PAYPAL) {
          this.bridge.assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleMixedRoundTrip');
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
            payment_reference: this.bridge.generateCode('REF'),
            amount: refundAmt,
            card_masked: resCard.maskedCard,
            currency: 'VND',
            status: 'SUCCESS',
            created_at: new Date(),
          });
        }
      }

      // SkyMiles adjustment
      if (milesDiff > 0) {
        await this.usersService.addSkyMiles(booking.user_id.toString(), milesDiff);
      } else if (milesDiff < 0) {
        await this.usersService.deductSkyMiles(booking.user_id.toString(), Math.abs(milesDiff));
      }
      skyMilesAdjusted = true;

      const newConfirmationNumber = this.bridge.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalAmount;
      booking.total_fare = newTotalFare;
      booking.total_seat_fees = newTotalSeatFees;
      booking.ticket_coupons = [...newOutboundCoupons, ...newReturnCoupons] as any;
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
      if (rescheduleOutbound) {
        for (const c of outboundCoupons) {
          if (!oldLegsToRestore.some((l) => l.flight_id === c.flight_id.toString() && l.inventory_id === c.inventory_id.toString())) {
            oldLegsToRestore.push({ flight_id: c.flight_id.toString(), inventory_id: c.inventory_id.toString() });
          }
        }
      }
      if (rescheduleReturn) {
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

      const legsMessage = rescheduleOutbound && rescheduleReturn
        ? 'Outbound and return legs' : rescheduleOutbound ? 'Outbound leg' : 'Return leg';
      return {
        booking,
        price_difference: priceDiff,
        message: `${legsMessage} rescheduled successfully. New confirmation number is ${newConfirmationNumber}. Fare difference: ${priceDiff} VND.`,
      };
    } catch (err) {
      if (businessCommitted) {
        this.logger.error(
          `Post-commit error in rescheduleMixedRoundTrip for booking ${booking._id}; leaving in COMMITTED / PENDING_FINALIZATION: ${err}`,
        );
        throw err;
      }

      // Compensating rollback
      let allCompensated = true;

      // A. Release physical allocations by saga_operation_id
      if (this.seatAllocationService && sagaOperationId) {
        try {
          await this.seatAllocationService.releaseAllocationsBySaga(sagaOperationId);
        } catch (allocErr) {
          allCompensated = false;
          this.logger.error(`Failed to release allocations by saga ${sagaOperationId}: ${allocErr}`);
        }
      }

      if (skyMilesAdjusted && milesDiff !== 0) {
        try { await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles); } catch (_) {}
      }

      // B. Compensate inventory reservations
      for (const r of reservedLegs) {
        if (this.sagaModel) {
          try {
            const ok = await this.flightsService.compensateInventoryReservation(r.flight_id, r.inventory_id, r.mutation_key, passengerCount);
            if (!ok) allCompensated = false;
          } catch (compErr) {
            allCompensated = false;
            this.logger.error(`Failed to compensate reservation in reschedule catch: ${compErr}`);
          }
        } else {
          try {
            await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount);
          } catch (_) {}
        }
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



      throw err;
    }
  }

}
