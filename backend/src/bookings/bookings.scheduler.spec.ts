import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BookingsScheduler } from './bookings.scheduler';
import { Booking, BookingStatus } from './bookings.schema';
import { BookingsService } from './bookings.service';
import { FlightsService } from '../flights/flights.service';
import { MailService } from '../mail/mail.service';

describe('BookingsScheduler - Hold Reminder Reliability (Gap 2)', () => {
  let scheduler: BookingsScheduler;
  let bookingModel: any;
  let bookingsService: any;
  let flightsService: any;
  let mailService: any;

  const now = new Date();
  const departureDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days ahead (<21 days)

  beforeEach(async () => {
    bookingModel = {
      find: jest.fn(),
    };

    bookingsService = {
      getEarliestDeparture: jest.fn().mockResolvedValue(departureDate),
      cancelExpiredBlockStrict: jest.fn(),
    };

    flightsService = {
      findById: jest.fn().mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: departureDate,
      }),
    };

    mailService = {
      sendBlockedTicketReminder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsScheduler,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: BookingsService, useValue: bookingsService },
        { provide: FlightsService, useValue: flightsService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    scheduler = module.get<BookingsScheduler>(BookingsScheduler);
  });

  it('Case 1: mail service returns true -> is_reminder_sent becomes true -> booking saved', async () => {
    const mockBooking: any = {
      pnr_code: 'PNR-SUCCESS',
      status: BookingStatus.BLOCKED,
      is_reminder_sent: false,
      user_id: { email: 'passenger@example.com', first_name: 'John', last_name: 'Doe' },
      ticket_coupons: [{ flight_id: 'f1', flight_number: 'VN101', inventory_id: 'inv1', cabin_class: 'ECONOMY' }],
      time_limit_deadline: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    bookingModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBooking]),
      }),
    });

    mailService.sendBlockedTicketReminder.mockResolvedValue(true);

    const sentCount = await scheduler.sendPendingReminders();

    expect(sentCount).toBe(1);
    expect(mailService.sendBlockedTicketReminder).toHaveBeenCalledTimes(1);
    expect(mockBooking.is_reminder_sent).toBe(true);
    expect(mockBooking.save).toHaveBeenCalledTimes(1);
  });

  it('Case 2: mail service returns false -> is_reminder_sent remains false -> booking must NOT be saved as reminded', async () => {
    const mockBooking: any = {
      pnr_code: 'PNR-FAIL',
      status: BookingStatus.BLOCKED,
      is_reminder_sent: false,
      user_id: { email: 'passenger@example.com', first_name: 'Jane', last_name: 'Doe' },
      ticket_coupons: [{ flight_id: 'f1', flight_number: 'VN101', inventory_id: 'inv1', cabin_class: 'ECONOMY' }],
      time_limit_deadline: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    bookingModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockBooking]),
      }),
    });

    mailService.sendBlockedTicketReminder.mockResolvedValue(false);

    const sentCount = await scheduler.sendPendingReminders();

    expect(sentCount).toBe(0);
    expect(mailService.sendBlockedTicketReminder).toHaveBeenCalledTimes(1);
    expect(mockBooking.is_reminder_sent).toBe(false);
    expect(mockBooking.save).not.toHaveBeenCalled();
  });

  it('Case 3: mail service throws -> booking remains retryable -> scheduler continues processing other bookings', async () => {
    const throwingBooking: any = {
      pnr_code: 'PNR-THROW',
      status: BookingStatus.BLOCKED,
      is_reminder_sent: false,
      user_id: { email: 'throw@example.com', first_name: 'Error', last_name: 'User' },
      ticket_coupons: [{ flight_id: 'f1', flight_number: 'VN101', inventory_id: 'inv1', cabin_class: 'ECONOMY' }],
      time_limit_deadline: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    const succeedingBooking: any = {
      pnr_code: 'PNR-OK',
      status: BookingStatus.BLOCKED,
      is_reminder_sent: false,
      user_id: { email: 'ok@example.com', first_name: 'Good', last_name: 'User' },
      ticket_coupons: [{ flight_id: 'f1', flight_number: 'VN101', inventory_id: 'inv1', cabin_class: 'ECONOMY' }],
      time_limit_deadline: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    bookingModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([throwingBooking, succeedingBooking]),
      }),
    });

    mailService.sendBlockedTicketReminder
      .mockRejectedValueOnce(new Error('SMTP connection timed out'))
      .mockResolvedValueOnce(true);

    const sentCount = await scheduler.sendPendingReminders();

    expect(sentCount).toBe(1);
    expect(mailService.sendBlockedTicketReminder).toHaveBeenCalledTimes(2);

    // First booking threw: stays unreminded, save not called
    expect(throwingBooking.is_reminder_sent).toBe(false);
    expect(throwingBooking.save).not.toHaveBeenCalled();

    // Second booking succeeded: marked reminded and saved
    expect(succeedingBooking.is_reminder_sent).toBe(true);
    expect(succeedingBooking.save).toHaveBeenCalledTimes(1);
  });
});
