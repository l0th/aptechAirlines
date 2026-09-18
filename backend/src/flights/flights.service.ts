import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flight, FlightDocument, FlightStatus } from './flights.schema';
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
import { RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService } from '../reference/route-schedule-validator.service';

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
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly airportsService: AirportsService,
    private readonly referenceService: ReferenceService,
    @Optional() private readonly routeGraphService?: RouteGraphService,
    @Optional() private readonly routeScheduleValidatorService?: RouteScheduleValidatorService,
  ) {}

  async findAll(status?: FlightStatus, origin?: string, dest?: string): Promise<Flight[]> {
    const filter: any = {};
    if (status) filter.status = status;
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
      .find({ flight_number: normalizedNumber, departure_date: date })
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
   * For each affected booking we:
   *  1. append a full REFUND payment transaction (booking.total_amount),
   *  2. release the held seats back to inventory (deduplicated per
   *     flight_id/inventory_id pair, one release per passenger),
   *  3. flag the booking CANCELLED with a freshly generated cancellation number.
   *
   * @returns the number of bookings that were cancelled.
   */
  private async cancelBookingsForFlight(flight: FlightDocument): Promise<number> {
    const affectedBookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $in: [BookingStatus.BLOCKED, BookingStatus.CONFIRMED] },
      })
      .exec();

    if (affectedBookings.length === 0) {
      return 0;
    }

    let cancelledCount = 0;
    for (const booking of affectedBookings) {
      const passengerCount = booking.passengers.length;

      // 1. Automatic full refund of what the customer paid.
      booking.payment_transactions.push({
        transaction_type: 'REFUND',
        amount: booking.total_amount,
        card_masked: 'AUTO-REFUND-FLIGHT-CANCELLED',
        status: 'SUCCESS',
        created_at: new Date(),
      });

      // 2. Give the seats back to inventory, deduplicated per
      //    (flight_id, inventory_id) pair.
      const releasedPairs = new Set<string>();
      for (const coupon of booking.ticket_coupons) {
        const pairKey = `${coupon.flight_id.toString()}_${coupon.inventory_id}`;
        if (releasedPairs.has(pairKey)) continue;
        releasedPairs.add(pairKey);
        try {
          await this.updateAvailableSeats(
            coupon.flight_id.toString(),
            coupon.inventory_id,
            +passengerCount,
          );
        } catch (err: any) {
          // The flight may already be deleted; do not block the cancellation.
          this.logger.warn(
            `Could not release seats for booking ${booking.pnr_code} (${pairKey}): ${err?.message}`,
          );
        }
      }

      // 3. Mark the booking as cancelled.
      booking.status = BookingStatus.CANCELLED;
      booking.cancellation_number = this.generateCode('CAN');
      await booking.save();
      cancelledCount++;
    }

    return cancelledCount;
  }

  async delete(id: string): Promise<{ message: string }> {
    await this.findById(id);
    await this.flightModel.findByIdAndDelete(id).exec();
    return { message: `Flight with ID ${id} deleted successfully` };
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
  async reserveSeats(flightId: string, inventoryId: string, count: number): Promise<boolean> {
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
      { new: true }
    );
    return !!result;
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
    route_network_suggestions?: any[];
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
    
    if (onwardDirect.length === 0 || dto.include_connecting) {
      connectingRoutes = await (dto.departure_date_end
        ? this.findConnectingRoutes(
            originScope.iata_codes,
            destScope.iata_codes,
            dto.departure_date,
            totalPassengers,
            adults,
            children,
            seniors,
            dto.departure_date_end,
          )
        : this.findConnectingRoutes(
            originScope.iata_codes,
            destScope.iata_codes,
            dto.departure_date,
            totalPassengers,
            adults,
            children,
            seniors,
          ));
      
      if (connectingRoutes.length === 0 && onwardDirect.length === 0) {
         routeNetworkSuggestions = await this.referenceService.findRouteNetworkConnections(originScope.iata_codes, destScope.iata_codes);
      }
    }

    let returnFlights: any[] | undefined = undefined;
    let returnConnectingRoutes: any[] | undefined = undefined;
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

    const dateFilter = dto.departure_date_end 
      ? { $gte: dto.departure_date, $lte: dto.departure_date_end } 
      : dto.departure_date;

    let originAirportsWithFlights = 0;
    if (originScope.iata_codes.length > 1) {
      const distinct = await this.flightModel.distinct('origin_iata', {
        origin_iata: { $in: originScope.iata_codes },
        departure_date: dateFilter,
        status: { $ne: FlightStatus.CANCELLED }
      }).exec();
      originAirportsWithFlights = distinct.length;
    }

    let destAirportsWithFlights = 0;
    if (destScope.iata_codes.length > 1) {
      const distinct = await this.flightModel.distinct('dest_iata', {
        dest_iata: { $in: destScope.iata_codes },
        departure_date: dateFilter,
        status: { $ne: FlightStatus.CANCELLED }
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
      origin_iata: { $in: originIatas },
      dest_iata: { $in: destIatas },
      status: { $ne: FlightStatus.CANCELLED },
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
        .filter((i: any) => i.available_seats >= totalPassengers)
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

    // 1. Authoritative Phase B/C when RouteGraphService and RouteScheduleValidatorService are available
    if (this.routeGraphService && this.routeScheduleValidatorService) {
      try {
        const graphRes = await this.routeGraphService.findPaths(originIatas, destIatas, { maxStops: 2 });
        const targetDates = enumerateDateRange(departureDate, departureDateEnd);

        for (const targetDate of targetDates) {
          const validated = this.routeScheduleValidatorService.validatePaths(graphRes, targetDate);

          for (const itin of validated.itineraries) {
            let allAvailable = true;

            const candidatesByLeg: FlightDocument[][] = [];
            for (const legDef of itin.legs) {
              const identity = (legDef.flight_iata || legDef.flight_number || '').replace(/\s+/g, '').toUpperCase();
              if (!identity || legDef.chronology_basis === 'LOCAL') {
                allAvailable = false;
                break;
              }
              const candidates = await this.flightModel.find({
                origin_iata: legDef.dep_iata,
                dest_iata: legDef.arr_iata,
                status: { $ne: FlightStatus.CANCELLED },
              }).exec();
              const confidentMatches = candidates.filter((flight: FlightDocument) => {
                const flightIdentity = flight.flight_number.replace(/\s+/g, '').toUpperCase();
                const scheduleDelta = Math.abs(
                  new Date(flight.scheduled_departure).getTime() - legDef.dep_datetime.getTime(),
                );
                return flightIdentity === identity && scheduleDelta <= 60000;
              });
              if (confidentMatches.length === 0) {
                allAvailable = false;
                break;
              }
              const reservable: FlightDocument[] = [];
              for (const flight of confidentMatches) {
                const processed = await processLeg(flight);
                if (processed.inventories?.length > 0) reservable.push(flight);
              }
              if (reservable.length === 0) {
                allAvailable = false;
                break;
              }
              candidatesByLeg.push(reservable);
            }

            if (allAvailable) {
              const combinations = candidatesByLeg.reduce<FlightDocument[][]>(
                (acc, candidates) => acc.flatMap((prefix) => candidates.map((candidate) => [...prefix, candidate])),
                [[]],
              );
              for (const combination of combinations) {
                const mappedLegs = await Promise.all(combination.map(processLeg));
                if (mappedLegs.length >= 2) {
                  let valid = true;
                  for (let i = 0; i < mappedLegs.length - 1; i++) {
                    const arrTime = new Date(mappedLegs[i].arrival).getTime();
                    const nextDepTime = new Date(mappedLegs[i + 1].departure).getTime();
                    const layover = Math.round((nextDepTime - arrTime) / 60000);
                    if (layover < 45 || layover > 720) {
                      valid = false;
                      break;
                    }
                  }

                  if (valid) {
                    const comboKey = mappedLegs.map((l: any) => l.flight_id.toString()).join('>');
                    if (!seenCombos.has(comboKey)) {
                      seenCombos.add(comboKey);
                      connectingOptions.push({
                        route_type: itin.route_type,
                        departure_date: mappedLegs[0]?.departure_date || targetDate,
                        transit_airport: itin.stops[0],
                        transit_airports: itin.stops,
                        total_duration_minutes: itin.total_duration_minutes,
                        layover_minutes: itin.layover_minutes.length === 1 ? itin.layover_minutes[0] : itin.layover_minutes,
                        leg1: mappedLegs[0],
                        leg2: mappedLegs[1],
                        legs: mappedLegs,
                        coverage: validated.coverage,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Error resolving route graph connecting routes: ${err.message}`);
      }
      return connectingOptions;
    }

    // 2. Legacy fallback loop ONLY when graph services are genuinely unavailable
    const leg1DateFilter = departureDateEnd
      ? { $gte: departureDate, $lte: departureDateEnd }
      : departureDate;

    const leg1Flights = await this.flightModel
      .find({
        origin_iata: { $in: originIatas },
        departure_date: leg1DateFilter,
        status: { $ne: FlightStatus.CANCELLED },
      })
      .exec();

    for (const leg1 of leg1Flights) {
      const transitIata = leg1.dest_iata;
      if (destIatas.includes(transitIata)) continue;

      const leg1ArrTime = new Date(leg1.scheduled_arrival);
      const minDepTime = new Date(leg1ArrTime.getTime() + 45 * 60000);
      const maxDepTime = new Date(leg1ArrTime.getTime() + 720 * 60000);

      const leg2Flights = await this.flightModel
        .find({
          origin_iata: transitIata,
          dest_iata: { $in: destIatas },
          scheduled_departure: { $gte: minDepTime, $lte: maxDepTime },
          status: { $ne: FlightStatus.CANCELLED },
        })
        .exec();

      for (const leg2 of leg2Flights) {
        const layoverMinutes = Math.round(
          (new Date(leg2.scheduled_departure).getTime() - leg1ArrTime.getTime()) / 60000,
        );

        if (layoverMinutes >= 45 && layoverMinutes <= 720) {
          const comboKey = `${leg1._id.toString()}>${leg2._id.toString()}`;
          if (!seenCombos.has(comboKey)) {
            seenCombos.add(comboKey);
            const processedLeg1 = await processLeg(leg1);
            const processedLeg2 = await processLeg(leg2);
            
            connectingOptions.push({
              route_type: 'CONNECTING',
              departure_date: processedLeg1.departure_date,
              transit_airport: transitIata,
              total_duration_minutes: leg1.duration_minutes + layoverMinutes + leg2.duration_minutes,
              layover_minutes: layoverMinutes,
              leg1: processedLeg1,
              leg2: processedLeg2,
              legs: [processedLeg1, processedLeg2],
            });
          }
        }
      }
    }

    return connectingOptions;
  }

  /**
   * Mô phỏng sơ đồ ghế ngồi chuẩn hàng không (Vietjet / Airbus A321)
   * Phân loại:
   * - Hàng 1 - 5: Hàng ghế ĐẶC BIỆT (Skyboss/Thương gia) - Màu đỏ
   * - Hàng 6 - 11: Hàng ghế TIÊU CHUẨN - Màu xanh lá
   * - Hàng 12, 14: Hàng ghế LỐI THOÁT HIỂM (Chỗ để chân rộng) - Màu xanh dương (bỏ qua hàng 13)
   * - Hàng 15 - 31: Hàng ghế TIÊU CHUẨN - Màu xanh lá
   * - Ghế đã bị đặt: Màu xám / Đỏ dấu X (is_occupied = true)
   */
  async getSeatMap(flightId: string) {
    const flight = await this.findById(flightId);

    // Lấy danh sách ghế đã được đặt trong DB
    const bookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $ne: 'CANCELLED' },
      })
      .exec();

    const occupiedSet = new Set<string>();
    for (const b of bookings) {
      for (const coupon of b.ticket_coupons) {
        if (coupon.flight_id.toString() === flight._id.toString() && coupon.seat_code) {
          occupiedSet.add(coupon.seat_code.toUpperCase());
        }
      }
    }

    // Ghế chỉ bị chiếm khi có hành khách thực tế đã đặt chỗ trong Database
    const columns = ['A', 'B', 'C', 'D', 'E', 'F'];
    const totalRows = 31;
    const exitRows = [12, 14];
    const specialRows = [1, 2, 3, 4, 5];
    const skippedRows = [13]; // Chuẩn hàng không quốc tế bỏ qua hàng 13

    const rows: any[] = [];

    for (let r = 1; r <= totalRows; r++) {
      if (skippedRows.includes(r)) continue;

      const isExit = exitRows.includes(r);
      const isSpecial = specialRows.includes(r);

      const seats = columns.map((col) => {
        const seatCode = `${r}${col}`;
        let type: 'SPECIAL' | 'EXIT_ROW' | 'STANDARD' = 'STANDARD';
        let typeLabel = 'Còn trống';
        let fee = 0;
        let cabinClass = 'ECONOMY';

        if (isSpecial) {
          type = 'SPECIAL';
          typeLabel = 'Đặc biệt';
          fee = 150000; // 150.000đ (≈15 USD) — chỉ để tham khảo, hệ thống không thu thêm phí ghế
          cabinClass = 'BUSINESS';
        } else if (isExit) {
          type = 'EXIT_ROW';
          typeLabel = 'Hàng ghế gần lối thoát hiểm';
          fee = 100000; // 100.000đ (≈10 USD) — chỉ để tham khảo, hệ thống không thu thêm phí ghế
          cabinClass = 'ECONOMY';
        }

        const isOccupied = occupiedSet.has(seatCode);

        return {
          seat_code: seatCode,
          row: r,
          column: col,
          type,
          type_label: typeLabel,
          cabin_class: cabinClass,
          fee,
          is_occupied: isOccupied,
          is_exit_row: isExit,
          is_special: isSpecial,
        };
      });

      rows.push({
        row_number: r,
        is_exit_row: isExit,
        is_special: isSpecial,
        seats,
      });
    }

    return {
      flight_id: flight._id,
      flight_number: flight.flight_number,
      route: `${flight.origin_iata} - ${flight.dest_iata}`,
      aircraft_model: flight.aircraft?.model_name ?? null,
      aircraft_known: !!flight.aircraft?.model_name,
      layout_notice: 'This is an illustrative Airbus A321 layout (31 rows, 3-3, exit rows 12 and 14) used for every flight until a real cabin layout is configured.',
      departure_time: flight.scheduled_departure,
      legend: [
        { type: 'AVAILABLE', label: 'Còn trống', color: '#22c55e', bg: 'bg-green-500' },
        { type: 'SELECTED', label: 'Đã chọn', color: '#eab308', bg: 'bg-yellow-400' },
        { type: 'EXIT_ROW', label: 'Hàng ghế gần lối thoát hiểm', color: '#3b82f6', bg: 'bg-blue-500' },
        { type: 'SPECIAL', label: 'Đặc biệt', color: '#ef4444', bg: 'bg-red-500' },
        { type: 'OCCUPIED', label: 'Đã bị chọn / không có', color: '#9ca3af', bg: 'bg-gray-400' },
      ],
      notice: {
        skyboss_benefit: 'Với vé Skyboss, quý khách được chọn chỗ ngồi miễn phí.',
        exit_row_warning:
          'Chúng tôi không đảm bảo cung cấp đúng chỗ ngồi lối thoát hiểm đã quý khách đặt trước và chỗ này có thể thay đổi mà không cần thông báo. Chỗ ngồi lối thoát hiểm (hàng ghế 12 và 14) chỉ có thể sắp xếp cho những hành khách người lớn và có khả năng hỗ trợ hành khách khác trong trường hợp khẩn cấp. Xin lưu ý rằng hành khách bị hạn chế về khả năng nghe nhìn, hành khách tàn tật hoặc hành khách đi kèm trẻ nhỏ không được phép ngồi chỗ này.',
      },
      layout: {
        left_columns: ['A', 'B', 'C'],
        right_columns: ['D', 'E', 'F'],
        exit_rows: exitRows,
        special_rows: specialRows,
        skipped_rows: skippedRows,
      },
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
        flight.scheduled_departure = depTime;
        flight.scheduled_arrival = arrTime;
        flight.duration_minutes = durationMinutes;
        flight.status = flightStatus;
        flight.delay_reason = delayReason;
        flight.delay_minutes = delayMinutes;
        flight.aircraft = aircraftData;
        if (distanceMiles > 0) flight.distance_miles = distanceMiles;
        await flight.save();
      } else {
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
          inventories,
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
