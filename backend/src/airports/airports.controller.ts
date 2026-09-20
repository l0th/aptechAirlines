import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AirportsService } from './airports.service';
import { CreateAirportDto, UpdateAirportDto } from './airports.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

// Admin roles allowed to mutate airport reference data and run syncs
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

// NOTE: all @Get routes stay public (guests need airport lookup to search flights).
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

  @Post('sync-airlabs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async syncAirLabs(@Query('iata_code') iataCode?: string) {
    if (!iataCode) {
      throw new BadRequestException('iata_code query parameter is required');
    }
    return this.airportsService.syncAirportFromAirLabs(iataCode);
  }

  @Post('sync-airlabs-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async syncAirLabsAll() {
    return this.airportsService.syncAllAirportsFromAirLabs();
  }

  @Post('import-country')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async importCountry(
    @Query('country_code') countryCode: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!countryCode) {
      throw new BadRequestException('Tham số country_code là bắt buộc');
    }
    const parsedLimit = limit && !isNaN(parseInt(limit, 10)) ? parseInt(limit, 10) : 1000;
    const parsedOffset = offset && !isNaN(parseInt(offset, 10)) ? parseInt(offset, 10) : 0;
    return this.airportsService.importAirportsForCountry(countryCode, parsedLimit, parsedOffset);
  }

  @Post('import-countries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async importCountries(@Query('codes') codes: string, @Req() req: any) {
    if (!codes) {
      throw new BadRequestException('Tham số codes là bắt buộc');
    }
    const codesList = codes.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
    if (codesList.length > 40) {
      throw new BadRequestException('Tối đa 40 mã quốc gia');
    }
    return this.airportsService.importAirportsForCountries(codesList, req.headers?.authorization);
  }

  @Post('fix-city-names')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async fixCityNames() {
    return this.airportsService.fixCityNames();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async create(@Body() createAirportDto: CreateAirportDto) {
    return this.airportsService.create(createAirportDto);
  }

  @Put(':iata')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async update(
    @Param('iata') iata: string,
    @Body() updateAirportDto: UpdateAirportDto,
  ) {
    return this.airportsService.update(iata, updateAirportDto);
  }

  @Delete(':iata')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async delete(@Param('iata') iata: string) {
    return this.airportsService.delete(iata);
  }
}
