import {
  isValidIanaTimeZone,
  formatWallParts,
  utcToWallTime,
  extractWallDate,
  wallTimeToUtc,
  computePhysicalDurationMinutes,
  getTimezoneGmtOffset,
  getTimezoneOffsetMinutes,
} from './timezone.util';

describe('Timezone Utility (timezone.util)', () => {
  describe('isValidIanaTimeZone', () => {
    it('should validate valid IANA timezones', () => {
      expect(isValidIanaTimeZone('Asia/Ashgabat')).toBe(true);
      expect(isValidIanaTimeZone('Europe/Berlin')).toBe(true);
      expect(isValidIanaTimeZone('Pacific/Kiritimati')).toBe(true);
      expect(isValidIanaTimeZone('Pacific/Honolulu')).toBe(true);
      expect(isValidIanaTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    });

    it('should reject invalid, malformed, or empty timezones', () => {
      expect(isValidIanaTimeZone('')).toBe(false);
      expect(isValidIanaTimeZone(null as any)).toBe(false);
      expect(isValidIanaTimeZone(undefined as any)).toBe(false);
      expect(isValidIanaTimeZone('Invalid/Zone')).toBe(false);
      expect(isValidIanaTimeZone('GMT+7')).toBe(false); // only valid IANA
    });
  });

  describe('ASB -> FRA Summer (2026-09-23)', () => {
    const depUtc = '2026-09-23T08:20:00.000Z';
    const arrUtc = '2026-09-23T14:20:00.000Z';

    it('should format ASB and FRA summer wall times correctly', () => {
      const asbWall = utcToWallTime(depUtc, 'Asia/Ashgabat');
      const fraWall = utcToWallTime(arrUtc, 'Europe/Berlin');

      expect(asbWall).toBe('2026-09-23T13:20');
      expect(fraWall).toBe('2026-09-23T16:20'); // CEST (UTC+2)
    });

    it('should convert summer wall times back to identical UTC instants', () => {
      const depResult = wallTimeToUtc('2026-09-23T13:20', 'Asia/Ashgabat');
      const arrResult = wallTimeToUtc('2026-09-23T16:20', 'Europe/Berlin');

      expect(depResult.success).toBe(true);
      expect(depResult.iso).toBe(depUtc);

      expect(arrResult.success).toBe(true);
      expect(arrResult.iso).toBe(arrUtc);

      const duration = computePhysicalDurationMinutes(depResult.date!, arrResult.date!);
      expect(duration).toBe(360);
    });
  });

  describe('ASB -> FRA Winter (2026-10-28)', () => {
    const depUtc = '2026-10-28T08:20:00.000Z';
    const arrUtc = '2026-10-28T14:20:00.000Z';

    it('should format ASB and FRA winter wall times correctly', () => {
      const asbWall = utcToWallTime(depUtc, 'Asia/Ashgabat');
      const fraWall = utcToWallTime(arrUtc, 'Europe/Berlin');

      expect(asbWall).toBe('2026-10-28T13:20');
      expect(fraWall).toBe('2026-10-28T15:20'); // CET (UTC+1)
    });

    it('should convert winter wall times back to identical UTC instants', () => {
      const depResult = wallTimeToUtc('2026-10-28T13:20', 'Asia/Ashgabat');
      const arrResult = wallTimeToUtc('2026-10-28T15:20', 'Europe/Berlin');

      expect(depResult.success).toBe(true);
      expect(depResult.iso).toBe(depUtc);

      expect(arrResult.success).toBe(true);
      expect(arrResult.iso).toBe(arrUtc);

      const duration = computePhysicalDurationMinutes(depResult.date!, arrResult.date!);
      expect(duration).toBe(360); // 360 min physical flight duration, not 540
    });
  });

  describe('DST Transitions', () => {
    it('should reject spring-forward nonexistent wall time', () => {
      // Clocks jump 02:00 -> 03:00 on 2026-03-29 in Europe/Berlin
      const result = wallTimeToUtc('2026-03-29T02:30', 'Europe/Berlin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('NONEXISTENT_WALL_TIME');
    });

    it('should reject ambiguous fall-back wall time when preferUtc is not provided', () => {
      // Clocks turn back 03:00 -> 02:00 on 2026-10-25 in Europe/Berlin
      const result = wallTimeToUtc('2026-10-25T02:30', 'Europe/Berlin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('AMBIGUOUS_WALL_TIME');
      expect(result.candidates?.length).toBe(2);
    });

    it('should preserve original ambiguous occurrence when preferUtc matches', () => {
      const occurrence1 = '2026-10-25T00:30:00.000Z'; // CEST
      const occurrence2 = '2026-10-25T01:30:00.000Z'; // CET

      const res1 = wallTimeToUtc('2026-10-25T02:30', 'Europe/Berlin', occurrence1);
      expect(res1.success).toBe(true);
      expect(res1.iso).toBe(occurrence1);
      expect(res1.isAmbiguous).toBe(true);

      const res2 = wallTimeToUtc('2026-10-25T02:30', 'Europe/Berlin', occurrence2);
      expect(res2.success).toBe(true);
      expect(res2.iso).toBe(occurrence2);
      expect(res2.isAmbiguous).toBe(true);
    });

    it('should reject ambiguous wall time when preferUtc does not match', () => {
      const unrelatedUtc = '2026-10-25T12:00:00.000Z';
      const result = wallTimeToUtc('2026-10-25T02:30', 'Europe/Berlin', unrelatedUtc);
      expect(result.success).toBe(false);
      expect(result.error).toBe('AMBIGUOUS_WALL_TIME');
    });
  });

  describe('Local Date Preservation (UTC+14 to UTC-12)', () => {
    it('should extract local date for UTC+14 (Pacific/Kiritimati)', () => {
      const wallTime = '2026-10-28T01:30';
      const localDate = extractWallDate(wallTime);
      expect(localDate).toBe('2026-10-28');

      const utcResult = wallTimeToUtc(wallTime, 'Pacific/Kiritimati');
      expect(utcResult.success).toBe(true);
      // UTC instant is 2026-10-27T11:30:00.000Z (previous calendar date in UTC)
      expect(utcResult.iso).toBe('2026-10-27T11:30:00.000Z');
      // But the airport local date remains strictly 2026-10-28
      expect(localDate).toBe('2026-10-28');
    });

    it('should extract local date for UTC-10 (Pacific/Honolulu)', () => {
      const wallTime = '2026-10-28T23:30';
      const localDate = extractWallDate(wallTime);
      expect(localDate).toBe('2026-10-28');

      const utcResult = wallTimeToUtc(wallTime, 'Pacific/Honolulu');
      expect(utcResult.success).toBe(true);
      // UTC instant is 2026-10-29T09:30:00.000Z (next calendar date in UTC)
      expect(utcResult.iso).toBe('2026-10-29T09:30:00.000Z');
      // But the airport local date remains strictly 2026-10-28
      expect(localDate).toBe('2026-10-28');
    });
  });

  describe('Fail Closed on Invalid Timezones', () => {
    it('should return empty string on invalid timezone in utcToWallTime', () => {
      expect(utcToWallTime('2026-10-28T08:20:00.000Z', 'Invalid/Zone')).toBe('');
      expect(utcToWallTime('2026-10-28T08:20:00.000Z', '')).toBe('');
      expect(utcToWallTime('2026-10-28T08:20:00.000Z', null as any)).toBe('');
    });

    it('should return INVALID_TIMEZONE in wallTimeToUtc', () => {
      const res1 = wallTimeToUtc('2026-10-28T13:20', 'Invalid/Zone');
      expect(res1.success).toBe(false);
      expect(res1.error).toBe('INVALID_TIMEZONE');

      const res2 = wallTimeToUtc('2026-10-28T13:20', '');
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('INVALID_TIMEZONE');
    });

    it('should throw an error in formatWallParts on invalid timezone', () => {
      expect(() => formatWallParts(new Date(), 'Invalid/Zone')).toThrowError(/INVALID_TIMEZONE/);
    });

    it('should return INVALID_TZ / NaN in offset helpers', () => {
      expect(getTimezoneGmtOffset('Invalid/Zone')).toBe('INVALID_TZ');
      expect(isNaN(getTimezoneOffsetMinutes('Invalid/Zone'))).toBe(true);
    });
  });
});
