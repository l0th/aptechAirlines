import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PolicyDocument = CancellationPolicy & Document;

@Schema({ timestamps: true })
export class CancellationPolicy {
  @Prop({ required: true })
  min_days_before: number;

  @Prop({ default: null })
  max_days_before: number; // null means no upper limit (e.g. >= min_days_before)

  @Prop({ required: true, min: 0, max: 100 })
  refund_percentage: number;

  @Prop({ required: true })
  description: string;

  @Prop({ required: false })
  description_en?: string;
}

export const CancellationPolicySchema = SchemaFactory.createForClass(CancellationPolicy);
