import { Test, TestingModule } from '@nestjs/testing';
import { BookingsService } from './bookings.service';
import { getModelToken } from '@nestjs/mongoose';
import { Booking } from './bookings.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { BadRequestException } from '@nestjs/common';
import { BookingStatus, PassengerType } from './bookings.schema';

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
    bookingModel.exec = jest.fn();

    flightsService = {
      findById: jest.fn(),
      reserveSeats: jest.fn(),
      updateAvailableSeats: jest.fn(),
    };

    usersService = {
      findById: jest.fn(),
      addSkyMiles: jest.fn(),
      deductSkyMiles: jest.fn(),
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
      };

      mockUser = { _id: 'user1', preferred_credit_card: '1234' };
      usersService.findById.mockResolvedValue(mockUser);

      mockFlight = {
        _id: 'f1',
        flight_number: 'FL1',
        distance_miles: 1000,
        scheduled_departure: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days ahead
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

    it('child fare = round(base*0.75), senior = round(base*0.85)', async () => {
      baseDto.passengers = [
        { passenger_type: PassengerType.CHILD, first_name: 'C', last_name: '1' },
        { passenger_type: PassengerType.SENIOR, first_name: 'S', last_name: '1' },
      ];
      const result = await service.createBooking(baseDto);
      // 100 * 0.75 = 75, 100 * 0.85 = 85. Total = 160
      expect(result.total_amount).toBe(160);
    });

    it('releases reserved seats and throws BadRequest when a later leg fails (rollback)', async () => {
      baseDto.legs.push({ flight_id: 'f2', inventory_id: 'i2', leg_type: 'INBOUND' });
      const mockFlight2 = {
        _id: 'f2',
        flight_number: 'FL2',
        distance_miles: 1000,
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
    });

    it('blocked -> confirmed with new confirmation_number and miles added', async () => {
      await service.confirmTicket({ blocking_number: 'BLK-1', credit_card_number: '1234' } as any);
      expect(mockBooking.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.confirmation_number).toBeDefined();
      expect(mockBooking.total_miles_accrued).toBe(500);
      expect(usersService.addSkyMiles).toHaveBeenCalledWith('user1', 500);
    });

    it('expired deadline -> booking auto-cancelled and seats released', async () => {
      mockBooking.time_limit_deadline = new Date(Date.now() - 100000); // expired
      await expect(service.confirmTicket({ blocking_number: 'BLK-1', credit_card_number: '1234' } as any)).rejects.toThrow(BadRequestException);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1); // 1 passenger
    });
  });

  describe('rescheduleTicket', () => {
    let mockBooking: any;
    beforeEach(() => {
      mockBooking = {
        status: BookingStatus.CONFIRMED,
        total_amount: 100,
        passengers: [{ passenger_type: PassengerType.ADULT }],
        booking_type: 'ONE_WAY',
        ticket_coupons: [{ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 }],
        payment_transactions: [],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      
      flightsService.findById.mockResolvedValue({
        _id: 'f2',
        flight_number: 'FL2',
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 150 }]
      });
      flightsService.updateAvailableSeats.mockResolvedValue(true);
    });

    it('refuses a non-CONFIRMED booking', async () => {
      mockBooking.status = BookingStatus.BLOCKED;
      await expect(service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any)).rejects.toThrow(BadRequestException);
    });

    it('charges the positive fare difference, issues a new confirmation number', async () => {
      const res = await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any);
      expect(res.price_difference).toBe(50); // 150 - 100
      expect(mockBooking.payment_transactions[0].transaction_type).toBe('RESCHEDULE_CHARGE');
      expect(mockBooking.confirmation_number).toBeDefined();
    });

    it('refunds a negative fare difference', async () => {
      flightsService.findById.mockResolvedValueOnce({
        _id: 'f2',
        flight_number: 'FL2',
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 50 }]
      });
      const res = await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any);
      expect(res.price_difference).toBe(-50); // 50 - 100
      expect(mockBooking.payment_transactions[0].transaction_type).toBe('RESCHEDULE_REFUND');
      expect(mockBooking.payment_transactions[0].amount).toBe(50);
    });

    it('keeps inbound coupons when only the outbound leg is rescheduled', async () => {
      mockBooking.booking_type = 'ROUND_TRIP';
      mockBooking.ticket_coupons.push({ leg_type: 'INBOUND', flight_id: 'f3', inventory_id: 'i3', fare_paid: 100 });
      mockBooking.total_amount = 200;
      
      await service.rescheduleTicket({ confirmation_number: 'CNF', new_flight_id: 'f2', new_inventory_id: 'i2' } as any);
      
      const out = mockBooking.ticket_coupons.find((c: any) => c.leg_type === 'OUTBOUND');
      const inb = mockBooking.ticket_coupons.find((c: any) => c.leg_type === 'INBOUND');
      expect(out.flight_id).toBe('f2');
      expect(inb.flight_id).toBe('f3'); // unchanged
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
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.updateAvailableSeats.mockResolvedValue(true);
      flightsService.findById.mockResolvedValue({ scheduled_departure: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
      policiesService.calculateRefundPercentage.mockResolvedValue(90);
    });

    it('confirmed ticket refunds total_amount * policy% and deducts the accrued miles', async () => {
      const res = await service.cancelTicket({ identifier: 'CNF-1' } as any);
      expect(res.refund_percentage).toBe(90);
      expect(res.refund_amount).toBe(900);
      expect(mockBooking.payment_transactions[0].transaction_type).toBe('REFUND');
      expect(mockBooking.payment_transactions[0].amount).toBe(900);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user1', 500);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBooking.total_miles_accrued).toBe(0);
    });

    it('blocked ticket releases seats with no refund', async () => {
      mockBooking.status = BookingStatus.BLOCKED;
      mockBooking.total_amount = 0;
      mockBooking.total_miles_accrued = 0;
      
      const res = await service.cancelTicket({ identifier: 'BLK-1' } as any);
      expect(res.refund_amount).toBe(0);
      expect(mockBooking.payment_transactions.length).toBe(0); // no refund transaction
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
    });

    it('identifier can be blocking_number, confirmation_number or pnr_code (mock queries it)', async () => {
      await service.cancelTicket({ identifier: 'XYZ' } as any);
      expect(bookingModel.findOne).toHaveBeenCalledWith({
        $or: [
          { blocking_number: 'XYZ' },
          { confirmation_number: 'XYZ' },
          { pnr_code: 'XYZ' },
        ],
      });
    });

    it('already-cancelled booking is rejected', async () => {
      mockBooking.status = BookingStatus.CANCELLED;
      await expect(service.cancelTicket({ identifier: 'CAN-1' } as any)).rejects.toThrow(BadRequestException);
    });
  });
});
