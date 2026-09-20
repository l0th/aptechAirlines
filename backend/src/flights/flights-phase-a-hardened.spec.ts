import { BadRequestException } from '@nestjs/common';
import { FlightsService } from './flights.service';
import { CabinClass, FlightStatus } from './flights.schema';

describe('FlightsService - Phase A Hardened Automated Requirements Tests', () => {
  let service: FlightsService;
  let flightModel: any;
  let bookingModel: any;
  let airportsService: any;
  let referenceService: any;
  let usersService: any;

  beforeEach(() => {
    flightModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      findByIdAndDelete: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    };

    bookingModel = {
      exists: jest.fn(),
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    airportsService = {
      findByIata: jest.fn().mockImplementation((code: string) => {
        return Promise.resolve({
          iata_code: code,
          time_zone: 'Asia/Ho_Chi_Minh',
          airport_name: `${code} International Airport`,
          city_name: code,
        });
      }),
    };

    referenceService = {
      expandLocation: jest.fn().mockImplementation((loc: string) => {
        return Promise.resolve({
          query: loc,
          matched_type: 'AIRPORT',
          city_name: loc,
          iata_codes: [loc.toUpperCase()],
          is_single_airport: true,
        });
      }),
      findRouteNetworkConnections: jest.fn().mockResolvedValue([]),
    };

    usersService = {};

    service = new FlightsService(
      flightModel as any,
      bookingModel as any,
      airportsService as any,
      referenceService as any,
      usersService as any,
    );
  });

  describe('1. Safe Flight Deletion Guard & Active Booking Protection', () => {
    const flightId = '507f1f77bcf86cd799439011';

    it('rejects deletion with BadRequestException when active CONFIRMED bookings exist', async () => {
      flightModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: flightId,
          flight_number: 'APT101',
          origin_iata: 'HAN',
          dest_iata: 'SGN',
        }),
      });

      // Active booking exists
      bookingModel.exists.mockResolvedValue({ _id: 'bkg_001' });

      await expect(service.deleteFlight(flightId)).rejects.toThrow(BadRequestException);
      expect(flightModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('rejects deletion with BadRequestException when active BLOCKED bookings exist', async () => {
      flightModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: flightId,
          flight_number: 'APT102',
          origin_iata: 'HAN',
          dest_iata: 'DAD',
        }),
      });

      bookingModel.exists.mockResolvedValue({ _id: 'bkg_002' });

      await expect(service.deleteFlight(flightId)).rejects.toThrow(
        /Không thể xóa chuyến bay đã có hành khách giữ chỗ hoặc mua vé/,
      );
      expect(flightModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('allows safe deletion when only CANCELLED bookings exist (or zero active bookings)', async () => {
      flightModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: flightId,
          flight_number: 'APT103',
          origin_iata: 'HAN',
          dest_iata: 'PQC',
        }),
      });

      // Zero active bookings
      bookingModel.exists.mockResolvedValue(null);
      flightModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: flightId }),
      });

      const res = await service.deleteFlight(flightId);
      expect(res.message).toContain('Flight APT103');
      expect(res.flight._id).toBe(flightId);
      expect(flightModel.findByIdAndDelete).toHaveBeenCalledWith(flightId);
    });
  });

  describe('2. Aptech Bookability vs External Carrier Isolation', () => {
    it('direct flight search queries enforce is_bookable: true and operator: APTECH_AIRLINES', async () => {
      await (service as any).findDirectFlights(
        ['HAN'],
        ['SGN'],
        '2026-10-01',
        undefined,
        CabinClass.ECONOMY,
        false,
        1,
        1,
        0,
        0,
      );

      expect(flightModel.find).toHaveBeenCalled();
      const query = flightModel.find.mock.calls[0][0];
      expect(query.is_bookable).toBe(true);
      expect(query.operator).toBe('APTECH_AIRLINES');
    });

    it('seat map rejects external non-bookable flight with BadRequestException', async () => {
      const flightId = '507f1f77bcf86cd799439099';
      flightModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: flightId,
          flight_number: 'VN250',
          operator: 'VN',
          is_bookable: false,
          origin_iata: 'HAN',
          dest_iata: 'SGN',
        }),
      });

      await expect(service.getSeatMap(flightId)).rejects.toThrow(
        'Seat map is only available for bookable Aptech Airlines flights.',
      );
    });

    it('AirLabs sync strips inventories and marks is_bookable: false on external airline flights', async () => {
      let savedDoc: any = null;
      (service as any).flightModel = function (doc: any) {
        savedDoc = {
          ...doc,
          save: jest.fn().mockResolvedValue(doc),
        };
        return savedDoc;
      };
      (service as any).flightModel.findOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null), // New flight
      });

      const airLabsData = [
        {
          airline_iata: 'BA',
          flight_number: '118',
          dep_iata: 'LHR',
          arr_iata: 'CDG',
          dep_time: '2026-10-15 10:00',
          arr_time: '2026-10-15 12:15',
          status: 'scheduled',
        },
      ];

      process.env.AIRLABS_API_KEY = 'test_airlabs_api_key';
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ response: airLabsData }),
      });

      try {
        await service.syncFromAirLabs('airline', undefined, undefined, 'BA');
      } finally {
        delete process.env.AIRLABS_API_KEY;
      }

      expect(savedDoc).toBeDefined();
      expect(savedDoc.operator).toBe('BA');
      expect(savedDoc.is_bookable).toBe(false);
      expect(savedDoc.inventories).toEqual([]);
      expect(savedDoc.data_source).toBe('AIRLABS_EXTERNAL');
    });
  });

  describe('3. Nearby Availability Search Logic', () => {
    it('evaluates +-7 day window and returns aggregated available dates with price and direct indicator', async () => {
      const mockFlight = {
        _id: 'fl_001',
        flight_number: 'APT105',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        departure_date: '2026-10-05',
        scheduled_departure: new Date('2026-10-05T08:00:00+07:00'),
        scheduled_arrival: new Date('2026-10-05T10:15:00+07:00'),
        status: FlightStatus.SCHEDULED,
        distance_miles: 720,
        inventories: [
          {
            _id: 'inv_001',
            cabin_class: CabinClass.ECONOMY,
            available_seats: 50,
            base_price: 1500000,
          },
        ],
      };

      // Direct search returns 1 flight on 2026-10-05
      jest.spyOn(service as any, 'findDirectFlights').mockImplementation((_o: any, _d: any, date: string) => {
        if (date === '2026-10-05') {
          return Promise.resolve([
            {
              flight_id: 'fl_001',
              flight_number: 'APT105',
              total_party_price: 1500000,
              base_price_per_adult: 1500000,
              available_seats: 50,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await service.getNearbyAvailability('HAN', 'SGN', '2026-10-04', CabinClass.ECONOMY);

      expect(res.origin).toBe('HAN');
      expect(res.destination).toBe('SGN');
      expect(res.requested_date).toBe('2026-10-04');
      expect(res.available_dates.length).toBeGreaterThanOrEqual(1);

      const foundDate = res.available_dates.find((d) => d.date === '2026-10-05');
      expect(foundDate).toBeDefined();
      expect(foundDate!.has_direct).toBe(true);
      expect(foundDate!.min_price).toBe(1500000);
      expect(foundDate!.available_itineraries_count).toBe(1);
    });
  });

  describe('4. Multi-Hop Connecting Search & Layover Enforcement', () => {
    it('enforces connection layover window between 45 and 720 minutes', async () => {
      // Leg 1: HAN -> DAD arriving 10:00
      const leg1 = {
        _id: 'leg1_01',
        flight_number: 'APT501',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-10',
        scheduled_departure: new Date('2026-10-10T08:00:00+07:00'),
        scheduled_arrival: new Date('2026-10-10T10:00:00+07:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 20, base_price: 1000000 }],
      };

      // Leg 2 (Invalid layover: departs 10:20 -> 20 minutes layover < 45m minimum)
      const leg2Invalid = {
        _id: 'leg2_inv',
        flight_number: 'APT502',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-10',
        scheduled_departure: new Date('2026-10-10T10:20:00+07:00'),
        scheduled_arrival: new Date('2026-10-10T12:00:00+07:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 20, base_price: 1000000 }],
      };

      // Leg 2 (Valid layover: departs 11:30 -> 90 minutes layover [45, 720])
      const leg2Valid = {
        _id: 'leg2_val',
        flight_number: 'APT503',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-10',
        scheduled_departure: new Date('2026-10-10T11:30:00+07:00'),
        scheduled_arrival: new Date('2026-10-10T13:00:00+07:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 20, base_price: 1000000 }],
      };

      flightModel.find.mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) {
          return { exec: () => Promise.resolve([leg1]) };
        }
        if (origins.includes('DAD')) {
          return { exec: () => Promise.resolve([leg2Invalid, leg2Valid]) };
        }
        return { exec: () => Promise.resolve([]) };
      });

      const routes = await (service as any).findConnectingRoutes(
        ['HAN'],
        ['SGN'],
        '2026-10-10',
        1,
        1,
        0,
        0,
      );

      // Only the valid 90-minute layover route should be returned
      expect(routes.length).toBe(1);
      expect(routes[0].route_type).toBe('ONE_STOP');
      expect(routes[0].transit_airport).toBe('DAD');
      expect(routes[0].layover_minutes).toBe(90);
      expect(routes[0].legs[1].flight_number).toBe('APT503');
    });

    it('validates 2-stop connection for HAN -> JFK via HKG and LAX', async () => {
      // Leg 1: HAN -> HKG arriving 11:00
      const leg1 = {
        _id: 'leg1_hkg',
        flight_number: 'APT531',
        origin_iata: 'HAN',
        dest_iata: 'HKG',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T08:00:00+07:00'),
        scheduled_arrival: new Date('2026-10-15T11:00:00+08:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 3000000 }],
      };

      // Leg 2: HKG -> LAX departing 14:30 (layover1 = 210m), arriving 11:45
      const leg2 = {
        _id: 'leg2_lax',
        flight_number: 'APT901',
        origin_iata: 'HKG',
        dest_iata: 'LAX',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T14:30:00+08:00'),
        scheduled_arrival: new Date('2026-10-15T11:45:00-07:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 12000000 }],
      };

      // Leg 3: LAX -> JFK departing 14:00 (layover2 = 135m), arriving 22:30
      const leg3 = {
        _id: 'leg3_jfk',
        flight_number: 'APT951',
        origin_iata: 'LAX',
        dest_iata: 'JFK',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T14:00:00-07:00'),
        scheduled_arrival: new Date('2026-10-15T22:30:00-04:00'),
        status: FlightStatus.SCHEDULED,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
        inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 5000000 }],
      };

      flightModel.find.mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { exec: () => Promise.resolve([leg1]) };
        if (origins.includes('HKG')) return { exec: () => Promise.resolve([leg2]) };
        if (origins.includes('LAX')) return { exec: () => Promise.resolve([leg3]) };
        return { exec: () => Promise.resolve([]) };
      });

      const routes = await (service as any).findConnectingRoutes(
        ['HAN'],
        ['JFK'],
        '2026-10-15',
        1,
        1,
        0,
        0,
      );

      expect(routes.length).toBe(1);
      expect(routes[0].route_type).toBe('TWO_STOP');
      expect(routes[0].transit_airports).toEqual(['HKG', 'LAX']);
      expect(routes[0].layover_minutes).toEqual([210, 135]);
      expect(routes[0].legs.length).toBe(3);
      expect(routes[0].legs[0].flight_number).toBe('APT531');
      expect(routes[0].legs[1].flight_number).toBe('APT901');
      expect(routes[0].legs[2].flight_number).toBe('APT951');
    });
  });

  describe('5. Production Dependency Injection & Authoritative Customer Search', () => {
    const leg1 = {
      _id: 'leg1_di',
      flight_number: 'APT101',
      origin_iata: 'HAN',
      dest_iata: 'DAD',
      departure_date: '2026-11-01',
      scheduled_departure: new Date('2026-11-01T08:00:00+07:00'),
      scheduled_arrival: new Date('2026-11-01T09:30:00+07:00'),
      status: FlightStatus.SCHEDULED,
      is_bookable: true,
      operator: 'APTECH_AIRLINES',
      inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 15, base_price: 1200000 }],
    };

    const leg2 = {
      _id: 'leg2_di',
      flight_number: 'APT102',
      origin_iata: 'DAD',
      dest_iata: 'SGN',
      departure_date: '2026-11-01',
      scheduled_departure: new Date('2026-11-01T11:00:00+07:00'),
      scheduled_arrival: new Date('2026-11-01T12:30:00+07:00'),
      status: FlightStatus.SCHEDULED,
      is_bookable: true,
      operator: 'APTECH_AIRLINES',
      inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 15, base_price: 1200000 }],
    };

    beforeEach(() => {
      flightModel.find.mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { exec: () => Promise.resolve([leg1]) };
        if (origins.includes('DAD')) return { exec: () => Promise.resolve([leg2]) };
        return { exec: () => Promise.resolve([]) };
      });
    });

    it('constructs FlightsService WITH RouteGraphService and RouteScheduleValidatorService injected, verifying customer search executes database-driven engine', async () => {
      const mockRouteGraphService = {
        findPaths: jest.fn().mockResolvedValue({ paths: [] }),
      };
      const mockRouteScheduleValidatorService = {
        validatePaths: jest.fn().mockReturnValue({ itineraries: [], coverage: { complete: false } }),
      };

      // Construct with RouteGraph dependencies injected (as in production NestJS runtime)
      const diService = new FlightsService(
        flightModel as any,
        bookingModel as any,
        airportsService as any,
        referenceService as any,
        usersService as any,
        mockRouteGraphService as any,
        mockRouteScheduleValidatorService as any,
      );

      const routes = await (diService as any).findConnectingRoutes(
        ['HAN'],
        ['SGN'],
        '2026-11-01',
        1,
        1,
        0,
        0,
      );

      // Verifies customer search is authoritative, database-driven, and NOT blocked by empty AirLabs graph
      expect(routes.length).toBe(1);
      expect(routes[0].route_type).toBe('ONE_STOP');
      expect(routes[0].transit_airport).toBe('DAD');
      expect(routes[0].layover_minutes).toBe(90);
      expect(routes[0].legs[0].flight_number).toBe('APT101');
      expect(routes[0].legs[1].flight_number).toBe('APT102');
      // Verify RouteGraphService.findPaths was NOT called - customer connecting search uses the batched database engine directly
      expect(mockRouteGraphService.findPaths).not.toHaveBeenCalled();
      expect(mockRouteScheduleValidatorService.validatePaths).not.toHaveBeenCalled();
    });

    it('regression: proves RouteGraphService.findPaths is NOT required to return customer availability', async () => {
      // Create service without any graph services provided (undefined)
      const pureDbService = new FlightsService(
        flightModel as any,
        bookingModel as any,
        airportsService as any,
        referenceService as any,
        usersService as any,
        undefined,
        undefined,
      );

      const routes = await (pureDbService as any).findConnectingRoutes(
        ['HAN'],
        ['SGN'],
        '2026-11-01',
        1,
        1,
        0,
        0,
      );

      expect(routes.length).toBe(1);
      expect(routes[0].route_type).toBe('ONE_STOP');
      expect(routes[0].transit_airport).toBe('DAD');
      expect(routes[0].layover_minutes).toBe(90);
      expect(routes[0].legs[0].flight_number).toBe('APT101');
      expect(routes[0].legs[1].flight_number).toBe('APT102');
    });
  });
});
