import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CabinClass } from '../flights/flights.schema';

export type SeatAllocationDocument = SeatAllocation & Document;

export enum SeatAllocationStatus {
  HELD = 'HELD',
  CONFIRMED = 'CONFIRMED',
  BLOCKED_MAINTENANCE = 'BLOCKED_MAINTENANCE',
  CREW_REST = 'CREW_REST',
  VIP_HOLD = 'VIP_HOLD',
}

export enum SeatSelectionType {
  AUTO = 'AUTO',
  CHOOSE = 'CHOOSE',
}

@Schema({ timestamps: true })
export class SeatAllocation {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true, index: true })
  flight_id: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  seat_code: string;

  @Prop({
    type: String,
    enum: SeatAllocationStatus,
    required: true,
    default: SeatAllocationStatus.HELD,
  })
  status: SeatAllocationStatus;

  @Prop({ type: String, enum: CabinClass, required: true })
  cabin_class: CabinClass;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: false })
  booking_id?: Types.ObjectId;

  @Prop({ required: false, trim: true })
  coupon_number?: string;

  @Prop({ required: false, trim: true })
  passenger_name?: string;

  @Prop({ type: String, enum: SeatSelectionType, required: false })
  seat_selection_type?: SeatSelectionType;

  @Prop({ type: Number, required: false })
  passenger_index?: number;

  @Prop({ default: 0, min: 0 })
  seat_fee?: number;

  @Prop({ default: 'VND' })
  seat_fee_currency?: string;

  @Prop({ type: Object, required: false })
  seat_pricing_snapshot?: any;

  @Prop({ required: false, trim: true })
  pricing_dimension_applied?: string;

  @Prop({ default: false })
  is_free_selection?: boolean;

  @Prop({ required: false })
  held_until?: Date;

  @Prop({ required: false, trim: true, index: true })
  saga_operation_id?: string;

  @Prop({ required: false, trim: true })
  allocation_batch_id?: string;

  @Prop({ required: false, trim: true })
  staff_block_reason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  staff_blocked_by_user_id?: Types.ObjectId;

  @Prop({ required: false })
  staff_blocked_at?: Date;

  @Prop({ required: false, trim: true })
  staff_notes?: string;
}

export const SeatAllocationSchema = SchemaFactory.createForClass(SeatAllocation);

// 1. Compound unique index: guarantees physical seat cannot be double-booked or co-occupied
SeatAllocationSchema.index({ flight_id: 1, seat_code: 1 }, { unique: true });

// 2. Partial unique index: prevents duplicate seats allocated to the same coupon under retry
SeatAllocationSchema.index(
  { booking_id: 1, coupon_number: 1 },
  {
    unique: true,
    partialFilterExpression: {
      booking_id: { $exists: true },
      coupon_number: { $exists: true },
    },
  },
);

// 3. Operational query indexes
SeatAllocationSchema.index({ flight_id: 1, status: 1 });
SeatAllocationSchema.index({ booking_id: 1 });
SeatAllocationSchema.index({ held_until: 1 });
// NOTE: Explicitly NO TTL index on held_until. Expiry is strictly managed by BookingsScheduler.
