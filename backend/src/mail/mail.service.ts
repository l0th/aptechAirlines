import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

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

  constructor() {
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
   * Generic mail sender. Falls back to console logging when no SMTP
   * host is configured so it never throws for missing infrastructure.
   */
  async sendMail(to: string, subject: string, html: string): Promise<boolean> {
    const from = process.env.MAIL_FROM || 'Airline Reservation System <no-reply@airline.local>';

    if (!this.transporter) {
      // DEV fallback: log instead of sending, never crash the caller.
      this.logger.log(`[MAIL:DEV-FALLBACK] --------------------------------------------------`);
      this.logger.log(`[MAIL:DEV-FALLBACK] To:      ${to}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] From:    ${from}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] Subject: ${subject}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] Body:\n${html}`);
      this.logger.log(`[MAIL:DEV-FALLBACK] --------------------------------------------------`);
      return true;
    }

    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Email sent to ${to} (subject: ${subject})`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Requirement 3.4.2.1: Reminder email sent 3 weeks before departure
   * for a ticket the user chose to block now.
   */
  async sendBlockedTicketReminder(toEmail: string, reminderBody: string): Promise<boolean> {
    return this.sendMail(
      toEmail,
      'Reminder: Your blocked ticket is awaiting confirmation',
      reminderBody,
    );
  }
}
