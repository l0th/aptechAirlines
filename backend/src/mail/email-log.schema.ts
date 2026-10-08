import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EmailLogStatus = 'SENT' | 'FAILED' | 'DEV_FALLBACK';

@Schema({ collection: 'email_logs', timestamps: { createdAt: 'created_at', updatedAt: false } })
export class EmailLog {
  @Prop({ required: true, index: true })
  template_key: string;

  @Prop({ required: true, index: true })
  to: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true, enum: ['SENT', 'FAILED', 'DEV_FALLBACK'], index: true })
  status: EmailLogStatus;

  @Prop()
  error?: string;

  @Prop({ index: true })
  booking_reference?: string;

  created_at?: Date;
}

export type EmailLogDocument = HydratedDocument<EmailLog>;
export const EmailLogSchema = SchemaFactory.createForClass(EmailLog);
EmailLogSchema.index({ created_at: -1 });

@Schema({ collection: 'email_settings', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class EmailSetting {
  @Prop({ required: true, unique: true })
  template_key: string;

  @Prop({ default: true })
  enabled: boolean;
}

export type EmailSettingDocument = HydratedDocument<EmailSetting>;
export const EmailSettingSchema = SchemaFactory.createForClass(EmailSetting);
