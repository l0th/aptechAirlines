import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema, BookingStatus, BookingType, PaymentMethod, PaymentTransaction } from './bookings.schema';
import { ConfirmTicketDto } from './bookings.dto';
import { FlightsService } from '../flights/flights.service';
import { UsersService, toSafeUserResponse } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { MailService } from '../mail/mail.service';
import { UserRole } from '../users/users.schema';
import { UsersController } from '../users/users.controller';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';

describe('Payment Phase 1A Specification Tests', () => {
  let service: BookingsService;
  let bookingModel: any;
  let flightsService: any;
  let usersService: any;
  let policiesService: any;
  let mailService: any;

  beforeEach(async () => {
    bookingModel = function (data: any) {
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...data, _id: 'new-booking-id' }),
      };
    };
    bookingModel.find = jest.fn().mockReturnThis();
    bookingModel.findById = jest.fn().mockReturnThis();
    bookingModel.findOne = jest.fn().mockReturnThis();
    bookingModel.sort = jest.fn().mockReturnThis();
    bookingModel.populate = jest.fn().mockReturnThis();
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
      setSkyMiles: jest.fn(),
    };

    policiesService = {
      calculateRefundPercentage: jest.fn(),
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

  describe('Scenario 1 & 2: toSafeUserResponse and user endpoint sanitization', () => {
    it('strips raw preferred_credit_card and password_hash, adds masked card and boolean flag', () => {
      const user = {
        _id: 'u1',
        username: 'john',
        email: 'john@example.com',
        password_hash: '$2b$10$xyz123',
        preferred_credit_card: '4111222233334444',
        role: UserRole.CUSTOMER,
        sky_miles: 1000,
      };

      const safe = toSafeUserResponse(user);
      expect(safe.password_hash).toBeUndefined();
      expect(safe.preferred_credit_card).toBeUndefined();
      expect(safe.has_preferred_credit_card).toBe(true);
      expect(safe.preferred_credit_card_masked).toBe('**** **** **** 4444');
    });

    it('handles placeholder, asterisks, and missing card safely without false has_preferred_credit_card', () => {
      const placeholders = ['CARD-DEFAULT', 'SAVED-CARD', 'UNKNOWN', 'ORIGINAL-PAYMENT-CARD', '**** **** **** 4444', ''];
      for (const ph of placeholders) {
        const safe = toSafeUserResponse({ _id: 'u2', preferred_credit_card: ph, password_hash: 'hash' });
        expect(safe.has_preferred_credit_card).toBe(false);
        expect(safe.preferred_credit_card_masked).toBeUndefined();
      }
    });

    it('UsersController and AuthController return sanitized safe user responses', async () => {
      const rawUser = {
        _id: 'u1',
        username: 'jane',
        password_hash: 'secret_hash',
        preferred_credit_card: '4111222233339999',
      };
      const mockUsersService: any = {
        findById: jest.fn().mockResolvedValue(rawUser),
        update: jest.fn().mockResolvedValue(rawUser),
      };
      const usersCtrl = new UsersController(mockUsersService);
      const res = await usersCtrl.findOne('u1');
      expect(res.password_hash).toBeUndefined();
      expect(res.preferred_credit_card).toBeUndefined();
      expect(res.has_preferred_credit_card).toBe(true);
      expect(res.preferred_credit_card_masked).toBe('**** **** **** 9999');

      const mockAuthService: any = {};
      const authCtrl = new AuthController(mockAuthService, mockUsersService);
      const meRes = await authCtrl.getProfile({ user: { sub: 'u1' } });
      expect(meRes.password_hash).toBeUndefined();
      expect(meRes.preferred_credit_card).toBeUndefined();
      expect(meRes.has_preferred_credit_card).toBe(true);
      expect(meRes.preferred_credit_card_masked).toBe('**** **** **** 9999');
    });
  });

  describe('Scenario 3, 4, 5, 6: POST /api/bookings purchase flow validation & preflight', () => {
    const validFlight = {
      _id: 'f1',
      flight_number: 'VN10',
      distance_miles: 500,
      scheduled_departure: new Date(Date.now() + 30 * 86400000),
      scheduled_arrival: new Date(Date.now() + 30 * 86400000 + 2 * 3600000),
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      status: 'SCHEDULED',
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      data_source: 'AIRLABS_COMMERCIALIZED',
      inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 100 }],
    };

    it('Scenario 3 / Requirement 4: BUY missing payment_method throws and reserveSeats is NOT called', async () => {
      flightsService.findById.mockResolvedValue(validFlight);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444' });

      await expect(
        service.createBooking({
          user_id: 'u1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          passengers: [{ first_name: 'A', last_name: 'B' } as any],
          legs: [{ flight_id: 'f1', inventory_id: 'i1' }],
        }),
      ).rejects.toThrow('Payment method is required to purchase tickets.');

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('Scenario 4 / Requirement 5: BUY PAYPAL throws and reserveSeats is NOT called', async () => {
      flightsService.findById.mockResolvedValue(validFlight);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444' });

      await expect(
        service.createBooking({
          user_id: 'u1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          payment_method: PaymentMethod.PAYPAL,
          passengers: [{ first_name: 'A', last_name: 'B' } as any],
          legs: [{ flight_id: 'f1', inventory_id: 'i1' }],
        }),
      ).rejects.toThrow('PayPal payment is not yet active.');

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('Scenario 5 / Requirement 6: BUY with invalid/missing profile card throws BEFORE reserveSeats or creating saga', async () => {
      flightsService.findById.mockResolvedValue(validFlight);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '' });

      await expect(
        service.createBooking({
          user_id: 'u1',
          booking_type: BookingType.ONE_WAY,
          is_block: false,
          payment_method: PaymentMethod.PROFILE_CARD,
          passengers: [{ first_name: 'A', last_name: 'B' } as any],
          legs: [{ flight_id: 'f1', inventory_id: 'i1' }],
        }),
      ).rejects.toThrow('Cannot process payment: no valid preferred credit card found in user profile. Please update your profile.');

      expect(flightsService.reserveSeats).not.toHaveBeenCalled();
    });

    it('Scenario 6: purchase with PROFILE_CARD and valid card succeeds and records transaction with payment_method PROFILE_CARD', async () => {
      flightsService.findById.mockResolvedValue(validFlight);
      flightsService.reserveSeats.mockResolvedValue(true);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444', sky_miles: 0 });

      const res = await service.createBooking({
        user_id: 'u1',
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        passengers: [{ first_name: 'A', last_name: 'B' } as any],
        legs: [{ flight_id: 'f1', inventory_id: 'i1' }],
      });

      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(flightsService.reserveSeats).toHaveBeenCalledWith('f1', 'i1', 1);
      expect(res.payment_transactions).toBeDefined();
      expect(res.payment_transactions.length).toBe(1);
      expect(res.payment_transactions[0].payment_method).toBe(PaymentMethod.PROFILE_CARD);
      expect(res.payment_transactions[0].card_masked).toBe('**** **** **** 4444');
    });

    it('Scenario 7: hold with is_block=true succeeds without payment_method and creates no payment transaction', async () => {
      flightsService.findById.mockResolvedValue(validFlight);
      flightsService.reserveSeats.mockResolvedValue(true);
      usersService.findById.mockResolvedValue({ _id: 'u1' });

      const res = await service.createBooking({
        user_id: 'u1',
        booking_type: BookingType.ONE_WAY,
        is_block: true,
        passengers: [{ first_name: 'A', last_name: 'B' } as any],
        legs: [{ flight_id: 'f1', inventory_id: 'i1' }],
      });

      expect(res.status).toBe(BookingStatus.BLOCKED);
      expect(res.blocking_number).toBeDefined();
      expect(res.payment_transactions).toEqual([]);
    });
  });

  describe('Scenario 8: Confirm hold validation, ordering, and DTO', () => {
    it('Requirement 1: ConfirmTicketDto without payment_method passes DTO validation', async () => {
      const dto = plainToInstance(ConfirmTicketDto, { blocking_number: 'BLK-TEST' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Requirement 2: active hold without payment_method reaches service and is rejected', async () => {
      const mockBooking: any = {
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() + 100000), // active hold!
        total_amount: 100,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);

      await expect(
        service.confirmTicket({ blocking_number: 'BLK-TEST' }),
      ).rejects.toThrow('Payment method is required to confirm reservation.');
    });

    it('Requirement 3: expired hold without payment_method is cancelled and seats released', async () => {
      const mockBooking: any = {
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() - 100000), // expired!
        total_amount: 100,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockResolvedValue({ distance_miles: 500 });
      flightsService.updateAvailableSeats.mockResolvedValue(true);

      // Call confirm WITHOUT payment_method on expired booking
      await expect(
        service.confirmTicket({ blocking_number: 'BLK-1' } as any),
      ).rejects.toThrow(BadRequestException);

      // Verify that expired hold was cancelled and seat was returned
      expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
      expect(flightsService.updateAvailableSeats).toHaveBeenCalledWith('f1', 'i1', 1);
    });

    it('valid hold requires PROFILE_CARD and valid profile card', async () => {
      const mockBooking: any = {
        status: BookingStatus.BLOCKED,
        time_limit_deadline: new Date(Date.now() + 100000), // active hold!
        total_amount: 100,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockResolvedValue({ distance_miles: 500 });
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444' });

      const res = await service.confirmTicket({
        blocking_number: 'BLK-1',
        payment_method: PaymentMethod.PROFILE_CARD,
      });

      expect(res.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBooking.payment_transactions.length).toBe(1);
      expect(mockBooking.payment_transactions[0].payment_method).toBe(PaymentMethod.PROFILE_CARD);
      expect(mockBooking.payment_transactions[0].card_masked).toBe('**** **** **** 4444');
    });
  });

  describe('Scenario 9: Reschedule payment method rules', () => {
    const futureDate = new Date(Date.now() + 45 * 86400000);
    const futureArrival = new Date(futureDate.getTime() + 2 * 3600000);

    const oldFlight = {
      _id: 'f1',
      flight_number: 'FL1',
      distance_miles: 500,
      scheduled_departure: futureDate,
      scheduled_arrival: futureArrival,
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      status: 'SCHEDULED',
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      data_source: 'AIRLABS_COMMERCIALIZED',
      inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 100 }],
    };

    it('reschedule surcharge (priceDiff > 0) requires payment_method PROFILE_CARD', async () => {
      const moreExpensiveFlight = {
        ...oldFlight,
        _id: 'f2',
        flight_number: 'FL2',
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 10, base_price: 150 }],
      };

      const mockBooking: any = {
        confirmation_number: 'CNF-1',
        user_id: 'u1',
        booking_type: BookingType.ONE_WAY,
        status: BookingStatus.CONFIRMED,
        total_amount: 100,
        ticket_coupons: [{ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 }],
        payment_transactions: [{ transaction_type: 'PAYMENT', card_masked: '**** **** **** 1111', status: 'SUCCESS' }],
        passengers: [{ first_name: 'A', last_name: 'B' }],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockImplementation((id: string) => Promise.resolve(id === 'f1' ? oldFlight : moreExpensiveFlight));
      flightsService.reserveSeats.mockResolvedValue(true);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444' });

      // Missing payment_method throws
      await expect(
        service.rescheduleTicket({
          confirmation_number: 'CNF-1',
          new_flight_id: 'f2',
          new_inventory_id: 'i2',
        } as any),
      ).rejects.toThrow('Payment method is required for reschedule fare difference.');

      // With PROFILE_CARD succeeds and tags transaction
      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF-1',
        new_flight_id: 'f2',
        new_inventory_id: 'i2',
        payment_method: PaymentMethod.PROFILE_CARD,
      });

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      const chargeTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'RESCHEDULE_CHARGE');
      expect(chargeTx).toBeDefined();
      expect(chargeTx.payment_method).toBe(PaymentMethod.PROFILE_CARD);
    });

    it('Requirement 11: reschedule refund from historical transaction retains its source method', async () => {
      const cheaperFlight = {
        ...oldFlight,
        _id: 'f3',
        flight_number: 'FL3',
        inventories: [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 60 }],
      };

      const mockBooking: any = {
        confirmation_number: 'CNF-2',
        user_id: 'u1',
        booking_type: BookingType.ONE_WAY,
        status: BookingStatus.CONFIRMED,
        total_amount: 100,
        ticket_coupons: [{ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          card_masked: '**** **** **** 9999',
          status: 'SUCCESS',
          created_at: new Date(),
        }],
        passengers: [{ first_name: 'A', last_name: 'B' }],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockImplementation((id: string) => Promise.resolve(id === 'f1' ? oldFlight : cheaperFlight));
      flightsService.reserveSeats.mockResolvedValue(true);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '' }); // User has no card in profile!

      // Call reschedule WITHOUT payment_method when priceDiff < 0
      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF-2',
        new_flight_id: 'f3',
        new_inventory_id: 'i3',
      });

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      const refundTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'RESCHEDULE_REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.card_masked).toBe('**** **** **** 9999');
      expect(refundTx.payment_method).toBe(PaymentMethod.PROFILE_CARD);
    });

    it('Requirement 12: reschedule refund falling back to actual preferred profile card records PROFILE_CARD', async () => {
      const cheaperFlight = {
        ...oldFlight,
        _id: 'f3',
        flight_number: 'FL3',
        inventories: [{ _id: 'i3', id: 'i3', available_seats: 10, base_price: 60 }],
      };

      const mockBooking: any = {
        confirmation_number: 'CNF-3',
        user_id: 'u1',
        booking_type: BookingType.ONE_WAY,
        status: BookingStatus.CONFIRMED,
        total_amount: 100,
        ticket_coupons: [{ leg_type: 'OUTBOUND', flight_id: 'f1', inventory_id: 'i1', fare_paid: 100 }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          card_masked: 'CARD-DEFAULT', // placeholder forces fallback to user.preferred_credit_card
          status: 'SUCCESS',
          created_at: new Date(),
        }],
        passengers: [{ first_name: 'A', last_name: 'B' }],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockImplementation((id: string) => Promise.resolve(id === 'f1' ? oldFlight : cheaperFlight));
      flightsService.reserveSeats.mockResolvedValue(true);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233338888' });

      const res = await service.rescheduleTicket({
        confirmation_number: 'CNF-3',
        new_flight_id: 'f3',
        new_inventory_id: 'i3',
      });

      expect(res.booking.status).toBe(BookingStatus.CONFIRMED);
      const refundTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'RESCHEDULE_REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.payment_method).toBe(PaymentMethod.PROFILE_CARD);
      expect(refundTx.card_masked).toBe('**** **** **** 8888');
    });
  });

  describe('Requirements 7, 8, 9, 10, 13, 14: Transaction provenance, schema defaults, emergency refunds & projections', () => {
    it('Requirement 7: PaymentTransaction schema has NO PROFILE_CARD default', () => {
      const path: any = BookingSchema.path('payment_transactions');
      const subSchema = path?.schema;
      const pmPath = subSchema?.path('payment_method');
      expect(pmPath?.defaultValue).toBeUndefined();
      expect(pmPath?.options?.default).toBeUndefined();
    });

    it('Requirement 8: manual cancellation REFUND copies PROFILE_CARD method when source PAYMENT explicitly has PROFILE_CARD', async () => {
      const mockBooking: any = {
        status: BookingStatus.CONFIRMED,
        total_amount: 1000,
        total_miles_accrued: 0,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1000,
          card_masked: '**** **** **** 4444',
          status: 'SUCCESS',
          created_at: new Date(),
        }],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockResolvedValue({
        distance_miles: 500,
        scheduled_departure: new Date(Date.now() + 10 * 86400000),
      });
      policiesService.calculateRefundPercentage.mockReturnValue(80);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111222233334444' });

      await service.cancelTicket({ identifier: 'CNF-1' });

      const refundTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.payment_method).toBe(PaymentMethod.PROFILE_CARD);
      expect(refundTx.card_masked).toBe('**** **** **** 4444');
    });

    it('Requirement 9: historical source PAYMENT without payment_method does not get falsely classified', async () => {
      const mockBooking: any = {
        status: BookingStatus.CONFIRMED,
        total_amount: 1000,
        total_miles_accrued: 0,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          // NO payment_method on historical transaction
          amount: 1000,
          card_masked: '**** **** **** 1234',
          status: 'SUCCESS',
          created_at: new Date(),
        }],
        passengers: [{}],
        save: jest.fn(),
      };
      bookingModel.exec.mockResolvedValue(mockBooking);
      flightsService.findById.mockResolvedValue({
        distance_miles: 500,
        scheduled_departure: new Date(Date.now() + 10 * 86400000),
      });
      policiesService.calculateRefundPercentage.mockReturnValue(80);
      usersService.findById.mockResolvedValue({ _id: 'u1', preferred_credit_card: '' }); // no profile card fallback either

      await service.cancelTicket({ identifier: 'CNF-HISTORICAL' });

      const refundTx = mockBooking.payment_transactions.find((t: any) => t.transaction_type === 'REFUND');
      expect(refundTx).toBeDefined();
      expect(refundTx.payment_method).toBeUndefined();
      expect(refundTx.card_masked).toBe('**** **** **** 1234');
    });

    it('Requirement 10: emergency cancellation REFUND copies source payment_method when present', async () => {
      const mockBookingWithMethod: any = {
        status: BookingStatus.CONFIRMED,
        total_amount: 1000,
        total_miles_accrued: 0,
        user_id: 'u1',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1000,
          card_masked: '**** **** **** 5555',
          status: 'SUCCESS',
        }],
        passengers: [{}],
        save: jest.fn(),
      };

      const mockBookingWithoutMethod: any = {
        status: BookingStatus.CONFIRMED,
        total_amount: 500,
        total_miles_accrued: 0,
        user_id: 'u2',
        ticket_coupons: [{ flight_id: 'f1', inventory_id: 'i1' }],
        payment_transactions: [{
          transaction_type: 'PAYMENT',
          amount: 500,
          card_masked: '**** **** **** 6666',
          status: 'SUCCESS',
        }],
        passengers: [{}],
        save: jest.fn(),
      };

      const flightDoc: any = { _id: 'f1' };
      const flightsSvcBookingModel: any = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockBookingWithMethod, mockBookingWithoutMethod]),
        }),
      };
      const realFlightsSvc = new FlightsService(
        {} as any,
        flightsSvcBookingModel,
        {} as any,
        usersService,
        {} as any,
        {} as any,
        {} as any,
      );
      jest.spyOn(realFlightsSvc, 'updateAvailableSeats').mockResolvedValue(true as any);

      await realFlightsSvc.cancelBookingsForFlight(flightDoc);

      const refund1 = mockBookingWithMethod.payment_transactions.find((t: any) => t.transaction_type === 'REFUND');
      expect(refund1).toBeDefined();
      expect(refund1.payment_method).toBe(PaymentMethod.PROFILE_CARD);

      const refund2 = mockBookingWithoutMethod.payment_transactions.find((t: any) => t.transaction_type === 'REFUND');
      expect(refund2).toBeDefined();
      expect(refund2.payment_method).toBeUndefined();
    });

    it('Requirement 13: booking population paths remain safe: findAll, findById, trackTicket project without preferred_credit_card', async () => {
      bookingModel.exec.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', ticket_coupons: [] });

      await service.findAll();
      expect(bookingModel.populate).toHaveBeenCalledWith('user_id', '-password_hash -preferred_credit_card');

      await service.findById('507f1f77bcf86cd799439011');
      expect(bookingModel.populate).toHaveBeenCalledWith('user_id', '-password_hash -preferred_credit_card');

      await service.trackTicket('PNR123');
      expect(bookingModel.populate).toHaveBeenCalledWith('user_id', '-password_hash -preferred_credit_card');
    });

    it('Requirement 14: existing historical transaction without payment_method remains readable and valid', () => {
      const historicalTx: PaymentTransaction = {
        transaction_type: 'PAYMENT',
        amount: 250000,
        card_masked: '**** **** **** 1234',
        status: 'SUCCESS',
        created_at: new Date('2025-01-01'),
      };
      expect(historicalTx.payment_method).toBeUndefined();
      expect(historicalTx.amount).toBe(250000);
      expect(historicalTx.card_masked).toBe('**** **** **** 1234');
    });
  });
});
