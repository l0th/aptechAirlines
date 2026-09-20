import mongoose, { Types } from 'mongoose';
import { FLEET_LAYOUT_CATALOG, PhysicalSeatDef, generatePhysicalSeats } from '../seat-allocation/fleet-layout.catalog';
import { SeatAllocationStatus, SeatSelectionType } from '../seat-allocation/seat-allocation.schema';

export enum MigrationBucket {
  EXPLICIT_VALID_SEAT = 'EXPLICIT_VALID_SEAT',
  MISSING_SEAT = 'MISSING_SEAT',
  DUPLICATE_CLAIM = 'DUPLICATE_CLAIM',
  AMBIGUOUS_MAPPING = 'AMBIGUOUS_MAPPING',
  INVALID_SEAT = 'INVALID_SEAT',
  CABIN_MISMATCH = 'CABIN_MISMATCH',
  UNKNOWN_LAYOUT = 'UNKNOWN_LAYOUT',
}

export async function runMigration(isDryRun = true) {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27018/airline_db';
  console.log(`\n=== PHASE B SEAT & FINANCIAL SNAPSHOT MIGRATION ===`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (Read-Only / No mutations)' : 'EXECUTE (Mutations will be committed)'}`);
  console.log(`Connecting to: ${mongoUri}...`);

  const connection = await mongoose.createConnection(mongoUri).asPromise();
  const db = connection.db;
  if (!db) {
    throw new Error('Could not obtain MongoDB database instance');
  }

  const bookingsColl = db.collection('bookings');
  const flightsColl = db.collection('flights');
  const allocationsColl = db.collection('seatallocations');
  const overridesColl = db.collection('flightseatoverrides');

  const stats = {
    totalBookingsScanned: 0,
    totalCouponsScanned: 0,
    buckets: {
      [MigrationBucket.EXPLICIT_VALID_SEAT]: 0,
      [MigrationBucket.MISSING_SEAT]: 0,
      [MigrationBucket.DUPLICATE_CLAIM]: 0,
      [MigrationBucket.AMBIGUOUS_MAPPING]: 0,
      [MigrationBucket.INVALID_SEAT]: 0,
      [MigrationBucket.CABIN_MISMATCH]: 0,
      [MigrationBucket.UNKNOWN_LAYOUT]: 0,
    },
    allocationsCreated: 0,
    bookingsUpdated: 0,
  };

  const startTime = Date.now();

  try {
    // 0. Explicit Inspection & Migration of flightseatoverrides indexes (Item 6)
    console.log('\n--- INDEX INSPECTION: flightseatoverrides ---');
    try {
      const collList = await db.listCollections({ name: 'flightseatoverrides' }).toArray();
      if (collList.length === 0 && !isDryRun) {
        await db.createCollection('flightseatoverrides');
      }
      const existingIndexes = collList.length > 0 || !isDryRun ? await overridesColl.indexes() : [];
      let legacyNonPartialFound = false;
      let legacyIndexName = '';
      let partialUniqueFound = false;

      for (const idx of existingIndexes) {
        if (idx.key && idx.key.flight_id === 1 && idx.key.seat_code === 1) {
          if (idx.unique) {
            if (idx.partialFilterExpression && idx.partialFilterExpression.is_active === true) {
              partialUniqueFound = true;
              console.log(`[INDEX] Verified partial unique active-only index present: "${idx.name}"`);
            } else {
              legacyNonPartialFound = true;
              legacyIndexName = idx.name;
              console.warn(`[INDEX] Legacy non-partial unique index detected: "${idx.name}"`);
            }
          }
        }
      }

      if (legacyNonPartialFound) {
        if (isDryRun) {
          console.log(
            `[INDEX] [DRY-RUN] Legacy non-partial unique index "${legacyIndexName}" detected. Will be dropped and recreated as partial unique during --execute.`,
          );
        } else {
          console.log(`[INDEX] Dropping obsolete non-partial unique index "${legacyIndexName}"...`);
          await overridesColl.dropIndex(legacyIndexName);
          console.log(`[INDEX] Dropped index "${legacyIndexName}" successfully.`);
        }
      }

      if (!isDryRun) {
        if (!partialUniqueFound || legacyNonPartialFound) {
          console.log(
            `[INDEX] Creating partial unique active-only index { flight_id: 1, seat_code: 1 } with partialFilterExpression: { is_active: true }...`,
          );
          await overridesColl.createIndex(
            { flight_id: 1, seat_code: 1 },
            { unique: true, partialFilterExpression: { is_active: true } },
          );
        }

        // Post-migration strict verification
        const rechecked = await overridesColl.indexes();
        const verifiedPartial = rechecked.some(
          (idx) =>
            idx.key?.flight_id === 1 &&
            idx.key?.seat_code === 1 &&
            idx.unique &&
            idx.partialFilterExpression?.is_active === true,
        );
        const legacyRemaining = rechecked.some(
          (idx) =>
            idx.key?.flight_id === 1 &&
            idx.key?.seat_code === 1 &&
            idx.unique &&
            (!idx.partialFilterExpression || idx.partialFilterExpression.is_active !== true),
        );

        if (!verifiedPartial) {
          throw new Error('Failed to verify partial unique active-only index on flightseatoverrides');
        }
        if (legacyRemaining) {
          throw new Error('Legacy non-partial unique index is still present on flightseatoverrides after migration');
        }
        console.log(`[INDEX] Partial unique active-only index is verified and legacy non-partial index is absent.`);
      } else if (partialUniqueFound && !legacyNonPartialFound) {
        console.log(`[INDEX] Partial unique active-only index is verified and healthy.`);
      }
    } catch (idxErr: any) {
      if (!isDryRun) {
        throw idxErr;
      }
      console.warn(`[INDEX] Notice during index inspection: ${idxErr?.message || idxErr}`);
    }

    // 1. Cache flights for layout lookup
    const flights = await flightsColl.find({}).toArray();
    const flightMap = new Map<string, any>();
    for (const f of flights) {
      flightMap.set(f._id.toString(), f);
    }

    // 2. Track existing allocations in DB
    const existingAllocations = await allocationsColl.find({}).toArray();
    const existingAllocMap = new Map<string, any>();
    const flightOccupiedSeats = new Map<string, Set<string>>();

    for (const alloc of existingAllocations) {
      const fKey = alloc.flight_id.toString();
      const seatKey = `${fKey}_${alloc.seat_code.toUpperCase()}`;
      existingAllocMap.set(seatKey, alloc);
      if (!flightOccupiedSeats.has(fKey)) {
        flightOccupiedSeats.set(fKey, new Set());
      }
      flightOccupiedSeats.get(fKey)!.add(alloc.seat_code.toUpperCase());
    }

    // 3. Scan ONLY active bookings (BLOCKED or CONFIRMED)
    const bookings = await bookingsColl
      .find({ status: { $in: ['BLOCKED', 'CONFIRMED'] } })
      .toArray();
    stats.totalBookingsScanned = bookings.length;

    // 4. PRE-SCAN: Count claims per (flight_id, seat_code) across active coupons to catch duplicates
    const claimCounts = new Map<string, number>();
    for (const booking of bookings) {
      for (const coupon of booking.ticket_coupons || []) {
        const rawSeat = (coupon.seat_code || '').trim().toUpperCase();
        if (rawSeat && coupon.flight_id) {
          const claimKey = `${coupon.flight_id.toString()}_${rawSeat}`;
          claimCounts.set(claimKey, (claimCounts.get(claimKey) || 0) + 1);

          // If DB already has an allocation for this seat belonging to another booking/coupon, treat as conflict
          const existing = existingAllocMap.get(claimKey);
          if (
            existing &&
            (existing.booking_id?.toString() !== booking._id.toString() ||
              (existing.coupon_number && existing.coupon_number !== coupon.coupon_number))
          ) {
            claimCounts.set(claimKey, (claimCounts.get(claimKey) || 0) + 1);
          }
        }
      }
    }

    const plannedAllocations: any[] = [];
    const plannedBookingUpdates: Array<{ id: any; update: any }> = [];

    // 5. Process each active booking
    for (const booking of bookings) {
      let bookingModified = false;
      const bookingUpdate: any = {};
      const coupons = booking.ticket_coupons || [];
      const updatedCoupons = [...coupons];

      // Frequency map of coupon numbers within this booking to catch duplicate coupon identity
      const couponNumberCounts = new Map<string, number>();
      for (const c of coupons) {
        const cNum = (c.coupon_number || '').trim();
        if (cNum) {
          couponNumberCounts.set(cNum, (couponNumberCounts.get(cNum) || 0) + 1);
        }
      }

      // Backfill financial snapshots if missing
      if (booking.total_fare === undefined || booking.total_fare === null) {
        bookingUpdate.total_fare = booking.total_amount || 0;
        bookingUpdate.total_seat_fees = 0;
        bookingModified = true;
      }

      for (let cIdx = 0; cIdx < coupons.length; cIdx++) {
        const coupon = coupons[cIdx];
        stats.totalCouponsScanned++;

        const flightIdStr = coupon.flight_id?.toString();
        const flight = flightIdStr ? flightMap.get(flightIdStr) : null;
        const aircraftCode = flight?.aircraft?.model_code;
        const layout = aircraftCode ? FLEET_LAYOUT_CATALOG[aircraftCode] : null;

        // Check TRUE AMBIGUOUS MAPPING (Item 7) before layout lookup
        const rawSeat = (coupon.seat_code || '').trim().toUpperCase();
        let isAmbiguous = false;
        let ambiguityReason = '';

        if (!coupon.coupon_number || !coupon.coupon_number.trim()) {
          isAmbiguous = true;
          ambiguityReason = 'Missing coupon_number identity on ticket coupon';
        } else if ((couponNumberCounts.get(coupon.coupon_number.trim()) || 0) > 1) {
          isAmbiguous = true;
          ambiguityReason = `Duplicate coupon_number "${coupon.coupon_number}" found multiple times within booking`;
        } else if (!coupon.flight_id) {
          isAmbiguous = true;
          ambiguityReason = 'Coupon has missing flight_id association';
        } else if (
          booking.legs &&
          booking.legs.length > 0 &&
          !booking.legs.some((leg: any) => leg.flight_id?.toString() === flightIdStr)
        ) {
          isAmbiguous = true;
          ambiguityReason = `Coupon flight_id ${flightIdStr} does not match any leg on booking`;
        } else if (
          rawSeat &&
          (rawSeat.includes(',') ||
            rawSeat.includes('/') ||
            rawSeat.includes(' ') ||
            rawSeat.includes(';') ||
            rawSeat.includes('-'))
        ) {
          isAmbiguous = true;
          ambiguityReason = `Malformed seat string "${rawSeat}" containing delimiters`;
        } else if (booking.passengers && booking.passengers.length > 1 && !coupon.passenger_name) {
          isAmbiguous = true;
          ambiguityReason = 'Coupon lacks passenger_name association in multi-passenger booking';
        }

        if (isAmbiguous) {
          stats.buckets[MigrationBucket.AMBIGUOUS_MAPPING]++;
          console.warn(
            `[UNRESOLVED:AMBIGUOUS_MAPPING] PNR: ${booking.pnr_code || 'NONE'} / Booking: ${booking._id}, Coupon: ${coupon.coupon_number || 'MISSING'}, Flight: ${flightIdStr || 'MISSING'}, Reason: ${ambiguityReason}`,
          );
          // INVARIANT: Never AUTO assign ambiguity. Keep unresolved.
          continue;
        }

        if (!flight || !layout || !aircraftCode) {
          stats.buckets[MigrationBucket.UNKNOWN_LAYOUT]++;
          console.warn(
            `[UNRESOLVED:UNKNOWN_LAYOUT] PNR: ${booking.pnr_code || 'NONE'} / Booking: ${booking._id}, Coupon: ${coupon.coupon_number}, Flight: ${flightIdStr}, Reason: Aircraft code "${aircraftCode || 'NONE'}" not found in catalog`,
          );
          continue; // Unresolved
        }

        if (!flightOccupiedSeats.has(flightIdStr)) {
          flightOccupiedSeats.set(flightIdStr, new Set());
        }
        const occupiedSet = flightOccupiedSeats.get(flightIdStr)!;

        const physicalSeats = generatePhysicalSeats(aircraftCode);
        const cabinClass = coupon.cabin_class || 'ECONOMY';
        let classification: MigrationBucket;

        if (!rawSeat) {
          classification = MigrationBucket.MISSING_SEAT;
        } else {
          const claimKey = `${flightIdStr}_${rawSeat}`;
          const isDuplicate = (claimCounts.get(claimKey) || 0) > 1;

          if (isDuplicate) {
            classification = MigrationBucket.DUPLICATE_CLAIM;
          } else {
            const physicalSeat = physicalSeats.find((s) => s.seat_code.toUpperCase() === rawSeat);
            if (!physicalSeat) {
              classification = MigrationBucket.INVALID_SEAT;
            } else if (physicalSeat.cabin_class !== cabinClass) {
              classification = MigrationBucket.CABIN_MISMATCH;
            } else {
              classification = MigrationBucket.EXPLICIT_VALID_SEAT;
            }
          }
        }

        stats.buckets[classification]++;

        if (
          classification !== MigrationBucket.EXPLICIT_VALID_SEAT &&
          classification !== MigrationBucket.MISSING_SEAT
        ) {
          console.warn(
            `[UNRESOLVED:${classification}] PNR: ${booking.pnr_code || 'NONE'} / Booking: ${booking._id}, Coupon: ${coupon.coupon_number}, Flight: ${flightIdStr}, Seat: "${rawSeat}", Cabin: ${cabinClass}`,
          );
        }

        // INVARIANT: ONLY EXPLICIT_VALID_SEAT and MISSING_SEAT can resolve to an allocation!
        // DUPLICATE_CLAIM, AMBIGUOUS_MAPPING, INVALID_SEAT, CABIN_MISMATCH, UNKNOWN_LAYOUT remain UNRESOLVED.
        let assignedSeat = '';
        let selectionType: SeatSelectionType = SeatSelectionType.AUTO;

        if (classification === MigrationBucket.EXPLICIT_VALID_SEAT) {
          assignedSeat = rawSeat;
          selectionType = SeatSelectionType.CHOOSE;
        } else if (classification === MigrationBucket.MISSING_SEAT) {
          // Deterministic AUTO assignment for missing seat with valid cabin & layout
          const availableSeat = physicalSeats.find(
            (s) => s.cabin_class === cabinClass && !occupiedSet.has(s.seat_code.toUpperCase()),
          );
          if (availableSeat) {
            assignedSeat = availableSeat.seat_code.toUpperCase();
            selectionType = SeatSelectionType.AUTO;
          }
        }

        if (assignedSeat) {
          occupiedSet.add(assignedSeat);

          const allocStatus =
            booking.status === 'BLOCKED' ? SeatAllocationStatus.HELD : SeatAllocationStatus.CONFIRMED;

          const snapshotData = {
            rule_ids: [],
            dimensions: ['MIGRATION_BASELINE'],
            flight_override: false,
            final_fee: 0,
          };

          plannedAllocations.push({
            flight_id: new Types.ObjectId(flightIdStr),
            seat_code: assignedSeat,
            booking_id: booking._id,
            coupon_number: coupon.coupon_number,
            passenger_name: coupon.passenger_name || 'Passenger',
            cabin_class: cabinClass,
            seat_selection_type: selectionType,
            status: allocStatus,
            seat_fee: 0,
            seat_fee_currency: 'VND',
            seat_pricing_snapshot: snapshotData,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          stats.allocationsCreated++;

          // Update coupon snapshot with canonical schema fields (Item 8)
          updatedCoupons[cIdx] = {
            ...coupon,
            seat_code: assignedSeat,
            seat_selection_type: selectionType,
            seat_fee: 0,
            seat_fee_currency: 'VND',
            seat_pricing_snapshot: snapshotData,
          };
          bookingModified = true;
        }
      }

      if (bookingModified) {
        bookingUpdate.ticket_coupons = updatedCoupons;
        plannedBookingUpdates.push({ id: booking._id, update: bookingUpdate });
      }
    }

    if (!isDryRun) {
      // Execute DB mutations
      if (plannedAllocations.length > 0) {
        // Insert allocations ignoring duplicates if re-run
        for (const alloc of plannedAllocations) {
          try {
            await allocationsColl.updateOne(
              { flight_id: alloc.flight_id, seat_code: alloc.seat_code },
              { $setOnInsert: alloc },
              { upsert: true },
            );
          } catch (_) {}
        }
      }

      for (const bUp of plannedBookingUpdates) {
        await bookingsColl.updateOne({ _id: bUp.id }, { $set: bUp.update });
        stats.bookingsUpdated++;
      }
    }

    const duration = Date.now() - startTime;

    console.log(`\n=== MIGRATION SUMMARY ===`);
    console.log(`Execution Duration: ${duration}ms`);
    console.log(`Total Bookings Scanned: ${stats.totalBookingsScanned}`);
    console.log(`Total Coupons Scanned:  ${stats.totalCouponsScanned}`);
    console.log(`\n--- Classification Breakdown ---`);
    console.log(`  EXPLICIT_VALID_SEAT : ${stats.buckets[MigrationBucket.EXPLICIT_VALID_SEAT]}`);
    console.log(`  MISSING_SEAT        : ${stats.buckets[MigrationBucket.MISSING_SEAT]}`);
    console.log(`  DUPLICATE_CLAIM     : ${stats.buckets[MigrationBucket.DUPLICATE_CLAIM]}`);
    console.log(`  AMBIGUOUS_MAPPING   : ${stats.buckets[MigrationBucket.AMBIGUOUS_MAPPING]}`);
    console.log(`  INVALID_SEAT        : ${stats.buckets[MigrationBucket.INVALID_SEAT]}`);
    console.log(`  CABIN_MISMATCH      : ${stats.buckets[MigrationBucket.CABIN_MISMATCH]}`);
    console.log(`  UNKNOWN_LAYOUT      : ${stats.buckets[MigrationBucket.UNKNOWN_LAYOUT]}`);
    console.log(`\n--- Actions ---`);
    console.log(`  Planned Allocations : ${stats.allocationsCreated}`);
    console.log(
      `  Bookings Updated    : ${isDryRun ? `${plannedBookingUpdates.length} (Dry-Run only)` : stats.bookingsUpdated}`,
    );
    console.log(`\nResult: SUCCESS (${isDryRun ? 'DRY-RUN COMPLETE' : 'COMMITTED TO DATABASE'})\n`);

    return stats;
  } finally {
    await connection.close();
  }
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute || args.includes('--dry-run');

  runMigration(isDryRun)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
