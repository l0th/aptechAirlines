import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FlightDocument = Flight & Document;

export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  DELAYED = 'DELAYED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum CabinClass {
  ECONOMY = 'ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
  CLUB = 'CLUB',
}

@Schema({ _id: false })
export class AircraftInfo {
  @Prop({ required: true, default: 'A321' })
  model_code: string;

  @Prop({ required: true, default: 'Airbus A321' })
  model_name: string;

  @Prop({ required: true, default: 180 })
  total_capacity: number;
}

@Schema({ _id: true })
export class FlightInventory {
  @Prop({ type: String, enum: CabinClass, required: true })
  cabin_class: CabinClass;

  // Requirement 3.3.4: smoking / non smoking option
  @Prop({ default: false })
  is_smoking: boolean;

  @Prop({ default: 'Y' })
  bucket_code: string;

  @Prop({ required: true, min: 0 })
  base_price: number;

  @Prop({ required: true, min: 0 })
  allocated_seats: number;

  @Prop({ required: true, min: 0 })
  available_seats: number;
}
export const FlightInventorySchema = SchemaFactory.createForClass(FlightInventory);

@Schema({ timestamps: true })
export class Flight {
  @Prop({ required: true, uppercase: true, trim: true })
  flight_number: string;

  @Prop({ required: true, uppercase: true, trim: true })
  origin_iata: string;

  @Prop({ required: true, uppercase: true, trim: true })
  dest_iata: string;

  @Prop({ required: true })
  departure_date: string; // YYYY-MM-DD format for easy range queries

  @Prop({ required: true })
  scheduled_departure: Date;

  @Prop({ required: true })
  scheduled_arrival: Date;

  @Prop()
  actual_departure?: Date;

  @Prop()
  actual_arrival?: Date;

  @Prop({ required: true, default: 120 })
  duration_minutes: number;

  // Sky Miles reference (miles earned on this flight)
  @Prop({ required: true, default: 500 })
  distance_miles: number;

  @Prop({ type: String, enum: FlightStatus, default: FlightStatus.SCHEDULED })
  status: FlightStatus;

  // Requirement 1.2.3 & 3.9: emergency changes or bad weather notes
  @Prop({ default: '' })
  delay_reason: string;

  @Prop({ type: AircraftInfo, default: () => ({}) })
  aircraft: AircraftInfo;

  @Prop({ type: [FlightInventorySchema], default: [] })
  inventories: FlightInventory[];
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

// Index for fast search queries
FlightSchema.index({ origin_iata: 1, dest_iata: 1, departure_date: 1 });
