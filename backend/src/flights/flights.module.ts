import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Flight, FlightSchema } from './flights.schema';
import { ScheduleTemplate, ScheduleTemplateSchema } from './schemas/schedule-template.schema';
import { Booking, BookingSchema } from '../bookings/bookings.schema';
import { AirportsModule } from '../airports/airports.module';
import { Airport, AirportSchema } from '../airports/airports.schema';
import { ReferenceModule } from '../reference/reference.module';
import { RouteRef, RouteRefSchema } from '../reference/reference.schema';
import { UsersModule } from '../users/users.module';
import { FlightGeneratorService } from './flight-generator.service';
import { FlightsScheduler } from './flights.scheduler';
import { AirlabsCommercialService } from './airlabs-commercial.service';
import { SeatAllocationModule } from '../seat-allocation/seat-allocation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: ScheduleTemplate.name, schema: ScheduleTemplateSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: RouteRef.name, schema: RouteRefSchema },
    ]),
    AirportsModule,
    ReferenceModule,
    UsersModule,
    SeatAllocationModule,
  ],
  controllers: [FlightsController],
  providers: [
    FlightsService,
    FlightGeneratorService,
    FlightsScheduler,
    AirlabsCommercialService,
  ],
  exports: [
    FlightsService,
    FlightGeneratorService,
    FlightsScheduler,
    AirlabsCommercialService,
    MongooseModule,
  ],
})
export class FlightsModule {}
