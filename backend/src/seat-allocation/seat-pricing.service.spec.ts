import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SeatPricingService } from './seat-pricing.service';
import { SeatPricingRule, PricingDimension } from './seat-pricing-rule.schema';
import { FlightSeatOverride } from './flight-seat-override.schema';
import { CabinClass } from '../flights/flights.schema';
import { PhysicalSeatDef } from './fleet-layout.catalog';

describe('SeatPricingService - 8-Dimension Stacking, Immutability & Contract Spec', () => {
  let service: SeatPricingService;
  let mockRuleModel: any;
  let mockOverrideModel: any;

  beforeEach(async () => {
    mockRuleModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(1) }),
    };

    mockOverrideModel = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeatPricingService,
        { provide: getModelToken(SeatPricingRule.name), useValue: mockRuleModel },
        { provide: getModelToken(FlightSeatOverride.name), useValue: mockOverrideModel },
      ],
    }).compile();

    service = module.get<SeatPricingService>(SeatPricingService);
  });

  describe('1. Pricing Dimensions & Additive Stacking', () => {
    it('AUTO selection is ALWAYS 0 fee regardless of seat attributes or active rules', async () => {
      const seat: PhysicalSeatDef = {
        seat_code: '12A',
        row_number: 12,
        column_letter: 'A',
        cabin_class: CabinClass.ECONOMY,
        is_exit_row: true,
        is_extra_legroom: true,
        position: 'WINDOW',
      };

      const pricing = await service.calculateSeatFee('507f1f77bcf86cd799439011', seat, 'AUTO');
      expect(pricing.final_fee).toBe(0);
      expect(pricing.dimensions).toEqual(['AUTO_SELECTION']);
      expect(pricing.flight_override).toBe(false);
    });

    it('stacks multiple independent dimensions additively for CHOOSE selection', async () => {
      // Seat has: CABIN_BASE + WINDOW + EXIT_ROW + EXTRA_LEGROOM
      const seat: PhysicalSeatDef = {
        seat_code: '12A',
        row_number: 12,
        column_letter: 'A',
        cabin_class: CabinClass.ECONOMY,
        is_exit_row: true,
        is_extra_legroom: true,
        position: 'WINDOW',
      };

      mockOverrideModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const activeRules: any[] = [
        { rule_id: 'R-BASE', pricing_dimension: PricingDimension.CABIN_BASE, amount: 20000, priority: 5 },
        { rule_id: 'R-WIN', pricing_dimension: PricingDimension.WINDOW, amount: 50000, priority: 5 },
        { rule_id: 'R-EXIT', pricing_dimension: PricingDimension.EXIT_ROW, amount: 150000, priority: 10 },
        { rule_id: 'R-LEG', pricing_dimension: PricingDimension.EXTRA_LEGROOM, amount: 100000, priority: 8 },
      ];

      mockRuleModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeRules),
        }),
      });

      const pricing = await service.calculateSeatFee('507f1f77bcf86cd799439011', seat, 'CHOOSE');
      // 20k (Base) + 50k (Window) + 150k (Exit) + 100k (Legroom) = 320,000 VND
      expect(pricing.final_fee).toBe(320000);
      expect(pricing.dimensions).toEqual([
        PricingDimension.CABIN_BASE,
        PricingDimension.WINDOW,
        PricingDimension.EXIT_ROW,
        PricingDimension.EXTRA_LEGROOM,
      ]);
      expect(pricing.rule_ids).toEqual(['R-BASE', 'R-WIN', 'R-EXIT', 'R-LEG']);
    });

    it('same-dimension deterministic winner: highest priority wins', async () => {
      const seat: PhysicalSeatDef = {
        seat_code: '5A',
        row_number: 5,
        column_letter: 'A',
        cabin_class: CabinClass.ECONOMY,
        is_exit_row: false,
        is_extra_legroom: false,
        position: 'WINDOW',
      };

      mockOverrideModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      // Two window rules: priority 10 ($80,000) and priority 5 ($50,000)
      const activeRules: any[] = [
        { rule_id: 'R-WIN-HIGH', pricing_dimension: PricingDimension.WINDOW, amount: 80000, priority: 10 },
        { rule_id: 'R-WIN-LOW', pricing_dimension: PricingDimension.WINDOW, amount: 50000, priority: 5 },
      ];

      mockRuleModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activeRules),
        }),
      });

      const pricing = await service.calculateSeatFee('507f1f77bcf86cd799439011', seat, 'CHOOSE');
      expect(pricing.final_fee).toBe(80000);
      expect(pricing.rule_ids).toEqual(['R-WIN-HIGH']);
    });

    it('ALL cabin rules apply across any cabin class', async () => {
      const businessSeat: PhysicalSeatDef = {
        seat_code: '1A',
        row_number: 1,
        column_letter: 'A',
        cabin_class: CabinClass.BUSINESS,
        is_exit_row: false,
        is_extra_legroom: true,
        position: 'WINDOW',
      };

      mockOverrideModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      // A rule defined with cabin_class: 'ALL'
      const activeRules: any[] = [
        {
          rule_id: 'R-ALL-WINDOW',
          pricing_dimension: PricingDimension.WINDOW,
          amount: 70000,
          cabin_class: 'ALL',
          priority: 10,
        },
      ];

      mockRuleModel.find.mockImplementation((query: any) => {
        expect(query.cabin_class.$in).toContain('ALL');
        expect(query.cabin_class.$in).toContain(CabinClass.BUSINESS);
        return {
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(activeRules),
          }),
        };
      });

      const pricing = await service.calculateSeatFee('507f1f77bcf86cd799439011', businessSeat, 'CHOOSE');
      expect(pricing.final_fee).toBe(70000);
      expect(pricing.rule_ids).toEqual(['R-ALL-WINDOW']);
    });
  });

  describe('2. Flight-Level Seat Override & Precedence', () => {
    it('active flight override takes precedence over global rules', async () => {
      const seat: PhysicalSeatDef = {
        seat_code: '1A',
        row_number: 1,
        column_letter: 'A',
        cabin_class: CabinClass.BUSINESS,
        is_exit_row: false,
        is_extra_legroom: true,
        position: 'WINDOW',
      };

      mockOverrideModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          flight_id: '507f1f77bcf86cd799439011',
          seat_code: '1A',
          override_fee: 500000,
          is_active: true,
        }),
      });

      const pricing = await service.calculateSeatFee('507f1f77bcf86cd799439011', seat, 'CHOOSE');
      expect(pricing.final_fee).toBe(500000);
      expect(pricing.flight_override).toBe(true);
      expect(pricing.dimensions).toEqual(['FLIGHT_OVERRIDE']);
      expect(mockRuleModel.find).not.toHaveBeenCalled();
    });
  });

  describe('3. Immutability & Audit Successor Pattern on Update', () => {
    it('updating a rule soft-deactivates existing rule with audit fields and creates V+1', async () => {
      const existingRule = {
        _id: new Types.ObjectId(),
        rule_id: 'R-ECO-WINDOW-01',
        version: 1,
        is_active: true,
        cabin_class: CabinClass.ECONOMY,
        pricing_dimension: PricingDimension.WINDOW,
        amount: 50000,
        priority: 5,
        effective_from: new Date('2026-01-01'),
        effective_to: null,
        deactivated_at: null as any,
        deactivated_by_user_id: null as any,
        save: jest.fn().mockResolvedValue(true),
      };

      mockRuleModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingRule),
      });

      const createdDoc: any = {};
      const mockRuleConstructor: any = jest.fn().mockImplementation((doc) => {
        Object.assign(createdDoc, doc);
        return {
          ...doc,
          save: jest.fn().mockResolvedValue(createdDoc),
        };
      });
      (service as any).ruleModel = mockRuleConstructor;
      mockRuleConstructor.findOne = mockRuleModel.findOne;

      const userId = new Types.ObjectId();
      const updated = await service.updateRule(
        'R-ECO-WINDOW-01',
        { amount: 65000, priority: 7 },
        userId,
      );

      // Old rule soft-deactivated
      expect(existingRule.is_active).toBe(false);
      expect(existingRule.deactivated_by_user_id).toEqual(userId);
      expect(existingRule.deactivated_at).toBeInstanceOf(Date);
      expect(existingRule.save).toHaveBeenCalled();

      // New rule created with successor identity
      expect(createdDoc.version).toBe(2);
      expect(createdDoc.rule_id).toBe('R-ECO-WINDOW-01-V2');
      expect(createdDoc.supersedes_rule_id).toBe('R-ECO-WINDOW-01');
      expect(createdDoc.is_active).toBe(true);
      expect(createdDoc.amount).toBe(65000);
      expect(createdDoc.priority).toBe(7);
      expect(createdDoc.created_by_user_id).toEqual(userId);
    });
  });

  describe('4. Frontend/Backend Contract Integration Test', () => {
    it('verifies CREATE payload generated by frontend creates a rule cleanly', async () => {
      mockRuleModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null), // Rule does not exist yet
      });

      const createdDoc: any = {};
      const mockRuleConstructor: any = jest.fn().mockImplementation((doc) => {
        Object.assign(createdDoc, doc);
        return {
          ...doc,
          save: jest.fn().mockResolvedValue(createdDoc),
        };
      });
      (service as any).ruleModel = mockRuleConstructor;
      mockRuleConstructor.findOne = mockRuleModel.findOne;

      // Exact payload sent by frontend seat-pricing.component.ts
      const frontendCreatePayload = {
        rule_id: 'R-ECO-FRONT-02',
        pricing_dimension: PricingDimension.FRONT_ZONE,
        amount: 85000,
        cabin_class: CabinClass.ECONOMY,
        priority: 8,
        effective_from: new Date('2026-03-01'),
        effective_to: undefined,
      };

      const userId = new Types.ObjectId();
      await service.createRule(frontendCreatePayload, userId);

      expect(createdDoc.rule_id).toBe('R-ECO-FRONT-02');
      expect(createdDoc.pricing_dimension).toBe(PricingDimension.FRONT_ZONE);
      expect(createdDoc.amount).toBe(85000);
      expect(createdDoc.cabin_class).toBe(CabinClass.ECONOMY);
      expect(createdDoc.priority).toBe(8);
      expect(createdDoc.is_active).toBe(true);
      expect(createdDoc.version).toBe(1);
    });
  });
});
