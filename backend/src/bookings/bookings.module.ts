import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './bookings.schema';
import { FlightsModule } from '../flights/flights.module';
import { AirportsModule } from '../airports/airports.module';
import { UsersModule } from '../users/users.module';
import { PoliciesModule } from '../policies/policies.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { BookingsScheduler } from './bookings.scheduler';
import { SeatAllocationModule } from '../seat-allocation/seat-allocation.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }]),
    FlightsModule,
    AirportsModule,
    UsersModule,
    PoliciesModule,
    AuthModule,
    MailModule,
    SeatAllocationModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsScheduler],
  exports: [BookingsService, MongooseModule],
})
export class BookingsModule {}
