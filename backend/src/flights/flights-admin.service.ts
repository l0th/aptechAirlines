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
import {
  CommercialNetworkDiscoveryDto,
  CommercialNetworkDiscoveryResponse,
} from './airlabs-commercial.dto';
import { AirportsService } from '../airports/airports.service';
import { Booking, BookingDocument, BookingStatus, PaymentMethod } from '../bookings/bookings.schema';
import { localWallTimeToUtc, parseUtcWallTime, localDateKey, utcOffsetMinutes, formatLocalTime } from '../common/timezone.util';
import { earlyBirdQuote, getBookingWindowLimits, maxAdvanceBookingDays } from '../common/pricing.util';

import { ReferenceService } from '../reference/reference.service';
import { RouteGraphCoverage, RouteGraphResult, RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService, ValidatedItinerary } from '../reference/route-schedule-validator.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';
import { MailService, ItineraryLegData, isValidMaskedCard } from '../mail/mail.service';
import { PaypalService, assertPayPalRefundExecutionSnapshot, classifyPayPalRefundStatus } from '../paypal/paypal.service';
import { allocateRefundSources, AllocatedRefundItem } from '../bookings/refund-allocation.util';
import { FlightsServiceBridge, FlightsServiceDependencies, FlightsServicePart } from './flights-service.part';

export class FlightsAdminService extends FlightsServicePart {
  constructor(
    deps: FlightsServiceDependencies,
    private readonly bridge: FlightsServiceBridge,
  ) {
    super(deps);
  }
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

  async getAirportTimeZone(iata: string): Promise<string | undefined> {
    if (!iata) return undefined;
    try {
      const apt = await this.airportsService.findByIata(iata);
      if (apt?.time_zone) {
        new Intl.DateTimeFormat('en-US', { timeZone: apt.time_zone });
        return apt.time_zone;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Requirement 3.10: Public flight lookup by flight number and date.
   * Any user (registered or not) can query arrival/departure times.
   * Enriches result with airport timezone context and local wall times.
   */
  async findByFlightNumberAndDate(flightNumber: string, date: string): Promise<any[]> {
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

    const enhanced = await Promise.all(
      flights.map(async (fl) => {
        const raw = fl.toObject ? fl.toObject() : { ...fl };
        const originTz = await this.bridge.getAirportTimeZone(fl.origin_iata);
        const destTz = await this.bridge.getAirportTimeZone(fl.dest_iata);

        return {
          ...raw,
          origin_time_zone: originTz,
          dest_time_zone: destTz,
          scheduled_departure_local: formatLocalTime(fl.scheduled_departure, originTz),
          scheduled_arrival_local: formatLocalTime(fl.scheduled_arrival, destTz),
          actual_departure_local: fl.actual_departure ? formatLocalTime(fl.actual_departure, originTz) : undefined,
          actual_arrival_local: fl.actual_arrival ? formatLocalTime(fl.actual_arrival, destTz) : undefined,
        };
      }),
    );

    return enhanced;
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
    const flight = await this.bridge.findById(id);

    const preSnapshot = {
      status: flight.status,
      delay_reason: flight.delay_reason || '',
      scheduled_departure: new Date(flight.scheduled_departure).getTime(),
      scheduled_arrival: new Date(flight.scheduled_arrival).getTime(),
    };

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

    if (updateFlightDto.aircraft) {
      const targetCode = updateFlightDto.aircraft.model_code.trim().toUpperCase();
      const layout = FLEET_LAYOUT_CATALOG[targetCode];
      if (!layout) {
        throw new BadRequestException(`Aircraft ${targetCode} is not supported by the configured fleet layouts.`);
      }

      const currentCode = flight.aircraft?.model_code?.trim().toUpperCase();
      if (currentCode !== targetCode && this.seatAllocationService) {
        const hasCustomerSeats = await this.seatAllocationService.hasCustomerSeatAssignments(flight._id);
        if (hasCustomerSeats) {
          throw new BadRequestException(
            'Không thể đổi máy bay khi chuyến đã có ghế HELD hoặc CONFIRMED. Hãy xử lý các giữ chỗ/đặt chỗ trước.',
          );
        }
      }

      const inventories = (updateFlightDto.inventories ?? flight.inventories ?? []) as any[];
      for (const inventory of inventories) {
        const physicalCapacity = Number(layout.cabin_capacities?.[inventory.cabin_class] || 0);
        if (!physicalCapacity) {
          throw new BadRequestException(
            `Aircraft ${targetCode} does not support cabin ${inventory.cabin_class}.`,
          );
        }
        if (Number(inventory.allocated_seats || 0) > physicalCapacity) {
          throw new BadRequestException(
            `Cabin ${inventory.cabin_class} allocates ${inventory.allocated_seats} seats but ${targetCode} supports only ${physicalCapacity}.`,
          );
        }
        const currentInventory = (flight.inventories || []).find(
          (item: any) => item.cabin_class === inventory.cabin_class,
        );
        const soldSeats = currentInventory
          ? Math.max(
              0,
              Number(currentInventory.allocated_seats || 0) - Number(currentInventory.available_seats || 0),
            )
          : 0;
        if (Number(inventory.allocated_seats || 0) < soldSeats) {
          throw new BadRequestException(`Cabin ${inventory.cabin_class} cannot be reduced below ${soldSeats} sold seats.`);
        }
        if (updateFlightDto.inventories) {
          // available_seats is derived server-side so callers cannot accidentally
          // resurrect sold seats (or hide free seats on a newly-added cabin).
          inventory.available_seats = Math.max(0, Number(inventory.allocated_seats || 0) - soldSeats);
        }
      }

      flight.aircraft = {
        model_code: targetCode,
        model_name: layout.model_name,
        total_capacity: layout.total_capacity,
      } as any;

      const seatProfile = (flight as any).seat_pricing_profile_snapshot;
      if (
        seatProfile?.aircraft_type &&
        seatProfile.aircraft_type !== 'ALL' &&
        seatProfile.aircraft_type !== targetCode
      ) {
        (flight as any).seat_pricing_profile_id = undefined;
        (flight as any).seat_pricing_profile_snapshot = undefined;
      }
    } else if (updateFlightDto.inventories) {
      const currentCode = flight.aircraft?.model_code?.trim().toUpperCase();
      const layout = currentCode ? FLEET_LAYOUT_CATALOG[currentCode] : undefined;
      if (!layout) {
        throw new BadRequestException(
          `Aircraft ${currentCode || 'UNKNOWN'} is not supported by the configured fleet layouts.`,
        );
      }

      for (const inventory of updateFlightDto.inventories as any[]) {
        const physicalCapacity = Number(layout.cabin_capacities?.[inventory.cabin_class] || 0);
        if (!physicalCapacity) {
          throw new BadRequestException(
            `Aircraft ${currentCode} does not support cabin ${inventory.cabin_class}.`,
          );
        }
        if (Number(inventory.allocated_seats || 0) > physicalCapacity) {
          throw new BadRequestException(
            `Cabin ${inventory.cabin_class} allocates ${inventory.allocated_seats} seats but ${currentCode} supports only ${physicalCapacity}.`,
          );
        }
        const currentInventory = (flight.inventories || []).find(
          (item: any) => item.cabin_class === inventory.cabin_class,
        );
        const soldSeats = currentInventory
          ? Math.max(
              0,
              Number(currentInventory.allocated_seats || 0) - Number(currentInventory.available_seats || 0),
            )
          : 0;
        if (Number(inventory.allocated_seats || 0) < soldSeats) {
          throw new BadRequestException(`Cabin ${inventory.cabin_class} cannot be reduced below ${soldSeats} sold seats.`);
        }
        inventory.available_seats = Math.max(0, Number(inventory.allocated_seats || 0) - soldSeats);
      }
    }
    if (updateFlightDto.status) {
      flight.status = updateFlightDto.status;
    }
    if (updateFlightDto.status === FlightStatus.SCHEDULED) {
      flight.delay_reason = '';
    } else if (updateFlightDto.delay_reason !== undefined) {
      flight.delay_reason = updateFlightDto.delay_reason;
    }
    if (updateFlightDto.inventories) flight.inventories = updateFlightDto.inventories as any;

    flight.is_manually_modified = true;
    const savedFlight = await flight.save();

    // C.1 Hủy booking liên quan khi flight bị CANCELLED
    if (updateFlightDto.status === FlightStatus.CANCELLED) {
      const cancelledBookings = await this.bridge.cancelBookingsForFlight(savedFlight);
      this.logger.warn(
        `Flight ${savedFlight.flight_number} (${savedFlight._id}) set to CANCELLED via update(). ` +
          `${cancelledBookings} booking(s) automatically cancelled, refunded and their seats released.`,
      );
    } else {
      const depShifted = new Date(savedFlight.scheduled_departure).getTime() !== preSnapshot.scheduled_departure;
      const arrShifted = new Date(savedFlight.scheduled_arrival).getTime() !== preSnapshot.scheduled_arrival;
      const statusBecameDelayed = savedFlight.status === FlightStatus.DELAYED && preSnapshot.status !== FlightStatus.DELAYED;
      const delayReasonChanged = savedFlight.status === FlightStatus.DELAYED && savedFlight.delay_reason !== preSnapshot.delay_reason;
      const recoveredToScheduled = savedFlight.status === FlightStatus.SCHEDULED && preSnapshot.status === FlightStatus.DELAYED;

      if (depShifted || arrShifted || statusBecameDelayed || delayReasonChanged || recoveredToScheduled) {
        await this.notifyDisruptedFlightBookings(savedFlight, preSnapshot);
      }
    }

    return savedFlight;
  }

  /**
   * Authoritative safe flight deletion enforcing booking integrity.
   * Rejects deletion if referenced by active BLOCKED or CONFIRMED bookings.
   */
  async deleteFlight(id: string): Promise<{ message: string; flight: FlightDocument }> {
    const flight = await this.bridge.findById(id);
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
    const flight = await this.bridge.findById(id);

    const preSnapshot = {
      status: flight.status,
      delay_reason: flight.delay_reason || '',
      scheduled_departure: new Date(flight.scheduled_departure).getTime(),
      scheduled_arrival: new Date(flight.scheduled_arrival).getTime(),
    };

    flight.status = dto.status;
    if (dto.status === FlightStatus.SCHEDULED) {
      flight.delay_reason = '';
      flight.delay_minutes = 0;
    } else {
      if (dto.delay_reason !== undefined) flight.delay_reason = dto.delay_reason;
      if (dto.delay_minutes !== undefined) flight.delay_minutes = dto.delay_minutes;
    }
    if (dto.actual_departure) flight.actual_departure = new Date(dto.actual_departure);
    if (dto.actual_arrival) flight.actual_arrival = new Date(dto.actual_arrival);
    const savedFlight = await flight.save();

    // Requirement 1.2.3: cancelling a flight is an emergency that must propagate
    // to every still-active booking holding a coupon on that flight (auto refund
    // + seat release + cancellation number).
    if (savedFlight.status === FlightStatus.CANCELLED) {
      const cancelledBookings = await this.bridge.cancelBookingsForFlight(savedFlight);
      // The HTTP response intentionally stays the bare Flight document (the
      // frontend reads concrete flight fields); the propagation result is
      // reported through the log only.
      this.logger.warn(
        `Flight ${savedFlight.flight_number} (${savedFlight._id}) set to CANCELLED. ` +
          `${cancelledBookings} booking(s) automatically cancelled, refunded and their seats released.`,
      );
    } else {
      const statusBecameDelayed = savedFlight.status === FlightStatus.DELAYED && preSnapshot.status !== FlightStatus.DELAYED;
      const delayReasonChanged = savedFlight.status === FlightStatus.DELAYED && savedFlight.delay_reason !== preSnapshot.delay_reason;
      const recoveredToScheduled = savedFlight.status === FlightStatus.SCHEDULED && preSnapshot.status === FlightStatus.DELAYED;

      if (statusBecameDelayed || delayReasonChanged || recoveredToScheduled) {
        await this.notifyDisruptedFlightBookings(savedFlight, preSnapshot);
      }
    }

    return savedFlight;
  }

  private async notifyDisruptedFlightBookings(
    flight: FlightDocument,
    preSnapshot: {
      status: string;
      delay_reason: string;
      scheduled_departure: number;
      scheduled_arrival: number;
    },
  ): Promise<void> {
    if (!this.mailService) return;

    try {
      const activeBookings = await this.bookingModel
        .find({
          'ticket_coupons.flight_id': flight._id,
          status: { $in: [BookingStatus.BLOCKED, BookingStatus.CONFIRMED] },
        })
        .populate('user_id', 'email first_name last_name')
        .exec();

      if (!activeBookings || activeBookings.length === 0) return;

      const originTz = await this.bridge.getAirportTimeZone(flight.origin_iata);
      const destTz = await this.bridge.getAirportTimeZone(flight.dest_iata);

      const originalDepLocal = formatLocalTime(new Date(preSnapshot.scheduled_departure), originTz);
      const originalDepStr = originalDepLocal
        ? `${originalDepLocal} (${originTz || 'UTC'})`
        : `${new Date(preSnapshot.scheduled_departure).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;

      const newDepLocal = formatLocalTime(flight.scheduled_departure, originTz);
      const newDepStr = newDepLocal
        ? `${newDepLocal} (${originTz || 'UTC'})`
        : `${new Date(flight.scheduled_departure).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;

      const originalArrLocal = formatLocalTime(new Date(preSnapshot.scheduled_arrival), destTz);
      const originalArrStr = originalArrLocal
        ? `${originalArrLocal} (${destTz || 'UTC'})`
        : `${new Date(preSnapshot.scheduled_arrival).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;

      const newArrLocal = formatLocalTime(flight.scheduled_arrival, destTz);
      const newArrStr = newArrLocal
        ? `${newArrLocal} (${destTz || 'UTC'})`
        : `${new Date(flight.scheduled_arrival).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;

      let disruptionType: 'DELAY' | 'SCHEDULE_CHANGE' | 'RECOVERY' = 'SCHEDULE_CHANGE';
      if (flight.status === FlightStatus.DELAYED) {
        disruptionType = 'DELAY';
      } else if (flight.status === FlightStatus.SCHEDULED && preSnapshot.status === FlightStatus.DELAYED) {
        disruptionType = 'RECOVERY';
      }

      for (const booking of activeBookings) {
        try {
          const user: any = booking.user_id;
          const toEmail = user?.email;
          if (!toEmail) continue;

          const passengerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Customer';

          const sent = await this.mailService.sendFlightDisruptionEmail({
            toEmail,
            passengerName,
            bookingReference: booking.pnr_code,
            flightNumber: flight.flight_number,
            origin: flight.origin_iata,
            destination: flight.dest_iata,
            disruptionType,
            originalDepartureFormatted: originalDepStr,
            newDepartureFormatted: newDepStr,
            originalArrivalFormatted: originalArrStr,
            newArrivalFormatted: newArrStr,
            delayReason: flight.status === FlightStatus.SCHEDULED ? undefined : (flight.delay_reason || undefined),
            statusText: flight.status,
          });
          if (!sent) {
            this.logger.warn(
              `Flight disruption email delivery returned false for booking ${booking.pnr_code} (${toEmail}) on flight ${flight.flight_number}.`,
            );
          }
        } catch (singleMailErr: any) {
          this.logger.error(
            `Failed to send disruption email for booking ${booking.pnr_code}: ${singleMailErr?.message || singleMailErr}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to process flight disruption notifications for flight ${flight.flight_number}: ${err?.message || err}`,
      );
    }
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
  private async buildItineraryLegs(
    ticketCoupons: any[],
    affectedFlightId?: any,
    affectedFlightNumber?: string,
  ): Promise<ItineraryLegData[]> {
    const legs: ItineraryLegData[] = [];
    const seen = new Set<string>();

    for (const coupon of ticketCoupons || []) {
      if (!coupon.flight_id && !coupon.flight_number) continue;
      const key = `${coupon.flight_number || ''}_${coupon.flight_id?.toString() || ''}_${coupon.inventory_id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let isAffected = false;
      if (affectedFlightId && coupon.flight_id) {
        isAffected = coupon.flight_id.toString() === affectedFlightId.toString();
      } else if (affectedFlightNumber && coupon.flight_number) {
        isAffected = coupon.flight_number === affectedFlightNumber;
      }

      try {
        if (!coupon.flight_id) {
          throw new Error('No flight_id');
        }
        const flight = await this.bridge.findById(coupon.flight_id.toString());
        const originTz = await this.bridge.getAirportTimeZone(flight.origin_iata);
        const destTz = await this.bridge.getAirportTimeZone(flight.dest_iata);

        const depLocal = formatLocalTime(flight.scheduled_departure, originTz);
        const arrLocal = formatLocalTime(flight.scheduled_arrival, destTz);

        const depStr = depLocal
          ? `${depLocal} (${originTz || 'UTC'})`
          : `${new Date(flight.scheduled_departure).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`;
        const arrStr = arrLocal
          ? `${arrLocal} (${destTz || 'UTC'})`
          : (flight.scheduled_arrival
              ? `${new Date(flight.scheduled_arrival).toISOString().replace('T', ' ').substring(0, 16)} (UTC)`
              : undefined);

        legs.push({
          flightNumber: flight.flight_number,
          origin: flight.origin_iata,
          destination: flight.dest_iata,
          cabinClass: coupon.cabin_class,
          departureTimeFormatted: depStr,
          arrivalTimeFormatted: arrStr,
          isAffected: !!isAffected,
        });
      } catch (err) {
        if (coupon.flight_number) {
          legs.push({
            flightNumber: coupon.flight_number,
            origin: coupon.origin || 'UNKNOWN',
            destination: coupon.destination || 'UNKNOWN',
            cabinClass: coupon.cabin_class,
            departureTimeFormatted: 'Schedule unresolvable',
            isAffected: !!isAffected,
          });
        }
      }
    }
    return legs;
  }

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
          await this.bridge.updateAvailableSeats(leg.flightId, leg.inventoryId, +passengerCount);
          releasedLegs.push(leg);
        }

        // Step 3: For CONFIRMED bookings, add multi-source REFUND transactions & reset miles
        let cardMasked: string | undefined = undefined;
        const refundAllocations: AllocatedRefundItem[] = [];
        if (wasConfirmed) {
          if (booking.total_amount > 0) {
            const allocations = allocateRefundSources(
              booking.payment_transactions || [],
              booking.total_amount,
              'REFUND',
              (p) => this.generateCode(p),
            );
            if (allocations.length > 0) {
              const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
              if (totalAllocated !== booking.total_amount) {
                throw new BadRequestException(
                  `Emergency flight cancellation refund allocation mismatch: expected ${booking.total_amount} VND, got ${totalAllocated} VND`,
                );
              }
              for (const alloc of allocations) {
                refundAllocations.push(alloc);
                booking.payment_transactions.push({
                  transaction_type: alloc.transaction_type,
                  payment_reference: alloc.payment_reference,
                  source_payment_reference: alloc.source_payment_reference,
                  payment_method: alloc.payment_method,
                  amount: alloc.amount,
                  currency: alloc.currency,
                  card_masked: alloc.card_masked,
                  provider_capture_id: alloc.provider_capture_id,
                  provider_order_id: alloc.provider_order_id,
                  provider_amount: alloc.provider_amount,
                  provider_currency: alloc.provider_currency,
                  exchange_rate_vnd_per_unit: alloc.exchange_rate_vnd_per_unit,
                  status: alloc.status,
                  created_at: new Date(),
                });
              }
              const cardItem = allocations.find((a) => a.card_masked);
              cardMasked = cardItem?.card_masked;
            } else {
              const ref = this.generateCode('REF');
              booking.payment_transactions.push({
                transaction_type: 'REFUND',
                payment_reference: ref,
                amount: booking.total_amount,
                currency: 'VND',
                status: 'SUCCESS',
                created_at: new Date(),
              });
            }
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

        // Step 5b: Post-commit PayPal refund execution
        if (this.paypalService && refundAllocations.length > 0) {
          for (const item of refundAllocations) {
            if (item.payment_method === PaymentMethod.PAYPAL) {
              try {
                assertPayPalRefundExecutionSnapshot({
                  payment_reference: item.payment_reference,
                  provider_capture_id: item.provider_capture_id || '',
                  provider_amount: item.provider_amount || '',
                  provider_currency: item.provider_currency || '',
                  exchange_rate_vnd_per_unit: item.exchange_rate_vnd_per_unit,
                  require_fx: true,
                  context: 'cancelBookingsForFlight',
                });
              } catch (valErr: any) {
                this.logger.error(
                  `Incomplete PayPal refund provenance for flight cancellation booking ${booking.pnr_code}, ref ${item.payment_reference}: ${valErr?.message}`,
                );
                item.status = 'FAILED';
                const tx = booking.payment_transactions?.find(
                  (t: any) => t.payment_reference === item.payment_reference,
                );
                if (tx) {
                  tx.status = 'FAILED';
                  tx.failure_reason = 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE';
                  tx.next_retry_at = null;
                }
                await this.bookingModel.updateOne(
                  { _id: booking._id, 'payment_transactions.payment_reference': item.payment_reference },
                  {
                    $set: {
                      'payment_transactions.$.status': 'FAILED',
                      'payment_transactions.$.failure_reason': 'INCOMPLETE_PAYPAL_REFUND_PROVENANCE',
                      'payment_transactions.$.next_retry_at': null,
                    },
                  },
                );
                continue;
              }

              try {
                const refundRes = await this.paypalService.refundCapture({
                  captureId: item.provider_capture_id!,
                  providerAmount: item.provider_amount!,
                  providerCurrency: item.provider_currency!,
                  paypalRequestId: item.payment_reference,
                  note: `Emergency flight cancellation refund for PNR ${booking.pnr_code}`,
                });
                const classified = classifyPayPalRefundStatus(refundRes.status);
                const localStatus = classified.local_status;
                const isFailed = classified.is_failed;
                await this.bookingModel.updateOne(
                  { _id: booking._id, 'payment_transactions.payment_reference': item.payment_reference },
                  {
                    $set: {
                      'payment_transactions.$.status': localStatus,
                      'payment_transactions.$.provider_refund_id': refundRes.refund_id,
                      'payment_transactions.$.provider_status': classified.provider_status,
                      ...(isFailed
                        ? {
                            'payment_transactions.$.failure_reason': `PayPal refund returned status: ${classified.provider_status}`,
                            'payment_transactions.$.next_retry_at': null,
                          }
                        : {}),
                    },
                  },
                );
                item.status = localStatus;
                item.provider_refund_id = refundRes.refund_id;
                item.provider_status = classified.provider_status;
                if (isFailed) {
                  item.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
                  (item as any).next_retry_at = null;
                }
                const tx = booking.payment_transactions?.find(
                  (t: any) => t.payment_reference === item.payment_reference,
                );
                if (tx) {
                  tx.status = localStatus;
                  tx.provider_refund_id = refundRes.refund_id;
                  tx.provider_status = classified.provider_status;
                  if (isFailed) {
                    tx.failure_reason = `PayPal refund returned status: ${classified.provider_status}`;
                    tx.next_retry_at = null;
                  }
                }
              } catch (ppErr: any) {
                this.logger.error(
                  `Post-commit PayPal refund failed for booking ${booking.pnr_code}, ref ${item.payment_reference}: ${ppErr?.message || ppErr}`,
                );
                item.status = 'PENDING';
                item.provider_status = 'FAILED';
                const tx = booking.payment_transactions?.find(
                  (t: any) => t.payment_reference === item.payment_reference,
                );
                if (tx) {
                  tx.status = 'PENDING';
                  tx.provider_status = 'FAILED';
                  tx.failure_reason = ppErr?.message || 'PayPal refund call failed';
                }
                await this.bookingModel.updateOne(
                  { _id: booking._id, 'payment_transactions.payment_reference': item.payment_reference },
                  {
                    $set: {
                      'payment_transactions.$.status': 'PENDING',
                      'payment_transactions.$.provider_status': 'FAILED',
                      'payment_transactions.$.failure_reason': ppErr?.message || 'PayPal refund call failed',
                      'payment_transactions.$.next_retry_at': new Date(Date.now() + 60 * 60 * 1000),
                    },
                  },
                );
              }
            }
          }
        }

        // Step 6: Dispatch emergency cancellation email safely
        if (this.mailService) {
          try {
            const user = await this.usersService.findById(booking.user_id.toString());
            if (user?.email) {
              const passengerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Customer';
              const originTz = await this.bridge.getAirportTimeZone(flight.origin_iata);
              const localDep = formatLocalTime(flight.scheduled_departure, originTz);
              const depFormatted = localDep ? `${localDep} (${originTz || 'UTC'})` : undefined;
              const itinerary = await this.buildItineraryLegs(
                booking.ticket_coupons,
                flight._id,
                flight.flight_number,
              );

              const sent = await this.mailService.sendCancellationEmail({
                toEmail: user.email,
                passengerName,
                bookingReference: booking.pnr_code,
                blockingNumber: booking.blocking_number || undefined,
                confirmationNumber: booking.confirmation_number || undefined,
                cancellationNumber: booking.cancellation_number!,
                cancellationType: 'EMERGENCY_FLIGHT_CANCELLED',
                originalBookingStatus: wasConfirmed ? 'CONFIRMED' : 'BLOCKED',
                flightNumber: flight.flight_number,
                origin: flight.origin_iata,
                destination: flight.dest_iata,
                departureTimeFormatted: depFormatted,
                itinerary: itinerary.length > 0 ? itinerary : undefined,
                refundAmount: wasConfirmed ? booking.total_amount : 0,
                refundPercentage: wasConfirmed ? 100 : undefined,
                currency: 'VND',
                maskedCard: wasConfirmed && isValidMaskedCard(cardMasked) ? cardMasked : undefined,
                refundDetails: refundAllocations.length > 0 ? refundAllocations.map((a) => ({
                  paymentMethod: a.payment_method,
                  amountVnd: a.amount,
                  cardMasked: a.card_masked,
                  providerAmount: a.provider_amount,
                  providerCurrency: a.provider_currency,
                  status: a.status,
                })) : undefined,
                reason: flight.delay_reason || 'Flight cancelled by airline operation',
              });
              if (!sent) {
                this.logger.warn(
                  `Emergency cancellation email delivery returned false for booking ${booking.pnr_code} (${user.email}); booking remains cancelled.`,
                );
              }
            }
          } catch (mailErr: any) {
            this.logger.error(
              `Failed to send emergency cancellation email for booking ${booking.pnr_code}: ${mailErr?.message || mailErr}`,
            );
          }
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to cancel booking ${booking.pnr_code || booking._id} during emergency flight cancellation: ${err?.message || err}. Initiating compensation rollback.`,
        );

        // Compensation 1: Restore released seats in reverse order
        for (const leg of [...releasedLegs].reverse()) {
          try {
            await this.bridge.updateAvailableSeats(leg.flightId, leg.inventoryId, -passengerCount);
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
}
