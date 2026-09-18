import { BadRequestException } from '@nestjs/common';
import { RouteScheduleValidatorService } from './route-schedule-validator.service';
import { RouteGraphCoverage, RouteGraphPath, RouteGraphResult } from './route-graph.service';

describe('RouteScheduleValidatorService', () => {
  let service: RouteScheduleValidatorService;

  const mockCoverage: RouteGraphCoverage = {
    complete: true,
    expanded_airports: ['HAN', 'DAD'],
    incomplete_airports: [],
    missing_sync_state_airports: [],
  };

  beforeEach(() => {
    service = new RouteScheduleValidatorService();
  });

  const mkService = (overrides: Partial<any> = {}) => ({
    source_key: 'KEY_' + Math.random().toString(36).substring(7),
    airline_iata: 'VN',
    dep_iata: 'HAN',
    arr_iata: 'SGN',
    dep_time: '08:00',
    arr_time: '10:00',
    duration: 120,
    has_schedule: true,
    source: 'airlabs',
    ...overrides,
  });

  // Monday = 2025-06-16, Tuesday = 2025-06-17, Wednesday = 2025-06-18
  const MONDAY_DATE = '2025-06-16';
  const TUESDAY_DATE = '2025-06-17';

  it('1. Direct route with weekday matching -> accepted', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'SGN'],
      stops: [],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'SGN',
          services: [mkService({ flight_number: 'VN100', days: ['mon', 'wed', 'fri'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].legs[0].flight_number).toBe('VN100');
    expect(res.itineraries[0].total_duration_minutes).toBe(120);
  });

  it('2. Direct route with weekday mismatch -> rejected (filtered out)', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'SGN'],
      stops: [],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'SGN',
          services: [mkService({ flight_number: 'VN100', days: ['tue', 'thu'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(0);
  });

  it('3. Direct route with no weekday restrictions (days empty/undefined) -> accepted', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'SGN'],
      stops: [],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'SGN',
          services: [mkService({ flight_number: 'VN101', days: [] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].legs[0].flight_number).toBe('VN101');
  });

  it('4. Overnight flight (arr_time < dep_time) -> correctly rolls over arrival date to +1 day', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'NRT'],
      stops: [],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'NRT',
          services: [mkService({ dep_time: '23:30', arr_time: '06:30', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    const leg = res.itineraries[0].legs[0];
    expect(leg.dep_datetime.toISOString()).toBe('2025-06-16T23:30:00.000Z');
    expect(leg.arr_datetime.toISOString()).toBe('2025-06-17T06:30:00.000Z');
    expect(leg.duration_minutes).toBe(420); // 7 hours = 420 min
  });

  it('5. Layover exactly 45 minutes -> accepted (minimum boundary)', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '08:00', arr_time: '09:15', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '10:00', arr_time: '11:20', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].layover_minutes).toEqual([45]);
    expect(res.itineraries[0].total_duration_minutes).toBe(200); // 75 flight + 45 layover + 80 flight = 200 min
  });

  it('6. Layover 44 minutes -> rejected (< 45 min boundary)', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '08:00', arr_time: '09:16', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '10:00', arr_time: '11:20', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(0);
  });

  it('7. Layover exactly 720 minutes -> accepted (maximum boundary = 12h)', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '06:00', arr_time: '07:00', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '19:00', arr_time: '20:15', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].layover_minutes).toEqual([720]);
  });

  it('8. Layover 721 minutes -> rejected (> 720 min boundary)', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '06:00', arr_time: '07:00', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '19:01', arr_time: '20:15', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(0);
  });

  it('9. Negative layover (departure before arrival on same day) -> rejected', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '14:00', arr_time: '15:15', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          // Departs at 10:00 (5 hours before arrival if same day, or 18h45m next day = 1125 min > 720 min)
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '10:00', arr_time: '11:20', days: ['mon', 'tue'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(0);
  });

  it('10. Overnight layover within 720 minutes -> accepted, checks next day operating weekday', () => {
    // Leg 1 arrives Monday at 22:00. Leg 2 departs Tuesday at 06:00. Layover = 8 hours (480 min).
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '20:30', arr_time: '22:00', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          // Operates on Tuesday
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '06:00', arr_time: '07:20', days: ['tue'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].layover_minutes).toEqual([480]);
    expect(res.itineraries[0].legs[1].dep_datetime.toISOString()).toBe('2025-06-17T06:00:00.000Z');
  });

  it('11. Two-stop route (3 legs): all layovers between 45 and 720 min -> valid', () => {
    const path: RouteGraphPath = {
      route_type: 'TWO_STOP',
      airports: ['HAN', 'DAD', 'CXR', 'SGN'],
      stops: ['DAD', 'CXR'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '06:00', arr_time: '07:15', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'CXR',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'CXR', dep_time: '08:30', arr_time: '09:30', days: ['mon'] })],
        },
        {
          dep_iata: 'CXR',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'CXR', arr_iata: 'SGN', dep_time: '11:00', arr_time: '12:00', days: ['mon'] })],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(1);
    expect(res.itineraries[0].route_type).toBe('TWO_STOP');
    expect(res.itineraries[0].legs.length).toBe(3);
    // Layover 1: 07:15 -> 08:30 = 75 min
    // Layover 2: 09:30 -> 11:00 = 90 min
    expect(res.itineraries[0].layover_minutes).toEqual([75, 90]);
    // Total duration: 06:00 to 12:00 = 360 min
    expect(res.itineraries[0].total_duration_minutes).toBe(360);
  });

  it('12. Two-stop route: leg 1-2 valid, but leg 2-3 layover < 45 min -> rejected', () => {
    const path: RouteGraphPath = {
      route_type: 'TWO_STOP',
      airports: ['HAN', 'DAD', 'CXR', 'SGN'],
      stops: ['DAD', 'CXR'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '06:00', arr_time: '07:15', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'CXR',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'CXR', dep_time: '08:30', arr_time: '09:30', days: ['mon'] })],
        },
        {
          dep_iata: 'CXR',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'CXR', arr_iata: 'SGN', dep_time: '09:50', arr_time: '10:50', days: ['mon'] })], // 20 min layover < 45 min
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(0);
  });

  it('13. Multi-candidate Cartesian product: only valid combinations emitted', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [
            mkService({ flight_number: 'VN1', dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '07:00', arr_time: '08:15', days: ['mon'] }),
            mkService({ flight_number: 'VN2', dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '12:00', arr_time: '13:15', days: ['mon'] }),
          ],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [
            // Connects with VN1 (layover = 08:15 to 09:30 = 75m), but invalid for VN2 (departs before VN2 arrives)
            mkService({ flight_number: 'VN3', dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '09:30', arr_time: '10:45', days: ['mon'] }),
            // Connects with VN2 (layover = 13:15 to 14:30 = 75m), but too long for VN1 (layover = 08:15 to 14:30 = 375m, wait, 375 <= 720 so both connect with VN4!)
            mkService({ flight_number: 'VN4', dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '14:30', arr_time: '15:45', days: ['mon'] }),
          ],
        },
      ],
    };

    const res = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    // VN1 + VN3 (75 min layover) -> valid
    // VN1 + VN4 (375 min layover) -> valid
    // VN2 + VN4 (75 min layover) -> valid
    // VN2 + VN3 (VN3 departs 09:30, VN2 arrives 13:15 -> layover < 0) -> invalid
    expect(res.itineraries.length).toBe(3);
  });

  it('14. Empty paths in -> empty itineraries out, coverage preserved', () => {
    const res = service.validatePaths({ paths: [], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries).toEqual([]);
    expect(res.coverage).toEqual(mockCoverage);
  });

  it('15. Invalid date string -> throws BadRequestException', () => {
    expect(() => {
      service.validatePaths({ paths: [], coverage: mockCoverage }, 'invalid-date');
    }).toThrow(BadRequestException);

    expect(() => {
      service.validatePaths({ paths: [], coverage: mockCoverage }, '2025-13-45');
    }).toThrow(BadRequestException);
  });

  it('16. Preservation of Phase B coverage metadata', () => {
    const customCoverage: RouteGraphCoverage = {
      complete: false,
      expanded_airports: ['HAN'],
      incomplete_airports: ['HAN'],
      missing_sync_state_airports: [],
    };
    const res = service.validatePaths({ paths: [], coverage: customCoverage }, MONDAY_DATE);
    expect(res.coverage.complete).toBe(false);
    expect(res.coverage.incomplete_airports).toEqual(['HAN']);
  });

  it('17. Deterministic sorting: shortest total duration first', () => {
    const pathA: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'DAD', 'SGN'],
      stops: ['DAD'],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'DAD',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'DAD', dep_time: '06:00', arr_time: '07:00', days: ['mon'] })],
        },
        {
          dep_iata: 'DAD',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'DAD', arr_iata: 'SGN', dep_time: '12:00', arr_time: '13:00', days: ['mon'] })], // 5h layover -> total 7h (420m)
        },
      ],
    };

    const pathB: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'SGN'],
      stops: [],
      legs: [
        {
          dep_iata: 'HAN',
          arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'SGN', dep_time: '09:00', arr_time: '11:00', days: ['mon'] })], // total 2h (120m)
        },
      ],
    };

    const res = service.validatePaths({ paths: [pathA, pathB], coverage: mockCoverage }, MONDAY_DATE);
    expect(res.itineraries.length).toBe(2);
    expect(res.itineraries[0].total_duration_minutes).toBe(120);
    expect(res.itineraries[1].total_duration_minutes).toBe(420);
  });

  it('18. uses UTC schedule fields for chronology when local wall clocks disagree', () => {
    const path: RouteGraphPath = {
      route_type: 'ONE_STOP',
      airports: ['HAN', 'BKK', 'SGN'],
      stops: ['BKK'],
      legs: [
        {
          dep_iata: 'HAN', arr_iata: 'BKK',
          services: [mkService({ dep_iata: 'HAN', arr_iata: 'BKK', dep_time: '23:30', dep_time_utc: '16:30', arr_time: '01:00', arr_time_utc: '18:00', duration: 90, days: ['mon'] })],
        },
        {
          dep_iata: 'BKK', arr_iata: 'SGN',
          services: [mkService({ dep_iata: 'BKK', arr_iata: 'SGN', dep_time: '02:00', dep_time_utc: '19:00', arr_time: '03:30', arr_time_utc: '20:30', duration: 90, days: ['tue'] })],
        },
      ],
    };

    const result = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(result.itineraries).toHaveLength(1);
    expect(result.itineraries[0].layover_minutes).toEqual([60]);
    expect(result.itineraries[0].legs.every((leg) => leg.chronology_basis === 'UTC')).toBe(true);
    expect(result.itineraries[0].legs[0].dep_datetime.toISOString()).toBe('2025-06-16T16:30:00.000Z');
  });

  it('19. resolves local midnight to the previous UTC date without changing the local operating weekday', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT',
      airports: ['HAN', 'BKK'],
      stops: [],
      legs: [{
        dep_iata: 'HAN', arr_iata: 'BKK',
        services: [mkService({ dep_time: '00:30', dep_time_utc: '17:30', arr_time: '02:00', arr_time_utc: '19:00', duration: 90, days: ['mon'] })],
      }],
    };

    const result = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(result.itineraries).toHaveLength(1);
    expect(result.itineraries[0].legs[0].dep_datetime.toISOString()).toBe('2025-06-15T17:30:00.000Z');
  });

  it('20. rejects an invalid UTC time instead of coercing it to midnight', () => {
    const path: RouteGraphPath = {
      route_type: 'DIRECT', airports: ['HAN', 'SGN'], stops: [],
      legs: [{ dep_iata: 'HAN', arr_iata: 'SGN', services: [mkService({ dep_time: '08:00', dep_time_utc: '25:99', arr_time: '10:00', arr_time_utc: '03:00' })] }],
    };
    const result = service.validatePaths({ paths: [path], coverage: mockCoverage }, MONDAY_DATE);
    expect(result.itineraries).toEqual([]);
  });
});
