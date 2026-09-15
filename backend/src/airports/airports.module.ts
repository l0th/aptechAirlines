import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { Airport, AirportSchema } from './airports.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Airport.name, schema: AirportSchema }]),
  ],
  controllers: [AirportsController],
  providers: [AirportsService],
  exports: [AirportsService, MongooseModule],
})
export class AirportsModule {}
