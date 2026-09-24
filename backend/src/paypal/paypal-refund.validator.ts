import { BadRequestException } from '@nestjs/common';

export interface PayPalRefundSnapshotInput {
  payment_reference: string;
  provider_capture_id: string;
  provider_amount: string;
  provider_currency: string;
  exchange_rate_vnd_per_unit?: number;
  provider_refund_id?: string;
  require_fx?: boolean;
  context?: string;
}

/**
 * Strict validator for PayPal refund execution snapshots (FIX 2 & FIX 5).
 * Fails closed before any PayPal refund API invocation.
 */
export function assertPayPalRefundExecutionSnapshot(input: PayPalRefundSnapshotInput): void {
  const ctx = input.context || 'assertPayPalRefundExecutionSnapshot';

  if (!input.payment_reference || typeof input.payment_reference !== 'string' || !input.payment_reference.trim()) {
    throw new BadRequestException(`[${ctx}] PayPal refund requires non-empty payment_reference.`);
  }

  if (!input.provider_capture_id || typeof input.provider_capture_id !== 'string' || !input.provider_capture_id.trim()) {
    throw new BadRequestException(`[${ctx}] PayPal refund requires non-empty provider_capture_id.`);
  }

  if (!input.provider_amount || typeof input.provider_amount !== 'string' || !input.provider_amount.trim()) {
    throw new BadRequestException(`[${ctx}] PayPal refund requires provider_amount.`);
  }

  const pAmt = parseFloat(input.provider_amount);
  if (isNaN(pAmt) || pAmt <= 0) {
    throw new BadRequestException(
      `[${ctx}] PayPal refund provider_amount must be a positive number, got "${input.provider_amount}".`,
    );
  }

  if (!/^\d+\.\d{2}$/.test(input.provider_amount.trim())) {
    throw new BadRequestException(
      `[${ctx}] PayPal refund provider_amount must have exactly 2 decimal places, got "${input.provider_amount}".`,
    );
  }

  if (
    !input.provider_currency ||
    typeof input.provider_currency !== 'string' ||
    input.provider_currency.trim().toUpperCase() !== 'USD'
  ) {
    throw new BadRequestException(
      `[${ctx}] PayPal refund provider_currency must strictly be USD, got "${input.provider_currency}".`,
    );
  }

  if (input.require_fx) {
    if (
      input.exchange_rate_vnd_per_unit === undefined ||
      typeof input.exchange_rate_vnd_per_unit !== 'number' ||
      isNaN(input.exchange_rate_vnd_per_unit) ||
      input.exchange_rate_vnd_per_unit <= 0
    ) {
      throw new BadRequestException(
        `[${ctx}] PayPal refund requires valid positive exchange_rate_vnd_per_unit in provenance snapshot, got "${input.exchange_rate_vnd_per_unit}".`,
      );
    }
  } else if (input.exchange_rate_vnd_per_unit !== undefined) {
    if (
      typeof input.exchange_rate_vnd_per_unit !== 'number' ||
      isNaN(input.exchange_rate_vnd_per_unit) ||
      input.exchange_rate_vnd_per_unit <= 0
    ) {
      throw new BadRequestException(
        `[${ctx}] Invalid exchange_rate_vnd_per_unit in refund snapshot: ${input.exchange_rate_vnd_per_unit}.`,
      );
    }
  }

  if (input.provider_refund_id && input.provider_refund_id.trim()) {
    throw new BadRequestException(
      `[${ctx}] Transaction already has provider_refund_id "${input.provider_refund_id}". Must reconcile via getRefundDetails instead of resubmitting refund.`,
    );
  }
}

export type PayPalRefundProviderStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED';

export interface ClassifiedPayPalRefundStatus {
  local_status: 'SUCCESS' | 'PENDING' | 'FAILED';
  provider_status: PayPalRefundProviderStatus;
  is_success: boolean;
  is_pending: boolean;
  is_failed: boolean;
}

/**
 * Centralized, fail-closed refund status classification helper (FIX 1).
 * Maps authoritative PayPal refund statuses to local transactional statuses.
 * - COMPLETED => SUCCESS
 * - PENDING   => PENDING
 * - FAILED    => FAILED
 * - CANCELLED => FAILED
 * - Unknown or missing => throws BadRequestException (fail closed, never SUCCESS, never silently PENDING)
 */
export function classifyPayPalRefundStatus(rawStatus?: string | null): ClassifiedPayPalRefundStatus {
  const norm = (rawStatus || '').trim().toUpperCase();
  switch (norm) {
    case 'COMPLETED':
      return {
        local_status: 'SUCCESS',
        provider_status: 'COMPLETED',
        is_success: true,
        is_pending: false,
        is_failed: false,
      };
    case 'PENDING':
      return {
        local_status: 'PENDING',
        provider_status: 'PENDING',
        is_success: false,
        is_pending: true,
        is_failed: false,
      };
    case 'FAILED':
      return {
        local_status: 'FAILED',
        provider_status: 'FAILED',
        is_success: false,
        is_pending: false,
        is_failed: true,
      };
    case 'CANCELLED':
      return {
        local_status: 'FAILED',
        provider_status: 'CANCELLED',
        is_success: false,
        is_pending: false,
        is_failed: true,
      };
    default:
      throw new BadRequestException(
        `Invalid or unsupported PayPal refund provider status: "${rawStatus || 'missing'}". Expected COMPLETED, PENDING, FAILED, or CANCELLED.`,
      );
  }
}

