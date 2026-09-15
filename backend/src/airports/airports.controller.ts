import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AirportsService } from './airports.service';
import { CreateAirportDto, UpdateAirportDto } from './airports.dto';

@Controller('airports')
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  async findAll(@Query('search') search?: string) {
    return this.airportsService.findAll(search);
  }

  @Get('resolve')
  async resolveCity(@Query('city') city: string) {
    return this.airportsService.resolveCity(city);
  }

  @Get(':iata')
  async findOne(@Param('iata') iata: string) {
    return this.airportsService.findByIata(iata);
  }

  @Post()
  async create(@Body() createAirportDto: CreateAirportDto) {
    return this.airportsService.create(createAirportDto);
  }

  @Put(':iata')
  async update(
    @Param('iata') iata: string,
    @Body() updateAirportDto: UpdateAirportDto,
  ) {
    return this.airportsService.update(iata, updateAirportDto);
  }

  @Delete(':iata')
  async delete(@Param('iata') iata: string) {
    return this.airportsService.delete(iata);
  }
}
