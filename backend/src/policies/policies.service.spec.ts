import { Test, TestingModule } from '@nestjs/testing';
import { PoliciesService } from './policies.service';
import { getModelToken } from '@nestjs/mongoose';
import { CancellationPolicy } from './policies.schema';

describe('PoliciesService', () => {
  let service: PoliciesService;
  
  const mockPolicies = [
    { min_days_before: 30, max_days_before: null, refund_percentage: 90 },
    { min_days_before: 15, max_days_before: 29, refund_percentage: 75 },
    { min_days_before: 7, max_days_before: 14, refund_percentage: 50 },
    { min_days_before: 0, max_days_before: 6, refund_percentage: 0 }
  ];

  const mockPolicyModel = {
    find: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(mockPolicies),
  };

  beforeEach(async () => {
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
    it('>=30 days -> 90', async () => {
      expect(await service.calculateRefundPercentage(35)).toBe(90);
      expect(await service.calculateRefundPercentage(30)).toBe(90);
    });

    it('15..29 -> 75', async () => {
      expect(await service.calculateRefundPercentage(29)).toBe(75);
      expect(await service.calculateRefundPercentage(15)).toBe(75);
      expect(await service.calculateRefundPercentage(20)).toBe(75);
    });

    it('7..14 -> 50', async () => {
      expect(await service.calculateRefundPercentage(14)).toBe(50);
      expect(await service.calculateRefundPercentage(7)).toBe(50);
    });

    it('0..6 -> 0', async () => {
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
});
