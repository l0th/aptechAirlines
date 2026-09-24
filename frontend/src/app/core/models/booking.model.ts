/**
 * Booking models — mirror the REAL backend `Booking` Mongoose document
 * (backend/src/bookings/bookings.schema.ts). Keep field names EXACTLY as the
 * server returns them (snake_case for domain fields, camelCase for timestamps).
 *
 * Important backend facts:
 *  - The reference code is `pnr_code` (there is NO `pnr_number`).
 *  - `Passenger` has NO `seat_code`: seats are stored per coupon in
 *    `ticket_coupons[].seat_code` and are mapped back to a passenger through
 *    `ticket_coupons[].passenger_name` (= `${first_name} ${last_name}`).
 *  - There is NO embedded `legs` array: the itinerary lives in `ticket_coupons`
 *    (grouped by `leg_type` + `flight_number`).
 *  - Dates come back from the API as ISO strings.
 */

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
  /** Multi-leg itinerary through a transit airport (backend supports it). */
  CONNECTING = 'CONNECTING',
}

/** Leg types written into `ticket_coupons[].leg_type` (free-form string). */
export enum LegType {
  OUTBOUND = 'OUTBOUND',
  INBOUND = 'INBOUND',
  CONNECTING_1 = 'CONNECTING_1',
  CONNECTING_2 = 'CONNECTING_2',
  CONNECTING_3 = 'CONNECTING_3',
  INBOUND_1 = 'INBOUND_1',
  INBOUND_2 = 'INBOUND_2',
  INBOUND_3 = 'INBOUND_3',
}

export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

/** Passenger sub-document stored on the booking (NO seat_code here). */
export interface Passenger {
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport?: string;
  nationality?: string;
  date_of_birth?: string;
}

/**
 * Passenger as accepted by `POST /api/bookings` (CreateBookingDto).
 * `seat_code` only exists on the REQUEST: the backend copies it into every
 * generated ticket coupon for that passenger (`passenger_name` match).
 */
export interface PassengerInput {
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport?: string;
  nationality?: string;
  date_of_birth?: string;
  seat_code?: string;
  seat_codes?: Record<string, string>;
}

/** One leg selection sent to `POST /api/bookings`. */
export interface FlightLegSelection {
  flight_id: string;
  inventory_id: string;
  leg_type?: LegType | string;
}

export interface TicketCoupon {
  coupon_number: string;
  /** `${first_name} ${last_name}` exactly as submitted by the client. */
  passenger_name: string;
  flight_id: string;
  flight_number: string;
  inventory_id: string;
  cabin_class: string;
  is_smoking: boolean;
  fare_paid: number;
  /** Assigned seat, e.g. '12A' (empty string when not selected). */
  seat_code?: string;
  leg_type: LegType | string;
  coupon_status: CouponStatus | string;
}

export interface PresentmentAmount {
  provider_amount: string;
  provider_currency: string;
  exchange_rate_vnd_per_unit: number;
}

export interface BookingQuoteResponse {
  total_fare: number;
  total_seat_fees: number;
  total_amount: number;
  currency: string;
  early_bird_percent?: number;
  ff_tier?: string;
  ff_discount_percent?: number;
  presentment?: PresentmentAmount;
}

export interface RescheduleQuoteResponse {
  price_difference: number;
  old_total: number;
  new_total: number;
  new_fare: number;
  new_seat_fees: number;
  currency: string;
  presentment?: PresentmentAmount;
}

export interface PaymentTransaction {
  /** PAYMENT | REFUND | RESCHEDULE_CHARGE | RESCHEDULE_REFUND */
  transaction_type: string;
  payment_method?: 'PROFILE_CARD' | 'PAYPAL';
  payment_reference?: string;
  source_payment_reference?: string;
  amount: number;
  currency?: string;
  card_masked?: string;
  provider_order_id?: string;
  provider_capture_id?: string;
  provider_refund_id?: string;
  provider_amount?: string;
  provider_currency?: string;
  exchange_rate_vnd_per_unit?: number;
  provider_status?: string;
  status: string;
  created_at: string;
}

/** Response document of every booking endpoint. */
export interface Booking {
  _id: string;
  pnr_code: string;
  /** ObjectId string, or the populated user document on list endpoints. */
  user_id: string | { _id: string; first_name?: string; last_name?: string; email?: string };
  user_name?: string;
  booking_type: BookingType;
  status: BookingStatus;
  /** Only for BLOCKED bookings (free hold). */
  blocking_number?: string;
  /** Only for CONFIRMED / RESCHEDULED bookings. */
  confirmation_number?: string;
  /** Only after a cancellation. */
  cancellation_number?: string;
  /** Hold deadline = earliest departure − 14 days (BLOCKED bookings). */
  time_limit_deadline?: string;
  is_reminder_sent?: boolean;
  total_amount: number;
  total_miles_accrued: number;
  passengers: Passenger[];
  ticket_coupons: TicketCoupon[];
  payment_transactions: PaymentTransaction[];
  early_bird_percent?: number;
  early_bird_label?: string;
  early_bird_label_en?: string;
  ff_tier?: string;
  ff_discount_percent?: number;
  pricing_note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CancellationPolicy {
  _id?: string;
  min_days_before: number;
  max_days_before: number | null;
  refund_percentage: number;
  description: string;
  description_en?: string;
}

export interface CancelBookingResponse {
  booking: Booking;
  refund_amount: number;
  refund_percentage: number;
  cancellation_number: string;
  currency: string;
  refund_card_masked?: string;
  message: string;
}
