import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  getAircraftLayout,
  generatePhysicalSeats,
  AircraftLayoutDef,
  PhysicalSeatDef,
  AircraftRowConfig,
} from './fleet-layout.catalog';
import { SeatAllocation, SeatAllocationDocument, SeatAllocationStatus } from './seat-allocation.schema';
import { FlightSeatOverride, FlightSeatOverrideDocument } from './flight-seat-override.schema';
import { SeatPricingService } from './seat-pricing.service';
import { CabinClass } from '../flights/flights.schema';

export interface EnrichedSeatMapItem {
  seat_code: string;
  row_number: number;
  column_letter: string;
  cabin_class: CabinClass;
  is_exit_row: boolean;
  is_extra_legroom: boolean;
  position: 'WINDOW' | 'AISLE' | 'MIDDLE';
  status: 'AVAILABLE' | 'HELD' | 'OCCUPIED' | 'BLOCKED';
  staff_block_reason?: string;
  seat_fee: number;
  pricing_dimensions: string[];
}

export interface EnrichedRowConfig {
  row_number: number;
  cabin_class: CabinClass;
  is_exit_row: boolean;
  is_extra_legroom: boolean;
  column_groups: EnrichedSeatMapItem[][];
}

export interface EnrichedSeatMapResponse {
  aircraft_type: string;
  model_name: string;
  total_capacity: number;
  cabin_capacities: Record<string, number>;
  total_available: number;
  total_occupied_or_held: number;
  total_blocked: number;
  rows: EnrichedRowConfig[];
}

@Injectable()
export class FleetLayoutService {
  constructor(private readonly seatPricingService: SeatPricingService) {}

  /**
   * Retrieves aircraft layout definition.
   */
  getLayout(aircraftType: string): AircraftLayoutDef {
    return getAircraftLayout(aircraftType);
  }

  /**
   * Generates all physical seat definitions for an aircraft.
   */
  getPhysicalSeats(aircraftType: string): PhysicalSeatDef[] {
    return generatePhysicalSeats(aircraftType);
  }

  /**
   * Looks up a single seat in the physical layout.
   */
  findSeat(aircraftType: string, seatCode: string): PhysicalSeatDef | undefined {
    const seats = this.getPhysicalSeats(aircraftType);
    return seats.find((s) => s.seat_code.toUpperCase() === (seatCode || '').trim().toUpperCase());
  }

  /**
   * Merges static geometry with live MongoDB SeatAllocation & FlightSeatOverride documents.
   */
  async buildEnrichedSeatMap(
    flightId: Types.ObjectId | string,
    aircraftType: string,
    allocations: SeatAllocationDocument[],
    overrides: FlightSeatOverrideDocument[],
  ): Promise<EnrichedSeatMapResponse> {
    const layout = this.getLayout(aircraftType);
    const profileSnapshot = await this.seatPricingService.getFlightProfileSnapshot(flightId);
    const allocMap = new Map<string, SeatAllocationDocument>();
    for (const a of allocations) {
      allocMap.set(a.seat_code.toUpperCase(), a);
    }

    const overrideMap = new Map<string, FlightSeatOverrideDocument>();
    for (const o of overrides) {
      if (o.is_active) {
        overrideMap.set(o.seat_code.toUpperCase(), o);
      }
    }

    let totalAvailable = 0;
    let totalOccupiedOrHeld = 0;
    let totalBlocked = 0;

    const enrichedRows: EnrichedRowConfig[] = [];

    for (const row of layout.rows) {
      const enrichedGroups: EnrichedSeatMapItem[][] = [];

      for (let gIdx = 0; gIdx < row.column_groups.length; gIdx++) {
        const group = row.column_groups[gIdx];
        const enrichedGroup: EnrichedSeatMapItem[] = [];

        for (const col of group) {
          const seatCode = `${row.row_number}${col}`;
          const seatDef: PhysicalSeatDef = {
            seat_code: seatCode,
            row_number: row.row_number,
            column_letter: col,
            cabin_class: row.cabin_class,
            is_exit_row: row.is_exit_row ?? false,
            is_extra_legroom: row.is_extra_legroom ?? false,
            position: row.position_map?.[col] ?? (
              gIdx === 0 && group.indexOf(col) === 0
                ? 'WINDOW'
                : gIdx === row.column_groups.length - 1 && group.indexOf(col) === group.length - 1
                ? 'WINDOW'
                : group.indexOf(col) === 0 || group.indexOf(col) === group.length - 1
                ? 'AISLE'
                : 'MIDDLE'
            ),
          };

          const allocation = allocMap.get(seatCode);

          let displayStatus: 'AVAILABLE' | 'HELD' | 'OCCUPIED' | 'BLOCKED' = 'AVAILABLE';
          let blockReason: string | undefined;

          if (allocation) {
            if (allocation.status === SeatAllocationStatus.HELD) {
              displayStatus = 'HELD';
              totalOccupiedOrHeld++;
            } else if (allocation.status === SeatAllocationStatus.CONFIRMED) {
              displayStatus = 'OCCUPIED';
              totalOccupiedOrHeld++;
            } else {
              displayStatus = 'BLOCKED';
              blockReason = allocation.staff_block_reason || allocation.status;
              totalBlocked++;
            }
          } else {
            totalAvailable++;
          }

          // Authoritative seat fee computation
          const pricing = await this.seatPricingService.calculateSeatFee(
            flightId,
            seatDef,
            'CHOOSE',
            profileSnapshot,
          );

          enrichedGroup.push({
            seat_code: seatCode,
            row_number: row.row_number,
            column_letter: col,
            cabin_class: row.cabin_class,
            is_exit_row: seatDef.is_exit_row,
            is_extra_legroom: seatDef.is_extra_legroom,
            position: seatDef.position,
            status: displayStatus,
            staff_block_reason: blockReason,
            seat_fee: pricing.final_fee,
            pricing_dimensions: pricing.dimensions,
          });
        }

        enrichedGroups.push(enrichedGroup);
      }

      enrichedRows.push({
        row_number: row.row_number,
        cabin_class: row.cabin_class,
        is_exit_row: row.is_exit_row ?? false,
        is_extra_legroom: row.is_extra_legroom ?? false,
        column_groups: enrichedGroups,
      });
    }

    return {
      aircraft_type: layout.aircraft_type,
      model_name: layout.model_name,
      total_capacity: layout.total_capacity,
      cabin_capacities: layout.cabin_capacities,
      total_available: totalAvailable,
      total_occupied_or_held: totalOccupiedOrHeld,
      total_blocked: totalBlocked,
      rows: enrichedRows,
    };
  }
}
