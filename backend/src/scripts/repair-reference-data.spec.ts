import mongoose from 'mongoose';
import {
  extractSanitizedMongoTarget,
  resolveAirportTimezone,
  computeAirportDiff,
  createDefaultMissingAirport,
  buildCountryRecord,
  planAirportRepairs,
  planCountryRepairs,
  runReferenceDataRepair,
} from './repair-reference-data';
import { ImportedAirport } from '../airports/ourairports.loader';
import tzlookup = require('tz-lookup');

describe('Reference Data Repair Utility', () => {
  const testMongoUri =
    process.env.TEST_MONGO_URI ||
    'mongodb://127.0.0.1:27017/airline_db_test_repair_spec';

  describe('Authoritative tz-lookup Loader Integration', () => {
    it('tz-lookup function directly resolves Ashgabat (ASB) coordinates without monkey-patch', () => {
      // ASB coordinates: 37.986801, 58.361
      const tz = tzlookup(37.986801, 58.361);
      expect(tz).toBe('Asia/Ashgabat');
    });

    it('tz-lookup function directly resolves Ho Chi Minh (SGN) coordinates', () => {
      // SGN coordinates: 10.8188, 106.652
      const tz = tzlookup(10.8188, 106.652);
      expect(tz).toBe('Asia/Ho_Chi_Minh');
    });

    it('resolveAirportTimezone resolves ASB coordinates to Asia/Ashgabat', () => {
      const ref: ImportedAirport = {
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        lat: 37.986801,
        lng: 58.361,
        time_zone: 'UTC', // Even if loader ref defaulted to UTC
        is_serviced_directly: false,
        data_source: 'ourairports',
      };
      expect(resolveAirportTimezone(ref)).toBe('Asia/Ashgabat');
    });
  });

  describe('extractSanitizedMongoTarget', () => {
    it('sanitizes URI with credentials and extracts database name', () => {
      const uri = 'mongodb://user:secretpass@127.0.0.1:27017/airline_db?authSource=admin';
      const result = extractSanitizedMongoTarget(uri);
      expect(result.dbName).toBe('airline_db');
      expect(result.sanitizedUri).toBe('mongodb://127.0.0.1:27017/airline_db');
      expect(result.sanitizedUri).not.toContain('user');
      expect(result.sanitizedUri).not.toContain('secretpass');
    });

    it('extracts database name from simple URI', () => {
      const uri = 'mongodb://localhost:27017/airline_db_custom';
      const result = extractSanitizedMongoTarget(uri);
      expect(result.dbName).toBe('airline_db_custom');
      expect(result.sanitizedUri).toBe('mongodb://localhost:27017/airline_db_custom');
    });
  });

  describe('Airport Timezone Resolution & Diffing', () => {
    const fixtureLoaderAirportASB: ImportedAirport = {
      iata_code: 'ASB',
      icao_code: 'UTAA',
      airport_name: 'Ashgabat International Airport',
      city_name: 'Ashgabat',
      country_code: 'TM',
      city_code: 'ASB',
      lat: 37.986801,
      lng: 58.361,
      time_zone: 'UTC',
      is_serviced_directly: false,
      nearest_airport_code: 'CDG',
      distance_to_nearest_km: 4555,
      data_source: 'ourairports',
    };

    it('A. existing airport: time_zone gets corrected from loader reference coordinates', () => {
      const existingDbAirport = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        city_code: 'ASB',
        time_zone: 'UTC',
        is_serviced_directly: true, // Operational config
        nearest_airport_code: 'DXB',
        distance_to_nearest_km: 1200,
        lat: 37.986801,
        lng: 58.361,
        data_source: 'ourairports',
      };

      const diff = computeAirportDiff(existingDbAirport, fixtureLoaderAirportASB);
      expect(diff.hasChanges).toBe(true);
      expect(diff.isTimezoneChanged).toBe(true);
      expect(diff.targetTimezone).toBe('Asia/Ashgabat');
      expect(diff.updateDoc.time_zone).toBe('Asia/Ashgabat');
    });

    it('B. existing airport: is_serviced_directly is preserved', () => {
      const existingDbAirport = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        time_zone: 'UTC',
        is_serviced_directly: true, // MUST BE PRESERVED
        nearest_airport_code: 'DXB',
        distance_to_nearest_km: 1200,
      };

      const diff = computeAirportDiff(existingDbAirport, fixtureLoaderAirportASB);
      expect(diff.updateDoc.is_serviced_directly).toBeUndefined();
    });

    it('C. existing airport: nearest_airport_code is preserved', () => {
      const existingDbAirport = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        time_zone: 'UTC',
        is_serviced_directly: false,
        nearest_airport_code: 'CUSTOM_HUB', // MUST BE PRESERVED
        distance_to_nearest_km: 1200,
      };

      const diff = computeAirportDiff(existingDbAirport, fixtureLoaderAirportASB);
      expect(diff.updateDoc.nearest_airport_code).toBeUndefined();
    });

    it('D. existing airport: distance_to_nearest_km is preserved', () => {
      const existingDbAirport = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        time_zone: 'UTC',
        is_serviced_directly: false,
        nearest_airport_code: 'DXB',
        distance_to_nearest_km: 9999, // MUST BE PRESERVED
      };

      const diff = computeAirportDiff(existingDbAirport, fixtureLoaderAirportASB);
      expect(diff.updateDoc.distance_to_nearest_km).toBeUndefined();
    });

    it('E. missing airport: upsert gets safe operational defaults', () => {
      const missingAirport = createDefaultMissingAirport(fixtureLoaderAirportASB);
      expect(missingAirport.iata_code).toBe('ASB');
      expect(missingAirport.time_zone).toBe('Asia/Ashgabat');
      expect(missingAirport.is_serviced_directly).toBe(false);
      expect(missingAirport.nearest_airport_code).toBe('');
      expect(missingAirport.distance_to_nearest_km).toBe(0);
      expect(missingAirport.data_source).toBe('ourairports');
    });
  });

  describe('City Code Preservation Invariant', () => {
    it('A. preserves good existing city_code when generic loader provides IATA fallback (NRT -> TYO)', () => {
      const existingNrt = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'NRT',
        airport_name: 'Narita International Airport',
        city_name: 'Tokyo',
        city_code: 'TYO', // Meaningful AirLabs-style metro code
        country_code: 'JP',
        time_zone: 'Asia/Tokyo',
        is_serviced_directly: true,
      };

      const loaderNrt: ImportedAirport = {
        iata_code: 'NRT',
        airport_name: 'Narita International Airport',
        city_name: 'Tokyo',
        city_code: 'NRT', // Generic loader fallback (iata_code used as city_code)
        country_code: 'JP',
        lat: 35.764702,
        lng: 140.386002,
        time_zone: 'Asia/Tokyo',
        is_serviced_directly: false,
        data_source: 'ourairports',
      };

      const diff = computeAirportDiff(existingNrt, loaderNrt);
      // city_code MUST NOT be in updateDoc so TYO is retained!
      expect(diff.updateDoc.city_code).toBeUndefined();
    });

    it('B. populates city_code when existing record has no city_code', () => {
      const existingWithoutCityCode = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'SGN',
        airport_name: 'Tan Son Nhat International Airport',
        city_name: 'Ho Chi Minh City',
        city_code: '', // Missing
        time_zone: 'Asia/Ho_Chi_Minh',
      };

      const loaderSgn: ImportedAirport = {
        iata_code: 'SGN',
        airport_name: 'Tan Son Nhat International Airport',
        city_name: 'Ho Chi Minh City',
        city_code: 'SGN',
        lat: 10.8188,
        lng: 106.652,
        time_zone: 'Asia/Ho_Chi_Minh',
        is_serviced_directly: true,
        data_source: 'ourairports',
      };

      const diff = computeAirportDiff(existingWithoutCityCode, loaderSgn);
      expect(diff.updateDoc.city_code).toBe('SGN');
    });

    it('C. operational fields remain untouched during city_code check', () => {
      const existingAirport = {
        _id: new mongoose.Types.ObjectId(),
        iata_code: 'HND',
        city_code: 'TYO',
        is_serviced_directly: true,
        nearest_airport_code: '',
        distance_to_nearest_km: 0,
      };

      const loaderHnd: ImportedAirport = {
        iata_code: 'HND',
        airport_name: 'Tokyo Haneda International Airport',
        city_name: 'Tokyo',
        city_code: 'HND',
        lat: 35.552299,
        lng: 139.779999,
        time_zone: 'Asia/Tokyo',
        is_serviced_directly: false,
        nearest_airport_code: 'NRT',
        distance_to_nearest_km: 60,
        data_source: 'ourairports',
      };

      const diff = computeAirportDiff(existingAirport, loaderHnd);
      expect(diff.updateDoc.city_code).toBeUndefined();
      expect(diff.updateDoc.is_serviced_directly).toBeUndefined();
      expect(diff.updateDoc.nearest_airport_code).toBeUndefined();
      expect(diff.updateDoc.distance_to_nearest_km).toBeUndefined();
    });
  });

  describe('Country Reference Bootstrap', () => {
    it('F. country bootstrap: DE creates English "Germany"', () => {
      const res = buildCountryRecord('DE');
      expect(res.action).toBe('insert');
      expect(res.record.code).toBe('DE');
      expect(res.record.name).toBe('Germany');
      expect(res.record.source).toBe('offline_reference');
    });

    it('G. Vietnamese display name exists where Intl supports it', () => {
      const deRes = buildCountryRecord('DE');
      expect(deRes.record.name_vi).toBe('Đức');

      const vnRes = buildCountryRecord('VN');
      expect(vnRes.record.name).toBe('Vietnam');
      expect(vnRes.record.name_vi).toBe('Việt Nam');

      const jpRes = buildCountryRecord('JP');
      expect(jpRes.record.name).toBe('Japan');
      expect(jpRes.record.name_vi).toBe('Nhật Bản');
    });

    it('preserves existing country record if it contains better explicit data', () => {
      const existingCustom = {
        _id: new mongoose.Types.ObjectId(),
        code: 'DE',
        name: 'Federal Republic of Germany',
        name_vi: 'Cộng hòa Liên bang Đức',
        code3: 'DEU',
        source: 'custom_curated',
      };
      const res = buildCountryRecord('DE', existingCustom);
      expect(res.action).toBe('unchanged');
      expect(res.record.name).toBe('Federal Republic of Germany');
      expect(res.record.name_vi).toBe('Cộng hòa Liên bang Đức');
    });
  });

  describe('In-Memory Planning & Upsert Operations', () => {
    const fixtureLoaderAirports: ImportedAirport[] = [
      {
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        city_code: 'ASB',
        lat: 37.986801,
        lng: 58.361,
        time_zone: 'UTC',
        is_serviced_directly: false,
        nearest_airport_code: '',
        distance_to_nearest_km: 0,
        data_source: 'ourairports',
      },
      {
        iata_code: 'SGN',
        airport_name: 'Tan Son Nhat International Airport',
        city_name: 'Ho Chi Minh City',
        country_code: 'VN',
        city_code: 'SGN',
        lat: 10.8188,
        lng: 106.652,
        time_zone: 'Asia/Ho_Chi_Minh',
        is_serviced_directly: true,
        nearest_airport_code: '',
        distance_to_nearest_km: 0,
        data_source: 'ourairports',
      },
    ];

    it('missing airports plan uses true upsert ($setOnInsert) with filter by iata_code', () => {
      const plan = planAirportRepairs([], fixtureLoaderAirports);
      expect(plan.missingInDb).toBe(2);
      expect(plan.upsertOperations.length).toBe(2);

      const op0 = plan.upsertOperations[0].updateOne;
      expect(op0.filter).toEqual({ iata_code: 'ASB' });
      expect(op0.upsert).toBe(true);
      expect(op0.update.$setOnInsert).toBeDefined();
      expect(op0.update.$setOnInsert.iata_code).toBe('ASB');
      expect(op0.update.$setOnInsert.is_serviced_directly).toBe(false);
    });

    it('missing countries plan uses true upsert ($setOnInsert) with filter by code', () => {
      const plan = planCountryRepairs([], ['DE', 'VN']);
      expect(plan.countriesToInsert).toBe(2);
      expect(plan.upsertOperations.length).toBe(2);

      const op0 = plan.upsertOperations[0].updateOne;
      expect(op0.filter).toEqual({ code: 'DE' });
      expect(op0.upsert).toBe(true);
      expect(op0.update.$setOnInsert).toBeDefined();
      expect(op0.update.$setOnInsert.code).toBe('DE');
      expect(op0.update.$setOnInsert.name).toBe('Germany');
    });

    it('H. second execution is idempotent (planning against updated data yields 0 changes)', () => {
      const initialDbAirports = [
        {
          _id: new mongoose.Types.ObjectId(),
          iata_code: 'ASB',
          airport_name: 'Ashgabat International Airport',
          city_name: 'Ashgabat',
          country_code: 'TM',
          city_code: 'ASB',
          lat: 37.986801,
          lng: 58.361,
          time_zone: 'UTC', // Outdated
          is_serviced_directly: true,
          nearest_airport_code: 'DXB',
          distance_to_nearest_km: 1200,
          data_source: 'ourairports',
        },
      ];

      // Pass 1: ASB needs update, SGN needs upsert
      const plan1 = planAirportRepairs(initialDbAirports, fixtureLoaderAirports);
      expect(plan1.timezoneMismatches).toBe(1);
      expect(plan1.updateOperations.length).toBe(1);
      expect(plan1.upsertOperations.length).toBe(1);

      // Simulate applying Pass 1
      const updatedDbAirports = [
        {
          ...initialDbAirports[0],
          time_zone: 'Asia/Ashgabat',
        },
        createDefaultMissingAirport(fixtureLoaderAirports[1]),
      ];

      // Pass 2: Identical reference data applied again
      const plan2 = planAirportRepairs(updatedDbAirports, fixtureLoaderAirports);
      expect(plan2.timezoneMismatches).toBe(0);
      expect(plan2.updateOperations.length).toBe(0);
      expect(plan2.upsertOperations.length).toBe(0);

      // Countries idempotency
      const countryCodes = ['DE', 'VN'];
      const countryPlan1 = planCountryRepairs([], countryCodes);
      expect(countryPlan1.countriesToInsert).toBe(2);

      const bootstrappedCountries = countryPlan1.upsertOperations.map((op) => op.updateOne.update.$setOnInsert);
      const countryPlan2 = planCountryRepairs(bootstrappedCountries, countryCodes);
      expect(countryPlan2.countriesToInsert).toBe(0);
      expect(countryPlan2.countriesToUpdate).toBe(0);
      expect(countryPlan2.countriesUnchanged).toBe(2);
    });
  });

  describe('Database Integration Verification (Isolated Test DB)', () => {
    let connection: mongoose.Connection;

    beforeAll(async () => {
      connection = await mongoose.createConnection(testMongoUri).asPromise();
      const db = connection.db;
      if (db) {
        await db.collection('airports').deleteMany({});
        await db.collection('countries').deleteMany({});
      }
    });

    afterAll(async () => {
      if (connection) {
        const db = connection.db;
        if (db) {
          await db.collection('airports').deleteMany({});
          await db.collection('countries').deleteMany({});
        }
        await connection.close();
      }
    });

    it('I. dry-run performs zero writes to MongoDB and execute uses true upserts', async () => {
      const db = connection.db!;
      const airportsColl = db.collection('airports');
      const countriesColl = db.collection('countries');

      // Seed 1 airport with UTC and a custom city_code
      await airportsColl.insertOne({
        iata_code: 'ASB',
        airport_name: 'Ashgabat International Airport',
        city_name: 'Ashgabat',
        country_code: 'TM',
        city_code: 'ASB',
        time_zone: 'UTC',
        is_serviced_directly: true,
        nearest_airport_code: 'DXB',
        distance_to_nearest_km: 1200,
        lat: 37.986801,
        lng: 58.361,
        data_source: 'ourairports',
      });

      const fixtureLoader = [
        {
          iata_code: 'ASB',
          airport_name: 'Ashgabat International Airport',
          city_name: 'Ashgabat',
          country_code: 'TM',
          city_code: 'ASB',
          lat: 37.986801,
          lng: 58.361,
          time_zone: 'UTC',
          is_serviced_directly: false,
          nearest_airport_code: '',
          distance_to_nearest_km: 0,
          data_source: 'ourairports',
        },
        {
          iata_code: 'NRT',
          airport_name: 'Narita International Airport',
          city_name: 'Tokyo',
          country_code: 'JP',
          city_code: 'NRT',
          lat: 35.764702,
          lng: 140.386002,
          time_zone: 'Asia/Tokyo',
          is_serviced_directly: false,
          nearest_airport_code: '',
          distance_to_nearest_km: 0,
          data_source: 'ourairports',
        },
      ];

      // Run in dry-run mode
      const dryStats = await runReferenceDataRepair({
        mongoUri: testMongoUri,
        isExecute: false,
        customRefAirports: fixtureLoader,
        quiet: true,
      });

      expect(dryStats.database.isDryRun).toBe(true);
      expect(dryStats.airports.timezoneMismatches).toBe(1);
      expect(dryStats.airports.updatedCount).toBe(0);
      expect(dryStats.airports.upsertedCount).toBe(0);
      expect(dryStats.countries.insertedCount).toBe(0);

      // Verify DB remains completely untouched
      const airportAfter = await airportsColl.findOne({ iata_code: 'ASB' });
      expect(airportAfter?.time_zone).toBe('UTC');
      const countBefore = await airportsColl.countDocuments();
      expect(countBefore).toBe(1);
      const countriesCount = await countriesColl.countDocuments();
      expect(countriesCount).toBe(0);

      // Run in execute mode
      const execStats = await runReferenceDataRepair({
        mongoUri: testMongoUri,
        isExecute: true,
        customRefAirports: fixtureLoader,
        quiet: true,
      });

      expect(execStats.database.isDryRun).toBe(false);
      expect(execStats.airports.updatedCount).toBe(1); // ASB
      expect(execStats.airports.upsertedCount).toBe(1); // NRT
      expect(execStats.countries.upsertedCount).toBe(2); // TM, JP

      // Verify DB was mutated accurately
      const airportMutated = await airportsColl.findOne({ iata_code: 'ASB' });
      expect(airportMutated?.time_zone).toBe('Asia/Ashgabat');
      // Operational fields preserved
      expect(airportMutated?.is_serviced_directly).toBe(true);
      expect(airportMutated?.nearest_airport_code).toBe('DXB');
      expect(airportMutated?.distance_to_nearest_km).toBe(1200);

      const nrtUpserted = await airportsColl.findOne({ iata_code: 'NRT' });
      expect(nrtUpserted?.iata_code).toBe('NRT');
      expect(nrtUpserted?.time_zone).toBe('Asia/Tokyo');
      expect(nrtUpserted?.is_serviced_directly).toBe(false);

      const tmCountry = await countriesColl.findOne({ code: 'TM' });
      expect(tmCountry?.name).toBe('Turkmenistan');
      const jpCountry = await countriesColl.findOne({ code: 'JP' });
      expect(jpCountry?.name).toBe('Japan');

      // Verify second execution does 0 modifications / 0 new upserts (idempotent)
      const execStats2 = await runReferenceDataRepair({
        mongoUri: testMongoUri,
        isExecute: true,
        customRefAirports: fixtureLoader,
        quiet: true,
      });
      expect(execStats2.airports.updatedCount).toBe(0);
      expect(execStats2.airports.upsertedCount).toBe(0);
      expect(execStats2.countries.upsertedCount).toBe(0);
      expect(execStats2.countries.updatedCount).toBe(0);

      // Verify document counts did not duplicate
      const finalAirportsCount = await airportsColl.countDocuments();
      expect(finalAirportsCount).toBe(2);
      const finalCountriesCount = await countriesColl.countDocuments();
      expect(finalCountriesCount).toBe(2);
    });
  });
});
