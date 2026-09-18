import { BadRequestException, Injectable } from '@nestjs/common';
import {
  RouteGraphCoverage,
  RouteGraphPath,
  RouteGraphResult,
  RouteGraphServiceCandidate,
  RouteType,
} from './route-graph.service';

export interface ValidatedItineraryLeg {
  flight_number?: string;
  airline_iata: string;
  airline_icao?: string;
  flight_iata?: string;
  flight_icao?: string;
  dep_iata: string;
  arr_iata: string;
  dep_datetime: Date;
  arr_datetime: Date;
  dep_time_local?: string;
  arr_time_local?: string;
  dep_time_utc?: string;
  arr_time_utc?: string;
  duration_minutes: number;
  source_key: string;
  cs_airline_iata?: string;
  cs_flight_iata?: string;
  cs_flight_number?: string;
  aircraft_icao?: string;
  days?: string[];
  chronology_basis?: 'UTC' | 'LOCAL';
}

export interface ValidatedItinerary {
  route_type: RouteType;
  airports: string[];
  stops: string[];
  total_duration_minutes: number;
  layover_minutes: number[];
  legs: ValidatedItineraryLeg[];
}

export interface ScheduleValidationOptions {
  minLayoverMinutes?: number; // default: 45
  maxLayoverMinutes?: number; // default: 720 (12 hours)
}

export interface ScheduleValidationResult {
  itineraries: ValidatedItinerary[];
  coverage: RouteGraphCoverage;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

@Injectable()
export class RouteScheduleValidatorService {
  /**
   * Validate abstract route graph paths against a concrete departure date,
   * checking operating days, overnight rollovers, and layovers (45m - 720m).
   */
  validatePaths(
    graphResult: RouteGraphResult,
    departureDate: string | Date,
    options?: ScheduleValidationOptions,
  ): ScheduleValidationResult {
    const minLayover = options?.minLayoverMinutes ?? 45;
    const maxLayover = options?.maxLayoverMinutes ?? 720;

    const baseDate = this.parseDate(departureDate);

    const validItineraries: ValidatedItinerary[] = [];

    for (const path of graphResult.paths) {
      const materialized = this.materializePath(path, baseDate, minLayover, maxLayover);
      validItineraries.push(...materialized);
    }

    // Deterministic sorting:
    // 1. Total duration ascending
    // 2. Departure datetime ascending
    // 3. First leg flight number / source_key lexical
    validItineraries.sort((a, b) => {
      if (a.total_duration_minutes !== b.total_duration_minutes) {
        return a.total_duration_minutes - b.total_duration_minutes;
      }
      const depDiff = a.legs[0].dep_datetime.getTime() - b.legs[0].dep_datetime.getTime();
      if (depDiff !== 0) return depDiff;
      const keyA = a.legs.map(l => l.source_key).join('>');
      const keyB = b.legs.map(l => l.source_key).join('>');
      return keyA.localeCompare(keyB);
    });

    return {
      itineraries: validItineraries,
      coverage: graphResult.coverage,
    };
  }

  private parseDate(d: string | Date): Date {
    if (d instanceof Date) {
      if (isNaN(d.getTime())) {
        throw new BadRequestException('Invalid departure date: NaN Date');
      }
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
    }

    if (typeof d === 'string') {
      const trimmed = d.trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
      if (!match) {
        throw new BadRequestException(`Invalid departure date format: "${d}". Expected YYYY-MM-DD.`);
      }
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new BadRequestException(`Invalid departure calendar date: "${d}".`);
      }
      const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      if (isNaN(date.getTime()) || date.getUTCDate() !== day) {
        throw new BadRequestException(`Invalid departure calendar date: "${d}".`);
      }
      return date;
    }

    throw new BadRequestException('Invalid departure date provided.');
  }

  private materializePath(
    path: RouteGraphPath,
    startDate: Date,
    minLayover: number,
    maxLayover: number,
  ): ValidatedItinerary[] {
    if (!path.legs || path.legs.length === 0) return [];

    // Recursively build valid leg sequences across the path legs
    const partials: Array<{
      legs: ValidatedItineraryLeg[];
      layovers: number[];
    }> = [];

    this.buildLegCombinations(
      path.legs,
      0,
      startDate,
      null,
      [],
      [],
      minLayover,
      maxLayover,
      partials,
    );

    return partials.map(p => {
      const totalDuration =
        Math.round((p.legs[p.legs.length - 1].arr_datetime.getTime() - p.legs[0].dep_datetime.getTime()) / 60000);

      return {
        route_type: path.route_type,
        airports: path.airports,
        stops: path.stops,
        total_duration_minutes: totalDuration,
        layover_minutes: p.layovers,
        legs: p.legs,
      };
    });
  }

  private buildLegCombinations(
    legs: RouteGraphPath['legs'],
    legIndex: number,
    candidateDepDate: Date,
    prevArrDateTime: Date | null,
    currentLegs: ValidatedItineraryLeg[],
    currentLayovers: number[],
    minLayover: number,
    maxLayover: number,
    results: Array<{ legs: ValidatedItineraryLeg[]; layovers: number[] }>,
  ): void {
    if (legIndex >= legs.length) {
      results.push({
        legs: [...currentLegs],
        layovers: [...currentLayovers],
      });
      return;
    }

    const legDef = legs[legIndex];

    for (const service of legDef.services) {
      // Must have valid departure time
      const timeStr = service.dep_time_utc || service.dep_time;
      if (!timeStr) {
        // Coarse edge without time cannot form concrete schedule
        continue;
      }

      // Check potential departure candidates for this service:
      // If it's the first leg (legIndex === 0), it departs on candidateDepDate.
      // If it's a connecting leg, it could depart on the same day as prev arrival or the next day.
      const candidateDates: Date[] = [];

      if (legIndex === 0) {
        candidateDates.push(candidateDepDate);
      } else if (prevArrDateTime) {
        // UTC arrival can fall on a different date from the next leg's local
        // operating day. Try the small safe window and let chronology reject
        // impossible materializations.
        const arrDateUtc = new Date(Date.UTC(
          prevArrDateTime.getUTCFullYear(),
          prevArrDateTime.getUTCMonth(),
          prevArrDateTime.getUTCDate(),
          0, 0, 0,
        ));
        candidateDates.push(new Date(arrDateUtc.getTime() - 24 * 60 * 60 * 1000));
        candidateDates.push(arrDateUtc);
        candidateDates.push(new Date(arrDateUtc.getTime() + 24 * 60 * 60 * 1000));
      }

      for (const dateCandidate of candidateDates) {
        // Check operating days
        if (!this.operatesOnDate(service, dateCandidate)) {
          continue;
        }

        // Materialize concrete departure and arrival datetime
        const concreteLeg = this.materializeServiceTimes(service, dateCandidate);
        if (!concreteLeg) continue;

        // If connecting leg, check layover constraints
        if (prevArrDateTime) {
          const layoverMs = concreteLeg.dep_datetime.getTime() - prevArrDateTime.getTime();
          const layoverMinutes = Math.round(layoverMs / 60000);

          if (layoverMinutes < minLayover || layoverMinutes > maxLayover) {
            // Layover invalid
            continue;
          }

          // Valid connection!
          this.buildLegCombinations(
            legs,
            legIndex + 1,
            new Date(concreteLeg.arr_datetime.getTime()),
            concreteLeg.arr_datetime,
            [...currentLegs, concreteLeg],
            [...currentLayovers, layoverMinutes],
            minLayover,
            maxLayover,
            results,
          );
        } else {
          // First leg
          this.buildLegCombinations(
            legs,
            legIndex + 1,
            new Date(concreteLeg.arr_datetime.getTime()),
            concreteLeg.arr_datetime,
            [...currentLegs, concreteLeg],
            [...currentLayovers],
            minLayover,
            maxLayover,
            results,
          );
        }
      }
    }
  }

  private operatesOnDate(service: RouteGraphServiceCandidate, date: Date): boolean {
    if (!service.days || service.days.length === 0) {
      // No day restriction -> operates daily
      return true;
    }
    const weekday = WEEKDAYS[date.getUTCDay()];
    const normalizedDays = service.days.map(d => d.trim().toLowerCase());
    return normalizedDays.includes(weekday);
  }

  private materializeServiceTimes(
    service: RouteGraphServiceCandidate,
    depDate: Date,
  ): ValidatedItineraryLeg | null {
    const localDep = this.parseHoursMinutes(service.dep_time);
    const utcDep = this.parseHoursMinutes(service.dep_time_utc);
    if ((service.dep_time && !localDep) || (service.dep_time_utc && !utcDep)) return null;
    if (!localDep && !utcDep) return null;

    let depDatetime: Date;
    let chronologyBasis: 'UTC' | 'LOCAL';
    if (utcDep) {
      if (!localDep) return null;
      const timezoneOffset = this.inferUtcOffsetMinutes(localDep, utcDep);
      if (timezoneOffset === null) return null;
      const localMinutes = localDep[0] * 60 + localDep[1];
      depDatetime = new Date(depDate.getTime() + (localMinutes - timezoneOffset) * 60 * 1000);
      chronologyBasis = 'UTC';
    } else {
      const localMinutes = localDep![0] * 60 + localDep![1];
      depDatetime = new Date(depDate.getTime() + localMinutes * 60 * 1000);
      chronologyBasis = 'LOCAL';
    }

    let arrDatetime: Date;
    let durationMinutes: number;
    const localArr = this.parseHoursMinutes(service.arr_time);
    const utcArr = this.parseHoursMinutes(service.arr_time_utc);
    if ((service.arr_time && !localArr) || (service.arr_time_utc && !utcArr)) return null;

    if (chronologyBasis === 'UTC' && utcArr) {
      const arrivalMinutes = utcArr[0] * 60 + utcArr[1];
      const departureUtcDay = Date.UTC(
        depDatetime.getUTCFullYear(),
        depDatetime.getUTCMonth(),
        depDatetime.getUTCDate(),
      );
      const candidates = [0, 1, 2].map(
        (dayOffset) => new Date(departureUtcDay + dayOffset * 86400000 + arrivalMinutes * 60000),
      ).filter((candidate) => candidate.getTime() > depDatetime.getTime());
      if (candidates.length === 0) return null;
      if (typeof service.duration === 'number' && service.duration > 0) {
        candidates.sort((a, b) =>
          Math.abs((a.getTime() - depDatetime.getTime()) / 60000 - service.duration!) -
          Math.abs((b.getTime() - depDatetime.getTime()) / 60000 - service.duration!),
        );
      }
      arrDatetime = candidates[0];
      durationMinutes = Math.round((arrDatetime.getTime() - depDatetime.getTime()) / 60000);
    } else if (chronologyBasis === 'LOCAL' && localArr) {
      const depMinutes = localDep![0] * 60 + localDep![1];
      const arrivalMinutes = localArr[0] * 60 + localArr[1];
      const dayOffset = arrivalMinutes < depMinutes || (service.duration || 0) >= 1440 ? 1 : 0;
      arrDatetime = new Date(depDate.getTime() + dayOffset * 86400000 + arrivalMinutes * 60000);
      durationMinutes = Math.round((arrDatetime.getTime() - depDatetime.getTime()) / 60000);
    } else if (service.duration && service.duration > 0) {
      durationMinutes = service.duration;
      arrDatetime = new Date(depDatetime.getTime() + durationMinutes * 60 * 1000);
    } else {
      // Neither arrival time nor duration available
      return null;
    }

    return {
      flight_number: service.flight_number,
      airline_iata: service.airline_iata,
      airline_icao: service.airline_icao,
      flight_iata: service.flight_iata,
      flight_icao: service.flight_icao,
      dep_iata: service.dep_iata,
      arr_iata: service.arr_iata,
      dep_datetime: depDatetime,
      arr_datetime: arrDatetime,
      dep_time_local: service.dep_time,
      arr_time_local: service.arr_time,
      dep_time_utc: service.dep_time_utc,
      arr_time_utc: service.arr_time_utc,
      duration_minutes: durationMinutes,
      source_key: service.source_key,
      cs_airline_iata: service.cs_airline_iata,
      cs_flight_iata: service.cs_flight_iata,
      cs_flight_number: service.cs_flight_number,
      aircraft_icao: service.aircraft_icao,
      days: service.days,
      chronology_basis: chronologyBasis,
    };
  }

  private parseHoursMinutes(timeStr?: string): [number, number] | null {
    if (!timeStr) return null;
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return [hours, minutes];
  }

  private inferUtcOffsetMinutes(local: [number, number], utc: [number, number]): number | null {
    const raw = local[0] * 60 + local[1] - (utc[0] * 60 + utc[1]);
    const candidates = [raw - 1440, raw, raw + 1440]
      .filter((offset) => offset >= -720 && offset <= 840);
    return candidates.length === 1 ? candidates[0] : null;
  }
}
