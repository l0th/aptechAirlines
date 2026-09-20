import { FlightsService } from './flights.service';
import { FlightStatus, CabinClass } from './flights.schema';
import { RouteGraphCoverage, RouteGraphPath, RouteGraphResult } from '../reference/route-graph.service';
import { ValidatedItinerary } from '../reference/route-schedule-validator.service';
import { BadRequestException } from '@nestjs/common';

describe('FlightsService - Network Discovery Fallback (16 Mandatory Invariants)', () => {
  let service: FlightsService;
  let flightModel: any;
  let bookingModel: any;
  let airportsService: any;
  let referenceService: any;
  let usersService: any;
  let routeGraphService: any;
  let routeScheduleValidatorService: any;

  beforeEach(() => {
    flightModel = {
      find: jest.fn().mockImplementation(() => ({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })),
      findOne: jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(null),
      })),
      distinct: jest.fn().mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue([]),
      })),
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
      resolveCity: jest.fn().mockResolvedValue({ exactMatches: [] }),
    };

    referenceService = {
      expandLocation: jest.fn().mockImplementation((loc: string) =>
        Promise.resolve({
          iata_codes: [loc.toUpperCase()],
          matched_kind: 'airport',
          label: loc.toUpperCase(),
          using_nearest_airport: false,
        }),
      ),
      findRouteNetworkConnections: jest.fn().mockResolvedValue([]),
      ensureRoutesForAirport: jest.fn().mockResolvedValue({
        from_cache: true,
        complete: true,
        stale: false,
        routes: [],
      }),
    };

    usersService = {
      deductMiles: jest.fn(),
      addMiles: jest.fn(),
    };

    routeGraphService = {
      findPaths: jest.fn().mockResolvedValue({
        paths: [],
        coverage: {
          complete: true,
          expanded_airports: ['HAN'],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      }),
    };

    routeScheduleValidatorService = {
      validatePaths: jest.fn().mockReturnValue({
        itineraries: [],
        coverage: {
          complete: true,
          expanded_airports: ['HAN'],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      }),
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
  });

  // =========================================================================
  // Case 1: Concrete direct exists -> graph fallback is NOT called
  // =========================================================================
  it('1. Concrete direct exists -> graph fallback is NOT called', async () => {
    const directFlight = {
      _id: 'df1',
      flight_number: 'APT101',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      departure_date: '2026-10-01',
      scheduled_departure: new Date('2026-10-01T08:00:00Z'),
      scheduled_arrival: new Date('2026-10-01T10:15:00Z'),
      duration_minutes: 135,
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      status: FlightStatus.SCHEDULED,
      inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 1500000 }],
    };

    flightModel.find.mockImplementation((query: any) => {
      if (query.origin_iata?.$in?.includes('SGN') && query.dest_iata?.$in?.includes('HAN')) {
        return {
          sort: () => ({ exec: () => Promise.resolve([directFlight]) }),
          exec: () => Promise.resolve([directFlight]),
        };
      }
      return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
    });

    const res = await service.searchFlights({
      origin: 'SGN',
      destination: 'HAN',
      departure_date: '2026-10-01',
    });

    expect(res.onward_flights.length).toBe(1);
    expect(routeGraphService.findPaths).not.toHaveBeenCalled();
    expect(res.network_status).toBeUndefined();
    expect(res.network_itineraries).toBeUndefined();
  });

  // =========================================================================
  // Case 2: Concrete connecting exists -> graph fallback is NOT called
  // =========================================================================
  it('2. Concrete connecting exists -> graph fallback is NOT called', async () => {
    const leg1 = {
      _id: 'c1',
      flight_number: 'APT201',
      origin_iata: 'SGN',
      dest_iata: 'DAD',
      departure_date: '2026-10-01',
      scheduled_departure: new Date('2026-10-01T08:00:00Z'),
      scheduled_arrival: new Date('2026-10-01T09:15:00Z'),
      duration_minutes: 75,
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      status: FlightStatus.SCHEDULED,
      inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 5, base_price: 800000 }],
    };
    const leg2 = {
      _id: 'c2',
      flight_number: 'APT202',
      origin_iata: 'DAD',
      dest_iata: 'HAN',
      departure_date: '2026-10-01',
      scheduled_departure: new Date('2026-10-01T10:30:00Z'),
      scheduled_arrival: new Date('2026-10-01T11:45:00Z'),
      duration_minutes: 75,
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      status: FlightStatus.SCHEDULED,
      inventories: [{ cabin_class: CabinClass.ECONOMY, available_seats: 5, base_price: 900000 }],
    };

    flightModel.find.mockImplementation((query: any) => {
      const origins = Array.isArray(query.origin_iata?.$in)
        ? query.origin_iata.$in
        : typeof query.origin_iata === 'string'
          ? [query.origin_iata]
          : [];
      if (origins.includes('SGN') && query.dest_iata?.$in?.includes('HAN')) {
        // Direct query returns empty
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      }
      if (origins.includes('SGN')) {
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg1]) };
      }
      if (origins.includes('DAD')) {
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg2]) };
      }
      return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
    });

    const res = await service.searchFlights({
      origin: 'SGN',
      destination: 'HAN',
      departure_date: '2026-10-01',
    });

    expect(res.connecting_routes!.length).toBe(1);
    expect(routeGraphService.findPaths).not.toHaveBeenCalled();
    expect(res.network_status).toBeUndefined();
  });

  // =========================================================================
  // Case 3: Concrete DB empty + fresh RouteRef cache -> graph works, zero external HTTP calls
  // =========================================================================
  it('3. Concrete DB empty + fresh RouteRef cache -> graph works, zero external HTTP calls', async () => {
    // DB returns 0 flights
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const mockCoverage: RouteGraphCoverage = {
      complete: true,
      expanded_airports: ['SGN', 'NRT'],
      incomplete_airports: [],
      missing_sync_state_airports: [],
    };

    const mockPath: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      legs: [
        {
          dep_iata: 'SGN',
          arr_iata: 'NRT',
          services: [
            {
              source_key: 'AIRLABS_JL_JL752_SGN_NRT',
              airline_iata: 'JL',
              dep_iata: 'SGN',
              arr_iata: 'NRT',
              dep_time: '08:00',
              arr_time: '16:00',
              has_schedule: true,
              source: 'airlabs',
            },
          ],
        },
        {
          dep_iata: 'NRT',
          arr_iata: 'LAX',
          services: [
            {
              source_key: 'AIRLABS_JL_JL062_NRT_LAX',
              airline_iata: 'JL',
              dep_iata: 'NRT',
              arr_iata: 'LAX',
              dep_time: '18:00',
              arr_time: '12:00',
              has_schedule: true,
              source: 'airlabs',
            },
          ],
        },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [mockPath],
      coverage: mockCoverage,
    });

    const mockValidatedItin: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 840,
      layover_minutes: [120],
      legs: [
        {
          airline_iata: 'JL',
          dep_iata: 'SGN',
          arr_iata: 'NRT',
          dep_datetime: new Date('2026-10-01T08:00:00Z'),
          arr_datetime: new Date('2026-10-01T16:00:00Z'),
          duration_minutes: 480,
          source_key: 'AIRLABS_JL_JL752_SGN_NRT',
        },
        {
          airline_iata: 'JL',
          dep_iata: 'NRT',
          arr_iata: 'LAX',
          dep_datetime: new Date('2026-10-01T18:00:00Z'),
          arr_datetime: new Date('2026-10-02T02:00:00Z'),
          duration_minutes: 480,
          source_key: 'AIRLABS_JL_JL062_NRT_LAX',
        },
      ],
    };

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [mockValidatedItin],
      coverage: mockCoverage,
    });

    const res = await service.searchFlights({
      origin: 'SGN',
      destination: 'LAX',
      departure_date: '2026-10-01',
    });

    expect(routeGraphService.findPaths).toHaveBeenCalledWith(['SGN'], ['LAX'], {
      maxStops: 2,
      source: 'airlabs',
    });
    // Fresh cache -> zero external expansions
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalled();
    expect(res.network_status).toBe('FOUND');
    expect(res.network_itineraries!.length).toBe(1);
    expect(res.network_itineraries![0].airports).toEqual(['SGN', 'NRT', 'LAX']);
  });

  // =========================================================================
  // Case 4: ONE_STOP: SGN -> NRT -> LAX -> exactly 2 legs
  // =========================================================================
  it('4. ONE_STOP: SGN -> NRT -> LAX -> exactly 2 legs', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const mockItin: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 900,
      layover_minutes: [120],
      legs: [
        {
          airline_iata: 'JL',
          dep_iata: 'SGN',
          arr_iata: 'NRT',
          dep_datetime: new Date('2026-10-01T08:00:00Z'),
          arr_datetime: new Date('2026-10-01T16:00:00Z'),
          duration_minutes: 480,
          source_key: 'K1',
        },
        {
          airline_iata: 'JL',
          dep_iata: 'NRT',
          arr_iata: 'LAX',
          dep_datetime: new Date('2026-10-01T18:00:00Z'),
          arr_datetime: new Date('2026-10-02T02:00:00Z'),
          duration_minutes: 480,
          source_key: 'K2',
        },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'ONE_STOP', airports: ['SGN', 'NRT', 'LAX'], stops: ['NRT'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [mockItin],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('FOUND');
    const itin = res.network_itineraries![0];
    expect(itin.route_type).toBe('ONE_STOP');
    expect(itin.stops).toEqual(['NRT']);
    expect(itin.legs.length).toBe(2);
  });

  // =========================================================================
  // Case 5: TWO_STOP: SGN -> HKG -> LAX -> destination -> exactly 3 legs
  // =========================================================================
  it('5. TWO_STOP: SGN -> HKG -> LAX -> JFK -> exactly 3 legs', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const mockItin: ValidatedItinerary = {
      route_type: 'TWO_STOP',
      airports: ['SGN', 'HKG', 'LAX', 'JFK'],
      stops: ['HKG', 'LAX'],
      total_duration_minutes: 1500,
      layover_minutes: [120, 180],
      legs: [
        {
          airline_iata: 'CX',
          dep_iata: 'SGN',
          arr_iata: 'HKG',
          dep_datetime: new Date('2026-10-01T08:00:00Z'),
          arr_datetime: new Date('2026-10-01T11:00:00Z'),
          duration_minutes: 180,
          source_key: 'K1',
        },
        {
          airline_iata: 'CX',
          dep_iata: 'HKG',
          arr_iata: 'LAX',
          dep_datetime: new Date('2026-10-01T13:00:00Z'),
          arr_datetime: new Date('2026-10-02T03:00:00Z'),
          duration_minutes: 840,
          source_key: 'K2',
        },
        {
          airline_iata: 'AA',
          dep_iata: 'LAX',
          arr_iata: 'JFK',
          dep_datetime: new Date('2026-10-02T06:00:00Z'),
          arr_datetime: new Date('2026-10-02T11:00:00Z'),
          duration_minutes: 300,
          source_key: 'K3',
        },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'TWO_STOP', airports: ['SGN', 'HKG', 'LAX', 'JFK'], stops: ['HKG', 'LAX'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'HKG', 'LAX'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [mockItin],
      coverage: { complete: true, expanded_airports: ['SGN', 'HKG', 'LAX'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'JFK', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('FOUND');
    const itin = res.network_itineraries![0];
    expect(itin.route_type).toBe('TWO_STOP');
    expect(itin.stops).toEqual(['HKG', 'LAX']);
    expect(itin.legs.length).toBe(3);
  });

  // =========================================================================
  // Case 6: No path + complete coverage -> NO_ROUTE_FOUND
  // =========================================================================
  it('6. No path + complete coverage -> NO_ROUTE_FOUND', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [],
      coverage: {
        complete: true,
        expanded_airports: ['SGN'],
        incomplete_airports: [],
        missing_sync_state_airports: [],
      },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'XYZ', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('NO_ROUTE_FOUND');
    expect(res.network_itineraries).toEqual([]);
    expect(res.network_coverage.complete).toBe(true);
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Case 7: No path + incomplete coverage -> bounded refresh triggered
  // =========================================================================
  it('7. No path + incomplete coverage -> bounded refresh triggered', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    // Pass 1: incomplete coverage with missing sync state at NRT
    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN', 'NRT'],
        incomplete_airports: [],
        missing_sync_state_airports: ['NRT'],
      },
    });

    // Pass 2: still no paths, but coverage now complete
    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [],
      coverage: {
        complete: true,
        expanded_airports: ['SGN', 'NRT'],
        incomplete_airports: [],
        missing_sync_state_airports: [],
      },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledWith('NRT');
    expect(res.network_status).toBe('NO_ROUTE_FOUND');
  });

  // =========================================================================
  // Case 8: Refresh finds path -> rerun graph and return itinerary
  // =========================================================================
  it('8. Refresh finds path -> rerun graph and return itinerary', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    // Pass 1: No path yet, NRT missing
    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN', 'NRT'],
        incomplete_airports: [],
        missing_sync_state_airports: ['NRT'],
      },
    });

    // Pass 2: After NRT refresh, graph returns SGN -> NRT -> LAX
    const foundPath: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      legs: [],
    };
    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [foundPath],
      coverage: {
        complete: true,
        expanded_airports: ['SGN', 'NRT'],
        incomplete_airports: [],
        missing_sync_state_airports: [],
      },
    });

    const validated: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 800,
      layover_minutes: [90],
      legs: [
        { airline_iata: 'VN', dep_iata: 'SGN', arr_iata: 'NRT', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T15:00:00Z'), duration_minutes: 420, source_key: 'A1' },
        { airline_iata: 'UA', dep_iata: 'NRT', arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T16:30:00Z'), arr_datetime: new Date('2026-10-02T01:30:00Z'), duration_minutes: 540, source_key: 'A2' },
      ],
    };
    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [validated],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledWith('NRT');
    expect(res.network_status).toBe('FOUND');
    expect(res.network_itineraries!.length).toBe(1);
    expect(res.network_itineraries![0].airports).toEqual(['SGN', 'NRT', 'LAX']);
  });

  // =========================================================================
  // Case 9: Expansion budget = 8 -> strictly no 9th airport expansion
  // =========================================================================
  it('9. Expansion budget = 8 -> strictly no 9th airport expansion', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    // RouteGraph always reports missing candidate hubs
    routeGraphService.findPaths.mockImplementation(() =>
      Promise.resolve({
        paths: [],
        coverage: {
          complete: false,
          expanded_airports: ['SGN', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
          incomplete_airports: [],
          missing_sync_state_airports: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
        },
      }),
    );

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    // Hard limit: exactly 8 expansions, no 9th call
    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(8);
    expect(res.network_status).toBe('NETWORK_DATA_INCOMPLETE');
  });

  // =========================================================================
  // Case 10: AirLabs 429 -> clean stop, no infinite retries
  // =========================================================================
  it('10. AirLabs 429 -> clean stop, no infinite retries', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    routeGraphService.findPaths.mockResolvedValue({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN', 'BKK', 'SIN'],
        incomplete_airports: [],
        missing_sync_state_airports: ['BKK', 'SIN'],
      },
    });

    // First call throws 429 rate limit
    referenceService.ensureRoutesForAirport.mockRejectedValueOnce(
      new BadRequestException('AirLabs API Rate Limit (429): Quota exceeded or too many requests.'),
    );

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    // Immediately stopped on 429, no infinite loop or subsequent calls
    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(1);
    expect(res.network_status).toBe('NETWORK_DATA_INCOMPLETE');
  });

  // =========================================================================
  // Case 11: Stale cache + refresh failure -> no crash loop, coverage shows uncertainty
  // =========================================================================
  it('11. Stale cache + refresh failure -> no crash loop, coverage shows uncertainty', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    routeGraphService.findPaths.mockResolvedValue({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN', 'HAN'],
        incomplete_airports: ['HAN'],
        missing_sync_state_airports: [],
      },
    });

    referenceService.ensureRoutesForAirport.mockRejectedValueOnce(
      new Error('AirLabs API connection timeout'),
    );

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    // Does not crash
    expect(res.network_status).toBe('NETWORK_DATA_INCOMPLETE');
    expect(res.network_coverage.complete).toBe(false);
    expect(res.network_coverage.incomplete_airports).toContain('HAN');
  });

  // =========================================================================
  // Case 12: Destination country with multiple airports -> set-based matching, no API call per dest
  // =========================================================================
  it('12. Destination country with multiple airports -> set-based matching, no API call per dest', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    referenceService.expandLocation.mockImplementation((loc: string) => {
      if (loc === 'USA') {
        return Promise.resolve({
          iata_codes: ['JFK', 'LAX', 'SFO', 'ORD', 'SEA'],
          matched_kind: 'country',
          label: 'Mọi sân bay Hoa Kỳ',
          using_nearest_airport: false,
        });
      }
      return Promise.resolve({
        iata_codes: [loc.toUpperCase()],
        matched_kind: 'airport',
        label: loc.toUpperCase(),
        using_nearest_airport: false,
      });
    });

    const itinToSfo: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'SFO'],
      stops: ['NRT'],
      total_duration_minutes: 850,
      layover_minutes: [100],
      legs: [
        { airline_iata: 'VN', dep_iata: 'SGN', arr_iata: 'NRT', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T15:00:00Z'), duration_minutes: 420, source_key: 'K1' },
        { airline_iata: 'UA', dep_iata: 'NRT', arr_iata: 'SFO', dep_datetime: new Date('2026-10-01T16:40:00Z'), arr_datetime: new Date('2026-10-02T02:00:00Z'), duration_minutes: 560, source_key: 'K2' },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'ONE_STOP', airports: ['SGN', 'NRT', 'SFO'], stops: ['NRT'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [itinToSfo],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'USA', departure_date: '2026-10-01' });

    // findPaths received full destination set
    expect(routeGraphService.findPaths).toHaveBeenCalledWith(
      ['SGN'],
      ['JFK', 'LAX', 'SFO', 'ORD', 'SEA'],
      { maxStops: 2, source: 'airlabs' },
    );

    // ensureRoutesForAirport was NEVER called for any destination airport (JFK, LAX, SFO, ORD, SEA)
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalledWith('JFK');
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalledWith('LAX');
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalledWith('SFO');
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalledWith('ORD');
    expect(referenceService.ensureRoutesForAirport).not.toHaveBeenCalledWith('SEA');

    expect(res.network_status).toBe('FOUND');
    expect(res.network_itineraries![0].airports).toEqual(['SGN', 'NRT', 'SFO']);
  });

  // =========================================================================
  // Case 13: Cyclic paths excluded
  // =========================================================================
  it('13. Cyclic paths excluded from network results', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    // In a valid network itinerary, no airport can appear more than once
    const itin1: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 800,
      layover_minutes: [100],
      legs: [
        { airline_iata: 'JL', dep_iata: 'SGN', arr_iata: 'NRT', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T15:00:00Z'), duration_minutes: 420, source_key: 'A1' },
        { airline_iata: 'JL', dep_iata: 'NRT', arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T16:40:00Z'), arr_datetime: new Date('2026-10-02T02:00:00Z'), duration_minutes: 560, source_key: 'A2' },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'ONE_STOP', airports: ['SGN', 'NRT', 'LAX'], stops: ['NRT'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [itin1],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    for (const itin of res.network_itineraries!) {
      const uniqueAirports = new Set(itin.airports);
      expect(uniqueAirports.size).toBe(itin.airports.length); // strictly acyclic
    }
  });

  // =========================================================================
  // Case 14: maxStops caller > 2 -> clamped to max 2 stops (TWO_STOP)
  // =========================================================================
  it('14. maxStops passed to routeGraphService is clamped to at most 2 stops', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    await service.discoverNetworkRoutes(['SGN'], ['LAX'], '2026-10-01');

    expect(routeGraphService.findPaths).toHaveBeenCalledWith(
      ['SGN'],
      ['LAX'],
      expect.objectContaining({ maxStops: 2 }),
    );
  });

  // =========================================================================
  // Case 15: AirLabs itinerary has is_bookable: false and inventories: []
  // =========================================================================
  it('15. AirLabs itinerary has is_bookable: false and inventories: []', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const itin: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 800,
      layover_minutes: [100],
      legs: [
        { airline_iata: 'JL', dep_iata: 'SGN', arr_iata: 'NRT', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T15:00:00Z'), duration_minutes: 420, source_key: 'A1' },
        { airline_iata: 'JL', dep_iata: 'NRT', arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T16:40:00Z'), arr_datetime: new Date('2026-10-02T02:00:00Z'), duration_minutes: 560, source_key: 'A2' },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'ONE_STOP', airports: ['SGN', 'NRT', 'LAX'], stops: ['NRT'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [itin],
      coverage: { complete: true, expanded_airports: ['SGN', 'NRT'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('FOUND');
    const returnedItin = res.network_itineraries![0];
    expect(returnedItin.is_bookable).toBe(false);
    expect(returnedItin.inventories).toEqual([]);
    for (const leg of returnedItin.legs) {
      expect((leg as any).is_bookable).toBe(false);
      expect((leg as any).inventories).toEqual([]);
    }
  });

  // =========================================================================
  // Case 16: Result sorting & capping (MAX_NETWORK_ITINERARIES = 20)
  // =========================================================================
  it('16. Result sorting & capping (MAX_NETWORK_ITINERARIES = 20)', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    // Generate 25 candidate itineraries with different stops and durations
    const manyItineraries: ValidatedItinerary[] = [];
    for (let i = 0; i < 25; i++) {
      manyItineraries.push({
        route_type: i < 5 ? 'ONE_STOP' : 'TWO_STOP',
        airports: i < 5 ? ['SGN', `T${i}`, 'LAX'] : ['SGN', `T${i}A`, `T${i}B`, 'LAX'],
        stops: i < 5 ? [`T${i}`] : [`T${i}A`, `T${i}B`],
        total_duration_minutes: 1000 - i * 10,
        layover_minutes: [60],
        legs: [
          { airline_iata: 'XX', dep_iata: 'SGN', arr_iata: `T${i}`, dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T12:00:00Z'), duration_minutes: 240, source_key: `KEY_${i}` },
          { airline_iata: 'YY', dep_iata: `T${i}`, arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T13:00:00Z'), arr_datetime: new Date('2026-10-01T20:00:00Z'), duration_minutes: 420, source_key: `KEY_${i}_B` },
        ],
      });
    }

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: manyItineraries.map(itin => ({ route_type: itin.route_type, airports: itin.airports, stops: itin.stops, legs: [] })),
      coverage: { complete: true, expanded_airports: ['SGN'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: manyItineraries,
      coverage: { complete: true, expanded_airports: ['SGN'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'LAX', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('FOUND');
    expect(res.network_itineraries!.length).toBe(20); // capped at 20
    // Fewer stops first
    expect(res.network_itineraries![0].stops.length).toBeLessThanOrEqual(res.network_itineraries![19].stops.length);
  });

  // =========================================================================
  // Case 17: AirLabs 429 returned in refresh_error -> clean stop, zero further calls
  // =========================================================================
  it('17. AirLabs 429 in refresh_error -> immediately halts expansion, returns NETWORK_DATA_INCOMPLETE', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    routeGraphService.findPaths.mockResolvedValue({
      paths: [],
      coverage: {
        complete: false,
        expanded_airports: ['SGN'],
        incomplete_airports: ['HKG'],
        missing_sync_state_airports: ['HKG', 'NRT'],
      },
    });

    // ensureRoutesForAirport returns stale with 429 refresh_error
    referenceService.ensureRoutesForAirport.mockResolvedValueOnce({
      from_cache: true,
      stale: true,
      complete: false,
      count: 10,
      refresh_error: 'AirLabs API Rate Limit (429): Quota exceeded or too many requests.',
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'JFK', departure_date: '2026-10-01' });

    // Stopped immediately on 1st candidate, zero subsequent calls
    expect(referenceService.ensureRoutesForAirport).toHaveBeenCalledTimes(1);
    expect(res.network_status).toBe('NETWORK_DATA_INCOMPLETE');
  });

  // =========================================================================
  // Case 18: TWO_STOP 3-leg itinerary mapping -> cleanly maps leg1, leg2, leg3
  // =========================================================================
  it('18. TWO_STOP 3-leg itinerary mapping -> maps leg1, leg2, leg3 cleanly without mixing', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const threeLegItin: ValidatedItinerary = {
      route_type: 'TWO_STOP',
      airports: ['SGN', 'HKG', 'LAX', 'JFK'],
      stops: ['HKG', 'LAX'],
      total_duration_minutes: 1440,
      layover_minutes: [120, 180],
      legs: [
        { airline_iata: 'CX', dep_iata: 'SGN', arr_iata: 'HKG', dep_datetime: new Date('2026-10-01T06:00:00Z'), arr_datetime: new Date('2026-10-01T10:00:00Z'), duration_minutes: 240, source_key: 'CX1' },
        { airline_iata: 'CX', dep_iata: 'HKG', arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T12:00:00Z'), arr_datetime: new Date('2026-10-01T23:00:00Z'), duration_minutes: 660, source_key: 'CX2' },
        { airline_iata: 'AA', dep_iata: 'LAX', arr_iata: 'JFK', dep_datetime: new Date('2026-10-02T02:00:00Z'), arr_datetime: new Date('2026-10-02T07:40:00Z'), duration_minutes: 340, source_key: 'AA3' },
      ],
    };

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [{ route_type: 'TWO_STOP', airports: ['SGN', 'HKG', 'LAX', 'JFK'], stops: ['HKG', 'LAX'], legs: [] }],
      coverage: { complete: true, expanded_airports: ['SGN', 'HKG'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    routeScheduleValidatorService.validatePaths.mockReturnValueOnce({
      itineraries: [threeLegItin],
      coverage: { complete: true, expanded_airports: ['SGN', 'HKG'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    const res = await service.searchFlights({ origin: 'SGN', destination: 'JFK', departure_date: '2026-10-01' });

    expect(res.network_status).toBe('FOUND');
    expect(res.route_network_suggestions).toBeDefined();
    expect(res.route_network_suggestions!.length).toBe(1);

    const sugg = res.route_network_suggestions![0];
    expect(sugg.transit_airport).toBe('HKG, LAX');
    // Leg 1: SGN -> HKG (CX)
    expect(sugg.leg1).toEqual({
      airline_iata: 'CX',
      dep_iata: 'SGN',
      arr_iata: 'HKG',
    });
    // Leg 2: HKG -> LAX (CX)
    expect(sugg.leg2).toEqual({
      airline_iata: 'CX',
      dep_iata: 'HKG',
      arr_iata: 'LAX',
    });
    // Leg 3: LAX -> JFK (AA)
    expect(sugg.leg3).toEqual({
      airline_iata: 'AA',
      dep_iata: 'LAX',
      arr_iata: 'JFK',
    });
  });

  // =========================================================================
  // Case 19: Round-trip search triggers return network discovery when concrete return is 0
  // =========================================================================
  it('19. Round-trip: when concrete return flights are 0, triggers return network discovery on return_date', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    const outboundItin: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['SGN', 'NRT', 'LAX'],
      stops: ['NRT'],
      total_duration_minutes: 900,
      layover_minutes: [90],
      legs: [
        { airline_iata: 'VN', dep_iata: 'SGN', arr_iata: 'NRT', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T15:00:00Z'), duration_minutes: 420, source_key: 'OB1' },
        { airline_iata: 'UA', dep_iata: 'NRT', arr_iata: 'LAX', dep_datetime: new Date('2026-10-01T16:30:00Z'), arr_datetime: new Date('2026-10-02T01:30:00Z'), duration_minutes: 540, source_key: 'OB2' },
      ],
    };

    const returnItin: ValidatedItinerary = {
      route_type: 'ONE_STOP',
      airports: ['LAX', 'ICN', 'SGN'],
      stops: ['ICN'],
      total_duration_minutes: 950,
      layover_minutes: [110],
      legs: [
        { airline_iata: 'KE', dep_iata: 'LAX', arr_iata: 'ICN', dep_datetime: new Date('2026-10-10T12:00:00Z'), arr_datetime: new Date('2026-10-11T05:00:00Z'), duration_minutes: 660, source_key: 'RT1' },
        { airline_iata: 'KE', dep_iata: 'ICN', arr_iata: 'SGN', dep_datetime: new Date('2026-10-11T06:50:00Z'), arr_datetime: new Date('2026-10-11T11:40:00Z'), duration_minutes: 290, source_key: 'RT2' },
      ],
    };

    // findPaths called for outbound, then return
    routeGraphService.findPaths
      .mockResolvedValueOnce({
        paths: [{ route_type: 'ONE_STOP', airports: ['SGN', 'NRT', 'LAX'], stops: ['NRT'], legs: [] }],
        coverage: { complete: true, expanded_airports: ['SGN'], incomplete_airports: [], missing_sync_state_airports: [] },
      })
      .mockResolvedValueOnce({
        paths: [{ route_type: 'ONE_STOP', airports: ['LAX', 'ICN', 'SGN'], stops: ['ICN'], legs: [] }],
        coverage: { complete: true, expanded_airports: ['LAX'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

    routeScheduleValidatorService.validatePaths
      .mockReturnValueOnce({
        itineraries: [outboundItin],
        coverage: { complete: true, expanded_airports: ['SGN'], incomplete_airports: [], missing_sync_state_airports: [] },
      })
      .mockReturnValueOnce({
        itineraries: [returnItin],
        coverage: { complete: true, expanded_airports: ['LAX'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

    const res = await service.searchFlights({
      origin: 'SGN',
      destination: 'LAX',
      departure_date: '2026-10-01',
      return_date: '2026-10-10',
    });

    expect(res.network_status).toBe('FOUND');
    expect(res.network_itineraries!.length).toBe(1);
    expect(res.network_itineraries![0].is_bookable).toBe(false);

    // Return network discovery was triggered
    expect(res.return_network_status).toBe('FOUND');
    expect(res.return_network_itineraries!.length).toBe(1);
    expect(res.return_network_itineraries![0].airports).toEqual(['LAX', 'ICN', 'SGN']);
    expect(res.return_network_itineraries![0].is_bookable).toBe(false);
  });

  // =========================================================================
  // Case 20: SGN -> USA destination country scope uses includeUnserviced for network discovery
  // =========================================================================
  it('20. SGN -> USA destination expands to all reference airports with includeUnserviced: true', async () => {
    flightModel.find.mockImplementation(() => ({
      sort: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));

    referenceService.expandLocation.mockImplementation((loc: string, options?: { includeUnserviced?: boolean }) => {
      if (loc === 'USA') {
        if (options?.includeUnserviced) {
          return Promise.resolve({
            iata_codes: ['JFK', 'LAX', 'SFO', 'ORD', 'SEA'],
            matched_kind: 'country',
            label: 'Mọi sân bay Hoa Kỳ',
            using_nearest_airport: false,
          });
        }
        return Promise.resolve({
          iata_codes: ['JFK', 'LAX', 'SFO'],
          matched_kind: 'country',
          label: 'Mọi sân bay Hoa Kỳ (phục vụ trực tiếp)',
          using_nearest_airport: false,
        });
      }
      return Promise.resolve({
        iata_codes: [loc.toUpperCase()],
        matched_kind: 'airport',
        label: loc.toUpperCase(),
        using_nearest_airport: false,
      });
    });

    routeGraphService.findPaths.mockResolvedValueOnce({
      paths: [],
      coverage: { complete: true, expanded_airports: ['SGN'], incomplete_airports: [], missing_sync_state_airports: [] },
    });

    await service.searchFlights({ origin: 'SGN', destination: 'USA', departure_date: '2026-10-01' });

    // Proves network discovery called with expanded US airports including unserviced (ORD, SEA)
    expect(routeGraphService.findPaths).toHaveBeenCalledWith(
      ['SGN'],
      expect.arrayContaining(['JFK', 'LAX', 'SFO', 'ORD', 'SEA']),
      expect.objectContaining({ source: 'airlabs' }),
    );
  });
});

