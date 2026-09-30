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

export class FlightsAirlabsService extends FlightsServicePart {
  constructor(
    deps: FlightsServiceDependencies,
    private readonly bridge: FlightsServiceBridge,
  ) {
    super(deps);
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

    const flight = await this.bridge.findById(flightId);
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
