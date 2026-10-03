import { Test, TestingModule } from '@nestjs/testing';
import { PoliciesService } from './policies.service';
import { getModelToken } from '@nestjs/mongoose';
import { CancellationPolicy } from './policies.schema';
import { BadRequestException } from '@nestjs/common';

describe('PoliciesService', () => {
  let service: PoliciesService;
  
  const mockPolicies = [
    { min_days_before: 30, max_days_before: null, refund_percentage: 90 },
    { min_days_before: 15, max_days_before: 29, refund_percentage: 75 },
    { min_days_before: 7, max_days_before: 14, refund_percentage: 50 },
    { min_days_before: 0, max_days_before: 6, refund_percentage: 0 }
  ];

  let mockPolicyModel: any;

  beforeEach(async () => {
    mockPolicyModel = jest.fn().mockImplementation((data: any) => {
      const document = { ...data };
      document.save = jest.fn().mockResolvedValue(document);
      return document;
    });
    mockPolicyModel.find = jest.fn().mockReturnThis();
    mockPolicyModel.sort = jest.fn().mockReturnThis();
    mockPolicyModel.exec = jest.fn().mockResolvedValue(mockPolicies);
    mockPolicyModel.findById = jest.fn();
    mockPolicyModel.findByIdAndDelete = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoliciesService,
        {
          provide: getModelToken(CancellationPolicy.name),
          useValue: mockPolicyModel,
        },
      ],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateRefundPercentage', () => {
    it('>=30 days -> 90 (including fractional values like 30.x)', async () => {
      expect(await service.calculateRefundPercentage(35)).toBe(90);
      expect(await service.calculateRefundPercentage(30)).toBe(90);
      expect(await service.calculateRefundPercentage(30.1)).toBe(90);
      expect(await service.calculateRefundPercentage(30.5)).toBe(90);
    });

    it('15..29 -> 75 (including fractional values like 29.5)', async () => {
      expect(await service.calculateRefundPercentage(29)).toBe(75);
      expect(await service.calculateRefundPercentage(29.5)).toBe(75);
      expect(await service.calculateRefundPercentage(15)).toBe(75);
      expect(await service.calculateRefundPercentage(20)).toBe(75);
    });

    it('7..14 -> 50 (including fractional values like 14.5)', async () => {
      expect(await service.calculateRefundPercentage(14)).toBe(50);
      expect(await service.calculateRefundPercentage(14.5)).toBe(50);
      expect(await service.calculateRefundPercentage(7)).toBe(50);
    });

    it('0..6 -> 0 (including fractional values like 6.5)', async () => {
      expect(await service.calculateRefundPercentage(6.5)).toBe(0);
      expect(await service.calculateRefundPercentage(6)).toBe(0);
      expect(await service.calculateRefundPercentage(0)).toBe(0);
    });

    it('no matching row -> 0', async () => {
      mockPolicyModel.exec.mockResolvedValueOnce([]);
      expect(await service.calculateRefundPercentage(100)).toBe(0);
    });
    
    it('max_days_before null means no upper bound', async () => {
      mockPolicyModel.exec.mockResolvedValueOnce([
        { min_days_before: 10, max_days_before: null, refund_percentage: 80 }
      ]);
      expect(await service.calculateRefundPercentage(10)).toBe(80);
      mockPolicyModel.exec.mockResolvedValueOnce([
        { min_days_before: 10, max_days_before: null, refund_percentage: 80 }
      ]);
      expect(await service.calculateRefundPercentage(100)).toBe(80);
    });

    it('policies are matched in min_days_before descending order (wider row must not shadow narrower one)', async () => {
      // simulate returning policies in descending order
      mockPolicyModel.exec.mockResolvedValueOnce([
        { min_days_before: 15, max_days_before: 29, refund_percentage: 75 },
        { min_days_before: 7, max_days_before: null, refund_percentage: 10 } // wider row, smaller min_days_before
      ]);
      // For 20 days, it should match the 15..29 row first because of descending sort (first in array).
      expect(await service.calculateRefundPercentage(20)).toBe(75);
    });
  });

  describe('admin policy maintenance', () => {
    it('serves generated VI/EN descriptions for existing legacy policies', async () => {
      mockPolicyModel.exec.mockResolvedValueOnce([{
        min_days_before: 30,
        max_days_before: null,
        refund_percentage: 90,
        description: 'legacy copy',
      }]);

      const policies = await service.findAll();

      expect(policies[0].description).toBe('Hủy từ 30 ngày trước bay: hoàn 90%.');
      expect(policies[0].description_en).toBe('Cancel 30+ days before departure: 90% refund.');
    });

    it('creates VI/EN descriptions from the numeric rule', async () => {
      await service.create({
        min_days_before: 7,
        max_days_before: 14,
        refund_percentage: 50,
      });

      expect(mockPolicyModel).toHaveBeenCalledWith({
        min_days_before: 7,
        max_days_before: 14,
        refund_percentage: 50,
        description: 'Hủy 7-14 ngày trước bay: hoàn 50%.',
        description_en: 'Cancel 7-14 days before departure: 50% refund.',
      });
    });

    it('regenerates descriptions and allows changing a bounded rule to infinity', async () => {
      const policy: any = {
        min_days_before: 15,
        max_days_before: 29,
        refund_percentage: 75,
        description: 'old',
        description_en: 'old',
      };
      policy.save = jest.fn().mockImplementation(async () => policy);
      mockPolicyModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(policy) });

      await service.update('507f1f77bcf86cd799439011', {
        min_days_before: 30,
        max_days_before: null,
        refund_percentage: 90,
      });

      expect(policy.min_days_before).toBe(30);
      expect(policy.max_days_before).toBeNull();
      expect(policy.refund_percentage).toBe(90);
      expect(policy.description).toBe('Hủy từ 30 ngày trước bay: hoàn 90%.');
      expect(policy.description_en).toBe('Cancel 30+ days before departure: 90% refund.');
      expect(policy.save).toHaveBeenCalledTimes(1);
    });

    it('generates no-refund copy when refund percentage is zero', async () => {
      await service.create({
        min_days_before: 0,
        max_days_before: 6,
        refund_percentage: 0,
      });

      expect(mockPolicyModel).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Hủy 0-6 ngày trước bay: không hoàn tiền.',
        description_en: 'Cancel 0-6 days before departure: no refund.',
      }));
    });

    it('rejects a range whose end day is before its start day', async () => {
      await expect(service.create({
        min_days_before: 15,
        max_days_before: 10,
        refund_percentage: 50,
      })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
