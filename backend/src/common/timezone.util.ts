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
