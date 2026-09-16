import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingStatus } from './bookings.schema';
import { BookingsService } from './bookings.service';
import { FlightsService } from '../flights/flights.service';
import { MailService } from '../mail/mail.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Scheduled jobs for the bookings domain:
 *
 * 1. REMINDER (Requirement 3.4.2.1): sends an email to the user 3 weeks
 *    before the departure date for tickets that were BLOCKED. Runs every
 *    hour; a booking is reminded once (is_reminder_sent flag) when its
 *    earliest departure is within 21 days.
 *
 * 2. AUTO-CANCEL: cancels BLOCKED bookings whose time_limit_deadline
 *    (2 weeks before departure) has passed, releasing the held seats the
 *    same way cancelTicket does.
 *
 * Both operations are also exposed as public methods so admins can trigger
 * them manually via the controller endpoints.
 */
@Injectable()
export class BookingsScheduler {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly bookingsService: BookingsService,
    private readonly flightsService: FlightsService,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledJobs(): Promise<void> {
    await this.sendPendingReminders();
    await this.autoCancelExpiredBlocks();
  }

  /**
   * Requirement 3.4.2.1: reminder email 3 weeks before departure for
   * blocked tickets. Simplest correct condition: booking still BLOCKED,
   * not yet reminded, and departure is within 21 days (and still in the
   * future). Per-booking try/catch so one failure does not stop the batch.
   * Returns the number of reminders sent.
   */
  async sendPendingReminders(): Promise<number> {
    const now = new Date();
    const twentyOneDaysFromNow = new Date(now.getTime() + 21 * DAY_MS);

    const candidates = await this.bookingModel
      .find({
        status: BookingStatus.BLOCKED,
        is_reminder_sent: false,
      })
      .populate('user_id', 'email first_name last_name')
      .exec();

    let sent = 0;
    for (const booking of candidates) {
      try {
        // Skip bookings whose blocking deadline already passed (auto-cancel handles them)
        if (booking.time_limit_deadline && new Date(booking.time_limit_deadline) <= now) {
          continue;
        }

        const earliestDeparture = await this.bookingsService.getEarliestDeparture(booking);
        if (earliestDeparture <= now || earliestDeparture > twentyOneDaysFromNow) {
          continue;
        }

        const user: any = booking.user_id as any;
        const toEmail = user?.email;
        if (!toEmail) {
          this.logger.warn(`Booking ${booking.pnr_code}: user has no email, reminder skipped`);
          continue;
        }

        const reminderBody = await this.buildReminderBody(booking, user, earliestDeparture);
        await this.mailService.sendBlockedTicketReminder(toEmail, reminderBody);

        booking.is_reminder_sent = true;
        await booking.save();
        sent++;
        this.logger.log(`Reminder email queued for booking ${booking.pnr_code} (${toEmail})`);
      } catch (err) {
        this.logger.error(
          `Failed to send reminder for booking ${booking.pnr_code}: ${err?.message || err}`,
        );
      }
    }
    return sent;
  }

  /**
   * Auto-cancel BLOCKED bookings whose time_limit_deadline has passed.
   * Releases seats exactly like cancelTicket (via BookingsService) and
   * stamps a cancellation number. Returns the number of cancellations.
   */
  async autoCancelExpiredBlocks(): Promise<number> {
    const now = new Date();

    const expired = await this.bookingModel
      .find({
        status: BookingStatus.BLOCKED,
        time_limit_deadline: { $lt: now, $ne: null },
      })
      .exec();

    let cancelled = 0;
    for (const booking of expired) {
      try {
        booking.status = BookingStatus.CANCELLED;
        booking.cancellation_number = this.generateCode('CAN');
        await booking.save();

        // Release the held seats (same logic as cancelTicket)
        await this.bookingsService.releaseSeatsForBooking(booking);

        cancelled++;
        this.logger.log(
          `Auto-cancelled expired blocked booking ${booking.pnr_code} ` +
            `(blocking number: ${booking.blocking_number}, deadline: ${booking.time_limit_deadline}, ` +
            `cancellation number: ${booking.cancellation_number})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-cancel booking ${booking.pnr_code}: ${err?.message || err}`,
        );
      }
    }
    return cancelled;
  }

  private async buildReminderBody(
    booking: BookingDocument,
    user: any,
    earliestDeparture: Date,
  ): Promise<string> {
    // Gather the distinct flight legs for the email
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const coupon of booking.ticket_coupons) {
      const key = `${coupon.flight_number}_${coupon.inventory_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const flight = await this.flightsService.findById(coupon.flight_id.toString());
        lines.push(
          `<li>Flight ${flight.flight_number}: ${flight.origin_iata} → ${flight.dest_iata}, ` +
            `departing ${new Date(flight.scheduled_departure).toLocaleString()} (${coupon.cabin_class})</li>`,
        );
      } catch (e) {
        lines.push(`<li>Flight ${coupon.flight_number} (${coupon.cabin_class})</li>`);
      }
    }

    const passengerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Customer';

    return `
      <h2>Blocked Ticket Reminder</h2>
      <p>Dear ${passengerName},</p>
      <p>This is a reminder that you have a <strong>blocked (unpaid) ticket</strong> with departure on
      <strong>${earliestDeparture.toLocaleString()}</strong> — 3 weeks or less away.</p>
      <p><strong>Booking reference (PNR):</strong> ${booking.pnr_code}<br/>
      <strong>Blocking number:</strong> ${booking.blocking_number || '-'}<br/>
      <strong>Payment deadline:</strong> ${booking.time_limit_deadline ? new Date(booking.time_limit_deadline).toLocaleString() : '-'}</p>
      <p>Your itinerary:</p>
      <ul>${lines.join('')}</ul>
      <p>Please confirm your ticket before the payment deadline. If you do not confirm in time,
      the reservation will be automatically cancelled and the seats will be released.</p>
      <p>Thank you for flying with us.</p>
    `;
  }

  private generateCode(prefix: string): string {
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomChars}`;
  }
}
