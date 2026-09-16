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

export type RouteRefDocument = RouteRef & Document;
@Schema({ timestamps: true })
export class RouteRef {
  @Prop({ required: true, uppercase: true, trim: true })
  airline_iata: string;

  @Prop({ uppercase: true, trim: true })
  airline_icao?: string;

  @Prop({ required: true, uppercase: true, trim: true })
  dep_iata: string;

  @Prop({ required: true, uppercase: true, trim: true })
  arr_iata: string;

  @Prop({ uppercase: true, trim: true })
  aircraft_icao?: string;

  @Prop({ default: 'airlabs' })
  source?: string;
}
export const RouteRefSchema = SchemaFactory.createForClass(RouteRef);
RouteRefSchema.index({ airline_iata: 1, dep_iata: 1, arr_iata: 1 }, { unique: true });
RouteRefSchema.index({ dep_iata: 1, arr_iata: 1 });
