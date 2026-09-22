import { formatLocalTime } from './timezone.util';

describe('Timezone Util - formatLocalTime (Fail-Closed Policy)', () => {
  it('formats UTC instant correctly in target airport IANA timezone', () => {
    // 2026-10-28 08:20:00Z in Asia/Ashgabat (GMT+5) = 2026-10-28 13:20
    const asbTime = formatLocalTime(new Date('2026-10-28T08:20:00.000Z'), 'Asia/Ashgabat');
    expect(asbTime).toBe('2026-10-28 13:20');

    // 2026-10-28 14:20:00Z in Europe/Berlin (winter GMT+1) = 2026-10-28 15:20
    const fraWinterTime = formatLocalTime(new Date('2026-10-28T14:20:00.000Z'), 'Europe/Berlin');
    expect(fraWinterTime).toBe('2026-10-28 15:20');

    // 2026-07-15 10:00:00Z in Europe/Berlin (summer DST GMT+2) = 2026-07-15 12:00
    const fraSummerTime = formatLocalTime(new Date('2026-07-15T10:00:00.000Z'), 'Europe/Berlin');
    expect(fraSummerTime).toBe('2026-07-15 12:00');
  });

  it('handles date crossing midnight into next/previous calendar day in airport local time', () => {
    // 2026-10-28 22:30:00Z in Asia/Tokyo (GMT+9) = 2026-10-29 07:30
    const tokyoTime = formatLocalTime(new Date('2026-10-28T22:30:00.000Z'), 'Asia/Tokyo');
    expect(tokyoTime).toBe('2026-10-29 07:30');

    // 2026-10-28 02:30:00Z in America/New_York (EDT GMT-4) = 2026-10-27 22:30
    const nyTime = formatLocalTime(new Date('2026-10-28T02:30:00.000Z'), 'America/New_York');
    expect(nyTime).toBe('2026-10-27 22:30');
  });

  it('fails closed when date is missing or invalid', () => {
    expect(formatLocalTime(undefined, 'Asia/Ho_Chi_Minh')).toBeUndefined();
    expect(formatLocalTime(null, 'Asia/Ho_Chi_Minh')).toBeUndefined();
    expect(formatLocalTime('not-a-date', 'Asia/Ho_Chi_Minh')).toBeUndefined();
  });

  it('fails closed when timezone is missing, empty, or invalid IANA name (never defaults to UTC)', () => {
    const instant = new Date('2026-10-28T08:20:00.000Z');
    expect(formatLocalTime(instant, undefined)).toBeUndefined();
    expect(formatLocalTime(instant, null as any)).toBeUndefined();
    expect(formatLocalTime(instant, '')).toBeUndefined();
    expect(formatLocalTime(instant, 'Invalid/Timezone')).toBeUndefined();
    expect(formatLocalTime(instant, 'GMT+7')).toBeUndefined();
    expect(formatLocalTime(instant, 'NotAZone')).toBeUndefined();
  });
});
