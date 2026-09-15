import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FlightsService } from './flights.service';
import {
  CreateFlightDto,
  SearchFlightDto,
  UpdateFlightDto,
  UpdateFlightStatusDto,
} from './flights.dto';
import { FlightStatus } from './flights.schema';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Get('search')
  async search(@Query() searchDto: SearchFlightDto) {
    return this.flightsService.searchFlights(searchDto);
  }

  @Get()
  async findAll(
    @Query('status') status?: FlightStatus,
    @Query('origin') origin?: string,
    @Query('dest') dest?: string,
  ) {
    return this.flightsService.findAll(status, origin, dest);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.flightsService.findById(id);
  }

  @Get(':id/seat-map')
  async getSeatMap(@Param('id') id: string) {
    return this.flightsService.getSeatMap(id);
  }

  @Post()
  async create(@Body() createFlightDto: CreateFlightDto) {
    return this.flightsService.create(createFlightDto);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateFlightDto: UpdateFlightDto,
  ) {
    return this.flightsService.update(id, updateFlightDto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateFlightStatusDto,
  ) {
    return this.flightsService.updateStatus(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.flightsService.delete(id);
  }
}
