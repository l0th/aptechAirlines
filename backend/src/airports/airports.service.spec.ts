import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
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
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
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

  it.each(['hà nội', 'Hà Nội', 'ha noi'])(
    'Vietnamese city input %s resolves accent-insensitively to HAN',
    async (query) => {
      const han = {
        iata_code: 'HAN',
        airport_name: 'Noi Bai International Airport',
        city_name: 'Ha Noi',
        is_serviced_directly: true,
      };
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      airportModel.find.mockImplementation((filter: any) => {
        const pattern = filter?.city_name?.$regex;
        const options = filter?.city_name?.$options || '';
        const matches = pattern && new RegExp(pattern, options).test(han.city_name) ? [han] : [];
        return {
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(matches),
          }),
        };
      });

      const res = await service.resolveCity(query);

      expect(res.exactMatches).toEqual([han]);
      expect(res.nearestSuggestion).toBeUndefined();
    },
  );

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

  describe('ensureAirportReference', () => {
    it('provisions missing HKG from curated data with the correct IANA timezone', async () => {
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      airportModel.findOneAndUpdate.mockImplementation((_filter: any, update: any) => ({
        exec: jest.fn().mockResolvedValue(update.$setOnInsert),
      }));

      const airport = await service.ensureAirportReference('hkg');

      expect(airport.iata_code).toBe('HKG');
      expect(airport.time_zone).toBe('Asia/Hong_Kong');
      expect(airport.icao_code).toBe('VHHH');
      expect(airportModel.findOneAndUpdate).toHaveBeenCalledWith(
        { iata_code: 'HKG' },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            iata_code: 'HKG',
            time_zone: 'Asia/Hong_Kong',
            data_source: 'curated_reference',
          }),
        }),
        expect.objectContaining({ upsert: true, new: true }),
      );
    });

    it('repairs a generic UTC LAX record from curated data without overwriting meaningful fields', async () => {
      const existing = {
        iata_code: 'LAX',
        city_name: 'Operator Los Angeles',
        airport_name: 'Operator Managed LAX',
        time_zone: 'UTC',
        lat: 33.9416,
        lng: -118.4085,
      };
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });
      airportModel.findOneAndUpdate.mockImplementation((_filter: any, update: any) => ({
        exec: jest.fn().mockResolvedValue({ ...existing, ...update.$set }),
      }));

      const airport = await service.ensureAirportReference('LAX');

      expect(airport.time_zone).toBe('America/Los_Angeles');
      expect(airport.city_name).toBe('Operator Los Angeles');
      expect(airport.airport_name).toBe('Operator Managed LAX');
      expect(airportModel.findOneAndUpdate).toHaveBeenCalledWith(
        { iata_code: 'LAX' },
        {
          $set: expect.objectContaining({
            time_zone: 'America/Los_Angeles',
            icao_code: 'KLAX',
            country_code: 'US',
            city_code: 'LAX',
          }),
        },
        { new: true },
      );
    });

    it('keeps an existing airport with an authoritative timezone unchanged', async () => {
      const existing = {
        iata_code: 'LAX',
        city_name: 'Los Angeles Custom',
        airport_name: 'Custom Airport Name',
        time_zone: 'America/Los_Angeles',
        icao_code: 'KLAX',
        country_code: 'US',
        city_code: 'LAX',
        lat: 1,
        lng: 2,
      };
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const airport = await service.ensureAirportReference('LAX');

      expect(airport).toBe(existing);
      expect(airportModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects a missing unknown airport instead of inventing timezone data', async () => {
      airportModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.ensureAirportReference('XYZ')).rejects.toThrow(BadRequestException);
      expect(airportModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
