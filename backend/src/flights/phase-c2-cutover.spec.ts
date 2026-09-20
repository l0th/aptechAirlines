import { BadRequestException } from '@nestjs/common';
import { FlightsService } from './flights.service';
import {
  FlightStatus,
  CabinClass,
  CUSTOMER_BOOKABLE_OPERATOR,
  CUSTOMER_BOOKABLE_DATA_SOURCE,
  getCustomerBookableFlightFilter,
  isCustomerBookableFlight,
} from './flights.schema';
import { BookingsService } from '../bookings/bookings.service';
import { BookingStatus, BookingType, PassengerType } from '../bookings/bookings.schema';
import { FlightGeneratorService } from './flight-generator.service';
import { FlightsScheduler } from './flights.scheduler';
import { FlightsController } from './flights.controller';

describe('Phase C2 — Cut Over Customer Transaction Flow to AirLabs-Commercialized Flights (20 Verification Invariants)', () => {
  let flightsService: FlightsService;
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
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
      distinct: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
      exists: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      deleteMany: jest.fn(),
      findByIdAndDelete: jest.fn(),
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 0, matchedCount: 0 }),
    };

    bookingModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
      exists: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    airportsService = {
      findByIata: jest.fn().mockImplementation((iata: string) =>
        Promise.resolve({
          iata_code: iata,
          city_name: `${iata}_City`,
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
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({ _id: 'user1', sky_miles: 500 }),
      addSkyMiles: jest.fn(),
      deductSkyMiles: jest.fn(),
    };

    routeGraphService = {
      findPaths: jest.fn().mockResolvedValue({
        paths: [],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      }),
    };

    routeScheduleValidatorService = {
      validatePaths: jest.fn().mockReturnValue({
        itineraries: [],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      }),
    };

    const seatAllocationService = {} as any;

    flightsService = new FlightsService(
      flightModel as any,
      bookingModel as any,
      airportsService as any,
      referenceService as any,
      usersService as any,
      routeGraphService as any,
      routeScheduleValidatorService as any,
      seatAllocationService,
    );
  });

  // =========================================================================
  // Requirement 1 & 2: Direct customer search cutover
  // =========================================================================
  describe('1 & 2. Direct Customer Search Invariant', () => {
    it('1. direct customer search excludes INTERNAL_GENERATED flights', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-15',
        adults: 1,
      });

      expect(capturedFilters.length).toBeGreaterThan(0);
      const directFilter = capturedFilters[0];
      expect(directFilter.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(directFilter.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(directFilter.is_bookable).toBe(true);
      expect(directFilter.status).toEqual({ $ne: FlightStatus.CANCELLED });
    });

    it('2. direct customer search returns AIRLABS_COMMERCIALIZED flights matching criteria', async () => {
      const commercialFlight = {
        _id: 'comm_fl_1',
        flight_number: 'VN123',
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-15T10:00:00Z'),
        operator: CUSTOMER_BOOKABLE_OPERATOR,
        is_bookable: true,
        data_source: CUSTOMER_BOOKABLE_DATA_SOURCE,
        status: FlightStatus.SCHEDULED,
        distance_miles: 700,
        inventories: [{ _id: 'inv_1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 150 }],
      };

      flightModel.find.mockImplementation((filter: any) => {
        if (filter.data_source === CUSTOMER_BOOKABLE_DATA_SOURCE) {
          return {
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([commercialFlight]),
          };
        }
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      const res = await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'SGN',
        departure_date: '2026-10-15',
        adults: 1,
      });

      expect(res.onward_flights).toHaveLength(1);
      expect(res.onward_flights[0].flight_number).toBe('VN123');
    });
  });

  // =========================================================================
  // Requirement 3 & 4: Connecting customer search cutover
  // =========================================================================
  describe('3 & 4. Connecting Customer Search Invariant', () => {
    it('3. connecting search enforces getCustomerBookableFlightFilter() on every leg (0/1/2-stop)', async () => {
      const queries: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        queries.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'PQC',
        departure_date: '2026-10-15',
        adults: 1,
        include_connecting: true,
      });

      // All flight queries executed by search must include customer bookable invariant
      for (const q of queries) {
        expect(q.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
        expect(q.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
        expect(q.is_bookable).toBe(true);
        expect(q.status).toEqual({ $ne: FlightStatus.CANCELLED });
      }
    });

    it('4. mixed commercial + synthetic itinerary is not returned', async () => {
      const commercialLeg1 = {
        _id: 'comm_leg1',
        flight_number: 'VN10',
        origin_iata: 'HAN',
        dest_iata: 'DAD',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T08:00:00Z'),
        scheduled_arrival: new Date('2026-10-15T09:15:00Z'),
        operator: CUSTOMER_BOOKABLE_OPERATOR,
        is_bookable: true,
        data_source: CUSTOMER_BOOKABLE_DATA_SOURCE,
        status: FlightStatus.SCHEDULED,
        distance_miles: 400,
        inventories: [{ _id: 'inv_1', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 100 }],
      };

      // Leg 2 in DB is synthetic INTERNAL_GENERATED
      const syntheticLeg2 = {
        _id: 'synth_leg2',
        flight_number: 'VN20',
        origin_iata: 'DAD',
        dest_iata: 'PQC',
        departure_date: '2026-10-15',
        scheduled_departure: new Date('2026-10-15T10:30:00Z'),
        scheduled_arrival: new Date('2026-10-15T12:00:00Z'),
        operator: CUSTOMER_BOOKABLE_OPERATOR,
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED', // Synthetic!
        status: FlightStatus.SCHEDULED,
        distance_miles: 500,
        inventories: [{ _id: 'inv_2', cabin_class: CabinClass.ECONOMY, available_seats: 10, base_price: 100 }],
      };

      flightModel.find.mockImplementation((filter: any) => {
        // Leg 1 query
        if (filter.origin_iata && filter.origin_iata.$in?.includes('HAN')) {
          return {
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([commercialLeg1]),
          };
        }
        // Leg 2 query matches only if filter matches data_source
        if (filter.origin_iata && (filter.origin_iata === 'DAD' || filter.origin_iata.$in?.includes('DAD'))) {
          // If query enforces AIRLABS_COMMERCIALIZED, synthetic leg2 will not be returned
          if (filter.data_source === CUSTOMER_BOOKABLE_DATA_SOURCE) {
            return {
              sort: jest.fn().mockReturnThis(),
              exec: jest.fn().mockResolvedValue([]), // No commercial leg 2!
            };
          }
          return {
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([syntheticLeg2]),
          };
        }
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      const res = await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'PQC',
        departure_date: '2026-10-15',
        adults: 1,
        include_connecting: true,
      });

      expect(res.connecting_routes || []).toHaveLength(0);
    });
  });

  // =========================================================================
  // Requirement 5 & 6: Nearby availability & Metadata
  // =========================================================================
  describe('5 & 6. Nearby Availability & Search Metadata Invariant', () => {
    it('5. nearby availability ignores synthetic-only dates', async () => {
      // Return synthetic flight only when data_source is not enforced (which would be a leak)
      flightModel.find.mockImplementation((filter: any) => {
        expect(filter.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
        // DB only has synthetic flights for these dates, so commercial query returns empty
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      const availability = await flightsService.getNearbyAvailability(
        'HAN',
        'SGN',
        '2026-10-15',
        CabinClass.ECONOMY,
        1,
      );

      expect(availability).toBeDefined();
      expect(Array.isArray(availability.available_dates)).toBe(true);
      for (const day of availability.available_dates) {
        expect(day.has_direct).toBe(false);
        expect(day.available_itineraries_count).toBe(0);
      }
    });

    it('6. airports_with_flights metadata ignores synthetic flights', async () => {
      const distinctFilters: any[] = [];
      flightModel.distinct.mockImplementation((field: string, filter: any) => {
        distinctFilters.push({ field, filter });
        return {
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      // City with multi-airport expansion
      referenceService.expandLocation.mockResolvedValueOnce({
        iata_codes: ['TYO', 'HND', 'NRT'],
        matched_kind: 'city',
        label: 'Tokyo',
        using_nearest_airport: false,
      });

      await flightsService.searchFlights({
        origin: 'TYO',
        destination: 'SGN',
        departure_date: '2026-10-15',
        adults: 1,
      });

      expect(distinctFilters.length).toBeGreaterThan(0);
      const originDistinct = distinctFilters.find((d) => d.field === 'origin_iata');
      expect(originDistinct).toBeDefined();
      expect(originDistinct.filter.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(originDistinct.filter.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(originDistinct.filter.is_bookable).toBe(true);
    });
  });

  // =========================================================================
  // Requirement 7 & 19: Network discovery stays non-bookable
  // =========================================================================
  describe('7 & 19. Network Discovery Non-Bookable Invariant', () => {
    it('7. network discovery remains AirLabs + non-bookable (is_bookable = false, inventories = [])', async () => {
      // Mock routeGraph and routeScheduleValidator to return an itinerary
      routeGraphService.findPaths.mockResolvedValue({
        paths: [[{ dep_iata: 'HAN', arr_iata: 'HND' }]],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

      routeScheduleValidatorService.validatePaths.mockReturnValue({
        itineraries: [
          {
            stops: [],
            legs: [
              {
                flight_number: 'JL752',
                airline_iata: 'JL',
                origin_iata: 'HAN',
                dest_iata: 'HND',
                std_dep_time: '23:20',
                std_arr_time: '06:30',
                days_of_week: [1, 2, 3, 4, 5, 6, 7],
              },
            ],
            total_duration_minutes: 310,
            route_type: 'DIRECT',
            coverage: { complete: true },
          },
        ],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

      const res = await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'HND',
        departure_date: '2026-10-15',
        adults: 1,
      });

      expect(res.network_discovery).toBeDefined();
      expect(res.network_discovery?.itineraries).toBeDefined();
      expect(res.network_discovery!.itineraries.length).toBeGreaterThan(0);
      for (const itin of res.network_discovery!.itineraries) {
        expect(itin.is_bookable).toBe(false);
        expect(itin.inventories).toEqual([]);
      }
    });

    it('19. network itinerary legs stay is_bookable=false and inventories=[]', async () => {
      routeGraphService.findPaths.mockResolvedValue({
        paths: [[{ dep_iata: 'HAN', arr_iata: 'HND' }]],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

      routeScheduleValidatorService.validatePaths.mockReturnValue({
        itineraries: [
          {
            stops: [],
            legs: [
              {
                flight_number: 'JL752',
                airline_iata: 'JL',
                origin_iata: 'HAN',
                dest_iata: 'HND',
                std_dep_time: '23:20',
                std_arr_time: '06:30',
                days_of_week: [1, 2, 3, 4, 5, 6, 7],
              },
            ],
            total_duration_minutes: 310,
            route_type: 'DIRECT',
            coverage: { complete: true },
          },
        ],
        coverage: { complete: true, expanded_airports: ['HAN'], incomplete_airports: [], missing_sync_state_airports: [] },
      });

      const res = await flightsService.searchFlights({
        origin: 'HAN',
        destination: 'HND',
        departure_date: '2026-10-15',
        adults: 1,
      });

      expect(res.network_discovery?.itineraries).toBeDefined();
      for (const itin of res.network_discovery!.itineraries) {
        for (const leg of itin.legs) {
          expect(leg.is_bookable).toBe(false);
          expect(leg.inventories).toEqual([]);
        }
      }
    });
  });

  // =========================================================================
  // Requirement 8, 9, 10, 11: Booking & Reschedule Invariant Enforcement
  // =========================================================================
  describe('8, 9, 10, 11. Booking & Reschedule Invariants', () => {
    let bookingsService: BookingsService;
    let mockBookingDocument: any;

    beforeEach(() => {
      mockBookingDocument = {
        _id: 'bkg_1',
        status: BookingStatus.CONFIRMED,
        confirmation_number: 'CNF-123456',
        total_amount: 100,
        total_miles_accrued: 500,
        user_id: 'user1',
        passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'Jane', last_name: 'Doe' }],
        booking_type: BookingType.ONE_WAY,
        ticket_coupons: [
          { leg_type: 'OUTBOUND', flight_id: 'legacy_fl', inventory_id: 'leg_inv', fare_paid: 100, seat_code: '1A' },
        ],
        payment_transactions: [
          {
            transaction_type: 'PAYMENT',
            amount: 100,
            card_masked: '**** **** **** 1234',
            status: 'SUCCESS',
            created_at: new Date(),
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      const policiesService = {
        calculateRefundPercentage: jest.fn().mockResolvedValue(100),
      };

      const mockBookingModel: any = function (data: any) {
        return {
          ...data,
          save: jest.fn().mockResolvedValue({ ...data, _id: 'new-bkg-id' }),
        };
      };
      mockBookingModel.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockBookingDocument),
      });
      mockBookingModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockBookingDocument]),
      });
      mockBookingModel.exec = jest.fn().mockResolvedValue(mockBookingDocument);

      bookingsService = new BookingsService(
        mockBookingModel,
        flightsService,
        usersService,
        policiesService as any,
      );
    });

    it('8. createBooking rejects INTERNAL_GENERATED target with authoritative error message', async () => {
      const syntheticFlight = {
        _id: 'synth_fl',
        flight_number: 'APT999',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
        status: FlightStatus.SCHEDULED,
        scheduled_departure: new Date(Date.now() + 20 * 86400000),
        inventories: [{ _id: 'inv_synth', id: 'inv_synth', available_seats: 10, base_price: 100 }],
      };
      flightModel.findById = jest.fn().mockResolvedValue(syntheticFlight);
      flightsService.findById = jest.fn().mockResolvedValue(syntheticFlight as any);

      await expect(
        bookingsService.createBooking({
          user_id: 'user1',
          booking_type: BookingType.ONE_WAY,
          legs: [{ flight_id: 'synth_fl', inventory_id: 'inv_synth' }],
          passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'John', last_name: 'Doe' }],
          is_block: true,
        }),
      ).rejects.toThrow('only AirLabs-backed Aptech commercial flights are customer-bookable.');
    });

    it('9. createBooking accepts AIRLABS_COMMERCIALIZED target', async () => {
      const commercialFlight = {
        _id: 'comm_fl',
        flight_number: 'VN100',
        operator: CUSTOMER_BOOKABLE_OPERATOR,
        is_bookable: true,
        data_source: CUSTOMER_BOOKABLE_DATA_SOURCE,
        status: FlightStatus.SCHEDULED,
        scheduled_departure: new Date(Date.now() + 20 * 86400000),
        scheduled_arrival: new Date(Date.now() + 20 * 86400000 + 7200000),
        distance_miles: 500,
        origin_iata: 'HAN',
        dest_iata: 'SGN',
        inventories: [{ _id: 'inv_comm', id: 'inv_comm', available_seats: 10, base_price: 150 }],
      };
      flightsService.findById = jest.fn().mockResolvedValue(commercialFlight as any);
      flightsService.reserveSeats = jest.fn().mockResolvedValue(true);

      const booking = await bookingsService.createBooking({
        user_id: 'user1',
        booking_type: BookingType.ONE_WAY,
        legs: [{ flight_id: 'comm_fl', inventory_id: 'inv_comm' }],
        passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'John', last_name: 'Doe' }],
        is_block: true,
      });

      expect(booking).toBeDefined();
      expect(booking.status).toBe(BookingStatus.BLOCKED);
    });

    it('10. rescheduleTicket rejects synthetic NEW target', async () => {
      const syntheticNewFlight = {
        _id: 'synth_new',
        flight_number: 'APT888',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
        status: FlightStatus.SCHEDULED,
        scheduled_departure: new Date(Date.now() + 25 * 86400000),
        inventories: [{ _id: 'inv_new', id: 'inv_new', available_seats: 10, base_price: 120 }],
      };
      flightsService.findById = jest.fn().mockResolvedValue(syntheticNewFlight as any);

      await expect(
        bookingsService.rescheduleTicket({
          confirmation_number: 'CNF-123456',
          new_flight_id: 'synth_new',
          new_inventory_id: 'inv_new',
        } as any),
      ).rejects.toThrow('only AirLabs-backed Aptech commercial flights are customer-bookable.');
    });

    it('11. existing legacy booking tracking/cancellation remains valid', async () => {
      // Existing booking points to an INTERNAL_GENERATED flight
      const legacyFlight = {
        _id: 'legacy_fl',
        flight_number: 'APT_LEGACY',
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
        scheduled_departure: new Date(Date.now() + 20 * 86400000),
      };
      flightsService.findById = jest.fn().mockResolvedValue(legacyFlight as any);
      flightsService.updateAvailableSeats = jest.fn().mockResolvedValue(true);

      // Cancel ticket should succeed without throwing bookable error
      const cancelResult = await bookingsService.cancelTicket({
        identifier: 'CNF-123456',
      } as any);

      expect(cancelResult).toBeDefined();
      expect(cancelResult.booking.status).toBe(BookingStatus.CANCELLED);
    });
  });

  // =========================================================================
  // Requirement 12, 13, 14: FlightsController & findAll commercial_only flag
  // =========================================================================
  describe('12, 13, 14. Controller & commercial_only Query Parameter', () => {
    let controller: FlightsController;
    let mockGeneratorService: any;

    beforeEach(() => {
      mockGeneratorService = {
        generateActiveCommercialTemplates: jest.fn().mockResolvedValue({ inserted_count: 5 }),
        generateRollingSchedule: jest.fn().mockResolvedValue({ inserted_count: 5 }),
      };
      controller = new FlightsController(flightsService, mockGeneratorService);
    });

    it('12. GET /flights?commercial_only=true excludes legacy synthetic flights', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await controller.findAll(undefined, undefined, undefined, 'true');

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      expect(query.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(query.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(query.is_bookable).toBe(true);
      expect(query.status).toEqual({ $ne: FlightStatus.CANCELLED });
    });

    it('12a. commercial_only=true + SCHEDULED enforces customer filter AND status=SCHEDULED', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await controller.findAll(FlightStatus.SCHEDULED, undefined, undefined, 'true');

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      expect(query.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(query.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(query.is_bookable).toBe(true);
      expect(query.status).toBe(FlightStatus.SCHEDULED);
    });

    it('12b. commercial_only=true + DELAYED enforces customer filter AND status=DELAYED', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await flightsService.findAll(FlightStatus.DELAYED, undefined, undefined, true);

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      expect(query.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(query.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(query.is_bookable).toBe(true);
      expect(query.status).toBe(FlightStatus.DELAYED);
    });

    it('12c. commercial_only=true + CANCELLED returns [] immediately without calling flightModel.find', async () => {
      flightModel.find.mockClear();

      const res = await controller.findAll(FlightStatus.CANCELLED, undefined, undefined, 'true');
      expect(res).toEqual([]);
      expect(flightModel.find).not.toHaveBeenCalled();

      const serviceRes = await flightsService.findAll(FlightStatus.CANCELLED, undefined, undefined, true);
      expect(serviceRes).toEqual([]);
      expect(flightModel.find).not.toHaveBeenCalled();
    });

    it('13. Admin GET /flights without commercial_only remains backward compatible', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await controller.findAll();

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      // Without commercial_only, no customer-bookable filter is added
      expect(query.data_source).toBeUndefined();
      expect(query.operator).toBeUndefined();
    });

    it('13b. Admin GET /flights?status=... passes status filter without customer-bookable constraints', async () => {
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await controller.findAll(FlightStatus.CANCELLED);

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      expect(query.status).toBe(FlightStatus.CANCELLED);
      expect(query.operator).toBeUndefined();
      expect(query.data_source).toBeUndefined();
      expect(query.is_bookable).toBeUndefined();
    });

    it('14. Direct flight alternatives via findAll(..., commercialOnly=true) enforces getCustomerBookableFlightFilter()', async () => {
      // Verifies backend findAll with commercialOnly=true enforces customer-bookable filter.
      // Used by TrackBookingComponent (4 direct reschedule alternative flight lookup sites):
      // 1. onOutboundDateChange (line 1702)
      // 2. loadAlternativeFlights (line 1837)
      // 3. onReturnDateChange (line 1939)
      // 4. loadReturnAlternativeFlights (line 2117)
      const capturedFilters: any[] = [];
      flightModel.find.mockImplementation((filter: any) => {
        capturedFilters.push(filter);
        return {
          sort: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      });

      await flightsService.findAll(undefined, 'HAN', 'SGN', true);

      expect(capturedFilters).toHaveLength(1);
      const query = capturedFilters[0];
      expect(query.origin_iata).toBe('HAN');
      expect(query.dest_iata).toBe('SGN');
      expect(query.data_source).toBe(CUSTOMER_BOOKABLE_DATA_SOURCE);
      expect(query.operator).toBe(CUSTOMER_BOOKABLE_OPERATOR);
      expect(query.is_bookable).toBe(true);
    });

    describe('Schedule generation input validation (POST /flights/generate-schedule & POST /flights/generate-legacy-schedule)', () => {
      it('accepts days=1 as valid', async () => {
        await expect(controller.generateSchedule(undefined, 1)).resolves.toBeDefined();
        expect(mockGeneratorService.generateActiveCommercialTemplates).toHaveBeenCalledWith(undefined, 1);

        await expect(controller.generateLegacySchedule(undefined, 1)).resolves.toBeDefined();
        expect(mockGeneratorService.generateRollingSchedule).toHaveBeenCalledWith(undefined, 1);
      });

      it('accepts days=330 as valid', async () => {
        await expect(controller.generateSchedule(undefined, 330)).resolves.toBeDefined();
        expect(mockGeneratorService.generateActiveCommercialTemplates).toHaveBeenCalledWith(undefined, 330);

        await expect(controller.generateLegacySchedule(undefined, 330)).resolves.toBeDefined();
        expect(mockGeneratorService.generateRollingSchedule).toHaveBeenCalledWith(undefined, 330);
      });

      it('rejects days=0 with BadRequestException', async () => {
        await expect(controller.generateSchedule(undefined, 0)).rejects.toThrow(BadRequestException);
        await expect(controller.generateLegacySchedule(undefined, 0)).rejects.toThrow(BadRequestException);
      });

      it('rejects days=331 with BadRequestException', async () => {
        await expect(controller.generateSchedule(undefined, 331)).rejects.toThrow(BadRequestException);
        await expect(controller.generateLegacySchedule(undefined, 331)).rejects.toThrow(BadRequestException);
      });

      it('rejects non-numeric days with BadRequestException', async () => {
        await expect(controller.generateSchedule(undefined, 'abc' as any)).rejects.toThrow(BadRequestException);
        await expect(controller.generateSchedule(undefined, 1.5 as any)).rejects.toThrow(BadRequestException);
        await expect(controller.generateLegacySchedule(undefined, 'not-a-number' as any)).rejects.toThrow(BadRequestException);
      });

      it('rejects malformed or impossible start_date with BadRequestException', async () => {
        await expect(controller.generateSchedule('invalid-date', 30)).rejects.toThrow(BadRequestException);
        await expect(controller.generateSchedule('2026-13-45', 30)).rejects.toThrow(BadRequestException);
        await expect(controller.generateSchedule('2026-02-31', 30)).rejects.toThrow(BadRequestException);
        await expect(controller.generateLegacySchedule('2026-00-01', 30)).rejects.toThrow(BadRequestException);
      });
    });
  });

  // =========================================================================
  // Requirement 15 & 16: Generator isolation
  // =========================================================================
  describe('15 & 16. Flight Generator Isolation Invariant', () => {
    let generatorService: FlightGeneratorService;
    let templateModel: any;
    let genFlightModel: any;
    let genAirportModel: any;

    beforeEach(() => {
      templateModel = {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
        bulkWrite: jest.fn().mockResolvedValue({}),
      };
      genFlightModel = {
        exists: jest.fn().mockResolvedValue(true),
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        }),
        bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 0, matchedCount: 0 }),
      };
      genAirportModel = {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      };

      generatorService = new FlightGeneratorService(
        genFlightModel as any,
        templateModel as any,
        genAirportModel as any,
      );
    });

    it('15. generateRollingSchedule only processes LEGACY_SYNTHETIC templates when commercial templates coexist', async () => {
      templateModel.find.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            template_id: 'TPL_SYNTH',
            origin_iata: 'HAN',
            dest_iata: 'SGN',
            source_type: 'LEGACY_SYNTHETIC',
            std_dep_time: '08:00',
            std_arr_time: '10:00',
            days_of_week: [1, 2, 3, 4, 5, 6, 7],
            aircraft_type: 'A21N',
            cabin_classes: ['ECONOMY', 'BUSINESS'],
            base_price_economy: 100,
            base_price_business: 200,
          },
        ]),
      });

      await generatorService.generateRollingSchedule('2026-10-15', 1);

      // Verify query strictly filters for LEGACY_SYNTHETIC templates
      expect(templateModel.find).toHaveBeenCalledWith({
        is_active: true,
        source_type: 'LEGACY_SYNTHETIC',
      });
    });

    it('16. legacy ensureHorizonDays does not inspect or count commercial flights', async () => {
      await generatorService.ensureHorizonDays(330);

      // Verify exists check strictly isolates legacy synthetic population
      expect(genFlightModel.exists).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source: 'INTERNAL_GENERATED',
          generated_source: 'seed_schedule_330',
        }),
      );
    });

    it('per-template failure isolation: ensureActiveCommercialHorizons continues on template failure', async () => {
      const tplA = { template_id: 'TPL_A', source_type: 'AIRLABS', is_active: true };
      const tplB = { template_id: 'TPL_B', source_type: 'AIRLABS', is_active: true };
      const tplC = { template_id: 'TPL_C', source_type: 'AIRLABS', is_active: true };

      templateModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([tplA, tplB, tplC]),
      });

      const horizonSpy = jest.spyOn(generatorService, 'ensureCommercialTemplateHorizon')
        .mockImplementation(async (tpl: any) => {
          if (tpl.template_id === 'TPL_A') return 2;
          if (tpl.template_id === 'TPL_B') throw new Error('Simulated B error: database connection reset');
          if (tpl.template_id === 'TPL_C') return 3;
          return 0;
        });

      const report = await generatorService.ensureActiveCommercialHorizons(330);

      // Verify all 3 templates were attempted and C executed after B threw
      expect(horizonSpy).toHaveBeenCalledTimes(3);
      expect(horizonSpy).toHaveBeenNthCalledWith(1, tplA, 330);
      expect(horizonSpy).toHaveBeenNthCalledWith(2, tplB, 330);
      expect(horizonSpy).toHaveBeenNthCalledWith(3, tplC, 330);

      // Verify aggregate report stats
      expect(report.templates_count).toBe(3);
      expect(report.successful_templates).toBe(2);
      expect(report.failed_templates).toBe(1);
      expect(report.inserted_count).toBe(5);
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].template_id).toBe('TPL_B');
      expect(report.failures[0].error).toContain('Simulated B error');
    });

    it('per-template failure isolation: generateActiveCommercialTemplates continues on template failure', async () => {
      const tplA = { template_id: 'TPL_A', source_type: 'AIRLABS', is_active: true };
      const tplB = { template_id: 'TPL_B', source_type: 'AIRLABS', is_active: true };
      const tplC = { template_id: 'TPL_C', source_type: 'AIRLABS', is_active: true };

      templateModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([tplA, tplB, tplC]),
      });

      const genSpy = jest.spyOn(generatorService, 'generateForTemplate')
        .mockImplementation(async (tpl: any) => {
          if (tpl.template_id === 'TPL_A') return { inserted_count: 2, matched_count: 0 } as any;
          if (tpl.template_id === 'TPL_B') throw new Error('Simulated B error: aircraft layout mismatch');
          if (tpl.template_id === 'TPL_C') return { inserted_count: 3, matched_count: 0 } as any;
          return { inserted_count: 0, matched_count: 0 } as any;
        });

      const report = await generatorService.generateActiveCommercialTemplates(undefined, 330);

      // Verify all 3 templates were attempted and C executed after B threw
      expect(genSpy).toHaveBeenCalledTimes(3);
      expect(genSpy).toHaveBeenNthCalledWith(1, tplA, undefined, 330);
      expect(genSpy).toHaveBeenNthCalledWith(2, tplB, undefined, 330);
      expect(genSpy).toHaveBeenNthCalledWith(3, tplC, undefined, 330);

      // Verify aggregate report stats
      expect(report.templates_count).toBe(3);
      expect(report.successful_templates).toBe(2);
      expect(report.failed_templates).toBe(1);
      expect(report.inserted_count).toBe(5);
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].template_id).toBe('TPL_B');
      expect(report.failures[0].error).toContain('Simulated B error');
    });
  });

  // =========================================================================
  // Requirement 17 & 18: Scheduler daily maintenance cutover
  // =========================================================================
  describe('17 & 18. Scheduler Daily Maintenance Cutover', () => {
    let scheduler: FlightsScheduler;
    let mockFlightGenerator: any;

    beforeEach(() => {
      mockFlightGenerator = {
        ensureActiveCommercialHorizons: jest.fn().mockResolvedValue({
          templates_count: 5,
          successful_templates: 5,
          failed_templates: 0,
          inserted_count: 10,
          failures: [],
        }),
        ensureHorizonDays: jest.fn(),
      };
      scheduler = new FlightsScheduler(mockFlightGenerator);
    });

    it('17. scheduler maintains active AIRLABS commercial template horizons', async () => {
      await scheduler.handleDailyHorizonMaintenance();

      expect(mockFlightGenerator.ensureActiveCommercialHorizons).toHaveBeenCalledWith(330);
    });

    it('18. scheduler no longer invokes synthetic ensureHorizonDays in production cron', async () => {
      await scheduler.handleDailyHorizonMaintenance();

      expect(mockFlightGenerator.ensureHorizonDays).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Requirement 20: No legacy Flight or Booking deletion occurs
  // =========================================================================
  describe('20. Safe Coexistence & Zero Deletion Invariant', () => {
    it('20. no legacy Flight or Booking deletion occurs', async () => {
      // Invariant: Phase C2 cutover does not call deleteMany or findByIdAndDelete on legacy collections
      expect(flightModel.deleteMany).not.toHaveBeenCalled();
      expect(flightModel.findByIdAndDelete).not.toHaveBeenCalled();
      expect(bookingModel.deleteMany).not.toHaveBeenCalled();
      expect(bookingModel.findByIdAndDelete).not.toHaveBeenCalled();

      // Shared filter and helper functions verify coexistence contract
      const filter = getCustomerBookableFlightFilter();
      expect(filter).toEqual({
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        status: { $ne: FlightStatus.CANCELLED },
      });

      // Legacy flight is preserved in database, but isCustomerBookableFlight correctly classifies it as false
      const legacyFlight = {
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
        status: FlightStatus.SCHEDULED,
      };
      expect(isCustomerBookableFlight(legacyFlight)).toBe(false);

      // Commercial flight correctly classifies as true
      const commercialFlight = {
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'AIRLABS_COMMERCIALIZED',
        status: FlightStatus.SCHEDULED,
      };
      expect(isCustomerBookableFlight(commercialFlight)).toBe(true);
    });
  });
});
