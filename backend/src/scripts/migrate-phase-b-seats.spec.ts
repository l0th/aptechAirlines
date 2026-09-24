import mongoose, { Types } from 'mongoose';
import { runMigration, MigrationBucket } from './migrate-phase-b-seats';
import { FlightSeatOverrideSchema } from '../seat-allocation/flight-seat-override.schema';

describe('Phase B Migration & Partial Unique Index Spec', () => {
  const testMongoUri = process.env.MONGO_TEST_URI || process.env.TEST_MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/airline_db_migration_test';
  let connection: mongoose.Connection;

  beforeAll(async () => {
    process.env.MONGO_URI = testMongoUri;
    connection = await mongoose.createConnection(testMongoUri).asPromise();
  });

  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });

  beforeEach(async () => {
    const collections = await connection.db!.collections();
    for (const c of collections) {
      await c.deleteMany({});
    }
  });

  describe('1. Seven Migration Classification Buckets & True Ambiguity Detection', () => {
    it('classifies all 7 buckets accurately and keeps unresolved coupons without auto-assignment', async () => {
      const db = connection.db!;
      const flightsColl = db.collection('flights');
      const bookingsColl = db.collection('bookings');

      // 1. Create a reference flight with A20N aircraft
      const flightId = new Types.ObjectId();
      await flightsColl.insertOne({
        _id: flightId,
        flight_number: 'AP-101',
        aircraft: { model_code: 'A20N', model_name: 'Airbus A320neo' },
      });

      // 2. Create bookings exercising all 7 classification scenarios
      const legObj = { flight_id: flightId, leg_type: 'OUTBOUND' };

      // Case A: EXPLICIT_VALID_SEAT (e.g. 1A Business, 4A Economy)
      const b1 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-001',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'John Doe' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-001',
            flight_id: flightId,
            seat_code: '1A',
            cabin_class: 'BUSINESS',
            passenger_name: 'John Doe',
          },
        ],
      };

      // Case B: MISSING_SEAT (empty seat string -> deterministic AUTO)
      const b2 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-002',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Jane Doe' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-002',
            flight_id: flightId,
            seat_code: '',
            cabin_class: 'ECONOMY',
            passenger_name: 'Jane Doe',
          },
        ],
      };

      // Case C: DUPLICATE_CLAIM (two bookings claiming same 4A)
      const b3 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-003',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Claimant 1' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-003',
            flight_id: flightId,
            seat_code: '4A',
            cabin_class: 'ECONOMY',
            passenger_name: 'Claimant 1',
          },
        ],
      };
      const b4 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-004',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Claimant 2' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-004',
            flight_id: flightId,
            seat_code: '4A',
            cabin_class: 'ECONOMY',
            passenger_name: 'Claimant 2',
          },
        ],
      };

      // Case D: AMBIGUOUS_MAPPING (Item 7: malformed seat string / missing identity / duplicate coupon)
      const b5 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-005',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Ambiguous User' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-005',
            flight_id: flightId,
            seat_code: '12A,12B', // Malformed with comma
            cabin_class: 'ECONOMY',
            passenger_name: 'Ambiguous User',
          },
          {
            coupon_number: '', // Missing coupon number
            flight_id: flightId,
            seat_code: '5A',
            cabin_class: 'ECONOMY',
            passenger_name: 'Ambiguous User',
          },
        ],
      };

      // Case E: INVALID_SEAT (e.g. Row 99 or seat code that doesn't exist on A20N)
      const b6 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-006',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Invalid User' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-006',
            flight_id: flightId,
            seat_code: '99Z',
            cabin_class: 'ECONOMY',
            passenger_name: 'Invalid User',
          },
        ],
      };

      // Case F: CABIN_MISMATCH (e.g. physical seat 1A is BUSINESS, but coupon says ECONOMY)
      const b7 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-007',
        status: 'CONFIRMED',
        legs: [legObj],
        passengers: [{ passenger_name: 'Mismatch User' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-007',
            flight_id: flightId,
            seat_code: '2A', // Physical seat 2A is BUSINESS on A20N
            cabin_class: 'ECONOMY', // Coupon claims ECONOMY
            passenger_name: 'Mismatch User',
          },
        ],
      };

      // Case G: UNKNOWN_LAYOUT (Flight with unknown aircraft code)
      const unknownFlightId = new Types.ObjectId();
      await flightsColl.insertOne({
        _id: unknownFlightId,
        flight_number: 'AP-999',
        aircraft: { model_code: 'UNKNOWN_99', model_name: 'Experimental Plane' },
      });
      const b8 = {
        _id: new Types.ObjectId(),
        pnr_code: 'PNR-008',
        status: 'CONFIRMED',
        legs: [{ flight_id: unknownFlightId, leg_type: 'OUTBOUND' }],
        passengers: [{ passenger_name: 'Alien User' }],
        ticket_coupons: [
          {
            coupon_number: 'CPN-008',
            flight_id: unknownFlightId,
            seat_code: '1A',
            cabin_class: 'ECONOMY',
            passenger_name: 'Alien User',
          },
        ],
      };

      await bookingsColl.insertMany([b1, b2, b3, b4, b5, b6, b7, b8]);

      // Run dry-run migration
      const dryRunStats = await runMigration(true);

      expect(dryRunStats.buckets[MigrationBucket.EXPLICIT_VALID_SEAT]).toBeGreaterThanOrEqual(1);
      expect(dryRunStats.buckets[MigrationBucket.MISSING_SEAT]).toBeGreaterThanOrEqual(1);
      expect(dryRunStats.buckets[MigrationBucket.DUPLICATE_CLAIM]).toBeGreaterThanOrEqual(2); // b3 & b4
      expect(dryRunStats.buckets[MigrationBucket.AMBIGUOUS_MAPPING]).toBeGreaterThanOrEqual(2); // b5 has 2 ambiguous coupons
      expect(dryRunStats.buckets[MigrationBucket.INVALID_SEAT]).toBeGreaterThanOrEqual(1); // b6
      expect(dryRunStats.buckets[MigrationBucket.CABIN_MISMATCH]).toBeGreaterThanOrEqual(1); // b7
      expect(dryRunStats.buckets[MigrationBucket.UNKNOWN_LAYOUT]).toBeGreaterThanOrEqual(1); // b8

      // In dry-run: no seatallocations inserted
      const dryAllocCount = await db.collection('seatallocations').countDocuments();
      expect(dryAllocCount).toBe(0);

      // Now run execute migration
      const execStats = await runMigration(false);
      expect(execStats.allocationsCreated).toBe(
        execStats.buckets[MigrationBucket.EXPLICIT_VALID_SEAT] +
          execStats.buckets[MigrationBucket.MISSING_SEAT],
      );

      // Verify ONLY EXPLICIT_VALID_SEAT and MISSING_SEAT were allocated!
      // DUPLICATE_CLAIM, AMBIGUOUS_MAPPING, INVALID_SEAT, CABIN_MISMATCH, UNKNOWN_LAYOUT remain UNRESOLVED!
      const totalAllocated = await db.collection('seatallocations').countDocuments();
      expect(totalAllocated).toBe(execStats.allocationsCreated);

      // Verify ambiguous coupon in b5 has NO allocation
      const b5Alloc = await db.collection('seatallocations').findOne({ booking_id: b5._id });
      expect(b5Alloc).toBeNull();
    });
  });

  describe('2. FlightSeatOverride Partial Unique Index Migration (Item 6)', () => {
    it('executes real migration starting with legacy non-partial index, drops legacy, creates partial index, and supports inactive+active successor while rejecting duplicate active', async () => {
      const db = connection.db!;
      const overridesColl = db.collection('flightseatoverrides');

      // Drop all existing indexes first (except default _id)
      try { await overridesColl.dropIndexes(); } catch (_) {}

      // 1. Install legacy non-partial unique index
      await overridesColl.createIndex(
        { flight_id: 1, seat_code: 1 },
        { unique: true, name: 'flight_id_1_seat_code_1_legacy' },
      );

      // Verify legacy index exists and has no partialFilterExpression
      const initialIndexes = await overridesColl.indexes();
      const legacyIdx = initialIndexes.find((idx) => idx.name === 'flight_id_1_seat_code_1_legacy');
      expect(legacyIdx).toBeDefined();
      expect(legacyIdx?.unique).toBe(true);
      expect(legacyIdx?.partialFilterExpression).toBeUndefined();

      // 2. Execute migration (isDryRun = false)
      await runMigration(false);

      // 3. Verify post-migration index state:
      const postIndexes = await overridesColl.indexes();
      const legacyRemaining = postIndexes.some(
        (idx) =>
          idx.key?.flight_id === 1 &&
          idx.key?.seat_code === 1 &&
          idx.unique &&
          (!idx.partialFilterExpression || idx.partialFilterExpression.is_active !== true),
      );
      const partialIndex = postIndexes.find(
        (idx) =>
          idx.key?.flight_id === 1 &&
          idx.key?.seat_code === 1 &&
          idx.unique &&
          idx.partialFilterExpression?.is_active === true,
      );
      expect(legacyRemaining).toBe(false);
      expect(partialIndex).toBeDefined();
      expect(partialIndex?.partialFilterExpression).toEqual({ is_active: true });

      // 4. Test successor pattern: insert inactive override, followed by active override for same flight+seat
      const flightId = new Types.ObjectId();
      const seatCode = '14B';

      const inactiveOverride = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 50000,
        reason: 'Archived promotional fee',
        is_active: false,
        created_at: new Date(Date.now() - 100000),
      };
      await overridesColl.insertOne(inactiveOverride);

      const activeOverride = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 90000,
        reason: 'Current active override',
        is_active: true,
        created_at: new Date(),
      };
      // Inactive followed by active MUST succeed without collision
      await expect(overridesColl.insertOne(activeOverride)).resolves.toBeDefined();

      // 5. Test duplicate active rejection: inserting another active for same flight+seat MUST throw E11000
      const duplicateActive = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 110000,
        reason: 'Colliding second active override',
        is_active: true,
        created_at: new Date(),
      };
      await expect(overridesColl.insertOne(duplicateActive)).rejects.toThrow();
    });

    it('proves deactivating an override allows creating successor active override for same flight+seat without E11000', async () => {
      const db = connection.db!;
      const overridesColl = db.collection('flightseatoverrides');

      // 1. Ensure partial unique active-only index is created
      await overridesColl.createIndex(
        { flight_id: 1, seat_code: 1 },
        { unique: true, partialFilterExpression: { is_active: true } },
      );

      const flightId = new Types.ObjectId();
      const seatCode = '12A';

      // 2. Create active override for flight+seat
      const override1 = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 100000,
        reason: 'Initial high demand',
        is_active: true,
        created_at: new Date(),
      };
      await overridesColl.insertOne(override1);

      // Trying to insert another active override for the same flight+seat must throw duplicate key error E11000
      const duplicateActive = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 120000,
        reason: 'Duplicate active attempt',
        is_active: true,
        created_at: new Date(),
      };
      await expect(overridesColl.insertOne(duplicateActive)).rejects.toThrow();

      // 3. Deactivate the first override
      await overridesColl.updateOne(
        { _id: override1._id },
        { $set: { is_active: false, deactivated_at: new Date() } },
      );

      // 4. Create successor active override for the same flight+seat
      const successorActive = {
        _id: new Types.ObjectId(),
        flight_id: flightId,
        seat_code: seatCode,
        override_fee: 150000,
        reason: 'Successor adjustment after deactivation',
        is_active: true,
        created_at: new Date(),
      };
      await overridesColl.insertOne(successorActive);

      // 5. Verify invariant: both documents remain in database, exactly one is active, no E11000 error
      const allOverrides = await overridesColl.find({ flight_id: flightId, seat_code: seatCode }).toArray();
      expect(allOverrides.length).toBe(2);

      const activeList = allOverrides.filter((o) => o.is_active === true);
      const inactiveList = allOverrides.filter((o) => o.is_active === false);
      expect(activeList.length).toBe(1);
      expect(inactiveList.length).toBe(1);
      expect(activeList[0].override_fee).toBe(150000);
      expect(inactiveList[0].override_fee).toBe(100000);
    });
  });
});
