import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/users.schema';
import { FlightsController } from './flights.controller';
import { AirlabsCommercialService } from './airlabs-commercial.service';
import {
  CommercializeRouteDto,
  UpdateCommercialTemplateDto,
} from './airlabs-commercial.dto';
import {
  CabinClass,
  FlightStatus,
  CUSTOMER_BOOKABLE_OPERATOR,
  CUSTOMER_BOOKABLE_DATA_SOURCE,
  getCustomerBookableFlightFilter,
  isCustomerBookableFlight,
} from './flights.schema';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';

describe('Phase C3.1: AirLabs Commercial Operations GUI Backend Contracts', () => {
  let controller: FlightsController;
  let commercialService: AirlabsCommercialService;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    commercialService = new AirlabsCommercialService(
      {} as any, // routeRefModel
      {} as any, // templateModel
      {} as any, // flightModel
      {} as any, // airportModel
      {} as any, // flightGeneratorService
      {} as any, // airportsService
    );
    controller = new FlightsController(
      {} as any, // flightsService
      {} as any, // flightGeneratorService
      commercialService,
    );
  });

  describe('1. GET /flights/commercial-aircraft-layouts & FLEET_LAYOUT_CATALOG', () => {
    it('returns all six authoritative fleet layouts from FLEET_LAYOUT_CATALOG', () => {
      const layouts = commercialService.getCommercialAircraftLayouts();
      expect(Array.isArray(layouts)).toBe(true);
      expect(layouts.length).toBe(6);

      const types = layouts.map((l) => l.aircraft_type).sort();
      expect(types).toEqual(['A20N', 'A21N', 'A359', 'AT76', 'B738', 'B789'].sort());
    });

    it('returns exact total capacities and cabin capacities matching FLEET_LAYOUT_CATALOG', () => {
      const layouts = commercialService.getCommercialAircraftLayouts();
      const byType = new Map(layouts.map((l) => [l.aircraft_type, l]));

      // A20N: BUSINESS 12, ECONOMY 168 (Total 180)
      const a20n = byType.get('A20N')!;
      expect(a20n.model_name).toBe('Airbus A320neo');
      expect(a20n.total_capacity).toBe(180);
      expect(a20n.cabin_capacities[CabinClass.BUSINESS]).toBe(12);
      expect(a20n.cabin_capacities[CabinClass.ECONOMY]).toBe(168);
      expect(a20n.supported_cabins).toEqual([CabinClass.BUSINESS, CabinClass.ECONOMY]);

      // A21N: BUSINESS 16, ECONOMY 188 (Total 204)
      const a21n = byType.get('A21N')!;
      expect(a21n.model_name).toBe('Airbus A321neo');
      expect(a21n.total_capacity).toBe(204);
      expect(a21n.cabin_capacities[CabinClass.BUSINESS]).toBe(16);
      expect(a21n.cabin_capacities[CabinClass.ECONOMY]).toBe(188);
      expect(a21n.supported_cabins).toEqual([CabinClass.BUSINESS, CabinClass.ECONOMY]);

      // B789: BUSINESS 28, CLUB 35, ECONOMY 231 (Total 294)
      const b789 = byType.get('B789')!;
      expect(b789.model_name).toBe('Boeing 787-9 Dreamliner');
      expect(b789.total_capacity).toBe(294);
      expect(b789.cabin_capacities[CabinClass.BUSINESS]).toBe(28);
      expect(b789.cabin_capacities[CabinClass.CLUB]).toBe(35);
      expect(b789.cabin_capacities[CabinClass.ECONOMY]).toBe(231);
      expect(b789.supported_cabins).toEqual([CabinClass.BUSINESS, CabinClass.CLUB, CabinClass.ECONOMY]);

      // A359: BUSINESS 29, CLUB 36, ECONOMY 240 (Total 305)
      const a359 = byType.get('A359')!;
      expect(a359.model_name).toBe('Airbus A350-900');
      expect(a359.total_capacity).toBe(305);
      expect(a359.cabin_capacities[CabinClass.BUSINESS]).toBe(29);
      expect(a359.cabin_capacities[CabinClass.CLUB]).toBe(36);
      expect(a359.cabin_capacities[CabinClass.ECONOMY]).toBe(240);
      expect(a359.supported_cabins).toEqual([CabinClass.BUSINESS, CabinClass.CLUB, CabinClass.ECONOMY]);

      // B738: BUSINESS 16, ECONOMY 150 (Total 166)
      const b738 = byType.get('B738')!;
      expect(b738.model_name).toBe('Boeing 737-800');
      expect(b738.total_capacity).toBe(166);
      expect(b738.cabin_capacities[CabinClass.BUSINESS]).toBe(16);
      expect(b738.cabin_capacities[CabinClass.ECONOMY]).toBe(150);
      expect(b738.supported_cabins).toEqual([CabinClass.BUSINESS, CabinClass.ECONOMY]);

      // AT76: ECONOMY 68 (Total 68)
      const at76 = byType.get('AT76')!;
      expect(at76.model_name).toBe('ATR 72-600');
      expect(at76.total_capacity).toBe(68);
      expect(at76.cabin_capacities[CabinClass.ECONOMY]).toBe(68);
      expect(at76.supported_cabins).toEqual([CabinClass.ECONOMY]);
    });

    it('proves FIRST cabin is ABSENT from all six current fleet layouts', () => {
      const layouts = commercialService.getCommercialAircraftLayouts();
      for (const layout of layouts) {
        expect(layout.supported_cabins).not.toContain(CabinClass.FIRST);
        expect(layout.cabin_capacities[CabinClass.FIRST]).toBeUndefined();
      }
    });

    it('does not send internal row definitions or seat maps in the layout endpoint response', () => {
      const layouts = commercialService.getCommercialAircraftLayouts();
      for (const layout of layouts) {
        expect((layout as any).rows).toBeUndefined();
        expect((layout as any).physical_seats).toBeUndefined();
      }
    });

    it('delegates through controller method to commercial service', async () => {
      const spy = jest.spyOn(commercialService, 'getCommercialAircraftLayouts');
      const res = await controller.getCommercialAircraftLayouts();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.length).toBe(6);
    });

    it('throws BadRequestException if airlabsCommercialService is unavailable', async () => {
      const brokenController = new FlightsController({} as any, {} as any, undefined);
      await expect(brokenController.getCommercialAircraftLayouts()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('2. Authorization Metadata on Commercial Aircraft Layout Endpoint', () => {
    it('is protected by JwtAuthGuard and RolesGuard', () => {
      const target = FlightsController.prototype.getCommercialAircraftLayouts;
      const guards = Reflect.getMetadata(GUARDS_METADATA, target);
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
    });

    it('requires ADMIN or SUPER_ADMIN role (ADMIN_ROLES)', () => {
      const target = FlightsController.prototype.getCommercialAircraftLayouts;
      const roles = Reflect.getMetadata(ROLES_KEY, target);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.ADMIN);
      expect(roles).toContain(UserRole.SUPER_ADMIN);
      expect(roles.length).toBe(2);
    });
  });

  describe('3. ValidationPipe Non-Whitelisted Properties Stripping Behavior', () => {
    let validationPipe: ValidationPipe;

    beforeEach(() => {
      validationPipe = new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      });
    });

    it('strips non-whitelisted properties (e.g. days_of_week, origin_iata, valid_from) from UpdateCommercialTemplateDto', async () => {
      const rawInput = {
        flight_number: 'APT999',
        aircraft_type: 'A21N',
        base_price_economy: 1500000,
        // Non-whitelisted fields that must be stripped:
        days_of_week: [1, 2, 3],
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        valid_from: '2026-09-01',
        valid_until: '2026-12-31',
        source_route_key: 'hacked_key',
        source_dep_time_utc: '00:00',
      };

      const transformed = (await validationPipe.transform(rawInput, {
        type: 'body',
        metatype: UpdateCommercialTemplateDto,
      })) as any;

      expect(transformed).toBeInstanceOf(UpdateCommercialTemplateDto);
      expect(transformed.flight_number).toBe('APT999');
      expect(transformed.aircraft_type).toBe('A21N');
      expect(transformed.base_price_economy).toBe(1500000);

      // Provenance and non-whitelisted fields MUST be stripped:
      expect(transformed.days_of_week).toBeUndefined();
      expect(transformed.origin_iata).toBeUndefined();
      expect(transformed.dest_iata).toBeUndefined();
      expect(transformed.valid_from).toBeUndefined();
      expect(transformed.valid_until).toBeUndefined();
      expect(transformed.source_route_key).toBeUndefined();
      expect(transformed.source_dep_time_utc).toBeUndefined();
    });

    it('strips non-whitelisted properties from CommercializeRouteDto', async () => {
      const rawInput = {
        source_key: 'VN_HAN_SGN_VN231',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A21N',
        base_price_economy: 1200000,
        // Non-whitelisted fields:
        operating_days: [1, 2, 3, 4, 5, 6, 7],
        valid_from: '2026-10-01',
        is_active: false,
      };

      const transformed = (await validationPipe.transform(rawInput, {
        type: 'body',
        metatype: CommercializeRouteDto,
      })) as any;

      expect(transformed).toBeInstanceOf(CommercializeRouteDto);
      expect(transformed.source_key).toBe('VN_HAN_SGN_VN231');
      expect(transformed.aptech_flight_number).toBe('APT231');
      expect(transformed.base_price_economy).toBe(1200000);

      expect(transformed.operating_days).toBeUndefined();
      expect(transformed.valid_from).toBeUndefined();
      expect(transformed.is_active).toBeUndefined();
    });
  });

  describe('4. DTO Validation Contract Details', () => {
    let validationPipe: ValidationPipe;

    beforeEach(() => {
      validationPipe = new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      });
    });

    it('validates aptech_flight_number pattern ^APT[A-Z0-9]+$', async () => {
      const valid = {
        source_key: 'KEY_1',
        aptech_flight_number: 'APT231',
        aircraft_type: 'A20N',
        base_price_economy: 1000000,
      };
      await expect(
        validationPipe.transform(valid, { type: 'body', metatype: CommercializeRouteDto }),
      ).resolves.toBeDefined();

      const invalidPrefix = {
        source_key: 'KEY_1',
        aptech_flight_number: 'VN231', // missing APT prefix
        aircraft_type: 'A20N',
        base_price_economy: 1000000,
      };
      await expect(
        validationPipe.transform(invalidPrefix, { type: 'body', metatype: CommercializeRouteDto }),
      ).rejects.toThrow();

      const invalidChars = {
        source_key: 'KEY_1',
        aptech_flight_number: 'APT-231', // hyphen not allowed
        aircraft_type: 'A20N',
        base_price_economy: 1000000,
      };
      await expect(
        validationPipe.transform(invalidChars, { type: 'body', metatype: CommercializeRouteDto }),
      ).rejects.toThrow();
    });

    it('accepts base_price_economy >= 0 as a valid finite number', async () => {
      const zeroPrice = {
        source_key: 'KEY_1',
        aptech_flight_number: 'APT100',
        aircraft_type: 'A20N',
        base_price_economy: 0,
      };
      await expect(
        validationPipe.transform(zeroPrice, { type: 'body', metatype: CommercializeRouteDto }),
      ).resolves.toBeDefined();

      const negativePrice = {
        source_key: 'KEY_1',
        aptech_flight_number: 'APT100',
        aircraft_type: 'A20N',
        base_price_economy: -50,
      };
      await expect(
        validationPipe.transform(negativePrice, { type: 'body', metatype: CommercializeRouteDto }),
      ).rejects.toThrow();
    });
  });

  describe('5. Preservation of Customer Transaction Invariant (Phase C2 Ground Truth)', () => {
    it('getCustomerBookableFlightFilter() enforces operator, is_bookable, data_source and non-cancelled status', () => {
      const filter = getCustomerBookableFlightFilter();
      expect(filter).toEqual({
        operator: CUSTOMER_BOOKABLE_OPERATOR,
        is_bookable: true,
        data_source: CUSTOMER_BOOKABLE_DATA_SOURCE,
        status: { $ne: FlightStatus.CANCELLED },
      });
      expect(CUSTOMER_BOOKABLE_OPERATOR).toBe('APTECH_AIRLINES');
      expect(CUSTOMER_BOOKABLE_DATA_SOURCE).toBe('AIRLABS_COMMERCIALIZED');
    });

    it('isCustomerBookableFlight() strictly validates the four invariant criteria', () => {
      expect(
        isCustomerBookableFlight({
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          data_source: 'AIRLABS_COMMERCIALIZED',
          status: FlightStatus.SCHEDULED,
        }),
      ).toBe(true);

      // AIRLABS_EXTERNAL is not customer bookable
      expect(
        isCustomerBookableFlight({
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          data_source: 'AIRLABS_EXTERNAL',
          status: FlightStatus.SCHEDULED,
        }),
      ).toBe(false);

      // INTERNAL_GENERATED is not customer bookable
      expect(
        isCustomerBookableFlight({
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          data_source: 'INTERNAL_GENERATED',
          status: FlightStatus.SCHEDULED,
        }),
      ).toBe(false);

      // Cancelled flight is not customer bookable
      expect(
        isCustomerBookableFlight({
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          data_source: 'AIRLABS_COMMERCIALIZED',
          status: FlightStatus.CANCELLED,
        }),
      ).toBe(false);
    });
  });

  describe('4. Nullable Premium Base Price & Fallback Semantics (Phase C3.1 Final Fix Pass)', () => {
    let validationPipe: ValidationPipe;

    beforeEach(() => {
      validationPipe = new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      });
    });

    it('allows null for base_price_business, base_price_club, base_price_first in UpdateCommercialTemplateDto', async () => {
      const validWithNull = {
        base_price_business: null,
        base_price_club: null,
        base_price_first: null,
      };

      const transformed = (await validationPipe.transform(validWithNull, {
        type: 'body',
        metatype: UpdateCommercialTemplateDto,
      })) as UpdateCommercialTemplateDto;

      expect(transformed.base_price_business).toBeNull();
      expect(transformed.base_price_club).toBeNull();
      expect(transformed.base_price_first).toBeNull();
    });

    it('rejects null for base_price_economy in UpdateCommercialTemplateDto', async () => {
      const invalidEconomy = {
        base_price_economy: null,
      };

      await expect(
        validationPipe.transform(invalidEconomy, {
          type: 'body',
          metatype: UpdateCommercialTemplateDto,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears persisted explicit premium price when updateCommercialTemplate receives null', async () => {
      const templateDoc: any = {
        template_id: 'APT-HAN-SGN-01',
        source_type: 'AIRLABS',
        aircraft_type: 'A21N',
        cabin_classes: [CabinClass.BUSINESS, CabinClass.ECONOMY],
        base_price_economy: 1500000,
        base_price_business: 3000000,
        commercial_inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 12 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 160 },
        ],
        set: jest.fn(function (k: string, v: any) {
          if (v === undefined) {
            delete this[k];
          } else {
            this[k] = v;
          }
          return this;
        }),
        save: jest.fn().mockResolvedValue(true),
      };

      const mockTemplateModel: any = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(templateDoc),
        }),
      };

      const testCommercialService = new AirlabsCommercialService(
        {} as any,
        mockTemplateModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const result = await testCommercialService.updateCommercialTemplate('APT-HAN-SGN-01', {
        base_price_business: null,
      });

      expect(templateDoc.set).toHaveBeenCalledWith('base_price_business', undefined);
      expect(result.base_price_business).toBeUndefined();
      expect(templateDoc.save).toHaveBeenCalled();
    });
  });
});
