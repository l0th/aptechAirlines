import { applyPricing, earlyBirdQuote, inventoryLoadFactor, loadFactorQuote } from './pricing.util';
import { PricingProfileSnapshot } from './pricing-profile.types';

describe('dynamic fare pricing profiles', () => {
  const profile: PricingProfileSnapshot = {
    profile_id: 'profile-1',
    code: 'DEMO_DYNAMIC',
    name: 'Demo dynamic pricing',
    version: 1,
    advance_rules: [
      { min_days: 0, max_days: 6, adjustment_percent: 20, label: 'Sát ngày', label_en: 'Close' },
      { min_days: 7, max_days: 29, adjustment_percent: 0, label: 'Chuẩn', label_en: 'Standard' },
      { min_days: 30, max_days: null, adjustment_percent: -10, label: 'Mua sớm', label_en: 'Early' },
    ],
    load_factor_rules: [
      { min_load_percent: 0, max_load_percent: 40, adjustment_percent: -20, label: 'Tải thấp', label_en: 'Low' },
      { min_load_percent: 40, max_load_percent: 80, adjustment_percent: 0, label: 'Tải chuẩn', label_en: 'Normal' },
      { min_load_percent: 80, max_load_percent: 100, adjustment_percent: 15, label: 'Tải cao', label_en: 'High' },
    ],
  };

  it('keeps legacy early-bird rules when no profile is assigned', () => {
    expect(earlyBirdQuote(70).percent).toBe(-15);
    expect(applyPricing(1_000_000, 70, 0).final_price).toBe(850_000);
  });

  it('combines reusable time and load-factor rules from the assigned profile', () => {
    const result = applyPricing(1_000_000, 45, 0, profile, 25);
    expect(result.early_bird_percent).toBe(-10);
    expect(result.load_adjustment_percent).toBe(-20);
    expect(result.final_price).toBe(720_000);
    expect(result.pricing_profile_id).toBe('profile-1');
  });

  it('uses half-open load bands so 40% and 80% move into the next band', () => {
    expect(loadFactorQuote(39.99, profile).percent).toBe(-20);
    expect(loadFactorQuote(40, profile).percent).toBe(0);
    expect(loadFactorQuote(79.99, profile).percent).toBe(0);
    expect(loadFactorQuote(80, profile).percent).toBe(15);
    expect(loadFactorQuote(100, profile).percent).toBe(15);
  });

  it('calculates physical sellable inventory load factor', () => {
    expect(inventoryLoadFactor(100, 100)).toBe(0);
    expect(inventoryLoadFactor(100, 60)).toBe(40);
    expect(inventoryLoadFactor(100, 0)).toBe(100);
  });
});
