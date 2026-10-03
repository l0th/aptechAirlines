import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CancellationPolicy, PolicyDocument } from './policies.schema';
import { CreatePolicyDto, UpdatePolicyDto } from './policies.dto';

@Injectable()
export class PoliciesService {
  constructor(
    @InjectModel(CancellationPolicy.name)
    private policyModel: Model<PolicyDocument>,
  ) {}

  async findAll(): Promise<CancellationPolicy[]> {
    const policies = await this.policyModel.find().sort({ min_days_before: -1 }).exec();
    return policies.map((policy) => this.applyGeneratedDescriptions(policy));
  }

  async findById(id: string): Promise<PolicyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid policy ID format');
    }
    const policy = await this.policyModel.findById(id).exec();
    if (!policy) {
      throw new NotFoundException(`Policy with ID ${id} not found`);
    }
    return this.applyGeneratedDescriptions(policy);
  }

  // Calculate applicable refund percentage based on how many days before departure
  async calculateRefundPercentage(daysBeforeDeparture: number): Promise<number> {
    const normalizedDays = Math.floor(Math.max(0, daysBeforeDeparture));
    const policies = await this.findAll();
    for (const policy of policies) {
      if (policy.max_days_before !== null && policy.max_days_before !== undefined) {
        if (normalizedDays >= policy.min_days_before && normalizedDays <= policy.max_days_before) {
          return policy.refund_percentage;
        }
      } else {
        // No upper bound (e.g. >= min_days_before)
        if (normalizedDays >= policy.min_days_before) {
          return policy.refund_percentage;
        }
      }
    }
    return 0; // Default no refund
  }

  async create(createPolicyDto: CreatePolicyDto): Promise<PolicyDocument> {
    const minDays = createPolicyDto.min_days_before;
    const maxDays = createPolicyDto.max_days_before ?? null;
    const refundPercentage = createPolicyDto.refund_percentage;

    this.validateRange(minDays, maxDays);
    const descriptions = this.buildDescriptions(minDays, maxDays, refundPercentage);
    const created = new this.policyModel({
      min_days_before: minDays,
      max_days_before: maxDays,
      refund_percentage: refundPercentage,
      ...descriptions,
    });
    return created.save();
  }

  async update(id: string, updatePolicyDto: UpdatePolicyDto): Promise<PolicyDocument> {
    const policy = await this.findById(id);

    const hasMaxDays = Object.prototype.hasOwnProperty.call(updatePolicyDto, 'max_days_before');
    const minDays = updatePolicyDto.min_days_before ?? policy.min_days_before;
    const maxDays = hasMaxDays
      ? (updatePolicyDto.max_days_before ?? null)
      : (policy.max_days_before ?? null);
    const refundPercentage = updatePolicyDto.refund_percentage ?? policy.refund_percentage;

    this.validateRange(minDays, maxDays);
    const descriptions = this.buildDescriptions(minDays, maxDays, refundPercentage);

    policy.min_days_before = minDays;
    policy.max_days_before = maxDays;
    policy.refund_percentage = refundPercentage;
    policy.description = descriptions.description;
    policy.description_en = descriptions.description_en;

    return policy.save();
  }

  private validateRange(minDays: number, maxDays: number | null): void {
    if (maxDays !== null && maxDays < minDays) {
      throw new BadRequestException('max_days_before must be greater than or equal to min_days_before');
    }
  }

  private buildDescriptions(
    minDays: number,
    maxDays: number | null,
    refundPercentage: number,
  ): { description: string; description_en: string } {
    const noRefund = refundPercentage === 0;

    if (maxDays === null) {
      return {
        description: noRefund
          ? `Hủy từ ${minDays} ngày trước bay: không hoàn tiền.`
          : `Hủy từ ${minDays} ngày trước bay: hoàn ${refundPercentage}%.`,
        description_en: noRefund
          ? `Cancel ${minDays}+ days before departure: no refund.`
          : `Cancel ${minDays}+ days before departure: ${refundPercentage}% refund.`,
      };
    }

    return {
      description: noRefund
        ? `Hủy ${minDays}-${maxDays} ngày trước bay: không hoàn tiền.`
        : `Hủy ${minDays}-${maxDays} ngày trước bay: hoàn ${refundPercentage}%.`,
      description_en: noRefund
        ? `Cancel ${minDays}-${maxDays} days before departure: no refund.`
        : `Cancel ${minDays}-${maxDays} days before departure: ${refundPercentage}% refund.`,
    };
  }

  private applyGeneratedDescriptions<T extends CancellationPolicy>(policy: T): T {
    const descriptions = this.buildDescriptions(
      policy.min_days_before,
      policy.max_days_before ?? null,
      policy.refund_percentage,
    );
    policy.description = descriptions.description;
    policy.description_en = descriptions.description_en;
    return policy;
  }

  async delete(id: string): Promise<{ message: string }> {
    await this.findById(id);
    await this.policyModel.findByIdAndDelete(id).exec();
    return { message: `Policy with ID ${id} deleted successfully` };
  }
}
