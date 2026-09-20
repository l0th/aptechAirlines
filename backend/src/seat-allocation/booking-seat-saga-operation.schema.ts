import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BookingSeatSagaOperationDocument = BookingSeatSagaOperation & Document;

export enum SagaOperationType {
  CREATE = 'CREATE',
  RESCHEDULE = 'RESCHEDULE',
}

export enum SagaState {
  PRECOMMIT = 'PRECOMMIT',
  COMMITTED = 'COMMITTED',
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
}

@Schema({ _id: false })
export class InventoryMutationEntry {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flight_id: Types.ObjectId;

  @Prop({ required: true })
  inventory_id: string;

  @Prop({ required: true, min: 1 })
  seat_count: number;

  @Prop({ required: true })
  mutation_key: string;
}

@Schema({ _id: false })
export class SeatAllocationRefEntry {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flight_id: Types.ObjectId;

  @Prop({ required: true, uppercase: true })
  seat_code: string;

  @Prop({ required: false })
  coupon_number?: string;
}

@Schema({ timestamps: true })
export class BookingSeatSagaOperation {
  @Prop({ required: true, unique: true, index: true })
  operation_id: string;

  @Prop({ type: String, enum: SagaOperationType, required: true })
  operation_type: SagaOperationType;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking_id: Types.ObjectId;

  @Prop({ type: String, enum: SagaState, default: SagaState.PRECOMMIT, required: true, index: true })
  state: SagaState;

  @Prop({ type: [InventoryMutationEntry], default: [] })
  new_inventory_reservations: InventoryMutationEntry[];

  @Prop({ type: [InventoryMutationEntry], default: [] })
  old_inventory_restorations: InventoryMutationEntry[];

  @Prop({ type: [SeatAllocationRefEntry], default: [] })
  new_seat_allocations: SeatAllocationRefEntry[];

  @Prop({ type: [SeatAllocationRefEntry], default: [] })
  old_seat_allocations: SeatAllocationRefEntry[];

  @Prop({ required: true, default: () => new Date() })
  last_progress_at: Date;

  @Prop({ required: false })
  aborted_at?: Date;

  @Prop({ required: false })
  completed_at?: Date;

  @Prop({ required: false })
  error?: string;
}

export const BookingSeatSagaOperationSchema = SchemaFactory.createForClass(BookingSeatSagaOperation);

BookingSeatSagaOperationSchema.index({ state: 1, last_progress_at: 1 });
