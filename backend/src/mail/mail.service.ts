import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { EmailLog, EmailLogDocument, EmailLogStatus, EmailSetting, EmailSettingDocument } from './email-log.schema';
import {
  CancellationEmailData,
  ExpiredHoldEmailData,
  FlightDisruptionEmailData,
  HoldCancelledByCustomerEmailData,
  PasswordResetEmailData,
  RenderedEmail,
  UpcomingTripEmailData,
  renderCancellationEmail,
  renderExpiredHoldCancellationEmail,
  renderFlightDisruptionEmail,
  renderHoldCancelledByCustomer,
  renderPasswordResetCode,
  renderUpcomingTripReminder,
} from './mail-renderers';
import { MailTemplateKey } from './mail-templates';

// Re-export renderer types/helpers so existing imports from './mail.service' keep working.
export * from './mail-renderers';

export interface SendMailMeta {
  templateKey?: MailTemplateKey;
  bookingReference?: string;
}

/**
 * SMTP configuration is read from environment variables:
 *
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=airline@example.com
 *   SMTP_PASS=app-password-here
 *   MAIL_FROM="Airline Reservation System <airline@example.com>"
 *
 * If SMTP_HOST is not set, the service falls back to DEV mode:
 * email content is logged to the console with a [MAIL:DEV-FALLBACK]
 * prefix and the send resolves successfully so the app stays runnable
 * for demos without a real SMTP server.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    @Optional() @InjectModel(EmailLog.name) private readonly logModel?: Model<EmailLogDocument>,
    @Optional() @InjectModel(EmailSetting.name) private readonly settingModel?: Model<EmailSettingDocument>,
  ) {
    const host = process.env.SMTP_HOST;
    if (host) {
      const port = Number(process.env.SMTP_PORT || 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
      });
      this.logger.log(`SMTP transport configured for host ${host}:${port}`);
    } else {
      this.logger.warn('SMTP_HOST not configured. Emails will be logged to the console ([MAIL:DEV-FALLBACK]).');
    }
  }

  /**
   * Generic mail sender with bounded retry (up to 3 attempts).
   * Falls back to console logging when no SMTP host is configured.
   * Never throws, returns true on success, false on permanent failure.
   */
  async sendMail(to: string, subject: string, html: string, meta: SendMailMeta = {}): Promise<boolean> {
    const from = process.env.MAIL_FROM || 'Airline Reservation System <no-reply@airline.local>';

    if (!this.transporter) {
      // DEV fallback: log instead of sending, never crash the caller.
      this.logger.log(`[MAIL:DEV-FALLBACK] --------------------------------------------------`);
      this.logger.log(`[MAIL:DEV-FALLBACK] To:      ${to}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] From:    ${from}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] Subject: ${subject}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] Body:\n${html}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] --------------------------------------------------`);
      await this.recordLog(to, subject, 'DEV_FALLBACK', meta);
      return true;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transporter.sendMail({ from, to, subject, html });
        this.logger.log(`Email sent to ${to} (subject: ${subject}) on attempt ${attempt}`);
        await this.recordLog(to, subject, 'SENT', meta);
        return true;
      } catch (err: any) {
        this.logger.warn(
          `Attempt ${attempt}/${maxAttempts} failed to send email to ${to}: ${err?.message || err}`,
        );
        if (attempt < maxAttempts) {
          if (process.env.NODE_ENV !== 'test') {
            await new Promise((resolve) => setTimeout(resolve, attempt * 150));
          }
        } else {
          this.logger.error(`All ${maxAttempts} attempts to send email to ${to} failed.`);
          await this.recordLog(to, subject, 'FAILED', meta, err?.message || String(err));
          return false;
        }
      }
    }

    return false;
  }


  /** Persist one delivery attempt into `email_logs`. Never throws. */
  private async recordLog(
    to: string,
    subject: string,
    status: EmailLogStatus,
    meta: SendMailMeta,
    error?: string,
  ): Promise<void> {
    if (!this.logModel) return;
    try {
      await this.logModel.create({
        template_key: meta.templateKey || 'CUSTOM',
        to,
        subject,
        status,
        error,
        booking_reference: meta.bookingReference,
      });
    } catch (err: any) {
      this.logger.warn(`Could not write email log: ${err?.message || err}`);
    }
  }

  /** Templates are enabled by default; an `email_settings` row can disable one. */
  async isTemplateEnabled(key: MailTemplateKey): Promise<boolean> {
    if (!this.settingModel || key === 'CUSTOM') return true;
    try {
      const setting = await this.settingModel.findOne({ template_key: key }).lean().exec();
      return setting ? setting.enabled !== false : true;
    } catch {
      return true;
    }
  }

  /**
   * Send a rendered template honouring the per-template enable toggle.
   * A disabled template is skipped and reported as handled (true) so batch
   * jobs do not retry it every hour.
   */
  async sendTemplate(
    key: MailTemplateKey,
    to: string,
    rendered: RenderedEmail,
    bookingReference?: string,
  ): Promise<boolean> {
    if (!(await this.isTemplateEnabled(key))) {
      this.logger.warn(`Email template ${key} is disabled; skipping email to ${to}`);
      return true;
    }
    return this.sendMail(to, rendered.subject, rendered.html, { templateKey: key, bookingReference });
  }

  /**
   * Requirement 3.4.2.1: Reminder email sent 3 weeks before departure
   * for a ticket the user chose to block now. Body is pre-rendered by the
   * scheduler via renderBlockedTicketReminder().
   */
  async sendBlockedTicketReminder(toEmail: string, reminderBody: string, bookingReference?: string): Promise<boolean> {
    return this.sendTemplate(
      'BLOCKED_REMINDER',
      toEmail,
      { subject: 'Reminder: Your blocked ticket is awaiting confirmation', html: reminderBody },
      bookingReference,
    );
  }

  async sendPasswordResetCode(data: PasswordResetEmailData): Promise<boolean> {
    return this.sendTemplate('PASSWORD_RESET', data.toEmail, renderPasswordResetCode(data));
  }

  async sendUpcomingTripReminder(data: UpcomingTripEmailData): Promise<boolean> {
    return this.sendTemplate('UPCOMING_TRIP', data.toEmail, renderUpcomingTripReminder(data), data.bookingReference);
  }

  /** Cancellation notice email (Manual Blocked, Manual Confirmed, or Emergency Flight Cancellation). */
  async sendCancellationEmail(data: CancellationEmailData): Promise<boolean> {
    return this.sendTemplate('CANCELLATION', data.toEmail, renderCancellationEmail(data), data.bookingReference);
  }

  /** Customer cancelled their own unpaid HOLD/BLOCKED booking. */
  async sendHoldCancelledByCustomerEmail(data: HoldCancelledByCustomerEmailData): Promise<boolean> {
    return this.sendTemplate(
      'HOLD_CANCELLED_BY_CUSTOMER',
      data.toEmail,
      renderHoldCancelledByCustomer(data),
      data.bookingReference,
    );
  }

  /** Expired hold cancellation notification. */
  async sendExpiredHoldCancellationEmail(data: ExpiredHoldEmailData): Promise<boolean> {
    return this.sendTemplate('EXPIRED_HOLD', data.toEmail, renderExpiredHoldCancellationEmail(data), data.bookingReference);
  }

  /** Flight schedule disruption or recovery notification. */
  async sendFlightDisruptionEmail(data: FlightDisruptionEmailData): Promise<boolean> {
    return this.sendTemplate('FLIGHT_DISRUPTION', data.toEmail, renderFlightDisruptionEmail(data), data.bookingReference);
  }
}
