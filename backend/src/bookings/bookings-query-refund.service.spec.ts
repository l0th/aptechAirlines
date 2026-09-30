import { BookingsQueryRefundService } from './bookings-query-refund.service';

describe('BookingsQueryRefundService trackTicket', () => {
  it('flattens Mongoose ticket subdocuments before enriching flight metadata', async () => {
    const coupon = {
      flight_id: { toString: () => 'flight-1' },
      _doc: { leg_type: 'OUTBOUND' },
      $__: { internal: true },
      __parentArray: [],
      toObject: jest.fn().mockReturnValue({
        coupon_number: 'CPN-1',
        passenger_name: 'Demo Customer',
        flight_id: 'flight-1',
        flight_number: 'APT-001',
        inventory_id: 'inv-1',
        cabin_class: 'ECONOMY',
        leg_type: 'OUTBOUND',
        coupon_status: 'ACTIVE',
      }),
    };

    const booking: any = {
      status: 'CONFIRMED',
      ticket_coupons: [coupon],
    };
    const query = {
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(booking),
    };
    const bookingModel: any = {
      findOne: jest.fn().mockReturnValue(query),
    };
    const flightsService: any = {
      findById: jest.fn().mockResolvedValue({
        status: 'SCHEDULED',
        delay_reason: '',
        origin_iata: 'SGN',
        dest_iata: 'HAN',
        departure_date: '2026-10-18',
        scheduled_departure: new Date('2026-10-18T03:00:00.000Z'),
        scheduled_arrival: new Date('2026-10-18T05:15:00.000Z'),
      }),
    };
    const airportsService: any = {
      findByIata: jest.fn().mockResolvedValue({ time_zone: 'Asia/Ho_Chi_Minh' }),
    };
    const deps: any = {
      bookingModel,
      flightsService,
      usersService: {},
      policiesService: {},
      airportsService,
    };
    const bridge: any = {
      generateCode: jest.fn(),
      getEarliestDeparture: jest.fn(),
      executePostCommitRefunds: jest.fn(),
      releaseSeatsForCouponsStrict: jest.fn(),
    };

    const service = new BookingsQueryRefundService(deps, bridge);
    const result = await service.trackTicket('CNF-DEMO-001');
    const enriched = result.flight_coupons[0];

    expect(coupon.toObject).toHaveBeenCalledTimes(1);
    expect(enriched.leg_type).toBe('OUTBOUND');
    expect(enriched.origin_iata).toBe('SGN');
    expect(enriched.dest_iata).toBe('HAN');
    expect(enriched).not.toHaveProperty('_doc');
    expect(enriched).not.toHaveProperty('$__');
    expect(enriched).not.toHaveProperty('__parentArray');
  });
});
