import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flight, FlightDocument, FlightStatus, CabinClass } from './flights.schema';
import { ScheduleTemplate, ScheduleTemplateDocument } from './schemas/schedule-template.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import { localWallTimeToUtc, resolveLocalWallTimeToUtc, localDateKey } from '../common/timezone.util';
import { APTECH_FLIGHT_TEMPLATES, CANONICAL_AIRCRAFT_TYPES } from './flight-templates.catalog';

export interface GenerationStats {
  total_days: number;
  start_date: string;
  end_date: string;
  templates_count: number;
  total_operations: number;
  inserted_count: number;
  matched_count: number;
  skipped_existing: number;
  duration_ms: number;
}

export interface CommercialHorizonReport {
  templates_count: number;
  successful_templates: number;
  failed_templates: number;
  inserted_count: number;
  failures: Array<{ template_id: string; error: string }>;
}

@Injectable()
export class FlightGeneratorService {
  private readonly logger = new Logger(FlightGeneratorService.name);

  constructor(
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(ScheduleTemplate.name) private templateModel: Model<ScheduleTemplateDocument>,
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
  ) {}

  /**
   * Great Circle Distance using Haversine formula (Statute miles)
   */
  private calculateGreatCircleMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 3958.8; // Radius of the Earth in statute miles
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

  private getAircraftMetadata(aircraftType: string): {
    model_name: string;
    total_capacity: number;
    inventories: Array<{
      cabin_class: CabinClass;
      allocated_seats: number;
      price_factor: number;
    }>;
  } {
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
        throw new BadRequestException(
          `Invalid or unapproved aircraft type: "${aircraftType}". Canonical types: ${CANONICAL_AIRCRAFT_TYPES.join(', ')}`,
        );
    }
  }

  /**
   * Synchronize the static template catalog into the Mongo `scheduletemplates` collection.
   */
  async syncTemplatesCatalog(): Promise<number> {
    const bulkOps = APTECH_FLIGHT_TEMPLATES.map((tpl) => ({
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
            source_type: 'LEGACY_SYNTHETIC',
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await this.templateModel.bulkWrite(bulkOps, { ordered: false });
    }
    this.logger.log(`Synced ${bulkOps.length} schedule templates into database.`);
    return bulkOps.length;
  }

  /**
   * Generates or maintains a rolling 330-day schedule using idempotent $setOnInsert in chunks of 1,000.
   */
  async generateRollingSchedule(startDateStr?: string, days = 330): Promise<GenerationStats> {
    const startTime = Date.now();
    await this.syncTemplatesCatalog();

    // 1. Fetch active legacy templates only (AirLabs commercial templates must never pass through legacy generator)
    const templates = await this.templateModel
      .find({ is_active: true, source_type: 'LEGACY_SYNTHETIC' })
      .lean()
      .exec();
    if (templates.length === 0) {
      throw new Error('No active legacy schedule templates found in database.');
    }

    // 2. Fetch all airports for timezone and coordinate lookup
    const airports = await this.airportModel.find({}).lean().exec();
    const airportMap = new Map<string, AirportDocument>();
    for (const apt of airports as any[]) {
      airportMap.set(apt.iata_code.toUpperCase(), apt);
    }

    // 3. Mark all airports present in active templates as is_serviced_directly = true
    const hubIatas = new Set<string>();
    for (const t of templates) {
      hubIatas.add(t.origin_iata);
      hubIatas.add(t.dest_iata);
    }
    await this.airportModel.updateMany(
      { iata_code: { $in: Array.from(hubIatas) } },
      { $set: { is_serviced_directly: true } },
    );

    // 4. Determine date window
    // Use Asia/Ho_Chi_Minh timezone for the start date anchor
    let baseDate: Date;
    if (startDateStr) {
      baseDate = new Date(`${startDateStr}T00:00:00+07:00`);
    } else {
      const now = new Date();
      const vnDateStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
      baseDate = new Date(`${vnDateStr}T00:00:00+07:00`);
    }

    const startFormatted = localDateKey(baseDate, 'Asia/Ho_Chi_Minh');
    const endDate = new Date(baseDate.getTime() + (days - 1) * 86400000);
    const endFormatted = localDateKey(endDate, 'Asia/Ho_Chi_Minh');

    this.logger.log(
      `Starting 330-day schedule generation from ${startFormatted} to ${endFormatted} (${days} days) across ${templates.length} templates...`,
    );

    let totalOperations = 0;
    let totalInserted = 0;
    let totalMatched = 0;

    let currentBatch: any[] = [];
    const CHUNK_SIZE = 1000;

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const targetDate = new Date(baseDate.getTime() + dayOffset * 86400000);
      const dateStr = localDateKey(targetDate, 'Asia/Ho_Chi_Minh');

      // ISO Day of Week: 1 = Monday ... 7 = Sunday
      const rawDow = targetDate.getDay();
      const isoDow = rawDow === 0 ? 7 : rawDow;

      for (const tpl of templates) {
        if (!tpl.days_of_week.includes(isoDow)) {
          continue;
        }

        const originApt = airportMap.get(tpl.origin_iata);
        const destApt = airportMap.get(tpl.dest_iata);

        const originTz = originApt?.time_zone || 'Asia/Ho_Chi_Minh';
        const destTz = destApt?.time_zone || 'Asia/Ho_Chi_Minh';

        // Calculate Departure UTC Date
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

        // Great-circle statute miles
        const miles =
          originApt && destApt && originApt.lat && originApt.lng && destApt.lat && destApt.lng
            ? this.calculateGreatCircleMiles(originApt.lat, originApt.lng, destApt.lat, destApt.lng)
            : 0;

        // Build aircraft and inventory items
        const meta = this.getAircraftMetadata(tpl.aircraft_type);
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
            bucket_code: invDef.cabin_class === CabinClass.ECONOMY ? 'Y' : invDef.cabin_class === CabinClass.BUSINESS ? 'J' : 'W',
            base_price: basePrice,
            allocated_seats: invDef.allocated_seats,
            available_seats: invDef.allocated_seats,
          };
        });

        const flightInsertDoc = {
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
          operator: 'APTECH_AIRLINES',
          is_bookable: true,
          data_source: 'INTERNAL_GENERATED',
        };

        // BulkWrite with $setOnInsert preserves any existing bookings, reduced seat counts or manual modifications
        currentBatch.push({
          updateOne: {
            filter: {
              template_id: tpl.template_id,
              operating_date: dateStr,
            },
            update: {
              $setOnInsert: flightInsertDoc,
            },
            upsert: true,
          },
        });

        if (currentBatch.length >= CHUNK_SIZE) {
          const res = await this.flightModel.bulkWrite(currentBatch, { ordered: false });
          totalOperations += currentBatch.length;
          totalInserted += res.upsertedCount;
          totalMatched += res.matchedCount;
          currentBatch = [];
        }
      }
    }

    if (currentBatch.length > 0) {
      const res = await this.flightModel.bulkWrite(currentBatch, { ordered: false });
      totalOperations += currentBatch.length;
      totalInserted += res.upsertedCount;
      totalMatched += res.matchedCount;
      currentBatch = [];
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `Completed 330-day generation: ${totalOperations} ops executed (${totalInserted} inserted, ${totalMatched} preserved) in ${durationMs}ms.`,
    );

    return {
      total_days: days,
      start_date: startFormatted,
      end_date: endFormatted,
      templates_count: templates.length,
      total_operations: totalOperations,
      inserted_count: totalInserted,
      matched_count: totalMatched,
      skipped_existing: totalMatched,
      duration_ms: durationMs,
    };
  }

  /**
   * Lightweight forward horizon maintainer (does NOT regenerate 15k flights on normal startup).
   * Appends only missing days at the horizon if today + horizonDays is missing.
   */
  async ensureHorizonDays(horizonDays = 330): Promise<number> {
    const now = new Date();
    const vnTodayStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
    const baseDate = new Date(`${vnTodayStr}T00:00:00+07:00`);
    const targetEndDate = new Date(baseDate.getTime() + (horizonDays - 1) * 86400000);
    const targetEndStr = localDateKey(targetEndDate, 'Asia/Ho_Chi_Minh');

    // Check if the farthest horizon day is already generated for the legacy population
    const exists = await this.flightModel.exists({
      operating_date: targetEndStr,
      data_source: 'INTERNAL_GENERATED',
      generated_source: 'seed_schedule_330',
    });
    if (exists) {
      return 0; // Horizon is intact; zero overhead on startup
    }

    // Generate missing days only (from last existing date forward)
    const latestFlight = await this.flightModel
      .findOne({
        is_generated: true,
        data_source: 'INTERNAL_GENERATED',
        generated_source: 'seed_schedule_330',
      })
      .sort({ operating_date: -1 })
      .select('operating_date')
      .lean()
      .exec();

    let startDateStr: string;
    if (latestFlight?.operating_date) {
      const nextDate = new Date(`${latestFlight.operating_date}T00:00:00+07:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      startDateStr = localDateKey(nextDate, 'Asia/Ho_Chi_Minh');
    } else {
      startDateStr = localDateKey(now, 'Asia/Ho_Chi_Minh');
    }

    const diffDays = Math.round(
      (new Date(`${targetEndStr}T00:00:00+07:00`).getTime() -
        new Date(`${startDateStr}T00:00:00+07:00`).getTime()) /
        86400000,
    ) + 1;

    if (diffDays > 0 && diffDays <= 30) {
      this.logger.log(`Appending ${diffDays} missing horizon days (${startDateStr} to ${targetEndStr})...`);
      const stats = await this.generateRollingSchedule(startDateStr, diffDays);
      return stats.inserted_count;
    }

    return 0;
  }

  /**
   * Generates or maintains flights for a specific schedule template (AirLabs-backed or synthetic).
   * Uses idempotent $setOnInsert keyed by { template_id, operating_date } to protect sold seats and bookings.
   * Does NOT call syncTemplatesCatalog().
   */
  async generateForTemplate(
    templateInput: ScheduleTemplateDocument | string,
    startDateStr?: string,
    days = 330,
  ): Promise<GenerationStats> {
    const startTime = Date.now();

    let tpl: ScheduleTemplateDocument | null = null;
    if (typeof templateInput === 'string') {
      tpl = await this.templateModel.findOne({ template_id: templateInput }).exec();
      if (!tpl) {
        throw new BadRequestException(`ScheduleTemplate not found with template_id: "${templateInput}"`);
      }
    } else {
      tpl = templateInput;
    }

    // 1. Fetch airports for timezone & coordinates
    const originApt = await this.airportModel.findOne({ iata_code: tpl.origin_iata }).lean().exec();
    const destApt = await this.airportModel.findOne({ iata_code: tpl.dest_iata }).lean().exec();

    // Defect 3: No fake Vietnam timezone for AirLabs commercial flights
    if (tpl.source_type === 'AIRLABS') {
      if (!originApt || !originApt.time_zone) {
        throw new BadRequestException(
          `Missing origin airport or timezone data for AirLabs commercial flight: "${tpl.origin_iata}"`,
        );
      }
      if (!destApt || !destApt.time_zone) {
        throw new BadRequestException(
          `Missing destination airport or timezone data for AirLabs commercial flight: "${tpl.dest_iata}"`,
        );
      }
    }

    const originTz = originApt?.time_zone || 'Asia/Ho_Chi_Minh';
    const destTz = destApt?.time_zone || 'Asia/Ho_Chi_Minh';

    // 2. Mark airports as serviced directly if active
    if (tpl.is_active) {
      await this.airportModel.updateMany(
        { iata_code: { $in: [tpl.origin_iata, tpl.dest_iata] } },
        { $set: { is_serviced_directly: true } },
      );
    }

    // 3. Determine date window using deterministic calendar date iteration (Defect 4)
    let startFormatted: string;
    if (startDateStr) {
      startFormatted = startDateStr;
    } else {
      const now = new Date();
      startFormatted = localDateKey(now, originTz);
    }

    const [startYear, startMonth, startDay] = startFormatted.split('-').map(Number);
    const endCalDate = new Date(Date.UTC(startYear, startMonth - 1, startDay + days - 1));
    const endFormatted = `${endCalDate.getUTCFullYear()}-${String(endCalDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endCalDate.getUTCDate()).padStart(2, '0')}`;

    let totalOperations = 0;
    let totalInserted = 0;
    let totalMatched = 0;

    let currentBatch: any[] = [];
    const CHUNK_SIZE = 1000;

    // Great-circle distance
    const miles =
      originApt && destApt && originApt.lat && originApt.lng && destApt.lat && destApt.lng
        ? this.calculateGreatCircleMiles(originApt.lat, originApt.lng, destApt.lat, destApt.lng)
        : 0;

    // Aircraft metadata & layout
    const meta = this.getAircraftMetadata(tpl.aircraft_type);

    // Defect 1: Map commercial inventories from template if configured
    const templateInvMap = new Map<CabinClass, number>();
    if (tpl.commercial_inventories && tpl.commercial_inventories.length > 0) {
      for (const inv of tpl.commercial_inventories) {
        templateInvMap.set(inv.cabin_class, inv.allocated_seats);
      }
    }

    // Build inventories based on template's configured cabin classes
    const configuredCabins = new Set(tpl.cabin_classes);
    // Generator must not silently fill a missing configured cabin from physical capacity
    if (tpl.source_type === 'AIRLABS') {
      for (const cabin of tpl.cabin_classes) {
        if (!templateInvMap.has(cabin)) {
          throw new BadRequestException(
            `Commercial template "${tpl.template_id}" has configured cabin "${cabin}" without a corresponding commercial inventory allocation.`,
          );
        }
      }
    }

    const inventories = meta.inventories
      .filter((inv) => configuredCabins.has(inv.cabin_class))
      .map((invDef) => {
        let basePrice = tpl.base_price_economy;
        if (invDef.cabin_class === CabinClass.BUSINESS) {
          basePrice = tpl.base_price_business || Math.round(tpl.base_price_economy * invDef.price_factor);
        } else if (invDef.cabin_class === CabinClass.CLUB) {
          basePrice = tpl.base_price_club || Math.round(tpl.base_price_economy * invDef.price_factor);
        } else if (invDef.cabin_class === CabinClass.FIRST) {
          basePrice = tpl.base_price_first || Math.round(tpl.base_price_economy * 3.5);
        }

        // Use persisted commercial allocation if present, otherwise default to aircraft layout capacity
        const allocatedSeats = templateInvMap.has(invDef.cabin_class)
          ? templateInvMap.get(invDef.cabin_class)!
          : invDef.allocated_seats;

        return {
          cabin_class: invDef.cabin_class,
          is_smoking: false,
          bucket_code:
            invDef.cabin_class === CabinClass.ECONOMY ? 'Y' : invDef.cabin_class === CabinClass.BUSINESS ? 'J' : 'W',
          base_price: basePrice,
          allocated_seats: allocatedSeats,
          available_seats: allocatedSeats,
        };
      });

    // Defect 4: Pure calendar date iteration across DST boundaries
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calDate = new Date(Date.UTC(startYear, startMonth - 1, startDay + dayOffset));
      const yearStr = calDate.getUTCFullYear();
      const monthStr = String(calDate.getUTCMonth() + 1).padStart(2, '0');
      const dayStr = String(calDate.getUTCDate()).padStart(2, '0');
      const dateStr = `${yearStr}-${monthStr}-${dayStr}`;

      // ISO Day of Week: 1 = Monday ... 7 = Sunday
      const rawDow = calDate.getUTCDay();
      const isoDow = rawDow === 0 ? 7 : rawDow;

      if (!tpl.days_of_week.includes(isoDow)) {
        continue;
      }

      // Scheduled Departure UTC (Defect 8 & Issue 5: DST-safe local wall time or provider UTC)
      let scheduledDepartureUtc: Date;
      if (tpl.std_dep_time) {
        scheduledDepartureUtc = resolveLocalWallTimeToUtc(
          dateStr,
          tpl.std_dep_time,
          originTz,
        );
      } else if (tpl.source_dep_time_utc) {
        // Find UTC date matching operating date dateStr in originTz
        const [cy, cm, cd] = dateStr.split('-').map(Number);
        let matchedUtc: Date | null = null;
        for (const offset of [-1, 0, 1]) {
          const candD = new Date(Date.UTC(cy, cm - 1, cd + offset));
          const candDateStr = `${candD.getUTCFullYear()}-${String(candD.getUTCMonth() + 1).padStart(2, '0')}-${String(candD.getUTCDate()).padStart(2, '0')}`;
          const candUtc = new Date(`${candDateStr}T${tpl.source_dep_time_utc}:00Z`);
          if (localDateKey(candUtc, originTz) === dateStr) {
            matchedUtc = candUtc;
            break;
          }
        }
        if (!matchedUtc) {
          throw new BadRequestException(
            `Cannot align source_dep_time_utc "${tpl.source_dep_time_utc}" to operating date "${dateStr}" in timezone "${originTz}"`,
          );
        }
        scheduledDepartureUtc = matchedUtc;
      } else {
        throw new BadRequestException(
          `Schedule template "${tpl.template_id}" lacks both std_dep_time and source_dep_time_utc.`,
        );
      }

      const depTimeMs = scheduledDepartureUtc.getTime();
      let scheduledArrivalUtc: Date;
      let durationMinutes: number;

      if (tpl.source_duration_minutes && tpl.source_duration_minutes > 0) {
        // 1. Physical chronology: prefer actual source duration across DST boundaries
        durationMinutes = tpl.source_duration_minutes;
        scheduledArrivalUtc = new Date(depTimeMs + durationMinutes * 60000);
      } else if (tpl.std_arr_time) {
        // 2. Local arrival wall-time resolution with concrete destination timezone
        let bestArrivalUtc: Date | null = null;
        let bestDurationMinutes = Infinity;
        let firstCandidateError: Error | null = null;

        for (const arrDayOffset of [0, 1, 2]) {
          const candCal = new Date(Date.UTC(yearStr, Number(monthStr) - 1, Number(dayStr) + arrDayOffset));
          const candArrDateStr = `${candCal.getUTCFullYear()}-${String(candCal.getUTCMonth() + 1).padStart(2, '0')}-${String(candCal.getUTCDate()).padStart(2, '0')}`;
          let candArrUtc: Date;
          try {
            candArrUtc = resolveLocalWallTimeToUtc(candArrDateStr, tpl.std_arr_time, destTz);
          } catch (err: any) {
            if (!firstCandidateError) {
              firstCandidateError = err;
            }
            continue;
          }
          const diffMinutes = Math.round((candArrUtc.getTime() - depTimeMs) / 60000);

          if (diffMinutes >= 20 && diffMinutes <= 1440 && diffMinutes < bestDurationMinutes) {
            bestArrivalUtc = candArrUtc;
            bestDurationMinutes = diffMinutes;
          }
        }

        if (bestArrivalUtc) {
          scheduledArrivalUtc = bestArrivalUtc;
          durationMinutes = bestDurationMinutes;
        } else {
          throw new BadRequestException(
            firstCandidateError?.message ||
              `Schedule template "${tpl.template_id}" (${tpl.flight_number}) on operating date "${dateStr}" cannot resolve valid arrival chronology for local time "${tpl.std_arr_time}" in timezone "${destTz}".`,
          );
        }
      } else if (tpl.source_arr_time_utc) {
        // 3. Provider UTC arrival clock directly
        const depCal = new Date(depTimeMs);
        const [arrH, arrM] = tpl.source_arr_time_utc.split(':').map(Number);
        const candidates: Date[] = [];
        for (const dayOffset of [0, 1, 2]) {
          const cand = new Date(
            Date.UTC(depCal.getUTCFullYear(), depCal.getUTCMonth(), depCal.getUTCDate() + dayOffset, arrH, arrM),
          );
          if (cand.getTime() > depTimeMs) {
            candidates.push(cand);
          }
        }

        if (candidates.length === 0) {
          throw new BadRequestException(
            `Schedule template "${tpl.template_id}" (${tpl.flight_number}) on operating date "${dateStr}": cannot resolve arrival chronology from source_arr_time_utc "${tpl.source_arr_time_utc}" after departure ${scheduledDepartureUtc.toISOString()}`,
          );
        }

        candidates.sort((a, b) => a.getTime() - b.getTime());
        scheduledArrivalUtc = candidates[0];
        durationMinutes = Math.round((scheduledArrivalUtc.getTime() - depTimeMs) / 60000);
      } else {
        throw new BadRequestException(
          `Schedule template "${tpl.template_id}" (${tpl.flight_number}) on operating date "${dateStr}" lacks std_arr_time, source_arr_time_utc, and source_duration_minutes.`,
        );
      }

      const isAirLabs = tpl.source_type === 'AIRLABS';

      const flightInsertDoc = {
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
        aircraft: {
          model_code: tpl.aircraft_type,
          model_name: meta.model_name,
          total_capacity: meta.total_capacity,
        },
        inventories,
        template_id: tpl.template_id,
        operating_date: dateStr,
        is_generated: true,
        generated_source: isAirLabs ? 'airlabs_commercial_schedule' : 'seed_schedule_330',
        is_manually_modified: false,
        operator: 'APTECH_AIRLINES',
        is_bookable: true,
        data_source: isAirLabs ? 'AIRLABS_COMMERCIALIZED' : 'INTERNAL_GENERATED',
        commercial_template_id: (tpl as any)._id?.toString() || undefined,
        source_type: tpl.source_type,
        source_route_key: tpl.source_route_key,
        source_service_key: tpl.source_service_key,
        source_airline_iata: tpl.source_airline_iata,
        source_airline_icao: tpl.source_airline_icao,
        source_flight_iata: tpl.source_flight_iata,
        source_flight_icao: tpl.source_flight_icao,
        source_flight_number: tpl.source_flight_number,
        source_aircraft_icao: tpl.source_aircraft_icao,
        source_duration_minutes: tpl.source_duration_minutes,
        source_synced_at: tpl.source_synced_at,
      };

      currentBatch.push({
        updateOne: {
          filter: {
            template_id: tpl.template_id,
            operating_date: dateStr,
          },
          update: {
            $setOnInsert: flightInsertDoc,
          },
          upsert: true,
        },
      });

      if (currentBatch.length >= CHUNK_SIZE) {
        const res = await this.flightModel.bulkWrite(currentBatch, { ordered: false });
        totalOperations += currentBatch.length;
        totalInserted += res.upsertedCount;
        totalMatched += res.matchedCount;
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      const res = await this.flightModel.bulkWrite(currentBatch, { ordered: false });
      totalOperations += currentBatch.length;
      totalInserted += res.upsertedCount;
      totalMatched += res.matchedCount;
      currentBatch = [];
    }

    const durationMs = Date.now() - startTime;
    return {
      total_days: days,
      start_date: startFormatted,
      end_date: endFormatted,
      templates_count: 1,
      total_operations: totalOperations,
      inserted_count: totalInserted,
      matched_count: totalMatched,
      skipped_existing: totalMatched,
      duration_ms: durationMs,
    };
  }

  /**
   * Materialize all active AirLabs commercial templates with per-template failure isolation.
   */
  async generateActiveCommercialTemplates(
    startDateStr?: string,
    days = 330,
  ): Promise<{
    templates_count: number;
    successful_templates: number;
    failed_templates: number;
    inserted_count: number;
    matched_count: number;
    failures: Array<{ template_id: string; error: string }>;
  }> {
    const templates = await this.templateModel
      .find({ source_type: 'AIRLABS', is_active: true })
      .exec();

    let successfulTemplates = 0;
    let failedTemplates = 0;
    let insertedCount = 0;
    let matchedCount = 0;
    const failures: Array<{ template_id: string; error: string }> = [];

    for (const tpl of templates) {
      try {
        const stats = await this.generateForTemplate(tpl, startDateStr, days);
        insertedCount += stats.inserted_count;
        matchedCount += stats.matched_count;
        successfulTemplates++;
      } catch (err: any) {
        failedTemplates++;
        const errMsg = err?.message || String(err);
        failures.push({ template_id: tpl.template_id, error: errMsg });
        this.logger.error(
          `Failed generation for commercial template "${tpl.template_id}": ${errMsg}`,
          err?.stack,
        );
      }
    }

    return {
      templates_count: templates.length,
      successful_templates: successfulTemplates,
      failed_templates: failedTemplates,
      inserted_count: insertedCount,
      matched_count: matchedCount,
      failures,
    };
  }

  /**
   * Ensures forward horizon for an individual commercial template.
   * Defect 5: Checks expected operating dates rather than plain calendar end.
   */
  async ensureCommercialTemplateHorizon(
    templateInput: ScheduleTemplateDocument | string,
    horizonDays = 330,
    customStartDateStr?: string,
  ): Promise<number> {
    let tpl: ScheduleTemplateDocument | null = null;
    if (typeof templateInput === 'string') {
      tpl = await this.templateModel.findOne({ template_id: templateInput }).exec();
      if (!tpl) {
        throw new BadRequestException(`ScheduleTemplate not found with template_id: "${templateInput}"`);
      }
    } else {
      tpl = templateInput;
    }

    const originApt = await this.airportModel.findOne({ iata_code: tpl.origin_iata }).lean().exec();
    // Defect 3: Reject missing timezone on AirLabs template
    if (tpl.source_type === 'AIRLABS' && (!originApt || !originApt.time_zone)) {
      throw new BadRequestException(
        `Missing origin airport or timezone data for AirLabs commercial flight: "${tpl.origin_iata}"`,
      );
    }

    const originTz = originApt?.time_zone || 'Asia/Ho_Chi_Minh';

    const originTodayStr = customStartDateStr || localDateKey(new Date(), originTz);
    const [startYear, startMonth, startDay] = originTodayStr.split('-').map(Number);

    // Defect 5: Compute the final EXPECTED operating date within horizon [0 ... horizonDays - 1]
    let lastExpectedDateStr: string | null = null;
    for (let offset = horizonDays - 1; offset >= 0; offset--) {
      const d = new Date(Date.UTC(startYear, startMonth - 1, startDay + offset));
      const rawDow = d.getUTCDay();
      const isoDow = rawDow === 0 ? 7 : rawDow;
      if (tpl.days_of_week.includes(isoDow)) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        lastExpectedDateStr = `${y}-${m}-${day}`;
        break;
      }
    }

    if (!lastExpectedDateStr) {
      return 0; // Template does not operate on any day in the requested horizon
    }

    // Horizon is complete if flight exists on that last expected operating date
    const exists = await this.flightModel.exists({
      template_id: tpl.template_id,
      operating_date: lastExpectedDateStr,
    });
    if (exists) {
      return 0;
    }

    const latestFlight = await this.flightModel
      .findOne({ template_id: tpl.template_id })
      .sort({ operating_date: -1 })
      .select('operating_date')
      .lean()
      .exec();

    let startDateStr: string;
    if (latestFlight?.operating_date) {
      const [ly, lm, ld] = latestFlight.operating_date.split('-').map(Number);
      const nextDate = new Date(Date.UTC(ly, lm - 1, ld + 1));
      startDateStr = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`;
    } else {
      startDateStr = originTodayStr;
    }

    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const [ey, em, ed] = lastExpectedDateStr.split('-').map(Number);
    const diffDays = Math.round(
      (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000,
    ) + 1;

    if (diffDays > 0) {
      const stats = await this.generateForTemplate(tpl, startDateStr, diffDays);
      return stats.inserted_count;
    }

    return 0;
  }

  /**
   * Orchestrates forward horizon maintenance across all active AirLabs commercial templates.
   * Isolates failures per template so one failure does not halt maintenance for others.
   * Returns an aggregate report containing templates_count, successful_templates, failed_templates, inserted_count, failures.
   */
  async ensureActiveCommercialHorizons(horizonDays = 330): Promise<CommercialHorizonReport> {
    const templates = await this.templateModel
      .find({ source_type: 'AIRLABS', is_active: true })
      .exec();

    let successfulTemplates = 0;
    let failedTemplates = 0;
    let totalInserted = 0;
    const failures: Array<{ template_id: string; error: string }> = [];

    for (const tpl of templates) {
      try {
        const appended = await this.ensureCommercialTemplateHorizon(tpl, horizonDays);
        totalInserted += appended;
        successfulTemplates++;
      } catch (err: any) {
        failedTemplates++;
        const errMsg = err?.message || String(err);
        failures.push({ template_id: tpl.template_id, error: errMsg });
        this.logger.error(
          `Failed horizon maintenance for commercial template "${tpl.template_id}": ${errMsg}`,
          err?.stack,
        );
      }
    }

    return {
      templates_count: templates.length,
      successful_templates: successfulTemplates,
      failed_templates: failedTemplates,
      inserted_count: totalInserted,
      failures,
    };
  }
}
