import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  CancelTicketDto,
  ConfirmTicketDto,
  CreateBookingDto,
  RescheduleTicketDto,
} from './bookings.dto';
import { BookingStatus } from './bookings.schema';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  async create(@Body() createBookingDto: CreateBookingDto) {
    return this.bookingsService.createBooking(createBookingDto);
  }

  @Post('confirm')
  async confirm(@Body() confirmTicketDto: ConfirmTicketDto) {
    return this.bookingsService.confirmTicket(confirmTicketDto);
  }

  @Post('reschedule')
  async reschedule(@Body() rescheduleTicketDto: RescheduleTicketDto) {
    return this.bookingsService.rescheduleTicket(rescheduleTicketDto);
  }

  @Post('cancel')
  async cancel(@Body() cancelTicketDto: CancelTicketDto) {
    return this.bookingsService.cancelTicket(cancelTicketDto);
  }

  @Get('track/:code')
  async track(@Param('code') code: string) {
    return this.bookingsService.trackTicket(code);
  }

  @Get()
  async findAll(
    @Query('status') status?: BookingStatus,
    @Query('user_id') userId?: string,
  ) {
    return this.bookingsService.findAll(status, userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }
}
