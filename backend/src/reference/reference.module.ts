import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceService } from './reference.service';
import { ReferenceController } from './reference.controller';
import { Country, CountrySchema, City, CitySchema, RouteRef, RouteRefSchema } from './reference.schema';
import { AirportsModule } from '../airports/airports.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: RouteRef.name, schema: RouteRefSchema },
    ]),
    AirportsModule,
  ],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
