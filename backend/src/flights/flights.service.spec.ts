import { Test, TestingModule } from '@nestjs/testing';
import { FlightsService } from './flights.service';
import { getModelToken } from '@nestjs/mongoose';
import { Flight } from './flights.schema';
import { Booking } from '../bookings/bookings.schema';
import { AirportsService } from '../airports/airports.service';
import { BadRequestException } from '@nestjs/common';
import { FlightStatus } from './flights.schema';

describe('FlightsService', () => {
  let service: FlightsService;
  let flightModel: any;
  let bookingModel: any;
  let airportsService: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        { provide: getModelToken(Flight.name), useValue: flightModel },
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: AirportsService, useValue: airportsService },
      ],
    }).compile();

    service = module.get<FlightsService>(FlightsService);
  });

  describe('searchFlights / findDirectFlights pricing', () => {
    const mockDate = '2025-01-01';

    it('adult 100%, child 75%, senior 85%, total_party_price calculation', async () => {
      const mockFlight = {
        _id: 'f1',
        flight_number: 'FL1',
        status: FlightStatus.SCHEDULED,
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
        inventories: [{ _id: 'i1', id: 'i1', available_seats: 10, base_price: 1000 }],
      };
      const mockFlight2 = {
        _id: 'f2',
        flight_number: 'FL2',
        status: FlightStatus.SCHEDULED,
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
        scheduled_arrival: new Date('2025-01-01T10:00:00Z'), // Arrives 10:00
        inventories: [{ _id: 'i1', available_seats: 10 }],
      };
      // Mock leg 2: DAD -> SGN
      const leg2Valid = { // Layover = 60 mins (between 45 and 720)
        _id: 'f2',
        flight_number: 'FL2',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        duration_minutes: 60,
        scheduled_departure: new Date('2025-01-01T11:00:00Z'),
        inventories: [{ _id: 'i2', available_seats: 10 }],
      };
      const leg2TooShort = { // Layover = 30 mins
        _id: 'f3',
        flight_number: 'FL3',
        origin_iata: 'DAD',
        dest_iata: 'SGN',
        duration_minutes: 60,
        scheduled_departure: new Date('2025-01-01T10:30:00Z'),
        inventories: [{ _id: 'i3', available_seats: 10 }],
      };

      // Mock exec to return direct=[] on first call, leg1 on second, leg2s on third
      flightModel.exec
        .mockResolvedValueOnce([]) // direct
        .mockResolvedValueOnce([leg1]) // leg1 search
        .mockResolvedValueOnce([leg2Valid, leg2TooShort]); // leg2 search

      const res = await service.searchFlights({ origin: 'HAN', destination: 'SGN', departure_date: '2025-01-01' } as any);
      
      expect(res.connecting_routes!.length).toBe(1);
      expect(res.connecting_routes![0].layover_minutes).toBe(60);
      expect(res.connecting_routes![0].total_duration_minutes).toBe(180); // 60 + 60 + 60
      expect(res.connecting_routes![0].transit_airport).toBe('DAD');
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
});
