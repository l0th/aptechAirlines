/**
 * Timezone utilities to handle international flight dates properly.
 * Spec 3.3.6: Flight duration must take into account timezone changes.
 * AirLabs: Returns dep_time/arr_time in local time, requiring proper conversion to UTC.
 */

// Lấy offset phút của một múi giờ IANA tại một thời điểm Date nhất định.
// Sử dụng Intl.DateTimeFormat để không bị phụ thuộc vào múi giờ của server đang chạy.
export function utcOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT+08:00" or "GMT"
  if (!tzName || tzName === 'GMT') {
    return 0;
  }
  const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3], 10);
  return sign * (hours * 60 + minutes);
}

// Chuyển đổi giờ địa phương ("YYYY-MM-DD" + "HH:mm") tại múi giờ timeZone thành Date UTC chuẩn.
export function localWallTimeToUtc(dateStr: string, hhmm: string, timeZone: string): Date {
  const isoStr = `${dateStr}T${hhmm}:00`;
  const tempDate = new Date(isoStr + 'Z'); 
  const offset = utcOffsetMinutes(tempDate, timeZone);
  // Subtract offset to move from UTC-interpreted time to real UTC
  return new Date(tempDate.getTime() - offset * 60 * 1000);
}

// Lấy ngày local "YYYY-MM-DD" từ UTC Date (phục vụ search nội địa theo timezone sân bay khởi hành).
export function localDateKey(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date);
}

// Đọc định dạng UTC của AirLabs "YYYY-MM-DD HH:mm" thành Date
export function parseUtcWallTime(value: string): Date {
  return new Date(value.replace(' ', 'T') + ':00Z');
}

import { BadRequestException } from '@nestjs/common';

/**
 * Format an instant into local wall clock date and time (YYYY-MM-DD and HH:mm) in timeZone.
 */
export function getLocalWallTimeParts(
  date: Date,
  timeZone: string,
): { dateStr: string; hhmm: string; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  let h = get('hour');
  if (h === '24') h = '00';
  const m = get('minute');
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const hhmm = `${h}:${m}`;
  return {
    dateStr,
    hhmm,
    hour: parseInt(h, 10),
    minute: parseInt(m, 10),
  };
}

/**
 * DST-safe conversion of local wall time to UTC for AirLabs commercial flights.
 * 
 * Invariants:
 * 1. Resolves correct UTC instant for named IANA timezone on the concrete operating date.
 * 2. Round-trips UTC -> local to verify requested local date and time are preserved.
 * 3. If providerUtcTime is supplied:
 *    - Unique local instant: compare its UTC HH:mm against providerUtcTime; if match return it, else throw BadRequestException.
 *    - Ambiguous local time (fall-back overlap): choose matching instant; if provider UTC matches none, reject.
 *      Never fall back to earlier occurrence when providerUtcTime is supplied.
 *    - Nonexistent local time (spring-forward gap): providerUtcTime is authoritative if it aligns with service date,
 *      otherwise reject.
 * 4. If providerUtcTime is absent:
 *    - Unique local instant: return it.
 *    - Ambiguous local time: select earlier occurrence (documented daylight saving policy).
 *    - Nonexistent local time: reject with BadRequestException.
 */
export function resolveLocalWallTimeToUtc(
  dateStr: string,
  hhmm: string,
  timeZone: string,
  providerUtcTime?: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const approxUtcMs = Date.UTC(y, m - 1, d, hh, mm);

  // Sample offsets around approxUtcMs (-24h to +24h)
  const candidateOffsets = new Set<number>();
  for (const hOffset of [-24, -12, 0, 12, 24]) {
    const sampleDate = new Date(approxUtcMs + hOffset * 3600000);
    candidateOffsets.add(utcOffsetMinutes(sampleDate, timeZone));
  }

  const validInstants: Date[] = [];
  for (const off of candidateOffsets) {
    const candidate = new Date(approxUtcMs - off * 60000);
    const local = getLocalWallTimeParts(candidate, timeZone);
    if (local.dateStr === dateStr && local.hhmm === hhmm) {
      validInstants.push(candidate);
    }
  }

  // Deduplicate by timestamp
  const uniqueInstants = Array.from(
    new Map(validInstants.map((inst) => [inst.getTime(), inst])).values(),
  ).sort((a, b) => a.getTime() - b.getTime());

  const hasProviderUtc = Boolean(providerUtcTime && providerUtcTime.trim().length > 0);
  let ph = -1;
  let pm = -1;
  if (hasProviderUtc) {
    const parts = providerUtcTime!.trim().split(':').map(Number);
    ph = parts[0];
    pm = parts[1];
  }

  if (uniqueInstants.length === 1) {
    const inst = uniqueInstants[0];
    if (hasProviderUtc) {
      if (inst.getUTCHours() === ph && inst.getUTCMinutes() === pm) {
        return inst;
      }
      const actualUtcHhmm = `${String(inst.getUTCHours()).padStart(2, '0')}:${String(inst.getUTCMinutes()).padStart(2, '0')}`;
      throw new BadRequestException(
        `Source data inconsistent: local wall time "${dateStr} ${hhmm}" in timezone "${timeZone}" resolves to UTC ${actualUtcHhmm}, conflicting with provider UTC time "${providerUtcTime}".`,
      );
    }
    return inst;
  }

  if (uniqueInstants.length === 0) {
    // Nonexistent local time (spring-forward gap)
    if (hasProviderUtc) {
      // Validate relationship to requested service date
      for (const dayOff of [-1, 0, 1]) {
        const cand = new Date(Date.UTC(y, m - 1, d + dayOff, ph, pm));
        if (localDateKey(cand, timeZone) === dateStr) {
          return cand;
        }
      }
      throw new BadRequestException(
        `Source data inconsistent: nonexistent local wall time "${dateStr} ${hhmm}" in timezone "${timeZone}" and provider UTC time "${providerUtcTime}" does not align with service date "${dateStr}".`,
      );
    }
    throw new BadRequestException(
      `Local wall time "${dateStr} ${hhmm}" does not exist in timezone "${timeZone}" due to DST spring-forward transition.`,
    );
  }

  // Ambiguous local time (fall-back overlap: uniqueInstants.length > 1)
  if (hasProviderUtc) {
    for (const inst of uniqueInstants) {
      if (inst.getUTCHours() === ph && inst.getUTCMinutes() === pm) {
        return inst;
      }
    }
    throw new BadRequestException(
      `Source data inconsistent: ambiguous local wall time "${dateStr} ${hhmm}" in timezone "${timeZone}" does not match provider UTC time "${providerUtcTime}".`,
    );
  }

  // Documented policy: for ambiguous fall-back wall times without providerUtcTime,
  // select the earlier instant (first occurrence / daylight saving time).
  return uniqueInstants[0];
}
