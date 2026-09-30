import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import * as dotenv from 'dotenv';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AirportsModule } from './airports/airports.module';
import { FlightsModule } from './flights/flights.module';
import { PoliciesModule } from './policies/policies.module';
import { BookingsModule } from './bookings/bookings.module';
import { MailModule } from './mail/mail.module';
import { ReferenceModule } from './reference/reference.module';
import { SeatAllocationModule } from './seat-allocation/seat-allocation.module';
import { PaypalModule } from './paypal/paypal.module';
import { AnalyticsModule } from './analytics/analytics.module';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/airline_db';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(mongoUri),
    UsersModule,
    AuthModule,
    AirportsModule,
    FlightsModule,
    PoliciesModule,
    BookingsModule,
    MailModule,
    ReferenceModule,
    SeatAllocationModule,
    PaypalModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
