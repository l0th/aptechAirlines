import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CabinClass } from '../flights.schema';

export type ScheduleTemplateDocument = ScheduleTemplate & Document;

@Schema({ _id: false })
export class CommercialInventoryConfig {
  @Prop({ type: String, enum: CabinClass, required: true })
  cabin_class: CabinClass;

  @Prop({ required: true, min: 1 })
  allocated_seats: number;
}
export const CommercialInventoryConfigSchema = SchemaFactory.createForClass(CommercialInventoryConfig);

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

  @Prop({ required: false, trim: true })
  std_dep_time?: string; // e.g. '06:30' (local time, optional if source_dep_time_utc provided)

  @Prop({ required: false, trim: true })
  std_arr_time?: string; // e.g. '08:45' (local time), optional if duration provided

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

  // Commercial inventory allocation (Defect 1 & 7)
  @Prop({ type: [CommercialInventoryConfigSchema], default: [] })
  commercial_inventories?: CommercialInventoryConfig[];

  // Provenance fields (Phase C1: AirLabs-Backed Commercial Flight Foundation)
  @Prop({ default: 'LEGACY_SYNTHETIC', trim: true })
  source_type: string; // 'AIRLABS' | 'LEGACY_SYNTHETIC' | 'MANUAL'

  @Prop({ required: false, trim: true })
  source_route_key?: string; // exact immutable RouteRef.source_key

  @Prop({ required: false, trim: true })
  source_service_key?: string; // coarse stable service grouping

  @Prop({ required: false, uppercase: true, trim: true })
  source_airline_iata?: string;

  @Prop({ required: false, uppercase: true, trim: true })
  source_airline_icao?: string;

  @Prop({ required: false, uppercase: true, trim: true })
  source_flight_iata?: string;

  @Prop({ required: false, uppercase: true, trim: true })
  source_flight_icao?: string;

  @Prop({ required: false, trim: true })
  source_flight_number?: string;

  @Prop({ required: false, uppercase: true, trim: true })
  source_aircraft_icao?: string;

  @Prop({ required: false, trim: true })
  source_dep_time_utc?: string;

  @Prop({ required: false, trim: true })
  source_arr_time_utc?: string;

  @Prop({ required: false, min: 1 })
  source_duration_minutes?: number;

  @Prop({ required: false })
  source_synced_at?: Date;
}

export const ScheduleTemplateSchema = SchemaFactory.createForClass(ScheduleTemplate);

ScheduleTemplateSchema.index({ origin_iata: 1, dest_iata: 1 });
ScheduleTemplateSchema.index({ is_active: 1 });
ScheduleTemplateSchema.index({ source_type: 1 });
ScheduleTemplateSchema.index({ source_service_key: 1 }, { sparse: true });
ScheduleTemplateSchema.index({ source_route_key: 1 }, { sparse: true });
