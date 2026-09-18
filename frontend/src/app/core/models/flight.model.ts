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
  time_zone_diff_minutes?: number;
  created_at?: string;
  updated_at?: string;
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
  seats: SeatItem[];
}

export interface SeatMapResponse {
  flight_id: string;
  flight_number: string;
  route: string;
  aircraft_model: string | null;
  aircraft_known?: boolean;
  layout_notice?: string;
  departure_time: string;
  legend: Array<{
    type: string;
    label: string;
    color: string;
    bg: string;
  }>;
  notice: {
    skyboss_benefit: string;
    exit_row_warning: string;
  };
  layout: {
    left_columns: string[];
    right_columns: string[];
    exit_rows: number[];
    special_rows: number[];
    skipped_rows: number[];
  };
  rows: SeatRow[];
}
