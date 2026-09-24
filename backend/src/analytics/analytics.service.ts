import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingStatus } from '../bookings/bookings.schema';
import { Flight, FlightDocument, FlightStatus } from '../flights/flights.schema';
import { User, UserDocument } from '../users/users.schema';
import { SeatAllocation, SeatAllocationDocument, SeatAllocationStatus } from '../seat-allocation/seat-allocation.schema';

export interface TravelPatternRouteStats {
  route: string;
  origin_iata: string;
  dest_iata: string;
  bookings_count: number;
  passenger_volume: number;
  active_booking_value_vnd: number;
}

export interface AnalyticsOverview {
  total_bookings: number;
  status_breakdown: {
    confirmed: number;
    blocked: number;
    rescheduled: number;
    cancelled: number;
  };
  cancellation_rate_percent: number;
  reschedule_rate_percent: number;
  net_revenue_vnd: number;
  active_booking_value_vnd: number;
  cabin_preferences: {
    economy: number;
    business: number;
    first: number;
    club: number;
  };
  passenger_demographics: {
    adults: number;
    children: number;
    seniors: number;
  };
  average_lead_time_days: number;
  repeat_customer_stats: {
    total_customers_with_bookings: number;
    repeat_customers: number;
    repeat_customer_rate_percent: number;
  };
  top_routes: TravelPatternRouteStats[];
}

export interface FlightCapacityStat {
  flight_id: string;
  flight_number: string;
  route: string;
  scheduled_departure: Date;
  total_capacity: number;
  occupied_seats: number;
  held_seats: number;
  staff_blocked_seats: number;
  available_seats: number;
  load_factor_percent: number;
  load_status: 'HIGH_LOAD' | 'LOW_LOAD' | 'NORMAL';
}

export interface CapacityUtilizationReport {
  total_scheduled_flights: number;
  total_seat_capacity: number;
  total_confirmed_occupied_seats: number;
  total_held_seats: number;
  total_staff_blocked_seats: number;
  total_available_seats: number;
  overall_load_factor_percent: number;
  high_load_flights: FlightCapacityStat[];
  low_load_flights: FlightCapacityStat[];
  cabin_utilization: Array<{
    cabin_class: string;
    total_allocated: number;
    occupied_or_held: number;
    load_factor_percent: number;
  }>;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Flight.name) private readonly flightModel: Model<FlightDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(SeatAllocation.name) private readonly allocationModel: Model<SeatAllocationDocument>,
  ) {}

  async getOverview(): Promise<AnalyticsOverview> {
    const bookings = await this.bookingModel
      .find()
      .populate('ticket_coupons.flight_id')
      .lean()
      .exec();

    const total_bookings = bookings.length;
    let confirmed = 0;
    let blocked = 0;
    let rescheduled = 0;
    let cancelled = 0;
    let net_revenue_vnd = 0;
    let active_booking_value_vnd = 0;

    const cabinCounts = { economy: 0, business: 0, first: 0, club: 0 };
    const demoCounts = { adults: 0, children: 0, seniors: 0 };
    const routeMap = new Map<
      string,
      { origin: string; dest: string; bookings: number; passengers: number; routeBookingValue: number }
    >();
    const customerBookingMap = new Map<string, number>();

    let totalLeadTimeDays = 0;
    let leadTimeCount = 0;

    for (const b of bookings) {
      if (b.status === BookingStatus.CONFIRMED) confirmed++;
      else if (b.status === BookingStatus.BLOCKED) blocked++;
      else if (b.status === BookingStatus.RESCHEDULED) rescheduled++;
      else if (b.status === BookingStatus.CANCELLED) cancelled++;

      // Real transaction-ledger net revenue from successful financial transactions:
      // SUM successful PAYMENT + SUM successful RESCHEDULE_CHARGE - SUM successful REFUND - SUM successful RESCHEDULE_REFUND
      // Do NOT clamp with Math.max(0, ...) and do NOT fall back to booking.total_amount under net_revenue_vnd
      if (b.payment_transactions && Array.isArray(b.payment_transactions) && b.payment_transactions.length > 0) {
        for (const txn of b.payment_transactions) {
          if (txn.status === 'SUCCESS') {
            const type = (txn.transaction_type || '').toUpperCase();
            if (type === 'PAYMENT' || type === 'RESCHEDULE_CHARGE') {
              net_revenue_vnd += (txn.amount || 0);
            } else if (type === 'REFUND' || type === 'RESCHEDULE_REFUND') {
              net_revenue_vnd -= (txn.amount || 0);
            }
          }
        }
      }

      // Active booking value (separate metric: legacy total_amount for active bookings)
      if (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.RESCHEDULED) {
        active_booking_value_vnd += (b.total_amount || 0);
      }

      // Track repeat customer
      if (b.user_id) {
        const uid = b.user_id.toString();
        customerBookingMap.set(uid, (customerBookingMap.get(uid) || 0) + 1);
      }

      // Demographic counts
      if (b.passengers && Array.isArray(b.passengers)) {
        for (const p of b.passengers) {
          const type = (p.passenger_type || 'ADULT').toUpperCase();
          if (type === 'CHILD') demoCounts.children++;
          else if (type === 'SENIOR') demoCounts.seniors++;
          else demoCounts.adults++;
        }
      }

      const bookingCreated = (b as any).createdAt || (b as any)._id?.getTimestamp?.();

      // Lead time calculation: calculated ONCE per qualifying booking based on:
      // booking createdAt -> earliest scheduled departure among all coupons of this booking
      let earliestDeparture: Date | null = null;

      // Group coupons by route for this single booking to ensure distinct booking counts per route
      const bookingRoutes = new Map<
        string,
        { origin: string; dest: string; passengers: number; routeBookingValue: number }
      >();

      if (b.ticket_coupons && Array.isArray(b.ticket_coupons)) {
        for (const coupon of b.ticket_coupons) {
          const c = (coupon.cabin_class || 'ECONOMY').toUpperCase();
          if (c === 'BUSINESS') cabinCounts.business++;
          else if (c === 'FIRST') cabinCounts.first++;
          else if (c === 'CLUB') cabinCounts.club++;
          else cabinCounts.economy++;

          const flight = coupon.flight_id as any;
          if (flight && typeof flight === 'object') {
            if (flight.scheduled_departure) {
              const d = new Date(flight.scheduled_departure);
              if (!earliestDeparture || d.getTime() < earliestDeparture.getTime()) {
                earliestDeparture = d;
              }
            }

            if (flight.origin_iata && flight.dest_iata) {
              const origin = flight.origin_iata;
              const dest = flight.dest_iata;
              const key = `${origin} -> ${dest}`;
              const cur = bookingRoutes.get(key) || {
                origin,
                dest,
                passengers: 0,
                routeBookingValue: 0,
              };
              cur.passengers += 1;
              if (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.RESCHEDULED) {
                cur.routeBookingValue += (coupon.fare_paid || 0) + (coupon.seat_fee || 0);
              }
              bookingRoutes.set(key, cur);
            }
          }
        }
      }

      // Record lead time once for this booking
      if (earliestDeparture && bookingCreated) {
        const depTime = earliestDeparture.getTime();
        const bookTime = new Date(bookingCreated).getTime();
        const leadDays = Math.max(0, Math.round((depTime - bookTime) / (1000 * 60 * 60 * 24)));
        totalLeadTimeDays += leadDays;
        leadTimeCount++;
      }

      // Merge bookingRoutes into global routeMap:
      // bookings_count = number of DISTINCT bookings containing that route
      // passenger_volume = actual passenger/coupon volume
      for (const [key, val] of bookingRoutes.entries()) {
        const existing = routeMap.get(key) || {
          origin: val.origin,
          dest: val.dest,
          bookings: 0,
          passengers: 0,
          routeBookingValue: 0,
        };
        existing.bookings += 1; // Distinct per booking!
        existing.passengers += val.passengers;
        existing.routeBookingValue += val.routeBookingValue;
        routeMap.set(key, existing);
      }
    }

    const cancellation_rate_percent =
      total_bookings > 0 ? Math.round((cancelled / total_bookings) * 1000) / 10 : 0;
    const reschedule_rate_percent =
      total_bookings > 0 ? Math.round((rescheduled / total_bookings) * 1000) / 10 : 0;
    const average_lead_time_days =
      leadTimeCount > 0 ? Math.round((totalLeadTimeDays / leadTimeCount) * 10) / 10 : 0;

    let repeatCustomers = 0;
    for (const count of customerBookingMap.values()) {
      if (count > 1) repeatCustomers++;
    }
    const totalCustomersWithBookings = customerBookingMap.size;
    const repeat_customer_rate_percent =
      totalCustomersWithBookings > 0
        ? Math.round((repeatCustomers / totalCustomersWithBookings) * 1000) / 10
        : 0;

    const top_routes: TravelPatternRouteStats[] = Array.from(routeMap.entries())
      .map(([key, val]) => ({
        route: key,
        origin_iata: val.origin,
        dest_iata: val.dest,
        bookings_count: val.bookings,
        passenger_volume: val.passengers,
        active_booking_value_vnd: val.routeBookingValue,
      }))
      .sort((a, b) => b.passenger_volume - a.passenger_volume)
      .slice(0, 10);

    return {
      total_bookings,
      status_breakdown: {
        confirmed,
        blocked,
        rescheduled,
        cancelled,
      },
      cancellation_rate_percent,
      reschedule_rate_percent,
      net_revenue_vnd,
      active_booking_value_vnd,
      cabin_preferences: cabinCounts,
      passenger_demographics: demoCounts,
      average_lead_time_days,
      repeat_customer_stats: {
        total_customers_with_bookings: totalCustomersWithBookings,
        repeat_customers: repeatCustomers,
        repeat_customer_rate_percent,
      },
      top_routes,
    };
  }

  async getCapacityUtilization(): Promise<CapacityUtilizationReport> {
    const now = new Date();
    // Analyze upcoming scheduled flights
    const flights = await this.flightModel
      .find({
        status: { $in: [FlightStatus.SCHEDULED, FlightStatus.DELAYED] },
        scheduled_departure: { $gte: now },
      })
      .lean()
      .exec();

    const flightIds = flights.map((f) => (f as any)._id);
    const allocations = await this.allocationModel
      .find({ flight_id: { $in: flightIds } })
      .lean()
      .exec();

    // Map allocations by flight id
    const allocMap = new Map<
      string,
      { confirmed: number; held: number; staffBlocked: number }
    >();
    for (const alloc of allocations) {
      const fId = alloc.flight_id.toString();
      const cur = allocMap.get(fId) || { confirmed: 0, held: 0, staffBlocked: 0 };
      if (alloc.status === SeatAllocationStatus.CONFIRMED) {
        cur.confirmed++;
      } else if (alloc.status === SeatAllocationStatus.HELD) {
        cur.held++;
      } else if (
        alloc.status === SeatAllocationStatus.BLOCKED_MAINTENANCE ||
        alloc.status === SeatAllocationStatus.CREW_REST ||
        alloc.status === SeatAllocationStatus.VIP_HOLD
      ) {
        cur.staffBlocked++;
      }
      allocMap.set(fId, cur);
    }

    let totalCapacity = 0;
    let totalConfirmedOccupied = 0;
    let totalHeld = 0;
    let totalStaffBlocked = 0;
    let totalAvailable = 0;

    const cabinAllocated: Record<string, number> = { ECONOMY: 0, BUSINESS: 0, FIRST: 0, CLUB: 0 };
    const cabinAvailable: Record<string, number> = { ECONOMY: 0, BUSINESS: 0, FIRST: 0, CLUB: 0 };

    const flightStats: FlightCapacityStat[] = [];

    for (const f of flights) {
      const cap = f.aircraft?.total_capacity || 180;
      const fId = (f as any)._id.toString();
      const allocInfo = allocMap.get(fId) || { confirmed: 0, held: 0, staffBlocked: 0 };

      let flightAvail = 0;
      if (f.inventories && Array.isArray(f.inventories) && f.inventories.length > 0) {
        flightAvail = f.inventories.reduce((sum, inv) => sum + (inv.available_seats || 0), 0);
        for (const inv of f.inventories) {
          const cls = (inv.cabin_class || 'ECONOMY').toUpperCase();
          cabinAllocated[cls] = (cabinAllocated[cls] || 0) + (inv.allocated_seats || 0);
          cabinAvailable[cls] = (cabinAvailable[cls] || 0) + (inv.available_seats || 0);
        }
      } else {
        flightAvail = cap;
      }

      // Reconcile physical allocations with inventory counts (Requirement 10):
      // Invariant: inventoryReserved = cap - flightAvail (customer reserved inventory)
      // confirmedFallback = max(0, inventoryReserved - activeHeldCustomerSeats)
      // confirmed = max(physicalConfirmedCustomerSeats, confirmedFallback)
      // availablePhysical = max(0, cap - confirmed - held - staffBlocked)
      const inventoryReserved = Math.max(0, cap - flightAvail);
      const confirmedFallback = Math.max(0, inventoryReserved - allocInfo.held);
      const occupied = Math.max(allocInfo.confirmed, confirmedFallback);
      const held = allocInfo.held;
      const staffBlocked = allocInfo.staffBlocked;
      const available = Math.max(0, cap - occupied - held - staffBlocked);

      const activeCommitted = occupied + held;
      const lf = cap > 0 ? Math.round((activeCommitted / cap) * 1000) / 10 : 0;

      totalCapacity += cap;
      totalConfirmedOccupied += occupied;
      totalHeld += held;
      totalStaffBlocked += staffBlocked;
      totalAvailable += available;

      flightStats.push({
        flight_id: fId,
        flight_number: f.flight_number,
        route: `${f.origin_iata} -> ${f.dest_iata}`,
        scheduled_departure: f.scheduled_departure,
        total_capacity: cap,
        occupied_seats: occupied,
        held_seats: held,
        staff_blocked_seats: staffBlocked,
        available_seats: available,
        load_factor_percent: lf,
        load_status: lf >= 80 ? 'HIGH_LOAD' : lf <= 40 ? 'LOW_LOAD' : 'NORMAL',
      });
    }

    const overallCommitted = totalConfirmedOccupied + totalHeld;
    const overall_load_factor_percent =
      totalCapacity > 0 ? Math.round((overallCommitted / totalCapacity) * 1000) / 10 : 0;

    // Mutually exclusive threshold classification (HIGH >= 80%, LOW <= 40%)
    const HIGH_LOAD_THRESHOLD = 80;
    const LOW_LOAD_THRESHOLD = 40;

    const high_load_flights = flightStats
      .filter((f) => f.load_factor_percent >= HIGH_LOAD_THRESHOLD)
      .sort((a, b) => b.load_factor_percent - a.load_factor_percent)
      .slice(0, 8);

    const low_load_flights = flightStats
      .filter((f) => f.load_factor_percent <= LOW_LOAD_THRESHOLD)
      .sort((a, b) => a.load_factor_percent - b.load_factor_percent)
      .slice(0, 8);

    const cabin_utilization = Object.keys(cabinAllocated).map((cls) => {
      const allocated = cabinAllocated[cls] || 0;
      const available = cabinAvailable[cls] || 0;
      const occupied = Math.max(0, allocated - available);
      const lf = allocated > 0 ? Math.round((occupied / allocated) * 1000) / 10 : 0;
      return {
        cabin_class: cls,
        total_allocated: allocated,
        occupied_or_held: occupied,
        load_factor_percent: lf,
      };
    });

    return {
      total_scheduled_flights: flights.length,
      total_seat_capacity: totalCapacity,
      total_confirmed_occupied_seats: totalConfirmedOccupied,
      total_held_seats: totalHeld,
      total_staff_blocked_seats: totalStaffBlocked,
      total_available_seats: totalAvailable,
      overall_load_factor_percent,
      high_load_flights,
      low_load_flights,
      cabin_utilization,
    };
  }
}
