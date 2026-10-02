#!/usr/bin/env node
'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const uri = readArg('--uri') || process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/airline_db';
const demoMode = process.argv.includes('--demo');
const dbName = readArg('--db') || (() => {
  try {
    const parsed = new URL(uri);
    return parsed.pathname.replace(/^\//, '') || 'airline_db';
  } catch {
    return 'airline_db';
  }
})();

const airports = [
  ['HAN', 'Ha Noi', 'Noi Bai International Airport', true, '', 0, 'Asia/Ho_Chi_Minh'],
  ['SGN', 'Ho Chi Minh', 'Tan Son Nhat International Airport', true, '', 0, 'Asia/Ho_Chi_Minh'],
  ['DAD', 'Da Nang', 'Da Nang International Airport', true, '', 0, 'Asia/Ho_Chi_Minh'],
  ['CXR', 'Nha Trang', 'Cam Ranh International Airport', true, '', 0, 'Asia/Ho_Chi_Minh'],
  ['PQC', 'Phu Quoc', 'Phu Quoc International Airport', true, '', 0, 'Asia/Ho_Chi_Minh'],
  ['HOI', 'Hoi An', 'Hoi An Town Heliport', false, 'DAD', 30, 'Asia/Ho_Chi_Minh'],
  ['SIN', 'Singapore', 'Changi', true, '', 0, 'Asia/Singapore'],
  ['BKK', 'Bangkok', 'Suvarnabhumi', true, '', 0, 'Asia/Bangkok'],
  ['KUL', 'Kuala Lumpur', 'KLIA', true, '', 0, 'Asia/Kuala_Lumpur'],
  ['NRT', 'Tokyo', 'Narita', true, '', 0, 'Asia/Tokyo'],
  ['ICN', 'Seoul', 'Incheon', true, '', 0, 'Asia/Seoul'],
  ['HKG', 'Hong Kong', 'HK Intl', true, '', 0, 'Asia/Hong_Kong'],
  ['PVG', 'Shanghai', 'Pudong', false, 'HKG', 1220, 'Asia/Shanghai'],
  ['TPE', 'Taipei', 'Taoyuan', true, '', 0, 'Asia/Taipei'],
  ['MNL', 'Manila', 'Ninoy Aquino', false, 'HKG', 1110, 'Asia/Manila'],
  ['CGK', 'Jakarta', 'Soekarno-Hatta', false, 'SIN', 880, 'Asia/Jakarta'],
  ['DEL', 'Delhi', 'Indira Gandhi', false, 'BKK', 2920, 'Asia/Kolkata'],
  ['DXB', 'Dubai', 'Dubai Intl', false, 'SIN', 5800, 'Asia/Dubai'],
  ['DOH', 'Doha', 'Hamad Intl', false, 'SIN', 5800, 'Asia/Qatar'],
  ['LHR', 'London', 'Heathrow', true, '', 0, 'Europe/London'],
  ['CDG', 'Paris', 'Charles de Gaulle', true, '', 0, 'Europe/Paris'],
  ['FRA', 'Frankfurt', 'Frankfurt am Main', false, 'CDG', 450, 'Europe/Berlin'],
  ['SYD', 'Sydney', 'Kingsford Smith', true, '', 0, 'Australia/Sydney'],
  ['MEL', 'Melbourne', 'Tullamarine', true, '', 0, 'Australia/Melbourne'],
  ['LAX', 'Los Angeles', 'LAX', true, '', 0, 'America/Los_Angeles'],
  ['SFO', 'San Francisco', 'San Francisco International', true, '', 0, 'America/Los_Angeles'],
  ['JFK', 'New York', 'JFK', true, '', 0, 'America/New_York'],
].map(([iata_code, city_name, airport_name, is_serviced_directly, nearest_airport_code, distance_to_nearest_km, time_zone]) => ({
  iata_code,
  city_name,
  airport_name,
  is_serviced_directly,
  nearest_airport_code,
  distance_to_nearest_km,
  time_zone,
  data_source: 'bootstrap',
}));

const policies = [
  [30, null, 90, 'Hủy trước ngày khởi hành trên 30 ngày: hoàn 90% giá vé', 'Cancel > 30 days before departure: 90% refund'],
  [15, 29, 75, 'Hủy từ 15 đến 29 ngày trước ngày bay: hoàn 75% giá vé', 'Cancel 15-29 days before departure: 75% refund'],
  [7, 14, 50, 'Hủy từ 7 đến 14 ngày trước ngày bay: hoàn 50% giá vé', 'Cancel 7-14 days before departure: 50% refund'],
  [0, 6, 0, 'Hủy trong vòng 6 ngày trước ngày bay: không hoàn tiền (0%)', 'Cancel within 6 days of departure: no refund (0%)'],
].map(([min_days_before, max_days_before, refund_percentage, description, description_en]) => ({
  min_days_before,
  max_days_before,
  refund_percentage,
  description,
  description_en,
}));

const DEMO_PASSWORD = 'DemoPass@2026';
const DEMO_SOURCE = 'database_bootstrap_demo';
const airportCoordinates = {
  HAN: [21.2212, 105.8072],
  SGN: [10.8188, 106.6519],
  DAD: [16.0439, 108.1994],
  PQC: [10.1698, 103.9931],
  SIN: [1.3644, 103.9915],
  NRT: [35.7647, 140.3863],
  LAX: [33.9416, -118.4085],
};

function vnTodayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function targetDateParts(daysOffset) {
  const today = vnTodayParts();
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + daysOffset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function dateKey(daysOffset) {
  const date = targetDateParts(daysOffset);
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function localWallTime(daysOffset, hour, minute = 0, utcOffsetHours = 7) {
  const date = targetDateParts(daysOffset);
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, hour - utcOffsetHours, minute),
  );
}

function greatCircleMiles(origin, destination) {
  const from = airportCoordinates[origin];
  const to = airportCoordinates[destination];
  if (!from || !to) return 0;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(to[0] - from[0]);
  const dLon = radians(to[1] - from[1]);
  const lat1 = radians(from[0]);
  const lat2 = radians(to[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function demoInventory(cabinClass, allocatedSeats, availableSeats, basePrice) {
  return {
    _id: new ObjectId(),
    cabin_class: cabinClass,
    is_smoking: false,
    bucket_code: 'Y',
    base_price: basePrice,
    allocated_seats: allocatedSeats,
    available_seats: availableSeats,
    saga_markers: [],
  };
}

function buildDemoFlight(spec) {
  const departure = localWallTime(
    spec.days,
    spec.hour,
    spec.minute || 0,
    spec.originOffset ?? 7,
  );
  const arrival = new Date(departure.getTime() + spec.duration * 60_000);
  return {
    flight_number: spec.flightNumber,
    origin_iata: spec.origin,
    dest_iata: spec.destination,
    departure_date: dateKey(spec.days),
    scheduled_departure: departure,
    scheduled_arrival: arrival,
    duration_minutes: spec.duration,
    distance_miles: greatCircleMiles(spec.origin, spec.destination),
    status: 'SCHEDULED',
    delay_reason: '',
    delay_minutes: 0,
    aircraft: {
      model_code: spec.aircraft,
      model_name: spec.aircraftName,
      total_capacity: spec.capacity,
    },
    inventories: spec.inventories(),
    is_generated: true,
    generated_source: DEMO_SOURCE,
    operator: 'APTECH_AIRLINES',
    is_bookable: true,
    data_source: 'AIRLABS_COMMERCIALIZED',
    source_type: 'DEMO_BOOTSTRAP',
    source_route_key: `${spec.origin}-${spec.destination}`,
    source_service_key: spec.flightNumber,
    source_airline_iata: 'APT',
    source_flight_number: spec.flightNumber.replace(/^APT-/, ''),
    source_duration_minutes: spec.duration,
    source_synced_at: new Date(),
    updatedAt: new Date(),
  };
}

async function seedDemoData(db) {
  const users = db.collection('users');
  const flights = db.collection('flights');
  const bookings = db.collection('bookings');
  const allocations = db.collection('seatallocations');

  await flights.createIndex({ flight_number: 1, departure_date: 1 });
  await flights.createIndex({ origin_iata: 1, dest_iata: 1, departure_date: 1, status: 1 });
  await flights.createIndex({ data_source: 1, operator: 1, is_bookable: 1, status: 1 });
  await bookings.createIndex({ pnr_code: 1 }, { unique: true });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const demoUsers = [
    {
      username: 'demo_customer',
      email: 'demo_customer@aptechairlines.test',
      first_name: 'Demo',
      last_name: 'Customer',
      phone_number: '+84901234567',
      role: 'CUSTOMER',
      sky_miles: 5000,
      preferred_credit_card: '4111222233334444',
    },
    {
      username: 'demo_clerk',
      email: 'demo_clerk@aptechairlines.test',
      first_name: 'Demo',
      last_name: 'Clerk',
      phone_number: '+84902345678',
      role: 'CLERK',
      sky_miles: 0,
      preferred_credit_card: '4111222233335555',
    },
    {
      username: 'demo_admin',
      email: 'demo_admin@aptechairlines.test',
      first_name: 'Demo',
      last_name: 'Admin',
      phone_number: '+84903456789',
      role: 'ADMIN',
      sky_miles: 0,
      preferred_credit_card: '4111222233336666',
    },
  ];

  for (const user of demoUsers) {
    await users.updateOne(
      { username: user.username },
      {
        $set: {
          ...user,
          password_hash: passwordHash,
          address: 'Aptech Airlines demo environment',
          sex: 'OTHER',
          age: 30,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const a20n = () => [
    demoInventory('BUSINESS', 12, 12, 3_800_000),
    demoInventory('ECONOMY', 168, 168, 1_800_000),
  ];
  const a21n = () => [
    demoInventory('BUSINESS', 16, 16, 4_200_000),
    demoInventory('ECONOMY', 188, 188, 1_350_000),
  ];
  const b789 = () => [
    demoInventory('BUSINESS', 28, 28, 13_500_000),
    demoInventory('CLUB', 35, 35, 9_200_000),
    demoInventory('ECONOMY', 231, 231, 6_500_000),
  ];
  const atr = () => [demoInventory('ECONOMY', 68, 68, 1_250_000)];

  const specs = [
    { flightNumber: 'APT-DMO-BUY', origin: 'SGN', destination: 'HAN', days: 5, hour: 8, duration: 135, aircraft: 'A20N', aircraftName: 'Airbus A320neo', capacity: 180, inventories: a20n },
    { flightNumber: 'APT-DMO-HLD', origin: 'SGN', destination: 'HAN', days: 20, hour: 8, duration: 135, aircraft: 'A20N', aircraftName: 'Airbus A320neo', capacity: 180, inventories: a20n },
    { flightNumber: 'APT-DMO-ALT', origin: 'SGN', destination: 'HAN', days: 20, hour: 18, minute: 30, duration: 135, aircraft: 'A21N', aircraftName: 'Airbus A321neo', capacity: 204, inventories: a21n },
    { flightNumber: 'APT-DMO-RET', origin: 'HAN', destination: 'SGN', days: 25, hour: 14, duration: 135, aircraft: 'A20N', aircraftName: 'Airbus A320neo', capacity: 180, inventories: a20n },
    { flightNumber: 'APT-DMO-C01', origin: 'HAN', destination: 'DAD', days: 20, hour: 7, duration: 80, aircraft: 'A20N', aircraftName: 'Airbus A320neo', capacity: 180, inventories: a20n },
    { flightNumber: 'APT-DMO-C02', origin: 'DAD', destination: 'PQC', days: 20, hour: 10, minute: 30, duration: 90, aircraft: 'AT76', aircraftName: 'ATR 72-600', capacity: 68, inventories: atr },
    { flightNumber: 'APT-DMO-SIN', origin: 'SGN', destination: 'SIN', days: 20, hour: 6, duration: 130, aircraft: 'A21N', aircraftName: 'Airbus A321neo', capacity: 204, inventories: a21n },
    { flightNumber: 'APT-DMO-LAX', origin: 'SIN', destination: 'LAX', days: 20, hour: 11, duration: 960, originOffset: 8, aircraft: 'B789', aircraftName: 'Boeing 787-9 Dreamliner', capacity: 294, inventories: b789 },
    { flightNumber: 'APT-DMO-NRT', origin: 'SGN', destination: 'NRT', days: 20, hour: 6, duration: 330, aircraft: 'B789', aircraftName: 'Boeing 787-9 Dreamliner', capacity: 294, inventories: b789 },
    { flightNumber: 'APT-DMO-REF90', origin: 'SGN', destination: 'DAD', days: 35, hour: 9, duration: 80, aircraft: 'A20N', aircraftName: 'Airbus A320neo', capacity: 180, inventories: a20n },
    {
      flightNumber: 'APT-DMO-SEAT',
      origin: 'SGN',
      destination: 'HAN',
      days: 20,
      hour: 10,
      duration: 135,
      aircraft: 'A20N',
      aircraftName: 'Airbus A320neo',
      capacity: 180,
      inventories: () => [
        demoInventory('BUSINESS', 12, 12, 3_800_000),
        demoInventory('ECONOMY', 168, 166, 1_800_000),
      ],
    },
  ];

  const flightMap = new Map();
  for (const spec of specs) {
    const doc = buildDemoFlight(spec);
    const flight = await flights.findOneAndUpdate(
      { flight_number: spec.flightNumber },
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    flightMap.set(spec.flightNumber, flight);
  }

  const customer = await users.findOne({ username: 'demo_customer' });
  const seatFlight = flightMap.get('APT-DMO-SEAT');
  if (customer && seatFlight) {
    const economy = seatFlight.inventories.find((item) => item.cabin_class === 'ECONOMY');
    const commonPassenger = {
      first_name: 'Demo',
      last_name: 'Customer',
      passenger_type: 'ADULT',
      id_card_or_passport: 'DEMO0001',
      nationality: 'Vietnamese',
      date_of_birth: new Date('1996-05-15'),
    };

    const confirmed = await bookings.findOneAndUpdate(
      { pnr_code: 'PNR-DEMO-CONF01' },
      {
        $set: {
          user_id: customer._id,
          confirmation_number: 'CNF-DEMO-001',
          status: 'CONFIRMED',
          booking_type: 'ONE_WAY',
          passengers: [commonPassenger],
          ticket_coupons: [{
            coupon_number: 'CPN-DEMO-001',
            passenger_name: 'Demo Customer',
            flight_id: seatFlight._id,
            flight_number: seatFlight.flight_number,
            inventory_id: economy._id.toString(),
            cabin_class: 'ECONOMY',
            is_smoking: false,
            fare_paid: 1_800_000,
            seat_code: '15C',
            seat_selection_type: 'CHOOSE',
            seat_fee: 50_000,
            seat_fee_currency: 'VND',
            leg_type: 'OUTBOUND',
            coupon_status: 'ACTIVE',
          }],
          total_fare: 1_800_000,
          total_seat_fees: 50_000,
          total_amount: 1_850_000,
          total_miles_accrued: seatFlight.distance_miles,
          payment_transactions: [{
            payment_reference: 'AUTH-DEMO-001',
            transaction_type: 'PAYMENT',
            payment_method: 'PROFILE_CARD',
            amount: 1_850_000,
            currency: 'VND',
            status: 'SUCCESS',
            card_masked: '•••• •••• •••• 4444',
            created_at: new Date(),
          }],
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const holdDeadline = localWallTime(6, 8);
    const blocked = await bookings.findOneAndUpdate(
      { pnr_code: 'PNR-DEMO-HOLD01' },
      {
        $set: {
          user_id: customer._id,
          blocking_number: 'BLK-DEMO-001',
          status: 'BLOCKED',
          booking_type: 'ONE_WAY',
          time_limit_deadline: holdDeadline,
          is_reminder_sent: false,
          passengers: [{ ...commonPassenger, first_name: 'Hold' }],
          ticket_coupons: [{
            coupon_number: 'CPN-DEMO-002',
            passenger_name: 'Hold Customer',
            flight_id: seatFlight._id,
            flight_number: seatFlight.flight_number,
            inventory_id: economy._id.toString(),
            cabin_class: 'ECONOMY',
            is_smoking: false,
            fare_paid: 1_800_000,
            seat_code: '15D',
            seat_selection_type: 'CHOOSE',
            seat_fee: 0,
            seat_fee_currency: 'VND',
            leg_type: 'OUTBOUND',
            coupon_status: 'ACTIVE',
          }],
          total_fare: 1_800_000,
          total_seat_fees: 0,
          total_amount: 1_800_000,
          total_miles_accrued: 0,
          payment_transactions: [],
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    );

    await allocations.updateOne(
      { flight_id: seatFlight._id, seat_code: '15C' },
      {
        $set: {
          status: 'CONFIRMED',
          cabin_class: 'ECONOMY',
          booking_id: confirmed._id,
          coupon_number: 'CPN-DEMO-001',
          passenger_name: 'Demo Customer',
          seat_selection_type: 'CHOOSE',
          passenger_index: 0,
          seat_fee: 50_000,
          seat_fee_currency: 'VND',
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    await allocations.updateOne(
      { flight_id: seatFlight._id, seat_code: '15D' },
      {
        $set: {
          status: 'HELD',
          cabin_class: 'ECONOMY',
          booking_id: blocked._id,
          coupon_number: 'CPN-DEMO-002',
          passenger_name: 'Hold Customer',
          seat_selection_type: 'CHOOSE',
          passenger_index: 0,
          seat_fee: 0,
          seat_fee_currency: 'VND',
          held_until: holdDeadline,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  console.log(`Demo data ready: ${specs.length} customer-bookable commercial flights.`);
  console.log(`Demo login: demo_customer / demo_clerk / demo_admin (password: ${DEMO_PASSWORD}).`);
  console.log('Demo bookings: PNR-DEMO-CONF01 and PNR-DEMO-HOLD01.');
}

async function seedReferenceData(db) {
  const now = new Date();
  const airportCollection = db.collection('airports');
  const policyCollection = db.collection('cancellationpolicies');

  await airportCollection.createIndex({ iata_code: 1 }, { unique: true });
  await airportCollection.createIndex({ city_name: 1 });
  await airportCollection.createIndex({ city_name: 1, is_serviced_directly: 1 });
  await airportCollection.createIndex({ is_serviced_directly: 1 });
  await airportCollection.createIndex({ country_code: 1 });

  for (const airport of airports) {
    await airportCollection.updateOne(
      { iata_code: airport.iata_code },
      {
        $setOnInsert: { ...airport, createdAt: now },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
  }

  for (const policy of policies) {
    await policyCollection.updateOne(
      { min_days_before: policy.min_days_before, max_days_before: policy.max_days_before },
      {
        $setOnInsert: { ...policy, createdAt: now },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
  }

  console.log(`Reference data ready: ${airports.length} airports, ${policies.length} cancellation policies.`);
}

async function ensureSuperAdmin(db) {
  const users = db.collection('users');
  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex({ email: 1 }, { unique: true });

  const existing = await users.findOne({ role: 'SUPER_ADMIN' });
  if (existing) {
    console.log(`SUPER_ADMIN already exists: ${existing.username}. No credential changes were made.`);
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log('\nNo SUPER_ADMIN exists. Create the initial database-owned administrator.');
    const username = (await rl.question('Username [superadmin]: ')).trim() || 'superadmin';
    const email = (await rl.question('Email [superadmin@airline.local]: ')).trim().toLowerCase() || 'superadmin@airline.local';
    const firstName = (await rl.question('First name [System]: ')).trim() || 'System';
    const lastName = (await rl.question('Last name [SuperAdmin]: ')).trim() || 'SuperAdmin';
    const password = await rl.question('Password (minimum 8 characters): ');

    if (password.length < 8) {
      throw new Error('SUPER_ADMIN password must contain at least 8 characters.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await users.insertOne({
      username,
      password_hash: passwordHash,
      first_name: firstName,
      last_name: lastName,
      address: '',
      phone_number: '',
      email,
      sex: 'OTHER',
      age: 0,
      preferred_credit_card: '',
      sky_miles: 0,
      role: 'SUPER_ADMIN',
      createdAt: now,
      updatedAt: now,
    });

    console.log(`SUPER_ADMIN created in MongoDB: ${username}`);
  } finally {
    rl.close();
  }
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`Connected to MongoDB database: ${dbName}`);
    await seedReferenceData(db);
    await ensureSuperAdmin(db);
    if (demoMode) {
      await seedDemoData(db);
    }
    console.log('\nDatabase bootstrap completed successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Database bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});
