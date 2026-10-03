import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PricingProfileDocument = PricingProfile & Document;

@Schema({ _id: false })
export class AdvancePricingRuleSchemaClass {
  @Prop({ required: true, min: 0 })
  min_days: number;

  @Prop({ required: false, default: null })
  max_days: number | null;

  @Prop({ required: true, min: -100, max: 500 })
  adjustment_percent: number;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, trim: true })
  label_en: string;
}
export const AdvancePricingRuleSchema = SchemaFactory.createForClass(AdvancePricingRuleSchemaClass);

@Schema({ _id: false })
export class LoadFactorPricingRuleSchemaClass {
  @Prop({ required: true, min: 0, max: 100 })
  min_load_percent: number;

  @Prop({ required: true, min: 0, max: 100 })
  max_load_percent: number;

  @Prop({ required: true, min: -100, max: 500 })
  adjustment_percent: number;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, trim: true })
  label_en: string;
}
export const LoadFactorPricingRuleSchema = SchemaFactory.createForClass(LoadFactorPricingRuleSchemaClass);

@Schema({ timestamps: true })
export class PricingProfile {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '', trim: true })
  description: string;

  @Prop({ default: true, index: true })
  is_active: boolean;

  @Prop({ required: true, default: 1, min: 1 })
  version: number;

  @Prop({ type: [AdvancePricingRuleSchema], default: [] })
  advance_rules: AdvancePricingRuleSchemaClass[];

  @Prop({ type: [LoadFactorPricingRuleSchema], default: [] })
  load_factor_rules: LoadFactorPricingRuleSchemaClass[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  created_by_user_id?: Types.ObjectId;
}

export const PricingProfileSchema = SchemaFactory.createForClass(PricingProfile);
PricingProfileSchema.index({ is_active: 1, updatedAt: -1 });
