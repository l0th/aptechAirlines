import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import * as dotenv from 'dotenv';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AirportsModule } from './airports/airports.module';
import { FlightsModule } from './flights/flights.module';
import { PoliciesModule } from './policies/policies.module';
import { BookingsModule } from './bookings/bookings.module';
import { SeedModule } from './seed/seed.module';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/airline_db';

@Module({
  imports: [
    MongooseModule.forRoot(mongoUri),
    UsersModule,
    AuthModule,
    AirportsModule,
    FlightsModule,
    PoliciesModule,
    BookingsModule,
    SeedModule,
  ],
})
export class AppModule {}
