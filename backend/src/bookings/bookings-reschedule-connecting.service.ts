import { BadRequestException, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
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
import { applyPricing, inventoryLoadFactor } from '../common/pricing.util';
import {
  BookingSeatSagaOperationDocument,
  SagaOperationType,
  SagaState,
} from '../seat-allocation/booking-seat-saga-operation.schema';
import { allocateRefundSources, AllocatedRefundItem, assertPayPalRefundAllocations } from './refund-allocation.util';
import {
  BookingsRescheduleBridge,
  BookingsRescheduleDependencies,
  BookingsReschedulePart,
} from './bookings-reschedule.part';

export class BookingsRescheduleConnectingService extends BookingsReschedulePart {
  private readonly logger = new Logger(BookingsRescheduleConnectingService.name);

  constructor(deps: BookingsRescheduleDependencies, bridge: BookingsRescheduleBridge) {
    super(deps, bridge);
  }
  async rescheduleConnectingTicket(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    const passengerCount = booking.passengers.length;
    const oldTotalFare = booking.total_amount;
    const newLegs = dto.new_legs!;
    // Historical RESCHEDULED/CANCELLED coupons must never be restored a second
    // time or used as the original route when rescheduling again.
    const oldCoupons = booking.ticket_coupons
      .filter((coupon: any) => String(coupon.coupon_status || 'ACTIVE').toUpperCase() === 'ACTIVE')
      .map((coupon: any) => ({ ...coupon }));
    if (oldCoupons.length === 0) {
      throw new BadRequestException('Booking has no active ticket coupons to reschedule.');
    }
    const refundAllocations: AllocatedRefundItem[] = [];

    // 1. Load and validate all new flights
    const loadedFlights: FlightDocument[] = [];
    const loadedInventories: any[] = [];

    for (let i = 0; i < newLegs.length; i++) {
      const legDef = newLegs[i];
      const flight = await this.flightsService.findById(legDef.flight_id);
      this.bridge.assertBookableFlight(flight, 'reschedule');
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
    this.bridge.validateBookingWindow(loadedFlights, 'Connecting itinerary');

    // 2. Validate the complete itinerary and keep the original journey endpoints.
    this.bridge.validateConnectingFlights(loadedFlights);
    const oldLegs = await this.bridge.loadDistinctCouponFlights(oldCoupons);
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
    const sagaOperationId = this.bridge.generateCode('SAGA-RESCHEDULE');
    let sagaOp: BookingSeatSagaOperationDocument | null = null;
    const oldSeatAllocations: Array<{ flight_id: any; seat_code: string }> = [];
    for (const c of oldCoupons) {
      if (c.seat_code && c.flight_id) {
        oldSeatAllocations.push({ flight_id: c.flight_id, seat_code: c.seat_code });
      }
    }

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

    const reservedLegs: Array<typeof newLegs[number] & { mutation_key: string }> = [];
    for (const legDef of newLegs) {
      let reserved = false;
      const mutKey = `${sagaOperationId}_${legDef.flight_id}_${legDef.inventory_id}`;

      // Persist intended journal entry BEFORE atomic mutation so scheduler always discovers it
      if (sagaOp) {
        sagaOp.new_inventory_reservations.push({
          flight_id: new Types.ObjectId(legDef.flight_id),
          inventory_id: legDef.inventory_id,
          seat_count: passengerCount,
          mutation_key: mutKey,
        });
        sagaOp.last_progress_at = new Date();
        await sagaOp.save().catch(() => {});
      }

      // Include an uncertain in-flight reservation in Saga compensation.
      // The marker makes compensation safe even if the reservation never applied.
      if (this.sagaModel) reservedLegs.push({ ...legDef, mutation_key: mutKey });

      try {
        reserved = this.sagaModel
          ? await this.flightsService.reserveSeats(
              legDef.flight_id,
              legDef.inventory_id,
              passengerCount,
              { operation_id: sagaOperationId, mutation_key: mutKey },
            )
          : await this.flightsService.reserveSeats(
              legDef.flight_id,
              legDef.inventory_id,
              passengerCount,
            );
      } catch (error) {
        let allCompensated = true;
        for (const reservedLeg of reservedLegs) {
          if (this.sagaModel) {
            try {
              const ok = await this.flightsService.compensateInventoryReservation(
                reservedLeg.flight_id,
                reservedLeg.inventory_id,
                reservedLeg.mutation_key,
                passengerCount,
              );
              if (!ok) allCompensated = false;
            } catch (compErr) {
              allCompensated = false;
              this.logger.error(`Failed to compensate reservation in reschedule error: ${compErr}`);
            }
          } else {
            try {
              await this.flightsService.updateAvailableSeats(
                reservedLeg.flight_id,
                reservedLeg.inventory_id,
                passengerCount,
              );
            } catch (_) {}
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
        // Rollback already reserved new legs
        let allCompensated = true;
        for (const r of reservedLegs) {
          if (this.sagaModel) {
            try {
              const ok = await this.flightsService.compensateInventoryReservation(
                r.flight_id,
                r.inventory_id,
                r.mutation_key,
                passengerCount,
              );
              if (!ok) allCompensated = false;
            } catch (compErr) {
              allCompensated = false;
              this.logger.error(`Failed to compensate reservation in reschedule: ${compErr}`);
            }
          } else {
            try {
              await this.flightsService.updateAvailableSeats(r.flight_id, r.inventory_id, +passengerCount);
            } catch (_) {}
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
        const f = await this.flightsService.findById(legDef.flight_id);
        throw new BadRequestException(
          `Not enough available seats on flight ${f.flight_number}. Reschedule cancelled and no seats were modified.`,
        );
      }
      // A non-Saga reservation must have succeeded before it can be released.
      if (!this.sagaModel) reservedLegs.push({ ...legDef, mutation_key: mutKey });
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

    let skyMilesAdjusted = false;
    let milesDiff = 0;
    let originalUserSkyMiles = 0;
    let businessCommitted = false;

    try {
      // NOTE: Per SAGA Order Invariant, old inventory is NOT released here prior to commit!

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
        const pricing = applyPricing(
          inv.base_price,
          daysUntil,
          user.sky_miles || 0,
          (fl as any).pricing_profile_snapshot,
          inventoryLoadFactor(inv.allocated_seats, inv.available_seats),
        );

        newTotalMiles += fl.distance_miles * passengerCount;

        for (const p of booking.passengers) {
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;

          newCoupons.push({
            coupon_number: this.bridge.generateCode('CPN'),
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

      // Physical seat allocations for connecting flights
      if (this.seatAllocationService) {
        for (let i = 0; i < loadedFlights.length; i++) {
          const fl = loadedFlights[i];
          const inv = loadedInventories[i];
          const legType = `CONNECTING_${i + 1}`;
          const legCoupons = newCoupons.filter(c => c.flight_id.toString() === fl._id.toString() && c.leg_type === legType);
          const aircraftType = fl.aircraft?.model_code;
          if (!aircraftType) {
            throw new BadRequestException(
              `Flight ${fl.flight_number} is missing aircraft model configuration.`,
            );
          }

          const connPassRequests = booking.passengers.map((p, idx) => {
            const explicitRequest = dto.seat_requests?.find(
              (r) => r.passenger_index === idx && r.flight_id === fl._id.toString(),
            );
            const selType = explicitRequest?.selection_type || 'AUTO';
            const explicitSeat = selType === 'CHOOSE' && explicitRequest?.seat_code ? explicitRequest.seat_code.trim() : undefined;
            return {
              passenger_name: `${p.first_name} ${p.last_name}`,
              passenger_index: idx,
              coupon_number: legCoupons[idx]?.coupon_number,
              cabin_class: inv.cabin_class,
              selection_type: selType,
              seat_code: explicitSeat,
            };
          });

          const allocResults = await this.seatAllocationService.allocateSeats({
            flight_id: fl._id,
            aircraft_type: aircraftType,
            booking_id: booking._id,
            held_until: new Date(Date.now() + 30 * 60 * 1000),
            saga_operation_id: sagaOperationId,
            passengers: connPassRequests,
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

      let newTotalSeatFees = 0;
      for (const c of newCoupons) {
        newTotalSeatFees += (c.seat_fee || 0);
      }

      const newTotalAmount = newTotalFare + newTotalSeatFees;
      const priceDiff = newTotalAmount - booking.total_amount;

      if (priceDiff > 0) {
        if (dto.payment_method === PaymentMethod.PAYPAL) {
          this.bridge.assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleConnectingTicket');
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
          if (!dto.payment_method) {
            throw new BadRequestException('Payment method is required for reschedule fare difference.');
          }
          if (dto.payment_method === PaymentMethod.PROFILE_CARD) {
            throw new BadRequestException('Saved card payments are no longer supported. Complete PayPal checkout.');
          }
          throw new BadRequestException('A PayPal payment is required for the reschedule fare difference.');
        }
      } else if (priceDiff < 0) {
        const refundAmt = Math.abs(priceDiff);
        const allocations = allocateRefundSources(
          booking.payment_transactions || [],
          refundAmt,
          'RESCHEDULE_REFUND',
          (p) => this.bridge.generateCode(p),
        );
        assertPayPalRefundAllocations(allocations, refundAmt);
        if (!this.paypalService?.isPayPalActive()) {
          throw new BadRequestException('PayPal refunds are unavailable. Please contact support before rescheduling.');
        }
        for (const alloc of allocations) {
            refundAllocations.push(alloc);
            booking.payment_transactions.push({
              transaction_type: alloc.transaction_type,
              payment_reference: alloc.payment_reference,
              source_payment_reference: alloc.source_payment_reference,
              payment_method: alloc.payment_method,
              payment_provider: 'PAYPAL',
              amount: alloc.amount,
              currency: alloc.currency,
              card_masked: alloc.card_masked,
              provider_capture_id: alloc.provider_capture_id,
              provider_order_id: alloc.provider_order_id,
              provider_amount: alloc.provider_amount,
              provider_currency: alloc.provider_currency,
              exchange_rate_vnd_per_unit: alloc.exchange_rate_vnd_per_unit,
              status: alloc.status,
              next_retry_at: alloc.status === 'PENDING' ? new Date() : undefined,
              created_at: new Date(),
            });
        }
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

      const newConfirmationNumber = this.bridge.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalAmount;
      booking.total_fare = newTotalFare;
      booking.total_seat_fees = newTotalSeatFees;
      booking.ticket_coupons = newCoupons;
      booking.total_miles_accrued = newTotalMiles;
      booking.seat_saga_commit = {
        operation_id: sagaOperationId,
        operation_type: 'RESCHEDULE',
        status: 'PENDING_FINALIZATION',
        committed_at: new Date(),
      };

      // Derive and pre-register old_inventory_restorations in sagaOp BEFORE booking.save()
      const oldLegsToRestore: Array<{ flight_id: string; inventory_id: string }> = [];
      for (const c of oldCoupons) {
        if (!oldLegsToRestore.some((l) => l.flight_id === c.flight_id.toString() && l.inventory_id === c.inventory_id.toString())) {
          oldLegsToRestore.push({ flight_id: c.flight_id.toString(), inventory_id: c.inventory_id.toString() });
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
        try {
          await this.bridge.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
        } catch (refundError) {
          this.logger.error(`Post-commit refund dispatch failed for ${booking.pnr_code}: ${refundError}`);
        }
      }

      const diffMsg =
        priceDiff > 0
          ? ` Thu thêm: ${priceDiff.toLocaleString()} VND.`
          : priceDiff < 0
          ? ` Đã yêu cầu hoàn qua PayPal: ${Math.abs(priceDiff).toLocaleString()} VND. Vui lòng theo dõi trạng thái hoàn tiền.`
          : ' Không phát sinh chênh lệch giá.';

      return {
        booking,
        price_difference: priceDiff,
        message: `Đổi vé nối chuyến thành công. Mã xác nhận mới: ${newConfirmationNumber}.${diffMsg}`,
      };
    } catch (err) {
      if (businessCommitted) {
        this.logger.error(
          `Post-commit error in rescheduleConnectingTicket for booking ${booking._id}; leaving in COMMITTED / PENDING_FINALIZATION: ${err}`,
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

      if (skyMilesAdjusted) {
        try {
          await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
        } catch (_) {}
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
