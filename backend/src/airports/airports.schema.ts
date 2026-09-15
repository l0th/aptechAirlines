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

  // Requirement 3.3.1: check if directly serviced
  @Prop({ default: true })
  is_serviced_directly: boolean;

  // Nearest city/airport if not directly serviced
  @Prop({ default: '' })
  nearest_airport_code: string;

  @Prop({ default: 0 })
  distance_to_nearest_km: number;

  @Prop({ default: 'Asia/Ho_Chi_Minh' })
  time_zone: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
