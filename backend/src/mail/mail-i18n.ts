/** Per-language content helpers. Outbound email combines both languages. */
export type MailLang = 'vi' | 'en';

export const DEFAULT_MAIL_LANG: MailLang = 'vi';

/** Normalise any incoming value (header, query, DB field) to a supported language. */
export function normalizeMailLang(value: unknown): MailLang {
  const v = String(Array.isArray(value) ? value[0] : value ?? '')
    .trim()
    .toLowerCase();
  return v.startsWith('en') ? 'en' : 'vi';
}

/** Returns `true` when the value is an explicit, supported language code. */
export function isMailLang(value: unknown): value is MailLang {
  return value === 'vi' || value === 'en';
}

/** Tiny helper: pick the Vietnamese or English variant. */
export function pick(lang: MailLang, vi: string, en: string): string {
  return lang === 'en' ? en : vi;
}

/**
 * Build one bilingual email from existing single-language renderers.
 * Renderers return HTML fragments (not nested html/head/body documents),
 * so this is safe to place directly into one email or the admin preview.
 */
export function renderBilingualMail(
  render: (lang: MailLang) => { subject: string; html: string },
): { subject: string; html: string } {
  const vi = render('vi');
  const en = render('en');
  return {
    subject: `${vi.subject} | ${en.subject}`,
    html: `<div style="margin:0 auto;max-width:640px">
      <section lang="vi" aria-label="Tiếng Việt">${vi.html}</section>
      <div role="separator" style="margin:28px auto;border-top:2px solid #e2e8f0;text-align:center;color:#64748b;font:12px Arial,sans-serif;padding:16px 0">English version below · Bản tiếng Anh bên dưới</div>
      <section lang="en" aria-label="English">${en.html}</section>
    </div>`,
  };
}

/** VND amount formatting (dot thousands separator, e.g. 1.800.000). */
export function formatAmount(_lang: MailLang, amount: number): string {
  return Number(amount || 0).toLocaleString('vi-VN');
}

/** Cabin class label. English keeps the original code (ECONOMY, BUSINESS...). */
export function cabinLabel(lang: MailLang, cabin?: string): string {
  if (!cabin) return '';
  if (lang === 'en') return cabin;
  const vi: Record<string, string> = {
    ECONOMY: 'Phổ thông',
    PREMIUM_ECONOMY: 'Phổ thông đặc biệt',
    BUSINESS: 'Thương gia',
    FIRST: 'Hạng nhất',
    FIRST_CLASS: 'Hạng nhất',
  };
  return vi[String(cabin).toUpperCase()] || cabin;
}

/** Flight status label. English keeps the original code (DELAYED, SCHEDULED...). */
export function flightStatusLabel(lang: MailLang, status?: string): string {
  if (!status) return '';
  if (lang === 'en') return status;
  const vi: Record<string, string> = {
    SCHEDULED: 'Đúng lịch',
    DELAYED: 'Trễ chuyến',
    CANCELLED: 'Đã hủy',
    DEPARTED: 'Đã khởi hành',
    ARRIVED: 'Đã hạ cánh',
  };
  return vi[String(status).toUpperCase()] || status;
}
