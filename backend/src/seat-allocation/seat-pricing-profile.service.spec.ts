import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CabinClass } from '../flights/flights.schema';
import { PricingDimension } from './seat-pricing-rule.schema';
import { SeatPricingService } from './seat-pricing.service';

describe('SeatPricingService - reusable profile CRUD and precedence', () => {
  let ruleModel: any;
  let overrideModel: any;
  let profileModel: any;
  let flightModel: any;
  let templateModel: any;
  let service: SeatPricingService;

  const profileId = new Types.ObjectId().toHexString();
  const baseRule = {
    cabin_class: CabinClass.ECONOMY,
    pricing_dimension: PricingDimension.WINDOW,
    amount: 50000,
    priority: 5,
  };

  const execResult = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

  beforeEach(() => {
    ruleModel = {
      find: jest.fn(),
      countDocuments: jest.fn(() => execResult(1)),
    };
    overrideModel = { findOne: jest.fn() };
    profileModel = {
      create: jest.fn(),
      findById: jest.fn(),
    };
    flightModel = {
      find: jest.fn(),
      updateMany: jest.fn(() => execResult({ matchedCount: 1, modifiedCount: 1 })),
      countDocuments: jest.fn(() => execResult(0)),
    };
    templateModel = {
      find: jest.fn(),
      updateMany: jest.fn(() => execResult({ matchedCount: 1, modifiedCount: 1 })),
      countDocuments: jest.fn(() => execResult(0)),
    };
    service = new SeatPricingService(
      ruleModel as any,
      overrideModel as any,
      profileModel as any,
      flightModel as any,
      templateModel as any,
    );
  });

  it('uses a profile snapshot before legacy global rules', async () => {
    overrideModel.findOne.mockReturnValue(execResult(null));
    const seat: any = {
      seat_code: '8A',
      row_number: 8,
      column_letter: 'A',
      cabin_class: CabinClass.ECONOMY,
      position: 'WINDOW',
      is_exit_row: false,
      is_extra_legroom: false,
    };

    const result = await service.calculateSeatFee(new Types.ObjectId(), seat, 'CHOOSE', {
      profile_id: profileId,
      code: 'A20N_STANDARD',
      name: 'A20N standard',
      version: 1,
      aircraft_type: 'A20N',
      rules: [{ ...baseRule, amount: 75000 }],
    });

    expect(result.final_fee).toBe(75000);
    expect(result.profile_code).toBe('A20N_STANDARD');
    expect(ruleModel.find).not.toHaveBeenCalled();
  });

  it('keeps an explicit per-flight seat override above a profile snapshot', async () => {
    overrideModel.findOne.mockReturnValue(execResult({ override_fee: 250000 }));
    const seat: any = {
      seat_code: '8A',
      row_number: 8,
      column_letter: 'A',
      cabin_class: CabinClass.ECONOMY,
      position: 'WINDOW',
      is_exit_row: false,
      is_extra_legroom: false,
    };

    const result = await service.calculateSeatFee(new Types.ObjectId(), seat, 'CHOOSE', {
      profile_id: profileId,
      code: 'A20N_STANDARD',
      name: 'A20N standard',
      version: 1,
      aircraft_type: 'A20N',
      rules: [baseRule],
    });

    expect(result.final_fee).toBe(250000);
    expect(result.flight_override).toBe(true);
    expect(ruleModel.find).not.toHaveBeenCalled();
  });

  it('creates a reusable profile with normalized identity and rules', async () => {
    profileModel.create.mockImplementation(async (payload: any) => payload);

    const created: any = await service.createProfile({
      code: ' a20n_standard ',
      name: ' Standard A20N ',
      description: ' Base profile ',
      aircraft_type: 'a20n',
      rules: [baseRule],
    } as any);

    expect(created.code).toBe('A20N_STANDARD');
    expect(created.name).toBe('Standard A20N');
    expect(created.aircraft_type).toBe('A20N');
    expect(created.version).toBe(1);
  });

  it('rejects assigning an aircraft-specific profile to an incompatible flight', async () => {
    profileModel.findById.mockReturnValue(execResult({
      _id: profileId,
      code: 'A20N_ONLY',
      name: 'A20N only',
      version: 1,
      is_active: true,
      aircraft_type: 'A20N',
      rules: [baseRule],
    }));
    flightModel.find.mockReturnValue(execResult([{
      _id: new Types.ObjectId(),
      flight_number: 'AP101',
      aircraft: { model_code: 'B789' },
    }]));

    await expect(service.assignProfile(profileId, {
      flight_ids: [new Types.ObjectId().toHexString()],
      template_ids: [],
    })).rejects.toThrow(/cannot be assigned/i);
    expect(flightModel.updateMany).not.toHaveBeenCalled();
  });

  it('propagates a template assignment only to compatible materialized flights', async () => {
    const templateId = new Types.ObjectId().toHexString();
    profileModel.findById.mockReturnValue(execResult({
      _id: profileId,
      code: 'A20N_ONLY',
      name: 'A20N only',
      version: 1,
      is_active: true,
      aircraft_type: 'A20N',
      rules: [baseRule],
    }));
    templateModel.find.mockReturnValue(execResult([{
      _id: templateId,
      template_id: 'TPL_AP101',
      aircraft_type: 'A20N',
    }]));

    await service.assignProfile(profileId, { flight_ids: [], template_ids: [templateId] });

    expect(templateModel.updateMany).toHaveBeenCalledTimes(1);
    expect(flightModel.updateMany).toHaveBeenCalledWith(
      {
        commercial_template_id: { $in: [templateId] },
        'aircraft.model_code': 'A20N',
      },
      expect.objectContaining({ $set: expect.objectContaining({ seat_pricing_profile_id: profileId }) }),
    );
  });

  it('refreshes stored snapshots when a profile is edited', async () => {
    const current: any = {
      _id: profileId,
      code: 'A20N_STANDARD',
      name: 'Old name',
      description: '',
      is_active: true,
      aircraft_type: 'A20N',
      version: 1,
      rules: [baseRule],
      save: jest.fn().mockResolvedValue(undefined),
    };
    profileModel.findById.mockReturnValue(execResult(current));

    await service.updateProfile(profileId, {
      name: 'New name',
      rules: [{ ...baseRule, amount: 90000 }],
    } as any);

    expect(current.version).toBe(2);
    expect(current.save).toHaveBeenCalled();
    expect(flightModel.updateMany).toHaveBeenCalledWith(
      { seat_pricing_profile_id: profileId },
      { $set: { seat_pricing_profile_snapshot: expect.objectContaining({ version: 2, name: 'New name' }) } },
    );
    expect(templateModel.updateMany).toHaveBeenCalled();
  });

  it('refuses to delete a profile that is still assigned', async () => {
    const current = {
      _id: profileId,
      deleteOne: jest.fn(),
    };
    profileModel.findById.mockReturnValue(execResult(current));
    flightModel.countDocuments.mockReturnValue(execResult(1));

    await expect(service.deleteProfile(profileId)).rejects.toBeInstanceOf(ConflictException);
    expect(current.deleteOne).not.toHaveBeenCalled();
  });
});
