import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Country, CountryDocument, City, CityDocument, RouteRef, RouteRefDocument } from './reference.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import { AirportsService } from '../airports/airports.service';

const VI_NAMES: Record<string, string> = {
  VN: 'Việt Nam', SG: 'Singapore', TH: 'Thái Lan', MY: 'Malaysia', JP: 'Nhật Bản', KR: 'Hàn Quốc', HK: 'Hồng Kông', CN: 'Trung Quốc', TW: 'Đài Loan', PH: 'Philippines', ID: 'Indonesia', IN: 'Ấn Độ', AE: 'Các Tiểu vương quốc Ả Rập Thống nhất', QA: 'Qatar', GB: 'Vương quốc Anh', FR: 'Pháp', DE: 'Đức', AU: 'Úc', US: 'Hoa Kỳ', KH: 'Campuchia', LA: 'Lào', MM: 'Myanmar', BN: 'Brunei', NZ: 'New Zealand', CA: 'Canada'
};

@Injectable()
export class ReferenceService {
  constructor(
    @InjectModel(Country.name) private countryModel: Model<CountryDocument>,
    @InjectModel(City.name) private cityModel: Model<CityDocument>,
    @InjectModel(RouteRef.name) private routeRefModel: Model<RouteRefDocument>,
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
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
  async syncRoutesForAirport(depIata: string, limit = 200, offset = 0) {
    const apiKey = this.getApiKey();
    const cleanDep = depIata?.trim().toUpperCase();
    if (!cleanDep) return { dep_iata: depIata, updated: 0, pages: 0 };

    let currentOffset = offset;
    let pageCount = 0;
    let totalUpdated = 0;

    // Giới hạn 5 trang để không làm tràn hạn ngạch request tới AirLabs API
    while (pageCount < 5) {
      pageCount++;
      const res = await fetch(`https://airlabs.co/api/v9/routes?dep_iata=${cleanDep}&limit=${limit}&offset=${currentOffset}&api_key=${apiKey}`);
      if (!res.ok) throw new BadRequestException(`Lỗi khi gọi AirLabs API: HTTP mã ${res.status}`);
      const data = await res.json();
      if (!data.response || data.response.length === 0) break;

      const items: any[] = data.response;
      for (const item of items) {
        if (!item.airline_iata || !item.dep_iata || !item.arr_iata) continue;
        try {
          await this.routeRefModel.findOneAndUpdate(
            { airline_iata: item.airline_iata, dep_iata: item.dep_iata, arr_iata: item.arr_iata },
            {
              airline_iata: item.airline_iata,
              airline_icao: item.airline_icao,
              dep_iata: item.dep_iata,
              arr_iata: item.arr_iata,
              aircraft_icao: item.aircraft_icao,
            },
            { upsert: true, new: true },
          ).exec();
          totalUpdated++;
        } catch (e) {
          // Bỏ qua nếu có trùng lặp bản ghi
        }
      }

      // Dừng nếu số bản ghi trả về nhỏ hơn limit trang
      if (items.length < limit) {
        break;
      }
      currentOffset += items.length;
    }

    return { dep_iata: cleanDep, updated: totalUpdated, pages: pageCount };
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

    const airports = await this.airportModel.find({
      is_serviced_directly: true,
      $or: [
        { iata_code: regex },
        { airport_name: regex },
        { city_name: regex }
      ]
    }).limit(8).exec();

    return {
      countries: countries.map(c => ({ code: c.code, name: c.name, name_vi: c.name_vi })),
      cities,
      airports: airports.map(a => ({
        iata_code: a.iata_code,
        airport_name: a.airport_name,
        city_name: a.city_name,
        country_code: a.country_code,
        time_zone: a.time_zone
      }))
    };
  }

  // Mở rộng location thành tập hợp mã IATA
  async expandLocation(token: string): Promise<{ iata_codes: string[], matched_kind: 'airport'|'city'|'country'|'iata_list'|'none', label: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { iata_codes: [], matched_kind: 'none', label: '' };

    if (cleanToken.includes(',')) {
      const list = cleanToken.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
      return { iata_codes: list, matched_kind: 'iata_list', label: list.join(', ') };
    }

    const upperToken = cleanToken.toUpperCase();
    const regex = new RegExp('^' + this.escapeRegex(cleanToken) + '$', 'i');

    const exactAirport = await this.airportModel.findOne({ iata_code: upperToken }).exec();
    if (exactAirport) {
      if (exactAirport.is_serviced_directly) {
        return { iata_codes: [exactAirport.iata_code], matched_kind: 'airport', label: exactAirport.airport_name };
      } else if (exactAirport.nearest_airport_code) {
        return { iata_codes: [exactAirport.nearest_airport_code], matched_kind: 'airport', label: `Gần ${exactAirport.city_name}` };
      }
    }

    const exactCountry = await this.countryModel.findOne({
      $or: [{ code: upperToken }, { name: regex }, { name_vi: regex }]
    }).exec();
    if (exactCountry) {
      const apts = await this.airportModel.find({ country_code: exactCountry.code, is_serviced_directly: true }).exec();
      const codes = apts.map(a => a.iata_code);
      return { iata_codes: codes, matched_kind: 'country', label: `Mọi sân bay ${exactCountry.name_vi || exactCountry.name}` };
    }

    const exactCity = await this.cityModel.findOne({
      $or: [{ city_code: upperToken }, { name: regex }, { name_vi: regex }]
    }).exec();
    if (exactCity) {
      const apts = await this.airportModel.find({
        is_serviced_directly: true,
        $or: [{ city_code: exactCity.city_code }, { city_name: regex }]
      }).exec();
      const codes = apts.map(a => a.iata_code);
      return { iata_codes: codes, matched_kind: 'city', label: `Mọi sân bay ${exactCity.name_vi || exactCity.name}` };
    }

    const resolved = await this.airportsService.resolveCity(cleanToken);
    let iata_codes: string[] = [];
    let label = '';
    
    if (resolved.nearestSuggestion) {
      iata_codes.push(resolved.nearestSuggestion.airport.iata_code);
      label = `Gần ${resolved.nearestSuggestion.for_city}`;
    } else if (resolved.exactMatches && resolved.exactMatches.length > 0) {
      iata_codes = resolved.exactMatches.map(a => a.iata_code);
      label = resolved.exactMatches[0].city_name;
    }

    if (iata_codes.length > 0) {
      return { iata_codes, matched_kind: 'airport', label };
    }

    return { iata_codes: [], matched_kind: 'none', label: 'Không tìm thấy' };
  }

  async findRouteNetworkConnections(originIatas: string[], destIatas: string[]): Promise<any[]> {
    if (originIatas.length === 0 || destIatas.length === 0) return [];
    
    // Find a transit airport T where Origin -> T and T -> Dest exists
    const leg1Routes = await this.routeRefModel.find({ dep_iata: { $in: originIatas } }).exec();
    
    const transitOptions = new Map<string, { leg1: RouteRef, leg2: RouteRef }>();
    
    for (const leg1 of leg1Routes) {
      const t = leg1.arr_iata;
      if (destIatas.includes(t)) continue;
      
      const leg2 = await this.routeRefModel.findOne({ dep_iata: t, arr_iata: { $in: destIatas } }).exec();
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
        note: 'Tuyến nối theo mạng đường bay thật của AirLabs - chưa có lịch bay cụ thể cho ngày đã chọn',
      });
    }
    return results;
  }
}
