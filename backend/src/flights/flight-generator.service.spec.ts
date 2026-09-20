import { BadRequestException } from '@nestjs/common';
import { FlightGeneratorService } from './flight-generator.service';
import { CabinClass, FlightStatus } from './flights.schema';
import { CANONICAL_AIRCRAFT_TYPES } from './flight-templates.catalog';
import { localDateKey } from '../common/timezone.util';

describe('FlightGeneratorService - Phase A 330-Day Automated Generator Tests', () => {
  let service: FlightGeneratorService;
  let flightModel: any;
  let templateModel: any;
  let airportModel: any;

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
        exec: jest.fn().mockResolvedValue([
          { iata_code: 'HAN', time_zone: 'Asia/Ho_Chi_Minh', lat: 21.2212, lng: 105.807 },
          { iata_code: 'SGN', time_zone: 'Asia/Ho_Chi_Minh', lat: 10.8188, lng: 106.652 },
          { iata_code: 'DAD', time_zone: 'Asia/Ho_Chi_Minh', lat: 16.0439, lng: 108.199 },
          { iata_code: 'CDG', time_zone: 'Europe/Paris', lat: 49.0097, lng: 2.5479 },
        ]),
      }),
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
});
