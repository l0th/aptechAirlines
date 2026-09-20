import * as mongoose from 'mongoose';
import { loadOurAirportsReferenceData, haversineDistanceKm } from '../airports/ourairports.loader';
import { CURATED_NEAREST_OVERLAYS } from '../airports/airports-reference.data';
import { CANONICAL_AIRCRAFT_TYPES, APTECH_FLIGHT_TEMPLATES } from '../flights/flight-templates.catalog';
import { localWallTimeToUtc, localDateKey } from '../common/timezone.util';
import { CabinClass, FlightStatus } from '../flights/flights.schema';

const CHUNK_SIZE = 1000;
const HORIZON_DAYS = 330;

function calculateGreatCircleMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function getAircraftMetadata(aircraftType: string) {
  if (!CANONICAL_AIRCRAFT_TYPES.includes(aircraftType as any)) {
    throw new Error(
      `Invalid aircraft type: "${aircraftType}". Must be one of canonical types: ${CANONICAL_AIRCRAFT_TYPES.join(', ')}`,
    );
  }
  switch (aircraftType) {
    case 'A20N':
      return {
        model_name: 'Airbus A320neo',
        total_capacity: 180,
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 12, price_factor: 2.2 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 168, price_factor: 1.0 },
        ],
      };
    case 'A21N':
      return {
        model_name: 'Airbus A321neo',
        total_capacity: 204,
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 16, price_factor: 2.2 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 188, price_factor: 1.0 },
        ],
      };
    case 'B789':
      return {
        model_name: 'Boeing 787-9 Dreamliner',
        total_capacity: 294,
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 28, price_factor: 2.5 },
          { cabin_class: CabinClass.CLUB, allocated_seats: 35, price_factor: 1.45 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 231, price_factor: 1.0 },
        ],
      };
    case 'A359':
      return {
        model_name: 'Airbus A350-900',
        total_capacity: 305,
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 29, price_factor: 2.5 },
          { cabin_class: CabinClass.CLUB, allocated_seats: 36, price_factor: 1.45 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 240, price_factor: 1.0 },
        ],
      };
    case 'B738':
      return {
        model_name: 'Boeing 737-800',
        total_capacity: 166,
        inventories: [
          { cabin_class: CabinClass.BUSINESS, allocated_seats: 16, price_factor: 2.2 },
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 150, price_factor: 1.0 },
        ],
      };
    case 'AT76':
      return {
        model_name: 'ATR 72-600',
        total_capacity: 68,
        inventories: [
          { cabin_class: CabinClass.ECONOMY, allocated_seats: 68, price_factor: 1.0 },
        ],
      };
    default:
      throw new Error(`Unhandled canonical aircraft type: ${aircraftType}`);
  }
}

async function run() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.TEST_MONGO_URI ||
    'mongodb://localhost:27017/airline_db';

  console.log(`================================================================`);
  console.log(`✈️  APTECH AIRLINES ARS: PHASE A SEED & 330-DAY FLIGHT GENERATOR`);
  console.log(`================================================================`);
  console.log(`Connecting to MongoDB at: ${mongoUri}...`);

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const airportsCol = db.collection('airports');
  const templatesCol = db.collection('scheduletemplates');
  const flightsCol = db.collection('flights');
  const routerefsCol = db.collection('routerefs');

  // ============================================================================
  // STEP 1: REAL AIRPORT REFERENCE IMPORT & ENRICHMENT
  // ============================================================================
  console.log(`\n[1/6] Importing & Enriching Airport Reference Dataset from OurAirports...`);
  const { airports: referenceAirports, totalParsed, validIataCount } = await loadOurAirportsReferenceData();
  console.log(`   Parsed ${totalParsed} facilities, identified ${validIataCount} valid IATA facilities, prepared ${referenceAirports.length} unique airport records.`);

  const airportBulkOps = referenceAirports.map((item) => ({
    updateOne: {
      filter: { iata_code: item.iata_code.toUpperCase() },
      update: {
        $setOnInsert: {
          iata_code: item.iata_code.toUpperCase(),
          is_serviced_directly: item.is_serviced_directly ?? false,
        },
        $set: {
          airport_name: item.airport_name,
          city_name: item.city_name,
          country_code: item.country_code,
          city_code: item.city_code || item.iata_code,
          icao_code: item.icao_code || '',
          lat: item.lat,
          lng: item.lng,
          time_zone: item.time_zone,
          nearest_airport_code: item.nearest_airport_code || '',
          distance_to_nearest_km: item.distance_to_nearest_km || 0,
          data_source: item.data_source || 'ourairports',
        },
      },
      upsert: true,
    },
  }));

  let airportUpserted = 0;
  let airportModified = 0;
  for (let i = 0; i < airportBulkOps.length; i += CHUNK_SIZE) {
    const chunk = airportBulkOps.slice(i, i + CHUNK_SIZE);
    const res = await airportsCol.bulkWrite(chunk, { ordered: false });
    airportUpserted += res.upsertedCount;
    airportModified += res.modifiedCount;
  }
  console.log(
    `✅ Airport Reference: ${referenceAirports.length} processed (${airportUpserted} inserted, ${airportModified} enriched).`,
  );

  // ============================================================================
  // STEP 2: SYNCHRONIZE SCHEDULE TEMPLATES CATALOG
  // ============================================================================
  console.log(`\n[2/6] Synchronizing Aptech Operational Schedule Templates...`);
  const templateBulkOps = APTECH_FLIGHT_TEMPLATES.map((tpl) => ({
    updateOne: {
      filter: { template_id: tpl.template_id },
      update: {
        $set: {
          flight_number: tpl.flight_number,
          origin_iata: tpl.origin_iata,
          dest_iata: tpl.dest_iata,
          std_dep_time: tpl.std_dep_time,
          std_arr_time: tpl.std_arr_time,
          days_of_week: tpl.days_of_week,
          aircraft_type: tpl.aircraft_type,
          cabin_classes: tpl.cabin_classes,
          base_price_economy: tpl.base_price_economy,
          base_price_business: tpl.base_price_business,
          base_price_club: tpl.base_price_club,
          base_price_first: tpl.base_price_first,
          is_active: true,
        },
      },
      upsert: true,
    },
  }));

  const templateRes = await templatesCol.bulkWrite(templateBulkOps, { ordered: false });
  console.log(
    `✅ Schedule Templates: ${APTECH_FLIGHT_TEMPLATES.length} synchronized (${templateRes.upsertedCount} new, ${templateRes.modifiedCount} updated).`,
  );

  // ============================================================================
  // STEP 3: ENFORCE SERVICED AIRPORTS SEMANTICS & COMPUTE NEAREST SERVICED HUBS
  // ============================================================================
  console.log(`\n[3/6] Applying Serviced Airport Semantics & Computing Nearest Hubs...`);
  const activeHubs = new Set<string>();
  for (const t of APTECH_FLIGHT_TEMPLATES) {
    activeHubs.add(t.origin_iata);
    activeHubs.add(t.dest_iata);
  }
  const activeHubsArray = Array.from(activeHubs);

  await airportsCol.updateMany(
    { iata_code: { $in: activeHubsArray } },
    { $set: { is_serviced_directly: true, nearest_airport_code: '', distance_to_nearest_km: 0 } },
  );

  const airportDocs = await airportsCol.find({}).toArray();
  const activeHubCoords: { iata: string; lat: number; lng: number }[] = [];
  for (const hubIata of activeHubsArray) {
    const hubDoc = airportDocs.find((a) => a.iata_code === hubIata);
    if (hubDoc && typeof hubDoc.lat === 'number' && typeof hubDoc.lng === 'number') {
      activeHubCoords.push({ iata: hubIata, lat: hubDoc.lat, lng: hubDoc.lng });
    }
  }

  console.log(`✅ Marked ${activeHubsArray.length} active Aptech route hubs as is_serviced_directly = true.`);
  console.log(`   Hubs: ${activeHubsArray.join(', ')}`);

  // Compute nearest served Aptech hub for EVERY unserved airport
  const unservedUpdateOps: any[] = [];
  let unservedWithNearest = 0;
  let unservedMissingNearest = 0;

  for (const apt of airportDocs) {
    if (activeHubsArray.includes(apt.iata_code)) continue;

    let nearestHub = '';
    let distanceKm = 0;

    if (CURATED_NEAREST_OVERLAYS[apt.iata_code]) {
      nearestHub = CURATED_NEAREST_OVERLAYS[apt.iata_code].nearest_airport_code;
      distanceKm = CURATED_NEAREST_OVERLAYS[apt.iata_code].distance_to_nearest_km;
    } else if (
      typeof apt.lat === 'number' &&
      typeof apt.lng === 'number' &&
      !isNaN(apt.lat) &&
      !isNaN(apt.lng) &&
      activeHubCoords.length > 0
    ) {
      let minDist = haversineDistanceKm(apt.lat, apt.lng, activeHubCoords[0].lat, activeHubCoords[0].lng);
      nearestHub = activeHubCoords[0].iata;

      for (let i = 1; i < activeHubCoords.length; i++) {
        const d = haversineDistanceKm(apt.lat, apt.lng, activeHubCoords[i].lat, activeHubCoords[i].lng);
        if (d < minDist) {
          minDist = d;
          nearestHub = activeHubCoords[i].iata;
        }
      }
      distanceKm = Math.max(1, minDist);
    }

    if (nearestHub && distanceKm > 0) {
      unservedWithNearest++;
    } else {
      unservedMissingNearest++;
    }

    unservedUpdateOps.push({
      updateOne: {
        filter: { iata_code: apt.iata_code },
        update: {
          $set: {
            is_serviced_directly: false,
            nearest_airport_code: nearestHub,
            distance_to_nearest_km: distanceKm,
          },
        },
      },
    });
  }

  for (let i = 0; i < unservedUpdateOps.length; i += CHUNK_SIZE) {
    const chunk = unservedUpdateOps.slice(i, i + CHUNK_SIZE);
    await airportsCol.bulkWrite(chunk, { ordered: false });
  }

  console.log(`✅ Unserved Airports with valid nearest mapping: ${unservedWithNearest}`);
  console.log(`ℹ️ Unserved Airports missing nearest mapping: ${unservedMissingNearest} (expected 0 for valid coordinates)`);

  const refreshedAirports = await airportsCol.find({}).toArray();
  const airportMap = new Map<string, any>();
  for (const apt of refreshedAirports) {
    airportMap.set(apt.iata_code.toUpperCase(), apt);
  }

  // ============================================================================
  // STEP 4: SYNCHRONIZE ROUTEREF GRAPH EDGES & PER-ORIGIN ROUTESYNCSTATE
  // ============================================================================
  console.log(`\n[4/6] Synchronizing RouteRef Graph Edges & Internal RouteSyncState...`);
  const DOW_NAMES = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const routeRefOps = APTECH_FLIGHT_TEMPLATES.map((tpl) => {
    const originApt = airportMap.get(tpl.origin_iata);
    const destApt = airportMap.get(tpl.dest_iata);
    const originTz = originApt?.time_zone || 'Asia/Ho_Chi_Minh';
    const destTz = destApt?.time_zone || 'Asia/Ho_Chi_Minh';

    const depUtc = localWallTimeToUtc('2026-09-23', tpl.std_dep_time, originTz);
    const depTimeUtc = `${String(depUtc.getUTCHours()).padStart(2, '0')}:${String(depUtc.getUTCMinutes()).padStart(2, '0')}`;

    let bestArrUtc: Date | null = null;
    let minDur = Infinity;
    for (const offset of [0, 1, 2]) {
      const cDate = new Date(new Date('2026-09-23T00:00:00+07:00').getTime() + offset * 86400000);
      const cDateStr = localDateKey(cDate, destTz);
      const cArrUtc = localWallTimeToUtc(cDateStr, tpl.std_arr_time, destTz);
      const diff = Math.round((cArrUtc.getTime() - depUtc.getTime()) / 60000);
      if (diff >= 20 && diff <= 1200 && diff < minDur) {
        bestArrUtc = cArrUtc;
        minDur = diff;
      }
    }
    const arrUtc = bestArrUtc || new Date(depUtc.getTime() + 120 * 60000);
    const arrTimeUtc = `${String(arrUtc.getUTCHours()).padStart(2, '0')}:${String(arrUtc.getUTCMinutes()).padStart(2, '0')}`;

    const dayStrings = [
      ...tpl.days_of_week.map(String),
      ...tpl.days_of_week.map((d) => DOW_NAMES[d]),
    ];

    return {
      updateOne: {
        filter: { source_key: `APT_${tpl.origin_iata}_${tpl.dest_iata}_${tpl.flight_number}` },
        update: {
          $set: {
            source_key: `APT_${tpl.origin_iata}_${tpl.dest_iata}_${tpl.flight_number}`,
            dep_iata: tpl.origin_iata,
            arr_iata: tpl.dest_iata,
            airline_iata: 'APT',
            flight_number: tpl.flight_number.replace('APT', ''),
            flight_iata: tpl.flight_number,
            dep_time: tpl.std_dep_time,
            arr_time: tpl.std_arr_time,
            dep_time_utc: depTimeUtc,
            arr_time_utc: arrTimeUtc,
            days: dayStrings,
            aircraft_icao: tpl.aircraft_type,
            has_schedule: true,
            source: 'aptech_internal', // Aptech Airlines internal operational schedule provider
            synced_at: new Date(),
          },
        },
        upsert: true,
      },
    };
  });
  await routerefsCol.bulkWrite(routeRefOps, { ordered: false });
  console.log(`✅ RouteRef Edges: ${routeRefOps.length} graph edges populated with source='aptech_internal'.`);

  const routeSyncStateCol = db.collection('routesyncstates');

  // Idempotent migration of RouteSyncState unique constraint: drop dep_iata_1 if present
  const syncIndexes = await routeSyncStateCol.indexes().catch(() => []);
  const obsoleteDepIataIdx = syncIndexes.find(
    (i: any) => i.name === 'dep_iata_1' || (Object.keys(i.key || {}).length === 1 && i.key.dep_iata === 1 && i.unique),
  );
  if (obsoleteDepIataIdx) {
    console.log(`Dropping obsolete single-field unique index ${obsoleteDepIataIdx.name} on routesyncstates...`);
    await routeSyncStateCol.dropIndex(obsoleteDepIataIdx.name).catch((e: any) => console.warn(`Could not drop index: ${e.message}`));
  }
  await routeSyncStateCol.createIndex({ dep_iata: 1, source: 1 }, { unique: true, name: 'dep_iata_1_source_1' });

  // Clean up any legacy malformed row lacking dep_iata
  await routeSyncStateCol.deleteMany({ dep_iata: { $exists: false } });

  // Seed proper internal sync-state rows for all internal Aptech origins
  const originAirports = Array.from(new Set(APTECH_FLIGHT_TEMPLATES.map((tpl) => tpl.origin_iata.toUpperCase())));
  const syncOps = originAirports.map((depIata) => {
    const count = APTECH_FLIGHT_TEMPLATES.filter((tpl) => tpl.origin_iata.toUpperCase() === depIata).length;
    return {
      updateOne: {
        filter: { dep_iata: depIata, source: 'aptech_internal' },
        update: {
          $set: {
            dep_iata: depIata,
            source: 'aptech_internal',
            complete: true,
            truncated: false,
            records_seen: count,
            records_upserted: count,
            last_synced_at: new Date(),
            sync_generation: 'phase-a-seed',
          },
        },
        upsert: true,
      },
    };
  });
  await routeSyncStateCol.bulkWrite(syncOps, { ordered: false });
  console.log(`✅ RouteSyncState: ${syncOps.length} internal sync-state rows populated for Aptech route origins.`);

  // ============================================================================
  // STEP 5: ROLLING 330-DAY FLIGHT INSTANCE GENERATION
  // ============================================================================
  console.log(`\n[5/6] Generating Rolling 330-Day Operational Flight Dataset...`);
  // Ensure index before bulk operations for O(1) upsert performance
  await flightsCol.createIndex({ template_id: 1, operating_date: 1 }, { unique: true, sparse: true });

  // Anchor date: Vietnam local date (Asia/Ho_Chi_Minh)
  const now = new Date();
  const vnTodayStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
  const baseDate = new Date(`${vnTodayStr}T00:00:00+07:00`);

  const genStartFormatted = localDateKey(baseDate, 'Asia/Ho_Chi_Minh');
  const genEndDate = new Date(baseDate.getTime() + (HORIZON_DAYS - 1) * 86400000);
  const genEndFormatted = localDateKey(genEndDate, 'Asia/Ho_Chi_Minh');

  console.log(`   Horizon Range: ${genStartFormatted} to ${genEndFormatted} (${HORIZON_DAYS} days)`);

  let totalBatches = 0;
  let totalOps = 0;
  let totalInserted = 0;
  let totalMatched = 0;
  let currentChunk: any[] = [];

  const genStartTime = Date.now();

  for (let dayOffset = 0; dayOffset < HORIZON_DAYS; dayOffset++) {
    const targetDate = new Date(baseDate.getTime() + dayOffset * 86400000);
    const dateStr = localDateKey(targetDate, 'Asia/Ho_Chi_Minh');

    const rawDow = targetDate.getDay();
    const isoDow = rawDow === 0 ? 7 : rawDow;

    for (const tpl of APTECH_FLIGHT_TEMPLATES) {
      if (!tpl.days_of_week.includes(isoDow)) continue;

      const originApt = airportMap.get(tpl.origin_iata);
      const destApt = airportMap.get(tpl.dest_iata);

      const originTz = originApt?.time_zone || 'Asia/Ho_Chi_Minh';
      const destTz = destApt?.time_zone || 'Asia/Ho_Chi_Minh';

      const scheduledDepartureUtc = localWallTimeToUtc(dateStr, tpl.std_dep_time, originTz);

      const depTimeMs = scheduledDepartureUtc.getTime();
      let bestArrivalUtc: Date | null = null;
      let bestDurationMinutes = Infinity;

      for (const dayOffset of [0, 1, 2]) {
        const candArrDate = new Date(targetDate.getTime() + dayOffset * 86400000);
        const candArrDateStr = localDateKey(candArrDate, destTz);
        const candArrUtc = localWallTimeToUtc(candArrDateStr, tpl.std_arr_time, destTz);
        const diffMinutes = Math.round((candArrUtc.getTime() - depTimeMs) / 60000);

        if (diffMinutes >= 20 && diffMinutes <= 1200 && diffMinutes < bestDurationMinutes) {
          bestArrivalUtc = candArrUtc;
          bestDurationMinutes = diffMinutes;
        }
      }

      const scheduledArrivalUtc = bestArrivalUtc || new Date(depTimeMs + 120 * 60000);
      const durationMinutes = bestDurationMinutes !== Infinity ? bestDurationMinutes : 120;

      const miles =
        originApt && destApt && originApt.lat && originApt.lng && destApt.lat && destApt.lng
          ? calculateGreatCircleMiles(originApt.lat, originApt.lng, destApt.lat, destApt.lng)
          : 0;

      const meta = getAircraftMetadata(tpl.aircraft_type);
      const inventories = meta.inventories.map((invDef) => {
        let basePrice = tpl.base_price_economy;
        if (invDef.cabin_class === CabinClass.BUSINESS) {
          basePrice = tpl.base_price_business || Math.round(tpl.base_price_economy * invDef.price_factor);
        } else if (invDef.cabin_class === CabinClass.CLUB) {
          basePrice = tpl.base_price_club || Math.round(tpl.base_price_economy * invDef.price_factor);
        } else if (invDef.cabin_class === CabinClass.FIRST) {
          basePrice = tpl.base_price_first || Math.round(tpl.base_price_economy * 3.5);
        }

        return {
          cabin_class: invDef.cabin_class,
          is_smoking: false,
          bucket_code:
            invDef.cabin_class === CabinClass.ECONOMY ? 'Y' : invDef.cabin_class === CabinClass.BUSINESS ? 'J' : 'W',
          base_price: basePrice,
          allocated_seats: invDef.allocated_seats,
          available_seats: invDef.allocated_seats,
        };
      });

      const flightDoc = {
        flight_number: tpl.flight_number,
        origin_iata: tpl.origin_iata,
        dest_iata: tpl.dest_iata,
        departure_date: dateStr,
        scheduled_departure: scheduledDepartureUtc,
        scheduled_arrival: scheduledArrivalUtc,
        duration_minutes: durationMinutes,
        distance_miles: miles,
        status: FlightStatus.SCHEDULED,
        delay_reason: '',
        delay_minutes: 0,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
        aircraft: {
          model_code: tpl.aircraft_type,
          model_name: meta.model_name,
          total_capacity: meta.total_capacity,
        },
        inventories,
        template_id: tpl.template_id,
        operating_date: dateStr,
        is_generated: true,
        generated_source: 'seed_schedule_330',
        is_manually_modified: false,
      };

      const {
        scheduled_departure,
        scheduled_arrival,
        duration_minutes,
        operator,
        is_bookable,
        data_source,
        ...restDoc
      } = flightDoc;

      currentChunk.push({
        updateOne: {
          filter: { template_id: tpl.template_id, operating_date: dateStr, is_manually_modified: { $ne: true } },
          update: {
            $set: {
              scheduled_departure,
              scheduled_arrival,
              duration_minutes,
              operator: 'APTECH_AIRLINES',
              is_bookable: true,
              data_source: 'INTERNAL_GENERATED',
            },
            $setOnInsert: restDoc,
          },
          upsert: true,
        },
      });

      if (currentChunk.length >= CHUNK_SIZE) {
        const res = await flightsCol.bulkWrite(currentChunk, { ordered: false });
        totalOps += currentChunk.length;
        totalInserted += res.upsertedCount;
        totalMatched += res.matchedCount;
        totalBatches++;
        currentChunk = [];
      }
    }
  }

  if (currentChunk.length > 0) {
    const res = await flightsCol.bulkWrite(currentChunk, { ordered: false });
    totalOps += currentChunk.length;
    totalInserted += res.upsertedCount;
    totalMatched += res.matchedCount;
    totalBatches++;
    currentChunk = [];
  }

  const genDuration = Date.now() - genStartTime;
  console.log(
    `✅ 330-Day Flights: ${totalOps} operations in ${totalBatches} chunks (${totalInserted} inserted, ${totalMatched} preserved) in ${genDuration}ms.`,
  );

  // ============================================================================
  // STEP 6: LEGACY FLIGHT MIGRATION & PROVENANCE ENFORCEMENT
  // ============================================================================
  console.log(`\n[6/7] Migrating Legacy Flights & Enforcing Bookability Provenance...`);
  const aptMigration = await flightsCol.updateMany(
    { flight_number: /^APT/i },
    {
      $set: {
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: 'INTERNAL_GENERATED',
      },
    },
  );
  console.log(`   Migrated ${aptMigration.modifiedCount} Aptech flights to operator='APTECH_AIRLINES', is_bookable=true.`);

  const externalMigration = await flightsCol.updateMany(
    { flight_number: { $not: /^APT/i } },
    {
      $set: {
        is_bookable: false,
        inventories: [],
      },
    },
  );
  console.log(`   Migrated ${externalMigration.modifiedCount} External flights to is_bookable=false, inventories=[].`);

  // ============================================================================
  // STEP 7: INDEX VERIFICATION & STATS AUDIT
  // ============================================================================
  console.log(`\n[7/7] Ensuring Compound & Covering Indexes...`);
  await flightsCol.createIndex({ template_id: 1, operating_date: 1 }, { unique: true, sparse: true });
  await flightsCol.createIndex({ flight_number: 1, departure_date: 1 });
  await flightsCol.createIndex({ origin_iata: 1, departure_date: 1, status: 1 });
  await flightsCol.createIndex({ dest_iata: 1, departure_date: 1, status: 1 });
  await flightsCol.createIndex({ origin_iata: 1, dest_iata: 1, departure_date: 1, status: 1 });
  await flightsCol.createIndex({ is_bookable: 1, origin_iata: 1, dest_iata: 1, departure_date: 1, status: 1 });
  await flightsCol.createIndex({ operator: 1, is_bookable: 1 });
  await flightsCol.createIndex({ status: 1, scheduled_departure: 1 });

  await airportsCol.createIndex({ is_serviced_directly: 1 });
  await airportsCol.createIndex({ country_code: 1 });
  await airportsCol.createIndex({ city_name: 1 });
  await airportsCol.createIndex({ city_name: 1, is_serviced_directly: 1 });

  await routerefsCol.createIndex({ source: 1, dep_iata: 1, arr_iata: 1 });
  console.log(`✅ All database indexes verified.`);

  // Audit Metrics
  const totalAirports = await airportsCol.countDocuments({});
  const servicedAirports = await airportsCol.countDocuments({ is_serviced_directly: true });
  const unservicedAirports = await airportsCol.countDocuments({ is_serviced_directly: false });
  const totalTemplates = await templatesCol.countDocuments({});
  const totalFlights = await flightsCol.countDocuments({});
  const generatedFlights = await flightsCol.countDocuments({ is_generated: true });
  const bookableFlights = await flightsCol.countDocuments({ is_bookable: true });
  const externalFlights = await flightsCol.countDocuments({ is_bookable: false });
  const totalRouteRefs = await routerefsCol.countDocuments({ source: 'aptech_internal' });

  const earliestFlight = await flightsCol.find({ is_generated: true }).sort({ departure_date: 1 }).limit(1).toArray();
  const latestFlight = await flightsCol.find({ is_generated: true }).sort({ departure_date: -1 }).limit(1).toArray();

  // Domestic legs query across days
  const domesticAirports = ['HAN', 'SGN', 'DAD', 'CXR', 'PQC'];
  const dailyDomestic = await flightsCol
    .aggregate([
      {
        $match: {
          is_generated: true,
          origin_iata: { $in: domesticAirports },
          dest_iata: { $in: domesticAirports },
        },
      },
      { $group: { _id: '$departure_date', count: { $sum: 1 } } },
      { $sort: { count: 1 } },
    ])
    .toArray();

  const minDomestic = dailyDomestic.length > 0 ? dailyDomestic[0].count : 0;
  const maxDomestic = dailyDomestic.length > 0 ? dailyDomestic[dailyDomestic.length - 1].count : 0;

  // International legs query across days
  const dailyIntl = await flightsCol
    .aggregate([
      {
        $match: {
          is_generated: true,
          $or: [
            { origin_iata: { $nin: domesticAirports } },
            { dest_iata: { $nin: domesticAirports } },
          ],
        },
      },
      { $group: { _id: '$departure_date', count: { $sum: 1 } } },
      { $sort: { count: 1 } },
    ])
    .toArray();

  const minIntl = dailyIntl.length > 0 ? dailyIntl[0].count : 0;
  const maxIntl = dailyIntl.length > 0 ? dailyIntl[dailyIntl.length - 1].count : 0;

  // Check duplicate identities
  const duplicates = await flightsCol
    .aggregate([
      { $match: { is_generated: true, template_id: { $exists: true } } },
      { $group: { _id: { t: '$template_id', d: '$operating_date' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  console.log(`\n================================================================`);
  console.log(`📊 PHASE A POPULATION ACCEPTANCE REPORT`);
  console.log(`================================================================`);
  console.log(`- Total Reference Airports      : ${totalAirports}`);
  console.log(`- Aptech-Serviced Airports      : ${servicedAirports}`);
  console.log(`- Unserviced Reference Airports : ${unservicedAirports}`);
  console.log(`- Schedule Templates            : ${totalTemplates}`);
  console.log(`- Total Flights in Database     : ${totalFlights}`);
  console.log(`- Bookable Aptech Flights       : ${bookableFlights}`);
  console.log(`- External Non-Bookable Flights : ${externalFlights}`);
  console.log(`- Generated Flights (330 days)  : ${generatedFlights}`);
  console.log(`- Internal RouteRef Graph Edges : ${totalRouteRefs}`);
  console.log(`- Earliest Departure Date       : ${earliestFlight[0]?.departure_date}`);
  console.log(`- Latest Departure Date         : ${latestFlight[0]?.departure_date}`);
  console.log(`- Min Domestic Flight Legs / Day: ${minDomestic} (Requirement: >= 10)`);
  console.log(`- Max Domestic Flight Legs / Day: ${maxDomestic}`);
  console.log(`- Min Intl Flight Legs / Day    : ${minIntl} (Requirement: >= 30)`);
  console.log(`- Max Intl Flight Legs / Day    : ${maxIntl}`);
  console.log(`- Duplicate (template+date) Ident: ${duplicates.length} (Expected: 0)`);
  console.log(`================================================================\n`);

  await mongoose.disconnect();
  console.log(`Phase A Seeding script completed successfully.`);
}

run().catch((err) => {
  console.error('Fatal error during Phase A seeding:', err);
  process.exit(1);
});
