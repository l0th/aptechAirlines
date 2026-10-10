/** UI-only date formatting. API and database values remain ISO yyyy-MM-dd. */
export function normalizeCalendarDate(value: unknown): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** Return the local calendar day in API-safe form without converting through UTC. */
export function localCalendarDate(date = new Date()): string {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatCalendarDate(value: unknown, fallback = '—'): string {
  if (!value) return fallback;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

/** Convert the visible dd/MM/yyyy value back to API-safe yyyy-MM-dd. */
export function parseDayFirstCalendarDate(value: unknown, min = '', max = ''): string {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if ((min && iso < min) || (max && iso > max)) return '';
  return iso;
}

export function formatDateTimeDayFirst(value: unknown, fallback = '—'): string {
  if (!value) return fallback;
  const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

/** Format canonical dates embedded in user-facing notices without changing API values. */
export function formatDayFirstDatesInText(value: string): string {
  return String(value || '')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1')
    .replace(/\bYYYY-MM-DD\b/gi, 'dd/mm/yyyy');
}
