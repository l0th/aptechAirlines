import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Airport, AirportDocument } from './airports.schema';
import { CreateAirportDto, UpdateAirportDto } from './airports.dto';
import { AIRPORT_REFERENCE_DATA, AirportReferenceItem } from './airports-reference.data';
import { buildAccentInsensitivePattern } from '../common/search-normalization';

@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
  ) {}

  async findAll(search?: string): Promise<Airport[]> {
    const filter: any = {};
    if (search) {
      filter.$or = [
        { iata_code: { $regex: search, $options: 'i' } },
        { city_name: { $regex: search, $options: 'i' } },
        { airport_name: { $regex: search, $options: 'i' } },
      ];
    }
    return this.airportModel.find(filter).sort({ city_name: 1 }).exec();
  }

  async findByIata(iata: string): Promise<AirportDocument> {
    const airport = await this.airportModel.findOne({ iata_code: iata.toUpperCase() }).exec();
    if (!airport) {
      throw new NotFoundException(`Airport with IATA code ${iata} not found`);
    }
    return airport;
  }

  /**
   * Ensure an airport required by the AirLabs commercial pipeline exists in MongoDB
   * with authoritative reference metadata, especially an IANA timezone.
   *
   * Existing operator-managed values are preserved. Curated reference data only fills
   * missing fields (and replaces the schema's generic UTC default when a more precise
   * curated timezone is available).
   */
  async ensureAirportReference(iataCode: string): Promise<AirportDocument> {
    const cleanIata = (iataCode || '').trim().toUpperCase();
    if (!cleanIata) {
      throw new BadRequestException('Airport IATA code is required');
    }

    const curated = AIRPORT_REFERENCE_DATA.find((item) => item.iata_code === cleanIata);
    const existing = await this.airportModel.findOne({ iata_code: cleanIata }).exec();

    if (existing) {
      const currentTimeZone = (existing.time_zone || '').trim();
      const hasUsableTimeZone = Boolean(currentTimeZone && currentTimeZone !== 'UTC');

      if (!curated) {
        if (!hasUsableTimeZone) {
          throw new BadRequestException(
            `Airport "${cleanIata}" exists but has no authoritative IANA timezone and is not present in curated airport reference data`,
          );
        }
        return existing;
      }

      const patch: Partial<AirportReferenceItem> = {};
      const fillString = (key: keyof AirportReferenceItem) => {
        const current = (existing as any)[key];
        const reference = (curated as any)[key];
        if ((current === undefined || current === null || current === '') && reference !== undefined) {
          (patch as any)[key] = reference;
        }
      };

      fillString('airport_name');
      fillString('city_name');
      fillString('icao_code');
      fillString('country_code');
      fillString('city_code');

      if (existing.lat === undefined || existing.lat === null) patch.lat = curated.lat;
      if (existing.lng === undefined || existing.lng === null) patch.lng = curated.lng;
      if (!hasUsableTimeZone && curated.time_zone) patch.time_zone = curated.time_zone;

      if (Object.keys(patch).length === 0) {
        return existing;
      }

      const repaired = await this.airportModel
        .findOneAndUpdate(
          { iata_code: cleanIata },
          { $set: patch },
          { new: true },
        )
        .exec();
      if (!repaired) {
        throw new NotFoundException(`Airport with IATA code ${cleanIata} disappeared during repair`);
      }
      return repaired;
    }

    if (!curated) {
      throw new BadRequestException(
        `Airport "${cleanIata}" is missing from MongoDB and curated airport reference data; refusing to invent timezone data`,
      );
    }

    const created = await this.airportModel
      .findOneAndUpdate(
        { iata_code: cleanIata },
        {
          $setOnInsert: {
            ...curated,
            data_source: 'curated_reference',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!created) {
      throw new BadRequestException(`Unable to provision airport reference data for "${cleanIata}"`);
    }
    return created;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Helper xử lý gợi ý sân bay thương mại gần nhất khi địa phương không có đường bay trực tiếp (Spec 3.3.1 - 3.3.2).
   */
  private async buildUnservicedResult(unserviced: Airport[]): Promise<{
    exactMatches: Airport[];
    nearestSuggestion?: { airport: Airport; distance_km: number; for_city: string };
    unservicedMatches?: Airport[];
  }> {
    if (unserviced.length > 0) {
      const firstUnserviced = unserviced[0];
      const distance = firstUnserviced.distance_to_nearest_km;
      const hasValidDistance = typeof distance === 'number' && Number.isFinite(distance);

      if (firstUnserviced.nearest_airport_code && hasValidDistance && firstUnserviced.city_name) {
        const nearest = await this.airportModel
          .findOne({
            iata_code: firstUnserviced.nearest_airport_code.toUpperCase(),
            is_serviced_directly: true,
          })
          .exec();
        if (nearest && nearest.is_serviced_directly === true) {
          return {
            exactMatches: [],
            nearestSuggestion: {
              airport: nearest,
              distance_km: distance,
              for_city: firstUnserviced.city_name,
            },
            unservicedMatches: unserviced,
          };
        }
      }
      return { exactMatches: [], unservicedMatches: unserviced };
    }
    return { exactMatches: [] };
  }

  /**
   * Requirement 3.3.2: Phân giải thành phố / sân bay theo thứ tự ưu tiên (Priority Order).
   * Chỉ dừng và trả kết quả ở tầng ưu tiên đầu tiên có dữ liệu; chỉ coi là nhập nhằng (ambiguity)
   * khi chính tầng đó trả về nhiều hơn một sân bay có phục vụ trực tiếp.
   */
  async resolveCity(query: string): Promise<{
    exactMatches: Airport[];
    nearestSuggestion?: { airport: Airport; distance_km: number; for_city: string };
    unservicedMatches?: Airport[];
  }> {
    const cleanQuery = query?.trim() || '';
    if (!cleanQuery) {
      return { exactMatches: [] };
    }

    const escaped = buildAccentInsensitivePattern(cleanQuery);

    // Ưu tiên 1: Khớp chính xác mã IATA (case-insensitive, trimmed)
    // Lý do: Người dùng nhập mã sân bay (như HAN, SGN) là chỉ định rõ ràng, cần trả về ngay 1 sân bay duy nhất,
    // không nhập nhằng và không gợi ý lân cận. Khắc phục lỗi "HAN" bị khớp nhầm sang Shanghai (PVG).
    const iataMatch = await this.airportModel
      .findOne({ iata_code: cleanQuery.toUpperCase() })
      .exec();

    if (iataMatch) {
      if (iataMatch.is_serviced_directly) {
        return { exactMatches: [iataMatch] };
      } else {
        // Nếu mã IATA thuộc điểm không bay trực tiếp -> gợi ý sân bay lân cận
        return this.buildUnservicedResult([iataMatch]);
      }
    }

    // Ưu tiên 2: Khớp chính xác tên thành phố (case-insensitive, trimmed)
    // Lý do: Tên thành phố được nhập chính xác (như "Da Nang", "Ho Chi Minh"). Nếu chỉ có 1 sân bay -> trả về;
    // nếu có nhiều sân bay cùng tên thành phố -> trả về danh sách nhập nhằng theo Spec 3.3.2.
    const exactCityMatches = await this.airportModel
      .find({ city_name: { $regex: `^${escaped}$`, $options: 'i' } })
      .sort({ city_name: 1 })
      .exec();

    if (exactCityMatches.length > 0) {
      const serviced = exactCityMatches.filter((m) => m.is_serviced_directly === true);
      const unserviced = exactCityMatches.filter((m) => m.is_serviced_directly === false);

      if (serviced.length > 0) {
        return {
          exactMatches: serviced,
          unservicedMatches: unserviced.length > 0 ? unserviced : undefined,
        };
      }

      if (unserviced.length > 0) {
        // Trường hợp thành phố không có đường bay trực tiếp (ví dụ "Hoi An") -> trả về nearestSuggestion
        return this.buildUnservicedResult(unserviced);
      }
    }

    // Ưu tiên 3: Khớp tiền tố theo từ / đầu tên thành phố (word-boundary prefix trên city_name)
    // Lý do: Cho phép tìm nhanh khi người dùng gõ phần đầu của tên thành phố (ví dụ: "Da" khớp "Da Nang",
    // "Ho Chi" khớp "Ho Chi Minh"; "han" KHÔNG khớp "Shanghai"). Chỉ nhập nhằng khi có từ 2 sân bay trở lên cùng tiền tố.
    const prefixMatches = await this.airportModel
      .find({ city_name: { $regex: `^${escaped}`, $options: 'i' } })
      .sort({ city_name: 1 })
      .exec();

    if (prefixMatches.length > 0) {
      const serviced = prefixMatches.filter((m) => m.is_serviced_directly === true);
      const unserviced = prefixMatches.filter((m) => m.is_serviced_directly === false);

      if (serviced.length > 0) {
        return {
          exactMatches: serviced,
          unservicedMatches: unserviced.length > 0 ? unserviced : undefined,
        };
      }

      if (unserviced.length > 0) {
        return this.buildUnservicedResult(unserviced);
      }
    }

    // Ưu tiên 4: Khớp chuỗi con trong tên thành phố (CONTAINS match trên city_name - phương án dự phòng cuối cùng)
    // Lý do: Giữ lại hành vi cũ cho các truy vấn chung chung / chuỗi con (ví dụ "an" nằm trong nhiều thành phố
    // như Bangkok, Da Nang, Nha Trang, Shanghai,...) và giữ tính nhập nhằng để khách tự chọn theo đúng Spec 3.3.2.
    const containsMatches = await this.airportModel
      .find({ city_name: { $regex: escaped, $options: 'i' } })
      .sort({ city_name: 1 })
      .exec();

    if (containsMatches.length > 0) {
      const serviced = containsMatches.filter((m) => m.is_serviced_directly === true);
      const unserviced = containsMatches.filter((m) => m.is_serviced_directly === false);

      if (serviced.length > 0) {
        return {
          exactMatches: serviced,
          unservicedMatches: unserviced.length > 0 ? unserviced : undefined,
        };
      }

      if (unserviced.length > 0) {
        return this.buildUnservicedResult(unserviced);
      }
    }

    // Ưu tiên 5: Không có kết quả nào khớp trong toàn bộ CSDL
    // Lý do: Không tìm thấy bất kỳ sân bay thương mại hay điểm lân cận nào phù hợp.
    return { exactMatches: [] };
  }

  async create(createAirportDto: CreateAirportDto): Promise<AirportDocument> {
    const existing = await this.airportModel
      .findOne({ iata_code: createAirportDto.iata_code.toUpperCase() })
      .exec();
    if (existing) {
      throw new ConflictException(`Airport with IATA ${createAirportDto.iata_code} already exists`);
    }

    const created = new this.airportModel({
      ...createAirportDto,
      iata_code: createAirportDto.iata_code.toUpperCase(),
    });
    return created.save();
  }

  async update(iata: string, updateAirportDto: UpdateAirportDto): Promise<AirportDocument> {
    const airport = await this.findByIata(iata);

    if (updateAirportDto.city_name) airport.city_name = updateAirportDto.city_name;
    if (updateAirportDto.airport_name) airport.airport_name = updateAirportDto.airport_name;
    if (updateAirportDto.is_serviced_directly !== undefined) airport.is_serviced_directly = updateAirportDto.is_serviced_directly;
    if (updateAirportDto.nearest_airport_code !== undefined) airport.nearest_airport_code = updateAirportDto.nearest_airport_code;
    if (updateAirportDto.distance_to_nearest_km !== undefined) airport.distance_to_nearest_km = updateAirportDto.distance_to_nearest_km;
    if (updateAirportDto.time_zone) airport.time_zone = updateAirportDto.time_zone;
    
    if (updateAirportDto.icao_code) airport.icao_code = updateAirportDto.icao_code;
    if (updateAirportDto.country_code) airport.country_code = updateAirportDto.country_code;
    if (updateAirportDto.city_code) airport.city_code = updateAirportDto.city_code;
    if (updateAirportDto.lat !== undefined) airport.lat = updateAirportDto.lat;
    if (updateAirportDto.lng !== undefined) airport.lng = updateAirportDto.lng;
    if (updateAirportDto.data_source) airport.data_source = updateAirportDto.data_source;

    return airport.save();
  }

  async delete(iata: string): Promise<{ message: string }> {
    const airport = await this.findByIata(iata);
    await this.airportModel.findOneAndDelete({ iata_code: airport.iata_code }).exec();
    return { message: `Airport ${airport.iata_code} deleted successfully` };
  }

  async deriveCityName(airportName: string, countryCode: string, lat?: number, lng?: number, cityCode?: string): Promise<string> {
    if (cityCode) {
      const city = await this.airportModel.db.collection('cities').findOne({ city_code: cityCode.toUpperCase() });
      if (city && city.name) return city.name;
    }

    if (lat !== undefined && lng !== undefined) {
      const nearestCities = await this.airportModel.db.collection('cities').find({
        country_code: countryCode.toUpperCase(),
        lat: { $gte: lat - 0.6, $lte: lat + 0.6 },
        lng: { $gte: lng - 0.6, $lte: lng + 0.6 }
      }).toArray();
      
      let bestCity = null;
      let minDiff = 0.6 * 0.6 * 2;
      for (const c of nearestCities) {
        if (c.lat !== undefined && c.lng !== undefined) {
          const diff = Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2);
          if (diff < minDiff) {
            minDiff = diff;
            bestCity = c;
          }
        }
      }
      if (bestCity && bestCity.name) return bestCity.name;
    }

    const suffixes = [' International Airport', ' Airport Terminal', ' Regional Airport', ' Municipal Airport', ' Airport', ' Airfield', ' Air Base', ' Heliport', ' AB', ' Intl'];
    let derived = airportName;
    for (const s of suffixes) {
      if (derived.toLowerCase().endsWith(s.toLowerCase())) {
        derived = derived.slice(0, -s.length);
        break;
      }
    }
    derived = derived.replace(/\s*Airport\s*\(.*?\)/gi, '');
    derived = derived.replace(/[,\-.\s]+$/, '');
    return derived.trim() || airportName;
  }

  async fixCityNames() {
    const regex = /(Airport|Airfield|Heliport|Air Base|AB)$/i;
    const airports = await this.airportModel.find({ city_name: regex }).exec();
    
    let checked = 0;
    let fixed = 0;
    const samples = [];
    
    for (const apt of airports) {
      checked++;
      const oldCityName = apt.city_name;
      const newCityName = await this.deriveCityName(apt.airport_name, apt.country_code, apt.lat, apt.lng, apt.city_code);
      
      if (newCityName !== oldCityName) {
        apt.city_name = newCityName;
        await apt.save();
        fixed++;
        if (samples.length < 10) {
          samples.push({ iata_code: apt.iata_code, old: oldCityName, new: newCityName });
        }
      }
    }
    
    return { checked, fixed, samples };
  }

  async syncAirportFromAirLabs(iataCode: string): Promise<any> {
    const apiKey = process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env.');
    }
    const cleanIata = iataCode.toUpperCase();

    const airportUrl = `https://airlabs.co/api/v9/airports?iata_code=${cleanIata}&api_key=${apiKey}`;
    let res = await fetch(airportUrl);
    if (!res.ok) throw new Error(`AirLabs API trả về HTTP mã ${res.status}`);
    const airportData = await res.json();
    if (airportData.error) throw new BadRequestException(`Lỗi từ AirLabs: ${airportData.error.message}`);
    const airlabsAirport = (airportData.response && airportData.response.length > 0) ? airportData.response[0] : null;

    const cityUrl = `https://airlabs.co/api/v9/cities?city_code=${cleanIata}&api_key=${apiKey}`;
    res = await fetch(cityUrl);
    if (!res.ok) throw new Error(`AirLabs API trả về HTTP mã ${res.status}`);
    const cityData = await res.json();
    if (cityData.error) throw new BadRequestException(`Lỗi từ AirLabs: ${cityData.error.message}`);
    const airlabsCity = (cityData.response && cityData.response.length > 0) ? cityData.response[0] : null;

    if (!airlabsAirport) {
       throw new NotFoundException(`Sân bay ${cleanIata} không tìm thấy trên AirLabs`);
    }

    let airport = await this.airportModel.findOne({ iata_code: cleanIata }).exec();
    let updated = false;
    if (!airport) {
      airport = new this.airportModel({ iata_code: cleanIata });
      updated = true; // New airport created
    } else {
      updated = true; // Existing airport updated
    }

    airport.airport_name = airlabsAirport.name;
    airport.icao_code = airlabsAirport.icao_code;
    airport.country_code = airlabsAirport.country_code;
    airport.lat = airlabsAirport.lat;
    airport.lng = airlabsAirport.lng;
    if (airlabsCity && airlabsCity.city_code) {
      airport.city_code = airlabsCity.city_code;
    }
    airport.data_source = 'airlabs';

    airport.city_name = await this.deriveCityName(
      airlabsAirport.name, 
      airlabsAirport.country_code, 
      airlabsAirport.lat, 
      airlabsAirport.lng, 
      airlabsCity?.city_code
    );

    // AirLabs does not provide IANA time zones - keeping ours
    
    await airport.save();

    return {
      iata_code: cleanIata,
      updated,
      airport,
      airlabs_airport: airlabsAirport,
      airlabs_city: airlabsCity
    };
  }

  async syncAllAirportsFromAirLabs(): Promise<any> {
    const airports = await this.airportModel.find().exec();
    let checked = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const apt of airports) {
      checked++;
      try {
        await this.syncAirportFromAirLabs(apt.iata_code);
        updated++;
      } catch (err: any) {
        failed++;
        errors.push({ iata_code: apt.iata_code, error: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    return { checked, updated, failed, errors };
  }

  /**
   * Ước tính múi giờ IANA từ quốc gia và tọa độ địa lý.
   * Lý do: AirLabs API không cung cấp trường timezone trong dữ liệu sân bay,
   * nên cần xấp xỉ dựa theo mã quốc gia hoặc tọa độ kinh/vĩ độ để gán cho sân bay mới.
   */
  private approximateTimeZone(countryCode: string, lat?: number, lng?: number): string {
    const cc = countryCode ? countryCode.trim().toUpperCase() : '';

    // 1. Ưu tiên các múi giờ đã biết dựa trên mã quốc gia
    if (cc === 'JP') return 'Asia/Tokyo';
    if (cc === 'VN') return 'Asia/Ho_Chi_Minh';
    if (cc === 'SG') return 'Asia/Singapore';
    if (cc === 'TH') return 'Asia/Bangkok';
    if (cc === 'MY') return 'Asia/Kuala_Lumpur';
    if (cc === 'KR') return 'Asia/Seoul';
    if (cc === 'HK') return 'Asia/Hong_Kong';
    if (cc === 'TW') return 'Asia/Taipei';
    if (cc === 'CN') return 'Asia/Shanghai';
    if (cc === 'PH') return 'Asia/Manila';
    if (cc === 'ID') return 'Asia/Jakarta';
    if (cc === 'IN') return 'Asia/Kolkata';
    if (cc === 'AE') return 'Asia/Dubai';
    if (cc === 'QA') return 'Asia/Qatar';
    if (cc === 'GB') return 'Europe/London';
    if (cc === 'FR') return 'Europe/Paris';
    if (cc === 'DE') return 'Europe/Berlin';
    if (cc === 'AU') {
      if (lat !== undefined && lat < -35 && lng !== undefined && lng < 147) {
        return 'Australia/Melbourne';
      }
      return 'Australia/Sydney';
    }
    if (cc === 'US') {
      if (lng !== undefined && lng < -100) {
        return 'America/Los_Angeles';
      }
      return 'America/New_York';
    }

    // 2. Đối chiếu theo tọa độ địa lý (bounding boxes) cho các khu vực chính
    if (lat !== undefined && lng !== undefined) {
      if (lat >= 24 && lat <= 46 && lng >= 122 && lng <= 154) return 'Asia/Tokyo';
      if (lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110) return 'Asia/Ho_Chi_Minh';
      if (lat >= 1.1 && lat <= 1.5 && lng >= 103.5 && lng <= 104.1) return 'Asia/Singapore';
      if (lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106) return 'Asia/Bangkok';
      if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 130) return 'Asia/Seoul';
      if (lat >= 22 && lat <= 23 && lng >= 113.8 && lng <= 114.5) return 'Asia/Hong_Kong';
      if (lat >= 21.8 && lat <= 25.4 && lng >= 119.9 && lng <= 122.1) return 'Asia/Taipei';
      if (lat >= 4.5 && lat <= 21.5 && lng >= 116.5 && lng <= 127) return 'Asia/Manila';
      if (lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141) return 'Asia/Jakarta';
      if (lat >= 6.5 && lat <= 36 && lng >= 68 && lng <= 97.5) return 'Asia/Kolkata';
      if (lat >= 22.5 && lat <= 26.5 && lng >= 51 && lng <= 56.5) return 'Asia/Dubai';
      if (lat >= 24.5 && lat <= 26.2 && lng >= 50.7 && lng <= 51.7) return 'Asia/Qatar';
      if (lat >= 49.8 && lat <= 60.9 && lng >= -8.6 && lng <= 1.8) return 'Europe/London';
      if (lat >= 41.3 && lat <= 51.1 && lng >= -5.2 && lng <= 9.6) return 'Europe/Paris';
      if (lat >= 47.2 && lat <= 55.1 && lng >= 5.8 && lng <= 15.1) return 'Europe/Berlin';
    }

    // 3. Nếu không khớp vùng nào, tính xấp xỉ theo kinh độ (chuẩn Etc/GMT của IANA: Etc/GMT-7 tương ứng UTC+7)
    if (lng !== undefined && lng !== null) {
      const offsetHours = Math.round(lng / 15);
      if (offsetHours === 0) return 'UTC';
      const sign = offsetHours > 0 ? '-' : '+';
      return `Etc/GMT${sign}${Math.abs(offsetHours)}`;
    }

    return 'Asia/Ho_Chi_Minh';
  }

  /**
   * Import toàn bộ sân bay của một quốc gia từ AirLabs API (Task 1).
   * Phân trang qua offset (tối đa 5 trang để không spam API), chỉ lưu các sân bay có iata_code.
   * Giữ nguyên cấu hình vận hành (time_zone, is_serviced_directly,...) nếu sân bay đã tồn tại trong DB.
   */
  async importAirportsForCountry(countryCode: string, limit = 1000, offset = 0): Promise<{
    country_code: string;
    pages: number;
    fetched: number;
    imported: number;
    updated: number;
    skipped_without_iata: number;
  }> {
    const apiKey = process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env.');
    }

    const cleanCountry = countryCode?.trim().toUpperCase();
    if (!cleanCountry) {
      throw new BadRequestException('Mã quốc gia country_code là bắt buộc.');
    }

    let currentOffset = offset;
    let pages = 0;
    let fetched = 0;
    let imported = 0;
    let updated = 0;
    let skipped_without_iata = 0;

    // Giới hạn tối đa 5 trang để bảo vệ hạn mức gọi AirLabs API
    while (pages < 5) {
      pages++;
      const url = `https://airlabs.co/api/v9/airports?country_code=${cleanCountry}&limit=${limit}&offset=${currentOffset}&api_key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new BadRequestException(`AirLabs API trả về HTTP mã ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new BadRequestException(`Lỗi từ AirLabs: ${data.error.message}`);
      }
      const items: any[] = data.response || [];
      fetched += items.length;

      for (const item of items) {
        // Loại bỏ bãi đáp trực thăng hoặc căn cứ quân sự không có mã IATA thương mại
        if (!item.iata_code || typeof item.iata_code !== 'string' || !item.iata_code.trim()) {
          skipped_without_iata++;
          continue;
        }

        const cleanIata = item.iata_code.trim().toUpperCase();
        let airport = await this.airportModel.findOne({ iata_code: cleanIata }).exec();
        const isNew = !airport;

        if (isNew) {
          // Khởi tạo sân bay mới: is_serviced_directly = true và múi giờ xấp xỉ
          airport = new this.airportModel({
            iata_code: cleanIata,
            is_serviced_directly: false,
            nearest_airport_code: '',
            distance_to_nearest_km: 0,
            time_zone: this.approximateTimeZone(cleanCountry, item.lat, item.lng),
          });
        }
        // Lưu ý: Tuyệt đối KHÔNG ghi đè time_zone, is_serviced_directly, nearest_airport_code, distance_to_nearest_km của sân bay đã có

        airport.airport_name = item.name || airport.airport_name || cleanIata;
        airport.country_code = item.country_code ? item.country_code.toUpperCase() : cleanCountry;
        if (item.icao_code) airport.icao_code = item.icao_code;
        if (item.lat !== undefined && item.lat !== null) airport.lat = item.lat;
        if (item.lng !== undefined && item.lng !== null) airport.lng = item.lng;
        airport.data_source = 'airlabs';

        // Khớp city_name từ collection City trong CSDL nếu có city_code
        let matchedCityName: string | undefined;
        if (item.city_code) {
          airport.city_code = item.city_code;
          const city = await this.airportModel.db.collection('cities').findOne({
            city_code: item.city_code.toUpperCase(),
          });
          if (city && city.name) {
            matchedCityName = city.name;
          }
        }

        if (matchedCityName) {
          airport.city_name = matchedCityName;
        } else if (!airport.city_name) {
          // Nếu không tìm thấy thành phố và chưa có city_name, dùng airport_name làm giá trị dự phòng
          airport.city_name = airport.airport_name;
        }

        await airport.save();

        if (isNew) {
          imported++;
        } else {
          updated++;
        }
      }

      // Dừng vòng lặp nếu số lượng trả về ít hơn giới hạn trang
      if (items.length < limit) {
        break;
      }
      currentOffset += items.length;
    }

    return {
      country_code: cleanCountry,
      pages,
      fetched,
      imported,
      updated,
      skipped_without_iata,
    };
  }

  async importAirportsForCountries(codes: string[], authHeader?: string) {
    const results = [];
    let rate_limited = false;
    let done = 0;
    let failed = 0;

    for (const code of codes) {
      try {
        const result = await this.importAirportsForCountry(code);
        results.push({ ...result, error: null });
        done++;

        // Call the existing city sync for each successfully imported country
        if (authHeader) {
          try {
            await fetch(`http://localhost:3000/api/reference/sync-cities?country_code=${code}`, {
              method: 'POST',
              headers: { 'Authorization': authHeader }
            });
          } catch (cityErr) {
            console.error(`City sync failed for ${code}`, cityErr);
          }
        }
      } catch (err: any) {
        failed++;
        if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate limit') || err.message?.toLowerCase().includes('quota')) {
          rate_limited = true;
          results.push({ country_code: code, error: `AirLabs giới hạn truy cập (Rate Limit): ${err.message}` });
          break; // STOP the whole loop early
        } else {
          results.push({ country_code: code, error: err.message });
        }
      }
      
      // Small delay (300-500ms)
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    return {
      requested: codes.length,
      done,
      failed,
      rate_limited,
      results
    };
  }
}
