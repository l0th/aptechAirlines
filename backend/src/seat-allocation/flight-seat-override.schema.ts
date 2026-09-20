import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FlightSeatOverrideDocument = FlightSeatOverride & Document;

@Schema({ timestamps: true })
export class FlightSeatOverride {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true, index: true })
  flight_id: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  seat_code: string;

  @Prop({ required: true, min: 0 })
  override_fee: number;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ required: true, default: true })
  is_active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by_user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  deactivated_by_user_id?: Types.ObjectId;

  @Prop({ required: false })
  deactivated_at?: Date;
}

export const FlightSeatOverrideSchema = SchemaFactory.createForClass(FlightSeatOverride);

FlightSeatOverrideSchema.index(
  { flight_id: 1, seat_code: 1 },
  { unique: true, partialFilterExpression: { is_active: true } },
);
FlightSeatOverrideSchema.index({ flight_id: 1, is_active: 1 });
