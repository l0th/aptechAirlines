import { MailService, escapeHtml, isValidMaskedCard } from './mail.service';

describe('MailService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('HTML escaping', () => {
    it('escapes special HTML characters correctly', () => {
      const raw = '<script>alert("XSS & fun\'");</script>';
      const safe = escapeHtml(raw);
      expect(safe).toBe('&lt;script&gt;alert(&quot;XSS &amp; fun&#039;&quot;);&lt;/script&gt;');
    });

    it('handles undefined and null inputs gracefully', () => {
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('DEV-fallback mode (no SMTP_HOST configured)', () => {
    it('resolves true and logs email without crashing when SMTP_HOST is not set', async () => {
      delete process.env.SMTP_HOST;
      const service = new MailService();

      const result = await service.sendMail('user@example.com', 'Test Subject', '<p>Test body</p>');
      expect(result).toBe(true);
    });

    it('sendCancellationEmail formats and sends in DEV mode without crashing', async () => {
      delete process.env.SMTP_HOST;
      const service = new MailService();

      const result = await service.sendCancellationEmail({
        toEmail: 'passenger@example.com',
        passengerName: 'Nguyen Van A',
        bookingReference: 'PNR123',
        cancellationNumber: 'CAN-456',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        flightNumber: 'VN101',
        origin: 'HAN',
        destination: 'SGN',
        departureTimeFormatted: '2026-10-28 14:00 (Asia/Ho_Chi_Minh)',
        refundAmount: 1500000,
        refundPercentage: 90,
        currency: 'VND',
        maskedCard: '**** **** **** 1234',
        policyDeduction: 10,
      });

      expect(result).toBe(true);
    });

    it('sendExpiredHoldCancellationEmail formats and sends in DEV mode without crashing', async () => {
      delete process.env.SMTP_HOST;
      const service = new MailService();

      const result = await service.sendExpiredHoldCancellationEmail({
        toEmail: 'passenger@example.com',
        passengerName: 'Tran B',
        bookingReference: 'PNR789',
        blockingNumber: 'BLK-123',
        cancellationNumber: 'CAN-999',
        holdDeadlineFormatted: '2026-10-25 23:59 (Asia/Ho_Chi_Minh)',
        flightNumber: 'VN102',
        origin: 'SGN',
        destination: 'DAD',
      });

      expect(result).toBe(true);
    });

    it('sendFlightDisruptionEmail formats and sends in DEV mode for DELAY', async () => {
      delete process.env.SMTP_HOST;
      const service = new MailService();

      const result = await service.sendFlightDisruptionEmail({
        toEmail: 'passenger@example.com',
        passengerName: 'Le C',
        bookingReference: 'PNR555',
        flightNumber: 'VN103',
        origin: 'HAN',
        destination: 'DAD',
        disruptionType: 'DELAY',
        originalDepartureFormatted: '2026-10-28 08:00 (Asia/Ho_Chi_Minh)',
        newDepartureFormatted: '2026-10-28 10:30 (Asia/Ho_Chi_Minh)',
        originalArrivalFormatted: '2026-10-28 09:20 (Asia/Ho_Chi_Minh)',
        newArrivalFormatted: '2026-10-28 11:50 (Asia/Ho_Chi_Minh)',
        delayReason: 'Weather delay at origin airport',
        statusText: 'DELAYED',
      });

      expect(result).toBe(true);
    });
  });

  describe('Email Content Formatting & Invariants', () => {
    let service: MailService;
    let sendMailSpy: jest.SpyInstance;

    beforeEach(() => {
      delete process.env.SMTP_HOST;
      service = new MailService();
      sendMailSpy = jest.spyOn(service, 'sendMail').mockResolvedValue(true);
    });

    it('manual BLOCKED cancellation renders PNR + BLK, no CNF, refund 0', async () => {
      await service.sendCancellationEmail({
        toEmail: 'blocked@example.com',
        passengerName: 'Hold Passenger',
        bookingReference: 'PNR-BLK-001',
        blockingNumber: 'BLK-777888',
        cancellationNumber: 'CAN-000111',
        cancellationType: 'MANUAL_BLOCKED',
        originalBookingStatus: 'BLOCKED',
        refundAmount: 0,
        currency: 'VND',
      });

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const [to, subject, html] = sendMailSpy.mock.calls[0];
      expect(to).toBe('blocked@example.com');
      expect(html).toContain('PNR-BLK-001');
      expect(html).toContain('BLK-777888');
      expect(html).not.toContain('Confirmation Number');
      expect(html).toContain('CAN-000111');
      expect(html).toContain('refund amount is 0 VND');
    });

    it('manual CONFIRMED cancellation renders PNR + CNF, no BLK, refund percentage & amount', async () => {
      await service.sendCancellationEmail({
        toEmail: 'confirmed@example.com',
        passengerName: 'Paid Passenger',
        bookingReference: 'PNR-CNF-002',
        confirmationNumber: 'CNF-555666',
        cancellationNumber: 'CAN-000222',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 1800000,
        refundPercentage: 90,
        policyDeduction: 10,
        currency: 'VND',
        maskedCard: '************4321',
      });

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const [to, subject, html] = sendMailSpy.mock.calls[0];
      expect(to).toBe('confirmed@example.com');
      expect(html).toContain('PNR-CNF-002');
      expect(html).toContain('CNF-555666');
      expect(html).not.toContain('Blocking Number');
      expect(html).toContain('Refund Percentage: <strong>90%</strong>');
      expect(html).toContain('Refund Target: <strong>************4321</strong>');
      expect(html).toContain('1.800.000 VND');
    });

    it('emergency flight cancellation renders PNR, BLK/CNF if present, 100% refund wording', async () => {
      await service.sendCancellationEmail({
        toEmail: 'emergency@example.com',
        passengerName: 'Stranded Passenger',
        bookingReference: 'PNR-EMG-003',
        confirmationNumber: 'CNF-999000',
        cancellationNumber: 'CAN-000333',
        cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
        originalBookingStatus: 'CONFIRMED',
        flightNumber: 'VN999',
        origin: 'SGN',
        destination: 'HAN',
        refundAmount: 2500000,
        refundPercentage: 100,
        currency: 'VND',
        maskedCard: '**** **** **** 9876',
        reason: 'Severe storm at destination',
      });

      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      const [to, subject, html] = sendMailSpy.mock.calls[0];
      expect(to).toBe('emergency@example.com');
      expect(subject).toContain('Important: Flight VN999 Cancelled');
      expect(html).toContain('We regret to inform you that your flight VN999 has been cancelled');
      expect(html).toContain('100% Refund Recorded');
      expect(html).toContain('CNF-999000');
      expect(html).toContain('Severe storm at destination');
      expect(html).toContain('Refund Target: <strong>**** **** **** 9876</strong>');
    });

    it('card masking: genuine card is rendered; placeholder and raw PAN are omitted entirely', async () => {
      // Direct helper assertions (R4-1 Requirements)
      // 1. Raw PANs rejected
      expect(isValidMaskedCard('4111111111111111')).toBe(false);
      expect(isValidMaskedCard('4111 1111 1111 1111')).toBe(false);
      // 2. Insufficiently masked cards (excessive visible digits) rejected
      expect(isValidMaskedCard('411111111111*1111')).toBe(false);
      expect(isValidMaskedCard('4111111111111111*4242')).toBe(false);
      // 3. Disallowed characters rejected
      expect(isValidMaskedCard('abc*1234')).toBe(false);
      // 4. Genuine accepted masks accepted
      expect(isValidMaskedCard('**** **** **** 4242')).toBe(true);
      expect(isValidMaskedCard('************4242')).toBe(true);
      expect(isValidMaskedCard('411111******1111')).toBe(true);
      // 5. Placeholders rejected
      expect(isValidMaskedCard('AUTO-REFUND-FLIGHT-CANCELLED')).toBe(false);

      // With genuine card
      await service.sendCancellationEmail({
        toEmail: 'card@example.com',
        passengerName: 'Card User',
        bookingReference: 'PNR-CARD-1',
        cancellationNumber: 'CAN-C1',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 1000000,
        currency: 'VND',
        maskedCard: '****1234',
      });
      const html1 = sendMailSpy.mock.calls[0][2];
      expect(html1).toContain('Refund Target: <strong>****1234</strong>');

      sendMailSpy.mockClear();

      // With placeholder
      await service.sendCancellationEmail({
        toEmail: 'card@example.com',
        passengerName: 'Card User',
        bookingReference: 'PNR-CARD-2',
        cancellationNumber: 'CAN-C2',
        cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 1000000,
        currency: 'VND',
        maskedCard: 'AUTO-REFUND-FLIGHT-CANCELLED',
      });
      const html2 = sendMailSpy.mock.calls[0][2];
      expect(html2).not.toContain('Refund Target');
      expect(html2).not.toContain('AUTO-REFUND-FLIGHT-CANCELLED');

      sendMailSpy.mockClear();

      // With raw PAN: MUST NOT appear in generated HTML (Finding F1 & R4-1)
      await service.sendCancellationEmail({
        toEmail: 'rawpan@example.com',
        passengerName: 'Raw PAN User',
        bookingReference: 'PNR-RAW-PAN',
        cancellationNumber: 'CAN-RAW',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 1000000,
        currency: 'VND',
        maskedCard: '4111111111111111',
      });
      const htmlRaw = sendMailSpy.mock.calls[0][2];
      expect(htmlRaw).not.toContain('Refund Target');
      expect(htmlRaw).not.toContain('4111111111111111');
    });

    it('manual CONFIRMED with 0% refund explains policy without claiming refund was recorded', async () => {
      await service.sendCancellationEmail({
        toEmail: 'zero@example.com',
        passengerName: 'Zero Refund Passenger',
        bookingReference: 'PNR-ZERO-1',
        confirmationNumber: 'CNF-ZERO-1',
        cancellationNumber: 'CAN-ZERO-1',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 0,
        refundPercentage: 0,
        policyDeduction: 100,
        currency: 'VND',
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).toContain('Refund Percentage: <strong>0%</strong>');
      expect(html).toContain('Refund Amount: <strong>0 VND</strong>');
      expect(html).toContain('No refund is due under the applicable cancellation policy.');
      expect(html).not.toContain('This refund has been recorded by the reservation system.');
    });

    it('manual CONFIRMED with 0 monetary amount and >0% refund rate displays actual percentage and states no monetary transaction required (R5-1)', async () => {
      await service.sendCancellationEmail({
        toEmail: 'zero90@example.com',
        passengerName: 'Zero Confirmed Passenger',
        bookingReference: 'PNR-ZERO-90',
        confirmationNumber: 'CNF-ZERO-90',
        cancellationNumber: 'CAN-ZERO-90',
        cancellationType: 'MANUAL_CONFIRMED',
        originalBookingStatus: 'CONFIRMED',
        refundAmount: 0,
        refundPercentage: 90,
        policyDeduction: 10,
        currency: 'VND',
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).toContain('Refund Percentage: <strong>90%</strong>');
      expect(html).not.toContain('Refund Percentage: <strong>0%</strong>');
      expect(html).toContain('Refund Amount: <strong>0 VND</strong>');
      expect(html).toContain('A 90% refund rate applies, but the refundable monetary amount is 0 VND. No monetary refund transaction was required.');
      expect(html).not.toContain('This refund has been recorded by the reservation system.');
      expect(html).not.toContain('Refund Recorded');
    });

    it('emergency CONFIRMED with 0 monetary amount clearly states cancellation without claiming refund recorded (R4-2)', async () => {
      await service.sendCancellationEmail({
        toEmail: 'emgzero@example.com',
        passengerName: 'Emergency Zero Passenger',
        bookingReference: 'PNR-EMG-ZERO',
        confirmationNumber: 'CNF-EMG-0',
        cancellationNumber: 'CAN-EMG-0',
        cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
        originalBookingStatus: 'CONFIRMED',
        flightNumber: 'VN101',
        refundAmount: 0,
        refundPercentage: 100,
        currency: 'VND',
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).not.toContain('Refund Recorded');
      expect(html).toContain('This confirmed booking has been cancelled due to flight cancellation.');
      expect(html).toContain('Refund Percentage: <strong>100%</strong>');
      expect(html).toContain('Refund Amount: <strong>0 VND</strong>');
      expect(html).toContain('No monetary refund transaction was required as the total paid amount was 0 VND.');
      expect(html).not.toContain('This refund has been recorded by the reservation system.');
    });

    it('emergency BLOCKED describes unpaid hold without claiming 100% refund', async () => {
      await service.sendCancellationEmail({
        toEmail: 'emgblk@example.com',
        passengerName: 'Emergency Hold Passenger',
        bookingReference: 'PNR-EMG-BLK',
        blockingNumber: 'BLK-EMG-0',
        cancellationNumber: 'CAN-EMG-BLK',
        cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
        originalBookingStatus: 'BLOCKED',
        flightNumber: 'VN101',
        refundAmount: 0,
        currency: 'VND',
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).toContain('This was an unconfirmed hold reservation.');
      expect(html).not.toContain('100% Refund Recorded');
      expect(html).not.toContain('This refund has been recorded by the reservation system.');
    });

    it('multi-leg itinerary rendering: shows all legs and flags [CANCELLED FLIGHT] for affected leg', async () => {
      await service.sendCancellationEmail({
        toEmail: 'multileg@example.com',
        passengerName: 'Connecting Passenger',
        bookingReference: 'PNR-MULTI',
        cancellationNumber: 'CAN-MULTI',
        cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
        originalBookingStatus: 'CONFIRMED',
        flightNumber: 'VN202',
        refundAmount: 3000000,
        currency: 'VND',
        itinerary: [
          {
            flightNumber: 'VN201',
            origin: 'SGN',
            destination: 'HAN',
            cabinClass: 'ECONOMY',
            departureTimeFormatted: '2026-10-28 06:00 (Asia/Ho_Chi_Minh)',
            isAffected: false,
          },
          {
            flightNumber: 'VN202',
            origin: 'HAN',
            destination: 'NRT',
            cabinClass: 'ECONOMY',
            departureTimeFormatted: '2026-10-28 11:00 (Asia/Ho_Chi_Minh)',
            isAffected: true,
          },
        ],
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).toContain('VN201');
      expect(html).toContain('SGN → HAN');
      expect(html).toContain('VN202');
      expect(html).toContain('HAN → NRT');
      expect(html).toContain('[CANCELLED FLIGHT]');
    });

    it('disruption email renders statusText, reason, formatted local times, and Track Booking guidance', async () => {
      await service.sendFlightDisruptionEmail({
        toEmail: 'disruption@example.com',
        passengerName: 'Affected Passenger',
        bookingReference: 'PNR-DISRUPT',
        flightNumber: 'VN303',
        origin: 'HAN',
        destination: 'SGN',
        disruptionType: 'DELAY',
        originalDepartureFormatted: '2026-10-28 10:00 (Asia/Ho_Chi_Minh)',
        newDepartureFormatted: '2026-10-28 13:00 (Asia/Ho_Chi_Minh)',
        originalArrivalFormatted: '2026-10-28 12:00 (Asia/Ho_Chi_Minh)',
        newArrivalFormatted: '2026-10-28 15:00 (Asia/Ho_Chi_Minh)',
        delayReason: 'Technical inspection requirement',
        statusText: 'DELAYED',
      });

      const html = sendMailSpy.mock.calls[0][2];
      expect(html).toContain('Flight Status:');
      expect(html).toContain('DELAYED');
      expect(html).toContain('Technical inspection requirement');
      expect(html).toContain('2026-10-28 10:00 (Asia/Ho_Chi_Minh)');
      expect(html).toContain('2026-10-28 13:00 (Asia/Ho_Chi_Minh)');
      expect(html).toContain('Please use Track Booking to check the latest flight status and trip details.');
    });
  });

  describe('Bounded retry with live transporter', () => {
    it('retries up to 3 times on transient failure and succeeds when transporter resolves', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '587';
      process.env.NODE_ENV = 'test';

      const service = new MailService();
      const mockTransporter: any = {
        sendMail: jest
          .fn()
          .mockRejectedValueOnce(new Error('Connection timeout'))
          .mockResolvedValueOnce({ messageId: 'msg-123' }),
      };
      (service as any).transporter = mockTransporter;

      const result = await service.sendMail('test@example.com', 'Retry Test', '<p>Hello</p>');

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
    });

    it('fails gracefully and returns false after 3 failed attempts without throwing', async () => {
      process.env.SMTP_HOST = 'smtp.test.local';
      process.env.SMTP_PORT = '587';
      process.env.NODE_ENV = 'test';

      const service = new MailService();
      const mockTransporter: any = {
        sendMail: jest.fn().mockRejectedValue(new Error('Permanent SMTP auth error')),
      };
      (service as any).transporter = mockTransporter;

      const result = await service.sendMail('test@example.com', 'Failure Test', '<p>Hello</p>');

      expect(result).toBe(false);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(3);
    });
  });
});
