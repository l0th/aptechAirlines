import { Types } from 'mongoose';
import { CabinClass, FlightStatus } from './flights.schema';
import { FlightsAdminService } from './flights-admin.service';

describe('FlightsAdminService - safe dated-flight CRUD', () => {
  let seatAllocationService: any;
  let bridge: any;
  let service: FlightsAdminService;

  const makeFlight = (overrides: any = {}) => {
    const flight: any = {
      _id: new Types.ObjectId(),
      flight_number: 'AP101',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      departure_date: '2026-10-20',
      scheduled_departure: new Date('2026-10-20T01:00:00.000Z'),
      scheduled_arrival: new Date('2026-10-20T03:00:00.000Z'),
      duration_minutes: 120,
      status: FlightStatus.SCHEDULED,
      delay_reason: '',
      aircraft: { model_code: 'A20N', model_name: 'Airbus A320neo', total_capacity: 180 },
      inventories: [
        {
          cabin_class: CabinClass.BUSINESS,
          allocated_seats: 12,
          available_seats: 12,
          base_price: 2500000,
          bucket_code: 'B',
        },
        {
          cabin_class: CabinClass.ECONOMY,
          allocated_seats: 100,
          available_seats: 90,
          base_price: 1000000,
          bucket_code: 'E',
        },
      ],
      is_manually_modified: false,
      save: jest.fn(),
      ...overrides,
    };
    flight.save.mockImplementation(async () => flight);
    return flight;
  };

  beforeEach(() => {
    seatAllocationService = {
      hasCustomerSeatAssignments: jest.fn().mockResolvedValue(false),
    };
    const airportsService = {
      findByIata: jest.fn().mockResolvedValue({ time_zone: 'Asia/Ho_Chi_Minh' }),
    };
    bridge = {
      findById: jest.fn(),
      cancelBookingsForFlight: jest.fn(),
    };
    service = new FlightsAdminService({
      flightModel: {} as any,
      bookingModel: {} as any,
      airportsService: airportsService as any,
      referenceService: {} as any,
      usersService: {} as any,
      seatAllocationService,
    }, bridge);
  });

  it('preserves sold seats when inventory is edited without resending aircraft', async () => {
    const flight = makeFlight();
    bridge.findById.mockResolvedValue(flight);

    await service.update(String(flight._id), {
      inventories: [{
        cabin_class: CabinClass.ECONOMY,
        allocated_seats: 80,
        available_seats: 80,
        base_price: 1100000,
        bucket_code: 'E',
        is_smoking: false,
      }],
    } as any);

    expect(flight.inventories[0].allocated_seats).toBe(80);
    expect(flight.inventories[0].available_seats).toBe(70);
  });

  it('rejects inventory above the current aircraft physical cabin capacity', async () => {
    const flight = makeFlight();
    bridge.findById.mockResolvedValue(flight);

    await expect(service.update(String(flight._id), {
      inventories: [{
        cabin_class: CabinClass.ECONOMY,
        allocated_seats: 169,
        available_seats: 169,
        base_price: 1000000,
        bucket_code: 'E',
        is_smoking: false,
      }],
    } as any)).rejects.toThrow(/supports only 168/i);
  });

  it('rejects reducing inventory below seats already sold', async () => {
    const flight = makeFlight();
    bridge.findById.mockResolvedValue(flight);

    await expect(service.update(String(flight._id), {
      inventories: [{
        cabin_class: CabinClass.ECONOMY,
        allocated_seats: 9,
        available_seats: 9,
        base_price: 1000000,
        bucket_code: 'E',
        is_smoking: false,
      }],
    } as any)).rejects.toThrow(/below 10 sold seats/i);
  });

  it('blocks aircraft changes while HELD or CONFIRMED customer seats exist', async () => {
    const flight = makeFlight();
    bridge.findById.mockResolvedValue(flight);
    seatAllocationService.hasCustomerSeatAssignments.mockResolvedValue(true);

    await expect(service.update(String(flight._id), {
      aircraft: { model_code: 'A21N', model_name: 'ignored', total_capacity: 1 },
      inventories: [{
        cabin_class: CabinClass.ECONOMY,
        allocated_seats: 100,
        available_seats: 90,
        base_price: 1000000,
        bucket_code: 'E',
        is_smoking: false,
      }],
    } as any)).rejects.toThrow(/HELD hoặc CONFIRMED/i);
    expect(flight.save).not.toHaveBeenCalled();
  });

  it('allows an independent dated-flight aircraft change and clears an incompatible seat profile', async () => {
    const flight = makeFlight({
      commercial_template_id: 'TPL_AP101',
      seat_pricing_profile_id: 'profile-a20n',
      seat_pricing_profile_snapshot: { aircraft_type: 'A20N', code: 'A20N_ONLY' },
    });
    bridge.findById.mockResolvedValue(flight);

    const saved: any = await service.update(String(flight._id), {
      aircraft: { model_code: 'A21N', model_name: 'client value ignored', total_capacity: 1 },
      inventories: [{
        cabin_class: CabinClass.ECONOMY,
        allocated_seats: 100,
        available_seats: 0,
        base_price: 1000000,
        bucket_code: 'E',
        is_smoking: false,
      }],
    } as any);

    expect(saved.aircraft.model_code).toBe('A21N');
    expect(saved.aircraft.total_capacity).toBe(204);
    expect(saved.inventories[0].available_seats).toBe(90);
    expect(saved.seat_pricing_profile_id).toBeUndefined();
    expect(saved.seat_pricing_profile_snapshot).toBeUndefined();
    expect(saved.commercial_template_id).toBe('TPL_AP101');
    expect(seatAllocationService.hasCustomerSeatAssignments).toHaveBeenCalledWith(flight._id);
  });
});
