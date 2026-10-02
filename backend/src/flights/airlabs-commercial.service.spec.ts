import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AirlabsCommercialService } from './airlabs-commercial.service';
import { FlightGeneratorService } from './flight-generator.service';
import { RouteRef } from '../reference/reference.schema';
import { ScheduleTemplate } from './schemas/schedule-template.schema';
import { Flight, CabinClass, FlightStatus } from './flights.schema';
import { Airport } from '../airports/airports.schema';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';
import { ReferenceService } from '../reference/reference.service';
import { FlightsService } from './flights.service';
import {
  CommercializeRouteDto,
  UpdateCommercialTemplateDto,
  MaterializeTemplateDto,
} from './airlabs-commercial.dto';
import { resolveLocalWallTimeToUtc } from '../common/timezone.util';

describe('Phase C1: AirLabs-Backed Commercial Flight Foundation (Complete & Hardened)', () => {
  let commercialService: AirlabsCommercialService;
  let generatorService: FlightGeneratorService;

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // In-memory mock stores
  let mockRouteRefs: Map<string, any>;
  let mockTemplates: Map<string, any>;
  let mockFlights: Map<string, any>;
  let mockAirports: Map<string, any>;

  const mockRouteRefModel: any = {
    findOne: jest.fn((filter: any) => {
      let found: any = null;
      for (const item of mockRouteRefs.values()) {
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (item[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) {
          found = item;
          break;
        }
      }
      return {
        exec: jest.fn().mockResolvedValue(found),
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(found),
        }),
      };
    }),
    find: jest.fn((filter: any) => {
      const results: any[] = [];
      for (const item of mockRouteRefs.values()) {
        let match = true;
        if (filter.source && item.source !== filter.source) match = false;
        if (filter.dep_iata && item.dep_iata !== filter.dep_iata) match = false;
        if (filter.arr_iata && item.arr_iata !== filter.arr_iata) match = false;
        if (match) results.push(item);
      }
      return {
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(results),
        }),
        exec: jest.fn().mockResolvedValue(results),
      };
    }),
    countDocuments: jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockImplementation(() => Promise.resolve(mockRouteRefs ? mockRouteRefs.size : 0)),
    })),
  };

  const mockTemplateModel: any = {
    findOneAndUpdate: jest.fn((filter: any, update: any, options: any) => {
      const template_id = filter.template_id;
      let existing = mockTemplates.get(template_id);
      const dataToSet = update.$set || update;
      const updated = { ...existing, ...dataToSet, _id: existing?._id || 'tpl_obj_id_123' };
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
          delete updated[k];
        }
      }
      mockTemplates.set(template_id, updated);
      return {
        exec: jest.fn().mockResolvedValue(updated),
        ...updated,
      };
    }),
    findOne: jest.fn((filter: any) => {
      let found: any = null;
      for (const tpl of mockTemplates.values()) {
        if (filter.template_id && tpl.template_id === filter.template_id) {
          found = tpl;
          break;
        }
        if (filter.$or) {
          for (const cond of filter.$or) {
            if (cond._id && tpl._id === cond._id) found = tpl;
            if (cond.template_id && tpl.template_id === cond.template_id) found = tpl;
          }
        }
      }
      if (!found) {
        return {
          exec: jest.fn().mockResolvedValue(null),
        };
      }
      const doc: any = {
        ...found,
        set: jest.fn().mockImplementation(function (k: string, v: any) {
          if (v === undefined) {
            delete this[k];
          } else {
            this[k] = v;
          }
          return this;
        }),
        save: jest.fn().mockImplementation(async function () {
          const toSave = { ...this };
          delete toSave.save;
          delete toSave.exec;
          delete toSave.set;
          mockTemplates.set(this.template_id, toSave);
          return this;
        }),
      };
      doc.exec = jest.fn().mockResolvedValue(doc);
      return doc;
    }),
    find: jest.fn((filter: any) => {
      const results: any[] = [];
      for (const item of mockTemplates.values()) {
        let match = true;
        if (filter.source_type && item.source_type !== filter.source_type) match = false;
        if (filter.is_active !== undefined && item.is_active !== filter.is_active) match = false;
        if (filter.origin_iata && item.origin_iata !== filter.origin_iata) match = false;
        if (filter.dest_iata && item.dest_iata !== filter.dest_iata) match = false;
        if (match) results.push(item);
      }
      return {
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(results),
        }),
        exec: jest.fn().mockResolvedValue(results),
      };
    }),
    countDocuments: jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockImplementation(() => Promise.resolve(mockTemplates ? mockTemplates.size : 0)),
    })),
    bulkWrite: jest.fn((ops?: any[]) => {
      if (ops) {
        for (const op of ops) {
          if (op.updateOne) {
            const tplId = op.updateOne.filter?.template_id;
            const update = op.updateOne.update?.$set || op.updateOne.update;
            if (tplId) {
              const existing = mockTemplates.get(tplId) || {};
              mockTemplates.set(tplId, { ...existing, ...update, template_id: tplId });
            }
          }
        }
      }
      return Promise.resolve({ upsertedCount: ops?.length || 0, modifiedCount: 0 });
    }),
  };

  const mockFlightModel: any = {
    bulkWrite: jest.fn((ops: any[]) => {
      let upsertedCount = 0;
      let matchedCount = 0;
      for (const op of ops) {
        const filter = op.updateOne.filter;
        const key = `${filter.template_id}:${filter.operating_date}`;
        if (mockFlights.has(key)) {
          matchedCount++;
          // $setOnInsert does NOT modify existing document
        } else {
          upsertedCount++;
          const insertDoc = { ...op.updateOne.update.$setOnInsert, _id: `fl_${Date.now()}_${Math.random()}` };
          mockFlights.set(key, insertDoc);
        }
      }
      return Promise.resolve({ upsertedCount, matchedCount });
    }),
    exists: jest.fn((filter: any) => {
      for (const fl of mockFlights.values()) {
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (fl[k] !== v) match = false;
        }
        if (match) return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }),
    findOne: jest.fn((filter: any) => {
      let found: any = null;
      for (const fl of mockFlights.values()) {
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (fl[k] !== v) match = false;
        }
        if (match) {
          found = fl;
          break;
        }
      }
      return {
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(found),
        }),
        exec: jest.fn().mockResolvedValue(found),
      };
    }),
  };

  const mockAirportModel: any = {
    find: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockImplementation(() => Promise.resolve(Array.from(mockAirports.values()))),
      }),
    }),
    findOne: jest.fn((filter: any) => {
      const apt = mockAirports.get(filter.iata_code);
      return {
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(apt || null),
        }),
        exec: jest.fn().mockResolvedValue(apt || null),
      };
    }),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };

  beforeEach(async () => {
    mockRouteRefs = new Map();
    mockTemplates = new Map();
    mockFlights = new Map();
    mockAirports = new Map();

    // Populate reference airports
    mockAirports.set('SGN', {
      iata_code: 'SGN',
      name: 'Tan Son Nhat',
      time_zone: 'Asia/Ho_Chi_Minh',
      lat: 10.8188,
      lng: 106.652,
      is_serviced_directly: true,
    });
    mockAirports.set('HAN', {
      iata_code: 'HAN',
      name: 'Noi Bai',
      time_zone: 'Asia/Ho_Chi_Minh',
      lat: 21.2212,
      lng: 105.807,
      is_serviced_directly: true,
    });
    mockAirports.set('NRT', {
      iata_code: 'NRT',
      name: 'Narita International',
      time_zone: 'Asia/Tokyo',
      lat: 35.7647,
      lng: 140.386,
      is_serviced_directly: true,
    });
    mockAirports.set('LAX', {
      iata_code: 'LAX',
      name: 'Los Angeles International',
      time_zone: 'America/Los_Angeles',
      lat: 33.9416,
      lng: -118.4085,
      is_serviced_directly: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirlabsCommercialService,
        FlightGeneratorService,
        { provide: getModelToken(RouteRef.name), useValue: mockRouteRefModel },
        { provide: getModelToken(ScheduleTemplate.name), useValue: mockTemplateModel },
        { provide: getModelToken(Flight.name), useValue: mockFlightModel },
        { provide: getModelToken(Airport.name), useValue: mockAirportModel },
      ],
    }).compile();

    commercialService = module.get<AirlabsCommercialService>(AirlabsCommercialService);
    generatorService = module.get<FlightGeneratorService>(FlightGeneratorService);
  });

  // =========================================================================
  // Section 1: Original Phase C1 Foundation & Invariants
  // =========================================================================
  describe('Original Phase C1 Foundation & Architectural Invariants', () => {
    it('C1-1: Preserves full provenance from RouteRef to ScheduleTemplate and concrete Flight', async () => {
      const syncDate = new Date('2026-09-18T10:00:00.000Z');
      mockRouteRefs.set('airlabs_PROV_1', {
        source_key: 'airlabs_PROV_1',
        source: 'airlabs',
        airline_iata: 'VN',
        airline_icao: 'HVN',
        flight_iata: 'VN231',
        flight_number: '231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '06:30',
        arr_time: '08:45',
        days: ['mon', 'wed', 'fri'],
        aircraft_icao: 'A21N',
        duration: 135,
        synced_at: syncDate,
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_PROV_1',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 16 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 188 },
        ],
      });

      expect(template.source_type).toBe('AIRLABS');
      expect(template.source_route_key).toBe('airlabs_PROV_1');
      expect(template.source_service_key).toBe('AIRLABS_SVC_VN_VN231_SGN_HAN');
      expect(template.source_airline_iata).toBe('VN');
      expect(template.source_airline_icao).toBe('HVN');
      expect(template.source_flight_iata).toBe('VN231');
      expect(template.source_flight_number).toBe('231');
      expect(template.source_aircraft_icao).toBe('A21N');
      expect(template.source_duration_minutes).toBe(135);
      expect(template.source_synced_at).toEqual(syncDate);

      // Materialize and check Flight provenance
      await generatorService.generateForTemplate(template, '2026-10-05', 7); // 2026-10-05 is Monday
      const flight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(flight).toBeDefined();
      expect(flight.operator).toBe('APTECH_AIRLINES');
      expect(flight.is_bookable).toBe(true);
      expect(flight.data_source).toBe('AIRLABS_COMMERCIALIZED');
      expect(flight.generated_source).toBe('airlabs_commercial_schedule');
      expect(flight.source_type).toBe('AIRLABS');
      expect(flight.source_route_key).toBe('airlabs_PROV_1');
      expect(flight.source_flight_number).toBe('231');
      expect(flight.flight_number).toBe('APT231');
    });

    it('C1-2: Source route/time and provenance remain immutable under commercial update', async () => {
      mockRouteRefs.set('airlabs_IMMUTABLE', {
        source_key: 'airlabs_IMMUTABLE',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN500',
        flight_number: '500',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '10:00',
        arr_time: '12:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_IMMUTABLE',
        aptech_flight_number: 'APT500',
        aircraft_type: 'A21N',
        base_price_economy: 1200000,
      });

      // Attempting to update commercial properties
      const updated = await commercialService.updateCommercialTemplate(template.template_id, {
        flight_number: 'APT501',
        base_price_economy: 1350000,
      });

      // Commercial fields updated
      expect(updated.flight_number).toBe('APT501');
      expect(updated.base_price_economy).toBe(1350000);
      // Provenance & route fields remain immutable
      expect(updated.origin_iata).toBe('SGN');
      expect(updated.dest_iata).toBe('HAN');
      expect(updated.std_dep_time).toBe('10:00');
      expect(updated.std_arr_time).toBe('12:00');
      expect(updated.source_route_key).toBe('airlabs_IMMUTABLE');
      expect(updated.source_flight_iata).toBe('VN500');
    });

    it('C1-3: Operating-day filtering only generates flights on valid schedule days', async () => {
      // Monday only (isoDow = 1)
      mockRouteRefs.set('airlabs_MON_ONLY', {
        source_key: 'airlabs_MON_ONLY',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN111',
        flight_number: '111',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '07:00',
        arr_time: '09:00',
        days: ['mon'],
        aircraft_icao: 'A20N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_MON_ONLY',
        aptech_flight_number: 'APT111',
        aircraft_type: 'A20N',
        base_price_economy: 1000000,
      });

      // Generate 14 days starting Monday 2026-10-05 (should generate exactly 2 flights: Oct 5 and Oct 12)
      const stats = await generatorService.generateForTemplate(template, '2026-10-05', 14);
      expect(stats.inserted_count).toBe(2);

      const generated = Array.from(mockFlights.values()).filter((f) => f.template_id === template.template_id);
      expect(generated.length).toBe(2);
      expect(generated[0].operating_date).toBe('2026-10-05');
      expect(generated[1].operating_date).toBe('2026-10-12');
    });

    it('C1-4: {template_id, operating_date} idempotency protects sold seats and modifications on re-run', async () => {
      mockRouteRefs.set('airlabs_IDEMP', {
        source_key: 'airlabs_IDEMP',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN222',
        flight_number: '222',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_IDEMP',
        aptech_flight_number: 'APT222',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      // Run 1: insert flights
      const stats1 = await generatorService.generateForTemplate(template, '2026-10-01', 3);
      expect(stats1.inserted_count).toBe(3);

      // Simulate selling seats on 2026-10-01 flight
      const flightKey = `${template.template_id}:2026-10-01`;
      const flight = mockFlights.get(flightKey);
      flight.inventories[0].available_seats = 5; // sold seats down to 5
      mockFlights.set(flightKey, flight);

      // Run 2: re-run generation over the same window
      const stats2 = await generatorService.generateForTemplate(template, '2026-10-01', 3);
      expect(stats2.inserted_count).toBe(0);
      expect(stats2.matched_count).toBe(3);

      // Verify sold available_seats was preserved by $setOnInsert
      const flightAfter = mockFlights.get(flightKey);
      expect(flightAfter.inventories[0].available_seats).toBe(5);
    });

    it('C1-5: Incomplete source RouteRef is strictly rejected with BadRequestException', async () => {
      mockRouteRefs.set('airlabs_INCOMPLETE_ORIGIN', {
        source_key: 'airlabs_INCOMPLETE_ORIGIN',
        source: 'airlabs',
        dep_iata: '',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_INCOMPLETE_ORIGIN',
          aptech_flight_number: 'APT001',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Section 2: Phase C1 Hardening Defect Verifications (1 - 11)
  // =========================================================================
  describe('Phase C1 Hardening Defect Verifications (1 - 11)', () => {
    it('Defect 1: Persists exact commercial inventory allocation and materializes it to Flight', async () => {
      mockRouteRefs.set('airlabs_VN_231_INV_PERSIST', {
        source_key: 'airlabs_VN_231_INV_PERSIST',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN231',
        flight_number: '231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '06:30',
        arr_time: '08:45',
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_VN_231_INV_PERSIST',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
        base_price_business: 3200000,
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 12 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 150 },
        ],
      });

      expect(template.commercial_inventories).toBeDefined();
      expect(template.commercial_inventories?.length).toBe(2);
      expect(template.commercial_inventories?.find((i) => i.cabin_class === CabinClass.BUSINESS)?.allocated_seats).toBe(12);
      expect(template.commercial_inventories?.find((i) => i.cabin_class === CabinClass.ECONOMY)?.allocated_seats).toBe(150);

      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const generatedFlight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(generatedFlight).toBeDefined();
      const busInv = generatedFlight.inventories.find((i: any) => i.cabin_class === CabinClass.BUSINESS);
      const ecoInv = generatedFlight.inventories.find((i: any) => i.cabin_class === CabinClass.ECONOMY);

      expect(busInv.allocated_seats).toBe(12);
      expect(busInv.available_seats).toBe(12);
      expect(ecoInv.allocated_seats).toBe(150);
      expect(ecoInv.available_seats).toBe(150);
    });

    it('Defect 2: Rejects AirLabs commercial flight when arrival chronology cannot be resolved and no duration exists', async () => {
      mockRouteRefs.set('airlabs_BAD_CHRONO', {
        source_key: 'airlabs_BAD_CHRONO',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN999',
        flight_number: '999',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '12:00',
        arr_time: '12:05', // 5 minutes diff
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_BAD_CHRONO',
        aptech_flight_number: 'APT999',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      await expect(generatorService.generateForTemplate(template, '2026-10-01', 1)).rejects.toThrow(BadRequestException);
    });

    it('Defect 3: Rejects AirLabs materialization when airport or timezone data is missing', async () => {
      mockRouteRefs.set('airlabs_MISSING_APT', {
        source_key: 'airlabs_MISSING_APT',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN888',
        flight_number: '888',
        dep_iata: 'SGN',
        arr_iata: 'XYZ',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_MISSING_APT',
        aptech_flight_number: 'APT888',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      await expect(generatorService.generateForTemplate(template, '2026-10-01', 1)).rejects.toThrow(BadRequestException);
    });

    it('Defect 4: Iterates exact calendar dates across DST spring-forward boundary (America/Los_Angeles)', async () => {
      mockRouteRefs.set('airlabs_DST_LAX', {
        source_key: 'airlabs_DST_LAX',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN001',
        flight_number: '1',
        dep_iata: 'LAX',
        arr_iata: 'SGN',
        dep_time: '23:00',
        arr_time: '06:00',
        days: ['daily'],
        aircraft_icao: 'B789',
        duration: 840,
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_DST_LAX',
        aptech_flight_number: 'APT001',
        aircraft_type: 'B789',
        base_price_economy: 12000000,
      });

      // 2026-03-08 is US Spring-Forward DST change in America/Los_Angeles
      await generatorService.generateForTemplate(template, '2026-03-07', 4);

      const generated = Array.from(mockFlights.values()).filter((f) => f.template_id === template.template_id);
      const operatingDates = generated.map((f) => f.operating_date).sort();

      expect(operatingDates).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    });

    it('Defect 5: Per-template horizon for Monday-only template ending on Sunday generates expected flights then returns 0', async () => {
      mockRouteRefs.set('airlabs_MON_HORIZON', {
        source_key: 'airlabs_MON_HORIZON',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN777',
        flight_number: '777',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '07:00',
        arr_time: '09:00',
        days: ['mon'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_MON_HORIZON',
        aptech_flight_number: 'APT777',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      // 2026-10-05 is Monday. 14 days ends on Sunday 2026-10-18.
      const firstRunCount = await generatorService.ensureCommercialTemplateHorizon(template, 14, '2026-10-05');
      expect(firstRunCount).toBe(2); // Monday Oct 5 and Monday Oct 12

      // Second check: already satisfied, must return 0
      const secondRunCount = await generatorService.ensureCommercialTemplateHorizon(template, 14, '2026-10-05');
      expect(secondRunCount).toBe(0);
    });

    it('Defect 6 & 7: Revalidates cabins and inventories when aircraft changes, rejecting incompatible configuration', async () => {
      mockRouteRefs.set('airlabs_VN_231_SGN_HAN_0630_1234567', {
        source_key: 'airlabs_VN_231_SGN_HAN_0630_1234567',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN231',
        flight_number: '231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '06:30',
        arr_time: '08:45',
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        aircraft_icao: 'B789',
      });

      const created = await commercialService.commercializeRoute({
        source_key: 'airlabs_VN_231_SGN_HAN_0630_1234567',
        aptech_flight_number: 'APT231',
        aircraft_type: 'B789',
        base_price_economy: 2000000,
        cabin_classes: [CabinClass.BUSINESS, CabinClass.CLUB, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 28 },
          { cabin_class: CabinClass.CLUB, allocated_seats: 35 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 200 },
        ],
      });

      // Change aircraft to A20N which does NOT support CLUB
      await expect(
        commercialService.updateCommercialTemplate(created.template_id, {
          aircraft_type: 'A20N',
        }),
      ).rejects.toThrow(BadRequestException);

      // Supplying valid cabins and inventories for A20N succeeds
      const updated = await commercialService.updateCommercialTemplate(created.template_id, {
        aircraft_type: 'A20N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 12 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 160 },
        ],
      });

      expect(updated.aircraft_type).toBe('A20N');
      expect(updated.cabin_classes).toEqual([CabinClass.BUSINESS, CabinClass.ECONOMY]);
      expect(updated.commercial_inventories?.find((i) => i.cabin_class === CabinClass.BUSINESS)?.allocated_seats).toBe(12);
    });

    it('Defect 8: Supports provider dep_time_utc when local dep_time is absent without fabricating local clock time', async () => {
      mockRouteRefs.set('airlabs_VN_231_SGN_HAN_0630_UTC_ONLY', {
        source_key: 'airlabs_VN_231_SGN_HAN_0630_UTC_ONLY',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN231',
        flight_number: '231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '',
        dep_time_utc: '23:30',
        arr_time: '01:45',
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_VN_231_SGN_HAN_0630_UTC_ONLY',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
        cabin_classes: [CabinClass.ECONOMY],
        inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }],
      });

      expect(template.std_dep_time).toBeUndefined();
      expect(template.source_dep_time_utc).toBe('23:30');

      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const generatedFlight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(generatedFlight).toBeDefined();
      expect(generatedFlight.scheduled_departure.toISOString()).toBe('2026-09-30T23:30:00.000Z');
    });

    it('Defect 8b: Rejects route missing both local dep_time and dep_time_utc', async () => {
      mockRouteRefs.set('airlabs_INVALID_NO_DEP_TIME', {
        source_key: 'airlabs_INVALID_NO_DEP_TIME',
        source: 'airlabs',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '',
        dep_time_utc: '',
        arr_time: '08:45',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_INVALID_NO_DEP_TIME',
          aptech_flight_number: 'APT999',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Defect 9: FlightsService.searchFlights explicitly calls findRouteNetworkConnections with "airlabs" for all fallback branches', async () => {
      const mockFindRouteNetwork = jest.fn().mockResolvedValue([]);
      const mockReferenceService: any = {
        expandLocation: jest.fn().mockImplementation((loc: string) => {
          return Promise.resolve({ iata_codes: [loc], matched_kind: 'airport', label: loc });
        }),
        findRouteNetworkConnections: mockFindRouteNetwork,
      };

      const mockQuery: any = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockQuery.lean = jest.fn().mockReturnValue(mockQuery);
      const mockFlightModelForSearch: any = {
        find: jest.fn().mockReturnValue(mockQuery),
        distinct: jest.fn().mockResolvedValue([]),
      };

      const searchService = new FlightsService(
        mockFlightModelForSearch,
        {} as any, // bookingModel
        {
          findByIata: jest.fn().mockImplementation((iata: string) => Promise.resolve({ iata_code: iata, city_name: iata })),
        } as any, // airportsService
        mockReferenceService, // referenceService
        {} as any, // usersService
        undefined, // routeGraphService undefined -> hits no-graph branch
        undefined, // routeScheduleValidatorService undefined
      );

      // 1. One-way search without graph service
      await searchService.searchFlights({
        origin: 'SGN',
        destination: 'LAX',
        departure_date: '2026-10-01',
        adults: 1,
      } as any);

      // Verify outbound call received 'airlabs'
      expect(mockFindRouteNetwork).toHaveBeenCalledWith(['SGN'], ['LAX'], 'airlabs');

      // 2. Round-trip search
      mockFindRouteNetwork.mockClear();
      await searchService.searchFlights({
        origin: 'SGN',
        destination: 'LAX',
        departure_date: '2026-10-01',
        return_date: '2026-10-10',
        adults: 1,
      } as any);

      // Verify outbound and return calls received 'airlabs'
      expect(mockFindRouteNetwork).toHaveBeenCalledWith(['SGN'], ['LAX'], 'airlabs');
      expect(mockFindRouteNetwork).toHaveBeenCalledWith(['LAX'], ['SGN'], 'airlabs');
    });

    it('Defect 10: updateCommercialTemplate and materializeTemplate reject non-AIRLABS and inactive templates', async () => {
      const legacyTemplate: any = {
        template_id: 'LEGACY-SYNTHETIC-01',
        flight_number: 'APT100',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        source_type: 'LEGACY_SYNTHETIC',
        is_active: true,
      };
      mockTemplates.set('LEGACY-SYNTHETIC-01', legacyTemplate);

      await expect(
        commercialService.updateCommercialTemplate('LEGACY-SYNTHETIC-01', {
          flight_number: 'APT101',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(commercialService.materializeTemplate('LEGACY-SYNTHETIC-01', 30)).rejects.toThrow(BadRequestException);

      const inactiveAirLabs: any = {
        template_id: 'AIRLABS-COMM-INACTIVE',
        flight_number: 'APT200',
        source_type: 'AIRLABS',
        is_active: false,
      };
      mockTemplates.set('AIRLABS-COMM-INACTIVE', inactiveAirLabs);

      await expect(commercialService.materializeTemplate('AIRLABS-COMM-INACTIVE', 30)).rejects.toThrow(BadRequestException);
    });

    it('Defect 11: Leaves source_synced_at undefined when RouteRef has no synced_at timestamp', async () => {
      mockRouteRefs.set('airlabs_VN_999_SGN_HAN_NO_SYNCED_AT', {
        source_key: 'airlabs_VN_999_SGN_HAN_NO_SYNCED_AT',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN999',
        flight_number: '999',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '09:00',
        arr_time: '11:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_VN_999_SGN_HAN_NO_SYNCED_AT',
        aptech_flight_number: 'APT999',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      expect(template.source_synced_at).toBeUndefined();
    });
  });

  // =========================================================================
  // Section 3: Gate Issue 1 — Honest source_arr_time_utc Materialization
  // =========================================================================
  describe('Gate Issue 1: Honest Materialization of source_arr_time_utc', () => {
    it('Issue 1a: Materializes local dep + UTC-only arrival honestly without inventing local clock', async () => {
      mockRouteRefs.set('airlabs_LOCAL_DEP_UTC_ARR', {
        source_key: 'airlabs_LOCAL_DEP_UTC_ARR',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN301',
        flight_number: '301',
        dep_iata: 'SGN', // SGN UTC+7. 06:00 local = 23:00 UTC previous day
        arr_iata: 'HAN', // HAN UTC+7
        dep_time: '06:00',
        dep_time_utc: '',
        arr_time: '',
        arr_time_utc: '01:15', // Arrival 01:15 UTC (2h15m after 23:00 UTC)
        days: ['daily'],
        aircraft_icao: 'A21N',
        duration: 135,
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_LOCAL_DEP_UTC_ARR',
        aptech_flight_number: 'APT301',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      expect(template.std_arr_time).toBeUndefined();
      expect(template.source_arr_time_utc).toBe('01:15');

      // Generate on 2026-10-01
      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const flight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(flight).toBeDefined();
      expect(flight.scheduled_departure.toISOString()).toBe('2026-09-30T23:00:00.000Z');
      expect(flight.scheduled_arrival.toISOString()).toBe('2026-10-01T01:15:00.000Z');
      expect(flight.duration_minutes).toBe(135);
    });

    it('Issue 1b: Materializes UTC-only dep + UTC-only arrival', async () => {
      mockRouteRefs.set('airlabs_UTC_DEP_UTC_ARR', {
        source_key: 'airlabs_UTC_DEP_UTC_ARR',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN302',
        flight_number: '302',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '',
        dep_time_utc: '01:00',
        arr_time: '',
        arr_time_utc: '03:15',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_UTC_DEP_UTC_ARR',
        aptech_flight_number: 'APT302',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const flight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(flight).toBeDefined();
      expect(flight.scheduled_departure.toISOString()).toBe('2026-10-01T01:00:00.000Z');
      expect(flight.scheduled_arrival.toISOString()).toBe('2026-10-01T03:15:00.000Z');
      expect(flight.duration_minutes).toBe(135);
    });

    it('Issue 1c: Materializes overnight UTC arrival across midnight boundary', async () => {
      mockRouteRefs.set('airlabs_OVERNIGHT_UTC_ARR', {
        source_key: 'airlabs_OVERNIGHT_UTC_ARR',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN303',
        flight_number: '303',
        dep_iata: 'SGN',
        arr_iata: 'NRT',
        dep_time: '',
        dep_time_utc: '22:30', // Dep 22:30 UTC
        arr_time: '',
        arr_time_utc: '04:00', // Arr 04:00 UTC next day (330 min flight)
        days: ['daily'],
        aircraft_icao: 'A21N',
        duration: 330,
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_OVERNIGHT_UTC_ARR',
        aptech_flight_number: 'APT303',
        aircraft_type: 'A21N',
        base_price_economy: 5000000,
      });

      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const flight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(flight).toBeDefined();
      expect(flight.scheduled_departure.toISOString()).toBe('2026-09-30T22:30:00.000Z');
      // Overnight UTC: arrival next UTC calendar day 04:00 UTC (330 min flight)
      expect(flight.scheduled_arrival.toISOString()).toBe('2026-10-01T04:00:00.000Z');
      expect(flight.duration_minutes).toBe(330);
    });
  });

  // =========================================================================
  // Section 4: Gate Issue 2 — Strict 1-to-1 Cabin & Commercial Inventory Invariant
  // =========================================================================
  describe('Gate Issue 2: Strict 1-to-1 Commercial Inventories & Cabins', () => {
    it('Issue 2a: Rejects commercialization when inventory cabin is missing relative to cabin_classes', async () => {
      mockRouteRefs.set('airlabs_INV_STRICT_1', {
        source_key: 'airlabs_INV_STRICT_1',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN401',
        flight_number: '401',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      // Supplied BUSINESS and ECONOMY, but inventories only has ECONOMY
      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_INV_STRICT_1',
          aptech_flight_number: 'APT401',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
          cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
          inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 150 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Issue 2b: Rejects commercialization when extra inventory cabin is supplied', async () => {
      mockRouteRefs.set('airlabs_INV_STRICT_2', {
        source_key: 'airlabs_INV_STRICT_2',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN402',
        flight_number: '402',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      // Supplied cabin_classes: [ECONOMY], but inventories has [ECONOMY, BUSINESS]
      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_INV_STRICT_2',
          aptech_flight_number: 'APT402',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
          cabin_classes: [CabinClass.ECONOMY],
          inventories: [
            { cabin_class: CabinClass.ECONOMY, allocated_seats: 150 },
            { cabin_class: CabinClass.BUSINESS, allocated_seats: 12 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Issue 2c: Rejects duplicate cabin inventory entries', async () => {
      mockRouteRefs.set('airlabs_INV_STRICT_3', {
        source_key: 'airlabs_INV_STRICT_3',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN403',
        flight_number: '403',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_INV_STRICT_3',
          aptech_flight_number: 'APT403',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
          inventories: [
            { cabin_class: CabinClass.ECONOMY, allocated_seats: 100 },
            { cabin_class: CabinClass.ECONOMY, allocated_seats: 50 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Issue 2d: Cabin update removing a cabin requires matching inventories in same request', async () => {
      mockRouteRefs.set('airlabs_INV_STRICT_4', {
        source_key: 'airlabs_INV_STRICT_4',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN404',
        flight_number: '404',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const tpl = await commercialService.commercializeRoute({
        source_key: 'airlabs_INV_STRICT_4',
        aptech_flight_number: 'APT404',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 16 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 188 },
        ],
      });

      // Updating cabin_classes to [ECONOMY] without matching inventory in same request is rejected
      await expect(
        commercialService.updateCommercialTemplate(tpl.template_id, {
          cabin_classes: [CabinClass.ECONOMY],
        }),
      ).rejects.toThrow(BadRequestException);

      // Supplying matching inventory succeeds and removes stale BUSINESS inventory
      const updated = await commercialService.updateCommercialTemplate(tpl.template_id, {
        cabin_classes: [CabinClass.ECONOMY],
        inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }],
      });

      expect(updated.cabin_classes).toEqual([CabinClass.ECONOMY]);
      expect(updated.commercial_inventories?.length).toBe(1);
      expect(updated.commercial_inventories?.[0].cabin_class).toBe(CabinClass.ECONOMY);
    });

    it('Issue 2e: Cabin update adding a cabin requires matching inventories and does not silently give full capacity', async () => {
      mockRouteRefs.set('airlabs_INV_STRICT_5', {
        source_key: 'airlabs_INV_STRICT_5',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN405',
        flight_number: '405',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const tpl = await commercialService.commercializeRoute({
        source_key: 'airlabs_INV_STRICT_5',
        aptech_flight_number: 'APT405',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
        cabin_classes: [CabinClass.ECONOMY],
        inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }],
      });

      // Adding BUSINESS without providing inventory is rejected
      await expect(
        commercialService.updateCommercialTemplate(tpl.template_id, {
          cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        }),
      ).rejects.toThrow(BadRequestException);

      // Providing matching inventory succeeds
      const updated = await commercialService.updateCommercialTemplate(tpl.template_id, {
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 10 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 180 },
        ],
      });

      expect(updated.cabin_classes).toEqual([CabinClass.BUSINESS, CabinClass.ECONOMY]);
      expect(updated.commercial_inventories?.find((i) => i.cabin_class === CabinClass.BUSINESS)?.allocated_seats).toBe(10);
    });

    it('Issue 2f: Generator rejects commercial template if configured cabin has no commercial inventory', async () => {
      // Create manually corrupted template in store
      const corrupted: any = {
        template_id: 'CORRUPT_TPL_1',
        flight_number: 'APT999',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        std_dep_time: '08:00',
        std_arr_time: '10:00',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        commercial_inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }], // Missing BUSINESS
        source_type: 'AIRLABS',
        is_active: true,
      };
      mockTemplates.set('CORRUPT_TPL_1', corrupted);

      await expect(generatorService.generateForTemplate(corrupted, '2026-10-01', 1)).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Section 5: Gate Issue 3 — MaterializeTemplateDto Validation
  // =========================================================================
  describe('Gate Issue 3: MaterializeTemplateDto Validation', () => {
    it('Issue 3a: Validates MaterializeTemplateDto days_ahead <= 330, days_ahead >= 1 and start_date format', async () => {
      // 1. Valid DTO
      const validDto = plainToInstance(MaterializeTemplateDto, {
        days_ahead: 330,
        start_date: '2026-10-01',
      });
      const validErrors = await validate(validDto);
      expect(validErrors.length).toBe(0);

      // 2. days_ahead > 330 must fail
      const tooManyDays = plainToInstance(MaterializeTemplateDto, {
        days_ahead: 331,
      });
      const tooManyErrors = await validate(tooManyDays);
      expect(tooManyErrors.length).toBeGreaterThan(0);
      expect(tooManyErrors[0].constraints?.max).toBeDefined();

      // 3. days_ahead < 1 must fail
      const zeroDays = plainToInstance(MaterializeTemplateDto, {
        days_ahead: 0,
      });
      const zeroErrors = await validate(zeroDays);
      expect(zeroErrors.length).toBeGreaterThan(0);
      expect(zeroErrors[0].constraints?.min).toBeDefined();

      // 4. Invalid start_date format must fail
      const badDate = plainToInstance(MaterializeTemplateDto, {
        start_date: '2026-02-30',
      });
      const badDateErrors = await validate(badDate);
      expect(badDateErrors.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Section 6: Gate Issue 4 — Aptech Commercial Flight Number Format
  // =========================================================================
  describe('Gate Issue 4: Aptech Commercial Flight Number Format', () => {
    it('Issue 4a: Enforces Aptech commercial flight number format ^APT[A-Z0-9]+$ in DTO and Service', async () => {
      // DTO Validation
      const validDto = plainToInstance(CommercializeRouteDto, {
        source_key: 'airlabs_FN_TEST',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });
      expect((await validate(validDto)).length).toBe(0);

      const invalidDto = plainToInstance(CommercializeRouteDto, {
        source_key: 'airlabs_FN_TEST',
        aptech_flight_number: 'VN231', // Not starting with APT
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });
      const invalidErrors = await validate(invalidDto);
      expect(invalidErrors.length).toBeGreaterThan(0);
      expect(invalidErrors[0].constraints?.matches).toBeDefined();

      // Service-level validation
      mockRouteRefs.set('airlabs_FN_TEST', {
        source_key: 'airlabs_FN_TEST',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN231',
        flight_number: '231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_FN_TEST',
          aptech_flight_number: 'VN231',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);

      // Valid lowercase is normalized to uppercase APT231
      const created = await commercialService.commercializeRoute({
        source_key: 'airlabs_FN_TEST',
        aptech_flight_number: 'apt231',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });
      expect(created.flight_number).toBe('APT231');

      // Update validation
      await expect(
        commercialService.updateCommercialTemplate(created.template_id, {
          flight_number: 'INVALID-APT',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Section 7: Gate Issue 5 — DST-Safe Local Wall Time Conversion
  // =========================================================================
  describe('Gate Issue 5 & Operating-Date Provider Local/UTC Consistency', () => {
    it('1. America/Los_Angeles summer date: 08:00 local + 15:00 UTC => valid', () => {
      // 2026-07-15 is summer (PDT, UTC-7). 08:00 local = 15:00 UTC.
      const instant = resolveLocalWallTimeToUtc('2026-07-15', '08:00', 'America/Los_Angeles', '15:00');
      expect(instant.toISOString()).toBe('2026-07-15T15:00:00.000Z');
    });

    it('2. America/Los_Angeles same summer date: 08:00 local + 16:00 UTC => reject', () => {
      // In summer, 08:00 local resolves to 15:00 UTC, conflicting with provider 16:00 UTC
      expect(() => {
        resolveLocalWallTimeToUtc('2026-07-15', '08:00', 'America/Los_Angeles', '16:00');
      }).toThrow(BadRequestException);
    });

    it('3. America/Los_Angeles winter date: 08:00 local + 16:00 UTC => valid', () => {
      // 2026-01-15 is winter (PST, UTC-8). 08:00 local = 16:00 UTC.
      const instant = resolveLocalWallTimeToUtc('2026-01-15', '08:00', 'America/Los_Angeles', '16:00');
      expect(instant.toISOString()).toBe('2026-01-15T16:00:00.000Z');
    });

    it('4. Ambiguous fall-back local + matching provider UTC => choose matching instant', () => {
      // 2026-11-01 01:30 in LA occurs twice: 08:30 UTC (PDT) and 09:30 UTC (PST)
      const pdtInstant = resolveLocalWallTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles', '08:30');
      expect(pdtInstant.toISOString()).toBe('2026-11-01T08:30:00.000Z');

      const pstInstant = resolveLocalWallTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles', '09:30');
      expect(pstInstant.toISOString()).toBe('2026-11-01T09:30:00.000Z');

      // Without provider UTC, default policy returns earlier instant (PDT)
      const defaultInstant = resolveLocalWallTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles');
      expect(defaultInstant.toISOString()).toBe('2026-11-01T08:30:00.000Z');
    });

    it('5. Ambiguous local + conflicting provider UTC => reject', () => {
      // 2026-11-01 01:30 in LA only occurs at 08:30 and 09:30 UTC. 10:30 UTC must be rejected.
      expect(() => {
        resolveLocalWallTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles', '10:30');
      }).toThrow(BadRequestException);
    });

    it('6. Arrival local/UTC conflict + valid duration => STILL reject; duration must not hide provider inconsistency', async () => {
      mockRouteRefs.set('airlabs_ARR_CONFLICT_WITH_DUR', {
        source_key: 'airlabs_ARR_CONFLICT_WITH_DUR',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN660',
        flight_number: '660',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        arr_time_utc: '01:00',
        days: ['daily'],
        duration: 120,
        aircraft_icao: 'A21N',
      });

      // Commercialization must reject genuinely inconsistent provider local/UTC data despite positive duration
      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_ARR_CONFLICT_WITH_DUR',
          aptech_flight_number: 'APT660',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('America/Los_Angeles 2026-03-08 03:30 resolves to 2026-03-08T10:30:00.000Z', () => {
      const utc = resolveLocalWallTimeToUtc('2026-03-08', '03:30', 'America/Los_Angeles');
      expect(utc.toISOString()).toBe('2026-03-08T10:30:00.000Z');
    });

    it('Rejects nonexistent spring-forward local time without provider UTC', () => {
      expect(() => {
        resolveLocalWallTimeToUtc('2026-03-08', '02:30', 'America/Los_Angeles');
      }).toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Section 8: Final Ground Truth Issue 1 — Clear Stale Fields on Re-commercialization
  // =========================================================================
  describe('Final Ground Truth Issue 1: Clear stale source schedule fields on re-commercialization', () => {
    it('removes provider fields from ScheduleTemplate when absent in refreshed RouteRef while retaining Aptech commercial config', async () => {
      // 1. First commercialization with local times, duration, aircraft_icao, synced_at
      mockRouteRefs.set('airlabs_STALE_TEST', {
        source_key: 'airlabs_STALE_TEST',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN701',
        flight_number: '701',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        duration: 120,
        aircraft_icao: 'A21N',
        days: ['daily'],
        synced_at: new Date('2026-03-01T00:00:00.000Z'),
      });

      const initial = await commercialService.commercializeRoute({
        source_key: 'airlabs_STALE_TEST',
        aptech_flight_number: 'APT701',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      expect(initial.std_dep_time).toBe('08:00');
      expect(initial.std_arr_time).toBe('10:00');
      expect(initial.source_duration_minutes).toBe(120);
      expect(initial.source_aircraft_icao).toBe('A21N');
      expect(initial.source_synced_at).toBeDefined();

      // 2. Refreshed RouteRef: local dep/arr absent, duration absent, aircraft_icao absent, synced_at absent
      // Only dep_time_utc and arr_time_utc are now provided
      mockRouteRefs.set('airlabs_STALE_TEST', {
        source_key: 'airlabs_STALE_TEST',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN701',
        flight_number: '701',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time_utc: '01:00',
        arr_time_utc: '03:15',
        days: ['daily'],
      });

      const refreshed = await commercialService.commercializeRoute({
        source_key: 'airlabs_STALE_TEST',
        aptech_flight_number: 'APT701',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      // Assert stale fields are removed from the template
      expect(refreshed.std_dep_time).toBeUndefined();
      expect(refreshed.std_arr_time).toBeUndefined();
      expect(refreshed.source_duration_minutes).toBeUndefined();
      expect(refreshed.source_aircraft_icao).toBeUndefined();
      expect(refreshed.source_synced_at).toBeUndefined();

      // Assert new fields are set
      expect(refreshed.source_dep_time_utc).toBe('01:00');
      expect(refreshed.source_arr_time_utc).toBe('03:15');

      // Assert Aptech commercial fields remain intact
      expect(refreshed.flight_number).toBe('APT701');
      expect(refreshed.aircraft_type).toBe('A21N');
      expect(refreshed.cabin_classes).toBeDefined();
      expect(refreshed.commercial_inventories).toBeDefined();
      expect(refreshed.base_price_economy).toBe(1500000);
    });
  });

  // =========================================================================
  // Section 9: Final Ground Truth Issue 2 — Require Real Source Airline & Flight Identity
  // =========================================================================
  describe('Final Ground Truth Issue 2: Require real source airline & flight identity', () => {
    it('rejects RouteRef with missing airline identity (neither airline_iata nor airline_icao)', async () => {
      mockRouteRefs.set('airlabs_NO_AIRLINE', {
        source_key: 'airlabs_NO_AIRLINE',
        source: 'airlabs',
        flight_iata: 'XX123',
        flight_number: '123',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_NO_AIRLINE',
          aptech_flight_number: 'APT123',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow('Source data incomplete: missing source airline identity');
    });

    it('rejects RouteRef with missing flight identity (neither flight_iata, flight_icao, nor flight_number)', async () => {
      mockRouteRefs.set('airlabs_NO_FLIGHT', {
        source_key: 'airlabs_NO_FLIGHT',
        source: 'airlabs',
        airline_iata: 'VN',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_NO_FLIGHT',
          aptech_flight_number: 'APT124',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow('Source data incomplete: missing source flight identity');
    });

    it('accepts RouteRef with airline_icao and flight_number when IATA values are absent', async () => {
      mockRouteRefs.set('airlabs_ICAO_ONLY', {
        source_key: 'airlabs_ICAO_ONLY',
        source: 'airlabs',
        airline_icao: 'HVN',
        flight_number: '998',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_ICAO_ONLY',
        aptech_flight_number: 'APT998',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      expect(template.source_airline_icao).toBe('HVN');
      expect(template.source_flight_number).toBe('998');
      expect(template.source_service_key).toContain('HVN_998');
    });

    it('End-to-End ICAO-only source identity: persists source_flight_icao to ScheduleTemplate and concrete Flight', async () => {
      mockRouteRefs.set('airlabs_ICAO_ONLY_E2E', {
        source_key: 'airlabs_ICAO_ONLY_E2E',
        source: 'airlabs',
        airline_icao: 'HVN',
        flight_icao: 'HVN231',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        days: ['daily'],
        aircraft_icao: 'A21N',
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_ICAO_ONLY_E2E',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      // Verify on ScheduleTemplate
      expect(template.source_airline_icao).toBe('HVN');
      expect(template.source_flight_icao).toBe('HVN231');
      expect(template.source_flight_iata).toBeUndefined();
      expect(template.source_flight_number).toBeUndefined();

      // Materialize into concrete Flight
      await generatorService.generateForTemplate(template, '2026-10-01', 1);

      const flightKey = `${template.template_id}:2026-10-01`;
      const generatedFlight = mockFlights.get(flightKey);
      expect(generatedFlight).toBeDefined();
      expect(generatedFlight.source_airline_icao).toBe('HVN');
      expect(generatedFlight.source_flight_icao).toBe('HVN231');
      expect(generatedFlight.source_flight_iata).toBeUndefined();
      expect(generatedFlight.source_flight_number).toBeUndefined();
    });
  });

  // =========================================================================
  // Section 10: Final Ground Truth Issue 3 — Validate Source Time Formats & Consistency
  // =========================================================================
  describe('Final Ground Truth Issue 3: Validate source time formats & provider local/UTC consistency', () => {
    it('rejects malformed time format strings', async () => {
      mockRouteRefs.set('airlabs_MALFORMED_TIME', {
        source_key: 'airlabs_MALFORMED_TIME',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN555',
        flight_number: '555',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '25:70', // Invalid clock
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_MALFORMED_TIME',
          aptech_flight_number: 'APT555',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow('Source data invalid: malformed time format');
    });

    it('accepts consistent local and UTC departure/arrival times', async () => {
      // SGN is UTC+7 all year. 08:00 local = 01:00 UTC.
      // HAN is UTC+7 all year. 10:00 local = 03:00 UTC.
      mockRouteRefs.set('airlabs_CONSISTENT_TIMES', {
        source_key: 'airlabs_CONSISTENT_TIMES',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN556',
        flight_number: '556',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        dep_time_utc: '01:00',
        arr_time: '10:00',
        arr_time_utc: '03:00',
        days: ['daily'],
      });

      const template = await commercialService.commercializeRoute({
        source_key: 'airlabs_CONSISTENT_TIMES',
        aptech_flight_number: 'APT556',
        aircraft_type: 'A21N',
        base_price_economy: 1000000,
      });

      expect(template.std_dep_time).toBe('08:00');
      expect(template.source_dep_time_utc).toBe('01:00');
      expect(template.std_arr_time).toBe('10:00');
      expect(template.source_arr_time_utc).toBe('03:00');
    });

    it('rejects conflicting local and UTC departure times for the airport timezone', async () => {
      // SGN is UTC+7 all year. 08:00 local with 05:00 UTC is conflicting
      mockRouteRefs.set('airlabs_CONFLICTING_DEP', {
        source_key: 'airlabs_CONFLICTING_DEP',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN557',
        flight_number: '557',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        dep_time_utc: '05:00',
        arr_time: '10:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_CONFLICTING_DEP',
          aptech_flight_number: 'APT557',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow('Source data inconsistent: departure local time');
    });

    it('rejects conflicting local and UTC arrival times for the airport timezone', async () => {
      // HAN is UTC+7 all year. 10:00 local with 01:00 UTC is conflicting
      mockRouteRefs.set('airlabs_CONFLICTING_ARR', {
        source_key: 'airlabs_CONFLICTING_ARR',
        source: 'airlabs',
        airline_iata: 'VN',
        flight_iata: 'VN558',
        flight_number: '558',
        dep_iata: 'SGN',
        arr_iata: 'HAN',
        dep_time: '08:00',
        arr_time: '10:00',
        arr_time_utc: '01:00',
        days: ['daily'],
      });

      await expect(
        commercialService.commercializeRoute({
          source_key: 'airlabs_CONFLICTING_ARR',
          aptech_flight_number: 'APT558',
          aircraft_type: 'A21N',
          base_price_economy: 1000000,
        }),
      ).rejects.toThrow('Source data inconsistent: arrival local time');
    });
  });

  // =========================================================================
  // Section 11: Final Ground Truth Issue 4 — Restore Explicit Legacy Generator Regression
  // =========================================================================
  describe('Final Ground Truth Issue 4: Legacy synthetic generator regression invariant', () => {
    it('proves legacy APTECH_FLIGHT_TEMPLATES generator path remains intact producing operator=APTECH_AIRLINES and data_source=INTERNAL_GENERATED', async () => {
      // Setup legacy template in templateModel
      const legacyTemplate = {
        template_id: 'APT_LEGACY_001',
        flight_number: 'APT990',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        std_dep_time: '06:00',
        std_arr_time: '08:15',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        base_price_economy: 1200000,
        is_active: true,
        source_type: 'LEGACY_SYNTHETIC',
      };

      mockTemplates.set('APT_LEGACY_001', legacyTemplate);

      // Run generator for 1 day
      await generatorService.generateRollingSchedule('2026-09-25', 1);

      // Check generated flight records in mockFlights
      const generatedFlight = mockFlights.get('APT_LEGACY_001:2026-09-25');
      expect(generatedFlight).toBeDefined();
      expect(generatedFlight.operator).toBe('APTECH_AIRLINES');
      expect(generatedFlight.data_source).toBe('INTERNAL_GENERATED');
      expect(generatedFlight.generated_source).toBe('seed_schedule_330');
      expect(generatedFlight.is_bookable).toBe(true);
      expect(generatedFlight.is_generated).toBe(true);
      expect(generatedFlight.template_id).toBe('APT_LEGACY_001');
      expect(generatedFlight.flight_number).toBe('APT990');
    });
  });

  // =========================================================================
  // Section 12: Phase C1 ICAO Ingestion Identity End-to-End
  // =========================================================================
  describe('Phase C1 ICAO Ingestion Identity End-to-End', () => {
    it('commercializes and materializes an ICAO-only RouteRef preserving source_airline_icao and source_flight_icao', async () => {
      const icaoRecord = {
        source_key: 'AIRLABS_HVN_HVN231_HAN_SGN_L:08:00_D:mon',
        source: 'airlabs',
        airline_icao: 'HVN',
        flight_icao: 'HVN231',
        dep_iata: 'HAN',
        arr_iata: 'SGN',
        dep_time: '08:00',
        arr_time: '10:15',
        days: ['mon'],
        aircraft_icao: 'A21N',
      };
      mockRouteRefs.set(icaoRecord.source_key, icaoRecord);

      // Commercialize RouteRef
      const template = await commercialService.commercializeRoute({
        source_key: icaoRecord.source_key,
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
      });

      expect(template.source_airline_icao).toBe('HVN');
      expect(template.source_flight_icao).toBe('HVN231');
      expect(template.source_airline_iata).toBeUndefined();
      expect(template.source_flight_iata).toBeUndefined();
      expect(template.source_type).toBe('AIRLABS');

      // Materialize Template into Flights (Monday is 2026-09-28)
      await generatorService.generateForTemplate(template, '2026-09-28', 1);

      const flight = Array.from(mockFlights.values()).find((f) => f.template_id === template.template_id);
      expect(flight).toBeDefined();
      expect(flight.operator).toBe('APTECH_AIRLINES');
      expect(flight.data_source).toBe('AIRLABS_COMMERCIALIZED');
      expect(flight.source_airline_icao).toBe('HVN');
      expect(flight.source_flight_icao).toBe('HVN231');
      expect(flight.source_airline_iata).toBeUndefined();
      expect(flight.source_flight_iata).toBeUndefined();
      expect(flight.flight_number).toBe('APT231');
    });
  });
});
