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
import { FlightsServiceBridge, FlightsServiceDependencies, FlightsServicePart } from './flights-service.part';
import { FlightsNetworkService } from './flights-network.service';

export class FlightsSearchService extends FlightsServicePart {
  constructor(
    deps: FlightsServiceDependencies,
    private readonly networkService: FlightsNetworkService,
    private readonly bridge: FlightsServiceBridge,
  ) {
    super(deps);
  }
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

    const onwardDirect = await this.bridge.findDirectFlights(
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
        connectingRoutes = await this.bridge.findConnectingRoutes(
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
        connectingRoutes = await this.bridge.findConnectingRoutes(
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
          networkDiscovery = await this.networkService.discoverNetworkRoutes(
            originNetScope.iata_codes.length > 0 ? originNetScope.iata_codes : originScope.iata_codes,
            destNetScope.iata_codes.length > 0 ? destNetScope.iata_codes : destScope.iata_codes,
            dto.departure_date,
          );

          if (networkDiscovery.itineraries.length > 0) {
            routeNetworkSuggestions = this.networkService.mapItinerariesToSuggestions(networkDiscovery.itineraries);
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
      returnFlights = await this.bridge.findDirectFlights(
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
          returnConnectingRoutes = await this.bridge.findConnectingRoutes(
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
          returnConnectingRoutes = await this.bridge.findConnectingRoutes(
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
          returnNetworkDiscovery = await this.networkService.discoverNetworkRoutes(
            destNetScope.iata_codes.length > 0 ? destNetScope.iata_codes : destScope.iata_codes,
            originNetScope.iata_codes.length > 0 ? originNetScope.iata_codes : originScope.iata_codes,
            dto.return_date,
          );

          if (returnNetworkDiscovery.itineraries.length > 0) {
            returnRouteNetworkSuggestions = this.networkService.mapItinerariesToSuggestions(returnNetworkDiscovery.itineraries);
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

}
