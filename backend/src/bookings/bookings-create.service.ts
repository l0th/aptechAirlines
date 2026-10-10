import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingDocument,
  BookingStatus,
  HoldEmailStatus,
  BookingType,
  ExternalPaymentProof,
  PassengerType,
  PaymentMethod,
} from './bookings.schema';
import { CreateBookingDto } from './bookings.dto';
import { FlightDocument, FlightStatus } from '../flights/flights.schema';
import { applyPricing, inventoryLoadFactor } from '../common/pricing.util';
import { deliverHoldCreatedEmail } from './hold-email-delivery';
import {
  BookingSeatSagaOperationDocument,
  SagaOperationType,
  SagaState,
} from '../seat-allocation/booking-seat-saga-operation.schema';
import { BookingsCoreBridge, BookingsCoreDependencies, BookingsCorePart } from './bookings-core.part';
import { findPassengerAgeCategoryMismatch } from './passenger-age.util';

export class BookingsCreateService extends BookingsCorePart {
  private readonly logger = new Logger(BookingsCreateService.name);

  constructor(deps: BookingsCoreDependencies, bridge: BookingsCoreBridge) {
    super(deps, bridge);
  }
  async createBooking(dto: CreateBookingDto, externalPaymentProof?: ExternalPaymentProof): Promise<BookingDocument> {
    const user = await this.usersService.findById(dto.user_id);

    const passengerCount = dto.passengers.length;

    if (passengerCount < 1) {
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
      this.bridge.assertBookableFlight(flight, 'book');
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
      this.bridge.validateConnectingFlights(selectedLegs.map((leg) => leg.flight));
      this.bridge.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Connecting itinerary');
    } else if (dto.booking_type === BookingType.ROUND_TRIP) {
      const { outboundLegs, inboundLegs } = this.bridge.validateRoundTripLegs(selectedLegs);
      this.bridge.validateBookingWindow(outboundLegs.map((leg) => leg.flight), 'Outbound itinerary');
      this.bridge.validateBookingWindow(inboundLegs.map((leg) => leg.flight), 'Return itinerary');
    } else {
      this.bridge.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Flight');
    }

    const firstDepartureLeg = [...selectedLegs].sort(
      (a, b) => new Date(a.flight.scheduled_departure).getTime() - new Date(b.flight.scheduled_departure).getTime(),
    )[0];
    const ageMismatch = findPassengerAgeCategoryMismatch(dto.passengers, firstDepartureLeg.flight.departure_date);
    if (ageMismatch) {
      if (ageMismatch.actual === 'INFANT') {
        throw new BadRequestException(`Passenger ${ageMismatch.index + 1} is under 2 on the departure date; infant fares are not supported.`);
      }
      throw new BadRequestException(
        `Passenger ${ageMismatch.index + 1} is ${ageMismatch.actual} on the departure date, not ${ageMismatch.selected}.`,
      );
    }

    const now = new Date();
    const daysUntilDeparture = (earliestDeparture!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    let totalFare = 0;
    const ticketCoupons: any[] = [];
    let earlyBirdPercent = 0;
    let earlyBirdLabel = '';
    let earlyBirdLabelEn = '';
    let loadFactorPercent = 0;
    let loadAdjustmentPercent = 0;
    let loadAdjustmentLabel = '';
    let pricingProfileId = '';
    let pricingProfileName = '';
    let ffTier = '';
    let ffDiscountPercent = 0;

    for (const { definition: leg, flight, inventory } of selectedLegs) {

      for (const p of dto.passengers) {
        const pricing = applyPricing(
          inventory.base_price,
          daysUntilDeparture,
          user.sky_miles || 0,
          (flight as any).pricing_profile_snapshot,
          inventoryLoadFactor(inventory.allocated_seats, inventory.available_seats),
        );
        earlyBirdPercent = pricing.early_bird_percent;
        earlyBirdLabel = pricing.early_bird_label;
        earlyBirdLabelEn = pricing.early_bird_label_en;
        loadFactorPercent = pricing.load_factor_percent;
        loadAdjustmentPercent = pricing.load_adjustment_percent;
        loadAdjustmentLabel = pricing.load_adjustment_label;
        pricingProfileId = pricing.pricing_profile_id || '';
        pricingProfileName = pricing.pricing_profile_name || '';
        ffTier = pricing.ff_tier;
        ffDiscountPercent = pricing.ff_percent;

        let fare = pricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);

        totalFare += fare;

        const normalizedLeg = this.bridge.normalizeLegType(leg.leg_type);
        ticketCoupons.push({
          coupon_number: this.bridge.generateCode('CPN'),
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

    // Authoritative total payable preflight before any mutation or seat reservations (Fix 7)
    let preflightSeatFees = 0;
    if (this.seatAllocationService) {
      for (const { definition: leg, flight, inventory } of selectedLegs) {
        const normalizedLeg = this.bridge.normalizeLegType(leg.leg_type);
        for (let idx = 0; idx < dto.passengers.length; idx++) {
          const p = dto.passengers[idx];
          const explicitRequest = dto.seat_requests?.find(
            (r) => r.passenger_index === idx && r.flight_id === flight._id.toString(),
          );
          let selType: 'AUTO' | 'CHOOSE';
          let explicitSeat: string | undefined;

          if (explicitRequest) {
            selType = explicitRequest.selection_type;
            explicitSeat = selType === 'CHOOSE' && explicitRequest.seat_code ? explicitRequest.seat_code.trim() : undefined;
          } else {
            const legacySeat =
              (p as any).seat_codes?.[normalizedLeg] ||
              (p as any).seat_codes?.[leg.leg_type || 'OUTBOUND'] ||
              (normalizedLeg === 'OUTBOUND' ? p.seat_code || '' : '');
            selType = legacySeat && legacySeat.trim() ? ('CHOOSE' as const) : ('AUTO' as const);
            explicitSeat = selType === 'CHOOSE' ? legacySeat.trim() : undefined;
          }

          if (selType === 'CHOOSE' && explicitSeat) {
            const aircraftType = flight.aircraft?.model_code;
            if (!aircraftType) {
              throw new BadRequestException(
                `Flight ${flight.flight_number} is missing aircraft model configuration.`,
              );
            }
            await this.seatAllocationService.validateSeatAvailability(
              flight._id,
              explicitSeat,
              aircraftType,
              inventory.cabin_class,
            );
            const fee = await this.seatAllocationService.calculateSeatFee(
              flight._id,
              explicitSeat,
              aircraftType,
              'CHOOSE',
            );
            preflightSeatFees += fee;
          }
        }
      }
    }
    const totalPayable = totalFare + preflightSeatFees;

    // Requirement 3.4.2: If <= 2 weeks, CANNOT block, MUST buy!
    if (dto.is_block) {
      if (daysUntilDeparture <= 14) {
        throw new BadRequestException(
          'Departure is within 2 weeks (14 days). Ticket blocking is not permitted. You must buy the ticket directly.',
        );
      }
    }

    // Purchase payment preflight before any saga creation or seat reservation mutation
    if (!dto.is_block) {
      if (!dto.payment_method) {
        throw new BadRequestException('Payment method is required to purchase tickets.');
      }
      if (dto.payment_method === PaymentMethod.PAYPAL) {
        if (totalPayable > 0) {
          this.bridge.assertPayPalPaymentProof(externalPaymentProof, totalPayable, 'createBooking:preflight');
        }
      } else if (dto.payment_method === PaymentMethod.PROFILE_CARD) {
        throw new BadRequestException('Saved card payments are no longer supported. Complete PayPal checkout.');
      } else {
        throw new BadRequestException('Unsupported payment method.');
      }
    }

    // Pre-generate Booking ObjectId and SAGA Operation
    const pregeneratedBookingId = new Types.ObjectId();
    const sagaOperationId = this.bridge.generateCode('SAGA-CREATE');
    let businessCommitted = false;

    let sagaOp: BookingSeatSagaOperationDocument | null = null;
    if (this.sagaModel) {
      sagaOp = new this.sagaModel({
        operation_id: sagaOperationId,
        operation_type: SagaOperationType.CREATE,
        booking_id: pregeneratedBookingId,
        state: SagaState.PRECOMMIT,
        new_inventory_reservations: [],
        new_seat_allocations: [],
        last_progress_at: new Date(),
      });
      await sagaOp.save();
    }

    // Decrement seats on all flight inventories (atomic with SAGA tracking)
    const reservedLegs: Array<{ flight_id: string; inventory_id: string; mutation_key: string }> = [];
    for (const leg of dto.legs) {
      const mutationKey = `${sagaOperationId}_${leg.flight_id}_${leg.inventory_id}`;
      // SAGA JOURNAL CRASH GAP FIX: Persist intended journal entry BEFORE executing atomic Flight mutation
      if (sagaOp) {
        sagaOp.new_inventory_reservations.push({
          flight_id: new Types.ObjectId(leg.flight_id),
          inventory_id: leg.inventory_id,
          seat_count: passengerCount,
          mutation_key: mutationKey,
        });
        sagaOp.last_progress_at = new Date();
        await sagaOp.save();
      }
      reservedLegs.push({ flight_id: leg.flight_id, inventory_id: leg.inventory_id, mutation_key: mutationKey });

      let reserved = false;
      try {
        if (this.sagaModel) {
          reserved = await this.flightsService.reserveSeats(
            leg.flight_id,
            leg.inventory_id,
            passengerCount,
            { operation_id: sagaOperationId, mutation_key: mutationKey },
          );
        } else {
          reserved = await this.flightsService.reserveSeats(
            leg.flight_id,
            leg.inventory_id,
            passengerCount,
          );
        }
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
              this.logger.error(`Failed to compensate reservation for flight ${reservedLeg.flight_id}: ${compErr}`);
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
            await sagaOp.save().catch(() => {});
          } else {
            sagaOp.last_progress_at = new Date();
            await sagaOp.save().catch(() => {});
            this.logger.warn(`Saga ${sagaOperationId} compensation incomplete; leaving in PRECOMMIT for scheduler retry.`);
          }
        }
        throw error;
      }
      if (!reserved) {
        // Rollback already reserved legs using compensateInventoryReservation for SAGA
        let allCompensated = true;
        for (const rLeg of reservedLegs) {
          if (this.sagaModel) {
            try {
              const ok = await this.flightsService.compensateInventoryReservation(
                rLeg.flight_id,
                rLeg.inventory_id,
                rLeg.mutation_key,
                passengerCount,
              );
              if (!ok) allCompensated = false;
            } catch (compErr) {
              allCompensated = false;
              this.logger.error(`Failed to compensate reservation for flight ${rLeg.flight_id}: ${compErr}`);
            }
          } else {
            try {
              await this.flightsService.updateAvailableSeats(
                rLeg.flight_id,
                rLeg.inventory_id,
                passengerCount,
              );
            } catch (_) {}
          }
        }
        if (sagaOp) {
          if (allCompensated) {
            sagaOp.state = SagaState.ABORTED;
            sagaOp.aborted_at = new Date();
            await sagaOp.save().catch(() => {});
          } else {
            sagaOp.last_progress_at = new Date();
            await sagaOp.save().catch(() => {});
            this.logger.warn(`Saga ${sagaOperationId} compensation incomplete; leaving in PRECOMMIT for scheduler retry.`);
          }
        }
        const flight = await this.flightsService.findById(leg.flight_id);
        throw new BadRequestException(`Not enough available seats on flight ${flight.flight_number}`);
      }
    }

    // Allocate physical seats (Phase B)
    let totalSeatFees = 0;
    if (this.seatAllocationService) {
      try {
        for (const { definition: leg, flight, inventory } of selectedLegs) {
          const normalizedLeg = this.bridge.normalizeLegType(leg.leg_type);
          const legCoupons = ticketCoupons.filter(
            (c) => c.flight_id.toString() === flight._id.toString() && c.leg_type === normalizedLeg,
          );

          const passRequests = dto.passengers.map((p, idx) => {
            const coupon = legCoupons[idx];
            const explicitRequest = dto.seat_requests?.find(
              (r) => r.passenger_index === idx && r.flight_id === flight._id.toString(),
            );

            let selType: 'AUTO' | 'CHOOSE';
            let explicitSeat: string | undefined;

            if (explicitRequest) {
              selType = explicitRequest.selection_type;
              explicitSeat = selType === 'CHOOSE' && explicitRequest.seat_code ? explicitRequest.seat_code.trim() : undefined;
            } else {
              const legacySeat =
                (p as any).seat_codes?.[normalizedLeg] ||
                (p as any).seat_codes?.[leg.leg_type || 'OUTBOUND'] ||
                (normalizedLeg === 'OUTBOUND' ? p.seat_code || '' : '');
              selType = legacySeat && legacySeat.trim() ? ('CHOOSE' as const) : ('AUTO' as const);
              explicitSeat = selType === 'CHOOSE' ? legacySeat.trim() : undefined;
            }

            return {
              passenger_name: `${p.first_name} ${p.last_name}`,
              coupon_number: coupon.coupon_number,
              cabin_class: inventory.cabin_class,
              selection_type: selType,
              seat_code: explicitSeat,
              passenger_index: idx,
            };
          });

          const aircraftType = flight.aircraft?.model_code;
          if (!aircraftType) {
            throw new BadRequestException(
              `Flight ${flight.flight_number} is missing aircraft model configuration.`,
            );
          }
          const heldUntil = dto.is_block
            ? new Date(earliestDeparture!.getTime() - 14 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 30 * 60 * 1000);

          const allocResults = await this.seatAllocationService.allocateSeats({
            flight_id: flight._id,
            aircraft_type: aircraftType,
            booking_id: pregeneratedBookingId,
            held_until: heldUntil,
            saga_operation_id: sagaOperationId,
            passengers: passRequests,
          });

          for (const res of allocResults) {
            const matchingCoupon = legCoupons.find((c) => c.coupon_number === res.coupon_number);
            if (matchingCoupon) {
              matchingCoupon.seat_code = res.seat_code;
              matchingCoupon.seat_selection_type = res.selection_type;
              matchingCoupon.seat_fee = res.seat_fee;
              matchingCoupon.seat_pricing_snapshot = res.pricing_snapshot;
            }
            totalSeatFees += res.seat_fee;
            if (sagaOp) {
              sagaOp.new_seat_allocations.push({
                flight_id: flight._id,
                seat_code: res.seat_code,
                coupon_number: res.coupon_number,
              });
            }
          }
        }
        if (sagaOp) {
          sagaOp.last_progress_at = new Date();
          await sagaOp.save().catch(() => {});
        }
      } catch (allocErr) {
        let allCompensated = true;
        if (this.seatAllocationService && sagaOperationId) {
          try {
            await this.seatAllocationService.releaseAllocationsBySaga(sagaOperationId);
          } catch (relErr) {
            allCompensated = false;
            this.logger.error(`Failed to release allocations by saga ${sagaOperationId}: ${relErr}`);
          }
        }
        for (const rLeg of reservedLegs) {
          if (this.sagaModel) {
            try {
              const ok = await this.flightsService.compensateInventoryReservation(
                rLeg.flight_id,
                rLeg.inventory_id,
                rLeg.mutation_key,
                passengerCount,
              );
              if (!ok) allCompensated = false;
            } catch (compErr) {
              allCompensated = false;
              this.logger.error(`Failed to compensate reservation for flight ${rLeg.flight_id}: ${compErr}`);
            }
          } else {
            try {
              await this.flightsService.updateAvailableSeats(
                rLeg.flight_id,
                rLeg.inventory_id,
                passengerCount,
              );
            } catch (_) {}
          }
        }
        if (sagaOp) {
          if (allCompensated) {
            sagaOp.state = SagaState.ABORTED;
            sagaOp.aborted_at = new Date();
            await sagaOp.save().catch(() => {});
          } else {
            sagaOp.last_progress_at = new Date();
            await sagaOp.save().catch(() => {});
            this.logger.warn(`Saga ${sagaOperationId} compensation incomplete; leaving in PRECOMMIT for scheduler retry.`);
          }
        }
        throw allocErr;
      }
    }

    const originalSkyMiles = user.sky_miles || 0;
    let skyMilesCredited = false;
    const totalAmount = totalFare + totalSeatFees;
    let pnrCode = '';

    try {
      pnrCode = this.bridge.generateCode('PNR');
      let status = BookingStatus.CONFIRMED;
      let blockingNumber: string | undefined = undefined;
      let confirmationNumber: string | undefined = undefined;
      let deadline: Date | undefined = undefined;
      const paymentTransactions: any[] = [];

      if (dto.is_block) {
        status = BookingStatus.BLOCKED;
        blockingNumber = this.bridge.generateCode('BLK');
        deadline = new Date(earliestDeparture!.getTime() - 14 * 24 * 60 * 60 * 1000);
      } else {
        confirmationNumber = this.bridge.generateCode('CNF');
        if (dto.payment_method === PaymentMethod.PAYPAL) {
          if (totalAmount === 0) {
            paymentTransactions.push({
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
            this.bridge.assertPayPalPaymentProof(externalPaymentProof, totalAmount, 'createBooking:post-allocation');
            paymentTransactions.push({
              transaction_type: 'PAYMENT',
              payment_method: PaymentMethod.PAYPAL,
              payment_provider: 'PAYPAL',
              payment_reference: externalPaymentProof!.payment_reference || this.bridge.generateCode('PAY'),
              amount: totalAmount,
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
        } else {
          throw new BadRequestException('Saved card payments are no longer supported. Complete PayPal checkout.');
        }
        await this.usersService.addSkyMiles(user._id.toString(), totalMiles);
        skyMilesCredited = true;
      }

      const booking = new this.bookingModel({
        _id: pregeneratedBookingId,
        pnr_code: pnrCode,
        user_id: user._id,
        booking_type: dto.booking_type,
        status,
        blocking_number: blockingNumber,
        confirmation_number: confirmationNumber,
        time_limit_deadline: deadline,
        ...(dto.is_block ? { hold_email: {
          status: HoldEmailStatus.PENDING,
          attempt_count: 0,
          next_retry_at: new Date(),
        } } : {}),
        total_amount: totalAmount,
        total_fare: totalFare,
        total_seat_fees: totalSeatFees,
        seat_saga_commit: {
          operation_id: sagaOperationId,
          operation_type: 'CREATE',
          status: 'PENDING_FINALIZATION',
          committed_at: new Date(),
        },
        total_miles_accrued: dto.is_block ? 0 : totalMiles,
        passengers: dto.passengers,
        ticket_coupons: ticketCoupons,
        payment_transactions: paymentTransactions,
        early_bird_percent: earlyBirdPercent,
        early_bird_label: earlyBirdLabel,
        early_bird_label_en: earlyBirdLabelEn,
        load_factor_percent: loadFactorPercent,
        load_adjustment_percent: loadAdjustmentPercent,
        load_adjustment_label: loadAdjustmentLabel,
        pricing_profile_id: pricingProfileId || undefined,
        pricing_profile_name: pricingProfileName || undefined,
        ff_tier: ffTier,
        ff_discount_percent: ffDiscountPercent,
        pricing_note: dto.legs.length > 1 ? 'Applied pricing based on earliest departure leg' : '',
      });

      const savedBooking = await booking.save();
      businessCommitted = true;

      // Post-commit phase (Forward Recovery Only — Never roll back committed booking)
      if (sagaOp) {
        sagaOp.state = SagaState.COMMITTED;
        sagaOp.last_progress_at = new Date();
        await sagaOp.save().catch(() => {});
      }

      let postCommitFinalized = true;
      if (!dto.is_block && this.seatAllocationService) {
        try {
          await this.seatAllocationService.confirmAllocations(pregeneratedBookingId, sagaOperationId);
        } catch (confirmErr) {
          postCommitFinalized = false;
          this.logger.error(`Failed to confirm allocations post-commit for booking ${pregeneratedBookingId}: ${confirmErr}`);
        }
      }

      if (postCommitFinalized) {
        let witnessPersisted = false;
        if (typeof this.bookingModel?.updateOne === 'function') {
          try {
            await this.bookingModel.updateOne(
              { _id: pregeneratedBookingId },
              { $set: { 'seat_saga_commit.status': 'COMPLETED' } },
            );
            witnessPersisted = true;
          } catch (witnessErr) {
            this.logger.error(
              `Failed to persist seat_saga_commit.status=COMPLETED witness on booking ${pregeneratedBookingId}: ${witnessErr}. Saga remains COMMITTED for scheduler retry.`,
            );
          }
        } else {
          witnessPersisted = true;
        }

        if (witnessPersisted) {
          if (savedBooking.seat_saga_commit) {
            savedBooking.seat_saga_commit.status = 'COMPLETED';
          }

          if (sagaOp) {
            sagaOp.state = SagaState.COMPLETED;
            sagaOp.completed_at = new Date();
            await sagaOp.save().catch(() => {});
          }
        }
      }

      // A newly held booking must notify its owner immediately, including when a
      // clerk created it on a customer's behalf. Mailing is post-commit only.
      if (savedBooking.status === BookingStatus.BLOCKED && this.mailService) {
        try {
          const sent = await deliverHoldCreatedEmail(
            this.bookingModel, this.flightsService, this.mailService, savedBooking._id,
          );
          if (!sent) this.logger.warn(`Hold-created email queued for retry: ${savedBooking.pnr_code}.`);
        } catch (mailError) {
          this.logger.warn(`Hold-created email could not be prepared/sent for ${savedBooking.pnr_code}: ${mailError}`);
        }
      }

      return savedBooking;
    } catch (error) {
      if (businessCommitted) {
        this.logger.error(
          `Post-commit error in createBooking for booking ${pregeneratedBookingId}; leaving in COMMITTED / PENDING_FINALIZATION: ${error}`,
        );
        throw error;
      }

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

      // B. Compensate NEW inventory reservations
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
            this.logger.error(`Failed to compensate reservation for flight ${leg.flight_id}: ${compErr}`);
          }
        } else {
          try {
            await this.flightsService.updateAvailableSeats(leg.flight_id, leg.inventory_id, passengerCount);
          } catch (_) {}
        }
      }

      // C. Restore SkyMiles compensation where required
      if (skyMilesCredited) {
        try {
          await this.usersService.setSkyMiles(user._id.toString(), originalSkyMiles);
        } catch (_) {}
      }



      // IF allCompensated -> ABORTED, else leave in PRECOMMIT for scheduler retry
      if (sagaOp) {
        if (allCompensated) {
          try {
            sagaOp.state = SagaState.ABORTED;
            sagaOp.aborted_at = new Date();
            await sagaOp.save();
          } catch (_) {}
        } else {
          try {
            sagaOp.last_progress_at = new Date();
            await sagaOp.save();
          } catch (_) {}
          this.logger.warn(`Saga ${sagaOperationId} compensation incomplete; leaving in PRECOMMIT for scheduler retry.`);
        }
      }
      throw error;
    }
  }

  /**
   * Requirement 3.5: Confirm Blocked Ticket (before 2-week cutoff)
   */

}
