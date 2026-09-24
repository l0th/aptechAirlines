import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PayPalCheckoutSessionDocument = PayPalCheckoutSession & Document;

export enum PayPalCheckoutOperationType {
  CREATE_BOOKING = 'CREATE_BOOKING',
  CONFIRM_HOLD = 'CONFIRM_HOLD',
  RESCHEDULE = 'RESCHEDULE',
}

export enum PayPalCheckoutStatus {
  CREATED = 'CREATED',
  CAPTURING = 'CAPTURING',
  CAPTURED = 'CAPTURED',
  FINALIZING = 'FINALIZING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  STALE = 'STALE',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
  RECONCILE_REQUIRED = 'RECONCILE_REQUIRED',
}

@Schema({ timestamps: true })
export class PayPalCheckoutSession {
  @Prop({ required: true, unique: true, index: true })
  checkout_id: string;

  @Prop({ required: true, index: true })
  client_request_id: string;

  @Prop({ required: true, index: true })
  user_id: string;

  @Prop({ required: true, enum: PayPalCheckoutOperationType })
  operation_type: PayPalCheckoutOperationType;

  @Prop({
    required: true,
    enum: PayPalCheckoutStatus,
    default: PayPalCheckoutStatus.CREATED,
    index: true,
  })
  status: PayPalCheckoutStatus;

  @Prop({ required: false, index: true })
  paypal_order_id?: string;

  @Prop({ required: false })
  paypal_capture_id?: string;

  @Prop({ required: false })
  paypal_refund_id?: string;

  @Prop({ required: false })
  provider_refund_id?: string;

  @Prop({ required: false })
  provider_refund_status?: string;

  @Prop({ required: false })
  finalizing_started_at?: Date;

  @Prop({ required: true })
  amount_vnd: number;

  @Prop({ required: true })
  provider_amount: string; // e.g. "100.00"

  @Prop({ required: true, default: 'USD' })
  provider_currency: string;

  @Prop({ required: true })
  exchange_rate_vnd_per_unit: number;

  @Prop({ type: Object, required: false })
  operation_payload?: Record<string, any>;

  @Prop({ required: false })
  result_booking_id?: string;

  @Prop({ required: false })
  result_confirmation_number?: string;

  @Prop({ required: false })
  error_message?: string;

  @Prop({ required: false })
  failure_reason?: string;

  @Prop({ required: false })
  order_expires_at?: Date;

  // No automatic TTL deletion of PayPal checkout sessions (FIX 1).
  // Financial/reconciliation sessions must remain available until explicitly resolved.
  @Prop({ default: () => new Date() })
  createdAt?: Date;

  @Prop({ default: () => new Date() })
  updatedAt?: Date;
}

export const PayPalCheckoutSessionSchema = SchemaFactory.createForClass(PayPalCheckoutSession);

// Compound index for user_id + client_request_id + operation_type idempotency check
PayPalCheckoutSessionSchema.index({ user_id: 1, client_request_id: 1, operation_type: 1 }, { unique: true });
