import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AirportDocument = Airport & Document;

@Schema({ timestamps: true })
export class Airport {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  iata_code: string;

  @Prop({ required: true, trim: true })
  city_name: string;

  @Prop({ required: true, trim: true })
  airport_name: string;

  // Requirement 3.3.1: check if directly serviced (default false for reference data)
  @Prop({ default: false })
  is_serviced_directly: boolean;

  // Nearest city/airport if not directly serviced
  @Prop({ default: '' })
  nearest_airport_code: string;

  @Prop({ default: 0 })
  distance_to_nearest_km: number;

  @Prop({ default: 'UTC' })
  time_zone: string;

  @Prop({ required: false })
  icao_code?: string;

  @Prop({ required: false })
  country_code?: string;

  @Prop({ required: false })
  city_code?: string;

  @Prop({ required: false })
  lat?: number;

  @Prop({ required: false })
  lng?: number;

  @Prop({ default: 'ourairports' })
  data_source?: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);

// Performance indexes for suggestion autocomplete, city resolution and location expansion
AirportSchema.index({ city_name: 1 });
AirportSchema.index({ city_name: 1, is_serviced_directly: 1 });
AirportSchema.index({ is_serviced_directly: 1 });
AirportSchema.index({ country_code: 1 });
