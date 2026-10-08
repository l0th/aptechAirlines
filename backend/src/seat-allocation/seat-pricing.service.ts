import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CabinClass, Flight, FlightDocument } from '../flights/flights.schema';
import { ScheduleTemplate, ScheduleTemplateDocument } from '../flights/schemas/schedule-template.schema';
import { PhysicalSeatDef, getAircraftLayout } from './fleet-layout.catalog';
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
import {
  SeatPricingProfile,
  SeatPricingProfileDocument,
  SeatPricingProfileSnapshot,
} from './seat-pricing-profile.schema';
import {
  AssignSeatPricingProfileDto,
  CreateSeatPricingProfileDto,
  UpdateSeatPricingProfileDto,
} from './seat-pricing-profile.dto';

export interface SeatPricingSnapshot {
  rule_ids: string[];
  dimensions: string[];
  flight_override: boolean;
  final_fee: number;
  profile_id?: string;
  profile_code?: string;
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
    @Optional()
    @InjectModel(SeatPricingProfile.name)
    private readonly profileModel?: Model<SeatPricingProfileDocument>,
    @Optional()
    @InjectModel(Flight.name)
    private readonly flightModel?: Model<FlightDocument>,
    @Optional()
    @InjectModel(ScheduleTemplate.name)
    private readonly templateModel?: Model<ScheduleTemplateDocument>,
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
    profileSnapshot?: SeatPricingProfileSnapshot,
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

    const profile = profileSnapshot ?? await this.getFlightProfileSnapshot(flightId);

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

    if (profile) {
      let totalFee = 0;
      const matchedRuleIds: string[] = [];
      const matchedDims: string[] = [];
      for (const dim of applicableDimensions) {
        const candidates = (profile.rules || [])
          .filter(
            (rule) =>
              rule.pricing_dimension === dim &&
              (rule.cabin_class === seat.cabin_class || rule.cabin_class === 'ALL'),
          )
          .sort((a, b) => {
            const cabinSpecific = Number(b.cabin_class === seat.cabin_class) - Number(a.cabin_class === seat.cabin_class);
            return cabinSpecific || Number(b.priority || 0) - Number(a.priority || 0);
          });
        if (candidates.length) {
          const winner = candidates[0];
          totalFee += Number(winner.amount || 0);
          matchedRuleIds.push(`${profile.code}:${winner.cabin_class}:${dim}`);
          matchedDims.push(dim);
        }
      }
      return {
        rule_ids: matchedRuleIds,
        dimensions: matchedDims.length ? matchedDims : ['PROFILE_DEFAULT_FREE'],
        flight_override: false,
        final_fee: Math.max(0, totalFee),
        profile_id: profile.profile_id,
        profile_code: profile.code,
      };
    }

    // 3. Query active global rules for this cabin class or ALL cabins.
    // These rules remain the backwards-compatible fallback for flights without a profile.
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

  async listProfiles() {
    const profileModel = this.requireProfileModel();
    const profiles = await profileModel.find().sort({ is_active: -1, updatedAt: -1 }).lean().exec();
    const ids = profiles.map((profile: any) => String(profile._id));
    const [flightCounts, templateCounts] = await Promise.all([
      this.countByProfile(this.flightModel, ids),
      this.countByProfile(this.templateModel, ids),
    ]);
    return profiles.map((profile: any) => ({
      ...profile,
      assigned_flights: flightCounts[String(profile._id)] || 0,
      assigned_templates: templateCounts[String(profile._id)] || 0,
    }));
  }

  async createProfile(
    dto: CreateSeatPricingProfileDto,
    userId?: Types.ObjectId | string,
  ) {
    const profileModel = this.requireProfileModel();
    const aircraftType = this.normalizeAircraftType(dto.aircraft_type);
    this.validateProfileRules(dto.rules);
    const createdBy = this.optionalObjectId(userId);
    try {
      return await profileModel.create({
        ...dto,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        aircraft_type: aircraftType,
        rules: this.normalizeProfileRules(dto.rules),
        version: 1,
        created_by_user_id: createdBy,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException(`Seat pricing profile code ${dto.code.toUpperCase()} already exists.`);
      }
      throw error;
    }
  }

  async updateProfile(id: string, dto: UpdateSeatPricingProfileDto) {
    const current = await this.requireProfile(id);
    const targetAircraft = this.normalizeAircraftType(dto.aircraft_type ?? current.aircraft_type);
    const rules = dto.rules ?? (current.rules as any[]);
    this.validateProfileRules(rules as any[]);

    if (targetAircraft !== current.aircraft_type) {
      await this.assertAssignedTargetsCompatible(String(current._id), targetAircraft);
    }

    if (dto.name !== undefined) current.name = dto.name.trim();
    if (dto.description !== undefined) current.description = dto.description.trim();
    if (dto.is_active !== undefined) current.is_active = dto.is_active;
    current.aircraft_type = targetAircraft;
    if (dto.rules !== undefined) current.rules = this.normalizeProfileRules(dto.rules) as any;
    current.version = Number(current.version || 1) + 1;
    await current.save();

    const snapshot = this.toProfileSnapshot(current);
    await Promise.all([
      this.flightModel?.updateMany(
        { seat_pricing_profile_id: String(current._id) },
        { $set: { seat_pricing_profile_snapshot: snapshot } },
      ).exec(),
      this.templateModel?.updateMany(
        { seat_pricing_profile_id: String(current._id) },
        { $set: { seat_pricing_profile_snapshot: snapshot } },
      ).exec(),
    ]);
    return current;
  }

  async assignProfile(id: string, dto: AssignSeatPricingProfileDto) {
    const profile = await this.requireProfile(id);
    if (!profile.is_active) throw new BadRequestException('Inactive seat pricing profiles cannot be assigned.');
    const flightIds = [...new Set(dto.flight_ids || [])];
    const templateIds = [...new Set(dto.template_ids || [])];
    if (!flightIds.length && !templateIds.length) {
      throw new BadRequestException('Select at least one flight or commercial template.');
    }
    if (flightIds.length && !this.flightModel) throw new BadRequestException('Flight model is not available.');
    if (templateIds.length && !this.templateModel) throw new BadRequestException('Template model is not available.');

    const [flights, templates] = await Promise.all([
      flightIds.length ? this.flightModel!.find({ _id: { $in: flightIds } }).exec() : Promise.resolve([]),
      templateIds.length ? this.templateModel!.find({ _id: { $in: templateIds } }).exec() : Promise.resolve([]),
    ]);
    if (flights.length !== flightIds.length) throw new BadRequestException('One or more selected flights do not exist.');
    if (templates.length !== templateIds.length) throw new BadRequestException('One or more selected templates do not exist.');

    for (const flight of flights as any[]) {
      this.assertAircraftCompatible(profile.aircraft_type, flight.aircraft?.model_code, `flight ${flight.flight_number}`);
    }
    for (const template of templates as any[]) {
      this.assertAircraftCompatible(profile.aircraft_type, template.aircraft_type, `template ${template.template_id}`);
    }

    const snapshot = this.toProfileSnapshot(profile);
    const [flightResult, templateResult] = await Promise.all([
      flightIds.length
        ? this.flightModel!.updateMany(
            { _id: { $in: flightIds } },
            { $set: { seat_pricing_profile_id: String(profile._id), seat_pricing_profile_snapshot: snapshot } },
          ).exec()
        : Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
      templateIds.length
        ? this.templateModel!.updateMany(
            { _id: { $in: templateIds } },
            { $set: { seat_pricing_profile_id: String(profile._id), seat_pricing_profile_snapshot: snapshot } },
          ).exec()
        : Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    ]);
    const inheritedFlightFilter: Record<string, any> = {
      commercial_template_id: { $in: templateIds },
    };
    if (profile.aircraft_type !== 'ALL') {
      inheritedFlightFilter['aircraft.model_code'] = profile.aircraft_type;
    }
    const inheritedResult = templateIds.length && this.flightModel
      ? await this.flightModel.updateMany(
          inheritedFlightFilter,
          { $set: { seat_pricing_profile_id: String(profile._id), seat_pricing_profile_snapshot: snapshot } },
        ).exec()
      : { matchedCount: 0, modifiedCount: 0 };

    return {
      profile: snapshot,
      flights_matched: (flightResult as any).matchedCount || 0,
      flights_updated: (flightResult as any).modifiedCount || 0,
      templates_matched: (templateResult as any).matchedCount || 0,
      templates_updated: (templateResult as any).modifiedCount || 0,
      inherited_flights_matched: (inheritedResult as any).matchedCount || 0,
      inherited_flights_updated: (inheritedResult as any).modifiedCount || 0,
    };
  }

  async deleteProfile(id: string) {
    const profile = await this.requireProfile(id);
    const profileId = String(profile._id);
    const [flights, templates] = await Promise.all([
      this.flightModel?.countDocuments({ seat_pricing_profile_id: profileId }).exec() ?? 0,
      this.templateModel?.countDocuments({ seat_pricing_profile_id: profileId }).exec() ?? 0,
    ]);
    if (flights || templates) {
      throw new ConflictException(
        `Seat pricing profile is still assigned to ${flights} flight(s) and ${templates} template(s). Reassign them before deleting.`,
      );
    }
    await profile.deleteOne();
    return { deleted: true, id: profileId };
  }

  async getFlightProfileSnapshot(
    flightId: Types.ObjectId | string,
  ): Promise<SeatPricingProfileSnapshot | undefined> {
    if (!this.flightModel || !Types.ObjectId.isValid(flightId)) return undefined;
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const flight = await this.flightModel
      .findById(fId)
      .select({ seat_pricing_profile_snapshot: 1 })
      .lean()
      .exec();
    return (flight as any)?.seat_pricing_profile_snapshot as SeatPricingProfileSnapshot | undefined;
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
   * Admin: Re-activate a rule that was turned off with deactivateRule.
   * Only the latest version of a rule chain can be re-activated; versions that were
   * superseded by an edit (a newer `-Vn` rule points to them) stay archived.
   */
  async activateRule(ruleId: string): Promise<SeatPricingRuleDocument> {
    const existing = await this.ruleModel.findOne({ rule_id: ruleId }).exec();
    if (!existing) {
      throw new NotFoundException(`Rule with ID '${ruleId}' not found.`);
    }
    if (existing.is_active) return existing;
    const newer = await this.ruleModel.findOne({ supersedes_rule_id: ruleId }).exec();
    if (newer) {
      throw new BadRequestException(
        `Rule '${ruleId}' đã được thay bằng phiên bản mới '${newer.rule_id}'. Hãy bật/sửa phiên bản mới.`,
      );
    }
    existing.is_active = true;
    existing.set('deactivated_at', undefined);
    existing.set('deactivated_by_user_id', undefined);
    return existing.save();
  }

  private requireProfileModel(): Model<SeatPricingProfileDocument> {
    if (!this.profileModel) throw new BadRequestException('Seat pricing profile storage is not available.');
    return this.profileModel;
  }

  private async requireProfile(id: string): Promise<SeatPricingProfileDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid seat pricing profile id.');
    const profile = await this.requireProfileModel().findById(id).exec();
    if (!profile) throw new NotFoundException('Seat pricing profile not found.');
    return profile;
  }

  private normalizeAircraftType(value: string): string {
    const normalized = String(value || 'ALL').trim().toUpperCase();
    if (normalized === 'ALL') return normalized;
    getAircraftLayout(normalized);
    return normalized;
  }

  private normalizeProfileRules(rules: any[]) {
    return rules.map((rule) => ({
      cabin_class: String(rule.cabin_class || 'ALL').toUpperCase(),
      pricing_dimension: rule.pricing_dimension,
      amount: Math.max(0, Number(rule.amount || 0)),
      priority: Number(rule.priority || 0),
    }));
  }

  private validateProfileRules(rules: any[]) {
    if (!Array.isArray(rules) || !rules.length) {
      throw new BadRequestException('Seat pricing profile requires at least one rule.');
    }
    const validCabins = new Set(['ALL', ...Object.values(CabinClass)]);
    const seen = new Set<string>();
    for (const rule of rules) {
      const cabin = String(rule.cabin_class || '').toUpperCase();
      if (!validCabins.has(cabin)) throw new BadRequestException(`Invalid cabin class ${cabin}.`);
      if (!Object.values(PricingDimension).includes(rule.pricing_dimension)) {
        throw new BadRequestException(`Invalid seat pricing dimension ${rule.pricing_dimension}.`);
      }
      if (!Number.isFinite(Number(rule.amount)) || Number(rule.amount) < 0) {
        throw new BadRequestException('Seat pricing amount must be a non-negative number.');
      }
      const key = `${cabin}:${rule.pricing_dimension}`;
      if (seen.has(key)) throw new BadRequestException(`Duplicate profile rule ${key}.`);
      seen.add(key);
    }
  }

  private toProfileSnapshot(profile: any): SeatPricingProfileSnapshot {
    return {
      profile_id: String(profile._id),
      code: profile.code,
      name: profile.name,
      version: Number(profile.version || 1),
      aircraft_type: profile.aircraft_type || 'ALL',
      rules: this.normalizeProfileRules(profile.rules || []) as any,
    };
  }

  private assertAircraftCompatible(profileAircraft: string, targetAircraft: string | undefined, targetLabel: string) {
    const expected = String(profileAircraft || 'ALL').toUpperCase();
    const actual = String(targetAircraft || '').toUpperCase();
    if (expected !== 'ALL' && expected !== actual) {
      throw new BadRequestException(
        `Seat pricing profile for ${expected} cannot be assigned to ${targetLabel} using ${actual || 'unknown aircraft'}.`,
      );
    }
  }

  private async assertAssignedTargetsCompatible(profileId: string, targetAircraft: string) {
    if (targetAircraft === 'ALL') return;
    const [flight, template] = await Promise.all([
      this.flightModel?.findOne({
        seat_pricing_profile_id: profileId,
        'aircraft.model_code': { $ne: targetAircraft },
      }).lean().exec(),
      this.templateModel?.findOne({
        seat_pricing_profile_id: profileId,
        aircraft_type: { $ne: targetAircraft },
      }).lean().exec(),
    ]);
    if (flight || template) {
      throw new ConflictException(
        `Cannot change profile aircraft to ${targetAircraft} while it is assigned to incompatible flights/templates.`,
      );
    }
  }

  private optionalObjectId(userId?: Types.ObjectId | string): Types.ObjectId | undefined {
    if (!userId) return undefined;
    if (userId instanceof Types.ObjectId) return userId;
    return Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
  }

  private async countByProfile(model: Model<any> | undefined, ids: string[]) {
    if (!model || !ids.length) return {} as Record<string, number>;
    const rows = await model.aggregate([
      { $match: { seat_pricing_profile_id: { $in: ids } } },
      { $group: { _id: '$seat_pricing_profile_id', count: { $sum: 1 } } },
    ]).exec();
    return Object.fromEntries(rows.map((row: any) => [String(row._id), Number(row.count)]));
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
