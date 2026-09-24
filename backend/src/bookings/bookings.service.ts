import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  BookingType,
  PassengerType,
  PaymentMethod,
  ExternalPaymentProof,
} from './bookings.schema';
import { FlightDocument, FlightStatus, isCustomerBookableFlight } from '../flights/flights.schema';
import {
  CancelTicketDto,
  ConfirmTicketDto,
  CreateBookingDto,
  RescheduleTicketDto,
  FlightLegSelectionDto,
  SeatSelectionRequestDto,
  QuoteBookingDto,
  CreatePayPalBookingOrderDto,
  CapturePayPalOrderDto,
  CreatePayPalConfirmHoldOrderDto,
  CreatePayPalRescheduleOrderDto,
} from './bookings.dto';
import { CREDIT_CARD_REGEX } from '../common/validation.constants';
import { AirportsService } from '../airports/airports.service';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/users.schema';
import { PoliciesService } from '../policies/policies.service';
import { applyPricing, getBookingWindowLimits, maxAdvanceBookingDays } from '../common/pricing.util';
import { formatLocalTime, parseUtcWallTime } from '../common/timezone.util';
import { MailService, ItineraryLegData, isValidMaskedCard } from '../mail/mail.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import {
  PaypalService,
  ConvertedPresentmentAmount,
  assertPayPalRefundExecutionSnapshot,
  classifyPayPalRefundStatus,
} from '../paypal/paypal.service';
import {
  PayPalCheckoutSession,
  PayPalCheckoutSessionDocument,
  PayPalCheckoutOperationType,
  PayPalCheckoutStatus,
} from '../paypal/paypal-checkout.schema';
import { allocateRefundSources, AllocatedRefundItem } from './refund-allocation.util';


export function assertPayPalPaymentProof(
  proof: ExternalPaymentProof | undefined | null,
  authoritativeAmountVnd: number,
  context: string,
): void {
  if (!proof) {
    throw new BadRequestException(
      `[${context}] Missing PayPal external payment proof for authoritative amount ${authoritativeAmountVnd} VND.`,
    );
  }

  if (proof.payment_method !== PaymentMethod.PAYPAL) {
    throw new BadRequestException(
      `[${context}] Invalid payment method in payment proof: expected PAYPAL, got ${proof.payment_method}.`,
    );
  }

  if (proof.status !== 'SUCCESS') {
    throw new BadRequestException(
      `[${context}] PayPal payment proof is not successful (status: ${proof.status}).`,
    );
  }

  if (typeof proof.expected_amount_vnd !== 'number' || proof.expected_amount_vnd !== authoritativeAmountVnd) {
    throw new BadRequestException(
      `[${context}] Payment amount mismatch: authoritative amount ${authoritativeAmountVnd} VND does not match proof expected amount ${proof.expected_amount_vnd} VND.`,
    );
  }

  if (!proof.provider_order_id || !proof.provider_order_id.trim()) {
    throw new BadRequestException(`[${context}] PayPal provider_order_id is required.`);
  }

  if (!proof.provider_capture_id || !proof.provider_capture_id.trim()) {
    throw new BadRequestException(`[${context}] PayPal provider_capture_id is required.`);
  }

  if (!proof.provider_currency || proof.provider_currency.trim().toUpperCase() !== 'USD') {
    throw new BadRequestException(
      `[${context}] Invalid PayPal presentment currency: expected USD, got ${proof.provider_currency}.`,
    );
  }

  if (
    typeof proof.exchange_rate_vnd_per_unit !== 'number' ||
    isNaN(proof.exchange_rate_vnd_per_unit) ||
    proof.exchange_rate_vnd_per_unit <= 0
  ) {
    throw new BadRequestException(
      `[${context}] Invalid exchange rate in payment proof: ${proof.exchange_rate_vnd_per_unit}.`,
    );
  }

  const expectedProviderAmount = (
    Math.round((authoritativeAmountVnd / proof.exchange_rate_vnd_per_unit) * 100) / 100
  ).toFixed(2);

  if (proof.provider_amount !== expectedProviderAmount) {
    throw new BadRequestException(
      `[${context}] PayPal provider_amount (${proof.provider_amount}) does not match converted authoritative amount (${expectedProviderAmount} USD for ${authoritativeAmountVnd} VND at rate ${proof.exchange_rate_vnd_per_unit}).`,
    );
  }
}
import {
  BookingSeatSagaOperation,
  BookingSeatSagaOperationDocument,
  SagaState,
  SagaOperationType,
} from '../seat-allocation/booking-seat-saga-operation.schema';

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
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly flightsService: FlightsService,
    private readonly usersService: UsersService,
    private readonly policiesService: PoliciesService,
    @Optional() private readonly airportsService?: AirportsService,
    @Optional() private readonly seatAllocationService?: SeatAllocationService,
    @Optional()
    @InjectModel(BookingSeatSagaOperation.name)
    private readonly sagaModel?: Model<BookingSeatSagaOperationDocument>,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly paypalService?: PaypalService,
    @Optional()
    @InjectModel(PayPalCheckoutSession.name)
    private readonly paypalCheckoutModel?: Model<PayPalCheckoutSessionDocument>,
  ) {}

  private generateCode(prefix: string): string {
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomChars}`;
  }

  async findAll(status?: BookingStatus, userId?: string): Promise<Booking[]> {
    const filter: any = {};
    if (status) filter.status = status;
    if (userId) filter.user_id = new Types.ObjectId(userId);
    return this.bookingModel.find(filter).sort({ createdAt: -1 }).populate('user_id', '-password_hash -preferred_credit_card').exec();
  }

  async findById(id: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }
    const booking = await this.bookingModel.findById(id).populate('user_id', '-password_hash -preferred_credit_card').exec();
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
    return booking;
  }

  private assertBookableFlight(flight: FlightDocument, context = 'book'): void {
    if (flight.status === FlightStatus.CANCELLED) {
      throw new BadRequestException(
        `Cannot ${context} flight ${flight.flight_number}: flight is CANCELLED.`,
      );
    }
    if (!isCustomerBookableFlight(flight)) {
      throw new BadRequestException(
        `Cannot ${context} flight ${flight.flight_number}: only AirLabs-backed Aptech commercial flights are customer-bookable.`,
      );
    }
  }

  /**
   * Requirement 3.4: Make Reservations / Blocking / Direct Buying
   */
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
      this.assertBookableFlight(flight, 'book');
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

    // Authoritative total payable preflight before any mutation or seat reservations (Fix 7)
    let preflightSeatFees = 0;
    if (this.seatAllocationService) {
      for (const { definition: leg, flight, inventory } of selectedLegs) {
        const normalizedLeg = normalizeLegType(leg.leg_type);
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

    let maskedProfileCard: string | undefined = undefined;

    // Purchase payment preflight before any saga creation or seat reservation mutation
    if (!dto.is_block) {
      if (!dto.payment_method) {
        throw new BadRequestException('Payment method is required to purchase tickets.');
      }
      if (dto.payment_method === PaymentMethod.PAYPAL) {
        if (totalPayable > 0) {
          assertPayPalPaymentProof(externalPaymentProof, totalPayable, 'createBooking:preflight');
        }
      } else if (dto.payment_method === PaymentMethod.PROFILE_CARD) {
        const rawCard = (user.preferred_credit_card || '').trim();
        const placeholders = new Set(['CARD-DEFAULT', 'SAVED-CARD', 'UNKNOWN', 'ORIGINAL-PAYMENT-CARD']);
        if (
          !rawCard ||
          placeholders.has(rawCard.toUpperCase()) ||
          rawCard.startsWith('*') ||
          !CREDIT_CARD_REGEX.test(rawCard)
        ) {
          throw new BadRequestException(
            'Cannot process payment: no valid preferred credit card found in user profile. Please update your profile.',
          );
        }

        const digits = rawCard.replace(/\D/g, '');
        maskedProfileCard = `**** **** **** ${digits.slice(-4)}`;
      } else {
        throw new BadRequestException('Unsupported payment method.');
      }
    }

    // Pre-generate Booking ObjectId and SAGA Operation
    const pregeneratedBookingId = new Types.ObjectId();
    const sagaOperationId = this.generateCode('SAGA-CREATE');
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
          const normalizedLeg = normalizeLegType(leg.leg_type);
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
      pnrCode = this.generateCode('PNR');
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
        if (dto.payment_method === PaymentMethod.PAYPAL) {
          if (totalAmount === 0) {
            paymentTransactions.push({
              transaction_type: 'PAYMENT',
              payment_method: PaymentMethod.PAYPAL,
              payment_provider: 'PAYPAL',
              payment_reference: this.generateCode('PAY'),
              amount: 0,
              currency: 'VND',
              status: 'SUCCESS',
              created_at: new Date(),
            });
          } else {
            assertPayPalPaymentProof(externalPaymentProof, totalAmount, 'createBooking:post-allocation');
            paymentTransactions.push({
              transaction_type: 'PAYMENT',
              payment_method: PaymentMethod.PAYPAL,
              payment_provider: 'PAYPAL',
              payment_reference: externalPaymentProof!.payment_reference || this.generateCode('PAY'),
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
          paymentTransactions.push({
            transaction_type: 'PAYMENT',
            payment_method: PaymentMethod.PROFILE_CARD,
            payment_provider: 'PROFILE_CARD',
            payment_reference: this.generateCode('PAY'),
            amount: totalAmount,
            card_masked: maskedProfileCard!,
            currency: 'VND',
            status: 'SUCCESS',
            created_at: new Date(),
          });
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

    if (!dto.payment_method) {
      throw new BadRequestException('Payment method is required to confirm reservation.');
    }
    if (dto.payment_method === PaymentMethod.PAYPAL) {
      if (booking.total_amount === 0) {
        booking.payment_transactions.push({
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_provider: 'PAYPAL',
          payment_reference: this.generateCode('PAY'),
          amount: 0,
          currency: 'VND',
          status: 'SUCCESS',
          created_at: new Date(),
        });
      } else {
        assertPayPalPaymentProof(externalPaymentProof, booking.total_amount, 'confirmTicket');
        booking.payment_transactions.push({
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_provider: 'PAYPAL',
          payment_reference: externalPaymentProof!.payment_reference || this.generateCode('PAY'),
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
      const user = await this.usersService.findById(booking.user_id.toString());
      const rawCard = (user?.preferred_credit_card || '').trim();
      const placeholders = new Set(['CARD-DEFAULT', 'SAVED-CARD', 'UNKNOWN', 'ORIGINAL-PAYMENT-CARD']);
      if (
        !rawCard ||
        placeholders.has(rawCard.toUpperCase()) ||
        rawCard.startsWith('*') ||
        !CREDIT_CARD_REGEX.test(rawCard)
      ) {
        throw new BadRequestException(
          'Cannot process payment: no valid preferred credit card found in user profile. Please update your profile.',
        );
      }

      const digits = rawCard.replace(/\D/g, '');
      const maskedCard = `**** **** **** ${digits.slice(-4)}`;

      booking.payment_transactions.push({
        transaction_type: 'PAYMENT',
        payment_method: PaymentMethod.PROFILE_CARD,
        payment_provider: 'PROFILE_CARD',
        payment_reference: this.generateCode('PAY'),
        amount: booking.total_amount,
        card_masked: maskedCard,
        currency: 'VND',
        status: 'SUCCESS',
        created_at: new Date(),
      });
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
  private async resolveRescheduleCard(
    booking: BookingDocument,
    paymentMethod?: PaymentMethod,
    isCharge: boolean = true,
  ): Promise<{ maskedCard: string; paymentMethod?: PaymentMethod }> {
    const user = booking.user_id
      ? await this.usersService.findById(booking.user_id.toString())
      : null;

    const placeholders = new Set(['SAVED-CARD', 'CARD-DEFAULT', 'ORIGINAL-PAYMENT-CARD', 'UNKNOWN']);

    if (isCharge) {
      if (!paymentMethod) {
        throw new BadRequestException('Payment method is required for reschedule fare difference.');
      }
      if (paymentMethod === PaymentMethod.PAYPAL) {
        throw new BadRequestException('PayPal reschedule charge requires completing PayPal checkout.');
      }
      if (paymentMethod !== PaymentMethod.PROFILE_CARD) {
        throw new BadRequestException('Invalid payment method.');
      }

      const rawCard = (user?.preferred_credit_card || '').trim();
      if (
        !rawCard ||
        placeholders.has(rawCard.toUpperCase()) ||
        rawCard.startsWith('*') ||
        !CREDIT_CARD_REGEX.test(rawCard)
      ) {
        throw new BadRequestException('Payment card is required for reschedule fare difference.');
      }
      const digits = rawCard.replace(/\D/g, '');
      return {
        maskedCard: `**** **** **** ${digits.slice(-4)}`,
        paymentMethod: PaymentMethod.PROFILE_CARD,
      };
    } else {
      // 1. Prefer original successful transaction's card_masked and payment_method
      if (Array.isArray(booking.payment_transactions) && booking.payment_transactions.length > 0) {
        const paymentTx = booking.payment_transactions
          .slice()
          .reverse()
          .find((t) => t.status === 'SUCCESS' && (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RESCHEDULE_CHARGE'));

        if (paymentTx?.card_masked) {
          const masked = paymentTx.card_masked.trim();
          if (masked && !placeholders.has(masked.toUpperCase())) {
            return {
              maskedCard: masked,
              paymentMethod: (paymentTx.payment_method as PaymentMethod) || undefined,
            };
          }
        }
      }

      // 2. Fall back to valid preferred card if needed
      const rawCard = (user?.preferred_credit_card || '').trim();
      if (rawCard && !placeholders.has(rawCard.toUpperCase()) && !rawCard.startsWith('*') && CREDIT_CARD_REGEX.test(rawCard)) {
        const digits = rawCard.replace(/\D/g, '');
        if (digits.length >= 4) {
          return {
            maskedCard: `**** **** **** ${digits.slice(-4)}`,
            paymentMethod: PaymentMethod.PROFILE_CARD,
          };
        }
      }

      // 3. Fall back to PayPal if booking has successful PayPal payments
      const hasPaypal = booking.payment_transactions?.some(
        (t) => t.status === 'SUCCESS' && t.payment_method === PaymentMethod.PAYPAL,
      );
      if (hasPaypal) {
        return {
          maskedCard: '',
          paymentMethod: PaymentMethod.PAYPAL,
        };
      }

      throw new BadRequestException('Cannot process refund: no valid payment card found for this booking.');
    }
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
      return this.rescheduleConnectingTicket(booking, dto, externalPaymentProof);
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
    this.assertBookableFlight(newFlight, 'reschedule');
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
      this.assertBookableFlight(newReturnFlight, 'reschedule');
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

    // SAGA setup
    const sagaOperationId = this.generateCode('SAGA-RESCHEDULE');
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
          assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleTicket');
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: PaymentMethod.PAYPAL,
            payment_provider: 'PAYPAL',
            payment_reference: externalPaymentProof!.payment_reference || this.generateCode('PAY'),
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, true);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: resCard.paymentMethod,
            payment_provider: resCard.paymentMethod === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
            payment_reference: this.generateCode('PAY'),
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
          (p) => this.generateCode(p),
        );
        if (allocations.length > 0) {
          const placeholders = new Set(['SAVED-CARD', 'CARD-DEFAULT', 'ORIGINAL-PAYMENT-CARD', 'UNKNOWN']);
          for (const alloc of allocations) {
            if (alloc.payment_method !== PaymentMethod.PAYPAL) {
              const rawMasked = (alloc.card_masked || '').trim();
              if (!alloc.payment_method || !rawMasked || placeholders.has(rawMasked.toUpperCase())) {
                const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_REFUND',
            payment_method: resCard.paymentMethod,
            payment_provider: resCard.paymentMethod === PaymentMethod.PAYPAL ? 'PAYPAL' : 'PROFILE_CARD',
            payment_reference: this.generateCode('REF'),
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
      const newConfirmationNumber = this.generateCode('CNF');
      booking.confirmation_number = newConfirmationNumber;
      booking.status = BookingStatus.CONFIRMED;
      booking.total_amount = newTotalAmount;
      booking.total_fare = newTotalFare;
      booking.total_seat_fees = newTotalSeatFees;
      booking.early_bird_percent = outPricing.early_bird_percent;
      booking.early_bird_label = outPricing.early_bird_label;
      booking.early_bird_label_en = outPricing.early_bird_label_en;
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
        await this.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
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
          this.assertBookableFlight(flight, 'reschedule');
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
        this.assertBookableFlight(flight, 'reschedule');
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
          this.assertBookableFlight(flight, 'reschedule');
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
        this.assertBookableFlight(flight, 'reschedule');
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

    // SAGA setup
    const sagaOperationId = this.generateCode('SAGA-RESCHEDULE');
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
          assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleMixedRoundTrip');
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: PaymentMethod.PAYPAL,
            payment_provider: 'PAYPAL',
            payment_reference: externalPaymentProof!.payment_reference || this.generateCode('PAY'),
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, true);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: resCard.paymentMethod,
            payment_reference: this.generateCode('PAY'),
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
          (p) => this.generateCode(p),
        );
        if (allocations.length > 0) {
          const placeholders = new Set(['SAVED-CARD', 'CARD-DEFAULT', 'ORIGINAL-PAYMENT-CARD', 'UNKNOWN']);
          for (const alloc of allocations) {
            if (alloc.payment_method !== PaymentMethod.PAYPAL) {
              const rawMasked = (alloc.card_masked || '').trim();
              if (!alloc.payment_method || !rawMasked || placeholders.has(rawMasked.toUpperCase())) {
                const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_REFUND',
            payment_method: resCard.paymentMethod,
            payment_reference: this.generateCode('REF'),
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

      const newConfirmationNumber = this.generateCode('CNF');
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
        await this.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
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

  /**
   * Reschedule a CONNECTING booking with complete multi-leg itinerary validation,
   * atomic reservation of new legs before releasing old legs, and full compensating rollback.
   */
  private async rescheduleConnectingTicket(
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
    const oldCoupons = booking.ticket_coupons.map((coupon: any) => ({ ...coupon }));
    const refundAllocations: AllocatedRefundItem[] = [];

    // 1. Load and validate all new flights
    const loadedFlights: FlightDocument[] = [];
    const loadedInventories: any[] = [];

    for (let i = 0; i < newLegs.length; i++) {
      const legDef = newLegs[i];
      const flight = await this.flightsService.findById(legDef.flight_id);
      this.assertBookableFlight(flight, 'reschedule');
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
    const sagaOperationId = this.generateCode('SAGA-RESCHEDULE');
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
      reservedLegs.push({ ...legDef, mutation_key: mutKey });
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
          assertPayPalPaymentProof(externalPaymentProof, priceDiff, 'rescheduleConnectingTicket');
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: PaymentMethod.PAYPAL,
            payment_provider: 'PAYPAL',
            payment_reference: externalPaymentProof!.payment_reference || this.generateCode('PAY'),
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, true);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: resCard.paymentMethod,
            payment_reference: this.generateCode('PAY'),
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
          (p) => this.generateCode(p),
        );
        if (allocations.length > 0) {
          const placeholders = new Set(['SAVED-CARD', 'CARD-DEFAULT', 'ORIGINAL-PAYMENT-CARD', 'UNKNOWN']);
          for (const alloc of allocations) {
            if (alloc.payment_method !== PaymentMethod.PAYPAL) {
              const rawMasked = (alloc.card_masked || '').trim();
              if (!alloc.payment_method || !rawMasked || placeholders.has(rawMasked.toUpperCase())) {
                const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
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
          const resCard = await this.resolveRescheduleCard(booking, dto.payment_method, false);
          booking.payment_transactions.push({
            transaction_type: 'RESCHEDULE_REFUND',
            payment_method: resCard.paymentMethod,
            payment_reference: this.generateCode('REF'),
            amount: refundAmt,
            card_masked: resCard.maskedCard,
            currency: 'VND',
            status: 'SUCCESS',
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

      const newConfirmationNumber = this.generateCode('CNF');
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
        await this.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
      }

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
    booking.cancellation_number = this.generateCode('CAN');

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
      seat_selection_type: 'AUTO' as any,
      seat_fee: 0,
      seat_pricing_snapshot: undefined as any,
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
      const earliestDeparture = await this.getEarliestDeparture(booking);
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
          (p) => this.generateCode(p),
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

    const cancellationNumber = this.generateCode('CAN');
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
              payment_reference: this.generateCode('REF'),
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
        await this.executePostCommitRefunds(booking._id, refundAllocations, booking.pnr_code);
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
      .populate('user_id', '-password_hash -preferred_credit_card')
      .exec();

    if (!booking) {
      throw new NotFoundException(`No booking found with code ${code}`);
    }

    // Enrich with flight real-time status, airport timezones and local wall times
    const enrichedCoupons: any[] = [];
    let hasEmergencyChanges = false;

    const tzCache: Record<string, string | undefined> = {};
    const getTz = async (iata: string): Promise<string | undefined> => {
      if (!iata) return undefined;
      if (iata in tzCache) return tzCache[iata];
      let tz: string | undefined = undefined;
      if (this.airportsService) {
        try {
          const apt = await this.airportsService.findByIata(iata);
          if (apt?.time_zone) {
            new Intl.DateTimeFormat('en-US', { timeZone: apt.time_zone });
            tz = apt.time_zone;
          }
        } catch {}
      } else if (typeof (this.flightsService as any).getAirportTimeZone === 'function') {
        tz = await (this.flightsService as any).getAirportTimeZone(iata);
      }
      tzCache[iata] = tz;
      return tz;
    };

    for (const coupon of booking.ticket_coupons) {
      const flight = await this.flightsService.findById(coupon.flight_id.toString());
      const isAltered = flight.status !== 'SCHEDULED' || !!flight.delay_reason;
      if (isAltered) hasEmergencyChanges = true;

      const originTz = await getTz(flight.origin_iata);
      const destTz = await getTz(flight.dest_iata);

      enrichedCoupons.push({
        ...coupon,
        origin_iata: flight.origin_iata,
        dest_iata: flight.dest_iata,
        origin_time_zone: originTz,
        dest_time_zone: destTz,
        departure_date: flight.departure_date,
        scheduled_departure: flight.scheduled_departure,
        scheduled_arrival: flight.scheduled_arrival,
        scheduled_departure_local: formatLocalTime(flight.scheduled_departure, originTz),
        scheduled_arrival_local: formatLocalTime(flight.scheduled_arrival, destTz),
        actual_departure: flight.actual_departure,
        actual_arrival: flight.actual_arrival,
        actual_departure_local: flight.actual_departure ? formatLocalTime(flight.actual_departure, originTz) : undefined,
        actual_arrival_local: flight.actual_arrival ? formatLocalTime(flight.actual_arrival, destTz) : undefined,
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
          { cancellation_number: identifier },
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

  /**
   * Post-commit PayPal refunds execution with outbox error tracking.
   */
  async executePostCommitRefunds(
    bookingId: any,
    refundAllocations: AllocatedRefundItem[],
    pnrCode: string,
  ): Promise<void> {
    if (!this.paypalService || !refundAllocations || refundAllocations.length === 0) {
      return;
    }

    for (const item of refundAllocations) {
      if (item.payment_method === PaymentMethod.PAYPAL) {
        try {
          assertPayPalRefundExecutionSnapshot({
            payment_reference: item.payment_reference,
            provider_capture_id: item.provider_capture_id || '',
            provider_amount: item.provider_amount || '',
            provider_currency: item.provider_currency || '',
            exchange_rate_vnd_per_unit: item.exchange_rate_vnd_per_unit,
            require_fx: true,
            context: 'executePostCommitRefunds',
          });
        } catch (valErr: any) {
          this.logger.error(
            `Incomplete PayPal refund provenance for booking ${pnrCode}, ref ${item.payment_reference}: ${valErr?.message}`,
          );
          item.status = 'FAILED';
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': 'FAILED',
                  'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
                  'payment_transactions.$.next_retry_at': null,
                },
              },
            );
          }
          continue;
        }

        try {
          const refundRes = await this.paypalService.refundCapture({
            captureId: item.provider_capture_id!,
            providerAmount: item.provider_amount!,
            providerCurrency: item.provider_currency!,
            paypalRequestId: item.payment_reference,
            note: `Refund for PNR ${pnrCode}`,
          });
          const classified = classifyPayPalRefundStatus(refundRes.status);
          const localStatus = classified.local_status;
          const isFailed = classified.is_failed;
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': localStatus,
                  'payment_transactions.$.provider_refund_id': refundRes.refund_id,
                  'payment_transactions.$.provider_status': classified.provider_status,
                  ...(isFailed
                    ? {
                        'payment_transactions.$.failure_reason': `PayPal refund returned status: ${classified.provider_status}`,
                        'payment_transactions.$.next_retry_at': null,
                      }
                    : {}),
                },
              },
            );
          }
          item.status = localStatus;
          (item as any).provider_refund_id = refundRes.refund_id;
          (item as any).provider_status = classified.provider_status;
          if (isFailed) {
            item.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
            (item as any).next_retry_at = null;
          }
        } catch (ppErr: any) {
          this.logger.error(
            `Post-commit PayPal refund failed for booking ${pnrCode}, ref ${item.payment_reference}: ${ppErr?.message || ppErr}`,
          );
          item.status = 'PENDING';
          if (typeof this.bookingModel?.updateOne === 'function') {
            await this.bookingModel.updateOne(
              { _id: bookingId, 'payment_transactions.payment_reference': item.payment_reference },
              {
                $set: {
                  'payment_transactions.$.status': 'PENDING',
                  'payment_transactions.$.provider_status': 'FAILED',
                  'payment_transactions.$.failure_reason': ppErr?.message || 'PayPal refund call failed',
                  'payment_transactions.$.next_retry_at': new Date(Date.now() + 60 * 60 * 1000),
                },
              },
            );
          }
        }
      }
    }
  }

  /**
   * Pure, side-effect-free quote calculation for ticket booking.
   * Full validation parity with createBooking without database mutation.
   */
  async quoteBooking(
    dto: QuoteBookingDto,
    userId?: string,
  ): Promise<{
    total_fare: number;
    total_seat_fees: number;
    total_amount: number;
    currency: string;
    early_bird_percent: number;
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
      this.assertBookableFlight(flight, 'quote');
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
      this.validateConnectingFlights(selectedLegs.map((leg) => leg.flight));
      this.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Connecting itinerary');
    } else if (dto.booking_type === BookingType.ROUND_TRIP) {
      const { outboundLegs, inboundLegs } = this.validateRoundTripLegs(selectedLegs);
      this.validateBookingWindow(outboundLegs.map((leg) => leg.flight), 'Outbound itinerary');
      this.validateBookingWindow(inboundLegs.map((leg) => leg.flight), 'Return itinerary');
    } else {
      this.validateBookingWindow(selectedLegs.map((leg) => leg.flight), 'Flight');
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
    let ffTier = '';
    let ffDiscountPercent = 0;

    for (const { inventory } of selectedLegs) {
      for (const p of dto.passengers) {
        const pricing = applyPricing(inventory.base_price, daysUntilDeparture, skyMiles);
        earlyBirdPercent = pricing.early_bird_percent;
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

    const passengerCount = booking.passengers?.length || 1;
    const user = booking.user_id ? await this.usersService.findById(booking.user_id.toString()) : null;
    const skyMiles = user?.sky_miles || 0;
    const oldTotal = booking.total_amount || 0;

    const isInbound = (lt?: string) => {
      const n = normalizeLegType(lt);
      return n === 'INBOUND' || n.startsWith('INBOUND_');
    };
    const isOutbound = (lt?: string) => {
      const n = normalizeLegType(lt);
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
        this.assertBookableFlight(flight, 'quote-reschedule');
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
          const pricing = applyPricing(inv.base_price, daysUntilDep, skyMiles);
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;
        }
      }
      if (outboundFlights.length > 1) {
        this.validateConnectingSequence(outboundFlights, 'outbound');
        this.validateBookingWindow(outboundFlights, 'Outbound connecting itinerary');
      }
    } else if (dto.new_flight_id && dto.new_inventory_id) {
      const flight = await this.flightsService.findById(dto.new_flight_id);
      if (!flight) throw new NotFoundException(`Flight ${dto.new_flight_id} not found.`);
      this.assertBookableFlight(flight, 'quote-reschedule');
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
      this.validateBookingWindow([flight], 'New outbound flight');

      const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      for (const p of booking.passengers) {
        const pricing = applyPricing(inv.base_price, daysUntilDep, skyMiles);
        let fare = pricing.final_price;
        if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
        if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
        newTotalFare += fare;
      }
    } else if (booking.booking_type === BookingType.ROUND_TRIP && shouldRescheduleReturn) {
      // Outbound is NOT rescheduled: retain existing outbound coupons fare and seat fees!
      const outboundCoupons = booking.ticket_coupons?.filter((c: any) => isOutbound(c.leg_type)) || [];
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
          this.assertBookableFlight(flight, 'quote-reschedule');
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
            const pricing = applyPricing(inv.base_price, daysUntilDep, skyMiles);
            let fare = pricing.final_price;
            if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
            if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
            newTotalFare += fare;
          }
        }
        if (returnFlights.length > 1) {
          this.validateConnectingSequence(returnFlights, 'return');
          this.validateBookingWindow(returnFlights, 'Return connecting itinerary');
        }
      } else if (dto.new_return_flight_id && dto.new_return_inventory_id) {
        const flight = await this.flightsService.findById(dto.new_return_flight_id);
        if (!flight) throw new NotFoundException(`Return flight ${dto.new_return_flight_id} not found.`);
        this.assertBookableFlight(flight, 'quote-reschedule');
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
        this.validateBookingWindow([flight], 'New return flight');

        const daysUntilDep = (dep.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        for (const p of booking.passengers) {
          const pricing = applyPricing(inv.base_price, daysUntilDep, skyMiles);
          let fare = pricing.final_price;
          if (p.passenger_type === PassengerType.CHILD) fare = Math.round(pricing.final_price * 0.75);
          if (p.passenger_type === PassengerType.SENIOR) fare = Math.round(pricing.final_price * 0.85);
          newTotalFare += fare;
        }
      }
    } else if (booking.booking_type === BookingType.ROUND_TRIP && isReschedulingOutbound) {
      // Inbound is NOT rescheduled: retain existing inbound coupons fare and seat fees!
      const inboundCoupons = booking.ticket_coupons?.filter((c: any) => isInbound(c.leg_type)) || [];
      for (const c of inboundCoupons) {
        newTotalFare += (c.fare_paid || 0);
        newTotalSeatFees += (c.seat_fee || 0);
      }
    }

    // Chronology check between outbound and return
    if (outboundFlights.length > 0 && returnFlights.length > 0) {
      const lastOutbound = outboundFlights[outboundFlights.length - 1];
      const firstReturn = returnFlights[0];
      if (lastOutbound.scheduled_arrival && new Date(firstReturn.scheduled_departure) <= new Date(lastOutbound.scheduled_arrival)) {
        throw new BadRequestException('Return flight must depart after the outbound flight arrives.');
      }
    }

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

  /**
   * Central server-side pre-capture verification gate.
   * Validates ownership, op-type parity, orderId match, expiry, hold deadline, and live quote parity.
   */
  private async verifyPreCaptureGate(
    session: PayPalCheckoutSessionDocument,
    expectedOpType: PayPalCheckoutOperationType,
    userId: string,
    orderId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<void> {
    if (session.user_id !== userId && role === UserRole.CUSTOMER) {
      throw new ForbiddenException('You do not have permission to access this checkout session.');
    }
    if (session.operation_type !== expectedOpType) {
      throw new BadRequestException(
        `Operation type mismatch: session is for ${session.operation_type}, attempted capture for ${expectedOpType}.`,
      );
    }
    if (!session.paypal_order_id || session.paypal_order_id !== orderId) {
      throw new BadRequestException(
        `Order ID mismatch: expected ${session.paypal_order_id}, got ${orderId}.`,
      );
    }
    if (session.order_expires_at && new Date() > session.order_expires_at) {
      session.status = PayPalCheckoutStatus.CANCELLED;
      session.error_message = 'Checkout session expired.';
      await session.save();
      throw new BadRequestException('Checkout session has expired. Please create a new checkout.');
    }

    // Recompute presentment BEFORE capture to verify snapshot parity
    const expectedPresentment = this.paypalService.convertVndToPresentment(
      session.amount_vnd,
      session.exchange_rate_vnd_per_unit,
    );
    if (
      expectedPresentment.provider_amount !== session.provider_amount ||
      expectedPresentment.provider_currency !== session.provider_currency
    ) {
      throw new BadRequestException(
        `Provider presentment snapshot mismatch: expected ${expectedPresentment.provider_amount} ${expectedPresentment.provider_currency}, session has ${session.provider_amount} ${session.provider_currency}.`,
      );
    }

    if (expectedOpType === PayPalCheckoutOperationType.CONFIRM_HOLD) {
      const blockingNumber = session.operation_payload?.blocking_number;
      if (!blockingNumber) throw new BadRequestException('Missing blocking number in session payload.');
      const booking = await this.bookingModel.findOne({ blocking_number: blockingNumber }).exec();
      if (!booking) throw new NotFoundException(`Booking with blocking number ${blockingNumber} not found.`);
      if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
        await this.cancelExpiredBlockStrict(booking);
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = 'Hold deadline expired before payment capture.';
        await session.save();
        throw new BadRequestException(
          'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
        );
      }
      if (booking.total_amount !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Hold booking total changed from ${session.amount_vnd} to ${booking.total_amount} VND.`;
        await session.save();
        throw new BadRequestException('Hold booking total has changed. Please start checkout again.');
      }
    } else if (expectedOpType === PayPalCheckoutOperationType.CREATE_BOOKING) {
      const quote = await this.quoteBooking(session.operation_payload as CreateBookingDto, session.user_id);
      if (quote.total_amount !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Price quote changed from ${session.amount_vnd} to ${quote.total_amount} VND.`;
        await session.save();
        throw new BadRequestException(
          `Price quote changed from ${session.amount_vnd} to ${quote.total_amount} VND. Please review and start checkout again.`,
        );
      }
    } else if (expectedOpType === PayPalCheckoutOperationType.RESCHEDULE) {
      const quote = await this.quoteRescheduleTicket(session.operation_payload as RescheduleTicketDto, session.user_id);
      if (quote.price_difference !== session.amount_vnd) {
        session.status = PayPalCheckoutStatus.CANCELLED;
        session.error_message = `Reschedule price quote changed from ${session.amount_vnd} to ${quote.price_difference} VND.`;
        await session.save();
        throw new BadRequestException(
          `Reschedule quote changed from ${session.amount_vnd} to ${quote.price_difference} VND. Please review and start checkout again.`,
        );
      }
    }
  }

  /**
   * Create PayPal Order for Ticket Booking.
   */
  async createPayPalBookingOrder(
    dto: CreatePayPalBookingOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    if (dto.is_block) {
      throw new BadRequestException('Ticket hold / block reservations do not require payment.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required for PayPal order creation.');
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    const quote = await this.quoteBooking(dto, userId);
    if (quote.total_amount <= 0) {
      throw new BadRequestException('Authoritative booking amount must be greater than zero.');
    }

    const checkoutId = this.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: quote.total_amount,
      clientRequestId: dto.client_request_id,
      description: 'Aptech Airlines Ticket Purchase',
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: quote.total_amount,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: dto,
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: quote.total_amount,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Compensation refund helper tracking truthful status.
   * COMPLETED -> REFUNDED
   * PENDING -> RECONCILE_REQUIRED
   * Failed / error -> RECONCILE_REQUIRED
   * Stores provider_refund_id and provider_refund_status.
   */
  private async executeCompensationRefund(
    session: PayPalCheckoutSessionDocument,
    bizErr: any,
    contextNote: string,
  ): Promise<void> {
    this.logger.error(
      `${contextNote} after PayPal capture ${session.paypal_capture_id} for session ${session.checkout_id}. Initiating automated compensation refund: ${bizErr?.message || 'Error'}`,
    );
    const reqId = `${session.checkout_id}-compensation-refund`;
    try {
      assertPayPalRefundExecutionSnapshot({
        payment_reference: reqId,
        provider_capture_id: session.paypal_capture_id || '',
        provider_amount: session.provider_amount || '',
        provider_currency: session.provider_currency || '',
        exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
        require_fx: true,
        context: 'executeCompensationRefund',
      });
      const refundRes = await this.paypalService.refundCapture({
        captureId: session.paypal_capture_id!,
        providerAmount: session.provider_amount!,
        providerCurrency: session.provider_currency!,
        paypalRequestId: reqId,
        note: `Automated compensation refund: ${contextNote} (${bizErr?.message})`,
      });
      const classified = classifyPayPalRefundStatus(refundRes.status);
      session.provider_refund_id = refundRes.refund_id;
      session.provider_refund_status = classified.provider_status;

      if (classified.is_success) {
        session.status = PayPalCheckoutStatus.REFUNDED;
      } else {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.failure_reason = `${contextNote}: ${bizErr?.message}. Refund status is ${classified.provider_status}.`;
      }
    } catch (refundErr: any) {
      this.logger.error(
        `CRITICAL: Compensation refund failed for capture ${session.paypal_capture_id} session ${session.checkout_id}: ${refundErr?.message}. Flagging as RECONCILE_REQUIRED.`,
      );
      session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
      session.failure_reason = `${contextNote}: ${bizErr?.message}. Refund failed: ${refundErr?.message}`;
    }
    session.error_message = session.failure_reason || bizErr?.message;
    await session.save();
  }

  /**
   * Prepares and claims PayPal capture:
   * State Machine: CREATED -> CAPTURING -> CAPTURED -> FINALIZING -> COMPLETED
   */
  private async prepareAndClaimPayPalCapture(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
    expectedOpType: PayPalCheckoutOperationType,
  ): Promise<{
    session: PayPalCheckoutSessionDocument;
    existingBooking?: any;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal service is unavailable.');
    }

    let session = await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec();
    if (!session) {
      throw new NotFoundException('PayPal checkout session not found.');
    }

    if (session.user_id !== userId && role === UserRole.CUSTOMER) {
      throw new ForbiddenException('You do not have permission to access this checkout session.');
    }

    if (session.status === PayPalCheckoutStatus.COMPLETED && session.result_booking_id) {
      const existingBooking = await this.findById(session.result_booking_id);
      return { session, existingBooking };
    }

    if (session.operation_type !== expectedOpType) {
      throw new BadRequestException(
        `Operation type mismatch: session is for ${session.operation_type}, attempted capture for ${expectedOpType}.`,
      );
    }
    if (!session.paypal_order_id || session.paypal_order_id !== orderId) {
      throw new BadRequestException(
        `Order ID mismatch: expected ${session.paypal_order_id}, got ${orderId}.`,
      );
    }

    if (session.status === PayPalCheckoutStatus.FAILED) {
      throw new BadRequestException(
        `Checkout session has failed: ${session.error_message || 'Payment capture failed.'}`,
      );
    }
    if (session.status === PayPalCheckoutStatus.CANCELLED) {
      throw new BadRequestException('Checkout session has been cancelled.');
    }
    if (session.status === PayPalCheckoutStatus.REFUNDED) {
      throw new BadRequestException('Checkout session has been refunded.');
    }
    if (session.status === PayPalCheckoutStatus.RECONCILE_REQUIRED) {
      throw new BadRequestException(
        `Checkout session requires manual reconciliation: ${session.failure_reason || session.error_message || 'Discrepancy detected.'}`,
      );
    }
    if (session.status === PayPalCheckoutStatus.PENDING) {
      const order = await this.paypalService.getOrder(session.paypal_order_id);
      const capture =
        order?.purchaseUnits?.[0]?.payments?.captures?.[0] ||
        order?.purchase_units?.[0]?.payments?.captures?.[0];

      if (!capture) {
        if (order?.status === 'VOIDED') {
          session.status = PayPalCheckoutStatus.FAILED;
          session.error_message = 'Order is VOIDED.';
          await session.save();
          throw new BadRequestException(
            'Payment authorization is in status VOIDED. Ticket booking cannot be completed until payment is completed.',
          );
        }
        session.status = PayPalCheckoutStatus.PENDING;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          'Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.',
        );
      }

      const captureId = capture.id;
      const captureStatus = capture.status;
      const providerAmount = capture.amount?.value || capture.amount?.total || '';
      const providerCurrency =
        capture.amount?.currencyCode ||
        capture.amount?.currency_code ||
        '';

      if (!captureId || !captureStatus || !providerAmount || !providerCurrency) {
        if (captureStatus === 'DECLINED' || captureStatus === 'FAILED' || order?.status === 'VOIDED') {
          session.status = PayPalCheckoutStatus.FAILED;
          if (captureId) session.paypal_capture_id = captureId;
          session.error_message = `Payment capture status is ${captureStatus || order?.status || 'FAILED'}.`;
          await session.save();
          throw new BadRequestException(
            `Payment authorization is in status ${captureStatus || order?.status}. Ticket booking cannot be completed until payment is completed.`,
          );
        }
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        if (captureId) {
          session.paypal_capture_id = captureId;
        }
        session.failure_reason = `PayPal capture snapshot is incomplete or missing fields (id: ${captureId || 'missing'}, status: ${captureStatus || 'missing'}, amount: ${providerAmount || 'missing'}, currency: ${providerCurrency || 'missing'}).`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      if (captureStatus === 'COMPLETED') {
        const isAmountMismatch = providerAmount !== session.provider_amount;
        const isCurrencyMismatch = providerCurrency !== session.provider_currency;

        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = isAmountMismatch
            ? `Captured amount ${providerAmount} does not match expected session amount ${session.provider_amount}.`
            : `Captured currency ${providerCurrency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          session.paypal_capture_id = captureId;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }

        session.paypal_capture_id = captureId;
        session.status = PayPalCheckoutStatus.CAPTURED;
        session.error_message = undefined;
        await session.save();
      } else if (captureStatus === 'PENDING') {
        const isAmountMismatch = providerAmount !== session.provider_amount;
        const isCurrencyMismatch = providerCurrency !== session.provider_currency;

        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.failure_reason = isAmountMismatch
            ? `Pending capture amount ${providerAmount} does not match expected session amount ${session.provider_amount}.`
            : `Pending capture currency ${providerCurrency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          session.paypal_capture_id = captureId;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }

        session.paypal_capture_id = captureId;
        session.status = PayPalCheckoutStatus.PENDING;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          'Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.',
        );
      } else if (
        captureStatus === 'DECLINED' ||
        captureStatus === 'FAILED' ||
        order?.status === 'VOIDED'
      ) {
        session.status = PayPalCheckoutStatus.FAILED;
        session.paypal_capture_id = captureId;
        session.error_message = `Payment capture status is ${captureStatus || order?.status || 'FAILED'}.`;
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status ${captureStatus || order?.status}. Ticket booking cannot be completed until payment is completed.`,
        );
      } else {
        // PARTIALLY_REFUNDED, REFUNDED, or any non-standard/unexpected capture status (FIX 9)
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureId;
        session.failure_reason = `Payment capture has non-standard status: ${captureStatus}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }
    }

    // Step 1: Transition CREATED -> CAPTURING
    if (session.status === PayPalCheckoutStatus.CREATED) {
      await this.verifyPreCaptureGate(session, expectedOpType, userId, orderId, role);

      const capturingSession = await this.paypalCheckoutModel.findOneAndUpdate(
        { checkout_id: checkoutId, status: PayPalCheckoutStatus.CREATED },
        { $set: { status: PayPalCheckoutStatus.CAPTURING } },
        { new: true },
      ).exec();

      if (!capturingSession) {
        const current = await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec();
        if (current?.status === PayPalCheckoutStatus.CAPTURING) {
          throw new ConflictException('Payment capture is currently in progress. Please wait.');
        }
        session = current!;
      } else {
        session = capturingSession;
        session.status = PayPalCheckoutStatus.CAPTURING;
      }
    }

    // Step 2: CAPTURING owns provider capture
    if (session.status === PayPalCheckoutStatus.CAPTURING) {
      let captureResult: {
        capture_id: string;
        status: string;
        provider_amount: string;
        provider_currency: string;
      } | null = null;

      try {
        captureResult = await this.paypalService.captureOrder({
          orderId,
          paypalRequestId: `${session.checkout_id}-capture`,
        });
      } catch (capErr: any) {
        this.logger.warn(
          `captureOrder failed for order ${orderId}: ${capErr.message}. Attempting getOrder recovery.`,
        );
        try {
          const order = await this.paypalService.getOrder(orderId);
          const capture =
            order?.purchaseUnits?.[0]?.payments?.captures?.[0] ||
            order?.purchase_units?.[0]?.payments?.captures?.[0];
          if (capture) {
            const capId = capture.id;
            const capStatus = capture.status;
            const capAmt = capture.amount?.value || capture.amount?.total || '';
            const capCur =
              capture.amount?.currencyCode ||
              capture.amount?.currency_code ||
              '';

            if (!capId || !capStatus || !capAmt || !capCur) {
              session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
              if (capId) session.paypal_capture_id = capId;
              session.failure_reason = `PayPal recovery getOrder capture record is incomplete (id: ${capId || 'missing'}, status: ${capStatus || 'missing'}, amount: ${capAmt || 'missing'}, currency: ${capCur || 'missing'}).`;
              session.error_message = session.failure_reason;
              await session.save();
              throw new BadRequestException(session.failure_reason);
            }

            captureResult = {
              capture_id: capId,
              status: capStatus,
              provider_amount: capAmt,
              provider_currency: capCur,
            };
          } else if (order?.status === 'VOIDED') {
            session.status = PayPalCheckoutStatus.FAILED;
            session.error_message = `Order is VOIDED. Capture failed: ${capErr.message}`;
            await session.save();
            throw capErr;
          } else {
            // Ambiguous capture outcome: captureOrder failed and getOrder found no capture
            session.status = PayPalCheckoutStatus.CAPTURING;
            session.error_message = `Ambiguous capture outcome: captureOrder failed (${capErr.message}), no capture found in order state ${order?.status}. Retryable.`;
            await session.save();
            throw capErr;
          }
        } catch (getErr: any) {
          if (getErr === capErr || getErr instanceof BadRequestException) {
            throw getErr;
          }
          // Ambiguous capture outcome: getOrder also failed/timed out
          session.status = PayPalCheckoutStatus.CAPTURING;
          session.error_message = `Ambiguous capture outcome: captureOrder failed (${capErr.message}), getOrder recovery failed (${getErr.message}). Retryable.`;
          await session.save();
          throw capErr;
        }
      }

      if (captureResult.status === 'PENDING') {
        const isAmountMismatch = captureResult.provider_amount !== session.provider_amount;
        const isCurrencyMismatch = captureResult.provider_currency !== session.provider_currency;
        if (isAmountMismatch || isCurrencyMismatch) {
          session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
          session.paypal_capture_id = captureResult.capture_id;
          session.failure_reason = isAmountMismatch
            ? `Pending capture amount ${captureResult.provider_amount} does not match expected session amount ${session.provider_amount}.`
            : `Pending capture currency ${captureResult.provider_currency} does not match expected session currency ${session.provider_currency}.`;
          session.error_message = session.failure_reason;
          await session.save();
          throw new BadRequestException(session.failure_reason);
        }
        session.status = PayPalCheckoutStatus.PENDING;
        session.paypal_capture_id = captureResult.capture_id;
        session.error_message = 'Payment capture is pending provider settlement.';
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status PENDING. Ticket booking cannot be completed until payment is completed.`,
        );
      }

      if (captureResult.status === 'DECLINED' || captureResult.status === 'FAILED') {
        session.status = PayPalCheckoutStatus.FAILED;
        session.paypal_capture_id = captureResult.capture_id;
        session.error_message = `Payment capture status is ${captureResult.status}.`;
        await session.save();
        throw new BadRequestException(
          `Payment authorization is in status ${captureResult.status}. Ticket booking cannot be completed until payment is completed.`,
        );
      }

      if (captureResult.status === 'PARTIALLY_REFUNDED' || captureResult.status === 'REFUNDED') {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureResult.capture_id;
        session.failure_reason = `Payment capture has non-standard status: ${captureResult.status}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      if (captureResult.status !== 'COMPLETED') {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.paypal_capture_id = captureResult.capture_id;
        session.failure_reason = `Payment capture has unexpected status: ${captureResult.status}. Manual reconciliation required.`;
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      session.paypal_capture_id = captureResult.capture_id;
      const isAmountMismatch = captureResult.provider_amount !== session.provider_amount;
      const isCurrencyMismatch = captureResult.provider_currency !== session.provider_currency;
      const isMissingCaptureId = !captureResult.capture_id;

      if (isAmountMismatch || isCurrencyMismatch || isMissingCaptureId) {
        session.status = PayPalCheckoutStatus.RECONCILE_REQUIRED;
        session.failure_reason = isAmountMismatch
          ? `Captured amount ${captureResult.provider_amount} does not match expected session amount ${session.provider_amount}.`
          : isCurrencyMismatch
          ? `Captured currency ${captureResult.provider_currency} does not match expected session currency ${session.provider_currency}.`
          : 'Capture completed but missing capture ID.';
        session.error_message = session.failure_reason;
        await session.save();
        throw new BadRequestException(session.failure_reason);
      }

      session.status = PayPalCheckoutStatus.CAPTURED;
      await session.save();
    }

    // Step 3: CAS Claim CAPTURED -> FINALIZING
    let isWinnerClaimant = false;
    if (session.status === PayPalCheckoutStatus.CAPTURED) {
      const claimed = await this.paypalCheckoutModel.findOneAndUpdate(
        {
          checkout_id: checkoutId,
          status: PayPalCheckoutStatus.CAPTURED,
        },
        {
          $set: {
            status: PayPalCheckoutStatus.FINALIZING,
            finalizing_started_at: new Date(),
          },
        },
        { new: true },
      ).exec();

      if (claimed) {
        session = claimed;
        session.status = PayPalCheckoutStatus.FINALIZING;
        session.finalizing_started_at = new Date();
        isWinnerClaimant = true;
      } else {
        session = (await this.paypalCheckoutModel.findOne({ checkout_id: checkoutId }).exec())!;
      }
    }

    // Step 4: Handle concurrent / non-winner callers in FINALIZING
    if (session.status === PayPalCheckoutStatus.FINALIZING && !isWinnerClaimant) {
      if (session.paypal_capture_id) {
        const existingBooking = await this.bookingModel.findOne({
          'payment_transactions.provider_capture_id': session.paypal_capture_id,
        }).exec();
        if (existingBooking) {
          session.status = PayPalCheckoutStatus.COMPLETED;
          session.result_booking_id = existingBooking._id.toString();
          session.result_confirmation_number = existingBooking.confirmation_number;
          await session.save();
          return { session, existingBooking };
        }
      }

      const startedAt = session.finalizing_started_at
        ? new Date(session.finalizing_started_at).getTime()
        : 0;
      const isStale = Date.now() - startedAt > 60000;

      if (isStale) {
        await this.paypalCheckoutModel.findOneAndUpdate(
          {
            checkout_id: checkoutId,
            status: PayPalCheckoutStatus.FINALIZING,
            finalizing_started_at: session.finalizing_started_at,
          },
          {
            $set: {
              status: PayPalCheckoutStatus.CAPTURED,
              finalizing_started_at: undefined,
            },
          },
        ).exec();
        throw new ConflictException(
          'Checkout finalization timed out or stalled. Recovered to CAPTURED. Please retry to complete finalization.',
        );
      }

      throw new ConflictException('Payment capture is currently finalizing. Please wait.');
    }

    if (session.status === PayPalCheckoutStatus.COMPLETED && session.result_booking_id) {
      const existingBooking = await this.findById(session.result_booking_id);
      return { session, existingBooking };
    }

    if (session.status !== PayPalCheckoutStatus.FINALIZING) {
      throw new BadRequestException(`Checkout session cannot be captured in status: ${session.status}`);
    }

    return { session };
  }

  /**
   * Capture PayPal Order and create Confirmed Booking.
   */
  async capturePayPalBooking(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ booking: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.CREATE_BOOKING,
    );

    if (claimResult.existingBooking) {
      return { booking: claimResult.existingBooking, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const bookingDto = { ...(session.operation_payload as CreateBookingDto), payment_method: PaymentMethod.PAYPAL };
    bookingDto.user_id = userId;
    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const booking = await this.createBooking(bookingDto, externalProof);
      session.status = PayPalCheckoutStatus.COMPLETED;
      session.result_booking_id = booking._id.toString();
      session.result_confirmation_number = booking.confirmation_number;
      await session.save();
      return { booking, checkout_id: checkoutId };
    } catch (createErr: any) {
      await this.executeCompensationRefund(session, createErr, 'Booking creation failed');
      throw createErr;
    }
  }

  /**
   * Create PayPal Order for Hold Confirmation.
   */
  async createPayPalConfirmHoldOrder(
    dto: CreatePayPalConfirmHoldOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    if (!dto.blocking_number) {
      throw new BadRequestException('blocking_number is required.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required.');
    }

    const booking = await this.bookingModel.findOne({ blocking_number: dto.blocking_number }).exec();
    if (!booking) {
      throw new NotFoundException(`Booking with blocking number ${dto.blocking_number} not found`);
    }
    if (booking.status !== BookingStatus.BLOCKED) {
      throw new BadRequestException(`Cannot confirm booking in ${booking.status} status.`);
    }

    // Check hold deadline: fail closed and cancel if expired
    if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
      await this.cancelExpiredBlockStrict(booking);
      throw new BadRequestException(
        'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
      );
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    if (booking.total_amount <= 0) {
      throw new BadRequestException(
        'Hold reservation does not require external PayPal payment (zero amount). Use standard confirm endpoint.',
      );
    }

    const checkoutId = this.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: booking.total_amount,
      clientRequestId: dto.client_request_id,
      description: `Aptech Airlines Hold Confirmation ${booking.pnr_code}`,
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: booking.total_amount,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: { blocking_number: dto.blocking_number },
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: booking.total_amount,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Capture PayPal Order and confirm Hold Booking.
   */
  async capturePayPalConfirmHold(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ booking: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.CONFIRM_HOLD,
    );

    if (claimResult.existingBooking) {
      return { booking: claimResult.existingBooking, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const blockingNumber = session.operation_payload?.blocking_number;
    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const confirmedBooking = await this.confirmTicket(
        { blocking_number: blockingNumber, payment_method: PaymentMethod.PAYPAL, paypal_order_id: session.paypal_order_id },
        externalProof,
      );
      session.status = PayPalCheckoutStatus.COMPLETED;
      session.result_booking_id = confirmedBooking._id.toString();
      session.result_confirmation_number = confirmedBooking.confirmation_number;
      await session.save();
      return { booking: confirmedBooking, checkout_id: checkoutId };
    } catch (confErr: any) {
      await this.executeCompensationRefund(session, confErr, 'Confirm hold failed');
      throw confErr;
    }
  }

  /**
   * Create PayPal Order for Ticket Reschedule Surcharge.
   */
  async createPayPalRescheduleOrder(
    dto: CreatePayPalRescheduleOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    const ident = dto.confirmation_number || dto.pnr_code;
    if (!ident) {
      throw new BadRequestException('Confirmation number or PNR code is required for reschedule.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required.');
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.RESCHEDULE,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    const quote = await this.quoteRescheduleTicket(dto, userId);
    if (quote.price_difference <= 0) {
      throw new BadRequestException(
        'Reschedule does not require external PayPal payment (zero or negative price difference). Use standard reschedule endpoint.',
      );
    }

    const checkoutId = this.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: quote.price_difference,
      clientRequestId: dto.client_request_id,
      description: `Aptech Airlines Reschedule Surcharge ${ident}`,
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.RESCHEDULE,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: quote.price_difference,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: dto,
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.RESCHEDULE,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: quote.price_difference,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Capture PayPal Order and execute Ticket Reschedule.
   */
  async capturePayPalReschedule(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ): Promise<{ result: any; checkout_id: string }> {
    const claimResult = await this.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      PayPalCheckoutOperationType.RESCHEDULE,
    );

    if (claimResult.existingBooking) {
      return { result: { booking: claimResult.existingBooking }, checkout_id: checkoutId };
    }

    const session = claimResult.session;
    if (!session.paypal_order_id) {
      throw new BadRequestException('Session missing paypal_order_id for payment proof.');
    }
    const rescheduleDto = {
      ...(session.operation_payload as RescheduleTicketDto),
      payment_method: PaymentMethod.PAYPAL,
      paypal_order_id: session.paypal_order_id,
    };

    const externalProof: ExternalPaymentProof = {
      payment_method: PaymentMethod.PAYPAL,
      payment_reference: this.generateCode('PAY'),
      expected_amount_vnd: session.amount_vnd,
      provider_order_id: session.paypal_order_id,
      provider_capture_id: session.paypal_capture_id!,
      provider_amount: session.provider_amount,
      provider_currency: session.provider_currency,
      exchange_rate_vnd_per_unit: session.exchange_rate_vnd_per_unit,
      status: 'SUCCESS',
    };

    try {
      const res = await this.rescheduleTicket(rescheduleDto, externalProof);
      session.status = PayPalCheckoutStatus.COMPLETED;
      if (res?.booking?._id) {
        session.result_booking_id = res.booking._id.toString();
        session.result_confirmation_number = res.booking.confirmation_number;
      }
      await session.save();
      return { result: res, checkout_id: checkoutId };
    } catch (resErr: any) {
      await this.executeCompensationRefund(session, resErr, 'Reschedule failed');
      throw resErr;
    }
  }
}
