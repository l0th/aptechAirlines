import { Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { BookingDocument, BookingStatus, HoldEmailStatus } from './bookings.schema';
import { FlightsService } from '../flights/flights.service';
import { MailService } from '../mail/mail.service';
import { formatLocalTime } from '../common/timezone.util';

export const HOLD_EMAIL_MAX_ATTEMPTS = 6;
const HOLD_EMAIL_LEASE_MS = 10 * 60 * 1000;
const HOLD_EMAIL_BACKOFF_MS = 60 * 1000;
const logger = new Logger('HoldEmailDelivery');

/** Shared post-commit + scheduler path. Claims one booking at a time across workers. */
export async function deliverHoldCreatedEmail(
  bookingModel: Model<BookingDocument>,
  flightsService: FlightsService,
  mailService: MailService,
  bookingId: Types.ObjectId | string,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + HOLD_EMAIL_LEASE_MS);
  const claimed = await bookingModel.findOneAndUpdate(
    {
      _id: bookingId,
      status: BookingStatus.BLOCKED,
      time_limit_deadline: { $gt: now },
      'hold_email.attempt_count': { $lt: HOLD_EMAIL_MAX_ATTEMPTS },
      $or: [
        { 'hold_email.status': { $in: [HoldEmailStatus.PENDING, HoldEmailStatus.FAILED] },
          'hold_email.next_retry_at': { $lte: now } },
        { 'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': { $lte: now } },
      ],
    },
    {
      $set: { 'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': leaseUntil },
      $inc: { 'hold_email.attempt_count': 1 },
    },
    { new: true },
  ).populate('user_id', 'email first_name last_name').exec();

  if (!claimed) return false;

  let sent = false;
  let failureReason = 'SMTP did not accept the email';
  try {
    const user = claimed.user_id as any;
    if (!user?.email) throw new Error('Customer email is missing');

    const configuredOrigin = process.env.FRONTEND_BASE_URL?.trim();
    const frontendBase = configuredOrigin || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4200');
    if (!frontendBase) throw new Error('Public frontend URL is not configured');
    const paymentUrl = new URL('/track', frontendBase);
    if (!['http:', 'https:'].includes(paymentUrl.protocol) || paymentUrl.username || paymentUrl.password ||
        (process.env.NODE_ENV === 'production' && paymentUrl.protocol !== 'https:')) {
      throw new Error('Frontend URL must be a public HTTPS address in production');
    }
    paymentUrl.searchParams.set('code', claimed.blocking_number || claimed.pnr_code);

    const distinctLegs = new Map<string, any>();
    for (const coupon of claimed.ticket_coupons || []) {
      if (String(coupon.coupon_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
      const id = coupon.flight_id?.toString();
      if (id && !distinctLegs.has(id)) distinctLegs.set(id, coupon);
    }
    if (!distinctLegs.size) throw new Error('Held itinerary has no active flight legs');
    const sortedLegs = await Promise.all([...distinctLegs].map(async ([id, coupon]) => {
      const flight = await flightsService.findById(id);
      if (!flight) throw new Error('A held flight is missing');
      const zone = await flightsService.getAirportTimeZone(flight.origin_iata);
      return {
        departure: new Date(flight.scheduled_departure).getTime(),
        zone,
        flightNumber: flight.flight_number,
        origin: flight.origin_iata,
        destination: flight.dest_iata,
        cabinClass: coupon.cabin_class,
        departureTimeFormatted: `${formatLocalTime(new Date(flight.scheduled_departure), zone)} (${zone})`,
      };
    }));
    sortedLegs.sort((a, b) => a.departure - b.departure);
    const deadline = claimed.time_limit_deadline;
    if (!deadline || !Number.isFinite(new Date(deadline).getTime())) throw new Error('Hold deadline is missing');
    const deadlineZone = sortedLegs[0].zone;
    const deadlineFormatted = `${formatLocalTime(new Date(deadline), deadlineZone)} (${deadlineZone})`;

    // Check immediately before SMTP; claims issued before payment/cancellation
    // must not turn into reminder emails after a booking changes state.
    const stillHeld = await bookingModel.exists({
      _id: claimed._id, status: BookingStatus.BLOCKED, time_limit_deadline: { $gt: new Date() },
      'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': leaseUntil,
    });
    if (!stillHeld) {
      // Release our lease. A paid/cancelled hold is never eligible for retries.
      await bookingModel.updateOne(
        { _id: claimed._id, 'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': leaseUntil },
        { $set: {
          'hold_email.status': HoldEmailStatus.FAILED,
          'hold_email.next_retry_at': null,
          'hold_email.lease_until': null,
          'hold_email.last_error': 'Hold no longer eligible for email delivery',
        } },
      ).exec();
      return false;
    }

    sent = await mailService.sendHoldCreatedEmail({
      toEmail: user.email,
      passengerName: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Customer',
      bookingReference: claimed.pnr_code,
      blockingNumber: claimed.blocking_number,
      deadlineFormatted,
      legs: sortedLegs.map(({ departure, zone, ...leg }) => leg),
      paymentUrl: paymentUrl.toString(),
    });
  } catch (err: any) {
    failureReason = err?.message?.substring(0, 200) || 'Unable to prepare hold email';
    logger.warn(`Hold email for ${claimed.pnr_code} was not delivered: ${failureReason}`);
  }

  const attempts = claimed.hold_email?.attempt_count || 1;
  const retryDelay = Math.min(24 * 60 * 60 * 1000, HOLD_EMAIL_BACKOFF_MS * (2 ** (attempts - 1)));
  const result = await bookingModel.updateOne(
    { _id: claimed._id, 'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': leaseUntil },
    { $set: {
      'hold_email.status': sent ? HoldEmailStatus.SENT : HoldEmailStatus.FAILED,
      'hold_email.next_retry_at': sent ? null : new Date(Date.now() + retryDelay),
      'hold_email.lease_until': null,
      'hold_email.sent_at': sent ? new Date() : null,
      'hold_email.last_error': sent ? null : failureReason,
    } },
  ).exec();
  if (sent && !result.modifiedCount) logger.warn(`Hold email for ${claimed.pnr_code} was submitted, but delivery state could not be finalized.`);
  return sent;
}
