/**
 * Faithful frontend port of backend/src/common/pricing.util.ts (earlyBirdQuote, loadFactorQuote,
 * frequentFlyerTier, applyPricing). Used only for the admin "Máy tính thử giá" preview.
 */
export type AdvanceRule = { min_days: number; max_days: number | null; adjustment_percent: number; label: string; label_en: string };
export type LoadRule = { min_load_percent: number; max_load_percent: number; adjustment_percent: number; label: string; label_en: string };
export type PricingProfileLike = { advance_rules?: AdvanceRule[]; load_factor_rules?: LoadRule[] } | null | undefined;
type Quote = { multiplier: number; percent: number; label: string; matched: boolean };

export function earlyBirdQuote(daysUntilDeparture: number, profile?: PricingProfileLike): Quote {
  const days = Math.floor(daysUntilDeparture < 0 ? 0 : daysUntilDeparture);
  const c = profile?.advance_rules?.slice().sort((a, b) => a.min_days - b.min_days)
    .find(r => days >= r.min_days && (r.max_days === null || r.max_days === undefined || days <= r.max_days));
  if (c) return { multiplier: Math.max(0, 1 + c.adjustment_percent / 100), percent: c.adjustment_percent, label: c.label, matched: true };
  if (days > 60) return { multiplier: 0.85, percent: -15, label: 'Mua sớm (mặc định hệ thống)', matched: false };
  if (days >= 30) return { multiplier: 0.92, percent: -8, label: 'Mua sớm (mặc định hệ thống)', matched: false };
  if (days >= 14) return { multiplier: 1, percent: 0, label: 'Giá chuẩn (mặc định hệ thống)', matched: false };
  if (days >= 7) return { multiplier: 1.1, percent: 10, label: 'Gần ngày bay (mặc định hệ thống)', matched: false };
  if (days >= 3) return { multiplier: 1.2, percent: 20, label: 'Gần ngày bay (mặc định hệ thống)', matched: false };
  return { multiplier: 1.35, percent: 35, label: 'Sát ngày bay (mặc định hệ thống)', matched: false };
}

export function loadFactorQuote(loadFactorPercent: number, profile?: PricingProfileLike): Quote {
  const load = Math.max(0, Math.min(100, Number(loadFactorPercent || 0)));
  const sorted = profile?.load_factor_rules?.slice().sort((a, b) => a.min_load_percent - b.min_load_percent) || [];
  const c = sorted.find((r, i) => load >= r.min_load_percent && (i === sorted.length - 1 ? load <= r.max_load_percent : load < r.max_load_percent));
  if (!c) return { multiplier: 1, percent: 0, label: 'Tải chuẩn (không có mốc phù hợp)', matched: false };
  return { multiplier: Math.max(0, 1 + c.adjustment_percent / 100), percent: c.adjustment_percent, label: c.label, matched: true };
}

export function frequentFlyerTier(skyMiles: number): { tier: string; percent: number } {
  if (skyMiles < 20000) return { tier: 'MEMBER', percent: 0 };
  if (skyMiles < 50000) return { tier: 'SILVER', percent: 3 };
  if (skyMiles < 100000) return { tier: 'GOLD', percent: 7 };
  return { tier: 'PLATINUM', percent: 12 };
}

export interface PriceStep { title: string; detail: string; percent: number; before: number; after: number }
export function explainPricing(basePrice: number, days: number, loadPercent: number, skyMiles: number, profile?: PricingProfileLike) {
  const base = Math.max(0, Number(basePrice || 0));
  const eb = earlyBirdQuote(Number(days || 0), profile);
  const lf = loadFactorQuote(Number(loadPercent || 0), profile);
  const ff = frequentFlyerTier(Number(skyMiles || 0));
  const a1 = base * eb.multiplier, a2 = a1 * lf.multiplier, a3 = a2 * (1 - ff.percent / 100);
  const steps: PriceStep[] = [
    { title: 'Theo thời điểm mua', detail: eb.label, percent: eb.percent, before: base, after: a1 },
    { title: 'Theo độ lấp đầy', detail: lf.label, percent: lf.percent, before: a1, after: a2 },
    { title: 'Hạng hội viên SkyMiles', detail: ff.tier === 'MEMBER' ? 'Thành viên thường (không giảm)' : `Hạng ${ff.tier}`, percent: -ff.percent, before: a2, after: a3 },
  ];
  return { steps, final: Math.round(a3) };
}
