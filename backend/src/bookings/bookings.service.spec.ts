import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { getModelToken } from '@nestjs/mongoose';
import { Booking } from './bookings.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { MailService } from '../mail/mail.service';
import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { BookingStatus, BookingType, PassengerType, PaymentMethod } from './bookings.schema';
import { UserRole } from '../users/users.schema';
import { getBookingWindowLimits } from '../common/pricing.util';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PassengerInputDto } from './bookings.dto';

describe('BookingsService', () => {
  let service: BookingsService;
  let bookingModel: any;
  let flightsService: any;
  let usersService: any;
  let policiesService: any;

  beforeEach(async () => {
    bookingModel = function(data: any) {
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...data, _id: 'new-booking-id' }),
      };
    };
    bookingModel.findOne = jest.fn().mockReturnThis();
    bookingModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    bookingModel.exec = jest.fn();

    flightsService = {
      findById: jest.fn(),
      reserveSeats: jest.fn(),
      updateAvailableSeats: jest.fn(),
      restoreSeatsWithSaga: jest.fn().mockResolvedValue(true),
    };

    usersService = {
      findById: jest.fn(),
      addSkyMiles: jest.fn(),
      deductSkyMiles: jest.fn(),
      setSkyMiles: jest.fn(),
    };

    policiesService = {
      calculateRefundPercentage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: FlightsService, useValue: flightsService },
        { provide: UsersService, useValue: usersService },
        { provide: PoliciesService, useValue: policiesService },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  describe('createBooking', () => {
    let baseDto: any;
    let mockUser: any;
    let mockFlight: any;

    beforeEach(() => {
      baseDto = {
        user_id: 'user1',
        passengers: [
          { passenger_type: PassengerType.ADULT, first_name: 'A', last_name: 'B', seat_codes: { OUTBOUND: '1A' } }
        ],
        legs: [{ flight_id: 'f1', inventory_id: 'i1', leg_type: 'OUTBOUND' }],
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
      };

      mockUser = { _id: 'user1', preferred_credit_card: '4111222233334444' };
      usersService.findById.mockResolvedValue(mockUser);

      mockFlight = {
        _id: 'f1',
        flight_number: 'FL1',
        distance_miles: 1000,
        scheduled_departure: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days ahead
        scheduled_arrival: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        status: 'SCHEDULED',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 100 }],
      };
      flightsService.findById.mockResolvedValue(mockFlight);
      flightsService.reserveSeats.mockResolvedValue(true);
    });

    it('rejects when departure is <= 14 days away and is_block=true', async () => {
      mockFlight.scheduled_departure = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days ahead
      baseDto.is_block = true;
      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('exact 14-day hold boundary policy: 13.99d -> DENIED, 14.00d -> DENIED, 14.01d -> ALLOWED, 14.50d -> ALLOWED, 15.00d -> ALLOWED', async () => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      baseDto.is_block = true;

      // 13.99 days -> DENIED
      mockFlight.scheduled_departure = new Date(Date.now() + 13.99 * DAY_MS);
      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);

      // 14.00 days -> DENIED
      mockFlight.scheduled_departure = new Date(Date.now() + 14.00 * DAY_MS);
      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);

      // 14.01 days -> ALLOWED
      mockFlight.scheduled_departure = new Date(Date.now() + 14.01 * DAY_MS);
      const res1401 = await service.createBooking(baseDto);
      expect(res1401.status).toBe(BookingStatus.BLOCKED);

      // 14.50 days -> ALLOWED
      mockFlight.scheduled_departure = new Date(Date.now() + 14.50 * DAY_MS);
      const res1450 = await service.createBooking(baseDto);
      expect(res1450.status).toBe(BookingStatus.BLOCKED);

      // 15.00 days -> ALLOWED
      mockFlight.scheduled_departure = new Date(Date.now() + 15.00 * DAY_MS);
      const res1500 = await service.createBooking(baseDto);
      expect(res1500.status).toBe(BookingStatus.BLOCKED);
    });

    it('sets status BLOCKED + blocking_number + time_limit_deadline + zero miles when is_block=true', async () => {
      baseDto.is_block = true;
      const result = await service.createBooking(baseDto);
      expect(result.status).toBe(BookingStatus.BLOCKED);
      expect(result.blocking_number).toBeDefined();
      expect(result.time_limit_deadline).toBeDefined();
      expect(result.total_miles_accrued).toBe(0);
    });

    it('sets CONFIRMED + confirmation_number + payment transaction + accrues miles when buying', async () => {
      baseDto.is_block = false;
      baseDto.passengers.push({ passenger_type: PassengerType.ADULT, first_name: 'C', last_name: 'D' }); // 2 adults
      const result = await service.createBooking(baseDto);
      expect(result.status).toBe(BookingStatus.CONFIRMED);
      expect(result.confirmation_number).toBeDefined();
      expect(result.payment_transactions.length).toBe(1);
      expect(result.total_miles_accrued).toBe(2000); // 1000 miles * 2 passengers
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 2000);
    });

    it('child fare = round(applyPricing*0.75), senior = round(applyPricing*0.85)', async () => {
      baseDto.passengers = [
        { passenger_type: PassengerType.CHILD, first_name: 'C', last_name: '1' },
        { passenger_type: PassengerType.SENIOR, first_name: 'S', last_name: '1' },
      ];
      const result = await service.createBooking(baseDto);
      // base=100, 45 days → earlyBird 0.92 → final=92
      // child = round(92*0.75) = 69, senior = round(92*0.85) = 78. Total = 147
      expect(result.total_amount).toBe(147);
    });

    it('releases reserved seats and throws BadRequest when a later leg fails (rollback)', async () => {
      baseDto.legs.push({ flight_id: 'f2', inventory_id: 'i2', leg_type: 'INBOUND' });
      const mockFlight2 = {
        _id: 'f2',
        flight_number: 'FL2',
        distance_miles: 1000,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        scheduled_departure: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 100 }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return mockFlight;
        if (id === 'f2') return mockFlight2;
      });
      flightsService.reserveSeats.mockImplementation((fId: string) => {
        if (fId === 'f1') return true;
        if (fId === 'f2') return false; // Fails on second leg
      });

      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
    });

    it('stores per-leg seats from passenger.seat_codes', async () => {
      baseDto.passengers = [
        { 
          passenger_type: PassengerType.ADULT, 
          first_name: 'A', 
          last_name: 'B', 
          seat_codes: { OUTBOUND: '1A', INBOUND: '2B' } 
        }
      ];
      baseDto.legs.push({ flight_id: 'f1', inventory_id: 'i1', leg_type: 'INBOUND' }); // Mocking same flight for simplicity

      const result = await service.createBooking(baseDto);
      expect(result.ticket_coupons.find((c: any) => c.leg_type === 'OUTBOUND').seat_code).toBe('1A');
      expect(result.ticket_coupons.find((c: any) => c.leg_type === 'INBOUND').seat_code).toBe('2B');
    });

    it('creates CONNECTING blocked booking with 0 miles and holds seats on all legs', async () => {
      baseDto.booking_type = BookingType.CONNECTING;
      baseDto.is_block = true;
      baseDto.legs = [
        { flight_id: 'f1', inventory_id: 'i1', leg_type: 'CONNECTING_LEG_1' },
        { flight_id: 'f2', inventory_id: 'i2', leg_type: 'CONNECTING_LEG_2' },
      ];
      const mockFlight2 = {
        _id: 'f2',
        flight_number: 'FL2',
        distance_miles: 500,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        scheduled_departure: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
        scheduled_arrival: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        status: 'SCHEDULED',
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 100 }],
      };
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(mockFlight);
        if (id === 'f2') return Promise.resolve(mockFlight2);
      });

      const res = await service.createBooking(baseDto);
      expect(res.status).toBe(BookingStatus.BLOCKED);
      expect(res.blocking_number).toBeDefined();
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f2', 'i2', 1);
      expect(res.total_miles_accrued).toBe(0);
    });

    it('releases a blocked seat hold when booking persistence fails', async () => {
      baseDto.is_block = true;
      (service as any).bookingModel = function(data: any) {
        return { ...data, save: jest.fn().mockRejectedValue(new Error('booking write failed')) };
      };

      await expect(service.createBooking(baseDto)).rejects.toThrow('booking write failed');
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledTimes(1);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(usersService.addSkyMiles).not.toHaveBeenCalled();
    });

    it('releases all reserved legs when SkyMiles credit fails', async () => {
      usersService.addSkyMiles.mockRejectedValue(new Error('miles write failed'));

      await expect(service.createBooking(baseDto)).rejects.toThrow('miles write failed');
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledTimes(1);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
    });

    it('restores exact SkyMiles and inventory when a bought booking save fails', async () => {
      mockUser.sky_miles = 321;
      (service as any).bookingModel = function(data: any) {
        return { ...data, save: jest.fn().mockRejectedValue(new Error('booking write failed')) };
      };

      await expect(service.createBooking(baseDto)).rejects.toThrow('booking write failed');
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user1', 321);
    });

    it('rejects a discontinuous connecting itinerary before reserving any seat', async () => {
      baseDto.booking_type = BookingType.CONNECTING;
      baseDto.legs = [
        { flight_id: 'f1', inventory_id: 'i1', leg_type: 'CONNECTING_1' },
        { flight_id: 'f2', inventory_id: 'i2', leg_type: 'CONNECTING_2' },
      ];
      const badSecond = {
        ...mockFlight,
        _id: 'f2',
        flight_number: 'FL2',
        origin_iata: 'CXR',
        dest_iata: 'SGN',
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 100 }],
      };
      flightsService.findById.mockImplementation((id: string) => Promise.resolve(id === 'f1' ? mockFlight : badSecond));

      await expect(service.createBooking(baseDto)).rejects.toThrow('Connecting airport mismatch');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('round-trip connecting legs: transfer layovers (45-720m) enforced, multi-day stay permitted', async () => {
      baseDto.booking_type = BookingType.ROUND_TRIP;
      const t0 = Date.now() + 45 * 24 * 3600 * 1000;
      const out1 = {
        ...mockFlight, _id: 'o1', flight_number: 'O1', origin_iata: 'HAN', dest_iata: 'DAD',
        scheduled_departure: new Date(t0),
        scheduled_arrival: new Date(t0 + 60 * 60000),
        inventories: [{ _id: 'oi1', id: 'oi1', available_seats: 10, base_price: 100 }],
      };
      const out2 = {
        ...mockFlight, _id: 'o2', flight_number: 'O2', origin_iata: 'DAD', dest_iata: 'SGN',
        scheduled_departure: new Date(t0 + 120 * 60000),
        scheduled_arrival: new Date(t0 + 180 * 60000),
        inventories: [{ _id: 'oi2', id: 'oi2', available_seats: 10, base_price: 100 }],
      };
      const ret1 = {
        ...mockFlight, _id: 'r1', flight_number: 'R1', origin_iata: 'SGN', dest_iata: 'DAD',
        scheduled_departure: new Date(t0 + 3 * 24 * 3600 * 1000),
        scheduled_arrival: new Date(t0 + 3 * 24 * 3600 * 1000 + 60 * 60000),
        inventories: [{ _id: 'ri1', id: 'ri1', available_seats: 10, base_price: 100 }],
      };
      const ret2 = {
        ...mockFlight, _id: 'r2', flight_number: 'R2', origin_iata: 'DAD', dest_iata: 'HAN',
        scheduled_departure: new Date(t0 + 3 * 24 * 3600 * 1000 + 120 * 60000),
        scheduled_arrival: new Date(t0 + 3 * 24 * 3600 * 1000 + 180 * 60000),
        inventories: [{ _id: 'ri2', id: 'ri2', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [
        { flight_id: 'o1', inventory_id: 'oi1', leg_type: 'OUTBOUND' },
        { flight_id: 'o2', inventory_id: 'oi2', leg_type: 'OUTBOUND' },
        { flight_id: 'r1', inventory_id: 'ri1', leg_type: 'INBOUND' },
        { flight_id: 'r2', inventory_id: 'ri2', leg_type: 'INBOUND' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ o1: out1, o2: out2, r1: ret1, r2: ret2 }[id]);
      });

      const res = await service.createBooking(baseDto);
      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(res.ticket_coupons.length).toBe(4);
    });

    it('round-trip connecting legs: transfer layover < 45m within outbound rejected', async () => {
      baseDto.booking_type = BookingType.ROUND_TRIP;
      const t0 = Date.now() + 45 * 24 * 3600 * 1000;
      const out1 = {
        ...mockFlight, _id: 'o1', flight_number: 'O1', origin_iata: 'HAN', dest_iata: 'DAD',
        scheduled_departure: new Date(t0),
        scheduled_arrival: new Date(t0 + 60 * 60000),
        inventories: [{ _id: 'oi1', id: 'oi1', available_seats: 10, base_price: 100 }],
      };
      const out2 = {
        ...mockFlight, _id: 'o2', flight_number: 'O2', origin_iata: 'DAD', dest_iata: 'SGN',
        scheduled_departure: new Date(t0 + 80 * 60000),
        scheduled_arrival: new Date(t0 + 140 * 60000),
        inventories: [{ _id: 'oi2', id: 'oi2', available_seats: 10, base_price: 100 }],
      };
      const ret1 = {
        ...mockFlight, _id: 'r1', flight_number: 'R1', origin_iata: 'SGN', dest_iata: 'HAN',
        scheduled_departure: new Date(t0 + 24 * 3600 * 1000),
        scheduled_arrival: new Date(t0 + 26 * 3600 * 1000),
        inventories: [{ _id: 'ri1', id: 'ri1', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [
        { flight_id: 'o1', inventory_id: 'oi1', leg_type: 'OUTBOUND' },
        { flight_id: 'o2', inventory_id: 'oi2', leg_type: 'OUTBOUND' },
        { flight_id: 'r1', inventory_id: 'ri1', leg_type: 'INBOUND' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ o1: out1, o2: out2, r1: ret1 }[id]);
      });

      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('round-trip: return departure <= outbound arrival rejected', async () => {
      baseDto.booking_type = BookingType.ROUND_TRIP;
      const t0 = Date.now() + 45 * 24 * 3600 * 1000;
      const out = {
        ...mockFlight, _id: 'o1', flight_number: 'O1', origin_iata: 'HAN', dest_iata: 'SGN',
        scheduled_departure: new Date(t0),
        scheduled_arrival: new Date(t0 + 2 * 3600 * 1000),
        inventories: [{ _id: 'oi1', id: 'oi1', available_seats: 10, base_price: 100 }],
      };
      const ret = {
        ...mockFlight, _id: 'r1', flight_number: 'R1', origin_iata: 'SGN', dest_iata: 'HAN',
        scheduled_departure: new Date(t0 + 1 * 3600 * 1000),
        scheduled_arrival: new Date(t0 + 3 * 3600 * 1000),
        inventories: [{ _id: 'ri1', id: 'ri1', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [
        { flight_id: 'o1', inventory_id: 'oi1', leg_type: 'OUTBOUND' },
        { flight_id: 'r1', inventory_id: 'ri1', leg_type: 'INBOUND' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ o1: out, r1: ret }[id]);
      });

      await expect(service.createBooking(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('A. DIRECT MAX-DATE BOUNDARY: departure_date === max_date late flight is accepted and seats reserved', async () => {
      const { max_date } = getBookingWindowLimits();
      const lateDep = new Date(`${max_date}T23:55:00.000Z`);
      const lateArr = new Date(lateDep.getTime() + 2 * 3600000);
      const boundaryFlight = {
        ...mockFlight,
        _id: 'f_boundary',
        flight_number: 'FL_BOUND',
        departure_date: max_date,
        scheduled_departure: lateDep,
        scheduled_arrival: lateArr,
        inventories: [{ _id: 'i_bound', id: 'i_bound', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [{ flight_id: 'f_boundary', inventory_id: 'i_bound', leg_type: 'OUTBOUND' }];
      flightsService.findById.mockResolvedValue(boundaryFlight);

      const result = await service.createBooking(baseDto);

      expect(result).toBeDefined();
      expect(result.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f_boundary', 'i_bound', 1);
    });

    it('B. DIRECT DAY AFTER MAX: operating date after max_date rejected before seat reservation', async () => {
      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterStr = new Date(maxDateObj.getTime() + 86400000).toISOString().split('T')[0];

      const afterDep = new Date(`${dayAfterStr}T08:00:00.000Z`);
      const afterArr = new Date(afterDep.getTime() + 2 * 3600000);
      const afterFlight = {
        ...mockFlight,
        _id: 'f_after',
        flight_number: 'FL_AFTER',
        departure_date: dayAfterStr,
        scheduled_departure: afterDep,
        scheduled_arrival: afterArr,
        inventories: [{ _id: 'i_after', id: 'i_after', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [{ flight_id: 'f_after', inventory_id: 'i_after', leg_type: 'OUTBOUND' }];
      flightsService.findById.mockResolvedValue(afterFlight);

      await expect(service.createBooking(baseDto)).rejects.toThrow(/exceeds maximum advance booking window/);
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('C. CONNECTING OVERNIGHT AT MAX DATE: leg 1 on max_date, leg 2 after midnight accepted with both legs reserved', async () => {
      baseDto.booking_type = BookingType.CONNECTING;
      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterStr = new Date(maxDateObj.getTime() + 86400000).toISOString().split('T')[0];

      const leg1Dep = new Date(`${max_date}T22:30:00.000Z`);
      const leg1Arr = new Date(`${max_date}T23:45:00.000Z`);
      const conn1 = {
        ...mockFlight,
        _id: 'c1',
        flight_number: 'CFL1',
        origin_iata: 'SGN',
        dest_iata: 'DAD',
        departure_date: max_date,
        scheduled_departure: leg1Dep,
        scheduled_arrival: leg1Arr,
        inventories: [{ _id: 'ci1', id: 'ci1', available_seats: 10, base_price: 90 }],
      };

      const leg2Dep = new Date(`${dayAfterStr}T01:15:00.000Z`);
      const leg2Arr = new Date(`${dayAfterStr}T02:45:00.000Z`);
      const conn2 = {
        ...mockFlight,
        _id: 'c2',
        flight_number: 'CFL2',
        origin_iata: 'DAD',
        dest_iata: 'HAN',
        departure_date: dayAfterStr,
        scheduled_departure: leg2Dep,
        scheduled_arrival: leg2Arr,
        inventories: [{ _id: 'ci2', id: 'ci2', available_seats: 10, base_price: 80 }],
      };

      baseDto.legs = [
        { flight_id: 'c1', inventory_id: 'ci1', leg_type: 'CONNECTING_1' },
        { flight_id: 'c2', inventory_id: 'ci2', leg_type: 'CONNECTING_2' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ c1: conn1, c2: conn2 }[id]);
      });

      const res = await service.createBooking(baseDto);

      expect(res).toBeDefined();
      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('c1', 'ci1', 1);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('c2', 'ci2', 1);
    });

    it('D. CONNECTING FIRST LEG AFTER MAX: rejected before reserving any leg', async () => {
      baseDto.booking_type = BookingType.CONNECTING;
      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterStr = new Date(maxDateObj.getTime() + 86400000).toISOString().split('T')[0];

      const leg1Dep = new Date(`${dayAfterStr}T10:00:00.000Z`);
      const leg1Arr = new Date(`${dayAfterStr}T11:15:00.000Z`);
      const conn1 = {
        ...mockFlight,
        _id: 'c1_late',
        flight_number: 'CFL1_L',
        origin_iata: 'SGN',
        dest_iata: 'DAD',
        departure_date: dayAfterStr,
        scheduled_departure: leg1Dep,
        scheduled_arrival: leg1Arr,
        inventories: [{ _id: 'ci1', id: 'ci1', available_seats: 10, base_price: 90 }],
      };

      const leg2Dep = new Date(`${dayAfterStr}T12:30:00.000Z`);
      const leg2Arr = new Date(`${dayAfterStr}T13:45:00.000Z`);
      const conn2 = {
        ...mockFlight,
        _id: 'c2_late',
        flight_number: 'CFL2_L',
        origin_iata: 'DAD',
        dest_iata: 'HAN',
        departure_date: dayAfterStr,
        scheduled_departure: leg2Dep,
        scheduled_arrival: leg2Arr,
        inventories: [{ _id: 'ci2', id: 'ci2', available_seats: 10, base_price: 80 }],
      };

      baseDto.legs = [
        { flight_id: 'c1_late', inventory_id: 'ci1', leg_type: 'CONNECTING_1' },
        { flight_id: 'c2_late', inventory_id: 'ci2', leg_type: 'CONNECTING_2' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ c1_late: conn1, c2_late: conn2 }[id]);
      });

      await expect(service.createBooking(baseDto)).rejects.toThrow(/exceeds maximum advance booking window/);
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('E. ROUND_TRIP RETURN AT MAX DATE: return first leg on max_date accepted', async () => {
      baseDto.booking_type = BookingType.ROUND_TRIP;
      const { max_date } = getBookingWindowLimits();
      const outDep = new Date(Date.now() + 45 * 86400000);
      const outArr = new Date(outDep.getTime() + 2 * 3600000);
      const outFlight = {
        ...mockFlight,
        _id: 'rt_out',
        flight_number: 'RTOUT',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        departure_date: outDep.toISOString().split('T')[0],
        scheduled_departure: outDep,
        scheduled_arrival: outArr,
        inventories: [{ _id: 'oi1', id: 'oi1', available_seats: 10, base_price: 100 }],
      };

      const retDep = new Date(`${max_date}T23:55:00.000Z`);
      const retArr = new Date(retDep.getTime() + 2 * 3600000);
      const retFlight = {
        ...mockFlight,
        _id: 'rt_ret',
        flight_number: 'RTRET',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        departure_date: max_date,
        scheduled_departure: retDep,
        scheduled_arrival: retArr,
        inventories: [{ _id: 'ri1', id: 'ri1', available_seats: 10, base_price: 120 }],
      };

      baseDto.legs = [
        { flight_id: 'rt_out', inventory_id: 'oi1', leg_type: 'OUTBOUND' },
        { flight_id: 'rt_ret', inventory_id: 'ri1', leg_type: 'INBOUND' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ rt_out: outFlight, rt_ret: retFlight }[id]);
      });

      const res = await service.createBooking(baseDto);

      expect(res).toBeDefined();
      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('rt_out', 'oi1', 1);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('rt_ret', 'ri1', 1);
    });

    it('F. ROUND_TRIP RETURN AFTER MAX DATE: return first leg after max_date rejected before reserving seats', async () => {
      baseDto.booking_type = BookingType.ROUND_TRIP;
      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterStr = new Date(maxDateObj.getTime() + 86400000).toISOString().split('T')[0];

      const outDep = new Date(Date.now() + 45 * 86400000);
      const outArr = new Date(outDep.getTime() + 2 * 3600000);
      const outFlight = {
        ...mockFlight,
        _id: 'rt_out',
        flight_number: 'RTOUT',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        departure_date: outDep.toISOString().split('T')[0],
        scheduled_departure: outDep,
        scheduled_arrival: outArr,
        inventories: [{ _id: 'oi1', id: 'oi1', available_seats: 10, base_price: 100 }],
      };

      const retDep = new Date(`${dayAfterStr}T08:00:00.000Z`);
      const retArr = new Date(retDep.getTime() + 2 * 3600000);
      const retFlight = {
        ...mockFlight,
        _id: 'rt_ret_late',
        flight_number: 'RTRET_L',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        departure_date: dayAfterStr,
        scheduled_departure: retDep,
        scheduled_arrival: retArr,
        inventories: [{ _id: 'ri1', id: 'ri1', available_seats: 10, base_price: 120 }],
      };

      baseDto.legs = [
        { flight_id: 'rt_out', inventory_id: 'oi1', leg_type: 'OUTBOUND' },
        { flight_id: 'rt_ret_late', inventory_id: 'ri1', leg_type: 'INBOUND' },
      ];

      flightsService.findById.mockImplementation((id: string) => {
        return Promise.resolve({ rt_out: outFlight, rt_ret_late: retFlight }[id]);
      });

      await expect(service.createBooking(baseDto)).rejects.toThrow(/exceeds maximum advance booking window/);
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('G. PAST FLIGHT ON MIN_DATE: already-departed flight on min_date rejected by future-flight defense', async () => {
      const { min_date } = getBookingWindowLimits();
      const pastDep = new Date(Date.now() - 2 * 3600000);
      const pastArr = new Date(Date.now() - 1 * 3600000);
      const pastFlight = {
        ...mockFlight,
        _id: 'f_past_today',
        flight_number: 'FL_PT',
        departure_date: min_date,
        scheduled_departure: pastDep,
        scheduled_arrival: pastArr,
        inventories: [{ _id: 'i_pt', id: 'i_pt', available_seats: 10, base_price: 100 }],
      };

      baseDto.legs = [{ flight_id: 'f_past_today', inventory_id: 'i_pt', leg_type: 'OUTBOUND' }];
      flightsService.findById.mockResolvedValue(pastFlight);

      await expect(service.createBooking(baseDto)).rejects.toThrow(/in the past/);
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });
  });

  describe('confirmTicket', () => {
    let mockBooking: any;
    beforeEach(() => {
      mockBooking = {
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() + 100000),
        total_amount: 100,
        user_id: 'user1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockResolvedValue({ distance_miles: 500 });
      usersService.findById.mockResolvedValue({ sky_miles: 1000, preferred_credit_card: '4111222233334444' });
    });

    it('blocked -> confirmed with new confirmation_number and miles added', async () => {
      await service.confirmTicket({ blocking_number: 'BLK-1', payment_method: PaymentMethod.PROFILE_CARD });
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.confirmation_number).toBeDefined();
      expect(mockBooking.total_miles_accrued).toBe(500);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 500);
    });

    it('confirms CONNECTING blocked booking without double reserving and accrues miles for all legs', async () => {
      mockBooking.booking_type = BookingType.CONNECTING;
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1' },
        { flight_id: 'f2', inventory_id: 'i2' },
      ];
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve({ distance_miles: 400 });
        if (id === 'f2') return Promise.resolve({ distance_miles: 600 });
      });

      const res = await service.confirmTicket({ blocking_number: 'BLK-1', payment_method: PaymentMethod.PROFILE_CARD });
      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(res.confirmation_number).toBeDefined();
      expect(flightsService.reserveSeats).not.toHaveBeenCalled(); // No double reservation!
      expect(res.total_miles_accrued).toBe(1000);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 1000);
    });

    it('expired deadline -> booking auto-cancelled and seats released', async () => {
      mockBooking.time_limit_deadline = new Date(Date.now() - 100000); // expired
      await expect(service.confirmTicket({ blocking_number: 'BLK-1', payment_method: PaymentMethod.PROFILE_CARD })).rejects.toThrow(BadRequestException);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1); // 1 passenger
    });

    it('expired block release failure -> booking stays BLOCKED, error rethrown', async () => {
      mockBooking.time_limit_deadline = new Date(Date.now() - 100000); // expired
      flightsService.updateAvailableSeats.mockRejectedValue(new Error('seat release failed'));

      await expect(
        service.confirmTicket({ blocking_number: 'BLK-1', payment_method: PaymentMethod.PROFILE_CARD }),
      ).rejects.toThrow('seat release failed');

      expect(mockBooking.status).toBe(BookingStatus.BLOCKED);
      expect(mockBooking.cancellation_number).toBeUndefined();
      expect(mockBooking.save).not.toHaveBeenCalled();
    });

    it('expired block save failure -> released seats restored and booking stays BLOCKED', async () => {
      mockBooking.time_limit_deadline = new Date(Date.now() - 100000); // expired
      mockBooking.save.mockRejectedValue(new Error('mongo save failed'));

      await expect(
        service.confirmTicket({ blocking_number: 'BLK-1', payment_method: PaymentMethod.PROFILE_CARD }),
      ).rejects.toThrow('mongo save failed');

      expect(flightsService.updateAvailableSeats.mock.calls).toEqual([
        ['f1', 'i1', 1],
        ['f1', 'i1', -1],
      ]);
      expect(mockBooking.status).toBe(BookingStatus.BLOCKED);
      expect(mockBooking.cancellation_number).toBeUndefined();
    });
  });

  describe('rescheduleTicket', () => {
    let mockBooking: any;
    let mockUser: any;

    const DAYS_UNTIL = 45;
    const msUntil = DAYS_UNTIL * 86400000;
    const futureDate = new Date(Date.now() + msUntil);
    const futureArrival = new Date(futureDate.getTime() + 12 * 3600000); // 12h after departure
    const laterFuture = new Date(Date.now() + (DAYS_UNTIL + 5) * 86400000);
    const laterFutureArrival = new Date(laterFuture.getTime() + 2 * 3600000);

    function mkFlight(
      id: string,
      num: string,
      miles: number,
      dep: Date,
      arr: Date,
      origin: string,
      dest: string,
      inventories: any[],
      status: string = 'SCHEDULED',
      departure_date?: string,
    ) {
      return {
        _id: id,
        flight_number: num,
        status,
        distance_miles: miles,
        departure_date: departure_date || (dep ? new Date(dep).toISOString().split('T')[0] : undefined),
        scheduled_departure: dep,
        scheduled_arrival: arr,
        origin_iata: origin,
        dest_iata: dest,
        inventories,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
      };
    }

    const F1 = () => mkFlight('f1', 'FL1', 1000, futureDate, futureArrival, 'SGN', 'HAN', [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 100 }]);
    const F2 = () => mkFlight('f2', 'FL2', 1500, futureDate, futureArrival, 'SGN', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 150 }]);
    const F3_RET = () => mkFlight('f3', 'FL3', 800, laterFuture, laterFutureArrival, 'HAN', 'SGN', [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 120 }]);
    const F4_RET = () => mkFlight('f4', 'FL4', 900, laterFuture, laterFutureArrival, 'HAN', 'SGN', [{ _id: 'i4', id: 'i4', available_seats: 10, base_price: 130 }]);

    beforeEach(() => {
      mockBooking = {
        status: BookingStatus.CONFIRMED,
        confirmation_number: 'CNF',
        total_amount: 100,
        total_miles_accrued: 1000,
        user_id: 'user1',
        passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'A', last_name: 'B' }],
        booking_type: 'ONE_WAY',
        ticket_coupons: [{ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100, seat_code: '1A' }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 100,
            card_masked: '**** **** **** 4242',
            status: 'SUCCESS',
            created_at: new Date(),
          },
        ],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);

      mockUser = { _id: 'user1', sky_miles: 5000, preferred_credit_card: '4111222233334242' };
      usersService.findById.mockResolvedValue(mockUser);
      usersService.setSkyMiles = jest.fn().mockResolvedValue(mockUser);

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'f3') return Promise.resolve(F3_RET());
        if (id === 'f4') return Promise.resolve(F4_RET());
        return Promise.resolve(mkFlight(id, 'FLX', 500, futureDate, futureArrival, 'SGN', 'HAN', []));
      });
      flightsService.reserveSeats.mockResolvedValue(true);
      flightsService.updateAvailableSeats.mockResolvedValue(true);
    });

    it('1. reserve outbound fails -> old seat unchanged (updateAvailableSeats NOT called)', async () => {
      flightsService.reserveSeats.mockResolvedValue(false);
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow(BadRequestException);
      expect(flightsService.updateAvailableSeats).not.toHaveBeenCalled();
    });

    it('2. return reserve fails -> outbound new reservation rollback (+passengerCount on new outbound)', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      mockBooking.total_amount = 200;

      flightsService.reserveSeats.mockImplementation((fId: string) => {
        if (fId === 'f2') return true;
        if (fId === 'f4') return false;
        return true;
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4', new_return_inventory_id: 'i4',
        } as any)
      ).rejects.toThrow(BadRequestException);

      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 1);
    });

    it('2b. return reserve throws error -> outbound reservation released exactly once, old seats/booking/SkyMiles untouched, original error rethrown', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      mockBooking.total_amount = 200;
      const origBooking = JSON.parse(JSON.stringify(mockBooking));

      flightsService.reserveSeats.mockImplementation((fId: string) => {
        if (fId === 'f2') return true;
        if (fId === 'f4') throw new Error('DB unavailable');
        return true;
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4', new_return_inventory_id: 'i4',
        } as any)
      ).rejects.toThrow('DB unavailable');

      // Outbound reservation released exactly once
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledTimes(1);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 1);

      // Old seats untouched & booking untouched
      expect(mockBooking.confirmation_number).toBe(origBooking.confirmation_number);
      expect(mockBooking.total_amount).toBe(origBooking.total_amount);
      expect(mockBooking.ticket_coupons.length).toBe(origBooking.ticket_coupons.length);

      // SkyMiles untouched
      expect(usersService.addSkyMiles).not.toHaveBeenCalled();
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(usersService.setSkyMiles).not.toHaveBeenCalled();
    });

    it('3. booking.save fails -> new seats released (updateAvailableSeats called with +passengerCount on new flight)', async () => {
      mockBooking.save.mockRejectedValue(new Error('DB error'));
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any)
      ).rejects.toThrow('DB error');
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 1);
    });

    it('4. booking.save fails -> old seats untouched because old seats are never released pre-commit', async () => {
      mockBooking.save.mockRejectedValue(new Error('DB error'));
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any)
      ).rejects.toThrow('DB error');
      const oldSeatCalls = flightsService.updateAvailableSeats.mock.calls.filter((c: any) => c[0] === 'f1');
      expect(oldSeatCalls.length).toBe(0);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 1);
    });

    it('5. 2 passengers, 2 coupons same leg, save fails -> old seats untouched, new seats released for all passengers', async () => {
      mockBooking.passengers.push({ passenger_type: PassengerType.ADULT, first_name: 'C', last_name: 'D' });
      mockBooking.ticket_coupons.push({ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100, seat_code: '1B' });
      mockBooking.save.mockRejectedValue(new Error('DB error'));

      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any)
      ).rejects.toThrow('DB error');

      const oldSeatCalls = flightsService.updateAvailableSeats.mock.calls.filter((c: any) => c[0] === 'f1');
      expect(oldSeatCalls.length).toBe(0);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 2);
    });

    it('6. SkyMiles positive delta (one-way longer distance) -> addSkyMiles called with correct delta', async () => {
      await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 500);
    });

    it('7. SkyMiles negative delta (one-way shorter distance) -> deductSkyMiles called', async () => {
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        return Promise.resolve(mkFlight('f2', 'FL2', 500, futureDate, futureArrival, 'SGN', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 80 }]));
      });
      await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user1', 500);
    });

    it('8. SkyMiles negative delta + clamp + later failure -> setSkyMiles called with exact original value (100, not 500)', async () => {
      mockUser.sky_miles = 100;
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        return Promise.resolve(mkFlight('f2', 'FL2', 500, futureDate, futureArrival, 'SGN', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 80 }]));
      });
      mockBooking.save.mockRejectedValue(new Error('DB error'));

      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('DB error');

      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user1', 100);
    });

    it('9. ROUND_TRIP outbound-only delta ignores unchanged return -> delta = outbound change only', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 500);
    });

    it('10. ROUND_TRIP both legs delta correct -> combined delta', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f2', new_inventory_id: 'i2',
        new_return_flight_id: 'f4', new_return_inventory_id: 'i4',
        payment_method: PaymentMethod.PROFILE_CARD,
      } as any);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 600); // 500 outbound + 100 return
    });

    it('11. dynamic pricing exact deterministic result -> total_amount = 138 for base=150, 45 days, MEMBER', async () => {
      await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any);
      expect(mockBooking.total_amount).toBe(138); // 150 * 0.92
    });

    it('12. partial return payload rejected -> BadRequestException', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4'
        } as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('13. outbound route mismatch rejected -> BadRequestException \'Route mismatch\'', async () => {
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        return Promise.resolve(mkFlight('f2', 'FL2', 1500, futureDate, futureArrival, 'DAD', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 150 }]));
      });
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('Route mismatch');
    });

    it('14. return route mismatch rejected -> BadRequestException \'Route mismatch\'', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'f3') return Promise.resolve(F3_RET());
        return Promise.resolve(mkFlight('f4', 'FL4', 900, laterFuture, laterFutureArrival, 'DAD', 'SGN', [{ _id: 'i4', id: 'i4', available_seats: 10, base_price: 130 }]));
      });
      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4', new_return_inventory_id: 'i4'
        } as any)
      ).rejects.toThrow('Route mismatch');
    });

    it('15. past outbound rejected -> BadRequestException \'in the past\'', async () => {
      const pastDate = new Date(Date.now() - 100000);
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        return Promise.resolve(mkFlight('f2', 'FL2', 1500, pastDate, pastDate, 'SGN', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 150 }]));
      });
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('in the past');
    });

    it('16. return departure before outbound ARRIVAL rejected -> BadRequestException \'depart after\'', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      const f2 = F2();
      const f4 = F4_RET();
      f2.scheduled_departure = new Date(futureDate.getTime() + 1 * 3600000);
      f2.scheduled_arrival = new Date(futureDate.getTime() + 13 * 3600000);
      f4.scheduled_departure = new Date(futureDate.getTime() + 6 * 3600000); // 6h < 13h -> departs before arrival
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        if (id === 'f3') return Promise.resolve(F3_RET());
        if (id === 'f4') return Promise.resolve(f4);
        return Promise.resolve(null);
      });
      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4', new_return_inventory_id: 'i4'
        } as any)
      ).rejects.toThrow('depart after');
    });

    it('17. valid return after outbound arrival accepted -> succeeds', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      const f2 = F2();
      const f4 = F4_RET();
      f2.scheduled_departure = new Date(futureDate.getTime() + 1 * 3600000);
      f2.scheduled_arrival = new Date(futureDate.getTime() + 13 * 3600000);
      f4.scheduled_departure = new Date(futureDate.getTime() + 24 * 3600000); // 24h > 13h -> after arrival
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        if (id === 'f3') return Promise.resolve(F3_RET());
        if (id === 'f4') return Promise.resolve(f4);
        return Promise.resolve(null);
      });
      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f2', new_inventory_id: 'i2',
        new_return_flight_id: 'f4', new_return_inventory_id: 'i4',
        payment_method: PaymentMethod.PROFILE_CARD,
      } as any);
      expect(res).toBeDefined();
    });

    it('18. KEEP OLD RETURN before outbound arrival -> rejected', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      const f2 = F2();
      const f3 = F3_RET();
      f2.scheduled_departure = new Date(futureDate.getTime() + 1 * 3600000);
      f2.scheduled_arrival = new Date(futureDate.getTime() + 13 * 3600000);
      f3.scheduled_departure = new Date(futureDate.getTime() + 6 * 3600000);
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        if (id === 'f3') return Promise.resolve(f3);
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2'
        } as any)
      ).rejects.toThrow('departs before');
    });

    it('19. KEEP OLD RETURN after outbound arrival -> accepted', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      const f2 = F2();
      const f3 = F3_RET();
      f2.scheduled_departure = new Date(futureDate.getTime() + 1 * 3600000);
      f2.scheduled_arrival = new Date(futureDate.getTime() + 13 * 3600000);
      f3.scheduled_departure = new Date(futureDate.getTime() + 24 * 3600000);
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        if (id === 'f3') return Promise.resolve(f3);
        return Promise.resolve(null);
      });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f2', new_inventory_id: 'i2',
        payment_method: PaymentMethod.PROFILE_CARD,
      } as any);
      expect(res).toBeDefined();
    });

    it('20. CANCELLED outbound rejected', async () => {
      const f2 = F2();
      f2.status = 'CANCELLED';
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('CANCELLED');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('21. CANCELLED return rejected', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      const f4 = F4_RET();
      f4.status = 'CANCELLED';
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'f3') return Promise.resolve(F3_RET());
        if (id === 'f4') return Promise.resolve(f4);
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2', new_inventory_id: 'i2',
          new_return_flight_id: 'f4', new_return_inventory_id: 'i4'
        } as any)
      ).rejects.toThrow('CANCELLED');
    });

    it('22. COMPLETED outbound rejected', async () => {
      const f2 = F2();
      f2.status = 'COMPLETED';
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(f2);
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('COMPLETED');
    });

    it('23. CONNECTING explicitly rejected -> BadRequestException \'Connecting itinerary\'', async () => {
      mockBooking.booking_type = 'CONNECTING';
      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)
      ).rejects.toThrow('Connecting itinerary reschedule is not yet supported');
    });

    it('24. save failure restores booking in-memory state -> confirmation_number, total_amount, ticket_coupons, total_miles_accrued all restored to original', async () => {
      mockBooking.save.mockRejectedValue(new Error('DB error'));
      const origConf = mockBooking.confirmation_number;
      const origAmount = mockBooking.total_amount;
      const origCoupons = [...mockBooking.ticket_coupons];
      const origMiles = mockBooking.total_miles_accrued;

      await expect(
        service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any)
      ).rejects.toThrow('DB error');

      expect(mockBooking.confirmation_number).toBe(origConf);
      expect(mockBooking.total_amount).toBe(origAmount);
      expect(mockBooking.ticket_coupons).toEqual(origCoupons);
      expect(mockBooking.total_miles_accrued).toBe(origMiles);
    });

    it('25. VND response -> message contains \'VND\', not \'USD\'', async () => {
      const res = await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2', payment_method: PaymentMethod.PROFILE_CARD } as any);
      expect(res.message).toContain('VND');
      expect(res.message).not.toContain('USD');
    });

    it('26. CONNECTING with valid new_legs -> successful reschedule with multi-leg atomic reservation, price delta, and SkyMiles update', async () => {
      mockBooking.booking_type = 'CONNECTING';
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_LEG_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 },
        { leg_type: 'CONNECTING_LEG_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 100 },
      ];
      mockBooking.total_miles_accrued = 1000;

      const newLeg1 = {
        _id: 'f_new1',
        flight_number: 'VN10',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        distance_miles: 400,
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        scheduled_departure: futureDate,
        scheduled_arrival: futureArrival,
        inventories: [{ _id: 'inv_new1', id: 'inv_new1', available_seats: 10, base_price: 150, cabin_class: 'ECONOMY', is_smoking: false }],
        status: 'SCHEDULED',
      };
      const newLeg2 = {
        _id: 'f_new2',
        flight_number: 'VN20',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        distance_miles: 600,
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        scheduled_departure: new Date(futureArrival.getTime() + 2 * 3600000),
        scheduled_arrival: new Date(futureArrival.getTime() + 4 * 3600000),
        inventories: [{ _id: 'inv_new2', id: 'inv_new2', available_seats: 10, base_price: 150, cabin_class: 'ECONOMY', is_smoking: false }],
        status: 'SCHEDULED',
      };

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f_new1') return Promise.resolve(newLeg1);
        if (id === 'f_new2') return Promise.resolve(newLeg2);
        if (id === 'f1') return Promise.resolve({ ...newLeg1, _id: 'f1', inventories: [{ _id: 'i1' }] });
        if (id === 'f2') return Promise.resolve({ ...newLeg2, _id: 'f2', inventories: [{ _id: 'i2' }] });
        return Promise.resolve(null);
      });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_new1',
        new_inventory_id: 'inv_new1',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [
          { flight_id: 'f_new1', inventory_id: 'inv_new1' },
          { flight_id: 'f_new2', inventory_id: 'inv_new2' },
        ],
      } as any);

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f_new1', 'inv_new1', 1);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f_new2', 'inv_new2', 1);
      expect(flightsService.restoreSeatsWithSaga).toHaveBeenCalledWith('f1', 'i1', 1, expect.any(Object));
      expect(flightsService.restoreSeatsWithSaga).toHaveBeenCalledWith('f2', 'i2', 1, expect.any(Object));
      expect(res.message).toContain('Đổi vé nối chuyến thành công');
      expect(res.booking.total_miles_accrued).toBe(1000);
    });

    it('27. CONNECTING with layover < 45m -> rejected before any reservation', async () => {
      mockBooking.booking_type = 'CONNECTING';
      const newLeg1 = {
        _id: 'f_new1',
        flight_number: 'VN10',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        scheduled_departure: futureDate,
        scheduled_arrival: new Date(futureDate.getTime() + 75 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new1', id: 'inv_new1', base_price: 150 }],
      };
      const newLeg2 = {
        _id: 'f_new2',
        flight_number: 'VN20',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        scheduled_departure: new Date(futureDate.getTime() + 90 * 60000), // 15 min layover < 45 min
        scheduled_arrival: new Date(futureDate.getTime() + 165 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new2', id: 'inv_new2', base_price: 150 }],
      };

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f_new1') return Promise.resolve(newLeg1);
        if (id === 'f_new2') return Promise.resolve(newLeg2);
        if (id === 'f1') return Promise.resolve({ ...newLeg1, _id: 'f1', origin_iata: 'HAN', dest_iata: 'SGN' });
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f_new1',
          new_inventory_id: 'inv_new1',
          new_legs: [
            { flight_id: 'f_new1', inventory_id: 'inv_new1' },
            { flight_id: 'f_new2', inventory_id: 'inv_new2' },
          ],
        } as any)
      ).rejects.toThrow('between 45 and 720 minutes');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('28. CONNECTING with route discontinuity -> rejected before any reservation', async () => {
      mockBooking.booking_type = 'CONNECTING';
      const newLeg1 = {
        _id: 'f_new1',
        flight_number: 'VN10',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        scheduled_departure: futureDate,
        scheduled_arrival: new Date(futureDate.getTime() + 75 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new1', id: 'inv_new1', base_price: 150 }],
      };
      const newLeg2 = {
        _id: 'f_new2',
        flight_number: 'VN20',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'CXR', // Discontinuous: DAD != CXR
        dest_iata: 'SGN',
        scheduled_departure: new Date(futureDate.getTime() + 150 * 60000),
        scheduled_arrival: new Date(futureDate.getTime() + 225 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new2', id: 'inv_new2', base_price: 150 }],
      };

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f_new1') return Promise.resolve(newLeg1);
        if (id === 'f_new2') return Promise.resolve(newLeg2);
        if (id === 'f1') {
          return Promise.resolve({
            ...newLeg1,
            _id: 'f1',
            origin_iata: 'HAN',
            dest_iata: 'SGN',
            inventories: [{ _id: 'i1' }],
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f_new1',
          new_inventory_id: 'inv_new1',
          new_legs: [
            { flight_id: 'f_new1', inventory_id: 'inv_new1' },
            { flight_id: 'f_new2', inventory_id: 'inv_new2' },
          ],
        } as any)
      ).rejects.toThrow('Connecting airport mismatch');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('29. CONNECTING reservation failure on leg 2 -> rolls back leg 1 and does not modify old booking', async () => {
      mockBooking.booking_type = 'CONNECTING';
      mockBooking.ticket_coupons = [{ flight_id: 'f1', inventory_id: 'i1' }];
      const newLeg1 = {
        _id: 'f_new1',
        flight_number: 'VN10',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        scheduled_departure: futureDate,
        scheduled_arrival: new Date(futureDate.getTime() + 75 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new1', id: 'inv_new1', base_price: 150 }],
      };
      const newLeg2 = {
        _id: 'f_new2',
        flight_number: 'VN20',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        scheduled_departure: new Date(futureDate.getTime() + 150 * 60000),
        scheduled_arrival: new Date(futureDate.getTime() + 225 * 60000),
        status: 'SCHEDULED',
        inventories: [{ _id: 'inv_new2', id: 'inv_new2', base_price: 150 }],
      };

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f_new1') return Promise.resolve(newLeg1);
        if (id === 'f_new2') return Promise.resolve(newLeg2);
        if (id === 'f1') {
          return Promise.resolve({
            ...newLeg1,
            _id: 'f1',
            origin_iata: 'HAN',
            dest_iata: 'SGN',
            inventories: [{ _id: 'i1' }],
          });
        }
        return Promise.resolve(null);
      });

      flightsService.reserveSeats.mockImplementation((fId: string) => {
        if (fId === 'f_new1') return Promise.resolve(true);
        if (fId === 'f_new2') return Promise.resolve(false);
        return Promise.resolve(false);
      });

      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f_new1',
          new_inventory_id: 'inv_new1',
          new_legs: [
            { flight_id: 'f_new1', inventory_id: 'inv_new1' },
            { flight_id: 'f_new2', inventory_id: 'inv_new2' },
          ],
        } as any)
      ).rejects.toThrow('Not enough available seats');

      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f_new1', 'inv_new1', 1);
    });

    it('30. CONNECTING save failure restores old legs and releases new legs exactly once', async () => {
      mockBooking.booking_type = BookingType.CONNECTING;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_LEG_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 },
        { leg_type: 'CONNECTING_LEG_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 100 },
      ];
      mockBooking.save.mockRejectedValue(new Error('booking write failed'));
      const oldLeg1 = { ...F1(), origin_iata: 'HAN', dest_iata: 'DAD' };
      const oldLeg2 = { ...F2(), origin_iata: 'DAD', dest_iata: 'SGN' };
      const newLeg1 = { ...oldLeg1, _id: 'n1', flight_number: 'VN10', inventories: [{ _id: 'ni1', id: 'ni1', base_price: 150 }] };
      const newLeg2 = { ...oldLeg2, _id: 'n2', flight_number: 'VN20', inventories: [{ _id: 'ni2', id: 'ni2', base_price: 150 }] };
      newLeg1.scheduled_arrival = new Date(newLeg1.scheduled_departure.getTime() + 60 * 60000);
      newLeg2.scheduled_departure = new Date(newLeg1.scheduled_arrival.getTime() + 60 * 60000);
      newLeg2.scheduled_arrival = new Date(newLeg2.scheduled_departure.getTime() + 60 * 60000);
      flightsService.findById.mockImplementation((id: string) => Promise.resolve({ f1: oldLeg1, f2: oldLeg2, n1: newLeg1, n2: newLeg2 }[id]));

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [
          { flight_id: 'n1', inventory_id: 'ni1' },
          { flight_id: 'n2', inventory_id: 'ni2' },
        ],
      } as any)).rejects.toThrow('booking write failed');

      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('n1', 'ni1', 1);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('n2', 'ni2', 1);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledTimes(2);
      expect(mockBooking.ticket_coupons.map((coupon: any) => coupon.flight_id)).toEqual(['f1', 'f2']);
    });

    it('31. CONNECTING cannot change the original journey endpoints', async () => {
      mockBooking.booking_type = BookingType.CONNECTING;
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1' },
        { flight_id: 'f2', inventory_id: 'i2' },
      ];
      const oldLeg1 = { ...F1(), origin_iata: 'HAN', dest_iata: 'DAD' };
      const oldLeg2 = { ...F2(), origin_iata: 'DAD', dest_iata: 'SGN' };
      const newLeg1 = { ...oldLeg1, _id: 'n1', origin_iata: 'HPH', inventories: [{ _id: 'ni1', id: 'ni1', base_price: 100 }] };
      const newLeg2 = { ...oldLeg2, _id: 'n2', dest_iata: 'DAD', inventories: [{ _id: 'ni2', id: 'ni2', base_price: 100 }] };
      newLeg1.scheduled_arrival = new Date(newLeg1.scheduled_departure.getTime() + 60 * 60000);
      newLeg2.origin_iata = newLeg1.dest_iata;
      newLeg2.scheduled_departure = new Date(newLeg1.scheduled_arrival.getTime() + 60 * 60000);
      newLeg2.scheduled_arrival = new Date(newLeg2.scheduled_departure.getTime() + 60 * 60000);
      flightsService.findById.mockImplementation((id: string) => Promise.resolve({ f1: oldLeg1, f2: oldLeg2, n1: newLeg1, n2: newLeg2 }[id]));

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_legs: [{ flight_id: 'n1', inventory_id: 'ni1' }, { flight_id: 'n2', inventory_id: 'ni2' }],
      } as any)).rejects.toThrow('does not match original journey');
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    // ====== Mixed ROUND_TRIP (connecting + direct directions) ======

    it('32. ROUND_TRIP connecting outbound + direct return -> reschedule outbound via new_legs, keep return', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 80 },
        { leg_type: 'CONNECTING_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 70 },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 },
      ];
      mockBooking.total_amount = 250;

      const outLeg1 = mkFlight('f1', 'FL1', 400, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'DAD',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 80 }]);
      const outLeg2 = mkFlight('f2', 'FL2', 300, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'DAD', 'HAN',
        [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 70 }]);
      const retLeg = mkFlight('f3', 'FL3', 700, laterFuture, laterFutureArrival, 'HAN', 'SGN',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 100 }]);

      // New outbound connecting via different transit
      const newOut1 = mkFlight('n1', 'NF1', 450, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'CXR',
        [{ _id: 'ni1', id: 'ni1', available_seats: 10, base_price: 90, cabin_class: 'ECONOMY', is_smoking: false }]);
      const newOut2 = mkFlight('n2', 'NF2', 350, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'CXR', 'HAN',
        [{ _id: 'ni2', id: 'ni2', available_seats: 10, base_price: 95, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg1, f2: outLeg2, f3: retLeg, n1: newOut1, n2: newOut2 };
        return Promise.resolve(map[id]);
      });

      const result = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [
          { flight_id: 'n1', inventory_id: 'ni1' },
          { flight_id: 'n2', inventory_id: 'ni2' },
        ],
      } as any);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      // Old return coupon preserved
      const returnCoupons = result.booking.ticket_coupons.filter((c: any) => c.leg_type === 'INBOUND');
      expect(returnCoupons.length).toBe(1);
      expect(returnCoupons[0].fare_paid).toBe(100);
      // New outbound connecting coupons
      const outCoupons = result.booking.ticket_coupons.filter((c: any) => /^CONNECTING_\d+$/.test(c.leg_type));
      expect(outCoupons.length).toBe(2);
      expect(result.message).toContain('VND');
    });

    it('33. ROUND_TRIP direct outbound + connecting return -> reschedule return via new_return_legs', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 },
        { leg_type: 'INBOUND_1', flight_id: 'f3', inventory_id: 'i3', fare_paid: 60 },
        { leg_type: 'INBOUND_2', flight_id: 'f4', inventory_id: 'i4', fare_paid: 60 },
      ];
      mockBooking.total_amount = 220;

      const outLeg = mkFlight('f1', 'FL1', 700, futureDate, futureArrival, 'SGN', 'HAN',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 100 }]);
      const retLeg1 = mkFlight('f3', 'FL3', 350, laterFuture, new Date(laterFuture.getTime() + 2 * 3600000), 'HAN', 'DAD',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 60 }]);
      const retLeg2 = mkFlight('f4', 'FL4', 350, new Date(laterFuture.getTime() + 3 * 3600000),
        new Date(laterFuture.getTime() + 5 * 3600000), 'DAD', 'SGN',
        [{ _id: 'i4', id: 'i4', available_seats: 10, base_price: 60 }]);

      // New return connecting via different transit
      const newRet1 = mkFlight('nr1', 'NR1', 400, laterFuture, new Date(laterFuture.getTime() + 2 * 3600000), 'HAN', 'CXR',
        [{ _id: 'nri1', id: 'nri1', available_seats: 10, base_price: 75, cabin_class: 'ECONOMY', is_smoking: false }]);
      const newRet2 = mkFlight('nr2', 'NR2', 400, new Date(laterFuture.getTime() + 3 * 3600000),
        new Date(laterFuture.getTime() + 5 * 3600000), 'CXR', 'SGN',
        [{ _id: 'nri2', id: 'nri2', available_seats: 10, base_price: 80, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg, f3: retLeg1, f4: retLeg2, nr1: newRet1, nr2: newRet2 };
        return Promise.resolve(map[id]);
      });

      const result = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_return_legs: [
          { flight_id: 'nr1', inventory_id: 'nri1' },
          { flight_id: 'nr2', inventory_id: 'nri2' },
        ],
      } as any);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      // Old outbound preserved
      const outCoupons = result.booking.ticket_coupons.filter((c: any) => c.leg_type === 'OUTBOUND');
      expect(outCoupons.length).toBe(1);
      expect(outCoupons[0].fare_paid).toBe(100);
      // New return connecting coupons
      const retCoupons = result.booking.ticket_coupons.filter((c: any) => /^INBOUND_\d+$/.test(c.leg_type));
      expect(retCoupons.length).toBe(2);
      expect(result.message).toContain('Return leg');
    });

    it('34. ROUND_TRIP connecting outbound + connecting return -> reschedule both directions', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 80 },
        { leg_type: 'CONNECTING_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 70 },
        { leg_type: 'INBOUND_1', flight_id: 'f3', inventory_id: 'i3', fare_paid: 60 },
        { leg_type: 'INBOUND_2', flight_id: 'f4', inventory_id: 'i4', fare_paid: 60 },
      ];
      mockBooking.total_amount = 270;

      const outLeg1 = mkFlight('f1', 'FL1', 400, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'DAD',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 80 }]);
      const outLeg2 = mkFlight('f2', 'FL2', 300, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'DAD', 'HAN',
        [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 70 }]);
      const retLeg1 = mkFlight('f3', 'FL3', 350, laterFuture, new Date(laterFuture.getTime() + 2 * 3600000), 'HAN', 'DAD',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 60 }]);
      const retLeg2 = mkFlight('f4', 'FL4', 350, new Date(laterFuture.getTime() + 3 * 3600000),
        new Date(laterFuture.getTime() + 5 * 3600000), 'DAD', 'SGN',
        [{ _id: 'i4', id: 'i4', available_seats: 10, base_price: 60 }]);

      const nOut1 = mkFlight('n1', 'NF1', 450, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'CXR',
        [{ _id: 'ni1', id: 'ni1', available_seats: 10, base_price: 90, cabin_class: 'ECONOMY', is_smoking: false }]);
      const nOut2 = mkFlight('n2', 'NF2', 350, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'CXR', 'HAN',
        [{ _id: 'ni2', id: 'ni2', available_seats: 10, base_price: 95, cabin_class: 'ECONOMY', is_smoking: false }]);
      const nRet1 = mkFlight('nr1', 'NR1', 400, laterFuture, new Date(laterFuture.getTime() + 2 * 3600000), 'HAN', 'CXR',
        [{ _id: 'nri1', id: 'nri1', available_seats: 10, base_price: 75, cabin_class: 'ECONOMY', is_smoking: false }]);
      const nRet2 = mkFlight('nr2', 'NR2', 400, new Date(laterFuture.getTime() + 3 * 3600000),
        new Date(laterFuture.getTime() + 5 * 3600000), 'CXR', 'SGN',
        [{ _id: 'nri2', id: 'nri2', available_seats: 10, base_price: 80, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg1, f2: outLeg2, f3: retLeg1, f4: retLeg2, n1: nOut1, n2: nOut2, nr1: nRet1, nr2: nRet2 };
        return Promise.resolve(map[id]);
      });

      const result = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [{ flight_id: 'n1', inventory_id: 'ni1' }, { flight_id: 'n2', inventory_id: 'ni2' }],
        new_return_legs: [{ flight_id: 'nr1', inventory_id: 'nri1' }, { flight_id: 'nr2', inventory_id: 'nri2' }],
      } as any);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      const outCoupons = result.booking.ticket_coupons.filter((c: any) => /^CONNECTING_\d+$/.test(c.leg_type));
      const retCoupons = result.booking.ticket_coupons.filter((c: any) => /^INBOUND_\d+$/.test(c.leg_type));
      expect(outCoupons.length).toBe(2);
      expect(retCoupons.length).toBe(2);
      expect(result.message).toContain('Outbound and return legs');
    });

    it('35. Mixed ROUND_TRIP save failure -> exact rollback: old seats restored, new seats released, SkyMiles restored, booking snapshot', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 80 },
        { leg_type: 'CONNECTING_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 70 },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 },
      ];
      mockBooking.total_amount = 250;
      mockBooking.total_miles_accrued = 1000;
      mockBooking.confirmation_number = 'CNF-ORIG';
      mockBooking.save.mockRejectedValue(new Error('DB save failed'));

      const outLeg1 = mkFlight('f1', 'FL1', 400, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'DAD',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 80 }]);
      const outLeg2 = mkFlight('f2', 'FL2', 300, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'DAD', 'HAN',
        [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 70 }]);
      const retLeg = mkFlight('f3', 'FL3', 700, laterFuture, laterFutureArrival, 'HAN', 'SGN',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 100 }]);

      const nOut1 = mkFlight('n1', 'NF1', 450, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'CXR',
        [{ _id: 'ni1', id: 'ni1', available_seats: 10, base_price: 90, cabin_class: 'ECONOMY', is_smoking: false }]);
      const nOut2 = mkFlight('n2', 'NF2', 350, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'CXR', 'HAN',
        [{ _id: 'ni2', id: 'ni2', available_seats: 10, base_price: 95, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg1, f2: outLeg2, f3: retLeg, n1: nOut1, n2: nOut2 };
        return Promise.resolve(map[id]);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [{ flight_id: 'n1', inventory_id: 'ni1' }, { flight_id: 'n2', inventory_id: 'ni2' }],
      } as any)).rejects.toThrow('DB save failed');

      // Booking snapshot fully restored
      expect(mockBooking.total_amount).toBe(250);
      expect(mockBooking.confirmation_number).toBe('CNF-ORIG');
      expect(mockBooking.total_miles_accrued).toBe(1000);
      expect(mockBooking.ticket_coupons).toHaveLength(3);
      expect(mockBooking.ticket_coupons[0].leg_type).toBe('CONNECTING_1');

      // SkyMiles restored
      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user1', 5000);

      // Exact seat mutations: old outbound untouched (not released pre-commit), new legs released (n1/ni1, n2/ni2)
      // Return (f3/i3) unchanged direction should NOT be adjusted
      const seatCalls = flightsService.updateAvailableSeats.mock.calls;
      const seatCallArgs = seatCalls.map((c: any) => `${c[0]}/${c[1]}/${c[2] > 0 ? '+' : '-'}${Math.abs(c[2])}`);
      // Old outbound was never touched pre-commit
      expect(seatCallArgs.filter((s: string) => s.includes('f1/i1') || s.includes('f2/i2'))).toHaveLength(0);
      // New legs released (positive = release reserved seats)
      expect(seatCallArgs).toContainEqual(expect.stringContaining('n1/ni1'));
      expect(seatCallArgs).toContainEqual(expect.stringContaining('n2/ni2'));
      // Unchanged return direction NOT touched
      const returnSeatCalls = seatCalls.filter((c: any) => c[0] === 'f3');
      expect(returnSeatCalls).toHaveLength(0);
    });

    it('36. Multi-passenger direct ROUND_TRIP not misclassified as connecting', async () => {
      // 2 passengers, 1 direct outbound, 1 direct return => 4 coupons total
      // Must NOT be misclassified as connecting outbound
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.passengers = [
        { passenger_type: PassengerType.ADULT, first_name: 'A', last_name: 'B' },
        { passenger_type: PassengerType.ADULT, first_name: 'C', last_name: 'D' },
      ];
      mockBooking.ticket_coupons = [
        { leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100, seat_code: '1A' },
        { leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100, seat_code: '1B' },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 120, seat_code: '2A' },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 120, seat_code: '2B' },
      ];
      mockBooking.total_amount = 440;

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'f3') return Promise.resolve(F3_RET());
        if (id === 'f4') return Promise.resolve(F4_RET());
        return Promise.resolve(mkFlight(id, 'FLX', 500, futureDate, futureArrival, 'SGN', 'HAN', []));
      });

      // Direct reschedule: new_flight_id/new_inventory_id — should follow existing direct ROUND_TRIP path, NOT mixed
      const result = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f2',
        new_inventory_id: 'i2',
        payment_method: PaymentMethod.PROFILE_CARD,
      } as any);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      // Outbound coupons replaced, return preserved
      const outCoupons = result.booking.ticket_coupons.filter((c: any) => c.leg_type === 'OUTBOUND');
      const retCoupons = result.booking.ticket_coupons.filter((c: any) => c.leg_type === 'INBOUND');
      expect(outCoupons.length).toBe(2); // 2 passengers
      expect(retCoupons.length).toBe(2); // return preserved
    });

    it('37. Legacy CONNECTING_LEG_n coupons correctly grouped for mixed ROUND_TRIP', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_LEG_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 80 },
        { leg_type: 'CONNECTING_LEG_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 70 },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 },
      ];
      mockBooking.total_amount = 250;

      const outLeg1 = mkFlight('f1', 'FL1', 400, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'DAD',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 80 }]);
      const outLeg2 = mkFlight('f2', 'FL2', 300, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'DAD', 'HAN',
        [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 70 }]);
      const retLeg = mkFlight('f3', 'FL3', 700, laterFuture, laterFutureArrival, 'HAN', 'SGN',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 100 }]);

      const nOut1 = mkFlight('n1', 'NF1', 450, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'CXR',
        [{ _id: 'ni1', id: 'ni1', available_seats: 10, base_price: 90, cabin_class: 'ECONOMY', is_smoking: false }]);
      const nOut2 = mkFlight('n2', 'NF2', 350, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'CXR', 'HAN',
        [{ _id: 'ni2', id: 'ni2', available_seats: 10, base_price: 95, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg1, f2: outLeg2, f3: retLeg, n1: nOut1, n2: nOut2 };
        return Promise.resolve(map[id]);
      });

      const result = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [
          { flight_id: 'n1', inventory_id: 'ni1' },
          { flight_id: 'n2', inventory_id: 'ni2' },
        ],
      } as any);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMED);
      // Legacy coupons were correctly classified as outbound connecting
      const retCoupons = result.booking.ticket_coupons.filter((c: any) => c.leg_type === 'INBOUND');
      expect(retCoupons.length).toBe(1); // Return preserved
      expect(retCoupons[0].fare_paid).toBe(100);
      const outCoupons = result.booking.ticket_coupons.filter((c: any) => /^CONNECTING_\d+$/.test(c.leg_type));
      expect(outCoupons.length).toBe(2); // New connecting outbound
    });

    it('38. 4-leg connecting replacement rejected before reservations', async () => {
      mockBooking.booking_type = BookingType.ROUND_TRIP;
      mockBooking.ticket_coupons = [
        { leg_type: 'CONNECTING_1', flight_id: 'f1', inventory_id: 'i1', fare_paid: 80 },
        { leg_type: 'CONNECTING_2', flight_id: 'f2', inventory_id: 'i2', fare_paid: 70 },
        { leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 },
      ];
      mockBooking.total_amount = 250;

      const outLeg1 = mkFlight('f1', 'FL1', 400, futureDate, new Date(futureDate.getTime() + 2 * 3600000), 'SGN', 'DAD',
        [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 80 }]);
      const outLeg2 = mkFlight('f2', 'FL2', 300, new Date(futureDate.getTime() + 3 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'DAD', 'HAN',
        [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 70 }]);
      const retLeg = mkFlight('f3', 'FL3', 700, laterFuture, laterFutureArrival, 'HAN', 'SGN',
        [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 100 }]);

      // 4 legs for replacement
      const n1 = mkFlight('n1', 'NF1', 200, futureDate, new Date(futureDate.getTime() + 1 * 3600000), 'SGN', 'DAD',
        [{ _id: 'ni1', id: 'ni1', available_seats: 10, base_price: 50, cabin_class: 'ECONOMY', is_smoking: false }]);
      const n2 = mkFlight('n2', 'NF2', 200, new Date(futureDate.getTime() + 2 * 3600000),
        new Date(futureDate.getTime() + 3 * 3600000), 'DAD', 'HUE',
        [{ _id: 'ni2', id: 'ni2', available_seats: 10, base_price: 50, cabin_class: 'ECONOMY', is_smoking: false }]);
      const n3 = mkFlight('n3', 'NF3', 200, new Date(futureDate.getTime() + 4 * 3600000),
        new Date(futureDate.getTime() + 5 * 3600000), 'HUE', 'VDO',
        [{ _id: 'ni3', id: 'ni3', available_seats: 10, base_price: 50, cabin_class: 'ECONOMY', is_smoking: false }]);
      const n4 = mkFlight('n4', 'NF4', 200, new Date(futureDate.getTime() + 6 * 3600000),
        new Date(futureDate.getTime() + 7 * 3600000), 'VDO', 'HAN',
        [{ _id: 'ni4', id: 'ni4', available_seats: 10, base_price: 50, cabin_class: 'ECONOMY', is_smoking: false }]);

      flightsService.findById.mockImplementation((id: string) => {
        const map: any = { f1: outLeg1, f2: outLeg2, f3: retLeg, n1, n2, n3, n4 };
        return Promise.resolve(map[id]);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_legs: [
          { flight_id: 'n1', inventory_id: 'ni1' },
          { flight_id: 'n2', inventory_id: 'ni2' },
          { flight_id: 'n3', inventory_id: 'ni3' },
          { flight_id: 'n4', inventory_id: 'ni4' },
        ],
      } as any)).rejects.toThrow(/2 or 3 legs/);

      // Rejected BEFORE reservations
      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('39. DIRECT — departure_date === max_date late in day accepted', async () => {
      const { max_date } = getBookingWindowLimits();
      // Late in the day on max_date (e.g. 23:55:00 UTC)
      const lateDep = new Date(`${max_date}T23:55:00.000Z`);
      const lateArr = new Date(lateDep.getTime() + 2 * 3600000);
      const boundaryFlight = mkFlight(
        'f_boundary', 'FL_BOUND', 1000, lateDep, lateArr, 'SGN', 'HAN',
        [{ _id: 'i_bound', id: 'i_bound', available_seats: 10, base_price: 100 }],
        'SCHEDULED',
        max_date,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f_boundary') return Promise.resolve(boundaryFlight);
        return Promise.resolve(null);
      });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_boundary',
        new_inventory_id: 'i_bound',
      } as any);

      expect(res).toBeDefined();
      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f_boundary', 'i_bound', 1);
    });

    it('40. DIRECT — departure_date is day after max_date rejected before reserving seats', async () => {
      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterObj = new Date(maxDateObj.getTime() + 86400000);
      const dayAfterStr = dayAfterObj.toISOString().split('T')[0];

      const afterDep = new Date(`${dayAfterStr}T08:00:00.000Z`);
      const afterArr = new Date(afterDep.getTime() + 2 * 3600000);
      const afterFlight = mkFlight(
        'f_after', 'FL_AFTER', 1000, afterDep, afterArr, 'SGN', 'HAN',
        [{ _id: 'i_after', id: 'i_after', available_seats: 10, base_price: 100 }],
        'SCHEDULED',
        dayAfterStr,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f_after') return Promise.resolve(afterFlight);
        return Promise.resolve(null);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_after',
        new_inventory_id: 'i_after',
      } as any)).rejects.toThrow(/exceeds maximum advance booking window/);

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('41. CONNECTING — first leg departure_date === max_date, second leg after midnight accepted', async () => {
      mockBooking.booking_type = BookingType.CONNECTING;
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1' },
        { flight_id: 'f2', inventory_id: 'i2' },
      ];

      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterObj = new Date(maxDateObj.getTime() + 86400000);
      const dayAfterStr = dayAfterObj.toISOString().split('T')[0];

      // Leg 1 departs late on max_date, arrives around midnight
      const leg1Dep = new Date(`${max_date}T22:30:00.000Z`);
      const leg1Arr = new Date(`${max_date}T23:45:00.000Z`);
      const connLeg1 = mkFlight(
        'c1', 'CFL1', 400, leg1Dep, leg1Arr, 'SGN', 'DAD',
        [{ _id: 'ci1', id: 'ci1', available_seats: 10, base_price: 90, cabin_class: 'ECONOMY', is_smoking: false }],
        'SCHEDULED',
        max_date,
      );

      // Leg 2 departs after midnight on the NEXT calendar day (day after max_date!)
      // Layover: 23:45 to 01:15 is 90 minutes (valid: 45 <= 90 <= 720)
      const leg2Dep = new Date(`${dayAfterStr}T01:15:00.000Z`);
      const leg2Arr = new Date(`${dayAfterStr}T02:45:00.000Z`);
      const connLeg2 = mkFlight(
        'c2', 'CFL2', 600, leg2Dep, leg2Arr, 'DAD', 'HAN',
        [{ _id: 'ci2', id: 'ci2', available_seats: 10, base_price: 80, cabin_class: 'ECONOMY', is_smoking: false }],
        'SCHEDULED',
        dayAfterStr,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'c1') return Promise.resolve(connLeg1);
        if (id === 'c2') return Promise.resolve(connLeg2);
        return Promise.resolve(null);
      });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        payment_method: PaymentMethod.PROFILE_CARD,
        new_legs: [
          { flight_id: 'c1', inventory_id: 'ci1' },
          { flight_id: 'c2', inventory_id: 'ci2' },
        ],
      } as any);

      expect(res).toBeDefined();
      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('c1', 'ci1', 1);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('c2', 'ci2', 1);
    });

    it('42. CONNECTING — first leg operating date is after max_date rejected before reserving seats', async () => {
      mockBooking.booking_type = BookingType.CONNECTING;
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1' },
        { flight_id: 'f2', inventory_id: 'i2' },
      ];

      const { max_date } = getBookingWindowLimits();
      const maxDateObj = new Date(`${max_date}T00:00:00.000Z`);
      const dayAfterObj = new Date(maxDateObj.getTime() + 86400000);
      const dayAfterStr = dayAfterObj.toISOString().split('T')[0];

      const leg1Dep = new Date(`${dayAfterStr}T10:00:00.000Z`);
      const leg1Arr = new Date(`${dayAfterStr}T11:15:00.000Z`);
      const connLeg1 = mkFlight(
        'c1_late', 'CFL1_L', 400, leg1Dep, leg1Arr, 'SGN', 'DAD',
        [{ _id: 'ci1', id: 'ci1', available_seats: 10, base_price: 90 }],
        'SCHEDULED',
        dayAfterStr,
      );

      const leg2Dep = new Date(`${dayAfterStr}T12:30:00.000Z`);
      const leg2Arr = new Date(`${dayAfterStr}T13:45:00.000Z`);
      const connLeg2 = mkFlight(
        'c2_late', 'CFL2_L', 600, leg2Dep, leg2Arr, 'DAD', 'HAN',
        [{ _id: 'ci2', id: 'ci2', available_seats: 10, base_price: 80 }],
        'SCHEDULED',
        dayAfterStr,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f2') return Promise.resolve(F2());
        if (id === 'c1_late') return Promise.resolve(connLeg1);
        if (id === 'c2_late') return Promise.resolve(connLeg2);
        return Promise.resolve(null);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_legs: [
          { flight_id: 'c1_late', inventory_id: 'ci1' },
          { flight_id: 'c2_late', inventory_id: 'ci2' },
        ],
      } as any)).rejects.toThrow(/exceeds maximum advance booking window/);

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('43. Already-departed flight on min_date rejected by future-flight defense', async () => {
      const { min_date } = getBookingWindowLimits();
      // 2 hours ago today
      const pastDep = new Date(Date.now() - 2 * 3600000);
      const pastArr = new Date(Date.now() - 1 * 3600000);
      const pastFlightToday = mkFlight(
        'f_past_today', 'FL_PT', 1000, pastDep, pastArr, 'SGN', 'HAN',
        [{ _id: 'i_pt', id: 'i_pt', available_seats: 10, base_price: 100 }],
        'SCHEDULED',
        min_date,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f_past_today') return Promise.resolve(pastFlightToday);
        return Promise.resolve(null);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_past_today',
        new_inventory_id: 'i_pt',
      } as any)).rejects.toThrow(/in the past/);

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('44. Operating date before min_date rejected by booking window validation', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const pastDep = new Date(Date.now() - 86400000);
      const pastArr = new Date(pastDep.getTime() + 2 * 3600000);
      const yesterdayFlight = mkFlight(
        'f_yesterday', 'FL_YEST', 1000, pastDep, pastArr, 'SGN', 'HAN',
        [{ _id: 'i_yest', id: 'i_yest', available_seats: 10, base_price: 100 }],
        'SCHEDULED',
        yesterday,
      );

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f_yesterday') return Promise.resolve(yesterdayFlight);
        return Promise.resolve(null);
      });

      await expect(service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_yesterday',
        new_inventory_id: 'i_yest',
      } as any)).rejects.toThrow(/before minimum booking date|in the past/);

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('45. valid target comfortably inside window accepted', async () => {
      const validDate = new Date(Date.now() + 60 * 86400000); // 60 days < 330 days
      const validFlight = mkFlight('f_valid', 'FL_VAL', 1000, validDate, new Date(validDate.getTime() + 2 * 3600000), 'SGN', 'HAN',
        [{ _id: 'i_val', id: 'i_val', available_seats: 10, base_price: 100 }]);

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        if (id === 'f_valid') return Promise.resolve(validFlight);
        return Promise.resolve(null);
      });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f_valid',
        new_inventory_id: 'i_val',
      } as any);

      expect(res).toBeDefined();
      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f_valid', 'i_val', 1);
    });

    it('46. reschedule charge with priceDiff > 0 and no card -> rejects with BadRequestException', async () => {
      mockUser.preferred_credit_card = undefined;
      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF',
          new_flight_id: 'f2',
          new_inventory_id: 'i2',
          payment_method: PaymentMethod.PROFILE_CARD,
        } as any),
      ).rejects.toThrow('Payment card is required for reschedule fare difference.');
    });

    it('47. reschedule refund with priceDiff < 0 -> uses original payment card_masked as destination', async () => {
      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f1') return Promise.resolve(F1());
        return Promise.resolve(mkFlight('f2', 'FL2', 500, futureDate, futureArrival, 'SGN', 'HAN', [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 50 }]));
      });
      mockBooking.total_amount = 200;
      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF',
        new_flight_id: 'f2',
        new_inventory_id: 'i2',
      } as any);

      expect(res.price_difference).toBeLessThan(0);
      const refundTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'RESCHEDULE_REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.card_masked).toBe('**** **** **** 4242');
    });
  });

  describe('cancelTicket', () => {
    let mockBooking: any;
    beforeEach(() => {
      mockBooking = {
        status: BookingStatus.CONFIRMED,
        total_amount: 1000,
        total_miles_accrued: 500,
        user_id: 'user1',
        passengers: [{}],
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 1000,
            card_masked: '**** **** **** 4242',
            status: 'SUCCESS',
            created_at: new Date(),
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.updateAvailableSeats.mockResolvedValue(true);
      flightsService.findById.mockResolvedValue({ scheduled_departure: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
      usersService.findById.mockResolvedValue({ sky_miles: 5000, preferred_credit_card: '4111222233334242' });
      policiesService.calculateRefundPercentage.mockResolvedValue(90);
    });

    it('Case A (Confirmed cancellation calculation): policy percentage * total_amount produces correct refund', async () => {
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_percentage).toBe(90);
      expect(res.refund_amount).toBe(900);
      const refundTx = mockBooking.payment_transactions.find((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.amount).toBe(900);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user1', 500);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.total_miles_accrued).toBe(0);
      expect(bookingModel.findOne).toHaveBeenCalledWith({
        $or: [
          { blocking_number: 'CNF-1' },
          { confirmation_number: 'CNF-1' },
          { pnr_code: 'CNF-1' },
        ],
      });
    });

    it('Case B (Currency convention): response message contains VND and does not contain USD, return object has currency VND', async () => {
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.currency).toBe('VND');
      expect(res.message).toContain('VND');
      expect(res.message).not.toContain('USD');
      expect(res.message).toContain('Refund: 900 VND (90%)');
    });

    it('Case C (Payment transaction card provenance): refund uses real masked card from latest successful PAYMENT transaction', async () => {
      mockBooking.payment_transactions = [
        {
          transaction_type: 'PAYMENT',
          amount: 500,
          card_masked: '**** **** **** 1111',
          status: 'SUCCESS',
          created_at: new Date(Date.now() - 10000),
        },
        {
          transaction_type: 'PAYMENT',
          amount: 500,
          card_masked: '**** **** **** 9999',
          status: 'SUCCESS',
          created_at: new Date(),
        },
      ];
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 9999');
      const refundTx = mockBooking.payment_transactions.find((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.card_masked).toBe('**** **** **** 9999');
      expect(refundTx.currency).toBe('VND');
    });

    it('Case C2 (Chronological order sorting): picks successful PAYMENT by newest valid created_at even if transaction array is out of order', async () => {
      mockBooking.payment_transactions = [
        {
          transaction_type: 'PAYMENT',
          amount: 500,
          card_masked: '**** **** **** 1111',
          status: 'SUCCESS',
          created_at: new Date('2026-09-20T10:00:00Z'),
        },
        {
          transaction_type: 'PAYMENT',
          amount: 500,
          card_masked: '**** **** **** 2222',
          status: 'SUCCESS',
          created_at: new Date('2026-09-10T10:00:00Z'), // Older, but placed at tail of array
        },
      ];
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 1111');
      const refundTx = mockBooking.payment_transactions.find((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTx.card_masked).toBe('**** **** **** 1111');
    });

    it('Case C3 (Raw historical card normalization): normalizes raw historical unmasked card to **** **** **** <last4>', async () => {
      mockBooking.payment_transactions = [
        {
          transaction_type: 'PAYMENT',
          amount: 1000,
          card_masked: '4111222233339999',
          status: 'SUCCESS',
          created_at: new Date(),
        },
      ];
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 9999');
      const refundTx = mockBooking.payment_transactions.find((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTx.card_masked).toBe('**** **** **** 9999');
    });

    it('Case D (Fake placeholders rejected): skips placeholder masks and falls back to earlier valid PAYMENT transaction or preferred credit card', async () => {
      // Scenario 1: Falls back to an earlier valid PAYMENT transaction
      mockBooking.payment_transactions = [
        {
          transaction_type: 'PAYMENT',
          amount: 250,
          card_masked: '**** **** **** 8888',
          status: 'SUCCESS',
          created_at: new Date(Date.now() - 30000),
        },
        {
          transaction_type: 'PAYMENT',
          amount: 250,
          card_masked: 'ORIGINAL-PAYMENT-CARD',
          status: 'SUCCESS',
          created_at: new Date(Date.now() - 20000),
        },
        {
          transaction_type: 'PAYMENT',
          amount: 250,
          card_masked: 'SAVED-CARD',
          status: 'SUCCESS',
          created_at: new Date(Date.now() - 10000),
        },
        {
          transaction_type: 'PAYMENT',
          amount: 250,
          card_masked: 'CARD-DEFAULT',
          status: 'SUCCESS',
          created_at: new Date(),
        },
      ];
      let res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 8888');

      // Scenario 2: If all transactions are placeholders, falls back to user.preferred_credit_card
      mockBooking.status = BookingStatus.CONFIRMED;
      mockBooking.payment_transactions = [
        {
          transaction_type: 'PAYMENT',
          amount: 1000,
          card_masked: 'CARD-DEFAULT',
          status: 'SUCCESS',
          created_at: new Date(),
        },
      ];
      usersService.findById.mockResolvedValue({
        sky_miles: 5000,
        preferred_credit_card: '4111222233337777',
      });
      res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 7777');
    });

    it('Case D2 (Placeholder preferred card rejected): rejects placeholder preferred card without creating **** **** **** AULT', async () => {
      mockBooking.payment_transactions = [];
      usersService.findById.mockResolvedValue({
        sky_miles: 5000,
        preferred_credit_card: 'CARD-DEFAULT',
      });
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(BadRequestException);
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(
        'Cannot process refund: no valid payment card found for this booking.',
      );
    });

    it('Case E (Fallback to user preferred card): when no valid PAYMENT transaction exists, falls back to masked user.preferred_credit_card', async () => {
      mockBooking.payment_transactions = [];
      usersService.findById.mockResolvedValue({
        sky_miles: 5000,
        preferred_credit_card: '4000123456781234',
      });
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_card_masked).toBe('**** **** **** 1234');
      const refundTx = mockBooking.payment_transactions.find((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.card_masked).toBe('**** **** **** 1234');
    });

    it('Case F (No card rejects before mutation): throws BadRequestException before seat release, miles deduction, or booking save', async () => {
      mockBooking.payment_transactions = [];
      usersService.findById.mockResolvedValue({
        sky_miles: 5000,
        preferred_credit_card: '',
      });
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(BadRequestException);
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(
        'Cannot process refund: no valid payment card found for this booking.',
      );
      expect(flightsService.updateAvailableSeats).not.toHaveBeenCalled();
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(mockBooking.save).not.toHaveBeenCalled();
    });

    it('Case G (Zero percent / zero amount refund): succeeds without card provenance, no fake refund transaction appended, message indicates 0 VND (0%)', async () => {
      policiesService.calculateRefundPercentage.mockResolvedValue(0);
      mockBooking.payment_transactions = [];
      usersService.findById.mockResolvedValue({
        sky_miles: 5000,
        preferred_credit_card: undefined,
      });
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_amount).toBe(0);
      expect(res.refund_percentage).toBe(0);
      expect(res.refund_card_masked).toBeUndefined();
      expect(mockBooking.payment_transactions.length).toBe(0);
      expect(res.message).toContain('0 VND (0%)');
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.save).toHaveBeenCalled();
    });

    it('Case H (Blocked cancellation): releases seats, creates no refund transaction, causes no SkyMiles mutation, and sets booking status to CANCELLED', async () => {
      mockBooking.status = BookingStatus.BLOCKED;
      mockBooking.total_amount = 0;
      mockBooking.total_miles_accrued = 0;
      mockBooking.payment_transactions = [];

      const res = await service.cancelTicket({ identifier: 'BLK-1' } as any);
      expect(res.refund_amount).toBe(0);
      expect(res.refund_percentage).toBe(0);
      expect(mockBooking.payment_transactions.length).toBe(0);
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
    });

    it('Case I (Coupon status update): marks every ticket coupon with CANCELLED', async () => {
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
      ];
      await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(mockBooking.ticket_coupons).toHaveLength(2);
      expect(mockBooking.ticket_coupons[0].coupon_status).toBe('CANCELLED');
      expect(mockBooking.ticket_coupons[1].coupon_status).toBe('CANCELLED');
    });

    it('Case J (Deduplicated distinct seat release with passenger count): restores each distinct leg once with full passenger count', async () => {
      mockBooking.passengers = [{ id: 'p1' }, { id: 'p2' }];
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
      ];
      await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledTimes(2);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 2);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f2', 'i2', 2);
    });

    it('Case K (Mileage deduction uses booking.total_miles_accrued): single deduction of aggregate miles and sets total_miles_accrued to 0', async () => {
      mockBooking.total_miles_accrued = 1500;
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
        { flight_id: 'f3', inventory_id: 'i3', coupon_status: 'ACTIVE' },
      ];
      await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(usersService.deductSkyMiles).toHaveBeenCalledTimes(1);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user1', 1500);
      expect(mockBooking.total_miles_accrued).toBe(0);
    });

    it('Case L (Seat release failure rollback): earlier released legs are compensated, no miles mutation, status and coupons preserved, no refund persisted', async () => {
      mockBooking.passengers = [{ id: 'p1' }];
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
        { flight_id: 'f3', inventory_id: 'i3', coupon_status: 'ACTIVE' },
      ];
      flightsService.updateAvailableSeats.mockImplementation((flightId: string, _inventoryId: string, change: number) => {
        if (flightId === 'f2' && change > 0) throw new Error('release failed');
        return true;
      });

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow('release failed');
      expect(flightsService.updateAvailableSeats.mock.calls).toEqual([
        ['f1', 'i1', 1],
        ['f2', 'i2', 1],
        ['f1', 'i1', -1],
      ]);
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.payment_transactions.filter((t: any) => t.transaction_type === 'REFUND')).toHaveLength(0);
      expect(mockBooking.ticket_coupons.every((c: any) => c.coupon_status === 'ACTIVE')).toBe(true);
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
    });

    it('Case L2 (Seat release rollback compensation failure): surfaces InternalServerErrorException when compensating re-reservation fails', async () => {
      mockBooking.passengers = [{ id: 'p1' }];
      mockBooking.ticket_coupons = [
        { flight_id: 'f1', inventory_id: 'i1', coupon_status: 'ACTIVE' },
        { flight_id: 'f2', inventory_id: 'i2', coupon_status: 'ACTIVE' },
      ];
      flightsService.updateAvailableSeats.mockImplementation((flightId: string, _inventoryId: string, change: number) => {
        if (flightId === 'f1' && change === 1) return true; // leg1 release succeeds
        if (flightId === 'f2' && change === 1) throw new Error('leg2 release failed'); // leg2 release throws
        if (flightId === 'f1' && change === -1) throw new Error('leg1 re-reserve failed'); // compensation of leg1 also throws
        return true;
      });

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(InternalServerErrorException);
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(
        /Seat release failed and compensating re-reservation was incomplete: Failed to re-reserve seats for flight f1 inventory i1: leg1 re-reserve failed\. Original release error: leg2 release failed/,
      );
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(mockBooking.save).not.toHaveBeenCalled();
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('Case M (SkyMiles deduction failure rollback): released seats restored, booking status restored, coupon statuses restored, payment history restored, booking not saved', async () => {
      usersService.deductSkyMiles.mockRejectedValue(new Error('SkyMiles deduction failed'));
      const originalTransactions = [...mockBooking.payment_transactions];

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow('SkyMiles deduction failed');

      expect(flightsService.updateAvailableSeats.mock.calls).toEqual([
        ['f1', 'i1', 1],
        ['f1', 'i1', -1],
      ]);
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.total_miles_accrued).toBe(500);
      expect(mockBooking.payment_transactions).toEqual(originalTransactions);
      expect(mockBooking.payment_transactions.some((tx: any) => tx.transaction_type === 'REFUND')).toBe(false);
      expect(mockBooking.ticket_coupons[0].coupon_status).toBe('ACTIVE');
      expect(mockBooking.cancellation_number).toBeUndefined();
      expect(mockBooking.save).not.toHaveBeenCalled();
    });

    it('Case N (Booking save failure rollback): exact SkyMiles restored, released seats restored, status restored, cancellation_number restored, coupons restored, payment_transactions restored', async () => {
      mockBooking.save.mockRejectedValue(new Error('booking write failed'));
      const originalTransactions = mockBooking.payment_transactions.map((tx: any) => ({ ...tx }));

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow('booking write failed');
      expect(flightsService.updateAvailableSeats.mock.calls).toEqual([
        ['f1', 'i1', 1],
        ['f1', 'i1', -1],
      ]);
      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user1', 5000);
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.total_miles_accrued).toBe(500);
      expect(mockBooking.payment_transactions).toEqual(originalTransactions);
      expect(mockBooking.cancellation_number).toBeUndefined();
      expect(mockBooking.ticket_coupons[0].coupon_status).toBe('ACTIVE');
    });

    it('Case O (Rollback failure handling): surfaced as InternalServerErrorException when compensation fails, seat restoration still attempted, success not returned', async () => {
      mockBooking.save.mockRejectedValue(new Error('booking write failed'));
      usersService.setSkyMiles.mockRejectedValue(new Error('SkyMiles restore failed'));

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(InternalServerErrorException);
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(
        /Cancellation failed and compensating rollback was incomplete: Failed to restore SkyMiles: SkyMiles restore failed\. Original error: booking write failed/,
      );
      // Seat restoration was still attempted:
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', -1);
      // Booking state restored to original snapshot:
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('Case P (Already-cancelled booking rejected): throws BadRequestException when booking is already CANCELLED', async () => {
      mockBooking.status = BookingStatus.CANCELLED;
      await expect(service.cancelTicket({ identifier: 'CAN-1' } as any)).rejects.toThrow(BadRequestException);
      await expect(service.cancelTicket({ identifier: 'CAN-1' } as any)).rejects.toThrow(
        'This booking has already been cancelled.',
      );
      expect(flightsService.updateAvailableSeats).not.toHaveBeenCalled();
      expect(mockBooking.save).not.toHaveBeenCalled();
    });

    it('Case R (Invalid flight lookup fails before mutation): throws BadRequestException when coupon flights cannot be resolved', async () => {
      flightsService.findById.mockRejectedValue(new Error('Flight database offline'));

      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(BadRequestException);
      await expect(service.cancelTicket({ identifier: 'CNF-1' } as any)).rejects.toThrow(
        /Unable to resolve valid departure date for booking: Flight f1 lookup failed: Flight database offline/,
      );
      expect(flightsService.updateAvailableSeats).not.toHaveBeenCalled();
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(mockBooking.save).not.toHaveBeenCalled();
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('Case S (Fractional days policy integration): cancelTicket passes fractional days to policiesService without falling into 0% gap', async () => {
      // 29.5 days before departure
      const depDate = new Date(Date.now() + 29.5 * 24 * 60 * 60 * 1000);
      flightsService.findById.mockResolvedValue({ scheduled_departure: depDate });
      policiesService.calculateRefundPercentage.mockImplementation(async (days: number) => {
        const normalized = Math.floor(Math.max(0, days));
        if (normalized >= 30) return 90;
        if (normalized >= 15 && normalized <= 29) return 75;
        if (normalized >= 7 && normalized <= 14) return 50;
        return 0;
      });

      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_percentage).toBe(75);
      expect(res.refund_amount).toBe(750);
    });

    describe('Case Q (Ownership/auth validation): unauthorized users cannot cancel other users bookings', () => {
      it('allows non-customer staff roles (CLERK, ADMIN, SUPER_ADMIN) to manage bookings without ownership check', async () => {
        await expect(service.assertOwnership('CNF-1', 'other-user', UserRole.CLERK)).resolves.toBeUndefined();
        await expect(service.assertOwnership('CNF-1', 'other-user', UserRole.ADMIN)).resolves.toBeUndefined();
        await expect(service.assertOwnership('CNF-1', 'other-user', UserRole.SUPER_ADMIN)).resolves.toBeUndefined();
      });

      it('allows customer to manage their own booking', async () => {
        mockBooking.user_id = 'user1';
        await expect(service.assertOwnership('CNF-1', 'user1', UserRole.CUSTOMER)).resolves.toBeUndefined();
      });

      it('rejects customer trying to manage another users booking with ForbiddenException', async () => {
        mockBooking.user_id = 'user1';
        await expect(service.assertOwnership('CNF-1', 'unauthorized-user', UserRole.CUSTOMER)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.assertOwnership('CNF-1', 'unauthorized-user', UserRole.CUSTOMER)).rejects.toThrow(
          'You do not have permission to manage this booking',
        );
      });

      it('Section 3.9 security: rejects customer A trying to track or manage customer B booking by cancellation_number', async () => {
        mockBooking.user_id = 'customerB';
        mockBooking.cancellation_number = 'CAN-123456';
        bookingModel.exec.mockResolvedValueOnce(mockBooking);

        await expect(
          service.assertOwnership('CAN-123456', 'customerA', UserRole.CUSTOMER),
        ).rejects.toThrow(ForbiddenException);

        expect(bookingModel.findOne).toHaveBeenCalledWith({
          $or: [
            { blocking_number: 'CAN-123456' },
            { confirmation_number: 'CAN-123456' },
            { pnr_code: 'CAN-123456' },
            { cancellation_number: 'CAN-123456' },
          ],
        });
      });

      it('Section 3.9 security: allows owner to track their own cancelled booking by cancellation_number', async () => {
        mockBooking.user_id = 'customerA';
        mockBooking.cancellation_number = 'CAN-123456';
        bookingModel.exec.mockResolvedValueOnce(mockBooking);

        await expect(
          service.assertOwnership('CAN-123456', 'customerA', UserRole.CUSTOMER),
        ).resolves.toBeUndefined();
      });

      it('Section 3.9 security: allows staff roles (CLERK, ADMIN, SUPER_ADMIN) to bypass ownership by cancellation_number', async () => {
        mockBooking.user_id = 'customerB';
        mockBooking.cancellation_number = 'CAN-123456';

        await expect(
          service.assertOwnership('CAN-123456', 'clerk-user', UserRole.CLERK),
        ).resolves.toBeUndefined();
        await expect(
          service.assertOwnership('CAN-123456', 'admin-user', UserRole.ADMIN),
        ).resolves.toBeUndefined();
        await expect(
          service.assertOwnership('CAN-123456', 'superadmin-user', UserRole.SUPER_ADMIN),
        ).resolves.toBeUndefined();
      });

      it('allows unknown booking through assertOwnership so service layer raises NotFoundException', async () => {
        bookingModel.exec.mockResolvedValueOnce(null);
        await expect(service.assertOwnership('NONEXISTENT', 'user1', UserRole.CUSTOMER)).resolves.toBeUndefined();
      });
    });
  });

  describe('findAll (My Trips / customer queries)', () => {
    it('filters bookings by userId when provided', async () => {
      const mockChain = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ _id: 'b1', pnr_code: 'PNR1' }]),
      };
      bookingModel.find = jest.fn().mockReturnValueOnce(mockChain);

      const validId = '507f1f77bcf86cd799439011';
      const result = await service.findAll(undefined, validId);

      expect(bookingModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: new Types.ObjectId(validId) }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('PassengerInputDto date_of_birth validation (Requirement 1.3.4)', () => {
    const basePassenger = {
      first_name: 'Nguyen',
      last_name: 'Van An',
      passenger_type: PassengerType.ADULT,
    };

    it('DOB omitted -> valid', async () => {
      const dto = plainToInstance(PassengerInputDto, { ...basePassenger });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('DOB empty string -> valid (optional field)', async () => {
      const dto = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('valid DOB -> valid', async () => {
      const dto = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '1995-05-20' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('malformed format -> rejected', async () => {
      const dto1 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: 'not-a-date' });
      const errors1 = await validate(dto1);
      expect(errors1.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      const dto2 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '1995/05/20' });
      const errors2 = await validate(dto2);
      expect(errors2.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      const dto3 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '1995-5-20' });
      const errors3 = await validate(dto3);
      expect(errors3.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');
    });

    it('impossible date -> rejected', async () => {
      // 2026-02-30 (February 30th does not exist)
      const dto1 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '2026-02-30' });
      const errors1 = await validate(dto1);
      expect(errors1.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      // 2023-02-29 (2023 is not a leap year)
      const dto2 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '2023-02-29' });
      const errors2 = await validate(dto2);
      expect(errors2.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      // 2026-04-31 (April has only 30 days)
      const dto3 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '2026-04-31' });
      const errors3 = await validate(dto3);
      expect(errors3.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      // Invalid month
      const dto4 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '2026-13-10' });
      const errors4 = await validate(dto4);
      expect(errors4.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');
    });

    it('future date -> rejected', async () => {
      // Future year
      const dto1 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: '2099-01-01' });
      const errors1 = await validate(dto1);
      expect(errors1.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');

      // Tomorrow / future date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const futureStr = tomorrow.toISOString().slice(0, 10);
      const dto2 = plainToInstance(PassengerInputDto, { ...basePassenger, date_of_birth: futureStr });
      const errors2 = await validate(dto2);
      expect(errors2.find((e) => e.property === 'date_of_birth')?.constraints).toHaveProperty('isValidDateOfBirth');
    });
  });

  describe('BookingsService - Email Lifecycle', () => {
    let service: BookingsService;
    let bookingModel: any;
    let flightsService: any;
    let usersService: any;
    let policiesService: any;
    let mailService: any;

    beforeEach(async () => {
      bookingModel = {
        findOne: jest.fn(),
        find: jest.fn(),
      };

      flightsService = {
        findById: jest.fn().mockResolvedValue({
          flight_number: 'VN101',
          origin_iata: 'HAN',
          dest_iata: 'SGN',
          scheduled_departure: new Date('2026-10-28T07:00:00Z'),
        }),
        getAirportTimeZone: jest.fn().mockResolvedValue('Asia/Ho_Chi_Minh'),
        updateAvailableSeats: jest.fn().mockResolvedValue(true),
      };

      usersService = {
        findById: jest.fn().mockResolvedValue({
          email: 'passenger@example.com',
          first_name: 'John',
          last_name: 'Doe',
          sky_miles: 100,
        }),
        deductSkyMiles: jest.fn().mockResolvedValue(true),
        setSkyMiles: jest.fn().mockResolvedValue(true),
      };

      policiesService = {
        calculateRefundPercentage: jest.fn().mockResolvedValue(90),
      };

      mailService = {
        sendCancellationEmail: jest.fn().mockResolvedValue(true),
        sendExpiredHoldCancellationEmail: jest.fn().mockResolvedValue(true),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BookingsService,
          { provide: getModelToken(Booking.name), useValue: bookingModel },
          { provide: FlightsService, useValue: flightsService },
          { provide: UsersService, useValue: usersService },
          { provide: PoliciesService, useValue: policiesService },
          { provide: MailService, useValue: mailService },
        ],
      }).compile();

      service = module.get<BookingsService>(BookingsService);
    });

    it('cancelTicket dispatches sendCancellationEmail for CONFIRMED booking with refund details', async () => {
      const departure = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const mockBooking: any = {
        _id: 'booking-1',
        pnr_code: 'PNR-CONFIRMED',
        confirmation_number: 'CNF-CONFIRMED-99',
        user_id: new Types.ObjectId(),
        status: BookingStatus.CONFIRMED,
        total_amount: 1000000,
        total_miles_accrued: 50,
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [
          {
            flight_id: 'f1',
            flight_number: 'VN101',
            inventory_id: 'inv1',
            cabin_class: 'ECONOMY',
            fare_paid: 1000000,
            coupon_status: 'ACTIVE',
          },
        ],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 1000000,
            card_masked: '411111******1111',
            status: 'SUCCESS',
            created_at: new Date(),
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockBooking),
      });
      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: departure,
      });

      const result = await service.cancelTicket({ identifier: 'PNR-CONFIRMED' });

      expect(result.cancellation_number).toBeDefined();
      expect(mailService.sendCancellationEmail).toHaveBeenCalledTimes(1);
      const [callData] = mailService.sendCancellationEmail.mock.calls[0];
      expect(callData.toEmail).toBe('passenger@example.com');
      expect(callData.cancellationType).toBe('MANUAL_CONFIRMED');
      expect(callData.confirmationNumber).toBe('CNF-CONFIRMED-99');
      expect(callData.blockingNumber).toBeUndefined();
      expect(callData.refundAmount).toBe(900000);
      expect(callData.refundPercentage).toBe(90);
      expect(callData.maskedCard).toBe('**** **** **** 1111');
      expect(callData.departureTimeFormatted).toContain('(Asia/Ho_Chi_Minh)');
    });

    it('cancelTicket dispatches sendCancellationEmail for BLOCKED booking with 0 refund', async () => {
      const departure = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const mockBooking: any = {
        _id: 'booking-2',
        pnr_code: 'PNR-BLOCKED',
        user_id: new Types.ObjectId(),
        status: BookingStatus.BLOCKED,
        blocking_number: 'BLK-123',
        total_amount: 1000000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'Jane', last_name: 'Doe' }],
        ticket_coupons: [
          {
            flight_id: 'f1',
            flight_number: 'VN101',
            inventory_id: 'inv1',
            cabin_class: 'ECONOMY',
            fare_paid: 1000000,
            coupon_status: 'ACTIVE',
          },
        ],
        payment_transactions: [],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockBooking),
      });
      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: departure,
      });

      const result = await service.cancelTicket({ identifier: 'PNR-BLOCKED' });

      expect(result.cancellation_number).toBeDefined();
      expect(mailService.sendCancellationEmail).toHaveBeenCalledTimes(1);
      const [callData] = mailService.sendCancellationEmail.mock.calls[0];
      expect(callData.cancellationType).toBe('MANUAL_BLOCKED');
      expect(callData.blockingNumber).toBe('BLK-123');
      expect(callData.confirmationNumber).toBeUndefined();
      expect(callData.refundAmount).toBe(0);
      expect(callData.refundPercentage).toBe(0);
      expect(callData.maskedCard).toBeUndefined();
    });

    it('cancelTicket for zero-value CONFIRMED booking passes real refundPercentage (90) and 0 refundAmount without creating REFUND transaction', async () => {
      const departure = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const mockBooking: any = {
        _id: 'booking-zero-cnf',
        pnr_code: 'PNR-ZERO-CONFIRMED',
        confirmation_number: 'CNF-ZERO-99',
        user_id: new Types.ObjectId(),
        status: BookingStatus.CONFIRMED,
        total_amount: 0,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'Zero', last_name: 'Cost' }],
        ticket_coupons: [
          {
            flight_id: 'f1',
            flight_number: 'VN101',
            inventory_id: 'inv1',
            cabin_class: 'ECONOMY',
            fare_paid: 0,
            coupon_status: 'ACTIVE',
          },
        ],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 0,
            card_masked: '411111******1111',
            status: 'SUCCESS',
            created_at: new Date(),
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockBooking),
      });
      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: departure,
      });

      policiesService.calculateRefundPercentage.mockResolvedValue(90);

      const result = await service.cancelTicket({ identifier: 'PNR-ZERO-CONFIRMED' });

      expect(result.cancellation_number).toBeDefined();
      expect(result.refund_amount).toBe(0);
      expect(result.refund_percentage).toBe(90);

      // Verify no monetary REFUND transaction is created
      const refundTxs = mockBooking.payment_transactions.filter((tx: any) => tx.transaction_type === 'REFUND');
      expect(refundTxs.length).toBe(0);

      expect(mailService.sendCancellationEmail).toHaveBeenCalledTimes(1);
      const [callData] = mailService.sendCancellationEmail.mock.calls[0];
      expect(callData.cancellationType).toBe('MANUAL_CONFIRMED');
      expect(callData.originalBookingStatus).toBe('CONFIRMED');
      expect(callData.refundAmount).toBe(0);
      expect(callData.refundPercentage).toBe(90);
    });

    it('cancelTicket succeeds normally even if mailService throws or returns false (isolation invariant)', async () => {
      const departure = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const mockBooking: any = {
        _id: 'booking-3',
        pnr_code: 'PNR-ISOLATION',
        user_id: new Types.ObjectId(),
        status: BookingStatus.BLOCKED,
        total_amount: 1000000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'Error', last_name: 'User' }],
        ticket_coupons: [
          {
            flight_id: 'f1',
            flight_number: 'VN101',
            inventory_id: 'inv1',
            cabin_class: 'ECONOMY',
            fare_paid: 1000000,
            coupon_status: 'ACTIVE',
          },
        ],
        payment_transactions: [],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockBooking),
      });
      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: departure,
      });

      // Case A: throws
      mailService.sendCancellationEmail.mockRejectedValue(new Error('SMTP down'));
      const resultA = await service.cancelTicket({ identifier: 'PNR-ISOLATION' });
      expect(resultA.cancellation_number).toBeDefined();
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.save).toHaveBeenCalled();

      // Case B: returns false
      mockBooking.status = BookingStatus.BLOCKED;
      mailService.sendCancellationEmail.mockResolvedValue(false);
      const resultB = await service.cancelTicket({ identifier: 'PNR-ISOLATION' });
      expect(resultB.cancellation_number).toBeDefined();
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
    });

    it('cancelExpiredBlockStrict dispatches sendExpiredHoldCancellationEmail and preserves isolation when mail fails', async () => {
      const mockBooking: any = {
        _id: 'booking-expired',
        pnr_code: 'PNR-EXPIRED',
        blocking_number: 'BLK-EXP-1',
        user_id: new Types.ObjectId(),
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date('2026-10-25T12:00:00Z'),
        passengers: [{ first_name: 'John', last_name: 'Doe' }],
        ticket_coupons: [
          {
            flight_id: 'f1',
            flight_number: 'VN101',
            inventory_id: 'inv1',
            cabin_class: 'ECONOMY',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: new Date('2026-10-28T07:00:00Z'),
      });

      // Successful mail send
      await service.cancelExpiredBlockStrict(mockBooking);

      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.cancellation_number).toBeDefined();
      expect(mailService.sendExpiredHoldCancellationEmail).toHaveBeenCalledTimes(1);
      const [callData] = mailService.sendExpiredHoldCancellationEmail.mock.calls[0];
      expect(callData.toEmail).toBe('passenger@example.com');
      expect(callData.bookingReference).toBe('PNR-EXPIRED');
      expect(callData.blockingNumber).toBe('BLK-EXP-1');

      // Mail throwing error: cancellation remains saved, no rollback
      mockBooking.status = BookingStatus.BLOCKED;
      mailService.sendExpiredHoldCancellationEmail.mockRejectedValue(new Error('SMTP unreachable'));
      await service.cancelExpiredBlockStrict(mockBooking);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.cancellation_number).toBeDefined();

      // Mail returning false: cancellation remains saved, no rollback (Finding F6)
      mockBooking.status = BookingStatus.BLOCKED;
      mailService.sendExpiredHoldCancellationEmail.mockResolvedValue(false);
      await service.cancelExpiredBlockStrict(mockBooking);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.cancellation_number).toBeDefined();
    });

    it('cancelExpiredBlockStrict formats holdDeadlineFormatted in origin timezone of earliest flight for multi-leg booking (Finding F2)', async () => {
      const flightLater = {
        flight_number: 'VN200',
        origin_iata: 'NRT',
        dest_iata: 'HAN',
        scheduled_departure: new Date('2026-10-30T10:00:00.000Z'),
      };
      const flightEarlier = {
        flight_number: 'VN100',
        origin_iata: 'HAN',
        dest_iata: 'NRT',
        scheduled_departure: new Date('2026-10-28T01:00:00.000Z'),
      };

      flightsService.findById.mockImplementation((id: string) => {
        if (id === 'f_later') return Promise.resolve(flightLater);
        if (id === 'f_earlier') return Promise.resolve(flightEarlier);
        return Promise.resolve(flightEarlier);
      });

      flightsService.getAirportTimeZone = jest.fn().mockImplementation((iata: string) => {
        if (iata === 'NRT') return Promise.resolve('Asia/Tokyo');
        if (iata === 'HAN') return Promise.resolve('Asia/Ho_Chi_Minh');
        return Promise.resolve('UTC');
      });

      const mockBooking: any = {
        _id: 'booking-expired-multileg',
        pnr_code: 'PNR-EXP-MULTI',
        blocking_number: 'BLK-EXP-MULTI',
        user_id: new Types.ObjectId(),
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date('2026-10-25T03:00:00.000Z'),
        passengers: [{ first_name: 'Lan', last_name: 'Vu' }],
        // Coupon 0 departs later (Tokyo), Coupon 1 departs earlier (Hanoi)
        ticket_coupons: [
          { flight_id: 'f_later', flight_number: 'VN200', inventory_id: 'inv2', cabin_class: 'ECONOMY' },
          { flight_id: 'f_earlier', flight_number: 'VN100', inventory_id: 'inv1', cabin_class: 'ECONOMY' },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      mailService.sendExpiredHoldCancellationEmail.mockResolvedValue(true);

      await service.cancelExpiredBlockStrict(mockBooking);

      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mailService.sendExpiredHoldCancellationEmail).toHaveBeenCalled();
      const calls = mailService.sendExpiredHoldCancellationEmail.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      // Deadline formatted in earliest leg's origin timezone (HAN -> Asia/Ho_Chi_Minh: UTC 03:00 + 7 = 10:00)
      expect(lastCall.holdDeadlineFormatted).toContain('2026-10-25 10:00 (Asia/Ho_Chi_Minh)');
      expect(lastCall.holdDeadlineFormatted).not.toContain('Asia/Tokyo');
      // Primary leg shows earliest departing flight
      expect(lastCall.flightNumber).toBe('VN100');
    });
  });
});

