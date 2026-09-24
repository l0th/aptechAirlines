import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Booking, BookingSchema } from '../bookings/bookings.schema';
import { Flight, FlightSchema } from '../flights/flights.schema';
import { User, UserSchema } from '../users/users.schema';
import { SeatAllocation, SeatAllocationSchema } from '../seat-allocation/seat-allocation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: User.name, schema: UserSchema },
      { name: SeatAllocation.name, schema: SeatAllocationSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
