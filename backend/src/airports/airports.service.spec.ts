import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AirportsService } from './airports.service';
import { Airport } from './airports.schema';
import { Flight } from '../flights/flights.schema';

describe('AirportsService - resolveCity & buildUnservicedResult (§3.3.1 - §3.3.2)', () => {
  let service: AirportsService;
  let airportModel: any;
  let flightModel: any;

  beforeEach(async () => {
    airportModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    flightModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirportsService,
        { provide: getModelToken(Airport.name), useValue: airportModel },
        { provide: getModelToken(Flight.name), useValue: flightModel },
      ],
    }).compile();

    service = module.get<AirportsService>(AirportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('serviced exact IATA -> returns exact match and no nearestSuggestion', async () => {
    const han = {
      iata_code: 'HAN',
      airport_name: 'Noi Bai',
      city_name: 'Ha Noi',
      is_serviced_directly: true,
    };
    airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(han) });

    const res = await service.resolveCity('HAN');
    expect(res.exactMatches).toEqual([han]);
    expect(res.nearestSuggestion).toBeUndefined();
  });

  it('unserviced IATA with valid serviced nearest airport and finite distance -> returns nearestSuggestion', async () => {
    const hoi = {
      iata_code: 'HOI',
      city_name: 'Hoi An',
      is_serviced_directly: false,
      nearest_airport_code: 'DAD',
      distance_to_nearest_km: 30,
    };
    const dad = {
      iata_code: 'DAD',
      city_name: 'Da Nang',
      airport_name: 'Da Nang International Airport',
      is_serviced_directly: true,
    };

    airportModel.findOne.mockImplementation((q: any) => {
      if (q.iata_code === 'HOI') return { exec: jest.fn().mockResolvedValue(hoi) };
      if (q.iata_code === 'DAD' && q.is_serviced_directly === true) {
        return { exec: jest.fn().mockResolvedValue(dad) };
      }
      return { exec: jest.fn().mockResolvedValue(null) };
    });

    const res = await service.resolveCity('HOI');
    expect(res.exactMatches).toEqual([]);
    expect(res.nearestSuggestion).toEqual({
      airport: dad,
      distance_km: 30,
      for_city: 'Hoi An',
    });
  });

  it('BLOCKER 1: buildUnservicedResult refuses unserviced nearest candidate (is_serviced_directly === false)', async () => {
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
      if (q.iata_code === 'UNS2' && q.is_serviced_directly === true) {
        return { exec: jest.fn().mockResolvedValue(null) };
      }
      if (q.iata_code === 'UNS2') {
        return { exec: jest.fn().mockResolvedValue(unservicedNearest) };
      }
      return { exec: jest.fn().mockResolvedValue(null) };
    });

    const res = await service.resolveCity('UNS1');
    expect(res.exactMatches).toEqual([]);
    expect(res.nearestSuggestion).toBeUndefined();
    expect(res.unservicedMatches).toEqual([unservicedOrigin]);
  });

  it('BLOCKER 2: buildUnservicedResult refuses nearest suggestion when distance is null/undefined/invalid (no fabricated 0km)', async () => {
    const unservicedNullDist = {
      iata_code: 'UNS_NULL',
      city_name: 'Town Null',
      is_serviced_directly: false,
      nearest_airport_code: 'DAD',
      distance_to_nearest_km: null,
    };
    const dad = {
      iata_code: 'DAD',
      city_name: 'Da Nang',
      is_serviced_directly: true,
    };

    airportModel.findOne.mockImplementation((q: any) => {
      if (q.iata_code === 'UNS_NULL') return { exec: jest.fn().mockResolvedValue(unservicedNullDist) };
      if (q.iata_code === 'DAD' && q.is_serviced_directly === true) {
        return { exec: jest.fn().mockResolvedValue(dad) };
      }
      return { exec: jest.fn().mockResolvedValue(null) };
    });

    const res = await service.resolveCity('UNS_NULL');
    expect(res.exactMatches).toEqual([]);
    expect(res.nearestSuggestion).toBeUndefined();
  });

  it('BLOCKER 2b: real configured distance of 0 is preserved as valid finite distance', async () => {
    const unservicedZeroDist = {
      iata_code: 'UNS_ZERO',
      city_name: 'Town Zero',
      is_serviced_directly: false,
      nearest_airport_code: 'DAD',
      distance_to_nearest_km: 0,
    };
    const dad = {
      iata_code: 'DAD',
      city_name: 'Da Nang',
      is_serviced_directly: true,
    };

    airportModel.findOne.mockImplementation((q: any) => {
      if (q.iata_code === 'UNS_ZERO') return { exec: jest.fn().mockResolvedValue(unservicedZeroDist) };
      if (q.iata_code === 'DAD' && q.is_serviced_directly === true) {
        return { exec: jest.fn().mockResolvedValue(dad) };
      }
      return { exec: jest.fn().mockResolvedValue(null) };
    });

    const res = await service.resolveCity('UNS_ZERO');
    expect(res.exactMatches).toEqual([]);
    expect(res.nearestSuggestion).toEqual({
      airport: dad,
      distance_km: 0,
      for_city: 'Town Zero',
    });
  });

  it('BLOCKER 1 & 2 on city-level match: unserviced city match with unserviced nearest candidate returns no nearestSuggestion', async () => {
    airportModel.findOne.mockImplementation((q: any) => {
      // Priority 1 (IATA match) returns null for city query
      if (q.is_serviced_directly === true) return { exec: jest.fn().mockResolvedValue(null) };
      return { exec: jest.fn().mockResolvedValue(null) };
    });

    const unservicedMatch = {
      iata_code: 'HOI',
      city_name: 'Hoi An',
      is_serviced_directly: false,
      nearest_airport_code: 'UNSERVICED_DAD',
      distance_to_nearest_km: 30,
    };

    airportModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([unservicedMatch]),
      }),
    });

    const res = await service.resolveCity('Hoi An');
    expect(res.exactMatches).toEqual([]);
    expect(res.nearestSuggestion).toBeUndefined();
    expect(res.unservicedMatches).toEqual([unservicedMatch]);
  });
});
