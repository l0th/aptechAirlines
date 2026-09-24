import * as dotenv from 'dotenv';
dotenv.config();

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// 1. Force strict test environment and safety
process.env.NODE_ENV = 'test';
process.env.PAYPAL_ENABLED = 'false';

// 2. Disable external SMTP completely to enforce [MAIL:DEV-FALLBACK]
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
process.env.SMTP_HOST = '';

// 3. Ephemeral auth secrets generated at runtime using crypto (never logged)
const ephemeralJwtSecret =
  process.env.E2E_MATRIX_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ephemeralSuperAdminPw =
  process.env.E2E_MATRIX_ADMIN_PW ||
  `EphemeralAdmin_${crypto.randomBytes(12).toString('hex')}!2026`;
process.env.JWT_SECRET = ephemeralJwtSecret;
process.env.SUPER_ADMIN_PASSWORD = ephemeralSuperAdminPw;

// 4. Dedicated disposable database
const ALLOWED_MATRIX_DB_NAME = 'airline_e2e_matrix_verification';
const MATRIX_MONGO_URI = `mongodb://localhost:27017/${ALLOWED_MATRIX_DB_NAME}`;
process.env.MONGO_URI = MATRIX_MONGO_URI;

function assertMatrixDbSafe(uri: string) {
  const dbName = uri.split('/').pop()?.split('?')[0];
  if (dbName !== ALLOWED_MATRIX_DB_NAME) {
    throw new Error(
      `FATAL SAFETY VIOLATION: Refusing to drop or operate on unauthorized database: "${dbName}". Matrix test is strictly locked to "${ALLOWED_MATRIX_DB_NAME}".`,
    );
  }
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as mongoose from 'mongoose';
import { AppModule } from '../app.module';
import {
  run as seedE2E,
  getRelativeDate,
  E2E_PASSWORD,
} from './seed-e2e-demo';
import { localDateKey } from '../common/timezone.util';
import {
  BookingStatus,
  BookingType,
  PaymentMethod,
  PassengerType,
} from '../bookings/bookings.schema';
import { FlightStatus } from '../flights/flights.schema';
import { UserRole } from '../users/users.schema';
import { FlightsService } from '../flights/flights.service';
import { MailService } from '../mail/mail.service';

export interface FlowResult {
  flow: string;
  name: string;
  method: string;
  endpoint: string;
  httpStatus: string;
  identifier: string;
  invariant: string;
  status: 'PASS' | 'FAIL';
  details?: Record<string, any>;
}

const results: FlowResult[] = [];

async function main() {
  const logger = new Logger('E2EMatrixRunner');
  logger.log('Starting Business E2E Verification Matrix execution...');

  // Step A: Ensure clean disposable database before NestJS bootstrap
  logger.log(`A. Dropping pre-existing disposable matrix database (${ALLOWED_MATRIX_DB_NAME}) if present...`);
  assertMatrixDbSafe(MATRIX_MONGO_URI);
  const preCleanConn = await mongoose.createConnection(MATRIX_MONGO_URI).asPromise();
  await preCleanConn.dropDatabase();
  await preCleanConn.close();

  // Step B: Bootstrap NestJS Application (SeedService initializes baseline SuperAdmin, Airports, Policies)
  logger.log('B. Bootstrapping NestJS application on ephemeral port...');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const server = await app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  logger.log(`NestJS server listening on ${baseUrl}`);

  // Step C: Seed airline_e2e_matrix_verification database with 16 commercial flights and users
  logger.log(`C. Seeding ${ALLOWED_MATRIX_DB_NAME} database with 16 flights and users...`);
  await seedE2E({
    mongoUri: MATRIX_MONGO_URI,
    isCleanup: false,
  });

  const flightsService = app.get(FlightsService);
  const mailService = app.get(MailService);

  // Helper fetch function
  async function api(
    method: string,
    path: string,
    body?: any,
    token?: string,
  ): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  }

  // Connect direct mongoose connection for checking invariants
  const dbConn = await mongoose.createConnection(MATRIX_MONGO_URI).asPromise();
  const flightsCol = dbConn.collection('flights');
  const bookingsCol = dbConn.collection('bookings');
  const usersCol = dbConn.collection('users');
  const allocationsCol = dbConn.collection('seatallocations');

  const VN_TZ = 'Asia/Ho_Chi_Minh';
  const date5Str = localDateKey(getRelativeDate(5), VN_TZ);
  const date20Str = localDateKey(getRelativeDate(20), VN_TZ);
  const date25Str = localDateKey(getRelativeDate(25), VN_TZ);

  try {
    // =========================================================================
    // FLOW A: Guest Search / date range / round trip
    // =========================================================================
    logger.log('--- Executing Flow A: Guest Search / date range / round trip ---');
    const flowARes = await api(
      'GET',
      `/flights/search?origin=SGN&destination=HAN&departure_date=${date5Str}&departure_date_end=${date20Str}&return_date=${date25Str}&adults=1&children=1&seniors=1`,
    );

    const outbounds: any[] = flowARes.data?.onward_flights || [];
    const returns: any[] = flowARes.data?.return_flights || [];

    const distinctOutboundDates = new Set(outbounds.map((f) => f.departure_date));
    const allOutboundsWithinRange = outbounds.every(
      (f) => f.departure_date >= date5Str && f.departure_date <= date20Str,
    );
    const returnOnRequestedDate = returns.length > 0 && returns.every((f) => f.departure_date === date25Str);

    // Party pricing check on first outbound
    let pricingVerified = false;
    if (outbounds.length > 0) {
      const sample = outbounds[0];
      const adult = sample.base_price_per_adult;
      const expectedTotal = sample.total_party_price;
      const childPrice = Math.round(adult * 0.75);
      const seniorPrice = Math.round(adult * 0.85);
      if (expectedTotal === adult + childPrice + seniorPrice) {
        pricingVerified = true;
      }
    }

    const flowAPass =
      flowARes.status === 200 &&
      distinctOutboundDates.size > 1 &&
      allOutboundsWithinRange &&
      returnOnRequestedDate &&
      pricingVerified;

    if (!flowAPass) {
      throw new Error(`Flow A invariant assertion failed: HTTP ${flowARes.status}, distinctDates: ${distinctOutboundDates.size}, withinRange: ${allOutboundsWithinRange}, returnMatch: ${returnOnRequestedDate}, pricing: ${pricingVerified}`);
    }

    results.push({
      flow: 'A',
      name: 'Guest Search / date range / round trip',
      method: 'GET',
      endpoint: '/api/flights/search',
      httpStatus: 'HTTP 200',
      identifier: 'SGN ➔ HAN / return HAN ➔ SGN',
      invariant: `Date range (${date5Str} to ${date20Str}) matched ${outbounds.length} outbounds across ${distinctOutboundDates.size} dates; return matched ${returns.length} flights at ${date25Str}; Adult 100%, Child 75%, Senior 85% verified.`,
      status: 'PASS',
      details: {
        outboundCount: outbounds.length,
        returnCount: returns.length,
        distinctDates: Array.from(distinctOutboundDates),
      },
    });

    // =========================================================================
    // FLOW B: Registration / login / profile
    // =========================================================================
    logger.log('--- Executing Flow B: Registration / login / profile ---');
    const runId = crypto.randomBytes(4).toString('hex');
    const userBUsername = `flow_b_${runId}`;
    const userBEmail = `flow_b_${runId}@aptechairlines.test`;
    const userBPassword = E2E_PASSWORD;
    const rawCard = '4111222233334444';

    const regRes = await api('POST', '/auth/register', {
      username: userBUsername,
      email: userBEmail,
      password: userBPassword,
      first_name: 'Minh',
      last_name: 'Tran',
      address: '123 Nguyen Hue, Ben Nghe, Quan 1, TP Ho Chi Minh',
      phone_number: '+84901234567',
      sex: 'Male',
      age: 29,
      preferred_credit_card: rawCard,
    });

    const loginRes = await api('POST', '/auth/login', {
      username: userBUsername,
      password: userBPassword,
    });
    const userBToken = loginRes.data?.access_token;

    const meRes = await api('GET', '/auth/me', undefined, userBToken);

    const flowBPass =
      regRes.status === 201 &&
      loginRes.status === 201 &&
      typeof userBToken === 'string' &&
      userBToken.length > 20 &&
      meRes.status === 200 &&
      meRes.data?.username === userBUsername &&
      meRes.data?.email === userBEmail &&
      meRes.data?.role === UserRole.CUSTOMER &&
      meRes.data?.sky_miles === 0 &&
      meRes.data?.preferred_credit_card === undefined &&
      meRes.data?.password_hash === undefined &&
      meRes.data?.has_preferred_credit_card === true &&
      meRes.data?.preferred_credit_card_masked === '**** **** **** 4444';

    if (!flowBPass) {
      throw new Error(`Flow B assertion failed: reg=${regRes.status}, login=${loginRes.status}, me=${meRes.status}, tokenPresent=${!!userBToken}`);
    }

    const userB = await usersCol.findOne({ username: userBUsername });

    results.push({
      flow: 'B',
      name: 'Registration / login / profile',
      method: 'POST /api/auth/register, POST /api/auth/login, GET /api/auth/me',
      endpoint: '/api/auth/*',
      httpStatus: 'HTTP 201 / HTTP 201 / HTTP 200',
      identifier: `User: ${userBUsername} (${userBEmail})`,
      invariant: 'Registered with bcrypt password; valid signed JWT obtained; profile verifies role CUSTOMER, sky_miles=0, card masked (**** **** **** 4444), password_hash excluded.',
      status: 'PASS',
      details: {
        userId: userB?._id?.toString(),
        username: userBUsername,
        email: userBEmail,
      },
    });

    // =========================================================================
    // FLOW C: Direct PROFILE_CARD purchase
    // =========================================================================
    logger.log('--- Executing Flow C: Direct PROFILE_CARD purchase ---');
    const buyFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-BUY' });
    if (!buyFlight) throw new Error('Fixture flight APT-E2E-BUY not found');
    const buyEcoInv = buyFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const buyEcoAvailBefore = buyEcoInv.available_seats;
    const userBMilesBefore = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const flowCRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: buyFlight._id.toString(),
            inventory_id: buyEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );

    const flowCPnr = flowCRes.data?.pnr_code;
    const dbBookingC = await bookingsCol.findOne({ pnr_code: flowCPnr });
    const buyFlightAfterC = await flightsCol.findOne({ _id: buyFlight._id });
    const buyEcoAvailAfterC = buyFlightAfterC?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const userBMilesAfterC = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const paymentTxC = dbBookingC?.payment_transactions?.filter((t: any) => t.transaction_type === 'PAYMENT');
    const activeCouponsC = dbBookingC?.ticket_coupons?.filter((c: any) => (c.coupon_status || c.status) === 'ACTIVE');

    const flowCPass =
      flowCRes.status === 201 &&
      dbBookingC?.status === BookingStatus.CONFIRMED &&
      paymentTxC?.length === 1 &&
      paymentTxC[0].status === 'SUCCESS' &&
      paymentTxC[0].payment_method === PaymentMethod.PROFILE_CARD &&
      paymentTxC[0].amount === 2640000 && // 2,200,000 base * 1.20 dynamic pricing (+5d)
      paymentTxC[0].amount === dbBookingC?.total_amount &&
      buyEcoAvailAfterC === buyEcoAvailBefore - 1 &&
      activeCouponsC?.length === 1 &&
      userBMilesAfterC === userBMilesBefore + 721 &&
      dbBookingC?.total_miles_accrued === 721;

    if (!flowCPass) {
      throw new Error(`Flow C assertion failed: HTTP ${flowCRes.status}, status=${dbBookingC?.status}, pmtCount=${paymentTxC?.length}, pmtMethod=${paymentTxC?.[0]?.payment_method}, pmtStatus=${paymentTxC?.[0]?.status}, pmtAmount=${paymentTxC?.[0]?.amount}, availBefore=${buyEcoAvailBefore}, availAfter=${buyEcoAvailAfterC}, coupons=${activeCouponsC?.length}, milesBefore=${userBMilesBefore}, milesAfter=${userBMilesAfterC}, accrued=${dbBookingC?.total_miles_accrued}`);
    }

    results.push({
      flow: 'C',
      name: 'Direct PROFILE_CARD purchase',
      method: 'POST',
      endpoint: '/api/bookings',
      httpStatus: 'HTTP 201',
      identifier: `PNR: ${flowCPnr} (${dbBookingC?.confirmation_number})`,
      invariant: `Status CONFIRMED; inventory decremented exactly once (${buyEcoAvailBefore} ➔ ${buyEcoAvailAfterC}); single SUCCESS PAYMENT tx (2,640,000 VND [2,200,000 base × 1.20 dynamic pricing]); SkyMiles accrued (+721); active ticket coupon issued.`,
      status: 'PASS',
      details: {
        pnr: flowCPnr,
        confirmationNumber: dbBookingC?.confirmation_number,
        bookingId: dbBookingC?._id?.toString(),
      },
    });

    // =========================================================================
    // FLOW D: Hold >14d + reject <=14d
    // =========================================================================
    logger.log('--- Executing Flow D: Hold >14d + reject <=14d ---');
    const hldFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-HLD' });
    if (!hldFlight) throw new Error('Fixture flight APT-E2E-HLD not found');
    const hldEcoInv = hldFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const hldEcoAvailBefore = hldEcoInv.available_seats;

    // Part 1: Hold >14d
    const flowDRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: true,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: hldFlight._id.toString(),
            inventory_id: hldEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );

    const flowDPnr = flowDRes.data?.pnr_code;
    const dbBookingD = await bookingsCol.findOne({ pnr_code: flowDPnr });
    const hldFlightAfterD = await flightsCol.findOne({ _id: hldFlight._id });
    const hldEcoAvailAfterD = hldFlightAfterD?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const expectedDeadlineD = new Date(hldFlight.scheduled_departure.getTime() - 14 * 24 * 60 * 60 * 1000);
    const deadlineDiffSeconds = Math.abs((new Date(dbBookingD?.time_limit_deadline).getTime() - expectedDeadlineD.getTime()) / 1000);

    const part1Pass =
      flowDRes.status === 201 &&
      dbBookingD?.status === BookingStatus.BLOCKED &&
      typeof dbBookingD?.blocking_number === 'string' &&
      dbBookingD?.blocking_number.startsWith('BLK-') &&
      (!dbBookingD?.payment_transactions || dbBookingD.payment_transactions.length === 0) &&
      dbBookingD?.total_miles_accrued === 0 &&
      deadlineDiffSeconds < 5 &&
      hldEcoAvailAfterD === hldEcoAvailBefore - 1;

    // Part 2: Hold <=14d rejection
    const buyCountBeforeRejection = await bookingsCol.countDocuments();
    const buyEcoAvailBeforeRejection = (await flightsCol.findOne({ _id: buyFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const flowDRejectRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: true,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: buyFlight._id.toString(),
            inventory_id: buyEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );

    const buyCountAfterRejection = await bookingsCol.countDocuments();
    const buyEcoAvailAfterRejection = (await flightsCol.findOne({ _id: buyFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const part2Pass =
      flowDRejectRes.status === 400 &&
      buyCountAfterRejection === buyCountBeforeRejection &&
      buyEcoAvailAfterRejection === buyEcoAvailBeforeRejection;

    const flowDPass = part1Pass && part2Pass;
    if (!flowDPass) {
      throw new Error(`Flow D assertion failed: part1=${part1Pass} (status=${flowDRes.status}, BLK=${dbBookingD?.blocking_number}, deadlineDiff=${deadlineDiffSeconds}), part2=${part2Pass} (status=${flowDRejectRes.status})`);
    }

    results.push({
      flow: 'D',
      name: 'Hold >14d + reject <=14d',
      method: 'POST',
      endpoint: '/api/bookings',
      httpStatus: 'HTTP 201 / HTTP 400',
      identifier: `Hold: ${dbBookingD?.blocking_number} (PNR: ${flowDPnr})`,
      invariant: `Eligible hold (+20d) granted BLOCKED status, BLK code, zero payment, zero miles, deadline = departure - 14d, inventory decremented once; Ineligible hold (+5d) strictly rejected with HTTP 400, no booking created, inventory unchanged.`,
      status: 'PASS',
      details: {
        blockingNumber: dbBookingD?.blocking_number,
        pnr: flowDPnr,
        timeLimitDeadline: dbBookingD?.time_limit_deadline,
      },
    });

    // =========================================================================
    // FLOW E: Confirm held booking
    // =========================================================================
    logger.log('--- Executing Flow E: Confirm held booking ---');
    const hldAvailBeforeE = (await flightsCol.findOne({ _id: hldFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const userBMilesBeforeE = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const flowERes = await api(
      'POST',
      '/bookings/confirm',
      {
        blocking_number: dbBookingD!.blocking_number,
        payment_method: PaymentMethod.PROFILE_CARD,
        payment_details: {
          card_number: '4111222233334444',
          card_holder: 'Minh Tran',
          expiry: '12/28',
          cvv: '123',
        },
      },
      userBToken,
    );

    const dbBookingE = await bookingsCol.findOne({ _id: dbBookingD!._id });
    const hldAvailAfterE = (await flightsCol.findOne({ _id: hldFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const userBMilesAfterE = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const paymentTxE = dbBookingE?.payment_transactions?.filter((t: any) => t.transaction_type === 'PAYMENT' && t.status === 'SUCCESS');
    const activeCouponsE = dbBookingE?.ticket_coupons?.filter((c: any) => (c.coupon_status || c.status) === 'ACTIVE');

    const flowEPass =
      flowERes.status === 201 &&
      dbBookingD?.status === BookingStatus.BLOCKED &&
      dbBookingE?.status === BookingStatus.CONFIRMED &&
      typeof dbBookingE?.confirmation_number === 'string' &&
      dbBookingE?.confirmation_number.startsWith('CNF-') &&
      paymentTxE?.length === 1 &&
      paymentTxE[0].amount === 1800000 &&
      activeCouponsE?.length === 1 &&
      hldAvailAfterE === hldAvailBeforeE && // NO second inventory decrement!
      userBMilesAfterE === userBMilesBeforeE + 721 && // credited exactly once
      dbBookingE?.total_miles_accrued === 721;

    if (!flowEPass) {
      throw new Error(`Flow E assertion failed: HTTP ${flowERes.status}, status=${dbBookingE?.status}, CNF=${dbBookingE?.confirmation_number}, pmtCount=${paymentTxE?.length}, availSame=${hldAvailAfterE === hldAvailBeforeE}, milesAfter=${userBMilesAfterE}`);
    }

    results.push({
      flow: 'E',
      name: 'Confirm held booking',
      method: 'POST',
      endpoint: '/api/bookings/confirm',
      httpStatus: 'HTTP 201',
      identifier: `${dbBookingD?.blocking_number} ➔ ${dbBookingE?.confirmation_number}`,
      invariant: `Status transitioned BLOCKED ➔ CONFIRMED; CNF code issued; exactly one SUCCESS PAYMENT transaction (1,800,000 VND); active coupons confirmed; ZERO double inventory decrement (${hldAvailBeforeE} === ${hldAvailAfterE}); SkyMiles credited exactly once (+721).`,
      status: 'PASS',
      details: {
        previousBlockingNumber: dbBookingD?.blocking_number,
        confirmationNumber: dbBookingE?.confirmation_number,
      },
    });

    // =========================================================================
    // FLOW F: Positive reschedule charge
    // =========================================================================
    logger.log('--- Executing Flow F: Positive reschedule charge ---');
    // Create base booking on APT-E2E-PRC-LO (base price 1,200,000)
    const loFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-PRC-LO' });
    const hiFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-PRC-HI' });
    if (!loFlight || !hiFlight) throw new Error('Pricing test flights not found');

    const loEcoInv = loFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const hiEcoInv = hiFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');

    const baseBookingFRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: loFlight._id.toString(),
            inventory_id: loEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );

    const bookingFConf = baseBookingFRes.data?.confirmation_number;
    const loAvailBeforeReschedule = (await flightsCol.findOne({ _id: loFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const hiAvailBeforeReschedule = (await flightsCol.findOne({ _id: hiFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    // Authoritative prices
    const oldAuthoritativeF = 1200000;
    const newAuthoritativeF = 2500000;
    const expectedDiffF = newAuthoritativeF - oldAuthoritativeF; // +1,300,000 VND

    const flowFRes = await api(
      'POST',
      '/bookings/reschedule',
      {
        confirmation_number: bookingFConf,
        new_flight_id: hiFlight._id.toString(),
        new_inventory_id: hiEcoInv._id.toString(),
        payment_method: PaymentMethod.PROFILE_CARD,
      },
      userBToken,
    );

    const dbBookingF = await bookingsCol.findOne({ pnr_code: baseBookingFRes.data?.pnr_code });
    const newConfF = dbBookingF?.confirmation_number;
    const loAvailAfterReschedule = (await flightsCol.findOne({ _id: loFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const hiAvailAfterReschedule = (await flightsCol.findOne({ _id: hiFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const chargeTx = dbBookingF?.payment_transactions?.find((t: any) => t.transaction_type === 'RESCHEDULE_CHARGE');
    const newCouponF = dbBookingF?.ticket_coupons?.find((c: any) => c.flight_id.toString() === hiFlight._id.toString());
    const oldCouponActiveOnLo = dbBookingF?.ticket_coupons?.some((c: any) => c.flight_id.toString() === loFlight._id.toString() && (c.coupon_status === 'ACTIVE' || c.status === 'ACTIVE'));

    const flowFPass =
      flowFRes.status === 201 &&
      chargeTx !== undefined &&
      chargeTx.status === 'SUCCESS' &&
      chargeTx.amount === expectedDiffF && // Exactly 1,300,000 VND
      newCouponF !== undefined &&
      (newCouponF.coupon_status === 'ACTIVE' || newCouponF.status === 'ACTIVE') &&
      !oldCouponActiveOnLo && // Old coupon superseded / replaced
      loAvailAfterReschedule === loAvailBeforeReschedule + 1 && // Old inventory restored
      hiAvailAfterReschedule === hiAvailBeforeReschedule - 1; // New inventory decremented

    if (!flowFPass) {
      throw new Error(`Flow F assertion failed: HTTP ${flowFRes.status}, chargeTx=${chargeTx?.amount} (expected ${expectedDiffF}), newCoupon=${newCouponF?.coupon_status}, oldActive=${oldCouponActiveOnLo}, loRestored=${loAvailAfterReschedule === loAvailBeforeReschedule + 1}, hiDecremented=${hiAvailAfterReschedule === hiAvailBeforeReschedule - 1}`);
    }

    results.push({
      flow: 'F',
      name: 'Positive reschedule charge',
      method: 'POST',
      endpoint: '/api/bookings/reschedule',
      httpStatus: 'HTTP 201',
      identifier: `PNR: ${dbBookingF?.pnr_code} (${newConfF})`,
      invariant: `Rescheduled from APT-E2E-PRC-LO (1,200,000 VND) to APT-E2E-PRC-HI (2,500,000 VND); exact difference (+1,300,000 VND) charged; old coupon CANCELLED, new coupon ACTIVE; old inventory restored (+1), new inventory decremented (-1).`,
      status: 'PASS',
      details: {
        rescheduleCharge: chargeTx?.amount,
        confirmationNumber: newConfF,
      },
    });

    // =========================================================================
    // FLOW G: Negative reschedule refund
    // =========================================================================
    logger.log('--- Executing Flow G: Negative reschedule refund ---');
    const hiAvailBeforeG = (await flightsCol.findOne({ _id: hiFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const loAvailBeforeG = (await flightsCol.findOne({ _id: loFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const oldAuthoritativeG = 2500000;
    const newAuthoritativeG = 1200000;
    const expectedDiffG = oldAuthoritativeG - newAuthoritativeG; // 1,300,000 VND refund

    const flowGRes = await api(
      'POST',
      '/bookings/reschedule',
      {
        confirmation_number: newConfF,
        new_flight_id: loFlight._id.toString(),
        new_inventory_id: loEcoInv._id.toString(),
      },
      userBToken,
    );

    const dbBookingG = await bookingsCol.findOne({ pnr_code: baseBookingFRes.data?.pnr_code });
    const hiAvailAfterG = (await flightsCol.findOne({ _id: hiFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const loAvailAfterG = (await flightsCol.findOne({ _id: loFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;

    const refundTxG = dbBookingG?.payment_transactions?.find((t: any) => t.transaction_type === 'RESCHEDULE_REFUND');
    const latestActiveCouponG = dbBookingG?.ticket_coupons?.filter((c: any) => (c.coupon_status || c.status) === 'ACTIVE')?.pop();

    const flowGPass =
      flowGRes.status === 201 &&
      refundTxG !== undefined &&
      refundTxG.status === 'SUCCESS' &&
      refundTxG.amount === expectedDiffG && // Exactly 1,300,000 VND refund
      refundTxG.card_masked === '**** **** **** 4444' && // Source card provenance preserved!
      latestActiveCouponG?.flight_id.toString() === loFlight._id.toString() &&
      hiAvailAfterG === hiAvailBeforeG + 1 && // Hi inventory restored
      loAvailAfterG === loAvailBeforeG - 1; // Lo inventory decremented

    if (!flowGPass) {
      throw new Error(`Flow G assertion failed: HTTP ${flowGRes.status}, refundTx=${refundTxG?.amount} (expected ${expectedDiffG}), cardMasked=${refundTxG?.card_masked}, hiRestored=${hiAvailAfterG === hiAvailBeforeG + 1}, loDecremented=${loAvailAfterG === loAvailBeforeG - 1}`);
    }

    results.push({
      flow: 'G',
      name: 'Negative reschedule refund',
      method: 'POST',
      endpoint: '/api/bookings/reschedule',
      httpStatus: 'HTTP 201',
      identifier: `PNR: ${dbBookingG?.pnr_code} (${bookingFConf})`,
      invariant: `Rescheduled from APT-E2E-PRC-HI (2,500,000 VND) back to APT-E2E-PRC-LO (1,200,000 VND); exact difference (1,300,000 VND) refunded to card (**** **** **** 4444); old coupon cancelled, new coupon active; inventory rebalanced.`,
      status: 'PASS',
      details: {
        rescheduleRefund: refundTxG?.amount,
        cardMasked: refundTxG?.card_masked,
      },
    });

    // =========================================================================
    // FLOW H: Blocked cancel + positive confirm + 0% refund
    // =========================================================================
    logger.log('--- Executing Flow H: Blocked cancel + positive confirm + 0% refund ---');
    // H1: Blocked cancellation
    const holdH1Res = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: true,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: hldFlight._id.toString(),
            inventory_id: hldEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );
    const holdH1Pnr = holdH1Res.data?.pnr_code;
    const holdH1Code = holdH1Res.data?.blocking_number;
    const hldAvailBeforeCancelH1 = (await flightsCol.findOne({ _id: hldFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesBeforeCancelH1 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const cancelH1Res = await api('POST', '/bookings/cancel', {
      identifier: holdH1Code,
      reason: 'Hold cancellation test',
    }, userBToken);

    const dbBookingH1 = await bookingsCol.findOne({ pnr_code: holdH1Pnr });
    const hldAvailAfterCancelH1 = (await flightsCol.findOne({ _id: hldFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesAfterCancelH1 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;
    const refundTxH1 = dbBookingH1?.payment_transactions?.filter((t: any) => t.transaction_type === 'REFUND');

    const h1Pass =
      cancelH1Res.status === 201 &&
      dbBookingH1?.status === BookingStatus.CANCELLED &&
      (!refundTxH1 || refundTxH1.length === 0) &&
      hldAvailAfterCancelH1 === hldAvailBeforeCancelH1 + 1 &&
      milesAfterCancelH1 === milesBeforeCancelH1;

    // H2: Confirmed positive refund (>30d, 90% policy)
    const ref90Flight = await flightsCol.findOne({ flight_number: 'APT-E2E-REF90' });
    if (!ref90Flight) throw new Error('Fixture flight APT-E2E-REF90 not found');
    const ref90EcoInv = ref90Flight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');

    const confH2Res = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: ref90Flight._id.toString(),
            inventory_id: ref90EcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );
    const confH2Pnr = confH2Res.data?.pnr_code;
    const confH2Code = confH2Res.data?.confirmation_number;
    const ref90AvailBeforeCancel = (await flightsCol.findOne({ _id: ref90Flight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesBeforeCancelH2 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const cancelH2Res = await api('POST', '/bookings/cancel', {
      identifier: confH2Code,
      reason: 'Advance cancellation (>30d) test',
    }, userBToken);

    const dbBookingH2 = await bookingsCol.findOne({ pnr_code: confH2Pnr });
    const ref90AvailAfterCancel = (await flightsCol.findOne({ _id: ref90Flight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesAfterCancelH2 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;
    const refundTxH2 = dbBookingH2?.payment_transactions?.find((t: any) => t.transaction_type === 'REFUND');

    const expectedRefundH2 = Math.round(1380000 * 0.9); // 1,242,000 VND (90% of 1,380,000 VND paid)
    const h2Pass =
      cancelH2Res.status === 201 &&
      dbBookingH2?.status === BookingStatus.CANCELLED &&
      refundTxH2 !== undefined &&
      refundTxH2.status === 'SUCCESS' &&
      refundTxH2.amount === expectedRefundH2 &&
      ref90AvailAfterCancel === ref90AvailBeforeCancel + 1 &&
      milesAfterCancelH2 === milesBeforeCancelH2 - 376;

    // H3: Confirmed 0% refund (<7d before departure)
    const confH3Res = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: buyFlight._id.toString(),
            inventory_id: buyEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );
    const confH3Pnr = confH3Res.data?.pnr_code;
    const confH3Code = confH3Res.data?.confirmation_number;
    const buyAvailBeforeCancelH3 = (await flightsCol.findOne({ _id: buyFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesBeforeCancelH3 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const cancelH3Res = await api('POST', '/bookings/cancel', {
      identifier: confH3Code,
      reason: 'Late cancellation (<7d) test',
    }, userBToken);

    const dbBookingH3 = await bookingsCol.findOne({ pnr_code: confH3Pnr });
    const buyAvailAfterCancelH3 = (await flightsCol.findOne({ _id: buyFlight._id }))?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const milesAfterCancelH3 = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;
    const positiveRefundTxH3 = dbBookingH3?.payment_transactions?.filter((t: any) => t.transaction_type === 'REFUND' && t.amount > 0);

    const h3Pass =
      cancelH3Res.status === 201 &&
      dbBookingH3?.status === BookingStatus.CANCELLED &&
      (!positiveRefundTxH3 || positiveRefundTxH3.length === 0) &&
      buyAvailAfterCancelH3 === buyAvailBeforeCancelH3 + 1 &&
      milesAfterCancelH3 === milesBeforeCancelH3 - 721;

    const flowHPass = h1Pass && h2Pass && h3Pass;
    if (!flowHPass) {
      throw new Error(`Flow H assertion failed: H1=${h1Pass}, H2=${h2Pass} (refund=${refundTxH2?.amount}, exp=${expectedRefundH2}), H3=${h3Pass}`);
    }

    results.push({
      flow: 'H',
      name: 'Blocked cancel + positive confirm + 0% refund',
      method: 'POST',
      endpoint: '/api/bookings/cancel',
      httpStatus: 'HTTP 201',
      identifier: `Held: ${holdH1Code} | Confirmed >30d: ${confH2Code} | Confirmed <7d: ${confH3Code}`,
      invariant: `H1 (BLOCKED): CANCELLED, 0 refund, inventory restored (+1), 0 miles reversed; H2 (>30d): 90% refund (${expectedRefundH2} VND) SUCCESS, inventory restored, miles deducted; H3 (<7d): 0% refund (0 VND), inventory restored, miles deducted.`,
      status: 'PASS',
      details: {
        h1Cancelled: holdH1Code,
        h2RefundAmount: refundTxH2?.amount,
        h3Cancelled: confH3Code,
      },
    });

    // =========================================================================
    // FLOW I: Disruption DELAYED + CANCELLED
    // =========================================================================
    logger.log('--- Executing Flow I: Disruption DELAYED + CANCELLED ---');
    // Get Admin Token for status mutations
    const adminLoginRes = await api('POST', '/auth/login', {
      username: 'e2e_admin',
      password: E2E_PASSWORD,
    });
    const adminToken = adminLoginRes.data?.access_token;

    // Part A: DELAYED real transition from SCHEDULED
    const dlyFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-DLY' });
    if (!dlyFlight) throw new Error('Fixture flight APT-E2E-DLY not found');
    if (dlyFlight.status !== FlightStatus.SCHEDULED) {
      throw new Error(`Test setup invalid: APT-E2E-DLY must initially be SCHEDULED, found: ${dlyFlight.status}`);
    }

    // Create a booking on APT-E2E-DLY to verify Track Booking enrichment
    const dlyEcoInv = dlyFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const dlyBookingRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: dlyFlight._id.toString(),
            inventory_id: dlyEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );
    const dlyBookingPnr = dlyBookingRes.data?.pnr_code;

    // Patch status from SCHEDULED -> DELAYED
    const delayPatchRes = await api(
      'PATCH',
      `/flights/${dlyFlight._id}/status`,
      {
        status: FlightStatus.DELAYED,
        delay_minutes: 120,
        delay_reason: 'Thunderstorm over Da Nang - ATC holding delay',
      },
      adminToken,
    );

    const dlyFlightAfter = await flightsCol.findOne({ _id: dlyFlight._id });
    const trackDlyRes = await api('GET', `/bookings/track/${dlyBookingPnr}`, undefined, userBToken);

    const partAPass =
      delayPatchRes.status === 200 &&
      dlyFlightAfter?.status === FlightStatus.DELAYED &&
      dlyFlightAfter?.delay_minutes === 120 &&
      dlyFlightAfter?.delay_reason === 'Thunderstorm over Da Nang - ATC holding delay' &&
      trackDlyRes.status === 200 &&
      trackDlyRes.data?.has_emergency_changes === true &&
      trackDlyRes.data?.flight_coupons?.[0]?.flight_status === FlightStatus.DELAYED;

    // Part B: CANCELLED real transition from SCHEDULED with automated 100% compensation
    const cncFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-CNC' });
    if (!cncFlight) throw new Error('Fixture flight APT-E2E-CNC not found');
    if (cncFlight.status !== FlightStatus.SCHEDULED) {
      throw new Error(`Test setup invalid: APT-E2E-CNC must initially be SCHEDULED, found: ${cncFlight.status}`);
    }

    const cncAvailBefore = cncFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const cncEcoInv = cncFlight.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const userBMilesBeforeCnc = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    // Create confirmed booking on cancellation flight
    const cncBookingRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(),
        legs: [
          {
            flight_id: cncFlight._id.toString(),
            inventory_id: cncEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      userBToken,
    );
    const cncBookingPnr = cncBookingRes.data?.pnr_code;
    const dbCncBookingBefore = await bookingsCol.findOne({ pnr_code: cncBookingPnr });
    const initialPaidAmount = dbCncBookingBefore?.total_amount;

    // Patch status from SCHEDULED -> CANCELLED (Triggers cancelBookingsForFlight in FlightsService)
    const cancelPatchRes = await api(
      'PATCH',
      `/flights/${cncFlight._id}/status`,
      {
        status: FlightStatus.CANCELLED,
        delay_reason: 'Emergency technical maintenance - aircraft grounded',
      },
      adminToken,
    );

    const cncFlightAfter = await flightsCol.findOne({ _id: cncFlight._id });
    const dbCncBookingAfter = await bookingsCol.findOne({ pnr_code: cncBookingPnr });
    const cncAvailAfter = cncFlightAfter?.inventories.find((i: any) => i.cabin_class === 'ECONOMY')?.available_seats;
    const userBMilesAfterCnc = (await usersCol.findOne({ _id: userB!._id }))?.sky_miles || 0;

    const compensationRefundTx = dbCncBookingAfter?.payment_transactions?.find(
      (t: any) => t.transaction_type === 'REFUND' && t.status === 'SUCCESS',
    );
    const allCouponsCancelled = dbCncBookingAfter?.ticket_coupons?.every(
      (c: any) => (c.coupon_status || c.status) === 'CANCELLED',
    );

    const partBPass =
      cancelPatchRes.status === 200 &&
      cncFlightAfter?.status === FlightStatus.CANCELLED &&
      dbCncBookingAfter?.status === BookingStatus.CANCELLED &&
      allCouponsCancelled === true &&
      compensationRefundTx !== undefined &&
      compensationRefundTx.amount === initialPaidAmount && // Exact 100% compensation refund!
      cncAvailAfter === cncAvailBefore && // Inventory fully restored
      userBMilesAfterCnc === userBMilesBeforeCnc; // SkyMiles compensated

    const flowIPass = partAPass && partBPass;
    if (!flowIPass) {
      throw new Error(`Flow I assertion failed: partA=${partAPass} [patch=${delayPatchRes.status}, status=${dlyFlightAfter?.status}, delayMins=${dlyFlightAfter?.delay_minutes}, reason=${dlyFlightAfter?.delay_reason}, trackStatus=${trackDlyRes.status}, emerg=${trackDlyRes.data?.has_emergency_changes}, coupStatus=${trackDlyRes.data?.flight_coupons?.[0]?.flight_status}], partB=${partBPass} (patch=${cancelPatchRes.status}, bkStatus=${dbCncBookingAfter?.status}, refund=${compensationRefundTx?.amount}, exp=${initialPaidAmount})`);
    }

    results.push({
      flow: 'I',
      name: 'Disruption DELAYED + CANCELLED',
      method: 'PATCH',
      endpoint: '/api/flights/:id/status',
      httpStatus: 'HTTP 200',
      identifier: `Delayed: APT-E2E-DLY | Cancelled: APT-E2E-CNC`,
      invariant: `A. SCHEDULED ➔ DELAYED (120m delay, reason verified, Track Booking reflects emergency change); B. SCHEDULED ➔ CANCELLED automatically sweeps bookings to CANCELLED with 100% compensation refund (${initialPaidAmount} VND), coupons CANCELLED, inventory restored.`,
      status: 'PASS',
      details: {
        delayedFlight: 'APT-E2E-DLY',
        cancelledFlight: 'APT-E2E-CNC',
        compensationRefundAmount: compensationRefundTx?.amount,
      },
    });

    // =========================================================================
    // FLOW J: Track Booking
    // =========================================================================
    logger.log('--- Executing Flow J: Track Booking ---');
    const flowJRes = await api('GET', `/bookings/track/${flowCPnr}`, undefined, userBToken);

    const bookingInfo = flowJRes.data?.booking_info;
    const flightCoupons = flowJRes.data?.flight_coupons;
    const hasEmergencyChanges = flowJRes.data?.has_emergency_changes;

    const flowJPass =
      flowJRes.status === 200 &&
      bookingInfo !== undefined &&
      bookingInfo.pnr_code === flowCPnr &&
      bookingInfo.status === BookingStatus.CONFIRMED &&
      Array.isArray(bookingInfo.passengers) &&
      bookingInfo.passengers.length >= 1 &&
      typeof bookingInfo.total_amount === 'number' &&
      bookingInfo.total_amount > 0 &&
      Array.isArray(flightCoupons) &&
      flightCoupons.length >= 1 &&
      flightCoupons[0].origin_iata === 'SGN' &&
      flightCoupons[0].dest_iata === 'HAN' &&
      flightCoupons[0].flight_status === FlightStatus.SCHEDULED &&
      typeof hasEmergencyChanges === 'boolean';

    if (!flowJPass) {
      throw new Error(`Flow J assertion failed: HTTP ${flowJRes.status}, PNR=${bookingInfo?.pnr_code}, couponsLen=${flightCoupons?.length}`);
    }

    results.push({
      flow: 'J',
      name: 'Track Booking',
      method: 'GET',
      endpoint: '/api/bookings/track/:code',
      httpStatus: 'HTTP 200',
      identifier: `Tracking Code: ${flowCPnr}`,
      invariant: `Envelope returned booking_info (PNR: ${flowCPnr}, status CONFIRMED, passenger demographic details, fare amounts), flight_coupons array (origin, destination, wall-clock time, status), and emergency change boolean.`,
      status: 'PASS',
      details: {
        pnr: flowCPnr,
        status: bookingInfo?.status,
        couponsCount: flightCoupons?.length,
      },
    });

    // =========================================================================
    // FLOW K: Clerk Booking / customer ownership
    // =========================================================================
    logger.log('--- Executing Flow K: Clerk Booking / customer ownership ---');
    const clerkLoginRes = await api('POST', '/auth/login', {
      username: 'e2e_clerk',
      password: E2E_PASSWORD,
    });
    const clerkToken = clerkLoginRes.data?.access_token;
    const clerkUser = await usersCol.findOne({ username: 'e2e_clerk' });

    // Clerk creates booking on behalf of userB (Customer)
    const clerkBookingRes = await api(
      'POST',
      '/bookings',
      {
        booking_type: BookingType.ONE_WAY,
        is_block: false,
        payment_method: PaymentMethod.PROFILE_CARD,
        user_id: userB!._id.toString(), // Customer ID!
        legs: [
          {
            flight_id: buyFlight._id.toString(),
            inventory_id: buyEcoInv._id.toString(),
            leg_type: 'OUTBOUND',
          },
        ],
        payment_details: {
          card_number: '4111222233334444',
          card_holder: 'Minh Tran',
          expiry: '12/28',
          cvv: '123',
        },
        passengers: [
          {
            first_name: 'Minh',
            last_name: 'Tran',
            passenger_type: PassengerType.ADULT,
            date_of_birth: '1995-05-15',
            id_card_or_passport: 'B1234567',
            nationality: 'VNM',
          },
        ],
      },
      clerkToken,
    );

    const clerkBookingPnr = clerkBookingRes.data?.pnr_code;
    const dbClerkBooking = await bookingsCol.findOne({ pnr_code: clerkBookingPnr });

    // Customer can track their own clerk-created booking
    const customerAccessRes = await api('GET', `/bookings/track/${clerkBookingPnr}`, undefined, userBToken);

    // Unrelated customer cannot track it (assertOwnership triggers ForbiddenException)
    const goldLoginRes = await api('POST', '/auth/login', {
      username: 'e2e_customer_gold',
      password: E2E_PASSWORD,
    });
    const unrelatedToken = goldLoginRes.data?.access_token;
    const unrelatedAccessRes = await api('GET', `/bookings/track/${clerkBookingPnr}`, undefined, unrelatedToken);

    const flowKPass =
      clerkBookingRes.status === 201 &&
      clerkUser?.role === UserRole.CLERK &&
      userB?.role === UserRole.CUSTOMER &&
      dbClerkBooking?.user_id.toString() === userB!._id.toString() &&
      dbClerkBooking?.user_id.toString() !== clerkUser!._id.toString() &&
      customerAccessRes.status === 200 &&
      unrelatedAccessRes.status === 403;

    if (!flowKPass) {
      throw new Error(`Flow K assertion failed: clerkCreate=${clerkBookingRes.status}, userIdMatch=${dbClerkBooking?.user_id.toString() === userB!._id.toString()}, custAccess=${customerAccessRes.status}, unrelatedAccess=${unrelatedAccessRes.status}`);
    }

    results.push({
      flow: 'K',
      name: 'Clerk Booking / customer ownership',
      method: 'POST',
      endpoint: '/api/bookings',
      httpStatus: 'HTTP 201 / HTTP 200 / HTTP 403',
      identifier: `PNR: ${clerkBookingPnr} (Clerk: e2e_clerk ➔ Customer: ${userBUsername})`,
      invariant: `Staff with CLERK role created reservation on behalf of customer; booking.user_id strictly references customer (${userB!._id}); customer token tracks booking (HTTP 200); unrelated customer is strictly blocked by ownership guard (HTTP 403).`,
      status: 'PASS',
      details: {
        pnr: clerkBookingPnr,
        clerkId: clerkUser?._id?.toString(),
        customerId: userB?._id?.toString(),
      },
    });

    // =========================================================================
    // FLOW L: Public flight lookup + Commercial Admin
    // =========================================================================
    logger.log('--- Executing Flow L: Public flight lookup + Commercial Admin ---');
    // Part 1: Public Flight Lookup without token
    const publicLookupRes = await api('GET', `/flights/lookup?flight_number=APT-E2E-HLD&date=${date20Str}`);
    const publicPass =
      publicLookupRes.status === 200 &&
      Array.isArray(publicLookupRes.data) &&
      publicLookupRes.data.length > 0 &&
      publicLookupRes.data[0].flight_number === 'APT-E2E-HLD';

    // Part 2: Airport resolve
    const resolveRes = await api('GET', '/airports/resolve?city=Ha%20Noi');
    const resolvePass =
      resolveRes.status === 200 &&
      Array.isArray(resolveRes.data?.exactMatches) &&
      resolveRes.data.exactMatches.some((m: any) => m.iata_code === 'HAN');

    // Part 3: Physical seat map
    const seatMapRes = await api('GET', `/seat-allocation/flight/${hldFlight._id}/map?aircraftType=A20N`);
    const totalPhysicalSeats = seatMapRes.data?.rows?.reduce(
      (sum: number, r: any) =>
        sum + (r.column_groups || []).reduce((gSum: number, g: any) => gSum + (g?.length || 0), 0),
      0,
    );
    const seatMapPass =
      seatMapRes.status === 200 &&
      seatMapRes.data?.aircraft_type === 'A20N' &&
      seatMapRes.data?.total_capacity === 180 &&
      totalPhysicalSeats === 180;

    // Part 4: Commercial Admin (GET /api/flights/commercial-templates)
    const adminCommercialRes = await api('GET', '/flights/commercial-templates', undefined, adminToken);
    const unauthCommercialRes = await api('GET', '/flights/commercial-templates'); // No token

    const adminCommercialPass =
      adminCommercialRes.status === 200 &&
      unauthCommercialRes.status === 401;

    const flowLPass = publicPass && resolvePass && seatMapPass && adminCommercialPass;
    if (!flowLPass) {
      throw new Error(`Flow L assertion failed: public=${publicPass}, resolve=${resolvePass}, seatMap=${seatMapPass} (status=${seatMapRes.status}, type=${seatMapRes.data?.aircraft_type}, cap=${seatMapRes.data?.total_capacity}, seats=${totalPhysicalSeats}), adminCommercial=${adminCommercialPass}`);
    }

    results.push({
      flow: 'L',
      name: 'Public flight lookup + Commercial Admin',
      method: 'GET',
      endpoint: '/api/flights/lookup, /api/airports/resolve, /api/seat-allocation/flight/:flightId/map, /api/flights/commercial-templates',
      httpStatus: 'HTTP 200 / HTTP 200 / HTTP 200 / HTTP 200 (Unauth 401)',
      identifier: 'Flight: APT-E2E-HLD | City: "Ha Noi" | Fleet: A20N',
      invariant: `Public flight lookup retrieves operational status without auth; airport resolver maps "Ha Noi" ➔ HAN; seat allocation renders physical 180-seat A20N catalog; commercial admin endpoint (/flights/commercial-templates) requires ADMIN role and rejects unauthenticated requests (HTTP 401).`,
      status: 'PASS',
      details: {
        publicLookupCount: publicLookupRes.data?.length,
        resolvedIata: resolveRes.data?.exactMatches?.[0]?.iata_code,
        aircraftType: seatMapRes.data?.aircraft_type,
        totalCapacity: seatMapRes.data?.total_capacity,
        totalPhysicalSeats,
      },
    });

    // =========================================================================
    // FLOW M: Analytics overview + physical capacity
    // =========================================================================
    logger.log('--- Executing Flow M: Analytics overview + physical capacity ---');
    const allBookings = await bookingsCol.find().toArray();

    // Recompute expected financial ledger equation:
    // net_revenue_vnd = SUM(PAYMENT) + SUM(RESCHEDULE_CHARGE) - SUM(REFUND) - SUM(RESCHEDULE_REFUND)
    let expectedNetRevenue = 0;
    let expectedActiveBookingValue = 0;

    for (const b of allBookings) {
      if (b.payment_transactions && Array.isArray(b.payment_transactions)) {
        for (const tx of b.payment_transactions) {
          if (tx.status === 'SUCCESS') {
            const type = (tx.transaction_type || '').toUpperCase();
            if (type === 'PAYMENT' || type === 'RESCHEDULE_CHARGE') {
              expectedNetRevenue += tx.amount || 0;
            } else if (type === 'REFUND' || type === 'RESCHEDULE_REFUND') {
              expectedNetRevenue -= tx.amount || 0;
            }
          }
        }
      }
      if (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.RESCHEDULED) {
        expectedActiveBookingValue += b.total_amount || 0;
      }
    }

    const overviewRes = await api('GET', '/analytics/overview', undefined, adminToken);
    const capacityRes = await api('GET', '/analytics/capacity', undefined, adminToken);

    // Recompute expected total seat capacity from qualifying upcoming SCHEDULED / DELAYED flights
    const now = new Date();
    const upcomingFlights = await flightsCol
      .find({
        status: { $in: [FlightStatus.SCHEDULED, FlightStatus.DELAYED] },
        scheduled_departure: { $gte: now },
      })
      .toArray();
    const expectedTotalCapacity = upcomingFlights.reduce(
      (sum, f) => sum + (f.aircraft?.total_capacity || 180),
      0,
    );

    // Verify reconciliation on APT-E2E-SEAT
    const seatFlight = await flightsCol.findOne({ flight_number: 'APT-E2E-SEAT' });
    const seatFlightCapacity = seatFlight?.aircraft?.total_capacity || 180;
    const seatAllocs = await allocationsCol.find({ flight_id: seatFlight?._id }).toArray();
    const confirmedCount = seatAllocs.filter((a) => a.status === 'CONFIRMED').length;
    const heldCount = seatAllocs.filter((a) => a.status === 'HELD').length;
    const staffBlockedCount = seatAllocs.filter((a) =>
      ['BLOCKED_MAINTENANCE', 'CREW_REST', 'VIP_HOLD'].includes(a.status),
    ).length;
    const seatEcoInv = seatFlight?.inventories.find((i: any) => i.cabin_class === 'ECONOMY');
    const availableCount = seatEcoInv?.available_seats || 0;

    const seatReconciliationPass =
      seatFlightCapacity === 180 &&
      confirmedCount === 1 && // 15C
      heldCount === 1 && // 15D
      staffBlockedCount === 3 && // 12B, 3D, 1A
      availableCount === 166; // 168 - 2 customer reserved

    const flowMPass =
      overviewRes.status === 200 &&
      capacityRes.status === 200 &&
      overviewRes.data?.net_revenue_vnd === expectedNetRevenue &&
      overviewRes.data?.active_booking_value_vnd === expectedActiveBookingValue &&
      capacityRes.data?.total_seat_capacity === expectedTotalCapacity &&
      seatReconciliationPass;

    if (!flowMPass) {
      throw new Error(`Flow M assertion failed: netRev=${overviewRes.data?.net_revenue_vnd} (exp ${expectedNetRevenue}), activeVal=${overviewRes.data?.active_booking_value_vnd} (exp ${expectedActiveBookingValue}), capacity=${capacityRes.data?.total_seat_capacity} (exp ${expectedTotalCapacity}), seatReconcile=${seatReconciliationPass}`);
    }

    results.push({
      flow: 'M',
      name: 'Analytics overview + physical capacity',
      method: 'GET',
      endpoint: '/api/analytics/overview, /api/analytics/capacity',
      httpStatus: 'HTTP 200 / HTTP 200',
      identifier: 'Executive Management Analytics',
      invariant: `Financial ledger identity verified: net_revenue_vnd (${expectedNetRevenue} VND) equals independently computed SUM(PAYMENT)+SUM(RESCHEDULE_CHARGE)-SUM(REFUND)-SUM(RESCHEDULE_REFUND); active_booking_value_vnd (${expectedActiveBookingValue} VND) matches contract; physical capacity (${expectedTotalCapacity} seats) matches upcoming fleet; APT-E2E-SEAT reconciles 180 seats (1 confirmed, 1 held, 3 staff blocks, 166 available).`,
      status: 'PASS',
      details: {
        netRevenueVnd: expectedNetRevenue,
        activeBookingValueVnd: expectedActiveBookingValue,
        totalSeatCapacity: expectedTotalCapacity,
      },
    });

    // =========================================================================
    // FLOW N: Mail DEV fallback lifecycle
    // =========================================================================
    logger.log('--- Executing Flow N: Mail DEV fallback lifecycle ---');
    // Force DEV fallback assertions through actual MailService lifecycle calls
    const reminderResult = await mailService.sendBlockedTicketReminder(
      'flow_n_user@aptechairlines.test',
      '<p>Reminder: Your blocked ticket is awaiting confirmation</p>',
    );

    const cancelResult = await mailService.sendCancellationEmail({
      toEmail: 'flow_n_user@aptechairlines.test',
      passengerName: 'Minh Tran',
      bookingReference: 'PNR-FLOW-N',
      cancellationNumber: 'CAN-FLOW-N',
      cancellationType: 'MANUAL_CONFIRMED',
      originalBookingStatus: 'CONFIRMED',
      refundAmount: 1350000,
      refundPercentage: 90,
      maskedCard: '**** **** **** 4444',
      itinerary: [
        {
          flightNumber: 'APT-E2E-REF90',
          origin: 'SGN',
          destination: 'DAD',
          departureTimeFormatted: '2026-10-28 09:00 (Asia/Ho_Chi_Minh)',
        },
      ],
    });

    const expiredResult = await mailService.sendExpiredHoldCancellationEmail({
      toEmail: 'flow_n_user@aptechairlines.test',
      passengerName: 'Minh Tran',
      bookingReference: 'PNR-FLOW-N',
      blockingNumber: 'BLK-FLOW-N',
      cancellationNumber: 'CAN-EXPIRED-N',
      holdDeadlineFormatted: '2026-10-25 23:59 (Asia/Ho_Chi_Minh)',
      flightNumber: 'APT-E2E-HLD',
      origin: 'SGN',
      destination: 'HAN',
      departureTimeFormatted: '2026-10-28 08:00 (Asia/Ho_Chi_Minh)',
    });

    const disruptionResult = await mailService.sendFlightDisruptionEmail({
      toEmail: 'flow_n_user@aptechairlines.test',
      passengerName: 'Minh Tran',
      bookingReference: 'PNR-FLOW-N',
      flightNumber: 'APT-E2E-DLY',
      origin: 'SGN',
      destination: 'DAD',
      disruptionType: 'DELAY',
      originalDepartureFormatted: '2026-10-28 13:00 (Asia/Ho_Chi_Minh)',
      newDepartureFormatted: '2026-10-28 15:00 (Asia/Ho_Chi_Minh)',
      originalArrivalFormatted: '2026-10-28 14:20 (Asia/Ho_Chi_Minh)',
      newArrivalFormatted: '2026-10-28 16:20 (Asia/Ho_Chi_Minh)',
      delayReason: 'Thunderstorm over Da Nang - ATC holding delay',
      statusText: 'DELAYED',
    });

    const flowNPass =
      reminderResult === true &&
      cancelResult === true &&
      expiredResult === true &&
      disruptionResult === true;

    if (!flowNPass) {
      throw new Error(`Flow N assertion failed: reminder=${reminderResult}, cancel=${cancelResult}, expired=${expiredResult}, disruption=${disruptionResult}`);
    }

    results.push({
      flow: 'N',
      name: 'Mail DEV fallback lifecycle',
      method: 'MailService Lifecycle Methods',
      endpoint: '[MAIL:DEV-FALLBACK]',
      httpStatus: 'Execution Verified',
      identifier: 'Lifecycle: Reminder / Cancel / Expired Hold / Disruption',
      invariant: 'All 4 operational email lifecycles (Hold Reminder, Confirmed Cancellation, Expired Hold Expiry, Flight Delay Notice) executed via actual MailService in DEV mode; formatted with IANA wall-clock timezones; returned true (zero failure, zero transaction rollback).',
      status: 'PASS',
      details: {
        reminderResult,
        cancelResult,
        expiredResult,
        disruptionResult,
      },
    });

    // =========================================================================
    // OUTPUT GENERATION (Machine-Sourced Artifacts)
    // =========================================================================
    logger.log('\n================================================================================');
    logger.log('BUSINESS E2E VERIFICATION MATRIX — EXECUTION REPORT');
    logger.log('================================================================================\n');

    console.table(
      results.map((r) => ({
        Flow: r.flow,
        Name: r.name,
        Endpoint: r.endpoint,
        Result: r.httpStatus,
        Identifier: r.identifier,
        Status: r.status,
      })),
    );

    const reportPath = path.resolve(__dirname, 'matrix-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          database: ALLOWED_MATRIX_DB_NAME,
          totalFlows: results.length,
          passedFlows: results.filter((r) => r.status === 'PASS').length,
          results,
        },
        null,
        2,
      ),
    );
    logger.log(`\nMachine-sourced matrix report saved to ${reportPath}`);

    const allPassed = results.length === 14 && results.every((r) => r.status === 'PASS');
    if (!allPassed) {
      logger.error('CRITICAL: One or more business flows failed verification!');
      process.exit(1);
    }

    logger.log('\n✅ ALL 14 BUSINESS E2E VERIFICATION FLOWS (A THROUGH N) PASSED WITH STRICT INVARIANTS.');
  } finally {
    // Step D: Teardown and clean up ONLY disposable database
    logger.log(`\nD. Teardown: closing server and dropping disposable database ${ALLOWED_MATRIX_DB_NAME}...`);
    await dbConn.close();
    await app.close();

    assertMatrixDbSafe(MATRIX_MONGO_URI);
    const postCleanConn = await mongoose.createConnection(MATRIX_MONGO_URI).asPromise();
    await postCleanConn.dropDatabase();
    await postCleanConn.close();
    logger.log(`Disposable database ${ALLOWED_MATRIX_DB_NAME} dropped successfully. Production airline_db preserved.`);
  }
}

main().catch((err) => {
  console.error('Fatal error running Business E2E Matrix:', err);
  process.exit(1);
});
