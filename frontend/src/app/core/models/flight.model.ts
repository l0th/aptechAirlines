export enum CabinClass {
  ECONOMY = 'ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
  CLUB = 'CLUB',
}

/** Khớp đúng enum FlightStatus của backend (backend/src/flights/flights.schema.ts). */
export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  DELAYED = 'DELAYED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export interface Aircraft {
  model_code?: string;
  model_name?: string;
  total_capacity?: number;
  registration?: string;
}

export interface FlightInventory {
  _id?: string;
  cabin_class: CabinClass;
  is_smoking?: boolean;
  bucket_code?: string;
  base_price: number;
  allocated_seats: number;
  available_seats: number;
  early_bird_percent?: number;
  early_bird_label?: string;
  early_bird_label_en?: string;
  days_until_departure?: number;
}

export interface Flight {
  _id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  departure_date: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  actual_departure?: string;
  actual_arrival?: string;
  duration_minutes: number;
  distance_miles: number;
  status: FlightStatus;
  delay_reason?: string;
  delay_minutes?: number;
  aircraft?: Aircraft;
  inventories: FlightInventory[];
  origin_time_zone?: string;
  dest_time_zone?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  actual_departure_local?: string;
  actual_arrival_local?: string;
  time_zone_diff_minutes?: number;
  created_at?: string;
  updated_at?: string;
  // Provenance & Deterministic Schedule Identity
  template_id?: string;
  operating_date?: string;
  is_generated?: boolean;
  generated_source?: string;
  is_manually_modified?: boolean;
  operator?: string;
  is_bookable?: boolean;
  data_source?: string;
  commercial_template_id?: string;
  source_type?: string;
  source_route_key?: string;
  source_service_key?: string;
  source_airline_iata?: string;
  source_airline_icao?: string;
  source_flight_iata?: string;
  source_flight_icao?: string;
  source_flight_number?: string;
  source_aircraft_icao?: string;
  source_duration_minutes?: number;
  source_synced_at?: string;
}

/**
 * Một dòng kết quả tìm kiếm = 1 chuyến bay × 1 khoang vé.
 * Đây chính là shape thật do GET /api/flights/search trả về
 * (backend/src/flights/flights.service.ts - findDirectFlights).
 */
export interface FormattedFlightResult {
  flight_id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  departure_date: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  duration_minutes: number;
  distance_miles: number;
  status: FlightStatus;
  delay_reason?: string;
  delay_minutes?: number;
  aircraft?: Aircraft;
  inventory_id: string;
  cabin_class: CabinClass;
  is_smoking?: boolean;
  available_seats: number;
  /** Giá 1 người lớn (VND). */
  base_price_per_adult: number;
  /** Tổng giá cho cả nhóm khách đã chọn (người lớn 100%, trẻ em 75%, cao tuổi 85%). */
  total_party_price: number;
  origin_time_zone?: string;
  dest_time_zone?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  time_zone_diff_minutes?: number;
  early_bird_percent?: number;
  early_bird_label?: string;
  early_bird_label_en?: string;
  days_until_departure?: number;
}

/** Một chặng trong hành trình nối chuyến (shape thật của backend). */
export interface ConnectingLeg {
  flight_id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  departure_date?: string;
  departure: string;
  arrival: string;
  inventories: FlightInventory[];
  origin_time_zone?: string;
  dest_time_zone?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  time_zone_diff_minutes?: number;
  early_bird_percent?: number;
  early_bird_label?: string;
  early_bird_label_en?: string;
  days_until_departure?: number;
}

export interface BookingWindowResponse {
  max_advance_days: number;
  min_date: string;
  max_date: string;
}

/**
 * Phương án nối chuyến do Route Selection Algorithm sinh ra
 * (backend/src/flights/flights.service.ts - findConnectingRoutes).
 */
export interface ConnectingRouteOption {
  departure_date?: string;
  route_type: 'CONNECTING' | 'ONE_STOP' | 'TWO_STOP';
  transit_airport: string;
  transit_airports?: string[];
  total_duration_minutes: number;
  layover_minutes: number | number[];
  leg1: ConnectingLeg;
  leg2: ConnectingLeg;
  legs: ConnectingLeg[];
}

export interface FlightSearchResult {
  origin_info: {
    query: string;
    resolved_iata: string;
    nearest_suggestion?: any;
    /** true khi hệ thống phải dùng sân bay gần nhất (thành phố không được phục vụ trực tiếp). */
    using_nearest_airport?: boolean;
  };
  dest_info: {
    query: string;
    resolved_iata: string;
    nearest_suggestion?: any;
    /** true khi hệ thống phải dùng sân bay gần nhất (thành phố không được phục vụ trực tiếp). */
    using_nearest_airport?: boolean;
  };
  is_round_trip: boolean;
  passenger_breakdown: {
    adults: number;
    children: number;
    seniors: number;
    total: number;
  };
  onward_flights: FormattedFlightResult[];
  return_flights?: FormattedFlightResult[];
  connecting_routes: ConnectingRouteOption[];
  return_connecting_routes?: ConnectingRouteOption[];
}

export interface SeatItem {
  seat_code: string;
  row?: number;
  column: string;
  /** SPECIAL (hàng 1-5) | EXIT_ROW (hàng 12,14) | STANDARD */
  type?: 'SPECIAL' | 'EXIT_ROW' | 'STANDARD';
  type_label?: string;
  cabin_class: CabinClass;
  /** Phụ phí chọn ghế tham khảo (VND): hàng đặc biệt 150.000, hàng thoát hiểm 100.000, còn lại 0. */
  fee?: number;
  is_occupied: boolean;
  is_exit_row?: boolean;
  is_special?: boolean;
}

export interface SeatRow {
  row_number: number;
  is_exit_row: boolean;
  is_special: boolean;
  column_groups?: SeatItem[][];
  seats: SeatItem[];
}

export interface SeatMapResponse {
  flight_id: string;
  flight_number: string;
  route: string;
  aircraft_model: string | null;
  aircraft_known?: boolean;
  aircraft_type?: string;
  layout_available?: boolean;
  layout_notice?: string;
  total_capacity?: number;
  departure_time: string;
  legend?: Array<{
    type: string;
    label: string;
    color: string;
    bg: string;
  }>;
  notice?: {
    skyboss_benefit?: string;
    exit_row_warning?: string;
  };
  layout?: {
    left_columns: string[];
    right_columns: string[];
    exit_rows: number[];
    special_rows: number[];
    skipped_rows: number[];
  };
  rows: SeatRow[];
}

/** Authoritative commercial aircraft layout metadata from backend */
export interface CommercialAircraftLayout {
  aircraft_type: string;
  model_name: string;
  total_capacity: number;
  cabin_capacities: Record<string, number>;
  supported_cabins: string[];
}

/** AirLabs RouteRef schema mirror */
export interface AirLabsRouteRef {
  source_key: string;
  airline_iata?: string;
  airline_icao?: string;
  flight_number?: string;
  flight_iata?: string;
  flight_icao?: string;
  cs_airline_iata?: string;
  cs_flight_iata?: string;
  cs_flight_number?: string;
  dep_iata: string;
  dep_icao?: string;
  dep_time?: string;
  dep_time_utc?: string;
  dep_terminals?: string[];
  arr_iata: string;
  arr_icao?: string;
  arr_time?: string;
  arr_time_utc?: string;
  arr_terminals?: string[];
  duration?: number;
  days?: string[]; // Provider string[] e.g. ["1", "2", "3", "4", "5", "6", "7"]
  aircraft_icao?: string;
  has_schedule?: boolean;
  source?: string;
  synced_at?: string;
  airlabs_updated?: string;
  sync_generation?: string;
}

/** Aptech Commercial ScheduleTemplate schema mirror */
export interface CommercialScheduleTemplate {
  _id?: string;
  template_id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  std_dep_time?: string;
  std_arr_time?: string;
  days_of_week: number[]; // 1=Mon ... 7=Sun
  aircraft_type: string;
  cabin_classes: CabinClass[];
  base_price_economy: number;
  base_price_business?: number;
  base_price_club?: number;
  base_price_first?: number;
  is_active: boolean;
  commercial_inventories?: Array<{
    cabin_class: CabinClass;
    allocated_seats: number;
  }>;
  source_type: string;
  source_route_key?: string;
  source_service_key?: string;
  source_airline_iata?: string;
  source_airline_icao?: string;
  source_flight_iata?: string;
  source_flight_icao?: string;
  source_flight_number?: string;
  source_aircraft_icao?: string;
  source_dep_time_utc?: string;
  source_arr_time_utc?: string;
  source_duration_minutes?: number;
  source_synced_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Mirror of CommercializeRouteDto */
export interface CommercializeRoutePayload {
  source_key: string;
  aptech_flight_number: string;
  aircraft_type: string;
  base_price_economy: number;
  base_price_business?: number;
  base_price_club?: number;
  base_price_first?: number;
  cabin_classes?: CabinClass[];
  inventories?: Array<{
    cabin_class: CabinClass;
    allocated_seats: number;
  }>;
}

/** Mirror of UpdateCommercialTemplateDto */
export interface UpdateCommercialTemplatePayload {
  flight_number?: string;
  aircraft_type?: string;
  base_price_economy?: number;
  base_price_business?: number | null;
  base_price_club?: number | null;
  base_price_first?: number | null;
  cabin_classes?: CabinClass[];
  is_active?: boolean;
  inventories?: Array<{
    cabin_class: CabinClass;
    allocated_seats: number;
  }>;
}

/** Mirror of MaterializeTemplateDto */
export interface MaterializeTemplatePayload {
  days_ahead?: number;
  start_date?: string;
}

/** Mirror of GenerationStats */
export interface MaterializeTemplateResponse {
  total_days: number;
  start_date: string;
  end_date: string;
  templates_count: number;
  total_operations: number;
  inserted_count: number;
  matched_count: number;
  skipped_existing: number;
  duration_ms: number;
}

/** Mirror of syncRoutesForAirport response */
export interface AirportRoutesSyncResponse {
  dep_iata: string;
  updated: number;
  records_seen: number;
  pages: number;
  truncated: boolean;
  complete: boolean;
  sync_generation?: string;
  next_offset?: number;
}

/** AirLabs routes list response with pagination */
export interface AirLabsRoutesListResponse {
  total: number;
  limit: number;
  offset: number;
  items: AirLabsRouteRef[];
}

/** Commercial templates list response with pagination */
export interface CommercialTemplatesListResponse {
  total: number;
  limit: number;
  offset: number;
  items: CommercialScheduleTemplate[];
}

/** Route graph coverage status */
export interface RouteGraphCoverage {
  complete: boolean;
  expanded_airports: string[];
  incomplete_airports: string[];
  missing_sync_state_airports: string[];
}

/** Request payload for commercial network discovery */
export interface CommercialNetworkDiscoveryRequest {
  origin: string;
  destination: string;
  departure_date: string;
  max_stops?: number;
}

/** Commercial network scope */
export interface CommercialNetworkScope {
  query: string;
  label: string;
  iata_codes: string[];
}

/** Single leg within a discovered commercial network itinerary */
export interface CommercialNetworkLeg {
  source_key: string;
  dep_iata: string;
  arr_iata: string;
  airline_iata?: string;
  airline_icao?: string;
  flight_iata?: string;
  flight_icao?: string;
  flight_number?: string;
  aircraft_icao?: string;
  dep_datetime?: string | Date;
  arr_datetime?: string | Date;
  dep_time_local?: string;
  arr_time_local?: string;
  dep_time_utc?: string;
  arr_time_utc?: string;
  duration_minutes?: number;
  days?: string[];
  is_bookable?: boolean;
}

/** Discovered itinerary from AirLabs route network */
export interface CommercialNetworkItinerary {
  route_type: 'DIRECT' | 'ONE_STOP' | 'TWO_STOP';
  airports: string[];
  stops: string[];
  total_duration_minutes: number;
  layover_minutes: number[];
  legs: CommercialNetworkLeg[];
  is_bookable?: boolean;
}

/** Full response for commercial network discovery */
export interface CommercialNetworkDiscoveryResponse {
  origin_scope: CommercialNetworkScope;
  destination_scope: CommercialNetworkScope;
  departure_date: string;
  max_stops: number;
  status: 'FOUND' | 'NO_ROUTE_FOUND' | 'NETWORK_DATA_INCOMPLETE';
  coverage: RouteGraphCoverage;
  itineraries: CommercialNetworkItinerary[];
}

