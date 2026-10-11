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
  QuoteBookingDto,
  CreatePayPalBookingOrderDto,
  CapturePayPalOrderDto,
  CreatePayPalConfirmHoldOrderDto,
  CreatePayPalRescheduleOrderDto,
} from './bookings.dto';
import { BookingStatus, PaymentMethod } from './bookings.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StrictCustomerGuard } from '../auth/strict-customer.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';
import { UsersService } from '../users/users.service';
import { BadRequestException } from '@nestjs/common';

// Staff roles allowed to view all bookings and manage anyone's bookings
const STAFF_ROLES = [UserRole.CLERK, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly bookingsScheduler: BookingsScheduler,
    private readonly usersService: UsersService,
  ) {}

  /** Old saved-card records remain available for historical refunds, never as new payment proof. */
  private rejectSavedCardPayment(method?: PaymentMethod) {
    if (method === PaymentMethod.PROFILE_CARD) {
      throw new BadRequestException('Saved-card payment is no longer supported. The customer must pay through PayPal Checkout.');
    }
  }

  /**
   * Staff (CLERK/ADMIN) book on behalf of a registered customer: the target
   * user_id must be an existing CUSTOMER account, never the staff member.
   */
  private async resolveStaffTargetCustomer(req: { user: { sub: string; role: UserRole } }, userId?: string) {
    if (!userId || userId === 'self' || userId === req.user.sub) {
      throw new BadRequestException('Nhân viên phải chọn tài khoản khách hàng (user_id) khi đặt vé hộ.');
    }
    const target = await this.usersService.findById(userId);
    if (target.role !== UserRole.CUSTOMER) {
      throw new BadRequestException('Chỉ có thể đặt vé hộ cho tài khoản CUSTOMER.');
    }
    return String(target._id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() createBookingDto: CreateBookingDto,
  ) {
    this.rejectSavedCardPayment(createBookingDto.payment_method);
    const staffAssistedHold = STAFF_ROLES.includes(req.user.role) && createBookingDto.is_block === true;
    // Customers can only create bookings for themselves
    if (req.user.role === UserRole.CUSTOMER) {
      createBookingDto.user_id = req.user.sub;
    } else {
      createBookingDto.user_id = await this.resolveStaffTargetCustomer(req, createBookingDto.user_id);
    }
    return this.bookingsService.createBooking(createBookingDto, undefined, { staffAssistedHold });
  }

  @Post('quote')
  @UseGuards(JwtAuthGuard)
  async quote(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() quoteBookingDto: QuoteBookingDto,
  ) {
    const targetUserId = req.user.role === UserRole.CUSTOMER
      ? req.user.sub
      : await this.resolveStaffTargetCustomer(req, quoteBookingDto.user_id);
    quoteBookingDto.user_id = targetUserId;
    return this.bookingsService.quoteBooking(quoteBookingDto, targetUserId);
  }

  @Post('reschedule/quote')
  @UseGuards(JwtAuthGuard)
  async quoteReschedule(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() rescheduleTicketDto: RescheduleTicketDto,
  ) {
    await this.bookingsService.assertOwnership(
      rescheduleTicketDto.pnr_code || rescheduleTicketDto.confirmation_number || '',
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.quoteRescheduleTicket(rescheduleTicketDto, req.user.sub);
  }

  @Post('paypal/create-order')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async createPayPalOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() dto: CreatePayPalBookingOrderDto,
  ) {
    dto.user_id = req.user.sub;
    return this.bookingsService.createPayPalBookingOrder(dto, req.user.sub);
  }

  @Post('paypal/checkouts/:checkoutId/capture')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async capturePayPalOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('checkoutId') checkoutId: string,
    @Body() dto: CapturePayPalOrderDto,
  ) {
    return this.bookingsService.capturePayPalBooking(
      checkoutId,
      dto.order_id,
      req.user.sub,
      req.user.role,
    );
  }

  @Post('paypal/confirm-hold/create-order')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async createPayPalConfirmHoldOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() dto: CreatePayPalConfirmHoldOrderDto,
  ) {
    await this.bookingsService.assertOwnership(
      dto.blocking_number,
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.createPayPalConfirmHoldOrder(dto, req.user.sub);
  }

  @Post('paypal/confirm-hold/:checkoutId/capture')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async capturePayPalConfirmHoldOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('checkoutId') checkoutId: string,
    @Body() dto: CapturePayPalOrderDto,
  ) {
    return this.bookingsService.capturePayPalConfirmHold(
      checkoutId,
      dto.order_id,
      req.user.sub,
      req.user.role,
    );
  }

  @Post('paypal/reschedule/create-order')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async createPayPalRescheduleOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() dto: CreatePayPalRescheduleOrderDto,
  ) {
    await this.bookingsService.assertOwnership(
      dto.pnr_code || dto.confirmation_number || '',
      req.user.sub,
      req.user.role,
    );
    return this.bookingsService.createPayPalRescheduleOrder(dto, req.user.sub);
  }

  @Post('paypal/reschedule/:checkoutId/capture')
  @UseGuards(JwtAuthGuard, StrictCustomerGuard)
  async capturePayPalRescheduleOrder(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('checkoutId') checkoutId: string,
    @Body() dto: CapturePayPalOrderDto,
  ) {
    return this.bookingsService.capturePayPalReschedule(
      checkoutId,
      dto.order_id,
      req.user.sub,
      req.user.role,
    );
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  async confirm(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() confirmTicketDto: ConfirmTicketDto,
  ) {
    this.rejectSavedCardPayment(confirmTicketDto.payment_method);
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
    this.rejectSavedCardPayment(rescheduleTicketDto.payment_method);
    await this.bookingsService.assertOwnership(
      rescheduleTicketDto.pnr_code || rescheduleTicketDto.confirmation_number || '',
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
    return {
      processed,
      message: `Reminder job finished. ${processed} reminder(s) sent.`,
      messageVi: `Đã hoàn tất tác vụ nhắc thanh toán. Đã gửi ${processed} email.`,
      messageEn: `Payment-reminder job finished. ${processed} email(s) sent.`,
    };
  }

  @Post('scheduler/run-travel-reminders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async runTravelReminders() {
    const processed = await this.bookingsScheduler.sendUpcomingTripReminders();
    return {
      processed,
      message: `Upcoming-trip reminder job finished. ${processed} reminder(s) sent.`,
      messageVi: `Đã hoàn tất tác vụ nhắc chuyến sắp bay. Đã gửi ${processed} email.`,
      messageEn: `Upcoming-trip reminder job finished. ${processed} email(s) sent.`,
    };
  }

  @Post('scheduler/run-expiry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async runExpiry() {
    const processed = await this.bookingsScheduler.autoCancelExpiredBlocks();
    return {
      processed,
      message: `Expiry job finished. ${processed} booking(s) auto-cancelled.`,
      messageVi: `Đã hoàn tất tác vụ hết hạn. Đã tự động hủy ${processed} đặt chỗ.`,
      messageEn: `Expiry job finished. ${processed} booking(s) auto-cancelled.`,
    };
  }

  @Post(':id/send-reminder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async sendBookingReminder(@Param('id') id: string) {
    return this.bookingsScheduler.sendManualReminder(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }
}
