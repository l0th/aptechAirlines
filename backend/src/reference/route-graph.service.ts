import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RouteRef,
  RouteRefDocument,
  RouteSyncState,
  RouteSyncStateDocument,
  RouteSource,
} from './reference.schema';

export type RouteType = 'DIRECT' | 'ONE_STOP' | 'TWO_STOP';

export interface RouteGraphServiceCandidate {
  source_key: string;
  airline_iata: string;
  airline_icao?: string;
  flight_number?: string;
  flight_iata?: string;
  flight_icao?: string;
  cs_airline_iata?: string;
  cs_flight_iata?: string;
  cs_flight_number?: string;
  dep_iata: string;
  dep_icao?: string;
  dep_time?: string;
  dep_time_utc?: string;
  dep_terminals?: string[];
  arr_iata: string;
  arr_icao?: string;
  arr_time?: string;
  arr_time_utc?: string;
  arr_terminals?: string[];
  duration?: number;
  days?: string[];
  aircraft_icao?: string;
  has_schedule: boolean;
  source: string;
  synced_at?: Date;
  airlabs_updated?: string;
  sync_generation?: string;
}

export interface RouteGraphLeg {
  dep_iata: string;
  arr_iata: string;
  services: RouteGraphServiceCandidate[];
}

export interface RouteGraphPath {
  route_type: RouteType;
  airports: string[];
  stops: string[];
  legs: RouteGraphLeg[];
}

export interface RouteGraphCoverage {
  complete: boolean;
  expanded_airports: string[];
  incomplete_airports: string[];
  missing_sync_state_airports: string[];
}

export interface RouteGraphResult {
  paths: RouteGraphPath[];
  coverage: RouteGraphCoverage;
}

export interface FindPathsOptions {
  maxStops?: number; // default 2, clamped [0, 2]
  source?: string; // default 'airlabs'
}

@Injectable()
export class RouteGraphService {
  constructor(
    @InjectModel(RouteRef.name) private routeRefModel: Model<RouteRefDocument>,
    @InjectModel(RouteSyncState.name) private routeSyncStateModel: Model<RouteSyncStateDocument>,
  ) {}

  /**
   * Enumerate all simple acyclic route paths from origin to destination airports
   * up to maxStops (default 2, max 2).
   * Operates purely on authoritative cached RouteRef documents for the declared provider source (default 'airlabs').
   */
  async findPaths(
    originIatas: string[],
    destinationIatas: string[],
    options?: FindPathsOptions,
  ): Promise<RouteGraphResult> {
    const rawMaxStops = options?.maxStops !== undefined ? options.maxStops : 2;
    const maxStops = Math.max(0, Math.min(2, Math.floor(rawMaxStops)));
    const providerSource =
      options?.source?.trim().toLowerCase() || 'airlabs';

    const cleanOrigins = Array.from(
      new Set((originIatas || []).map(s => s?.trim().toUpperCase()).filter(Boolean)),
    );
    const cleanDestinations = new Set(
      (destinationIatas || []).map(s => s?.trim().toUpperCase()).filter(Boolean),
    );

    const expandedAirports = new Set<string>();

    if (cleanOrigins.length === 0 || cleanDestinations.size === 0) {
      return {
        paths: [],
        coverage: {
          complete: false,
          expanded_airports: [],
          incomplete_airports: [],
          missing_sync_state_airports: [],
        },
      };
    }

    const validSourceKeyFilter = {
      source_key: { $exists: true, $type: 'string', $ne: '' },
    };

    // Frontier depth 0: outgoing edges from all clean origins (1 bulk query)
    cleanOrigins.forEach(o => expandedAirports.add(o));
    const depth0Routes = await this.routeRefModel
      .find({
        dep_iata: { $in: cleanOrigins },
        source: providerSource,
        ...validSourceKeyFilter,
      })
      .lean()
      .exec();

    // Identify unique transit candidates for Depth 1
    const t1Candidates = new Set<string>();
    for (const r of depth0Routes) {
      const arr = r.arr_iata?.trim().toUpperCase();
      if (arr && !cleanDestinations.has(arr) && !expandedAirports.has(arr)) {
        t1Candidates.add(arr);
      }
    }

    // Frontier depth 1: outgoing edges from T1 candidates (1 bulk query, if maxStops >= 1)
    let depth1Routes: any[] = [];
    if (maxStops >= 1 && t1Candidates.size > 0) {
      t1Candidates.forEach(t => expandedAirports.add(t));
      depth1Routes = await this.routeRefModel
        .find({
          dep_iata: { $in: Array.from(t1Candidates) },
          source: providerSource,
          ...validSourceKeyFilter,
        })
        .lean()
        .exec();
    }

    // Identify unique transit candidates for Depth 2
    const t2Candidates = new Set<string>();
    if (maxStops >= 2 && depth1Routes.length > 0) {
      for (const r of depth1Routes) {
        const arr = r.arr_iata?.trim().toUpperCase();
        if (arr && !cleanDestinations.has(arr) && !expandedAirports.has(arr)) {
          t2Candidates.add(arr);
        }
      }
    }

    // Frontier depth 2: outgoing edges from T2 candidates (1 bulk query, if maxStops >= 2)
    let depth2Routes: any[] = [];
    if (maxStops >= 2 && t2Candidates.size > 0) {
      t2Candidates.forEach(t => expandedAirports.add(t));
      depth2Routes = await this.routeRefModel
        .find({
          dep_iata: { $in: Array.from(t2Candidates) },
          source: providerSource,
          ...validSourceKeyFilter,
        })
        .lean()
        .exec();
    }

    // Combine all retrieved RouteRef records
    const allRoutes = [...depth0Routes, ...depth1Routes, ...depth2Routes];

    // Build directed multi-service edge map
    // Key: "DEP>ARR"
    const edgeMap = new Map<string, RouteGraphLeg>();
    const adjacency = new Map<string, Set<string>>();

    for (const r of allRoutes) {
      const dep = r.dep_iata?.trim().toUpperCase();
      const arr = r.arr_iata?.trim().toUpperCase();
      const sourceKey = typeof r.source_key === 'string' ? r.source_key.trim() : '';
      if (!dep || !arr || !sourceKey) continue;

      const edgeKey = `${dep}>${arr}`;
      if (!adjacency.has(dep)) {
        adjacency.set(dep, new Set<string>());
      }
      adjacency.get(dep)!.add(arr);

      const candidate: RouteGraphServiceCandidate = {
        source_key: sourceKey,
        airline_iata: r.airline_iata,
        airline_icao: r.airline_icao,
        flight_number: r.flight_number,
        flight_iata: r.flight_iata,
        flight_icao: r.flight_icao,
        cs_airline_iata: r.cs_airline_iata,
        cs_flight_iata: r.cs_flight_iata,
        cs_flight_number: r.cs_flight_number,
        dep_iata: dep,
        dep_icao: r.dep_icao,
        dep_time: r.dep_time,
        dep_time_utc: r.dep_time_utc,
        dep_terminals: r.dep_terminals,
        arr_iata: arr,
        arr_icao: r.arr_icao,
        arr_time: r.arr_time,
        arr_time_utc: r.arr_time_utc,
        arr_terminals: r.arr_terminals,
        duration: r.duration,
        days: r.days,
        aircraft_icao: r.aircraft_icao,
        has_schedule: Boolean(r.has_schedule),
        source: r.source || 'airlabs',
        synced_at: r.synced_at,
        airlabs_updated: r.airlabs_updated,
        sync_generation: r.sync_generation,
      };

      const existingLeg = edgeMap.get(edgeKey);
      if (!existingLeg) {
        edgeMap.set(edgeKey, {
          dep_iata: dep,
          arr_iata: arr,
          services: [candidate],
        });
      } else {
        if (!existingLeg.services.some(s => s.source_key === candidate.source_key)) {
          existingLeg.services.push(candidate);
        }
      }
    }

    // Sort services in each leg deterministically by source_key ascending
    for (const leg of edgeMap.values()) {
      leg.services.sort((a, b) => a.source_key.localeCompare(b.source_key));
    }

    // Construct simple acyclic paths
    const pathsMap = new Map<string, RouteGraphPath>();

    const addPath = (routeType: RouteType, airports: string[], stops: string[]) => {
      const pathId = airports.join('>');
      if (pathsMap.has(pathId)) return;

      const legs: RouteGraphLeg[] = [];
      for (let i = 0; i < airports.length - 1; i++) {
        const edge = edgeMap.get(`${airports[i]}>${airports[i + 1]}`);
        if (!edge) return; // Incomplete edge
        legs.push(edge);
      }

      pathsMap.set(pathId, {
        route_type: routeType,
        airports,
        stops,
        legs,
      });
    };

    // 1. Direct paths (0 stops): O -> D
    for (const o of cleanOrigins) {
      const nextHops = adjacency.get(o);
      if (!nextHops) continue;
      for (const d of nextHops) {
        if (cleanDestinations.has(d) && d !== o) {
          addPath('DIRECT', [o, d], []);
        }
      }
    }

    // 2. One-stop paths (1 stop): O -> T1 -> D
    if (maxStops >= 1) {
      for (const o of cleanOrigins) {
        const t1Set = adjacency.get(o);
        if (!t1Set) continue;
        for (const t1 of t1Set) {
          if (t1 === o || cleanDestinations.has(t1)) continue;
          const destSet = adjacency.get(t1);
          if (!destSet) continue;
          for (const d of destSet) {
            if (cleanDestinations.has(d) && d !== o && d !== t1) {
              addPath('ONE_STOP', [o, t1, d], [t1]);
            }
          }
        }
      }
    }

    // 3. Two-stop paths (2 stops): O -> T1 -> T2 -> D
    if (maxStops >= 2) {
      for (const o of cleanOrigins) {
        const t1Set = adjacency.get(o);
        if (!t1Set) continue;
        for (const t1 of t1Set) {
          if (t1 === o || cleanDestinations.has(t1)) continue;
          const t2Set = adjacency.get(t1);
          if (!t2Set) continue;
          for (const t2 of t2Set) {
            if (t2 === o || t2 === t1 || cleanDestinations.has(t2)) continue;
            const destSet = adjacency.get(t2);
            if (!destSet) continue;
            for (const d of destSet) {
              if (cleanDestinations.has(d) && d !== o && d !== t1 && d !== t2) {
                addPath('TWO_STOP', [o, t1, t2, d], [t1, t2]);
              }
            }
          }
        }
      }
    }

    // Deterministic sorting of paths:
    // 1. Number of legs ascending (DIRECT < ONE_STOP < TWO_STOP)
    // 2. Airport sequence lexical order
    const sortedPaths = Array.from(pathsMap.values()).sort((a, b) => {
      if (a.legs.length !== b.legs.length) {
        return a.legs.length - b.legs.length;
      }
      return a.airports.join('>').localeCompare(b.airports.join('>'));
    });

    // Coverage calculation: query RouteSyncState for all expanded airports in 1 bulk query
    const expandedList = Array.from(expandedAirports).sort();
    const syncStates = await this.routeSyncStateModel
      .find({ dep_iata: { $in: expandedList }, source: providerSource })
      .lean()
      .exec();

    const syncStateMap = new Map<string, any>(
      syncStates.map(s => [s.dep_iata.toUpperCase(), s]),
    );

    const incompleteAirports: string[] = [];
    const missingSyncStateAirports: string[] = [];

    for (const apt of expandedList) {
      const s = syncStateMap.get(apt);
      if (!s) {
        missingSyncStateAirports.push(apt);
      } else if (!s.complete || s.truncated) {
        incompleteAirports.push(apt);
      }
    }

    incompleteAirports.sort();
    missingSyncStateAirports.sort();

    const isCoverageComplete =
      expandedList.length > 0 &&
      missingSyncStateAirports.length === 0 &&
      incompleteAirports.length === 0;

    return {
      paths: sortedPaths,
      coverage: {
        complete: isCoverageComplete,
        expanded_airports: expandedList,
        incomplete_airports: incompleteAirports,
        missing_sync_state_airports: missingSyncStateAirports,
      },
    };
  }
}
