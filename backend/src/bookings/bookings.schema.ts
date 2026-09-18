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

  @Prop({ default: 'OUTBOUND' })
  leg_type: string; // OUTBOUND, INBOUND, or CONNECTING_LEG

  @Prop({ default: 'ACTIVE' })
  coupon_status: string; // ACTIVE, CANCELLED, RESCHEDULED
}

@Schema({ _id: false })
export class PaymentTransaction {
  @Prop({ required: true })
  transaction_type: string; // PAYMENT, REFUND, RESCHEDULE_CHARGE, RESCHEDULE_REFUND

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  card_masked: string;

  @Prop({ default: 'VND' })
  currency?: string;

  @Prop({ default: 'SUCCESS' })
  status: string;

  @Prop({ default: () => new Date() })
  created_at: Date;
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
