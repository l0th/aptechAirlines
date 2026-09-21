import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { ImportedAirport, loadOurAirportsReferenceData } from '../airports/ourairports.loader';
import tzlookup = require('tz-lookup');

dotenv.config();

export { tzlookup };

export interface AirportRepairPlan {
  totalDbAirports: number;
  totalLoaderAirports: number;
  matchedByIata: number;
  missingInDb: number;
  timezoneMismatches: number;
  currentUtcCount: number;
  projectedUtcCount: number;
  invalidCoordsCount: number;
  sampleTimezoneChanges: Array<{ iata: string; from: string; to: string }>;
  updateOperations: any[];
  upsertOperations: any[];
}

export interface CountryRepairPlan {
  distinctCountryCodes: number;
  existingCountryDocs: number;
  countriesToInsert: number;
  countriesToUpdate: number;
  countriesUnchanged: number;
  upsertOperations: any[];
  updateOperations: any[];
}

export interface RepairStats {
  airports: AirportRepairPlan & {
    updatedCount: number;
    upsertedCount: number;
    insertedCount: number;
  };
  countries: CountryRepairPlan & {
    upsertedCount: number;
    insertedCount: number;
    updatedCount: number;
  };
  cities: {
    status: string;
  };
  database: {
    targetDb: string;
    sanitizedUri: string;
    isDryRun: boolean;
  };
}

/**
 * Extracts a sanitized URI (credentials stripped) and database name from a Mongo URI string.
 */
export function extractSanitizedMongoTarget(uri: string): { sanitizedUri: string; dbName: string } {
  try {
    const parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const dbName = parsed.pathname.replace(/^\//, '').split('?')[0] || '';
    const host = parsed.host;
    const protocol = uri.startsWith('mongodb+srv://') ? 'mongodb+srv://' : 'mongodb://';
    const sanitizedUri = `${protocol}${host}/${dbName}`;
    return { sanitizedUri, dbName };
  } catch {
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)(?:\/([^?]+))?/);
    const host = match ? match[1] : 'unknown-host';
    const dbName = match && match[2] ? match[2].split('?')[0] : '';
    const sanitizedUri = `mongodb://${host}/${dbName}`;
    return { sanitizedUri, dbName };
  }
}

/**
 * Resolves the accurate timezone for an airport reference using tz-lookup and fallback.
 */
export function resolveAirportTimezone(ref: ImportedAirport): string {
  if (
    typeof ref.lat === 'number' &&
    typeof ref.lng === 'number' &&
    !isNaN(ref.lat) &&
    !isNaN(ref.lng) &&
    ref.lat >= -90 &&
    ref.lat <= 90 &&
    ref.lng >= -180 &&
    ref.lng <= 180
  ) {
    try {
      const resolved = tzlookup(ref.lat, ref.lng);
      if (resolved && resolved.trim()) {
        return resolved.trim();
      }
    } catch {
      // Fallback to ref.time_zone or UTC
    }
  }
  return ref.time_zone && ref.time_zone.trim() ? ref.time_zone.trim() : 'UTC';
}

/**
 * Compares an existing DB airport document with authoritative loader reference data.
 * CRITICAL INVARIANTS:
 * 1. NEVER modifies operational fields (is_serviced_directly, nearest_airport_code, distance_to_nearest_km).
 * 2. NEVER overwrites a good existing city_code with a generic IATA fallback.
 */
export function computeAirportDiff(
  existing: any,
  ref: ImportedAirport,
): {
  hasChanges: boolean;
  isTimezoneChanged: boolean;
  updateDoc: Record<string, any>;
  previousTimezone: string;
  targetTimezone: string;
} {
  const targetTz = resolveAirportTimezone(ref);
  const previousTz = existing.time_zone || 'UTC';
  const isTimezoneChanged = previousTz !== targetTz;

  const updateDoc: Record<string, any> = {};
  let hasChanges = false;

  if (isTimezoneChanged) {
    updateDoc.time_zone = targetTz;
    hasChanges = true;
  }

  if (ref.airport_name && existing.airport_name !== ref.airport_name) {
    updateDoc.airport_name = ref.airport_name;
    hasChanges = true;
  }

  if (ref.city_name && existing.city_name !== ref.city_name) {
    updateDoc.city_name = ref.city_name;
    hasChanges = true;
  }

  if (ref.country_code && existing.country_code !== ref.country_code) {
    updateDoc.country_code = ref.country_code;
    hasChanges = true;
  }

  // Preserve existing city_code if already non-empty (never replace with generic fallback)
  const existingCityCode = existing.city_code ? String(existing.city_code).trim() : '';
  if (!existingCityCode) {
    const trustworthyCityCode = ref.city_code || ref.iata_code;
    if (trustworthyCityCode && trustworthyCityCode.trim()) {
      updateDoc.city_code = trustworthyCityCode.trim();
      hasChanges = true;
    }
  }

  if (ref.icao_code && existing.icao_code !== ref.icao_code) {
    updateDoc.icao_code = ref.icao_code;
    hasChanges = true;
  }

  if (typeof ref.lat === 'number' && !isNaN(ref.lat) && existing.lat !== ref.lat) {
    updateDoc.lat = ref.lat;
    hasChanges = true;
  }

  if (typeof ref.lng === 'number' && !isNaN(ref.lng) && existing.lng !== ref.lng) {
    updateDoc.lng = ref.lng;
    hasChanges = true;
  }

  const targetSource = ref.data_source || 'ourairports';
  if (existing.data_source !== targetSource) {
    updateDoc.data_source = targetSource;
    hasChanges = true;
  }

  return {
    hasChanges,
    isTimezoneChanged,
    updateDoc,
    previousTimezone: previousTz,
    targetTimezone: targetTz,
  };
}

/**
 * Creates a default document for an airport missing entirely from DB.
 * Uses safe default operational configurations.
 */
export function createDefaultMissingAirport(ref: ImportedAirport): Record<string, any> {
  const targetTz = resolveAirportTimezone(ref);
  return {
    iata_code: ref.iata_code.toUpperCase(),
    airport_name: ref.airport_name,
    city_name: ref.city_name,
    country_code: ref.country_code || '',
    city_code: ref.city_code || ref.iata_code,
    icao_code: ref.icao_code || '',
    lat: ref.lat,
    lng: ref.lng,
    time_zone: targetTz,
    is_serviced_directly: false,
    nearest_airport_code: '',
    distance_to_nearest_km: 0,
    data_source: ref.data_source || 'ourairports',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Plans airport repairs in-memory without database mutation.
 * Missing airports use true upsert ($setOnInsert) operations.
 */
export function planAirportRepairs(
  existingAirports: any[],
  refAirports: ImportedAirport[],
): AirportRepairPlan {
  const existingMap = new Map<string, any>();
  let currentUtcCount = 0;

  for (const doc of existingAirports) {
    if (doc.iata_code) {
      existingMap.set(doc.iata_code.toUpperCase(), doc);
    }
    if ((doc.time_zone || 'UTC') === 'UTC') {
      currentUtcCount++;
    }
  }

  const updateOperations: any[] = [];
  const upsertOperations: any[] = [];
  let matchedByIata = 0;
  let missingInDb = 0;
  let timezoneMismatches = 0;
  let invalidCoordsCount = 0;
  const sampleTimezoneChanges: Array<{ iata: string; from: string; to: string }> = [];

  // Track projected timezones for all DB airports
  const projectedTimezones = new Map<string, string>();
  for (const doc of existingAirports) {
    if (doc.iata_code) {
      projectedTimezones.set(doc.iata_code.toUpperCase(), doc.time_zone || 'UTC');
    }
  }

  for (const ref of refAirports) {
    const iata = ref.iata_code ? ref.iata_code.toUpperCase() : '';
    if (!iata) continue;

    const hasValidCoords =
      typeof ref.lat === 'number' &&
      typeof ref.lng === 'number' &&
      !isNaN(ref.lat) &&
      !isNaN(ref.lng) &&
      ref.lat >= -90 &&
      ref.lat <= 90 &&
      ref.lng >= -180 &&
      ref.lng <= 180;

    if (!hasValidCoords) {
      invalidCoordsCount++;
    }

    const existing = existingMap.get(iata);
    if (existing) {
      matchedByIata++;
      const diff = computeAirportDiff(existing, ref);

      if (diff.isTimezoneChanged) {
        timezoneMismatches++;
        if (sampleTimezoneChanges.length < 20) {
          sampleTimezoneChanges.push({
            iata,
            from: diff.previousTimezone,
            to: diff.targetTimezone,
          });
        }
      }

      projectedTimezones.set(iata, diff.targetTimezone);

      if (diff.hasChanges) {
        updateOperations.push({
          updateOne: {
            filter: { _id: existing._id },
            update: {
              $set: {
                ...diff.updateDoc,
                updatedAt: new Date(),
              },
            },
          },
        });
      }
    } else {
      missingInDb++;
      const missingDoc = createDefaultMissingAirport(ref);
      projectedTimezones.set(iata, missingDoc.time_zone);
      upsertOperations.push({
        updateOne: {
          filter: { iata_code: iata },
          update: {
            $setOnInsert: missingDoc,
          },
          upsert: true,
        },
      });
    }
  }

  let projectedUtcCount = 0;
  for (const tz of projectedTimezones.values()) {
    if (tz === 'UTC') {
      projectedUtcCount++;
    }
  }

  return {
    totalDbAirports: existingAirports.length,
    totalLoaderAirports: refAirports.length,
    matchedByIata,
    missingInDb,
    timezoneMismatches,
    currentUtcCount,
    projectedUtcCount,
    invalidCoordsCount,
    sampleTimezoneChanges,
    updateOperations,
    upsertOperations,
  };
}

/**
 * Builds or updates a country record using Node's Intl.DisplayNames.
 * Preserves existing country records if they already contain valid explicit data.
 */
export function buildCountryRecord(
  code: string,
  existing?: any,
): {
  action: 'insert' | 'update' | 'unchanged';
  record: {
    code: string;
    name: string;
    name_vi?: string;
    source: string;
  };
  updateFields?: Record<string, any>;
} {
  const upperCode = code.toUpperCase();
  let enName = upperCode;
  let viName = upperCode;

  try {
    const enDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
    enName = enDisplay.of(upperCode) || upperCode;
  } catch {
    enName = upperCode;
  }

  try {
    const viDisplay = new Intl.DisplayNames(['vi'], { type: 'region' });
    viName = viDisplay.of(upperCode) || enName;
  } catch {
    viName = enName;
  }

  if (!existing) {
    return {
      action: 'insert',
      record: {
        code: upperCode,
        name: enName,
        name_vi: viName,
        source: 'offline_reference',
      },
    };
  }

  const updateFields: Record<string, any> = {};
  let needsUpdate = false;

  // If existing record has no name or name is just the 2-letter ISO code, upgrade it
  if (!existing.name || existing.name.trim() === upperCode) {
    updateFields.name = enName;
    needsUpdate = true;
  }

  // If existing record has no Vietnamese translation, upgrade it
  if (!existing.name_vi && viName && viName !== upperCode) {
    updateFields.name_vi = viName;
    needsUpdate = true;
  }

  if (needsUpdate) {
    return {
      action: 'update',
      record: {
        code: upperCode,
        name: updateFields.name || existing.name,
        name_vi: updateFields.name_vi || existing.name_vi,
        source: existing.source || 'offline_reference',
      },
      updateFields,
    };
  }

  return {
    action: 'unchanged',
    record: {
      code: upperCode,
      name: existing.name,
      name_vi: existing.name_vi,
      source: existing.source || 'offline_reference',
    },
  };
}

/**
 * Plans country reference repairs in-memory from distinct airport country codes.
 * Missing countries use true upsert ($setOnInsert) operations.
 */
export function planCountryRepairs(
  existingCountries: any[],
  countryCodes: string[],
): CountryRepairPlan {
  const existingMap = new Map<string, any>();
  for (const doc of existingCountries) {
    if (doc.code) {
      existingMap.set(doc.code.toUpperCase(), doc);
    }
  }

  const distinctCodes = Array.from(
    new Set(countryCodes.map((c) => (c ? c.trim().toUpperCase() : '')).filter((c) => /^[A-Z]{2}$/.test(c))),
  ).sort();

  const upsertOperations: any[] = [];
  const updateOperations: any[] = [];
  let countriesToInsert = 0;
  let countriesToUpdate = 0;
  let countriesUnchanged = 0;

  for (const code of distinctCodes) {
    const existing = existingMap.get(code);
    const result = buildCountryRecord(code, existing);

    if (result.action === 'insert') {
      countriesToInsert++;
      upsertOperations.push({
        updateOne: {
          filter: { code },
          update: {
            $setOnInsert: {
              ...result.record,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    } else if (result.action === 'update') {
      countriesToUpdate++;
      updateOperations.push({
        updateOne: {
          filter: { _id: existing._id },
          update: {
            $set: {
              ...result.updateFields,
              updatedAt: new Date(),
            },
          },
        },
      });
    } else {
      countriesUnchanged++;
    }
  }

  return {
    distinctCountryCodes: distinctCodes.length,
    existingCountryDocs: existingCountries.length,
    countriesToInsert,
    countriesToUpdate,
    countriesUnchanged,
    upsertOperations,
    updateOperations,
  };
}

/**
 * Executes operations in batches using bulkWrite.
 */
export async function executeChunkedBulkWrite(
  collection: any,
  operations: any[],
  chunkSize = 1000,
): Promise<{ matchedCount: number; modifiedCount: number; insertedCount: number; upsertedCount: number }> {
  let matchedCount = 0;
  let modifiedCount = 0;
  let insertedCount = 0;
  let upsertedCount = 0;

  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const res = await collection.bulkWrite(chunk, { ordered: false });
    matchedCount += res.matchedCount || 0;
    modifiedCount += res.modifiedCount || 0;
    insertedCount += res.insertedCount || 0;
    upsertedCount += res.upsertedCount || 0;
  }

  return { matchedCount, modifiedCount, insertedCount, upsertedCount };
}

/**
 * Main coordinator function for reference data repair.
 */
export async function runReferenceDataRepair(options?: {
  mongoUri?: string;
  isExecute?: boolean;
  customRefAirports?: ImportedAirport[];
  csvFilePath?: string;
  quiet?: boolean;
}): Promise<RepairStats> {
  const isExecute = options?.isExecute === true;
  const isDryRun = !isExecute;
  const rawMongoUri = options?.mongoUri || process.env.MONGO_URI || 'mongodb://localhost:27017/airline_db';

  const { sanitizedUri, dbName } = extractSanitizedMongoTarget(rawMongoUri);

  if (isExecute && (!dbName || dbName === '')) {
    throw new Error(
      `Cannot determine target database name from MongoDB URI: "${sanitizedUri}". Aborting execute mode for safety.`,
    );
  }

  if (!options?.quiet) {
    console.log(`\n==================================================`);
    console.log(`APTECH AIRLINES — REFERENCE DATA REPAIR UTILITY`);
    console.log(`==================================================`);
    console.log(`Target database : ${dbName || 'default'} (${sanitizedUri})`);
    console.log(`Execution Mode  : ${isDryRun ? 'DRY-RUN (Analysis Only / Zero Mutations)' : 'EXECUTE (Mutations will be committed)'}`);
    console.log(`==================================================\n`);
  }

  const connection = await mongoose.createConnection(rawMongoUri).asPromise();
  try {
    const db = connection.db;
    if (!db) {
      throw new Error('Could not obtain MongoDB database instance');
    }

    const airportsColl = db.collection('airports');
    const countriesColl = db.collection('countries');

    // 1. Load reference data
    let refAirports: ImportedAirport[] = [];
    if (options?.customRefAirports) {
      refAirports = options.customRefAirports;
    } else {
      if (!options?.quiet) {
        console.log(`Loading authoritative reference data via OurAirports loader...`);
      }
      const loaded = await loadOurAirportsReferenceData(options?.csvFilePath);
      refAirports = loaded.airports;
      if (!options?.quiet) {
        console.log(`Loaded ${refAirports.length} reference airports from loader.\n`);
      }
    }

    // 2. Fetch existing DB records
    const existingDbAirports = await airportsColl.find({}).toArray();
    const existingDbCountries = await countriesColl.find({}).toArray();

    // 3. Plan Airport Repairs
    const airportPlan = planAirportRepairs(existingDbAirports, refAirports);

    // 4. Collect distinct country codes from both existing airports and loader reference
    const allCountryCodes = new Set<string>();
    for (const a of existingDbAirports) {
      if (a.country_code) allCountryCodes.add(a.country_code);
    }
    for (const a of refAirports) {
      if (a.country_code) allCountryCodes.add(a.country_code);
    }
    const countryPlan = planCountryRepairs(existingDbCountries, Array.from(allCountryCodes));

    // 5. Output Dry-Run Summary
    if (!options?.quiet) {
      console.log(`--- AIRPORT REFERENCE AUDIT ---`);
      console.log(`  Total DB airport documents       : ${airportPlan.totalDbAirports}`);
      console.log(`  Total loader reference airports  : ${airportPlan.totalLoaderAirports}`);
      console.log(`  Matched by IATA                  : ${airportPlan.matchedByIata}`);
      console.log(`  Missing in DB (available upsert) : ${airportPlan.missingInDb}`);
      console.log(`  Timezone mismatches detected     : ${airportPlan.timezoneMismatches}`);
      console.log(`  Current UTC timezone count in DB : ${airportPlan.currentUtcCount}`);
      console.log(`  Projected UTC count after repair : ${airportPlan.projectedUtcCount}`);
      console.log(`  Invalid/missing coordinates      : ${airportPlan.invalidCoordsCount}`);
      console.log(`\n  Sample timezone adjustments (max 20):`);
      if (airportPlan.sampleTimezoneChanges.length === 0) {
        console.log(`    (None detected - timezones already consistent)`);
      } else {
        for (const change of airportPlan.sampleTimezoneChanges) {
          console.log(`    ${change.iata.padEnd(5)}: ${change.from} -> ${change.to}`);
        }
      }

      console.log(`\n--- COUNTRY REFERENCE BOOTSTRAP ---`);
      console.log(`  Distinct airport country codes   : ${countryPlan.distinctCountryCodes}`);
      console.log(`  Existing country documents in DB : ${countryPlan.existingCountryDocs}`);
      console.log(`  Countries to insert (upsert)     : ${countryPlan.countriesToInsert}`);
      console.log(`  Countries to update              : ${countryPlan.countriesToUpdate}`);
      console.log(`  Countries unchanged              : ${countryPlan.countriesUnchanged}`);

      console.log(`\n--- CITY CATALOG ---`);
      console.log(
        `  City catalog: Unchanged (AirportsService.resolveCity fallback handles city resolution deterministically from airport reference data).`,
      );
    }

    let airportUpdatedCount = 0;
    let airportUpsertedCount = 0;
    let countryUpsertedCount = 0;
    let countryUpdatedCount = 0;

    // 6. Execute mutations if --execute is explicitly active
    if (isExecute) {
      if (!options?.quiet) {
        console.log(`\nCommitting reference data mutations to database "${dbName}"...`);
      }

      // Airport updates
      if (airportPlan.updateOperations.length > 0) {
        const res = await executeChunkedBulkWrite(airportsColl, airportPlan.updateOperations);
        airportUpdatedCount = res.modifiedCount;
      }

      // Airport upserts (missing airports)
      if (airportPlan.upsertOperations.length > 0) {
        const res = await executeChunkedBulkWrite(airportsColl, airportPlan.upsertOperations);
        airportUpsertedCount = res.upsertedCount;
      }

      // Country upserts
      if (countryPlan.upsertOperations.length > 0) {
        const res = await executeChunkedBulkWrite(countriesColl, countryPlan.upsertOperations);
        countryUpsertedCount = res.upsertedCount;
      }

      // Country updates
      if (countryPlan.updateOperations.length > 0) {
        const res = await executeChunkedBulkWrite(countriesColl, countryPlan.updateOperations);
        countryUpdatedCount = res.modifiedCount;
      }

      if (!options?.quiet) {
        console.log(`\n--- EXECUTION RESULTS ---`);
        console.log(`  Airports updated : ${airportUpdatedCount}`);
        console.log(`  Airports upserted: ${airportUpsertedCount}`);
        console.log(`  Countries upserted: ${countryUpsertedCount}`);
        console.log(`  Countries updated: ${countryUpdatedCount}`);
        console.log(`Result: SUCCESS (COMMITTED TO DATABASE)\n`);
      }
    } else {
      if (!options?.quiet) {
        console.log(`\nResult: SUCCESS (DRY-RUN COMPLETE — Zero database mutations performed)\n`);
      }
    }

    return {
      airports: {
        ...airportPlan,
        updatedCount: airportUpdatedCount,
        upsertedCount: airportUpsertedCount,
        insertedCount: airportUpsertedCount,
      },
      countries: {
        ...countryPlan,
        upsertedCount: countryUpsertedCount,
        insertedCount: countryUpsertedCount,
        updatedCount: countryUpdatedCount,
      },
      cities: {
        status: 'Unchanged (AirportsService.resolveCity fallback handles city resolution)',
      },
      database: {
        targetDb: dbName,
        sanitizedUri,
        isDryRun,
      },
    };
  } finally {
    await connection.close();
  }
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute') && !args.includes('--dry-run');

  runReferenceDataRepair({ isExecute })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nRepair script failed with error:', err.message || err);
      process.exit(1);
    });
}
