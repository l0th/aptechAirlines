import { Test, TestingModule } from '@nestjs/testing';
import { FlightsService } from './flights.service';
import { getModelToken } from '@nestjs/mongoose';
import { Flight } from './flights.schema';
import { Booking, BookingStatus } from '../bookings/bookings.schema';
import { AirportsService } from '../airports/airports.service';
import { BadRequestException } from '@nestjs/common';
import { FlightStatus, CabinClass } from './flights.schema';
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
      lean: jest.fn().mockReturnThis(),
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
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve({ _id: id, sky_miles: 1000 })),
      deductSkyMiles: jest.fn().mockResolvedValue(true),
      setSkyMiles: jest.fn().mockResolvedValue(true),
      addSkyMiles: jest.fn().mockResolvedValue(true),
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

    it('production DI: executes database connecting engine without invoking findPaths even when RouteGraph services are injected', async () => {
      const mockGraphService = {
        findPaths: jest.fn().mockResolvedValue({ paths: [] }),
      };

      const mockValidatorService = {
        validatePaths: jest.fn().mockReturnValue({ itineraries: [] }),
      };

      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i2', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 600 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f1]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f2]) };
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });
      flightModel.exec.mockResolvedValue([]);

      const res = await svc.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      expect(mockGraphService.findPaths).not.toHaveBeenCalled();
      expect(mockValidatorService.validatePaths).not.toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].transit_airport).toBe('DAD');
      expect(res.connecting_routes![0].legs[0].flight_number).toBe('VN1');
      expect(res.connecting_routes![0].legs[0].flight_id).toBe('f1');
    });

    it('does not expose connecting routes when connecting flights have no available seats or are cancelled', async () => {
      const graph = { findPaths: jest.fn().mockResolvedValue({ paths: [] }) };
      const validator = { validatePaths: jest.fn().mockReturnValue({ itineraries: [] }) };
      const svc = new FlightsService(flightModel, bookingModel, airportsService, referenceService, usersService, graph as any, validator as any);

      const f1 = {
        _id: 'f1',
        flight_number: 'VN1',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-01T09:15:00Z'),
        duration_minutes: 75,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
      };
      // Leg 2 has 0 seats available
      const f2 = {
        _id: 'f2',
        flight_number: 'VN2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        departure_date: '2026-10-01',
        scheduled_departure: new Date('2026-10-01T10:15:00Z'),
        scheduled_arrival: new Date('2026-10-01T11:30:00Z'),
        duration_minutes: 75,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i2', cabin_class: CabinClass.ECONOMY, available_seats: 0, base_price: 600 }],
      };

      flightModel.find.mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f1]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f2]) };
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });

      const result = await (svc as any).findConnectingRoutes(['HAN'], ['SGN'], '2026-10-01', 1, 1, 0, 0);
      expect(result).toEqual([]);
      expect(graph.findPaths).not.toHaveBeenCalled();
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

    it('proves customer connecting search uses database flights and never calls RouteGraph findPaths', async () => {
      const mockGraphService = {
        findPaths: jest.fn().mockResolvedValue({ paths: [] }),
      };
      const mockValidatorService = {
        validatePaths: jest.fn().mockReturnValue({ itineraries: [] }),
      };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
        mockGraphService as any,
        mockValidatorService as any,
      );

      const leg1 = {
        _id: 'leg1', flight_number: 'APT101', origin_iata: 'HAN', dest_iata: 'DAD',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T08:00:00Z'), scheduled_arrival: new Date('2026-10-01T09:00:00Z'),
        operator: 'APTECH_AIRLINES', is_bookable: true, status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'inv1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 100 }],
      };
      const leg2 = {
        _id: 'leg2', flight_number: 'APT102', origin_iata: 'DAD', dest_iata: 'SGN',
        departure_date: '2026-10-01', scheduled_departure: new Date('2026-10-01T10:30:00Z'), scheduled_arrival: new Date('2026-10-01T11:45:00Z'),
        operator: 'APTECH_AIRLINES', is_bookable: true, status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'inv2', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 120 }],
      };

      flightModel.find.mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg1]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg2]) };
        return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([]) };
      });

      const res = await svc.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2026-10-01' } as any);
      expect(mockGraphService.findPaths).not.toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].transit_airport).toBe('DAD');
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
        aircraft: {
          model_code: 'A20N',
          model_name: 'Airbus A320neo',
        },
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

      // Row 1 Seat C should be empty
      const seat1C = row1.seats.find((s: any) => s.column === 'C');
      expect(seat1C.is_occupied).toBe(false);
      
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
    it('Test I: Authoritative database path: range 3 days, valid itinerary only on middle date -> included', async () => {
      const mockGraph = { findPaths: jest.fn() };
      const mockValidator = { validatePaths: jest.fn() };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'inv1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'inv2', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 600 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg1Flight]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([leg2Flight]) };
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

      expect(mockGraph.findPaths).not.toHaveBeenCalled();
      expect(mockValidator.validatePaths).not.toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].departure_date).toBe('2026-10-02');
      expect(res.connecting_routes![0].legs[0].flight_number).toBe('VN10');
      expect(res.connecting_routes![0].legs[1].flight_number).toBe('VN20');
    });

    it('Test J: Multiple valid connecting dates -> itineraries from each valid date are returned', async () => {
      const mockGraph = { findPaths: jest.fn() };
      const mockValidator = { validatePaths: jest.fn() };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
        mockGraph as any,
        mockValidator as any,
      );

      const makeFlights = (dateStr: string) => [
        {
          _id: `f_HAN_${dateStr}`,
          flight_number: `VN1_${dateStr}`,
          origin_iata: 'HAN',
          dest_iata: 'DAD',
          departure_date: dateStr,
          scheduled_departure: new Date(`${dateStr}T08:00:00Z`),
          scheduled_arrival: new Date(`${dateStr}T09:15:00Z`),
          duration_minutes: 75,
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          status: FlightStatus.SCHEDULED,
          inventories: [{ _id: `i1_${dateStr}`, cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
        },
        {
          _id: `f_DAD_${dateStr}`,
          flight_number: `VN2_${dateStr}`,
          origin_iata: 'DAD',
          dest_iata: 'SGN',
          departure_date: dateStr,
          scheduled_departure: new Date(`${dateStr}T10:15:00Z`),
          scheduled_arrival: new Date(`${dateStr}T11:30:00Z`),
          duration_minutes: 75,
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          status: FlightStatus.SCHEDULED,
          inventories: [{ _id: `i2_${dateStr}`, cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
        },
      ];

      const [han1, dad1] = makeFlights('2026-10-01');
      const [han2, dad2] = makeFlights('2026-10-02');

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([han1, han2]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([dad1, dad2]) };
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

      expect(mockGraph.findPaths).not.toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBe(2);
      const dates = res.connecting_routes!.map((r: any) => r.departure_date);
      expect(dates).toContain('2026-10-01');
      expect(dates).toContain('2026-10-02');
    });

    it('Test K: Duplicate concrete leg combination is not returned twice after merging dates', async () => {
      const mockGraph = { findPaths: jest.fn() };
      const mockValidator = { validatePaths: jest.fn() };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i2', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 500 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f1]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f2]) };
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

      expect(mockGraph.findPaths).not.toHaveBeenCalled();
      expect(res.connecting_routes!.length).toBe(1);
    });

    it('Test L: Overnight connection: first leg in range, second leg leaves after midnight -> accepted', async () => {
      const mockGraph = { findPaths: jest.fn() };
      const mockValidator = { validatePaths: jest.fn() };
      const svc = new FlightsService(
        flightModel,
        bookingModel,
        airportsService,
        referenceService,
        usersService,
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i1', cabin_class: CabinClass.ECONOMY, available_seats: 5, base_price: 500 }],
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
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        status: FlightStatus.SCHEDULED,
        inventories: [{ _id: 'i2', cabin_class: CabinClass.ECONOMY, available_seats: 5, base_price: 600 }],
      };

      flightModel.find = jest.fn().mockImplementation((query: any) => {
        const origins = Array.isArray(query.origin_iata?.$in)
          ? query.origin_iata.$in
          : typeof query.origin_iata === 'string'
            ? [query.origin_iata]
            : [];
        if (origins.includes('HAN')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f1]) };
        if (origins.includes('DAD')) return { sort: () => ({ exec: () => Promise.resolve([]) }), exec: () => Promise.resolve([f2]) };
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

      expect(mockGraph.findPaths).not.toHaveBeenCalled();
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

    it('Scenario D1: SkyMiles deduction fails -> booking NOT cancelled, miles not reset, no refund, batch continues', async () => {
      usersService.deductSkyMiles.mockRejectedValueOnce(new Error('SkyMiles deduction service unavailable'));

      const mockBookingFail: any = {
        _id: 'b_fail_1',
        pnr_code: 'PNRFAIL1',
        user_id: 'user_fail',
        status: BookingStatus.CONFIRMED,
        total_amount: 500000,
        total_miles_accrued: 200,
        passengers: [{ first_name: 'DUNG', last_name: 'VU' }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 500000,
            card_masked: '**** **** **** 1111',
            status: 'SUCCESS',
            created_at: new Date('2026-09-01'),
          },
        ],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_fail', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockBookingSuccess: any = {
        _id: 'b_success_1',
        pnr_code: 'PNROK1',
        user_id: 'user_ok',
        status: BookingStatus.BLOCKED,
        total_amount: 800000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'HUY', last_name: 'NGUYEN' }],
        payment_transactions: [],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_ok', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockBookingFail, mockBookingSuccess]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      // Only mockBookingSuccess was finalized
      expect(cancelledCount).toBe(1);

      // Failed booking was rolled back and NOT finalized
      expect(mockBookingFail.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBookingFail.cancellation_number).toBeUndefined();
      expect(mockBookingFail.total_miles_accrued).toBe(200); // Not falsely reset!
      expect(mockBookingFail.payment_transactions).toHaveLength(1); // No refund added!
      expect(mockBookingFail.ticket_coupons[0].coupon_status).toBe('ACTIVE');
      expect(mockBookingFail.save).not.toHaveBeenCalled();

      // Successful booking was finalized
      expect(mockBookingSuccess.status).toBe(BookingStatus.CANCELLED);
      expect(mockBookingSuccess.cancellation_number).toMatch(/^CAN-/);
      expect(mockBookingSuccess.save).toHaveBeenCalled();
    });

    it('Scenario D2: Seat release fails after SkyMiles were deducted -> SkyMiles restored, booking NOT cancelled, batch continues', async () => {
      usersService.findById.mockResolvedValueOnce({ _id: 'user_d2', sky_miles: 800 });
      usersService.deductSkyMiles.mockResolvedValueOnce(true);
      jest.spyOn(service, 'updateAvailableSeats').mockRejectedValueOnce(new Error('Seat inventory update lock timeout'));

      const mockBookingD2: any = {
        _id: 'b_d2',
        pnr_code: 'PNRD2',
        user_id: 'user_d2',
        status: BookingStatus.CONFIRMED,
        total_amount: 1000000,
        total_miles_accrued: 300,
        passengers: [{ first_name: 'NAM', last_name: 'DO' }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 1000000,
            card_masked: '**** **** **** 2222',
            status: 'SUCCESS',
            created_at: new Date('2026-09-01'),
          },
        ],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_d2', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockBookingD2]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(0);
      expect(usersService.deductSkyMiles).toHaveBeenCalledWith('user_d2', 300);
      // SkyMiles restored via setSkyMiles
      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user_d2', 800);
      // Booking state restored
      expect(mockBookingD2.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBookingD2.cancellation_number).toBeUndefined();
      expect(mockBookingD2.total_miles_accrued).toBe(300);
      expect(mockBookingD2.payment_transactions).toHaveLength(1);
      expect(mockBookingD2.ticket_coupons[0].coupon_status).toBe('ACTIVE');
      expect(mockBookingD2.save).not.toHaveBeenCalled();
    });

    it('Scenario D3: Multiple seat inventory pairs: earlier pair released, later pair fails -> released seats restored', async () => {
      const updateSeatsSpy = jest.spyOn(service, 'updateAvailableSeats');
      // First leg release succeeds
      updateSeatsSpy.mockResolvedValueOnce(true);
      // Second leg release fails
      updateSeatsSpy.mockRejectedValueOnce(new Error('Second leg inventory full or offline'));
      // Compensation re-reservation succeeds
      updateSeatsSpy.mockResolvedValueOnce(true);

      const mockMultiLegBooking: any = {
        _id: 'b_multi_1',
        pnr_code: 'PNRMULTI',
        user_id: 'user_d3',
        status: BookingStatus.BLOCKED,
        total_amount: 1200000,
        total_miles_accrued: 0,
        passengers: [{ first_name: 'LAN', last_name: 'HOANG' }],
        payment_transactions: [],
        ticket_coupons: [
          { flight_id: flightId, inventory_id: 'inv_leg_1', coupon_status: 'ACTIVE' },
          { flight_id: 'flight_other_456', inventory_id: 'inv_leg_2', coupon_status: 'ACTIVE' },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      bookingModel.exec.mockResolvedValueOnce([mockMultiLegBooking]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(0);
      // Calls to updateAvailableSeats:
      // 1. Release leg 1 (+1)
      expect(updateSeatsSpy).toHaveBeenNthCalledWith(1, flightId, 'inv_leg_1', 1);
      // 2. Release leg 2 (+1) -> failed
      expect(updateSeatsSpy).toHaveBeenNthCalledWith(2, 'flight_other_456', 'inv_leg_2', 1);
      // 3. Compensation: re-reserve leg 1 (-1)
      expect(updateSeatsSpy).toHaveBeenNthCalledWith(3, flightId, 'inv_leg_1', -1);
      // Booking not saved or modified
      expect(mockMultiLegBooking.status).toBe(BookingStatus.BLOCKED);
      expect(mockMultiLegBooking.cancellation_number).toBeUndefined();
      expect(mockMultiLegBooking.ticket_coupons[0].coupon_status).toBe('ACTIVE');
      expect(mockMultiLegBooking.ticket_coupons[1].coupon_status).toBe('ACTIVE');
      expect(mockMultiLegBooking.save).not.toHaveBeenCalled();
    });

    it('Scenario D4: If booking.save() fails after side effects -> compensate SkyMiles and released seats', async () => {
      usersService.findById.mockResolvedValueOnce({ _id: 'user_d4', sky_miles: 500 });
      usersService.deductSkyMiles.mockResolvedValueOnce(true);

      const mockBookingSaveFail: any = {
        _id: 'b_save_fail',
        pnr_code: 'PNRSAVEFAIL',
        user_id: 'user_d4',
        status: BookingStatus.CONFIRMED,
        total_amount: 700000,
        total_miles_accrued: 100,
        passengers: [{ first_name: 'THU', last_name: 'VU' }],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 700000,
            card_masked: '**** **** **** 3333',
            status: 'SUCCESS',
            created_at: new Date('2026-09-01'),
          },
        ],
        ticket_coupons: [{ flight_id: flightId, inventory_id: 'inv_save_fail', coupon_status: 'ACTIVE' }],
        save: jest.fn().mockRejectedValueOnce(new Error('Mongo network timeout on save')),
      };

      bookingModel.exec.mockResolvedValueOnce([mockBookingSaveFail]);

      const cancelledCount = await service.cancelBookingsForFlight(mockFlightDoc);

      expect(cancelledCount).toBe(0);
      // SkyMiles restored
      expect(usersService.setSkyMiles).toHaveBeenCalledWith('user_d4', 500);
      // Released seats restored (-1)
      expect(service.updateAvailableSeats).toHaveBeenCalledWith(flightId, 'inv_save_fail', -1);
      // In-memory fields restored from snapshot
      expect(mockBookingSaveFail.status).toBe(BookingStatus.CONFIRMED);
      expect(mockBookingSaveFail.cancellation_number).toBeUndefined();
      expect(mockBookingSaveFail.total_miles_accrued).toBe(100);
      expect(mockBookingSaveFail.payment_transactions).toHaveLength(1);
      expect(mockBookingSaveFail.ticket_coupons[0].coupon_status).toBe('ACTIVE');
    });
  });
});
