import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FlightsService } from './flights.service';
import {
  CreateFlightDto,
  SearchFlightDto,
  UpdateFlightDto,
  UpdateFlightStatusDto,
} from './flights.dto';
import { FlightStatus } from './flights.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

// Staff roles allowed to mutate flight data (create/update/delete/status)
const STAFF_ROLES = [UserRole.CLERK, UserRole.ADMIN, UserRole.SUPER_ADMIN];

// NOTE: every @Get route below stays public on purpose (requirements 3.3 & 3.10:
// guests must be able to search, lookup and view flights/seat maps without auth).
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

  // Requirement 3.10: public lookup by flight number + date (must be above @Get(':id'))
  @Get('lookup')
  async lookup(
    @Query('flight_number') flightNumber?: string,
    @Query('date') date?: string,
  ) {
    if (!flightNumber || !date) {
      throw new BadRequestException('flight_number and date query params are required');
    }
    return this.flightsService.findByFlightNumberAndDate(flightNumber, date);
  }

  @Get('airline-fleet')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async getAirlineFleet(@Query('airline_iata') airlineIata: string) {
    if (!airlineIata) {
      throw new BadRequestException('airline_iata query param is required');
    }
    return this.flightsService.getAirlineFleet(airlineIata);
  }

  @Post('enrich-airborne')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async enrichAirborneFlightsForToday() {
    return this.flightsService.enrichAirborneFlightsForToday();
  }

  @Get('booking-window')
  async getBookingWindow() {
    const { getBookingWindowLimits } = await import('../common/pricing.util');
    return getBookingWindowLimits();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.flightsService.findById(id);
  }

  @Post(':id/enrich-aircraft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async enrichAircraftFromAirLabs(@Param('id') id: string) {
    return this.flightsService.enrichAircraftFromAirLabs(id);
  }

  @Get(':id/seat-map')
  async getSeatMap(@Param('id') id: string) {
    return this.flightsService.getSeatMap(id);
  }

  @Post('sync-airlabs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async syncAirLabs(
    @Query('mode') mode?: string,
    @Query('dep_iata') depIata?: string,
    @Query('arr_iata') arrIata?: string,
    @Query('airline_iata') airlineIata?: string,
    @Query('flight_iata') flightIata?: string,
    // limit max: 1000 for airport, 200 for airline. Note: Free keys cap at 50.
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('api_key') apiKey?: string,
    @Body('api_key') bodyApiKey?: string,
  ) {
    return this.flightsService.syncFromAirLabs(
      mode,
      depIata,
      arrIata,
      airlineIata,
      flightIata,
      limit ? parseInt(limit.toString(), 10) : 50,
      offset ? parseInt(offset.toString(), 10) : 0,
      apiKey || bodyApiKey,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async create(@Body() createFlightDto: CreateFlightDto) {
    return this.flightsService.create(createFlightDto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async update(
    @Param('id') id: string,
    @Body() updateFlightDto: UpdateFlightDto,
  ) {
    return this.flightsService.update(id, updateFlightDto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateFlightStatusDto,
  ) {
    return this.flightsService.updateStatus(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async delete(@Param('id') id: string) {
    return this.flightsService.delete(id);
  }
}
