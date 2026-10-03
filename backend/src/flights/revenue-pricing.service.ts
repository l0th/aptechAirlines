import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PricingProfileSnapshot } from '../common/pricing-profile.types';
import { Flight, FlightDocument } from './flights.schema';
import { AssignPricingProfileDto, CreatePricingProfileDto, UpdatePricingProfileDto } from './pricing-profile.dto';
import { PricingProfile, PricingProfileDocument } from './schemas/pricing-profile.schema';
import { ScheduleTemplate, ScheduleTemplateDocument } from './schemas/schedule-template.schema';

@Injectable()
export class RevenuePricingService {
  constructor(
    @InjectModel(PricingProfile.name) private readonly profileModel: Model<PricingProfileDocument>,
    @InjectModel(Flight.name) private readonly flightModel: Model<FlightDocument>,
    @InjectModel(ScheduleTemplate.name) private readonly templateModel: Model<ScheduleTemplateDocument>,
  ) {}

  async listProfiles() {
    const profiles = await this.profileModel.find().sort({ is_active: -1, updatedAt: -1 }).lean().exec();
    const ids = profiles.map((p: any) => String(p._id));
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

  async createProfile(dto: CreatePricingProfileDto, userId?: string) {
    this.validateRules(dto.advance_rules, dto.load_factor_rules);
    try {
      return await this.profileModel.create({
        ...dto,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        version: 1,
        created_by_user_id: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
      });
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException(`Pricing profile code ${dto.code.toUpperCase()} already exists.`);
      throw error;
    }
  }

  async updateProfile(id: string, dto: UpdatePricingProfileDto) {
    const current = await this.requireProfile(id);
    const advanceRules = dto.advance_rules ?? (current.advance_rules as any[]);
    const loadRules = dto.load_factor_rules ?? (current.load_factor_rules as any[]);
    this.validateRules(advanceRules as any, loadRules as any);

    if (dto.name !== undefined) current.name = dto.name.trim();
    if (dto.description !== undefined) current.description = dto.description.trim();
    if (dto.is_active !== undefined) current.is_active = dto.is_active;
    if (dto.advance_rules !== undefined) current.advance_rules = dto.advance_rules as any;
    if (dto.load_factor_rules !== undefined) current.load_factor_rules = dto.load_factor_rules as any;
    current.version = Number(current.version || 1) + 1;
    await current.save();

    const snapshot = this.toSnapshot(current);
    await Promise.all([
      this.flightModel.updateMany(
        { pricing_profile_id: String(current._id) },
        { $set: { pricing_profile_snapshot: snapshot } },
      ).exec(),
      this.templateModel.updateMany(
        { pricing_profile_id: String(current._id) },
        { $set: { pricing_profile_snapshot: snapshot } },
      ).exec(),
    ]);
    return current;
  }

  async assignProfile(id: string, dto: AssignPricingProfileDto) {
    const profile = await this.requireProfile(id);
    if (!profile.is_active) throw new BadRequestException('Inactive pricing profiles cannot be assigned.');
    const flightIds = [...new Set(dto.flight_ids || [])];
    const templateIds = [...new Set(dto.template_ids || [])];
    if (!flightIds.length && !templateIds.length) {
      throw new BadRequestException('Select at least one flight or commercial template.');
    }
    const snapshot = this.toSnapshot(profile);
    const [flightResult, templateResult] = await Promise.all([
      flightIds.length
        ? this.flightModel.updateMany(
            { _id: { $in: flightIds.map((x) => new Types.ObjectId(x)) } },
            { $set: { pricing_profile_id: String(profile._id), pricing_profile_snapshot: snapshot } },
          ).exec()
        : Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
      templateIds.length
        ? this.templateModel.updateMany(
            { _id: { $in: templateIds.map((x) => new Types.ObjectId(x)) } },
            { $set: { pricing_profile_id: String(profile._id), pricing_profile_snapshot: snapshot } },
          ).exec()
        : Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    ]);
    const inheritedFlightResult = templateIds.length
      ? await this.flightModel.updateMany(
          { commercial_template_id: { $in: templateIds } },
          { $set: { pricing_profile_id: String(profile._id), pricing_profile_snapshot: snapshot } },
        ).exec()
      : { matchedCount: 0, modifiedCount: 0 };
    return {
      profile: snapshot,
      flights_matched: (flightResult as any).matchedCount || 0,
      flights_updated: (flightResult as any).modifiedCount || 0,
      templates_matched: (templateResult as any).matchedCount || 0,
      templates_updated: (templateResult as any).modifiedCount || 0,
      inherited_flights_matched: (inheritedFlightResult as any).matchedCount || 0,
      inherited_flights_updated: (inheritedFlightResult as any).modifiedCount || 0,
    };
  }

  async deleteProfile(id: string) {
    const profile = await this.requireProfile(id);
    const profileId = String(profile._id);
    const [flights, templates] = await Promise.all([
      this.flightModel.countDocuments({ pricing_profile_id: profileId }),
      this.templateModel.countDocuments({ pricing_profile_id: profileId }),
    ]);
    if (flights || templates) {
      throw new ConflictException(
        `Pricing profile is still assigned to ${flights} flight(s) and ${templates} template(s). Reassign them before deleting.`,
      );
    }
    await profile.deleteOne();
    return { deleted: true, id: profileId };
  }

  private async requireProfile(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid pricing profile id.');
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) throw new NotFoundException('Pricing profile not found.');
    return profile;
  }

  private toSnapshot(profile: any): PricingProfileSnapshot {
    return {
      profile_id: String(profile._id),
      code: profile.code,
      name: profile.name,
      version: Number(profile.version || 1),
      advance_rules: (profile.advance_rules || []).map((r: any) => ({
        min_days: Number(r.min_days),
        max_days: r.max_days === null || r.max_days === undefined ? null : Number(r.max_days),
        adjustment_percent: Number(r.adjustment_percent),
        label: r.label,
        label_en: r.label_en,
      })),
      load_factor_rules: (profile.load_factor_rules || []).map((r: any) => ({
        min_load_percent: Number(r.min_load_percent),
        max_load_percent: Number(r.max_load_percent),
        adjustment_percent: Number(r.adjustment_percent),
        label: r.label,
        label_en: r.label_en,
      })),
    };
  }

  private validateRules(advanceRules: any[], loadRules: any[]) {
    const advance = [...advanceRules].sort((a, b) => Number(a.min_days) - Number(b.min_days));
    if (!advance.length) throw new BadRequestException('At least one advance-purchase rule is required.');
    if (Number(advance[0].min_days) !== 0) throw new BadRequestException('Advance-purchase rules must start at 0 days.');
    for (let i = 0; i < advance.length; i++) {
      const rule = advance[i];
      const min = Number(rule.min_days);
      const max = rule.max_days === null || rule.max_days === undefined ? null : Number(rule.max_days);
      if (max !== null && max < min) throw new BadRequestException('Advance-purchase rule max_days must be >= min_days.');
      if (i < advance.length - 1) {
        if (max === null) throw new BadRequestException('Only the final advance-purchase rule may be open-ended.');
        if (Number(advance[i + 1].min_days) !== max + 1) {
          throw new BadRequestException('Advance-purchase rules must be contiguous without gaps or overlaps.');
        }
      } else if (max !== null) {
        throw new BadRequestException('The final advance-purchase rule must have no max_days.');
      }
    }

    if (!loadRules.length) throw new BadRequestException('At least one load-factor rule is required.');
    const sortedLoad = [...loadRules].sort((a, b) => Number(a.min_load_percent) - Number(b.min_load_percent));
    if (Number(sortedLoad[0].min_load_percent) !== 0) {
      throw new BadRequestException('Load-factor rules must start at 0%.');
    }
    for (let i = 0; i < sortedLoad.length; i++) {
      const rule = sortedLoad[i];
      const min = Number(rule.min_load_percent);
      const max = Number(rule.max_load_percent);
      if (max < min) throw new BadRequestException('Load-factor rule max must be >= min.');
      if (i > 0 && min !== Number(sortedLoad[i - 1].max_load_percent)) {
        throw new BadRequestException('Load-factor rules must be contiguous without gaps or overlaps.');
      }
    }
    if (Number(sortedLoad[sortedLoad.length - 1].max_load_percent) !== 100) {
      throw new BadRequestException('Load-factor rules must end at 100%.');
    }
  }

  private async countByProfile(model: Model<any>, ids: string[]) {
    if (!ids.length) return {} as Record<string, number>;
    const rows = await model.aggregate([
      { $match: { pricing_profile_id: { $in: ids } } },
      { $group: { _id: '$pricing_profile_id', count: { $sum: 1 } } },
    ]).exec();
    return Object.fromEntries(rows.map((row: any) => [String(row._id), Number(row.count)]));
  }
}
