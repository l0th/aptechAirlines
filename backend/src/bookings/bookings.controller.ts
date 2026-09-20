import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsScheduler } from './bookings.scheduler';
import {
  CancelTicketDto,
  ConfirmTicketDto,
  CreateBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { BookingStatus } from './bookings.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

// Staff roles allowed to view all bookings and manage anyone's bookings
const STAFF_ROLES = [UserRole.CLERK, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly bookingsScheduler: BookingsScheduler,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() createBookingDto: CreateBookingDto,
  ) {
    // Customers can only create bookings for themselves
    if (req.user.role === UserRole.CUSTOMER) {
      createBookingDto.user_id = req.user.sub;
    }
    return this.bookingsService.createBooking(createBookingDto);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  async confirm(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() confirmTicketDto: ConfirmTicketDto,
  ) {
    await this.bookingsService.assertOwnership(
      confirmTicketDto.blocking_number,
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.confirmTicket(confirmTicketDto);
  }

  @Post('reschedule')
  @UseGuards(JwtAuthGuard)
  async reschedule(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() rescheduleTicketDto: RescheduleTicketDto,
  ) {
    await this.bookingsService.assertOwnership(
      rescheduleTicketDto.confirmation_number,
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.rescheduleTicket(rescheduleTicketDto);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() cancelTicketDto: CancelTicketDto,
  ) {
    await this.bookingsService.assertOwnership(
      cancelTicketDto.identifier,
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.cancelTicket(cancelTicketDto);
  }

  // Requirement 3.9: Authenticated customer can track their own tickets; staff can track any ticket
  @Get('track/:code')
  @UseGuards(JwtAuthGuard)
  async track(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('code') code: string,
  ) {
    await this.bookingsService.assertOwnership(
      code,
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.trackTicket(code);
  }

  // Requirement 1.3.5: Allow authenticated customers to retrieve their own bookings list
  @Get('my-trips')
  @UseGuards(JwtAuthGuard)
  async getMyTrips(@Req() req: { user: { sub: string } }) {
    return this.bookingsService.findAll(undefined, req.user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async findAll(
    @Query('status') status?: BookingStatus,
    @Query('user_id') userId?: string,
  ) {
    return this.bookingsService.findAll(status, userId);
  }

  // Admin-triggerable scheduler endpoints so the reminder/expiry jobs can be
  // demoed without waiting for the hourly cron.
  @Post('scheduler/run-reminders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async runReminders() {
    const processed = await this.bookingsScheduler.sendPendingReminders();
    return { message: `Reminder job finished. ${processed} reminder(s) sent.` };
  }

  @Post('scheduler/run-expiry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async runExpiry() {
    const processed = await this.bookingsScheduler.autoCancelExpiredBlocks();
    return { message: `Expiry job finished. ${processed} booking(s) auto-cancelled.` };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }
}
