import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as https from 'https';
import tzlookup = require('tz-lookup');
import {
  AIRPORT_REFERENCE_DATA,
  CURATED_NEAREST_OVERLAYS,
  CuratedAirport,
} from './airports-reference.data';

export interface ImportedAirport {
  iata_code: string;
  icao_code?: string;
  airport_name: string;
  city_name: string;
  country_code?: string;
  city_code?: string;
  lat: number;
  lng: number;
  time_zone: string;
  is_serviced_directly: boolean;
  nearest_airport_code?: string;
  distance_to_nearest_km?: number;
  data_source: string;
}

export const APTECH_SERVICED_HUBS = [
  'HAN',
  'SGN',
  'DAD',
  'CXR',
  'PQC',
  'SIN',
  'BKK',
  'KUL',
  'HKG',
  'ICN',
  'NRT',
  'TPE',
  'SYD',
  'MEL',
  'LAX',
  'SFO',
  'JFK',
  'LHR',
  'CDG',
] as const;

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth mean radius in km
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

/**
 * Robust RFC-4180 compliant CSV line parser supporting quoted fields and embedded commas.
 */
export function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current);
  return values;
}

/**
 * Ensures the reference OurAirports airports.csv file exists locally.
 * If not present, downloads it once and caches it.
 */
export async function ensureOurAirportsCsv(targetFile: string): Promise<void> {
  if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 1000000) {
    return;
  }
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const url = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
  console.log(`Downloading OurAirports dataset from ${url}...`);

  await new Promise<void>((resolve, reject) => {
    const fileStream = fs.createWriteStream(targetFile);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download airports.csv: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(targetFile, () => {});
        reject(err);
      });
  });
}

/**
 * Loads and processes all valid airports with 3-letter IATA codes from OurAirports dataset.
 * Combines with SRS curated reference airports (e.g. HOI) and applies curated nearest overlays.
 */
export async function loadOurAirportsReferenceData(
  csvFilePath?: string,
): Promise<{ airports: ImportedAirport[]; totalParsed: number; validIataCount: number }> {
  const filePath =
    csvFilePath ||
    path.join(process.cwd(), 'data', 'reference', 'airports.csv');

  await ensureOurAirportsCsv(filePath);

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let iataIdx = -1;
  let icaoIdx = -1;
  let nameIdx = -1;
  let latIdx = -1;
  let lngIdx = -1;
  let countryIdx = -1;
  let municipalityIdx = -1;
  let typeIdx = -1;

  const airportMap = new Map<string, { airport: ImportedAirport; rank: number }>();

  // Facility type precedence rank for deduplication (higher is preferred)
  const typeRank = (t: string): number => {
    switch (t) {
      case 'large_airport':
        return 4;
      case 'medium_airport':
        return 3;
      case 'small_airport':
        return 2;
      case 'seaplane_base':
        return 1;
      case 'heliport':
        return 1;
      default:
        return 0;
    }
  };

  let totalParsed = 0;
  let validIataCount = 0;

  for await (const line of rl) {
    if (!line || line.trim().length === 0) continue;
    if (headers.length === 0) {
      headers = parseCSVLine(line).map((h) => h.trim().toLowerCase());
      iataIdx = headers.indexOf('iata_code');
      icaoIdx = headers.indexOf('ident');
      nameIdx = headers.indexOf('name');
      latIdx = headers.indexOf('latitude_deg');
      lngIdx = headers.indexOf('longitude_deg');
      countryIdx = headers.indexOf('iso_country');
      municipalityIdx = headers.indexOf('municipality');
      typeIdx = headers.indexOf('type');
      continue;
    }

    totalParsed++;
    const cols = parseCSVLine(line);
    const iata = cols[iataIdx]?.trim().toUpperCase();
    const facilityType = cols[typeIdx]?.trim().toLowerCase() || '';

    // Filter: Must have valid 3-letter IATA code, and facility must not be closed
    if (!iata || !/^[A-Z]{3}$/.test(iata) || facilityType === 'closed') {
      continue;
    }

    validIataCount++;
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }

    const name = cols[nameIdx]?.trim() || `${iata} Airport`;
    let municipality = cols[municipalityIdx]?.trim() || '';
    if (!municipality) {
      municipality = name.replace(/International|Airport|Air Base|Heliport|Intl/gi, '').trim();
    }
    if (!municipality) municipality = iata;

    const country = cols[countryIdx]?.trim().toUpperCase() || '';
    const icao = cols[icaoIdx]?.trim().toUpperCase() || undefined;

    // Offline IANA Timezone resolution
    let timeZone = 'UTC';
    try {
      timeZone = tzlookup(lat, lng);
    } catch {
      timeZone = 'UTC';
    }

    const rank = typeRank(facilityType);
    const existing = airportMap.get(iata);
    if (!existing || rank > existing.rank) {
      airportMap.set(iata, {
        airport: {
          iata_code: iata,
          icao_code: icao,
          airport_name: name,
          city_name: municipality,
          country_code: country,
          city_code: iata,
          lat,
          lng,
          time_zone: timeZone,
          is_serviced_directly: false, // Default false; only active Aptech schedule hubs are true
          nearest_airport_code: '',
          distance_to_nearest_km: 0,
          data_source: 'ourairports',
        },
        rank,
      });
    }
  }

  // Overlay curated SRS reference data (e.g. HOI town heliport and Vietnamese special aerodromes)
  for (const curated of AIRPORT_REFERENCE_DATA) {
    const existing = airportMap.get(curated.iata_code);
    if (!existing) {
      airportMap.set(curated.iata_code, {
        airport: {
          iata_code: curated.iata_code,
          icao_code: curated.icao_code,
          airport_name: curated.airport_name,
          city_name: curated.city_name,
          country_code: curated.country_code,
          city_code: curated.city_code || curated.iata_code,
          lat: curated.lat,
          lng: curated.lng,
          time_zone: curated.time_zone,
          is_serviced_directly: false,
          nearest_airport_code: curated.nearest_airport_code || '',
          distance_to_nearest_km: curated.distance_to_nearest_km || 0,
          data_source: 'curated_srs',
        },
        rank: 10,
      });
    } else {
      // Preserve curated precise coordinates and city name
      existing.airport.city_name = curated.city_name;
      existing.airport.airport_name = curated.airport_name;
      existing.airport.time_zone = curated.time_zone;
      if (curated.country_code) existing.airport.country_code = curated.country_code;
    }
  }

  // 1. Resolve coordinates of the 19 active Aptech serviced hubs
  const activeHubCoords: { iata: string; lat: number; lng: number }[] = [];
  for (const hubIata of APTECH_SERVICED_HUBS) {
    const hubEntry = airportMap.get(hubIata);
    if (
      hubEntry &&
      typeof hubEntry.airport.lat === 'number' &&
      typeof hubEntry.airport.lng === 'number'
    ) {
      activeHubCoords.push({
        iata: hubIata,
        lat: hubEntry.airport.lat,
        lng: hubEntry.airport.lng,
      });
      hubEntry.airport.is_serviced_directly = true;
      hubEntry.airport.nearest_airport_code = '';
      hubEntry.airport.distance_to_nearest_km = 0;
    }
  }

  // 2. For every unserved airport, compute Haversine distance to the nearest active serviced hub
  for (const entry of airportMap.values()) {
    const apt = entry.airport;
    if ((APTECH_SERVICED_HUBS as readonly string[]).includes(apt.iata_code)) {
      apt.is_serviced_directly = true;
      apt.nearest_airport_code = '';
      apt.distance_to_nearest_km = 0;
      continue;
    }

    apt.is_serviced_directly = false;

    if (
      typeof apt.lat === 'number' &&
      typeof apt.lng === 'number' &&
      !isNaN(apt.lat) &&
      !isNaN(apt.lng) &&
      activeHubCoords.length > 0
    ) {
      let nearestHub = activeHubCoords[0].iata;
      let minDistance = haversineDistanceKm(
        apt.lat,
        apt.lng,
        activeHubCoords[0].lat,
        activeHubCoords[0].lng,
      );

      for (let i = 1; i < activeHubCoords.length; i++) {
        const d = haversineDistanceKm(
          apt.lat,
          apt.lng,
          activeHubCoords[i].lat,
          activeHubCoords[i].lng,
        );
        if (d < minDistance) {
          minDistance = d;
          nearestHub = activeHubCoords[i].iata;
        }
      }

      apt.nearest_airport_code = nearestHub;
      apt.distance_to_nearest_km = Math.max(1, minDistance);
    }
  }

  // 3. Apply Curated Nearest Overlays (e.g. MUC/AMS -> CDG, DAD/PQC links) as explicit overrides
  for (const [code, overlay] of Object.entries(CURATED_NEAREST_OVERLAYS)) {
    const entry = airportMap.get(code.toUpperCase());
    if (entry) {
      entry.airport.nearest_airport_code = overlay.nearest_airport_code;
      entry.airport.distance_to_nearest_km = overlay.distance_to_nearest_km;
    }
  }

  const airports = Array.from(airportMap.values()).map((v) => v.airport);
  return { airports, totalParsed, validIataCount };
}
