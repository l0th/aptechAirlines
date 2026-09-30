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

export class FlightsNetworkService extends FlightsServicePart {
  constructor(
    deps: FlightsServiceDependencies,
    private readonly bridge: FlightsServiceBridge,
  ) {
    super(deps);
  }
  async discoverNetworkRoutes(
    originIatas: string[],
    destIatas: string[],
    departureDate: string,
    maxStops: number = 2,
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

    const effectiveMaxStops =
      typeof maxStops === 'number' && !isNaN(maxStops)
        ? Math.max(0, Math.min(2, Math.floor(maxStops)))
        : 2;

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

    // Initial graph exploration with effectiveMaxStops
    let graphResult = await this.routeGraphService.findPaths(cleanOrigins, cleanDestinations, {
      maxStops: effectiveMaxStops,
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
        maxStops: effectiveMaxStops,
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

  /**
   * Admin-Only Commercial Network Discovery:
   * Resolves origin and destination via ReferenceService (including unserviced reference airports),
   * validates calendar date and bounded maxStops (0..2), executes bounded network discovery over AirLabs routes,
   * and returns grounded discovery response with origin/destination scopes, coverage, and source network itineraries.
   */
  async discoverCommercialNetwork(
    dto: CommercialNetworkDiscoveryDto,
  ): Promise<CommercialNetworkDiscoveryResponse> {
    const origin = (dto.origin || '').trim();
    const destination = (dto.destination || '').trim();
    const departureDate = (dto.departure_date || '').trim();
    const rawMaxStops = dto.max_stops;
    const maxStops = typeof rawMaxStops === 'number' && !isNaN(rawMaxStops) ? rawMaxStops : 2;

    if (!origin) {
      throw new BadRequestException('Origin is required.');
    }
    if (!destination) {
      throw new BadRequestException('Destination is required.');
    }
    if (!isValidCalendarDateString(departureDate)) {
      throw new BadRequestException('departure_date must be a valid calendar date in YYYY-MM-DD format.');
    }
    if (typeof maxStops !== 'number' || isNaN(maxStops) || maxStops < 0 || maxStops > 2) {
      throw new BadRequestException('max_stops must be an integer between 0 and 2.');
    }

    const originNetScope = await this.referenceService.expandLocation(origin, { includeUnserviced: true });
    if (!originNetScope || !originNetScope.iata_codes || originNetScope.iata_codes.length === 0) {
      throw new BadRequestException(`Origin location '${origin}' could not be resolved to any supported airport.`);
    }

    const destNetScope = await this.referenceService.expandLocation(destination, { includeUnserviced: true });
    if (!destNetScope || !destNetScope.iata_codes || destNetScope.iata_codes.length === 0) {
      throw new BadRequestException(`Destination location '${destination}' could not be resolved to any supported airport.`);
    }

    const discovery = await this.discoverNetworkRoutes(
      originNetScope.iata_codes,
      destNetScope.iata_codes,
      departureDate,
      maxStops,
    );

    return {
      origin_scope: {
        query: origin,
        label: originNetScope.label || originNetScope.iata_codes.join(', '),
        iata_codes: originNetScope.iata_codes,
      },
      destination_scope: {
        query: destination,
        label: destNetScope.label || destNetScope.iata_codes.join(', '),
        iata_codes: destNetScope.iata_codes,
      },
      departure_date: departureDate,
      max_stops: maxStops,
      status: discovery.status,
      itineraries: discovery.itineraries,
      coverage: discovery.coverage,
    };
  }

  mapItinerariesToSuggestions(itineraries: ValidatedItinerary[]): any[] {
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
      const directs = await this.bridge.findDirectFlights(
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
        connecting = await this.bridge.findConnectingRoutes(
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
}
