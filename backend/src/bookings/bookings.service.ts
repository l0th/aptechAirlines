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
import { PaypalRefundScheduler } from '../paypal/paypal-refund.scheduler';
import {
  PayPalCheckoutSession,
  PayPalCheckoutSessionDocument,
  PayPalCheckoutOperationType,
  PayPalCheckoutStatus,
} from '../paypal/paypal-checkout.schema';
import { allocateRefundSources, AllocatedRefundItem } from './refund-allocation.util';
import { BookingsPayPalOrderService } from './bookings-paypal-order.service';
import { BookingsPayPalCaptureService } from './bookings-paypal-capture.service';
import {
  BookingsPayPalBridge,
  BookingsPayPalDependencies,
} from './bookings-paypal.part';
import { BookingsCreateService } from './bookings-create.service';
import { BookingsConfirmService } from './bookings-confirm.service';
import {
  BookingsCoreBridge,
  BookingsCoreDependencies,
} from './bookings-core.part';
import { BookingsRescheduleDirectService } from './bookings-reschedule-direct.service';
import { BookingsRescheduleMixedService } from './bookings-reschedule-mixed.service';
import { BookingsRescheduleConnectingService } from './bookings-reschedule-connecting.service';
import {
  BookingsRescheduleBridge,
  BookingsRescheduleDependencies,
} from './bookings-reschedule.part';
import { BookingsCancellationService } from './bookings-cancellation.service';
import { BookingsQueryRefundService } from './bookings-query-refund.service';
import {
  BookingsLifecycleBridge,
  BookingsLifecycleDependencies,
} from './bookings-lifecycle.part';
import { BookingsQuoteService } from './bookings-quote.service';
import {
  BookingsQuoteBridge,
  BookingsQuoteDependencies,
} from './bookings-quote.part';


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
  private readonly paypalOrderService: BookingsPayPalOrderService;
  private readonly paypalCaptureService: BookingsPayPalCaptureService;
  private readonly createService: BookingsCreateService;
  private readonly confirmService: BookingsConfirmService;
  private readonly rescheduleDirectService: BookingsRescheduleDirectService;
  private readonly rescheduleMixedService: BookingsRescheduleMixedService;
  private readonly rescheduleConnectingService: BookingsRescheduleConnectingService;
  private readonly cancellationService: BookingsCancellationService;
  private readonly queryRefundService: BookingsQueryRefundService;
  private readonly quoteService: BookingsQuoteService;

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
    @Optional() private readonly paypalRefundScheduler?: PaypalRefundScheduler,
  ) {
    const self = this;
    const paypalDeps: BookingsPayPalDependencies = {
      get bookingModel() { return self.bookingModel; },
      get paypalService() { return self.paypalService; },
      get paypalCheckoutModel() { return self.paypalCheckoutModel; },
    };
    const paypalBridge: BookingsPayPalBridge = {
      generateCode: (prefix) => this.generateCode(prefix),
      cancelExpiredBlockStrict: (booking) => this.cancelExpiredBlockStrict(booking),
      quoteBooking: (...args) => this.quoteBooking(...args as Parameters<BookingsService['quoteBooking']>),
      quoteRescheduleTicket: (...args) => this.quoteRescheduleTicket(...args as Parameters<BookingsService['quoteRescheduleTicket']>),
      findById: (...args) => this.findById(...args as Parameters<BookingsService['findById']>),
      createBooking: (...args) => this.createBooking(...args as Parameters<BookingsService['createBooking']>),
      confirmTicket: (...args) => this.confirmTicket(...args as Parameters<BookingsService['confirmTicket']>),
      rescheduleTicket: (...args) => this.rescheduleTicket(...args as Parameters<BookingsService['rescheduleTicket']>),
    };
    this.paypalOrderService = new BookingsPayPalOrderService(paypalDeps, paypalBridge);
    this.paypalCaptureService = new BookingsPayPalCaptureService(paypalDeps, paypalBridge);

    const coreDeps: BookingsCoreDependencies = {
      get bookingModel() { return self.bookingModel; },
      get flightsService() { return self.flightsService; },
      get usersService() { return self.usersService; },
      get seatAllocationService() { return self.seatAllocationService; },
      get sagaModel() { return self.sagaModel; },
      get mailService() { return self.mailService; },
    };
    const coreBridge: BookingsCoreBridge = {
      generateCode: (prefix) => this.generateCode(prefix),
      normalizeLegType: (legType) => normalizeLegType(legType),
      assertPayPalPaymentProof: (proof, amount, context) =>
        assertPayPalPaymentProof(proof, amount, context),
      assertBookableFlight: (flight, context) => this.assertBookableFlight(flight, context),
      validateBookingWindow: (flightOrFlights, directionName) =>
        this.validateBookingWindow(flightOrFlights, directionName),
      validateConnectingFlights: (flights) => this.validateConnectingFlights(flights),
      validateRoundTripLegs: (selectedLegs) => this.validateRoundTripLegs(selectedLegs),
      cancelExpiredBlockStrict: (booking) => this.cancelExpiredBlockStrict(booking),
    };
    this.createService = new BookingsCreateService(coreDeps, coreBridge);
    this.confirmService = new BookingsConfirmService(coreDeps, coreBridge);

    const rescheduleDeps: BookingsRescheduleDependencies = {
      get bookingModel() { return self.bookingModel; },
      get flightsService() { return self.flightsService; },
      get usersService() { return self.usersService; },
      get seatAllocationService() { return self.seatAllocationService; },
      get sagaModel() { return self.sagaModel; },
      get paypalService() { return self.paypalService; },
    };
    const rescheduleBridge: BookingsRescheduleBridge = {
      generateCode: (prefix) => this.generateCode(prefix),
      normalizeLegType: (legType) => normalizeLegType(legType),
      assertPayPalPaymentProof: (proof, amount, context) =>
        assertPayPalPaymentProof(proof, amount, context),
      assertBookableFlight: (flight, context) => this.assertBookableFlight(flight, context),
      validateBookingWindow: (flightOrFlights, directionName) =>
        this.validateBookingWindow(flightOrFlights, directionName),
      validateConnectingFlights: (flights) => this.validateConnectingFlights(flights),
      validateConnectingSequence: (flights, label) => this.validateConnectingSequence(flights, label),
      loadDistinctCouponFlights: (coupons) => this.loadDistinctCouponFlights(coupons),
      distinctCouponLegs: (coupons) => this.distinctCouponLegs(coupons),
      buildCouponWithFare: (passenger, flight, inventory, legType, fare) =>
        this.buildCouponWithFare(passenger, flight, inventory, legType, fare),
      executePostCommitRefunds: (bookingId, refundAllocations, pnrCode) =>
        this.executePostCommitRefunds(bookingId, refundAllocations, pnrCode),
      rescheduleMixedRoundTrip: (...args) =>
        this.rescheduleMixedRoundTrip(...args as Parameters<BookingsService['rescheduleMixedRoundTrip']>),
      rescheduleConnectingTicket: (...args) =>
        this.rescheduleConnectingTicket(...args as Parameters<BookingsService['rescheduleConnectingTicket']>),
    };
    this.rescheduleDirectService = new BookingsRescheduleDirectService(rescheduleDeps, rescheduleBridge);
    this.rescheduleMixedService = new BookingsRescheduleMixedService(rescheduleDeps, rescheduleBridge);
    this.rescheduleConnectingService = new BookingsRescheduleConnectingService(rescheduleDeps, rescheduleBridge);

    const lifecycleDeps: BookingsLifecycleDependencies = {
      get bookingModel() { return self.bookingModel; },
      get flightsService() { return self.flightsService; },
      get usersService() { return self.usersService; },
      get policiesService() { return self.policiesService; },
      get airportsService() { return self.airportsService; },
      get seatAllocationService() { return self.seatAllocationService; },
      get mailService() { return self.mailService; },
      get paypalService() { return self.paypalService; },
      get paypalRefundScheduler() { return self.paypalRefundScheduler; },
    };
    const lifecycleBridge: BookingsLifecycleBridge = {
      generateCode: (prefix) => this.generateCode(prefix),
      getEarliestDeparture: (booking) => this.getEarliestDeparture(booking),
      executePostCommitRefunds: (bookingId, refundAllocations, pnrCode) =>
        this.executePostCommitRefunds(bookingId, refundAllocations, pnrCode),
      releaseSeatsForCouponsStrict: (passengerCount, coupons) =>
        this.releaseSeatsForCouponsStrict(passengerCount, coupons),
    };
    this.cancellationService = new BookingsCancellationService(lifecycleDeps, lifecycleBridge);
    this.queryRefundService = new BookingsQueryRefundService(lifecycleDeps, lifecycleBridge);

    const quoteDeps: BookingsQuoteDependencies = {
      get bookingModel() { return self.bookingModel; },
      get flightsService() { return self.flightsService; },
      get usersService() { return self.usersService; },
      get seatAllocationService() { return self.seatAllocationService; },
      get paypalService() { return self.paypalService; },
    };
    const quoteBridge: BookingsQuoteBridge = {
      loadDistinctCouponFlights: (coupons) => this.loadDistinctCouponFlights(coupons),
      normalizeLegType: (legType) => normalizeLegType(legType),
      assertBookableFlight: (flight, context) => this.assertBookableFlight(flight, context),
      validateBookingWindow: (flightOrFlights, directionName) =>
        this.validateBookingWindow(flightOrFlights, directionName),
      validateConnectingFlights: (flights) => this.validateConnectingFlights(flights),
      validateConnectingSequence: (flights, label) => this.validateConnectingSequence(flights, label),
      validateRoundTripLegs: (selectedLegs) => this.validateRoundTripLegs(selectedLegs),
    };
    this.quoteService = new BookingsQuoteService(quoteDeps, quoteBridge);
  }

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
        `Cannot ${context} flight ${flight.flight_number}: only approved Aptech commercial or admin-created flights are customer-bookable.`,
      );
    }
  }

  /**
   * Requirement 3.4: Make Reservations / Blocking / Direct Buying
   */
  async createBooking(
    dto: CreateBookingDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<BookingDocument> {
    return this.createService.createBooking(dto, externalPaymentProof);
  }

  /**
   * Requirement 3.5: Confirm Blocked Ticket (before 2-week cutoff)
   */
  async confirmTicket(
    dto: ConfirmTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<BookingDocument> {
    return this.confirmService.confirmTicket(dto, externalPaymentProof);
  }

  async rescheduleTicket(
    dto: RescheduleTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    return this.rescheduleDirectService.rescheduleTicket(dto, externalPaymentProof);
  }

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
    return this.rescheduleMixedService.rescheduleMixedRoundTrip(
      booking,
      dto,
      outboundCoupons,
      inboundCoupons,
      outboundIsConnecting,
      returnIsConnecting,
      externalPaymentProof,
    );
  }

  private async rescheduleConnectingTicket(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<{
    booking: BookingDocument;
    price_difference: number;
    message: string;
  }> {
    return this.rescheduleConnectingService.rescheduleConnectingTicket(
      booking,
      dto,
      externalPaymentProof,
    );
  }

  /**
   * Like releaseSeatsForCoupons but THROWS on error (for reschedule critical path).
   */
  private async releaseSeatsForCouponsStrict(passengerCount: number, coupons: any[]) {
    return this.cancellationService.releaseSeatsForCouponsStrict(passengerCount, coupons);
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

  async cancelExpiredBlockStrict(booking: BookingDocument): Promise<void> {
    return this.cancellationService.cancelExpiredBlockStrict(booking);
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
    refund_status: 'NOT_APPLICABLE' | 'PENDING' | 'SUCCESS' | 'FAILED';
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
    return this.cancellationService.cancelTicket(dto);
  }

  /**
   * Requirement 3.9: View Ticket Status (Highlight emergency changes/delays)
   */
  async trackTicket(code: string): Promise<any> {
    return this.queryRefundService.trackTicket(code);
  }

  /**
   * Release the seats held by a booking (one release per distinct
   * flight/inventory pair). Public so the scheduler can reuse it when
   * auto-cancelling expired blocked bookings.
   */
  async releaseSeatsForBooking(booking: BookingDocument) {
    return this.queryRefundService.releaseSeatsForBooking(booking);
  }

  /**
   * Release seats for an arbitrary list of coupons (deduplicated by
   * flight/inventory pair).
   */
  async getEarliestDeparture(booking: BookingDocument): Promise<Date> {
    return this.queryRefundService.getEarliestDeparture(booking);
  }

  /**
   * Ownership pre-check: a CUSTOMER may only manage their own bookings.
   * Staff roles (CLERK/ADMIN/SUPER_ADMIN) bypass the check.
   */
  async assertOwnership(identifier: string, userId: string, role: string): Promise<void> {
    return this.queryRefundService.assertOwnership(identifier, userId, role);
  }

  /**
   * Post-commit PayPal refunds execution with outbox error tracking.
   */
  async executePostCommitRefunds(
    bookingId: any,
    refundAllocations: AllocatedRefundItem[],
    pnrCode: string,
  ): Promise<void> {
    return this.queryRefundService.executePostCommitRefunds(bookingId, refundAllocations, pnrCode);
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
    return this.quoteService.quoteBooking(dto, userId);
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
    return this.quoteService.quoteRescheduleTicket(dto, userId);
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
    return this.paypalCaptureService.verifyPreCaptureGate(
      session,
      expectedOpType,
      userId,
      orderId,
      role,
    );
  }

  async createPayPalBookingOrder(dto: CreatePayPalBookingOrderDto, userId: string) {
    return this.paypalOrderService.createPayPalBookingOrder(dto, userId);
  }

  private async executeCompensationRefund(
    session: PayPalCheckoutSessionDocument,
    bizErr: any,
    contextNote: string,
  ): Promise<void> {
    return this.paypalCaptureService.executeCompensationRefund(session, bizErr, contextNote);
  }

  private async prepareAndClaimPayPalCapture(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
    expectedOpType: PayPalCheckoutOperationType,
  ) {
    return this.paypalCaptureService.prepareAndClaimPayPalCapture(
      checkoutId,
      orderId,
      userId,
      role,
      expectedOpType,
    );
  }

  async capturePayPalBooking(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ) {
    return this.paypalCaptureService.capturePayPalBooking(checkoutId, orderId, userId, role);
  }

  async createPayPalConfirmHoldOrder(dto: CreatePayPalConfirmHoldOrderDto, userId: string) {
    return this.paypalOrderService.createPayPalConfirmHoldOrder(dto, userId);
  }

  async capturePayPalConfirmHold(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ) {
    return this.paypalCaptureService.capturePayPalConfirmHold(checkoutId, orderId, userId, role);
  }

  async createPayPalRescheduleOrder(dto: CreatePayPalRescheduleOrderDto, userId: string) {
    return this.paypalOrderService.createPayPalRescheduleOrder(dto, userId);
  }

  async capturePayPalReschedule(
    checkoutId: string,
    orderId: string,
    userId: string,
    role: string = UserRole.CUSTOMER,
  ) {
    return this.paypalCaptureService.capturePayPalReschedule(checkoutId, orderId, userId, role);
  }
}
