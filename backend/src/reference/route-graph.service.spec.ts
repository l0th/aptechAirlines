import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RouteGraphService } from './route-graph.service';
import { RouteRef, RouteSyncState } from './reference.schema';

describe('RouteGraphService - Phase B Route Selection Graph Algorithm', () => {
  let service: RouteGraphService;
  let routeRefModel: any;
  let routeSyncStateModel: any;

  // Helper to build realistic mock RouteRef documents
  const mkRoute = (
    dep: string,
    arr: string,
    flightIata = 'VN100',
    extra: Partial<any> = {},
  ) => {
    const source_key = `AIRLABS_VN_${flightIata}_${dep}_${arr}_NOTIME_NODAYS`;
    return {
      source_key,
      airline_iata: 'VN',
      airline_icao: 'HVN',
      flight_number: flightIata.replace('VN', ''),
      flight_iata: flightIata,
      dep_iata: dep,
      dep_icao: 'V' + dep,
      dep_time: '08:00',
      dep_time_utc: '01:00',
      dep_terminals: ['T1'],
      arr_iata: arr,
      arr_icao: 'V' + arr,
      arr_time: '10:00',
      arr_time_utc: '03:00',
      arr_terminals: ['T2'],
      duration: 120,
      days: ['mon', 'wed', 'fri'],
      aircraft_icao: 'A321',
      has_schedule: true,
      source: 'airlabs',
      synced_at: new Date('2026-09-17T10:00:00Z'),
      airlabs_updated: '2026-09-17T10:00:00Z',
      sync_generation: 'gen_test_01',
      ...extra,
    };
  };

  // Helper to configure RouteRef mock store
  let mockRoutes: any[] = [];
  let mockSyncStates: any[] = [];

  beforeEach(async () => {
    mockRoutes = [];
    mockSyncStates = [];

    routeRefModel = {
      find: jest.fn().mockImplementation((query: any) => {
        let results = [...mockRoutes];
        if (query?.dep_iata?.$in) {
          const deps = query.dep_iata.$in;
          results = results.filter(r => deps.includes(r.dep_iata));
        } else if (query?.dep_iata) {
          results = results.filter(r => r.dep_iata === query.dep_iata);
        }
        if (query?.source) {
          results = results.filter(r => (r.source || 'airlabs') === query.source);
        }
        if (query?.source_key) {
          results = results.filter(r => {
            if (query.source_key.$exists === true && (r.source_key === undefined || r.source_key === null)) {
              return false;
            }
            if (query.source_key.$type === 'string' && typeof r.source_key !== 'string') {
              return false;
            }
            if (query.source_key.$ne !== undefined && r.source_key === query.source_key.$ne) {
              return false;
            }
            return true;
          });
        }
        return {
          lean: () => ({
            exec: jest.fn().mockResolvedValue(results),
          }),
          exec: jest.fn().mockResolvedValue(results),
        };
      }),
    };

    routeSyncStateModel = {
      find: jest.fn().mockImplementation((query: any) => {
        let results = [...mockSyncStates];
        if (query?.dep_iata?.$in) {
          const deps = query.dep_iata.$in;
          results = results.filter(s => deps.includes(s.dep_iata));
        }
        if (query?.source) {
          results = results.filter(s => (s.source || 'airlabs') === query.source);
        }
        return {
          lean: () => ({
            exec: jest.fn().mockResolvedValue(results),
          }),
          exec: jest.fn().mockResolvedValue(results),
        };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteGraphService,
        { provide: getModelToken(RouteRef.name), useValue: routeRefModel },
        { provide: getModelToken(RouteSyncState.name), useValue: routeSyncStateModel },
      ],
    }).compile();

    service = module.get<RouteGraphService>(RouteGraphService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 1. Direct path: A -> D returns DIRECT
  it('1. direct path: A -> D returns DIRECT', async () => {
    mockRoutes = [mkRoute('AAA', 'DDD', 'VN101')];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path.route_type).toBe('DIRECT');
    expect(path.airports).toEqual(['AAA', 'DDD']);
    expect(path.stops).toEqual([]);
    expect(path.legs).toHaveLength(1);
    expect(path.legs[0].dep_iata).toBe('AAA');
    expect(path.legs[0].arr_iata).toBe('DDD');
  });

  // 2. Multiple direct service records: A -> D flight1, A -> D flight2 -> one topology, both services preserved
  it('2. multiple direct service records: A -> D flight1, A -> D flight2 -> one topology, both services preserved', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN101', { source_key: 'KEY_VN101' }),
      mkRoute('AAA', 'DDD', 'VN102', { source_key: 'KEY_VN102' }),
    ];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path.route_type).toBe('DIRECT');
    expect(path.legs[0].services).toHaveLength(2);
    expect(path.legs[0].services.map(s => s.flight_iata)).toEqual(['VN101', 'VN102']);
  });

  // 3. One-stop: A -> B -> D returned
  it('3. one-stop: A -> B -> D returned', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path.route_type).toBe('ONE_STOP');
    expect(path.airports).toEqual(['AAA', 'BBB', 'DDD']);
    expect(path.stops).toEqual(['BBB']);
    expect(path.legs).toHaveLength(2);
  });

  // 4. All one-stop alternatives: A -> B -> D and A -> C -> D both returned
  it('4. all one-stop alternatives: A -> B -> D and A -> C -> D both returned', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'),
      mkRoute('AAA', 'CCC', 'VN103'),
      mkRoute('CCC', 'DDD', 'VN104'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
      { dep_iata: 'CCC', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].airports).toEqual(['AAA', 'BBB', 'DDD']);
    expect(result.paths[1].airports).toEqual(['AAA', 'CCC', 'DDD']);
  });

  // 5. Two-stop: A -> B -> C -> D returned
  it('5. two-stop: A -> B -> C -> D returned', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'CCC', 'VN102'),
      mkRoute('CCC', 'DDD', 'VN103'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
      { dep_iata: 'CCC', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path.route_type).toBe('TWO_STOP');
    expect(path.airports).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(path.stops).toEqual(['BBB', 'CCC']);
    expect(path.legs).toHaveLength(3);
  });

  // 6. Multiple two-stop combinations all returned
  it('6. multiple two-stop combinations all returned', async () => {
    mockRoutes = [
      // Branch 1: AAA -> BBB -> CCC -> DDD
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'CCC', 'VN102'),
      mkRoute('CCC', 'DDD', 'VN103'),
      // Branch 2: AAA -> BBB -> EEE -> DDD
      mkRoute('BBB', 'EEE', 'VN104'),
      mkRoute('EEE', 'DDD', 'VN105'),
      // Branch 3: AAA -> FFF -> CCC -> DDD
      mkRoute('AAA', 'FFF', 'VN106'),
      mkRoute('FFF', 'CCC', 'VN107'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
      { dep_iata: 'CCC', complete: true, truncated: false },
      { dep_iata: 'EEE', complete: true, truncated: false },
      { dep_iata: 'FFF', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    expect(result.paths).toHaveLength(3);
    const pathStrings = result.paths.map(p => p.airports.join('>'));
    expect(pathStrings).toContain('AAA>BBB>CCC>DDD');
    expect(pathStrings).toContain('AAA>BBB>EEE>DDD');
    expect(pathStrings).toContain('AAA>FFF>CCC>DDD');
  });

  // 7. Cycle rejected: A -> B -> A -> D must not appear
  it('7. cycle rejected: A -> B -> A -> D must not appear', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'AAA', 'VN102'), // reverse cycle
      mkRoute('AAA', 'DDD', 'VN103'), // direct
      mkRoute('BBB', 'DDD', 'VN104'), // 1-stop
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    const pathStrings = result.paths.map(p => p.airports.join('>'));
    // Valid simple paths
    expect(pathStrings).toContain('AAA>DDD');
    expect(pathStrings).toContain('AAA>BBB>DDD');
    // Cycle must NOT appear
    expect(pathStrings).not.toContain('AAA>BBB>AAA>DDD');
  });

  // 8. No route with complete coverage: paths=[], coverage.complete=true
  it('8. no route with complete coverage: paths=[], coverage.complete=true', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'), // leads to BBB only, no connection to DDD
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toEqual([]);
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.missing_sync_state_airports).toEqual([]);
    expect(result.coverage.incomplete_airports).toEqual([]);
  });

  // 9. No route with incomplete coverage: paths=[], coverage.complete=false
  it('9. no route with incomplete coverage: paths=[], coverage.complete=false', async () => {
    mockRoutes = [];
    // AAA sync state is incomplete/truncated
    mockSyncStates = [
      { dep_iata: 'AAA', complete: false, truncated: true },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toEqual([]);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.incomplete_airports).toContain('AAA');
  });

  // 10. Missing RouteSyncState for expanded transit: coverage.complete=false, missing_sync_state_airports contains transit
  it('10. missing RouteSyncState for expanded transit: coverage.complete=false, missing_sync_state_airports contains transit', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'),
    ];
    // BBB has no RouteSyncState in MongoDB
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(1);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.missing_sync_state_airports).toContain('BBB');
  });

  // 11. Truncated sync state: complete=false / truncated=true -> coverage incomplete
  it('11. truncated sync state: complete=false / truncated=true -> coverage incomplete', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: false, truncated: true }, // truncated
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.incomplete_airports).toContain('BBB');
  });

  // 12. Multiple origins
  it('12. multiple origins', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA', 'BBB'], ['DDD']);

    expect(result.paths).toHaveLength(2);
    expect(result.paths.map(p => p.airports.join('>'))).toEqual(['AAA>DDD', 'BBB>DDD']);
  });

  // 13. Multiple destinations
  it('13. multiple destinations', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN101'),
      mkRoute('AAA', 'EEE', 'VN102'),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD', 'EEE']);

    expect(result.paths).toHaveLength(2);
    expect(result.paths.map(p => p.airports.join('>'))).toEqual(['AAA>DDD', 'AAA>EEE']);
  });

  // 14. Direct + one-stop + two-stop coexist: all must be returned
  it('14. direct + one-stop + two-stop coexist: all must be returned', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN001'), // Direct
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'), // 1-Stop: AAA>BBB>DDD
      mkRoute('BBB', 'CCC', 'VN201'),
      mkRoute('CCC', 'DDD', 'VN202'), // 2-Stop: AAA>BBB>CCC>DDD
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
      { dep_iata: 'CCC', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    expect(result.paths).toHaveLength(3);
    expect(result.paths[0].route_type).toBe('DIRECT');
    expect(result.paths[1].route_type).toBe('ONE_STOP');
    expect(result.paths[2].route_type).toBe('TWO_STOP');
  });

  // 15. Topology dedupe: multiple services do not duplicate path
  it('15. topology dedupe: multiple services do not duplicate path', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101', { source_key: 'K1' }),
      mkRoute('AAA', 'BBB', 'VN102', { source_key: 'K2' }),
      mkRoute('BBB', 'DDD', 'VN201', { source_key: 'K3' }),
      mkRoute('BBB', 'DDD', 'VN202', { source_key: 'K4' }),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].airports).toEqual(['AAA', 'BBB', 'DDD']);
    expect(result.paths[0].legs[0].services).toHaveLength(2);
    expect(result.paths[0].legs[1].services).toHaveLength(2);
  });

  // 16. Service candidates preserved with full fields
  it('16. service candidates preserved with full fields', async () => {
    const rawRoute = mkRoute('AAA', 'DDD', 'VN888', {
      source_key: 'AIRLABS_VN_VN888_AAA_DDD_L:08:00_D:mon,wed,fri',
      dep_time: '08:00',
      arr_time: '10:00',
      days: ['mon', 'wed', 'fri'],
      duration: 120,
      aircraft_icao: 'B789',
      has_schedule: true,
      cs_flight_iata: 'AF4000',
      sync_generation: 'gen_alpha',
    });
    mockRoutes = [rawRoute];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const result = await service.findPaths(['AAA'], ['DDD']);

    const s = result.paths[0].legs[0].services[0];
    expect(s.source_key).toBe('AIRLABS_VN_VN888_AAA_DDD_L:08:00_D:mon,wed,fri');
    expect(s.flight_iata).toBe('VN888');
    expect(s.dep_time).toBe('08:00');
    expect(s.arr_time).toBe('10:00');
    expect(s.days).toEqual(['mon', 'wed', 'fri']);
    expect(s.duration).toBe(120);
    expect(s.aircraft_icao).toBe('B789');
    expect(s.has_schedule).toBe(true);
    expect(s.cs_flight_iata).toBe('AF4000');
    expect(s.sync_generation).toBe('gen_alpha');
  });

  // 17. Deterministic ordering: fewer legs first, then airport sequence lexical, services sorted by source_key
  it('17. deterministic ordering: fewer legs first, then airport sequence lexical, services sorted by source_key', async () => {
    mockRoutes = [
      mkRoute('AAA', 'CCC', 'VN101'),
      mkRoute('CCC', 'DDD', 'VN102'), // AAA>CCC>DDD (1-stop)
      mkRoute('AAA', 'BBB', 'VN103'),
      mkRoute('BBB', 'DDD', 'VN104'), // AAA>BBB>DDD (1-stop)
      mkRoute('AAA', 'DDD', 'VN002', { source_key: 'Z_KEY' }), // AAA>DDD (direct)
      mkRoute('AAA', 'DDD', 'VN001', { source_key: 'A_KEY' }), // AAA>DDD (direct)
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
      { dep_iata: 'CCC', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['AAA'], ['DDD']);

    // Direct must come first
    expect(result.paths[0].airports).toEqual(['AAA', 'DDD']);
    // Within direct, services sorted by source_key: A_KEY before Z_KEY
    expect(result.paths[0].legs[0].services[0].source_key).toBe('A_KEY');
    expect(result.paths[0].legs[0].services[1].source_key).toBe('Z_KEY');

    // 1-stop paths ordered alphabetically: AAA>BBB>DDD before AAA>CCC>DDD
    expect(result.paths[1].airports).toEqual(['AAA', 'BBB', 'DDD']);
    expect(result.paths[2].airports).toEqual(['AAA', 'CCC', 'DDD']);
  });

  // 18. No hard-coded airport assumption: use arbitrary names/codes in unit fixtures
  it('18. no hard-coded airport assumption: arbitrary codes XXX, YYY, ZZZ, KKK', async () => {
    mockRoutes = [
      mkRoute('XXX', 'YYY', 'AB100'),
      mkRoute('YYY', 'ZZZ', 'AB200'),
      mkRoute('ZZZ', 'KKK', 'AB300'),
    ];
    mockSyncStates = [
      { dep_iata: 'XXX', complete: true, truncated: false },
      { dep_iata: 'YYY', complete: true, truncated: false },
      { dep_iata: 'ZZZ', complete: true, truncated: false },
    ];

    const result = await service.findPaths(['XXX'], ['KKK'], { maxStops: 2 });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].airports).toEqual(['XXX', 'YYY', 'ZZZ', 'KKK']);
  });

  // 19. Verifies bulk frontier querying rather than query-per-transit behavior
  it('19. verifies bulk frontier querying rather than query-per-transit behavior', async () => {
    // 5 transit airports at Depth 1
    mockRoutes = [
      mkRoute('AAA', 'T01'),
      mkRoute('AAA', 'T02'),
      mkRoute('AAA', 'T03'),
      mkRoute('AAA', 'T04'),
      mkRoute('AAA', 'T05'),
      mkRoute('T01', 'DDD'),
      mkRoute('T02', 'DDD'),
      mkRoute('T03', 'DDD'),
      mkRoute('T04', 'DDD'),
      mkRoute('T05', 'DDD'),
    ];

    await service.findPaths(['AAA'], ['DDD'], { maxStops: 1 });

    // Depth 0: 1 query for ['AAA']
    // Depth 1: 1 bulk query for ['T01', 'T02', 'T03', 'T04', 'T05'] (NOT 5 separate queries!)
    // RouteRef queries total must be exactly 2
    expect(routeRefModel.find).toHaveBeenCalledTimes(2);

    const call1Query = routeRefModel.find.mock.calls[0][0];
    const call2Query = routeRefModel.find.mock.calls[1][0];

    expect(call1Query).toEqual({
      dep_iata: { $in: ['AAA'] },
      source: 'airlabs',
      source_key: { $exists: true, $type: 'string', $ne: '' },
    });
    expect(call2Query.source).toBe('airlabs');
    expect(call2Query.source_key).toEqual({ $exists: true, $type: 'string', $ne: '' });
    expect(call2Query.dep_iata.$in).toHaveLength(5);
  });

  // 20. maxStops=0 returns direct only
  it('20. maxStops=0 returns direct only', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN001'), // direct
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'), // 1-stop
      mkRoute('BBB', 'CCC', 'VN201'),
      mkRoute('CCC', 'DDD', 'VN202'), // 2-stop
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 0 });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].route_type).toBe('DIRECT');
  });

  // 21. maxStops=1 returns direct + one-stop, not two-stop
  it('21. maxStops=1 returns direct + one-stop, not two-stop', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN001'), // direct
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'), // 1-stop
      mkRoute('BBB', 'CCC', 'VN201'),
      mkRoute('CCC', 'DDD', 'VN202'), // 2-stop
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 1 });

    expect(result.paths).toHaveLength(2);
    expect(result.paths.map(p => p.route_type)).toEqual(['DIRECT', 'ONE_STOP']);
  });

  // 22. maxStops=2 returns all direct/one/two-stop paths
  it('22. maxStops=2 returns all direct/one/two-stop paths', async () => {
    mockRoutes = [
      mkRoute('AAA', 'DDD', 'VN001'), // direct
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'DDD', 'VN102'), // 1-stop
      mkRoute('BBB', 'CCC', 'VN201'),
      mkRoute('CCC', 'DDD', 'VN202'), // 2-stop
    ];

    const result = await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    expect(result.paths).toHaveLength(3);
    expect(result.paths.map(p => p.route_type)).toEqual(['DIRECT', 'ONE_STOP', 'TWO_STOP']);
  });

  // 23. non-AirLabs RouteRef excluded from graph (AAA -> BBB from other-provider, AAA -> CCC from airlabs)
  it('23. non-AirLabs RouteRef excluded from graph', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'OP101', { source: 'other-provider' }),
      mkRoute('AAA', 'CCC', 'VN101', { source: 'airlabs' }),
    ];
    mockSyncStates = [
      { dep_iata: 'AAA', source: 'airlabs', complete: true, truncated: false },
    ];

    // Search AAA -> BBB: only other-provider has AAA -> BBB, so path must NOT exist
    const resBBB = await service.findPaths(['AAA'], ['BBB']);
    expect(resBBB.paths).toHaveLength(0);

    // Search AAA -> CCC: airlabs has AAA -> CCC, so path MUST exist
    const resCCC = await service.findPaths(['AAA'], ['CCC']);
    expect(resCCC.paths).toHaveLength(1);
    expect(resCCC.paths[0].legs[0].services[0].source).toBe('airlabs');
  });

  // 24. graph RouteRef queries include source: 'airlabs' for depth 0, 1, and 2
  it('24. graph RouteRef queries include source: airlabs for depth 0, 1, and 2', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101', { source: 'airlabs' }),
      mkRoute('BBB', 'CCC', 'VN102', { source: 'airlabs' }),
      mkRoute('CCC', 'DDD', 'VN103', { source: 'airlabs' }),
    ];

    await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    // Depth 0, 1, 2 = 3 queries
    expect(routeRefModel.find).toHaveBeenCalledTimes(3);
    expect(routeRefModel.find.mock.calls[0][0].source).toBe('airlabs');
    expect(routeRefModel.find.mock.calls[1][0].source).toBe('airlabs');
    expect(routeRefModel.find.mock.calls[2][0].source).toBe('airlabs');
  });

  // 25. RouteSyncState coverage uses correct source semantics
  it('25. RouteSyncState coverage uses correct source semantics (non-AirLabs sync state rejected)', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101', { source: 'airlabs' }),
    ];
    // Sync state is complete but belongs to 'other-provider'
    mockSyncStates = [
      { dep_iata: 'AAA', source: 'other-provider', complete: true, truncated: false },
    ];

    const res = await service.findPaths(['AAA'], ['BBB']);

    expect(res.paths).toHaveLength(1);
    // Because AAA's airlabs sync state is missing, coverage cannot be complete
    expect(res.coverage.complete).toBe(false);
    expect(res.coverage.missing_sync_state_airports).toContain('AAA');
  });

  // 26. non-AirLabs RouteRef cannot make an AirLabs graph appear complete
  it('26. non-AirLabs RouteRef cannot make an AirLabs graph appear complete', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'OTHER1', { source: 'other-provider' }),
    ];
    mockSyncStates = [];

    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(0);
    expect(res.coverage.complete).toBe(false);
  });

  // 27. AirLabs RouteRef with missing source_key is ignored
  it('27. AirLabs RouteRef with missing source_key is ignored', async () => {
    const legacyNoKey = mkRoute('AAA', 'BBB', 'VN100');
    delete (legacyNoKey as any).source_key;
    mockRoutes = [legacyNoKey];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(0);
  });

  // 28. source_key=null is ignored
  it('28. source_key=null is ignored', async () => {
    const legacyNullKey = mkRoute('AAA', 'BBB', 'VN100', { source_key: null });
    mockRoutes = [legacyNullKey];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(0);
  });

  // 29. source_key='' is ignored
  it('29. source_key="" is ignored', async () => {
    const legacyEmptyKey = mkRoute('AAA', 'BBB', 'VN100', { source_key: '' });
    mockRoutes = [legacyEmptyKey];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(0);
  });

  // 30. valid AirLabs service on same edge remains usable
  it('30. valid AirLabs service on same edge remains usable when legacy malformed records exist', async () => {
    const legacyNullKey = mkRoute('AAA', 'BBB', 'VN100', { source_key: null });
    const validFlight = mkRoute('AAA', 'BBB', 'VN200', { source_key: 'AIRLABS_VN_VN200_AAA_BBB_NOTIME_NODAYS' });
    mockRoutes = [legacyNullKey, validFlight];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0].legs[0].services).toHaveLength(1);
    expect(res.paths[0].legs[0].services[0].source_key).toBe('AIRLABS_VN_VN200_AAA_BBB_NOTIME_NODAYS');
  });

  // 31. identity-less legacy route cannot create a topology
  it('31. identity-less legacy route cannot create a topology edge', async () => {
    const legacyNoKey = mkRoute('AAA', 'BBB', 'VN100');
    delete (legacyNoKey as any).source_key;
    const validLeg2 = mkRoute('BBB', 'CCC', 'VN200', { source_key: 'AIRLABS_VN_VN200_BBB_CCC_NOTIME_NODAYS' });
    mockRoutes = [legacyNoKey, validLeg2];
    mockSyncStates = [
      { dep_iata: 'AAA', complete: true, truncated: false },
      { dep_iata: 'BBB', complete: true, truncated: false },
    ];

    const res = await service.findPaths(['AAA'], ['CCC']);
    // Because AAA -> BBB has no valid source_key, no topology edge exists
    expect(res.paths).toHaveLength(0);
  });

  // 32. graph service does not crash when legacy malformed records exist
  it('32. graph service does not crash when legacy malformed records exist (defensive against undefined/empty)', async () => {
    mockRoutes = [
      { dep_iata: 'AAA', arr_iata: 'BBB' }, // no source_key at all
      { dep_iata: 'AAA', arr_iata: 'BBB', source_key: null },
      { dep_iata: 'AAA', arr_iata: 'BBB', source_key: '' },
      { dep_iata: 'AAA', arr_iata: 'BBB', source_key: 12345 }, // invalid type
    ];
    mockSyncStates = [{ dep_iata: 'AAA', complete: true, truncated: false }];

    // Should complete cleanly without throwing undefined.localeCompare or any error
    await expect(service.findPaths(['AAA'], ['BBB'])).resolves.toBeDefined();
    const res = await service.findPaths(['AAA'], ['BBB']);
    expect(res.paths).toHaveLength(0);
  });

  // 33. RouteRef frontier queries explicitly contain provider + valid source_key filter
  it('33. RouteRef frontier queries explicitly contain provider + valid source_key filter', async () => {
    mockRoutes = [
      mkRoute('AAA', 'BBB', 'VN101'),
      mkRoute('BBB', 'CCC', 'VN102'),
      mkRoute('CCC', 'DDD', 'VN103'),
    ];

    await service.findPaths(['AAA'], ['DDD'], { maxStops: 2 });

    expect(routeRefModel.find).toHaveBeenCalledTimes(3);
    for (const call of routeRefModel.find.mock.calls) {
      const q = call[0];
      expect(q.source).toBe('airlabs');
      expect(q.source_key).toEqual({ $exists: true, $type: 'string', $ne: '' });
    }
  });
});
