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
import { MailModule } from '../mail/mail.module';
import { PaypalModule } from '../paypal/paypal.module';
import { PricingProfile, PricingProfileSchema } from './schemas/pricing-profile.schema';
import { RevenuePricingService } from './revenue-pricing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: ScheduleTemplate.name, schema: ScheduleTemplateSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: RouteRef.name, schema: RouteRefSchema },
      { name: PricingProfile.name, schema: PricingProfileSchema },
    ]),
    AirportsModule,
    ReferenceModule,
    UsersModule,
    SeatAllocationModule,
    MailModule,
    PaypalModule,
  ],
  controllers: [FlightsController],
  providers: [
    FlightsService,
    FlightGeneratorService,
    FlightsScheduler,
    AirlabsCommercialService,
    RevenuePricingService,
  ],
  exports: [
    FlightsService,
    FlightGeneratorService,
    FlightsScheduler,
    AirlabsCommercialService,
    RevenuePricingService,
    MongooseModule,
  ],
})
export class FlightsModule {}
