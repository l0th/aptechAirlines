import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { UsersModule } from '../users/users.module';
import { AirportsModule } from '../airports/airports.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [
    UsersModule,
    AirportsModule,
    PoliciesModule,
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
