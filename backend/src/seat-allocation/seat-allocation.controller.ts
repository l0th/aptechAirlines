import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { SeatAllocationService } from './seat-allocation.service';
import { SeatPricingService, CreateSeatPricingRuleDto, UpdateSeatPricingRuleDto } from './seat-pricing.service';
import {
  AssignSeatPricingProfileDto,
  CreateSeatPricingProfileDto,
  UpdateSeatPricingProfileDto,
} from './seat-pricing-profile.dto';
import { SeatAllocationStatus } from './seat-allocation.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/users.schema';

@Controller('seat-allocation')
export class SeatAllocationController {
  constructor(
    private readonly allocationService: SeatAllocationService,
    private readonly pricingService: SeatPricingService,
  ) {}

  /**
   * Public: Retrieve enriched seat map for a flight.
   */
  @Get('flight/:flightId/map')
  async getSeatMap(
    @Param('flightId') flightId: string,
    @Query('aircraftType') aircraftType: string,
  ) {
    if (!aircraftType) {
      throw new BadRequestException('Query parameter aircraftType is required.');
    }
    return this.allocationService.getSeatMap(flightId, aircraftType);
  }

  // ---------------------------------------------------------------------------
  // Staff Flight-Level Operations (Clerk, Admin, SuperAdmin)
  // ---------------------------------------------------------------------------

  @Post('flight/:flightId/block')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async blockSeat(
    @Param('flightId') flightId: string,
    @Body() body: { seat_code: string; reason: SeatAllocationStatus; aircraft_type: string; notes?: string },
    @Request() req: any,
  ) {
    if (!body.seat_code || !body.reason || !body.aircraft_type) {
      throw new BadRequestException('seat_code, reason, and aircraft_type are required.');
    }
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.allocationService.blockSeat(
      flightId,
      body.aircraft_type,
      body.seat_code,
      body.reason,
      userId,
      body.notes,
    );
  }

  @Post('flight/:flightId/unblock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async unblockSeat(
    @Param('flightId') flightId: string,
    @Body() body: { seat_code: string },
  ) {
    if (!body.seat_code) {
      throw new BadRequestException('seat_code is required.');
    }
    await this.allocationService.unblockSeat(flightId, body.seat_code);
    return { message: `Seat ${body.seat_code} unblocked successfully.` };
  }

  @Post('flight/:flightId/override-price')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async setPriceOverride(
    @Param('flightId') flightId: string,
    @Body() body: { seat_code: string; override_fee: number; reason: string },
    @Request() req: any,
  ) {
    if (!body.seat_code || body.override_fee === undefined || !body.reason) {
      throw new BadRequestException('seat_code, override_fee, and reason are required.');
    }
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.allocationService.setPriceOverride(
      flightId,
      body.seat_code,
      body.override_fee,
      body.reason,
      userId,
    );
  }

  @Delete('flight/:flightId/override-price/:seatCode')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CLERK)
  async removePriceOverride(
    @Param('flightId') flightId: string,
    @Param('seatCode') seatCode: string,
    @Request() req: any,
  ) {
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    await this.allocationService.removePriceOverride(flightId, seatCode, userId);
    return { message: `Price override for seat ${seatCode} removed successfully.` };
  }

  // ---------------------------------------------------------------------------
  // Admin Global Seat Pricing Rules (Admin, SuperAdmin)
  // ---------------------------------------------------------------------------

  @Get('pricing-profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getPricingProfiles() {
    return this.pricingService.listProfiles();
  }

  @Post('pricing-profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async createPricingProfile(
    @Body() dto: CreateSeatPricingProfileDto,
    @Request() req: any,
  ) {
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.pricingService.createProfile(dto, userId);
  }

  @Put('pricing-profiles/:profileId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updatePricingProfile(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateSeatPricingProfileDto,
  ) {
    return this.pricingService.updateProfile(profileId, dto);
  }

  @Post('pricing-profiles/:profileId/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async assignPricingProfile(
    @Param('profileId') profileId: string,
    @Body() dto: AssignSeatPricingProfileDto,
  ) {
    return this.pricingService.assignProfile(profileId, dto);
  }

  @Delete('pricing-profiles/:profileId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async deletePricingProfile(@Param('profileId') profileId: string) {
    return this.pricingService.deleteProfile(profileId);
  }

  @Get('pricing-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async getPricingRules() {
    return this.pricingService.getAllRules();
  }

  @Post('pricing-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async createPricingRule(
    @Body() dto: CreateSeatPricingRuleDto,
    @Request() req: any,
  ) {
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.pricingService.createRule(dto, userId);
  }

  @Put('pricing-rules/:ruleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updatePricingRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateSeatPricingRuleDto,
    @Request() req: any,
  ) {
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.pricingService.updateRule(ruleId, dto, userId);
  }

  @Delete('pricing-rules/:ruleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async deactivatePricingRule(
    @Param('ruleId') ruleId: string,
    @Request() req: any,
  ) {
    const userId = req.user?.sub || req.user?._id || req.user?.userId;
    return this.pricingService.deactivateRule(ruleId, userId);
  }

  @Post('pricing-rules/:ruleId/activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async activatePricingRule(@Param('ruleId') ruleId: string) {
    return this.pricingService.activateRule(ruleId);
  }
}
