import { Types } from 'mongoose';
import { RevenuePricingService } from './revenue-pricing.service';

describe('RevenuePricingService', () => {
  const profileId = new Types.ObjectId();
  const flightId = new Types.ObjectId();
  const templateId = new Types.ObjectId();

  const profile: any = {
    _id: profileId,
    code: 'STANDARD',
    name: 'Standard',
    description: '',
    is_active: true,
    version: 1,
    advance_rules: [
      { min_days: 0, max_days: 13, adjustment_percent: 10, label: 'Gần ngày', label_en: 'Close' },
      { min_days: 14, max_days: null, adjustment_percent: -5, label: 'Mua sớm', label_en: 'Early' },
    ],
    load_factor_rules: [
      { min_load_percent: 0, max_load_percent: 40, adjustment_percent: -10, label: 'Tải thấp', label_en: 'Low' },
      { min_load_percent: 40, max_load_percent: 80, adjustment_percent: 0, label: 'Tải chuẩn', label_en: 'Normal' },
      { min_load_percent: 80, max_load_percent: 100, adjustment_percent: 10, label: 'Tải cao', label_en: 'High' },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
  };

  const profileModel: any = {
    findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(profile) })),
    create: jest.fn(),
    find: jest.fn(),
  };
  const flightModel: any = {
    updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) })),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
  };
  const templateModel: any = {
    updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) })),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
  };

  let service: RevenuePricingService;

  beforeEach(() => {
    jest.clearAllMocks();
    profile.save = jest.fn().mockResolvedValue(undefined);
    profileModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(profile) });
    flightModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) });
    templateModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) });
    service = new RevenuePricingService(profileModel, flightModel, templateModel);
  });

  it('assigns one reusable profile to direct flights, templates, and flights already generated from those templates', async () => {
    const result = await service.assignProfile(String(profileId), {
      flight_ids: [String(flightId)],
      template_ids: [String(templateId)],
    });

    expect(result.flights_updated).toBe(1);
    expect(result.templates_updated).toBe(1);
    expect(result.inherited_flights_updated).toBe(1);
    expect(flightModel.updateMany).toHaveBeenCalledTimes(2);
    expect(templateModel.updateMany).toHaveBeenCalledTimes(1);
    expect(result.profile.code).toBe('STANDARD');
  });

  it('increments profile version and propagates the new snapshot to assigned flights and templates', async () => {
    profile.version = 1;
    await service.updateProfile(String(profileId), { name: 'Standard v2' });

    expect(profile.version).toBe(2);
    expect(profile.save).toHaveBeenCalledTimes(1);
    expect(flightModel.updateMany).toHaveBeenCalledWith(
      { pricing_profile_id: String(profileId) },
      expect.objectContaining({ $set: { pricing_profile_snapshot: expect.objectContaining({ version: 2 }) } }),
    );
    expect(templateModel.updateMany).toHaveBeenCalledWith(
      { pricing_profile_id: String(profileId) },
      expect.objectContaining({ $set: { pricing_profile_snapshot: expect.objectContaining({ version: 2 }) } }),
    );
  });
});
