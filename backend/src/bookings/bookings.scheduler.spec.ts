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
      getAirportTimeZone: jest.fn().mockResolvedValue('Asia/Ho_Chi_Minh'),
    };

    mailService = {
      sendBlockedTicketReminder: jest.fn(),
      sendUpcomingTripReminder: jest.fn(),
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

  it('Case 4: reminder email formats departure in origin airport-local timezone without host-OS skew', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    try {
      const fixedUtcDeparture = new Date('2026-10-28T01:00:00.000Z');
      flightsService.findById.mockResolvedValue({
        flight_number: 'VN101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: fixedUtcDeparture,
      });
      flightsService.getAirportTimeZone.mockResolvedValue('Asia/Ho_Chi_Minh');
      bookingsService.getEarliestDeparture.mockResolvedValue(fixedUtcDeparture);

      const mockBooking: any = {
        pnr_code: 'PNR-TZ-TEST',
        blocking_number: 'BLK-999',
        status: BookingStatus.BLOCKED,
        is_reminder_sent: false,
        user_id: { email: 'passenger@example.com', first_name: '<John>', last_name: 'Doe' },
        ticket_coupons: [{ flight_id: 'f1', flight_number: 'VN101', inventory_id: 'inv1', cabin_class: 'BUSINESS' }],
        time_limit_deadline: new Date('2026-10-25T00:00:00.000Z'),
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
      const [toEmail, body] = mailService.sendBlockedTicketReminder.mock.calls[0];
      expect(toEmail).toBe('passenger@example.com');
      // Verifies airport-local timezone is resolved and formatted deterministically (UTC 01:00 -> ICT 08:00)
      expect(body).toContain('2026-10-28 08:00');
      expect(body).toContain('(Asia/Ho_Chi_Minh)');
      expect(body.indexOf('<section lang="vi"')).toBeLessThan(body.indexOf('<section lang="en"'));
      expect(body).toContain('<section lang="en"');
      expect(body).toContain('Payment deadline');
      // Verifies HTML escaping on passenger name
      expect(body).toContain('&lt;John&gt; Doe');
      expect(body).not.toContain('<John>');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Case 5: Multi-leg booking with non-chronological coupons resolves earliest departing leg origin timezone for reminder and deadline (Finding F2)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    try {
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

      flightsService.getAirportTimeZone.mockImplementation((iata: string) => {
        if (iata === 'NRT') return Promise.resolve('Asia/Tokyo');
        if (iata === 'HAN') return Promise.resolve('Asia/Ho_Chi_Minh');
        return Promise.resolve('UTC');
      });

      bookingsService.getEarliestDeparture.mockResolvedValue(new Date('2026-10-28T01:00:00.000Z'));

      // Coupon 0 is the LATER flight (Tokyo), Coupon 1 is the EARLIER flight (Hanoi)
      const mockBooking: any = {
        pnr_code: 'PNR-MULTI-TZ',
        blocking_number: 'BLK-MULTI',
        status: BookingStatus.BLOCKED,
        is_reminder_sent: false,
        user_id: { email: 'multileg@example.com', first_name: 'Lan', last_name: 'Vu' },
        ticket_coupons: [
          { flight_id: 'f_later', flight_number: 'VN200', inventory_id: 'inv2', cabin_class: 'ECONOMY' },
          { flight_id: 'f_earlier', flight_number: 'VN100', inventory_id: 'inv1', cabin_class: 'ECONOMY' },
        ],
        time_limit_deadline: new Date('2026-10-25T03:00:00.000Z'),
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
      const [toEmail, body] = mailService.sendBlockedTicketReminder.mock.calls[0];
      expect(toEmail).toBe('multileg@example.com');
      // Origin timezone of earliest physical flight (HAN -> Asia/Ho_Chi_Minh, UTC 01:00 -> 08:00)
      expect(body).toContain('2026-10-28 08:00');
      expect(body).toContain('(Asia/Ho_Chi_Minh)');
      // Hold deadline formatted in earliest flight's origin timezone (UTC 03:00 + 7 = 10:00)
      // Customer has no language preference -> Vietnamese email ("Hạn thanh toán" = payment deadline)
      expect(body).toContain('<strong>Hạn thanh toán:</strong> 2026-10-25 10:00 (Asia/Ho_Chi_Minh)');
      expect(body).not.toContain('<strong>Hạn thanh toán:</strong> 2026-10-25 12:00 (Asia/Tokyo)');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Case 6: confirmed trip within 3 days receives one upcoming-trip reminder per itinerary fingerprint', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    try {
      const dep = new Date('2026-10-22T01:00:00.000Z');
      const arr = new Date('2026-10-22T03:00:00.000Z');
      flightsService.findById.mockResolvedValue({
        flight_number: 'APT9001', origin_iata: 'SGN', dest_iata: 'HAN', scheduled_departure: dep, scheduled_arrival: arr,
      });
      flightsService.getAirportTimeZone.mockResolvedValue('Asia/Ho_Chi_Minh');
      mailService.sendUpcomingTripReminder.mockResolvedValue(true);

      const mockBooking: any = {
        pnr_code: 'PNR-UPCOMING', confirmation_number: 'CNF-UPCOMING', status: BookingStatus.CONFIRMED,
        user_id: { email: 'upcoming@example.com', first_name: 'An', last_name: 'Nguyen' },
        ticket_coupons: [{ flight_id: 'f-upcoming', flight_number: 'APT9001', inventory_id: 'i1', cabin_class: 'ECONOMY', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockResolvedValue(true),
      };
      bookingModel.find.mockReturnValue({ populate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([mockBooking]) }) });

      expect(await scheduler.sendUpcomingTripReminders()).toBe(1);
      expect(mailService.sendUpcomingTripReminder).toHaveBeenCalledTimes(1);
      expect(mockBooking.departure_reminder_key).toContain('f-upcoming');
      expect(mockBooking.save).toHaveBeenCalledTimes(1);

      expect(await scheduler.sendUpcomingTripReminders()).toBe(0);
      expect(mailService.sendUpcomingTripReminder).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
