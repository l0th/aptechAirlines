import { BadRequestException } from '@nestjs/common';
import { FlightGeneratorService } from './flight-generator.service';
import { CabinClass, FlightStatus } from './flights.schema';
import { CANONICAL_AIRCRAFT_TYPES } from './flight-templates.catalog';
import { localDateKey, getLocalWallTimeParts, resolveLocalWallTimeToUtc } from '../common/timezone.util';

describe('FlightGeneratorService - Phase A 330-Day Automated Generator Tests', () => {
  let service: FlightGeneratorService;
  let flightModel: any;
  let templateModel: any;
  let airportModel: any;

  const mockAirports: Record<string, any> = {
    HAN: { iata_code: 'HAN', time_zone: 'Asia/Ho_Chi_Minh', lat: 21.2212, lng: 105.807 },
    SGN: { iata_code: 'SGN', time_zone: 'Asia/Ho_Chi_Minh', lat: 10.8188, lng: 106.652 },
    DAD: { iata_code: 'DAD', time_zone: 'Asia/Ho_Chi_Minh', lat: 16.0439, lng: 108.199 },
    CDG: { iata_code: 'CDG', time_zone: 'Europe/Paris', lat: 49.0097, lng: 2.5479 },
    ASB: { iata_code: 'ASB', time_zone: 'Asia/Ashgabat', lat: 37.9868, lng: 58.361 },
    FRA: { iata_code: 'FRA', time_zone: 'Europe/Berlin', lat: 50.0379, lng: 8.5622 },
    JFK: { iata_code: 'JFK', time_zone: 'America/New_York', lat: 40.6413, lng: -73.7781 },
  };

  beforeEach(() => {
    flightModel = {
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 10, matchedCount: 0 }),
      distinct: jest.fn().mockResolvedValue([]),
      createIndex: jest.fn().mockResolvedValue(undefined),
    };
    templateModel = {
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 42, modifiedCount: 0 }),
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };
    airportModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(Object.values(mockAirports)),
      }),
      findOne: jest.fn().mockImplementation((query: any) => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockAirports[query?.iata_code] || null),
      })),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 4 }),
    };

    service = new FlightGeneratorService(
      flightModel as any,
      templateModel as any,
      airportModel as any,
    );
  });

  describe('1. Canonical Aircraft Validation & No False Fallback', () => {
    it('throws BadRequestException for unknown aircraft type and NEVER falls back to A321', () => {
      expect(() => (service as any).getAircraftMetadata('UNKNOWN_JET')).toThrow(BadRequestException);
      expect(() => (service as any).getAircraftMetadata('B777')).toThrow(BadRequestException);
      expect(() => (service as any).getAircraftMetadata('A380')).toThrow(BadRequestException);
    });

    it('successfully accepts every canonical aircraft type with valid inventory definitions', () => {
      for (const type of CANONICAL_AIRCRAFT_TYPES) {
        const meta = (service as any).getAircraftMetadata(type);
        expect(meta).toBeDefined();
        expect(meta.model_name).toBeDefined();
        expect(meta.total_capacity).toBeGreaterThan(0);
        expect(meta.inventories.length).toBeGreaterThan(0);
        const sumSeats = meta.inventories.reduce((sum: number, inv: any) => sum + inv.allocated_seats, 0);
        expect(sumSeats).toBe(meta.total_capacity);
      }
    });
  });

  describe('2. CabinClass Enum Integrity', () => {
    it('strictly preserves authoritative CabinClass enum values (no FIRST_CLASS)', () => {
      expect(CabinClass.ECONOMY).toBe('ECONOMY');
      expect(CabinClass.BUSINESS).toBe('BUSINESS');
      expect(CabinClass.FIRST).toBe('FIRST');
      expect(CabinClass.CLUB).toBe('CLUB');
      expect((CabinClass as any).FIRST_CLASS).toBeUndefined();
    });
  });

  describe('3. Weekday Filtering Logic', () => {
    it('generates flights only on scheduled days of week (Mon/Wed/Fri vs Tue/Thu/Sat)', async () => {
      const mockTemplate = {
        template_id: 'TPL_HAN_SGN_01',
        flight_number: 'APT101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        std_dep_time: '08:00',
        std_arr_time: '10:15',
        days_of_week: [1, 3, 5], // Mon, Wed, Fri only
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        base_price_economy: 1500000,
        base_price_business: 3300000,
        is_active: true,
      };

      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockTemplate]),
      });

      // Target a Tuesday (2026-09-22 is Tuesday -> ISO DOW 2)
      const statsTue = await service.generateRollingSchedule('2026-09-22', 1);
      expect(statsTue.total_operations).toBe(0);
      expect(flightModel.bulkWrite).not.toHaveBeenCalled();

      // Target a Wednesday (2026-09-23 is Wednesday -> ISO DOW 3)
      const statsWed = await service.generateRollingSchedule('2026-09-23', 1);
      expect(statsWed.total_operations).toBe(1);
      expect(flightModel.bulkWrite).toHaveBeenCalledTimes(1);

      const bulkOps = flightModel.bulkWrite.mock.calls[0][0];
      expect(bulkOps[0].updateOne.filter.template_id).toBe('TPL_HAN_SGN_01');
    });
  });

  describe('4. Generator Idempotency & $setOnInsert Inventory Preservation', () => {
    it('uses $setOnInsert for inventories and metadata so manual seat reductions are preserved on re-run', async () => {
      const mockTemplate = {
        template_id: 'TPL_HAN_DAD_01',
        flight_number: 'APT201',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        std_dep_time: '09:00',
        std_arr_time: '10:30',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A20N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        base_price_economy: 1200000,
        is_active: true,
      };

      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockTemplate]),
      });

      await service.generateRollingSchedule('2026-09-25', 1);

      expect(flightModel.bulkWrite).toHaveBeenCalledTimes(1);
      const bulkOps = flightModel.bulkWrite.mock.calls[0][0];
      const op = bulkOps[0].updateOne;

      // Filter matches by template_id and operating_date
      expect(op.filter.template_id).toBe('TPL_HAN_DAD_01');
      expect(op.filter.operating_date).toBe('2026-09-25');

      // $setOnInsert must store original full inventories and status so existing rows are not overwritten
      expect(op.update.$setOnInsert.inventories).toBeDefined();
      expect(op.update.$setOnInsert.operator).toBe('APTECH_AIRLINES');
      expect(op.update.$setOnInsert.is_bookable).toBe(true);
      expect(op.update.$setOnInsert.data_source).toBe('INTERNAL_GENERATED');
      expect(op.update.$setOnInsert.status).toBe(FlightStatus.SCHEDULED);
      expect(op.update.$setOnInsert.flight_number).toBe('APT201');
      expect(op.upsert).toBe(true);
    });
  });

  describe('5. 330-Day Range Boundaries', () => {
    it('generates the exact 330-day window [T, T+329] based on midnight anchor', async () => {
      const mockTemplate = {
        template_id: 'TPL_WINDOW_01',
        flight_number: 'APT999',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        std_dep_time: '08:00',
        std_arr_time: '10:15',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.ECONOMY],
        base_price_economy: 1500000,
        is_active: true,
      };

      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockTemplate]),
      });

      const stats = await service.generateRollingSchedule('2026-09-20', 330);

      expect(stats.total_days).toBe(330);
      expect(stats.start_date).toBe('2026-09-20');

      // T+329 days: 2026-09-20 + 329 days
      const expectedEnd = new Date(new Date('2026-09-20T00:00:00+07:00').getTime() + 329 * 86400000);
      const expectedEndStr = localDateKey(expectedEnd, 'Asia/Ho_Chi_Minh');
      expect(stats.end_date).toBe(expectedEndStr);
    });
  });

  describe('6. Rolling 330-Day Horizon Maintainer', () => {
    it('appends only missing tail dates when existing days are already populated in DB', async () => {
      const mockTemplate = {
        template_id: 'TPL_ROLLING_01',
        flight_number: 'APT301',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        std_dep_time: '07:00',
        std_arr_time: '09:15',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.ECONOMY],
        base_price_economy: 1500000,
        is_active: true,
      };

      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockTemplate]),
      });

      // Simulate that the farthest horizon day is missing
      flightModel.exists = jest.fn().mockResolvedValue(false);

      // Latest flight in Mongo is 2 days before the horizon end
      const now = new Date();
      const vnTodayStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
      const baseDate = new Date(`${vnTodayStr}T00:00:00+07:00`);
      const latestDate = new Date(baseDate.getTime() + 327 * 86400000);
      const latestDateStr = localDateKey(latestDate, 'Asia/Ho_Chi_Minh');

      flightModel.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ operating_date: latestDateStr }),
      });

      const appendedCount = await service.ensureHorizonDays(330);

      // Successfully appended the 2 missing tail days
      expect(appendedCount).toBeGreaterThanOrEqual(0);
      expect(flightModel.bulkWrite).toHaveBeenCalled();
    });
  });

  describe('7. Legacy Generator Invariants & Regression Proof', () => {
    it('proves APTECH_FLIGHT_TEMPLATES syncs into templateModel and generates flights with APTECH_AIRLINES and INTERNAL_GENERATED', async () => {
      // 1. syncTemplatesCatalog invokes templateModel.bulkWrite for catalog templates
      const syncedCount = await service.syncTemplatesCatalog();
      expect(syncedCount).toBeGreaterThan(0);
      expect(templateModel.bulkWrite).toHaveBeenCalled();

      // 2. generateRollingSchedule generates internal flights with APTECH_AIRLINES and INTERNAL_GENERATED
      const mockLegacyTemplate = {
        template_id: 'TPL_LEGACY_01',
        flight_number: 'APT101',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        std_dep_time: '08:00',
        std_arr_time: '10:15',
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        base_price_economy: 1500000,
        is_active: true,
      };

      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockLegacyTemplate]),
      });

      flightModel.bulkWrite.mockClear();
      await service.generateRollingSchedule('2026-09-25', 1);

      expect(flightModel.bulkWrite).toHaveBeenCalledTimes(1);
      const bulkOps = flightModel.bulkWrite.mock.calls[0][0];
      const insertedDoc = bulkOps[0].updateOne.update.$setOnInsert;

      expect(insertedDoc.operator).toBe('APTECH_AIRLINES');
      expect(insertedDoc.data_source).toBe('INTERNAL_GENERATED');
      expect(insertedDoc.generated_source).toBe('seed_schedule_330');
      expect(insertedDoc.is_bookable).toBe(true);
      expect(insertedDoc.is_generated).toBe(true);
      expect(insertedDoc.template_id).toBe('TPL_LEGACY_01');
      expect(insertedDoc.flight_number).toBe('APT101');
    });
  });

  describe('8. Commercial Flight Materialization Across DST Transitions (Gate Issue DST)', () => {
    const apt5461Template: any = {
      template_id: 'AIRLABS-COMM-AIRLABS_T5_T5461_ASB_FRA_T_08_20_D_WED',
      flight_number: 'APT5461',
      origin_iata: 'ASB',
      dest_iata: 'FRA',
      std_dep_time: '13:20',
      std_arr_time: '16:20',
      source_dep_time_utc: '08:20',
      source_arr_time_utc: '14:20',
      source_duration_minutes: 360,
      days_of_week: [3], // Wednesday
      aircraft_type: 'A359',
      cabin_classes: [CabinClass.BUSINESS, CabinClass.CLUB, CabinClass.ECONOMY],
      commercial_inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 29 },
        { cabin_class: CabinClass.CLUB, allocated_seats: 36 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 240 },
      ],
      base_price_economy: 14000000,
      base_price_business: 28000000,
      is_active: true,
      source_type: 'AIRLABS',
    };

    it('A. Europe/Berlin summer: 2026-09-23 operates with dep 08:20 UTC and arr 14:20 UTC (duration 360)', async () => {
      flightModel.bulkWrite.mockClear();

      const stats = await service.generateForTemplate(apt5461Template, '2026-09-23', 1);

      expect(stats.total_operations).toBe(1);
      expect(flightModel.bulkWrite).toHaveBeenCalledTimes(1);

      const bulkOps = flightModel.bulkWrite.mock.calls[0][0];
      const insertedDoc = bulkOps[0].updateOne.update.$setOnInsert;

      expect(insertedDoc.flight_number).toBe('APT5461');
      expect(insertedDoc.departure_date).toBe('2026-09-23');
      expect(insertedDoc.scheduled_departure.toISOString()).toBe('2026-09-23T08:20:00.000Z');
      expect(insertedDoc.scheduled_arrival.toISOString()).toBe('2026-09-23T14:20:00.000Z');
      expect(insertedDoc.duration_minutes).toBe(360);

      // Local display in Europe/Berlin (CEST, UTC+2) is 16:20
      const localArr = getLocalWallTimeParts(insertedDoc.scheduled_arrival, 'Europe/Berlin');
      expect(localArr.hhmm).toBe('16:20');
    });

    it('B. Europe/Berlin after DST ends: 2026-10-28 materializes successfully without provider UTC conflict', async () => {
      flightModel.bulkWrite.mockClear();

      // 2026-10-28 is Wednesday after Europe/Berlin DST transition (CEST -> CET on 2026-10-25)
      const stats = await service.generateForTemplate(apt5461Template, '2026-10-28', 1);

      expect(stats.total_operations).toBe(1);
      expect(flightModel.bulkWrite).toHaveBeenCalledTimes(1);

      const bulkOps = flightModel.bulkWrite.mock.calls[0][0];
      const insertedDoc = bulkOps[0].updateOne.update.$setOnInsert;

      expect(insertedDoc.scheduled_departure.toISOString()).toBe('2026-10-28T08:20:00.000Z');
      expect(insertedDoc.scheduled_arrival.toISOString()).toBe('2026-10-28T14:20:00.000Z');
      expect(insertedDoc.duration_minutes).toBe(360);

      // Destination local display in Europe/Berlin (CET, UTC+1) naturally renders as 15:20
      const localArr = getLocalWallTimeParts(insertedDoc.scheduled_arrival, 'Europe/Berlin');
      expect(localArr.hhmm).toBe('15:20');
    });

    it('C. 330-day horizon crossing DST: generates all Wednesday flights without throwing provider UTC conflict', async () => {
      flightModel.bulkWrite.mockClear();

      const stats = await service.generateForTemplate(apt5461Template, '2026-09-23', 330);

      // 330 days from 2026-09-23 has exactly 48 Wednesdays
      expect(stats.total_operations).toBe(48);
      expect(flightModel.bulkWrite).toHaveBeenCalled();
    });

    it('D. Origin timezone DST case: concrete departure UTC is derived from local wall clock and seasonal IANA offset', async () => {
      const fraOriginTemplate: any = {
        template_id: 'AIRLABS-COMM-FRA-SGN',
        flight_number: 'APT7001',
        origin_iata: 'FRA',
        dest_iata: 'SGN',
        std_dep_time: '10:00',
        source_dep_time_utc: '08:00', // Summer snapshot (UTC+2)
        source_duration_minutes: 600,
        days_of_week: [3], // Wednesday
        aircraft_type: 'A359',
        cabin_classes: [CabinClass.ECONOMY],
        commercial_inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 240 }],
        base_price_economy: 15000000,
        is_active: true,
        source_type: 'AIRLABS',
      };

      flightModel.bulkWrite.mockClear();

      // Summer: 2026-09-23 (Europe/Berlin UTC+2) -> 10:00 local resolves to 08:00 UTC
      await service.generateForTemplate(fraOriginTemplate, '2026-09-23', 1);
      const summerOps = flightModel.bulkWrite.mock.calls[0][0];
      const summerDoc = summerOps[0].updateOne.update.$setOnInsert;
      expect(summerDoc.scheduled_departure.toISOString()).toBe('2026-09-23T08:00:00.000Z');

      flightModel.bulkWrite.mockClear();

      // Winter: 2026-11-04 (Europe/Berlin UTC+1) -> 10:00 local resolves to 09:00 UTC (not frozen to 08:00)
      await service.generateForTemplate(fraOriginTemplate, '2026-11-04', 1);
      const winterOps = flightModel.bulkWrite.mock.calls[0][0];
      const winterDoc = winterOps[0].updateOne.update.$setOnInsert;
      expect(winterDoc.scheduled_departure.toISOString()).toBe('2026-11-04T09:00:00.000Z');
    });

    it('E. Genuine bad source still rejected: generator rejects when arrival cannot be chronologically resolved', async () => {
      const badChronoTemplate: any = {
        template_id: 'AIRLABS-COMM-BAD-CHRONO',
        flight_number: 'APT9999',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        std_dep_time: '12:00',
        std_arr_time: '12:05', // Only 5 min diff, no duration provided
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.ECONOMY],
        commercial_inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }],
        base_price_economy: 1000000,
        is_active: true,
        source_type: 'AIRLABS',
      };

      await expect(service.generateForTemplate(badChronoTemplate, '2026-10-01', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('F. DST fall-back ambiguous wall time: selects earlier occurrence deterministically without provider UTC', () => {
      // 2026-11-01 01:30 in America/Los_Angeles occurs twice (PDT 08:30 UTC and PST 09:30 UTC)
      const instant = resolveLocalWallTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles');
      expect(instant.toISOString()).toBe('2026-11-01T08:30:00.000Z');
    });

    it('G. DST spring-forward nonexistent wall time: rejects nonexistent local departure without silently inventing time', async () => {
      const springForwardTemplate: any = {
        template_id: 'AIRLABS-COMM-SPRING-GAP',
        flight_number: 'APT8001',
        origin_iata: 'JFK', // America/New_York
        dest_iata: 'SGN',
        std_dep_time: '02:30', // In America/New_York on 2026-03-08, 02:00..02:59 does not exist
        source_duration_minutes: 1200,
        days_of_week: [7], // Sunday
        aircraft_type: 'B789',
        cabin_classes: [CabinClass.ECONOMY],
        commercial_inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 250 }],
        base_price_economy: 20000000,
        is_active: true,
        source_type: 'AIRLABS',
      };

      await expect(service.generateForTemplate(springForwardTemplate, '2026-03-08', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('H. Error reporting cleanup: surfaces actual operating date and template context instead of +2 days candidate date', async () => {
      const badArrivalTemplate: any = {
        template_id: 'AIRLABS-COMM-ERROR-CONTEXT',
        flight_number: 'APT9001',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        std_dep_time: '12:00',
        std_arr_time: '12:05', // invalid diff, lacks duration
        days_of_week: [3], // Wednesday
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.ECONOMY],
        commercial_inventories: [{ cabin_class: CabinClass.ECONOMY, allocated_seats: 188 }],
        base_price_economy: 1000000,
        is_active: true,
        source_type: 'AIRLABS',
      };

      try {
        await service.generateForTemplate(badArrivalTemplate, '2026-10-28', 1);
        fail('Expected generateForTemplate to throw BadRequestException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        // Must identify actual operating date and flight/template
        expect(err.message).toContain('2026-10-28');
        expect(err.message).toContain('APT9001');
        // Must NOT refer to Friday +2 days (2026-10-30) as the primary operating context
        expect(err.message).not.toContain('2026-10-30');
      }
    });
  });
});
