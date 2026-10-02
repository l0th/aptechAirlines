import { FlightsService } from './flights.service';
import { FlightsController } from './flights.controller';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/users.schema';

describe('Admin Commercial Network Discovery (Phase C3.1+ Invariants)', () => {
  let service: FlightsService;
  let controller: FlightsController;
  let flightModel: any;
  let bookingModel: any;
  let airportsService: any;
  let referenceService: any;
  let usersService: any;
  let routeGraphService: any;
  let routeScheduleValidatorService: any;

  beforeEach(() => {
    flightModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn(),
      insertMany: jest.fn(),
    };

    bookingModel = {
      find: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    airportsService = {
      findByIata: jest.fn().mockImplementation((iata: string) =>
        Promise.resolve({
          iata_code: iata,
          city_name: iata + '_City',
          country_code: 'VN',
          time_zone: 'Asia/Ho_Chi_Minh',
        }),
      ),
    };

    referenceService = {
      expandLocation: jest.fn().mockImplementation((loc: string, options?: { includeUnserviced?: boolean }) => {
        const upper = (loc || '').trim().toUpperCase();
        if (upper === 'INVALID_LOC') {
          return Promise.resolve({ iata_codes: [], matched_kind: 'none', label: '', using_nearest_airport: false });
        }
        if (upper === 'GERMANY') {
          return Promise.resolve({ iata_codes: ['FRA', 'MUC', 'BER'], matched_kind: 'country', label: 'Germany', using_nearest_airport: false });
        }
        return Promise.resolve({
          iata_codes: [upper],
          matched_kind: 'airport',
          label: upper,
          using_nearest_airport: false,
        });
      }),
      ensureRoutesForAirport: jest.fn().mockResolvedValue({ complete: true, routes: [] }),
      ensureRoutesForPair: jest.fn().mockResolvedValue({
        from_cache: true,
        stale: false,
        count: 0,
        routes: [],
      }),
      findRouteNetworkConnections: jest.fn().mockResolvedValue([]),
    };

    usersService = {};

    routeGraphService = {
      findPaths: jest.fn().mockResolvedValue({
        paths: [
          {
            route_type: 'ONE_STOP',
            airports: ['SGN', 'MCT', 'FRA'],
            stops: ['MCT'],
            legs: [
              {
                source_key: 'WY_SGN_MCT_1',
                airline_iata: 'WY',
                flight_number: 'WY501',
                dep_iata: 'SGN',
                arr_iata: 'MCT',
                days: ['1', '2', '3', '4', '5', '6', '7'],
                dep_time_local: '07:30',
                arr_time_local: '12:10',
                duration_minutes: 340,
                aircraft_icao: 'B789',
              },
              {
                source_key: 'WY_MCT_FRA_1',
                airline_iata: 'WY',
                flight_number: 'WY502',
                dep_iata: 'MCT',
                arr_iata: 'FRA',
                days: ['1', '2', '3', '4', '5', '6', '7'],
                dep_time_local: '14:25',
                arr_time_local: '19:10',
                duration_minutes: 405,
                aircraft_icao: 'B789',
              },
            ],
          },
        ],
        coverage: {
          complete: true,
          expanded_airports: ['SGN', 'MCT'],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      }),
    };

    routeScheduleValidatorService = {
      validatePaths: jest.fn().mockImplementation((graphResult: any) => ({
        itineraries: graphResult.paths.map((p: any) => ({
          ...p,
          total_duration_minutes: 880,
          layover_minutes: [135],
          legs: p.legs.map((l: any) => ({
            ...l,
            dep_datetime: new Date('2026-10-15T07:30:00Z'),
            arr_datetime: new Date('2026-10-15T12:10:00Z'),
          })),
        })),
        coverage: graphResult.coverage,
      })),
    };

    service = new FlightsService(
      flightModel,
      bookingModel,
      airportsService,
      referenceService,
      usersService,
      routeGraphService,
      routeScheduleValidatorService,
    );

    controller = new FlightsController(service);
  });

  // 1. commercial-network-discovery endpoint is Admin protected
  it('1. commercial-network-discovery endpoint has JwtAuthGuard, RolesGuard and ADMIN/SUPER_ADMIN roles', () => {
    const guards = Reflect.getMetadata('__guards__', FlightsController.prototype.discoverCommercialNetwork);
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);

    const roles = Reflect.getMetadata('roles', FlightsController.prototype.discoverCommercialNetwork);
    expect(roles).toBeDefined();
    expect(roles).toContain(UserRole.ADMIN);
    expect(roles).toContain(UserRole.SUPER_ADMIN);
  });

  // 2. origin/destination are resolved through ReferenceService with includeUnserviced: true
  it('2. origin/destination are resolved through ReferenceService with includeUnserviced: true', async () => {
    const result = await service.discoverCommercialNetwork({
      origin: 'Germany',
      destination: 'SGN',
      departure_date: '2026-10-15',
    });

    expect(referenceService.expandLocation).toHaveBeenCalledWith('Germany', { includeUnserviced: true });
    expect(referenceService.expandLocation).toHaveBeenCalledWith('SGN', { includeUnserviced: true });
    expect(result.origin_scope.query).toBe('Germany');
    expect(result.origin_scope.iata_codes).toEqual(['FRA', 'MUC', 'BER']);
    expect(result.destination_scope.query).toBe('SGN');
    expect(result.destination_scope.iata_codes).toEqual(['SGN']);
  });

  // 3. max_stops accepts 0, 1, 2 and rejects values outside range
  it('3. max_stops accepts 0, 1, 2 and rejects values outside 0..2', async () => {
    // Valid values
    for (const validStops of [0, 1, 2]) {
      const res = await service.discoverCommercialNetwork({
        origin: 'SGN',
        destination: 'FRA',
        departure_date: '2026-10-15',
        max_stops: validStops,
      });
      expect(res.max_stops).toBe(validStops);
    }

    // Invalid values
    await expect(
      service.discoverCommercialNetwork({
        origin: 'SGN',
        destination: 'FRA',
        departure_date: '2026-10-15',
        max_stops: -1,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.discoverCommercialNetwork({
        origin: 'SGN',
        destination: 'FRA',
        departure_date: '2026-10-15',
        max_stops: 3,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 4. discoverNetworkRoutes default remains 2 when customer search calls it without maxStops
  it('4. discoverNetworkRoutes default remains 2 when called without maxStops', async () => {
    await service.discoverNetworkRoutes(['SGN'], ['FRA'], '2026-10-15');
    expect(routeGraphService.findPaths).toHaveBeenCalledWith(
      ['SGN'],
      ['FRA'],
      expect.objectContaining({ maxStops: 2 }),
    );
  });

  // 5. maxStops is passed to RouteGraphService.findPaths
  it('5. maxStops (e.g. 1) is passed to RouteGraphService.findPaths', async () => {
    await service.discoverNetworkRoutes(['SGN'], ['FRA'], '2026-10-15', 1);
    expect(routeGraphService.findPaths).toHaveBeenCalledWith(
      ['SGN'],
      ['FRA'],
      expect.objectContaining({ maxStops: 1 }),
    );
  });

  // 6. on-demand expansion remains bounded at maximum 8 airports
  it('6. on-demand expansion remains bounded at maximum 8 airports', async () => {
    let callCount = 0;
    routeGraphService.findPaths.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        paths: [],
        coverage: {
          complete: false,
          expanded_airports: [],
          incomplete_airports: ['HUB_' + callCount],
          missing_sync_state_airports: ['HUB_' + callCount],
        },
      });
    });

    await service.discoverNetworkRoutes(['SGN'], ['FRA'], '2026-10-15');
    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(8);
  });

  // 7. FOUND returns validated itinerary source keys and adheres to authoritative contract
  it('7. FOUND returns validated itinerary source keys and adheres to authoritative contract', async () => {
    const res = await service.discoverCommercialNetwork({
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
      max_stops: 1,
    });

    expect(res.origin_scope).toBeDefined();
    expect(res.origin_scope.query).toBe('SGN');
    expect(res.origin_scope.iata_codes).toEqual(['SGN']);
    expect(res.destination_scope).toBeDefined();
    expect(res.destination_scope.query).toBe('FRA');
    expect(res.destination_scope.iata_codes).toEqual(['FRA']);
    expect(res.departure_date).toBe('2026-10-15');
    expect(res.max_stops).toBe(1);
    expect(res.coverage.complete).toBe(true);
    expect(res.coverage.expanded_airports).toEqual(['SGN', 'MCT']);

    expect(res.status).toBe('FOUND');
    expect(res.itineraries.length).toBeGreaterThan(0);
    const firstItin = res.itineraries[0];
    expect(firstItin.route_type).toBe('ONE_STOP');
    expect(firstItin.airports).toEqual(['SGN', 'MCT', 'FRA']);
    expect(firstItin.stops).toEqual(['MCT']);
    expect(firstItin.legs[0].source_key).toBe('WY_SGN_MCT_1');
    expect(firstItin.legs[1].source_key).toBe('WY_MCT_FRA_1');
  });

  // 8. NO_ROUTE_FOUND is distinct from NETWORK_DATA_INCOMPLETE
  it('8. NO_ROUTE_FOUND is returned when graph coverage is complete but no valid paths exist', async () => {
    routeGraphService.findPaths.mockResolvedValue({
      paths: [],
      coverage: {
        complete: true,
        expanded_airports: ['SGN', 'FRA'],
        incomplete_airports: [],
        missing_sync_state_airports: [],
      },
    });

    const res = await service.discoverCommercialNetwork({
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
    });

    expect(res.status).toBe('NO_ROUTE_FOUND');
    expect(res.itineraries).toEqual([]);
  });

  it('8b. NETWORK_DATA_INCOMPLETE is returned when graph coverage is incomplete after search', async () => {
    routeGraphService.findPaths.mockResolvedValue({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN'],
        incomplete_airports: [],
        missing_sync_state_airports: [],
      },
    });

    const res = await service.discoverCommercialNetwork({
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
    });

    expect(res.status).toBe('NETWORK_DATA_INCOMPLETE');
    expect(res.itineraries).toEqual([]);
  });

  // 9. network discovery does NOT create Flight records
  it('9. network discovery does NOT create Flight records', async () => {
    await service.discoverCommercialNetwork({
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
    });

    expect(flightModel.create).not.toHaveBeenCalled();
    expect(flightModel.insertMany).not.toHaveBeenCalled();
  });

  // 10. network discovery does NOT create ScheduleTemplates
  it('10. network discovery returns unbookable source network data without creating templates', async () => {
    const res = await service.discoverCommercialNetwork({
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
    });

    expect(res.itineraries[0].is_bookable).toBe(false);
    expect(res.itineraries[0].inventories).toEqual([]);
    expect(res.itineraries[0].legs[0].is_bookable).toBe(false);
  });

  // 11. existing C2 customer filter remains unchanged
  it('11. customer bookable filter enforces operator=APTECH_AIRLINES and data_source=AIRLABS_COMMERCIALIZED', () => {
    const filter = require('./flights.schema').getCustomerBookableFlightFilter();
    expect(filter.operator).toBe('APTECH_AIRLINES');
    expect(filter.data_source).toBe('AIRLABS_COMMERCIALIZED');
    expect(filter.is_bookable).toBe(true);
    expect(filter.status).toEqual({ $ne: 'CANCELLED' });
  });

  // 12. controller delegation
  it('12. controller correctly delegates commercial-network-discovery to FlightsService', async () => {
    const spy = jest.spyOn(service, 'discoverCommercialNetwork');
    const dto = {
      origin: 'SGN',
      destination: 'FRA',
      departure_date: '2026-10-15',
      max_stops: 1,
    };
    await controller.discoverCommercialNetwork(dto);
    expect(spy).toHaveBeenCalledWith(dto);
  });
});
