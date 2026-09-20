import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RouteRef, RouteRefDocument } from '../reference/reference.schema';
import { ScheduleTemplate, ScheduleTemplateDocument } from './schemas/schedule-template.schema';
import { Flight, FlightDocument } from './flights.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import { FlightGeneratorService, GenerationStats } from './flight-generator.service';
import {
  CommercializeRouteDto,
  UpdateCommercialTemplateDto,
} from './airlabs-commercial.dto';
import { CabinClass } from './flights.schema';
import { getAircraftLayout, FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';
import { utcOffsetMinutes } from '../common/timezone.util';

const DAY_NAME_TO_ISO: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

@Injectable()
export class AirlabsCommercialService {
  private readonly logger = new Logger(AirlabsCommercialService.name);

  constructor(
    @InjectModel(RouteRef.name) private routeRefModel: Model<RouteRefDocument>,
    @InjectModel(ScheduleTemplate.name) private templateModel: Model<ScheduleTemplateDocument>,
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
    private flightGeneratorService: FlightGeneratorService,
  ) {}

  /**
   * Parse days from RouteRef into ISO day numbers (1 = Mon ... 7 = Sun)
   */
  private parseDaysToIso(daysInput: any): number[] {
    if (!daysInput) return [];
    if (typeof daysInput === 'string' && daysInput.toLowerCase().trim() === 'daily') {
      return [1, 2, 3, 4, 5, 6, 7];
    }
    const daysArr = Array.isArray(daysInput) ? daysInput : [daysInput];
    const isoDays = new Set<number>();

    for (const d of daysArr) {
      if (typeof d === 'number' && d >= 1 && d <= 7) {
        isoDays.add(d);
      } else if (typeof d === 'string') {
        const trimmed = d.trim().toLowerCase();
        if (trimmed === 'daily') {
          [1, 2, 3, 4, 5, 6, 7].forEach((day) => isoDays.add(day));
        } else if (DAY_NAME_TO_ISO[trimmed]) {
          isoDays.add(DAY_NAME_TO_ISO[trimmed]);
        } else {
          // If numeric string "1"..."7"
          const num = parseInt(trimmed, 10);
          if (!isNaN(num) && num >= 1 && num <= 7) {
            isoDays.add(num);
          }
        }
      }
    }

    return Array.from(isoDays).sort((a, b) => a - b);
  }

  /**
   * Validate provider clock string format (HH:mm or HH:mm:ss)
   */
  private validateProviderTimeFormat(field: string, timeStr?: string): void {
    if (!timeStr) return;
    const trimmed = timeStr.trim();
    if (!trimmed) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(trimmed)) {
      throw new BadRequestException(
        `Source data invalid: malformed time format for "${field}": "${timeStr}". Expected HH:mm or HH:mm:ss (00-23:00-59[:00-59])`,
      );
    }
  }

  /**
   * Check consistency between provider local wall clock and provider UTC clock
   */
  private checkLocalUtcConsistency(localHhmm: string, utcHhmm: string, timeZone: string): boolean {
    const [lh, lm] = localHhmm.split(':').map(Number);
    const [uh, um] = utcHhmm.split(':').map(Number);
    const localMins = lh * 60 + lm;
    const utcMins = uh * 60 + um;

    try {
      const offsets = new Set<number>();
      for (let month = 0; month < 12; month++) {
        const d = new Date(Date.UTC(2026, month, 15, 12, 0));
        offsets.add(utcOffsetMinutes(d, timeZone));
      }

      for (const off of offsets) {
        const expectedUtc = ((localMins - off) % 1440 + 1440) % 1440;
        if (expectedUtc === utcMins) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List real AirLabs routes from cache with schedule
   */
  async listAirlabsRoutesWithSchedule(filter: {
    dep_iata?: string;
    arr_iata?: string;
    has_schedule?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    total: number;
    limit: number;
    offset: number;
    items: RouteRef[];
  }> {
    const query: any = { source: 'airlabs' };

    if (filter.dep_iata) {
      query.dep_iata = filter.dep_iata.toUpperCase().trim();
    }
    if (filter.arr_iata) {
      query.arr_iata = filter.arr_iata.toUpperCase().trim();
    }
    if (filter.has_schedule !== false) {
      query.$or = [
        { dep_time: { $exists: true, $ne: '' } },
        { dep_time_utc: { $exists: true, $ne: '' } },
      ];
    }

    const limit = Math.min(Math.max(filter.limit || 50, 1), 500);
    const offset = Math.max(filter.offset || 0, 0);

    const [total, items] = await Promise.all([
      this.routeRefModel.countDocuments(query).exec(),
      this.routeRefModel.find(query).skip(offset).limit(limit).lean().exec(),
    ]);

    return { total, limit, offset, items };
  }

  /**
   * Get single AirLabs RouteRef details
   */
  async getAirlabsRouteDetail(sourceKey: string): Promise<RouteRef> {
    const route = await this.routeRefModel
      .findOne({ source_key: sourceKey, source: 'airlabs' })
      .lean()
      .exec();

    if (!route) {
      throw new NotFoundException(`AirLabs RouteRef not found with source_key: "${sourceKey}"`);
    }

    return route;
  }

  /**
   * Commercialize an AirLabs RouteRef into an Aptech commercial ScheduleTemplate.
   * Enforces zero synthetic invention when source schedule data is incomplete.
   */
  async commercializeRoute(dto: CommercializeRouteDto): Promise<ScheduleTemplateDocument> {
    // 1. Load RouteRef
    const route = await this.routeRefModel
      .findOne({ source_key: dto.source_key, source: 'airlabs' })
      .exec();

    if (!route) {
      throw new NotFoundException(`AirLabs RouteRef not found for source_key: "${dto.source_key}"`);
    }

    if (route.source !== 'airlabs') {
      throw new BadRequestException(`Route source must be 'airlabs', received: "${route.source}"`);
    }

    // 2. Validate Origin & Destination
    const depIata = (route.dep_iata || '').toUpperCase().trim();
    const arrIata = (route.arr_iata || '').toUpperCase().trim();
    if (!depIata || !arrIata) {
      throw new BadRequestException('Source data incomplete: missing origin or destination');
    }

    // Require real source flight identity before commercialization (Issue 2)
    const carrier = (route.airline_iata || route.airline_icao || '').toUpperCase().trim();
    if (!carrier) {
      throw new BadRequestException('Source data incomplete: missing source airline identity');
    }

    const flight = (route.flight_iata || route.flight_icao || route.flight_number || '').toUpperCase().trim();
    if (!flight) {
      throw new BadRequestException('Source data incomplete: missing source flight identity');
    }

    // 3. Strict Schedule Validation (Zero Synthetic Invention)
    // Departure time required (either local dep_time or dep_time_utc)
    const depTime = (route.dep_time || '').trim();
    const depTimeUtc = (route.dep_time_utc || '').trim();
    if (!depTime && !depTimeUtc) {
      throw new BadRequestException('Source data incomplete: missing both local dep_time and dep_time_utc');
    }

    // Arrival time or positive duration required
    const arrTime = (route.arr_time || '').trim();
    const arrTimeUtc = (route.arr_time_utc || '').trim();
    const duration =
      typeof route.duration === 'number' && route.duration > 0 ? route.duration : undefined;

    if (!arrTime && !arrTimeUtc && !duration) {
      throw new BadRequestException('Source data incomplete: missing arrival time and duration');
    }

    // Operating days required
    const daysOfWeek = this.parseDaysToIso(route.days);
    if (daysOfWeek.length === 0) {
      throw new BadRequestException('Source data incomplete: missing operating days');
    }

    // Validate provider time format (Issue 3)
    this.validateProviderTimeFormat('dep_time', depTime);
    this.validateProviderTimeFormat('dep_time_utc', depTimeUtc);
    this.validateProviderTimeFormat('arr_time', arrTime);
    this.validateProviderTimeFormat('arr_time_utc', arrTimeUtc);

    // Validate provider local vs UTC consistency if both local and UTC values are supplied (Issue 3)
    if ((depTime && depTimeUtc) || (arrTime && arrTimeUtc)) {
      const [depAirport, arrAirport] = await Promise.all([
        depTime && depTimeUtc ? this.airportModel.findOne({ iata_code: depIata }).lean().exec() : null,
        arrTime && arrTimeUtc ? this.airportModel.findOne({ iata_code: arrIata }).lean().exec() : null,
      ]);

      if (depTime && depTimeUtc && depAirport?.time_zone) {
        if (!this.checkLocalUtcConsistency(depTime, depTimeUtc, depAirport.time_zone)) {
          throw new BadRequestException(
            `Source data inconsistent: departure local time "${depTime}" conflicts with UTC time "${depTimeUtc}" for timezone "${depAirport.time_zone}"`,
          );
        }
      }

      if (arrTime && arrTimeUtc && arrAirport?.time_zone) {
        if (!this.checkLocalUtcConsistency(arrTime, arrTimeUtc, arrAirport.time_zone)) {
          throw new BadRequestException(
            `Source data inconsistent: arrival local time "${arrTime}" conflicts with UTC time "${arrTimeUtc}" for timezone "${arrAirport.time_zone}"`,
          );
        }
      }
    }

    // Validate Aptech commercial flight number format (Requirement 4)
    const aptechFlightNumber = (dto.aptech_flight_number || '').toUpperCase().trim();
    if (!/^APT[A-Z0-9]+$/.test(aptechFlightNumber)) {
      throw new BadRequestException(
        `Commercial flight number must match format ^APT[A-Z0-9]+$, received: "${dto.aptech_flight_number}"`,
      );
    }

    // 4. Commercial Aircraft & Layout Validation
    const layout = getAircraftLayout(dto.aircraft_type);
    const supportedCabins = Object.keys(layout.cabin_capacities) as CabinClass[];

    // Validate and build commercial cabins and inventories (Requirement 2)
    let cabinClasses: CabinClass[];
    let commercialInventories: Array<{ cabin_class: CabinClass; allocated_seats: number }> = [];

    if (dto.inventories && dto.inventories.length > 0) {
      const seenCabins = new Set<CabinClass>();
      for (const inv of dto.inventories) {
        if (seenCabins.has(inv.cabin_class)) {
          throw new BadRequestException(`Duplicate commercial inventory entry for cabin "${inv.cabin_class}"`);
        }
        seenCabins.add(inv.cabin_class);

        const physicalCapacity = layout.cabin_capacities[inv.cabin_class];
        if (!physicalCapacity) {
          throw new BadRequestException(
            `Aircraft "${layout.aircraft_type}" does not support cabin class "${inv.cabin_class}" in inventory allocation`,
          );
        }
        if (inv.allocated_seats > physicalCapacity) {
          throw new BadRequestException(
            `Commercial inventory allocated_seats (${inv.allocated_seats}) exceeds physical seat capacity (${physicalCapacity}) for cabin ${inv.cabin_class}`,
          );
        }
        commercialInventories.push({
          cabin_class: inv.cabin_class,
          allocated_seats: inv.allocated_seats,
        });
      }

      if (dto.cabin_classes && dto.cabin_classes.length > 0) {
        const requestedCabinsSet = new Set(dto.cabin_classes);
        if (requestedCabinsSet.size !== dto.cabin_classes.length) {
          throw new BadRequestException('Duplicate cabin class entries in cabin_classes');
        }
        if (requestedCabinsSet.size !== seenCabins.size) {
          throw new BadRequestException(
            'Commercial inventories must exactly match commercial cabin classes (missing or extra cabins)',
          );
        }
        for (const c of requestedCabinsSet) {
          if (!seenCabins.has(c)) {
            throw new BadRequestException(
              `Commercial inventories must exactly match commercial cabin classes: missing cabin "${c}"`,
            );
          }
        }
        cabinClasses = dto.cabin_classes;
      } else {
        // Derive commercial cabin classes from unique inventory cabin classes
        cabinClasses = Array.from(seenCabins);
      }
    } else if (dto.cabin_classes && dto.cabin_classes.length > 0) {
      // cabin_classes supplied but inventories omitted: reject to maintain 1-to-1 invariant
      throw new BadRequestException('Commercial inventories must be provided and match specified cabin_classes');
    } else {
      // Neither supplied: default to physical aircraft commercial cabins and capacities
      cabinClasses = supportedCabins;
      commercialInventories = supportedCabins.map((cabin) => ({
        cabin_class: cabin,
        allocated_seats: layout.cabin_capacities[cabin],
      }));
    }

    for (const cabin of cabinClasses) {
      if (!supportedCabins.includes(cabin)) {
        throw new BadRequestException(
          `Aircraft "${layout.aircraft_type}" does not support cabin class "${cabin}". Supported: ${supportedCabins.join(', ')}`,
        );
      }
    }

    // 5. Compute Provenance & Deterministic Keys
    const cs =
      route.cs_flight_iata || route.cs_flight_number
        ? `_${(route.cs_flight_iata || route.cs_flight_number).toUpperCase().trim()}`
        : '';
    const source_service_key = `AIRLABS_SVC_${carrier}_${flight}_${depIata}_${arrIata}${cs}`;

    // Deterministic unique template_id
    const sanitizedKey = route.source_key.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase();
    const template_id = `AIRLABS-COMM-${sanitizedKey}`;

    // 6. Create or Update Commercial ScheduleTemplate
    const updatePayload: any = {
      template_id,
      flight_number: aptechFlightNumber,
      origin_iata: depIata,
      dest_iata: arrIata,
      days_of_week: daysOfWeek,
      aircraft_type: layout.aircraft_type,
      cabin_classes: cabinClasses,
      commercial_inventories: commercialInventories,
      base_price_economy: dto.base_price_economy,
      is_active: true,
      source_type: 'AIRLABS',
      source_route_key: route.source_key,
      source_service_key,
      source_airline_iata: route.airline_iata,
      source_airline_icao: route.airline_icao,
      source_flight_iata: route.flight_iata,
      source_flight_number: route.flight_number,
    };

    if (route.flight_icao) {
      updatePayload.source_flight_icao = route.flight_icao.toUpperCase().trim();
    }
    if (route.aircraft_icao) {
      updatePayload.source_aircraft_icao = route.aircraft_icao;
    }
    if (route.synced_at) {
      updatePayload.source_synced_at = route.synced_at;
    }
    if (depTime) {
      updatePayload.std_dep_time = depTime;
    }
    if (depTimeUtc) {
      updatePayload.source_dep_time_utc = depTimeUtc;
    }
    if (arrTime) {
      updatePayload.std_arr_time = arrTime;
    }
    if (arrTimeUtc) {
      updatePayload.source_arr_time_utc = arrTimeUtc;
    }
    if (duration) {
      updatePayload.source_duration_minutes = duration;
    }
    if (dto.base_price_business !== undefined) {
      updatePayload.base_price_business = dto.base_price_business;
    }
    if (dto.base_price_club !== undefined) {
      updatePayload.base_price_club = dto.base_price_club;
    }
    if (dto.base_price_first !== undefined) {
      updatePayload.base_price_first = dto.base_price_first;
    }

    // Clear stale source schedule fields when re-commercializing (Issue 1)
    const unsetPayload: Record<string, 1> = {};
    const providerOptionalFields = [
      'std_dep_time',
      'source_dep_time_utc',
      'std_arr_time',
      'source_arr_time_utc',
      'source_duration_minutes',
      'source_aircraft_icao',
      'source_flight_icao',
      'source_synced_at',
    ];
    for (const field of providerOptionalFields) {
      if (updatePayload[field] === undefined) {
        unsetPayload[field] = 1;
      }
    }

    const updateDoc: any = { $set: updatePayload };
    if (Object.keys(unsetPayload).length > 0) {
      updateDoc.$unset = unsetPayload;
    }

    const template = await this.templateModel.findOneAndUpdate(
      { template_id },
      updateDoc,
      { upsert: true, new: true },
    );

    this.logger.log(
      `Commercialized AirLabs route "${route.source_key}" as Aptech template "${template.template_id}" (${template.flight_number}: ${depIata}->${arrIata}).`,
    );

    return template;
  }

  /**
   * List commercial ScheduleTemplates
   */
  async listCommercialTemplates(query: {
    source_type?: string;
    is_active?: boolean;
    origin_iata?: string;
    dest_iata?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    total: number;
    limit: number;
    offset: number;
    items: ScheduleTemplateDocument[];
  }> {
    const filter: any = {};
    if (query.source_type) {
      filter.source_type = query.source_type;
    } else {
      filter.source_type = 'AIRLABS';
    }

    if (query.is_active !== undefined) {
      filter.is_active = query.is_active;
    }
    if (query.origin_iata) {
      filter.origin_iata = query.origin_iata.toUpperCase().trim();
    }
    if (query.dest_iata) {
      filter.dest_iata = query.dest_iata.toUpperCase().trim();
    }

    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    const offset = Math.max(query.offset || 0, 0);

    const [total, items] = await Promise.all([
      this.templateModel.countDocuments(filter).exec(),
      this.templateModel.find(filter).skip(offset).limit(limit).exec(),
    ]);

    return { total, limit, offset, items };
  }

  /**
   * Update commercial properties of a commercial ScheduleTemplate
   */
  async updateCommercialTemplate(
    id: string,
    dto: UpdateCommercialTemplateDto,
  ): Promise<ScheduleTemplateDocument> {
    const template = await this.templateModel
      .findOne({
        $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { template_id: id }],
      })
      .exec();

    if (!template) {
      throw new NotFoundException(`Commercial ScheduleTemplate not found with identifier: "${id}"`);
    }

    // Defect 10: Restrict commercial management boundaries to AIRLABS templates
    if (template.source_type !== 'AIRLABS') {
      throw new BadRequestException(
        `Template "${id}" is not an AirLabs commercial template (source_type !== 'AIRLABS')`,
      );
    }

    // Defect 6 & 7 & Issue 2: Aircraft change & inventory revalidation
    const targetAircraft = dto.aircraft_type || template.aircraft_type;
    const layout = getAircraftLayout(targetAircraft);
    const supportedCabins = Object.keys(layout.cabin_capacities) as CabinClass[];

    if (dto.aircraft_type) {
      template.aircraft_type = layout.aircraft_type;
    }

    // Validate effective cabin classes against target aircraft layout
    const targetCabins = dto.cabin_classes || template.cabin_classes;
    if (dto.cabin_classes) {
      if (new Set(dto.cabin_classes).size !== dto.cabin_classes.length) {
        throw new BadRequestException('Duplicate cabin class entries in cabin_classes');
      }
      const existingSorted = [...template.cabin_classes].sort();
      const newSorted = [...dto.cabin_classes].sort();
      const cabinsChanged = JSON.stringify(existingSorted) !== JSON.stringify(newSorted);
      if (cabinsChanged && (!dto.inventories || dto.inventories.length === 0)) {
        throw new BadRequestException(
          'Updating cabin_classes requires matching inventory configuration in the same request',
        );
      }
    }

    for (const cabin of targetCabins) {
      if (!supportedCabins.includes(cabin)) {
        throw new BadRequestException(
          `Aircraft "${layout.aircraft_type}" does not support cabin class "${cabin}". Supported: ${supportedCabins.join(', ')}`,
        );
      }
    }

    // Validate commercial inventories against target aircraft layout & target cabins
    if (dto.inventories && dto.inventories.length > 0) {
      const seenCabins = new Set<CabinClass>();
      const updatedInvs: Array<{ cabin_class: CabinClass; allocated_seats: number }> = [];

      for (const inv of dto.inventories) {
        if (seenCabins.has(inv.cabin_class)) {
          throw new BadRequestException(`Duplicate commercial inventory entry for cabin "${inv.cabin_class}"`);
        }
        seenCabins.add(inv.cabin_class);

        const physicalCapacity = layout.cabin_capacities[inv.cabin_class];
        if (!physicalCapacity) {
          throw new BadRequestException(
            `Aircraft "${layout.aircraft_type}" does not support cabin class "${inv.cabin_class}" in inventory update`,
          );
        }
        if (inv.allocated_seats > physicalCapacity) {
          throw new BadRequestException(
            `Commercial inventory allocated_seats (${inv.allocated_seats}) exceeds physical seat capacity (${physicalCapacity}) for cabin ${inv.cabin_class}`,
          );
        }
        updatedInvs.push({
          cabin_class: inv.cabin_class,
          allocated_seats: inv.allocated_seats,
        });
      }

      // Invariant: inventories must exactly match target cabins
      if (seenCabins.size !== targetCabins.length) {
        throw new BadRequestException(
          'Commercial inventories must exactly match commercial cabin classes (missing or extra cabins)',
        );
      }
      for (const c of targetCabins) {
        if (!seenCabins.has(c)) {
          throw new BadRequestException(
            `Commercial inventories must exactly match commercial cabin classes: missing cabin "${c}"`,
          );
        }
      }

      template.cabin_classes = targetCabins;
      template.commercial_inventories = updatedInvs;
    } else if (dto.cabin_classes) {
      template.cabin_classes = dto.cabin_classes;
    } else if (dto.aircraft_type && template.commercial_inventories && template.commercial_inventories.length > 0) {
      // Aircraft changed without inventory override: ensure existing inventories fit new layout
      for (const inv of template.commercial_inventories) {
        const physicalCapacity = layout.cabin_capacities[inv.cabin_class];
        if (!physicalCapacity || inv.allocated_seats > physicalCapacity) {
          throw new BadRequestException(
            `Existing commercial inventory for cabin "${inv.cabin_class}" (${inv.allocated_seats} seats) is incompatible with new aircraft "${layout.aircraft_type}" (capacity ${physicalCapacity || 0}). Please supply replacement inventory configuration.`,
          );
        }
      }
    }

    if (dto.flight_number !== undefined) {
      const fn = dto.flight_number.toUpperCase().trim();
      if (!/^APT[A-Z0-9]+$/.test(fn)) {
        throw new BadRequestException(
          `Commercial flight number must match format ^APT[A-Z0-9]+$, received: "${dto.flight_number}"`,
        );
      }
      template.flight_number = fn;
    }
    if (dto.base_price_economy !== undefined) {
      template.base_price_economy = dto.base_price_economy;
    }
    if (dto.base_price_business !== undefined) {
      if (dto.base_price_business === null) {
        if (typeof (template as any).set === 'function') {
          (template as any).set('base_price_business', undefined);
        }
        (template as any).base_price_business = undefined;
      } else {
        template.base_price_business = dto.base_price_business;
      }
    }
    if (dto.base_price_club !== undefined) {
      if (dto.base_price_club === null) {
        if (typeof (template as any).set === 'function') {
          (template as any).set('base_price_club', undefined);
        }
        (template as any).base_price_club = undefined;
      } else {
        template.base_price_club = dto.base_price_club;
      }
    }
    if (dto.base_price_first !== undefined) {
      if (dto.base_price_first === null) {
        if (typeof (template as any).set === 'function') {
          (template as any).set('base_price_first', undefined);
        }
        (template as any).base_price_first = undefined;
      } else {
        template.base_price_first = dto.base_price_first;
      }
    }
    if (dto.is_active !== undefined) {
      template.is_active = dto.is_active;
    }

    await template.save();
    return template;
  }

  /**
   * Toggle template active status
   */
  async setTemplateStatus(id: string, isActive: boolean): Promise<ScheduleTemplateDocument> {
    return this.updateCommercialTemplate(id, { is_active: isActive });
  }

  /**
   * Materialize concrete dated Flights for a template
   */
  async materializeTemplate(
    id: string,
    daysAhead = 30,
    startDateStr?: string,
  ): Promise<GenerationStats> {
    const template = await this.templateModel
      .findOne({
        $or: [{ _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, { template_id: id }],
      })
      .exec();

    if (!template) {
      throw new NotFoundException(`Commercial ScheduleTemplate not found with identifier: "${id}"`);
    }

    // Defect 10: Reject non-AIRLABS templates and inactive templates
    if (template.source_type !== 'AIRLABS') {
      throw new BadRequestException(
        `Template "${id}" is not an AirLabs commercial template (source_type !== 'AIRLABS')`,
      );
    }
    if (!template.is_active) {
      throw new BadRequestException(
        `Cannot materialize inactive commercial template: "${template.template_id}"`,
      );
    }

    return this.flightGeneratorService.generateForTemplate(template, startDateStr, daysAhead);
  }

  /**
   * Authoritative commercial aircraft layout metadata derived from FLEET_LAYOUT_CATALOG.
   * Exposes physical capacities and supported cabins without internal row definitions.
   */
  getCommercialAircraftLayouts(): Array<{
    aircraft_type: string;
    model_name: string;
    total_capacity: number;
    cabin_capacities: Record<string, number>;
    supported_cabins: string[];
  }> {
    return Object.values(FLEET_LAYOUT_CATALOG).map((layout) => ({
      aircraft_type: layout.aircraft_type,
      model_name: layout.model_name,
      total_capacity: layout.total_capacity,
      cabin_capacities: layout.cabin_capacities,
      supported_cabins: Object.keys(layout.cabin_capacities),
    }));
  }
}
