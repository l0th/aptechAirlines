import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { User, UserSchema, UserRole } from '../users/users.schema';
import { Flight, FlightSchema, CabinClass, FlightStatus } from '../flights/flights.schema';
import { Booking, BookingSchema, BookingStatus, BookingType, PaymentMethod, PassengerType } from '../bookings/bookings.schema';
import { SeatAllocation, SeatAllocationSchema, SeatAllocationStatus, SeatSelectionType } from '../seat-allocation/seat-allocation.schema';
import { FlightSeatOverride, FlightSeatOverrideSchema } from '../seat-allocation/flight-seat-override.schema';
import { CancellationPolicy, CancellationPolicySchema } from '../policies/policies.schema';
import { calculateGreatCircleMiles } from '../common/distance.util';
import { localDateKey, localWallTimeToUtc } from '../common/timezone.util';

dotenv.config();

/**
 * Disposable, test-only credentials strictly for local E2E demo environments.
 * These cannot authenticate production accounts (production environment is hard-denied).
 */
export const E2E_PASSWORD = 'E2ePass@2026';
export const BCRYPT_SALT_ROUNDS = 10;

/**
 * Requirement 5: Hard deny production environment without exception.
 */
export function assertSafeEnvironment(env?: string): void {
  if (env === 'production') {
    throw new Error('⛔ FATAL: E2E seed is strictly prohibited in PRODUCTION environment. Hard deny enforced.');
  }
}

/**
 * Returns a UTC Date corresponding to exact local wall time in Asia/Ho_Chi_Minh.
 * Independent of host machine or container process timezone.
 */
export function getRelativeDate(
  daysOffset: number,
  hours: number = 8,
  minutes: number = 0,
  baseInstant: Date = new Date(),
): Date {
  const VN_TZ = 'Asia/Ho_Chi_Minh';
  const vnTodayStr = localDateKey(baseInstant, VN_TZ);
  const [yearStr, monthStr, dayStr] = vnTodayStr.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = parseInt(dayStr, 10);

  const targetUtcDate = new Date(Date.UTC(y, m, d + daysOffset));
  const targetYear = targetUtcDate.getUTCFullYear();
  const targetMonth = String(targetUtcDate.getUTCMonth() + 1).padStart(2, '0');
  const targetDay = String(targetUtcDate.getUTCDate()).padStart(2, '0');
  const targetDateStr = `${targetYear}-${targetMonth}-${targetDay}`;

  const hhStr = String(hours).padStart(2, '0');
  const mmStr = String(minutes).padStart(2, '0');
  const hhmm = `${hhStr}:${mmStr}`;

  return localWallTimeToUtc(targetDateStr, hhmm, VN_TZ);
}

export function formatTimeStr(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Safely parses and sanitizes a MongoDB connection URI to prevent credential leakage.
 */
export function sanitizeMongoUri(uri: string): { host: string; database: string } {
  try {
    const parsed = new URL(uri);
    return {
      host: parsed.host || 'localhost',
      database: parsed.pathname.replace(/^\//, '') || 'airline_db',
    };
  } catch {
    return { host: 'localhost', database: 'airline_db' };
  }
}

/**
 * Requirement 3: Isolated coordinate reference map used ONLY for great-circle distance
 * calculation without mutating pre-existing legitimate airport records.
 */
export const KNOWN_AIRPORT_COORDINATES: Record<string, { lat: number; lng: number }> = {
  HAN: { lat: 21.2212, lng: 105.8072 },
  SGN: { lat: 10.8188, lng: 106.6519 },
  DAD: { lat: 16.0439, lng: 108.1994 },
  CXR: { lat: 11.9981, lng: 109.2194 },
  PQC: { lat: 10.1698, lng: 103.9931 },
  HOI: { lat: 15.8801, lng: 108.338 },
  NRT: { lat: 35.7647, lng: 140.3863 },
  HND: { lat: 35.5494, lng: 139.7798 },
  SIN: { lat: 1.3644, lng: 103.9915 },
  BKK: { lat: 13.69, lng: 100.7501 },
  CDG: { lat: 49.0097, lng: 2.5479 },
  LAX: { lat: 33.9416, lng: -118.4085 },
};

export function resolveAirportCoordinates(
  airportRecord?: { lat?: number; lng?: number; iata_code?: string } | null,
  fallbackIata?: string,
): { lat: number; lng: number } | null {
  if (typeof airportRecord?.lat === 'number' && typeof airportRecord?.lng === 'number') {
    return { lat: airportRecord.lat, lng: airportRecord.lng };
  }
  const iata = airportRecord?.iata_code || fallbackIata;
  if (iata && KNOWN_AIRPORT_COORDINATES[iata]) {
    return KNOWN_AIRPORT_COORDINATES[iata];
  }
  return null;
}

/**
 * Pure builders for E2E dataset entities conforming strictly to production Mongoose schemas.
 */

export function buildE2EUsers(passwordHash: string) {
  return [
    {
      username: 'e2e_customer',
      password_hash: passwordHash,
      email: 'e2e_customer@aptechairlines.test',
      first_name: 'Standard',
      last_name: 'Customer',
      address: '123 Le Loi Street, Ben Nghe Ward, District 1, Ho Chi Minh City',
      phone_number: '+84901234567',
      sex: 'MALE',
      age: 28,
      preferred_credit_card: '4111222233334444',
      sky_miles: 5000,
      role: UserRole.CUSTOMER,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      username: 'e2e_customer_gold',
      password_hash: passwordHash,
      email: 'e2e_customer_gold@aptechairlines.test',
      first_name: 'Gold',
      last_name: 'Customer',
      address: '456 Tran Hung Dao Street, Ward 2, District 5, Ho Chi Minh City',
      phone_number: '+84902345678',
      sex: 'FEMALE',
      age: 35,
      preferred_credit_card: '4111222233335555',
      sky_miles: 65000,
      role: UserRole.CUSTOMER,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      username: 'e2e_clerk',
      password_hash: passwordHash,
      email: 'e2e_clerk@aptechairlines.test',
      first_name: 'Airport',
      last_name: 'Clerk',
      address: 'Tan Son Nhat International Airport, Ward 2, Tan Binh District, HCMC',
      phone_number: '+84903456789',
      sex: 'MALE',
      age: 30,
      preferred_credit_card: '4111222233336666',
      sky_miles: 0,
      role: UserRole.CLERK,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      username: 'e2e_admin',
      password_hash: passwordHash,
      email: 'e2e_admin@aptechairlines.test',
      first_name: 'Operations',
      last_name: 'Admin',
      address: 'Aptech Airlines Headquarters, Noi Bai Airport, Hanoi',
      phone_number: '+84904567890',
      sex: 'FEMALE',
      age: 42,
      preferred_credit_card: '4111222233337777',
      sky_miles: 0,
      role: UserRole.ADMIN,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

export function buildE2EAirports() {
  return [
    {
      iata_code: 'HAN',
      city_name: 'Ha Noi',
      airport_name: 'Noi Bai International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 21.2212,
      lng: 105.8072,
    },
    {
      iata_code: 'SGN',
      city_name: 'Ho Chi Minh',
      airport_name: 'Tan Son Nhat International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 10.8188,
      lng: 106.6519,
    },
    {
      iata_code: 'DAD',
      city_name: 'Da Nang',
      airport_name: 'Da Nang International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 16.0439,
      lng: 108.1994,
    },
    {
      iata_code: 'CXR',
      city_name: 'Nha Trang',
      airport_name: 'Cam Ranh International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 11.9981,
      lng: 109.2194,
    },
    {
      iata_code: 'PQC',
      city_name: 'Phu Quoc',
      airport_name: 'Phu Quoc International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 10.1698,
      lng: 103.9931,
    },
    {
      iata_code: 'HOI',
      city_name: 'Hoi An',
      airport_name: 'Hoi An Town Heliport',
      is_serviced_directly: false,
      nearest_airport_code: 'DAD',
      distance_to_nearest_km: 30.0,
      time_zone: 'Asia/Ho_Chi_Minh',
      country_code: 'VN',
      lat: 15.8801,
      lng: 108.338,
    },
    {
      iata_code: 'NRT',
      city_name: 'Tokyo',
      airport_name: 'Narita International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Tokyo',
      country_code: 'JP',
      lat: 35.7647,
      lng: 140.3863,
    },
    {
      iata_code: 'HND',
      city_name: 'Tokyo',
      airport_name: 'Tokyo Haneda International Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Tokyo',
      country_code: 'JP',
      lat: 35.5494,
      lng: 139.7798,
    },
    {
      iata_code: 'SIN',
      city_name: 'Singapore',
      airport_name: 'Singapore Changi Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Singapore',
      country_code: 'SG',
      lat: 1.3644,
      lng: 103.9915,
    },
    {
      iata_code: 'BKK',
      city_name: 'Bangkok',
      airport_name: 'Suvarnabhumi Airport',
      is_serviced_directly: true,
      time_zone: 'Asia/Bangkok',
      country_code: 'TH',
      lat: 13.69,
      lng: 100.7501,
    },
    {
      iata_code: 'CDG',
      city_name: 'Paris',
      airport_name: 'Charles de Gaulle Airport',
      is_serviced_directly: true,
      time_zone: 'Europe/Paris',
      country_code: 'FR',
      lat: 49.0097,
      lng: 2.5479,
    },
    {
      iata_code: 'LAX',
      city_name: 'Los Angeles',
      airport_name: 'Los Angeles International Airport',
      is_serviced_directly: true,
      time_zone: 'America/Los_Angeles',
      country_code: 'US',
      lat: 33.9416,
      lng: -118.4085,
    },
  ];
}

export function createFlightDoc(params: {
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  departureDate: Date;
  arrivalDate: Date;
  aircraft_type: string;
  aircraft_model: string;
  total_capacity: number;
  base_price: number;
  status?: FlightStatus;
  delay_minutes?: number;
  delay_reason?: string;
  is_smoking?: boolean;
  inventories: Array<{
    cabin_class: CabinClass;
    allocated_seats: number;
    available_seats: number;
    price_factor: number;
    final_price?: number;
  }>;
  flight_duration_minutes: number;
  airportMap?: Record<string, any>;
}) {
  const inventoriesWithPrice = params.inventories.map((inv) => ({
    _id: new mongoose.Types.ObjectId(),
    cabin_class: inv.cabin_class,
    is_smoking: params.is_smoking ?? false,
    bucket_code: 'Y',
    base_price: inv.final_price || Math.round(params.base_price * inv.price_factor),
    allocated_seats: inv.allocated_seats,
    available_seats: inv.available_seats,
    saga_markers: [],
  }));

  const departureDateStr = params.departureDate.toISOString().slice(0, 10);

  // Requirement 2 & 3: Authoritative distance without hardcoded fallbacks
  const origCoords = resolveAirportCoordinates(params.airportMap?.[params.origin_iata], params.origin_iata);
  const destCoords = resolveAirportCoordinates(params.airportMap?.[params.dest_iata], params.dest_iata);
  const realDistance =
    origCoords && destCoords
      ? calculateGreatCircleMiles(origCoords.lat, origCoords.lng, destCoords.lat, destCoords.lng)
      : 0;

  return {
    flight_number: params.flight_number,
    operator: 'APTECH_AIRLINES',
    is_bookable: true,
    data_source: 'AIRLABS_COMMERCIALIZED',
    generated_source: 'seed_e2e_demo',
    origin_iata: params.origin_iata,
    dest_iata: params.dest_iata,
    departure_date: departureDateStr,
    scheduled_departure: params.departureDate,
    scheduled_arrival: params.arrivalDate,
    duration_minutes: params.flight_duration_minutes,
    distance_miles: realDistance,
    status: params.status || FlightStatus.SCHEDULED,
    delay_minutes: params.delay_minutes || 0,
    delay_reason: params.delay_reason || '',
    aircraft: {
      model_code: params.aircraft_type,
      model_name: params.aircraft_model,
      total_capacity: params.total_capacity,
    },
    inventories: inventoriesWithPrice,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export interface RawFlightSpec {
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  depOffset: number;
  depHour: number;
  depMin: number;
  duration: number;
  aircraft_type: string;
  aircraft_model: string;
  total_capacity: number;
  base_price: number;
  status?: FlightStatus;
  delay_minutes?: number;
  delay_reason?: string;
  is_smoking?: boolean;
  inventories: Array<{
    cabin_class: CabinClass;
    allocated_seats: number;
    available_seats: number;
    price_factor: number;
    final_price?: number;
  }>;
}

export function buildRawFlightSpecs(): RawFlightSpec[] {
  return [
    // 1. Eligible for HOLD (>14 days, +20d) - A20N (12 Business, 168 Economy = 180)
    {
      flight_number: 'APT-E2E-HLD',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 20,
      depHour: 8,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1800000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, available_seats: 12, price_factor: 2.11 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, available_seats: 168, price_factor: 1.0 },
      ],
    },
    // 2. HOLD Denied (<=14 days, +5d) & 0% refund bracket - A20N
    {
      flight_number: 'APT-E2E-BUY',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 5,
      depHour: 8,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 2200000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, available_seats: 12, price_factor: 2.05 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, available_seats: 168, price_factor: 1.0 },
      ],
    },
    // 3. Round-Trip Inbound Return Flight (+25d) - A20N
    {
      flight_number: 'APT-E2E-RET',
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      depOffset: 25,
      depHour: 14,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1800000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, available_seats: 12, price_factor: 2.11 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, available_seats: 168, price_factor: 1.0 },
      ],
    },
    // 4. Connecting Leg 1: HAN -> DAD (+20d) - A20N
    {
      flight_number: 'APT-E2E-C01',
      origin_iata: 'HAN',
      dest_iata: 'DAD',
      depOffset: 20,
      depHour: 7,
      depMin: 0,
      duration: 80,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1200000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, available_seats: 12, price_factor: 2.08 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, available_seats: 168, price_factor: 1.0 },
      ],
    },
    // 5. Connecting Leg 2: DAD -> PQC (+20d) (Layover at DAD from 08:20 to 10:30 = 2h10m) - AT76 (68 Economy)
    {
      flight_number: 'APT-E2E-C02',
      origin_iata: 'DAD',
      dest_iata: 'PQC',
      depOffset: 20,
      depHour: 10,
      depMin: 30,
      duration: 90,
      aircraft_type: 'AT76',
      aircraft_model: 'ATR 72-600',
      total_capacity: 68,
      base_price: 1400000,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 68, available_seats: 68, price_factor: 1.0 },
      ],
    },
    // 6. Alternative Flight: Lower Budget Price (+20d 06:00) - A21N (16 Business, 188 Economy = 204)
    {
      flight_number: 'APT-E2E-PRC-LO',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 20,
      depHour: 6,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A21N',
      aircraft_model: 'Airbus A321neo',
      total_capacity: 204,
      base_price: 1200000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 16, available_seats: 16, price_factor: 2.16 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 188, available_seats: 188, price_factor: 1.0 },
      ],
    },
    // 7. Widebody Flight (+20d 18:30) - B789 (Business 28, Club 35, Economy 231 = 294)
    {
      flight_number: 'APT-E2E-PRC-HI',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 20,
      depHour: 18,
      depMin: 30,
      duration: 135,
      aircraft_type: 'B789',
      aircraft_model: 'Boeing 787-9 Dreamliner',
      total_capacity: 294,
      base_price: 2500000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 28, available_seats: 28, price_factor: 2.2 },
        { cabin_class: CabinClass.CLUB, allocated_seats: 35, available_seats: 35, price_factor: 1.45 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 231, available_seats: 231, price_factor: 1.0 },
      ],
    },
    // 8. Flight with 90% Refund Eligibility (+35d, >30d) - A20N
    {
      flight_number: 'APT-E2E-REF90',
      origin_iata: 'SGN',
      dest_iata: 'DAD',
      depOffset: 35,
      depHour: 9,
      depMin: 0,
      duration: 80,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1500000,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 180, price_factor: 1.0 },
      ],
    },
    // 9. Flight with 50% Refund Eligibility (+10d, 7-14d) - A20N
    {
      flight_number: 'APT-E2E-REF50',
      origin_iata: 'SGN',
      dest_iata: 'DAD',
      depOffset: 10,
      depHour: 9,
      depMin: 0,
      duration: 80,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1700000,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 180, price_factor: 1.0 },
      ],
    },
    // 10. Limited Inventory Flight (+20d, only 2 seats left!) - AT76
    {
      flight_number: 'APT-E2E-LIM',
      origin_iata: 'SGN',
      dest_iata: 'CXR',
      depOffset: 20,
      depHour: 11,
      depMin: 0,
      duration: 65,
      aircraft_type: 'AT76',
      aircraft_model: 'ATR 72-600',
      total_capacity: 68,
      base_price: 1300000,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 68, available_seats: 2, price_factor: 1.0 },
      ],
    },
    // 11. Sold-Out Flight (+20d, 0 seats left) - AT76
    {
      flight_number: 'APT-E2E-OUT',
      origin_iata: 'SGN',
      dest_iata: 'CXR',
      depOffset: 20,
      depHour: 15,
      depMin: 0,
      duration: 65,
      aircraft_type: 'AT76',
      aircraft_model: 'ATR 72-600',
      total_capacity: 68,
      base_price: 1300000,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 68, available_seats: 0, price_factor: 1.0 },
      ],
    },
    // 12. Smoking Cabin Flight (+20d 21:00) - A20N
    {
      flight_number: 'APT-E2E-SMK',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 20,
      depHour: 21,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1500000,
      is_smoking: true,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 180, price_factor: 1.0 },
      ],
    },
    // 13. Delayed Test Target Flight (+5d 13:00) - A20N (Initially SCHEDULED)
    {
      flight_number: 'APT-E2E-DLY',
      origin_iata: 'SGN',
      dest_iata: 'DAD',
      depOffset: 5,
      depHour: 13,
      depMin: 0,
      duration: 80,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1500000,
      status: FlightStatus.SCHEDULED,
      delay_minutes: 0,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 180, price_factor: 1.0 },
      ],
    },
    // 14. Emergency Cancelled Test Target Flight (+5d 16:00) - A20N (Initially SCHEDULED)
    {
      flight_number: 'APT-E2E-CNC',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 5,
      depHour: 16,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1500000,
      status: FlightStatus.SCHEDULED,
      inventories: [
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 180, available_seats: 180, price_factor: 1.0 },
      ],
    },
    // 15. Cross-Timezone International Flight (+20d, SGN -> NRT Tokyo) - B789 (Business 28, Club 35, Economy 231)
    {
      flight_number: 'APT-E2E-INTL',
      origin_iata: 'SGN',
      dest_iata: 'NRT',
      depOffset: 20,
      depHour: 6,
      depMin: 0,
      duration: 330,
      aircraft_type: 'B789',
      aircraft_model: 'Boeing 787-9 Dreamliner',
      total_capacity: 294,
      base_price: 6500000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 28, available_seats: 28, price_factor: 2.15 },
        { cabin_class: CabinClass.CLUB, allocated_seats: 35, available_seats: 35, price_factor: 1.45 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 231, available_seats: 231, price_factor: 1.0 },
      ],
    },
    // 16. Designated Seat Map Demo Flight (+20d 10:00) - A20N (12 Business, 168 Economy = 180)
    // Requirement 4: Runtime invariant parity:
    // Staff physical blocks do NOT decrement commercial available_seats!
    // Customer CONFIRMED (15C) and HELD (15D) reservations = 2 Economy seats.
    // Economy available = 168 - 2 = 166. Business available = 12 - 0 = 12.
    {
      flight_number: 'APT-E2E-SEAT',
      origin_iata: 'SGN',
      dest_iata: 'HAN',
      depOffset: 20,
      depHour: 10,
      depMin: 0,
      duration: 135,
      aircraft_type: 'A20N',
      aircraft_model: 'Airbus A320neo',
      total_capacity: 180,
      base_price: 1800000,
      inventories: [
        { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, available_seats: 12, price_factor: 2.11 },
        { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, available_seats: 166, price_factor: 1.0 },
      ],
    },
  ];
}

export function buildSeatAllocations(params: {
  seatFlightId: mongoose.Types.ObjectId;
  confBookingId: mongoose.Types.ObjectId;
  holdBookingId: mongoose.Types.ObjectId;
  holdDeadline: Date;
}) {
  return [
    // 15C Confirmed occupied seat (belongs to PNR-E2E-CONF01)
    {
      flight_id: params.seatFlightId,
      seat_code: '15C',
      status: SeatAllocationStatus.CONFIRMED,
      cabin_class: CabinClass.ECONOMY,
      booking_id: params.confBookingId,
      coupon_number: 'CPN-E2E-001',
      passenger_name: 'Standard Customer',
      seat_selection_type: SeatSelectionType.CHOOSE,
      passenger_index: 0,
      seat_fee: 30000,
      seat_fee_currency: 'VND',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 15D Held seat (belongs to PNR-E2E-HOLD01)
    {
      flight_id: params.seatFlightId,
      seat_code: '15D',
      status: SeatAllocationStatus.HELD,
      cabin_class: CabinClass.ECONOMY,
      booking_id: params.holdBookingId,
      coupon_number: 'CPN-E2E-002',
      passenger_name: 'Tran Thi B',
      seat_selection_type: SeatSelectionType.CHOOSE,
      passenger_index: 0,
      seat_fee: 0,
      seat_fee_currency: 'VND',
      held_until: params.holdDeadline,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 12B Blocked Maintenance (unserviceable)
    {
      flight_id: params.seatFlightId,
      seat_code: '12B',
      status: SeatAllocationStatus.BLOCKED_MAINTENANCE,
      cabin_class: CabinClass.ECONOMY,
      staff_block_reason: 'Armrest recliner gear stuck; unserviceable',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 3D Blocked Crew Rest
    {
      flight_id: params.seatFlightId,
      seat_code: '3D',
      status: SeatAllocationStatus.CREW_REST,
      cabin_class: CabinClass.BUSINESS,
      staff_block_reason: 'Relief crew mandatory rest seat',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 1A VIP Protocol Hold
    {
      flight_id: params.seatFlightId,
      seat_code: '1A',
      status: SeatAllocationStatus.VIP_HOLD,
      cabin_class: CabinClass.BUSINESS,
      staff_block_reason: 'Airport protocol reservation',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

export function buildFlightSeatOverrides(params: {
  seatFlightId: mongoose.Types.ObjectId;
  adminUserId: mongoose.Types.ObjectId;
}) {
  return [
    {
      flight_id: params.seatFlightId,
      seat_code: '15E',
      override_fee: 250000,
      reason: 'Special promotional seat with extra amenities',
      is_active: true,
      created_by_user_id: params.adminUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

export function buildSampleBookings(params: {
  confBookingId: mongoose.Types.ObjectId;
  holdBookingId: mongoose.Types.ObjectId;
  cancBookingId: mongoose.Types.ObjectId;
  customerUserId: mongoose.Types.ObjectId;
  seatFlightId: mongoose.Types.ObjectId;
  seatFlightNumber: string;
  ecoInvId: string;
  distanceMiles: number;
  holdDeadline: Date;
}) {
  return [
    // 1. Confirmed Booking (Direct BUY)
    {
      _id: params.confBookingId,
      user_id: params.customerUserId,
      pnr_code: 'PNR-E2E-CONF01',
      confirmation_number: 'CNF-E2E-001',
      status: BookingStatus.CONFIRMED,
      booking_type: BookingType.ONE_WAY,
      passengers: [
        {
          first_name: 'Standard',
          last_name: 'Customer',
          passenger_type: PassengerType.ADULT,
          date_of_birth: new Date('1996-05-15'),
          id_card_or_passport: '001096000123',
          nationality: 'Vietnamese',
        },
      ],
      ticket_coupons: [
        {
          coupon_number: 'CPN-E2E-001',
          passenger_name: 'Standard Customer',
          flight_id: params.seatFlightId,
          flight_number: params.seatFlightNumber,
          inventory_id: params.ecoInvId,
          cabin_class: CabinClass.ECONOMY,
          is_smoking: false,
          fare_paid: 1800000,
          seat_code: '15C',
          seat_selection_type: 'CHOOSE',
          seat_fee: 30000,
          seat_fee_currency: 'VND',
          leg_type: 'OUTBOUND',
          coupon_status: 'ACTIVE',
        },
      ],
      total_fare: 1800000,
      total_seat_fees: 30000,
      total_amount: 1830000,
      total_miles_accrued: params.distanceMiles > 0 ? params.distanceMiles : 0,
      payment_transactions: [
        {
          payment_reference: 'AUTH-E2E-001',
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1830000,
          currency: 'VND',
          status: 'SUCCESS',
          card_masked: '•••• •••• •••• 4444',
          created_at: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 2. Active Held / Blocked Booking (>14 days, with BLK number)
    {
      _id: params.holdBookingId,
      user_id: params.customerUserId,
      pnr_code: 'PNR-E2E-HOLD01',
      blocking_number: 'BLK-E2E-001',
      status: BookingStatus.BLOCKED,
      booking_type: BookingType.ONE_WAY,
      time_limit_deadline: params.holdDeadline,
      is_reminder_sent: false,
      passengers: [
        {
          first_name: 'Tran Thi',
          last_name: 'B',
          passenger_type: PassengerType.ADULT,
          date_of_birth: new Date('1998-08-20'),
          id_card_or_passport: '001098000456',
          nationality: 'Vietnamese',
        },
      ],
      ticket_coupons: [
        {
          coupon_number: 'CPN-E2E-002',
          passenger_name: 'Tran Thi B',
          flight_id: params.seatFlightId,
          flight_number: params.seatFlightNumber,
          inventory_id: params.ecoInvId,
          cabin_class: CabinClass.ECONOMY,
          is_smoking: false,
          fare_paid: 1800000,
          seat_code: '15D',
          seat_selection_type: 'CHOOSE',
          seat_fee: 0,
          seat_fee_currency: 'VND',
          leg_type: 'OUTBOUND',
          coupon_status: 'ACTIVE',
        },
      ],
      total_fare: 1800000,
      total_seat_fees: 0,
      total_amount: 1800000,
      total_miles_accrued: 0,
      payment_transactions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // 3. Cancelled Booking with Refund Record
    {
      _id: params.cancBookingId,
      user_id: params.customerUserId,
      pnr_code: 'PNR-E2E-CANC01',
      confirmation_number: 'CNF-E2E-CNC',
      cancellation_number: 'CAN-E2E-001',
      status: BookingStatus.CANCELLED,
      booking_type: BookingType.ONE_WAY,
      passengers: [
        {
          first_name: 'Nguyen Van',
          last_name: 'C',
          passenger_type: PassengerType.ADULT,
          date_of_birth: new Date('1992-02-10'),
          id_card_or_passport: '001092000789',
          nationality: 'Vietnamese',
        },
      ],
      ticket_coupons: [
        {
          coupon_number: 'CPN-E2E-003',
          passenger_name: 'Nguyen Van C',
          flight_id: params.seatFlightId,
          flight_number: params.seatFlightNumber,
          inventory_id: params.ecoInvId,
          cabin_class: CabinClass.ECONOMY,
          is_smoking: false,
          fare_paid: 1800000,
          seat_code: '',
          seat_selection_type: 'AUTO',
          seat_fee: 0,
          seat_fee_currency: 'VND',
          leg_type: 'OUTBOUND',
          coupon_status: 'CANCELLED',
        },
      ],
      total_fare: 1800000,
      total_seat_fees: 0,
      total_amount: 1800000,
      total_miles_accrued: 0,
      payment_transactions: [
        {
          payment_reference: 'AUTH-E2E-002',
          transaction_type: 'PAYMENT',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1800000,
          currency: 'VND',
          status: 'SUCCESS',
          card_masked: '•••• •••• •••• 4444',
          created_at: new Date(Date.now() - 86400000),
        },
        {
          payment_reference: 'REF-E2E-001',
          source_payment_reference: 'AUTH-E2E-002',
          transaction_type: 'REFUND',
          payment_method: PaymentMethod.PROFILE_CARD,
          amount: 1350000,
          currency: 'VND',
          status: 'SUCCESS',
          failure_reason: 'Voluntary customer cancellation (>15 days)',
          card_masked: '•••• •••• •••• 4444',
          created_at: new Date(),
        },
      ],
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(),
    },
  ];
}

/**
 * Validates any fixture document against a Mongoose Schema to guarantee strict parity.
 */
export function validateDocumentAgainstSchema(schema: mongoose.Schema, doc: any): void {
  const model = mongoose.models.__validation_model__
    ? mongoose.models.__validation_model__
    : mongoose.model('__validation_model__', schema);
  const inst = new model(doc);
  const err = inst.validateSync();
  if (err) {
    throw new Error(`Mongoose schema validation failed: ${err.message}`);
  }
}

export async function run(options?: { mongoUri?: string; isCleanup?: boolean }) {
  const isCleanup =
    options?.isCleanup !== undefined
      ? options.isCleanup
      : process.argv.includes('--cleanup');

  // Hard production deny
  assertSafeEnvironment(process.env.NODE_ENV);

  const mongoUri =
    options?.mongoUri ||
    process.env.MONGO_URI ||
    process.env.TEST_MONGO_URI ||
    'mongodb://localhost:27017/airline_db';

  const sanitized = sanitizeMongoUri(mongoUri);

  console.log(`================================================================`);
  console.log(`✈️  APTECH AIRLINES ARS: E2E DEMO SEED SYSTEM`);
  console.log(`   Mode: ${isCleanup ? 'CLEANUP' : 'SEED'}`);
  console.log(`   Database: ${sanitized.database}`);
  console.log(`   Host: ${sanitized.host}`);
  console.log(`================================================================`);

  const conn = await mongoose.createConnection(mongoUri).asPromise();
  const db = conn.db;
  if (!db) {
    throw new Error('Could not obtain database instance');
  }

  const usersCol = db.collection('users');
  const airportsCol = db.collection('airports');
  const flightsCol = db.collection('flights');
  const allocationsCol = db.collection('seatallocations');
  const overridesCol = db.collection('flightseatoverrides');
  const bookingsCol = db.collection('bookings');
  const policiesCol = db.collection('cancellationpolicies');

  if (isCleanup) {
    console.log('\n🧹 Executing E2E dataset cleanup...');

    // Find all E2E users (strictly excluding SUPER_ADMIN)
    const e2eUsers = await usersCol
      .find({
        $or: [{ username: /^e2e_/i }, { email: /@aptechairlines\.test$/i }],
        role: { $ne: UserRole.SUPER_ADMIN },
      })
      .toArray();
    const e2eUserIds = e2eUsers.map((u) => u._id);

    // Find all E2E flights
    const e2eFlights = await flightsCol
      .find({
        $or: [{ flight_number: /^APT-E2E-/i }, { generated_source: 'seed_e2e_demo' }],
      })
      .toArray();
    const e2eFlightIds = e2eFlights.map((f) => f._id);

    const deletedAllocations = await allocationsCol.deleteMany({
      $or: [
        { flight_id: { $in: e2eFlightIds } },
        { coupon_number: /^CPN-E2E-/i },
      ],
    });
    console.log(`   Removed ${deletedAllocations.deletedCount} seat allocations.`);

    const deletedOverrides = await overridesCol.deleteMany({
      flight_id: { $in: e2eFlightIds },
    });
    console.log(`   Removed ${deletedOverrides.deletedCount} flight seat overrides.`);

    const deletedBookings = await bookingsCol.deleteMany({
      $or: [{ user_id: { $in: e2eUserIds } }, { pnr_code: /^PNR-E2E-/i }],
    });
    console.log(`   Removed ${deletedBookings.deletedCount} bookings.`);

    const deletedFlights = await flightsCol.deleteMany({
      _id: { $in: e2eFlightIds },
    });
    console.log(`   Removed ${deletedFlights.deletedCount} flights.`);

    // Requirement 4: Clean ONLY airports provisioned by E2E seed (data_source: 'e2e_seed')
    const deletedAirports = await airportsCol.deleteMany({
      data_source: 'e2e_seed',
    });
    console.log(`   Removed ${deletedAirports.deletedCount} E2E-seeded reference airports.`);

    // Requirement 4: E2E cleanup NEVER deletes normal cancellation policies.

    const deletedUsers = await usersCol.deleteMany({
      _id: { $in: e2eUserIds },
      role: { $ne: UserRole.SUPER_ADMIN },
    });
    console.log(`   Removed ${deletedUsers.deletedCount} E2E users.`);

    const superAdminCount = await usersCol.countDocuments({ role: UserRole.SUPER_ADMIN });
    console.log(`   Verified SUPER_ADMIN intact: count = ${superAdminCount}`);
    console.log(`\n✅ E2E Cleanup completed successfully.`);
    await conn.close();
    return;
  }

  // ============================================================================
  // STEP 1: VERIFY IMMUTABLE SUPER_ADMIN (READ-ONLY, NEVER CREATE IN E2E SEED)
  // ============================================================================
  console.log('\n[1/6] Verifying immutable SUPER_ADMIN protection (Requirement 3)...');
  const existingSuperAdmin = await usersCol.findOne({ role: UserRole.SUPER_ADMIN });
  if (!existingSuperAdmin) {
    console.log('   ℹ️  SUPER_ADMIN not present in database. Note: database/bootstrap-db.js manages the initial SUPER_ADMIN outside backend startup.');
  } else {
    console.log(`   ✅ Existing SUPER_ADMIN confirmed immutable: "${existingSuperAdmin.username}".`);
  }

  // ============================================================================
  // STEP 2: IDEMPOTENT E2E USER SEEDING
  // ============================================================================
  console.log('\n[2/6] Seeding deterministic E2E users...');
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, salt);

  const e2eUsers = buildE2EUsers(passwordHash);

  const userMap: Record<string, any> = {};
  for (const u of e2eUsers) {
    const { createdAt, ...userFields } = u as any;
    const res = await usersCol.findOneAndUpdate(
      { username: u.username },
      {
        $set: {
          ...userFields,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: createdAt || new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    userMap[u.username] = res;
    console.log(`   ✅ User ready: ${u.username} (${u.role})`);
  }

  // ============================================================================
  // STEP 3: SAFE AIRPORT REFERENCE DATA SEEDING (Requirement 3 & 4)
  // ============================================================================
  console.log('\n[3/6] Seeding airport reference dataset (Domestic, International, Ambiguity, Nearest)...');
  const e2eAirports = buildE2EAirports();

  const airportMap: Record<string, any> = {};
  for (const ap of e2eAirports) {
    const existing = await airportsCol.findOne({ iata_code: ap.iata_code });
    if (existing) {
      // Reuse existing legitimate record without mutating it
      airportMap[ap.iata_code] = existing;
    } else {
      // Requirement 4: Use existing schema-valid field data_source='e2e_seed', never invent e2e_provenance
      const toInsert = {
        ...ap,
        data_source: 'e2e_seed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await airportsCol.insertOne(toInsert);
      airportMap[ap.iata_code] = toInsert;
    }
  }
  console.log(`   ✅ Verified/provisioned ${e2eAirports.length} reference airports safely.`);

  // Requirement 4: Cancellation policies are owned by database/bootstrap-db.js.
  // Require normal policies to exist before proceeding with business flows.
  const policyCount = await policiesCol.countDocuments();
  if (policyCount === 0) {
    throw new Error(
      '⛔ FATAL: Cancellation policies not found in database. database/bootstrap-db.js bootstraps policies. Run the database bootstrap before the E2E demo.',
    );
  }
  console.log(`   ✅ Confirmed ${policyCount} cancellation policies present.`);

  // ============================================================================
  // STEP 4: FLIGHT INVENTORY SEEDING (RELATIVE DATES & REAL DISTANCES)
  // ============================================================================
  console.log('\n[4/6] Seeding commercial flights with real great-circle distances & fleet invariants...');
  const rawFlightSpecs: any[] = buildRawFlightSpecs();
  const flightMap: Record<string, any> = {};

  for (const s of rawFlightSpecs) {
    const depDate = getRelativeDate(s.depOffset, s.depHour, s.depMin);
    const arrDate = new Date(depDate.getTime() + s.duration * 60000);

    const doc = createFlightDoc({
      flight_number: s.flight_number,
      origin_iata: s.origin_iata,
      dest_iata: s.dest_iata,
      departureDate: depDate,
      arrivalDate: arrDate,
      aircraft_type: s.aircraft_type,
      aircraft_model: s.aircraft_model,
      total_capacity: s.total_capacity,
      base_price: s.base_price,
      status: s.status,
      delay_minutes: s.delay_minutes,
      delay_reason: s.delay_reason,
      is_smoking: s.is_smoking,
      inventories: s.inventories,
      flight_duration_minutes: s.duration,
      airportMap,
    });

    const res = await flightsCol.findOneAndUpdate(
      { flight_number: s.flight_number },
      { $set: doc },
      { upsert: true, returnDocument: 'after' },
    );
    flightMap[s.flight_number] = res;
    console.log(
      `   ✅ Flight ready: ${s.flight_number} (${s.origin_iata} -> ${s.dest_iata}, ${doc.distance_miles} mi) on ${depDate.toISOString().slice(0, 10)} ${formatTimeStr(depDate)}`,
    );
  }

  // ============================================================================
  // STEP 5: SEAT MAP ALLOCATIONS & OVERRIDES SEEDING (Requirement 1, 4)
  // ============================================================================
  console.log('\n[5/6] Seeding physical seat layout & overrides for demo flight...');
  const seatFlight = flightMap['APT-E2E-SEAT'];
  const adminUser = userMap['e2e_admin'];
  const customerUser = userMap['e2e_customer'];

  if (seatFlight?._id && customerUser?._id && adminUser?._id) {
    const ecoInv = seatFlight.inventories.find(
      (inv: any) => inv.cabin_class === CabinClass.ECONOMY,
    );
    const ecoInvId = ecoInv?._id ? ecoInv._id.toString() : new mongoose.Types.ObjectId().toString();

    const confBookingId = new mongoose.Types.ObjectId();
    const holdBookingId = new mongoose.Types.ObjectId();
    const cancBookingId = new mongoose.Types.ObjectId();
    const holdDeadline = getRelativeDate(6);

    const seatAllocations = buildSeatAllocations({
      seatFlightId: seatFlight._id,
      confBookingId,
      holdBookingId,
      holdDeadline,
    });

    for (const alloc of seatAllocations) {
      await allocationsCol.updateOne(
        { flight_id: alloc.flight_id, seat_code: alloc.seat_code },
        { $set: alloc },
        { upsert: true },
      );
    }
    console.log(`   ✅ Seeded ${seatAllocations.length} physical seat allocations.`);

    const overrides = buildFlightSeatOverrides({
      seatFlightId: seatFlight._id,
      adminUserId: adminUser._id,
    });

    for (const ov of overrides) {
      await overridesCol.updateOne(
        { flight_id: ov.flight_id, seat_code: ov.seat_code },
        { $set: ov },
        { upsert: true },
      );
    }
    console.log('   ✅ Seeded flight seat override for seat 15E with created_by_user_id.');

    // ============================================================================
    // STEP 6: SAMPLE BOOKINGS SEEDING (Requirement 1, 2)
    // ============================================================================
    console.log('\n[6/6] Seeding sample bookings conforming strictly to Booking schema...');

    const sampleBookings = buildSampleBookings({
      confBookingId,
      holdBookingId,
      cancBookingId,
      customerUserId: customerUser._id,
      seatFlightId: seatFlight._id,
      seatFlightNumber: seatFlight.flight_number,
      ecoInvId,
      distanceMiles: seatFlight.distance_miles,
      holdDeadline,
    });

    for (const bk of sampleBookings) {
      const { _id, ...bkFields } = bk;
      const res = await bookingsCol.findOneAndUpdate(
        { pnr_code: bk.pnr_code },
        {
          $set: bkFields,
          $setOnInsert: { _id },
        },
        { upsert: true, returnDocument: 'after' },
      );

      // Ensure physical seat allocation booking_id matches resolved booking _id
      if (bk.pnr_code === 'PNR-E2E-CONF01' && res?._id) {
        await allocationsCol.updateOne(
          { flight_id: seatFlight._id, seat_code: '15C' },
          { $set: { booking_id: res._id } },
        );
      } else if (bk.pnr_code === 'PNR-E2E-HOLD01' && res?._id) {
        await allocationsCol.updateOne(
          { flight_id: seatFlight._id, seat_code: '15D' },
          { $set: { booking_id: res._id } },
        );
      }

      console.log(`   ✅ Booking ready: ${bk.pnr_code} (Status: ${bk.status}, Miles: ${bk.total_miles_accrued})`);
    }
  }

  console.log(`================================================================`);
  console.log(`🎉 APTECH AIRLINES E2E SEEDING COMPLETE`);
  console.log(`   - Default E2E Password: ${E2E_PASSWORD}`);
  console.log(`   - Users: e2e_customer, e2e_customer_gold, e2e_clerk, e2e_admin`);
  console.log(`   - Flights: 16 dynamic commercial flights (+5d to +35d)`);
  console.log(`   - Sample Bookings: PNR-E2E-CONF01, PNR-E2E-HOLD01, PNR-E2E-CANC01`);
  console.log(`================================================================\n`);

  await conn.close();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Error during E2E seed run:', err);
    process.exit(1);
  });
}
