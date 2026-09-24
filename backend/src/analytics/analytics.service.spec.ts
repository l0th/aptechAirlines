import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AnalyticsService } from './analytics.service';
import { Booking, BookingStatus } from '../bookings/bookings.schema';
import { Flight, CabinClass } from '../flights/flights.schema';
import { User } from '../users/users.schema';
import { SeatAllocation, SeatAllocationStatus } from '../seat-allocation/seat-allocation.schema';
import { Types } from 'mongoose';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockBookingModel = {
    find: jest.fn(),
  };

  const mockFlightModel = {
    find: jest.fn(),
  };

  const mockUserModel = {
    find: jest.fn(),
  };

  const mockAllocationModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getModelToken(Booking.name),
          useValue: mockBookingModel,
        },
        {
          provide: getModelToken(Flight.name),
          useValue: mockFlightModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(SeatAllocation.name),
          useValue: mockAllocationModel,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOverview - Distinct Booking Count and Active Booking Value (Requirements 8 & 9)', () => {
    it('proves a 2-passenger booking produces bookings_count = 1, passenger_volume = 2, and active_booking_value_vnd', async () => {
      const flightId = new Types.ObjectId();
      const mockFlight = {
        _id: flightId,
        flight_number: 'VN101',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        scheduled_departure: new Date('2026-10-01T10:00:00Z'),
      };

      const twoPassengerBooking = [
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.CONFIRMED,
          total_amount: 3600000,
          user_id: new Types.ObjectId(),
          createdAt: new Date('2026-09-25T10:00:00Z'),
          passengers: [
            { passenger_type: 'ADULT' },
            { passenger_type: 'ADULT' },
          ],
          ticket_coupons: [
            {
              cabin_class: 'ECONOMY',
              fare_paid: 1800000,
              seat_fee: 0,
              flight_id: mockFlight,
            },
            {
              cabin_class: 'ECONOMY',
              fare_paid: 1800000,
              seat_fee: 0,
              flight_id: mockFlight,
            },
          ],
          payment_transactions: [
            {
              transaction_type: 'PAYMENT',
              amount: 3600000,
              status: 'SUCCESS',
            },
          ],
        },
      ];

      mockBookingModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(twoPassengerBooking),
          }),
        }),
      });

      const result = await service.getOverview();

      expect(result.top_routes.length).toBe(1);
      const routeStat = result.top_routes[0];
      expect(routeStat.route).toBe('SGN -> HAN');
      expect(routeStat.bookings_count).toBe(1); // Exactly 1 distinct booking!
      expect(routeStat.passenger_volume).toBe(2); // 2 passengers!
      expect(routeStat.active_booking_value_vnd).toBe(3600000);
    });
  });

  describe('getOverview - Lead Time Calculation', () => {
    it('calculates average lead time once per booking regardless of coupon/passenger count', async () => {
      const flight1 = {
        _id: new Types.ObjectId(),
        flight_number: 'VN101',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        scheduled_departure: new Date('2026-10-10T10:00:00Z'),
      };
      const flight2 = {
        _id: new Types.ObjectId(),
        flight_number: 'VN102',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: new Date('2026-10-20T10:00:00Z'),
      };

      const bookingA = {
        _id: new Types.ObjectId(),
        status: BookingStatus.CONFIRMED,
        total_amount: 7200000,
        createdAt: new Date('2026-09-30T10:00:00Z'),
        passengers: [{ passenger_type: 'ADULT' }, { passenger_type: 'ADULT' }],
        ticket_coupons: [
          { flight_id: flight1, cabin_class: 'ECONOMY', fare_paid: 1800000 },
          { flight_id: flight1, cabin_class: 'ECONOMY', fare_paid: 1800000 },
          { flight_id: flight2, cabin_class: 'ECONOMY', fare_paid: 1800000 },
          { flight_id: flight2, cabin_class: 'ECONOMY', fare_paid: 1800000 },
        ],
        payment_transactions: [{ transaction_type: 'PAYMENT', amount: 7200000, status: 'SUCCESS' }],
      };

      const bookingB = {
        _id: new Types.ObjectId(),
        status: BookingStatus.CONFIRMED,
        total_amount: 1800000,
        createdAt: new Date('2026-09-20T10:00:00Z'),
        passengers: [{ passenger_type: 'ADULT' }],
        ticket_coupons: [{ flight_id: flight1, cabin_class: 'ECONOMY', fare_paid: 1800000 }],
        payment_transactions: [{ transaction_type: 'PAYMENT', amount: 1800000, status: 'SUCCESS' }],
      };

      mockBookingModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([bookingA, bookingB]),
          }),
        }),
      });

      const result = await service.getOverview();
      expect(result.average_lead_time_days).toBe(15.0);
    });
  });

  describe('getOverview - Truthful Transaction-Ledger Net Revenue (Requirement 8)', () => {
    it('correctly calculates net_revenue_vnd across PAYMENT, partial refund, full refund, reschedule charge, reschedule refund, and ignores pending/failed transactions', async () => {
      const bookingsWithTxns = [
        // Booking 1: Confirmed with partial refund (net: 2,000,000 - 1,500,000 = 500,000)
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.CANCELLED,
          total_amount: 2000000,
          payment_transactions: [
            { transaction_type: 'PAYMENT', amount: 2000000, status: 'SUCCESS' },
            { transaction_type: 'REFUND', amount: 1500000, status: 'SUCCESS' },
          ],
          ticket_coupons: [],
        },
        // Booking 2: Rescheduled with reschedule charge (net: 2,000,000 + 500,000 = 2,500,000)
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.RESCHEDULED,
          total_amount: 2500000,
          payment_transactions: [
            { transaction_type: 'PAYMENT', amount: 2000000, status: 'SUCCESS' },
            { transaction_type: 'RESCHEDULE_CHARGE', amount: 500000, status: 'SUCCESS' },
          ],
          ticket_coupons: [],
        },
        // Booking 3: Full refund (net: 1,000,000 - 1,000,000 = 0)
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.CANCELLED,
          total_amount: 1000000,
          payment_transactions: [
            { transaction_type: 'PAYMENT', amount: 1000000, status: 'SUCCESS' },
            { transaction_type: 'REFUND', amount: 1000000, status: 'SUCCESS' },
          ],
          ticket_coupons: [],
        },
        // Booking 4: Rescheduled with reschedule refund (net: 2,000,000 - 400,000 = 1,600,000)
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.RESCHEDULED,
          total_amount: 1600000,
          payment_transactions: [
            { transaction_type: 'PAYMENT', amount: 2000000, status: 'SUCCESS' },
            { transaction_type: 'RESCHEDULE_REFUND', amount: 400000, status: 'SUCCESS' },
          ],
          ticket_coupons: [],
        },
        // Booking 5: Failed and Pending transactions (must NOT contribute to net_revenue_vnd)
        {
          _id: new Types.ObjectId(),
          status: BookingStatus.BLOCKED,
          total_amount: 3000000,
          payment_transactions: [
            { transaction_type: 'PAYMENT', amount: 1500000, status: 'FAILED' },
            { transaction_type: 'PAYMENT', amount: 1500000, status: 'PENDING' },
          ],
          ticket_coupons: [],
        },
      ];

      mockBookingModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(bookingsWithTxns),
          }),
        }),
      });

      const result = await service.getOverview();

      // Net revenue = 500,000 + 2,500,000 + 0 + 1,600,000 + 0 = 4,600,000 VND
      expect(result.net_revenue_vnd).toBe(4600000);

      // Active booking value = Booking 2 (2,500,000) + Booking 4 (1,600,000) = 4,100,000 VND
      expect(result.active_booking_value_vnd).toBe(4100000);
    });
  });

  describe('getCapacityUtilization - Reconciliation Invariants & Exact Assertions (Requirement 10)', () => {
    it('correctly reconciles physical allocations, held seats, staff blocks, and inventory fallback without double subtraction', async () => {
      const flightId = new Types.ObjectId();

      // Aircraft capacity 180, inventories available = 168 (meaning inventoryReserved = 180 - 168 = 12 customer reserved seats)
      const mockFlight = {
        _id: flightId,
        flight_number: 'APT-TEST',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        scheduled_departure: new Date('2026-10-15T08:00:00Z'),
        aircraft: { total_capacity: 180 },
        inventories: [
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 168 },
        ],
      };

      // Physical allocations:
      // 8 physical CONFIRMED allocations (partially missing compared to 12 inventory reserved)
      // 2 physical HELD allocations
      // 3 physical staff blocked allocations (1 maintenance, 1 crew rest, 1 vip hold)
      const mockAllocations = [
        ...Array(8).fill(null).map(() => ({ flight_id: flightId, status: SeatAllocationStatus.CONFIRMED })),
        ...Array(2).fill(null).map(() => ({ flight_id: flightId, status: SeatAllocationStatus.HELD })),
        { flight_id: flightId, status: SeatAllocationStatus.BLOCKED_MAINTENANCE },
        { flight_id: flightId, status: SeatAllocationStatus.CREW_REST },
        { flight_id: flightId, status: SeatAllocationStatus.VIP_HOLD },
      ];

      mockFlightModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockFlight]),
        }),
      });

      mockAllocationModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockAllocations),
        }),
      });

      const result = await service.getCapacityUtilization();

      expect(result.total_scheduled_flights).toBe(1);
      expect(result.total_seat_capacity).toBe(180);

      // Inventory reserved = 180 - 168 = 12.
      // Held = 2.
      // Confirmed fallback = max(0, 12 - 2) = 10.
      // Physical confirmed = 8.
      // Confirmed occupied = max(8, 10) = 10.
      expect(result.total_confirmed_occupied_seats).toBe(10);
      expect(result.total_held_seats).toBe(2);
      expect(result.total_staff_blocked_seats).toBe(3);

      // Available physical = 180 - 10 (occupied) - 2 (held) - 3 (staff blocked) = 165
      expect(result.total_available_seats).toBe(165);

      const flightStat = result.low_load_flights.find((f) => f.flight_number === 'APT-TEST')
        || result.high_load_flights.find((f) => f.flight_number === 'APT-TEST');

      // (10 occupied + 2 held) / 180 = 6.7% -> LOW_LOAD
      expect(flightStat).toBeDefined();
      expect(flightStat?.occupied_seats).toBe(10);
      expect(flightStat?.held_seats).toBe(2);
      expect(flightStat?.staff_blocked_seats).toBe(3);
      expect(flightStat?.available_seats).toBe(165);
      expect(flightStat?.load_factor_percent).toBe(6.7);
      expect(flightStat?.load_status).toBe('LOW_LOAD');
    });

    it('enforces mutually exclusive thresholds: High load >= 80%, Low load <= 40%', async () => {
      const flightHighId = new Types.ObjectId();
      const flightLowId = new Types.ObjectId();
      const flightNormalId = new Types.ObjectId();

      const mockFlights = [
        {
          _id: flightHighId,
          flight_number: 'APT-HIGH',
          origin_iata: 'SGN',
          dest_iata: 'HAN',
          scheduled_departure: new Date('2026-10-15T08:00:00Z'),
          aircraft: { total_capacity: 100 },
          inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 100, available_seats: 15 }],
        },
        {
          _id: flightLowId,
          flight_number: 'APT-LOW',
          origin_iata: 'SGN',
          dest_iata: 'DAD',
          scheduled_departure: new Date('2026-10-15T10:00:00Z'),
          aircraft: { total_capacity: 100 },
          inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 100, available_seats: 70 }],
        },
        {
          _id: flightNormalId,
          flight_number: 'APT-NORM',
          origin_iata: 'HAN',
          dest_iata: 'DAD',
          scheduled_departure: new Date('2026-10-15T12:00:00Z'),
          aircraft: { total_capacity: 100 },
          inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 100, available_seats: 40 }],
        },
      ];

      mockFlightModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockFlights),
        }),
      });

      mockAllocationModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getCapacityUtilization();

      expect(result.high_load_flights.length).toBe(1);
      expect(result.high_load_flights[0].flight_number).toBe('APT-HIGH');
      expect(result.high_load_flights[0].load_status).toBe('HIGH_LOAD');

      expect(result.low_load_flights.length).toBe(1);
      expect(result.low_load_flights[0].flight_number).toBe('APT-LOW');
      expect(result.low_load_flights[0].load_status).toBe('LOW_LOAD');

      const highFlightIds = new Set(result.high_load_flights.map((f) => f.flight_id));
      const lowFlightIds = new Set(result.low_load_flights.map((f) => f.flight_id));
      for (const id of highFlightIds) {
        expect(lowFlightIds.has(id)).toBe(false);
      }
    });
  });
});
