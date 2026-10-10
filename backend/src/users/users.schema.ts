import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  CLERK = 'CLERK',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({ required: true })
  password_hash: string;

  @Prop({ required: true, trim: true })
  first_name: string;

  @Prop({ required: true, trim: true })
  last_name: string;

  @Prop({ default: '' })
  address: string;

  @Prop({ default: '' })
  phone_number: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email: string;

  @Prop({ default: 'OTHER' })
  sex: string;

  @Prop({ default: 0 })
  age: number;

  @Prop({ default: '' })
  preferred_credit_card: string;

  // Requirement 3.2: Automatically initialize sky miles to 0
  @Prop({ default: 0 })
  sky_miles: number;

  @Prop({ type: String, enum: UserRole, default: UserRole.CUSTOMER })
  role: UserRole;

  // Account lock flag: inactive (locked) users cannot log in
  @Prop({ default: true })
  is_active: boolean;

  @Prop()
  password_reset_code_hash?: string;

  @Prop()
  password_reset_expires_at?: Date;

  // Language chosen on the website (VI/EN switch). All emails to this user are
  // rendered entirely in this language. Defaults to Vietnamese.
  @Prop({ type: String, enum: ['vi', 'en'], default: 'vi' })
  preferred_language: 'vi' | 'en';
}

export const UserSchema = SchemaFactory.createForClass(User);
