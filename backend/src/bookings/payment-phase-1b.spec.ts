import { BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BookingsService, assertPayPalPaymentProof } from './bookings.service';
import {
  Booking,
  BookingStatus,
  BookingType,
  PaymentMethod,
  PaymentTransaction,
  PassengerType,
  ExternalPaymentProof,
} from './bookings.schema';
import { StrictCustomerGuard } from '../auth/strict-customer.guard';
import { PaypalController } from '../paypal/paypal.controller';
import {
  PayPalCheckoutSession,
  PayPalCheckoutStatus,
  PayPalCheckoutOperationType,
  PayPalCheckoutSessionSchema,
} from '../paypal/paypal-checkout.schema';
import { PaypalService, assertPayPalRefundExecutionSnapshot, classifyPayPalRefundStatus } from '../paypal/paypal.service';
import { PaypalRefundScheduler } from '../paypal/paypal-refund.scheduler';
import { FlightsService } from '../flights/flights.service';
import { FlightStatus } from '../flights/flights.schema';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { MailService } from '../mail/mail.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { allocateRefundSources } from './refund-allocation.util';
import { UserRole } from '../users/users.schema';

describe('Payment Phase 1B.1 Specification Tests (42 Target Verification Tests)', () => {
  let bookingsService: BookingsService;
  let paypalRefundScheduler: PaypalRefundScheduler;
  let bookingModel: any;
  let sessionModel: any;
  let flightsService: any;
  let usersService: any;
  let policiesService: any;
  let mailService: any;
  let paypalService: any;
  let seatAllocationService: any;

  const mockFlight: any = {
    _id: 'f-101',
    flight_number: 'AP-101',
    distance_miles: 700,
    scheduled_departure: new Date(Date.now() + 30 * 86400000), // 30 days in future
    scheduled_arrival: new Date(Date.now() + 30 * 86400000 + 2 * 3600000),
    origin_iata: 'SGN',
    dest_iata: 'HAN',
    status: 'SCHEDULED',
    operator: 'APTECH_AIRLINES',
    aircraft: { model_code: 'A321', model_name: 'Airbus A321' },
    is_bookable: true,
    data_source: 'AIRLABS_COMMERCIALIZED',
    inventories: [
      { _id: 'inv-eco', id: 'inv-eco', available_seats: 50, base_price: 1000000, cabin_class: 'ECONOMY' },
      { _id: 'inv-biz', id: 'inv-biz', available_seats: 10, base_price: 2500000, cabin_class: 'BUSINESS' },
    ],
  };

  const mockCheaperFlight: any = {
    _id: 'f-102',
    flight_number: 'AP-102',
    distance_miles: 700,
    scheduled_departure: new Date(Date.now() + 20 * 86400000),
    scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 2 * 3600000),
    origin_iata: 'SGN',
    dest_iata: 'HAN',
    status: 'SCHEDULED',
    operator: 'APTECH_AIRLINES',
    aircraft: { model_code: 'A321', model_name: 'Airbus A321' },
    is_bookable: true,
    data_source: 'AIRLABS_COMMERCIALIZED',
    inventories: [
      { _id: 'inv-cheap', id: 'inv-cheap', available_seats: 50, base_price: 750000, cabin_class: 'ECONOMY' },
    ],
  };

  beforeEach(async () => {
    bookingModel = function (data: any) {
      return {
        ...data,
        _id: data._id || new Types.ObjectId().toString(),
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
    };
    bookingModel.find = jest.fn().mockReturnThis();
    bookingModel.findById = jest.fn().mockReturnThis();
    bookingModel.findOne = jest.fn().mockReturnThis();
    bookingModel.sort = jest.fn().mockReturnThis();
    bookingModel.populate = jest.fn().mockReturnThis();
    bookingModel.exec = jest.fn();

    sessionModel = function (data: any) {
      return {
        ...data,
        _id: data._id || new Types.ObjectId().toString(),
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
    };
    sessionModel.find = jest.fn().mockReturnThis();
    sessionModel.findById = jest.fn().mockReturnThis();
    sessionModel.findOne = jest.fn().mockReturnThis();
    sessionModel.findOneAndUpdate = jest.fn().mockReturnThis();
    sessionModel.exec = jest.fn();

    flightsService = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === 'f-102') return Promise.resolve(mockCheaperFlight);
        return Promise.resolve(mockFlight);
      }),
      reserveSeats: jest.fn().mockResolvedValue(true),
      updateAvailableSeats: jest.fn().mockResolvedValue(true),
      compensateInventoryReservation: jest.fn().mockResolvedValue(true),
      getAirportTimeZone: jest.fn().mockReturnValue('Asia/Ho_Chi_Minh'),
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({
        _id: 'u-customer-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        sky_miles: 500,
        preferred_credit_card: '4111222233334444',
      }),
      addSkyMiles: jest.fn().mockResolvedValue(true),
      deductSkyMiles: jest.fn().mockResolvedValue(true),
    };

    policiesService = {
      calculateRefundPercentage: jest.fn().mockResolvedValue(80),
    };

    mailService = {
      sendCancellationEmail: jest.fn().mockResolvedValue(true),
      sendBookingConfirmation: jest.fn().mockResolvedValue(true),
    };

    paypalService = {
      isPayPalActive: jest.fn().mockReturnValue(true),
      getPublicConfig: jest.fn().mockReturnValue({
        enabled: true,
        environment: 'sandbox',
        client_id: 'sandbox_client_id_mock',
        presentment_currency: 'USD',
        vnd_per_presentment_unit: 25000,
      }),
      getPresentmentCurrency: jest.fn().mockReturnValue('USD'),
      getVndPerUnit: jest.fn().mockReturnValue(25000),
      convertVndToPresentment: jest.fn().mockImplementation((amountVnd: number) => {
        if (amountVnd === undefined || amountVnd === null || isNaN(amountVnd) || amountVnd < 0) {
          throw new BadRequestException('Invalid VND amount for PayPal conversion.');
        }
        const rate = 25000;
        const val = Math.round((amountVnd / rate) * 100) / 100;
        return {
          provider_amount: val.toFixed(2),
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: rate,
        };
      }),
      createOrder: jest.fn().mockImplementation(async (params: any) => ({
        order_id: `MOCK-ORDER-${Date.now()}`,
        provider_amount: (params.amountVnd / 25000).toFixed(2),
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
      })),
      getOrder: jest.fn().mockImplementation(async (orderId: string) => ({
        id: orderId,
        status: 'COMPLETED',
      })),
      captureOrder: jest.fn().mockImplementation(async (params: any) => ({
        capture_id: `MOCK-CAP-${Date.now()}`,
        status: 'COMPLETED',
        provider_amount: '40.00',
        provider_currency: 'USD',
      })),
      refundCapture: jest.fn().mockImplementation(async (params: any) => ({
        refund_id: `MOCK-REF-${Date.now()}`,
        status: 'COMPLETED',
      })),
      getRefundDetails: jest.fn().mockImplementation(async (refundId: string) => ({
        refund_id: refundId,
        status: 'COMPLETED',
      })),
    };

    seatAllocationService = {
      validateSeatAvailability: jest.fn().mockResolvedValue(undefined),
      calculateSeatFee: jest.fn().mockImplementation((flight: any, seatCode: string) => {
        if (seatCode === 'INVALID_SEAT') {
          throw new BadRequestException('Seat not found in layout catalog');
        }
        return seatCode.startsWith('1') ? 500000 : 0;
      }),
      attemptAllocateSeats: jest.fn().mockResolvedValue({
        allocations: [{ seat_code: '1A', seat_fee: 500000, seat_fee_currency: 'VND' }],
        total_seat_fee_vnd: 500000,
        seat_pricing_snapshots: [],
      }),
      allocateSeats: jest.fn().mockImplementation((params: any) => {
        const pass = params?.passengers || [];
        return Promise.resolve(
          pass.map((p: any, idx: number) => ({
            coupon_number: p.coupon_number || `CPN-${idx + 1}`,
            seat_code: p.seat_code || '12A',
            selection_type: p.selection_type || 'AUTO',
            seat_fee: p.selection_type === 'CHOOSE' ? 500000 : 0,
            pricing_snapshot: null,
          })),
        );
      }),
      releaseAllocations: jest.fn().mockResolvedValue(true),
      confirmAllocations: jest.fn().mockResolvedValue(true),
      releaseHeldAllocations: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        PaypalRefundScheduler,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(PayPalCheckoutSession.name), useValue: sessionModel },
        { provide: FlightsService, useValue: flightsService },
        { provide: UsersService, useValue: usersService },
        { provide: PoliciesService, useValue: policiesService },
        { provide: MailService, useValue: mailService },
        { provide: PaypalService, useValue: paypalService },
        { provide: SeatAllocationService, useValue: seatAllocationService },
      ],
    }).compile();

    bookingsService = module.get<BookingsService>(BookingsService);
    paypalRefundScheduler = module.get<PaypalRefundScheduler>(PaypalRefundScheduler);
  });

  // =========================================================================
  // Suite 1: Pure Pricing Quotes & Parity Validation (6 tests)
  // =========================================================================
  describe('Suite 1: Pure Pricing Quotes & Parity Validation', () => {
    it('1. quoteBooking returns accurate integer VND fares, seat fees, and USD presentment without reservations', async () => {
      const quote = await bookingsService.quoteBooking(
        {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        'u-customer-1',
      );

      expect(quote.total_amount).toBe(1000000);
      expect(Number.isInteger(quote.total_amount)).toBe(true);
      expect(quote.presentment).toBeDefined();
      expect(quote.presentment?.provider_amount).toBe('40.00'); // 1,000,000 / 25,000
      expect(quote.presentment?.provider_currency).toBe('USD');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('2. quoteBooking throws when requested seat does not exist in fleet layout', async () => {
      seatAllocationService.calculateSeatFee.mockImplementationOnce(() => {
        throw new BadRequestException('Seat INVALID_99 not found in layout catalog');
      });

      await expect(
        bookingsService.quoteBooking(
          {
            user_id: 'u-customer-1',
            booking_type: BookingType.ONE_WAY,
            is_block: false,
            passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
            legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
            seat_requests: [{ passenger_index: 0, flight_id: 'f-101', selection_type: 'CHOOSE', seat_code: 'INVALID_99' }],
          },
          'u-customer-1',
        ),
      ).rejects.toThrow('Seat INVALID_99 not found in layout catalog');
    });

    it('3. quoteBooking throws when seat is occupied or held', async () => {
      seatAllocationService.validateSeatAvailability.mockRejectedValueOnce(
        new ConflictException('Seat 12A is already occupied or held.'),
      );

      await expect(
        bookingsService.quoteBooking(
          {
            user_id: 'u-customer-1',
            booking_type: BookingType.ONE_WAY,
            is_block: false,
            passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
            legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
            seat_requests: [{ passenger_index: 0, flight_id: 'f-101', selection_type: 'CHOOSE', seat_code: '12A' }],
          },
          'u-customer-1',
        ),
      ).rejects.toThrow('already occupied or held');
    });

    it('4. quoteBooking throws when seat cabin does not match ticket cabin', async () => {
      seatAllocationService.validateSeatAvailability.mockRejectedValueOnce(
        new BadRequestException('Requested seat 1A cabin (BUSINESS) does not match ticket cabin (ECONOMY).'),
      );

      await expect(
        bookingsService.quoteBooking(
          {
            user_id: 'u-customer-1',
            booking_type: BookingType.ONE_WAY,
            is_block: false,
            passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
            legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
            seat_requests: [{ passenger_index: 0, flight_id: 'f-101', selection_type: 'CHOOSE', seat_code: '1A' }],
          },
          'u-customer-1',
        ),
      ).rejects.toThrow('Requested seat 1A cabin (BUSINESS) does not match ticket cabin (ECONOMY).');
    });

    it('5. quoteRescheduleTicket returns difference and presentment for fare increase', async () => {
      const mockBooking: any = {
        _id: 'b-resc-1',
        confirmation_number: 'CNF-RESC-1',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.ONE_WAY,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        flight_id: 'f-101',
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [{ passenger_name: 'John Doe', price: 1000000 }],
        legs: [{ flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) }],
      };
      bookingModel.exec.mockResolvedValue(mockBooking);

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-biz-flight') {
          return Promise.resolve({
            ...mockFlight,
            _id: 'f-biz-flight',
            inventories: [{ _id: 'inv-biz-only', base_price: 1500000, cabin_class: 'BUSINESS', available_seats: 10 }],
          });
        }
        return Promise.resolve(mockFlight);
      });

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-RESC-1',
          new_flight_id: 'f-biz-flight',
          new_inventory_id: 'inv-biz-only',
        },
        'u-customer-1',
      );

      expect(quote.price_difference).toBe(500000);
      expect(quote.presentment?.provider_amount).toBe('20.00'); // 500,000 / 25,000
      expect(quote.presentment?.provider_currency).toBe('USD');
    });

    it('6. quoteRescheduleTicket returns zero presentment for fare decrease (no surcharge)', async () => {
      const mockBooking: any = {
        _id: 'b-resc-2',
        confirmation_number: 'CNF-RESC-2',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.ONE_WAY,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        flight_id: 'f-101',
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [{ passenger_name: 'John Doe', price: 1000000 }],
        legs: [{ flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) }],
      };
      bookingModel.exec.mockResolvedValue(mockBooking);

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-RESC-2',
          new_flight_id: 'f-102',
          new_inventory_id: 'inv-cheap',
        },
        'u-customer-1',
      );

      expect(quote.price_difference).toBe(-250000); // 750,000 - 1,000,000
      expect(quote.presentment?.provider_amount).toBe('0.00');
    });
  });

  // =========================================================================
  // Suite 2: Reschedule Quote Direction & Branch Parity (4 tests)
  // =========================================================================
  describe('Suite 2: Reschedule Quote Direction & Branch Parity', () => {
    it('7. quoteRescheduleTicket for return-only reschedule excludes unchanged outbound fare', async () => {
      const mockRoundTripBooking: any = {
        _id: 'b-rt-1',
        confirmation_number: 'CNF-RT-1',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.ROUND_TRIP,
        user_id: 'u-customer-1',
        total_amount: 2000000,
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
          { leg_type: 'INBOUND', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
        ],
        legs: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) },
          { leg_type: 'INBOUND', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 35 * 86400000) },
        ],
        tickets: [
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'OUTBOUND' },
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'INBOUND' },
        ],
      };
      bookingModel.exec.mockResolvedValue(mockRoundTripBooking);

      // Return flight rescheduled to more expensive flight (1,200,000 VND)
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-ret-new') {
          return Promise.resolve({
            ...mockFlight,
            _id: 'f-ret-new',
            inventories: [{ _id: 'inv-ret-new', base_price: 1200000, cabin_class: 'ECONOMY', available_seats: 10 }],
          });
        }
        return Promise.resolve(mockFlight);
      });

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-RT-1',
          new_return_flight_id: 'f-ret-new',
          new_return_inventory_id: 'inv-ret-new',
        },
        'u-customer-1',
      );

      // Surcharge must be exactly 1,200,000 - 1,000,000 = 200,000 VND (NOT adding unchanged outbound 1,000,000)
      expect(quote.price_difference).toBe(200000);
      expect(quote.presentment?.provider_amount).toBe('8.00'); // 200,000 / 25,000
    });

    it('8. quoteRescheduleTicket for return-only reschedule excludes unchanged outbound seat fees', async () => {
      const mockRoundTripBooking: any = {
        _id: 'b-rt-2',
        confirmation_number: 'CNF-RT-2',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.ROUND_TRIP,
        user_id: 'u-customer-1',
        total_amount: 2500000,
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 500000 },
          { leg_type: 'INBOUND', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
        ],
        legs: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) },
          { leg_type: 'INBOUND', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 35 * 86400000) },
        ],
        tickets: [
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'OUTBOUND', seat_fee: 500000 },
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'INBOUND', seat_fee: 0 },
        ],
      };
      bookingModel.exec.mockResolvedValue(mockRoundTripBooking);

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-ret-same') {
          return Promise.resolve({
            ...mockFlight,
            _id: 'f-ret-same',
            inventories: [{ _id: 'inv-ret-same', base_price: 1000000, cabin_class: 'ECONOMY', available_seats: 10 }],
          });
        }
        return Promise.resolve(mockFlight);
      });

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-RT-2',
          new_return_flight_id: 'f-ret-same',
          new_return_inventory_id: 'inv-ret-same',
        },
        'u-customer-1',
      );

      // Return leg fare is same (1,000,000 vs 1,000,000). Difference must be 0!
      expect(quote.price_difference).toBe(0);
    });

    it('9. quoteRescheduleTicket matches connecting inbound coupons correctly', async () => {
      const mockConnectingBooking: any = {
        _id: 'b-conn-1',
        confirmation_number: 'CNF-CONN-1',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.ROUND_TRIP,
        user_id: 'u-customer-1',
        total_amount: 3000000,
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
          { leg_type: 'INBOUND_1', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
          { leg_type: 'INBOUND_2', flight_id: 'f-101', fare_paid: 1000000, seat_fee: 0 },
        ],
        legs: [
          { leg_type: 'OUTBOUND', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) },
          { leg_type: 'INBOUND_1', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 35 * 86400000) },
          { leg_type: 'INBOUND_2', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 36 * 86400000) },
        ],
        tickets: [
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'OUTBOUND' },
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'INBOUND_1' },
          { passenger_name: 'John Doe', price: 1000000, leg_type: 'INBOUND_2' },
        ],
      };
      bookingModel.exec.mockResolvedValue(mockConnectingBooking);

      const mockReturnFlight1: any = {
        ...mockFlight,
        _id: 'f-ret-1',
        flight_number: 'AP-201',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        scheduled_departure: new Date(Date.now() + 20 * 86400000),
        scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 80 * 60000),
        inventories: [{ _id: 'inv-inb', base_price: 1100000, cabin_class: 'ECONOMY', available_seats: 10 }],
      };
      const mockReturnFlight2: any = {
        ...mockFlight,
        _id: 'f-ret-2',
        flight_number: 'AP-202',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        scheduled_departure: new Date(Date.now() + 20 * 86400000 + 150 * 60000),
        scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 230 * 60000),
        inventories: [{ _id: 'inv-inb', base_price: 1100000, cabin_class: 'ECONOMY', available_seats: 10 }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-ret-1') return Promise.resolve(mockReturnFlight1);
        if (id === 'f-ret-2') return Promise.resolve(mockReturnFlight2);
        return Promise.resolve(mockFlight);
      });

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-CONN-1',
          new_return_legs: [
            { flight_id: 'f-ret-1', inventory_id: 'inv-inb', leg_type: 'INBOUND_1' },
            { flight_id: 'f-ret-2', inventory_id: 'inv-inb', leg_type: 'INBOUND_2' },
          ],
        },
        'u-customer-1',
      );

      // (1,100,000 + 1,100,000) - (1,000,000 + 1,000,000) = +200,000 VND
      expect(quote.price_difference).toBe(200000);
    });

    it('10. quoteRescheduleTicket for connecting reschedule calculates total price accurately', async () => {
      const mockConnBooking: any = {
        _id: 'b-conn-pure',
        confirmation_number: 'CNF-CONN-PURE',
        status: BookingStatus.CONFIRMED,
        booking_type: BookingType.CONNECTING,
        user_id: 'u-customer-1',
        total_amount: 1500000,
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        legs: [
          { leg_type: 'CONNECTING_1', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) },
          { leg_type: 'CONNECTING_2', flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000 + 4 * 3600000) },
        ],
        tickets: [
          { passenger_name: 'John Doe', price: 750000, leg_type: 'CONNECTING_1' },
          { passenger_name: 'John Doe', price: 750000, leg_type: 'CONNECTING_2' },
        ],
      };
      bookingModel.exec.mockResolvedValue(mockConnBooking);

      const mockConnFlight1: any = {
        ...mockFlight,
        _id: 'f-conn-1',
        flight_number: 'AP-301',
        origin_iata: 'SGN',
        dest_iata: 'DAD',
        scheduled_departure: new Date(Date.now() + 20 * 86400000),
        scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 80 * 60000),
        inventories: [{ _id: 'inv-new-conn', base_price: 900000, cabin_class: 'ECONOMY', available_seats: 10 }],
      };
      const mockConnFlight2: any = {
        ...mockFlight,
        _id: 'f-conn-2',
        flight_number: 'AP-302',
        origin_iata: 'DAD',
        dest_iata: 'HAN',
        scheduled_departure: new Date(Date.now() + 20 * 86400000 + 150 * 60000),
        scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 230 * 60000),
        inventories: [{ _id: 'inv-new-conn', base_price: 900000, cabin_class: 'ECONOMY', available_seats: 10 }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-conn-1') return Promise.resolve(mockConnFlight1);
        if (id === 'f-conn-2') return Promise.resolve(mockConnFlight2);
        return Promise.resolve(mockFlight);
      });

      const quote = await bookingsService.quoteRescheduleTicket(
        {
          confirmation_number: 'CNF-CONN-PURE',
          new_legs: [
            { flight_id: 'f-conn-1', inventory_id: 'inv-new-conn', leg_type: 'CONNECTING_1' },
            { flight_id: 'f-conn-2', inventory_id: 'inv-new-conn', leg_type: 'CONNECTING_2' },
          ],
        },
        'u-customer-1',
      );

      // (900,000 + 900,000) - 1,500,000 = +300,000 VND
      expect(quote.price_difference).toBe(300000);
      expect(quote.presentment?.provider_amount).toBe('12.00'); // 300,000 / 25,000
    });
  });

  // =========================================================================
  // Suite 3: Fail-Closed FX & Exchange Rate Boundaries (4 tests)
  // =========================================================================
  describe('Suite 3: Fail-Closed FX & Exchange Rate Boundaries', () => {
    it('11. convertVndToPresentment throws if rate is missing, NaN, or non-positive', () => {
      const origEnabled = process.env.PAYPAL_ENABLED;
      const origEnv = process.env.PAYPAL_ENV;
      const origClientId = process.env.PAYPAL_CLIENT_ID;
      const origClientSecret = process.env.PAYPAL_CLIENT_SECRET;
      const origRate = process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT;
      const origCurr = process.env.PAYPAL_PRESENTMENT_CURRENCY;
      try {
        process.env.PAYPAL_ENABLED = 'true';
        process.env.PAYPAL_ENV = 'sandbox';
        process.env.PAYPAL_CLIENT_ID = 'test-client';
        process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
        delete process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT;
        process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
        expect(() => new PaypalService()).toThrow('Invalid PAYPAL_VND_PER_PRESENTMENT_UNIT');
      } finally {
        process.env.PAYPAL_ENABLED = origEnabled;
        process.env.PAYPAL_ENV = origEnv;
        process.env.PAYPAL_CLIENT_ID = origClientId;
        process.env.PAYPAL_CLIENT_SECRET = origClientSecret;
        process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = origRate;
        process.env.PAYPAL_PRESENTMENT_CURRENCY = origCurr;
      }
    });

    it('12. allocateRefundSources throws if exchange rate snapshot is missing on PayPal charge', () => {
      const txs: PaymentTransaction[] = [
        {
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_reference: 'PAY-NO-RATE',
          amount: 500000,
          provider_capture_id: 'CAP-NO-RATE',
          provider_amount: '20.00',
          provider_currency: 'USD',
          // exchange_rate_vnd_per_unit omitted!
          status: 'SUCCESS',
          created_at: new Date(),
        },
      ];

      expect(() => allocateRefundSources(txs, 500000, 'REFUND')).toThrow(
        'Incomplete provider provenance for PayPal charge PAY-NO-RATE',
      );
    });

    it('13. PayPalService fails closed if VND_PER_PRESENTMENT_UNIT is invalid', () => {
      const origEnabled = process.env.PAYPAL_ENABLED;
      const origEnv = process.env.PAYPAL_ENV;
      const origClientId = process.env.PAYPAL_CLIENT_ID;
      const origClientSecret = process.env.PAYPAL_CLIENT_SECRET;
      const origRate = process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT;
      const origCurr = process.env.PAYPAL_PRESENTMENT_CURRENCY;
      try {
        process.env.PAYPAL_ENABLED = 'true';
        process.env.PAYPAL_ENV = 'sandbox';
        process.env.PAYPAL_CLIENT_ID = 'test-client';
        process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
        process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '-100';
        process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
        expect(() => new PaypalService()).toThrow('positive numeric rate');
      } finally {
        process.env.PAYPAL_ENABLED = origEnabled;
        process.env.PAYPAL_ENV = origEnv;
        process.env.PAYPAL_CLIENT_ID = origClientId;
        process.env.PAYPAL_CLIENT_SECRET = origClientSecret;
        process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = origRate;
        process.env.PAYPAL_PRESENTMENT_CURRENCY = origCurr;
      }
    });

    it('14. PayPalService enforces USD presentment currency when active', () => {
      const origEnabled = process.env.PAYPAL_ENABLED;
      const origEnv = process.env.PAYPAL_ENV;
      const origClientId = process.env.PAYPAL_CLIENT_ID;
      const origClientSecret = process.env.PAYPAL_CLIENT_SECRET;
      const origRate = process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT;
      const origCurr = process.env.PAYPAL_PRESENTMENT_CURRENCY;
      try {
        process.env.PAYPAL_ENABLED = 'true';
        process.env.PAYPAL_ENV = 'sandbox';
        process.env.PAYPAL_CLIENT_ID = 'test-client';
        process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
        process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';
        process.env.PAYPAL_PRESENTMENT_CURRENCY = 'EUR';
        expect(() => new PaypalService()).toThrow('USD presentment currency');
      } finally {
        process.env.PAYPAL_ENABLED = origEnabled;
        process.env.PAYPAL_ENV = origEnv;
        process.env.PAYPAL_CLIENT_ID = origClientId;
        process.env.PAYPAL_CLIENT_SECRET = origClientSecret;
        process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = origRate;
        process.env.PAYPAL_PRESENTMENT_CURRENCY = origCurr;
      }
    });
  });

  // =========================================================================
  // Suite 4: Race-Safe Checkout Creation & Idempotency (4 tests)
  // =========================================================================
  describe('Suite 4: Race-Safe Checkout Creation & Idempotency', () => {
    it('15. createPayPalBookingOrder creates order with deterministic request ID and persists session', async () => {
      const res = await bookingsService.createPayPalBookingOrder(
        {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
          client_request_id: 'REQ-CLI-001',
        },
        'u-customer-1',
      );

      expect(res.checkout_id).toBeDefined();
      expect(res.order_id).toBeDefined();
      expect(res.amount).toBe('40.00');
      expect(paypalService.createOrder).toHaveBeenCalled();
    });

    it('16. createPayPalBookingOrder catches duplicate key E11000 and refetches existing session', async () => {
      const existingSession: any = {
        _id: 'sess-existing',
        checkout_id: 'CHK-EXISTING',
        client_request_id: 'REQ-RACE-001',
        user_id: 'u-customer-1',
        paypal_order_id: 'ORD-EXISTING-1',
        amount_vnd: 1000000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
      };

      // Mock duplicate key error on save
      let saveAttempts = 0;
      sessionModel = function (data: any) {
        return {
          ...data,
          save: jest.fn().mockImplementation(() => {
            saveAttempts++;
            const err: any = new Error('E11000 duplicate key error collection: sessions index: user_id_1_client_request_id_1_operation_type_1 dup key');
            err.code = 11000;
            throw err;
          }),
        };
      };
      let findOneAttempts16 = 0;
      sessionModel.findOne = jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockImplementation(async () => {
          findOneAttempts16++;
          if (findOneAttempts16 === 1) return null;
          return existingSession;
        }),
      }));

      // Inject updated mock
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const res = await bookingsService.createPayPalBookingOrder(
        {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
          client_request_id: 'REQ-RACE-001',
        },
        'u-customer-1',
      );

      expect(res.checkout_id).toBe('CHK-EXISTING');
      expect(res.order_id).toBe('ORD-EXISTING-1');
      expect(saveAttempts).toBe(1);
    });

    it('17. createPayPalConfirmHoldOrder catches duplicate key E11000 and refetches existing session', async () => {
      const mockBooking: any = {
        _id: 'b-hold-race',
        blocking_number: 'BLK-RACE-1',
        status: BookingStatus.BLOCKED,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        time_limit_deadline: new Date(Date.now() + 5 * 86400000),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockBooking) });

      const existingSession: any = {
        _id: 'sess-hold-exist',
        checkout_id: 'CHK-HOLD-EXIST',
        client_request_id: 'REQ-HOLD-RACE',
        user_id: 'u-customer-1',
        paypal_order_id: 'ORD-HOLD-EXIST',
        amount_vnd: 1000000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
      };

      sessionModel = function (data: any) {
        return {
          ...data,
          save: jest.fn().mockImplementation(() => {
            const err: any = new Error('E11000 duplicate key');
            err.code = 11000;
            throw err;
          }),
        };
      };
      let findOneAttempts17 = 0;
      sessionModel.findOne = jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockImplementation(async () => {
          findOneAttempts17++;
          if (findOneAttempts17 === 1) return null;
          return existingSession;
        }),
      }));
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const res = await bookingsService.createPayPalConfirmHoldOrder({
        blocking_number: 'BLK-RACE-1',
        client_request_id: 'REQ-HOLD-RACE',
      }, 'u-customer-1');

      expect(res.checkout_id).toBe('CHK-HOLD-EXIST');
      expect(res.order_id).toBe('ORD-HOLD-EXIST');
    });

    it('18. createPayPalRescheduleOrder catches duplicate key E11000 and refetches existing session', async () => {
      const mockBooking: any = {
        _id: 'b-resc-race',
        confirmation_number: 'CNF-RESC-RACE',
        status: BookingStatus.CONFIRMED,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [{ passenger_name: 'John Doe', price: 1000000 }],
        legs: [{ flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) }],
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockBooking) });

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-biz-res') {
          return Promise.resolve({
            ...mockFlight,
            _id: 'f-biz-res',
            inventories: [{ _id: 'inv-biz-res', base_price: 1500000, cabin_class: 'BUSINESS', available_seats: 10 }],
          });
        }
        return Promise.resolve(mockFlight);
      });

      const existingSession: any = {
        _id: 'sess-resc-exist',
        checkout_id: 'CHK-RESC-EXIST',
        client_request_id: 'REQ-RESC-RACE',
        user_id: 'u-customer-1',
        paypal_order_id: 'ORD-RESC-EXIST',
        amount_vnd: 500000,
        provider_amount: '20.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
      };

      sessionModel = function (data: any) {
        return {
          ...data,
          save: jest.fn().mockImplementation(() => {
            const err: any = new Error('E11000 duplicate key');
            err.code = 11000;
            throw err;
          }),
        };
      };
      let findOneAttempts18 = 0;
      sessionModel.findOne = jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockImplementation(async () => {
          findOneAttempts18++;
          if (findOneAttempts18 === 1) return null;
          return existingSession;
        }),
      }));
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const res = await bookingsService.createPayPalRescheduleOrder({
        confirmation_number: 'CNF-RESC-RACE',
        new_flight_id: 'f-biz-res',
        new_inventory_id: 'inv-biz-res',
        client_request_id: 'REQ-RESC-RACE',
      }, 'u-customer-1');

      expect(res.checkout_id).toBe('CHK-RESC-EXIST');
      expect(res.order_id).toBe('ORD-RESC-EXIST');
    });
  });

  // =========================================================================
  // Suite 5: Pre-Capture Verification Gate (6 tests)
  // =========================================================================
  describe('Suite 5: Pre-Capture Verification Gate', () => {
    it('19. verifyPreCaptureGate rejects session when user does not own session', async () => {
      const mockSession: any = {
        _id: 'sess-own-1',
        checkout_id: 'CHK-OWN-1',
        user_id: 'u-other-user', // Different user!
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-OWN-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await expect(
        bookingsService.capturePayPalBooking('CHK-OWN-1', 'ORD-OWN-1', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('20. verifyPreCaptureGate rejects session when operation type does not match', async () => {
      const mockSession: any = {
        _id: 'sess-op-1',
        checkout_id: 'CHK-OP-1',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-OP-1',
        operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD, // Expected CREATE_BOOKING!
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await expect(
        bookingsService.capturePayPalBooking('CHK-OP-1', 'ORD-OP-1', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('Operation type mismatch');
    });

    it('21. verifyPreCaptureGate rejects session when order ID does not match', async () => {
      const mockSession: any = {
        _id: 'sess-ord-1',
        checkout_id: 'CHK-ORD-1',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-REAL-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await expect(
        bookingsService.capturePayPalBooking('CHK-ORD-1', 'ORD-ATTACKER-1', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('Order ID mismatch');
    });

    it('22. verifyPreCaptureGate marks CANCELLED and throws when checkout session is expired', async () => {
      const mockSession: any = {
        _id: 'sess-exp-1',
        checkout_id: 'CHK-EXP-1',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-EXP-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        order_expires_at: new Date(Date.now() - 1000), // Expired!
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await expect(
        bookingsService.capturePayPalBooking('CHK-EXP-1', 'ORD-EXP-1', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('Checkout session has expired');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.CANCELLED);
    });

    it('23. verifyPreCaptureGate throws when live booking quote does not match session amount', async () => {
      const mockSession: any = {
        _id: 'sess-quote-chg',
        checkout_id: 'CHK-Q-CHG',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 800000, // Session was for 800,000 VND
        exchange_rate_vnd_per_unit: 25000,
        provider_amount: '32.00',
        provider_currency: 'USD',
        paypal_order_id: 'ORD-Q-CHG',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      // Live flight price is 1,000,000 VND -> mismatch!
      await expect(
        bookingsService.capturePayPalBooking('CHK-Q-CHG', 'ORD-Q-CHG', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('Price quote changed from 800000 to 1000000 VND');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.CANCELLED);
    });

    it('24. verifyPreCaptureGate throws when hold deadline has passed before capture', async () => {
      const mockSession: any = {
        _id: 'sess-hold-exp',
        checkout_id: 'CHK-HOLD-EXP',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        exchange_rate_vnd_per_unit: 25000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        paypal_order_id: 'ORD-HOLD-EXP',
        operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        operation_payload: {
          blocking_number: 'BLK-EXP-1',
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const mockHoldBooking: any = {
        _id: 'b-hold-exp',
        blocking_number: 'BLK-EXP-1',
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() - 3600000), // Deadline passed 1 hour ago
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [],
        legs: [{ flight_id: 'f-101' }],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockHoldBooking) });

      await expect(
        bookingsService.capturePayPalConfirmHold('CHK-HOLD-EXP', 'ORD-HOLD-EXP', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('2-week deadline for this blocked ticket has passed');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.CANCELLED);
    });
  });

  // =========================================================================
  // Suite 6: Capture Verification & Atomic Finalizing Transitions (4 tests)
  // =========================================================================
  describe('Suite 6: Capture Verification & Atomic Finalizing Transitions', () => {
    it('25. capturePayPalBooking transitions to CAPTURING and FINALIZING via state machine', async () => {
      const mockSession: any = {
        _id: 'sess-claim',
        checkout_id: 'CHK-CLAIM',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-CLAIM',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-CLAIM',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        } else if (update.$set?.status === PayPalCheckoutStatus.FINALIZING) {
          mockSession.status = PayPalCheckoutStatus.FINALIZING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await bookingsService.capturePayPalBooking('CHK-CLAIM', 'ORD-CLAIM', 'u-customer-1', UserRole.CUSTOMER);

      expect(sessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ checkout_id: 'CHK-CLAIM', status: PayPalCheckoutStatus.CREATED }),
        { $set: { status: PayPalCheckoutStatus.CAPTURING } },
        { new: true },
      );
      expect(sessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ checkout_id: 'CHK-CLAIM', status: PayPalCheckoutStatus.CAPTURED }),
        expect.objectContaining({ $set: expect.objectContaining({ status: PayPalCheckoutStatus.FINALIZING }) }),
        { new: true },
      );
    });

    it('26. capturePayPalBooking throws ConflictException when session is already FINALIZING', async () => {
      const mockFinalizingSession: any = {
        _id: 'sess-fin',
        checkout_id: 'CHK-FIN',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.FINALIZING, // Already finalizing!
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-FIN',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFinalizingSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      await expect(
        bookingsService.capturePayPalBooking('CHK-FIN', 'ORD-FIN', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(ConflictException);
    });

    it('27. capturePayPalBooking throws when PayPal capture status is PENDING, sets PENDING status and never creates booking', async () => {
      const mockSession: any = {
        _id: 'sess-cap-pend',
        checkout_id: 'CHK-CAP-PEND',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-CAP-PEND',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-CAP-PEND',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      // Mock captureOrder returning PENDING status
      paypalService.captureOrder.mockResolvedValueOnce({
        capture_id: 'CAP-PEND-101',
        status: 'PENDING',
        provider_amount: '40.00',
        provider_currency: 'USD',
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-CAP-PEND', 'ORD-CAP-PEND', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('Payment authorization is in status PENDING');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.PENDING);
      expect(mockSession.paypal_capture_id).toBe('CAP-PEND-101');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('28. capturePayPalBooking throws when captured amount or currency does not match session and sets RECONCILE_REQUIRED', async () => {
      const mockSession: any = {
        _id: 'sess-amt-mismatch',
        checkout_id: 'CHK-AMT-MIS',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-AMT-MIS',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-AMT-MIS',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      // Mock capture returning wrong amount (e.g. 35.00 instead of 40.00)
      paypalService.captureOrder.mockResolvedValueOnce({
        capture_id: 'CAP-WRONG-AMT',
        status: 'COMPLETED',
        provider_amount: '35.00',
        provider_currency: 'USD',
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-AMT-MIS', 'ORD-AMT-MIS', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow('does not match expected session amount');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.paypal_capture_id).toBe('CAP-WRONG-AMT');
    });

    it('28b. capturePayPalBooking recovers from network error during captureOrder using getOrder()', async () => {
      const mockSession: any = {
        _id: 'sess-net-rec',
        checkout_id: 'CHK-NET-REC',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-NET-REC',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-NET-REC',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        } else if (update.$set?.status === PayPalCheckoutStatus.FINALIZING) {
          mockSession.status = PayPalCheckoutStatus.FINALIZING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockRejectedValueOnce(new Error('ETIMEDOUT: Connection reset by peer'));
      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-NET-REC',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-NET-RECOVERED',
                  status: 'COMPLETED',
                  amount: { value: '40.00', currencyCode: 'USD' },
                },
              ],
            },
          },
        ],
      });

      const res = await bookingsService.capturePayPalBooking(
        'CHK-NET-REC',
        'ORD-NET-REC',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockSession.paypal_capture_id).toBe('CAP-NET-RECOVERED');
      expect(mockSession.status).toBe(PayPalCheckoutStatus.COMPLETED);
    });

    it('28c. capturePayPalBooking recovers stale FINALIZING session (>60s) to CAPTURED and throws 409', async () => {
      const staleDate = new Date(Date.now() - 75000);
      const mockStaleSession: any = {
        _id: 'sess-stale',
        checkout_id: 'CHK-STALE',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.FINALIZING,
        finalizing_started_at: staleDate,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-STALE',
        paypal_capture_id: 'CAP-STALE-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockStaleSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURED) {
          mockStaleSession.status = PayPalCheckoutStatus.CAPTURED;
        }
        return { exec: jest.fn().mockResolvedValue(mockStaleSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        bookingsService.capturePayPalBooking('CHK-STALE', 'ORD-STALE', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(ConflictException);

      expect(sessionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          checkout_id: 'CHK-STALE',
          status: PayPalCheckoutStatus.FINALIZING,
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: PayPalCheckoutStatus.CAPTURED }),
        }),
      );
    });

    it('28d. capturePayPalBooking self-heals when DB booking exists with matching provider_capture_id', async () => {
      const mockFinalizingSession: any = {
        _id: 'sess-self-heal',
        checkout_id: 'CHK-HEAL',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.FINALIZING,
        finalizing_started_at: new Date(Date.now() - 5000),
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-HEAL',
        paypal_capture_id: 'CAP-HEAL-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFinalizingSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const existingBooking: any = {
        _id: new Types.ObjectId(),
        confirmation_number: 'CNF-HEALED-999',
        status: BookingStatus.CONFIRMED,
        payment_transactions: [{ provider_capture_id: 'CAP-HEAL-1' }],
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existingBooking) });

      const res = await bookingsService.capturePayPalBooking(
        'CHK-HEAL',
        'ORD-HEAL',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(res.booking.confirmation_number).toBe('CNF-HEALED-999');
      expect(mockFinalizingSession.status).toBe(PayPalCheckoutStatus.COMPLETED);
      expect(mockFinalizingSession.result_booking_id).toBe(existingBooking._id.toString());
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('28e. createBooking allows zero totalAmount with PAYPAL payment method without provider IDs', async () => {
      const zeroAmountDto: any = {
        user_id: 'u-customer-1',
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PAYPAL,
        passengers: [{ first_name: 'Free', last_name: 'Flyer', passenger_type: PassengerType.ADULT }],
        legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
      };

      const freeFlight: any = {
        ...mockFlight,
        flight_number: 'AP-FREE',
        inventories: [{ _id: 'inv-eco', available_seats: 10, base_price: 0, cabin_class: 'ECONOMY' }],
      };
      flightsService.findById.mockResolvedValue(freeFlight);
      seatAllocationService.allocateSeats.mockResolvedValueOnce([
        { coupon_number: 'CPN-FREE-1', seat_code: '12A', seat_fee: 0 },
      ]);

      const booking = await bookingsService.createBooking(zeroAmountDto);

      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.total_amount).toBe(0);
      const paypalTx = booking.payment_transactions.find((tx: any) => tx.payment_method === PaymentMethod.PAYPAL);
      expect(paypalTx).toBeDefined();
      expect(paypalTx.amount).toBe(0);
      expect(paypalTx.provider_order_id).toBeUndefined();
      expect(paypalTx.provider_capture_id).toBeUndefined();
    });
  });

  // =========================================================================
  // Suite 7: Single-Owner SAGA Compensation & Capture Retries (4 tests)
  // =========================================================================
  describe('Suite 7: Single-Owner SAGA Compensation & Capture Retries', () => {
    it('29. capturePayPalBooking successfully commits booking on COMPLETED capture', async () => {
      const mockSession: any = {
        _id: 'sess-success',
        checkout_id: 'CHK-SUCCESS',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-SUCCESS',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-SUCCESS',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const result = await bookingsService.capturePayPalBooking(
        'CHK-SUCCESS',
        'ORD-SUCCESS',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockSession.status).toBe(PayPalCheckoutStatus.COMPLETED);
    });

    it('30. capturePayPalBooking refunds capture with session-compensation-refund idempotency key if commit throws', async () => {
      const mockSession: any = {
        _id: 'sess-saga-fail',
        checkout_id: 'CHK-SAGA-FAIL',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-SAGA-FAIL',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-SAGA-FAIL',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      // Force atomic reserveSeats to fail
      flightsService.reserveSeats.mockResolvedValueOnce(false);

      await expect(
        bookingsService.capturePayPalBooking('CHK-SAGA-FAIL', 'ORD-SAGA-FAIL', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow();

      // Outer capture method initiates compensation refund with exact session-compensation-refund key
      expect(paypalService.refundCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          paypalRequestId: 'CHK-SAGA-FAIL-compensation-refund',
          note: expect.stringContaining('Automated compensation refund'),
        }),
      );
      expect(mockSession.status).toBe(PayPalCheckoutStatus.REFUNDED);
    });

    it('31. capturePayPalBooking capture retry: returns existing booking if session was already COMPLETED', async () => {
      const validBookingId = new Types.ObjectId().toString();
      const mockCompletedSession: any = {
        _id: 'sess-already-done',
        checkout_id: 'CHK-ALREADY-DONE',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.COMPLETED,
        result_booking_id: validBookingId,
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockCompletedSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const mockExistingBooking: any = {
        _id: validBookingId,
        confirmation_number: 'CNF-DONE-123',
        status: BookingStatus.CONFIRMED,
      };
      bookingModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(mockExistingBooking) }),
      });

      const res = await bookingsService.capturePayPalBooking(
        'CHK-ALREADY-DONE',
        'ORD-ANY',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(res.booking.confirmation_number).toBe('CNF-DONE-123');
      expect(paypalService.captureOrder).not.toHaveBeenCalled();
    });

    it('32. internal createBooking never initiates PayPal refund directly (single owner SAGA)', async () => {
      // Direct call to createBooking with an external PayPal proof
      // If booking fails, createBooking does NOT call paypalService.refundCapture directly!
      flightsService.reserveSeats.mockResolvedValueOnce(false);

      const externalProof = {
        payment_method: PaymentMethod.PAYPAL,
        expected_amount_vnd: 1000000,
        provider_order_id: 'ORD-EXT',
        provider_capture_id: 'CAP-EXT',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        status: 'SUCCESS' as const,
        payment_reference: 'PAY-EXT',
      };

      await expect(
        bookingsService.createBooking(
          {
            user_id: 'u-customer-1',
            booking_type: BookingType.ONE_WAY,
            is_block: false,
            passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
            legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
          },
          externalProof,
        ),
      ).rejects.toThrow();

      // paypalService.refundCapture must NOT have been called inside createBooking
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite 8: Hold Booking Pre-Capture Deadline & Validation (3 tests)
  // =========================================================================
  describe('Suite 8: Hold Booking Pre-Capture Deadline & Validation', () => {
    it('33. createPayPalConfirmHoldOrder rejects expired hold and releases seats with ZERO charge', async () => {
      const mockHoldBooking: any = {
        _id: 'b-hold-exp-create',
        blocking_number: 'BLK-EXP-CRT',
        status: BookingStatus.BLOCKED,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        time_limit_deadline: new Date(Date.now() - 3600000), // Expired!
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [],
        legs: [{ flight_id: 'f-101' }],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockHoldBooking) });

      await expect(
        bookingsService.createPayPalConfirmHoldOrder(
          { blocking_number: 'BLK-EXP-CRT', client_request_id: 'REQ-HOLD-EXP' },
          'u-customer-1',
        ),
      ).rejects.toThrow('2-week deadline for this blocked ticket has passed');

      // ZERO charge to PayPal
      expect(paypalService.createOrder).not.toHaveBeenCalled();
      expect(mockHoldBooking.status).toBe(BookingStatus.CANCELLED);
    });

    it('34. capturePayPalConfirmHold rejects expired hold before capture and never charges customer', async () => {
      const mockSession: any = {
        _id: 'sess-hold-exp-cap',
        checkout_id: 'CHK-HOLD-EXP-CAP',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        exchange_rate_vnd_per_unit: 25000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        paypal_order_id: 'ORD-HOLD-EXP-CAP',
        operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        operation_payload: { blocking_number: 'BLK-EXP-CAP' },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const mockHoldBooking: any = {
        _id: 'b-hold-exp-cap',
        blocking_number: 'BLK-EXP-CAP',
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() - 10000), // Expired!
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [],
        tickets: [],
        legs: [{ flight_id: 'f-101' }],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockHoldBooking) });

      await expect(
        bookingsService.capturePayPalConfirmHold(
          'CHK-HOLD-EXP-CAP',
          'ORD-HOLD-EXP-CAP',
          'u-customer-1',
          UserRole.CUSTOMER,
        ),
      ).rejects.toThrow('2-week deadline for this blocked ticket has passed');

      // PayPal capture was NEVER called
      expect(paypalService.captureOrder).not.toHaveBeenCalled();
    });

    it('35. capturePayPalConfirmHold captures and confirms hold booking on valid unexpired hold', async () => {
      const mockSession: any = {
        _id: 'sess-hold-valid',
        checkout_id: 'CHK-HOLD-VALID',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-HOLD-VALID',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        operation_payload: { blocking_number: 'BLK-VALID-1' },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      const mockHoldBooking: any = {
        _id: 'b-hold-valid-1',
        blocking_number: 'BLK-VALID-1',
        status: BookingStatus.BLOCKED,
        user_id: 'u-customer-1',
        total_amount: 1000000,
        time_limit_deadline: new Date(Date.now() + 5 * 86400000), // 5 days valid
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [
          { flight_id: 'f-101', coupon_number: 'CPN-1', status: 'CONFIRMED' },
        ],
        payment_transactions: [],
        tickets: [{ passenger_name: 'John Doe', price: 1000000, ticket_number: 'TKT-1' }],
        legs: [{ flight_id: 'f-101' }],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockHoldBooking) });

      const res = await bookingsService.capturePayPalConfirmHold(
        'CHK-HOLD-VALID',
        'ORD-HOLD-VALID',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(paypalService.captureOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ORD-HOLD-VALID' }),
      );
    });
  });

  // =========================================================================
  // Suite 9: Multi-Source LIFO Refund Allocator & Rounding Parity (4 tests)
  // =========================================================================
  describe('Suite 9: Multi-Source LIFO Refund Allocator & Rounding Parity', () => {
    it('36. allocates full refund to single source PAYMENT preserving method and provider amount', () => {
      const txs: PaymentTransaction[] = [
        {
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PAYPAL,
          payment_reference: 'PAY-PP-FULL',
          amount: 1000000,
          currency: 'VND',
          provider_capture_id: 'CAP-FULL-1',
          provider_amount: '40.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 25000,
          status: 'SUCCESS',
          created_at: new Date('2026-09-01T10:00:00Z'),
        },
      ];

      const allocs = allocateRefundSources(txs, 1000000, 'REFUND');
      expect(allocs.length).toBe(1);
      expect(allocs[0].payment_method).toBe(PaymentMethod.PAYPAL);
      expect(allocs[0].amount).toBe(1000000);
      expect(allocs[0].provider_amount).toBe('40.00');
      expect(allocs[0].status).toBe('PENDING');
    });

    it('37. allocates refund in strict LIFO order across PAYMENT and RESCHEDULE_CHARGE (newest first)', () => {
      const txs: PaymentTransaction[] = [
        {
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          payment_reference: 'PAY-CARD-OLD',
          amount: 1000000,
          card_masked: '**** **** **** 4444',
          status: 'SUCCESS',
          created_at: new Date('2026-09-01T10:00:00Z'),
        },
        {
          transaction_type: 'RESCHEDULE_CHARGE',
          payment_method: PaymentMethod.PAYPAL,
          payment_reference: 'PAY-PP-NEW',
          amount: 500000,
          provider_capture_id: 'CAP-NEW-1',
          provider_amount: '20.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 25000,
          status: 'SUCCESS',
          created_at: new Date('2026-09-10T10:00:00Z'),
        },
      ];

      const allocs = allocateRefundSources(txs, 700000, 'REFUND');
      expect(allocs.length).toBe(2);

      // Item 1: Newer PayPal charge refunded first
      expect(allocs[0].source_payment_reference).toBe('PAY-PP-NEW');
      expect(allocs[0].payment_method).toBe(PaymentMethod.PAYPAL);
      expect(allocs[0].amount).toBe(500000);
      expect(allocs[0].provider_amount).toBe('20.00');

      // Item 2: Older Card charge refunded next
      expect(allocs[1].source_payment_reference).toBe('PAY-CARD-OLD');
      expect(allocs[1].payment_method).toBe(PaymentMethod.PROFILE_CARD);
      expect(allocs[1].amount).toBe(200000);
    });

    it('38. tracks both SUCCESS and PENDING refunds to prevent over-refunding a source', () => {
      const txs: PaymentTransaction[] = [
        {
          transaction_type: 'PAYMENT',
          payment_reference: 'PAY-OVER-1',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1000000,
          status: 'SUCCESS',
          created_at: new Date('2026-09-01T10:00:00Z'),
        },
        {
          transaction_type: 'REFUND',
          source_payment_reference: 'PAY-OVER-1',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 600000,
          status: 'PENDING', // Still pending, but MUST reserve refundable balance!
          created_at: new Date('2026-09-02T10:00:00Z'),
        },
      ];

      const allocs = allocateRefundSources(txs, 500000, 'REFUND');
      // Only 400,000 VND remains available for refund from PAY-OVER-1
      expect(allocs.length).toBe(1);
      expect(allocs[0].amount).toBe(400000);
    });

    it('39. uses exact remaining provider amount on final refund to eliminate cent rounding drift', () => {
      // 1,000,000 VND at rate 25,000 = 40.00 USD
      // First partial refund: 333,333 VND = 13.33 USD
      // Final refund: 666,667 VND -> must use exactly 40.00 - 13.33 = 26.67 USD without drift
      const txs: PaymentTransaction[] = [
        {
          transaction_type: 'PAYMENT',
          payment_reference: 'PAY-DRIFT-1',
          provider_capture_id: 'CAP-DRIFT-1',
          payment_method: PaymentMethod.PAYPAL,
          amount: 1000000,
          provider_amount: '40.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 25000,
          status: 'SUCCESS',
          created_at: new Date('2026-09-01T10:00:00Z'),
        },
        {
          transaction_type: 'REFUND',
          payment_reference: 'REF-DRIFT-1',
          source_payment_reference: 'PAY-DRIFT-1',
          provider_capture_id: 'CAP-DRIFT-1',
          payment_method: PaymentMethod.PAYPAL,
          amount: 333333,
          provider_amount: '13.33',
          provider_currency: 'USD',
          status: 'SUCCESS',
          created_at: new Date('2026-09-02T10:00:00Z'),
        },
      ];

      const allocs = allocateRefundSources(txs, 666667, 'REFUND');
      expect(allocs.length).toBe(1);
      expect(allocs[0].amount).toBe(666667);
      expect(allocs[0].provider_amount).toBe('26.67'); // Exact remaining 40.00 - 13.33
    });
  });

  // =========================================================================
  // Suite 10: Outbox Refund Scheduler & Status Truthfulness (3 tests)
  // =========================================================================
  describe('Suite 10: Outbox Refund Scheduler & Status Truthfulness', () => {
    it('40. discovers PENDING PayPal refunds and executes them with exact payment_reference idempotency key', async () => {
      const mockPendingBooking: any = {
        _id: 'b-pend-1',
        confirmation_number: 'CNF-PEND-1',
        status: BookingStatus.CANCELLED,
        payment_transactions: [
          {
            transaction_type: 'REFUND',
            payment_method: PaymentMethod.PAYPAL,
            payment_reference: 'REF-IDEM-001',
            source_payment_reference: 'PAY-PP-1',
            amount: 500000,
            provider_capture_id: 'CAP-PEND-1',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec.mockResolvedValue([mockPendingBooking]);

      const result = await paypalRefundScheduler.processPendingRefunds();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      // Key must be exact payment_reference without RETRY- prefix
      expect(paypalService.refundCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: 'CAP-PEND-1',
          paypalRequestId: 'REF-IDEM-001',
          providerAmount: '20.00',
        }),
      );

      const tx = mockPendingBooking.payment_transactions[0];
      expect(tx.status).toBe('SUCCESS');
      expect(tx.provider_status).toBe('COMPLETED');
    });

    it('41. applies exponential backoff on failure and flags FAILED after MAX retries (5)', async () => {
      const mockPendingBooking: any = {
        _id: 'b-pend-fail',
        confirmation_number: 'CNF-FAIL-MAX',
        status: BookingStatus.CANCELLED,
        payment_transactions: [
          {
            transaction_type: 'REFUND',
            payment_method: PaymentMethod.PAYPAL,
            payment_reference: 'REF-FAIL-MAX',
            source_payment_reference: 'PAY-FAIL',
            amount: 500000,
            provider_capture_id: 'CAP-FAIL-1',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            status: 'PENDING',
            retry_count: 4, // Next attempt is 5th (MAX)
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec.mockResolvedValue([mockPendingBooking]);
      paypalService.refundCapture.mockRejectedValue(new Error('PayPal API Gateway 500'));

      const result = await paypalRefundScheduler.processPendingRefunds();

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      const tx = mockPendingBooking.payment_transactions[0];
      expect(tx.status).toBe('FAILED');
      expect(tx.retry_count).toBe(5);
      expect(tx.failure_reason).toContain('PayPal API Gateway 500');
    });

    it('42. cancellation email truthfully states PENDING for PayPal refunds and SUCCESS for card', async () => {
      const mockBooking: any = {
        _id: 'b-truth-email',
        confirmation_number: 'CNF-TRUTH-EMAIL',
        status: BookingStatus.CONFIRMED,
        user_id: 'u-customer-1',
        total_amount: 1500000,
        booking_type: BookingType.ONE_WAY,
        legs: [{ flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 30 * 86400000) }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            payment_method: PaymentMethod.PROFILE_CARD,
            payment_reference: 'PAY-CARD-TRUTH',
            amount: 1000000,
            card_masked: '**** **** **** 4444',
            status: 'SUCCESS',
            created_at: new Date('2026-09-01'),
          },
          {
            transaction_type: 'RESCHEDULE_CHARGE',
            payment_method: PaymentMethod.PAYPAL,
            payment_reference: 'PAY-PP-TRUTH',
            amount: 500000,
            provider_capture_id: 'CAP-TRUTH-EMAIL',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            status: 'SUCCESS',
            created_at: new Date('2026-09-05'),
          },
        ],
        passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
        ticket_coupons: [
          { flight_id: 'f-101', inventory_id: 'inv-eco', coupon_number: 'CPN-TRUTH-1', status: 'CONFIRMED' },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      policiesService.calculateRefundPercentage.mockResolvedValue(100);
      paypalService.refundCapture.mockResolvedValueOnce({ refund_id: 'REF-TRUTH-PP', status: 'PENDING' });

      await bookingsService.cancelTicket({ identifier: 'CNF-TRUTH-EMAIL' });

      expect(mailService.sendCancellationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          refundDetails: expect.arrayContaining([
            expect.objectContaining({
              payment_method: PaymentMethod.PAYPAL,
              status: 'PENDING',
              provider_amount: '20.00',
              provider_currency: 'USD',
            }),
            expect.objectContaining({
              payment_method: PaymentMethod.PROFILE_CARD,
              status: 'SUCCESS',
              card_masked: '**** **** **** 4444',
            }),
          ]),
        }),
      );
    });
  });

  describe('Suite 11: Payment Phase 1B.2.1 Closeout Verification Tests', () => {
    it('43. Fix 1: retry on PENDING session checks getOrder and remains PENDING when capture is still PENDING', async () => {
      const mockSession: any = {
        _id: 'sess-pending-retry-1',
        checkout_id: 'CHK-PEND-RETRY-1',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.PENDING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-PEND-RETRY-1',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-PEND-RETRY-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-PEND-RETRY-1',
        status: 'APPROVED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-STILL-PEND',
                  status: 'PENDING',
                  amount: { value: '40.00', currencyCode: 'USD' },
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking(
          'CHK-PEND-RETRY-1',
          'ORD-PEND-RETRY-1',
          'u-customer-1',
          UserRole.CUSTOMER,
        ),
      ).rejects.toThrow('Payment authorization is in status PENDING');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.PENDING);
      expect(mockSession.paypal_capture_id).toBe('CAP-STILL-PEND');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('44. Fix 1: retry on PENDING session transitions to CAPTURED and completes booking when provider capture is now COMPLETED', async () => {
      const mockSession: any = {
        _id: 'sess-pending-comp',
        checkout_id: 'CHK-PEND-COMP',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.PENDING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-PEND-COMP',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-PEND-COMP',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.FINALIZING) {
          mockSession.status = PayPalCheckoutStatus.FINALIZING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-PEND-COMP',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-NOW-RESOLVED',
                  status: 'COMPLETED',
                  amount: { value: '40.00', currencyCode: 'USD' },
                },
              ],
            },
          },
        ],
      });

      const res = await bookingsService.capturePayPalBooking(
        'CHK-PEND-COMP',
        'ORD-PEND-COMP',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(res.booking).toBeDefined();
      expect(mockSession.paypal_capture_id).toBe('CAP-NOW-RESOLVED');
      expect(mockSession.status).toBe(PayPalCheckoutStatus.COMPLETED);
    });

    it('45. Fix 1: ambiguous capture outcome (captureOrder error + getOrder error) keeps session in CAPTURING status (not FAILED)', async () => {
      const mockSession: any = {
        _id: 'sess-amb-timeout',
        checkout_id: 'CHK-AMB-TIMEOUT',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-AMB-TIMEOUT',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-AMB-TIMEOUT',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockRejectedValueOnce(new Error('ETIMEDOUT: Connection reset by peer'));
      paypalService.getOrder.mockRejectedValueOnce(new Error('ECONNREFUSED: Network unreachable'));

      await expect(
        bookingsService.capturePayPalBooking(
          'CHK-AMB-TIMEOUT',
          'ORD-AMB-TIMEOUT',
          'u-customer-1',
          UserRole.CUSTOMER,
        ),
      ).rejects.toThrow('ETIMEDOUT');

      expect(mockSession.status).toBe(PayPalCheckoutStatus.CAPTURING);
      expect(mockSession.error_message).toContain('Ambiguous capture outcome');
    });

    it('46. Fix 1: retry after ambiguous capture outcome in CAPTURING reuses identical ${checkout_id}-capture request key', async () => {
      const mockSession: any = {
        _id: 'sess-amb-retry',
        checkout_id: 'CHK-AMB-RETRY',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CAPTURING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-AMB-RETRY',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        client_request_id: 'REQ-AMB-RETRY',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.FINALIZING) {
          mockSession.status = PayPalCheckoutStatus.FINALIZING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockResolvedValueOnce({
        capture_id: 'CAP-AMB-IDEMP',
        status: 'COMPLETED',
        provider_amount: '40.00',
        provider_currency: 'USD',
      });

      const res = await bookingsService.capturePayPalBooking(
        'CHK-AMB-RETRY',
        'ORD-AMB-RETRY',
        'u-customer-1',
        UserRole.CUSTOMER,
      );

      expect(paypalService.captureOrder).toHaveBeenCalledWith({
        orderId: 'ORD-AMB-RETRY',
        paypalRequestId: 'CHK-AMB-RETRY-capture',
      });
      expect(res.booking).toBeDefined();
      expect(mockSession.status).toBe(PayPalCheckoutStatus.COMPLETED);
    });

    it('47. Fix 2: zero-external-charge flow creates direct booking and confirms hold with 0 createOrder, 0 captureOrder, 0 fake IDs', async () => {
      // 1. Direct booking with totalAmount === 0
      const freeFlight: any = {
        _id: 'f-free',
        flight_number: 'AP-FREE',
        distance_miles: 500,
        scheduled_departure: new Date(Date.now() + 30 * 86400000),
        scheduled_arrival: new Date(Date.now() + 30 * 86400000 + 2 * 3600000),
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        status: 'SCHEDULED',
        operator: 'APTECH_AIRLINES',
        aircraft: { model_code: 'A321', model_name: 'Airbus A321' },
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        inventories: [{ _id: 'inv-free', id: 'inv-free', available_seats: 50, base_price: 0, cabin_class: 'ECONOMY' }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-free') return Promise.resolve(freeFlight);
        return Promise.resolve(mockFlight);
      });
      seatAllocationService.attemptAllocateSeats.mockResolvedValueOnce({
        allocations: [{ seat_code: '12A', seat_fee: 0, seat_fee_currency: 'VND' }],
        total_seat_fee_vnd: 0,
        seat_pricing_snapshots: [],
      });
      seatAllocationService.allocateSeats.mockResolvedValueOnce([
        { coupon_number: 'CPN-FREE-1', seat_code: '12A', seat_fee: 0 },
      ]);

      const booking = await bookingsService.createBooking({
        user_id: 'u-customer-1',
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        passengers: [{ first_name: 'Free', last_name: 'User', passenger_type: PassengerType.ADULT }],
        legs: [{ flight_id: 'f-free', inventory_id: 'inv-free' }],
        payment_method: PaymentMethod.PAYPAL,
      });

      expect(booking).toBeDefined();
      expect(paypalService.createOrder).not.toHaveBeenCalled();
      expect(paypalService.captureOrder).not.toHaveBeenCalled();
      expect(booking.payment_transactions[0].amount).toBe(0);
      expect(booking.payment_transactions[0].payment_method).toBe(PaymentMethod.PAYPAL);
      expect(booking.payment_transactions[0].provider_capture_id).toBeUndefined();

      // 2. Hold confirmation with total_amount === 0
      const mockHoldBooking: any = {
        _id: 'b-hold-zero',
        blocking_number: 'BLK-ZERO-1',
        pnr_code: 'PNR-ZERO-1',
        status: BookingStatus.BLOCKED,
        user_id: 'u-customer-1',
        total_amount: 0,
        booking_type: BookingType.ONE_WAY,
        passengers: [{ first_name: 'Free', last_name: 'User' }],
        legs: [{ flight_id: 'f-free', scheduled_departure: new Date(Date.now() + 30 * 86400000) }],
        payment_transactions: [],
        ticket_coupons: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockHoldBooking) });

      const confirmed = await bookingsService.confirmTicket({
        blocking_number: 'BLK-ZERO-1',
        payment_method: PaymentMethod.PAYPAL,
      });

      expect(confirmed.status).toBe(BookingStatus.CONFIRMED);
      expect(paypalService.createOrder).not.toHaveBeenCalled();
      expect(paypalService.captureOrder).not.toHaveBeenCalled();
      expect(confirmed.payment_transactions[0].amount).toBe(0);
      expect(confirmed.payment_transactions[0].payment_method).toBe(PaymentMethod.PAYPAL);
    });

    it('48. Fix 6: quoteRescheduleTicket throws BadRequestException when seat_request references flight not in target itinerary', async () => {
      const mockExistingBooking: any = {
        _id: 'b-resc-flight-mismatch',
        confirmation_number: 'CNF-RESC-MIS',
        pnr_code: 'PNR-RESC-MIS',
        status: BookingStatus.CONFIRMED,
        user_id: 'u-customer-1',
        booking_type: BookingType.ONE_WAY,
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [
          { flight_id: 'f-101', inventory_id: 'inv-eco', status: 'CONFIRMED' },
        ],
        legs: [{ flight_id: 'f-101', scheduled_departure: new Date(Date.now() + 10 * 86400000) }],
      };
      bookingModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockExistingBooking) });

      await expect(
        bookingsService.quoteRescheduleTicket({
          confirmation_number: 'CNF-RESC-MIS',
          new_flight_id: 'f-102',
          new_inventory_id: 'inv-cheap',
          seat_requests: [
            { passenger_index: 0, flight_id: 'f-999-unrelated', selection_type: 'CHOOSE', seat_code: '12A' },
          ],
        }),
      ).rejects.toThrow('Seat request references flight f-999-unrelated which is not part of the rescheduled itinerary.');
    });

    it('49. Fix 7: createBooking with zero base fare but positive seat fee requires PayPal proof and rejects before reserveSeats', async () => {
      const zeroFareFlight: any = {
        _id: 'f-zero-fare',
        flight_number: 'AP-ZERO',
        distance_miles: 500,
        scheduled_departure: new Date(Date.now() + 30 * 86400000),
        scheduled_arrival: new Date(Date.now() + 30 * 86400000 + 2 * 3600000),
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        status: 'SCHEDULED',
        operator: 'APTECH_AIRLINES',
        aircraft: { model_code: 'A321', model_name: 'Airbus A321' },
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        inventories: [{ _id: 'inv-zero', id: 'inv-zero', available_seats: 50, base_price: 0, cabin_class: 'ECONOMY' }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f-zero-fare') return Promise.resolve(zeroFareFlight);
        return Promise.resolve(mockFlight);
      });

      seatAllocationService.evaluateSeatFee = jest.fn().mockResolvedValue({
        fee_amount: 50000,
        currency: 'VND',
        rule_applied: 'EXIT_ROW_PREMIUM',
      });

      await expect(
        bookingsService.createBooking({
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'Jane', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-zero-fare', inventory_id: 'inv-zero' }],
          seat_requests: [
            { passenger_index: 0, flight_id: 'f-zero-fare', selection_type: 'CHOOSE', seat_code: '12A' },
          ],
          payment_method: PaymentMethod.PAYPAL,
        }),
      ).rejects.toThrow('[createBooking:preflight] Missing PayPal external payment proof');

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });
  });

  describe('Suite 12: Payment Phase 1B.3 Hardening & Boundary Verification Tests', () => {
    describe('StrictCustomerGuard', () => {
      let guard: StrictCustomerGuard;
      beforeEach(() => {
        guard = new StrictCustomerGuard();
      });

      it('50. allows access when user role is strictly CUSTOMER', () => {
        const mockContext: any = {
          switchToHttp: () => ({
            getRequest: () => ({ user: { sub: 'u-1', role: UserRole.CUSTOMER } }),
          }),
        };
        expect(guard.canActivate(mockContext)).toBe(true);
      });

      it('51. returns false when req.user is absent', () => {
        const mockContext: any = {
          switchToHttp: () => ({
            getRequest: () => ({ user: undefined }),
          }),
        };
        expect(guard.canActivate(mockContext)).toBe(false);
      });

      it('52. throws ForbiddenException for SUPER_ADMIN (no bypass)', () => {
        const mockContext: any = {
          switchToHttp: () => ({
            getRequest: () => ({ user: { sub: 'u-admin', role: UserRole.SUPER_ADMIN } }),
          }),
        };
        expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
      });

      it('53. throws ForbiddenException for ADMIN', () => {
        const mockContext: any = {
          switchToHttp: () => ({
            getRequest: () => ({ user: { sub: 'u-admin', role: UserRole.ADMIN } }),
          }),
        };
        expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
      });

      it('54. throws ForbiddenException for CLERK', () => {
        const mockContext: any = {
          switchToHttp: () => ({
            getRequest: () => ({ user: { sub: 'u-clerk', role: UserRole.CLERK } }),
          }),
        };
        expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
      });
    });

    describe('assertPayPalPaymentProof', () => {
      const validProof: ExternalPaymentProof = {
        payment_method: PaymentMethod.PAYPAL,
        payment_reference: 'PAY-123456',
        expected_amount_vnd: 2500000,
        provider_order_id: 'ORD-123',
        provider_capture_id: 'CAP-456',
        provider_amount: '100.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        status: 'SUCCESS',
      };

      it('55. succeeds with authoritative amount matching proof and exact cent rounding', () => {
        expect(() => assertPayPalPaymentProof(validProof, 2500000, 'test-context')).not.toThrow();
      });

      it('56. throws BadRequestException when proof is null or undefined', () => {
        expect(() => assertPayPalPaymentProof(null, 2500000, 'test-context')).toThrow(
          '[test-context] Missing PayPal external payment proof for authoritative amount 2500000 VND.',
        );
      });

      it('57. throws BadRequestException when payment_method is not PAYPAL', () => {
        const proof = { ...validProof, payment_method: PaymentMethod.PROFILE_CARD as any };
        expect(() => assertPayPalPaymentProof(proof, 2500000, 'test-context')).toThrow(
          '[test-context] Invalid payment method in payment proof: expected PAYPAL',
        );
      });

      it('58. throws BadRequestException when status is not SUCCESS', () => {
        const proof = { ...validProof, status: 'PENDING' as any };
        expect(() => assertPayPalPaymentProof(proof, 2500000, 'test-context')).toThrow(
          '[test-context] PayPal payment proof is not successful (status: PENDING).',
        );
      });

      it('59. throws BadRequestException when expected_amount_vnd does not equal authoritativeAmountVnd', () => {
        expect(() => assertPayPalPaymentProof(validProof, 3000000, 'test-context')).toThrow(
          '[test-context] Payment amount mismatch: authoritative amount 3000000 VND does not match proof expected amount 2500000 VND.',
        );
      });

      it('60. throws BadRequestException when provider_order_id or provider_capture_id is missing or empty', () => {
        const emptyOrder = { ...validProof, provider_order_id: '   ' };
        expect(() => assertPayPalPaymentProof(emptyOrder, 2500000, 'test-context')).toThrow(
          '[test-context] PayPal provider_order_id is required.',
        );
        const emptyCapture = { ...validProof, provider_capture_id: '' };
        expect(() => assertPayPalPaymentProof(emptyCapture, 2500000, 'test-context')).toThrow(
          '[test-context] PayPal provider_capture_id is required.',
        );
      });

      it('61. throws BadRequestException when provider_currency is not USD', () => {
        const nonUsd = { ...validProof, provider_currency: 'EUR' };
        expect(() => assertPayPalPaymentProof(nonUsd, 2500000, 'test-context')).toThrow(
          '[test-context] Invalid PayPal presentment currency: expected USD, got EUR.',
        );
      });

      it('62. throws BadRequestException when exchange_rate_vnd_per_unit is non-positive or NaN', () => {
        const invalidRate = { ...validProof, exchange_rate_vnd_per_unit: 0 };
        expect(() => assertPayPalPaymentProof(invalidRate, 2500000, 'test-context')).toThrow(
          '[test-context] Invalid exchange rate in payment proof: 0.',
        );
      });

      it('63. throws BadRequestException when provider_amount does not match converted authoritative amount', () => {
        const wrongAmount = { ...validProof, provider_amount: '99.00' };
        expect(() => assertPayPalPaymentProof(wrongAmount, 2500000, 'test-context')).toThrow(
          '[test-context] PayPal provider_amount (99.00) does not match converted authoritative amount (100.00 USD for 2500000 VND at rate 25000).',
        );
      });
    });

    describe('Admin Refund & Compensation Reconciliation Endpoints', () => {
      let paypalController: PaypalController;

      beforeEach(() => {
        paypalController = new PaypalController(
          paypalService,
          paypalRefundScheduler,
          sessionModel,
          bookingModel,
        );
      });

      it('64. retrySpecificRefund throws NotFoundException if paymentReference does not exist', async () => {
        bookingModel.findOne.mockReturnValue(Promise.resolve(null));
        await expect(
          paypalController.retrySpecificRefund('NON-EXISTENT', { booking_id: 'b-1' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('65. retrySpecificRefund returns ALREADY_COMPLETED if transaction status is SUCCESS', async () => {
        const mockBooking = {
          _id: 'b-1',
          confirmation_number: 'CNF-123',
          payment_transactions: [
            {
              payment_reference: 'REF-ALREADY-DONE',
              payment_method: PaymentMethod.PAYPAL,
              transaction_type: 'REFUND',
              status: 'SUCCESS',
              provider_refund_id: 'RF-DONE-1',
            },
          ],
        };
        bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
        const res = await paypalController.retrySpecificRefund('REF-ALREADY-DONE', { booking_id: 'b-1' });
        expect(res.status).toBe('ALREADY_COMPLETED');
        expect(res.provider_refund_id).toBe('RF-DONE-1');
      });

      it('66. retrySpecificRefund heals status to SUCCESS if PayPal getRefund reports COMPLETED', async () => {
        const mockBooking = {
          _id: 'b-1',
          confirmation_number: 'CNF-123',
          payment_transactions: [
            {
              payment_reference: 'REF-HEAL-1',
              payment_method: PaymentMethod.PAYPAL,
              transaction_type: 'REFUND',
              status: 'PENDING',
              provider_refund_id: 'RF-HEALED-ON-PAYPAL',
              provider_capture_id: 'CAP-1',
              provider_amount: '10.00',
              provider_currency: 'USD',
              exchange_rate_vnd_per_unit: 25000,
            },
          ],
          save: jest.fn().mockResolvedValue(true),
        };
        bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
        paypalService.getRefundDetails = jest.fn().mockResolvedValue({ status: 'COMPLETED' });

        const res = await paypalController.retrySpecificRefund('REF-HEAL-1', { booking_id: 'b-1' });
        expect(res.status).toBe('SUCCESS');
        expect(res.message).toContain('pre-check');
        expect(mockBooking.payment_transactions[0].status).toBe('SUCCESS');
      });

      it('67. retrySpecificRefund invokes refundCapture with payment_reference idempotency key and updates status', async () => {
        const mockBooking = {
          _id: 'b-1',
          confirmation_number: 'CNF-123',
          payment_transactions: [
            {
              payment_reference: 'REF-EXECUTE-1',
              payment_method: PaymentMethod.PAYPAL,
              transaction_type: 'REFUND',
              status: 'FAILED',
              provider_capture_id: 'CAP-EXECUTE-1',
              provider_amount: '20.00',
              provider_currency: 'USD',
              exchange_rate_vnd_per_unit: 25000,
            },
          ],
          save: jest.fn().mockResolvedValue(true),
        };
        bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
        paypalService.refundCapture = jest.fn().mockResolvedValue({
          refund_id: 'RF-NEW-123',
          status: 'COMPLETED',
          amount: '20.00',
          currency: 'USD',
        });

        const res = await paypalController.retrySpecificRefund('REF-EXECUTE-1', { booking_id: 'b-1', reset_retry_count: true });
        expect(paypalService.refundCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            captureId: 'CAP-EXECUTE-1',
            providerAmount: '20.00',
            providerCurrency: 'USD',
            paypalRequestId: 'REF-EXECUTE-1',
          }),
        );
        expect(res.status).toBe('SUCCESS');
        expect(res.provider_refund_id).toBe('RF-NEW-123');
      });

      it('68. reconcileCompensationRefund reconciles RECONCILE_REQUIRED session to REFUNDED', async () => {
        const mockSession = {
          checkout_id: 'CHK-RECON-1',
          status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
          paypal_capture_id: 'CAP-RECON-1',
          provider_amount: '50.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 25000,
          save: jest.fn().mockResolvedValue(true),
        };
        sessionModel.findOne.mockReturnValue(Promise.resolve(mockSession));
        paypalService.refundCapture = jest.fn().mockResolvedValue({
          refund_id: 'RF-RECON-COMP',
          status: 'COMPLETED',
        });

        const res = await paypalController.reconcileCompensationRefund('CHK-RECON-1');
        expect(paypalService.refundCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            captureId: 'CAP-RECON-1',
            paypalRequestId: 'CHK-RECON-1-compensation-refund',
          }),
        );
        expect(res.status).toBe(PayPalCheckoutStatus.REFUNDED);
        expect(res.provider_refund_id).toBe('RF-RECON-COMP');
      });

      it('69. getReconciliationOverview returns accurate overview of troubled sessions and transactions', async () => {
        const mockSessions = [
          {
            checkout_id: 'CHK-TROUBLE-1',
            operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
            status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
            paypal_order_id: 'ORD-1',
            paypal_capture_id: 'CAP-1',
            amount_vnd: 500000,
            provider_amount: '20.00',
            provider_currency: 'USD',
            failure_reason: 'Network error',
          },
        ];
        const mockTroubledBookings = [
          {
            _id: 'b-trouble-1',
            pnr_code: 'PNR999',
            confirmation_number: 'CNF-999',
            payment_transactions: [
              {
                payment_reference: 'REF-TROUBLE-1',
                payment_method: PaymentMethod.PAYPAL,
                transaction_type: 'REFUND',
                amount: 500000,
                provider_amount: '20.00',
                provider_currency: 'USD',
                provider_capture_id: 'CAP-999',
                status: 'FAILED',
                retry_count: 5,
                failure_reason: 'Max retries exceeded',
              },
            ],
          },
        ];

        sessionModel.find = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(mockSessions),
        });

        bookingModel.find = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(mockTroubledBookings),
        });

        const overview = await paypalController.getReconciliationOverview();
        expect(overview.summary.reconcile_required_sessions_count).toBe(1);
        expect(overview.summary.troubled_refunds_count).toBe(1);
        expect(overview.reconcile_required_sessions[0].checkout_id).toBe('CHK-TROUBLE-1');
        expect(overview.troubled_refund_transactions[0].payment_reference).toBe('REF-TROUBLE-1');
      });
    });
  });

  describe('Suite 13: Payment Phase 1B.3.1 Money-State Closeout (24 Test Matrix Items)', () => {
    let paypalController: PaypalController;

    beforeEach(() => {
      paypalController = new PaypalController(
        paypalService,
        paypalRefundScheduler,
        sessionModel,
        bookingModel,
      );
    });

    // 1. legacy unconditional checkout TTL index is removed safely
    it('70. Item 1: dropLegacyCheckoutTtlIndex safely drops only legacy unconditional createdAt TTL index and preserves others', async () => {
      const mockCollection = {
        collectionName: 'paypal_checkout_sessions',
        indexes: jest.fn().mockResolvedValue([
          { v: 2, key: { _id: 1 }, name: '_id_' },
          { v: 2, key: { createdAt: 1 }, name: 'createdAt_1', expireAfterSeconds: 604800 },
          { v: 2, key: { checkout_id: 1 }, name: 'checkout_id_1', unique: true },
          { v: 2, key: { user_id: 1, client_request_id: 1, operation_type: 1 }, name: 'user_client_op_1', unique: true },
        ]),
        dropIndex: jest.fn().mockResolvedValue(true),
      };
      const mockModel = { collection: mockCollection } as any;
      const service = new PaypalService(mockModel);

      const result = await service.dropLegacyCheckoutTtlIndex();
      expect(result.dropped).toBe(true);
      expect(result.droppedIndexName).toBe('createdAt_1');
      expect(mockCollection.dropIndex).toHaveBeenCalledWith('createdAt_1');
      expect(result.preservedIndexes).toEqual(['_id_', 'checkout_id_1', 'user_client_op_1']);
    });

    // 2. unresolved RECONCILE_REQUIRED session is never scheduled for TTL deletion
    it('71. Item 2: unresolved RECONCILE_REQUIRED session is never scheduled for TTL deletion (schema has no TTL)', () => {
      const createdAtProp = (PayPalCheckoutSessionSchema.path('createdAt') as any)?.options;
      expect(createdAtProp?.expires).toBeUndefined();
      const indexes = PayPalCheckoutSessionSchema.indexes();
      const ttlIndex = indexes.find((idx: any) => idx[0]?.createdAt && idx[1]?.expireAfterSeconds);
      expect(ttlIndex).toBeUndefined();
    });

    // 3. unresolved PENDING/CAPTURED/FINALIZING session is retained
    it('72. Item 3: unresolved PENDING/CAPTURED/FINALIZING session is retained indefinitely', async () => {
      const mockCollection = {
        collectionName: 'paypal_checkout_sessions',
        indexes: jest.fn().mockResolvedValue([
          { v: 2, key: { _id: 1 }, name: '_id_' },
          { v: 2, key: { checkout_id: 1 }, name: 'checkout_id_1', unique: true },
        ]),
        dropIndex: jest.fn(),
      };
      const mockModel = { collection: mockCollection } as any;
      const service = new PaypalService(mockModel);
      const res = await service.dropLegacyCheckoutTtlIndex();
      expect(res.dropped).toBe(false);
      expect(mockCollection.dropIndex).not.toHaveBeenCalled();
    });

    // 4. refundCapture rejects missing providerAmount
    it('73. Item 4: refundCapture rejects missing providerAmount and never triggers implicit full refund', async () => {
      const service = new PaypalService();
      await expect(
        service.refundCapture({
          captureId: 'CAP-123',
          providerAmount: '',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-123',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.refundCapture({
          captureId: 'CAP-123',
          providerAmount: undefined as any,
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 5. refundCapture rejects missing providerCurrency
    it('74. Item 5: refundCapture rejects missing or non-USD providerCurrency', async () => {
      const service = new PaypalService();
      await expect(
        service.refundCapture({
          captureId: 'CAP-123',
          providerAmount: '25.00',
          providerCurrency: '',
          paypalRequestId: 'REQ-123',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.refundCapture({
          captureId: 'CAP-123',
          providerAmount: '25.00',
          providerCurrency: 'EUR',
          paypalRequestId: 'REQ-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 6. refundCapture rejects missing PayPal-Request-Id
    it('75. Item 6: refundCapture rejects missing PayPal-Request-Id', async () => {
      const service = new PaypalService();
      await expect(
        service.refundCapture({
          captureId: 'CAP-123',
          providerAmount: '25.00',
          providerCurrency: 'USD',
          paypalRequestId: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 7. executePostCommitRefunds missing provider_amount: provider NOT called, transaction becomes FAILED/reconciliation-visible
    it('76. Item 7: executePostCommitRefunds missing provider_amount: provider NOT called, transaction becomes FAILED', async () => {
      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const refundItems: any[] = [
        {
          payment_reference: 'REF-MISSING-AMT',
          payment_method: PaymentMethod.PAYPAL,
          amount: 500000,
          provider_capture_id: 'CAP-777',
          provider_amount: '',
          provider_currency: 'USD',
          status: 'PENDING',
        },
      ];

      await bookingsService.executePostCommitRefunds('b-test-1', refundItems, 'PNR-TEST');
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(refundItems[0].status).toBe('FAILED');
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b-test-1', 'payment_transactions.payment_reference': 'REF-MISSING-AMT' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
          }),
        }),
      );
    });

    // 8. emergency cancellation missing provider_currency: business remains CANCELLED, provider NOT called, refund marked reconciliation-required/FAILED truthfully
    it('77. Item 8: emergency cancellation missing provider_currency: business remains CANCELLED, provider NOT called, refund marked FAILED', async () => {
      const mockFlightForCancel: any = {
        _id: 'f-cancel-1',
        flight_number: 'AP-CANCEL',
        status: FlightStatus.SCHEDULED,
      };
      const mockBookingForCancel: any = {
        _id: 'b-cancel-1',
        pnr_code: 'PNR-CANCEL',
        user_id: 'u-customer-1',
        total_miles_accrued: 0,
        status: BookingStatus.CONFIRMED,
        flight_id: 'f-cancel-1',
        total_amount: 500000,
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [{ flight_id: 'f-cancel-1', inventory_id: 'inv-1', status: 'ISSUED' }],
        payment_transactions: [
          {
            payment_reference: 'PAY-1',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'PAYMENT',
            amount: 500000,
            provider_capture_id: 'CAP-1',
            provider_amount: '20.00',
            provider_currency: '', // missing currency
            exchange_rate_vnd_per_unit: 25000,
            status: 'SUCCESS',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingForCancel]),
      });

      const flightModel: any = {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockFlightForCancel),
        }),
      };

      const realFlightsService = new FlightsService(
        flightModel,
        bookingModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        usersService,
        seatAllocationService,
        mailService,
        paypalService,
      );
      (realFlightsService as any).updateAvailableSeats = jest.fn().mockResolvedValue(true);

      paypalService.refundCapture.mockClear();

      await realFlightsService.cancelBookingsForFlight(mockFlightForCancel);

      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(mockBookingForCancel.status).toBe(BookingStatus.CANCELLED);
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
          }),
        }),
      );
    });

    // 9. scheduler missing payment_reference: provider NOT called, transaction does not remain invisible PENDING forever
    it('78. Item 9: scheduler missing payment_reference: provider NOT called, transaction marked FAILED to stop infinite loop', async () => {
      const mockBookingWithMissingRef: any = {
        _id: 'b-sched-1',
        confirmation_number: 'CNF-SCHED-1',
        payment_transactions: [
          {
            payment_reference: '',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            provider_capture_id: 'CAP-SCHED-1',
            provider_amount: '10.00',
            provider_currency: 'USD',
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingWithMissingRef]),
      });
      paypalService.refundCapture.mockClear();

      const res = await paypalRefundScheduler.processPendingRefunds();
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(mockBookingWithMissingRef.payment_transactions[0].status).toBe('FAILED');
      expect(mockBookingWithMissingRef.payment_transactions[0].failure_reason).toBe('INCOMPLETE_PAYPAL_REFUND_PROVENANCE');
      expect(mockBookingWithMissingRef.save).toHaveBeenCalled();
      expect(res.failed).toBe(1);
    });

    // 10. scheduler with provider_refund_id + provider PENDING: getRefundDetails called, refundCapture NOT called, local remains PENDING
    it('79. Item 10: scheduler with provider_refund_id + provider PENDING: getRefundDetails called, refundCapture NOT called', async () => {
      const mockBookingWithPendingRefund: any = {
        _id: 'b-sched-2',
        confirmation_number: 'CNF-SCHED-2',
        payment_transactions: [
          {
            payment_reference: 'REF-SCHED-2',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            provider_capture_id: 'CAP-SCHED-2',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            provider_refund_id: 'RF-PENDING-SCHED',
            status: 'PENDING',
            retry_count: 1,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingWithPendingRefund]),
      });
      paypalService.getRefundDetails = jest.fn().mockResolvedValue({
        refund_id: 'RF-PENDING-SCHED',
        status: 'PENDING',
      });
      paypalService.refundCapture.mockClear();

      const res = await paypalRefundScheduler.processPendingRefunds();
      expect(paypalService.getRefundDetails).toHaveBeenCalledWith('RF-PENDING-SCHED', {
        expectedAmount: '20.00',
        expectedCurrency: 'USD',
      });
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(mockBookingWithPendingRefund.payment_transactions[0].status).toBe('PENDING');
      expect(mockBookingWithPendingRefund.payment_transactions[0].next_retry_at).toBeDefined();
      expect(mockBookingWithPendingRefund.save).toHaveBeenCalled();
    });

    // 11. scheduler with provider_refund_id + provider COMPLETED: SUCCESS, refundCapture NOT called
    it('80. Item 11: scheduler with provider_refund_id + provider COMPLETED: reconciles to SUCCESS, refundCapture NOT called', async () => {
      const mockBookingWithCompletedRefund: any = {
        _id: 'b-sched-3',
        confirmation_number: 'CNF-SCHED-3',
        payment_transactions: [
          {
            payment_reference: 'REF-SCHED-3',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            provider_capture_id: 'CAP-SCHED-3',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            provider_refund_id: 'RF-COMPLETED-SCHED',
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingWithCompletedRefund]),
      });
      paypalService.getRefundDetails = jest.fn().mockResolvedValue({
        refund_id: 'RF-COMPLETED-SCHED',
        status: 'COMPLETED',
      });
      paypalService.refundCapture.mockClear();

      const res = await paypalRefundScheduler.processPendingRefunds();
      expect(paypalService.getRefundDetails).toHaveBeenCalled();
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(mockBookingWithCompletedRefund.payment_transactions[0].status).toBe('SUCCESS');
      expect(mockBookingWithCompletedRefund.save).toHaveBeenCalled();
      expect(res.succeeded).toBe(1);
    });

    // 12. manual admin retry with existing PENDING provider_refund_id: getRefundDetails called, refundCapture NOT called
    it('81. Item 12: manual admin retry with existing PENDING provider_refund_id: calls getRefundDetails, refundCapture NOT called', async () => {
      const mockBooking = {
        _id: 'b-admin-1',
        confirmation_number: 'CNF-ADMIN-1',
        payment_transactions: [
          {
            payment_reference: 'REF-ADMIN-PENDING',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            status: 'PENDING',
            provider_refund_id: 'RF-ADMIN-PENDING',
            provider_capture_id: 'CAP-1',
            provider_amount: '15.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
      paypalService.getRefundDetails = jest.fn().mockResolvedValue({
        refund_id: 'RF-ADMIN-PENDING',
        status: 'PENDING',
      });
      paypalService.refundCapture.mockClear();

      const res = await paypalController.retrySpecificRefund('REF-ADMIN-PENDING', { booking_id: 'b-admin-1' });
      expect(paypalService.getRefundDetails).toHaveBeenCalledWith('RF-ADMIN-PENDING', {
        expectedAmount: '15.00',
        expectedCurrency: 'USD',
      });
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(res.status).toBe('PENDING');
      expect(res.message).toContain('PENDING on PayPal');
    });

    // 13. manual admin retry with malformed provenance: provider NOT called
    it('82. Item 13: manual admin retry with malformed provenance: provider NOT called and throws BadRequestException', async () => {
      const mockBooking = {
        _id: 'b-admin-2',
        confirmation_number: 'CNF-ADMIN-2',
        payment_transactions: [
          {
            payment_reference: 'REF-MALFORMED',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            status: 'FAILED',
            provider_capture_id: '', // missing capture id
            provider_amount: '15.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
      paypalService.refundCapture.mockClear();
      paypalService.getRefundDetails.mockClear();

      await expect(
        paypalController.retrySpecificRefund('REF-MALFORMED', { booking_id: 'b-admin-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(paypalService.getRefundDetails).not.toHaveBeenCalled();
    });

    // 14. manual admin retry uses booking_id + payment_reference exact transaction
    it('83. Item 14: manual admin retry uses booking_id + payment_reference for exact transaction query', async () => {
      const mockBooking = {
        _id: 'b-exact-99',
        confirmation_number: 'CNF-EXACT',
        payment_transactions: [
          {
            payment_reference: 'REF-EXACT-1',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            status: 'FAILED',
            provider_capture_id: 'CAP-EXACT-1',
            provider_amount: '15.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne.mockReturnValue(Promise.resolve(mockBooking));
      paypalService.refundCapture = jest.fn().mockResolvedValue({
        refund_id: 'RF-EXACT-DONE',
        status: 'COMPLETED',
      });

      await paypalController.retrySpecificRefund('REF-EXACT-1', { booking_id: 'b-exact-99' });
      expect(bookingModel.findOne).toHaveBeenCalledWith({
        _id: 'b-exact-99',
        'payment_transactions.payment_reference': 'REF-EXACT-1',
      });
    });

    // 15. compensation reconcile with provider_refund_id PENDING: getRefundDetails called, refundCapture NOT called
    it('84. Item 15: compensation reconcile with provider_refund_id PENDING: calls getRefundDetails, refundCapture NOT called', async () => {
      const mockSession = {
        checkout_id: 'CHK-COMP-PENDING',
        status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
        provider_refund_id: 'RF-COMP-PEND',
        paypal_capture_id: 'CAP-COMP-1',
        provider_amount: '30.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue(Promise.resolve(mockSession));
      paypalService.getRefundDetails = jest.fn().mockResolvedValue({
        refund_id: 'RF-COMP-PEND',
        status: 'PENDING',
      });
      paypalService.refundCapture.mockClear();

      const res = await paypalController.reconcileCompensationRefund('CHK-COMP-PENDING');
      expect(paypalService.getRefundDetails).toHaveBeenCalledWith('RF-COMP-PEND', {
        expectedAmount: '30.00',
        expectedCurrency: 'USD',
      });
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(res.status).toBe('PENDING');
      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(res.message).toContain('PENDING');
    });

    // 16. compensation reconcile without provider_refund_id: uses exactly ${checkout_id}-compensation-refund
    it('85. Item 16: compensation reconcile without provider_refund_id uses exactly ${checkout_id}-compensation-refund', async () => {
      const mockSession = {
        checkout_id: 'CHK-COMP-NEW',
        status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
        paypal_capture_id: 'CAP-COMP-NEW',
        provider_amount: '30.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue(Promise.resolve(mockSession));
      paypalService.refundCapture = jest.fn().mockResolvedValue({
        refund_id: 'RF-COMP-NEW-SUCCESS',
        status: 'COMPLETED',
      });

      const res = await paypalController.reconcileCompensationRefund('CHK-COMP-NEW');
      expect(paypalService.refundCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: 'CAP-COMP-NEW',
          providerAmount: '30.00',
          providerCurrency: 'USD',
          paypalRequestId: 'CHK-COMP-NEW-compensation-refund',
        }),
      );
      expect(res.status).toBe(PayPalCheckoutStatus.REFUNDED);
    });

    // 17. compensation reconcile missing provider_amount: provider NOT called
    it('86. Item 17: compensation reconcile missing provider_amount: provider NOT called and throws BadRequestException', async () => {
      const mockSession = {
        checkout_id: 'CHK-COMP-NO-AMT',
        status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
        paypal_capture_id: 'CAP-COMP-NO-AMT',
        provider_amount: '', // missing
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue(Promise.resolve(mockSession));
      paypalService.refundCapture.mockClear();
      paypalService.getRefundDetails.mockClear();

      await expect(
        paypalController.reconcileCompensationRefund('CHK-COMP-NO-AMT'),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(paypalService.getRefundDetails).not.toHaveBeenCalled();
    });

    // 18. getRefundDetails COMPLETED but amount mismatch: never mark local SUCCESS
    it('87. Item 18: getRefundDetails COMPLETED but amount mismatch: throws and never marks local SUCCESS', async () => {
      const mockClient: any = {
        paymentsController: {
          getRefund: jest.fn().mockResolvedValue({
            result: {
              id: 'RF-MISMATCH-AMT',
              status: 'COMPLETED',
              amount: { value: '20.00', currencyCode: 'USD' },
            },
          }),
        },
      };
      const realService = new PaypalService();
      (realService as any).isEnabled = true;
      (realService as any).paymentsController = mockClient.paymentsController;

      await expect(
        realService.getRefundDetails('RF-MISMATCH-AMT', {
          expectedAmount: '25.00',
          expectedCurrency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 19. getRefundDetails currency mismatch: never mark local SUCCESS
    it('88. Item 19: getRefundDetails currency mismatch: throws and never marks local SUCCESS', async () => {
      const mockClient: any = {
        paymentsController: {
          getRefund: jest.fn().mockResolvedValue({
            result: {
              id: 'RF-MISMATCH-CURR',
              status: 'COMPLETED',
              amount: { value: '25.00', currencyCode: 'EUR' },
            },
          }),
        },
      };
      const realService = new PaypalService();
      (realService as any).isEnabled = true;
      (realService as any).paymentsController = mockClient.paymentsController;

      await expect(
        realService.getRefundDetails('RF-MISMATCH-CURR', {
          expectedAmount: '25.00',
          expectedCurrency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 20. reconciliation overview exposes stale unresolved checkout states
    it('89. Item 20: reconciliation overview exposes stale unresolved checkout states (PENDING, CAPTURING, CAPTURED, FINALIZING)', async () => {
      const staleDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago (>15 min threshold)
      const mockSessions = [
        {
          checkout_id: 'CHK-STALE-CAPTURING',
          operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
          status: PayPalCheckoutStatus.CAPTURING,
          paypal_order_id: 'ORD-STALE-1',
          amount_vnd: 500000,
          provider_amount: '20.00',
          provider_currency: 'USD',
          createdAt: staleDate,
        },
      ];

      sessionModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockSessions),
      });

      bookingModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      const overview = await paypalController.getReconciliationOverview();
      expect(overview.summary.stale_unresolved_sessions_count).toBe(1);
      expect(overview.summary.total_troubled_sessions_count).toBe(1);
      expect(overview.reconcile_required_sessions[0].checkout_id).toBe('CHK-STALE-CAPTURING');
      expect(overview.reconcile_required_sessions[0].status).toBe(PayPalCheckoutStatus.CAPTURING);
    });

    // 21. reconciliation overview exposes malformed refund provenance
    it('90. Item 21: reconciliation overview exposes malformed refund provenance (missing ref, amount, capture_id)', async () => {
      const mockTroubledBookings = [
        {
          _id: 'b-malformed-1',
          pnr_code: 'PNR-MAL',
          confirmation_number: 'CNF-MAL',
          payment_transactions: [
            {
              payment_reference: '', // missing
              payment_method: PaymentMethod.PAYPAL,
              transaction_type: 'REFUND',
              amount: 500000,
              provider_amount: '', // missing
              provider_currency: 'USD',
              provider_capture_id: 'CAP-MAL',
              status: 'PENDING',
              retry_count: 0,
            },
          ],
        },
      ];

      sessionModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      bookingModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockTroubledBookings),
      });

      const overview = await paypalController.getReconciliationOverview();
      expect(overview.summary.troubled_refunds_count).toBe(1);
      expect(overview.troubled_refund_transactions[0].provider_capture_id).toBe('CAP-MAL');
    });

    // 22. direct booking proof uses persisted session paypal_order_id only
    it('91. Item 22: direct booking proof strictly uses session.paypal_order_id and throws if absent', async () => {
      const mockSessionWithoutOrderId: any = {
        checkout_id: 'CHK-NO-ORD-1',
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        status: PayPalCheckoutStatus.FINALIZING,
        user_id: 'u-customer-1',
        amount_vnd: 1000000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        paypal_capture_id: 'CAP-1',
        paypal_order_id: undefined, // missing
        operation_payload: {},
      };

      sessionModel.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSessionWithoutOrderId),
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-NO-ORD-1', 'ORD-CLIENT-INPUT', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);
    });

    // 23. hold proof uses persisted session paypal_order_id only
    it('92. Item 23: hold proof strictly uses session.paypal_order_id and throws if absent', async () => {
      const mockSessionWithoutOrderId: any = {
        checkout_id: 'CHK-NO-ORD-HOLD',
        operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        status: PayPalCheckoutStatus.FINALIZING,
        user_id: 'u-customer-1',
        amount_vnd: 1000000,
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        paypal_capture_id: 'CAP-HOLD',
        paypal_order_id: undefined, // missing
        operation_payload: { blocking_number: 'BLK-123' },
      };

      sessionModel.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSessionWithoutOrderId),
      });

      await expect(
        bookingsService.capturePayPalConfirmHold('CHK-NO-ORD-HOLD', 'ORD-CLIENT-INPUT', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);
    });

    // 24. reschedule proof uses persisted session paypal_order_id only
    it('93. Item 24: reschedule proof strictly uses session.paypal_order_id and throws if absent', async () => {
      const mockSessionWithoutOrderId: any = {
        checkout_id: 'CHK-NO-ORD-RESCHED',
        operation_type: PayPalCheckoutOperationType.RESCHEDULE,
        status: PayPalCheckoutStatus.FINALIZING,
        user_id: 'u-customer-1',
        amount_vnd: 500000,
        provider_amount: '20.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        paypal_capture_id: 'CAP-RESCHED',
        paypal_order_id: undefined, // missing
        operation_payload: {},
      };

      sessionModel.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSessionWithoutOrderId),
      });

      await expect(
        bookingsService.capturePayPalReschedule('CHK-NO-ORD-RESCHED', 'ORD-CLIENT-INPUT', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Suite 14: Payment Phase 1B.3.2 Final Pre-Sandbox Closeout (16 Tests)
  // =========================================================================
  describe('Suite 14: Payment Phase 1B.3.2 Final Pre-Sandbox Closeout (Fail-Closed Provenance & Boundary Retries)', () => {
    let paypalController: PaypalController;

    beforeEach(() => {
      paypalController = new PaypalController(
        paypalService,
        paypalRefundScheduler,
        sessionModel,
        bookingModel,
      );
    });

    // 1. executePostCommitRefunds missing exchange_rate_vnd_per_unit: provider NOT called, marked FAILED
    it('94. Item 1: executePostCommitRefunds missing exchange_rate_vnd_per_unit: provider NOT called, marked FAILED with INCOMPLETE_PAYPAL_REFUND_PROVENANCE', async () => {
      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const refundItems: any[] = [
        {
          payment_reference: 'REF-MISSING-FX',
          payment_method: PaymentMethod.PAYPAL,
          amount: 500000,
          provider_capture_id: 'CAP-FX-1',
          provider_amount: '20.00',
          provider_currency: 'USD',
          // exchange_rate_vnd_per_unit is missing
          status: 'PENDING',
        },
      ];

      paypalService.refundCapture.mockClear();
      await bookingsService.executePostCommitRefunds('b-test-fx', refundItems, 'PNR-FX');
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(refundItems[0].status).toBe('FAILED');
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b-test-fx', 'payment_transactions.payment_reference': 'REF-MISSING-FX' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
          }),
        }),
      );
    });

    // 2. executePostCommitRefunds non-positive exchange_rate_vnd_per_unit: provider NOT called, marked FAILED
    it('95. Item 2: executePostCommitRefunds non-positive exchange_rate_vnd_per_unit: provider NOT called, marked FAILED', async () => {
      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const refundItems: any[] = [
        {
          payment_reference: 'REF-ZERO-FX',
          payment_method: PaymentMethod.PAYPAL,
          amount: 500000,
          provider_capture_id: 'CAP-FX-2',
          provider_amount: '20.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 0,
          status: 'PENDING',
        },
      ];

      paypalService.refundCapture.mockClear();
      await bookingsService.executePostCommitRefunds('b-test-fx2', refundItems, 'PNR-FX2');
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(refundItems[0].status).toBe('FAILED');
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b-test-fx2', 'payment_transactions.payment_reference': 'REF-ZERO-FX' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
          }),
        }),
      );
    });

    // 3. emergency cancellation (cancelBookingsForFlight) missing exchange_rate_vnd_per_unit: business remains CANCELLED, provider NOT called, refund marked FAILED
    it('96. Item 3: emergency cancellation (cancelBookingsForFlight) missing exchange_rate_vnd_per_unit: business remains CANCELLED, provider NOT called, refund marked FAILED', async () => {
      const mockFlightForCancel: any = {
        _id: 'f-cancel-fx',
        flight_number: 'AP-CANCEL-FX',
        status: FlightStatus.SCHEDULED,
      };
      const mockBookingForCancel: any = {
        _id: 'b-cancel-fx',
        pnr_code: 'PNR-CANCEL-FX',
        user_id: 'u-customer-1',
        total_miles_accrued: 0,
        status: BookingStatus.CONFIRMED,
        flight_id: 'f-cancel-fx',
        total_amount: 500000,
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [{ flight_id: 'f-cancel-fx', inventory_id: 'inv-1', status: 'ISSUED' }],
        payment_transactions: [
          {
            payment_reference: 'PAY-NO-FX',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'PAYMENT',
            amount: 500000,
            provider_capture_id: 'CAP-NO-FX',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            status: 'SUCCESS',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingForCancel]),
      });

      const refundUtil = require('./refund-allocation.util');
      const refundSpy = jest.spyOn(refundUtil, 'allocateRefundSources').mockReturnValueOnce([
        {
          transaction_type: 'REFUND',
          payment_reference: 'REF-NO-FX-ALLOC',
          source_payment_reference: 'PAY-NO-FX',
          payment_method: PaymentMethod.PAYPAL,
          amount: 500000,
          currency: 'VND',
          provider_capture_id: 'CAP-NO-FX',
          provider_amount: '20.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: undefined, // Missing FX in allocation snapshot!
          status: 'PENDING',
        },
      ]);

      const flightModel: any = {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockFlightForCancel),
        }),
      };

      const realFlightsService = new FlightsService(
        flightModel,
        bookingModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        usersService,
        seatAllocationService,
        mailService,
        paypalService,
      );
      (realFlightsService as any).updateAvailableSeats = jest.fn().mockResolvedValue(true);
      paypalService.refundCapture.mockClear();

      await realFlightsService.cancelBookingsForFlight(mockFlightForCancel);

      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(mockBookingForCancel.status).toBe(BookingStatus.CANCELLED);
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
          }),
        }),
      );
      refundSpy.mockRestore();
    });

    // 4. scheduler (processPendingRefunds) missing exchange_rate_vnd_per_unit: provider NOT called, marked FAILED
    it('97. Item 4: scheduler (processPendingRefunds) missing exchange_rate_vnd_per_unit: provider NOT called, transaction marked FAILED', async () => {
      const mockPendingBooking: any = {
        _id: 'b-pend-no-fx',
        confirmation_number: 'CNF-PEND-NO-FX',
        status: BookingStatus.CANCELLED,
        payment_transactions: [
          {
            transaction_type: 'REFUND',
            payment_method: PaymentMethod.PAYPAL,
            payment_reference: 'REF-NO-FX',
            source_payment_reference: 'PAY-1',
            amount: 500000,
            provider_capture_id: 'CAP-NO-FX',
            provider_amount: '20.00',
            provider_currency: 'USD',
            // exchange_rate_vnd_per_unit missing
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec = jest.fn().mockResolvedValue([mockPendingBooking]);
      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockPendingBooking]),
      });
      paypalService.refundCapture.mockClear();

      const result = await paypalRefundScheduler.processPendingRefunds();

      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      const tx = mockPendingBooking.payment_transactions[0];
      expect(tx.status).toBe('FAILED');
      expect(tx.failure_reason).toBe('INCOMPLETE_PAYPAL_REFUND_PROVENANCE');
    });

    // 5. scheduler (processPendingRefunds) non-positive exchange_rate_vnd_per_unit: provider NOT called, marked FAILED
    it('98. Item 5: scheduler (processPendingRefunds) non-positive exchange_rate_vnd_per_unit: provider NOT called, transaction marked FAILED', async () => {
      const mockPendingBooking: any = {
        _id: 'b-pend-neg-fx',
        confirmation_number: 'CNF-PEND-NEG-FX',
        status: BookingStatus.CANCELLED,
        payment_transactions: [
          {
            transaction_type: 'REFUND',
            payment_method: PaymentMethod.PAYPAL,
            payment_reference: 'REF-NEG-FX',
            source_payment_reference: 'PAY-1',
            amount: 500000,
            provider_capture_id: 'CAP-NEG-FX',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: -100,
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec = jest.fn().mockResolvedValue([mockPendingBooking]);
      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockPendingBooking]),
      });
      paypalService.refundCapture.mockClear();

      const result = await paypalRefundScheduler.processPendingRefunds();

      expect(paypalService.refundCapture).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      const tx = mockPendingBooking.payment_transactions[0];
      expect(tx.status).toBe('FAILED');
      expect(tx.failure_reason).toBe('INCOMPLETE_PAYPAL_REFUND_PROVENANCE');
    });

    // 6. manual admin retry throws BadRequestException when booking_id is missing from request body
    it('99. Item 6: manual admin retry throws BadRequestException when booking_id is missing from request body', async () => {
      await expect(
        paypalController.retrySpecificRefund('REF-NO-BID', {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    // 7. manual admin retry throws BadRequestException when booking_id is empty or whitespace
    it('100. Item 7: manual admin retry throws BadRequestException when booking_id is empty or whitespace', async () => {
      await expect(
        paypalController.retrySpecificRefund('REF-BLANK-BID', { booking_id: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 8. manual admin retry throws NotFoundException when booking_id does not match payment_reference
    it('101. Item 8: manual admin retry throws NotFoundException when booking_id does not match payment_reference', async () => {
      bookingModel.findOne = jest.fn().mockReturnValue(Promise.resolve(null));

      await expect(
        paypalController.retrySpecificRefund('REF-NOT-FOUND', { booking_id: 'b-wrong-id' }),
      ).rejects.toThrow(NotFoundException);
      expect(bookingModel.findOne).toHaveBeenCalledWith({
        _id: 'b-wrong-id',
        'payment_transactions.payment_reference': 'REF-NOT-FOUND',
      });
    });

    // 9. manual admin retry with transaction missing exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called
    it('102. Item 9: manual admin retry with transaction missing exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called', async () => {
      const mockBooking = {
        _id: 'b-admin-no-fx',
        confirmation_number: 'CNF-ADMIN-NO-FX',
        payment_transactions: [
          {
            payment_reference: 'REF-ADMIN-NO-FX',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            status: 'FAILED',
            provider_capture_id: 'CAP-ADMIN-1',
            provider_amount: '15.00',
            provider_currency: 'USD',
            // exchange_rate_vnd_per_unit missing
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne = jest.fn().mockReturnValue(Promise.resolve(mockBooking));
      paypalService.refundCapture.mockClear();

      await expect(
        paypalController.retrySpecificRefund('REF-ADMIN-NO-FX', { booking_id: 'b-admin-no-fx' }),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
    });

    // 10. manual admin retry with transaction having non-positive exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called
    it('103. Item 10: manual admin retry with transaction having non-positive exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called', async () => {
      const mockBooking = {
        _id: 'b-admin-zero-fx',
        confirmation_number: 'CNF-ADMIN-ZERO-FX',
        payment_transactions: [
          {
            payment_reference: 'REF-ADMIN-ZERO-FX',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            status: 'FAILED',
            provider_capture_id: 'CAP-ADMIN-2',
            provider_amount: '15.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 0,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.findOne = jest.fn().mockReturnValue(Promise.resolve(mockBooking));
      paypalService.refundCapture.mockClear();

      await expect(
        paypalController.retrySpecificRefund('REF-ADMIN-ZERO-FX', { booking_id: 'b-admin-zero-fx' }),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
    });

    // 11. compensation reconcile with session missing exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called
    it('104. Item 11: compensation reconcile with session missing exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called', async () => {
      const mockSession = {
        checkout_id: 'CHK-NO-FX-RECON',
        status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
        paypal_capture_id: 'CAP-NO-FX',
        provider_amount: '30.00',
        provider_currency: 'USD',
        // exchange_rate_vnd_per_unit missing
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne = jest.fn().mockReturnValue(Promise.resolve(mockSession));
      paypalService.refundCapture.mockClear();

      await expect(
        paypalController.reconcileCompensationRefund('CHK-NO-FX-RECON'),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
    });

    // 12. compensation reconcile with session having non-positive exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called
    it('105. Item 12: compensation reconcile with session having non-positive exchange_rate_vnd_per_unit throws BadRequestException and provider NOT called', async () => {
      const mockSession = {
        checkout_id: 'CHK-NEG-FX-RECON',
        status: PayPalCheckoutStatus.RECONCILE_REQUIRED,
        paypal_capture_id: 'CAP-NEG-FX',
        provider_amount: '30.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: -25000,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne = jest.fn().mockReturnValue(Promise.resolve(mockSession));
      paypalService.refundCapture.mockClear();

      await expect(
        paypalController.reconcileCompensationRefund('CHK-NEG-FX-RECON'),
      ).rejects.toThrow(BadRequestException);
      expect(paypalService.refundCapture).not.toHaveBeenCalled();
    });

    // 13. refundCapture throws BadRequestException if PayPal returns amount different from requested
    it('106. Item 13: refundCapture throws BadRequestException if PayPal returns amount different from requested', async () => {
      const mockPaymentsController = {
        refundCapture: jest.fn().mockResolvedValue({
          result: {
            id: 'RF-WRONG-AMT-1',
            status: 'COMPLETED',
            amount: { value: '18.00', currencyCode: 'USD' },
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      await expect(
        realPaypalService.refundCapture({
          captureId: 'CAP-1',
          providerAmount: '20.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 14. refundCapture throws BadRequestException if PayPal returns currency different from requested
    it('107. Item 14: refundCapture throws BadRequestException if PayPal returns currency different from requested', async () => {
      const mockPaymentsController = {
        refundCapture: jest.fn().mockResolvedValue({
          result: {
            id: 'RF-WRONG-CURR-1',
            status: 'COMPLETED',
            amount: { value: '20.00', currencyCode: 'EUR' },
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      await expect(
        realPaypalService.refundCapture({
          captureId: 'CAP-1',
          providerAmount: '20.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 15. refundCapture throws BadRequestException if PayPal response lacks amount or currency
    it('108. Item 15: refundCapture throws BadRequestException if PayPal response lacks amount or currency', async () => {
      const mockPaymentsController = {
        refundCapture: jest.fn().mockResolvedValue({
          result: {
            id: 'RF-NO-AMT-1',
            status: 'COMPLETED',
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      await expect(
        realPaypalService.refundCapture({
          captureId: 'CAP-1',
          providerAmount: '20.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // 16. getRefundDetails throws BadRequestException when returned refund id does not match requested refund id
    it('109. Item 16: getRefundDetails throws BadRequestException when returned refund id does not match requested refund id', async () => {
      const mockPaymentsController = {
        getRefund: jest.fn().mockResolvedValue({
          result: {
            id: 'RF-DIFFERENT-ID',
            status: 'COMPLETED',
            amount: { value: '20.00', currencyCode: 'USD' },
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      await expect(
        realPaypalService.getRefundDetails('RF-REQUESTED-ID', {
          expectedAmount: '20.00',
          expectedCurrency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('15. Payment Phase 1B.3.3: Strict Provider-Status & Capture-Snapshot Regression Tests', () => {
    // 1. classifyPayPalRefundStatus mapping
    it('110. Item 1: classifyPayPalRefundStatus accurately classifies COMPLETED, PENDING, FAILED, CANCELLED and fails closed on unknown', () => {
      // COMPLETED -> SUCCESS
      const comp = classifyPayPalRefundStatus('COMPLETED');
      expect(comp.local_status).toBe('SUCCESS');
      expect(comp.provider_status).toBe('COMPLETED');
      expect(comp.is_success).toBe(true);
      expect(comp.is_pending).toBe(false);
      expect(comp.is_failed).toBe(false);

      // PENDING -> PENDING
      const pend = classifyPayPalRefundStatus('PENDING');
      expect(pend.local_status).toBe('PENDING');
      expect(pend.provider_status).toBe('PENDING');
      expect(pend.is_success).toBe(false);
      expect(pend.is_pending).toBe(true);
      expect(pend.is_failed).toBe(false);

      // FAILED -> FAILED
      const fail = classifyPayPalRefundStatus('FAILED');
      expect(fail.local_status).toBe('FAILED');
      expect(fail.provider_status).toBe('FAILED');
      expect(fail.is_success).toBe(false);
      expect(fail.is_pending).toBe(false);
      expect(fail.is_failed).toBe(true);

      // CANCELLED -> FAILED
      const canc = classifyPayPalRefundStatus('CANCELLED');
      expect(canc.local_status).toBe('FAILED');
      expect(canc.provider_status).toBe('CANCELLED');
      expect(canc.is_success).toBe(false);
      expect(canc.is_pending).toBe(false);
      expect(canc.is_failed).toBe(true);

      // Unknown / empty / null fails closed
      expect(() => classifyPayPalRefundStatus('UNKNOWN')).toThrow(BadRequestException);
      expect(() => classifyPayPalRefundStatus('')).toThrow(BadRequestException);
      expect(() => classifyPayPalRefundStatus(null as any)).toThrow(BadRequestException);
      expect(() => classifyPayPalRefundStatus(undefined as any)).toThrow(BadRequestException);
    });

    // 2. refundCapture validates refund.status strictly in COMPLETED, PENDING, FAILED, CANCELLED; throws BadRequestException on unknown or missing
    it('111. Item 2: refundCapture validates refund.status strictly and throws BadRequestException on unknown or missing status', async () => {
      const mockPaymentsController = {
        refundCapturedPayment: jest.fn(),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      // Unknown status throws
      mockPaymentsController.refundCapturedPayment.mockResolvedValueOnce({
        result: { id: 'RF-INV-STATUS', status: 'UNKNOWN_STATE', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      await expect(
        realPaypalService.refundCapture({
          captureId: 'CAP-1',
          providerAmount: '20.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-STATUS-1',
        }),
      ).rejects.toThrow(BadRequestException);

      // Missing status throws
      mockPaymentsController.refundCapturedPayment.mockResolvedValueOnce({
        result: { id: 'RF-NO-STATUS', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      await expect(
        realPaypalService.refundCapture({
          captureId: 'CAP-1',
          providerAmount: '20.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-STATUS-2',
        }),
      ).rejects.toThrow(BadRequestException);

      // Valid FAILED status succeeds and returns status: 'FAILED'
      mockPaymentsController.refundCapturedPayment.mockResolvedValueOnce({
        result: { id: 'RF-FAILED-OK', status: 'FAILED', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      const res = await realPaypalService.refundCapture({
        captureId: 'CAP-1',
        providerAmount: '20.00',
        providerCurrency: 'USD',
        paypalRequestId: 'REQ-STATUS-3',
      });
      expect(res.status).toBe('FAILED');
      expect(res.refund_id).toBe('RF-FAILED-OK');
    });

    // 3. getRefundDetails validates refund.status strictly in COMPLETED, PENDING, FAILED, CANCELLED; throws BadRequestException on unknown or missing
    it('112. Item 3: getRefundDetails validates refund.status strictly and throws BadRequestException on unknown or missing status', async () => {
      const mockPaymentsController = {
        getRefund: jest.fn(),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).paymentsController = mockPaymentsController;

      // Unknown status throws
      mockPaymentsController.getRefund.mockResolvedValueOnce({
        result: { id: 'RF-QRY-1', status: 'CORRUPTED', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      await expect(
        realPaypalService.getRefundDetails('RF-QRY-1', { expectedAmount: '20.00', expectedCurrency: 'USD' }),
      ).rejects.toThrow(BadRequestException);

      // Missing status throws
      mockPaymentsController.getRefund.mockResolvedValueOnce({
        result: { id: 'RF-QRY-2', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      await expect(
        realPaypalService.getRefundDetails('RF-QRY-2', { expectedAmount: '20.00', expectedCurrency: 'USD' }),
      ).rejects.toThrow(BadRequestException);

      // Valid PENDING status succeeds
      mockPaymentsController.getRefund.mockResolvedValueOnce({
        result: { id: 'RF-QRY-3', status: 'PENDING', amount: { value: '20.00', currencyCode: 'USD' } },
      });
      const res = await realPaypalService.getRefundDetails('RF-QRY-3', { expectedAmount: '20.00', expectedCurrency: 'USD' });
      expect(res.status).toBe('PENDING');
      expect(res.refund_id).toBe('RF-QRY-3');
    });

    // 4. executePostCommitRefunds: when PayPal returns FAILED or CANCELLED, local transaction status is marked FAILED, provider_status recorded, next_retry_at null
    it('113. Item 4: executePostCommitRefunds marks transaction FAILED with next_retry_at=null when PayPal returns FAILED or CANCELLED', async () => {
      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const refundItems: any[] = [
        {
          payment_reference: 'REF-POST-FAIL',
          payment_method: PaymentMethod.PAYPAL,
          amount: 500000,
          provider_capture_id: 'CAP-FAIL-1',
          provider_amount: '20.00',
          provider_currency: 'USD',
          exchange_rate_vnd_per_unit: 25000,
          status: 'PENDING',
        },
      ];

      paypalService.refundCapture.mockResolvedValueOnce({
        refund_id: 'RF-GW-FAIL',
        status: 'FAILED',
        amount: '20.00',
        currency: 'USD',
      });

      await bookingsService.executePostCommitRefunds('b-test-p15', refundItems, 'PNR-POST-FAIL');

      expect(refundItems[0].status).toBe('FAILED');
      expect(refundItems[0].provider_status).toBe('FAILED');
      expect(refundItems[0].failure_reason).toBe('PayPal refund returned status: FAILED');
      expect(refundItems[0].next_retry_at).toBeNull();
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b-test-p15', 'payment_transactions.payment_reference': 'REF-POST-FAIL' },
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.provider_status': 'FAILED',
            'payment_transactions.$.failure_reason': 'PayPal refund returned status: FAILED',
            'payment_transactions.$.next_retry_at': null,
          }),
        }),
      );
    });

    // 5. executeCompensationRefund: when PayPal returns PENDING, session status is RECONCILE_REQUIRED with provider_refund_status=PENDING
    it('114. Item 5: executeCompensationRefund sets RECONCILE_REQUIRED and provider_refund_status=PENDING when refund returns PENDING', async () => {
      const mockSession: any = {
        checkout_id: 'CHK-COMP-PENDING',
        paypal_capture_id: 'CAP-COMP-1',
        provider_amount: '30.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        status: PayPalCheckoutStatus.CAPTURED,
        save: jest.fn().mockResolvedValue(true),
      };

      paypalService.refundCapture.mockResolvedValueOnce({
        refund_id: 'RF-COMP-PENDING',
        status: 'PENDING',
        amount: '30.00',
        currency: 'USD',
      });

      await (bookingsService as any).executeCompensationRefund(
        mockSession,
        new Error('Inventory confirmation failed'),
        'Booking creation failed',
      );

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.provider_refund_status).toBe('PENDING');
      expect(mockSession.provider_refund_id).toBe('RF-COMP-PENDING');
      expect(mockSession.failure_reason).toContain('Refund status is PENDING');
      expect(mockSession.save).toHaveBeenCalled();
    });

    // 6. executeCompensationRefund: when PayPal returns FAILED or CANCELLED, session status is RECONCILE_REQUIRED with provider_refund_status truthfully recorded
    it('115. Item 6: executeCompensationRefund sets RECONCILE_REQUIRED and records provider_refund_status when refund returns CANCELLED', async () => {
      const mockSession: any = {
        checkout_id: 'CHK-COMP-CANCELLED',
        paypal_capture_id: 'CAP-COMP-2',
        provider_amount: '30.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        status: PayPalCheckoutStatus.CAPTURED,
        save: jest.fn().mockResolvedValue(true),
      };

      paypalService.refundCapture.mockResolvedValueOnce({
        refund_id: 'RF-COMP-CANC',
        status: 'CANCELLED',
        amount: '30.00',
        currency: 'USD',
      });

      await (bookingsService as any).executeCompensationRefund(
        mockSession,
        new Error('Seat allocation failure'),
        'Seat assignment failed',
      );

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.provider_refund_status).toBe('CANCELLED');
      expect(mockSession.provider_refund_id).toBe('RF-COMP-CANC');
      expect(mockSession.failure_reason).toContain('Refund status is CANCELLED');
      expect(mockSession.save).toHaveBeenCalled();
    });

    // 7. cancelBookingsForFlight: when PayPal returns FAILED or CANCELLED, local refund transaction is marked FAILED (not PENDING), next_retry_at is null, flight remains CANCELLED
    it('116. Item 7: cancelBookingsForFlight marks local refund transaction FAILED with next_retry_at=null when PayPal refund returns CANCELLED', async () => {
      const mockFlightForCancel: any = {
        _id: 'f-cancel-p15',
        flight_number: 'AP-P15',
        status: FlightStatus.SCHEDULED,
      };
      const mockBookingForCancel: any = {
        _id: 'b-cancel-p15',
        pnr_code: 'PNR-P15-CANC',
        user_id: 'u-customer-1',
        total_miles_accrued: 0,
        status: BookingStatus.CONFIRMED,
        flight_id: 'f-cancel-p15',
        total_amount: 500000,
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [{ flight_id: 'f-cancel-p15', inventory_id: 'inv-1', status: 'ISSUED' }],
        payment_transactions: [
          {
            payment_reference: 'PAY-P15-1',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'PAYMENT',
            amount: 500000,
            provider_capture_id: 'CAP-P15-1',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            status: 'SUCCESS',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingForCancel]),
      });

      const flightModel: any = {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockFlightForCancel),
        }),
      };

      const realFlightsService = new FlightsService(
        flightModel,
        bookingModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        usersService,
        seatAllocationService,
        mailService,
        paypalService,
      );
      (realFlightsService as any).updateAvailableSeats = jest.fn().mockResolvedValue(true);

      paypalService.refundCapture.mockResolvedValueOnce({
        refund_id: 'RF-P15-CANCELLED',
        status: 'CANCELLED',
        amount: '20.00',
        currency: 'USD',
      });

      await realFlightsService.cancelBookingsForFlight(mockFlightForCancel);

      expect(mockBookingForCancel.status).toBe(BookingStatus.CANCELLED);
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            'payment_transactions.$.status': 'FAILED',
            'payment_transactions.$.provider_status': 'CANCELLED',
            'payment_transactions.$.failure_reason': 'PayPal refund returned status: CANCELLED',
            'payment_transactions.$.next_retry_at': null,
          }),
        }),
      );
    });

    // 8. processPendingRefunds: scheduler reconciling refund via getRefundDetails or retrying via refundCapture maps FAILED / CANCELLED to local status FAILED without infinite loop
    it('117. Item 8: processPendingRefunds maps FAILED/CANCELLED to local status FAILED and stops retries (next_retry_at undefined)', async () => {
      const mockBookingWithFailedDetails: any = {
        _id: 'b-sched-fail-1',
        confirmation_number: 'CNF-SCHED-FAIL-1',
        payment_transactions: [
          {
            payment_reference: 'REF-SCHED-FAIL-1',
            payment_method: PaymentMethod.PAYPAL,
            transaction_type: 'REFUND',
            provider_capture_id: 'CAP-SCHED-F1',
            provider_amount: '20.00',
            provider_currency: 'USD',
            exchange_rate_vnd_per_unit: 25000,
            provider_refund_id: 'RF-FAIL-SCHED',
            status: 'PENDING',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.find = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBookingWithFailedDetails]),
      });
      paypalService.getRefundDetails = jest.fn().mockResolvedValue({
        refund_id: 'RF-FAIL-SCHED',
        status: 'FAILED',
      });

      const res = await paypalRefundScheduler.processPendingRefunds();
      expect(mockBookingWithFailedDetails.payment_transactions[0].status).toBe('FAILED');
      expect(mockBookingWithFailedDetails.payment_transactions[0].failure_reason).toBe('PayPal refund returned status: FAILED');
      expect(mockBookingWithFailedDetails.payment_transactions[0].next_retry_at).toBeUndefined();
      expect(res.failed).toBe(1);
    });

    // 9. captureOrder throws BadRequestException when capture.id is missing
    it('118. Item 9: captureOrder throws BadRequestException when capture.id is missing', async () => {
      const mockOrdersController = {
        captureOrder: jest.fn().mockResolvedValue({
          result: {
            purchaseUnits: [
              {
                payments: {
                  captures: [{ status: 'COMPLETED', amount: { value: '25.00', currencyCode: 'USD' } }],
                },
              },
            ],
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).ordersController = mockOrdersController;

      await expect(
        realPaypalService.captureOrder({ orderId: 'ORD-NO-CAP-ID', paypalRequestId: 'REQ-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 10. captureOrder throws BadRequestException when capture.status is missing
    it('119. Item 10: captureOrder throws BadRequestException when capture.status is missing', async () => {
      const mockOrdersController = {
        captureOrder: jest.fn().mockResolvedValue({
          result: {
            purchaseUnits: [
              {
                payments: {
                  captures: [{ id: 'CAP-123', amount: { value: '25.00', currencyCode: 'USD' } }],
                },
              },
            ],
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).ordersController = mockOrdersController;

      await expect(
        realPaypalService.captureOrder({ orderId: 'ORD-NO-STATUS', paypalRequestId: 'REQ-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 11. captureOrder throws BadRequestException when capture.amount.value is missing
    it('120. Item 11: captureOrder throws BadRequestException when capture.amount.value is missing', async () => {
      const mockOrdersController = {
        captureOrder: jest.fn().mockResolvedValue({
          result: {
            purchaseUnits: [
              {
                payments: {
                  captures: [{ id: 'CAP-123', status: 'COMPLETED', amount: { currencyCode: 'USD' } }],
                },
              },
            ],
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).ordersController = mockOrdersController;

      await expect(
        realPaypalService.captureOrder({ orderId: 'ORD-NO-VAL', paypalRequestId: 'REQ-3' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 12. captureOrder throws BadRequestException when capture.amount.currencyCode is missing
    it('121. Item 12: captureOrder throws BadRequestException when capture.amount.currencyCode is missing', async () => {
      const mockOrdersController = {
        captureOrder: jest.fn().mockResolvedValue({
          result: {
            purchaseUnits: [
              {
                payments: {
                  captures: [{ id: 'CAP-123', status: 'COMPLETED', amount: { value: '25.00' } }],
                },
              },
            ],
          },
        }),
      };
      const realPaypalService = new PaypalService();
      (realPaypalService as any).isEnabled = true;
      (realPaypalService as any).ordersController = mockOrdersController;

      await expect(
        realPaypalService.captureOrder({ orderId: 'ORD-NO-CCY', paypalRequestId: 'REQ-4' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 13. prepareAndClaimPayPalCapture in getOrder recovery throws BadRequestException and sets session to RECONCILE_REQUIRED when capture currency is missing
    it('122. Item 13: prepareAndClaimPayPalCapture getOrder recovery fails closed to RECONCILE_REQUIRED when capture currency is missing (no fallback)', async () => {
      const mockSession: any = {
        _id: 'sess-rec-no-ccy',
        checkout_id: 'CHK-REC-NO-CCY',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-REC-NO-CCY',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockRejectedValueOnce(new Error('Gateway timeout'));
      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-REC-NO-CCY',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-REC-1',
                  status: 'COMPLETED',
                  amount: { value: '40.00' }, // missing currencyCode!
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-REC-NO-CCY', 'ORD-REC-NO-CCY', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('capture record is incomplete');
    });

    // 14. prepareAndClaimPayPalCapture in getOrder recovery throws BadRequestException and sets session to RECONCILE_REQUIRED when capture amount is missing
    it('123. Item 14: prepareAndClaimPayPalCapture getOrder recovery fails closed to RECONCILE_REQUIRED when capture amount is missing', async () => {
      const mockSession: any = {
        _id: 'sess-rec-no-amt',
        checkout_id: 'CHK-REC-NO-AMT',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-REC-NO-AMT',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockRejectedValueOnce(new Error('Gateway timeout'));
      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-REC-NO-AMT',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-REC-2',
                  status: 'COMPLETED',
                  amount: { currencyCode: 'USD' }, // missing value!
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-REC-NO-AMT', 'ORD-REC-NO-AMT', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('capture record is incomplete');
    });

    // 15. prepareAndClaimPayPalCapture in getOrder recovery throws BadRequestException and sets session to RECONCILE_REQUIRED when capture id is missing
    it('124. Item 15: prepareAndClaimPayPalCapture getOrder recovery fails closed to RECONCILE_REQUIRED when capture id is missing', async () => {
      const mockSession: any = {
        _id: 'sess-rec-no-id',
        checkout_id: 'CHK-REC-NO-ID',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-REC-NO-ID',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockRejectedValueOnce(new Error('Gateway timeout'));
      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-REC-NO-ID',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  status: 'COMPLETED',
                  amount: { value: '40.00', currencyCode: 'USD' }, // missing id!
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-REC-NO-ID', 'ORD-REC-NO-ID', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('capture record is incomplete');
    });

    // 16. prepareAndClaimPayPalCapture in session.status === PENDING: when capture has non-matching amount/currency, sets RECONCILE_REQUIRED
    it('125. Item 16: prepareAndClaimPayPalCapture in PENDING session sets RECONCILE_REQUIRED on amount mismatch', async () => {
      const mockSession: any = {
        _id: 'sess-pend-mismatch',
        checkout_id: 'CHK-PEND-MISMATCH',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.PENDING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-PEND-MISMATCH',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-PEND-MISMATCH',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-MISMATCH-1',
                  status: 'COMPLETED',
                  amount: { value: '99.00', currencyCode: 'USD' }, // mismatch: expected 40.00
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-PEND-MISMATCH', 'ORD-PEND-MISMATCH', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('Captured amount 99.00 does not match expected session amount 40.00');
    });

    // 17. prepareAndClaimPayPalCapture in session.status === PENDING: when capture status is PENDING with matching amount/currency, keeps PENDING
    it('126. Item 17: prepareAndClaimPayPalCapture in PENDING session keeps PENDING when capture is still PENDING with matching snapshot', async () => {
      const mockSession: any = {
        _id: 'sess-pend-valid',
        checkout_id: 'CHK-PEND-VALID',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.PENDING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-PEND-VALID',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-PEND-VALID',
        status: 'PENDING',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-PEND-VALID-1',
                  status: 'PENDING',
                  amount: { value: '40.00', currencyCode: 'USD' },
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-PEND-VALID', 'ORD-PEND-VALID', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.PENDING);
      expect(mockSession.paypal_capture_id).toBe('CAP-PEND-VALID-1');
      expect(mockSession.error_message).toContain('pending provider settlement');
    });

    // 18. prepareAndClaimPayPalCapture in session.status === PENDING: when capture status is PARTIALLY_REFUNDED or REFUNDED, sets RECONCILE_REQUIRED (FIX 9)
    it('127. Item 18: prepareAndClaimPayPalCapture in PENDING session sets RECONCILE_REQUIRED when capture is PARTIALLY_REFUNDED or REFUNDED', async () => {
      const mockSession: any = {
        _id: 'sess-pend-part-ref',
        checkout_id: 'CHK-PEND-PART-REF',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.PENDING,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-PEND-PART-REF',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.getOrder.mockResolvedValueOnce({
        id: 'ORD-PEND-PART-REF',
        status: 'COMPLETED',
        purchaseUnits: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-PART-REF-1',
                  status: 'PARTIALLY_REFUNDED',
                  amount: { value: '40.00', currencyCode: 'USD' },
                },
              ],
            },
          },
        ],
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-PEND-PART-REF', 'ORD-PEND-PART-REF', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('non-standard status: PARTIALLY_REFUNDED');
      expect(mockSession.paypal_capture_id).toBe('CAP-PART-REF-1');
    });

    // 19. prepareAndClaimPayPalCapture in session.status === CAPTURING: when captureResult status is PARTIALLY_REFUNDED or REFUNDED, sets RECONCILE_REQUIRED
    it('128. Item 19: prepareAndClaimPayPalCapture in CAPTURING session sets RECONCILE_REQUIRED when captureResult is REFUNDED or PARTIALLY_REFUNDED', async () => {
      const mockSession: any = {
        _id: 'sess-cap-ref',
        checkout_id: 'CHK-CAP-REF',
        user_id: 'u-customer-1',
        status: PayPalCheckoutStatus.CREATED,
        amount_vnd: 1000000,
        paypal_order_id: 'ORD-CAP-REF',
        provider_amount: '40.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
        operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        operation_payload: {
          user_id: 'u-customer-1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'John', last_name: 'Doe', passenger_type: PassengerType.ADULT }],
          legs: [{ flight_id: 'f-101', inventory_id: 'inv-eco' }],
        },
        save: jest.fn().mockResolvedValue(true),
      };
      sessionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockSession) });
      sessionModel.findOneAndUpdate.mockImplementation((filter: any, update: any) => {
        if (update.$set?.status === PayPalCheckoutStatus.CAPTURING) {
          mockSession.status = PayPalCheckoutStatus.CAPTURING;
        }
        return { exec: jest.fn().mockResolvedValue(mockSession) };
      });
      (bookingsService as any).paypalCheckoutModel = sessionModel;

      paypalService.captureOrder.mockResolvedValueOnce({
        capture_id: 'CAP-ALREADY-REF',
        status: 'REFUNDED',
        provider_amount: '40.00',
        provider_currency: 'USD',
      });

      await expect(
        bookingsService.capturePayPalBooking('CHK-CAP-REF', 'ORD-CAP-REF', 'u-customer-1', UserRole.CUSTOMER),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.status).toBe(PayPalCheckoutStatus.RECONCILE_REQUIRED);
      expect(mockSession.failure_reason).toContain('non-standard status: REFUNDED');
      expect(mockSession.paypal_capture_id).toBe('CAP-ALREADY-REF');
    });
  });
});
