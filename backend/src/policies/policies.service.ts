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
    return this.policyModel.find().sort({ min_days_before: -1 }).exec();
  }

  async findById(id: string): Promise<PolicyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid policy ID format');
    }
    const policy = await this.policyModel.findById(id).exec();
    if (!policy) {
      throw new NotFoundException(`Policy with ID ${id} not found`);
    }
    return policy;
  }

  // Calculate applicable refund percentage based on how many days before departure
  async calculateRefundPercentage(daysBeforeDeparture: number): Promise<number> {
    const policies = await this.findAll();
    for (const policy of policies) {
      if (policy.max_days_before !== null && policy.max_days_before !== undefined) {
        if (daysBeforeDeparture >= policy.min_days_before && daysBeforeDeparture <= policy.max_days_before) {
          return policy.refund_percentage;
        }
      } else {
        // No upper bound (e.g. >= min_days_before)
        if (daysBeforeDeparture >= policy.min_days_before) {
          return policy.refund_percentage;
        }
      }
    }
    return 0; // Default no refund
  }

  async create(createPolicyDto: CreatePolicyDto): Promise<PolicyDocument> {
    const created = new this.policyModel(createPolicyDto);
    return created.save();
  }

  async update(id: string, updatePolicyDto: UpdatePolicyDto): Promise<PolicyDocument> {
    const policy = await this.findById(id);

    if (updatePolicyDto.min_days_before !== undefined) policy.min_days_before = updatePolicyDto.min_days_before;
    if (updatePolicyDto.max_days_before !== undefined) policy.max_days_before = updatePolicyDto.max_days_before;
    if (updatePolicyDto.refund_percentage !== undefined) policy.refund_percentage = updatePolicyDto.refund_percentage;
    if (updatePolicyDto.description !== undefined) policy.description = updatePolicyDto.description;

    return policy.save();
  }

  async delete(id: string): Promise<{ message: string }> {
    await this.findById(id);
    await this.policyModel.findByIdAndDelete(id).exec();
    return { message: `Policy with ID ${id} deleted successfully` };
  }
}
