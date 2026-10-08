import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';
import { MailAdminService } from './mail-admin.service';

@Controller('mail')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class MailController {
  constructor(private readonly mailAdmin: MailAdminService) {}

  @Get('templates')
  listTemplates() {
    return this.mailAdmin.listTemplates();
  }

  @Get('templates/:key/preview')
  preview(@Param('key') key: string) {
    return this.mailAdmin.preview(key);
  }

  @Post('templates/:key/test')
  sendTest(@Param('key') key: string, @Body() body: { to: string }) {
    return this.mailAdmin.sendTest(key, body?.to);
  }

  @Patch('templates/:key')
  setEnabled(@Param('key') key: string, @Body() body: { enabled: boolean }) {
    return this.mailAdmin.setEnabled(key, body?.enabled);
  }

  @Get('logs')
  listLogs(
    @Query('template') template?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.mailAdmin.listLogs({ template, status, q, page, limit });
  }
}
