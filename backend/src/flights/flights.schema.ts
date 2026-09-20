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
  @Prop()
  model_code?: string;

  @Prop()
  model_name?: string;

  @Prop()
  total_capacity?: number;

  @Prop()
  registration?: string;
}

@Schema({ _id: false })
export class InventorySagaMarker {
  @Prop({ required: true })
  mutation_key: string;

  @Prop({ required: true })
  operation_id: string;

  @Prop({ required: true, enum: ['RESERVE_NEW', 'RESTORE_OLD'] })
  action: 'RESERVE_NEW' | 'RESTORE_OLD';

  @Prop({ required: true, min: 1 })
  seat_count: number;

  @Prop({ required: true, enum: ['APPLIED', 'COMPENSATED'], default: 'APPLIED' })
  state: 'APPLIED' | 'COMPENSATED';

  @Prop({ default: () => new Date() })
  created_at: Date;

  @Prop({ required: false })
  compensated_at?: Date;
}
export const InventorySagaMarkerSchema = SchemaFactory.createForClass(InventorySagaMarker);

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

  @Prop({ type: [InventorySagaMarkerSchema], default: [] })
  saga_markers: InventorySagaMarker[];
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

  // Sky Miles reference (miles earned on this flight).
  // Computed from the real great-circle distance between the two airports' coordinates
  // (see FlightsService.greatCircleMiles). 0 = unknown, never a made-up constant.
  @Prop({ required: true, default: 0 })
  distance_miles: number;

  @Prop({ type: String, enum: FlightStatus, default: FlightStatus.SCHEDULED })
  status: FlightStatus;

  // Requirement 1.2.3 & 3.9: emergency changes or bad weather notes
  @Prop({ default: '' })
  delay_reason: string;

  @Prop()
  delay_minutes?: number;

  @Prop({ type: AircraftInfo })
  aircraft?: AircraftInfo;

  @Prop({ type: [FlightInventorySchema], default: [] })
  inventories: FlightInventory[];

  // Provenance & Deterministic Schedule Identity (Phase A)
  @Prop({ required: false, trim: true })
  template_id?: string;

  @Prop({ required: false })
  operating_date?: string;

  @Prop({ default: false })
  is_generated: boolean;

  @Prop({ default: 'seed' })
  generated_source?: string;

  @Prop({ default: false })
  is_manually_modified: boolean;

  @Prop({ required: true, uppercase: true, trim: true, default: 'APTECH_AIRLINES' })
  operator: string;

  @Prop({ required: true, default: true, index: true })
  is_bookable: boolean;

  @Prop({ default: 'INTERNAL_GENERATED' })
  data_source: string;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

// Covering and compound indexes for 15k+ operational flight documents
FlightSchema.index({ template_id: 1, operating_date: 1 }, { unique: true, sparse: true });
FlightSchema.index({ flight_number: 1, departure_date: 1 });
FlightSchema.index({ origin_iata: 1, departure_date: 1, status: 1 });
FlightSchema.index({ dest_iata: 1, departure_date: 1, status: 1 });
FlightSchema.index({ origin_iata: 1, dest_iata: 1, departure_date: 1, status: 1 });
FlightSchema.index({ is_bookable: 1, origin_iata: 1, dest_iata: 1, departure_date: 1, status: 1 });
FlightSchema.index({ operator: 1, is_bookable: 1 });
FlightSchema.index({ status: 1, scheduled_departure: 1 });
