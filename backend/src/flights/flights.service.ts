import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flight, FlightDocument, FlightStatus, CabinClass, getCustomerBookableFlightFilter } from './flights.schema';
import {
  CreateFlightDto,
  SearchFlightDto,
  UpdateFlightDto,
  UpdateFlightStatusDto,
  isValidCalendarDateString,
} from './flights.dto';
import { AirportsService } from '../airports/airports.service';
import { Booking, BookingDocument, BookingStatus } from '../bookings/bookings.schema';
import { localWallTimeToUtc, parseUtcWallTime, localDateKey, utcOffsetMinutes } from '../common/timezone.util';
import { earlyBirdQuote, getBookingWindowLimits, maxAdvanceBookingDays } from '../common/pricing.util';

import { ReferenceService } from '../reference/reference.service';
import { RouteGraphCoverage, RouteGraphResult, RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService, ValidatedItinerary } from '../reference/route-schedule-validator.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';

/**
 * Enumerates all calendar dates (YYYY-MM-DD) inclusively from startDate through endDate.
 */
export function enumerateDateRange(startDate: string, endDate?: string): string[] {
  if (!endDate || endDate <= startDate) {
    return [startDate];
  }
  const dates: string[] = [];
  const cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().substring(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
export interface RouteNetworkLeg {
  airline_iata?: string;
  dep_iata?: string;
  arr_iata?: string;
}

export interface RouteNetworkSuggestion {
  transit_airport: string;
  leg1?: RouteNetworkLeg;
  leg2?: RouteNetworkLeg;
  leg3?: RouteNetworkLeg;
  note?: string;
}

@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly airportsService: AirportsService,
    private readonly referenceService: ReferenceService,
    private readonly usersService: UsersService,
    @Optional() private readonly routeGraphService?: RouteGraphService,
    @Optional() private readonly routeScheduleValidatorService?: RouteScheduleValidatorService,
    @Optional() private readonly seatAllocationService?: SeatAllocationService,
  ) {}

  async findAll(status?: FlightStatus, origin?: string, dest?: string, commercialOnly = false): Promise<Flight[]> {
    if (commercialOnly && status === FlightStatus.CANCELLED) {
      return [];
    }

    const filter: any = {};
    if (commercialOnly) {
      Object.assign(filter, getCustomerBookableFlightFilter());
      if (status) {
        filter.status = status;
      }
    } else if (status) {
      filter.status = status;
    }
    if (origin) filter.origin_iata = origin.toUpperCase();
    if (dest) filter.dest_iata = dest.toUpperCase();

    return this.flightModel.find(filter).sort({ scheduled_departure: 1 }).exec();
  }

  async findById(id: string): Promise<FlightDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid flight ID format');
    }
    const flight = await this.flightModel.findById(id).exec();
    if (!flight) {
      throw new NotFoundException(`Flight with ID ${id} not found`);
    }
    return flight;
  }

  /**
   * Requirement 3.10: Public flight lookup by flight number and date.
   * Any user (registered or not) can query arrival/departure times.
   */
  async findByFlightNumberAndDate(flightNumber: string, date: string): Promise<FlightDocument[]> {
    if (!flightNumber || !date) {
      throw new BadRequestException('flight_number and date query params are required');
    }

    const normalizedNumber = flightNumber.trim().toUpperCase();

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD');
    }

    const flights = await this.flightModel
      .find({
        flight_number: normalizedNumber,
        departure_date: date,
        is_bookable: true,
        operator: 'APTECH_AIRLINES',
      })
      .sort({ scheduled_departure: 1 })
      .exec();

    if (!flights || flights.length === 0) {
      throw new NotFoundException(
        `No flights found for flight number ${normalizedNumber} on ${date}`,
      );
    }

    return flights;
  }

  private parseAdminTime(timeStr: string, timeZone: string): { date: Date; isWallTime: boolean } {
    if (!timeStr) return { date: new Date(), isWallTime: false };
    if (timeStr.endsWith('Z') || timeStr.match(/[+-]\d{2}:?\d{2}$/)) {
      return { date: new Date(timeStr), isWallTime: false };
    }
    const [datePart, timePart] = timeStr.split('T');
    const hhmm = timePart.substring(0, 5);
    return { date: localWallTimeToUtc(datePart, hhmm, timeZone), isWallTime: true };
  }

  async create(createFlightDto: CreateFlightDto): Promise<FlightDocument> {
    // Validate IATAs
    const originAirport = await this.airportsService.findByIata(createFlightDto.origin_iata);
    const destAirport = await this.airportsService.findByIata(createFlightDto.dest_iata);

    const depStr = createFlightDto.scheduled_departure as unknown as string;
    const arrStr = createFlightDto.scheduled_arrival as unknown as string;
    let dep = new Date(depStr);
    let arr = new Date(arrStr);
    let departureDate = createFlightDto.departure_date;

    if (typeof depStr === 'string') {
      const parsedDep = this.parseAdminTime(depStr, originAirport.time_zone);
      dep = parsedDep.date;
      if (parsedDep.isWallTime) departureDate = localDateKey(dep, originAirport.time_zone);
    }
    if (typeof arrStr === 'string') {
      const parsedArr = this.parseAdminTime(arrStr, destAirport.time_zone);
      arr = parsedArr.date;
    }

    let duration = createFlightDto.duration_minutes;
    const actualDiff = Math.round((arr.getTime() - dep.getTime()) / 60000);
    if (Math.abs(actualDiff - duration) > 1) {
      duration = actualDiff;
    }

    const created = new this.flightModel({
      ...createFlightDto,
      scheduled_departure: dep,
      scheduled_arrival: arr,
      departure_date: departureDate,
      duration_minutes: duration,
      origin_iata: createFlightDto.origin_iata.toUpperCase(),
      dest_iata: createFlightDto.dest_iata.toUpperCase(),
      status: FlightStatus.SCHEDULED,
    });
    return created.save();
  }

  async update(id: string, updateFlightDto: UpdateFlightDto): Promise<FlightDocument> {
    const flight = await this.findById(id);

    // To parse times properly we need airports
    const originAirport = await this.airportsService.findByIata(flight.origin_iata);
    const destAirport = await this.airportsService.findByIata(flight.dest_iata);

    if (updateFlightDto.flight_number) flight.flight_number = updateFlightDto.flight_number;
    if (updateFlightDto.departure_date) flight.departure_date = updateFlightDto.departure_date;

    const depStr = updateFlightDto.scheduled_departure as unknown as string;
    const arrStr = updateFlightDto.scheduled_arrival as unknown as string;

    if (depStr) {
      const parsedDep = this.parseAdminTime(depStr, originAirport.time_zone);
      flight.scheduled_departure = parsedDep.date;
      if (parsedDep.isWallTime) flight.departure_date = localDateKey(flight.scheduled_departure, originAirport.time_zone);
    }
    if (arrStr) {
      const parsedArr = this.parseAdminTime(arrStr, destAirport.time_zone);
      flight.scheduled_arrival = parsedArr.date;
    }
    
    if (updateFlightDto.duration_minutes !== undefined) flight.duration_minutes = updateFlightDto.duration_minutes;
    
    // Recompute duration
    if (depStr || arrStr || updateFlightDto.duration_minutes !== undefined) {
      const actualDiff = Math.round((flight.scheduled_arrival.getTime() - flight.scheduled_departure.getTime()) / 60000);
      if (Math.abs(actualDiff - flight.duration_minutes) > 1) {
        flight.duration_minutes = actualDiff;
      }
    }

    if (updateFlightDto.distance_miles !== undefined) flight.distance_miles = updateFlightDto.distance_miles;
    if (updateFlightDto.status) {
      flight.status = updateFlightDto.status;
      // C.2 Xoá delay_reason khi set lại SCHEDULED
      if (updateFlightDto.status === FlightStatus.SCHEDULED) {
        flight.delay_reason = '';
      }
    }
    if (updateFlightDto.delay_reason !== undefined) flight.delay_reason = updateFlightDto.delay_reason;
    if (updateFlightDto.inventories) flight.inventories = updateFlightDto.inventories as any;

    flight.is_manually_modified = true;
    const savedFlight = await flight.save();

    // C.1 Hủy booking liên quan khi flight bị CANCELLED
    if (updateFlightDto.status === FlightStatus.CANCELLED) {
      const cancelledBookings = await this.cancelBookingsForFlight(savedFlight);
      this.logger.warn(
        `Flight ${savedFlight.flight_number} (${savedFlight._id}) set to CANCELLED via update(). ` +
          `${cancelledBookings} booking(s) automatically cancelled, refunded and their seats released.`,
      );
    }

    return savedFlight;
  }

  /**
   * Authoritative safe flight deletion enforcing booking integrity.
   * Rejects deletion if referenced by active BLOCKED or CONFIRMED bookings.
   */
  async deleteFlight(id: string): Promise<{ message: string; flight: FlightDocument }> {
    const flight = await this.findById(id);
    const hasBookings = await this.bookingModel.exists({
      'ticket_coupons.flight_id': flight._id,
      status: { $in: ['BLOCKED', 'CONFIRMED'] },
    });
    if (hasBookings) {
      throw new BadRequestException(
        'Không thể xóa chuyến bay đã có hành khách giữ chỗ hoặc mua vé. (Cannot delete flight with active BLOCKED or CONFIRMED bookings)',
      );
    }
    await this.flightModel.findByIdAndDelete(id).exec();
    return {
      message: `Flight ${flight.flight_number} (${id}) deleted successfully`,
      flight,
    };
  }

  async updateStatus(id: string, dto: UpdateFlightStatusDto): Promise<FlightDocument> {
    const flight = await this.findById(id);
    flight.status = dto.status;
    if (dto.delay_reason !== undefined) flight.delay_reason = dto.delay_reason;
    if (dto.actual_departure) flight.actual_departure = new Date(dto.actual_departure);
    if (dto.actual_arrival) flight.actual_arrival = new Date(dto.actual_arrival);
    const savedFlight = await flight.save();

    // Requirement 1.2.3: cancelling a flight is an emergency that must propagate
    // to every still-active booking holding a coupon on that flight (auto refund
    // + seat release + cancellation number).
    if (savedFlight.status === FlightStatus.CANCELLED) {
      const cancelledBookings = await this.cancelBookingsForFlight(savedFlight);
      // The HTTP response intentionally stays the bare Flight document (the
      // frontend reads concrete flight fields); the propagation result is
      // reported through the log only.
      this.logger.warn(
        `Flight ${savedFlight.flight_number} (${savedFlight._id}) set to CANCELLED. ` +
          `${cancelledBookings} booking(s) automatically cancelled, refunded and their seats released.`,
      );
    }

    return savedFlight;
  }

  /** Cancellation code generator (same format as BookingsService.generateCode). */
  private generateCode(prefix: string): string {
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${randomChars}`;
  }

  /**
   * Requirement 1.2.3: propagate an emergency flight cancellation to all
   * BLOCKED/CONFIRMED bookings that contain a coupon for `flight`.
   *
   * Invariants:
   * 1. BLOCKED bookings:
   *    - release all reserved seats
   *    - mark coupons CANCELLED
   *    - assign cancellation number
   *    - save booking as CANCELLED
   *    - DO NOT create a REFUND payment transaction (ticket was unpaid)
   *    - SkyMiles remain untouched
   * 2. CONFIRMED bookings:
   *    - reverse accrued SkyMiles (via usersService.deductSkyMiles)
   *    - release all reserved seats
   *    - add full refund transaction (booking.total_amount)
   *    - set total_miles_accrued = 0
   *    - mark coupons CANCELLED
   *    - assign cancellation number
   *    - save booking as CANCELLED
   * 3. Deduplicate seat release per (flight_id, inventory_id) pair.
   * 4. Per-booking compensation / rollback:
   *    - If any mandatory operation fails for a booking, restore any deducted SkyMiles,
   *      restore any released seats, revert in-memory booking fields to snapshot,
   *      do NOT save as CANCELLED, and continue processing other bookings in the batch.
   *    - cancelledCount only increments for bookings that successfully and completely finalize.
   *
   * @returns the number of bookings that were successfully cancelled.
   */
  async cancelBookingsForFlight(flight: FlightDocument): Promise<number> {
    const affectedBookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $in: [BookingStatus.BLOCKED, BookingStatus.CONFIRMED] },
      })
      .exec();

    if (!affectedBookings || affectedBookings.length === 0) {
      return 0;
    }

    let cancelledCount = 0;
    for (const booking of affectedBookings) {
      // Guard against double-processing if status was somehow already CANCELLED
      if (booking.status === BookingStatus.CANCELLED) {
        continue;
      }

      const wasConfirmed = booking.status === BookingStatus.CONFIRMED;
      const passengerCount = booking.passengers?.length || 1;

      // 1. Snapshot original booking state for rollback
      const snapshot = {
        status: booking.status,
        cancellation_number: booking.cancellation_number,
        total_miles_accrued: booking.total_miles_accrued,
        payment_transactions: (booking.payment_transactions || []).map((t: any) => ({
          ...(t.toObject ? t.toObject() : t),
        })),
        ticket_coupons: (booking.ticket_coupons || []).map((c: any) => ({
          ...(c.toObject ? c.toObject() : c),
        })),
      };

      let skyMilesDeducted = false;
      let milesDeductedAmount = 0;
      let originalUserSkyMiles: number | null = null;
      const releasedLegs: Array<{ flightId: string; inventoryId: string }> = [];

      try {
        // Step 1: For CONFIRMED bookings with accrued miles, reverse SkyMiles
        if (wasConfirmed && booking.total_miles_accrued > 0) {
          milesDeductedAmount = booking.total_miles_accrued;
          try {
            const user = await this.usersService.findById(booking.user_id.toString());
            if (user && typeof user.sky_miles === 'number') {
              originalUserSkyMiles = user.sky_miles;
            }
          } catch {
            // If user lookup fails, compensation will fall back to addSkyMiles
          }

          await this.usersService.deductSkyMiles(booking.user_id.toString(), milesDeductedAmount);
          skyMilesDeducted = true;
        }

        // Step 2: Release all reserved seats (deduplicated per flight_id + inventory_id)
        const legMap = new Map<string, { flightId: string; inventoryId: string }>();
        for (const coupon of booking.ticket_coupons || []) {
          if (!coupon.flight_id || !coupon.inventory_id) continue;
          const flightId = coupon.flight_id.toString();
          const inventoryId = coupon.inventory_id.toString();
          legMap.set(`${flightId}_${inventoryId}`, { flightId, inventoryId });
        }
        const distinctLegs = Array.from(legMap.values());

        for (const leg of distinctLegs) {
          await this.updateAvailableSeats(leg.flightId, leg.inventoryId, +passengerCount);
          releasedLegs.push(leg);
        }

        // Step 3: For CONFIRMED bookings, add full REFUND transaction & reset miles
        if (wasConfirmed) {
          if (booking.total_amount > 0) {
            const originalPayment = booking.payment_transactions?.find(
              (t: any) => t.transaction_type === 'PAYMENT' && t.status === 'SUCCESS',
            );
            const cardMasked = originalPayment?.card_masked || 'AUTO-REFUND-FLIGHT-CANCELLED';

            booking.payment_transactions.push({
              transaction_type: 'REFUND',
              amount: booking.total_amount,
              card_masked: cardMasked,
              currency: 'VND',
              status: 'SUCCESS',
              created_at: new Date(),
            });
          }
          booking.total_miles_accrued = 0;
        }

        // Step 4: Mark all coupons as CANCELLED
        if (booking.ticket_coupons && Array.isArray(booking.ticket_coupons)) {
          booking.ticket_coupons.forEach((coupon: any) => {
            coupon.coupon_status = 'CANCELLED';
          });
        }

        // Step 5: Mark booking as CANCELLED, assign cancellation number, and save
        booking.status = BookingStatus.CANCELLED;
        booking.cancellation_number = this.generateCode('CAN');
        await booking.save();

        cancelledCount++;
      } catch (err: any) {
        this.logger.error(
          `Failed to cancel booking ${booking.pnr_code || booking._id} during emergency flight cancellation: ${err?.message || err}. Initiating compensation rollback.`,
        );

        // Compensation 1: Restore released seats in reverse order
        for (const leg of [...releasedLegs].reverse()) {
          try {
            await this.updateAvailableSeats(leg.flightId, leg.inventoryId, -passengerCount);
          } catch (compSeatErr: any) {
            this.logger.error(
              `Compensation failure: could not restore seats for flight ${leg.flightId}, inventory ${leg.inventoryId}: ${compSeatErr?.message || compSeatErr}`,
            );
          }
        }

        // Compensation 2: Restore deducted SkyMiles
        if (skyMilesDeducted) {
          try {
            if (originalUserSkyMiles !== null && typeof this.usersService.setSkyMiles === 'function') {
              await this.usersService.setSkyMiles(booking.user_id.toString(), originalUserSkyMiles);
            } else if (typeof this.usersService.addSkyMiles === 'function') {
              await this.usersService.addSkyMiles(booking.user_id.toString(), milesDeductedAmount);
            } else if (typeof this.usersService.setSkyMiles === 'function') {
              await this.usersService.setSkyMiles(booking.user_id.toString(), milesDeductedAmount);
            }
          } catch (compMilesErr: any) {
            this.logger.error(
              `Compensation failure: could not restore SkyMiles for user ${booking.user_id}: ${compMilesErr?.message || compMilesErr}`,
            );
          }
        }

        // Compensation 3: Revert in-memory booking fields to snapshot
        booking.status = snapshot.status;
        booking.cancellation_number = snapshot.cancellation_number;
        booking.total_miles_accrued = snapshot.total_miles_accrued;
        booking.payment_transactions = snapshot.payment_transactions as any;
        if (booking.ticket_coupons && Array.isArray(booking.ticket_coupons)) {
          booking.ticket_coupons.forEach((coupon: any, idx: number) => {
            if (snapshot.ticket_coupons[idx]) {
              coupon.coupon_status = snapshot.ticket_coupons[idx].coupon_status;
            }
          });
        }

        // Continue batch processing for other bookings
      }
    }

    return cancelledCount;
  }

  /**
   * @deprecated Use deleteFlight() to enforce booking safety invariants.
   */
  async delete(id: string): Promise<{ message: string; flight?: FlightDocument }> {
    return this.deleteFlight(id);
  }

  // Atomically decrement or increment available seats
  async updateAvailableSeats(
    flightId: string,
    inventoryId: string,
    seatCountChange: number, // Negative to reserve/block, positive to release/cancel
  ): Promise<boolean> {
    const flight = await this.findById(flightId);
    const inv = flight.inventories.find(
      (i: any) => i._id.toString() === inventoryId || i.id === inventoryId,
    );
    if (!inv) {
      throw new NotFoundException(`Inventory with ID ${inventoryId} not found on flight`);
    }

    if (seatCountChange < 0 && inv.available_seats < Math.abs(seatCountChange)) {
      throw new BadRequestException(`Not enough available seats in ${inv.cabin_class}. Only ${inv.available_seats} left.`);
    }

    inv.available_seats += seatCountChange;
    await flight.save();
    return true;
  }

  // Yêu cầu B.1: Đặt chỗ an toàn (atomic)
  async reserveSeats(
    flightId: string,
    inventoryId: string,
    count: number,
    sagaOptions?: { operation_id: string; mutation_key: string },
  ): Promise<boolean> {
    if (!sagaOptions) {
      const result = await this.flightModel.findOneAndUpdate(
        {
          _id: flightId,
          inventories: {
            $elemMatch: { _id: inventoryId, available_seats: { $gte: count } },
          },
        },
        {
          $inc: { 'inventories.$.available_seats': -count },
        },
        { new: true },
      );
      return !!result;
    }

    const invObjId = new Types.ObjectId(inventoryId);

    // Atomic update filter requires:
    // 1. the exact inventory via $elemMatch
    // 2. available_seats >= count
    // 3. that exact inventory does NOT already contain mutation_key
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            available_seats: { $gte: count },
            'saga_markers.mutation_key': { $ne: sagaOptions.mutation_key },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': -count },
        $push: {
          'inventories.$[inv].saga_markers': {
            mutation_key: sagaOptions.mutation_key,
            operation_id: sagaOptions.operation_id,
            action: 'RESERVE_NEW',
            seat_count: count,
            state: 'APPLIED',
            created_at: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }],
        new: true,
      },
    );

    if (result) {
      return true;
    }

    // If atomic update returned null: query for the exact marker
    // marker APPLIED => ALREADY_APPLIED / idempotent success
    // marker absent => genuine capacity failure
    const existingFlight = await this.flightModel.findOne({
      _id: flightId,
      inventories: {
        $elemMatch: {
          _id: inventoryId,
          saga_markers: {
            $elemMatch: { mutation_key: sagaOptions.mutation_key, state: 'APPLIED' },
          },
        },
      },
    }).exec();

    if (existingFlight) {
      return true; // ALREADY_APPLIED / idempotent success
    }

    return false; // Genuine capacity or flight failure
  }

  /**
   * Phase B SAGA: Atomically compensates an inventory reservation if the marker is APPLIED.
   */
  async compensateInventoryReservation(
    flightId: string | Types.ObjectId,
    inventoryId: string,
    mutationKey: string,
    count: number,
  ): Promise<boolean> {
    const invObjId = new Types.ObjectId(inventoryId);
    const now = new Date();
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            saga_markers: {
              $elemMatch: { mutation_key: mutationKey, state: 'APPLIED' },
            },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': +count },
        $set: {
          'inventories.$[inv].saga_markers.$[m].state': 'COMPENSATED',
          'inventories.$[inv].saga_markers.$[m].compensated_at': now,
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }, { 'm.mutation_key': mutationKey, 'm.state': 'APPLIED' }],
        new: true,
      },
    );
    if (result) {
      return true;
    }

    // Idempotent recovery inspection:
    // If findOneAndUpdate didn't match, check whether already compensated or never applied
    const flight = await this.flightModel.findOne({ _id: flightId }).lean();
    if (!flight) {
      return false;
    }
    const inv = flight.inventories?.find((i: any) => String(i._id) === String(inventoryId));
    if (!inv) {
      return false;
    }
    const marker = inv.saga_markers?.find((m: any) => m.mutation_key === mutationKey);
    if (!marker) {
      // Marker absent: mutation never reached flight inventory -> NO-OP SUCCESS
      return true;
    }
    if (marker.state === 'COMPENSATED') {
      // Already compensated -> IDEMPOTENT SUCCESS
      return true;
    }
    return false;
  }

  /**
   * Phase B SAGA: Atomically restores inventory with an idempotent saga marker.
   * Two concurrent identical restore calls must never increment twice.
   */
  async restoreSeatsWithSaga(
    flightId: string | Types.ObjectId,
    inventoryId: string,
    count: number,
    sagaOptions: { operation_id: string; mutation_key: string },
  ): Promise<boolean> {
    const invObjId = new Types.ObjectId(inventoryId);

    // Atomic update filter requires:
    // 1. exact inventory via $elemMatch
    // 2. that exact inventory does NOT already contain mutation_key
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            'saga_markers.mutation_key': { $ne: sagaOptions.mutation_key },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': +count },
        $push: {
          'inventories.$[inv].saga_markers': {
            mutation_key: sagaOptions.mutation_key,
            operation_id: sagaOptions.operation_id,
            action: 'RESTORE_OLD',
            seat_count: count,
            state: 'APPLIED',
            created_at: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }],
        new: true,
      },
    );

    if (result) {
      return true;
    }

    // Check if marker was already APPLIED (idempotent retry)
    const existing = await this.flightModel.findOne({
      _id: flightId,
      inventories: {
        $elemMatch: {
          _id: inventoryId,
          saga_markers: {
            $elemMatch: { mutation_key: sagaOptions.mutation_key, state: 'APPLIED' },
          },
        },
      },
    }).exec();

    return !!existing;
  }

  /**
   * Requirement 3.3: Advanced Flight Search & Route Selection Algorithm
   */
  async searchFlights(dto: SearchFlightDto): Promise<{
    origin_info: any;
    dest_info: any;
    origin_scope?: any;
    dest_scope?: any;
    is_round_trip: boolean;
    passenger_breakdown: { adults: number; children: number; seniors: number; total: number };
    onward_flights: any[];
    return_flights?: any[];
    connecting_routes?: any[];
    return_connecting_routes?: any[];
    route_network_suggestions?: RouteNetworkSuggestion[];
    network_status?: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
    network_itineraries?: ValidatedItinerary[];
    network_coverage?: RouteGraphCoverage;
    network_discovery?: {
      status: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
      itineraries: ValidatedItinerary[];
      coverage: RouteGraphCoverage;
    };
    return_route_network_suggestions?: RouteNetworkSuggestion[];
    return_network_status?: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
    return_network_itineraries?: ValidatedItinerary[];
    return_network_coverage?: RouteGraphCoverage;
    return_network_discovery?: {
      status: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
      itineraries: ValidatedItinerary[];
      coverage: RouteGraphCoverage;
    };
  }> {
    const adults = Number(dto.adults) || 1;
    const children = Number(dto.children) || 0;
    const seniors = Number(dto.seniors) || 0;
    const totalPassengers = adults + children + seniors;

    const { min_date: minDateStr, max_date: maxDateStr, max_advance_days: maxDays } = getBookingWindowLimits();

    if (!isValidCalendarDateString(dto.departure_date)) {
      throw new BadRequestException('Ngày khởi hành không đúng định dạng YYYY-MM-DD hoặc không hợp lệ.');
    }
    if (dto.departure_date < minDateStr) {
      throw new BadRequestException(`Ngày khởi hành không được trước ngày hiện tại (${minDateStr}).`);
    }
    if (dto.departure_date > maxDateStr) {
      throw new BadRequestException(`Ngày bay vượt quá giới hạn đặt vé trước ${maxDays} ngày.`);
    }

    if (dto.departure_date_end) {
      if (!isValidCalendarDateString(dto.departure_date_end)) {
        throw new BadRequestException('Ngày kết thúc khoảng tìm kiếm không đúng định dạng YYYY-MM-DD hoặc không hợp lệ.');
      }
      if (dto.departure_date_end < dto.departure_date) {
        throw new BadRequestException('Ngày kết thúc khoảng tìm kiếm không được trước ngày khởi hành.');
      }
      if (dto.departure_date_end > maxDateStr) {
        throw new BadRequestException(`Ngày bay vượt quá giới hạn đặt vé trước ${maxDays} ngày.`);
      }
    }

    if (dto.return_date) {
      if (!isValidCalendarDateString(dto.return_date)) {
        throw new BadRequestException('Ngày về không đúng định dạng YYYY-MM-DD hoặc không hợp lệ.');
      }
      if (dto.return_date < minDateStr) {
        throw new BadRequestException(`Ngày về không được trước ngày hiện tại (${minDateStr}).`);
      }
      if (dto.return_date > maxDateStr) {
        throw new BadRequestException(`Ngày bay vượt quá giới hạn đặt vé trước ${maxDays} ngày.`);
      }
      const latestOutboundDate = dto.departure_date_end || dto.departure_date;
      if (dto.return_date < latestOutboundDate) {
        throw new BadRequestException('Return date cannot be earlier than departure date');
      }
    }

    const originScope = await this.referenceService.expandLocation(dto.origin);
    const destScope = await this.referenceService.expandLocation(dto.destination);
    
    const legacyOriginIata = originScope.iata_codes[0] || dto.origin.toUpperCase();
    const legacyDestIata = destScope.iata_codes[0] || dto.destination.toUpperCase();

    const onwardDirect = await this.findDirectFlights(
      originScope.iata_codes,
      destScope.iata_codes,
      dto.departure_date,
      dto.departure_date_end,
      dto.cabin_class,
      dto.is_smoking,
      totalPassengers,
      adults,
      children,
      seniors,
    );

    let connectingRoutes: any[] = [];
    let routeNetworkSuggestions: any[] = [];
    let networkDiscovery: {
      status: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
      itineraries: ValidatedItinerary[];
      coverage: RouteGraphCoverage;
    } | undefined = undefined;
    
    if (onwardDirect.length === 0 || dto.include_connecting) {
      if (dto.departure_date_end || dto.cabin_class) {
        connectingRoutes = await this.findConnectingRoutes(
          originScope.iata_codes,
          destScope.iata_codes,
          dto.departure_date,
          totalPassengers,
          adults,
          children,
          seniors,
          dto.departure_date_end,
          dto.cabin_class,
        );
      } else {
        connectingRoutes = await this.findConnectingRoutes(
          originScope.iata_codes,
          destScope.iata_codes,
          dto.departure_date,
          totalPassengers,
          adults,
          children,
          seniors,
        );
      }
      
      if (connectingRoutes.length === 0 && onwardDirect.length === 0) {
        if (this.routeGraphService && this.routeScheduleValidatorService) {
          const originNetScope = await this.referenceService.expandLocation(dto.origin, { includeUnserviced: true });
          const destNetScope = await this.referenceService.expandLocation(dto.destination, { includeUnserviced: true });
          networkDiscovery = await this.discoverNetworkRoutes(
            originNetScope.iata_codes.length > 0 ? originNetScope.iata_codes : originScope.iata_codes,
            destNetScope.iata_codes.length > 0 ? destNetScope.iata_codes : destScope.iata_codes,
            dto.departure_date,
          );

          if (networkDiscovery.itineraries.length > 0) {
            routeNetworkSuggestions = this.mapItinerariesToSuggestions(networkDiscovery.itineraries);
          } else {
            routeNetworkSuggestions = await this.referenceService.findRouteNetworkConnections(
              originScope.iata_codes,
              destScope.iata_codes,
              'airlabs',
            );
          }
        } else {
          routeNetworkSuggestions = await this.referenceService.findRouteNetworkConnections(
            originScope.iata_codes,
            destScope.iata_codes,
            'airlabs',
          );
        }
      }
    }

    let returnFlights: any[] | undefined = undefined;
    let returnConnectingRoutes: any[] | undefined = undefined;
    let returnNetworkDiscovery: any = undefined;
    let returnRouteNetworkSuggestions: any[] | undefined = undefined;

    if (dto.return_date) {
      returnFlights = await this.findDirectFlights(
        destScope.iata_codes,
        originScope.iata_codes,
        dto.return_date,
        undefined,
        dto.cabin_class,
        dto.is_smoking,
        totalPassengers,
        adults,
        children,
        seniors,
      );
      if (returnFlights.length === 0 || dto.include_connecting) {
        if (dto.cabin_class) {
          returnConnectingRoutes = await this.findConnectingRoutes(
            destScope.iata_codes,
            originScope.iata_codes,
            dto.return_date,
            totalPassengers,
            adults,
            children,
            seniors,
            undefined,
            dto.cabin_class,
          );
        } else {
          returnConnectingRoutes = await this.findConnectingRoutes(
            destScope.iata_codes,
            originScope.iata_codes,
            dto.return_date,
            totalPassengers,
            adults,
            children,
            seniors,
          );
        }
      }

      // Reverse Network Discovery for return flight when both concrete direct and connecting yield 0
      if ((returnFlights?.length ?? 0) === 0 && (returnConnectingRoutes?.length ?? 0) === 0) {
        if (this.routeGraphService && this.routeScheduleValidatorService) {
          const destNetScope = await this.referenceService.expandLocation(dto.destination, { includeUnserviced: true });
          const originNetScope = await this.referenceService.expandLocation(dto.origin, { includeUnserviced: true });
          returnNetworkDiscovery = await this.discoverNetworkRoutes(
            destNetScope.iata_codes.length > 0 ? destNetScope.iata_codes : destScope.iata_codes,
            originNetScope.iata_codes.length > 0 ? originNetScope.iata_codes : originScope.iata_codes,
            dto.return_date,
          );

          if (returnNetworkDiscovery.itineraries.length > 0) {
            returnRouteNetworkSuggestions = this.mapItinerariesToSuggestions(returnNetworkDiscovery.itineraries);
          } else {
            returnRouteNetworkSuggestions = await this.referenceService.findRouteNetworkConnections(
              destScope.iata_codes,
              originScope.iata_codes,
              'airlabs',
            );
          }
        } else {
          returnRouteNetworkSuggestions = await this.referenceService.findRouteNetworkConnections(
            destScope.iata_codes,
            originScope.iata_codes,
            'airlabs',
          );
        }
      }
    }

    const dateFilter = dto.departure_date_end 
      ? { $gte: dto.departure_date, $lte: dto.departure_date_end } 
      : dto.departure_date;

    let originAirportsWithFlights = 0;
    if (originScope.iata_codes.length > 1) {
      const distinct = await this.flightModel.distinct('origin_iata', {
        ...getCustomerBookableFlightFilter(),
        origin_iata: { $in: originScope.iata_codes },
        departure_date: dateFilter,
      }).exec();
      originAirportsWithFlights = distinct.length;
    }

    let destAirportsWithFlights = 0;
    if (destScope.iata_codes.length > 1) {
      const distinct = await this.flightModel.distinct('dest_iata', {
        ...getCustomerBookableFlightFilter(),
        dest_iata: { $in: destScope.iata_codes },
        departure_date: dateFilter,
      }).exec();
      destAirportsWithFlights = distinct.length;
    }

    return {
      origin_info: {
        query: dto.origin,
        resolved_iata: legacyOriginIata,
        using_nearest_airport: !!originScope.using_nearest_airport,
        ...(originScope.nearest_suggestion ? { nearest_suggestion: originScope.nearest_suggestion } : {}),
      },
      dest_info: {
        query: dto.destination,
        resolved_iata: legacyDestIata,
        using_nearest_airport: !!destScope.using_nearest_airport,
        ...(destScope.nearest_suggestion ? { nearest_suggestion: destScope.nearest_suggestion } : {}),
      },
      origin_scope: { 
        kind: originScope.matched_kind, 
        label: originScope.label, 
        iata_codes: originScope.iata_codes,
        ...(originScope.iata_codes.length > 1 ? { airports_with_flights: originAirportsWithFlights } : {})
      },
      dest_scope: { 
        kind: destScope.matched_kind, 
        label: destScope.label, 
        iata_codes: destScope.iata_codes,
        ...(destScope.iata_codes.length > 1 ? { airports_with_flights: destAirportsWithFlights } : {})
      },
      is_round_trip: !!dto.return_date,
      passenger_breakdown: { adults, children, seniors, total: totalPassengers },
      onward_flights: onwardDirect,
      return_flights: returnFlights,
      connecting_routes: connectingRoutes,
      return_connecting_routes: returnConnectingRoutes,
      route_network_suggestions: routeNetworkSuggestions,
      network_status: networkDiscovery?.status,
      network_itineraries: networkDiscovery?.itineraries,
      network_coverage: networkDiscovery?.coverage,
      network_discovery: networkDiscovery,
      return_route_network_suggestions: returnRouteNetworkSuggestions,
      return_network_status: returnNetworkDiscovery?.status,
      return_network_itineraries: returnNetworkDiscovery?.itineraries,
      return_network_coverage: returnNetworkDiscovery?.coverage,
      return_network_discovery: returnNetworkDiscovery,
    };
  }

  private async findDirectFlights(
    originIatas: string[],
    destIatas: string[],
    departureDate: string,
    departureDateEnd: string | undefined,
    cabinClass?: string,
    isSmoking?: boolean,
    totalPassengers = 1,
    adults = 1,
    children = 0,
    seniors = 0,
  ) {
    if (originIatas.length === 0 || destIatas.length === 0) return [];

    const filter: any = {
      ...getCustomerBookableFlightFilter(),
      origin_iata: { $in: originIatas },
      dest_iata: { $in: destIatas },
    };

    if (departureDateEnd) {
      filter.departure_date = { $gte: departureDate, $lte: departureDateEnd };
    } else {
      filter.departure_date = departureDate;
    }

    const flights = await this.flightModel.find(filter).sort({ scheduled_departure: 1 }).exec();
    
    const tzMap: Record<string, string> = {};
    const cityMap: Record<string, string> = {};
    const countryMap: Record<string, string> = {};
    
    const getAirportInfo = async (iata: string) => {
      if (tzMap[iata]) return { tz: tzMap[iata], city: cityMap[iata], country: countryMap[iata] };
      try {
        const apt = await this.airportsService.findByIata(iata);
        if (apt) {
           tzMap[iata] = apt.time_zone;
           cityMap[iata] = apt.city_name;
           countryMap[iata] = apt.country_code || '';
        }
      } catch (e) {
        tzMap[iata] = 'UTC';
        cityMap[iata] = '';
        countryMap[iata] = '';
      }
      return { tz: tzMap[iata] || 'UTC', city: cityMap[iata] || '', country: countryMap[iata] || '' };
    };

    const formatLocal = (d: Date, tz: string) => {
       const offset = utcOffsetMinutes(d, tz);
       const iso = new Date(d.getTime() + offset * 60000).toISOString();
       return iso.substring(0, 16).replace('T', ' ');
    };

    const now = Date.now();
    const formattedResults: any[] = [];
    for (const fl of flights) {
      const oInfo = await getAirportInfo(fl.origin_iata);
      const dInfo = await getAirportInfo(fl.dest_iata);
      const originTz = oInfo.tz;
      const destTz = dInfo.tz;

      const depOffset = utcOffsetMinutes(fl.scheduled_departure, originTz);
      const arrOffset = utcOffsetMinutes(fl.scheduled_arrival, destTz);
      
      const daysUntilDeparture = Math.max(0, (fl.scheduled_departure.getTime() - now) / 86400000);
      const earlyBird = earlyBirdQuote(daysUntilDeparture);
      
      for (const inv of fl.inventories) {
        if (cabinClass && inv.cabin_class !== cabinClass) continue;
        if (isSmoking !== undefined && inv.is_smoking !== isSmoking) continue;
        if (inv.available_seats < totalPassengers) continue;

        const discountedBase = inv.base_price * earlyBird.multiplier;
        const adultPrice = Math.round(discountedBase);
        const childPrice = Math.round(discountedBase * 0.75);
        const seniorPrice = Math.round(discountedBase * 0.85);
        const totalPartyPrice =
          adults * adultPrice + children * childPrice + seniors * seniorPrice;

        formattedResults.push({
          flight_id: fl._id,
          flight_number: fl.flight_number,
          origin_iata: fl.origin_iata,
          dest_iata: fl.dest_iata,
          origin_city: oInfo.city,
          dest_city: dInfo.city,
          origin_country: oInfo.country,
          dest_country: dInfo.country,
          departure_date: fl.departure_date,
          scheduled_departure: fl.scheduled_departure,
          scheduled_arrival: fl.scheduled_arrival,
          origin_time_zone: originTz,
          dest_time_zone: destTz,
          scheduled_departure_local: formatLocal(fl.scheduled_departure, originTz),
          scheduled_arrival_local: formatLocal(fl.scheduled_arrival, destTz),
          time_zone_diff_minutes: arrOffset - depOffset,
          duration_minutes: fl.duration_minutes,
          distance_miles: fl.distance_miles,
          status: fl.status,
          delay_reason: fl.delay_reason,
          aircraft: fl.aircraft,
          inventory_id: (inv as any)._id,
          cabin_class: inv.cabin_class,
          is_smoking: inv.is_smoking,
          available_seats: inv.available_seats,
          base_price_per_adult: adultPrice,
          total_party_price: totalPartyPrice,
          early_bird_percent: earlyBird.percent,
          early_bird_label: earlyBird.label,
          early_bird_label_en: earlyBird.label_en,
          days_until_departure: Math.floor(daysUntilDeparture),
        });
      }
    }
    return formattedResults;
  }

  private async findConnectingRoutes(
    originIatas: string[],
    destIatas: string[],
    departureDate: string,
    totalPassengers: number,
    adults: number,
    children: number,
    seniors: number,
    departureDateEnd?: string,
    cabinClass?: CabinClass,
  ): Promise<any[]> {
    if (originIatas.length === 0 || destIatas.length === 0) return [];

    const connectingOptions: any[] = [];
    const now = Date.now();
    const seenCombos = new Set<string>();
    
    const tzMap: Record<string, string> = {};
    const getTz = async (iata: string) => {
      if (tzMap[iata]) return tzMap[iata];
      try {
        const apt = await this.airportsService.findByIata(iata);
        if (apt) tzMap[iata] = apt.time_zone;
      } catch (e) {
        tzMap[iata] = 'UTC';
      }
      return tzMap[iata] || 'UTC';
    };

    const formatLocal = (d: Date, tz: string) => {
       const offset = utcOffsetMinutes(d, tz);
       const iso = new Date(d.getTime() + offset * 60000).toISOString();
       return iso.substring(0, 16).replace('T', ' ');
    };

    const processLeg = async (leg: any) => {
      const oTz = await getTz(leg.origin_iata);
      const dTz = await getTz(leg.dest_iata);
      const daysUntilDeparture = leg.scheduled_departure ? Math.max(0, (new Date(leg.scheduled_departure).getTime() - now) / 86400000) : 0;
      const earlyBird = earlyBirdQuote(daysUntilDeparture);
      
      const mappedInventories = leg.inventories
        .filter(
          (i: any) =>
            (!cabinClass || i.cabin_class === cabinClass) &&
            i.available_seats >= totalPassengers,
        )
        .map((inv: any) => {
            const rawInv = typeof inv.toObject === 'function' ? inv.toObject() : inv;
            const discountedBase = Math.round(inv.base_price * earlyBird.multiplier);
            const childPrice = Math.round(discountedBase * 0.75);
            const seniorPrice = Math.round(discountedBase * 0.85);
            const totalPartyPrice = adults * discountedBase + children * childPrice + seniors * seniorPrice;
            
            return {
                ...rawInv,
                base_price_per_adult: discountedBase,
                total_party_price: totalPartyPrice,
                early_bird_percent: earlyBird.percent,
                early_bird_label: earlyBird.label,
                early_bird_label_en: earlyBird.label_en,
                days_until_departure: Math.floor(daysUntilDeparture)
            };
        });

      return {
        flight_id: leg._id,
        flight_number: leg.flight_number,
        origin_iata: leg.origin_iata,
        dest_iata: leg.dest_iata,
        departure_date: leg.departure_date,
        departure: leg.scheduled_departure,
        arrival: leg.scheduled_arrival,
        origin_time_zone: oTz,
        dest_time_zone: dTz,
        scheduled_departure_local: formatLocal(leg.scheduled_departure, oTz),
        scheduled_arrival_local: formatLocal(leg.scheduled_arrival, dTz),
        inventories: mappedInventories,
      };
    };

    // Authoritative Zero N+1 Database-Driven Multi-Hop Connecting Search (0/1/2-Stop)
    // Operates strictly on concrete dated Flight documents enforcing operator='APTECH_AIRLINES', is_bookable=true,
    // status != CANCELLED, requested passenger inventory, requested cabin, and 45-720 minute layover windows.
    const leg1DateFilter = departureDateEnd
      ? { $gte: departureDate, $lte: departureDateEnd }
      : departureDate;

    const leg1Flights = await this.flightModel
      .find({
        ...getCustomerBookableFlightFilter(),
        origin_iata: { $in: originIatas },
        departure_date: leg1DateFilter,
        'inventories.available_seats': { $gte: totalPassengers },
      })
      .exec();

    if (leg1Flights.length === 0) return connectingOptions;

    // Collect candidate transit 1 airports
    const transit1Iatas = Array.from(
      new Set(
        leg1Flights
          .map((f: any) => f.dest_iata)
          .filter((iata: string) => !originIatas.includes(iata) && !destIatas.includes(iata)),
      ),
    );

    if (transit1Iatas.length === 0) return connectingOptions;

    const baseDepDate = new Date(`${departureDate}T00:00:00+07:00`);
    const nextDayDate = new Date(baseDepDate.getTime() + 86400000);
    const nextDateStr = localDateKey(nextDayDate, 'Asia/Ho_Chi_Minh');
    const dayAfterDate = new Date(nextDayDate.getTime() + 86400000);
    const dayAfterStr = localDateKey(dayAfterDate, 'Asia/Ho_Chi_Minh');

    const leg2Dates = departureDateEnd
      ? [departureDate, nextDateStr, dayAfterStr, departureDateEnd]
      : [departureDate, nextDateStr, dayAfterStr];

    const leg2OriginFilter = transit1Iatas.length === 1 ? transit1Iatas[0] : { $in: transit1Iatas };
    const leg2Flights = await this.flightModel
      .find({
        ...getCustomerBookableFlightFilter(),
        origin_iata: leg2OriginFilter,
        departure_date: { $in: leg2Dates },
        'inventories.available_seats': { $gte: totalPassengers },
      })
      .exec();

    const leg2ByOrigin = new Map<string, any[]>();
    for (const fl of leg2Flights) {
      if (!leg2ByOrigin.has(fl.origin_iata)) {
        leg2ByOrigin.set(fl.origin_iata, []);
      }
      leg2ByOrigin.get(fl.origin_iata)!.push(fl);
    }

    // Collect candidate transit 2 airports for 2-stop routing
    const transit2Iatas = new Set<string>();
    for (const fl of leg2Flights) {
      if (!destIatas.includes(fl.dest_iata) && !originIatas.includes(fl.dest_iata)) {
        transit2Iatas.add(fl.dest_iata);
      }
    }

    const transit2Arr = Array.from(transit2Iatas);
    let leg3Flights: any[] = [];
    if (transit2Arr.length > 0) {
      const leg3OriginFilter = transit2Arr.length === 1 ? transit2Arr[0] : { $in: transit2Arr };
      leg3Flights = await this.flightModel
        .find({
          ...getCustomerBookableFlightFilter(),
          origin_iata: leg3OriginFilter,
          dest_iata: { $in: destIatas },
          departure_date: { $in: leg2Dates },
          'inventories.available_seats': { $gte: totalPassengers },
        })
        .exec();
    }

    const leg3ByOrigin = new Map<string, any[]>();
    for (const fl of leg3Flights) {
      if (!leg3ByOrigin.has(fl.origin_iata)) {
        leg3ByOrigin.set(fl.origin_iata, []);
      }
      leg3ByOrigin.get(fl.origin_iata)!.push(fl);
    }

    for (const leg1 of leg1Flights) {
      const leg1ArrTime = new Date(leg1.scheduled_arrival).getTime();
      const candidates2 = leg2ByOrigin.get(leg1.dest_iata) || [];

      for (const leg2 of candidates2) {
        const leg2DepTime = new Date(leg2.scheduled_departure).getTime();
        const layover1 = Math.round((leg2DepTime - leg1ArrTime) / 60000);
        if (layover1 < 45 || layover1 > 720) continue;

        const dur1 = leg1.duration_minutes ?? Math.round((new Date(leg1.scheduled_arrival).getTime() - new Date(leg1.scheduled_departure).getTime()) / 60000);
        const dur2 = leg2.duration_minutes ?? Math.round((new Date(leg2.scheduled_arrival).getTime() - new Date(leg2.scheduled_departure).getTime()) / 60000);

        if (destIatas.includes(leg2.dest_iata)) {
          // 1-Stop Connection
          const comboKey = `${leg1._id.toString()}>${leg2._id.toString()}`;
          if (!seenCombos.has(comboKey)) {
            seenCombos.add(comboKey);
            const pLeg1 = await processLeg(leg1);
            const pLeg2 = await processLeg(leg2);
            if (pLeg1.inventories?.length > 0 && pLeg2.inventories?.length > 0) {
              connectingOptions.push({
                route_type: 'ONE_STOP',
                departure_date: pLeg1.departure_date,
                transit_airport: leg1.dest_iata,
                transit_airports: [leg1.dest_iata],
                total_duration_minutes: dur1 + layover1 + dur2,
                layover_minutes: layover1,
                leg1: pLeg1,
                leg2: pLeg2,
                legs: [pLeg1, pLeg2],
              });
            }
          }
        } else {
          // 2-Stop Connection Candidate
          const leg2ArrTime = new Date(leg2.scheduled_arrival).getTime();
          const candidates3 = leg3ByOrigin.get(leg2.dest_iata) || [];

          for (const leg3 of candidates3) {
            const leg3DepTime = new Date(leg3.scheduled_departure).getTime();
            const layover2 = Math.round((leg3DepTime - leg2ArrTime) / 60000);
            if (layover2 < 45 || layover2 > 720) continue;

            const dur3 = leg3.duration_minutes ?? Math.round((new Date(leg3.scheduled_arrival).getTime() - new Date(leg3.scheduled_departure).getTime()) / 60000);

            const comboKey3 = `${leg1._id.toString()}>${leg2._id.toString()}>${leg3._id.toString()}`;
            if (!seenCombos.has(comboKey3)) {
              seenCombos.add(comboKey3);
              const pLeg1 = await processLeg(leg1);
              const pLeg2 = await processLeg(leg2);
              const pLeg3 = await processLeg(leg3);
              if (
                pLeg1.inventories?.length > 0 &&
                pLeg2.inventories?.length > 0 &&
                pLeg3.inventories?.length > 0
              ) {
                connectingOptions.push({
                  route_type: 'TWO_STOP',
                  departure_date: pLeg1.departure_date,
                  transit_airport: leg1.dest_iata,
                  transit_airports: [leg1.dest_iata, leg2.dest_iata],
                  total_duration_minutes: dur1 + layover1 + dur2 + layover2 + dur3,
                  layover_minutes: [layover1, layover2],
                  leg1: pLeg1,
                  leg2: pLeg2,
                  legs: [pLeg1, pLeg2, pLeg3],
                });
              }
            }
          }
        }
      }
    }

    return connectingOptions;
  }

  /**
   * Discover multi-hop external route network itineraries via cached AirLabs RouteRef & RouteGraphService
   * with strictly bounded on-demand airport expansion (max 8 expansions per customer search request).
   */
  async discoverNetworkRoutes(
    originIatas: string[],
    destIatas: string[],
    departureDate: string,
  ): Promise<{
    status: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
    itineraries: ValidatedItinerary[];
    coverage: RouteGraphCoverage;
  }> {
    if (!this.routeGraphService || !this.routeScheduleValidatorService) {
      return {
        status: 'NETWORK_DATA_INCOMPLETE',
        itineraries: [],
        coverage: {
          complete: false,
          expanded_airports: [],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      };
    }

    const MAX_ON_DEMAND_AIRPORT_EXPANSIONS = 8;
    const PRIORITY_HUBS = [
      'SGN', 'HAN', 'DAD', 'SIN', 'BKK', 'KUL', 'HKG', 'PVG', 'PEK', 'CAN',
      'NRT', 'HND', 'KIX', 'ICN', 'TPE', 'MNL', 'CGK', 'DEL', 'BOM', 'DXB',
      'DOH', 'AUH', 'IST', 'LHR', 'CDG', 'FRA', 'AMS', 'JFK', 'LAX', 'SYD', 'MEL',
    ];

    const cleanOrigins = Array.from(
      new Set((originIatas || []).map(s => s?.trim().toUpperCase()).filter(Boolean)),
    );
    const cleanDestinations = Array.from(
      new Set((destIatas || []).map(s => s?.trim().toUpperCase()).filter(Boolean)),
    );

    if (cleanOrigins.length === 0 || cleanDestinations.length === 0) {
      return {
        status: 'NO_ROUTE_FOUND',
        itineraries: [],
        coverage: {
          complete: true,
          expanded_airports: [],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      };
    }

    const destSet = new Set(cleanDestinations);

    // Initial graph exploration with maxStops = 2
    let graphResult = await this.routeGraphService.findPaths(cleanOrigins, cleanDestinations, {
      maxStops: 2,
      source: 'airlabs',
    });

    if (!graphResult) {
      graphResult = {
        paths: [],
        coverage: { complete: false, expanded_airports: [], incomplete_airports: [], missing_sync_state_airports: [] },
      };
    }
    if (!graphResult.paths) graphResult.paths = [];
    if (!graphResult.coverage) {
      graphResult.coverage = { complete: false, expanded_airports: [], incomplete_airports: [], missing_sync_state_airports: [] };
    }

    let expansionsCount = 0;
    const attemptedAirports = new Set<string>();
    let hitRateLimit = false;

    while (expansionsCount < MAX_ON_DEMAND_AIRPORT_EXPANSIONS) {
      // 1. Check if current graph results yield valid flight itineraries on the departure date
      if (graphResult.paths.length > 0) {
        const validationResult = this.routeScheduleValidatorService.validatePaths(
          graphResult,
          departureDate,
          { minLayoverMinutes: 45, maxLayoverMinutes: 720 },
        );
        if (validationResult.itineraries.length > 0) {
          return {
            status: 'FOUND',
            itineraries: this.formatAndSortNetworkItineraries(validationResult.itineraries),
            coverage: graphResult.coverage,
          };
        }
      }

      // 2. If coverage is complete and no valid path found, stop with NO_ROUTE_FOUND
      if (graphResult.coverage.complete) {
        return {
          status: 'NO_ROUTE_FOUND',
          itineraries: [],
          coverage: graphResult.coverage,
        };
      }

      // 3. Find candidate airports for bounded on-demand expansion (only missing/incomplete nodes)
      const missingCandidates = (graphResult.coverage.missing_sync_state_airports || []).filter(
        a => !attemptedAirports.has(a) && !destSet.has(a),
      );
      const incompleteCandidates = (graphResult.coverage.incomplete_airports || []).filter(
        a => !attemptedAirports.has(a) && !destSet.has(a) && !missingCandidates.includes(a),
      );

      // Separate candidates into origins vs transit hubs
      const originSet = new Set(cleanOrigins);
      const missingOrigins = missingCandidates.filter(a => originSet.has(a));
      const incompleteOrigins = incompleteCandidates.filter(a => originSet.has(a));

      const missingTransits = missingCandidates.filter(a => !originSet.has(a));
      const incompleteTransits = incompleteCandidates.filter(a => !originSet.has(a));

      // Sort candidate transits: priority hubs first, then alphabetical
      const transitCandidates = [...missingTransits, ...incompleteTransits].sort((a, b) => {
        const idxA = PRIORITY_HUBS.indexOf(a);
        const idxB = PRIORITY_HUBS.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      const allCandidates = [...missingOrigins, ...incompleteOrigins, ...transitCandidates];
      if (allCandidates.length === 0) {
        // Frontier exhausted, no more candidate airports can be expanded
        break;
      }

      const nextAirport = allCandidates[0];
      attemptedAirports.add(nextAirport);
      expansionsCount++;

      hitRateLimit = false;
      try {
        const ensureRes = await this.referenceService.ensureRoutesForAirport(nextAirport);
        if (ensureRes?.refresh_error) {
          const isRateLimit =
            ensureRes.refresh_error.includes('429') ||
            ensureRes.refresh_error.toLowerCase().includes('rate limit') ||
            ensureRes.refresh_error.toLowerCase().includes('quota');
          if (isRateLimit) {
            this.logger.warn(`AirLabs 429 Rate Limit encountered in refresh_error while expanding airport ${nextAirport}. Stopping.`);
            hitRateLimit = true;
          }
        }
      } catch (err: any) {
        const isRateLimit =
          err.status === 429 ||
          err.message?.includes('429') ||
          err.message?.toLowerCase().includes('rate limit') ||
          err.message?.toLowerCase().includes('quota');
        if (isRateLimit) {
          this.logger.warn(`AirLabs 429 Rate Limit encountered while expanding airport ${nextAirport}. Stopping.`);
          hitRateLimit = true;
        } else {
          this.logger.warn(`Error ensuring routes for airport ${nextAirport}: ${err.message}`);
        }
      }

      if (hitRateLimit) {
        break;
      }

      // Re-run findPaths after expansion
      graphResult = await this.routeGraphService.findPaths(cleanOrigins, cleanDestinations, {
        maxStops: 2,
        source: 'airlabs',
      });

      if (!graphResult) {
        graphResult = {
          paths: [],
          coverage: { complete: false, expanded_airports: [], incomplete_airports: [], missing_sync_state_airports: [] },
        };
      }
      if (!graphResult.paths) graphResult.paths = [];
      if (!graphResult.coverage) {
        graphResult.coverage = { complete: false, expanded_airports: [], incomplete_airports: [], missing_sync_state_airports: [] };
      }
    }

    if (hitRateLimit) {
      return {
        status: 'NETWORK_DATA_INCOMPLETE',
        itineraries: [],
        coverage: {
          ...graphResult.coverage,
          complete: false,
        },
      };
    }

    // Final evaluation after expansion loop completes
    if (graphResult.paths.length > 0) {
      const validationResult = this.routeScheduleValidatorService.validatePaths(
        graphResult,
        departureDate,
        { minLayoverMinutes: 45, maxLayoverMinutes: 720 },
      );
      if (validationResult.itineraries.length > 0) {
        return {
          status: 'FOUND',
          itineraries: this.formatAndSortNetworkItineraries(validationResult.itineraries),
          coverage: graphResult.coverage,
        };
      }
    }

    if (graphResult.coverage.complete) {
      return {
        status: 'NO_ROUTE_FOUND',
        itineraries: [],
        coverage: graphResult.coverage,
      };
    }

    return {
      status: 'NETWORK_DATA_INCOMPLETE',
      itineraries: [],
      coverage: graphResult.coverage,
    };
  }

  private formatAndSortNetworkItineraries(itineraries: ValidatedItinerary[]): ValidatedItinerary[] {
    const sorted = [...itineraries].sort((a, b) => {
      // 1. Number of stops ascending (0 stops < 1 stop < 2 stops)
      if (a.stops.length !== b.stops.length) {
        return a.stops.length - b.stops.length;
      }
      // 2. Total duration ascending
      if (a.total_duration_minutes !== b.total_duration_minutes) {
        return a.total_duration_minutes - b.total_duration_minutes;
      }
      // 3. Earliest departure datetime
      const depTimeA = a.legs[0]?.dep_datetime ? new Date(a.legs[0].dep_datetime).getTime() : 0;
      const depTimeB = b.legs[0]?.dep_datetime ? new Date(b.legs[0].dep_datetime).getTime() : 0;
      if (depTimeA !== depTimeB) {
        return depTimeA - depTimeB;
      }
      // 4. Deterministic lexical tiebreaker
      const keyA = a.legs.map(l => l.source_key || `${l.airline_iata}_${l.dep_iata}_${l.arr_iata}`).join('>');
      const keyB = b.legs.map(l => l.source_key || `${l.airline_iata}_${l.dep_iata}_${l.arr_iata}`).join('>');
      return keyA.localeCompare(keyB);
    });

    return sorted.slice(0, 20).map(itin => ({
      ...itin,
      is_bookable: false,
      inventories: [],
      legs: itin.legs.map(leg => ({
        ...leg,
        is_bookable: false,
        inventories: [],
      })),
    }));
  }

  private mapItinerariesToSuggestions(itineraries: ValidatedItinerary[]): any[] {
    const suggestions: any[] = [];
    const seenTransits = new Set<string>();

    for (const itin of itineraries) {
      if (itin.stops.length === 0) continue;
      const transitKey = itin.stops.join('-');
      if (seenTransits.has(transitKey)) continue;
      seenTransits.add(transitKey);

      if (itin.legs.length === 2) {
        suggestions.push({
          transit_airport: itin.stops[0],
          leg1: {
            airline_iata: itin.legs[0].airline_iata,
            dep_iata: itin.legs[0].dep_iata,
            arr_iata: itin.legs[0].arr_iata,
          },
          leg2: {
            airline_iata: itin.legs[1].airline_iata,
            dep_iata: itin.legs[1].dep_iata,
            arr_iata: itin.legs[1].arr_iata,
          },
          note: `Tuyến nối qua ${itin.stops[0]} (AirLabs Route Network) - không thể đặt vé trực tiếp trên Aptech Airlines`,
        });
      } else if (itin.legs.length === 3) {
        suggestions.push({
          transit_airport: `${itin.stops[0]}, ${itin.stops[1]}`,
          leg1: {
            airline_iata: itin.legs[0].airline_iata,
            dep_iata: itin.legs[0].dep_iata,
            arr_iata: itin.legs[0].arr_iata,
          },
          leg2: {
            airline_iata: itin.legs[1].airline_iata,
            dep_iata: itin.legs[1].dep_iata,
            arr_iata: itin.legs[1].arr_iata,
          },
          leg3: {
            airline_iata: itin.legs[2].airline_iata,
            dep_iata: itin.legs[2].dep_iata,
            arr_iata: itin.legs[2].arr_iata,
          },
          note: `Tuyến nối 2 điểm dừng qua ${itin.stops[0]} và ${itin.stops[1]} (AirLabs Route Network) - không thể đặt vé trực tiếp trên Aptech Airlines`,
        });
      }
    }

    return suggestions;
  }

  /**
   * Bounded Nearby-Date Availability Search (Requirement 3.3.3 & Phase A)
   * Evaluates real availability (+-7 days) when exact date yields no result.
   */
  async getNearbyAvailability(
    origin: string,
    destination: string,
    dateStr: string,
    cabinClass?: CabinClass,
    passengers = 1,
    adults = 1,
    children = 0,
    seniors = 0,
    isSmoking = false,
  ): Promise<{
    origin: string;
    destination: string;
    requested_date: string;
    date_range: { min_date: string; max_date: string };
    available_dates: Array<{
      date: string;
      day_of_week: string;
      min_price: number;
      has_direct: boolean;
      available_itineraries_count: number;
    }>;
  }> {
    const originScope = await this.referenceService.expandLocation(origin);
    const destScope = await this.referenceService.expandLocation(destination);

    const targetDate = new Date(`${dateStr}T00:00:00+07:00`);
    const now = new Date();
    const todayStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
    const today = new Date(`${todayStr}T00:00:00+07:00`);
    const maxDate = new Date(today.getTime() + 329 * 86400000);

    const results: Array<{
      date: string;
      day_of_week: string;
      min_price: number;
      has_direct: boolean;
      available_itineraries_count: number;
    }> = [];

    const offsets = [-3, -2, -1, 1, 2, 3, -7, -6, -5, -4, 4, 5, 6, 7];
    const checkedDates = new Set<string>();

    for (const offset of offsets) {
      const candDate = new Date(targetDate.getTime() + offset * 86400000);
      if (candDate < today || candDate > maxDate) continue;

      const candDateStr = localDateKey(candDate, 'Asia/Ho_Chi_Minh');
      if (candDateStr === dateStr || checkedDates.has(candDateStr)) continue;
      checkedDates.add(candDateStr);

      // 1. Direct Flights
      const directs = await this.findDirectFlights(
        originScope.iata_codes,
        destScope.iata_codes,
        candDateStr,
        undefined,
        cabinClass,
        isSmoking,
        passengers,
        adults,
        children,
        seniors,
      );

      // 2. Connecting Flights (if no direct or for coverage)
      let connecting: any[] = [];
      if (directs.length === 0) {
        connecting = await this.findConnectingRoutes(
          originScope.iata_codes,
          destScope.iata_codes,
          candDateStr,
          passengers,
          adults,
          children,
          seniors,
          undefined,
          cabinClass,
        );
      }

      const validCount = directs.length + connecting.length;
      if (validCount > 0) {
        let minPrice = Infinity;
        for (const d of directs) {
          const p = d.total_party_price || d.base_price_per_adult || 0;
          if (p > 0 && p < minPrice) minPrice = p;
        }
        for (const c of connecting) {
          let partyTotal = 0;
          const legs = c.legs || [c.leg1, c.leg2];
          for (const leg of legs) {
            const inv = leg.inventories?.find((i: any) => !cabinClass || i.cabin_class === cabinClass);
            if (inv) partyTotal += inv.total_party_price || inv.base_price_per_adult || 0;
          }
          if (partyTotal > 0 && partyTotal < minPrice) {
            minPrice = partyTotal;
          }
        }

        const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        results.push({
          date: candDateStr,
          day_of_week: dayNames[candDate.getDay()],
          min_price: minPrice === Infinity ? 0 : minPrice,
          has_direct: directs.length > 0,
          available_itineraries_count: validCount,
        });
      }
    }

    results.sort((a, b) => a.date.localeCompare(b.date));
    const maxDateStr = localDateKey(maxDate, 'Asia/Ho_Chi_Minh');
    return {
      origin,
      destination,
      requested_date: dateStr,
      date_range: {
        min_date: todayStr,
        max_date: maxDateStr,
      },
      available_dates: results,
    };
  }

  /**
   * Phase B: Aircraft-specific seat map (A20N, A21N, B789, A359, B738, AT76).
   * ZERO universal A321 fallback.
   */
  async getSeatMap(flightId: string) {
    const flight = await this.findById(flightId);
    if (flight.is_bookable === false || (flight.operator && flight.operator !== 'APTECH_AIRLINES')) {
      throw new BadRequestException(
        'Seat map is only available for bookable Aptech Airlines flights.',
      );
    }

    // Lấy danh sách ghế đã được đặt trong DB từ Bookings
    const bookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $ne: 'CANCELLED' },
      })
      .exec();

    const occupiedSet = new Set<string>();
    for (const b of bookings) {
      for (const coupon of (b.ticket_coupons || [])) {
        if (coupon.flight_id?.toString() === flight._id.toString() && coupon.seat_code) {
          occupiedSet.add(coupon.seat_code.toUpperCase());
        }
      }
    }

    // Resolve real aircraft type
    let aircraftType: string | null = null;
    const modelCode = flight.aircraft?.model_code?.toUpperCase();
    const modelName = flight.aircraft?.model_name;

    if (modelCode && FLEET_LAYOUT_CATALOG[modelCode]) {
      aircraftType = modelCode;
    } else if (modelName) {
      if (/A321/i.test(modelName)) aircraftType = 'A21N';
      else if (/A320/i.test(modelName)) aircraftType = 'A20N';
      else if (/787/i.test(modelName)) aircraftType = 'B789';
      else if (/A350/i.test(modelName)) aircraftType = 'A359';
      else if (/737/i.test(modelName)) aircraftType = 'B738';
      else if (/ATR/i.test(modelName)) aircraftType = 'AT76';
    }

    let enrichedMap: any = null;
    if (aircraftType && this.seatAllocationService) {
      try {
        enrichedMap = await this.seatAllocationService.getSeatMap(flight._id, aircraftType);
      } catch (err: any) {
        this.logger.error(
          `Authoritative seat map and pricing resolution failed for flight ${flight._id}: ${err?.message || err}`,
        );
        throw new ServiceUnavailableException(
          'Authoritative seat map and pricing are temporarily unavailable. Please try again later.',
        );
      }
    }

    const rows: any[] = [];

    if (!aircraftType) {
      return {
        flight_id: flight._id,
        flight_number: flight.flight_number,
        route: `${flight.origin_iata} - ${flight.dest_iata}`,
        aircraft_model: flight.aircraft?.model_name ?? null,
        aircraft_known: false,
        layout_available: false,
        layout_notice: 'Aircraft model is not configured or recognized for this flight.',
        departure_time: flight.scheduled_departure,
        rows: [],
      };
    }

    const layout = FLEET_LAYOUT_CATALOG[aircraftType];

    for (const rConfig of layout.rows) {
      const isExit = rConfig.is_exit_row ?? false;
      const isSpecial = rConfig.cabin_class === CabinClass.BUSINESS || (rConfig.is_extra_legroom ?? false);

      const seats: any[] = [];
      const columnGroups: any[][] = [];

      for (const group of rConfig.column_groups) {
        const groupSeats: any[] = [];
        for (const col of group) {
          const seatCode = `${rConfig.row_number}${col}`;
          let isOccupied = occupiedSet.has(seatCode);
          let fee = 0;
          let type: 'SPECIAL' | 'EXIT_ROW' | 'STANDARD' = 'STANDARD';
          let typeLabel = 'Còn trống';

          if (isExit) {
            type = 'EXIT_ROW';
            typeLabel = 'Hàng ghế gần lối thoát hiểm';
          } else if (isSpecial) {
            type = 'SPECIAL';
            typeLabel = rConfig.cabin_class === CabinClass.BUSINESS ? 'Thương gia' : 'Đặc biệt';
          }

          if (enrichedMap) {
            const enrichedRow = enrichedMap.rows?.find((r: any) => r.row_number === rConfig.row_number);
            if (enrichedRow) {
              for (const grp of enrichedRow.column_groups) {
                const enrichedSeat = grp.find((s: any) => s.seat_code === seatCode);
                if (enrichedSeat) {
                  if (enrichedSeat.status === 'OCCUPIED' || enrichedSeat.status === 'HELD' || enrichedSeat.status === 'BLOCKED') {
                    isOccupied = true;
                  }
                  if (enrichedSeat.seat_fee !== undefined) {
                    fee = enrichedSeat.seat_fee;
                  }
                }
              }
            }
          }

          const seatObj = {
            seat_code: seatCode,
            row: rConfig.row_number,
            column: col,
            type,
            type_label: typeLabel,
            cabin_class: rConfig.cabin_class,
            fee,
            is_occupied: isOccupied,
            is_exit_row: isExit,
            is_special: isSpecial,
          };

          seats.push(seatObj);
          groupSeats.push(seatObj);
        }
        columnGroups.push(groupSeats);
      }

      rows.push({
        row_number: rConfig.row_number,
        is_exit_row: isExit,
        is_special: isSpecial,
        column_groups: columnGroups,
        seats,
      });
    }

    return {
      flight_id: flight._id,
      flight_number: flight.flight_number,
      route: `${flight.origin_iata} - ${flight.dest_iata}`,
      aircraft_model: flight.aircraft?.model_name ?? null,
      aircraft_known: !!flight.aircraft?.model_name,
      aircraft_type: aircraftType,
      total_capacity: layout.total_capacity,
      cabin_capacities: layout.cabin_capacities,
      layout_notice: `Aircraft cabin layout for ${layout.model_name} (${layout.total_capacity} seats).`,
      departure_time: flight.scheduled_departure,
      legend: [
        { type: 'AVAILABLE', label: 'Còn trống', color: '#22c55e', bg: 'bg-green-500' },
        { type: 'SELECTED', label: 'Đã chọn', color: '#eab308', bg: 'bg-yellow-400' },
        { type: 'EXIT_ROW', label: 'Hàng ghế gần lối thoát hiểm', color: '#3b82f6', bg: 'bg-blue-500' },
        { type: 'SPECIAL', label: 'Đặc biệt', color: '#ef4444', bg: 'bg-red-500' },
        { type: 'OCCUPIED', label: 'Đã bị chọn / không có', color: '#9ca3af', bg: 'bg-gray-400' },
      ],
      rows,
    };
  }

  /**
   * Đồng bộ chuyến bay thật từ AirLabs API (airlabs.co)
   * @param depIata Mã sân bay đi (VD: 'HAN')
   * @param arrIata Mã sân bay đến (VD: 'SGN')
   * @param customApiKey API Key do người dùng truyền vào (nếu không dùng file .env)
   */
  async syncFromAirLabs(
    mode: string = 'route',
    depIata?: string,
    arrIata?: string,
    airlineIata?: string,
    flightIata?: string,
    limit: number = 50,
    offset: number = 0,
    customApiKey?: string,
  ): Promise<{
    mode: string;
    request_params: any;
    fetched_count: number;
    created_or_updated_count: number;
    has_more: boolean;
    next_offset: number;
    window_note: string;
    message: string;
    synchronized_count: number;
    flights: any[];
  }> {
    const apiKey = customApiKey || process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env hoặc truyền tham số api_key vào request.',
      );
    }

    let urlParams = `api_key=${apiKey}&offset=${offset}`;

    if (mode === 'route') {
      if (!depIata || !arrIata) {
        throw new BadRequestException('Chế độ route yêu cầu phải có cả dep_iata và arr_iata.');
      }
      urlParams += `&dep_iata=${depIata.toUpperCase()}&arr_iata=${arrIata.toUpperCase()}&limit=${Math.min(limit, 1000)}`;
    } else if (mode === 'departure') {
      if (!depIata) {
        throw new BadRequestException('Chế độ departure yêu cầu phải có dep_iata.');
      }
      urlParams += `&dep_iata=${depIata.toUpperCase()}&limit=${Math.min(limit, 1000)}`;
    } else if (mode === 'arrival') {
      if (!arrIata) {
        throw new BadRequestException('Chế độ arrival yêu cầu phải có arr_iata.');
      }
      urlParams += `&arr_iata=${arrIata.toUpperCase()}&limit=${Math.min(limit, 1000)}`;
    } else if (mode === 'airline') {
      if (!airlineIata) {
        throw new BadRequestException('Chế độ airline yêu cầu phải có airline_iata.');
      }
      urlParams += `&airline_iata=${airlineIata.toUpperCase()}&limit=${Math.min(limit, 200)}`;
    } else if (mode === 'flight') {
      if (!flightIata) {
        throw new BadRequestException('Chế độ flight yêu cầu phải có flight_iata.');
      }
      urlParams += `&flight_iata=${flightIata.toUpperCase()}&limit=${Math.min(limit, 1000)}`;
    } else {
      throw new BadRequestException('Chế độ không hợp lệ. Hãy dùng route, departure, arrival, airline, hoặc flight.');
    }

    const url = `https://airlabs.co/api/v9/schedules?${urlParams}`;

    let responseData: any;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`AirLabs API trả về HTTP mã ${res.status}`);
      }
      responseData = await res.json();
    } catch (err: any) {
      throw new BadRequestException(`Không thể kết nối tới AirLabs API: ${err.message}`);
    }

    if (responseData.error) {
      throw new BadRequestException(`Lỗi từ AirLabs: ${responseData.error.message || JSON.stringify(responseData.error)}`);
    }

    const schedules = responseData.response || [];
    const has_more = responseData.request?.has_more || false;
    const request_params = responseData.request?.params || {};
    const fetched_count = schedules.length;

    const window_note = "AirLabs /schedules chỉ trả về dữ liệu trong khoảng thời gian cửa sổ ngắn (khoảng 10 giờ tới) và luôn yêu cầu bộ lọc.";

    if (!Array.isArray(schedules) || schedules.length === 0) {
      return {
        mode,
        request_params,
        fetched_count,
        created_or_updated_count: 0,
        has_more,
        next_offset: offset + fetched_count,
        window_note,
        message: `Không tìm thấy chuyến bay nào từ AirLabs trong khung giờ hiện tại.`,
        synchronized_count: 0,
        flights: [],
      };
    }

    const savedFlights: any[] = [];
    const tzs: Record<string, string> = {};
    const getTz = async (iata: string) => {
      if (!iata) return 'UTC';
      if (tzs[iata]) return tzs[iata];
      try {
        const apt = await this.airportsService.findByIata(iata);
        if (apt) tzs[iata] = apt.time_zone;
      } catch (e) {
        tzs[iata] = 'UTC';
      }
      return tzs[iata] || 'UTC';
    };

    for (const item of schedules) {
      const flightNumber =
        item.flight_iata ||
        `${item.airline_iata || 'FL'}${item.flight_number || Math.floor(100 + Math.random() * 900)}`;
      
      const origin = (item.dep_iata || depIata || 'UNK').toUpperCase();
      const dest = (item.arr_iata || arrIata || 'UNK').toUpperCase();

      const originTz = await getTz(origin);
      const destTz = await getTz(dest);

      let depTime: Date;
      if (item.dep_time_utc) {
        depTime = parseUtcWallTime(item.dep_time_utc);
      } else if (item.dep_time) {
        const [d, t] = item.dep_time.split(' ');
        depTime = localWallTimeToUtc(d, t, originTz);
      } else {
        depTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
      }

      let arrTime: Date;
      if (item.arr_time_utc) {
        arrTime = parseUtcWallTime(item.arr_time_utc);
      } else if (item.arr_time) {
        const [d, t] = item.arr_time.split(' ');
        arrTime = localWallTimeToUtc(d, t, destTz);
      } else {
        arrTime = new Date(depTime.getTime() + (item.duration || 120) * 60 * 1000);
      }

      const departureDate = localDateKey(depTime, originTz);

      let durationMinutes = Math.round((arrTime.getTime() - depTime.getTime()) / 60000);
      if (durationMinutes <= 0 || Number.isNaN(durationMinutes)) {
        durationMinutes = item.duration || 120;
      }

      const inventories = [
        {
          cabin_class: 'ECONOMY',
          is_smoking: false,
          bucket_code: 'Y',
          base_price: 1250000,
          allocated_seats: 140,
          available_seats: 140,
        },
        {
          cabin_class: 'BUSINESS',
          is_smoking: false,
          bucket_code: 'J',
          base_price: 2950000,
          allocated_seats: 30,
          available_seats: 30,
        },
        {
          cabin_class: 'FIRST',
          is_smoking: false,
          bucket_code: 'F',
          base_price: 4200000,
          allocated_seats: 10,
          available_seats: 10,
        },
      ];

      let aircraftData: any = undefined;
      if (item.aircraft_icao) {
        const code = item.aircraft_icao;
        const model_name = code.startsWith('A3') ? `Airbus ${code}` : code;
        const total_capacity = inventories.reduce((sum, inv) => sum + inv.allocated_seats, 0);
        aircraftData = {
          model_code: code,
          model_name: model_name,
          total_capacity: total_capacity,
        };
      }

      let flight = await this.flightModel
        .findOne({
          flight_number: flightNumber,
          departure_date: departureDate,
        })
        .exec();

      const flightStatus =
        item.status === 'cancelled'
          ? FlightStatus.CANCELLED
          : item.delayed
            ? FlightStatus.DELAYED
            : FlightStatus.SCHEDULED;
      const delayMinutes = item.delayed ? Number(item.delayed) : 0;
      const delayReason = '';
      const distanceMiles = await this.greatCircleMiles(origin, dest);

      if (flight) {
        // Strictly protect synthetic Aptech flights, manually modified flights, and Aptech operator flights
        const isAptechOrManual =
          flight.is_generated ||
          flight.is_manually_modified ||
          flight.flight_number.startsWith('APT') ||
          flight.operator === 'APTECH_AIRLINES';

        if (isAptechOrManual) {
          this.logger.warn(
            `Preserving Aptech operational flight ${flight.flight_number} from AirLabs sync mutation.`,
          );
          continue;
        }

        const hasActiveBookings = await this.bookingModel.exists({
          'ticket_coupons.flight_id': flight._id,
          status: { $in: ['BLOCKED', 'CONFIRMED'] },
        });

        if (!hasActiveBookings) {
          flight.scheduled_departure = depTime;
          flight.scheduled_arrival = arrTime;
          flight.duration_minutes = durationMinutes;
        }

        flight.status = flightStatus;
        if (delayReason) flight.delay_reason = delayReason;
        if (delayMinutes > 0) flight.delay_minutes = delayMinutes;
        if (aircraftData) flight.aircraft = aircraftData;
        if (distanceMiles > 0) flight.distance_miles = distanceMiles;

        // Requirement 4: Fix legacy inventory leak on external rows
        flight.inventories = [];
        flight.is_bookable = false;
        flight.operator = (item.airline_iata || item.airline_icao || 'AIRLABS_EXTERNAL').toUpperCase();
        flight.data_source = 'AIRLABS_EXTERNAL';
        await flight.save();
      } else {
        // External airline schedules must NOT automatically become Aptech customer-bookable flights.
        // Stored with empty inventories and is_bookable = false for reference/status lookup only.
        flight = new this.flightModel({
          flight_number: flightNumber,
          origin_iata: origin,
          dest_iata: dest,
          departure_date: departureDate,
          scheduled_departure: depTime,
          scheduled_arrival: arrTime,
          duration_minutes: durationMinutes,
          distance_miles: distanceMiles,
          status: flightStatus,
          delay_reason: delayReason,
          delay_minutes: delayMinutes,
          aircraft: aircraftData,
          inventories: [], // Zero sellable inventory for external carriers
          is_generated: false,
          generated_source: 'AIRLABS_EXTERNAL',
          data_source: 'AIRLABS_EXTERNAL',
          is_manually_modified: false,
          operator: (item.airline_iata || item.airline_icao || 'AIRLABS_EXTERNAL').toUpperCase(),
          is_bookable: false,
        });
        await flight.save();
      }

      savedFlights.push(flight);
    }

    return {
      mode,
      request_params,
      fetched_count,
      created_or_updated_count: savedFlights.length,
      has_more,
      next_offset: offset + fetched_count,
      window_note,
      message: `Đã đồng bộ thành công ${savedFlights.length} chuyến bay thật từ AirLabs!`,
      synchronized_count: savedFlights.length,
      flights: savedFlights,
    };
  }

  /**
   * Real great-circle distance in miles between two airports, using their coordinates
   * from the `airports` collection. Returns 0 when coordinates are unavailable so that
   * no invented constant is ever stored (requirement: honest data only).
   */
  private readonly distanceCache = new Map<string, number>();

  async greatCircleMiles(originIata: string, destIata: string): Promise<number> {
    const key = `${originIata}-${destIata}`;
    const cached = this.distanceCache.get(key);
    if (cached !== undefined) return cached;

    let miles = 0;
    try {
      const col = this.flightModel.db.collection('airports');
      const docs = (await col
        .find(
          { iata_code: { $in: [originIata, destIata] } },
          { projection: { iata_code: 1, lat: 1, lng: 1 } },
        )
        .toArray()) as unknown as Array<{ iata_code: string; lat?: number; lng?: number }>;
      const a = docs.find((d) => d.iata_code === originIata);
      const b = docs.find((d) => d.iata_code === destIata);
      if (
        a && b &&
        typeof a.lat === 'number' && typeof a.lng === 'number' &&
        typeof b.lat === 'number' && typeof b.lng === 'number'
      ) {
        const R = 3958.8; // Earth radius in miles
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        miles = Math.round(2 * R * Math.asin(Math.sqrt(h)));
      }
    } catch {
      miles = 0;
    }
    this.distanceCache.set(key, miles);
    return miles;
  }

  private getIcaoHumanReadableName(icao: string): string {
    const map: Record<string, string> = {
      'A321': 'Airbus A321',
      'A21N': 'Airbus A321neo',
      'A320': 'Airbus A320',
      'A20N': 'Airbus A320neo',
      'A359': 'Airbus A350-900',
      'A350': 'Airbus A350',
      'B738': 'Boeing 737-800',
      'B77W': 'Boeing 777-300ER',
      'B789': 'Boeing 787-9',
      'AT76': 'ATR 72-600'
    };
    return map[icao] || icao;
  }

  async enrichAircraftFromAirLabs(flightId: string): Promise<any> {
    const apiKey = process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env.');
    }

    const flight = await this.findById(flightId);
    const flightNumber = flight.flight_number;
    const airlineIata = flightNumber.replace(/[0-9]/g, '');

    let url = `https://airlabs.co/api/v9/flights?flight_iata=${flightNumber}&api_key=${apiKey}`;
    let res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException(`Lỗi từ AirLabs: HTTP ${res.status}`);
    }
    let data = await res.json();
    if (data.error) {
      throw new BadRequestException(`Lỗi từ AirLabs: ${data.error.message || JSON.stringify(data.error)}`);
    }

    let liveRows = data.response || [];
    let liveRow = liveRows.find((r: any) => r.flight_iata === flightNumber);

    if (!liveRow) {
      url = `https://airlabs.co/api/v9/flights?airline_iata=${airlineIata}&limit=100&api_key=${apiKey}`;
      res = await fetch(url);
      if (!res.ok) {
        throw new BadRequestException(`Lỗi từ AirLabs: HTTP ${res.status}`);
      }
      data = await res.json();
      if (data.error) {
        throw new BadRequestException(`Lỗi từ AirLabs: ${data.error.message || JSON.stringify(data.error)}`);
      }
      liveRows = data.response || [];
      liveRow = liveRows.find((r: any) => r.flight_iata === flightNumber);
    }

    if (!liveRow) {
      return { found: false, flight, message: 'Chuyến bay hiện không ở trạng thái đang bay nên AirLabs chưa có dữ liệu máy bay thật cho số hiệu này.' };
    }

    const totalCapacity = flight.inventories.reduce((acc, inv) => acc + inv.allocated_seats, 0);

    flight.aircraft = {
      model_code: liveRow.aircraft_icao,
      model_name: this.getIcaoHumanReadableName(liveRow.aircraft_icao),
      total_capacity: totalCapacity,
      registration: liveRow.reg_number
    };
    await flight.save();

    return {
      found: true,
      flight,
      registration: liveRow.reg_number,
      aircraft_icao: liveRow.aircraft_icao,
      source: 'airlabs-flights'
    };
  }

  async getAirlineFleet(airlineIata: string): Promise<any> {
    const apiKey = process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env.');
    }

    const url = `https://airlabs.co/api/v9/fleets?airline_iata=${airlineIata}&limit=100&api_key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException(`Lỗi từ AirLabs: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new BadRequestException(`Lỗi từ AirLabs: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const rows = data.response || [];
    const validRows = rows.filter((r: any) => r.icao && r.model);

    const modelMap = new Map<string, any>();
    for (const row of validRows) {
      const key = `${row.icao}_${row.model}`;
      if (!modelMap.has(key)) {
        modelMap.set(key, {
          icao: row.icao,
          model: row.model,
          manufacturer: row.manufacturer,
          count: 0,
          sample_registrations: []
        });
      }
      const m = modelMap.get(key);
      m.count++;
      if (m.sample_registrations.length < 3 && row.reg_number) {
        m.sample_registrations.push(row.reg_number);
      }
    }

    const models = Array.from(modelMap.values()).sort((a, b) => b.count - a.count);

    return {
      airline_iata: airlineIata,
      total_aircraft: validRows.length,
      models
    };
  }

  async enrichAirborneFlightsForToday(): Promise<any> {
    const today = new Date().toISOString().split('T')[0];
    const flights = await this.flightModel.find({ departure_date: today }).exec();
    
    let checked = 0;
    let enriched = 0;
    let not_found = 0;
    let errors = 0;

    for (const flight of flights) {
      checked++;
      try {
        const res = await this.enrichAircraftFromAirLabs(flight.id);
        if (res.found) {
          enriched++;
        } else {
          not_found++;
        }
      } catch (error) {
        errors++;
      }
    }

    this.logger.log(`Enrich airborne for today summary: checked=${checked}, enriched=${enriched}, not_found=${not_found}, errors=${errors}`);
    return { checked, enriched, not_found, errors };
  }
}
