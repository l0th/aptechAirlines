import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Flight, FlightSchema } from './flights.schema';
import { Booking, BookingSchema } from '../bookings/bookings.schema';
import { AirportsModule } from '../airports/airports.module';
import { ReferenceModule } from '../reference/reference.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    AirportsModule,
    ReferenceModule,
    UsersModule,
  ],
  controllers: [FlightsController],
  providers: [FlightsService],
  exports: [FlightsService, MongooseModule],
})
export class FlightsModule {}
