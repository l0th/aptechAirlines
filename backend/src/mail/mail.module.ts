import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailService } from './mail.service';
import { EmailLog, EmailLogSchema, EmailSetting, EmailSettingSchema } from './email-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailLog.name, schema: EmailLogSchema },
      { name: EmailSetting.name, schema: EmailSettingSchema },
    ]),
  ],
  providers: [MailService],
  exports: [MailService, MongooseModule],
})
export class MailModule {}
