/**
 * Frontend port of backend/src/seat-allocation/fleet-layout.catalog.ts.
 * The /flights/commercial-aircraft-layouts endpoint only returns capacities, so the
 * row/column layout is mirrored here to draw a preview seat map. Keep in sync with backend.
 */
export type SeatPosition = 'WINDOW' | 'AISLE' | 'MIDDLE';
export interface PreviewSeat {
  seat_code: string; row_number: number; column_letter: string; cabin_class: string;
  position: SeatPosition; is_exit_row: boolean; is_extra_legroom: boolean; is_bulkhead: boolean; is_front_zone: boolean;
}
interface RowCfg { row_number: number; cabin_class: string; is_exit_row?: boolean; is_extra_legroom?: boolean; column_groups: string[][] }
export interface LayoutDef { aircraft_type: string; model_name: string; rows: RowCfg[] }

const G22 = [['A', 'C'], ['D', 'F']], G33 = [['A', 'B', 'C'], ['D', 'E', 'F']], G333 = [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'K']];
function range(a: number, b: number, skip13 = false) { const r: number[] = []; for (let i = a; i <= b; i++) if (!(skip13 && i === 13)) r.push(i); return r; }
const biz = (rows: number[], groups: string[][], cabin = 'BUSINESS'): RowCfg[] => rows.map(r => ({ row_number: r, cabin_class: cabin, is_extra_legroom: true, column_groups: groups }));
const eco = (rows: number[], groups: string[][], exits: number[], extras: number[] = []): RowCfg[] => rows.map(r => ({ row_number: r, cabin_class: 'ECONOMY', is_exit_row: exits.includes(r), is_extra_legroom: exits.includes(r) || extras.includes(r), column_groups: groups }));

export const FLEET_LAYOUTS: Record<string, LayoutDef> = {
  A20N: { aircraft_type: 'A20N', model_name: 'Airbus A320neo', rows: [...biz(range(1, 3), G22), ...eco(range(4, 32, true), G33, [12, 14], [4])] },
  A21N: { aircraft_type: 'A21N', model_name: 'Airbus A321neo', rows: [...biz(range(1, 4), G22),
    ...range(5, 37, true).map(r => (r === 27 || r === 35) ? { row_number: r, cabin_class: 'ECONOMY', is_exit_row: true, is_extra_legroom: true, column_groups: G22 } : eco([r], G33, [12, 26], [5])[0])] },
  B789: { aircraft_type: 'B789', model_name: 'Boeing 787-9 Dreamliner', rows: [...biz(range(1, 7), [['A'], ['D', 'G'], ['K']]), ...biz(range(10, 14), [['A', 'C'], ['D', 'F', 'G'], ['H', 'K']], 'CLUB'),
    ...eco(range(16, 40), G333, [16, 30]), { row_number: 41, cabin_class: 'ECONOMY', column_groups: [['D', 'E', 'F'], ['G', 'H', 'K']] }] },
  A359: { aircraft_type: 'A359', model_name: 'Airbus A350-900', rows: [...biz(range(1, 7), [['A'], ['D', 'G'], ['K']]), ...biz([8], [['D']]),
    ...biz(range(10, 13), [['A', 'C'], ['D', 'E', 'F', 'G'], ['H', 'K']], 'CLUB'), ...biz([14], [['D', 'E', 'F', 'G']], 'CLUB'),
    ...eco(range(16, 41), G333, [16, 31]), { row_number: 42, cabin_class: 'ECONOMY', column_groups: [['D', 'E', 'F'], ['G', 'H', 'K']] }] },
  B738: { aircraft_type: 'B738', model_name: 'Boeing 737-800', rows: [...biz(range(1, 4), G22), ...eco(range(5, 30, true), G33, [14, 15], [5])] },
  AT76: { aircraft_type: 'AT76', model_name: 'ATR 72-600', rows: eco(range(1, 17), G22, [1]) },
};

function resolvePosition(col: string, group: string[], gi: number, total: number): SeatPosition {
  const first = gi === 0, last = gi === total - 1, ci = group.indexOf(col);
  if ((first && ci === 0) || (last && ci === group.length - 1)) return 'WINDOW';
  if ((!first && ci === 0) || (!last && ci === group.length - 1) || (first && ci === group.length - 1 && group.length > 1) || (last && ci === 0 && group.length > 1)) return 'AISLE';
  return 'MIDDLE';
}

/** Same derivation as backend generatePhysicalSeats (bulkhead = first row of cabin; front zone = first 5 economy rows). */
export function previewSeats(aircraftType: string): PreviewSeat[] {
  const layout = FLEET_LAYOUTS[(aircraftType || '').toUpperCase()];
  if (!layout) return [];
  const firstEco = layout.rows.find(r => r.cabin_class === 'ECONOMY')?.row_number ?? 5;
  const seats: PreviewSeat[] = [];
  for (const row of layout.rows) {
    const firstOfCabin = layout.rows.find(r => r.cabin_class === row.cabin_class)?.row_number;
    const n = row.column_groups.length;
    row.column_groups.forEach((g, gi) => g.forEach(col => seats.push({
      seat_code: `${row.row_number}${col}`, row_number: row.row_number, column_letter: col, cabin_class: row.cabin_class,
      position: resolvePosition(col, g, gi, n), is_exit_row: !!row.is_exit_row, is_extra_legroom: !!row.is_extra_legroom,
      is_bulkhead: row.row_number === firstOfCabin, is_front_zone: row.cabin_class === 'ECONOMY' && row.row_number <= firstEco + 4,
    })));
  }
  return seats;
}

/** Dimensions applied to a seat, same order as backend SeatPricingService. */
export function seatDimensions(s: PreviewSeat): string[] {
  const d = ['CABIN_BASE', s.position];
  if (s.is_exit_row) d.push('EXIT_ROW');
  if (s.is_extra_legroom) d.push('EXTRA_LEGROOM');
  if (s.is_bulkhead) d.push('BULKHEAD');
  if (s.is_front_zone) d.push('FRONT_ZONE');
  return d;
}

/** Column letters across all rows, in order, with aisle markers ('|') between groups of the widest row. */
export function layoutColumns(aircraftType: string): string[] {
  const layout = FLEET_LAYOUTS[(aircraftType || '').toUpperCase()];
  if (!layout) return [];
  const widest = layout.rows.reduce((a, r) => r.column_groups.flat().length > a.column_groups.flat().length ? r : a, layout.rows[0]);
  const all = new Set(layout.rows.flatMap(r => r.column_groups.flat()));
  const cols: string[] = [];
  widest.column_groups.forEach((g, i) => { if (i) cols.push('|'); cols.push(...g); });
  // include letters that exist in other rows but not in the widest row (e.g. B789 business 'G'), keep alphabetical placement
  for (const c of [...all].sort()) if (!cols.includes(c)) { const idx = cols.findIndex(x => x !== '|' && x > c); cols.splice(idx < 0 ? cols.length : idx, 0, c); }
  return cols;
}
