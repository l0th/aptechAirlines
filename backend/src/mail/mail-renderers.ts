import { renderLayout, highlightBox, infoBox } from './mail-layout';
import { MailLang, cabinLabel, flightStatusLabel, formatAmount, pick } from './mail-i18n';

export type { MailLang } from './mail-i18n';

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

/** Every email payload may carry the recipient's language. Defaults to Vietnamese. */
export interface MailLangOption {
  lang?: MailLang;
}

function langOf(data: MailLangOption | undefined): MailLang {
  return data?.lang === 'en' ? 'en' : 'vi';
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

export interface CancellationEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  bookingReference: string; // PNR
  blockingNumber?: string;
  confirmationNumber?: string;
  cancellationNumber: string;
  cancellationType: 'MANUAL_BLOCKED' | 'MANUAL_CONFIRMED' | 'EMERGENCY_FLIGHT_CANCELLED';
  originalBookingStatus: 'BLOCKED' | 'CONFIRMED' | 'RESCHEDULED';
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

export interface ExpiredHoldEmailData extends MailLangOption {
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

export interface FlightDisruptionEmailData extends MailLangOption {
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

export interface PasswordResetEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  code: string;
  expiresInMinutes: number;
}

export interface UpcomingTripEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  confirmationNumber?: string;
  departureTimeFormatted: string;
  itinerary: ItineraryLegData[];
}

/** Bulleted itinerary list (shared by cancellation / expired-hold emails). */
function renderItineraryBullets(lang: MailLang, legs: ItineraryLegData[], showAffected: boolean): string {
  return legs
    .map((leg) => {
      const affectedBadge =
        showAffected && leg.isAffected
          ? ` <span style="color: #b91c1c; font-weight: bold;">${pick(lang, '[CHUYẾN BỊ HỦY]', '[CANCELLED FLIGHT]')}</span>`
          : '';
      const cabin = leg.cabinClass ? ` (${escapeHtml(cabinLabel(lang, leg.cabinClass))})` : '';
      const arr = leg.arrivalTimeFormatted
        ? ` → ${pick(lang, 'Đến', 'Arrival')}: ${escapeHtml(leg.arrivalTimeFormatted)}`
        : '';
      return `<li style="margin-bottom: 4px;">${pick(lang, 'Chuyến bay', 'Flight')} <strong>${escapeHtml(leg.flightNumber)}</strong>: ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}, ${pick(lang, 'Khởi hành', 'Departure')}: ${escapeHtml(leg.departureTimeFormatted)}${arr}${cabin}${affectedBadge}</li>`;
    })
    .join('');
}

/** Single-flight fallback when no structured itinerary is available. */
function renderSingleFlight(
  lang: MailLang,
  data: { flightNumber?: string; origin?: string; destination?: string; departureTimeFormatted?: string },
): string {
  return `<p><strong>${pick(lang, 'Chuyến bay', 'Flight')}:</strong> ${escapeHtml(data.flightNumber)} (${escapeHtml(data.origin || '')} → ${escapeHtml(data.destination || '')})<br/>
       ${data.departureTimeFormatted ? `<strong>${pick(lang, 'Giờ khởi hành dự kiến', 'Scheduled Departure')}:</strong> ${escapeHtml(data.departureTimeFormatted)}<br/>` : ''}</p>`;
}

/**
 * Cancellation notice email (Manual Blocked, Manual Confirmed, or Emergency Flight Cancellation).
 */
export function renderCancellationEmail(data: CancellationEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const safeName = escapeHtml(data.passengerName);
  const safePnr = escapeHtml(data.bookingReference);
  const safeCan = escapeHtml(data.cancellationNumber);
  const currency = escapeHtml(data.currency || 'VND');

  let subject = t(
    `Aptech Airlines - Thông báo hủy đặt chỗ ${data.bookingReference}`,
    `Booking Cancellation Notice - ${data.bookingReference}`,
  );
  let typeDescription = '';
  let refundSection = '';

  const validCard = isValidMaskedCard(data.maskedCard);
  const recordedNote = `<span style="color: #64748b; font-size: 13px;">${t(
    'Khoản hoàn tiền này đã được hệ thống đặt chỗ ghi nhận.',
    'This refund has been recorded by the reservation system.',
  )}</span>`;

  const formatRefundTargets = (): string => {
    if (data.refundDetails && data.refundDetails.length > 0) {
      return data.refundDetails
        .map((item) => {
          if (item.paymentMethod === 'PAYPAL') {
            const usdStr = item.providerAmount ? ` (${item.providerAmount} ${item.providerCurrency || 'USD'})` : '';
            if (item.status === 'SUCCESS') {
              return `${t('Hoàn về', 'Refund Target')}: <strong>${t('Tài khoản PayPal', 'PayPal Account')}${usdStr}</strong><br/>
                      <span style="color: #15803d; font-size: 13px;">${t('Trạng thái: Hoàn tất', 'Status: Completed')} (${t('Mã hoàn tiền PayPal', 'PayPal Refund ID')}: ${escapeHtml(item.providerRefundId || t('Đã xử lý', 'Processed'))})</span>`;
            }
            if (item.status === 'FAILED') {
              return `${t('Hoàn về', 'Refund Target')}: <strong>${t('Tài khoản PayPal', 'PayPal Account')}${usdStr}</strong><br/>
                      <span style="color: #b91c1c; font-size: 13px; font-weight: bold;">${t('Trạng thái: Cần hỗ trợ', 'Status: Needs assistance')}</span> — ${t(
                        'Yêu cầu hoàn tiền gặp lỗi. Vui lòng liên hệ bộ phận hỗ trợ và cung cấp mã đặt chỗ; không cần hủy vé lần nữa.',
                        'The refund encountered an error. Please contact support with your booking reference; do not cancel again.',
                      )}`;
            }
            return `${t('Hoàn về', 'Refund Target')}: <strong>${t('Tài khoản PayPal', 'PayPal Account')}${usdStr}</strong><br/>
                      <span style="color: #b45309; font-size: 13px; font-weight: bold;">${t('Trạng thái: Đang xử lý', 'Status: Processing')}</span> — ${t(
                        'Khoản hoàn tiền đang chờ PayPal xác nhận. Hệ thống sẽ tiếp tục kiểm tra tự động.',
                        'The refund is awaiting PayPal confirmation. The system will continue checking automatically.',
                      )}`;
          }
          const cardStr = item.cardMasked || (validCard ? data.maskedCard : t('Thẻ đã lưu trong hồ sơ', 'Credit Card on Profile'));
          return `${t('Hoàn về', 'Refund Target')}: <strong>${escapeHtml(cardStr!)}</strong><br/>
                    ${recordedNote}`;
        })
        .join('<br/><br/>');
    }
    return `${validCard ? `${t('Hoàn về', 'Refund Target')}: <strong>${escapeHtml(data.maskedCard)}</strong><br/>` : ''}
            ${recordedNote}`;
  };

  const feeLine =
    data.policyDeduction !== undefined
      ? `${t('Phí hủy', 'Cancellation Fee')}: <strong>${data.policyDeduction}%</strong><br/>`
      : '';

  if (data.cancellationType === 'EMERGENCY_FLIGHT_CANCELLED') {
    subject = t(
      `Quan trọng: Chuyến bay ${data.flightNumber || ''} đã bị hủy - Đặt chỗ ${data.bookingReference}`,
      `Important: Flight ${data.flightNumber || ''} Cancelled - Booking ${data.bookingReference}`,
    );
    const isConfirmed = data.originalBookingStatus === 'CONFIRMED' || data.originalBookingStatus === 'RESCHEDULED';
    const reasonLine = data.reason
      ? `<p><strong>${t('Lý do', 'Reason')}:</strong> ${escapeHtml(data.reason)}</p>`
      : '';

    if (isConfirmed) {
      typeDescription = `
        <p style="color: #b91c1c; font-weight: bold;">
          ${t(
            `Chúng tôi rất tiếc phải thông báo chuyến bay ${escapeHtml(data.flightNumber)} của bạn đã bị hãng hủy do điều hành khai thác.`,
            `We regret to inform you that your flight ${escapeHtml(data.flightNumber)} has been cancelled by airline operations.`,
          )}
        </p>
        ${reasonLine}
      `;
      const refundAmt = data.refundAmount ?? 0;
      if (refundAmt > 0) {
        refundSection = `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; color: #15803d; font-weight: bold;">${t('Đã ghi nhận hoàn tiền 100%', '100% Refund Recorded')}</p>
            <p style="margin: 4px 0 0 0;">
              ${t('Số tiền hoàn', 'Refund Amount')}: <strong>${formatAmount(lang, refundAmt)} ${currency}</strong><br/>
              ${formatRefundTargets()}
            </p>
          </div>
        `;
      } else {
        refundSection = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">${t('Tóm tắt hủy đặt chỗ', 'Booking Cancellation Summary')}</p>
            <p style="margin: 4px 0 0 0;">
              ${t('Đặt chỗ đã xác nhận này bị hủy do chuyến bay bị hủy.', 'This confirmed booking has been cancelled due to flight cancellation.')}<br/>
              ${t('Tỷ lệ hoàn tiền', 'Refund Percentage')}: <strong>100%</strong><br/>
              ${t('Số tiền hoàn', 'Refund Amount')}: <strong>0 ${currency}</strong><br/>
              <span style="color: #64748b; font-size: 13px;">${t(
                `Không cần giao dịch hoàn tiền vì tổng số tiền đã thanh toán là 0 ${currency}.`,
                `No monetary refund transaction was required as the total paid amount was 0 ${currency}.`,
              )}</span>
            </p>
          </div>
        `;
      }
    } else {
      typeDescription = `
        <p style="color: #b91c1c; font-weight: bold;">
          ${t(
            `Chúng tôi rất tiếc phải thông báo vé giữ chỗ của bạn trên chuyến bay ${escapeHtml(data.flightNumber)} đã bị hãng hủy do điều hành khai thác.`,
            `We regret to inform you that your hold reservation for flight ${escapeHtml(data.flightNumber)} has been cancelled by airline operations.`,
          )}
        </p>
        ${reasonLine}
      `;
      refundSection = `
        <p style="color: #64748b;">${t(
          `Đây là vé giữ chỗ chưa xác nhận. Chưa có khoản thanh toán nào và số tiền hoàn là 0 ${currency}.`,
          `This was an unconfirmed hold reservation. No payment was collected and refund amount is 0 ${currency}.`,
        )}</p>
      `;
    }
  } else if (data.cancellationType === 'MANUAL_CONFIRMED') {
    typeDescription = `
      <p>${t(
        'Đặt chỗ đã xác nhận của bạn đã được hủy thành công theo yêu cầu.',
        'Your confirmed booking reservation has been successfully cancelled per your request.',
      )}</p>
    `;
    const refundAmt = data.refundAmount ?? 0;
    const refundPct = data.refundPercentage ?? 0;
    const summaryTitle = `<p style="margin: 0; font-weight: bold;">${t('Tóm tắt hoàn tiền', 'Refund Summary')}</p>`;
    if (refundAmt > 0) {
      refundSection = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
          ${summaryTitle}
          <p style="margin: 4px 0 0 0;">
            ${data.refundPercentage !== undefined ? `${t('Tỷ lệ hoàn tiền', 'Refund Percentage')}: <strong>${data.refundPercentage}%</strong><br/>` : ''}
            ${t('Số tiền hoàn', 'Refund Amount')}: <strong>${formatAmount(lang, refundAmt)} ${currency}</strong><br/>
            ${feeLine}
            ${formatRefundTargets()}
          </p>
        </div>
      `;
    } else if (refundPct > 0) {
      refundSection = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
          ${summaryTitle}
          <p style="margin: 4px 0 0 0;">
            ${t('Tỷ lệ hoàn tiền', 'Refund Percentage')}: <strong>${refundPct}%</strong><br/>
            ${t('Số tiền hoàn', 'Refund Amount')}: <strong>0 ${currency}</strong><br/>
            ${feeLine}
            <span style="color: #64748b; font-size: 13px;">${t(
              `Áp dụng tỷ lệ hoàn ${refundPct}%, nhưng số tiền được hoàn là 0 ${currency}. Không cần giao dịch hoàn tiền.`,
              `A ${refundPct}% refund rate applies, but the refundable monetary amount is 0 ${currency}. No monetary refund transaction was required.`,
            )}</span>
          </p>
        </div>
      `;
    } else {
      refundSection = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
          ${summaryTitle}
          <p style="margin: 4px 0 0 0;">
            ${t('Tỷ lệ hoàn tiền', 'Refund Percentage')}: <strong>0%</strong><br/>
            ${t('Số tiền hoàn', 'Refund Amount')}: <strong>0 ${currency}</strong><br/>
            ${feeLine}
            <span style="color: #64748b; font-size: 13px;">${t(
              'Theo chính sách hủy vé hiện hành, đặt chỗ này không được hoàn tiền.',
              'No refund is due under the applicable cancellation policy.',
            )}</span>
          </p>
        </div>
      `;
    }
  } else {
    // MANUAL_BLOCKED
    typeDescription = `
      <p>${t(
        'Vé giữ chỗ của bạn đã được hủy thành công theo yêu cầu.',
        'Your hold reservation has been successfully cancelled per your request.',
      )}</p>
    `;
    refundSection = `
      <p style="color: #64748b;">${t(
        `Đây là vé giữ chỗ (chưa thanh toán). Không phát sinh phí và số tiền hoàn là 0 ${currency}.`,
        `This was a blocked (unpaid) reservation. No charges were made, and refund amount is 0 ${currency}.`,
      )}</p>
    `;
  }

  // Identifiers box: only render existing values
  let identifierRows = `<p style="margin: 0;"><strong>${t('Mã đặt chỗ (PNR)', 'Booking Reference (PNR)')}:</strong> ${safePnr}</p>`;
  if (data.blockingNumber) {
    identifierRows += `<p style="margin: 4px 0 0 0;"><strong>${t('Mã giữ chỗ', 'Blocking Number')}:</strong> ${escapeHtml(data.blockingNumber)}</p>`;
  }
  if (data.confirmationNumber) {
    identifierRows += `<p style="margin: 4px 0 0 0;"><strong>${t('Mã xác nhận', 'Confirmation Number')}:</strong> ${escapeHtml(data.confirmationNumber)}</p>`;
  }
  identifierRows += `<p style="margin: 4px 0 0 0;"><strong>${t('Mã hủy', 'Cancellation Number')}:</strong> <span style="color: #0284c7; font-weight: bold;">${safeCan}</span></p>`;

  // Itinerary section: multi-leg structured summary
  let itineraryHtml = '';
  if (data.itinerary && data.itinerary.length > 0) {
    itineraryHtml = `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: bold;">${t('Chi tiết hành trình', 'Itinerary Details')}:</p>
        <ul style="margin: 0; padding-left: 20px;">
          ${renderItineraryBullets(lang, data.itinerary, true)}
        </ul>
      </div>
    `;
  } else if (data.flightNumber) {
    itineraryHtml = renderSingleFlight(lang, data);
  }

  const html = renderLayout({
    lang,
    title: t('Xác nhận hủy đặt chỗ', 'Cancellation Confirmation'),
    accent: '#0284c7',
    body: `
      <p>${t('Kính gửi', 'Dear')} ${safeName},</p>
      ${typeDescription}
      ${highlightBox(identifierRows)}
      ${itineraryHtml}
      ${refundSection}
      <p style="margin-top: 24px;">${t(
        'Nếu bạn có thắc mắc hoặc muốn đặt lại hành trình, vui lòng liên hệ bộ phận hỗ trợ hoặc truy cập website của chúng tôi.',
        'If you have any questions or wish to re-book, please contact our support team or visit our website.',
      )}</p>`,
  });

  return { subject, html };
}

/**
 * Expired hold cancellation notification.
 */
export function renderExpiredHoldCancellationEmail(data: ExpiredHoldEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const safeName = escapeHtml(data.passengerName);
  const safePnr = escapeHtml(data.bookingReference);
  const safeBlk = escapeHtml(data.blockingNumber || '-');
  const safeCan = escapeHtml(data.cancellationNumber);
  const safeDeadline = escapeHtml(data.holdDeadlineFormatted);

  const subject = t(
    `Aptech Airlines - Hết hạn giữ chỗ, đặt chỗ ${data.bookingReference} đã bị hủy`,
    `Hold Period Expired - Booking ${data.bookingReference} Cancelled`,
  );

  let itineraryHtml = '';
  if (data.itinerary && data.itinerary.length > 0) {
    itineraryHtml = `
      <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 12px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: bold; color: #9f1239;">${t('Các chặng đã được giải phóng', 'Released Itinerary Legs')}:</p>
        <ul style="margin: 0; padding-left: 20px;">
          ${renderItineraryBullets(lang, data.itinerary, false)}
        </ul>
      </div>
    `;
  } else if (data.flightNumber) {
    itineraryHtml = renderSingleFlight(lang, data);
  }

  const html = renderLayout({
    lang,
    title: t('Giữ chỗ đã hết hạn', 'Reservation Expired'),
    accent: '#e11d48',
    body: `
      <p>${t('Kính gửi', 'Dear')} ${safeName},</p>
      <p>
        ${t(
          `Vé giữ chỗ của bạn đã đến hạn thanh toán (<strong>${safeDeadline}</strong>) nhưng chưa được xác nhận.
        Theo chính sách đặt chỗ, thời hạn giữ chỗ tạm thời đã kết thúc và đặt chỗ đã bị hủy.`,
          `Your hold reservation has reached its payment deadline (<strong>${safeDeadline}</strong>) without confirmation.
        In accordance with our booking policy, the temporary hold has now expired, and the reservation has been cancelled.`,
        )}
      </p>
      <div style="background: #fff1f2; border: 1px solid #fecdd3; padding: 12px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 0;"><strong>${t('Mã đặt chỗ (PNR)', 'Booking Reference (PNR)')}:</strong> ${safePnr}</p>
        <p style="margin: 4px 0 0 0;"><strong>${t('Mã giữ chỗ', 'Blocking Number')}:</strong> ${safeBlk}</p>
        <p style="margin: 4px 0 0 0;"><strong>${t('Mã hủy', 'Cancellation Number')}:</strong> <span style="color: #e11d48; font-weight: bold;">${safeCan}</span></p>
      </div>
      ${itineraryHtml}
      <p>${t(
        'Toàn bộ ghế đã giữ được hoàn về kho để mở bán cho hành khách khác. Tài khoản của bạn không bị trừ bất kỳ khoản phí nào.',
        'All reserved seats have been returned to inventory and made available to other travelers. No charges have been made to your account.',
      )}</p>
      <p>${t(
        'Bạn có thể tạo đặt chỗ mới bất cứ lúc nào trên website của chúng tôi.',
        'You are welcome to create a new reservation at any time on our website.',
      )}</p>`,
  });

  return { subject, html };
}

/**
 * Flight schedule disruption or recovery notification.
 */
export function renderFlightDisruptionEmail(data: FlightDisruptionEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const safeName = escapeHtml(data.passengerName);
  const safePnr = escapeHtml(data.bookingReference);
  const safeFlight = escapeHtml(data.flightNumber);
  const safeOrigin = escapeHtml(data.origin);
  const safeDest = escapeHtml(data.destination);
  const statusText = escapeHtml(flightStatusLabel(lang, data.statusText));

  let subject = t(
    `Quan trọng: Thay đổi lịch bay chuyến ${data.flightNumber}`,
    `Important: Schedule Change for Flight ${data.flightNumber}`,
  );
  let headerTitle = t('Cập nhật lịch bay', 'Flight Schedule Update');
  let headerColor = '#d97706';
  let introMessage = '';

  if (data.disruptionType === 'DELAY') {
    subject = t(
      `Cập nhật lịch bay: Chuyến ${data.flightNumber} bị trễ`,
      `Schedule Update: Flight ${data.flightNumber} Delayed`,
    );
    headerTitle = t('Thông báo trễ chuyến', 'Flight Delay Notice');
    headerColor = '#ea580c';
    introMessage = `
      <p>
        ${t(
          `Chúng tôi xin thông báo chuyến bay sắp tới của bạn <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) đã bị <strong>TRỄ CHUYẾN</strong>.`,
          `We are writing to inform you that your upcoming flight <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) has been <strong>DELAYED</strong>.`,
        )}
      </p>
    `;
  } else if (data.disruptionType === 'RECOVERY') {
    subject = t(
      `Cập nhật chuyến bay: Chuyến ${data.flightNumber} đã trở lại đúng lịch`,
      `Flight Update: Flight ${data.flightNumber} On Schedule`,
    );
    headerTitle = t('Chuyến bay đã khôi phục lịch', 'Flight Schedule Restored');
    headerColor = '#16a34a';
    introMessage = `
      <p>
        ${t(
          `Chúng tôi vui mừng thông báo sự cố khai thác ảnh hưởng tới chuyến bay <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) đã được khắc phục, chuyến bay hiện ở trạng thái <strong>ĐÚNG LỊCH</strong>.`,
          `We are pleased to inform you that operational disruptions affecting flight <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}) have been resolved, and the flight status is now <strong>SCHEDULED</strong>.`,
        )}
      </p>
    `;
  } else {
    introMessage = `
      <p>
        ${t(
          `Chúng tôi xin thông báo có thay đổi lịch bay ảnh hưởng tới chuyến bay sắp tới của bạn
        <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}).`,
          `We are writing to inform you of a schedule change affecting your upcoming flight
        <strong>${safeFlight}</strong> (${safeOrigin} → ${safeDest}).`,
        )}
      </p>
    `;
  }

  const html = renderLayout({
    lang,
    title: headerTitle,
    accent: headerColor,
    body: `
      <p>${t('Kính gửi', 'Dear')} ${safeName},</p>
      ${introMessage}
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 0;"><strong>${t('Mã đặt chỗ (PNR)', 'Booking Reference (PNR)')}:</strong> ${safePnr}</p>
        <p style="margin: 4px 0 0 0;"><strong>${t('Chuyến bay', 'Flight')}:</strong> ${safeFlight}</p>
        <p style="margin: 4px 0 0 0;"><strong>${t('Trạng thái chuyến bay', 'Flight Status')}:</strong> <span style="font-weight: bold; color: ${headerColor};">${statusText}</span></p>
        ${data.delayReason ? `<p style="margin: 4px 0 0 0;"><strong>${t('Lý do', 'Reason')}:</strong> ${escapeHtml(data.delayReason)}</p>` : ''}
      </div>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left;">
            <th style="padding: 8px; border: 1px solid #e2e8f0;">${t('Sự kiện', 'Event')}</th>
            <th style="padding: 8px; border: 1px solid #e2e8f0;">${t('Giờ ban đầu', 'Original Time')}</th>
            <th style="padding: 8px; border: 1px solid #e2e8f0;">${t('Giờ cập nhật', 'Updated Time')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">${t('Khởi hành', 'Departure')} (${safeOrigin})</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(data.originalDepartureFormatted)}</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0; color: #b45309; font-weight: bold;">
              ${escapeHtml(data.newDepartureFormatted || data.originalDepartureFormatted)}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">${t('Hạ cánh', 'Arrival')} (${safeDest})</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(data.originalArrivalFormatted)}</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0; color: #b45309; font-weight: bold;">
              ${escapeHtml(data.newArrivalFormatted || data.originalArrivalFormatted)}
            </td>
          </tr>
        </tbody>
      </table>
      <p>${t(
        'Vui lòng dùng chức năng Tra cứu đặt chỗ để kiểm tra trạng thái chuyến bay và chi tiết hành trình mới nhất.',
        'Please use Track Booking to check the latest flight status and trip details.',
      )}</p>
      <p>${t('Cảm ơn bạn đã lựa chọn Aptech Airlines.', 'Thank you for choosing Aptech Airlines.')}</p>`,
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

export interface BlockedReminderEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  earliestDepartureFormatted: string;
  deadlineFormatted: string;
  legs: BlockedReminderLeg[];
}

/** Immediate notice of a successful unpaid hold, whether customer- or clerk-created. */
export interface HoldCreatedEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  deadlineFormatted: string;
  legs: BlockedReminderLeg[];
  paymentUrl?: string;
}

export interface HoldCancelledByCustomerEmailData extends MailLangOption {
  toEmail: string;
  passengerName: string;
  bookingReference: string;
  blockingNumber?: string;
  cancellationNumber: string;
  itinerary?: ItineraryLegData[];
}

function renderLegList(lang: MailLang, legs: ItineraryLegData[]): string {
  return legs
    .map(
      (leg) => `
      <div style="padding:12px 0;border-bottom:1px solid #e2e8f0">
        <strong>${escapeHtml(leg.flightNumber)}</strong> · ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}<br/>
        <span style="color:#64748b">${pick(lang, 'Khởi hành', 'Departure')}: ${escapeHtml(leg.departureTimeFormatted)}${leg.cabinClass ? ` · ${escapeHtml(cabinLabel(lang, leg.cabinClass))}` : ''}</span>
      </div>`,
    )
    .join('');
}

/** Subject of the hold-payment reminder (also used by MailService). */
export function blockedReminderSubject(lang: MailLang, bookingReference?: string): string {
  const ref = bookingReference ? ` ${bookingReference}` : '';
  return pick(
    lang,
    `Aptech Airlines - Nhắc thanh toán vé giữ chỗ${ref}`,
    `Reminder: Your blocked ticket${ref} is awaiting confirmation`,
  );
}

export function renderHoldCreatedEmail(data: HoldCreatedEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const itinerary = data.legs.map((leg) =>
    `<li>${t('Chuyến bay', 'Flight')} ${escapeHtml(leg.flightNumber)}: ${escapeHtml(leg.origin || '')} → ` +
    `${escapeHtml(leg.destination || '')}, ${t('khởi hành', 'departing')} ${escapeHtml(leg.departureTimeFormatted)}</li>`,
  ).join('');
  const payLink = data.paymentUrl && /^https?:\/\//i.test(data.paymentUrl)
    ? `<p><a href="${escapeHtml(data.paymentUrl)}" style="display:inline-block;padding:12px 20px;background:#0a2540;color:#ffffff;text-decoration:none;border-radius:8px">${t('Xem đặt chỗ và thanh toán PayPal', 'View booking and pay with PayPal')}</a></p>`
    : `<p>${t('Đăng nhập vào Aptech Airlines, mở mục Chuyến đi hoặc Tra cứu vé và nhập mã giữ chỗ bên trên để thanh toán PayPal.', 'Sign in to Aptech Airlines, open My Trips or Track Booking and enter the hold number above to pay with PayPal.')}</p>`;

  return {
    subject: t(`Aptech Airlines - Giữ chỗ thành công ${data.bookingReference}`,
      `Aptech Airlines - Booking held ${data.bookingReference}`),
    html: renderLayout({
      lang,
      title: t('Đã giữ chỗ thành công', 'Your booking is on hold'),
      footer: t('Aptech Airlines • Email thông báo tự động.', 'Aptech Airlines • Automated notification.'),
      body: `<p>${t('Xin chào', 'Hello')} ${escapeHtml(data.passengerName)},</p>
        <p>${t('Chỗ của bạn đã được giữ thành công và đang chờ thanh toán. Vui lòng thanh toán trước hạn bên dưới.', 'Your seats have been held successfully and are awaiting payment. Please pay before the deadline below.')}</p>
        ${highlightBox(`<div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
          <div><strong>${t('Mã giữ chỗ', 'Hold number')}:</strong> ${escapeHtml(data.blockingNumber || '-')}</div>
          <div><strong>${t('Hạn thanh toán', 'Payment deadline')}:</strong> ${escapeHtml(data.deadlineFormatted)}</div>`)}
        <p><strong>${t('Hành trình', 'Itinerary')}:</strong></p><ul>${itinerary}</ul>
        ${payLink}
        <p>${t('Đặt chỗ sẽ tự động hủy nếu quá hạn thanh toán.', 'Your hold will be cancelled automatically if the payment deadline passes.')}</p>`,
    }),
  };
}

/** Requirement 3.4.2.1: reminder for an unpaid HOLD/BLOCKED booking (≤ 21 days before departure). */
export function renderBlockedTicketReminder(data: BlockedReminderEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const lines = data.legs
    .map((leg) =>
      leg.origin
        ? `<li>${t('Chuyến bay', 'Flight')} ${escapeHtml(leg.flightNumber)}: ${escapeHtml(leg.origin)} → ${escapeHtml(leg.destination)}, ` +
          `${t('khởi hành', 'departing')} ${escapeHtml(leg.departureTimeFormatted)} (${escapeHtml(cabinLabel(lang, leg.cabinClass))})</li>`
        : `<li>${t('Chuyến bay', 'Flight')} ${escapeHtml(leg.flightNumber)} (${escapeHtml(cabinLabel(lang, leg.cabinClass))})</li>`,
    )
    .join('');
  const html = renderLayout({
    lang,
    title: t('Nhắc thanh toán vé đang giữ chỗ', 'Payment reminder for your held booking'),
    footer: t(
      'Aptech Airlines • Thông báo giữ chỗ tự động • Vui lòng không trả lời trực tiếp email này.',
      'Aptech Airlines • Automated Hold Notification • Please do not reply directly to this email.',
    ),
    body: `
          <p>${t('Xin chào', 'Hello')} ${escapeHtml(data.passengerName)},</p>
          <p>${t(
            `Bạn đang có một vé <strong>giữ chỗ chưa thanh toán</strong>. Chuyến bay đầu tiên dự kiến khởi hành vào <strong>${escapeHtml(data.earliestDepartureFormatted)}</strong>.`,
            `You have an <strong>unpaid held booking</strong>. Your first flight is scheduled to depart on <strong>${escapeHtml(data.earliestDepartureFormatted)}</strong>.`,
          )}</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            <div><strong>${t('Mã giữ chỗ', 'Blocking Number')}:</strong> ${escapeHtml(data.blockingNumber || '-')}</div>
            <div><strong>${t('Hạn thanh toán', 'Payment deadline')}:</strong> ${escapeHtml(data.deadlineFormatted)}<br/><span style="color:#64748b;font-size:12px">${t('Hạn xác nhận &amp; thanh toán', 'Confirm &amp; pay before this time')}</span></div>`)}
          <p><strong>${t('Hành trình', 'Itinerary')}:</strong></p><ul>${lines}</ul>
          <p>${t(
            'Vui lòng xác nhận vé trước hạn. Nếu quá hạn, hệ thống sẽ tự động hủy giữ chỗ và hoàn ghế về kho.',
            'Please confirm your booking before the deadline. Otherwise the hold will be cancelled automatically and the seats released.',
          )}</p>`,
  });
  return { subject: blockedReminderSubject(lang, data.bookingReference), html };
}

export function renderPasswordResetCode(data: PasswordResetEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const minutes = Number(data.expiresInMinutes) || 0;
  const html = renderLayout({
    lang,
    title: t('Mã xác nhận đặt lại mật khẩu', 'Password reset verification code'),
    footer: t(
      'Aptech Airlines • Email tự động • Không chia sẻ mã xác nhận cho người khác.',
      'Aptech Airlines • Automated email • Never share this verification code with anyone.',
    ),
    body: `
          <p>${t('Xin chào', 'Hello')} ${escapeHtml(data.passengerName)},</p>
          <p>${t(
            'Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Aptech Airlines. Nhập mã sau tại màn hình đặt lại mật khẩu:',
            'You requested to reset the password of your Aptech Airlines account. Enter the following code on the password reset screen:',
          )}</p>
          <div style="margin:22px 0;padding:18px;text-align:center;background:#fff7df;border:1px solid #efd783;border-radius:12px;font-size:32px;font-weight:900;letter-spacing:.18em;color:#071b2e">${escapeHtml(data.code)}</div>
          <p>${t(
            `Mã có hiệu lực trong <strong>${minutes} phút</strong>. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.`,
            `This code is valid for <strong>${minutes} minutes</strong>. If you did not request this, please ignore this email.`,
          )}</p>`,
  });
  return { subject: t('Aptech Airlines - Mã đặt lại mật khẩu', 'Aptech Airlines - Password reset code'), html };
}

export function renderUpcomingTripReminder(data: UpcomingTripEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const html = renderLayout({
    lang,
    title: t('Chuyến bay của bạn sắp khởi hành', 'Your flight is departing soon'),
    footer: t(
      'Aptech Airlines • Thông báo hành trình tự động • Vui lòng không trả lời trực tiếp email này.',
      'Aptech Airlines • Automated Trip Notification • Please do not reply directly to this email.',
    ),
    body: `
          <p>${t('Xin chào', 'Hello')} ${escapeHtml(data.passengerName)},</p>
          <p>${t(
            `Đây là email nhắc lịch cho hành trình đã xác nhận. Chuyến bay đầu tiên dự kiến khởi hành vào <strong>${escapeHtml(data.departureTimeFormatted)}</strong>.`,
            `This is a reminder for your confirmed trip. Your first flight is scheduled to depart on <strong>${escapeHtml(data.departureTimeFormatted)}</strong>.`,
          )}</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            ${data.confirmationNumber ? `<div><strong>${t('Mã xác nhận', 'Confirmation Number')}:</strong> ${escapeHtml(data.confirmationNumber)}</div>` : ''}`)}
          ${renderLegList(lang, data.itinerary)}
          <p style="margin-top:20px">${t(
            'Vui lòng kiểm tra giấy tờ tùy thân, hành lý và có mặt tại sân bay đúng giờ. Bạn có thể vào mục Chuyến đi để xem trạng thái mới nhất.',
            'Please check your ID documents and baggage, and arrive at the airport on time. You can open My Trips to see the latest status.',
          )}</p>`,
  });
  return {
    subject: t(
      `Aptech Airlines - Nhắc lịch chuyến bay ${data.bookingReference}`,
      `Aptech Airlines - Upcoming flight reminder ${data.bookingReference}`,
    ),
    html,
  };
}

/** Customer voluntarily cancels their own unpaid HOLD/BLOCKED booking. */
export function renderHoldCancelledByCustomer(data: HoldCancelledByCustomerEmailData): RenderedEmail {
  const lang = langOf(data);
  const t = (vi: string, en: string) => pick(lang, vi, en);
  const html = renderLayout({
    lang,
    title: t('Đã hủy giữ chỗ theo yêu cầu', 'Hold cancelled at your request'),
    accent: '#0284c7',
    footer: t(
      'Aptech Airlines • Thông báo giữ chỗ tự động • Vui lòng không trả lời trực tiếp email này.',
      'Aptech Airlines • Automated Hold Notification • Please do not reply directly to this email.',
    ),
    body: `
          <p>${t('Xin chào', 'Hello')} ${escapeHtml(data.passengerName)},</p>
          <p>${t(
            'Chúng tôi xác nhận bạn đã <strong>hủy vé giữ chỗ</strong> theo yêu cầu. Vì đây là vé giữ chỗ chưa thanh toán nên <strong>không phát sinh phí</strong> và không có khoản hoàn tiền nào.',
            'We confirm that you have <strong>cancelled your held booking</strong>. Because it was an unpaid hold, <strong>no fee was charged</strong> and there is no refund.',
          )}</p>
          ${highlightBox(`
            <div><strong>PNR:</strong> ${escapeHtml(data.bookingReference)}</div>
            <div><strong>${t('Mã giữ chỗ', 'Blocking Number')}:</strong> ${escapeHtml(data.blockingNumber || '-')}</div>
            <div><strong>${t('Mã hủy', 'Cancellation Number')}:</strong> <span style="color:#0284c7;font-weight:bold">${escapeHtml(data.cancellationNumber)}</span></div>`)}
          ${data.itinerary && data.itinerary.length ? `<p><strong>${t('Hành trình đã hủy', 'Cancelled itinerary')}:</strong></p>${renderLegList(lang, data.itinerary)}` : ''}
          ${infoBox(t(
            'Ghế đã được hoàn về kho. Bạn có thể đặt hành trình mới bất cứ lúc nào trên website Aptech Airlines.',
            'The seats have been released. You can book a new trip at any time on the Aptech Airlines website.',
          ))}`,
  });
  return {
    subject: t(
      `Aptech Airlines - Đã hủy giữ chỗ ${data.bookingReference}`,
      `Aptech Airlines - Hold cancelled ${data.bookingReference}`,
    ),
    html,
  };
}
