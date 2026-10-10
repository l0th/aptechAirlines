/**
 * Shared HTML layout for every Aptech Airlines transactional email.
 * Visual language: navy header (#071b2e), gold eyebrow, rounded card body,
 * gold highlight box for key identifiers.
 */
import type { MailLang } from './mail-i18n';

export interface MailLayoutOptions {
  /** Heading shown in the navy header. Plain text (escaped by the caller if dynamic). */
  title: string;
  /** Inner body HTML (already escaped where needed). */
  body: string;
  /** Optional accent colour for the thin bar under the header (status colour). */
  accent?: string;
  /** Footer text line. */
  footer?: string;
  /** Email language; controls the default footer. Defaults to Vietnamese. */
  lang?: MailLang;
}

export const MAIL_COLORS = {
  navy: '#071b2e',
  gold: '#f2c85f',
  goldBg: '#fff7df',
  goldBorder: '#efd783',
  muted: '#64748b',
  border: '#e2e8f0',
  danger: '#b91c1c',
  success: '#15803d',
  warning: '#b45309',
};

export function renderLayout(opts: MailLayoutOptions): string {
  const lang: MailLang = opts.lang === 'en' ? 'en' : 'vi';
  const accent = opts.accent
    ? `<div style="height:4px;background:${opts.accent}"></div>`
    : '';
  const footer =
    opts.footer ||
    (lang === 'en'
      ? 'Aptech Airlines • Automated Service Notification • Please do not reply directly to this email.'
      : 'Aptech Airlines • Thông báo tự động • Vui lòng không trả lời trực tiếp email này.');
  return `
      <div lang="${lang}" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;line-height:1.6">
        <div style="background:${MAIL_COLORS.navy};color:#fff;padding:22px 24px;border-radius:14px 14px 0 0">
          <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:${MAIL_COLORS.gold}">APTECH AIRLINES</div>
          <h2 style="margin:8px 0 0">${opts.title}</h2>
        </div>
        ${accent}
        <div style="border:1px solid ${MAIL_COLORS.border};border-top:0;padding:24px;border-radius:0 0 14px 14px">
          ${opts.body}
          <p style="color:${MAIL_COLORS.muted};font-size:12px;margin-top:28px;border-top:1px solid ${MAIL_COLORS.border};padding-top:12px">${footer}</p>
        </div>
      </div>`;
}

/** Gold highlight box used for PNR / codes. */
export function highlightBox(inner: string): string {
  return `<div style="background:${MAIL_COLORS.goldBg};border:1px solid ${MAIL_COLORS.goldBorder};padding:14px;border-radius:12px;margin:16px 0">${inner}</div>`;
}

/** Neutral info box. */
export function infoBox(inner: string): string {
  return `<div style="background:#f8fafc;border:1px solid ${MAIL_COLORS.border};padding:14px;border-radius:12px;margin:16px 0">${inner}</div>`;
}
