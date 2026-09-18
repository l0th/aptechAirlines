import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ReferenceService, computeSourceKey } from './reference.service';
import { Country, City, RouteRef, RouteSyncState } from './reference.schema';
import { Airport } from '../airports/airports.schema';
import { AirportsService } from '../airports/airports.service';

describe('ReferenceService - AirLabs Route Data Foundation (Phase A Final Consistency)', () => {
  let service: ReferenceService;
  let routeRefModel: any;
  let routeSyncStateModel: any;
  let airportModel: any;
  let countryModel: any;
  let cityModel: any;
  let airportsService: any;
  let originalFetch: any;

  beforeEach(async () => {
    process.env.AIRLABS_API_KEY = 'test_airlabs_api_key';

    routeRefModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
    };

    routeSyncStateModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    airportModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      distinct: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    countryModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    cityModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    airportsService = {
      findByIata: jest.fn(),
      resolveCity: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferenceService,
        { provide: getModelToken(Country.name), useValue: countryModel },
        { provide: getModelToken(City.name), useValue: cityModel },
        { provide: getModelToken(RouteRef.name), useValue: routeRefModel },
        { provide: getModelToken(RouteSyncState.name), useValue: routeSyncStateModel },
        { provide: getModelToken(Airport.name), useValue: airportModel },
        { provide: AirportsService, useValue: airportsService },
      ],
    }).compile();

    service = module.get<ReferenceService>(ReferenceService);

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  // =========================================================================
  // SECTION 1: IDENTITY & NORMALIZATION
  // =========================================================================

  it('1. same airline + same dep/arr + different flight/time records -> stored as DISTINCT RouteRefs', async () => {
    const flightMorning = {
      airline_iata: 'VN',
      flight_iata: 'VN210',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
      dep_time: '08:00',
      days: ['mon', 'wed', 'fri'],
    };
    const flightEvening = {
      airline_iata: 'VN',
      flight_iata: 'VN218',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
      dep_time: '20:00',
      days: ['mon', 'wed', 'fri'],
    };

    const keyMorning = computeSourceKey(flightMorning);
    const keyEvening = computeSourceKey(flightEvening);

    expect(keyMorning).not.toEqual(keyEvening);
    expect(keyMorning).toContain('VN210');
    expect(keyMorning).toContain('L:08:00');
    expect(keyEvening).toContain('VN218');
    expect(keyEvening).toContain('L:20:00');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [flightMorning, flightEvening],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN');
    expect(result.updated).toBe(2);

    const calls = routeRefModel.findOneAndUpdate.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toEqual({ source_key: keyMorning });
    expect(calls[1][0]).toEqual({ source_key: keyEvening });
  });

  it('2. same provider record synchronized twice -> upserts same record, no duplicate', async () => {
    const record = {
      airline_iata: 'VN',
      flight_iata: 'VN210',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
      dep_time_utc: '01:00',
      days: ['daily'],
    };
    const expectedKey = computeSourceKey(record);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [record],
      }),
    });

    await service.syncRoutesForAirport('HAN');
    await service.syncRoutesForAirport('HAN');

    const calls = routeRefModel.findOneAndUpdate.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toEqual({ source_key: expectedKey });
    expect(calls[1][0]).toEqual({ source_key: expectedKey });
    expect(calls[0][2]).toEqual({ upsert: true, new: true });
    expect(calls[1][2]).toEqual({ upsert: true, new: true });
  });

  it('3. synced_at written/updated on successful sync', async () => {
    const record = {
      airline_iata: 'VN',
      flight_iata: 'VN210',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
      updated: '2026-09-17T10:00:00.000Z',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [record],
      }),
    });

    const before = new Date();
    await service.syncRoutesForAirport('HAN');
    const after = new Date();

    const updatePayload = routeRefModel.findOneAndUpdate.mock.calls[0][1];
    expect(updatePayload.source).toBe('airlabs');
    expect(updatePayload.synced_at).toBeInstanceOf(Date);
    expect(updatePayload.synced_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updatePayload.synced_at.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(updatePayload.airlabs_updated).toBe('2026-09-17T10:00:00.000Z');
  });

  it('4. missing flight_iata -> deterministic identity still works using real available fields', () => {
    const recordA = {
      airline_iata: 'VN',
      flight_number: '210',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    };
    const keyA = computeSourceKey(recordA);
    expect(keyA).toContain('VN210');
    expect(keyA).toContain('HAN_SGN');

    const recordB = {
      airline_iata: 'VN',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    };
    const keyB = computeSourceKey(recordB);
    expect(keyB).toContain('NOFLT');
    expect(keyB).toContain('HAN_SGN');
  });

  it('5. missing schedule-time fields -> no fake 00:00 or invented timetable', async () => {
    const coarseRecord = {
      airline_iata: 'VN',
      flight_iata: 'VN210',
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    };
    const key = computeSourceKey(coarseRecord);

    expect(key).toContain('NOTIME');
    expect(key).toContain('NODAYS');
    expect(key).not.toContain('00:00');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [coarseRecord],
      }),
    });

    await service.syncRoutesForAirport('HAN');

    const updatePayload = routeRefModel.findOneAndUpdate.mock.calls[0][1];
    expect(updatePayload.has_schedule).toBe(false);
    expect(updatePayload.dep_time).toBeUndefined();
    expect(updatePayload.days).toBeUndefined();
  });

  // =========================================================================
  // SECTION 2: RESUMABLE SYNCHRONIZATION & CONTINUATION OFFSET
  // =========================================================================

  it('6. truncated first invocation hits safety cap, persists next_offset, complete=false, truncated=true, and does NOT prune', async () => {
    const pageItems = Array.from({ length: 10 }, (_, i) => ({
      airline_iata: 'VN',
      flight_iata: `VN${100 + i}`,
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: true },
        response: pageItems,
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(result.pages).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.next_offset).toBe(50);
    expect(result.records_seen).toBe(50);

    // Verify persisted state
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        dep_iata: 'HAN',
        complete: false,
        truncated: true,
        next_offset: 50,
        sync_generation: expect.any(String),
        generation_started_at_offset_zero: true,
      }),
      { upsert: true, new: true },
    );

    // Must NOT prune
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  it('7. second invocation resumes from next_offset and reuses the same sync_generation', async () => {
    // Existing sync state reflects truncated generation
    const existingState = {
      dep_iata: 'HAN',
      sync_generation: 'gen_existing_123',
      generation_started_at_offset_zero: true,
      next_offset: 50,
      complete: false,
      truncated: true,
      records_seen: 50,
      records_upserted: 50,
      last_synced_at: new Date(),
    };
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(existingState),
    });

    const page2Items = [
      {
        airline_iata: 'VN',
        flight_iata: 'VN250',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: page2Items,
      }),
    });

    // Calling syncRoutesForAirport without explicit offset resumes from existingState.next_offset
    const result = await service.syncRoutesForAirport('HAN', 200);

    // Verify fetch used offset=50
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=50'));

    // Reused the exact same sync_generation
    expect(result.sync_generation).toBe('gen_existing_123');
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.next_offset).toBe(0);
    expect(result.records_seen).toBe(51);
  });

  it('8. final resumed page has has_more=false -> complete=true, next_offset=0, truncated=false', async () => {
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        sync_generation: 'gen_final_run',
        generation_started_at_offset_zero: true,
        next_offset: 100,
        complete: false,
        truncated: true,
        records_seen: 100,
        records_upserted: 100,
      }),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [
          {
            airline_iata: 'VN',
            flight_iata: 'VN999',
            dep_iata: 'HAN',
            arr_iata: 'SGN',
          },
        ],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.next_offset).toBe(0);

    // Finalized RouteSyncState persisted with complete: true
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        dep_iata: 'HAN',
        complete: true,
        truncated: false,
        next_offset: 0,
        sync_generation: 'gen_final_run',
      }),
      { upsert: true, new: true },
    );
  });

  // =========================================================================
  // SECTION 3: SYNC GENERATION & SAFE PRUNING
  // =========================================================================

  it('9. safe pruning runs ONLY after final generation completion with sync_generation $ne filter', async () => {
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [
          {
            airline_iata: 'VN',
            flight_iata: 'VN210',
            dep_iata: 'HAN',
            arr_iata: 'SGN',
          },
        ],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(result.complete).toBe(true);
    expect(routeRefModel.deleteMany).toHaveBeenCalledWith({
      source: 'airlabs',
      dep_iata: 'HAN',
      sync_generation: { $ne: result.sync_generation },
    });
  });

  it('10. routes seen in earlier capped invocations of the same generation are retained', async () => {
    const generationId = 'gen_multi_invocation_test';

    // Resuming generationId
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        sync_generation: generationId,
        generation_started_at_offset_zero: true,
        next_offset: 50,
        complete: false,
        truncated: true,
      }),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [
          {
            airline_iata: 'VN',
            flight_iata: 'VN300',
            dep_iata: 'HAN',
            arr_iata: 'SGN',
          },
        ],
      }),
    });

    await service.syncRoutesForAirport('HAN', 200);

    // Prune deletes records WHERE sync_generation != generationId
    // Because routes seen in invocation 1 also received generationId, they are NOT deleted!
    expect(routeRefModel.deleteMany).toHaveBeenCalledWith({
      source: 'airlabs',
      dep_iata: 'HAN',
      sync_generation: { $ne: generationId },
    });
  });

  it('11. truncated sync NEVER prunes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: true },
        response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(result.truncated).toBe(true);
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  it('12. provider failure midway NEVER prunes', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          request: { has_more: true },
          response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    await expect(service.syncRoutesForAirport('HAN', 200)).rejects.toThrow(BadRequestException);
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  it('13. arbitrary offset > 0 without persisted generation does NOT claim complete and NEVER prunes', async () => {
    // No persisted generation starting at 0
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    // Caller calls with explicit arbitrary offset = 50
    const result = await service.syncRoutesForAirport('HAN', 200, 50);

    // Cannot be marked complete because it did not start from offset 0
    expect(result.complete).toBe(false);
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  // =========================================================================
  // SECTION 4: FAILURE CONSISTENCY & PRE-MUTATION STATE
  // =========================================================================

  it('14. previous complete state + page1 write + page2 failure -> state becomes incomplete, error exposed, no prune', async () => {
    // Previous state in DB: complete: true
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        complete: true,
        truncated: false,
        sync_generation: 'old_gen',
        last_synced_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      }),
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          request: { has_more: true },
          response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    await expect(service.syncRoutesForAirport('HAN', 200, 0)).rejects.toThrow(BadRequestException);

    // Verify RouteSyncState was updated to complete: false and last_error recorded
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        complete: false,
        last_error: expect.stringContaining('500'),
      }),
      { upsert: true, new: true },
    );

    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  it('15. failure halfway through page persists pageStartOffset so retry cannot skip unprocessed records', async () => {
    // Start page at offset 40
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: true },
        response: [
          { airline_iata: 'VN', flight_iata: 'VN101', dep_iata: 'HAN', arr_iata: 'SGN' },
          { airline_iata: 'VN', flight_iata: 'VN102', dep_iata: 'HAN', arr_iata: 'SGN' },
        ],
      }),
    });

    // Fail during item 2 processing
    routeRefModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(new Error('DB connection lost')) });

    await expect(service.syncRoutesForAirport('HAN', 200, 40)).rejects.toThrow('DB connection lost');

    // next_offset must be persisted as 40 (the beginning of the page), NOT 41 or 42
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        next_offset: 40,
        complete: false,
        last_error: 'DB connection lost',
      }),
      { upsert: true, new: true },
    );
  });

  it('16. failed refresh during ensureRoutesForAirport does not falsely mark cache complete/fresh', async () => {
    const cachedRoutes = [
      {
        source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
        synced_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // stale
      },
    ];

    routeRefModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(cachedRoutes),
    });

    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        complete: false,
        truncated: true,
        last_synced_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      }),
    });

    global.fetch = jest.fn().mockRejectedValue(new Error('AirLabs API connection timeout'));

    const result = await service.ensureRoutesForAirport('HAN');

    expect(result.from_cache).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.refresh_error).toContain('AirLabs API connection timeout');
  });

  // =========================================================================
  // SECTION 5: UNKNOWN / MISSING PAGINATION METADATA
  // =========================================================================

  it('17. missing request.has_more metadata with fewer rows than limit -> NOT complete, no prune', async () => {
    // Provider returns 50 rows without request.has_more
    const items = Array.from({ length: 50 }, (_, i) => ({
      airline_iata: 'VN',
      flight_iata: `VN${100 + i}`,
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        response: items,
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    // Because request.has_more is missing, completeness CANNOT be verified authoritatively
    expect(result.complete).toBe(false);
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        complete: false,
      }),
      { upsert: true, new: true },
    );
  });

  it('18. missing request.has_more metadata for all pages -> incomplete/unknown state remains truthful', async () => {
    // 5 pages with no has_more metadata
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(result.complete).toBe(false);
    expect(routeRefModel.deleteMany).not.toHaveBeenCalled();
  });

  // =========================================================================
  // SECTION 6: PROVIDER PAGINATION DETAILS & OFFSETS
  // =========================================================================

  it('19. provider returns fewer items than limit with request.has_more=true -> continues, offset advances by actual items.length', async () => {
    const page1 = Array.from({ length: 42 }, (_, i) => ({
      airline_iata: 'VN',
      flight_iata: `VN${100 + i}`,
      dep_iata: 'HAN',
      arr_iata: 'SGN',
    }));
    const page2 = [
      {
        airline_iata: 'VN',
        flight_iata: 'VN300',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
      },
    ];

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          request: { has_more: true },
          response: page1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          request: { has_more: false },
          response: page2,
        }),
      });

    // Start with explicit initial offset 10
    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        sync_generation: 'gen_page_test',
        generation_started_at_offset_zero: true,
        next_offset: 10,
        complete: false,
        truncated: true,
      }),
    });

    await service.syncRoutesForAirport('HAN', 200, 10);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const call1Url = (global.fetch as jest.Mock).mock.calls[0][0];
    const call2Url = (global.fetch as jest.Mock).mock.calls[1][0];

    expect(call1Url).toContain('offset=10');
    // Offset advanced by 42 (actual items), so page 2 fetch has offset=52 (NOT 210)
    expect(call2Url).toContain('offset=52');
  });

  it('20. provider request.has_more=false on page 1 -> stops immediately', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('21. page safety cap of 5 pages enforced when has_more=true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: true },
        response: [{ airline_iata: 'VN', flight_iata: 'VN100', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.syncRoutesForAirport('HAN', 200);

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(result.pages).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
  });

  // =========================================================================
  // SECTION 7: CACHE READING & ERROR HANDLING
  // =========================================================================

  it('22. fresh and complete cache -> no provider request', async () => {
    const cachedRoutes = [
      {
        source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
        synced_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ];

    routeRefModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(cachedRoutes),
    });

    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        complete: true,
        truncated: false,
        last_synced_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }),
    });

    global.fetch = jest.fn();

    const result = await service.ensureRoutesForAirport('HAN');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.from_cache).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.count).toBe(1);
    expect(result.routes).toEqual(cachedRoutes);
  });

  it('23. fresh but incomplete/truncated cache -> ensureRoutesForAirport attempts refresh/resume', async () => {
    const cachedRoutes = [
      {
        source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
        synced_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    ];

    routeRefModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(cachedRoutes),
    });

    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        complete: false,
        truncated: true,
        sync_generation: 'gen_resume_test',
        next_offset: 50,
        last_synced_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
      }),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.ensureRoutesForAirport('HAN');

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=50'));
    expect(result.from_cache).toBe(false);
  });

  it('24. empty cache + provider unavailable -> transparent error', async () => {
    routeRefModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    global.fetch = jest.fn().mockRejectedValue(new Error('Network connection failure'));

    await expect(service.ensureRoutesForAirport('HAN')).rejects.toThrow(BadRequestException);
    await expect(service.ensureRoutesForAirport('HAN')).rejects.toThrow('Network connection failure');
  });

  it('25. stale cache -> refresh attempted', async () => {
    const staleRoutes = [
      {
        source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
        synced_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ];

    routeRefModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(staleRoutes),
    });

    routeSyncStateModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        dep_iata: 'HAN',
        complete: true,
        truncated: false,
        last_synced_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      }),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const result = await service.ensureRoutesForAirport('HAN');

    expect(global.fetch).toHaveBeenCalled();
    expect(result.from_cache).toBe(false);
    expect(result.stale).toBe(false);
  });

  it('26. HTTP 429 -> handled explicitly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });

    await expect(service.syncRoutesForAirport('HAN')).rejects.toThrow(BadRequestException);
    await expect(service.syncRoutesForAirport('HAN')).rejects.toThrow(/Rate Limit|429/);
  });

  it('27. unexpected DB error -> NOT silently swallowed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    routeRefModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('MongoNetworkTimeoutException')),
    });

    await expect(service.syncRoutesForAirport('HAN')).rejects.toThrow('MongoNetworkTimeoutException');
  });

  it('28. duplicate key error on unexpected index (e.g. obsolete unique index) -> NOT swallowed, remains observable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const unexpectedDuplicateError: any = new Error(
      'E11000 duplicate key error collection: airline_db.routerefs index: airline_iata_1_dep_iata_1_arr_iata_1 dup key: { airline_iata: "VN", dep_iata: "HAN", arr_iata: "SGN" }',
    );
    unexpectedDuplicateError.code = 11000;
    unexpectedDuplicateError.keyPattern = { airline_iata: 1, dep_iata: 1, arr_iata: 1 };
    unexpectedDuplicateError.keyValue = { airline_iata: 'VN', dep_iata: 'HAN', arr_iata: 'SGN' };

    routeRefModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue(unexpectedDuplicateError),
    });

    // The unexpected conflict must NOT be swallowed; syncRoutesForAirport records error and rethrows original error
    await expect(service.syncRoutesForAirport('HAN')).rejects.toThrow(/E11000/);
    expect(routeSyncStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dep_iata: 'HAN' },
      expect.objectContaining({
        complete: false,
        last_error: expect.stringContaining('E11000'),
      }),
      expect.anything(),
    );
  });

  it('29. duplicate key error on identical source_key -> treated idempotently via retry update', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        request: { has_more: false },
        response: [{ airline_iata: 'VN', flight_iata: 'VN210', dep_iata: 'HAN', arr_iata: 'SGN' }],
      }),
    });

    const sourceKeyDuplicateError: any = new Error(
      'E11000 duplicate key error collection: airline_db.routerefs index: source_key_1 dup key: { source_key: "AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS" }',
    );
    sourceKeyDuplicateError.code = 11000;
    sourceKeyDuplicateError.keyPattern = { source_key: 1 };
    sourceKeyDuplicateError.keyValue = { source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS' };

    // First call (upsert) fails with 11000 on source_key, second call (retry update without upsert) succeeds
    routeRefModel.findOneAndUpdate
      .mockReturnValueOnce({
        exec: jest.fn().mockRejectedValue(sourceKeyDuplicateError),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({ source_key: 'AIRLABS_VN_VN210_HAN_SGN_NOTIME_NODAYS' }),
      });

    const result = await service.syncRoutesForAirport('HAN');

    expect(result.updated).toBe(1);
    expect(routeRefModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // Second call should have { new: true } and $set
    expect(routeRefModel.findOneAndUpdate.mock.calls[1][1].$set).toBeDefined();
    expect(routeRefModel.findOneAndUpdate.mock.calls[1][1].$set.airline_iata).toBe('VN');
  });

  // =========================================================================
  // SECTION 7: EXPAND LOCATION & NEAREST AIRPORT RESOLUTION (§3.3.1 - §3.3.2)
  // =========================================================================

  describe('expandLocation & Nearest Airport Resolution', () => {
    it('Case A: Serviced airport (HAN) -> using_nearest_airport: false, no nearest_suggestion', async () => {
      airportModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          iata_code: 'HAN',
          airport_name: 'Noi Bai International Airport',
          city_name: 'Ha Noi',
          is_serviced_directly: true,
        }),
      });

      const res = await service.expandLocation('HAN');
      expect(res.iata_codes).toEqual(['HAN']);
      expect(res.matched_kind).toBe('airport');
      expect(res.label).toBe('Noi Bai International Airport');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case B: Unserviced exact airport (HOI) with valid nearest airport (DAD, 30km) -> using_nearest_airport: true, nearest_suggestion populated', async () => {
      const hoiAirport = {
        iata_code: 'HOI',
        city_name: 'Hoi An',
        airport_name: 'Hoi An Town Heliport',
        is_serviced_directly: false,
        nearest_airport_code: 'DAD',
        distance_to_nearest_km: 30,
      };
      const dadAirport = {
        iata_code: 'DAD',
        city_name: 'Da Nang',
        airport_name: 'Da Nang International Airport',
        is_serviced_directly: true,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'HOI') return { exec: jest.fn().mockResolvedValue(hoiAirport) };
        if (q.iata_code === 'DAD') return { exec: jest.fn().mockResolvedValue(dadAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('HOI');
      expect(res.iata_codes).toEqual(['DAD']);
      expect(res.matched_kind).toBe('airport');
      expect(res.label).toBe('Gần Hoi An');
      expect(res.using_nearest_airport).toBe(true);
      expect(res.nearest_suggestion).toEqual({
        airport: dadAirport,
        distance_km: 30,
        for_city: 'Hoi An',
      });
    });

    it('Case D: resolveCity() returning nearestSuggestion -> preserved in expandLocation()', async () => {
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      countryModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      cityModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const nearestAirport = {
        iata_code: 'DAD',
        city_name: 'Da Nang',
        airport_name: 'Da Nang International Airport',
        is_serviced_directly: true,
      };
      const nearestSuggestion = {
        airport: nearestAirport,
        distance_km: 30,
        for_city: 'Hoi An',
      };

      airportsService.resolveCity.mockResolvedValue({
        exactMatches: [],
        nearestSuggestion,
      });

      const res = await service.expandLocation('Hoi An');
      expect(res.iata_codes).toEqual(['DAD']);
      expect(res.matched_kind).toBe('airport');
      expect(res.label).toBe('Gần Hoi An');
      expect(res.using_nearest_airport).toBe(true);
      expect(res.nearest_suggestion).toEqual(nearestSuggestion);
    });

    it('Case E: Unserviced airport with missing/invalid nearest airport code -> using_nearest_airport: false, no nearest suggestion', async () => {
      const invalidAirport = {
        iata_code: 'XXX',
        city_name: 'Nowhere',
        is_serviced_directly: false,
        nearest_airport_code: 'NON_EXISTENT',
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'XXX') return { exec: jest.fn().mockResolvedValue(invalidAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('XXX');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.label).toBe('Không tìm thấy');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case E2: Unserviced airport with no nearest_airport_code configured -> using_nearest_airport: false, no nearest suggestion', async () => {
      const unconfiguredAirport = {
        iata_code: 'YYY',
        city_name: 'No Code City',
        is_serviced_directly: false,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'YYY') return { exec: jest.fn().mockResolvedValue(unconfiguredAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('YYY');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.label).toBe('Không tìm thấy');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case 1: nearest_airport_code points to an unserviced airport -> no substitution, using_nearest_airport === false, no nearest suggestion', async () => {
      const unservicedOrigin = {
        iata_code: 'UNS1',
        city_name: 'Town 1',
        is_serviced_directly: false,
        nearest_airport_code: 'UNS2',
        distance_to_nearest_km: 25,
      };
      const unservicedNearest = {
        iata_code: 'UNS2',
        city_name: 'Town 2',
        is_serviced_directly: false,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'UNS1') return { exec: jest.fn().mockResolvedValue(unservicedOrigin) };
        if (q.iata_code === 'UNS2' && q.is_serviced_directly === true) return { exec: jest.fn().mockResolvedValue(null) };
        if (q.iata_code === 'UNS2') return { exec: jest.fn().mockResolvedValue(unservicedNearest) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('UNS1');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.label).toBe('Không tìm thấy');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case 2: nearest airport is serviced, but distance is null/undefined/invalid -> no fabricated 0km, no nearest suggestion', async () => {
      const unservicedNullDist = {
        iata_code: 'UNS_NULL',
        city_name: 'Town Null',
        is_serviced_directly: false,
        nearest_airport_code: 'DAD',
        distance_to_nearest_km: null,
      };
      const dadAirport = {
        iata_code: 'DAD',
        city_name: 'Da Nang',
        is_serviced_directly: true,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'UNS_NULL') return { exec: jest.fn().mockResolvedValue(unservicedNullDist) };
        if (q.iata_code === 'DAD' && q.is_serviced_directly === true) return { exec: jest.fn().mockResolvedValue(dadAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('UNS_NULL');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case 2b: nearest airport is serviced, but distance is undefined -> no fabricated 0km, no nearest suggestion', async () => {
      const unservicedUndefDist = {
        iata_code: 'UNS_UNDEF',
        city_name: 'Town Undef',
        is_serviced_directly: false,
        nearest_airport_code: 'DAD',
        distance_to_nearest_km: undefined,
      };
      const dadAirport = {
        iata_code: 'DAD',
        city_name: 'Da Nang',
        is_serviced_directly: true,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'UNS_UNDEF') return { exec: jest.fn().mockResolvedValue(unservicedUndefDist) };
        if (q.iata_code === 'DAD' && q.is_serviced_directly === true) return { exec: jest.fn().mockResolvedValue(dadAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('UNS_UNDEF');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });

    it('Case 2c: real configured distance of 0 is preserved as valid finite number', async () => {
      const unservicedZeroDist = {
        iata_code: 'UNS_ZERO',
        city_name: 'Town Zero',
        is_serviced_directly: false,
        nearest_airport_code: 'DAD',
        distance_to_nearest_km: 0,
      };
      const dadAirport = {
        iata_code: 'DAD',
        city_name: 'Da Nang',
        is_serviced_directly: true,
      };

      airportModel.findOne.mockImplementation((q: any) => {
        if (q.iata_code === 'UNS_ZERO') return { exec: jest.fn().mockResolvedValue(unservicedZeroDist) };
        if (q.iata_code === 'DAD' && q.is_serviced_directly === true) return { exec: jest.fn().mockResolvedValue(dadAirport) };
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const res = await service.expandLocation('UNS_ZERO');
      expect(res.iata_codes).toEqual(['DAD']);
      expect(res.using_nearest_airport).toBe(true);
      expect(res.nearest_suggestion).toEqual({
        airport: dadAirport,
        distance_km: 0,
        for_city: 'Town Zero',
      });
    });

    it('Case 3: resolveCity returning unserviced nearest candidate -> expandLocation refuses substitution', async () => {
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      countryModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      cityModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      airportsService.resolveCity.mockResolvedValue({
        exactMatches: [],
        nearestSuggestion: {
          airport: { iata_code: 'UNS2', city_name: 'Town 2', is_serviced_directly: false },
          distance_km: 25,
          for_city: 'Town 1',
        },
      });

      const res = await service.expandLocation('Town 1');
      expect(res.iata_codes).toEqual([]);
      expect(res.matched_kind).toBe('none');
      expect(res.using_nearest_airport).toBe(false);
      expect(res.nearest_suggestion).toBeUndefined();
    });
  });
});
