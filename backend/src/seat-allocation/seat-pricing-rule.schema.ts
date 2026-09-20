import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CabinClass } from '../flights/flights.schema';

export type SeatPricingRuleDocument = SeatPricingRule & Document;

export enum PricingDimension {
  CABIN_BASE = 'CABIN_BASE',
  WINDOW = 'WINDOW',
  AISLE = 'AISLE',
  MIDDLE = 'MIDDLE',
  FRONT_ZONE = 'FRONT_ZONE',
  EXIT_ROW = 'EXIT_ROW',
  EXTRA_LEGROOM = 'EXTRA_LEGROOM',
  BULKHEAD = 'BULKHEAD',
}

export enum SeatPositionSubtype {
  WINDOW = 'WINDOW',
  AISLE = 'AISLE',
  MIDDLE = 'MIDDLE',
}

@Schema({ timestamps: true })
export class SeatPricingRule {
  @Prop({ required: true, uppercase: true, trim: true, unique: true })
  rule_id: string;

  @Prop({ required: false, uppercase: true, trim: true })
  supersedes_rule_id?: string;

  @Prop({ required: true, default: 1, min: 1 })
  version: number;

  @Prop({ required: true, default: true })
  is_active: boolean;

  @Prop({ type: String, required: true })
  cabin_class: CabinClass | 'ALL';

  @Prop({ type: String, enum: PricingDimension, required: true })
  pricing_dimension: PricingDimension;

  @Prop({ type: String, enum: SeatPositionSubtype, required: false })
  position_subtype?: SeatPositionSubtype;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, default: 0 })
  priority: number;

  @Prop({ required: true, default: () => new Date() })
  effective_from: Date;

  @Prop({ required: false })
  effective_to?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  created_by_user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  deactivated_by_user_id?: Types.ObjectId;

  @Prop({ required: false })
  deactivated_at?: Date;
}

export const SeatPricingRuleSchema = SchemaFactory.createForClass(SeatPricingRule);

SeatPricingRuleSchema.index({
  cabin_class: 1,
  pricing_dimension: 1,
  is_active: 1,
  priority: -1,
});
