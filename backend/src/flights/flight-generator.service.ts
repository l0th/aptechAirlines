import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flight, FlightDocument, FlightStatus, CabinClass } from './flights.schema';
import { ScheduleTemplate, ScheduleTemplateDocument } from './schemas/schedule-template.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import { localWallTimeToUtc, localDateKey } from '../common/timezone.util';
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

    // 1. Fetch active templates
    const templates = await this.templateModel.find({ is_active: true }).lean().exec();
    if (templates.length === 0) {
      throw new Error('No active schedule templates found in database.');
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

    // Check if the farthest horizon day is already generated
    const exists = await this.flightModel.exists({ operating_date: targetEndStr });
    if (exists) {
      return 0; // Horizon is intact; zero overhead on startup
    }

    // Generate missing days only (from last existing date forward)
    const latestFlight = await this.flightModel
      .findOne({ is_generated: true })
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
}
