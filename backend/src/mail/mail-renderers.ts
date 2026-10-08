import { renderLayout, highlightBox, infoBox } from './mail-layout';

export interface RenderedEmail {
  subject: string;
  html: string;
}

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

export interface RefundDetailItem {
  paymentMethod?: string;
  payment_method?: string;
  amountVnd: number;
  amount?: number;
  cardMasked?: string;
  card_masked?: string;
  providerAmount?: string | number;
  provider_amount?: string | number;
  providerCurrency?: string;
  provider_currency?: string;
  providerRefundId?: string;
  provider_refund_id?: string;
  status: string; // 'SUCCESS' | 'PENDING'
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
  refundDetails?: RefundDetailItem[];
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

export interface PasswordResetEmailData {
  toEmail: string;
  passengerName: string;
  code: string;
  expiresInMinutes: number;
}

export interface UpcomingTripEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  confirmationNumber?: string;
  departureTimeFormatted: string;
  itinerary: ItineraryLegData[];
}

/**
 * Cancellation notice email (Manual Blocked, Manual Confirmed, or Emergency Flight Cancellation).
 */
export function renderCancellationEmail(data: CancellationEmailData): RenderedEmail {
  const safeName = escapeHtml(data.passengerName);
  const safePnr = escapeHtml(data.bookingReference);
  const safeCan = escapeHtml(data.cancellationNumber);
  const currency = escapeHtml(data.currency || 'VND');

  let subject = `Booking Cancellation Notice - ${data.bookingReference}`;
  let typeDescription = '';
  let refundSection = '';

  const validCard = isValidMaskedCard(data.maskedCard);

  const formatRefundTargets = (): string => {
    if (data.refundDetails && data.refundDetails.length > 0) {
      return data.refundDetails
        .map((item) => {
          if (item.paymentMethod === 'PAYPAL') {
            const usdStr = item.providerAmount ? ` (${item.providerAmount} ${item.providerCurrency || 'USD'})` : '';
            if (item.status === 'SUCCESS') {
              return `Refund Target: <strong>PayPal Account${usdStr}</strong><br/>
                      <span style="color: #15803d; font-size: 13px;">Status: Completed (PayPal Refund ID: ${escapeHtml(item.providerRefundId || 'Processed')})</span>`;
            } else {
              return `Refund Target: <strong>PayPal Account${usdStr}</strong><br/>
                      <span style="color: #b45309; font-size: 13px; font-weight: bold;">Status: Processing</span> — Your refund has been initiated with PayPal and is currently awaiting gateway settlement.`;
            }
          } else {
            const cardStr = item.cardMasked || (validCard ? data.maskedCard : 'Credit Card on Profile');
            return `Refund Target: <strong>${escapeHtml(cardStr!)}</strong><br/>
                    <span style="color: #64748b; font-size: 13px;">This refund has been recorded by the reservation system.</span>`;
          }
        })
        .join('<br/><br/>');
    }
    return `${validCard ? `Refund Target: <strong>${escapeHtml(data.maskedCard)}</strong><br/>` : ''}
            <span style="color: #64748b; font-size: 13px;">This refund has been recorded by the reservation system.</span>`;
  };

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
              ${formatRefundTargets()}
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
            ${formatRefundTargets()}
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

  const html = renderLayout({
    title: 'Cancellation Confirmation',
    accent: '#0284c7',
    body: `
      <p>Dear ${safeName},</p>
      ${typeDescription}
      ${highlightBox(identifierRows)}
      ${itineraryHtml}
      ${refundSection}
      <p style="margin-top: 24px;">If you have any questions or wish to re-book, please contact our support team or visit our website.</p>`,
  });

  return { subject, html };
}

/**
 * Expired hold cancellation notification.
 */
export function renderExpiredHoldCancellationEmail(data: ExpiredHoldEmailData): RenderedEmail {
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

  const html = renderLayout({
    title: 'Reservation Expired',
    accent: '#e11d48',
    body: `
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
      <p>You are welcome to create a new reservation at any time on our website.</p>`,
  });

  return { subject, html };
}

/**
 * Flight schedule disruption or recovery notification.
 */
export function renderFlightDisruptionEmail(data: FlightDisruptionEmailData): RenderedEmail {
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

  const html = renderLayout({
    title: headerTitle,
    accent: headerColor,
    body: `
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
      <p>Thank you for choosing Aptech Airlines.</p>`,
  });

  return { subject, html };
}

export interface BlockedReminderLeg {
  flightNumber: string;
  origin?: string;
  destination?: string;
  departureTimeFormatted?: string;
  cabinClass?: string;
}

export interface BlockedReminderEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  earliestDepartureFormatted: string;
  deadlineFormatted: string;
  legs: BlockedReminderLeg[];
}

export interface HoldCancelledByCustomerEmailData {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  cancellationNumber: string;
  itinerary?: ItineraryLegData[];
}

function renderLegList(legs: ItineraryLegData[]): string {
  return legs
    .map(
      (leg) => `
      <div style="padding:12px 0;border-bottom:1px solid #e2e8f0">
        <strong>${escapeHtml(leg.flightNumber)}</strong> · ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}<br/>
        <span style="color:#64748b">Khởi hành: ${escapeHtml(leg.departureTimeFormatted)}${leg.cabinClass ? ` · ${escapeHtml(leg.cabinClass)}` : ''}</span>
      </div>`,
    )
    .join('');
}

/** Requirement 3.4.2.1: reminder for an unpaid HOLD/BLOCKED booking (≤ 21 days before departure). */
export function renderBlockedTicketReminder(data: BlockedReminderEmailData): RenderedEmail {
  const lines = data.legs
    .map((leg) =>
      leg.origin
        ? `<li>Flight ${escapeHtml(leg.flightNumber)}: ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}, ` +
          `departing ${escapeHtml(leg.departureTimeFormatted)} (${escapeHtml(leg.cabinClass)})</li>`
        : `<li>Flight ${escapeHtml(leg.flightNumber)} (${escapeHtml(leg.cabinClass)})</li>`,
    )
    .join('');
  const html = renderLayout({
    title: 'Nhắc thanh toán vé đang giữ chỗ',
    footer: 'Aptech Airlines • Thông báo giữ chỗ tự động • Vui lòng không trả lời trực tiếp email này.',
    body: `
          <p>Xin chào ${escapeHtml(data.passengerName)},</p>
          <p>Bạn đang có một vé <strong>giữ chỗ chưa thanh toán</strong>. Chuyến bay đầu tiên dự kiến khởi hành vào <strong>${escapeHtml(data.earliestDepartureFormatted)}</strong>.</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            <div><strong>Mã giữ chỗ:</strong> ${escapeHtml(data.blockingNumber || '-')}</div>
            <div><strong>Payment deadline:</strong> ${escapeHtml(data.deadlineFormatted)}<br/><span style="color:#64748b;font-size:12px">Hạn xác nhận &amp; thanh toán</span></div>`)}
          <p><strong>Hành trình:</strong></p><ul>${lines}</ul>
          <p>Vui lòng xác nhận vé trước hạn. Nếu quá hạn, hệ thống sẽ tự động hủy giữ chỗ và hoàn ghế về kho.</p>`,
  });
  return { subject: 'Reminder: Your blocked ticket is awaiting confirmation', html };
}

export function renderPasswordResetCode(data: PasswordResetEmailData): RenderedEmail {
  const html = renderLayout({
    title: 'Mã xác nhận đặt lại mật khẩu',
    footer: 'Aptech Airlines • Email tự động • Không chia sẻ mã xác nhận cho người khác.',
    body: `
          <p>Xin chào ${escapeHtml(data.passengerName)},</p>
          <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Aptech Airlines. Nhập mã sau tại màn hình đặt lại mật khẩu:</p>
          <div style="margin:22px 0;padding:18px;text-align:center;background:#fff7df;border:1px solid #efd783;border-radius:12px;font-size:32px;font-weight:900;letter-spacing:.18em;color:#071b2e">${escapeHtml(data.code)}</div>
          <p>Mã có hiệu lực trong <strong>${Number(data.expiresInMinutes) || 0} phút</strong>. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p>`,
  });
  return { subject: 'Aptech Airlines - Mã đặt lại mật khẩu', html };
}

export function renderUpcomingTripReminder(data: UpcomingTripEmailData): RenderedEmail {
  const html = renderLayout({
    title: 'Chuyến bay của bạn sắp khởi hành',
    footer: 'Aptech Airlines • Thông báo hành trình tự động • Vui lòng không trả lời trực tiếp email này.',
    body: `
          <p>Xin chào ${escapeHtml(data.passengerName)},</p>
          <p>Đây là email nhắc lịch cho hành trình đã xác nhận. Chuyến bay đầu tiên dự kiến khởi hành vào <strong>${escapeHtml(data.departureTimeFormatted)}</strong>.</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            ${data.confirmationNumber ? `<div><strong>Mã xác nhận:</strong> ${escapeHtml(data.confirmationNumber)}</div>` : ''}`)}
          ${renderLegList(data.itinerary)}
          <p style="margin-top:20px">Vui lòng kiểm tra giấy tờ tùy thân, hành lý và có mặt tại sân bay đúng giờ. Bạn có thể vào mục Chuyến đi để xem trạng thái mới nhất.</p>`,
  });
  return { subject: `Aptech Airlines - Nhắc lịch chuyến bay ${data.bookingReference}`, html };
}

/** Customer voluntarily cancels their own unpaid HOLD/BLOCKED booking. */
export function renderHoldCancelledByCustomer(data: HoldCancelledByCustomerEmailData): RenderedEmail {
  const html = renderLayout({
    title: 'Đã hủy giữ chỗ theo yêu cầu',
    accent: '#0284c7',
    footer: 'Aptech Airlines • Thông báo giữ chỗ tự động • Vui lòng không trả lời trực tiếp email này.',
    body: `
          <p>Xin chào ${escapeHtml(data.passengerName)},</p>
          <p>Chúng tôi xác nhận bạn đã <strong>hủy vé giữ chỗ</strong> theo yêu cầu. Vì đây là vé giữ chỗ chưa thanh toán nên <strong>không phát sinh phí</strong> và không có khoản hoàn tiền nào.</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            <div><strong>Mã giữ chỗ:</strong> ${escapeHtml(data.blockingNumber || '-')}</div>
            <div><strong>Mã hủy:</strong> <span style="color:#0284c7;font-weight:bold">${escapeHtml(data.cancellationNumber)}</span></div>`)}
          ${data.itinerary && data.itinerary.length ? `<p><strong>Hành trình đã hủy:</strong></p>${renderLegList(data.itinerary)}` : ''}
          ${infoBox('Ghế đã được hoàn về kho. Bạn có thể đặt hành trình mới bất cứ lúc nào trên website Aptech Airlines.')}`,
  });
  return { subject: `Aptech Airlines - Đã hủy giữ chỗ ${data.bookingReference}`, html };
}
