import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from './mail.module';
import { MailController } from './mail.controller';
import { MailAdminService } from './mail-admin.service';

/**
 * Admin email-center endpoints. Kept separate from MailModule because
 * AuthModule already imports MailModule (password reset) and the guards
 * need AuthModule's JwtModule export.
 */
@Module({
  imports: [MailModule, AuthModule],
  controllers: [MailController],
  providers: [MailAdminService],
})
export class MailAdminModule {}
