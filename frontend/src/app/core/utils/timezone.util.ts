/**
 * Timezone and Wall-Time Conversion Utilities
 *
 * Deterministic conversion between UTC instants and airport local wall times
 * using Intl.DateTimeFormat (IANA timezones), supporting DST transitions,
 * detecting nonexistent wall times (spring-forward), and handling ambiguous times (fall-back).
 *
 * FAIL CLOSED POLICY:
 * - Timezone must be a valid non-empty IANA timezone.
 * - If timezone is missing or invalid, conversion fails explicitly (error: 'INVALID_TIMEZONE').
 * - Ambiguous wall times without a matching preferUtc fail explicitly (error: 'AMBIGUOUS_WALL_TIME').
 * - Nonexistent wall times (spring forward) fail explicitly (error: 'NONEXISTENT_WALL_TIME').
 */

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface WallToUtcResult {
  success: boolean;
  date?: Date;
  iso?: string;
  isAmbiguous?: boolean;
  candidates?: string[];
  error?: 'INVALID_FORMAT' | 'INVALID_TIMEZONE' | 'NONEXISTENT_WALL_TIME' | 'AMBIGUOUS_WALL_TIME';
}

/**
 * Validates that the provided timezone string is a valid IANA timezone name.
 */
export function isValidIanaTimeZone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a Date instant into individual wall parts in the target IANA timezone.
 * Throws an Error if the timezone is invalid (fails closed).
 */
export function formatWallParts(date: Date, timeZone: string): WallParts {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(`INVALID_TIMEZONE: "${timeZone}" is not a valid IANA timezone.`);
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(date);
  const p: Partial<WallParts> = {};
  for (const part of parts) {
    if (part.type === 'year') p.year = parseInt(part.value, 10);
    else if (part.type === 'month') p.month = parseInt(part.value, 10);
    else if (part.type === 'day') p.day = parseInt(part.value, 10);
    else if (part.type === 'hour') p.hour = parseInt(part.value, 10);
    else if (part.type === 'minute') p.minute = parseInt(part.value, 10);
  }

  return {
    year: p.year ?? date.getUTCFullYear(),
    month: p.month ?? date.getUTCMonth() + 1,
    day: p.day ?? date.getUTCDate(),
    hour: p.hour ?? date.getUTCHours(),
    minute: p.minute ?? date.getUTCMinutes(),
  };
}

/**
 * Converts a UTC instant (ISO string or Date) into a datetime-local string (YYYY-MM-DDTHH:mm)
 * in the specified airport IANA timezone.
 * Returns empty string if instant or timezone is invalid (fails closed).
 */
export function utcToWallTime(utc: string | Date | undefined, timeZone?: string | null): string {
  if (!utc || !timeZone || !isValidIanaTimeZone(timeZone)) return '';
  const d = utc instanceof Date ? utc : new Date(utc);
  if (isNaN(d.getTime())) return '';

  const parts = formatWallParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Extracts the local calendar date (YYYY-MM-DD) from a local wall time string (YYYY-MM-DDTHH:mm).
 * Preserves the exact origin airport local date without browser or UTC date skew.
 */
export function extractWallDate(wallStr?: string | null): string | null {
  if (!wallStr) return null;
  const match = String(wallStr).trim().match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}

/**
 * Converts a datetime-local wall time (YYYY-MM-DDTHH:mm) in a specific IANA timezone into a UTC instant.
 *
 * Rules:
 * 1. Fails with INVALID_TIMEZONE if timezone is missing or not a valid IANA timezone name.
 * 2. Fails with INVALID_FORMAT if wallStr is malformed.
 * 3. Fails with NONEXISTENT_WALL_TIME if clock skipped forward (spring-forward gap).
 * 4. In case of ambiguous wall time (fall-back overlap):
 *    - If preferUtc matches one of the valid occurrences, preserves that exact occurrence.
 *    - If preferUtc does NOT match, fails with AMBIGUOUS_WALL_TIME (does not silently guess).
 */
export function wallTimeToUtc(
  wallStr: string,
  timeZone?: string | null,
  preferUtc?: string | Date | null,
): WallToUtcResult {
  if (!wallStr) return { success: false, error: 'INVALID_FORMAT' };
  if (!timeZone || !isValidIanaTimeZone(timeZone)) return { success: false, error: 'INVALID_TIMEZONE' };

  const match = String(wallStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return { success: false, error: 'INVALID_FORMAT' };

  const [_, yStr, mStr, dStr, hStr, minStr] = match;
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  const h = parseInt(hStr, 10);
  const min = parseInt(minStr, 10);

  const tz = timeZone.trim();
  const targetUtcEpoch = Date.UTC(y, m - 1, d, h, min, 0, 0);

  // Guess UTC instant by treating wall clock as UTC
  const guess = new Date(targetUtcEpoch);
  const guessWall = formatWallParts(guess, tz);
  const guessWallEpoch = Date.UTC(guessWall.year, guessWall.month - 1, guessWall.day, guessWall.hour, guessWall.minute, 0, 0);
  const offsetMs = guessWallEpoch - targetUtcEpoch;

  // Search window of candidate offsets in 15-minute increments around offsetMs (+/- 2 hours)
  const validCandidates: Date[] = [];
  for (let delta = -120 * 60000; delta <= 120 * 60000; delta += 15 * 60000) {
    const candidateEpoch = targetUtcEpoch - offsetMs + delta;
    const candidate = new Date(candidateEpoch);
    const wall = formatWallParts(candidate, tz);
    if (wall.year === y && wall.month === m && wall.day === d && wall.hour === h && wall.minute === min) {
      if (!validCandidates.some((c) => c.getTime() === candidate.getTime())) {
        validCandidates.push(candidate);
      }
    }
  }

  // Nonexistent wall time (e.g. spring-forward transition)
  if (validCandidates.length === 0) {
    return { success: false, error: 'NONEXISTENT_WALL_TIME' };
  }

  // Exactly one unambiguous match
  if (validCandidates.length === 1) {
    return { success: true, date: validCandidates[0], iso: validCandidates[0].toISOString() };
  }

  // Multiple candidates (DST fall back ambiguity)
  if (preferUtc) {
    const prefTime = new Date(preferUtc).getTime();
    const matched = validCandidates.find((c) => c.getTime() === prefTime);
    if (matched) {
      return { success: true, date: matched, iso: matched.toISOString(), isAmbiguous: true };
    }
  }

  // Ambiguous and no matching preferUtc => fail closed (do NOT silently guess)
  return {
    success: false,
    error: 'AMBIGUOUS_WALL_TIME',
    candidates: validCandidates.map((c) => c.toISOString()),
  };
}

/**
 * Calculates physical flight duration in minutes between two UTC instants.
 */
export function computePhysicalDurationMinutes(depUtc: string | Date, arrUtc: string | Date): number {
  const dep = depUtc instanceof Date ? depUtc : new Date(depUtc);
  const arr = arrUtc instanceof Date ? arrUtc : new Date(arrUtc);
  if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return 0;
  const duration = Math.round((arr.getTime() - dep.getTime()) / 60000);
  return duration > 0 ? duration : 0;
}

/**
 * Returns formatted GMT offset string for a timezone at a given date (e.g. 'GMT+5', 'GMT+2', 'GMT-5').
 * Returns 'INVALID_TZ' if timezone is invalid (never silently defaults to GMT+7).
 */
export function getTimezoneGmtOffset(timeZone?: string | null, refDate?: Date): string {
  if (!timeZone || !isValidIanaTimeZone(timeZone)) return 'INVALID_TZ';
  try {
    const d = refDate && !isNaN(refDate.getTime()) ? refDate : new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim(),
      timeZoneName: 'shortOffset',
    });
    const parts = dtf.formatToParts(d);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzName) return tzName === 'GMT' ? 'GMT+0' : tzName;
  } catch {}
  return 'INVALID_TZ';
}

/**
 * Returns timezone offset in minutes at a given date for an IANA timezone.
 * Returns NaN if timezone is invalid (fails closed).
 */
export function getTimezoneOffsetMinutes(timeZone?: string | null, refDate?: Date): number {
  if (!timeZone || !isValidIanaTimeZone(timeZone)) return NaN;
  try {
    const d = refDate && !isNaN(refDate.getTime()) ? refDate : new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim(),
      timeZoneName: 'longOffset',
    });
    const parts = dtf.formatToParts(d);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzName || tzName === 'GMT') return 0;
    const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    return sign * (hours * 60 + minutes);
  } catch {
    return NaN;
  }
}
