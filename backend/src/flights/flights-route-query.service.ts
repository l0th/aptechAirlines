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
import { FlightsServiceDependencies, FlightsServicePart } from './flights-service.part';

export class FlightsRouteQueryService extends FlightsServicePart {
  constructor(deps: FlightsServiceDependencies) {
    super(deps);
  }
  async findDirectFlights(
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

  async findConnectingRoutes(
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
}
