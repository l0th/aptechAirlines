import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CabinClass } from '../flights.schema';

export type ScheduleTemplateDocument = ScheduleTemplate & Document;

@Schema({ timestamps: true })
export class ScheduleTemplate {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  template_id: string; // e.g. 'APT-HAN-SGN-01'

  @Prop({ required: true, uppercase: true, trim: true })
  flight_number: string; // e.g. 'APT201'

  @Prop({ required: true, uppercase: true, trim: true })
  origin_iata: string;

  @Prop({ required: true, uppercase: true, trim: true })
  dest_iata: string;

  @Prop({ required: true, trim: true })
  std_dep_time: string; // e.g. '06:30' (local time)

  @Prop({ required: true, trim: true })
  std_arr_time: string; // e.g. '08:45' (local time)

  @Prop({ type: [Number], required: true })
  days_of_week: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun

  @Prop({ required: true, uppercase: true, trim: true })
  aircraft_type: string; // 'A20N' | 'A21N' | 'B789' | 'A359' | 'B738' | 'AT76'

  @Prop({ type: [String], enum: CabinClass, required: true })
  cabin_classes: CabinClass[];

  @Prop({ required: true, min: 0 })
  base_price_economy: number;

  @Prop({ required: false, min: 0 })
  base_price_business?: number;

  @Prop({ required: false, min: 0 })
  base_price_club?: number;

  @Prop({ required: false, min: 0 })
  base_price_first?: number;

  @Prop({ default: true })
  is_active: boolean;
}

export const ScheduleTemplateSchema = SchemaFactory.createForClass(ScheduleTemplate);

ScheduleTemplateSchema.index({ origin_iata: 1, dest_iata: 1 });
ScheduleTemplateSchema.index({ is_active: 1 });
