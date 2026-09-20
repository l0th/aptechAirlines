import { BadRequestException } from '@nestjs/common';
import { CabinClass } from '../flights/flights.schema';

export interface PhysicalSeatDef {
  seat_code: string; // e.g. '1A', '12F'
  row_number: number;
  column_letter: string;
  cabin_class: CabinClass;
  is_exit_row: boolean;
  is_extra_legroom: boolean;
  position: 'WINDOW' | 'AISLE' | 'MIDDLE';
  is_bulkhead?: boolean;
  is_front_zone?: boolean;
}

export interface AircraftRowConfig {
  row_number: number;
  cabin_class: CabinClass;
  is_exit_row?: boolean;
  is_extra_legroom?: boolean;
  is_bulkhead?: boolean;
  is_front_zone?: boolean;
  // Aisle-separated column groups, e.g. [['A', 'C'], ['D', 'F']]
  column_groups: string[][];
  // Column letter to position override (if not standard)
  position_map?: Record<string, 'WINDOW' | 'AISLE' | 'MIDDLE'>;
}

export interface AircraftLayoutDef {
  aircraft_type: string; // e.g. 'A20N', 'A21N', 'B789', 'A359', 'B738', 'AT76'
  model_name: string;
  total_capacity: number;
  cabin_capacities: Record<string, number>;
  rows: AircraftRowConfig[];
}

/**
 * Helper to determine default seat position (WINDOW, AISLE, MIDDLE) for standard groupings.
 */
function resolvePosition(col: string, group: string[], groupIndex: number, totalGroups: number): 'WINDOW' | 'AISLE' | 'MIDDLE' {
  const isFirstGroup = groupIndex === 0;
  const isLastGroup = groupIndex === totalGroups - 1;
  const colIndex = group.indexOf(col);

  // Left-most seat of first group or right-most seat of last group = WINDOW
  if ((isFirstGroup && colIndex === 0) || (isLastGroup && colIndex === group.length - 1)) {
    return 'WINDOW';
  }

  // Edge facing aisle in each group = AISLE
  if (
    (!isFirstGroup && colIndex === 0) ||
    (!isLastGroup && colIndex === group.length - 1) ||
    (isFirstGroup && colIndex === group.length - 1 && group.length > 1) ||
    (isLastGroup && colIndex === 0 && group.length > 1)
  ) {
    return 'AISLE';
  }

  return 'MIDDLE';
}

// -----------------------------------------------------------------------------
// 1. A20N - Airbus A320neo (180 seats: 12 Business, 168 Economy)
// -----------------------------------------------------------------------------
function buildA20NRows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Business: Rows 1-3 (2-2) = 12 seats
  for (let r = 1; r <= 3; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.BUSINESS,
      is_extra_legroom: true,
      column_groups: [['A', 'C'], ['D', 'F']],
    });
  }
  // Economy: Rows 4-32 excl row 13 = 28 physical rows (3-3) = 168 seats
  for (let r = 4; r <= 32; r++) {
    if (r === 13) continue; // standard airline skipped row 13
    const isExit = r === 12 || r === 14;
    const isExtra = r === 4 || isExit;
    rows.push({
      row_number: r,
      cabin_class: CabinClass.ECONOMY,
      is_exit_row: isExit,
      is_extra_legroom: isExtra,
      column_groups: [['A', 'B', 'C'], ['D', 'E', 'F']],
    });
  }
  return rows;
}

// -----------------------------------------------------------------------------
// 2. A21N - Airbus A321neo (204 seats: 16 Business, 188 Economy)
// -----------------------------------------------------------------------------
function buildA21NRows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Business: Rows 1-4 (2-2) = 16 seats
  for (let r = 1; r <= 4; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.BUSINESS,
      is_extra_legroom: true,
      column_groups: [['A', 'C'], ['D', 'F']],
    });
  }
  // Economy: Rows 5-37 excl 13 = 32 physical rows
  // Rows 27 & 35: 4 seats each (A, C | D, F) = 8 seats
  // Remaining 30 rows: 6 seats each (A, B, C | D, E, F) = 180 seats
  // Total Economy = 188 seats.
  for (let r = 5; r <= 37; r++) {
    if (r === 13) continue;
    if (r === 27 || r === 35) {
      rows.push({
        row_number: r,
        cabin_class: CabinClass.ECONOMY,
        is_exit_row: true,
        is_extra_legroom: true,
        column_groups: [['A', 'C'], ['D', 'F']],
      });
    } else {
      const isExit = r === 12 || r === 26;
      const isExtra = r === 5 || isExit;
      rows.push({
        row_number: r,
        cabin_class: CabinClass.ECONOMY,
        is_exit_row: isExit,
        is_extra_legroom: isExtra,
        column_groups: [['A', 'B', 'C'], ['D', 'E', 'F']],
      });
    }
  }
  return rows;
}

// -----------------------------------------------------------------------------
// 3. B789 - Boeing 787-9 Dreamliner (294 seats: 28 Business, 35 Club, 231 Economy)
// -----------------------------------------------------------------------------
function buildB789Rows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Business: Rows 1-7 (1-2-1) = 28 seats
  for (let r = 1; r <= 7; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.BUSINESS,
      is_extra_legroom: true,
      column_groups: [['A'], ['D', 'G'], ['K']],
    });
  }
  // Club / Premium Economy: Rows 10-14 (2-3-2) = 35 seats
  for (let r = 10; r <= 14; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.CLUB,
      is_extra_legroom: true,
      column_groups: [['A', 'C'], ['D', 'F', 'G'], ['H', 'K']],
    });
  }
  // Economy: Rows 16-40 (25 rows of 3-3-3 = 225 seats) + Row 41 (6 seats) = 231 seats
  for (let r = 16; r <= 40; r++) {
    const isExit = r === 16 || r === 30;
    const isExtra = isExit;
    rows.push({
      row_number: r,
      cabin_class: CabinClass.ECONOMY,
      is_exit_row: isExit,
      is_extra_legroom: isExtra,
      column_groups: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'K']],
    });
  }
  // Row 41 taper: 6 seats (D, E, F | G, H, K)
  rows.push({
    row_number: 41,
    cabin_class: CabinClass.ECONOMY,
    column_groups: [['D', 'E', 'F'], ['G', 'H', 'K']],
  });
  return rows;
}

// -----------------------------------------------------------------------------
// 4. A359 - Airbus A350-900 (305 seats: 29 Business, 36 Club, 240 Economy)
// -----------------------------------------------------------------------------
function buildA359Rows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Business: Rows 1-7 (1-2-1 = 28 seats) + Row 8 (1 seat: 8D center console) = 29 seats
  for (let r = 1; r <= 7; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.BUSINESS,
      is_extra_legroom: true,
      column_groups: [['A'], ['D', 'G'], ['K']],
    });
  }
  rows.push({
    row_number: 8,
    cabin_class: CabinClass.BUSINESS,
    is_extra_legroom: true,
    column_groups: [['D']],
  });

  // Club / Premium Economy: Rows 10-13 (2-4-2 = 32 seats) + Row 14 center block (4 seats: D, E, F, G) = 36 seats
  for (let r = 10; r <= 13; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.CLUB,
      is_extra_legroom: true,
      column_groups: [['A', 'C'], ['D', 'E', 'F', 'G'], ['H', 'K']],
    });
  }
  rows.push({
    row_number: 14,
    cabin_class: CabinClass.CLUB,
    is_extra_legroom: true,
    column_groups: [['D', 'E', 'F', 'G']],
  });

  // Economy: Rows 16-41 (26 rows of 3-3-3 = 234 seats) + Row 42 (6 seats: D, E, F | G, H, K) = 240 seats
  for (let r = 16; r <= 41; r++) {
    const isExit = r === 16 || r === 31;
    const isExtra = isExit;
    rows.push({
      row_number: r,
      cabin_class: CabinClass.ECONOMY,
      is_exit_row: isExit,
      is_extra_legroom: isExtra,
      column_groups: [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'K']],
    });
  }
  // Row 42 taper: 6 seats (D, E, F | G, H, K)
  rows.push({
    row_number: 42,
    cabin_class: CabinClass.ECONOMY,
    column_groups: [['D', 'E', 'F'], ['G', 'H', 'K']],
  });
  return rows;
}

// -----------------------------------------------------------------------------
// 5. B738 - Boeing 737-800 (166 seats: 16 Business, 150 Economy)
// -----------------------------------------------------------------------------
function buildB738Rows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Business: Rows 1-4 (2-2) = 16 seats
  for (let r = 1; r <= 4; r++) {
    rows.push({
      row_number: r,
      cabin_class: CabinClass.BUSINESS,
      is_extra_legroom: true,
      column_groups: [['A', 'C'], ['D', 'F']],
    });
  }
  // Economy: Rows 5-30 excl row 13 = 25 rows (3-3) = 150 seats
  for (let r = 5; r <= 30; r++) {
    if (r === 13) continue;
    const isExit = r === 14 || r === 15;
    const isExtra = r === 5 || isExit;
    rows.push({
      row_number: r,
      cabin_class: CabinClass.ECONOMY,
      is_exit_row: isExit,
      is_extra_legroom: isExtra,
      column_groups: [['A', 'B', 'C'], ['D', 'E', 'F']],
    });
  }
  return rows;
}

// -----------------------------------------------------------------------------
// 6. AT76 - ATR 72-600 (68 seats: 68 Economy)
// -----------------------------------------------------------------------------
function buildAT76Rows(): AircraftRowConfig[] {
  const rows: AircraftRowConfig[] = [];
  // Economy: Rows 1-17 (2-2) = 68 seats
  for (let r = 1; r <= 17; r++) {
    const isExit = r === 1;
    const isExtra = isExit;
    rows.push({
      row_number: r,
      cabin_class: CabinClass.ECONOMY,
      is_exit_row: isExit,
      is_extra_legroom: isExtra,
      column_groups: [['A', 'C'], ['D', 'F']],
    });
  }
  return rows;
}

// -----------------------------------------------------------------------------
// Fleet Catalog Registry
// -----------------------------------------------------------------------------
export const FLEET_LAYOUT_CATALOG: Record<string, AircraftLayoutDef> = {
  A20N: {
    aircraft_type: 'A20N',
    model_name: 'Airbus A320neo',
    total_capacity: 180,
    cabin_capacities: {
      [CabinClass.BUSINESS]: 12,
      [CabinClass.ECONOMY]: 168,
    },
    rows: buildA20NRows(),
  },
  A21N: {
    aircraft_type: 'A21N',
    model_name: 'Airbus A321neo',
    total_capacity: 204,
    cabin_capacities: {
      [CabinClass.BUSINESS]: 16,
      [CabinClass.ECONOMY]: 188,
    },
    rows: buildA21NRows(),
  },
  B789: {
    aircraft_type: 'B789',
    model_name: 'Boeing 787-9 Dreamliner',
    total_capacity: 294,
    cabin_capacities: {
      [CabinClass.BUSINESS]: 28,
      [CabinClass.CLUB]: 35,
      [CabinClass.ECONOMY]: 231,
    },
    rows: buildB789Rows(),
  },
  A359: {
    aircraft_type: 'A359',
    model_name: 'Airbus A350-900',
    total_capacity: 305,
    cabin_capacities: {
      [CabinClass.BUSINESS]: 29,
      [CabinClass.CLUB]: 36,
      [CabinClass.ECONOMY]: 240,
    },
    rows: buildA359Rows(),
  },
  B738: {
    aircraft_type: 'B738',
    model_name: 'Boeing 737-800',
    total_capacity: 166,
    cabin_capacities: {
      [CabinClass.BUSINESS]: 16,
      [CabinClass.ECONOMY]: 150,
    },
    rows: buildB738Rows(),
  },
  AT76: {
    aircraft_type: 'AT76',
    model_name: 'ATR 72-600',
    total_capacity: 68,
    cabin_capacities: {
      [CabinClass.ECONOMY]: 68,
    },
    rows: buildAT76Rows(),
  },
};

/**
 * Retrieves the layout definition for a given aircraft type.
 * Throws BadRequestException if the aircraft type is unknown (ZERO universal A321 fallback).
 */
export function getAircraftLayout(aircraftType: string): AircraftLayoutDef {
  const normalized = (aircraftType || '').trim().toUpperCase();
  const layout = FLEET_LAYOUT_CATALOG[normalized];
  if (!layout) {
    throw new BadRequestException(
      `Unsupported or unknown aircraft type '${aircraftType}'. Must be one of: ${Object.keys(FLEET_LAYOUT_CATALOG).join(', ')}.`,
    );
  }
  return layout;
}

/**
 * Generates the full flat list of PhysicalSeatDef objects for an aircraft type.
 */
export function generatePhysicalSeats(aircraftType: string): PhysicalSeatDef[] {
  const layout = getAircraftLayout(aircraftType);
  const seats: PhysicalSeatDef[] = [];

  const firstEcoRow = layout.rows.find((r) => r.cabin_class === CabinClass.ECONOMY)?.row_number ?? 5;

  for (const row of layout.rows) {
    const firstRowOfCabin = layout.rows.find((r) => r.cabin_class === row.cabin_class)?.row_number;
    const isBulkhead = row.is_bulkhead ?? (row.row_number === firstRowOfCabin);
    const isFrontZone = row.is_front_zone ?? (row.cabin_class === CabinClass.ECONOMY && row.row_number <= (firstEcoRow + 4));

    const totalGroups = row.column_groups.length;
    for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
      const group = row.column_groups[gIdx];
      for (const col of group) {
        const position = row.position_map?.[col] ?? resolvePosition(col, group, gIdx, totalGroups);
        seats.push({
          seat_code: `${row.row_number}${col}`,
          row_number: row.row_number,
          column_letter: col,
          cabin_class: row.cabin_class,
          is_exit_row: row.is_exit_row ?? false,
          is_extra_legroom: row.is_extra_legroom ?? false,
          position,
          is_bulkhead: isBulkhead,
          is_front_zone: isFrontZone,
        });
      }
    }
  }

  return seats;
}
