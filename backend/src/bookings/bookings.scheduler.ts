import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingStatus, HoldEmailStatus } from './bookings.schema';
import { deliverHoldCreatedEmail, HOLD_EMAIL_MAX_ATTEMPTS } from './hold-email-delivery';
import { BookingsService } from './bookings.service';
import { FlightsService } from '../flights/flights.service';
import { BlockedReminderLeg, ItineraryLegData, MailService, normalizeMailLang, renderBlockedTicketReminder } from '../mail/mail.service';
import { formatLocalTime } from '../common/timezone.util';
import { renderBilingualMail } from '../mail/mail-i18n';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import {
  BookingSeatSagaOperation,
  BookingSeatSagaOperationDocument,
  SagaState,
  SagaOperationType,
} from '../seat-allocation/booking-seat-saga-operation.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BookingsScheduler {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly bookingsService: BookingsService,
    private readonly flightsService: FlightsService,
    private readonly mailService: MailService,
    @Optional() private readonly seatAllocationService?: SeatAllocationService,
    @Optional()
    @InjectModel(BookingSeatSagaOperation.name)
    private readonly sagaModel?: Model<BookingSeatSagaOperationDocument>,
  ) {}

  /** Recover undelivered hold-created emails after crashes or SMTP outages. */
  @Cron('*/5 * * * *')
  async retryHoldCreatedEmails(): Promise<number> {
    const now = new Date();
    const candidates = await this.bookingModel.find({
      status: BookingStatus.BLOCKED,
      time_limit_deadline: { $gt: now },
      'hold_email.attempt_count': { $lt: HOLD_EMAIL_MAX_ATTEMPTS },
      $or: [
        { 'hold_email.status': { $in: [HoldEmailStatus.PENDING, HoldEmailStatus.FAILED] },
          'hold_email.next_retry_at': { $lte: now } },
        { 'hold_email.status': HoldEmailStatus.SENDING, 'hold_email.lease_until': { $lte: now } },
      ],
    }).select('_id').limit(50).lean().exec();

    let delivered = 0;
    for (const booking of candidates) {
      try {
        if (await deliverHoldCreatedEmail(this.bookingModel, this.flightsService, this.mailService, booking._id)) {
          delivered++;
        }
      } catch (err: any) {
        this.logger.error(`Hold email retry failed for booking ${booking._id}: ${err?.message || err}`);
      }
    }
    return delivered;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledJobs(): Promise<void> {
    await this.sendPendingReminders();
    await this.sendUpcomingTripReminders();
    await this.autoCancelExpiredBlocks();
    await this.reconcileStaleSagaOperations();
    await this.recoverUnconfirmedSeatAllocations();
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
      .populate('user_id', 'email first_name last_name preferred_language')
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
        const mailSent = await this.mailService.sendBlockedTicketReminder(toEmail, reminderBody, booking.pnr_code);
        if (!mailSent) {
          this.logger.warn(
            `Reminder email delivery returned false for booking ${booking.pnr_code} (${toEmail}); leaving unreminded for retry`,
          );
          continue;
        }

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
   * Sends a customer reminder when a confirmed trip is within 3 days of its
   * next active departure. The itinerary fingerprint prevents duplicate hourly
   * sends but still allows a new reminder after a reschedule changes the trip.
   */
  async sendUpcomingTripReminders(): Promise<number> {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * DAY_MS);
    const candidates = await this.bookingModel
      .find({ status: { $in: [BookingStatus.CONFIRMED, BookingStatus.RESCHEDULED] } })
      .populate('user_id', 'email first_name last_name preferred_language')
      .exec();

    let sent = 0;
    for (const booking of candidates) {
      try {
        const itinerary = await this.resolveActiveItinerary(booking);
        if (itinerary.earliestDeparture <= now || itinerary.earliestDeparture > threeDaysFromNow) continue;
        if (booking.departure_reminder_key === itinerary.key) continue;
        if (await this.sendUpcomingForBooking(booking, itinerary)) sent++;
      } catch (err: any) {
        this.logger.error(`Failed to send upcoming-trip reminder for ${booking.pnr_code}: ${err?.message || err}`);
      }
    }
    return sent;
  }

  /** Admin/demo action: send the correct reminder template for one booking now. */
  async sendManualReminder(bookingId: string): Promise<{
    type: 'HOLD_PAYMENT' | 'UPCOMING_TRIP';
    message: string;
    messageVi: string;
    messageEn: string;
  }> {
    const booking = await this.bookingModel
      .findById(bookingId)
      .populate('user_id', 'email first_name last_name preferred_language')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found.');

    const user: any = booking.user_id as any;
    if (!user?.email) throw new BadRequestException('Customer does not have an email address.');

    if (booking.status === BookingStatus.BLOCKED) {
      const earliestDeparture = await this.bookingsService.getEarliestDeparture(booking);
      const body = await this.buildReminderBody(booking, user, earliestDeparture);
      const ok = await this.mailService.sendBlockedTicketReminder(user.email, body, booking.pnr_code);
      if (!ok) throw new BadRequestException('Email delivery failed. Check SMTP configuration/logs.');
      booking.is_reminder_sent = true;
      await booking.save();
      const messageVi = `Đã gửi email nhắc thanh toán cho ${booking.pnr_code}.`;
      const messageEn = `Payment reminder email sent for ${booking.pnr_code}.`;
      return { type: 'HOLD_PAYMENT', message: messageVi, messageVi, messageEn };
    }

    if (booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.RESCHEDULED) {
      const itinerary = await this.resolveActiveItinerary(booking);
      const ok = await this.sendUpcomingForBooking(booking, itinerary);
      if (!ok) throw new BadRequestException('Email delivery failed. Check SMTP configuration/logs.');
      const messageVi = `Đã gửi email nhắc lịch bay cho ${booking.pnr_code}.`;
      const messageEn = `Upcoming-trip reminder email sent for ${booking.pnr_code}.`;
      return { type: 'UPCOMING_TRIP', message: messageVi, messageVi, messageEn };
    }

    throw new BadRequestException('Only BLOCKED, CONFIRMED, or RESCHEDULED bookings can receive reminders.');
  }

  private async sendUpcomingForBooking(
    booking: BookingDocument,
    itinerary: Awaited<ReturnType<BookingsScheduler['resolveActiveItinerary']>>,
  ): Promise<boolean> {
    const user: any = booking.user_id as any;
    if (!user?.email) return false;
    const passengerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Customer';
    const departureTimeFormatted = itinerary.legs[0]?.departureTimeFormatted || itinerary.earliestDeparture.toISOString();
    const ok = await this.mailService.sendUpcomingTripReminder({
      toEmail: user.email,
      passengerName,
      bookingReference: booking.pnr_code,
      confirmationNumber: booking.confirmation_number,
      departureTimeFormatted,
      itinerary: itinerary.legs,
      lang: normalizeMailLang(user.preferred_language),
    });
    if (!ok) return false;
    booking.departure_reminder_key = itinerary.key;
    await booking.save();
    this.logger.log(`Upcoming-trip reminder sent for booking ${booking.pnr_code} (${user.email})`);
    return true;
  }

  private async resolveActiveItinerary(booking: BookingDocument): Promise<{
    earliestDeparture: Date;
    key: string;
    legs: ItineraryLegData[];
  }> {
    const coupons = (booking.ticket_coupons || []).filter(
      (coupon: any) => !['CANCELLED', 'RESCHEDULED'].includes(String(coupon.coupon_status || 'ACTIVE').toUpperCase()),
    );
    const seen = new Set<string>();
    const resolved: Array<{ departure: Date; key: string; leg: ItineraryLegData }> = [];
    for (const coupon of coupons) {
      const flightId = coupon.flight_id?.toString();
      if (!flightId || seen.has(flightId)) continue;
      seen.add(flightId);
      const flight = await this.flightsService.findById(flightId);
      const departure = new Date(flight.scheduled_departure);
      if (Number.isNaN(departure.getTime())) continue;
      const originTz = await this.flightsService.getAirportTimeZone(flight.origin_iata);
      const destinationTz = await this.flightsService.getAirportTimeZone(flight.dest_iata);
      const depLocal = formatLocalTime(flight.scheduled_departure, originTz);
      const arrLocal = formatLocalTime(flight.scheduled_arrival, destinationTz);
      resolved.push({
        departure,
        key: `${flightId}:${departure.toISOString()}`,
        leg: {
          flightNumber: flight.flight_number,
          origin: flight.origin_iata,
          destination: flight.dest_iata,
          cabinClass: coupon.cabin_class,
          departureTimeFormatted: depLocal ? `${depLocal} (${originTz})` : departure.toISOString(),
          arrivalTimeFormatted: arrLocal ? `${arrLocal} (${destinationTz})` : undefined,
        },
      });
    }
    resolved.sort((a, b) => a.departure.getTime() - b.departure.getTime());
    if (!resolved.length) throw new BadRequestException('Booking has no active future itinerary to remind.');
    return {
      earliestDeparture: resolved[0].departure,
      key: resolved.map((x) => x.key).join('|'),
      legs: resolved.map((x) => x.leg),
    };
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
        await this.bookingsService.cancelExpiredBlockStrict(booking);

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
    const legs: BlockedReminderLeg[] = [];
    const seen = new Set<string>();
    let earliestLegOriginTz: string | undefined;
    let minDepTime = Infinity;

    for (const coupon of booking.ticket_coupons) {
      const key = `${coupon.flight_number}_${coupon.inventory_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const flight = await this.flightsService.findById(coupon.flight_id.toString());
        const originTz = await this.flightsService.getAirportTimeZone(flight.origin_iata);
        const depTime = new Date(flight.scheduled_departure).getTime();
        if (depTime < minDepTime) {
          minDepTime = depTime;
          earliestLegOriginTz = originTz;
        }
        const localDep = formatLocalTime(flight.scheduled_departure, originTz);
        const depStr = localDep
          ? `${localDep} (${originTz})`
          : `${new Date(flight.scheduled_departure).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;
        legs.push({
          flightNumber: flight.flight_number,
          origin: flight.origin_iata,
          destination: flight.dest_iata,
          departureTimeFormatted: depStr,
          cabinClass: coupon.cabin_class,
        });
      } catch (e) {
        legs.push({ flightNumber: coupon.flight_number, cabinClass: coupon.cabin_class });
      }
    }

    const passengerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Customer';

    const localEarliest = formatLocalTime(earliestDeparture, earliestLegOriginTz);
    const earliestStr = localEarliest
      ? `${localEarliest} (${earliestLegOriginTz})`
      : `${earliestDeparture.toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;

    let deadlineStr = '-';
    if (booking.time_limit_deadline) {
      const localDeadline = formatLocalTime(new Date(booking.time_limit_deadline), earliestLegOriginTz);
      deadlineStr = localDeadline
        ? `${localDeadline} (${earliestLegOriginTz})`
        : `${new Date(booking.time_limit_deadline).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;
    }

    const data = {
      toEmail: user?.email || '',
      passengerName,
      bookingReference: booking.pnr_code,
      blockingNumber: booking.blocking_number,
      earliestDepartureFormatted: earliestStr,
      deadlineFormatted: deadlineStr,
      legs,
    };
    return renderBilingualMail((lang) => renderBlockedTicketReminder({ ...data, lang })).html;
  }

  /**
  /**
   * Phase B SAGA Reconciliation Job:
   * Recovers crashes occurring between inventory decrement, seat allocation, and booking save.
   * Runs every 10 minutes with a 15-minute stale grace window.
   */
  @Cron('*/10 * * * *')
  async reconcileStaleSagaOperations(): Promise<{ reconciledCount: number }> {
    if (!this.sagaModel) return { reconciledCount: 0 };

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const staleOps = await this.sagaModel.find({
      state: { $in: [SagaState.PRECOMMIT, SagaState.COMMITTED] },
      last_progress_at: { $lt: fifteenMinutesAgo },
    }).exec();

    let count = 0;
    for (const op of staleOps) {
      try {
        const matchingBooking = await this.bookingModel.findOne({
          'seat_saga_commit.operation_id': op.operation_id,
        }).exec();

        if (op.state === SagaState.PRECOMMIT) {
          if (matchingBooking) {
            // Promote to COMMITTED
            op.state = SagaState.COMMITTED;
            await op.save();

            // Forward finalize
            let forwardFinalized = true;
            if (this.seatAllocationService) {
              try {
                if (op.operation_type === SagaOperationType.CREATE) {
                  if (matchingBooking.status === BookingStatus.CONFIRMED) {
                    await this.seatAllocationService.confirmAllocations(matchingBooking._id, op.operation_id);
                  }
                } else if (op.operation_type === SagaOperationType.RESCHEDULE) {
                  await this.seatAllocationService.finalizeRescheduleAllocations(
                    matchingBooking._id,
                    op.operation_id,
                    op.old_seat_allocations,
                  );
                }
              } catch (allocErr) {
                forwardFinalized = false;
                this.logger.error(`Failed to forward finalize allocations for saga ${op.operation_id}: ${allocErr}`);
              }
            }

            // In RESCHEDULE, restore old inventory using restoreSeatsWithSaga
            if (op.operation_type === SagaOperationType.RESCHEDULE && op.old_inventory_restorations?.length > 0) {
              for (const r of op.old_inventory_restorations) {
                const restored = await this.flightsService.restoreSeatsWithSaga(
                  r.flight_id.toString(),
                  r.inventory_id,
                  r.seat_count,
                  { operation_id: op.operation_id, mutation_key: r.mutation_key },
                ).catch(() => false);
                if (!restored) {
                  forwardFinalized = false;
                  this.logger.error(`Failed to restore old inventory for saga ${op.operation_id}, flight ${r.flight_id}`);
                }
              }
            }

            if (forwardFinalized) {
              if (matchingBooking.seat_saga_commit) {
                matchingBooking.seat_saga_commit.status = 'COMPLETED';
                await matchingBooking.save();
              }
              op.state = SagaState.COMPLETED;
              op.completed_at = new Date();
              await op.save();
              count++;
            } else {
              this.logger.warn(`Saga ${op.operation_id} forward finalization incomplete; leaving in COMMITTED to retry.`);
            }
          } else {
            // True stale PRECOMMIT crash before booking save -> Compensate NEW resources only
            let allCompensated = true;
            for (const res of op.new_inventory_reservations) {
              const ok = await this.flightsService.compensateInventoryReservation(
                res.flight_id,
                res.inventory_id,
                res.mutation_key,
                res.seat_count,
              ).catch(() => false);
              if (!ok) {
                allCompensated = false;
                this.logger.error(`Failed to compensate inventory for saga op ${op.operation_id}, flight ${res.flight_id}`);
              }
            }

            // PRECOMMIT compensation MUST release allocations by saga_operation_id == operation_id, NEVER by booking_id alone
            if (this.seatAllocationService) {
              try {
                await this.seatAllocationService.releaseAllocationsBySaga(op.operation_id);
              } catch (seatErr) {
                allCompensated = false;
                this.logger.error(`Failed to release allocations by saga ${op.operation_id}: ${seatErr}`);
              }
            }

            // Only mark ABORTED after ALL required NEW-resource compensation succeeds
            if (allCompensated) {
              op.state = SagaState.ABORTED;
              op.aborted_at = new Date();
              await op.save();
              count++;
            } else {
              this.logger.warn(`Saga ${op.operation_id} compensation incomplete; leaving in PRECOMMIT to retry later.`);
            }
          }
        } else if (op.state === SagaState.COMMITTED) {
          // If a COMMITTED journal has no matching Booking commit witness:
          // do NOT mark COMPLETED. Leave it recoverable, record/log the failure, retry later.
          if (!matchingBooking) {
            this.logger.warn(
              `Stale COMMITTED saga ${op.operation_id} has no matching booking witness yet. Leaving recoverable for retry.`,
            );
            continue;
          }

          let forwardFinalized = true;

          // Forward-only finalization with verified booking commit witness
          if (this.seatAllocationService) {
            try {
              if (op.operation_type === SagaOperationType.CREATE) {
                if (matchingBooking.status === BookingStatus.CONFIRMED) {
                  await this.seatAllocationService.confirmAllocations(matchingBooking._id, op.operation_id);
                }
              } else if (op.operation_type === SagaOperationType.RESCHEDULE) {
                await this.seatAllocationService.finalizeRescheduleAllocations(
                  matchingBooking._id,
                  op.operation_id,
                  op.old_seat_allocations,
                );
              }
            } catch (allocErr) {
              forwardFinalized = false;
              this.logger.error(`Failed to finalize allocations for COMMITTED saga ${op.operation_id}: ${allocErr}`);
            }
          }

          // In RESCHEDULE, restore old inventory using restoreSeatsWithSaga
          if (op.operation_type === SagaOperationType.RESCHEDULE && op.old_inventory_restorations?.length > 0) {
            for (const r of op.old_inventory_restorations) {
              const restored = await this.flightsService.restoreSeatsWithSaga(
                r.flight_id.toString(),
                r.inventory_id,
                r.seat_count,
                { operation_id: op.operation_id, mutation_key: r.mutation_key },
              ).catch(() => false);
              if (!restored) {
                forwardFinalized = false;
                this.logger.error(`Failed to restore old inventory for COMMITTED saga ${op.operation_id}, flight ${r.flight_id}`);
              }
            }
          }

          if (forwardFinalized) {
            if (matchingBooking.seat_saga_commit) {
              matchingBooking.seat_saga_commit.status = 'COMPLETED';
              await matchingBooking.save();
            }
            op.state = SagaState.COMPLETED;
            op.completed_at = new Date();
            await op.save();
            count++;
          } else {
            this.logger.warn(`Saga ${op.operation_id} old inventory restoration incomplete; leaving in COMMITTED to retry.`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed to reconcile saga op ${op.operation_id}: ${err?.message || err}`);
      }
    }
    return { reconciledCount: count };
  }

  /**
   * Recovers ConfirmTicket crash gap:
   * Queries CONFIRMED bookings that still have HELD seat allocations and confirms them.
   */
  @Cron('*/10 * * * *')
  async recoverUnconfirmedSeatAllocations(): Promise<{ recoveredBookingsCount: number }> {
    if (!this.seatAllocationService) return { recoveredBookingsCount: 0 };

    try {
      const heldBookingIds = await this.seatAllocationService.findDistinctBookingIdsWithHeldAllocations();
      if (!heldBookingIds || heldBookingIds.length === 0) {
        return { recoveredBookingsCount: 0 };
      }

      const confirmedBookings = await this.bookingModel.find({
        _id: { $in: heldBookingIds },
        status: BookingStatus.CONFIRMED,
      }).select('_id ticket_coupons').exec();

      let recovered = 0;
      for (const booking of confirmedBookings) {
        try {
          // Read booking.ticket_coupons[].coupon_number to confirm ONLY persisted coupons
          // and never confirm tentative PRECOMMIT reschedule allocations belonging to uncommitted sagas
          const persistedCouponNumbers = (booking.ticket_coupons || [])
            .map((c: any) => c.coupon_number)
            .filter(Boolean);

          if (persistedCouponNumbers.length === 0) {
            // Never confirm arbitrary HELD allocations by booking_id alone when no persisted coupons exist
            continue;
          }

          const count = await this.seatAllocationService.confirmAllocations(
            booking._id,
            undefined,
            persistedCouponNumbers,
          );
          if (count > 0) {
            recovered++;
            this.logger.log(
              `Recovered ${count} unconfirmed seat allocation(s) for CONFIRMED booking ${booking._id}`,
            );
          }
        } catch (err: any) {
          this.logger.error(
            `Failed to confirm held allocations for booking ${booking._id}: ${err?.message || err}`,
          );
        }
      }
      return { recoveredBookingsCount: recovered };
    } catch (err: any) {
      this.logger.error(`Error in recoverUnconfirmedSeatAllocations: ${err?.message || err}`);
      return { recoveredBookingsCount: 0 };
    }
  }

  private generateCode(prefix: string): string {
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomChars}`;
  }
}
