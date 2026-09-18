import { Test, TestingModule } from '@nestjs/testing';
import { FlightsService } from './flights.service';
import { getModelToken } from '@nestjs/mongoose';
import { Flight } from './flights.schema';
import { Booking, BookingStatus } from '../bookings/bookings.schema';
import { AirportsService } from '../airports/airports.service';
import { BadRequestException } from '@nestjs/common';
import { FlightStatus } from './flights.schema';
import { ReferenceService } from '../reference/reference.service';
import { SearchFlightDto } from './flights.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UsersService } from '../users/users.service';

describe('FlightsService', () => {
  let service: FlightsService;
  let flightModel: any;
  let bookingModel: any;
  let airportsService: any;
  let referenceService: any;
  let usersService: any;

  beforeEach(async () => {
    flightModel = {
      find: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockReturnThis(),
      findOneAndUpdate: jest.fn(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      findById: jest.fn().mockReturnThis(),
    };

    bookingModel = {
      find: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    airportsService = {
      findByIata: jest.fn(),
      resolveCity: jest.fn().mockImplementation((city: string) => ({
        exactMatches: [{ iata_code: city.toUpperCase() }],
        nearestSuggestion: null,
      })),
    };

    referenceService = {
      expandLocation: jest.fn().mockImplementation((code: string) =>
        Promise.resolve({ iata_codes: [code?.toUpperCase() || ''] }),
      ),
      findRouteNetworkConnections: jest.fn().mockResolvedValue([]),
    };

    usersService = {
      deductSkyMiles: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: getModelToken(Flight.name), useValue: flightModel },
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: AirportsService, useValue: airportsService },
        { provide: ReferenceService, useValue: referenceService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<FlightsService>(FlightsService);
  });

  describe('searchFlights / findDirectFlights pricing', () => {
    const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const mockDate = futureDate.toISOString().substring(0, 10);
    const depDateTime = new Date(futureDate.getTime() + 8 * 3600 * 1000);
    const arrDateTime = new Date(futureDate.getTime() + 10 * 3600 * 1000);

    it('adult 100%, child 75%, senior 85%, total_party_price calculation', async () => {
      const mockFlight = {
        _id: 'f1',
        flight_number: 'FL1',
        status: FlightStatus.SCHEDULED,
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: depDateTime,
        scheduled_arrival: arrDateTime,
        inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 1000 }],
      };
      flightModel.exec.mockResolvedValue([mockFlight]);

      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: mockDate,
        adults: 2,
        children: 1, // 750
        seniors: 1, // 850
      } as any);

      const onward = res.onward_flights[0];
      // 2 * 1000 + 750 + 850 = 3600
      expect(onward.total_party_price).toBe(3600);
      expect(onward.base_price_per_adult).toBe(1000);
    });

    it('flights with too few seats or CANCELLED status are excluded', async () => {
      // 1 valid, 1 too few seats, 1 cancelled (handled by mock filter or check)
      const mockFlight1 = {
        _id: 'f1',
        flight_number: 'FL1',
        status: FlightStatus.SCHEDULED,
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: depDateTime,
        scheduled_arrival: arrDateTime,
        inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 1000 }],
      };
      const mockFlight2 = {
        _id: 'f2',
        flight_number: 'FL2',
        status: FlightStatus.SCHEDULED,
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: depDateTime,
        scheduled_arrival: arrDateTime,
        inventories: [{ _id: 'i2', id: 'i2', available_seats: 1, base_price: 1000 }], // Not enough seats for 2
      };
      flightModel.exec.mockResolvedValue([mockFlight1, mockFlight2]);

      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: mockDate,
        adults: 2,
      } as any);

      expect(res.onward_flights.length).toBe(1);
      expect(res.onward_flights[0].flight_number).toBe('FL1');

      // Check if CANCELLED is excluded in the query filter
      expect(flightModel.find).toHaveBeenCalledWith(expect.objectContaining({
        status: { $ne: FlightStatus.CANCELLED }
      }));
    });

    it('return_date < departure_date throws', async () => {
      await expect(service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2025-01-02',
        return_date: '2025-01-01',
      } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('connecting route algorithm', () => {
    it('only routes with a layover between 45 and 720 minutes are returned', async () => {
      // When searching HAN -> SGN, direct returns [], then it looks for connections.
      // Mock leg 1: HAN -> DAD
      const leg1 = {
        _id: 'f1',
        flight_number: 'FL1',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        duration_minutes: 60,
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T10:00:00Z'), // Arrives 10:00
        inventories: [{ _id: 'i1', available_seats: 10, base_price: 500 }],
      };
      // Mock leg 2: DAD -> SGN
      const leg2Valid = { // Layover = 60 mins (between 45 and 720)
        _id: 'f2',
        flight_number: 'FL2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        duration_minutes: 60,
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T11:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T12:00:00Z'),
        inventories: [{ _id: 'i2', available_seats: 10, base_price: 500 }],
      };
      const leg2TooShort = { // Layover = 30 mins
        _id: 'f3',
        flight_number: 'FL3',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        duration_minutes: 60,
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T10:30:00Z'),
        scheduled_arrival: new Date('2026-10-01T11:30:00Z'),
        inventories: [{ _id: 'i3', available_seats: 10, base_price: 500 }],
      };

      // Mock exec to return direct=[] on first call, leg1 on second, leg2s on third
      flightModel.exec
        .mockResolvedValueOnce([]) // direct
        .mockResolvedValueOnce([leg1]) // leg1 search
        .mockResolvedValueOnce([leg2Valid, leg2TooShort]); // leg2 search

      const res = await service.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].layover_minutes).toBe(60);
      expect(res.connecting_routes![0].total_duration_minutes).toBe(180); // 60 + 60 + 60
      expect(res.connecting_routes![0].transit_airport).toBe('DAD');
    });

    it('integrates RouteGraphService and RouteScheduleValidatorService when available', async () => {
      const mockGraphService = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [
            {
              route_type: 'ONE_STOP',
              airports: ['HAN', 'DAD', 'SGN'],
              stops: ['DAD'],
              legs: [
                {
                  dep_iata: 'HAN',
                  arr_iata: 'DAD',
                  services: [{ flight_number: 'VN1', dep_time: '08:00', arr_time: '09:15', days: ['mon'] }],
                },
                {
                  dep_iata: 'DAD',
                  arr_iata: 'SGN',
                  services: [{ flight_number: 'VN2', dep_time: '10:15', arr_time: '11:30', days: ['mon'] }],
                },
              ],
            },
          ],
          coverage: { complete: true, expanded_airports: ['HAN', 'DAD'], incomplete_airports: [], missing_sync_state_airports: [] },
        }),
      };

      const mockValidatorService = {
        validatePaths: jest.fn().mockReturnValue({
          itineraries: [
            {
              route_type: 'ONE_STOP',
              airports: ['HAN', 'DAD', 'SGN'],
              stops: ['DAD'],
              total_duration_minutes: 210,
              layover_minutes: [60],
              legs: [
                { flight_number: 'VN1', chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T09:15:00Z') },
                { flight_number: 'VN2', chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date('2026-10-01T10:15:00Z'), arr_datetime: new Date('2026-10-01T11:30:00Z') },
              ],
            },
          ],
          coverage: { complete: true, expanded_airports: ['HAN', 'DAD'], incomplete_airports: [], missing_sync_state_airports: [] },
        }),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraphService as any,
        mockValidatorService as any,
      );

      const f1 = {
        _id: 'f1',
        flight_number: 'VN1',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T09:15:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'i1', available_seats: 10, base_price: 500 }],
      };
      const f2 = {
        _id: 'f2',
        flight_number: 'VN2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T10:15:00Z'),
        scheduled_arrival: new Date('2026-10-01T11:30:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'i2', available_seats: 10, base_price: 600 }],
      };
      const wrongNumber = { ...f1, _id: 'wrong', flight_number: 'VN999' };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        if (query.origin_iata === 'HAN' && query.dest_iata === 'DAD') {
          return { exec: () => Promise.resolve([wrongNumber, f1]) };
        }
        if (query.origin_iata === 'DAD' && query.dest_iata === 'SGN') {
          return { exec: () => Promise.resolve([f2]) };
        }
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      expect(mockGraphService.findPaths).toHaveBeenCalled();
      expect(mockValidatorService.validatePaths).toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBeGreaterThanOrEqual(1);
      expect(res.connecting_routes![0].transit_airport).toBe('DAD');
      expect(res.connecting_routes![0].legs[0].flight_number).toBe('VN1');
      expect(res.connecting_routes![0].legs[0].flight_id).toBe('f1');
      expect(res.connecting_routes![0].coverage.complete).toBe(true);
    });

    it('does not expose a graph itinerary when flight identity or exact schedule cannot be matched', async () => {
      const graph = { findPaths: jest.fn().mockResolvedValue({ paths: [{}], coverage: { complete: true } }) };
      const validator = {
        validatePaths: jest.fn().mockReturnValue({
          itineraries: [{
            route_type: 'ONE_STOP', stops: ['DAD'], total_duration_minutes: 180, layover_minutes: [60],
            legs: [
              { flight_number: 'VN123', chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date('2026-10-01T08:00:00Z') },
              { flight_number: 'VN456', chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date('2026-10-01T10:00:00Z') },
            ],
          }],
          coverage: { complete: true },
        }),
      };
      const svc = new FlightsService(flightModel, bookingModel, airportsService, referenceService, graph as any, validator as any);
      const wrong = {
        _id: 'wrong', flight_number: 'VN999', origin_iata: 'HAN', dest_iata: 'DAD',
        scheduled_departure: new Date('2026-10-01T09:00:00Z'), scheduled_arrival: new Date('2026-10-01T10:00:00Z'),
        inventories: [{ _id: 'i1', available_seats: 10, base_price: 100 }],
      };
      flightModel.find.mockImplementation((query: any) => ({
        sort: () => ({ exec: () => Promise.resolve([]) }),
        exec: () => Promise.resolve(query.origin_iata === 'HAN' && query.dest_iata === 'DAD' ? [wrong] : []),
      }));

      const result = await svc.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      expect(result.connecting_routes).toEqual([]);
    });

    it('searches the return direction through the connecting pipeline independently', async () => {
      const directSpy = jest.spyOn(service as any, 'findDirectFlights').mockResolvedValue([]);
      const connectingSpy = jest.spyOn(service as any, 'findConnectingRoutes')
        .mockResolvedValueOnce([{ route_type: 'ONE_STOP', legs: ['outbound'] }])
        .mockResolvedValueOnce([{ route_type: 'TWO_STOP', legs: ['return'] }]);

      const result = await service.searchFlights({
        origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01', return_date: '2026-10-10',
      } as any);

      expect(directSpy).toHaveBeenCalledTimes(2);
      expect(connectingSpy).toHaveBeenNthCalledWith(1, ['HAN'], ['SGN'], '2026-10-01', 1, 1, 0, 0);
      expect(connectingSpy).toHaveBeenNthCalledWith(2, ['SGN'], ['HAN'], '2026-10-10', 1, 1, 0, 0);
      expect(result.connecting_routes?.[0].legs).toEqual(['outbound']);
      expect(result.return_connecting_routes?.[0].legs).toEqual(['return']);
    });

    it('proving internal routes cannot bypass Phase B/C when routeGraphService is present (legacy loop never reached)', async () => {
      const mockGraphService = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [], // No path in AirLabs graph
          coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
        }),
      };
      const mockValidatorService = {
        validatePaths: jest.fn().mockReturnValue({
          itineraries: [],
          coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
        }),
      };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraphService as any,
        mockValidatorService as any,
      );

      // In database, there exist internal flights that WOULD match legacy connecting loop
      const leg1 = {
        _id: 'leg1', flight_number: 'INTERNAL1', origin_iata: 'HAN', dest_iata: 'DAD',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T08:00:00Z'), scheduled_arrival: new Date('2026-10-01T09:00:00Z'),
        inventories: [{ _id: 'inv1', available_seats: 10, base_price: 100 }],
      };
      flightModel.find.mockImplementation(() => ({
        sort: () => ({ exec: () => Promise.resolve([]) }),
        exec: () => Promise.resolve([leg1]),
      }));

      const res = await svc.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      expect(res.connecting_routes).toEqual([]);
      expect(mockGraphService.findPaths).toHaveBeenCalled();
    });

    it('returns connecting routes even when direct flights exist when include_connecting: true', async () => {
      const mockDirect = {
        _id: 'direct1', flight_number: 'DIRECT1', origin_iata: 'HAN', dest_iata: 'SGN',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T08:00:00Z'), scheduled_arrival: new Date('2026-10-01T10:00:00Z'),
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'd_inv', available_seats: 10, base_price: 1000 }],
      };
      const leg1 = {
        _id: 'f1', flight_number: 'L1', origin_iata: 'HAN', dest_iata: 'DAD',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T08:00:00Z'), scheduled_arrival: new Date('2026-10-01T09:00:00Z'),
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i1', available_seats: 10, base_price: 500 }],
      };
      const leg2 = {
        _id: 'f2', flight_number: 'L2', origin_iata: 'DAD', dest_iata: 'SGN',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T10:00:00Z'), scheduled_arrival: new Date('2026-10-01T11:00:00Z'),
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i2', available_seats: 10, base_price: 500 }],
      };

      flightModel.find.mockImplementation((q: any) => {
        const execFn = () => {
          if (q.origin_iata?.$in && q.dest_iata?.$in) {
            return Promise.resolve([mockDirect]);
          }
          if (q.origin_iata?.$in) return Promise.resolve([leg1]);
          if (q.origin_iata === 'DAD') return Promise.resolve([leg2]);
          return Promise.resolve([]);
        };
        return {
          sort: () => ({ exec: execFn }),
          exec: execFn,
        };
      });

      // Search without include_connecting -> direct only
      const resWithout = await service.searchFlights({
        origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01',
      } as any);
      expect(resWithout.onward_flights.length).toBe(1);
      expect(resWithout.connecting_routes).toEqual([]);

      // Search WITH include_connecting: true -> direct AND connecting
      const resWith = await service.searchFlights({
        origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01', include_connecting: true,
      } as any);
      expect(resWith.onward_flights.length).toBe(1);
      expect(resWith.connecting_routes!.length).toBe(1);
    });
  });

  describe('reserveSeats', () => {
    it('returns true when the atomic findOneAndUpdate matches', async () => {
      flightModel.findOneAndUpdate.mockResolvedValue({ _id: 'f1' });
      const res = await service.reserveSeats('f1', 'i1', 2);
      expect(res).toBe(true);
      
      // must be called with an $elemMatch + $inc update
      expect(flightModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inventories: { $elemMatch: { _id: 'i1', available_seats: { $gte: 2 } } }
        }),
        expect.objectContaining({
          $inc: { 'inventories.$.available_seats': -2 }
        }),
        { new: true }
      );
    });

    it('returns false when it does not match', async () => {
      flightModel.findOneAndUpdate.mockResolvedValue(null);
      const res = await service.reserveSeats('f1', 'i1', 2);
      expect(res).toBe(false);
    });
  });

  describe('getSeatMap', () => {
    it('seats occupied by non-cancelled bookings are marked is_occupied', async () => {
      const validId = '507f1f77bcf86cd799439011';
      const mockFlight = {
        _id: validId,
        flight_number: 'FL1',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: new Date(),
      };
      flightModel.exec.mockResolvedValue(mockFlight);

      const mockBooking = {
        ticket_coupons: [{ flight_id: validId, seat_code: '1A' }, { flight_id: validId, seat_code: '12F' }]
      };
      bookingModel.exec.mockResolvedValue([mockBooking]);

      const res = await service.getSeatMap(validId);
      
      // Row 1 Seat A should be occupied
      const row1 = res.rows.find((r: any) => r.row_number === 1);
      const seat1A = row1.seats.find((s: any) => s.column === 'A');
      expect(seat1A.is_occupied).toBe(true);

      // Row 1 Seat B should be empty
      const seat1B = row1.seats.find((s: any) => s.column === 'B');
      expect(seat1B.is_occupied).toBe(false);
      
      // Row 12 Seat F should be occupied
      const row12 = res.rows.find((r: any) => r.row_number === 12);
      const seat12F = row12.seats.find((s: any) => s.column === 'F');
      expect(seat12F.is_occupied).toBe(true);
    });

    it('exposes aircraft_model (null when no real aircraft data), aircraft_known and layout_notice, NEVER fabricates aircraft model', async () => {
      const validId = '507f1f77bcf86cd799439011';
      // Case 1: no aircraft
      flightModel.exec.mockResolvedValue({
        _id: validId,
        flight_number: 'FL1',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: new Date(),
      });
      bookingModel.exec.mockResolvedValue([]);

      let res = await service.getSeatMap(validId);
      expect(res.aircraft_model).toBeNull();
      expect(res.aircraft_known).toBe(false);
      expect(res.layout_notice).toBeDefined();

      // Case 2: has aircraft
      flightModel.exec.mockResolvedValue({
        _id: validId,
        flight_number: 'FL1',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        scheduled_departure: new Date(),
        aircraft: { model_name: 'Boeing 737' }
      });
      res = await service.getSeatMap(validId);
      expect(res.aircraft_model).toBe('Boeing 737');
      expect(res.aircraft_known).toBe(true);
    });
  });

  describe('searchFlights nearest airport propagation (§3.3.1 - §3.3.2)', () => {
    it('propagates nearest airport metadata for unserviced origin and serviced destination', async () => {
      const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      const mockDate = futureDate.toISOString().substring(0, 10);

      referenceService.expandLocation.mockImplementation((token: string) => {
        if (token === 'HOI') {
          return Promise.resolve({
            iata_codes: ['DAD'],
            matched_kind: 'airport',
            label: 'Gần Hoi An',
            using_nearest_airport: true,
            nearest_suggestion: {
              airport: { iata_code: 'DAD', city_name: 'Da Nang' },
              distance_km: 30,
              for_city: 'Hoi An',
            },
          });
        }
        return Promise.resolve({
          iata_codes: ['SGN'],
          matched_kind: 'airport',
          label: 'Tan Son Nhat',
          using_nearest_airport: false,
        });
      });

      flightModel.exec.mockResolvedValue([]);

      const res = await service.searchFlights({
        origin: 'HOI',
        destination: 'SGN',
        departure_date: mockDate,
      } as any);

      expect(res.origin_info.query).toBe('HOI');
      expect(res.origin_info.resolved_iata).toBe('DAD');
      expect(res.origin_info.using_nearest_airport).toBe(true);
      expect(res.origin_info.nearest_suggestion).toEqual({
        airport: { iata_code: 'DAD', city_name: 'Da Nang' },
        distance_km: 30,
        for_city: 'Hoi An',
      });

      expect(res.dest_info.query).toBe('SGN');
      expect(res.dest_info.resolved_iata).toBe('SGN');
      expect(res.dest_info.using_nearest_airport).toBe(false);
      expect(res.dest_info.nearest_suggestion).toBeUndefined();
    });

    it('propagates nearest airport metadata for unserviced destination', async () => {
      const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      const mockDate = futureDate.toISOString().substring(0, 10);

      referenceService.expandLocation.mockImplementation((token: string) => {
        if (token === 'HAN') {
          return Promise.resolve({
            iata_codes: ['HAN'],
            matched_kind: 'airport',
            label: 'Noi Bai',
            using_nearest_airport: false,
          });
        }
        return Promise.resolve({
          iata_codes: ['DAD'],
          matched_kind: 'airport',
          label: 'Gần Hoi An',
          using_nearest_airport: true,
          nearest_suggestion: {
            airport: { iata_code: 'DAD', city_name: 'Da Nang' },
            distance_km: 30,
            for_city: 'Hoi An',
          },
        });
      });

      flightModel.exec.mockResolvedValue([]);

      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'HOI',
        departure_date: mockDate,
      } as any);

      expect(res.origin_info.using_nearest_airport).toBe(false);
      expect(res.origin_info.nearest_suggestion).toBeUndefined();

      expect(res.dest_info.query).toBe('HOI');
      expect(res.dest_info.resolved_iata).toBe('DAD');
      expect(res.dest_info.using_nearest_airport).toBe(true);
      expect(res.dest_info.nearest_suggestion).toEqual({
        airport: { iata_code: 'DAD', city_name: 'Da Nang' },
        distance_km: 30,
        for_city: 'Hoi An',
      });
    });
  });

  describe('Requirement 1.1 date-range search & validation (§3.3.4.2, §3.3.4.3, §3.3.6.1)', () => {
    // Tests A - H: Backend Date Validation
    it('Test A: valid single departure date -> accepted', async () => {
      flightModel.exec.mockResolvedValue([]);
      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
      } as any);
      expect(res).toBeDefined();
      expect(res.onward_flights).toBeDefined();
    });

    it('Test B: valid inclusive range (01-03) -> accepted and direct DB filter uses $gte/$lte', async () => {
      flightModel.exec.mockResolvedValue([]);
      flightModel.find.mockClear();

      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-03',
      } as any);

      expect(res).toBeDefined();
      expect(flightModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          departure_date: { $gte: '2026-10-01', $lte: '2026-10-03' },
        }),
      );
    });

    it('Test C: departure_date_end < departure_date -> rejected before flight queries', async () => {
      flightModel.find.mockClear();
      await expect(
        service.searchFlights({
          origin: 'HAN',
          destination: 'SGN',
          departure_date: '2026-10-05',
          departure_date_end: '2026-10-02',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(flightModel.find).not.toHaveBeenCalled();
    });

    it('Test D: departure before min_date -> rejected', async () => {
      await expect(
        service.searchFlights({
          origin: 'HAN',
          destination: 'SGN',
          departure_date: '2020-01-01',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('Test E: start/end after max_date -> rejected', async () => {
      await expect(
        service.searchFlights({
          origin: 'HAN',
          destination: 'SGN',
          departure_date: '2099-01-01',
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.searchFlights({
          origin: 'HAN',
          destination: 'SGN',
          departure_date: '2026-10-01',
          departure_date_end: '2099-01-01',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('Test F: malformed/impossible date DTO values -> rejected by DTO validation', async () => {
      // 1. abc
      const dto1 = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: 'abc',
      });
      const errs1 = await validate(dto1);
      expect(errs1.length).toBeGreaterThan(0);
      expect(errs1.some((e) => e.property === 'departure_date')).toBe(true);

      // 2. 2026-13-01
      const dto2 = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-13-01',
      });
      const errs2 = await validate(dto2);
      expect(errs2.length).toBeGreaterThan(0);
      expect(errs2.some((e) => e.property === 'departure_date')).toBe(true);

      // 3. 2026-02-31
      const dto3 = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-02-31',
      });
      const errs3 = await validate(dto3);
      expect(errs3.length).toBeGreaterThan(0);
      expect(errs3.some((e) => e.property === 'departure_date')).toBe(true);

      // 4. Invalid departure_date_end
      const dto4 = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: 'not-a-date',
      });
      const errs4 = await validate(dto4);
      expect(errs4.length).toBeGreaterThan(0);
      expect(errs4.some((e) => e.property === 'departure_date_end')).toBe(true);

      // 5. Invalid return_date (non-leap year Feb 29)
      const dto5 = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        return_date: '2026-02-29',
      });
      const errs5 = await validate(dto5);
      expect(errs5.length).toBeGreaterThan(0);
      expect(errs5.some((e) => e.property === 'return_date')).toBe(true);

      // 6. Valid DTO passes
      const dtoValid = plainToInstance(SearchFlightDto, {
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-03',
        return_date: '2026-10-05',
      });
      const errsValid = await validate(dtoValid);
      expect(errsValid.length).toBe(0);
    });

    it('Test G: round trip start = 01, end = 05, return = 04 -> rejected', async () => {
      await expect(
        service.searchFlights({
          origin: 'HAN',
          destination: 'SGN',
          departure_date: '2026-10-01',
          departure_date_end: '2026-10-05',
          return_date: '2026-10-04',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('Test H: round trip start = 01, end = 05, return = 05 -> accepted', async () => {
      flightModel.exec.mockResolvedValue([]);
      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-05',
        return_date: '2026-10-05',
      } as any);
      expect(res).toBeDefined();
    });

    // Tests I - M: Connecting Range Tests
    it('Test I: Authoritative route-graph path: range 3 days, valid itinerary only on middle date -> included', async () => {
      const mockGraph = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [
            {
              route_type: 'ONE_STOP',
              airports: ['HAN', 'DAD', 'SGN'],
              stops: ['DAD'],
              legs: [
                { dep_iata: 'HAN', arr_iata: 'DAD', services: [{ flight_number: 'VN10' }] },
                { dep_iata: 'DAD', arr_iata: 'SGN', services: [{ flight_number: 'VN20' }] },
              ],
            },
          ],
          coverage: { complete: true, expanded_airports: ['HAN', 'DAD'], incomplete_airports: [], missing_sync_state_airports: [] },
        }),
      };

      const mockValidator = {
        validatePaths: jest.fn().mockImplementation((_graphRes: any, dateStr: string) => {
          if (dateStr === '2026-10-02') {
            return {
              itineraries: [
                {
                  route_type: 'ONE_STOP',
                  airports: ['HAN', 'DAD', 'SGN'],
                  stops: ['DAD'],
                  total_duration_minutes: 200,
                  layover_minutes: [60],
                  legs: [
                    { flight_number: 'VN10', chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date('2026-10-02T08:00:00Z'), arr_datetime: new Date('2026-10-02T09:15:00Z') },
                    { flight_number: 'VN20', chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date('2026-10-02T10:15:00Z'), arr_datetime: new Date('2026-10-02T11:30:00Z') },
                  ],
                },
              ],
              coverage: { complete: true },
            };
          }
          return { itineraries: [], coverage: { complete: true } };
        }),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraph as any,
        mockValidator as any,
      );

      const leg1Flight = {
        _id: 'fl10',
        flight_number: 'VN10',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-02',
        scheduled_departure: new Date('2026-10-02T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-02T09:15:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'inv1', available_seats: 10, base_price: 500 }],
      };
      const leg2Flight = {
        _id: 'fl20',
        flight_number: 'VN20',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-02',
        scheduled_departure: new Date('2026-10-02T10:15:00Z'),
        scheduled_arrival: new Date('2026-10-02T11:30:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'inv2', available_seats: 10, base_price: 600 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        if (query.origin_iata === 'HAN' && query.dest_iata === 'DAD') {
          return { exec: () => Promise.resolve([leg1Flight]) };
        }
        if (query.origin_iata === 'DAD' && query.dest_iata === 'SGN') {
          return { exec: () => Promise.resolve([leg2Flight]) };
        }
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-03',
        include_connecting: true,
      } as any);

      expect(mockGraph.findPaths).toHaveBeenCalledTimes(1); // Checked ONCE
      expect(mockValidator.validatePaths).toHaveBeenCalledTimes(3); // Enumerated all 3 dates
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].departure_date).toBe('2026-10-02');
      expect(res.connecting_routes![0].legs[0].flight_number).toBe('VN10');
      expect(res.connecting_routes![0].legs[1].flight_number).toBe('VN20');
    });

    it('Test J: Multiple valid connecting dates -> itineraries from each valid date are returned', async () => {
      const mockGraph = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [{ route_type: 'ONE_STOP', stops: ['DAD'] }],
          coverage: { complete: true },
        }),
      };

      const mockValidator = {
        validatePaths: jest.fn().mockImplementation((_graphRes: any, dateStr: string) => ({
          itineraries: [
            {
              route_type: 'ONE_STOP',
              stops: ['DAD'],
              total_duration_minutes: 200,
              layover_minutes: [60],
              legs: [
                { flight_number: `VN1_${dateStr}`, chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date(`${dateStr}T08:00:00Z`), arr_datetime: new Date(`${dateStr}T09:15:00Z`) },
                { flight_number: `VN2_${dateStr}`, chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date(`${dateStr}T10:15:00Z`), arr_datetime: new Date(`${dateStr}T11:30:00Z`) },
              ],
            },
          ],
          coverage: { complete: true },
        })),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraph as any,
        mockValidator as any,
      );

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        if (query.origin_iata?.$in && query.dest_iata?.$in) {
          return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
        }
        const isHan = query.origin_iata === 'HAN';
        const flightNumber = isHan ? 'VN1_' : 'VN2_';
        const depTimeStr = isHan ? '08:00:00Z' : '10:15:00Z';
        const arrTimeStr = isHan ? '09:15:00Z' : '11:30:00Z';
        const execFn = () =>
          Promise.resolve([
            {
              _id: `f_${query.origin_iata}_2026-10-01`,
              flight_number: `${flightNumber}2026-10-01`,
              origin_iata: query.origin_iata,
              dest_iata: query.dest_iata,
              departure_date: '2026-10-01',
              scheduled_departure: new Date(`2026-10-01T${depTimeStr}`),
              scheduled_arrival: new Date(`2026-10-01T${arrTimeStr}`),
              duration_minutes: 75,
              inventories: [{ _id: 'i1', available_seats: 10, base_price: 500 }],
            },
            {
              _id: `f_${query.origin_iata}_2026-10-02`,
              flight_number: `${flightNumber}2026-10-02`,
              origin_iata: query.origin_iata,
              dest_iata: query.dest_iata,
              departure_date: '2026-10-02',
              scheduled_departure: new Date(`2026-10-02T${depTimeStr}`),
              scheduled_arrival: new Date(`2026-10-02T${arrTimeStr}`),
              duration_minutes: 75,
              inventories: [{ _id: 'i2', available_seats: 10, base_price: 500 }],
            },
          ]);
        return {
          sort: () => ({ exec: execFn }),
          exec: execFn,
        };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-02',
        include_connecting: true,
      } as any);

      expect(res.connecting_routes!.length).toBe(2);
      const dates = res.connecting_routes!.map((r: any) => r.departure_date);
      expect(dates).toContain('2026-10-01');
      expect(dates).toContain('2026-10-02');
    });

    it('Test K: Duplicate concrete leg combination is not returned twice after merging dates', async () => {
      const mockGraph = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [{ route_type: 'ONE_STOP', stops: ['DAD'] }],
          coverage: { complete: true },
        }),
      };

      // Both dates return itineraries referencing the EXACT SAME concrete flight IDs
      const mockValidator = {
        validatePaths: jest.fn().mockImplementation((_graphRes: any, _dateStr: string) => ({
          itineraries: [
            {
              route_type: 'ONE_STOP',
              stops: ['DAD'],
              total_duration_minutes: 200,
              layover_minutes: [60],
              legs: [
                { flight_number: 'VN100', chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date('2026-10-01T08:00:00Z'), arr_datetime: new Date('2026-10-01T09:15:00Z') },
                { flight_number: 'VN200', chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date('2026-10-01T10:15:00Z'), arr_datetime: new Date('2026-10-01T11:30:00Z') },
              ],
            },
          ],
          coverage: { complete: true },
        })),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraph as any,
        mockValidator as any,
      );

      const f1 = {
        _id: 'f_same_1',
        flight_number: 'VN100',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T09:15:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'i1', available_seats: 10, base_price: 500 }],
      };
      const f2 = {
        _id: 'f_same_2',
        flight_number: 'VN200',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T10:15:00Z'),
        scheduled_arrival: new Date('2026-10-01T11:30:00Z'),
        duration_minutes: 75,
        inventories: [{ _id: 'i2', available_seats: 10, base_price: 500 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        if (query.origin_iata === 'HAN') return { exec: () => Promise.resolve([f1]) };
        if (query.origin_iata === 'DAD') return { exec: () => Promise.resolve([f2]) };
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-02',
        include_connecting: true,
      } as any);

      expect(res.connecting_routes!.length).toBe(1);
    });

    it('Test L: Overnight connection: first leg in range, second leg leaves after midnight -> accepted', async () => {
      const mockGraph = {
        findPaths: jest.fn().mockResolvedValue({
          paths: [{ route_type: 'ONE_STOP', stops: ['DAD'] }],
          coverage: { complete: true },
        }),
      };

      // Leg 1: dep 2026-10-01 22:00, arr 23:30.
      // Leg 2: dep 2026-10-02 01:30 (overnight next day, layover 120 mins).
      const mockValidator = {
        validatePaths: jest.fn().mockReturnValue({
          itineraries: [
            {
              route_type: 'ONE_STOP',
              stops: ['DAD'],
              total_duration_minutes: 270,
              layover_minutes: [120],
              legs: [
                { flight_number: 'VN_NIGHT1', chronology_basis: 'UTC', dep_iata: 'HAN', arr_iata: 'DAD', dep_datetime: new Date('2026-10-01T22:00:00Z'), arr_datetime: new Date('2026-10-01T23:30:00Z') },
                { flight_number: 'VN_NIGHT2', chronology_basis: 'UTC', dep_iata: 'DAD', arr_iata: 'SGN', dep_datetime: new Date('2026-10-02T01:30:00Z'), arr_datetime: new Date('2026-10-02T03:00:00Z') },
              ],
            },
          ],
          coverage: { complete: true },
        }),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        mockGraph as any,
        mockValidator as any,
      );

      const f1 = {
        _id: 'fn1',
        flight_number: 'VN_NIGHT1',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T22:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T23:30:00Z'),
        duration_minutes: 90,
        inventories: [{ _id: 'i1', available_seats: 5, base_price: 500 }],
      };
      const f2 = {
        _id: 'fn2',
        flight_number: 'VN_NIGHT2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-02',
        scheduled_departure: new Date('2026-10-02T01:30:00Z'),
        scheduled_arrival: new Date('2026-10-02T03:00:00Z'),
        duration_minutes: 90,
        inventories: [{ _id: 'i2', available_seats: 5, base_price: 600 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        if (query.origin_iata === 'HAN') return { exec: () => Promise.resolve([f1]) };
        if (query.origin_iata === 'DAD') return { exec: () => Promise.resolve([f2]) };
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-01',
        include_connecting: true,
      } as any);

      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].layover_minutes).toBe(120);
      expect(res.connecting_routes![0].legs[0].departure_date).toBe('2026-10-01');
      expect(res.connecting_routes![0].legs[1].departure_date).toBe('2026-10-02');
    });

    it('Test M: Legacy fallback also uses the range and allows overnight second legs', async () => {
      // service instance without graph services (legacy fallback)
      const leg1 = {
        _id: 'leg1_range',
        flight_number: 'LEGACY1',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        duration_minutes: 60,
        departure_date: '2026-10-02', // middle of range
        scheduled_departure: new Date('2026-10-02T22:30:00Z'),
        scheduled_arrival: new Date('2026-10-02T23:30:00Z'),
        inventories: [{ _id: 'inv1', available_seats: 10, base_price: 500 }],
      };
      const leg2Overnight = {
        _id: 'leg2_overnight',
        flight_number: 'LEGACY2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        duration_minutes: 60,
        departure_date: '2026-10-03', // next calendar date
        scheduled_departure: new Date('2026-10-03T01:00:00Z'), // 90 min layover
        scheduled_arrival: new Date('2026-10-03T02:00:00Z'),
        inventories: [{ _id: 'inv2', available_seats: 10, base_price: 500 }],
      };

      flightModel.exec
        .mockResolvedValueOnce([]) // direct onward
        .mockResolvedValueOnce([leg1]) // leg1 query using date range filter
        .mockResolvedValueOnce([leg2Overnight]); // leg2 query based on scheduled_departure window

      const res = await service.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-01',
        departure_date_end: '2026-10-03',
      } as any);

      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].layover_minutes).toBe(90);
      expect(res.connecting_routes![0].leg1.flight_number).toBe('LEGACY1');
      expect(res.connecting_routes![0].leg2.flight_number).toBe('LEGACY2');
    });
  });

  describe('Emergency flight cancellation (cancelBookingsForFlight)', () => {
    const flightId = 'flight_emergency_123';
    const mockFlightDoc: any = {
      _id: flightId,
      flight_number: 'VN123',
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      status: FlightStatus.SCHEDULED,
      save: jest.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
      jest.spyOn(service, 'updateAvailableSeats').mockResolvedValue(true);
    });

    it('Scenario A: BLOCKED booking is cancelled, seats released, NO refund transaction, SkyMiles untouched, coupons CANCELLED', async () => {
      const mockBlockedBooking: any = {
        _id: 'b_blocked_1',
        pnr_code: 'PNRBLK1',
        blocking_number: 'BLK-123456',
        user_id: 'user_123',
        status: BookingStatus.BLOCKED,
        total_amount: 1500000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'AN', last_name: 'NGUYEN' }],
        payment_transactions: [],
        ticket_coupons: [
          {
            coupon_number: 'CPN1',
            flight_id: flightId,
            inventory_id: 'inv_1',
            coupon_status: 'ACTIVE',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockBlockedBooking]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(1);
      expect(mockBlockedBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockBlockedBooking.cancellation_number).toMatch(/^CAN-/);
      expect(service.updateAvailableSeats).toHaveBeenCalledWith(flightId, 'inv_1', 1);
      expect(mockBlockedBooking.payment_transactions).toHaveLength(0);
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(mockBlockedBooking.total_miles_accrued).toBe(0);
      expect(mockBlockedBooking.ticket_coupons[0].coupon_status).toBe('CANCELLED');
      expect(mockBlockedBooking.save).toHaveBeenCalled();
    });

    it('Scenario B: CONFIRMED booking is cancelled, seats released, full refund transaction created, SkyMiles deducted once, total_miles_accrued reset to 0, coupons CANCELLED', async () => {
      const mockConfirmedBooking: any = {
        _id: 'b_confirmed_1',
        pnr_code: 'PNRCNF1',
        confirmation_number: 'CNF-654321',
        user_id: 'user_456',
        status: BookingStatus.CONFIRMED,
        total_amount: 2500000,
        total_miles_accrued: 750,
        passengers: [
          { first_name: 'BINH', last_name: 'TRAN' },
          { first_name: 'CUONG', last_name: 'TRAN' },
        ],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 2500000,
            card_masked: '**** **** **** 1234',
            status: 'SUCCESS',
            created_at: new Date('2026-09-01'),
          },
        ],
        ticket_coupons: [
          {
            coupon_number: 'CPN_B',
            flight_id: flightId,
            inventory_id: 'inv_2',
            coupon_status: 'ACTIVE',
          },
          {
            coupon_number: 'CPN_C',
            flight_id: flightId,
            inventory_id: 'inv_2',
            coupon_status: 'ACTIVE',
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockConfirmedBooking]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(1);
      expect(mockConfirmedBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockConfirmedBooking.cancellation_number).toMatch(/^CAN-/);
      // Seats deduplicated per (flight_id, inventory_id) pair -> passengerCount = 2
      expect(service.updateAvailableSeats).toHaveBeenCalledTimes(1);
      expect(service.updateAvailableSeats).toHaveBeenCalledWith(flightId, 'inv_2', 2);
      // Full refund transaction created with original card
      expect(mockConfirmedBooking.payment_transactions).toHaveLength(2);
      const refundTx = mockConfirmedBooking.payment_transactions[1];
      expect(refundTx.transaction_type).toBe('REFUND');
      expect(refundTx.amount).toBe(2500000);
      expect(refundTx.card_masked).toBe('**** **** **** 1234');
      expect(refundTx.status).toBe('SUCCESS');
      // SkyMiles deducted exactly once and reset
      expect(usersService.deductSkyMiles).toHaveBeenCalledTimes(1);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user_456', 750);
      expect(mockConfirmedBooking.total_miles_accrued).toBe(0);
      // All coupons marked CANCELLED
      expect(mockConfirmedBooking.ticket_coupons[0].coupon_status).toBe('CANCELLED');
      expect(mockConfirmedBooking.ticket_coupons[1].coupon_status).toBe('CANCELLED');
      expect(mockConfirmedBooking.save).toHaveBeenCalled();
    });

    it('Scenario C: Already CANCELLED bookings are skipped without duplicate processing', async () => {
      const mockAlreadyCancelledBooking: any = {
        _id: 'b_already_cancelled',
        pnr_code: 'PNRCAN1',
        status: BookingStatus.CANCELLED,
        total_amount: 1000000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'HOA', last_name: 'LE' }],
        payment_transactions: [{ transaction_type: 'REFUND', amount: 1000000 }],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_1', coupon_status: 'CANCELLED' }],
        save: jest.fn(),
      };

      bookingModel.exec.mockResolvedValueOnce([mockAlreadyCancelledBooking]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(0);
      expect(service.updateAvailableSeats).not.toHaveBeenCalled();
      expect(usersService.deductSkyMiles).not.toHaveBeenCalled();
      expect(mockAlreadyCancelledBooking.save).not.toHaveBeenCalled();
    });

    it('Scenario D: Failure resilience (seat release or SkyMiles error does not crash cancellation batch)', async () => {
      jest.spyOn(service, 'updateAvailableSeats').mockRejectedValueOnce(new Error('Flight deleted'));
      usersService.deductSkyMiles.mockRejectedValueOnce(new Error('User service temporary error'));

      const mockResilientBooking: any = {
        _id: 'b_resilient_1',
        pnr_code: 'PNRRES1',
        user_id: 'user_err',
        status: BookingStatus.CONFIRMED,
        total_amount: 500000,
        total_miles_accrued: 200,
        passengers: [{ first_name: 'DUNG', last_name: 'VU' }],
        payment_transactions: [],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_fail', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockResilientBooking]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(1);
      expect(mockResilientBooking.status).toBe(BookingStatus.CANCELLED);
      expect(mockResilientBooking.cancellation_number).toMatch(/^CAN-/);
      expect(mockResilientBooking.ticket_coupons[0].coupon_status).toBe('CANCELLED');
      expect(mockResilientBooking.save).toHaveBeenCalled();
    });
  });
});
