import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import {
  Flight,
  FlightSearchResult,
  SeatMapResponse,
  FlightStatus,
  AirLabsRouteRef,
  CommercialAircraftLayout,
  CommercialScheduleTemplate,
  CommercializeRoutePayload,
  UpdateCommercialTemplatePayload,
  MaterializeTemplatePayload,
  MaterializeTemplateResponse,
  AirportRoutesSyncResponse,
  AirLabsRoutesListResponse,
  CommercialTemplatesListResponse,
  CommercialNetworkDiscoveryRequest,
  CommercialNetworkDiscoveryResponse,
} from '../models/flight.model';
import {
  Airport,
  CityResolveResult,
  CountrySuggestion,
  LocationSuggestResponse,
} from '../models/airport.model';
import {
  Booking,
  BookingStatus,
  CancelBookingResponse,
  CancellationPolicy,
} from '../models/booking.model';
import { AuthResponse, RegisterPayload, User, UserRole } from '../models/user.model';

export interface AirportSyncAllResponse {
  checked: number;
  updated: number;
  failed: number;
  errors?: any[];
  message?: string;
}

export interface AirportImportCountryResult {
  country_code: string;
  fetched: number;
  imported: number;
  updated: number;
  skipped_without_iata: number;
  error?: string;
}

export interface AirportImportCountriesResponse {
  requested: number;
  done: number;
  failed: number;
  rate_limited: boolean;
  results: AirportImportCountryResult[];
}

export interface AirportFixCityNamesResponse {
  checked: number;
  fixed: number;
  samples?: Array<Record<string, any>>;
  sample_fixes?: Array<Record<string, any>>;
  message?: string;
  [key: string]: any;
}

export interface SyncRoutesHubsResponse {
  message?: string;
  results?: any[];
  [key: string]: any;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  // Relative path so the app works from any host: `ng serve` proxies /api via
  // proxy.conf.json; in Docker nginx proxies /api to the backend.
  private readonly baseUrl = '/api';

  // ===================== AUTH =====================
  login(credentials: { username: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, credentials);
  }

  register(userData: RegisterPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, userData);
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/auth/me`);
  }

  // ===================== FLIGHTS =====================
  searchFlights(params: {
    origin: string;
    destination: string;
    departure_date: string;
    departure_date_end?: string;
    return_date?: string;
    cabin_class?: string;
    is_smoking?: boolean;
    adults?: number;
    children?: number;
    seniors?: number;
    include_connecting?: boolean;
  }): Observable<FlightSearchResult> {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        httpParams = httpParams.set(key, val.toString());
      }
    });
    return this.http.get<FlightSearchResult>(`${this.baseUrl}/flights/search`, {
      params: httpParams,
    });
  }

  getNearbyAvailability(params: {
    origin: string;
    destination: string;
    date: string;
    cabin_class?: string;
    passengers?: number;
    adults?: number;
    children?: number;
    seniors?: number;
  }): Observable<{
    origin: string;
    destination: string;
    requested_date: string;
    date_range: { min_date: string; max_date: string };
    available_dates: Array<{
      date: string;
      day_of_week: string;
      has_direct: boolean;
      has_connecting: boolean;
      available_itineraries_count: number;
      min_price: number;
    }>;
  }> {
    let httpParams = new HttpParams()
      .set('origin', params.origin)
      .set('destination', params.destination)
      .set('date', params.date);
    if (params.cabin_class) httpParams = httpParams.set('cabin_class', params.cabin_class);
    if (params.passengers) httpParams = httpParams.set('passengers', params.passengers.toString());
    if (params.adults) httpParams = httpParams.set('adults', params.adults.toString());
    if (params.children) httpParams = httpParams.set('children', params.children.toString());
    if (params.seniors) httpParams = httpParams.set('seniors', params.seniors.toString());
    return this.http.get<any>(`${this.baseUrl}/flights/nearby-availability`, { params: httpParams });
  }

  lookupFlights(flightNumber: string, date: string): Observable<Flight[]> {
    const params = new HttpParams()
      .set('flight_number', flightNumber)
      .set('date', date);
    return this.http.get<Flight[]>(`${this.baseUrl}/flights/lookup`, { params });
  }

  getFlights(filter?: {
    status?: FlightStatus;
    origin?: string;
    dest?: string;
    commercial_only?: boolean;
  }): Observable<Flight[]> {
    let params = new HttpParams();
    if (filter?.status) params = params.set('status', filter.status);
    if (filter?.origin) params = params.set('origin', filter.origin);
    if (filter?.dest) params = params.set('dest', filter.dest);
    if (filter?.commercial_only !== undefined) params = params.set('commercial_only', String(filter.commercial_only));
    return this.http.get<Flight[]>(`${this.baseUrl}/flights`, { params });
  }

  getFlightById(id: string): Observable<Flight> {
    return this.http.get<Flight>(`${this.baseUrl}/flights/${id}`);
  }

  getSeatMap(flightId: string): Observable<SeatMapResponse> {
    return this.http.get<SeatMapResponse>(`${this.baseUrl}/flights/${flightId}/seat-map`);
  }

  getBookingWindow(): Observable<{ max_advance_days: number; min_date: string; max_date: string }> {
    return this.http.get<{ max_advance_days: number; min_date: string; max_date: string }>(
      `${this.baseUrl}/flights/booking-window`,
    );
  }

  getAirlineFleet(airlineIata: string): Observable<any> {
    const params = new HttpParams().set('airline_iata', airlineIata);
    return this.http.get<any>(`${this.baseUrl}/flights/airline-fleet`, { params });
  }

  createFlight(flightData: any): Observable<Flight> {
    return this.http.post<Flight>(`${this.baseUrl}/flights`, flightData);
  }

  updateFlight(id: string, flightData: any): Observable<Flight> {
    return this.http.put<Flight>(`${this.baseUrl}/flights/${id}`, flightData);
  }

  updateFlightStatus(
    id: string,
    statusData: {
      status: FlightStatus;
      delay_reason?: string;
      actual_departure?: string;
      actual_arrival?: string;
    },
  ): Observable<Flight> {
    return this.http.patch<Flight>(`${this.baseUrl}/flights/${id}/status`, statusData);
  }

  deleteFlight(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/flights/${id}`);
  }

  // ===================== AIRPORTS & REFERENCE =====================
  suggestLocations(q: string): Observable<LocationSuggestResponse> {
    const params = new HttpParams().set('q', q);
    return this.http.get<LocationSuggestResponse>(`${this.baseUrl}/reference/suggest`, { params });
  }

  getCountries(): Observable<CountrySuggestion[]> {
    return this.http.get<CountrySuggestion[]>(`${this.baseUrl}/reference/countries`);
  }

  getAirports(search?: string): Observable<Airport[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<Airport[]>(`${this.baseUrl}/airports`, { params });
  }

  resolveCity(city: string): Observable<CityResolveResult> {
    const params = new HttpParams().set('city', city);
    return this.http.get<CityResolveResult>(`${this.baseUrl}/airports/resolve`, { params });
  }

  getAirportByIata(iata: string): Observable<Airport> {
    return this.http.get<Airport>(`${this.baseUrl}/airports/${iata}`);
  }

  createAirport(airport: Partial<Airport>): Observable<Airport> {
    return this.http.post<Airport>(`${this.baseUrl}/airports`, airport);
  }

  updateAirport(iata: string, airport: Partial<Airport>): Observable<Airport> {
    return this.http.put<Airport>(`${this.baseUrl}/airports/${iata}`, airport);
  }

  deleteAirport(iata: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/airports/${iata}`);
  }

  syncAirportFromAirLabs(iata: string, apiKey?: string): Observable<any> {
    const code = iata.trim().toUpperCase();
    let params = new HttpParams().set('iata_code', code);
    const body: Record<string, any> = { iata_code: code };
    if (apiKey && apiKey.trim()) {
      params = params.set('api_key', apiKey.trim());
      body['api_key'] = apiKey.trim();
    }
    return this.http.post<any>(`${this.baseUrl}/airports/sync-airlabs`, body, { params });
  }

  syncAllAirportsFromAirLabs(apiKey?: string): Observable<AirportSyncAllResponse> {
    let params = new HttpParams();
    const body: Record<string, any> = {};
    if (apiKey && apiKey.trim()) {
      params = params.set('api_key', apiKey.trim());
      body['api_key'] = apiKey.trim();
    }
    return this.http.post<AirportSyncAllResponse>(
      `${this.baseUrl}/airports/sync-airlabs-all`,
      body,
      { params },
    );
  }

  importAirportsForCountries(codes: string[]): Observable<AirportImportCountriesResponse> {
    const cleanCodes = codes.map((c) => c.trim().toUpperCase()).filter(Boolean).join(',');
    const params = new HttpParams().set('codes', cleanCodes);
    return this.http.post<AirportImportCountriesResponse>(
      `${this.baseUrl}/airports/import-countries`,
      {},
      { params },
    );
  }

  fixAirportCityNames(): Observable<AirportFixCityNamesResponse> {
    return this.http.post<AirportFixCityNamesResponse>(
      `${this.baseUrl}/airports/fix-city-names`,
      {},
    );
  }

  syncRoutesForHubs(hubs?: string[]): Observable<SyncRoutesHubsResponse> {
    let params = new HttpParams();
    if (hubs && hubs.length > 0) {
      const cleanHubs = hubs.map((h) => h.trim().toUpperCase()).filter(Boolean).join(',');
      if (cleanHubs) {
        params = params.set('hubs', cleanHubs);
      }
    }
    return this.http.post<SyncRoutesHubsResponse>(
      `${this.baseUrl}/reference/sync-routes-hubs`,
      {},
      { params },
    );
  }

  // ===================== BOOKINGS =====================
  createBooking(bookingData: {
    user_id: string;
    booking_type: string;
    is_block: boolean;
    passengers: any[];
    legs: any[];
    payment_method?: 'PROFILE_CARD' | 'PAYPAL';
    seat_requests?: Array<{
      passenger_index: number;
      flight_id: string;
      selection_type: 'AUTO' | 'CHOOSE';
      seat_code?: string;
    }>;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings`, bookingData);
  }

  confirmBooking(data: {
    blocking_number: string;
    payment_method: 'PROFILE_CARD' | 'PAYPAL';
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings/confirm`, data);
  }

  rescheduleBooking(data: {
    confirmation_number: string;
    new_flight_id?: string;
    new_inventory_id?: string;
    new_legs?: Array<{ flight_id: string; inventory_id: string; leg_type?: string }>;
    new_return_flight_id?: string;
    new_return_inventory_id?: string;
    new_return_legs?: Array<{ flight_id: string; inventory_id: string; leg_type?: string }>;
    payment_method?: 'PROFILE_CARD' | 'PAYPAL';
    seat_requests?: Array<{
      passenger_index: number;
      flight_id: string;
      selection_type: 'AUTO' | 'CHOOSE';
      seat_code?: string;
    }>;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings/reschedule`, data);
  }

  cancelBooking(data: { identifier: string; reason?: string }): Observable<CancelBookingResponse> {
    return this.http.post<CancelBookingResponse>(`${this.baseUrl}/bookings/cancel`, data);
  }

  trackBooking(code: string): Observable<Booking> {
    return this.http.get<Booking>(`${this.baseUrl}/bookings/track/${encodeURIComponent(code)}`);
  }

  getMyTrips(): Observable<Booking[]> {
    return this.http.get<Booking[]>(`${this.baseUrl}/bookings/my-trips`);
  }

  getBookings(filter?: { status?: BookingStatus; user_id?: string }): Observable<Booking[]> {
    let params = new HttpParams();
    if (filter?.status) params = params.set('status', filter.status);
    if (filter?.user_id) params = params.set('user_id', filter.user_id);
    return this.http.get<Booking[]>(`${this.baseUrl}/bookings`, { params });
  }

  getBookingById(id: string): Observable<Booking> {
    return this.http.get<Booking>(`${this.baseUrl}/bookings/${id}`);
  }

  // ===================== POLICIES =====================
  getPolicies(): Observable<CancellationPolicy[]> {
    return this.http.get<CancellationPolicy[]>(`${this.baseUrl}/policies`);
  }

  createPolicy(policy: Partial<CancellationPolicy>): Observable<CancellationPolicy> {
    return this.http.post<CancellationPolicy>(`${this.baseUrl}/policies`, policy);
  }

  updatePolicy(id: string, policy: Partial<CancellationPolicy>): Observable<CancellationPolicy> {
    return this.http.put<CancellationPolicy>(`${this.baseUrl}/policies/${id}`, policy);
  }

  deletePolicy(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/policies/${id}`);
  }

  // ===================== USERS =====================
  getUsers(search?: string, role?: UserRole): Observable<User[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    if (role) params = params.set('role', role);
    return this.http.get<User[]>(`${this.baseUrl}/users`, { params });
  }

  getUserById(id: string): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/users/${id}`);
  }

  createUser(user: any): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/users`, user);
  }

  updateUser(id: string, user: any): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/users/${id}`, user);
  }

  deleteUser(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/users/${id}`);
  }

  // ===================== SEAT ALLOCATION & PRICING =====================
  getEnrichedSeatMap(flightId: string, aircraftType: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/seat-allocation/flight/${flightId}/map`, {
      params: new HttpParams().set('aircraftType', aircraftType),
    });
  }

  blockSeat(
    flightId: string,
    data: { seat_code: string; reason: string; aircraft_type: string; notes?: string },
  ): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/seat-allocation/flight/${flightId}/block`, data);
  }

  unblockSeat(flightId: string, seatCode: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/seat-allocation/flight/${flightId}/unblock`, {
      seat_code: seatCode,
    });
  }

  setSeatPriceOverride(
    flightId: string,
    data: { seat_code: string; override_fee: number; reason: string },
  ): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/seat-allocation/flight/${flightId}/override-price`, data);
  }

  removeSeatPriceOverride(flightId: string, seatCode: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.baseUrl}/seat-allocation/flight/${flightId}/override-price/${seatCode}`,
    );
  }

  getSeatPricingRules(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/seat-allocation/pricing-rules`);
  }

  createSeatPricingRule(data: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/seat-allocation/pricing-rules`, data);
  }

  updateSeatPricingRule(ruleId: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/seat-allocation/pricing-rules/${ruleId}`, data);
  }

  deleteSeatPricingRule(ruleId: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/seat-allocation/pricing-rules/${ruleId}`);
  }

  // ===================== AIRLABS COMMERCIAL OPERATIONS =====================

  syncRoutesForAirport(depIata: string, limit = 200): Observable<AirportRoutesSyncResponse> {
    const cleanDep = (depIata || '').trim().toUpperCase();
    let params = new HttpParams().set('dep_iata', cleanDep);
    if (limit) {
      params = params.set('limit', limit.toString());
    }
    return this.http.post<AirportRoutesSyncResponse>(
      `${this.baseUrl}/reference/sync-routes`,
      {},
      { params },
    );
  }

  getAirLabsRoutes(query?: {
    dep_iata?: string;
    arr_iata?: string;
    has_schedule?: boolean;
    limit?: number;
    offset?: number;
  }): Observable<AirLabsRoutesListResponse> {
    let params = new HttpParams();
    if (query?.dep_iata) params = params.set('dep_iata', query.dep_iata.trim().toUpperCase());
    if (query?.arr_iata) params = params.set('arr_iata', query.arr_iata.trim().toUpperCase());
    if (query?.has_schedule !== undefined) params = params.set('has_schedule', query.has_schedule.toString());
    if (query?.limit !== undefined) params = params.set('limit', query.limit.toString());
    if (query?.offset !== undefined) params = params.set('offset', query.offset.toString());

    return this.http.get<AirLabsRoutesListResponse>(`${this.baseUrl}/flights/airlabs-routes`, { params });
  }

  getAirLabsRouteBySourceKey(sourceKey: string): Observable<AirLabsRouteRef> {
    return this.http.get<AirLabsRouteRef>(
      `${this.baseUrl}/flights/airlabs-routes/${encodeURIComponent(sourceKey)}`,
    );
  }

  discoverCommercialNetwork(
    payload: CommercialNetworkDiscoveryRequest,
  ): Observable<CommercialNetworkDiscoveryResponse> {
    return this.http.post<CommercialNetworkDiscoveryResponse>(
      `${this.baseUrl}/flights/commercial-network-discovery`,
      payload,
    );
  }

  getCommercialAircraftLayouts(): Observable<CommercialAircraftLayout[]> {
    return this.http.get<CommercialAircraftLayout[]>(
      `${this.baseUrl}/flights/commercial-aircraft-layouts`,
    );
  }

  commercializeAirLabsRoute(payload: CommercializeRoutePayload): Observable<CommercialScheduleTemplate> {
    return this.http.post<CommercialScheduleTemplate>(
      `${this.baseUrl}/flights/commercialize-airlabs-route`,
      payload,
    );
  }

  getCommercialTemplates(query?: {
    is_active?: boolean;
    origin_iata?: string;
    dest_iata?: string;
    limit?: number;
    offset?: number;
  }): Observable<CommercialTemplatesListResponse> {
    let params = new HttpParams();
    if (query?.is_active !== undefined) params = params.set('is_active', query.is_active.toString());
    if (query?.origin_iata) params = params.set('origin_iata', query.origin_iata.trim().toUpperCase());
    if (query?.dest_iata) params = params.set('dest_iata', query.dest_iata.trim().toUpperCase());
    if (query?.limit !== undefined) params = params.set('limit', query.limit.toString());
    if (query?.offset !== undefined) params = params.set('offset', query.offset.toString());

    return this.http.get<CommercialTemplatesListResponse>(
      `${this.baseUrl}/flights/commercial-templates`,
      { params },
    );
  }

  fetchAllCommercialTemplates(): Observable<CommercialScheduleTemplate[]> {
    const pageSize = 200;
    return this.getCommercialTemplates({ limit: pageSize, offset: 0 }).pipe(
      switchMap((firstPage) => {
        const total = firstPage.total;
        const accumulated = [...firstPage.items];
        if (accumulated.length >= total || firstPage.items.length === 0) {
          return of(accumulated);
        }

        const remainingRequests: Observable<CommercialTemplatesListResponse>[] = [];
        for (let offset = pageSize; offset < total; offset += pageSize) {
          remainingRequests.push(this.getCommercialTemplates({ limit: pageSize, offset }));
        }

        return forkJoin(remainingRequests).pipe(
          map((subsequentPages) => {
            for (const page of subsequentPages) {
              accumulated.push(...page.items);
            }
            return accumulated;
          }),
        );
      }),
    );
  }

  updateCommercialTemplate(
    id: string,
    payload: UpdateCommercialTemplatePayload,
  ): Observable<CommercialScheduleTemplate> {
    return this.http.patch<CommercialScheduleTemplate>(
      `${this.baseUrl}/flights/commercial-templates/${encodeURIComponent(id)}`,
      payload,
    );
  }

  toggleCommercialTemplateStatus(
    id: string,
    isActive: boolean,
  ): Observable<CommercialScheduleTemplate> {
    return this.http.patch<CommercialScheduleTemplate>(
      `${this.baseUrl}/flights/commercial-templates/${encodeURIComponent(id)}/status`,
      { is_active: isActive },
    );
  }

  materializeCommercialTemplate(
    id: string,
    payload: MaterializeTemplatePayload,
  ): Observable<MaterializeTemplateResponse> {
    return this.http.post<MaterializeTemplateResponse>(
      `${this.baseUrl}/flights/commercial-templates/${encodeURIComponent(id)}/materialize`,
      payload,
    );
  }
}
