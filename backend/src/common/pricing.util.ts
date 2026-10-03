/**
 * Utility functions for pricing (dynamic early-bird pricing and frequent flyer tiers).
 * 
 * req 1.2.4.3: dynamic pricing: the fare must depend on how EARLY before departure the customer buys.
 * req 1.2.4.1: special offers/discounts for frequent travellers (SkyMiles tier).
 * req 3.3.4.2: the date menu must not offer dates too far in the future.
 */

import { localDateKey } from './timezone.util';
import { PricingProfileSnapshot } from './pricing-profile.types';

export const BOOKING_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// a) earlyBirdQuote(daysUntilDeparture)
export function earlyBirdQuote(
    daysUntilDeparture: number,
    profile?: PricingProfileSnapshot | null,
): { multiplier: number; percent: number; label: string; label_en: string } {
    const days = Math.floor(daysUntilDeparture < 0 ? 0 : daysUntilDeparture);
    const configured = profile?.advance_rules
        ?.slice()
        .sort((a, b) => a.min_days - b.min_days)
        .find((rule) => days >= rule.min_days && (rule.max_days === null || days <= rule.max_days));
    if (configured) {
        return {
            multiplier: Math.max(0, 1 + configured.adjustment_percent / 100),
            percent: configured.adjustment_percent,
            label: configured.label,
            label_en: configured.label_en,
        };
    }
    // req 1.2.4.3: Dynamic early-bird pricing
    if (days > 60) return { multiplier: 0.85, percent: -15, label: 'Mua sớm', label_en: 'Early bird' };
    if (days >= 30 && days <= 60) return { multiplier: 0.92, percent: -8, label: 'Mua sớm', label_en: 'Early bird' };
    if (days >= 14 && days <= 29) return { multiplier: 1.00, percent: 0, label: 'Giá chuẩn', label_en: 'Standard fare' };
    if (days >= 7 && days <= 13) return { multiplier: 1.10, percent: 10, label: 'Gần ngày bay', label_en: 'Close to departure' };
    if (days >= 3 && days <= 6) return { multiplier: 1.20, percent: 20, label: 'Gần ngày bay', label_en: 'Close to departure' };
    return { multiplier: 1.35, percent: 35, label: 'Sát ngày bay', label_en: 'Last minute' }; // 0-2 days
}

export function inventoryLoadFactor(allocatedSeats: number, availableSeats: number): number {
    const allocated = Number(allocatedSeats || 0);
    if (allocated <= 0) return 0;
    const available = Math.max(0, Math.min(allocated, Number(availableSeats || 0)));
    return Math.max(0, Math.min(100, ((allocated - available) / allocated) * 100));
}

export function loadFactorQuote(
    loadFactorPercent: number,
    profile?: PricingProfileSnapshot | null,
): { multiplier: number; percent: number; label: string; label_en: string } {
    const load = Math.max(0, Math.min(100, Number(loadFactorPercent || 0)));
    const sorted = profile?.load_factor_rules
        ?.slice()
        .sort((a, b) => a.min_load_percent - b.min_load_percent) || [];
    const configured = sorted.find((rule, index) =>
        load >= rule.min_load_percent &&
        (index === sorted.length - 1 ? load <= rule.max_load_percent : load < rule.max_load_percent),
    );
    if (!configured) return { multiplier: 1, percent: 0, label: 'Tải chuẩn', label_en: 'Normal load' };
    return {
        multiplier: Math.max(0, 1 + configured.adjustment_percent / 100),
        percent: configured.adjustment_percent,
        label: configured.label,
        label_en: configured.label_en,
    };
}

// b) frequentFlyerTier(skyMiles)
export function frequentFlyerTier(skyMiles: number): { tier: string; percent: number } {
    // req 1.2.4.1: SkyMiles tier discount
    if (skyMiles < 20000) return { tier: 'MEMBER', percent: 0 };
    if (skyMiles < 50000) return { tier: 'SILVER', percent: 3 };
    if (skyMiles < 100000) return { tier: 'GOLD', percent: 7 };
    return { tier: 'PLATINUM', percent: 12 };
}

// c) applyPricing(basePrice, daysUntilDeparture, skyMiles)
export function applyPricing(
    basePrice: number,
    daysUntilDeparture: number,
    skyMiles: number,
    profile?: PricingProfileSnapshot | null,
    loadFactorPercent = 0,
): {
    final_price: number;
    early_bird_percent: number;
    early_bird_label: string;
    early_bird_label_en: string;
    load_factor_percent: number;
    load_adjustment_percent: number;
    load_adjustment_label: string;
    load_adjustment_label_en: string;
    pricing_profile_id?: string;
    pricing_profile_name?: string;
    ff_tier: string;
    ff_percent: number;
} {
    const earlyBird = earlyBirdQuote(daysUntilDeparture, profile);
    const load = loadFactorQuote(loadFactorPercent, profile);
    const ff = frequentFlyerTier(skyMiles);
    
    // Yêu cầu (req 1.2.4.3 & 1.2.4.1): Kết hợp chiết khấu
    const afterEarlyBird = basePrice * earlyBird.multiplier;
    const afterLoadFactor = afterEarlyBird * load.multiplier;
    const finalPrice = afterLoadFactor * (1 - ff.percent / 100);

    return {
        final_price: Math.round(finalPrice),
        early_bird_percent: earlyBird.percent,
        early_bird_label: earlyBird.label,
        early_bird_label_en: earlyBird.label_en,
        load_factor_percent: Math.round(Math.max(0, Math.min(100, loadFactorPercent)) * 100) / 100,
        load_adjustment_percent: load.percent,
        load_adjustment_label: load.label,
        load_adjustment_label_en: load.label_en,
        pricing_profile_id: profile?.profile_id,
        pricing_profile_name: profile?.name,
        ff_tier: ff.tier,
        ff_percent: ff.percent,
    };
}

// d) maxAdvanceBookingDays()
export function maxAdvanceBookingDays(): number {
    // req 3.3.4.2: Limit max booking dates
    const maxDays = process.env.MAX_ADVANCE_BOOKING_DAYS;
    if (maxDays) {
        return parseInt(maxDays, 10);
    }
    return 330;
}

// e) getBookingWindowLimits()
export interface BookingWindowLimits {
    max_advance_days: number;
    min_date: string; // YYYY-MM-DD
    max_date: string; // YYYY-MM-DD
    current_date: string; // YYYY-MM-DD in booking timezone
    time_zone: string;
    server_time: string;
}

export function getBookingWindowLimits(refDate: Date = new Date()): BookingWindowLimits {
    const maxDays = maxAdvanceBookingDays();
    const currentDate = localDateKey(refDate, BOOKING_TIME_ZONE);
    const [year, month, day] = currentDate.split('-').map(Number);
    const maxDate = new Date(Date.UTC(year, month - 1, day + maxDays));
    return {
        max_advance_days: maxDays,
        min_date: currentDate,
        max_date: maxDate.toISOString().split('T')[0],
        current_date: currentDate,
        time_zone: BOOKING_TIME_ZONE,
        server_time: refDate.toISOString(),
    };
}
