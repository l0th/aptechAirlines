import {
  FLEET_LAYOUT_CATALOG,
  getAircraftLayout,
  generatePhysicalSeats,
} from './fleet-layout.catalog';
import { CabinClass } from '../flights/flights.schema';

describe('FleetLayoutCatalog - Mathematical Verification & Geometry Invariants', () => {
  const expectedTotals: Record<string, { total: number; cabins: Record<string, number> }> = {
    A20N: {
      total: 180,
      cabins: {
        [CabinClass.BUSINESS]: 12,
        [CabinClass.ECONOMY]: 168,
      },
    },
    A21N: {
      total: 204,
      cabins: {
        [CabinClass.BUSINESS]: 16,
        [CabinClass.ECONOMY]: 188,
      },
    },
    B789: {
      total: 294,
      cabins: {
        [CabinClass.BUSINESS]: 28,
        [CabinClass.CLUB]: 35,
        [CabinClass.ECONOMY]: 231,
      },
    },
    A359: {
      total: 305,
      cabins: {
        [CabinClass.BUSINESS]: 29,
        [CabinClass.CLUB]: 36,
        [CabinClass.ECONOMY]: 240,
      },
    },
    B738: {
      total: 166,
      cabins: {
        [CabinClass.BUSINESS]: 16,
        [CabinClass.ECONOMY]: 150,
      },
    },
    AT76: {
      total: 68,
      cabins: {
        [CabinClass.ECONOMY]: 68,
      },
    },
  };

  it('1. Throws BadRequestException for unknown aircraft (zero universal A321 fallback)', () => {
    expect(() => getAircraftLayout('UNKNOWN')).toThrow();
    expect(() => getAircraftLayout('')).toThrow();
    expect(() => getAircraftLayout('CONCORDE')).toThrow();
  });

  for (const [code, expected] of Object.entries(expectedTotals)) {
    describe(`Aircraft ${code}`, () => {
      it(`matches defined total capacity ${expected.total}`, () => {
        const layout = getAircraftLayout(code);
        expect(layout.total_capacity).toBe(expected.total);
      });

      it(`generated physical seats exactly equal ${expected.total}`, () => {
        const seats = generatePhysicalSeats(code);
        expect(seats.length).toBe(expected.total);

        // Verify uniqueness of seat codes
        const seatCodes = new Set(seats.map((s) => s.seat_code));
        expect(seatCodes.size).toBe(expected.total);

        // Verify cabin breakdown
        const cabinCounts: Record<string, number> = {};
        for (const seat of seats) {
          cabinCounts[seat.cabin_class] = (cabinCounts[seat.cabin_class] || 0) + 1;
        }

        for (const [cabin, count] of Object.entries(expected.cabins)) {
          expect(cabinCounts[cabin]).toBe(count);
        }
      });
    });
  }

  describe('Exact Aircraft Geometry & Reconciled Exit-Row Verification', () => {
    it('A20N: exact rows, column groups, exit rows 12 & 14, capacities 12 Business / 168 Economy', () => {
      const layout = getAircraftLayout('A20N');
      expect(layout.total_capacity).toBe(180);
      expect(layout.cabin_capacities[CabinClass.BUSINESS]).toBe(12);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(168);

      const businessRows = layout.rows.filter((r) => r.cabin_class === CabinClass.BUSINESS);
      expect(businessRows.map((r) => r.row_number)).toEqual([1, 2, 3]);
      businessRows.forEach((r) => {
        expect(r.column_groups).toEqual([['A', 'C'], ['D', 'F']]);
      });

      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([12, 14]);

      // Row 13 is skipped
      expect(layout.rows.some((r) => r.row_number === 13)).toBe(false);
    });

    it('A21N: reconciled geometry - exit rows are 12, 26, 27, 35; Row 11 is NOT exit; rows 27 & 35 have 4 seats', () => {
      const layout = getAircraftLayout('A21N');
      expect(layout.total_capacity).toBe(204);
      expect(layout.cabin_capacities[CabinClass.BUSINESS]).toBe(16);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(188);

      // Business: rows 1-4 (4 seats each)
      const businessRows = layout.rows.filter((r) => r.cabin_class === CabinClass.BUSINESS);
      expect(businessRows.map((r) => r.row_number)).toEqual([1, 2, 3, 4]);

      // Assert row 11 is NOT exit row
      const row11 = layout.rows.find((r) => r.row_number === 11);
      expect(row11).toBeDefined();
      expect(row11?.is_exit_row).toBeFalsy();

      // Exit rows are strictly 12, 26, 27, 35
      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([12, 26, 27, 35]);

      // Rows 27 & 35: exactly 4 physical seats (A, C | D, F)
      const seats = generatePhysicalSeats('A21N');
      const row27Seats = seats.filter((s) => s.row_number === 27);
      const row35Seats = seats.filter((s) => s.row_number === 35);
      expect(row27Seats.length).toBe(4);
      expect(row35Seats.length).toBe(4);
      expect(row27Seats.map((s) => s.column_letter)).toEqual(['A', 'C', 'D', 'F']);
      expect(row35Seats.map((s) => s.column_letter)).toEqual(['A', 'C', 'D', 'F']);
      expect(row27Seats.every((s) => s.is_exit_row)).toBe(true);
      expect(row35Seats.every((s) => s.is_exit_row)).toBe(true);

      // Standard Economy row has 6 seats
      const row12Seats = seats.filter((s) => s.row_number === 12);
      expect(row12Seats.length).toBe(6);
      expect(row12Seats.map((s) => s.column_letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });

    it('B789: exact widebody 1-2-1 Business (28), 2-3-2 Club (35), 3-3-3 Economy (231), exit rows 16 & 30, row 41 taper', () => {
      const layout = getAircraftLayout('B789');
      expect(layout.total_capacity).toBe(294);
      expect(layout.cabin_capacities[CabinClass.BUSINESS]).toBe(28);
      expect(layout.cabin_capacities[CabinClass.CLUB]).toBe(35);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(231);

      // Business: rows 1-7 (1-2-1)
      const businessRows = layout.rows.filter((r) => r.cabin_class === CabinClass.BUSINESS);
      expect(businessRows.map((r) => r.row_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      businessRows.forEach((r) => {
        expect(r.column_groups).toEqual([['A'], ['D', 'G'], ['K']]);
      });

      // Club: rows 10-14 (2-3-2)
      const clubRows = layout.rows.filter((r) => r.cabin_class === CabinClass.CLUB);
      expect(clubRows.map((r) => r.row_number)).toEqual([10, 11, 12, 13, 14]);
      clubRows.forEach((r) => {
        expect(r.column_groups).toEqual([['A', 'C'], ['D', 'F', 'G'], ['H', 'K']]);
      });

      // Economy exit rows
      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([16, 30]);

      // Row 41 taper has 6 seats
      const row41 = layout.rows.find((r) => r.row_number === 41);
      expect(row41).toBeDefined();
      expect(row41?.column_groups).toEqual([['D', 'E', 'F'], ['G', 'H', 'K']]);
    });

    it('A359: exact widebody 29 Business (including 8D), 36 Club (including Row 14 D-G), 240 Economy, exit rows 16 & 31, row 42 taper', () => {
      const layout = getAircraftLayout('A359');
      expect(layout.total_capacity).toBe(305);
      expect(layout.cabin_capacities[CabinClass.BUSINESS]).toBe(29);
      expect(layout.cabin_capacities[CabinClass.CLUB]).toBe(36);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(240);

      // Business: rows 1-7 (4 seats) + row 8 (1 seat 8D)
      const seats = generatePhysicalSeats('A359');
      const row8Seats = seats.filter((s) => s.row_number === 8);
      expect(row8Seats.length).toBe(1);
      expect(row8Seats[0].seat_code).toBe('8D');

      // Club: rows 10-13 (8 seats) + row 14 (4 seats 14D, 14E, 14F, 14G)
      const row14Seats = seats.filter((s) => s.row_number === 14);
      expect(row14Seats.length).toBe(4);
      expect(row14Seats.map((s) => s.seat_code)).toEqual(['14D', '14E', '14F', '14G']);

      // Exit rows
      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([16, 31]);

      // Row 42 taper has 6 seats
      const row42Seats = seats.filter((s) => s.row_number === 42);
      expect(row42Seats.length).toBe(6);
    });

    it('B738: exact narrowbody 16 Business (rows 1-4), 150 Economy (rows 5-30 excl 13), exit rows 14 & 15', () => {
      const layout = getAircraftLayout('B738');
      expect(layout.total_capacity).toBe(166);
      expect(layout.cabin_capacities[CabinClass.BUSINESS]).toBe(16);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(150);

      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([14, 15]);

      expect(layout.rows.some((r) => r.row_number === 13)).toBe(false);
    });

    it('AT76: exact turboprop 68 Economy (rows 1-17, 2-2), exit row 1', () => {
      const layout = getAircraftLayout('AT76');
      expect(layout.total_capacity).toBe(68);
      expect(layout.cabin_capacities[CabinClass.ECONOMY]).toBe(68);

      expect(layout.rows.length).toBe(17);
      expect(layout.rows.map((r) => r.row_number)).toEqual(
        Array.from({ length: 17 }, (_, i) => i + 1),
      );
      layout.rows.forEach((r) => {
        expect(r.column_groups).toEqual([['A', 'C'], ['D', 'F']]);
      });

      const exitRows = layout.rows.filter((r) => r.is_exit_row);
      expect(exitRows.map((r) => r.row_number)).toEqual([1]);
    });
  });
});
