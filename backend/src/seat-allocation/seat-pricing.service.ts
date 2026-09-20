import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CabinClass } from '../flights/flights.schema';
import { PhysicalSeatDef } from './fleet-layout.catalog';
import {
  SeatPricingRule,
  SeatPricingRuleDocument,
  PricingDimension,
  SeatPositionSubtype,
} from './seat-pricing-rule.schema';
import {
  FlightSeatOverride,
  FlightSeatOverrideDocument,
} from './flight-seat-override.schema';

export interface SeatPricingSnapshot {
  rule_ids: string[];
  dimensions: string[];
  flight_override: boolean;
  final_fee: number;
}

export interface CreateSeatPricingRuleDto {
  rule_id: string;
  cabin_class: CabinClass | 'ALL';
  pricing_dimension: PricingDimension;
  position_subtype?: SeatPositionSubtype;
  amount: number;
  priority?: number;
  effective_from?: Date;
  effective_to?: Date;
}

export interface UpdateSeatPricingRuleDto {
  amount?: number;
  priority?: number;
  effective_from?: Date;
  effective_to?: Date;
}

@Injectable()
export class SeatPricingService implements OnModuleInit {
  private readonly logger = new Logger(SeatPricingService.name);

  constructor(
    @InjectModel(SeatPricingRule.name)
    private readonly ruleModel: Model<SeatPricingRuleDocument>,
    @InjectModel(FlightSeatOverride.name)
    private readonly overrideModel: Model<FlightSeatOverrideDocument>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultRulesIfEmpty();
  }

  /**
   * Evaluates authoritative seat fee for a given seat on a flight.
   * AUTO assignment is ALWAYS 0 fee.
   */
  async calculateSeatFee(
    flightId: Types.ObjectId | string,
    seat: PhysicalSeatDef,
    selectionType: 'AUTO' | 'CHOOSE',
  ): Promise<SeatPricingSnapshot> {
    if (selectionType === 'AUTO') {
      return {
        rule_ids: [],
        dimensions: ['AUTO_SELECTION'],
        flight_override: false,
        final_fee: 0,
      };
    }

    const fId = Types.ObjectId.isValid(flightId)
      ? typeof flightId === 'string'
        ? new Types.ObjectId(flightId)
        : flightId
      : flightId;
    const activeOverride = await this.overrideModel.findOne({
      flight_id: fId,
      seat_code: seat.seat_code,
      is_active: true,
    }).exec();

    if (activeOverride) {
      return {
        rule_ids: [],
        dimensions: ['FLIGHT_OVERRIDE'],
        flight_override: true,
        final_fee: activeOverride.override_fee,
      };
    }

    // 2. Resolve applicable dimensions independently (no else-if between independent attributes!)
    const applicableDimensions: PricingDimension[] = [];

    // CABIN_BASE is always evaluated
    applicableDimensions.push(PricingDimension.CABIN_BASE);

    // Position dimension: WINDOW, AISLE, or MIDDLE
    if (seat.position === 'WINDOW') {
      applicableDimensions.push(PricingDimension.WINDOW);
    } else if (seat.position === 'AISLE') {
      applicableDimensions.push(PricingDimension.AISLE);
    } else if (seat.position === 'MIDDLE') {
      applicableDimensions.push(PricingDimension.MIDDLE);
    }

    // Physical seat features: independent dimensions
    if (seat.is_exit_row) {
      applicableDimensions.push(PricingDimension.EXIT_ROW);
    }

    if (seat.is_extra_legroom) {
      applicableDimensions.push(PricingDimension.EXTRA_LEGROOM);
    }

    if (seat.is_bulkhead) {
      applicableDimensions.push(PricingDimension.BULKHEAD);
    }

    if (seat.is_front_zone) {
      applicableDimensions.push(PricingDimension.FRONT_ZONE);
    }

    // 3. Query active global rules for this cabin class or ALL cabins
    const now = new Date();
    const rules = await this.ruleModel.find({
      cabin_class: { $in: [seat.cabin_class, 'ALL'] },
      is_active: true,
      effective_from: { $lte: now },
      $or: [{ effective_to: { $exists: false } }, { effective_to: null }, { effective_to: { $gte: now } }],
    }).sort({ priority: -1, createdAt: -1, rule_id: 1 }).exec();

    // 4. Stacking: distinct dimensions stack additively.
    // Winner per dimension: priority DESC, createdAt DESC, rule_id ASC
    let totalFee = 0;
    const matchedRuleIds: string[] = [];
    const matchedDims: string[] = [];

    for (const dim of applicableDimensions) {
      const candidates = rules.filter((r) => {
        if (r.pricing_dimension === dim) return true;
        // Legacy alias fallbacks
        if (dim === PricingDimension.CABIN_BASE && (r.pricing_dimension as any) === 'BASE_CABIN') return true;
        if (dim === PricingDimension.EXIT_ROW && (r.pricing_dimension as any) === 'EMERGENCY_EXIT') return true;
        if (dim === PricingDimension.FRONT_ZONE && (r.pricing_dimension as any) === 'FRONT_ROW') return true;
        if ((r.pricing_dimension as any) === 'SEAT_POSITION') {
          if (dim === PricingDimension.WINDOW && r.position_subtype === SeatPositionSubtype.WINDOW) return true;
          if (dim === PricingDimension.AISLE && r.position_subtype === SeatPositionSubtype.AISLE) return true;
          if (dim === PricingDimension.MIDDLE && r.position_subtype === SeatPositionSubtype.MIDDLE) return true;
        }
        return false;
      });

      if (candidates.length > 0) {
        // Highest priority winner for this dimension (deterministic: priority DESC, createdAt DESC, rule_id ASC)
        const winner = candidates[0];
        totalFee += winner.amount;
        matchedRuleIds.push(winner.rule_id);
        matchedDims.push(dim);
      }
    }

    return {
      rule_ids: matchedRuleIds,
      dimensions: matchedDims.length > 0 ? matchedDims : ['DEFAULT_FREE'],
      flight_override: false,
      final_fee: Math.max(0, totalFee),
    };
  }

  /**
   * Admin: List all seat pricing rules.
   */
  async getAllRules(): Promise<SeatPricingRuleDocument[]> {
    return this.ruleModel.find().sort({ cabin_class: 1, pricing_dimension: 1, priority: -1 }).exec();
  }

  /**
   * Admin: Create a new seat pricing rule.
   */
  async createRule(dto: CreateSeatPricingRuleDto, userId: Types.ObjectId | string): Promise<SeatPricingRuleDocument> {
    const existing = await this.ruleModel.findOne({ rule_id: dto.rule_id }).exec();
    if (existing) {
      throw new BadRequestException(`Rule with ID '${dto.rule_id}' already exists.`);
    }

    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const rule = new this.ruleModel({
      ...dto,
      version: 1,
      is_active: true,
      created_by_user_id: uId,
    });
    return rule.save();
  }

  /**
   * Admin: Update an existing seat pricing rule.
   * Enforces immutability: deactivates old rule and creates a new version.
   */
  async updateRule(
    ruleId: string,
    dto: UpdateSeatPricingRuleDto,
    userId: Types.ObjectId | string,
  ): Promise<SeatPricingRuleDocument> {
    const existing = await this.ruleModel.findOne({ rule_id: ruleId, is_active: true }).exec();
    if (!existing) {
      throw new NotFoundException(`Active rule with ID '${ruleId}' not found.`);
    }

    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // Soft-deactivate existing rule with audit trail
    existing.is_active = false;
    existing.deactivated_by_user_id = uId;
    existing.deactivated_at = new Date();
    await existing.save();

    // Create new immutable version
    const newVersion = existing.version + 1;
    const newRuleId = `${existing.rule_id.replace(/-V\d+$/, '')}-V${newVersion}`;

    const updated = new this.ruleModel({
      rule_id: newRuleId,
      supersedes_rule_id: existing.rule_id,
      version: newVersion,
      is_active: true,
      cabin_class: existing.cabin_class,
      pricing_dimension: existing.pricing_dimension,
      position_subtype: existing.position_subtype,
      amount: dto.amount !== undefined ? dto.amount : existing.amount,
      priority: dto.priority !== undefined ? dto.priority : existing.priority,
      effective_from: dto.effective_from || new Date(),
      effective_to: dto.effective_to !== undefined ? dto.effective_to : existing.effective_to,
      created_by_user_id: uId,
    });

    return updated.save();
  }

  /**
   * Admin: Deactivate a rule.
   */
  async deactivateRule(ruleId: string, userId?: Types.ObjectId | string): Promise<SeatPricingRuleDocument> {
    const existing = await this.ruleModel.findOne({ rule_id: ruleId, is_active: true }).exec();
    if (!existing) {
      throw new NotFoundException(`Active rule with ID '${ruleId}' not found.`);
    }
    existing.is_active = false;
    existing.deactivated_at = new Date();
    if (userId) {
      existing.deactivated_by_user_id = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    }
    return existing.save();
  }

  /**
   * Seed default baseline seat pricing rules if none exist.
   */
  private async seedDefaultRulesIfEmpty(): Promise<void> {
    const count = await this.ruleModel.countDocuments().exec();
    if (count > 0) return;

    this.logger.log('Seeding default Phase B seat pricing rules...');
    const systemUserId = new Types.ObjectId('000000000000000000000001');

    const defaultRules: Partial<SeatPricingRule>[] = [
      // Economy Exit Row: +150,000 VND
      {
        rule_id: 'R-ECO-EXIT-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.EXIT_ROW,
        amount: 150000,
        priority: 10,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Economy Extra Legroom: +100,000 VND
      {
        rule_id: 'R-ECO-LEGROOM-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.EXTRA_LEGROOM,
        amount: 100000,
        priority: 10,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Economy Front Zone: +80,000 VND
      {
        rule_id: 'R-ECO-FRONT-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.FRONT_ZONE,
        amount: 80000,
        priority: 8,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Economy Bulkhead: +120,000 VND
      {
        rule_id: 'R-ECO-BULKHEAD-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.BULKHEAD,
        amount: 120000,
        priority: 9,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Economy Window: +50,000 VND
      {
        rule_id: 'R-ECO-WINDOW-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.WINDOW,
        amount: 50000,
        priority: 5,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Economy Aisle: +30,000 VND
      {
        rule_id: 'R-ECO-AISLE-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.AISLE,
        amount: 30000,
        priority: 5,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Club Extra Legroom: +200,000 VND
      {
        rule_id: 'R-CLUB-LEGROOM-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.CLUB,
        pricing_dimension: PricingDimension.EXTRA_LEGROOM,
        amount: 200000,
        priority: 10,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
      // Business: All free seat selection by default
      {
        rule_id: 'R-BIZ-BASE-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.BUSINESS,
        pricing_dimension: PricingDimension.CABIN_BASE,
        amount: 0,
        priority: 1,
        effective_from: new Date('2026-01-01'),
        created_by_user_id: systemUserId,
      },
    ];

    await this.ruleModel.insertMany(defaultRules);
    this.logger.log(`✅ Seeded ${defaultRules.length} default seat pricing rules.`);
  }
}
