export interface AdvancePricingRule {
  min_days: number;
  max_days: number | null;
  adjustment_percent: number;
  label: string;
  label_en: string;
}

export interface LoadFactorPricingRule {
  min_load_percent: number;
  max_load_percent: number;
  adjustment_percent: number;
  label: string;
  label_en: string;
}

export interface PricingProfileSnapshot {
  profile_id: string;
  code: string;
  name: string;
  version: number;
  advance_rules: AdvancePricingRule[];
  load_factor_rules: LoadFactorPricingRule[];
}
