import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import type { CabinClass } from '../flights/flights.schema';
import { PricingDimension } from './seat-pricing-rule.schema';

export type SeatPricingProfileDocument = SeatPricingProfile & Document;

export interface SeatPricingProfileRuleSnapshot {
  cabin_class: CabinClass | 'ALL';
  pricing_dimension: PricingDimension;
  amount: number;
  priority: number;
}

export interface SeatPricingProfileSnapshot {
  profile_id: string;
  code: string;
  name: string;
  version: number;
  aircraft_type: string;
  rules: SeatPricingProfileRuleSnapshot[];
}

@Schema({ _id: false })
export class SeatPricingProfileRule {
  @Prop({ type: String, required: true })
  cabin_class: CabinClass | 'ALL';

  @Prop({ type: String, enum: PricingDimension, required: true })
  pricing_dimension: PricingDimension;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, default: 0 })
  priority: number;
}

export const SeatPricingProfileRuleSchema = SchemaFactory.createForClass(SeatPricingProfileRule);

@Schema({ timestamps: true })
export class SeatPricingProfile {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '', trim: true })
  description: string;

  @Prop({ required: true, uppercase: true, trim: true, default: 'ALL' })
  aircraft_type: string;

  @Prop({ default: true, index: true })
  is_active: boolean;

  @Prop({ required: true, default: 1, min: 1 })
  version: number;

  @Prop({ type: [SeatPricingProfileRuleSchema], default: [] })
  rules: SeatPricingProfileRule[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  created_by_user_id?: Types.ObjectId;
}

export const SeatPricingProfileSchema = SchemaFactory.createForClass(SeatPricingProfile);
SeatPricingProfileSchema.index({ aircraft_type: 1, is_active: 1, updatedAt: -1 });
