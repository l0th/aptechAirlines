import { formatMailDateTime } from './mail-i18n';
import {
  renderBlockedTicketReminder,
  renderExpiredHoldCancellationEmail,
  renderFlightDisruptionEmail,
} from './mail-renderers';

describe('formatMailDateTime', () => {
  it('renders canonical timestamps as dd/MM/yyyy without changing the time or timezone', () => {
    expect(formatMailDateTime('2026-11-02 08:30 (Asia/Ho_Chi_Minh)'))
      .toBe('02/11/2026 08:30 (Asia/Ho_Chi_Minh)');
    expect(formatMailDateTime('2026-01-09T14:05:00Z')).toBe('09/01/2026T14:05:00Z');
  });
});

describe('mail date rendering', () => {
  it('never exposes canonical year-first dates to customers', () => {
    const expired = renderExpiredHoldCancellationEmail({
      lang: 'vi', toEmail: 'customer@example.com', passengerName: 'Customer', bookingReference: 'PNR-1',
      blockingNumber: 'BLK-1', cancellationNumber: 'CAN-1',
      holdDeadlineFormatted: '2026-10-25 23:59 (Asia/Ho_Chi_Minh)',
    });
    const disruption = renderFlightDisruptionEmail({
      lang: 'vi', toEmail: 'customer@example.com', passengerName: 'Customer', bookingReference: 'PNR-1',
      flightNumber: 'APT101', origin: 'SGN', destination: 'HAN', disruptionType: 'DELAY', statusText: 'DELAYED',
      originalDepartureFormatted: '2026-10-28 08:00', newDepartureFormatted: '2026-10-28 10:30',
      originalArrivalFormatted: '2026-10-28 09:20', newArrivalFormatted: '2026-10-28 11:50',
    });
    const reminder = renderBlockedTicketReminder({
      lang: 'vi', toEmail: 'customer@example.com', passengerName: 'Customer', bookingReference: 'PNR-1',
      blockingNumber: 'BLK-1', earliestDepartureFormatted: '2026-11-02 08:30',
      deadlineFormatted: '2026-10-19 08:30', legs: [],
    });

    for (const rendered of [expired, disruption, reminder]) {
      expect(rendered.html).not.toMatch(/2026-(10|11)-/);
    }
    expect(expired.html).toContain('25/10/2026 23:59');
    expect(disruption.html).toContain('28/10/2026 10:30');
    expect(reminder.html).toContain('02/11/2026 08:30');
  });
});
