import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailService } from './mail.service';
import { EmailLog, EmailLogSchema, EmailSetting, EmailSettingSchema } from './email-log.schema';
import { User, UserSchema } from '../users/users.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailLog.name, schema: EmailLogSchema },
      { name: EmailSetting.name, schema: EmailSettingSchema },
      // Read-only use: look up the recipient's preferred email language.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [MailService],
  exports: [MailService, MongooseModule],
})
export class MailModule {}
