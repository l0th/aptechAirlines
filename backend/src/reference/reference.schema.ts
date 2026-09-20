import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CountryDocument = Country & Document;
@Schema({ timestamps: true })
export class Country {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop()
  code3?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  name_vi?: string;

  @Prop({ default: 'airlabs' })
  source?: string;
}
export const CountrySchema = SchemaFactory.createForClass(Country);

export type CityDocument = City & Document;
@Schema({ timestamps: true })
export class City {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  city_code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  name_vi?: string;

  @Prop({ required: true, uppercase: true, trim: true })
  country_code: string;

  @Prop()
  lat?: number;

  @Prop()
  lng?: number;

  @Prop({ default: 'airlabs' })
  source?: string;
}
export const CitySchema = SchemaFactory.createForClass(City);

export enum RouteSource {
  APTECH_INTERNAL = 'aptech_internal',
  AIRLABS = 'airlabs',
}

export type RouteRefDocument = RouteRef & Document;
@Schema({ timestamps: true, autoIndex: false })
export class RouteRef {
  @Prop({ required: true, uppercase: true, trim: true })
  source_key: string;

  @Prop({ uppercase: true, trim: true })
  airline_iata?: string;

  @Prop({ uppercase: true, trim: true })
  airline_icao?: string;

  @Prop({ trim: true })
  flight_number?: string;

  @Prop({ uppercase: true, trim: true })
  flight_iata?: string;

  @Prop({ uppercase: true, trim: true })
  flight_icao?: string;

  @Prop({ uppercase: true, trim: true })
  cs_airline_iata?: string;

  @Prop({ uppercase: true, trim: true })
  cs_flight_iata?: string;

  @Prop({ trim: true })
  cs_flight_number?: string;

  @Prop({ required: true, uppercase: true, trim: true })
  dep_iata: string;

  @Prop({ uppercase: true, trim: true })
  dep_icao?: string;

  @Prop({ trim: true })
  dep_time?: string;

  @Prop({ trim: true })
  dep_time_utc?: string;

  @Prop({ type: [String] })
  dep_terminals?: string[];

  @Prop({ required: true, uppercase: true, trim: true })
  arr_iata: string;

  @Prop({ uppercase: true, trim: true })
  arr_icao?: string;

  @Prop({ trim: true })
  arr_time?: string;

  @Prop({ trim: true })
  arr_time_utc?: string;

  @Prop({ type: [String] })
  arr_terminals?: string[];

  @Prop()
  duration?: number;

  @Prop({ type: [String] })
  days?: string[];

  @Prop({ uppercase: true, trim: true })
  aircraft_icao?: string;

  @Prop({ default: false })
  has_schedule?: boolean;

  @Prop({ default: 'aptech_internal' })
  source?: string;

  @Prop({ default: Date.now })
  synced_at?: Date;

  @Prop()
  airlabs_updated?: string;

  @Prop({ trim: true })
  sync_generation?: string;
}
export const RouteRefSchema = SchemaFactory.createForClass(RouteRef);
RouteRefSchema.set('autoIndex', false);
RouteRefSchema.index({ source_key: 1 }, { unique: true, sparse: true });
RouteRefSchema.index({ dep_iata: 1, arr_iata: 1 });
RouteRefSchema.index({ source: 1, dep_iata: 1, arr_iata: 1 });
RouteRefSchema.index({ dep_iata: 1, synced_at: 1 });
RouteRefSchema.index({ dep_iata: 1, sync_generation: 1 });

export type RouteSyncStateDocument = RouteSyncState & Document;
@Schema({ timestamps: true })
export class RouteSyncState {
  @Prop({ required: true, uppercase: true, trim: true })
  dep_iata: string;

  @Prop({ default: 'airlabs' })
  source: string;

  @Prop({ trim: true })
  sync_generation?: string;

  @Prop({ default: 0 })
  next_offset?: number;

  @Prop({ default: false })
  generation_started_at_offset_zero?: boolean;

  @Prop({ required: true })
  last_synced_at: Date;

  @Prop({ required: true, default: false })
  complete: boolean;

  @Prop({ required: true, default: false })
  truncated: boolean;

  @Prop({ default: 0 })
  records_seen: number;

  @Prop({ default: 0 })
  records_upserted: number;

  @Prop()
  last_error?: string;
}
export const RouteSyncStateSchema = SchemaFactory.createForClass(RouteSyncState);
RouteSyncStateSchema.index({ dep_iata: 1, source: 1 }, { unique: true });
