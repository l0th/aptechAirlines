import {
  RenderedEmail,
  renderBlockedTicketReminder,
  renderHoldCreatedEmail,
  renderCancellationEmail,
  renderExpiredHoldCancellationEmail,
  renderFlightDisruptionEmail,
  renderHoldCancelledByCustomer,
  renderPasswordResetCode,
  renderUpcomingTripReminder,
} from './mail-renderers';

export type MailTemplateKey =
  | 'HOLD_CREATED'
  | 'BLOCKED_REMINDER'
  | 'UPCOMING_TRIP'
  | 'CANCELLATION'
  | 'EXPIRED_HOLD'
  | 'HOLD_CANCELLED_BY_CUSTOMER'
  | 'FLIGHT_DISRUPTION'
  | 'PASSWORD_RESET'
  | 'CUSTOM';

export interface MailTemplateDefinition {
  key: Exclude<MailTemplateKey, 'CUSTOM'>;
  name: string;
  description: string;
  trigger: string;
  /** English labels shown when the admin UI is in English. */
  nameEn: string;
  descriptionEn: string;
  triggerEn: string;
  sampleData: any;
  /** Sample fields that must change for the English preview (free-text values). */
  sampleDataEn?: any;
  render: (data: any) => RenderedEmail;
}

const sampleLegs = [
  {
    flightNumber: 'APT1201',
    origin: 'SGN',
    destination: 'HAN',
    cabinClass: 'ECONOMY',
    departureTimeFormatted: '2026-11-02 08:30 (Asia/Ho_Chi_Minh)',
    arrivalTimeFormatted: '2026-11-02 10:40 (Asia/Ho_Chi_Minh)',
  },
];

export const MAIL_TEMPLATES: MailTemplateDefinition[] = [
  {
    key: 'HOLD_CREATED',
    name: 'Đã giữ chỗ thành công',
    description: 'Gửi ngay cho chủ tài khoản khi tạo giữ chỗ, kể cả nhân viên đặt thay.',
    trigger: 'Ngay sau khi đặt chỗ BLOCKED được lưu thành công.',
    nameEn: 'Booking hold created',
    descriptionEn: 'Immediately notifies the account owner of a newly held booking, including staff-created holds.',
    triggerEn: 'After the BLOCKED booking is committed.',
    sampleData: {
      toEmail: 'customer@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      blockingNumber: 'BLK-20261015-001',
      deadlineFormatted: '2026-10-19 08:30 (Asia/Ho_Chi_Minh)',
      legs: sampleLegs,
      paymentUrl: 'https://aptech-airlines.example/track?code=BLK-20261015-001',
    },
    render: renderHoldCreatedEmail,
  },
  {
    key: 'BLOCKED_REMINDER',
    name: 'Nhắc thanh toán vé giữ chỗ',
    description: 'Nhắc khách xác nhận & thanh toán vé đang giữ chỗ (BLOCKED) trước hạn.',
    trigger: 'Cron mỗi giờ: vé BLOCKED chưa nhắc, khởi hành trong vòng 21 ngày tới và chưa quá hạn giữ chỗ. Admin có thể chạy ngay.',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      blockingNumber: 'BLK-20261015-001',
      earliestDepartureFormatted: '2026-11-02 08:30 (Asia/Ho_Chi_Minh)',
      deadlineFormatted: '2026-10-19 08:30 (Asia/Ho_Chi_Minh)',
      legs: sampleLegs,
    },
    nameEn: 'Hold payment reminder',
    descriptionEn: 'Reminds the customer to confirm & pay a held (BLOCKED) booking before the deadline.',
    triggerEn: 'Hourly cron: BLOCKED bookings not yet reminded, departing within 21 days and still before the hold deadline. Admins can run it now.',
    render: renderBlockedTicketReminder,
  },
  {
    key: 'UPCOMING_TRIP',
    name: 'Nhắc chuyến bay sắp khởi hành',
    description: 'Nhắc lịch cho vé đã xác nhận khi chuyến bay sắp tới.',
    trigger: 'Cron mỗi giờ: vé CONFIRMED/RESCHEDULED có chặng khởi hành trong vòng 3 ngày (mỗi hành trình chỉ gửi 1 lần).',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      confirmationNumber: 'CNF-20261015-001',
      departureTimeFormatted: '2026-11-02 08:30 (Asia/Ho_Chi_Minh)',
      itinerary: sampleLegs,
    },
    nameEn: 'Upcoming flight reminder',
    descriptionEn: 'Trip reminder for confirmed bookings shortly before departure.',
    triggerEn: 'Hourly cron: CONFIRMED/RESCHEDULED bookings with a leg departing within 3 days (sent once per itinerary).',
    render: renderUpcomingTripReminder,
  },
  {
    key: 'CANCELLATION',
    name: 'Xác nhận hủy vé',
    description: 'Thông báo hủy vé đã thanh toán (kèm hoàn tiền) hoặc hủy do chuyến bay bị hủy.',
    trigger: 'Khi khách/nhân viên hủy vé CONFIRMED, hoặc khi admin hủy chuyến bay (hủy khẩn cấp).',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      confirmationNumber: 'CNF-20261015-001',
      cancellationNumber: 'CAN-20261020-001',
      cancellationType: 'MANUAL_CONFIRMED',
      originalBookingStatus: 'CONFIRMED',
      itinerary: sampleLegs,
      refundAmount: 1800000,
      refundPercentage: 90,
      policyDeduction: 10,
      currency: 'VND',
      maskedCard: '****4321',
    },
    nameEn: 'Cancellation confirmation',
    descriptionEn: 'Cancellation notice for a paid booking (with refund) or a cancellation caused by a cancelled flight.',
    triggerEn: 'When a customer/staff cancels a CONFIRMED booking, or an admin cancels a flight (emergency cancellation).',
    render: renderCancellationEmail,
  },
  {
    key: 'EXPIRED_HOLD',
    name: 'Giữ chỗ hết hạn',
    description: 'Thông báo vé giữ chỗ đã bị hệ thống tự động hủy do quá hạn thanh toán.',
    trigger: 'Cron mỗi giờ: vé BLOCKED quá hạn giữ chỗ (14 ngày trước khởi hành) bị tự động hủy và hoàn ghế.',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      blockingNumber: 'BLK-20261015-001',
      cancellationNumber: 'CAN-20261019-002',
      holdDeadlineFormatted: '2026-10-19 08:30 (Asia/Ho_Chi_Minh)',
      itinerary: sampleLegs,
    },
    nameEn: 'Hold expired',
    descriptionEn: 'Tells the customer the held booking was cancelled automatically because the payment deadline passed.',
    triggerEn: 'Hourly cron: BLOCKED bookings past the hold deadline (14 days before departure) are cancelled and seats released.',
    render: renderExpiredHoldCancellationEmail,
  },
  {
    key: 'HOLD_CANCELLED_BY_CUSTOMER',
    name: 'Khách tự hủy vé giữ chỗ',
    description: 'Xác nhận khách đã tự hủy vé giữ chỗ chưa thanh toán (không phí, không hoàn tiền).',
    trigger: 'Khi khách (hoặc nhân viên thay khách) hủy vé đang ở trạng thái BLOCKED.',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      blockingNumber: 'BLK-20261015-001',
      cancellationNumber: 'CAN-20261016-003',
      itinerary: sampleLegs,
    },
    nameEn: 'Hold cancelled by customer',
    descriptionEn: 'Confirms the customer cancelled an unpaid hold (no fee, no refund).',
    triggerEn: 'When the customer (or staff on their behalf) cancels a BLOCKED booking.',
    render: renderHoldCancelledByCustomer,
  },
  {
    key: 'FLIGHT_DISRUPTION',
    name: 'Thay đổi lịch bay',
    description: 'Thông báo chuyến bay bị trễ, đổi lịch hoặc khôi phục lịch bay.',
    trigger: 'Khi admin cập nhật trạng thái chuyến bay (DELAYED / đổi giờ / khôi phục SCHEDULED).',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      bookingReference: 'PNR8X2KQ',
      flightNumber: 'APT1201',
      origin: 'SGN',
      destination: 'HAN',
      disruptionType: 'DELAY',
      originalDepartureFormatted: '2026-11-02 08:30 (Asia/Ho_Chi_Minh)',
      newDepartureFormatted: '2026-11-02 10:00 (Asia/Ho_Chi_Minh)',
      originalArrivalFormatted: '2026-11-02 10:40 (Asia/Ho_Chi_Minh)',
      newArrivalFormatted: '2026-11-02 12:10 (Asia/Ho_Chi_Minh)',
      delayReason: 'Thời tiết xấu tại sân bay đến',
      statusText: 'DELAYED',
    },
    nameEn: 'Flight schedule change',
    descriptionEn: 'Notifies a flight delay, schedule change or schedule recovery.',
    triggerEn: 'When an admin updates the flight status (DELAYED / new time / back to SCHEDULED).',
    sampleDataEn: { delayReason: 'Bad weather at the destination airport' },
    render: renderFlightDisruptionEmail,
  },
  {
    key: 'PASSWORD_RESET',
    name: 'Mã đặt lại mật khẩu',
    description: 'Gửi mã OTP 6 số để khách đặt lại mật khẩu.',
    trigger: 'Khi người dùng bấm "Quên mật khẩu" và email tồn tại trong hệ thống.',
    sampleData: {
      toEmail: 'khach@example.com',
      passengerName: 'Nguyễn Văn An',
      code: '482913',
      expiresInMinutes: 10,
    },
    nameEn: 'Password reset code',
    descriptionEn: 'Sends a 6-digit code so the customer can reset the password.',
    triggerEn: 'When a user clicks "Forgot password" and the email exists in the system.',
    render: renderPasswordResetCode,
  },
];

/** Sample payload for previews/tests in the requested language. */
export function sampleDataFor(tpl: MailTemplateDefinition, lang: 'vi' | 'en'): any {
  return lang === 'en' ? { ...tpl.sampleData, ...(tpl.sampleDataEn || {}), lang } : { ...tpl.sampleData, lang };
}

export function findMailTemplate(key: string): MailTemplateDefinition | undefined {
  return MAIL_TEMPLATES.find((t) => t.key === key);
}
