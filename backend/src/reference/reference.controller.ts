import { Controller, Get, Post, Query, UseGuards, Body } from '@nestjs/common';
import { ReferenceService } from './reference.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

@Controller('reference')
export class ReferenceController {
  constructor(private readonly referenceService: ReferenceService) {}

  @Get('suggest')
  async suggest(@Query('q') q: string) {
    return this.referenceService.suggest(q);
  }

  @Get('countries')
  async getCountries() {
    return this.referenceService.getAllCountries();
  }

  @Post('sync-countries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async syncCountries(@Body() body: { codes?: string[] }) {
    return this.referenceService.syncCountries(body?.codes);
  }

  @Post('sync-cities')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async syncCities(@Query('country_code') countryCode: string, @Query('limit') limit?: number) {
    return this.referenceService.syncCitiesForCountry(countryCode, limit ? Number(limit) : 200);
  }

  @Post('sync-routes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async syncRoutes(@Query('dep_iata') depIata: string, @Query('limit') limit?: number) {
    return this.referenceService.syncRoutesForAirport(depIata, limit ? Number(limit) : 200);
  }

  @Post('sync-routes-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async syncRoutesAll() {
    return this.referenceService.syncRoutesForAllOurAirports();
  }

  @Post('sync-routes-hubs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async syncRoutesHubs(@Query('hubs') hubs?: string) {
    const hubsList = hubs ? hubs.split(',').map(h => h.trim().toUpperCase()).filter(h => h) : undefined;
    return this.referenceService.syncRoutesForHubs(hubsList);
  }
}
