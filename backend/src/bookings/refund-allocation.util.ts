import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, PaymentTransaction } from './bookings.schema';

export interface AllocatedRefundItem {
  payment_reference: string;
  source_payment_reference?: string;
  transaction_type: 'REFUND' | 'RESCHEDULE_REFUND';
  payment_method?: PaymentMethod;
  amount: number;
  currency: string;
  card_masked?: string;
  provider_capture_id?: string;
  provider_order_id?: string;
  provider_amount?: string;
  provider_currency?: string;
  exchange_rate_vnd_per_unit?: number;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  provider_refund_id?: string;
  provider_status?: string;
  failure_reason?: string;
}

/** Never commit a fare reduction that cannot be refunded to the original PayPal captures. */
export function assertPayPalRefundAllocations(
  allocations: AllocatedRefundItem[],
  requestedAmountVnd: number,
): void {
  const allocatedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
  const hasValidSources = allocations.length > 0 && allocations.every((item) =>
    item.transaction_type === 'RESCHEDULE_REFUND' &&
    item.status === 'PENDING' &&
    item.payment_method === PaymentMethod.PAYPAL &&
    !!item.source_payment_reference &&
    !!item.provider_capture_id &&
    !!item.provider_currency &&
    Number(item.provider_amount) > 0 &&
    Number(item.exchange_rate_vnd_per_unit) > 0 &&
    Number.isFinite(item.amount) && item.amount > 0,
  );

  if (!Number.isFinite(requestedAmountVnd) || requestedAmountVnd <= 0 ||
      Math.abs(allocatedTotal - requestedAmountVnd) > 0.01 || !hasValidSources) {
    throw new BadRequestException(
      'Cannot refund the full reschedule difference to verified PayPal captures. Please contact support.',
    );
  }
}

/**
 * Allocates refund amount in LIFO order across positive source charges (PAYMENT, RESCHEDULE_CHARGE),
 * tracking remaining refundable balance to prevent over-refunding and preserving original provider provenance.
 */
export function allocateRefundSources(
  transactions: PaymentTransaction[],
  targetRefundVnd: number,
  transactionType: 'REFUND' | 'RESCHEDULE_REFUND' = 'REFUND',
  generateCode: (prefix: string) => string = (p) =>
    `${p}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
): AllocatedRefundItem[] {
  if (targetRefundVnd <= 0 || !Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  // 1. Identify all successful positive charges sorted chronologically
  const rawCharges = transactions.filter(
    (t) =>
      (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RESCHEDULE_CHARGE') &&
      t.status === 'SUCCESS',
  );

  if (rawCharges.length === 0) {
    return [];
  }

  const charges = rawCharges
    .map((c, idx) => ({
      charge: c,
      originalIndex: idx,
      timestamp: c.created_at ? new Date(c.created_at).getTime() : -1,
    }))
    .sort((a, b) => {
      const timeA = isNaN(a.timestamp) ? -1 : a.timestamp;
      const timeB = isNaN(b.timestamp) ? -1 : b.timestamp;
      if (timeA >= 0 && timeB >= 0 && timeA !== timeB) {
        return timeA - timeB;
      }
      return a.originalIndex - b.originalIndex;
    })
    .map((x) => x.charge);

  // 2. Calculate already refunded balances (both SUCCESS and PENDING reserve balance)
  const refunds = transactions.filter(
    (t) =>
      (t.transaction_type === 'REFUND' || t.transaction_type === 'RESCHEDULE_REFUND') &&
      (t.status === 'SUCCESS' || t.status === 'PENDING'),
  );

  const refundedVndBySource = new Map<string, number>();
  const refundedProviderBySource = new Map<string, number>();

  for (const r of refunds) {
    if (r.source_payment_reference) {
      refundedVndBySource.set(
        r.source_payment_reference,
        (refundedVndBySource.get(r.source_payment_reference) || 0) + r.amount,
      );
      if (r.provider_amount) {
        const pAmt = parseFloat(r.provider_amount);
        if (!isNaN(pAmt)) {
          refundedProviderBySource.set(
            r.source_payment_reference,
            Math.round(((refundedProviderBySource.get(r.source_payment_reference) || 0) + pAmt) * 100) / 100,
          );
        }
      }
    }
  }

  let legacyRefundPool = 0;
  for (const r of refunds) {
    if (!r.source_payment_reference) {
      legacyRefundPool += r.amount;
    }
  }

  const chargesWithRemaining = charges.map((c) => {
    let alreadyRefundedVnd = c.payment_reference
      ? refundedVndBySource.get(c.payment_reference) || 0
      : 0;
    const chargeVnd = typeof c.amount === 'number' && !isNaN(c.amount) ? c.amount : targetRefundVnd;
    if (legacyRefundPool > 0) {
      const deduct = Math.min(legacyRefundPool, Math.max(0, chargeVnd - alreadyRefundedVnd));
      alreadyRefundedVnd += deduct;
      legacyRefundPool -= deduct;
    }
    const remainingVnd = Math.max(0, chargeVnd - alreadyRefundedVnd);

    let originalProviderAmt = 0;
    if (c.payment_method === PaymentMethod.PAYPAL) {
      if (!c.payment_reference || !c.provider_capture_id || !c.provider_amount || !c.exchange_rate_vnd_per_unit) {
        throw new Error(
          `Incomplete provider provenance for PayPal charge ${c.payment_reference || 'UNKNOWN'}. payment_reference, provider_capture_id, provider_amount, and exchange_rate_vnd_per_unit are strictly required.`,
        );
      }
      const p = parseFloat(c.provider_amount);
      if (isNaN(p) || p <= 0) {
        throw new Error(`Invalid provider_amount "${c.provider_amount}" on PayPal charge ${c.payment_reference}.`);
      }
      originalProviderAmt = p;
    } else if (c.provider_amount) {
      const p = parseFloat(c.provider_amount);
      if (!isNaN(p)) originalProviderAmt = p;
    }
    const alreadyRefundedProvider = c.payment_reference
      ? refundedProviderBySource.get(c.payment_reference) || 0
      : 0;
    const remainingProvider = Math.max(
      0,
      Math.round((originalProviderAmt - alreadyRefundedProvider) * 100) / 100,
    );

    return {
      charge: c,
      remainingVnd,
      remainingProvider,
      originalProviderAmt,
    };
  });

  // 3. Allocate targetRefundVnd in LIFO order (newest charges first)
  let toAllocate = targetRefundVnd;
  const result: AllocatedRefundItem[] = [];

  const reversedCharges = [...chargesWithRemaining].reverse();
  for (const item of reversedCharges) {
    if (toAllocate <= 0) break;
    if (item.remainingVnd <= 0) continue;

    const allocVnd = Math.min(toAllocate, item.remainingVnd);
    toAllocate -= allocVnd;

    const isPaypal = item.charge.payment_method === PaymentMethod.PAYPAL;
    let providerAmount: string | undefined = undefined;
    if (isPaypal) {
      const rate = item.charge.exchange_rate_vnd_per_unit;
      if (!rate || isNaN(rate) || rate <= 0) {
        throw new Error(
          `Missing or invalid exchange rate snapshot for PayPal charge ${item.charge.payment_reference}. Cannot allocate refund.`,
        );
      }

      if (allocVnd === item.remainingVnd) {
        // Final remaining refund of this capture -> exact remaining provider amount eliminates cent drift
        providerAmount = item.remainingProvider.toFixed(2);
      } else {
        // Partial refund -> derive via snapshot exchange rate capped at remaining provider amount
        const derivedUsd = Math.round((allocVnd / rate) * 100) / 100;
        const cappedUsd = Math.min(derivedUsd, item.remainingProvider);
        providerAmount = cappedUsd.toFixed(2);
      }
    }

    result.push({
      payment_reference: generateCode('REF'),
      source_payment_reference: item.charge.payment_reference,
      transaction_type: transactionType,
      payment_method: item.charge.payment_method,
      amount: allocVnd,
      currency: item.charge.currency || 'VND',
      card_masked: item.charge.card_masked,
      provider_capture_id: item.charge.provider_capture_id,
      provider_order_id: item.charge.provider_order_id,
      provider_amount: providerAmount,
      provider_currency: item.charge.provider_currency,
      exchange_rate_vnd_per_unit: item.charge.exchange_rate_vnd_per_unit,
      status: isPaypal ? 'PENDING' : 'SUCCESS',
    });
  }

  return result;
}
