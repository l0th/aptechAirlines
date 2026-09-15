export enum CabinClass {
  ECONOMY = 'ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
}

export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  LANDED = 'LANDED',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED',
}

export interface Aircraft {
  model_code: string;
  model_name: string;
  total_capacity: number;
}

export interface FlightInventory {
  _id?: string;
  cabin_class: CabinClass;
  is_smoking?: boolean;
  bucket_code?: string;
  base_price: number;
  allocated_seats: number;
  available_seats: number;
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
  aircraft?: Aircraft;
  inventories: FlightInventory[];
  created_at?: string;
  updated_at?: string;
}

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
  aircraft?: Aircraft;
  inventory_id: string;
  cabin_class: CabinClass;
  is_smoking?: boolean;
  available_seats: number;
  pricing: {
    adult_price: number;
    child_price: number;
    senior_price: number;
    total_party_price: number;
  };
}

export interface ConnectingRouteOption {
  leg_1: FormattedFlightResult;
  leg_2: FormattedFlightResult;
  transit_airport: string;
  transit_layover_minutes: number;
  total_journey_duration_minutes: number;
  pricing: {
    adult_price: number;
    child_price: number;
    senior_price: number;
    total_party_price: number;
  };
}

export interface FlightSearchResult {
  origin_info: {
    query: string;
    resolved_iata: string;
    nearest_suggestion?: any;
  };
  dest_info: {
    query: string;
    resolved_iata: string;
    nearest_suggestion?: any;
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
}

export interface SeatItem {
  seat_code: string;
  column: string;
  is_occupied: boolean;
  cabin_class: CabinClass;
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
  aircraft_model: string;
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
