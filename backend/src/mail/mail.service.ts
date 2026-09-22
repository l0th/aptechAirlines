import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * HTML sanitization helper to prevent injection in dynamic email bodies.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates whether a masked card string represents a genuine card destination
 * and filters out application placeholder tokens.
 */
export function isValidMaskedCard(card?: string | null): boolean {
  if (!card || typeof card !== 'string') return false;
  const trimmed = card.trim();
  if (!trimmed) return false;
  const placeholders = new Set([
    'AUTO-REFUND-FLIGHT-CANCELLED',
    'ORIGINAL-PAYMENT-CARD',
    'SAVED-CARD',
    'CARD-DEFAULT',
    'UNKNOWN',
    'ORIGINAL PAYMENT METHOD',
    'ORIGINAL PAYMENT CARD',
  ]);
  if (placeholders.has(trimmed.toUpperCase())) return false;
  // Disallow any characters other than digits, *, space, and hyphen
  if (/[^0-9*\s-]/.test(trimmed)) return false;
  // Strip spaces and hyphens
  const stripped = trimmed.replace(/[\s-]/g, '');
  // Standard PAN length range (allows 8 to 19 characters, e.g. ****1234 or full-length PAN masks)
  if (stripped.length < 8 || stripped.length > 19) return false;
  // Must have at most 6 leading digits, at least one '*', and exactly 4 trailing digits
  // (enforces no more than first 6 plus last 4 visible digits, rejects raw PANs)
  return /^(\d{0,6})(\*+)(\d{4})$/.test(stripped);
}

export interface ItineraryLegData {
  flightNumber: string;
  origin: string;
  destination: string;
  cabinClass?: string;
  departureTimeFormatted: string;
  arrivalTimeFormatted?: string;
  isAffected?: boolean;
}

export interface CancellationEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string; // PNR
  blockingNumber?: string;
  confirmationNumber?: string;
  cancellationNumber: string;
  cancellationType: 'MANUAL_BLOCKED' | 'MANUAL_CONFIRMED' | 'EMERGENCY_FLIGHT_CANCELLED';
  originalBookingStatus: 'BLOCKED' | 'CONFIRMED';
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departureTimeFormatted?: string;
  itinerary?: ItineraryLegData[];
  refundAmount?: number;
  refundPercentage?: number;
  currency?: string;
  maskedCard?: string;
  policyDeduction?: number;
  reason?: string;
}

export interface ExpiredHoldEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  cancellationNumber: string;
  holdDeadlineFormatted: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departureTimeFormatted?: string;
  itinerary?: ItineraryLegData[];
}

export interface FlightDisruptionEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  flightNumber: string;
  origin: string;
  destination: string;
  disruptionType: 'DELAY' | 'SCHEDULE_CHANGE' | 'RECOVERY';
  originalDepartureFormatted: string;
  newDepartureFormatted?: string;
  originalArrivalFormatted: string;
  newArrivalFormatted?: string;
  delayReason?: string;
  statusText: string;
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
   * Generic mail sender with bounded retry (up to 3 attempts).
   * Falls back to console logging when no SMTP host is configured.
   * Never throws, returns true on success, false on permanent failure.
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

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transporter.sendMail({ from, to, subject, html });
        this.logger.log(`Email sent to ${to} (subject: ${subject}) on attempt ${attempt}`);
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
          return false;
        }
      }
    }

    return false;
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

  /**
   * Cancellation notice email (Manual Blocked, Manual Confirmed, or Emergency Flight Cancellation).
   */
  async sendCancellationEmail(data: CancellationEmailData): Promise<boolean> {
    const safeName = escapeHtml(data.passengerName);
    const safePnr = escapeHtml(data.bookingReference);
    const safeCan = escapeHtml(data.cancellationNumber);
    const currency = escapeHtml(data.currency || 'VND');

    let subject = `Booking Cancellation Notice - ${data.bookingReference}`;
    let typeDescription = '';
    let refundSection = '';

    const validCard = isValidMaskedCard(data.maskedCard);

    if (data.cancellationType === 'EMERGENCY_FLIGHT_CANCELLED') {
      subject = `Important: Flight ${data.flightNumber || ''} Cancelled - Booking ${data.bookingReference}`;
      const isConfirmed = data.originalBookingStatus === 'CONFIRMED';

      if (isConfirmed) {
        typeDescription = `
          <p style="color: #b91c1c; font-weight: bold;">
            We regret to inform you that your flight ${escapeHtml(data.flightNumber)} has been cancelled by airline operations.
          </p>
          ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
        `;
        const refundAmt = data.refundAmount ?? 0;
        if (refundAmt > 0) {
          refundSection = `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin: 16px 0;">
              <p style="margin: 0; color: #15803d; font-weight: bold;">100% Refund Recorded</p>
              <p style="margin: 4px 0 0 0;">
                Refund Amount: <strong>${refundAmt.toLocaleString('vi-VN')} ${currency}</strong><br/>
                ${validCard ? `Refund Target: <strong>${escapeHtml(data.maskedCard)}</strong><br/>` : ''}
                <span style="color: #64748b; font-size: 13px;">This refund has been recorded by the reservation system.</span>
              </p>
            </div>
          `;
        } else {
          refundSection = `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
              <p style="margin: 0; font-weight: bold;">Booking Cancellation Summary</p>
              <p style="margin: 4px 0 0 0;">
                This confirmed booking has been cancelled due to flight cancellation.<br/>
                Refund Percentage: <strong>100%</strong><br/>
                Refund Amount: <strong>0 ${currency}</strong><br/>
                <span style="color: #64748b; font-size: 13px;">No monetary refund transaction was required as the total paid amount was 0 ${currency}.</span>
              </p>
            </div>
          `;
        }
      } else {
        typeDescription = `
          <p style="color: #b91c1c; font-weight: bold;">
            We regret to inform you that your hold reservation for flight ${escapeHtml(data.flightNumber)} has been cancelled by airline operations.
          </p>
          ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
        `;
        refundSection = `
          <p style="color: #64748b;">This was an unconfirmed hold reservation. No payment was collected and refund amount is 0 ${currency}.</p>
        `;
      }
    } else if (data.cancellationType === 'MANUAL_CONFIRMED') {
      typeDescription = `
        <p>Your confirmed booking reservation has been successfully cancelled per your request.</p>
      `;
      const refundAmt = data.refundAmount ?? 0;
      const refundPct = data.refundPercentage ?? 0;
      if (refundAmt > 0) {
        refundSection = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">Refund Summary</p>
            <p style="margin: 4px 0 0 0;">
              ${data.refundPercentage !== undefined ? `Refund Percentage: <strong>${data.refundPercentage}%</strong><br/>` : ''}
              Refund Amount: <strong>${refundAmt.toLocaleString('vi-VN')} ${currency}</strong><br/>
              ${data.policyDeduction !== undefined ? `Cancellation Fee: <strong>${data.policyDeduction}%</strong><br/>` : ''}
              ${validCard ? `Refund Target: <strong>${escapeHtml(data.maskedCard)}</strong><br/>` : ''}
              <span style="color: #64748b; font-size: 13px;">This refund has been recorded by the reservation system.</span>
            </p>
          </div>
        `;
      } else if (refundPct > 0) {
        refundSection = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">Refund Summary</p>
            <p style="margin: 4px 0 0 0;">
              Refund Percentage: <strong>${refundPct}%</strong><br/>
              Refund Amount: <strong>0 ${currency}</strong><br/>
              ${data.policyDeduction !== undefined ? `Cancellation Fee: <strong>${data.policyDeduction}%</strong><br/>` : ''}
              <span style="color: #64748b; font-size: 13px;">A ${refundPct}% refund rate applies, but the refundable monetary amount is 0 ${currency}. No monetary refund transaction was required.</span>
            </p>
          </div>
        `;
      } else {
        refundSection = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">Refund Summary</p>
            <p style="margin: 4px 0 0 0;">
              Refund Percentage: <strong>0%</strong><br/>
              Refund Amount: <strong>0 ${currency}</strong><br/>
              ${data.policyDeduction !== undefined ? `Cancellation Fee: <strong>${data.policyDeduction}%</strong><br/>` : ''}
              <span style="color: #64748b; font-size: 13px;">No refund is due under the applicable cancellation policy.</span>
            </p>
          </div>
        `;
      }
    } else {
      // MANUAL_BLOCKED
      typeDescription = `
        <p>Your hold reservation has been successfully cancelled per your request.</p>
      `;
      refundSection = `
        <p style="color: #64748b;">This was a blocked (unpaid) reservation. No charges were made, and refund amount is 0 ${currency}.</p>
      `;
    }

    // Identifiers box: only render existing values (Finding 1)
    let identifierRows = `<p style="margin: 0;"><strong>Booking Reference (PNR):</strong> ${safePnr}</p>`;
    if (data.blockingNumber) {
      identifierRows += `<p style="margin: 4px 0 0 0;"><strong>Blocking Number:</strong> ${escapeHtml(data.blockingNumber)}</p>`;
    }
    if (data.confirmationNumber) {
      identifierRows += `<p style="margin: 4px 0 0 0;"><strong>Confirmation Number:</strong> ${escapeHtml(data.confirmationNumber)}</p>`;
    }
    identifierRows += `<p style="margin: 4px 0 0 0;"><strong>Cancellation Number:</strong> <span style="color: #0284c7; font-weight: bold;">${safeCan}</span></p>`;

    // Itinerary section: multi-leg structured summary (Finding 6)
    let itineraryHtml = '';
    if (data.itinerary && data.itinerary.length > 0) {
      itineraryHtml = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; font-weight: bold;">Itinerary Details:</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${data.itinerary
              .map((leg) => {
                const affectedBadge = leg.isAffected
                  ? ` <span style="color: #b91c1c; font-weight: bold;">[CANCELLED FLIGHT]</span>`
                  : '';
                const cabin = leg.cabinClass ? ` (${escapeHtml(leg.cabinClass)})` : '';
                const arr = leg.arrivalTimeFormatted ? ` → Arrival: ${escapeHtml(leg.arrivalTimeFormatted)}` : '';
                return `<li style="margin-bottom: 4px;">Flight <strong>${escapeHtml(leg.flightNumber)}</strong>: ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}, Departure: ${escapeHtml(leg.departureTimeFormatted)}${arr}${cabin}${affectedBadge}</li>`;
              })
              .join('')}
          </ul>
        </div>
      `;
    } else if (data.flightNumber) {
      itineraryHtml = `<p><strong>Flight:</strong> ${escapeHtml(data.flightNumber)} (${escapeHtml(data.origin || '')} → ${escapeHtml(data.destination || '')})<br/>
         ${data.departureTimeFormatted ? `<strong>Scheduled Departure:</strong> ${escapeHtml(data.departureTimeFormatted)}<br/>` : ''}</p>`;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.5;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 8px;">Aptech Airlines - Cancellation Confirmation</h2>
        <p>Dear ${safeName},</p>
        ${typeDescription}
        <div style="background: #f1f5f9; padding: 12px; border-radius: 6px; margin: 16px 0;">
          ${identifierRows}
        </div>
        ${itineraryHtml}
        ${refundSection}
        <p style="margin-top: 24px;">If you have any questions or wish to re-book, please contact our support team or visit our website.</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Aptech Airlines • Automated Service Notification • Please do not reply directly to this email.
        </p>
      </div>
    `;

    return this.sendMail(data.toEmail, subject, html);
  }

  /**
   * Expired hold cancellation notification.
   */
  async sendExpiredHoldCancellationEmail(data: ExpiredHoldEmailData): Promise<boolean> {
    const safeName = escapeHtml(data.passengerName);
    const safePnr = escapeHtml(data.bookingReference);
    const safeBlk = escapeHtml(data.blockingNumber || '-');
    const safeCan = escapeHtml(data.cancellationNumber);
    const safeDeadline = escapeHtml(data.holdDeadlineFormatted);

    const subject = `Hold Period Expired - Booking ${data.bookingReference} Cancelled`;

    // Itinerary section: multi-leg structured summary (Finding 6)
    let itineraryHtml = '';
    if (data.itinerary && data.itinerary.length > 0) {
      itineraryHtml = `
        <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 12px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; font-weight: bold; color: #9f1239;">Released Itinerary Legs:</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${data.itinerary
              .map((leg) => {
                const cabin = leg.cabinClass ? ` (${escapeHtml(leg.cabinClass)})` : '';
                const arr = leg.arrivalTimeFormatted ? ` → Arrival: ${escapeHtml(leg.arrivalTimeFormatted)}` : '';
                return `<li style="margin-bottom: 4px;">Flight <strong>${escapeHtml(leg.flightNumber)}</strong>: ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}, Departure: ${escapeHtml(leg.departureTimeFormatted)}${arr}${cabin}</li>`;
              })
              .join('')}
          </ul>
        </div>
      `;
    } else if (data.flightNumber) {
      itineraryHtml = `<p><strong>Flight:</strong> ${escapeHtml(data.flightNumber)} (${escapeHtml(data.origin || '')} → ${escapeHtml(data.destination || '')})<br/>
         ${data.departureTimeFormatted ? `<strong>Scheduled Departure:</strong> ${escapeHtml(data.departureTimeFormatted)}<br/>` : ''}</p>`;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.5;">
        <h2 style="color: #0f172a; border-bottom: 2px solid #e11d48; padding-bottom: 8px;">Aptech Airlines - Reservation Expired</h2>
        <p>Dear ${safeName},</p>
        <p>
          Your hold reservation has reached its payment deadline (<strong>${safeDeadline}</strong>) without confirmation.
          In accordance with our booking policy, the temporary hold has now expired, and the reservation has been cancelled.
        </p>
        <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 12px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Booking Reference (PNR):</strong> ${safePnr}</p>
          <p style="margin: 4px 0 0 0;"><strong>Blocking Number:</strong> ${safeBlk}</p>
          <p style="margin: 4px 0 0 0;"><strong>Cancellation Number:</strong> <span style="color: #e11d48; font-weight: bold;">${safeCan}</span></p>
        </div>
        ${itineraryHtml}
        <p>All reserved seats have been returned to inventory and made available to other travelers. No charges have been made to your account.</p>
        <p>You are welcome to create a new reservation at any time on our website.</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Aptech Airlines • Automated Service Notification • Please do not reply directly to this email.
        </p>
      </div>
    `;

    return this.sendMail(data.toEmail, subject, html);
  }

  /**
   * Flight schedule disruption or recovery notification.
   */
  async sendFlightDisruptionEmail(data: FlightDisruptionEmailData): Promise<boolean> {
    const safeName = escapeHtml(data.passengerName);
    const safePnr = escapeHtml(data.bookingReference);
    const safeFlight = escapeHtml(data.flightNumber);
    const safeOrigin = escapeHtml(data.origin);
    const safeDest = escapeHtml(data.destination);

    let subject = `Important: Schedule Change for Flight ${data.flightNumber}`;
    let headerTitle = 'Flight Schedule Update';
    let headerColor = '#d97706';
    let statusText = escapeHtml(data.statusText);
    let introMessage = '';

    if (data.disruptionType === 'DELAY') {
      subject = `Schedule Update: Flight ${data.flightNumber} Delayed`;
      headerTitle = 'Flight Delay Notice';
      headerColor = '#ea580c';
      statusText = escapeHtml(data.statusText);
      introMessage = `
        <p>
          We are writing to inform you that your upcoming flight <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) has been <strong>DELAYED</strong>.
        </p>
      `;
    } else if (data.disruptionType === 'RECOVERY') {
      subject = `Flight Update: Flight ${data.flightNumber} On Schedule`;
      headerTitle = 'Flight Schedule Restored';
      headerColor = '#16a34a';
      statusText = escapeHtml(data.statusText);
      introMessage = `
        <p>
          We are pleased to inform you that operational disruptions affecting flight <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) have been resolved, and the flight status is now <strong>SCHEDULED</strong>.
        </p>
      `;
    } else {
      introMessage = `
        <p>
          We are writing to inform you of a schedule change affecting your upcoming flight
          <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}).
        </p>
      `;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.5;">
        <h2 style="color: ${headerColor}; border-bottom: 2px solid ${headerColor}; padding-bottom: 8px;">${headerTitle}</h2>
        <p>Dear ${safeName},</p>
        ${introMessage}
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Booking Reference (PNR):</strong> ${safePnr}</p>
          <p style="margin: 4px 0 0 0;"><strong>Flight:</strong> ${safeFlight}</p>
          <p style="margin: 4px 0 0 0;"><strong>Flight Status:</strong> <span style="font-weight: bold; color: ${headerColor};">${statusText}</span></p>
          ${data.delayReason ? `<p style="margin: 4px 0 0 0;"><strong>Reason:</strong> ${escapeHtml(data.delayReason)}</p>` : ''}
        </div>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Event</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Original Time</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Updated Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Departure (${safeOrigin})</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(data.originalDepartureFormatted)}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; color: #b45309; font-weight: bold;">
                ${escapeHtml(data.newDepartureFormatted || data.originalDepartureFormatted)}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Arrival (${safeDest})</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(data.originalArrivalFormatted)}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; color: #b45309; font-weight: bold;">
                ${escapeHtml(data.newArrivalFormatted || data.originalArrivalFormatted)}
              </td>
            </tr>
          </tbody>
        </table>
        <p>Please use Track Booking to check the latest flight status and trip details.</p>
        <p>Thank you for choosing Aptech Airlines.</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          Aptech Airlines • Automated Service Notification • Please do not reply directly to this email.
        </p>
      </div>
    `;

    return this.sendMail(data.toEmail, subject, html);
  }
}
