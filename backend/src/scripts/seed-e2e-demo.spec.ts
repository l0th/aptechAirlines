import * as mongoose from 'mongoose';
import {
  assertSafeEnvironment,
  sanitizeMongoUri,
  buildE2EUsers,
  buildE2EAirports,
  buildRawFlightSpecs,
  createFlightDoc,
  buildSeatAllocations,
  buildFlightSeatOverrides,
  buildSampleBookings,
  resolveAirportCoordinates,
  KNOWN_AIRPORT_COORDINATES,
  getRelativeDate,
  formatTimeStr,
  run,
  E2E_PASSWORD,
} from './seed-e2e-demo';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';
import { BookingSchema, BookingStatus, PassengerType } from '../bookings/bookings.schema';
import { SeatAllocationSchema, SeatAllocationStatus } from '../seat-allocation/seat-allocation.schema';
import { FlightSeatOverrideSchema } from '../seat-allocation/flight-seat-override.schema';
import { FlightSchema, CabinClass } from '../flights/flights.schema';
import { UserSchema, UserRole } from '../users/users.schema';
import { CancellationPolicySchema } from '../policies/policies.schema';
import { calculateGreatCircleMiles } from '../common/distance.util';
import { getLocalWallTimeParts, localDateKey } from '../common/timezone.util';

describe('SeedE2EDemo - Production Schema Parity & Integrity (Master Closeout Correction 3)', () => {
  // Production Mongoose Models for live schema validation
  const BookingModel = mongoose.models.BookingTest || mongoose.model('BookingTest', BookingSchema);
  const SeatAllocationModel = mongoose.models.SeatAllocTest || mongoose.model('SeatAllocTest', SeatAllocationSchema);
  const FlightSeatOverrideModel = mongoose.models.OverrideTest || mongoose.model('OverrideTest', FlightSeatOverrideSchema);
  const FlightModel = mongoose.models.FlightTest || mongoose.model('FlightTest', FlightSchema);
  const UserModel = mongoose.models.UserTest || mongoose.model('UserTest', UserSchema);
  const PolicyModel = mongoose.models.PolicyTest || mongoose.model('PolicyTest', CancellationPolicySchema);

  describe('1. Production Hard Deny & URI Sanitization (Requirements 2 & 5)', () => {
    it('enforces hard deny on production environment without exception', () => {
      expect(() => assertSafeEnvironment('production')).toThrow(
        /strictly prohibited in PRODUCTION environment/i,
      );
      expect(() => assertSafeEnvironment('development')).not.toThrow();
      expect(() => assertSafeEnvironment('test')).not.toThrow();
      expect(() => assertSafeEnvironment(undefined)).not.toThrow();
    });

    it('sanitizes credential-bearing Mongo URIs and prevents password leakage', () => {
      const sensitiveUri = 'mongodb://app_user:SecretPass123!@mongo-cluster.internal:27017/airline_db?authSource=admin';
      const result = sanitizeMongoUri(sensitiveUri);

      expect(result.database).toBe('airline_db');
      expect(result.host).toBe('mongo-cluster.internal:27017');
      expect(JSON.stringify(result)).not.toContain('SecretPass123!');
      expect(JSON.stringify(result)).not.toContain('app_user');
    });
  });

  describe('2. User Seeding & SUPER_ADMIN Immutability (Requirement 7)', () => {
    it('verifies seeded users contain NO SUPER_ADMIN accounts and validate against UserSchema', () => {
      const users = buildE2EUsers('hashed_pw_test');
      expect(users.length).toBe(4);

      for (const u of users) {
        expect(u.role).not.toBe(UserRole.SUPER_ADMIN);
        const inst = new UserModel(u);
        const err = inst.validateSync();
        expect(err).toBeUndefined();
      }
    });
  });

  describe('3. Authoritative Coordinates & Zero Fallback Rule (Requirements 2, 3, 7)', () => {
    it('resolves coordinates from isolated reference map if airport record lacks coordinates without mutating record', () => {
      const bareAirportRecord = { iata_code: 'HAN' }; // lacks lat/lng
      const coords = resolveAirportCoordinates(bareAirportRecord, 'HAN');
      expect(coords).toEqual(KNOWN_AIRPORT_COORDINATES['HAN']);
      expect(bareAirportRecord).not.toHaveProperty('lat'); // proves non-mutation
    });

    it('derives confirmed booking miles strictly from calculated distance without hardcoded 721 fallback', () => {
      const confBookingId = new mongoose.Types.ObjectId();
      const holdBookingId = new mongoose.Types.ObjectId();
      const cancBookingId = new mongoose.Types.ObjectId();
      const customerUserId = new mongoose.Types.ObjectId();
      const seatFlightId = new mongoose.Types.ObjectId();
      const holdDeadline = new Date(Date.now() + 6 * 86400000);

      // Case A: When real distance is 721 mi
      const bookingsRealDist = buildSampleBookings({
        confBookingId,
        holdBookingId,
        cancBookingId,
        customerUserId,
        seatFlightId,
        seatFlightNumber: 'APT-E2E-SEAT',
        ecoInvId: new mongoose.Types.ObjectId().toString(),
        distanceMiles: 721,
        holdDeadline,
      });
      const confA = bookingsRealDist.find((b) => b.pnr_code === 'PNR-E2E-CONF01');
      expect(confA?.total_miles_accrued).toBe(721);

      // Case B: When distance is 0 (coordinates unknown), total_miles_accrued must be 0, NEVER 721
      const bookingsZeroDist = buildSampleBookings({
        confBookingId,
        holdBookingId,
        cancBookingId,
        customerUserId,
        seatFlightId,
        seatFlightNumber: 'APT-E2E-SEAT',
        ecoInvId: new mongoose.Types.ObjectId().toString(),
        distanceMiles: 0,
        holdDeadline,
      });
      const confB = bookingsZeroDist.find((b) => b.pnr_code === 'PNR-E2E-CONF01');
      expect(confB?.total_miles_accrued).toBe(0); // Proves no invented fallback!
    });
  });

  describe('4. Sample Bookings Domain Schema Parity (Requirement 1 & 7)', () => {
    it('validates all sample bookings strictly against production BookingSchema with zero errors', () => {
      const confBookingId = new mongoose.Types.ObjectId();
      const holdBookingId = new mongoose.Types.ObjectId();
      const cancBookingId = new mongoose.Types.ObjectId();
      const customerUserId = new mongoose.Types.ObjectId();
      const seatFlightId = new mongoose.Types.ObjectId();
      const holdDeadline = new Date(Date.now() + 6 * 86400000);

      const sampleBookings = buildSampleBookings({
        confBookingId,
        holdBookingId,
        cancBookingId,
        customerUserId,
        seatFlightId,
        seatFlightNumber: 'APT-E2E-SEAT',
        ecoInvId: new mongoose.Types.ObjectId().toString(),
        distanceMiles: 721,
        holdDeadline,
      });

      expect(sampleBookings.length).toBe(3);

      for (const bk of sampleBookings) {
        // Assert no unsupported legacy fields exist on booking root
        expect((bk as any).contact_name).toBeUndefined();
        expect((bk as any).contact_phone).toBeUndefined();
        expect((bk as any).contact_email).toBeUndefined();
        expect((bk as any).created_at).toBeUndefined();
        expect((bk as any).updated_at).toBeUndefined();

        // Assert no unsupported passenger fields exist
        for (const p of bk.passengers) {
          expect((p as any).passenger_index).toBeUndefined();
          expect((p as any).sex).toBeUndefined();
        }

        // Validate strictly with production Booking Mongoose Model
        const inst = new BookingModel(bk);
        const err = inst.validateSync();
        expect(err).toBeUndefined();
      }

      // Prove BLOCKED booking total_miles_accrued = 0 invariant
      const holdBooking = sampleBookings.find((b) => b.pnr_code === 'PNR-E2E-HOLD01');
      expect(holdBooking?.status).toBe(BookingStatus.BLOCKED);
      expect(holdBooking?.total_miles_accrued).toBe(0);
    });
  });

  describe('5. Seat Allocation & Override Schema Parity (Requirements 1, 4, 7)', () => {
    it('validates physical seat allocations and overrides strictly against production schemas', () => {
      const seatFlightId = new mongoose.Types.ObjectId();
      const confBookingId = new mongoose.Types.ObjectId();
      const holdBookingId = new mongoose.Types.ObjectId();
      const adminUserId = new mongoose.Types.ObjectId();
      const holdDeadline = new Date(Date.now() + 6 * 86400000);

      const allocations = buildSeatAllocations({
        seatFlightId,
        confBookingId,
        holdBookingId,
        holdDeadline,
      });

      expect(allocations.length).toBe(5);

      for (const alloc of allocations) {
        // Assert no unsupported fields exist on SeatAllocation
        expect((alloc as any).allocated_at).toBeUndefined();
        expect((alloc as any).confirmed_at).toBeUndefined();

        const inst = new SeatAllocationModel(alloc);
        const err = inst.validateSync();
        expect(err).toBeUndefined();
      }

      // Verify overrides
      const overrides = buildFlightSeatOverrides({ seatFlightId, adminUserId });
      expect(overrides.length).toBe(1);
      const ov = overrides[0];
      expect(ov.created_by_user_id).toEqual(adminUserId);

      const ovInst = new FlightSeatOverrideModel(ov);
      const ovErr = ovInst.validateSync();
      expect(ovErr).toBeUndefined();
    });
  });

  describe('6. Commercial Inventory vs Physical Staff Block Invariant (Requirement 4 & 7)', () => {
    it('proves commercial inventory reserved reflects customer reservations but NOT staff physical blocks', () => {
      const specs = buildRawFlightSpecs();
      const seatFlightSpec = specs.find((s) => s.flight_number === 'APT-E2E-SEAT');
      expect(seatFlightSpec).toBeDefined();

      const ecoInv = seatFlightSpec?.inventories.find((i) => i.cabin_class === CabinClass.ECONOMY);
      const busInv = seatFlightSpec?.inventories.find((i) => i.cabin_class === CabinClass.BUSINESS);

      // Economy: 168 allocated. Customer reservations: 15C (CONFIRMED) + 15D (HELD) = 2.
      // Staff block: 12B (BLOCKED_MAINTENANCE) = 1 physical block.
      // Runtime blockSeat() invariant: staff blocks do NOT decrement available_seats!
      // Therefore Economy available_seats = 168 - 2 = 166.
      expect(ecoInv?.allocated_seats).toBe(168);
      expect(ecoInv?.available_seats).toBe(166);

      // Business: 12 allocated. Customer reservations = 0.
      // Staff blocks: 3D (CREW_REST) + 1A (VIP_HOLD) = 2 physical blocks.
      // Staff blocks do NOT decrement available_seats!
      // Therefore Business available_seats = 12.
      expect(busInv?.allocated_seats).toBe(12);
      expect(busInv?.available_seats).toBe(12);

      // Prove commercial inventory reserved = customer confirmed (1) + active held (1)
      const totalAllocated = (ecoInv?.allocated_seats || 0) + (busInv?.allocated_seats || 0);
      const totalAvailable = (ecoInv?.available_seats || 0) + (busInv?.available_seats || 0);
      const inventoryReservedCustomerSeats = totalAllocated - totalAvailable;

      expect(inventoryReservedCustomerSeats).toBe(2); // Exactly 1 CONFIRMED + 1 HELD!
    });

    it('verifies all 16 flight specs inventory sums match aircraft total physical capacity', () => {
      const specs = buildRawFlightSpecs();
      expect(specs.length).toBe(16);

      for (const s of specs) {
        const sumAllocated = s.inventories.reduce((acc, inv) => acc + inv.allocated_seats, 0);
        expect(sumAllocated).toBe(s.total_capacity);

        // Verify with FlightModel schema
        const airportMap = {
          SGN: { lat: 10.8188, lng: 106.6519 },
          HAN: { lat: 21.2212, lng: 105.8072 },
          DAD: { lat: 16.0439, lng: 108.1994 },
          CXR: { lat: 11.9981, lng: 109.2194 },
          PQC: { lat: 10.1698, lng: 103.9931 },
          NRT: { lat: 35.7647, lng: 140.3863 },
        };
        const dep = new Date();
        const arr = new Date(dep.getTime() + s.duration * 60000);
        const flightDoc = createFlightDoc({
          flight_number: s.flight_number,
          origin_iata: s.origin_iata,
          dest_iata: s.dest_iata,
          departureDate: dep,
          arrivalDate: arr,
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

        const inst = new FlightModel(flightDoc);
        const err = inst.validateSync();
        expect(err).toBeUndefined();
      }
    });
  });

  describe('7. Timezone Determinism for Relative Flight Dates (Asia/Ho_Chi_Minh)', () => {
    it('produces identical Vietnam local wall time (08:00) independent of host timezone', () => {
      const VN_TZ = 'Asia/Ho_Chi_Minh';
      // Test base instant at various UTC hours (e.g. UTC morning, afternoon, night)
      const baseDates = [
        new Date('2026-09-24T01:00:00.000Z'), // 08:00 VN
        new Date('2026-09-24T12:00:00.000Z'), // 19:00 VN
        new Date('2026-09-24T23:30:00.000Z'), // 06:30 next day VN
      ];

      for (const base of baseDates) {
        const offsetDays = 5;
        const resultDate = getRelativeDate(offsetDays, 8, 0, base);

        // Verify wall clock time in Vietnam timezone is strictly 08:00:00
        const wallParts = getLocalWallTimeParts(resultDate, VN_TZ);
        expect(wallParts.hour).toBe(8);
        expect(wallParts.minute).toBe(0);
        expect(wallParts.hhmm).toBe('08:00');

        // Since Vietnam is UTC+7 (no DST), UTC hour must strictly be 01:00:00
        expect(resultDate.getUTCHours()).toBe(1);
        expect(resultDate.getUTCMinutes()).toBe(0);
        expect(resultDate.getUTCSeconds()).toBe(0);

        // Verify date offset from base VN date
        const baseVnKey = localDateKey(base, VN_TZ);
        const resVnKey = localDateKey(resultDate, VN_TZ);
        const [by, bm, bd] = baseVnKey.split('-').map(Number);
        const expectedDate = new Date(Date.UTC(by, bm - 1, bd + offsetDays));
        const expectedKey = `${expectedDate.getUTCFullYear()}-${String(expectedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(expectedDate.getUTCDate()).padStart(2, '0')}`;
        expect(resVnKey).toBe(expectedKey);
      }
    });

    it('correctly handles non-zero minutes and afternoon departures', () => {
      const VN_TZ = 'Asia/Ho_Chi_Minh';
      const base = new Date('2026-09-24T00:00:00.000Z');

      // Connecting Leg 2: 10:30
      const leg2Date = getRelativeDate(20, 10, 30, base);
      const leg2Parts = getLocalWallTimeParts(leg2Date, VN_TZ);
      expect(leg2Parts.hhmm).toBe('10:30');
      expect(leg2Date.getUTCHours()).toBe(3);
      expect(leg2Date.getUTCMinutes()).toBe(30);

      // Widebody: 18:30
      const widebodyDate = getRelativeDate(20, 18, 30, base);
      const widebodyParts = getLocalWallTimeParts(widebodyDate, VN_TZ);
      expect(widebodyParts.hhmm).toBe('18:30');
      expect(widebodyDate.getUTCHours()).toBe(11);
      expect(widebodyDate.getUTCMinutes()).toBe(30);
    });
  });

  describe('8. Policy Non-Destruction & Schema-Valid Airport Provenance (Requirement 4)', () => {
    it('verifies seed airports use data_source = "e2e_seed" without invented e2e_provenance', () => {
      const seededAirports = buildE2EAirports();
      expect(seededAirports.length).toBeGreaterThan(0);

      for (const ap of seededAirports) {
        expect((ap as any).e2e_provenance).toBeUndefined();
        expect(ap.iata_code).toBeDefined();
        expect(ap.city_name).toBeDefined();
      }
    });
  });

  describe('9. Isolated 12-Step Seed Idempotency & Cleanup Lane (airline_e2e_verification)', () => {
    const VERIFY_URI =
      process.env.TEST_MONGO_URI ||
      process.env.MONGO_URI ||
      'mongodb://localhost:27017/airline_e2e_verification';
    let verifyConn: mongoose.Connection;

    beforeAll(async () => {
      // Step 1: Connect to isolated disposable database
      verifyConn = await mongoose.createConnection(VERIFY_URI).asPromise();
    });

    afterAll(async () => {
      if (verifyConn) {
        await verifyConn.dropDatabase();
        await verifyConn.close();
      }
    });

    it('executes the full 12-step sequence verifying seed, idempotency, preservation, and cleanup', async () => {
      const db = verifyConn.db!;
      const usersCol = db.collection('users');
      const airportsCol = db.collection('airports');
      const policiesCol = db.collection('cancellationpolicies');
      const flightsCol = db.collection('flights');
      const allocationsCol = db.collection('seatallocations');
      const overridesCol = db.collection('flightseatoverrides');
      const bookingsCol = db.collection('bookings');

      // Step 2: Ensure clean baseline
      await usersCol.deleteMany({});
      await airportsCol.deleteMany({});
      await policiesCol.deleteMany({});
      await flightsCol.deleteMany({});
      await allocationsCol.deleteMany({});
      await overridesCol.deleteMany({});
      await bookingsCol.deleteMany({});

      // Step 3: Insert baseline SUPER_ADMIN user
      await usersCol.insertOne({
        username: 'superadmin_baseline',
        email: 'superadmin@baseline.test',
        password_hash: '$2b$10$hashed_superadmin_pw',
        first_name: 'Super',
        last_name: 'Admin',
        address: '100 Airline Blvd',
        phone_number: '+84999888777',
        sex: 'OTHER',
        age: 35,
        preferred_credit_card: '4111222233334444',
        sky_miles: 0,
        role: UserRole.SUPER_ADMIN,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Step 4: Insert baseline pre-existing airport record (HAN with official provenance)
      await airportsCol.insertOne({
        iata_code: 'HAN',
        city_name: 'Ha Noi',
        airport_name: 'Noi Bai International Airport (Pre-existing)',
        is_serviced_directly: true,
        time_zone: 'Asia/Ho_Chi_Minh',
        lat: 21.2212,
        lng: 105.8072,
        data_source: 'official_baseline',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Step 5: Insert baseline cancellation policies (normal SeedService policies)
      const baselinePolicies = [
        {
          min_days_before: 30,
          max_days_before: null,
          refund_percentage: 90,
          description: 'Hủy trước ngày khởi hành trên 30 ngày: hoàn 90% giá vé',
          description_en: 'Cancel > 30 days before departure: 90% refund',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          min_days_before: 15,
          max_days_before: 29,
          refund_percentage: 75,
          description: 'Hủy từ 15 đến 29 ngày trước ngày bay: hoàn 75% giá vé',
          description_en: 'Cancel 15-29 days before departure: 75% refund',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          min_days_before: 7,
          max_days_before: 14,
          refund_percentage: 50,
          description: 'Hủy từ 7 đến 14 ngày trước ngày bay: hoàn 50% giá vé',
          description_en: 'Cancel 7-14 days before departure: 50% refund',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          min_days_before: 0,
          max_days_before: 6,
          refund_percentage: 0,
          description: 'Hủy trong vòng 6 ngày trước ngày bay: không hoàn tiền (0%)',
          description_en: 'Cancel within 6 days of departure: no refund (0%)',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await policiesCol.insertMany(baselinePolicies);

      // Step 6: Record baseline counts
      const baselineUserCount = await usersCol.countDocuments();
      const baselineAirportCount = await airportsCol.countDocuments();
      const baselinePolicyCount = await policiesCol.countDocuments();
      expect(baselineUserCount).toBe(1);
      expect(baselineAirportCount).toBe(1);
      expect(baselinePolicyCount).toBe(4);

      // Step 7: Run E2E seed (Run 1)
      await run({ mongoUri: VERIFY_URI, isCleanup: false });

      // Step 8: Assert Run 1 counts and preservation
      const run1UserCount = await usersCol.countDocuments();
      const run1FlightCount = await flightsCol.countDocuments();
      const run1AllocCount = await allocationsCol.countDocuments();
      const run1OverrideCount = await overridesCol.countDocuments();
      const run1BookingCount = await bookingsCol.countDocuments();
      const run1PolicyCount = await policiesCol.countDocuments();

      expect(run1UserCount).toBe(5); // 1 baseline SUPER_ADMIN + 4 seeded E2E users
      expect(run1FlightCount).toBe(16); // 16 commercial flights
      expect(run1AllocCount).toBe(5); // 5 physical seat allocations
      expect(run1OverrideCount).toBe(1); // 1 flight seat override
      expect(run1BookingCount).toBe(3); // 3 sample bookings
      expect(run1PolicyCount).toBe(4); // 4 baseline policies untouched

      // Pre-existing airport HAN must NOT be mutated
      const hanAirport = await airportsCol.findOne({ iata_code: 'HAN' });
      expect(hanAirport?.data_source).toBe('official_baseline');
      expect((hanAirport as any)?.e2e_provenance).toBeUndefined();

      // Seeded airports must carry schema-valid data_source = 'e2e_seed'
      const seededAirports = await airportsCol.find({ data_source: 'e2e_seed' }).toArray();
      expect(seededAirports.length).toBeGreaterThan(0);
      for (const sa of seededAirports) {
        expect((sa as any).e2e_provenance).toBeUndefined();
      }

      // Step 9: Run E2E seed again (Run 2 - Idempotency test)
      await run({ mongoUri: VERIFY_URI, isCleanup: false });

      // Step 10: Assert counts match Run 1 exactly (no duplicates created)
      const run2UserCount = await usersCol.countDocuments();
      const run2FlightCount = await flightsCol.countDocuments();
      const run2AllocCount = await allocationsCol.countDocuments();
      const run2OverrideCount = await overridesCol.countDocuments();
      const run2BookingCount = await bookingsCol.countDocuments();
      const run2PolicyCount = await policiesCol.countDocuments();

      expect(run2UserCount).toBe(run1UserCount);
      expect(run2FlightCount).toBe(run1FlightCount);
      expect(run2AllocCount).toBe(run1AllocCount);
      expect(run2OverrideCount).toBe(run1OverrideCount);
      expect(run2BookingCount).toBe(run1BookingCount);
      expect(run2PolicyCount).toBe(run1PolicyCount);

      // Step 11: Run E2E cleanup
      await run({ mongoUri: VERIFY_URI, isCleanup: true });

      // Step 12: Verify cleanup integrity
      const postCleanupFlights = await flightsCol.countDocuments();
      const postCleanupBookings = await bookingsCol.countDocuments();
      const postCleanupAllocs = await allocationsCol.countDocuments();
      const postCleanupOverrides = await overridesCol.countDocuments();
      const postCleanupUsers = await usersCol.countDocuments();
      const postCleanupSuperAdmin = await usersCol.findOne({ role: UserRole.SUPER_ADMIN });
      const postCleanupPolicies = await policiesCol.countDocuments();
      const postCleanupHanAirport = await airportsCol.findOne({ iata_code: 'HAN' });
      const postCleanupSeededAirports = await airportsCol.countDocuments({ data_source: 'e2e_seed' });

      // All E2E operational entities completely purged
      expect(postCleanupFlights).toBe(0);
      expect(postCleanupBookings).toBe(0);
      expect(postCleanupAllocs).toBe(0);
      expect(postCleanupOverrides).toBe(0);

      // E2E users purged; SUPER_ADMIN completely preserved
      expect(postCleanupUsers).toBe(1);
      expect(postCleanupSuperAdmin?.username).toBe('superadmin_baseline');

      // Cancellation policies completely preserved (never deleted)
      expect(postCleanupPolicies).toBe(4);

      // Pre-existing airport intact; only e2e_seed airports removed
      expect(postCleanupHanAirport?.data_source).toBe('official_baseline');
      expect(postCleanupSeededAirports).toBe(0);
    }, 30000);
  });
});
