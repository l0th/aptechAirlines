import { CabinClass } from './flight.model';

export enum PassengerType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
  SENIOR = 'SENIOR',
}

export enum BookingStatus {
  BLOCKED = 'BLOCKED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

export enum BookingType {
  ONE_WAY = 'ONE_WAY',
  ROUND_TRIP = 'ROUND_TRIP',
  CONNECTING = 'CONNECTING',
}

export interface Passenger {
  _id?: string;
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport?: string;
  nationality?: string;
  date_of_birth?: string;
  seat_code?: string;
  fare_charged?: number;
}

export interface FlightLeg {
  flight_id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  duration_minutes: number;
  cabin_class: CabinClass;
  inventory_id: string;
  leg_type?: string;
}

export interface Booking {
  _id: string;
  user_id: string;
  user_name?: string;
  booking_type: BookingType;
  status: BookingStatus;
  pnr_number: string;
  blocking_number?: string;
  blocking_expires_at?: string;
  confirmation_number?: string;
  confirmed_at?: string;
  total_amount: number;
  currency: string;
  passengers: Passenger[];
  legs: FlightLeg[];
  credit_card_mask?: string;
  created_at: string;
  cancelled_at?: string;
  cancel_reason?: string;
  refund_percentage?: number;
  refund_amount?: number;
  delay_or_cancellation_info?: {
    is_affected: boolean;
    flight_status: string;
    delay_reason?: string;
    message: string;
  };
}

export interface CancellationPolicy {
  _id?: string;
  min_days_before: number;
  max_days_before: number | null;
  refund_percentage: number;
  description: string;
}
