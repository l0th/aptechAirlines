import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SeatAllocation, SeatAllocationSchema } from './seat-allocation.schema';
import { FlightSeatOverride, FlightSeatOverrideSchema } from './flight-seat-override.schema';
import { SeatPricingRule, SeatPricingRuleSchema } from './seat-pricing-rule.schema';
import { SeatPricingProfile, SeatPricingProfileSchema } from './seat-pricing-profile.schema';
import {
  BookingSeatSagaOperation,
  BookingSeatSagaOperationSchema,
} from './booking-seat-saga-operation.schema';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SeatAllocationService } from './seat-allocation.service';
import { SeatPricingService } from './seat-pricing.service';
import { FleetLayoutService } from './fleet-layout.service';
import { SeatAllocationController } from './seat-allocation.controller';
import { Flight, FlightSchema } from '../flights/flights.schema';
import { ScheduleTemplate, ScheduleTemplateSchema } from '../flights/schemas/schedule-template.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: SeatAllocation.name, schema: SeatAllocationSchema },
      { name: FlightSeatOverride.name, schema: FlightSeatOverrideSchema },
      { name: SeatPricingRule.name, schema: SeatPricingRuleSchema },
      { name: SeatPricingProfile.name, schema: SeatPricingProfileSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: ScheduleTemplate.name, schema: ScheduleTemplateSchema },
      { name: BookingSeatSagaOperation.name, schema: BookingSeatSagaOperationSchema },
    ]),
  ],
  controllers: [SeatAllocationController],
  providers: [SeatAllocationService, SeatPricingService, FleetLayoutService],
  exports: [
    SeatAllocationService,
    SeatPricingService,
    FleetLayoutService,
    MongooseModule,
  ],
})
export class SeatAllocationModule {}
