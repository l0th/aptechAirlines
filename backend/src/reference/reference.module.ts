import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceService } from './reference.service';
import { RouteGraphService } from './route-graph.service';
import { RouteIndexMigrationService } from './route-index-migration.service';
import { RouteScheduleValidatorService } from './route-schedule-validator.service';
import { ReferenceController } from './reference.controller';
import { Country, CountrySchema, City, CitySchema, RouteRef, RouteRefSchema, RouteSyncState, RouteSyncStateSchema } from './reference.schema';
import { AirportsModule } from '../airports/airports.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: RouteRef.name, schema: RouteRefSchema },
      { name: RouteSyncState.name, schema: RouteSyncStateSchema },
    ]),
    AirportsModule,
  ],
  controllers: [ReferenceController],
  providers: [ReferenceService, RouteGraphService, RouteIndexMigrationService, RouteScheduleValidatorService],
  exports: [ReferenceService, RouteGraphService, RouteIndexMigrationService, RouteScheduleValidatorService],
})
export class ReferenceModule {}
