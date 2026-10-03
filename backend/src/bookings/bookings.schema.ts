import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BookingDocument = Booking & Document;

export enum BookingStatus {
  BLOCKED = 'BLOCKED',
  CONFIRMED = 'CONFIRMED',
  RESCHEDULED = 'RESCHEDULED',
  CANCELLED = 'CANCELLED',
}

export enum BookingType {
  ONE_WAY = 'ONE_WAY',
  ROUND_TRIP = 'ROUND_TRIP',
  // Requirement 3.3.3: hành trình nhiều chặng (nối chuyến qua điểm trung chuyển)
  CONNECTING = 'CONNECTING',
}

export enum PassengerType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
  SENIOR = 'SENIOR',
}

export enum PaymentMethod {
  PROFILE_CARD = 'PROFILE_CARD',
  PAYPAL = 'PAYPAL',
}

export interface ExternalPaymentProof {
  payment_method: PaymentMethod;
  payment_reference: string;
  expected_amount_vnd: number;
  provider_order_id: string;
  provider_capture_id: string;
  provider_amount: string;
  provider_currency: string;
  exchange_rate_vnd_per_unit: number;
  status: 'SUCCESS';
}

@Schema({ _id: false })
export class Passenger {
  @Prop({ required: true })
  first_name: string;

  @Prop({ required: true })
  last_name: string;

  @Prop({ type: String, enum: PassengerType, default: PassengerType.ADULT })
  passenger_type: PassengerType;

  @Prop({ default: '' })
  id_card_or_passport: string;

  @Prop({ default: 'Vietnamese' })
  nationality: string;

  @Prop()
  date_of_birth?: Date;
}

@Schema({ _id: false })
export class TicketCoupon {
  @Prop({ required: true })
  coupon_number: string;

  @Prop({ required: true })
  passenger_name: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Flight' })
  flight_id: Types.ObjectId;

  @Prop({ required: true })
  flight_number: string;

  @Prop({ required: true })
  inventory_id: string;

  @Prop({ required: true })
  cabin_class: string;

  @Prop({ default: false })
  is_smoking: boolean;

  @Prop({ required: true })
  fare_paid: number;

  @Prop({ default: '' })
  seat_code?: string; // e.g. '12A', '14C'

  @Prop({ type: String, enum: ['AUTO', 'CHOOSE'], default: 'AUTO' })
  seat_selection_type?: 'AUTO' | 'CHOOSE';

  @Prop({ default: 0, min: 0 })
  seat_fee?: number;

  @Prop({ default: 'VND' })
  seat_fee_currency?: string;

  @Prop({ type: Object, required: false })
  seat_pricing_snapshot?: {
    rule_ids: string[];
    dimensions: string[];
    flight_override: boolean;
    final_fee: number;
  };

  @Prop({ default: 'OUTBOUND' })
  leg_type: string; // OUTBOUND, INBOUND, or CONNECTING_LEG

  @Prop({ default: 'ACTIVE' })
  coupon_status: string; // ACTIVE, CANCELLED, RESCHEDULED
}

@Schema({ _id: false })
export class PaymentTransaction {
  @Prop({ required: false })
  payment_reference?: string;

  @Prop({ required: false })
  source_payment_reference?: string;

  @Prop({ required: true })
  transaction_type: string; // PAYMENT, REFUND, RESCHEDULE_CHARGE, RESCHEDULE_REFUND

  @Prop({ required: true })
  amount: number;

  @Prop({ required: false })
  card_masked?: string;

  @Prop({ default: 'VND' })
  currency?: string;

  @Prop({ default: 'SUCCESS' })
  status: string; // SUCCESS, PENDING, FAILED

  @Prop({ type: String, enum: PaymentMethod, required: false })
  payment_method?: PaymentMethod;

  @Prop({ required: false })
  payment_provider?: string;

  @Prop({ required: false })
  provider_order_id?: string;

  @Prop({ required: false })
  provider_capture_id?: string;

  @Prop({ required: false })
  provider_refund_id?: string;

  @Prop({ required: false })
  provider_amount?: string;

  @Prop({ required: false })
  provider_currency?: string;

  @Prop({ required: false })
  exchange_rate_vnd_per_unit?: number;

  @Prop({ required: false })
  provider_status?: string;

  @Prop({ required: false, default: 0 })
  retry_count?: number;

  @Prop({ required: false })
  next_retry_at?: Date;

  @Prop({ required: false })
  failure_reason?: string;

  @Prop({ default: () => new Date() })
  created_at: Date;
}

@Schema({ _id: false })
export class SeatSagaCommit {
  @Prop({ required: true })
  operation_id: string;

  @Prop({ required: true, enum: ['CREATE', 'RESCHEDULE'] })
  operation_type: 'CREATE' | 'RESCHEDULE';

  @Prop({ required: true, enum: ['PENDING_FINALIZATION', 'COMPLETED'], default: 'PENDING_FINALIZATION' })
  status: 'PENDING_FINALIZATION' | 'COMPLETED';

  @Prop({ default: () => new Date() })
  committed_at: Date;
}

@Schema({ timestamps: true })
export class Booking {
  @Prop({ required: true, unique: true })
  pnr_code: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: Types.ObjectId;

  @Prop({ type: String, enum: BookingType, default: BookingType.ONE_WAY })
  booking_type: BookingType;

  @Prop({ type: String, enum: BookingStatus, required: true })
  status: BookingStatus;

  // Requirement 3.4: Blocking number (only for blocked bookings)
  @Prop({ unique: true, sparse: true })
  blocking_number?: string;

  // Requirement 3.4 & 3.5: Confirmation number (for confirmed/bought bookings)
  @Prop({ unique: true, sparse: true })
  confirmation_number?: string;

  // Requirement 3.7: Cancellation number
  @Prop({ unique: true, sparse: true })
  cancellation_number?: string;

  // 2 weeks before departure deadline for blocked tickets
  @Prop()
  time_limit_deadline?: Date;

  // 3 weeks reminder flag
  @Prop({ default: false })
  is_reminder_sent: boolean;

  @Prop({ required: true, default: 0 })
  total_amount: number;

  @Prop({ required: true, default: 0 })
  total_fare: number;

  @Prop({ required: true, default: 0 })
  total_seat_fees: number;

  @Prop({ type: SeatSagaCommit, required: false })
  seat_saga_commit?: SeatSagaCommit;

  @Prop({ required: true, default: 0 })
  total_miles_accrued: number;

  @Prop({ type: [Passenger], default: [] })
  passengers: Passenger[];

  @Prop({ type: [TicketCoupon], default: [] })
  ticket_coupons: TicketCoupon[];

  @Prop({ type: [PaymentTransaction], default: [] })
  payment_transactions: PaymentTransaction[];

  @Prop()
  early_bird_percent?: number;

  @Prop()
  early_bird_label?: string;

  @Prop()
  early_bird_label_en?: string;

  @Prop()
  load_factor_percent?: number;

  @Prop()
  load_adjustment_percent?: number;

  @Prop()
  load_adjustment_label?: string;

  @Prop()
  pricing_profile_id?: string;

  @Prop()
  pricing_profile_name?: string;

  @Prop()
  ff_tier?: string;

  @Prop()
  ff_discount_percent?: number;

  @Prop()
  pricing_note?: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// LƯU Ý: blocking_number / confirmation_number / pnr_code đã có `unique: true` trong
// @Prop nên Mongoose tự tạo index — khai báo lại bằng schema.index() sẽ sinh index
// trùng và log cảnh báo "Duplicate schema index" khi khởi động.
BookingSchema.index({ user_id: 1 });
