import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Flight,
  FlightSearchResult,
  SeatMapResponse,
  FlightStatus,
} from '../models/flight.model';
import { Airport, CityResolveResult } from '../models/airport.model';
import {
  Booking,
  BookingStatus,
  CancellationPolicy,
} from '../models/booking.model';
import { AuthResponse, User, UserRole } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api';

  // ===================== AUTH =====================
  login(credentials: { username: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, credentials);
  }

  register(userData: Partial<User> & { password: string }): Observable<AuthResponse> {
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

  getFlights(filter?: {
    status?: FlightStatus;
    origin?: string;
    dest?: string;
  }): Observable<Flight[]> {
    let params = new HttpParams();
    if (filter?.status) params = params.set('status', filter.status);
    if (filter?.origin) params = params.set('origin', filter.origin);
    if (filter?.dest) params = params.set('dest', filter.dest);
    return this.http.get<Flight[]>(`${this.baseUrl}/flights`, { params });
  }

  getFlightById(id: string): Observable<Flight> {
    return this.http.get<Flight>(`${this.baseUrl}/flights/${id}`);
  }

  getSeatMap(flightId: string): Observable<SeatMapResponse> {
    return this.http.get<SeatMapResponse>(`${this.baseUrl}/flights/${flightId}/seat-map`);
  }

  syncAirLabs(
    depIata = 'HAN',
    arrIata = 'SGN',
    apiKey = '8b45eda3-b158-40d3-a6fa-892632ed8075',
  ): Observable<{ message: string; synchronized_count: number; flights: any[] }> {
    let params = new HttpParams()
      .set('dep_iata', depIata)
      .set('arr_iata', arrIata)
      .set('api_key', apiKey);
    return this.http.post<{
      message: string;
      synchronized_count: number;
      flights: any[];
    }>(`${this.baseUrl}/flights/sync-airlabs`, { api_key: apiKey }, { params });
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

  // ===================== AIRPORTS =====================
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

  // ===================== BOOKINGS =====================
  createBooking(bookingData: {
    user_id: string;
    booking_type: string;
    is_block: boolean;
    passengers: any[];
    legs: any[];
    credit_card_number?: string;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings`, bookingData);
  }

  confirmBooking(data: {
    blocking_number: string;
    credit_card_number: string;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings/confirm`, data);
  }

  rescheduleBooking(data: {
    confirmation_number: string;
    new_flight_id: string;
    new_inventory_id: string;
    credit_card_number?: string;
  }): Observable<Booking> {
    return this.http.post<Booking>(`${this.baseUrl}/bookings/reschedule`, data);
  }

  cancelBooking(data: { identifier: string; reason?: string }): Observable<{
    message: string;
    booking: Booking;
    refund_percentage: number;
    refund_amount: number;
  }> {
    return this.http.post<any>(`${this.baseUrl}/bookings/cancel`, data);
  }

  trackBooking(code: string): Observable<Booking> {
    return this.http.get<Booking>(`${this.baseUrl}/bookings/track/${encodeURIComponent(code)}`);
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
}
