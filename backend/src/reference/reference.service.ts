import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Country, CountryDocument, City, CityDocument, RouteRef, RouteRefDocument, RouteSyncState, RouteSyncStateDocument } from './reference.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import { AirportsService } from '../airports/airports.service';

const VI_NAMES: Record<string, string> = {
  VN: 'Việt Nam', SG: 'Singapore', TH: 'Thái Lan', MY: 'Malaysia', JP: 'Nhật Bản', KR: 'Hàn Quốc', HK: 'Hồng Kông', CN: 'Trung Quốc', TW: 'Đài Loan', PH: 'Philippines', ID: 'Indonesia', IN: 'Ấn Độ', AE: 'Các Tiểu vương quốc Ả Rập Thống nhất', QA: 'Qatar', GB: 'Vương quốc Anh', FR: 'Pháp', DE: 'Đức', AU: 'Úc', US: 'Hoa Kỳ', KH: 'Campuchia', LA: 'Lào', MM: 'Myanmar', BN: 'Brunei', NZ: 'New Zealand', CA: 'Canada'
};

// Deterministic identity generator function.
// Why no fake midnight 00:00 or invented dates are used:
// NOTIME, NODAYS preserve honesty for coarse route edges without complete schedules.
export function computeSourceKey(item: any): string {
  const carrier = (item.airline_iata || item.airline_icao || 'UNK').trim().toUpperCase();
  const flight = (item.flight_iata || (item.flight_number ? `${item.airline_iata || ''}${item.flight_number}` : 'NOFLT')).trim().toUpperCase();
  const dep = (item.dep_iata || 'UNK').trim().toUpperCase();
  const arr = (item.arr_iata || 'UNK').trim().toUpperCase();
  const time = item.dep_time_utc ? `T:${item.dep_time_utc.trim()}` : (item.dep_time ? `L:${item.dep_time.trim()}` : 'NOTIME');
  const days = Array.isArray(item.days) && item.days.length > 0 ? `D:${[...item.days].map((d: string) => d.trim().toLowerCase()).sort().join(',')}` : 'NODAYS';
  const cs = item.cs_flight_iata ? `_CS:${item.cs_flight_iata.trim().toUpperCase()}` : '';
  return `AIRLABS_${carrier}_${flight}_${dep}_${arr}_${time}_${days}${cs}`;
}

export interface ExpandedLocation {
  iata_codes: string[];
  matched_kind: 'airport' | 'city' | 'country' | 'iata_list' | 'none';
  label: string;
  using_nearest_airport: boolean;
  nearest_suggestion?: {
    airport: Airport | any;
    distance_km: number;
    for_city: string;
  };
}

@Injectable()
export class ReferenceService {
  constructor(
    @InjectModel(Country.name) private countryModel: Model<CountryDocument>,
    @InjectModel(City.name) private cityModel: Model<CityDocument>,
    @InjectModel(RouteRef.name) private routeRefModel: Model<RouteRefDocument>,
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
    @InjectModel(RouteSyncState.name) private routeSyncStateModel: Model<RouteSyncStateDocument>,
    private readonly airportsService: AirportsService,
  ) {}

  private getApiKey(): string {
    const apiKey = process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env.');
    }
    return apiKey;
  }

  // Lấy danh sách quốc gia từ AirLabs và lưu DB
  async syncCountries(codes?: string[]) {
    const apiKey = this.getApiKey();
    let codesToSync = codes;
    if (!codesToSync || codesToSync.length === 0) {
      const distinctCountries = await this.airportModel.distinct('country_code').exec();
      codesToSync = distinctCountries.filter(c => c);
    }
    if (codesToSync.length === 0) return { updated: 0 };

    let updated = 0;
    for (const code of codesToSync) {
      const res = await fetch(`https://airlabs.co/api/v9/countries?code=${code}&api_key=${apiKey}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.response && data.response.length > 0) {
        const c = data.response[0];
        await this.countryModel.findOneAndUpdate(
          { code: c.code },
          { 
            code: c.code, 
            code3: c.code3, 
            name: c.name, 
            name_vi: VI_NAMES[c.code] || '' 
          },
          { upsert: true, new: true }
        ).exec();
        updated++;
      }
    }
    return { updated };
  }

  async getAllCountries() {
    return this.countryModel.find().exec();
  }

  // Lấy các thành phố của một quốc gia
  async syncCitiesForCountry(countryCode: string, limit = 200) {
    const apiKey = this.getApiKey();
    const res = await fetch(`https://airlabs.co/api/v9/cities?country_code=${countryCode}&api_key=${apiKey}`);
    if (!res.ok) throw new BadRequestException('Lỗi khi gọi AirLabs API');
    const data = await res.json();
    if (!data.response) return { updated: 0 };

    let updated = 0;
    const items = data.response.slice(0, limit);
    for (const item of items) {
      if (!item.city_code) continue;
      await this.cityModel.findOneAndUpdate(
        { city_code: item.city_code },
        {
          city_code: item.city_code,
          name: item.name,
          country_code: item.country_code,
          lat: item.lat,
          lng: item.lng
        },
        { upsert: true, new: true }
      ).exec();
      updated++;
    }
    return { updated };
  }

  // Lấy mạng đường bay thực tế xuất phát từ 1 sân bay (phân trang tối đa 5 trang để thu thập đầy đủ)
  async syncRoutesForAirport(depIata: string, limit = 200, explicitOffset?: number) {
    const apiKey = this.getApiKey();
    const cleanDep = depIata?.trim().toUpperCase();
    if (!cleanDep) return { dep_iata: depIata, updated: 0, records_seen: 0, pages: 0, truncated: false, complete: false };

    // 1. Determine generation and starting offset
    const existingSyncState = await this.routeSyncStateModel.findOne({ dep_iata: cleanDep }).exec();

    let generation: string;
    let currentOffset: number;
    let generationStartedAtZero: boolean;
    let totalSeen = 0;
    let totalUpdated = 0;

    if (explicitOffset !== undefined) {
      if (explicitOffset > 0) {
        // Check if this explicit offset matches an in-progress/truncated generation to resume
        if (
          existingSyncState &&
          !existingSyncState.complete &&
          existingSyncState.truncated &&
          existingSyncState.next_offset === explicitOffset &&
          existingSyncState.sync_generation
        ) {
          generation = existingSyncState.sync_generation;
          currentOffset = explicitOffset;
          generationStartedAtZero = existingSyncState.generation_started_at_offset_zero ?? false;
          totalSeen = existingSyncState.records_seen ?? 0;
          totalUpdated = existingSyncState.records_upserted ?? 0;
        } else {
          // Arbitrary offset call: NOT a full snapshot from 0
          generation = `adhoc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          currentOffset = explicitOffset;
          generationStartedAtZero = false;
        }
      } else {
        // explicitOffset === 0 -> fresh full scan
        generation = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        currentOffset = 0;
        generationStartedAtZero = true;
      }
    } else {
      // explicitOffset is undefined: check if we should resume a truncated sync
      if (
        existingSyncState &&
        !existingSyncState.complete &&
        existingSyncState.truncated &&
        typeof existingSyncState.next_offset === 'number' &&
        existingSyncState.sync_generation
      ) {
        generation = existingSyncState.sync_generation;
        currentOffset = existingSyncState.next_offset;
        generationStartedAtZero = existingSyncState.generation_started_at_offset_zero ?? false;
        totalSeen = existingSyncState.records_seen ?? 0;
        totalUpdated = existingSyncState.records_upserted ?? 0;
      } else {
        // Start fresh from 0
        generation = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        currentOffset = 0;
        generationStartedAtZero = true;
      }
    }

    // 2. Mark refresh incomplete BEFORE partial mutation
    await this.routeSyncStateModel.findOneAndUpdate(
      { dep_iata: cleanDep },
      {
        dep_iata: cleanDep,
        source: 'airlabs',
        sync_generation: generation,
        generation_started_at_offset_zero: generationStartedAtZero,
        next_offset: currentOffset,
        last_synced_at: new Date(),
        complete: false,
        truncated: false,
        records_seen: totalSeen,
        records_upserted: totalUpdated,
        last_error: undefined,
      },
      { upsert: true, new: true },
    ).exec();

    let pageCount = 0;
    let truncated = false;
    let authoritativeEnd = false;
    let pageStartOffset = currentOffset;

    try {
      // Giới hạn 5 trang để không làm tràn hạn ngạch request tới AirLabs API
      while (pageCount < 5) {
        pageCount++;
        pageStartOffset = currentOffset;

        const res = await fetch(`https://airlabs.co/api/v9/routes?dep_iata=${cleanDep}&limit=${limit}&offset=${currentOffset}&api_key=${apiKey}`);
        
        if (res.status === 429) {
          throw new BadRequestException('AirLabs API Rate Limit (429): Quota exceeded or too many requests.');
        }
        if (!res.ok) {
          throw new BadRequestException(`Lỗi khi gọi AirLabs API: HTTP mã ${res.status}`);
        }
        
        const data = await res.json();
        const items: any[] = Array.isArray(data.response) ? data.response : [];

        const providerHasMore = data.request?.has_more;
        let continuePagination = false;

        if (typeof providerHasMore === 'boolean') {
          if (providerHasMore === false) {
            authoritativeEnd = true;
            continuePagination = false;
          } else {
            authoritativeEnd = false;
            continuePagination = true;
          }
        } else {
          // request.has_more is missing/undefined/non-boolean
          authoritativeEnd = false;
          // Conservative fallback only to decide whether another fetch is worth attempting
          continuePagination = items.length >= limit;
        }

        for (const item of items) {
          totalSeen++;
          if (!item.airline_iata || !item.dep_iata || !item.arr_iata) continue;
          
          const source_key = computeSourceKey(item);
          const has_schedule = !!(item.dep_time || item.dep_time_utc) && Array.isArray(item.days) && item.days.length > 0;
          
          try {
            await this.routeRefModel.findOneAndUpdate(
              { source_key },
              {
                source_key,
                sync_generation: generation,
                airline_iata: item.airline_iata.trim().toUpperCase(),
                airline_icao: item.airline_icao?.trim().toUpperCase(),
                flight_number: item.flight_number?.toString().trim(),
                flight_iata: item.flight_iata?.trim().toUpperCase(),
                flight_icao: item.flight_icao?.trim().toUpperCase(),
                cs_airline_iata: item.cs_airline_iata?.trim().toUpperCase(),
                cs_flight_iata: item.cs_flight_iata?.trim().toUpperCase(),
                cs_flight_number: item.cs_flight_number?.toString().trim(),
                dep_iata: item.dep_iata.trim().toUpperCase(),
                dep_icao: item.dep_icao?.trim().toUpperCase(),
                dep_time: item.dep_time?.trim(),
                dep_time_utc: item.dep_time_utc?.trim(),
                dep_terminals: Array.isArray(item.dep_terminals) ? item.dep_terminals : undefined,
                arr_iata: item.arr_iata.trim().toUpperCase(),
                arr_icao: item.arr_icao?.trim().toUpperCase(),
                arr_time: item.arr_time?.trim(),
                arr_time_utc: item.arr_time_utc?.trim(),
                arr_terminals: Array.isArray(item.arr_terminals) ? item.arr_terminals : undefined,
                duration: typeof item.duration === 'number' ? item.duration : undefined,
                days: Array.isArray(item.days) ? item.days.map((d: string) => d.trim().toLowerCase()) : undefined,
                aircraft_icao: item.aircraft_icao?.trim().toUpperCase(),
                has_schedule,
                source: 'airlabs',
                synced_at: new Date(),
                airlabs_updated: item.updated,
              },
              { upsert: true, new: true },
            ).exec();
            totalUpdated++;
          } catch (e: any) {
            if (e.code === 11000) {
              // Only treat as idempotent collision if the duplicate key error is explicitly on source_key
              const isSourceKeyConflict =
                (e.keyPattern && Object.keys(e.keyPattern).length === 1 && e.keyPattern.source_key !== undefined) ||
                (typeof e.message === 'string' &&
                  (e.message.includes('index: source_key_') || e.message.includes('dup key: { source_key:')));

              if (isSourceKeyConflict) {
                // Idempotent race: another concurrent sync upserted the same deterministic source_key.
                // Retry update without upsert to ensure the record contains the latest fields.
                await this.routeRefModel.findOneAndUpdate(
                  { source_key },
                  {
                    $set: {
                      airline_iata: item.airline_iata.trim().toUpperCase(),
                      airline_icao: item.airline_icao?.trim().toUpperCase(),
                      flight_number: item.flight_number?.toString().trim(),
                      flight_iata: item.flight_iata?.trim().toUpperCase(),
                      flight_icao: item.flight_icao?.trim().toUpperCase(),
                      cs_airline_iata: item.cs_airline_iata?.trim().toUpperCase(),
                      cs_flight_iata: item.cs_flight_iata?.trim().toUpperCase(),
                      cs_flight_number: item.cs_flight_number?.toString().trim(),
                      dep_iata: item.dep_iata.trim().toUpperCase(),
                      dep_icao: item.dep_icao?.trim().toUpperCase(),
                      dep_time: item.dep_time?.trim(),
                      dep_time_utc: item.dep_time_utc?.trim(),
                      dep_terminals: Array.isArray(item.dep_terminals) ? item.dep_terminals : undefined,
                      arr_iata: item.arr_iata.trim().toUpperCase(),
                      arr_icao: item.arr_icao?.trim().toUpperCase(),
                      arr_time: item.arr_time?.trim(),
                      arr_time_utc: item.arr_time_utc?.trim(),
                      arr_terminals: Array.isArray(item.arr_terminals) ? item.arr_terminals : undefined,
                      duration: typeof item.duration === 'number' ? item.duration : undefined,
                      days: Array.isArray(item.days) ? item.days.map((d: string) => d.trim().toLowerCase()) : undefined,
                      aircraft_icao: item.aircraft_icao?.trim().toUpperCase(),
                      has_schedule,
                      source: 'airlabs',
                      synced_at: new Date(),
                      airlabs_updated: item.updated,
                    },
                  },
                  { new: true },
                ).exec();
                totalUpdated++;
              } else {
                // Duplicate key collision on an unexpected index (e.g. obsolete unique index).
                // Must remain observable!
                throw e;
              }
            } else {
              throw e;
            }
          }
        }

        currentOffset += items.length;

        if (authoritativeEnd || items.length === 0 || !continuePagination) {
          break;
        }

        if (pageCount >= 5 && continuePagination) {
          truncated = true;
          break;
        }
      }
    } catch (err: any) {
      // Record failure state without marking complete
      // Persist offset at the beginning of the failed page so no records are skipped on retry
      await this.routeSyncStateModel.findOneAndUpdate(
        { dep_iata: cleanDep },
        {
          dep_iata: cleanDep,
          source: 'airlabs',
          sync_generation: generation,
          generation_started_at_offset_zero: generationStartedAtZero,
          next_offset: pageStartOffset,
          last_synced_at: new Date(),
          complete: false,
          truncated: true,
          records_seen: totalSeen,
          records_upserted: totalUpdated,
          last_error: err.message,
        },
        { upsert: true, new: true },
      ).exec();

      throw err;
    }

    const isComplete = !truncated && authoritativeEnd && generationStartedAtZero;

    // Prune obsolete AirLabs routes only on complete, successful, non-truncated sync of a full generation starting at 0
    if (isComplete && pageCount > 0) {
      await this.routeRefModel.deleteMany({
        source: 'airlabs',
        dep_iata: cleanDep,
        sync_generation: { $ne: generation },
      }).exec();
    }

    // Persist finalized sync state
    await this.routeSyncStateModel.findOneAndUpdate(
      { dep_iata: cleanDep },
      {
        dep_iata: cleanDep,
        source: 'airlabs',
        sync_generation: generation,
        generation_started_at_offset_zero: generationStartedAtZero,
        next_offset: isComplete ? 0 : currentOffset,
        last_synced_at: new Date(),
        complete: isComplete,
        truncated,
        records_seen: totalSeen,
        records_upserted: totalUpdated,
        last_error: undefined,
      },
      { upsert: true, new: true },
    ).exec();

    return {
      dep_iata: cleanDep,
      updated: totalUpdated,
      records_seen: totalSeen,
      pages: pageCount,
      truncated,
      complete: isComplete,
      sync_generation: generation,
      next_offset: isComplete ? 0 : currentOffset,
    };
  }

  async ensureRoutesForAirport(depIata: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const cleanDep = depIata?.trim().toUpperCase();
    if (!cleanDep) return { from_cache: true, stale: false, synced_at: null, complete: false, truncated: false, count: 0, routes: [] };

    const routes = await this.routeRefModel.find({ dep_iata: cleanDep }).exec();
    const syncState = await this.routeSyncStateModel.findOne({ dep_iata: cleanDep }).exec();
    const latestSyncedAt = syncState?.last_synced_at || routes.reduce((latest: Date | null, r: any) => !latest || (r.synced_at && new Date(r.synced_at) > latest) ? new Date(r.synced_at) : latest, null);

    const isFresh = Boolean(latestSyncedAt && (Date.now() - new Date(latestSyncedAt).getTime()) < maxAgeMs);
    const isComplete = Boolean(syncState?.complete && !syncState?.truncated);

    // Case 1: Fresh AND complete cache exists
    if (routes.length > 0 && isFresh && isComplete) {
      return {
        from_cache: true,
        stale: false,
        synced_at: latestSyncedAt,
        complete: true,
        truncated: false,
        count: routes.length,
        routes,
      };
    }

    // Case 2: Cache completely missing
    if (routes.length === 0) {
      try {
        await this.syncRoutesForAirport(cleanDep);
      } catch (err: any) {
        throw new BadRequestException(`Không thể tải dữ liệu tuyến bay cho sân bay ${cleanDep} từ AirLabs: ${err.message}`);
      }
      const freshRoutes = await this.routeRefModel.find({ dep_iata: cleanDep }).exec();
      const freshSyncState = await this.routeSyncStateModel.findOne({ dep_iata: cleanDep }).exec();
      return {
        from_cache: false,
        stale: false,
        synced_at: freshSyncState?.last_synced_at || new Date(),
        complete: freshSyncState?.complete ?? false,
        truncated: freshSyncState?.truncated ?? false,
        count: freshRoutes.length,
        routes: freshRoutes,
      };
    }

    // Case 3: Cache exists but is stale OR incomplete/truncated -> attempt refresh / resume
    try {
      await this.syncRoutesForAirport(cleanDep);
      const refreshedRoutes = await this.routeRefModel.find({ dep_iata: cleanDep }).exec();
      const refreshedSyncState = await this.routeSyncStateModel.findOne({ dep_iata: cleanDep }).exec();
      return {
        from_cache: false,
        stale: false,
        synced_at: refreshedSyncState?.last_synced_at || new Date(),
        complete: refreshedSyncState?.complete ?? false,
        truncated: refreshedSyncState?.truncated ?? false,
        count: refreshedRoutes.length,
        routes: refreshedRoutes,
      };
    } catch (err: any) {
      // Re-read latest syncState to get any updated last_error / incomplete status
      const updatedSyncState = await this.routeSyncStateModel.findOne({ dep_iata: cleanDep }).exec();
      return {
        from_cache: true,
        stale: true,
        synced_at: updatedSyncState?.last_synced_at || latestSyncedAt,
        complete: updatedSyncState?.complete ?? false,
        truncated: updatedSyncState?.truncated ?? true,
        count: routes.length,
        routes,
        refresh_error: err.message,
      };
    }
  }

  async syncRoutesForAllOurAirports() {
    // Quét toàn bộ sân bay đang phục vụ trực tiếp để lấy mạng đường bay thực tế
    const airports = await this.airportModel.find({ is_serviced_directly: true }).exec();
    let totalUpdated = 0;
    const perAirport: Array<{ iata_code: string; updated: number; pages?: number }> = [];

    for (const apt of airports) {
      try {
        const result = await this.syncRoutesForAirport(apt.iata_code);
        totalUpdated += result.updated;
        perAirport.push({ iata_code: apt.iata_code, updated: result.updated, pages: result.pages });
      } catch (err: any) {
        perAirport.push({ iata_code: apt.iata_code, updated: 0 });
      }
      // Nghỉ ngắn để bảo đảm không vượt quá tần suất request của AirLabs
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return {
      total_airports: airports.length,
      updated: totalUpdated,
      per_airport: perAirport,
    };
  }

  async syncRoutesForHubs(hubs?: string[]) {
    const defaultHubs = ['HAN', 'SGN', 'DAD', 'BKK', 'SIN', 'KUL', 'HKG', 'PVG', 'PEK', 'CAN', 'NRT', 'HND', 'KIX', 'ICN', 'TPE', 'MNL', 'CGK', 'DEL', 'BOM', 'DXB', 'DOH', 'AUH', 'IST', 'LHR', 'CDG', 'FRA', 'AMS', 'JFK', 'LAX', 'SYD', 'MEL'];
    const hubsToSync = hubs && hubs.length > 0 ? hubs : defaultHubs;
    
    const existingHubs = await this.airportModel.distinct('iata_code', { iata_code: { $in: hubsToSync } }).exec();
    const validHubs = hubsToSync.filter(h => existingHubs.includes(h.toUpperCase()));
    
    let totalUpdated = 0;
    const perHubCounts = [];
    
    for (const hub of validHubs) {
      try {
        const result = await this.syncRoutesForAirport(hub, 200, 0);
        totalUpdated += result.updated;
        perHubCounts.push({ hub: hub.toUpperCase(), updated: result.updated, pages: result.pages });
      } catch (err: any) {
        if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate limit') || err.message?.toLowerCase().includes('quota') || err.status === 429) {
          return {
            total_updated: totalUpdated,
            per_hub: perHubCounts,
            rate_limited: true,
            message: 'AirLabs đã chặn do vượt quá giới hạn (Rate Limit). Đã dừng sớm.',
          };
        }
        perHubCounts.push({ hub: hub.toUpperCase(), updated: 0, error: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    return {
      total_updated: totalUpdated,
      per_hub: perHubCounts
    };
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Tìm kiếm gợi ý dựa trên chuỗi query (tìm trong DB)
  async suggest(q: string) {
    if (!q || q.trim().length === 0) {
      return { countries: [], cities: [], airports: [] };
    }
    const cleanQ = q.trim();
    const regex = new RegExp(this.escapeRegex(cleanQ), 'i');

    const countries = await this.countryModel.find({
      $or: [{ name: regex }, { name_vi: regex }, { code: regex }]
    }).limit(8).exec();

    const rawCities = await this.cityModel.find({
      $or: [{ name: regex }, { name_vi: regex }, { city_code: regex }]
    }).limit(8).exec();

    const allAirports = await this.airportModel.find({ is_serviced_directly: true }).exec();

    const cities = rawCities.map(c => {
      const apts = allAirports.filter(a => a.city_code === c.city_code || a.city_name.toLowerCase() === c.name.toLowerCase());
      return {
        city_code: c.city_code,
        name: c.name,
        name_vi: c.name_vi,
        country_code: c.country_code,
        airport_count: apts.length,
        iata_codes: apts.map(a => a.iata_code)
      };
    });

    const matchedAirports = await this.airportModel
      .find({
        $or: [
          { iata_code: regex },
          { airport_name: regex },
          { city_name: regex },
        ],
      })
      .limit(30)
      .exec();

    // Sort: Exact IATA match first, then directly serviced hubs first, then alphabetical by city
    const upperQ = cleanQ.toUpperCase();
    const sortedAirports = matchedAirports
      .sort((a, b) => {
        const aExactIata = a.iata_code.toUpperCase() === upperQ ? 1 : 0;
        const bExactIata = b.iata_code.toUpperCase() === upperQ ? 1 : 0;
        if (aExactIata !== bExactIata) return bExactIata - aExactIata;

        const aServiced = a.is_serviced_directly ? 1 : 0;
        const bServiced = b.is_serviced_directly ? 1 : 0;
        if (aServiced !== bServiced) return bServiced - aServiced;

        return (a.city_name || '').localeCompare(b.city_name || '');
      })
      .slice(0, 10);

    return {
      countries: countries.map((c) => ({ code: c.code, name: c.name, name_vi: c.name_vi })),
      cities,
      airports: sortedAirports.map((a) => ({
        iata_code: a.iata_code,
        airport_name: a.airport_name,
        city_name: a.city_name,
        country_code: a.country_code,
        time_zone: a.time_zone,
        is_serviced_directly: a.is_serviced_directly ?? false,
        nearest_airport_code: a.nearest_airport_code || undefined,
        distance_to_nearest_km: a.distance_to_nearest_km || undefined,
        label_vi: a.is_serviced_directly
          ? 'Khai thác trực tiếp bởi Aptech'
          : a.nearest_airport_code
            ? `Sân bay tham chiếu — Gần ${a.nearest_airport_code} (${a.distance_to_nearest_km || 0} km)`
            : 'Sân bay tham chiếu',
        label_en: a.is_serviced_directly
          ? 'Served directly by Aptech'
          : a.nearest_airport_code
            ? `Reference airport — Near ${a.nearest_airport_code} (${a.distance_to_nearest_km || 0} km)`
            : 'Reference airport',
      })),
    };
  }

  // Mở rộng location thành tập hợp mã IATA kèm thông tin gợi ý sân bay lân cận
  async expandLocation(
    token: string,
    options?: { includeUnserviced?: boolean },
  ): Promise<ExpandedLocation> {
    const cleanToken = token ? token.trim() : '';
    if (!cleanToken) {
      return { iata_codes: [], matched_kind: 'none', label: '', using_nearest_airport: false };
    }

    if (cleanToken.includes(',')) {
      const list = cleanToken.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
      return { iata_codes: list, matched_kind: 'iata_list', label: list.join(', '), using_nearest_airport: false };
    }

    const upperToken = cleanToken.toUpperCase();
    const regex = new RegExp('^' + this.escapeRegex(cleanToken) + '$', 'i');

    const exactAirport = await this.airportModel.findOne({ iata_code: upperToken }).exec();
    if (exactAirport) {
      if (exactAirport.is_serviced_directly || options?.includeUnserviced) {
        return {
          iata_codes: [exactAirport.iata_code],
          matched_kind: 'airport',
          label: exactAirport.airport_name,
          using_nearest_airport: false,
        };
      } else {
        const distance = exactAirport.distance_to_nearest_km;
        const hasValidDistance = typeof distance === 'number' && Number.isFinite(distance);

        if (exactAirport.nearest_airport_code && hasValidDistance && exactAirport.city_name) {
          const nearest = await this.airportModel
            .findOne({
              iata_code: exactAirport.nearest_airport_code.toUpperCase(),
              is_serviced_directly: true,
            })
            .exec();
          if (nearest && nearest.is_serviced_directly === true) {
            return {
              iata_codes: [nearest.iata_code],
              matched_kind: 'airport',
              label: `Gần ${exactAirport.city_name}`,
              using_nearest_airport: true,
              nearest_suggestion: {
                airport: nearest,
                distance_km: distance,
                for_city: exactAirport.city_name,
              },
            };
          }
        }
      }
      return {
        iata_codes: [],
        matched_kind: 'none',
        label: 'Không tìm thấy',
        using_nearest_airport: false,
      };
    }

    const exactCountry = await this.countryModel.findOne({
      $or: [{ code: upperToken }, { code3: upperToken }, { name: regex }, { name_vi: regex }]
    }).exec();
    if (exactCountry) {
      const filter: any = { country_code: exactCountry.code };
      if (!options?.includeUnserviced) {
        filter.is_serviced_directly = true;
      }
      const apts = await this.airportModel.find(filter).exec();
      const codes = apts.map(a => a.iata_code);
      if (codes.length > 0) {
        return {
          iata_codes: codes,
          matched_kind: 'country',
          label: `Mọi sân bay ${exactCountry.name_vi || exactCountry.name}`,
          using_nearest_airport: false,
        };
      }
    } else if (upperToken.length === 2) {
      // Direct 2-letter country code fallback
      const filter: any = { country_code: upperToken };
      if (!options?.includeUnserviced) {
        filter.is_serviced_directly = true;
      }
      const apts = await this.airportModel.find(filter).exec();
      const codes = apts.map(a => a.iata_code);
      if (codes.length > 0) {
        return {
          iata_codes: codes,
          matched_kind: 'country',
          label: `Mọi sân bay ${upperToken}`,
          using_nearest_airport: false,
        };
      }
    }

    const exactCity = await this.cityModel.findOne({
      $or: [{ city_code: upperToken }, { name: regex }, { name_vi: regex }]
    }).exec();
    if (exactCity) {
      const filter: any = {
        $or: [{ city_code: exactCity.city_code }, { city_name: regex }]
      };
      if (!options?.includeUnserviced) {
        filter.is_serviced_directly = true;
      }
      const apts = await this.airportModel.find(filter).exec();
      const codes = apts.map(a => a.iata_code);
      if (codes.length > 0) {
        return {
          iata_codes: codes,
          matched_kind: 'city',
          label: `Mọi sân bay ${exactCity.name_vi || exactCity.name}`,
          using_nearest_airport: false,
        };
      }
    }

    const resolved = await this.airportsService.resolveCity(cleanToken);
    let iata_codes: string[] = [];
    let label = '';
    let using_nearest_airport = false;
    let nearest_suggestion: { airport: Airport | any; distance_km: number; for_city: string } | undefined = undefined;

    const nearestSug = resolved.nearestSuggestion;
    const hasValidSugDistance = typeof nearestSug?.distance_km === 'number' && Number.isFinite(nearestSug.distance_km);

    if (
      nearestSug &&
      nearestSug.airport?.iata_code &&
      nearestSug.airport?.is_serviced_directly === true &&
      hasValidSugDistance &&
      nearestSug.for_city
    ) {
      iata_codes.push(nearestSug.airport.iata_code);
      label = `Gần ${nearestSug.for_city}`;
      using_nearest_airport = true;
      nearest_suggestion = nearestSug;
    } else if (resolved.exactMatches && resolved.exactMatches.length > 0) {
      iata_codes = resolved.exactMatches.map(a => a.iata_code);
      label = resolved.exactMatches[0].city_name;
      using_nearest_airport = false;
    }

    if (iata_codes.length > 0) {
      return {
        iata_codes,
        matched_kind: 'airport',
        label,
        using_nearest_airport,
        ...(nearest_suggestion ? { nearest_suggestion } : {}),
      };
    }

    return { iata_codes: [], matched_kind: 'none', label: 'Không tìm thấy', using_nearest_airport: false };
  }

  async findRouteNetworkConnections(
    originIatas: string[],
    destIatas: string[],
    source: string = 'aptech_internal',
  ): Promise<any[]> {
    if (originIatas.length === 0 || destIatas.length === 0) return [];

    // 1. Batched Leg 1 Query with strict source isolation
    const leg1Routes = await this.routeRefModel
      .find({ dep_iata: { $in: originIatas }, source })
      .lean()
      .exec();
    if (leg1Routes.length === 0) return [];

    // 2. Candidate Transit Hubs
    const candidateTransits = Array.from(
      new Set(
        leg1Routes
          .map((r: any) => r.arr_iata)
          .filter((t: string) => !originIatas.includes(t) && !destIatas.includes(t)),
      ),
    );
    if (candidateTransits.length === 0) return [];

    // 3. Batched Leg 2 Query (Zero N+1)
    const leg2Routes = await this.routeRefModel
      .find({ dep_iata: { $in: candidateTransits }, arr_iata: { $in: destIatas }, source })
      .lean()
      .exec();

    const leg2ByOrigin = new Map<string, any>();
    for (const l2 of leg2Routes) {
      if (!leg2ByOrigin.has(l2.dep_iata)) {
        leg2ByOrigin.set(l2.dep_iata, l2);
      }
    }

    const transitOptions = new Map<string, { leg1: any; leg2: any }>();
    for (const leg1 of leg1Routes) {
      const t = leg1.arr_iata;
      const leg2 = leg2ByOrigin.get(t);
      if (leg2 && !transitOptions.has(t)) {
        transitOptions.set(t, { leg1, leg2 });
      }
    }

    const results = [];
    for (const [t, { leg1, leg2 }] of transitOptions.entries()) {
      results.push({
        transit_airport: t,
        leg1: { airline_iata: leg1.airline_iata, dep_iata: leg1.dep_iata, arr_iata: leg1.arr_iata },
        leg2: { airline_iata: leg2.airline_iata, dep_iata: leg2.dep_iata, arr_iata: leg2.arr_iata },
        note: 'Tuyến nối theo mạng đường bay nội bộ Aptech Airlines - chưa có lịch bay cụ thể cho ngày đã chọn',
      });
    }
    return results;
  }
}
