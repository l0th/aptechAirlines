import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SeatAllocation,
  SeatAllocationDocument,
  SeatAllocationStatus,
  SeatSelectionType,
} from './seat-allocation.schema';
import {
  FlightSeatOverride,
  FlightSeatOverrideDocument,
} from './flight-seat-override.schema';
import { FleetLayoutService, EnrichedSeatMapResponse } from './fleet-layout.service';
import { SeatPricingService, SeatPricingSnapshot } from './seat-pricing.service';
import { CabinClass } from '../flights/flights.schema';
import { PhysicalSeatDef } from './fleet-layout.catalog';

export interface PassengerSeatRequest {
  passenger_name: string;
  coupon_number: string;
  cabin_class: CabinClass;
  selection_type: 'AUTO' | 'CHOOSE';
  seat_code?: string;
  passenger_index?: number;
}

export interface AllocatedSeatResult {
  coupon_number: string;
  passenger_name: string;
  seat_code: string;
  cabin_class: CabinClass;
  selection_type: 'AUTO' | 'CHOOSE';
  seat_fee: number;
  pricing_snapshot: SeatPricingSnapshot;
  passenger_index?: number;
}

export interface AllocateSeatsParams {
  flight_id: Types.ObjectId | string;
  aircraft_type: string;
  booking_id: Types.ObjectId | string;
  held_until?: Date;
  saga_operation_id?: string;
  passengers: PassengerSeatRequest[];
}

@Injectable()
export class SeatAllocationService {
  private readonly logger = new Logger(SeatAllocationService.name);

  constructor(
    @InjectModel(SeatAllocation.name)
    private readonly allocationModel: Model<SeatAllocationDocument>,
    @InjectModel(FlightSeatOverride.name)
    private readonly overrideModel: Model<FlightSeatOverrideDocument>,
    private readonly fleetLayoutService: FleetLayoutService,
    private readonly seatPricingService: SeatPricingService,
  ) {}

  /**
   * Retrieves enriched seat map for a flight.
   */
  async getSeatMap(
    flightId: Types.ObjectId | string,
    aircraftType: string,
  ): Promise<EnrichedSeatMapResponse> {
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const [allocations, overrides] = await Promise.all([
      this.allocationModel.find({ flight_id: fId }).exec(),
      this.overrideModel.find({ flight_id: fId, is_active: true }).exec(),
    ]);

    return this.fleetLayoutService.buildEnrichedSeatMap(fId, aircraftType, allocations, overrides);
  }

  async hasCustomerSeatAssignments(flightId: Types.ObjectId | string): Promise<boolean> {
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const existing = await this.allocationModel.exists({
      flight_id: fId,
      status: { $in: [SeatAllocationStatus.HELD, SeatAllocationStatus.CONFIRMED] },
    });
    return !!existing;
  }

  /**
   * Pure, side-effect-free seat fee calculation for booking and reschedule quotes.
   */
  async calculateSeatFee(
    flightId: Types.ObjectId | string,
    seatCode: string,
    aircraftType: string,
    selectionType: 'AUTO' | 'CHOOSE',
  ): Promise<number> {
    if (selectionType === 'AUTO' || !seatCode) {
      return 0;
    }
    const seat = this.fleetLayoutService.findSeat(aircraftType, seatCode);
    if (!seat) {
      throw new BadRequestException(`Seat ${seatCode} does not exist on aircraft ${aircraftType}.`);
    }
    const pricing = await this.seatPricingService.calculateSeatFee(flightId, seat, 'CHOOSE');
    return pricing.final_fee;
  }

  /**
   * Pure, side-effect-free seat validation for booking quotes and pre-capture gates.
   */
  async validateSeatAvailability(
    flightId: Types.ObjectId | string,
    seatCode: string,
    aircraftType: string,
    cabinClass?: string,
  ): Promise<void> {
    const seat = this.fleetLayoutService.findSeat(aircraftType, seatCode);
    if (!seat) {
      throw new BadRequestException(`Seat ${seatCode} does not exist on aircraft ${aircraftType}.`);
    }
    if (cabinClass && seat.cabin_class !== cabinClass) {
      throw new BadRequestException(
        `Requested seat ${seatCode} cabin (${seat.cabin_class}) does not match ticket cabin (${cabinClass}).`,
      );
    }
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const now = new Date();
    const existing = await this.allocationModel
      .findOne({
        flight_id: fId,
        seat_code: seatCode,
        status: {
          $in: [
            SeatAllocationStatus.HELD,
            SeatAllocationStatus.CONFIRMED,
            SeatAllocationStatus.BLOCKED_MAINTENANCE,
            SeatAllocationStatus.CREW_REST,
            SeatAllocationStatus.VIP_HOLD,
          ],
        },
        $or: [
          {
            status: {
              $in: [
                SeatAllocationStatus.CONFIRMED,
                SeatAllocationStatus.BLOCKED_MAINTENANCE,
                SeatAllocationStatus.CREW_REST,
                SeatAllocationStatus.VIP_HOLD,
              ],
            },
          },
          { held_until: { $gt: now } },
        ],
      })
      .exec();
    if (existing) {
      throw new ConflictException(`Seat ${seatCode} is already occupied or held.`);
    }
  }

  /**
   * Authoritative seat allocation engine for booking create or reschedule.
   * Enforces atomic concurrency via MongoDB unique index on (flight_id, seat_code).
   * Compensates partially inserted seats on conflict.
   * Retries transient concurrency collisions for pure AUTO assignments.
   */
  async allocateSeats(params: AllocateSeatsParams): Promise<AllocatedSeatResult[]> {
    const maxRetries = 5;
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        return await this.attemptAllocateSeats(params);
      } catch (error: any) {
        const isConflict = error.code === 11000 || error instanceof ConflictException;
        const hasChoose = params.passengers?.some(
          (p) => p.selection_type === 'CHOOSE' && p.seat_code && p.seat_code.trim(),
        );

        // Immediate failure for explicit seat selections or when retries exhausted
        if (hasChoose || attempt >= maxRetries || !isConflict) {
          if (error instanceof ConflictException) throw error;
          if (error.code === 11000) {
            throw new ConflictException('Selected seat is already reserved or held by another passenger.');
          }
          throw error;
        }

        // AUTO concurrency collision retry backoff with jitter
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 10));
      }
    }
  }

  private async attemptAllocateSeats(params: AllocateSeatsParams): Promise<AllocatedSeatResult[]> {
    const { flight_id, aircraft_type, booking_id, held_until, saga_operation_id, passengers } = params;
    const fId = typeof flight_id === 'string' ? new Types.ObjectId(flight_id) : flight_id;
    const bId = typeof booking_id === 'string' ? new Types.ObjectId(booking_id) : booking_id;

    if (!passengers || passengers.length === 0) {
      return [];
    }

    const batchId = new Types.ObjectId().toHexString();
    const results: AllocatedSeatResult[] = [];
    const insertedAllocations: SeatAllocationDocument[] = [];

    // Pre-fetch all currently occupied seats on this flight to inform AUTO assignment
    const existingOccupied = await this.allocationModel.find(
      { flight_id: fId },
      { seat_code: 1 },
    ).exec();
    const occupiedSeatSet = new Set<string>(existingOccupied.map((a) => a.seat_code.toUpperCase()));

    // Separate passengers into CHOOSE vs AUTO
    const chooseRequests: PassengerSeatRequest[] = [];
    const autoRequests: PassengerSeatRequest[] = [];

    for (const p of passengers) {
      if (p.selection_type === 'CHOOSE' && p.seat_code && p.seat_code.trim()) {
        chooseRequests.push(p);
      } else {
        autoRequests.push(p);
      }
    }

    try {
      // 1. Process CHOOSE requests first
      for (const p of chooseRequests) {
        const seatCode = p.seat_code!.trim().toUpperCase();
        const physicalSeat = this.fleetLayoutService.findSeat(aircraft_type, seatCode);

        if (!physicalSeat) {
          throw new BadRequestException(
            `Seat '${seatCode}' does not exist on aircraft type '${aircraft_type}'.`,
          );
        }

        // Strict Cabin Class Validation: Cannot cross/upgrade cabin classes via seat selection!
        if (physicalSeat.cabin_class !== p.cabin_class) {
          throw new BadRequestException(
            `Seat '${seatCode}' is in cabin class '${physicalSeat.cabin_class}', which does not match ticket cabin class '${p.cabin_class}'.`,
          );
        }

        if (occupiedSeatSet.has(seatCode)) {
          throw new ConflictException(`Seat '${seatCode}' is already occupied or held.`);
        }

        // Calculate authoritative seat fee
        const pricingSnapshot = await this.seatPricingService.calculateSeatFee(
          fId,
          physicalSeat,
          'CHOOSE',
        );

        const appliedDim = pricingSnapshot.dimensions?.join(',') || 'DEFAULT_FREE';
        const fee = pricingSnapshot.final_fee;
        const isFree = fee === 0;

        const allocation = new this.allocationModel({
          flight_id: fId,
          seat_code: seatCode,
          status: SeatAllocationStatus.HELD,
          cabin_class: physicalSeat.cabin_class,
          booking_id: bId,
          coupon_number: p.coupon_number,
          passenger_name: p.passenger_name,
          passenger_index: p.passenger_index,
          seat_selection_type: SeatSelectionType.CHOOSE,
          seat_fee: fee,
          seat_fee_currency: 'VND',
          seat_pricing_snapshot: pricingSnapshot,
          pricing_dimension_applied: appliedDim,
          is_free_selection: isFree,
          held_until,
          saga_operation_id,
          allocation_batch_id: batchId,
        });

        await allocation.save();
        insertedAllocations.push(allocation);
        occupiedSeatSet.add(seatCode);

        results.push({
          coupon_number: p.coupon_number,
          passenger_name: p.passenger_name,
          seat_code: seatCode,
          cabin_class: physicalSeat.cabin_class,
          selection_type: 'CHOOSE',
          seat_fee: pricingSnapshot.final_fee,
          pricing_snapshot: pricingSnapshot,
          passenger_index: p.passenger_index,
        });
      }

      // 2. Process AUTO requests with party adjacency heuristic
      if (autoRequests.length > 0) {
        // Group auto requests by cabin class
        const requestsByCabin = new Map<CabinClass, PassengerSeatRequest[]>();
        for (const req of autoRequests) {
          const list = requestsByCabin.get(req.cabin_class) || [];
          list.push(req);
          requestsByCabin.set(req.cabin_class, list);
        }

        for (const [cabin, cabinRequests] of requestsByCabin.entries()) {
          const assignedSeats = this.findAdjacentAutoSeats(
            aircraft_type,
            cabin,
            cabinRequests.length,
            occupiedSeatSet,
          );

          if (assignedSeats.length < cabinRequests.length) {
            throw new ConflictException(
              `Not enough physical seats remaining in cabin '${cabin}' to allocate for party of ${cabinRequests.length}.`,
            );
          }

          for (let i = 0; i < cabinRequests.length; i++) {
            const p = cabinRequests[i];
            const seat = assignedSeats[i];
            const seatCode = seat.seat_code.toUpperCase();

            // AUTO is ALWAYS 0 fee
            const pricing: SeatPricingSnapshot = {
              rule_ids: [],
              dimensions: ['AUTO_SELECTION'],
              flight_override: false,
              final_fee: 0,
            };

            const allocation = new this.allocationModel({
              flight_id: fId,
              seat_code: seatCode,
              status: SeatAllocationStatus.HELD,
              cabin_class: cabin,
              booking_id: bId,
              coupon_number: p.coupon_number,
              passenger_name: p.passenger_name,
              passenger_index: p.passenger_index,
              seat_selection_type: SeatSelectionType.AUTO,
              seat_fee: 0,
              seat_fee_currency: 'VND',
              seat_pricing_snapshot: pricing,
              pricing_dimension_applied: 'AUTO_SELECTION',
              is_free_selection: true,
              held_until,
              saga_operation_id,
              allocation_batch_id: batchId,
            });

            await allocation.save();
            insertedAllocations.push(allocation);
            occupiedSeatSet.add(seatCode);

            results.push({
              coupon_number: p.coupon_number,
              passenger_name: p.passenger_name,
              seat_code: seatCode,
              cabin_class: cabin,
              selection_type: 'AUTO',
              seat_fee: 0,
              pricing_snapshot: pricing,
              passenger_index: p.passenger_index,
            });
          }
        }
      }

      return results;
    } catch (error: any) {
      // Partial failure / race condition compensation: remove all allocations in this batch!
      if (insertedAllocations.length > 0) {
        this.logger.warn(
          `Seat allocation failed for batch ${batchId}. Compensating ${insertedAllocations.length} seats...`,
        );
        await this.allocationModel.deleteMany({ allocation_batch_id: batchId }).exec();
      }

      if (error.code === 11000) {
        throw new ConflictException('Selected seat is already reserved or held by another passenger.');
      }
      throw error;
    }
  }

  /**
   * Confirms HELD allocations for a booking.
   * If couponNumbers is provided, confirms ONLY allocations matching those persisted coupon numbers.
   * This prevents confirming uncommitted tentative reschedule allocations sharing the same booking_id.
   */
  async confirmAllocations(
    bookingId: Types.ObjectId | string,
    sagaOperationId?: string,
    couponNumbers?: string[],
  ): Promise<number> {
    const bId = typeof bookingId === 'string' ? new Types.ObjectId(bookingId) : bookingId;
    const query: any = { booking_id: bId, status: SeatAllocationStatus.HELD };
    if (sagaOperationId) {
      query.saga_operation_id = sagaOperationId;
    }
    if (couponNumbers && couponNumbers.length > 0) {
      query.coupon_number = { $in: couponNumbers };
    }

    const res = await this.allocationModel.updateMany(query, {
      $set: { status: SeatAllocationStatus.CONFIRMED },
      $unset: { held_until: 1 },
    }).exec();

    return res.modifiedCount;
  }

  /**
   * Returns distinct booking IDs that currently have HELD seat allocations.
   */
  async findDistinctBookingIdsWithHeldAllocations(): Promise<Types.ObjectId[]> {
    return this.allocationModel.distinct('booking_id', {
      status: SeatAllocationStatus.HELD,
    }).exec();
  }

  /**
   * Releases (deletes) all allocations matching a specific saga_operation_id.
   * Required for safe PRECOMMIT compensation (especially for reschedule).
   */
  async releaseAllocationsBySaga(sagaOperationId: string): Promise<number> {
    const res = await this.allocationModel.deleteMany({ saga_operation_id: sagaOperationId }).exec();
    return res.deletedCount;
  }

  /**
   * Releases (deletes) all allocations for a booking (e.g. on cancellation or expiry),
   * or optionally only allocations matching a specific saga_operation_id.
   */
  async releaseAllocations(
    bookingId: Types.ObjectId | string,
    sagaOperationId?: string,
  ): Promise<number> {
    const bId = typeof bookingId === 'string' ? new Types.ObjectId(bookingId) : bookingId;
    const filter: any = { booking_id: bId };
    if (sagaOperationId) {
      filter.saga_operation_id = sagaOperationId;
    }
    const res = await this.allocationModel.deleteMany(filter).exec();
    return res.deletedCount;
  }

  /**
   * Reschedule Swap: Confirms new allocations and deletes old allocations atomically.
   */
  async finalizeRescheduleAllocations(
    bookingId: Types.ObjectId | string,
    newSagaOperationId: string,
    oldSeatCodes: Array<{ flight_id: Types.ObjectId | string; seat_code: string }>,
  ): Promise<void> {
    const bId = typeof bookingId === 'string' ? new Types.ObjectId(bookingId) : bookingId;

    // 1. Confirm new allocations for this saga operation
    await this.allocationModel.updateMany(
      { booking_id: bId, saga_operation_id: newSagaOperationId, status: SeatAllocationStatus.HELD },
      { $set: { status: SeatAllocationStatus.CONFIRMED }, $unset: { held_until: 1 } },
    ).exec();

    // 2. Remove old allocations
    for (const old of oldSeatCodes) {
      const fId = typeof old.flight_id === 'string' ? new Types.ObjectId(old.flight_id) : old.flight_id;
      await this.allocationModel.deleteOne({
        flight_id: fId,
        seat_code: old.seat_code.toUpperCase(),
        booking_id: bId,
      }).exec();
    }
  }

  /**
   * Staff: Block a physical seat for maintenance, crew rest, or VIP hold.
   */
  async blockSeat(
    flightId: Types.ObjectId | string,
    aircraftType: string,
    seatCode: string,
    reason: SeatAllocationStatus,
    userId: Types.ObjectId | string,
    notes?: string,
  ): Promise<SeatAllocationDocument> {
    const validReasons = [
      SeatAllocationStatus.BLOCKED_MAINTENANCE,
      SeatAllocationStatus.CREW_REST,
      SeatAllocationStatus.VIP_HOLD,
    ];
    if (!validReasons.includes(reason)) {
      throw new BadRequestException(`Invalid staff block reason '${reason}'.`);
    }

    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const code = seatCode.trim().toUpperCase();

    const physicalSeat = this.fleetLayoutService.findSeat(aircraftType, code);
    if (!physicalSeat) {
      throw new BadRequestException(`Seat '${code}' does not exist on aircraft type '${aircraftType}'.`);
    }

    try {
      const block = new this.allocationModel({
        flight_id: fId,
        seat_code: code,
        status: reason,
        cabin_class: physicalSeat.cabin_class,
        staff_block_reason: reason,
        staff_blocked_by_user_id: uId,
        staff_blocked_at: new Date(),
        staff_notes: notes,
      });
      return await block.save();
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(`Seat '${code}' is already occupied or blocked.`);
      }
      throw err;
    }
  }

  /**
   * Staff: Remove an operational block from a seat.
   */
  async unblockSeat(
    flightId: Types.ObjectId | string,
    seatCode: string,
  ): Promise<void> {
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const code = seatCode.trim().toUpperCase();

    const existing = await this.allocationModel.findOne({ flight_id: fId, seat_code: code }).exec();
    if (!existing) {
      throw new NotFoundException(`No allocation found for seat '${code}' on this flight.`);
    }

    if (existing.status === SeatAllocationStatus.CONFIRMED || existing.status === SeatAllocationStatus.HELD) {
      throw new BadRequestException(`Cannot unblock seat '${code}': seat is occupied by a passenger.`);
    }

    await this.allocationModel.deleteOne({ _id: existing._id }).exec();
  }

  /**
   * Staff: Set non-blocking flight-level price override.
   */
  async setPriceOverride(
    flightId: Types.ObjectId | string,
    seatCode: string,
    overrideFee: number,
    reason: string,
    userId: Types.ObjectId | string,
  ): Promise<FlightSeatOverrideDocument> {
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const code = seatCode.trim().toUpperCase();

    // Soft-deactivate any existing active override for this seat
    await this.overrideModel.updateMany(
      { flight_id: fId, seat_code: code, is_active: true },
      {
        $set: {
          is_active: false,
          deactivated_by_user_id: uId,
          deactivated_at: new Date(),
        },
      },
    ).exec();

    // Create new active successor override record to preserve audit history
    const newOverride = new this.overrideModel({
      flight_id: fId,
      seat_code: code,
      override_fee: overrideFee,
      reason,
      is_active: true,
      created_by_user_id: uId,
    });
    return newOverride.save();
  }

  /**
   * Staff: Soft-deactivate flight-level price override.
   */
  async removePriceOverride(
    flightId: Types.ObjectId | string,
    seatCode: string,
    userId: Types.ObjectId | string,
  ): Promise<void> {
    const fId = typeof flightId === 'string' ? new Types.ObjectId(flightId) : flightId;
    const uId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const code = seatCode.trim().toUpperCase();

    const existing = await this.overrideModel.findOne({ flight_id: fId, seat_code: code, is_active: true }).exec();
    if (!existing) {
      throw new NotFoundException(`No active price override found for seat '${code}'.`);
    }

    existing.is_active = false;
    existing.deactivated_by_user_id = uId;
    existing.deactivated_at = new Date();
    await existing.save();
  }

  /**
   * Party adjacency heuristic for AUTO assignment.
   */
  private findAdjacentAutoSeats(
    aircraftType: string,
    cabin: CabinClass,
    partySize: number,
    occupiedSet: Set<string>,
  ): PhysicalSeatDef[] {
    const allSeats = this.fleetLayoutService.getPhysicalSeats(aircraftType);
    const cabinSeats = allSeats.filter(
      (s) => s.cabin_class === cabin && !occupiedSet.has(s.seat_code.toUpperCase()),
    );

    if (cabinSeats.length < partySize) {
      return [];
    }

    // Group available seats by row
    const rowMap = new Map<number, PhysicalSeatDef[]>();
    for (const s of cabinSeats) {
      const list = rowMap.get(s.row_number) || [];
      list.push(s);
      rowMap.set(s.row_number, list);
    }

    // Pass 1: Try to find a single row that can fit the entire party
    for (const [rowNum, seatsInRow] of rowMap.entries()) {
      if (seatsInRow.length >= partySize) {
        // Return first N seats in this row
        return seatsInRow.slice(0, partySize);
      }
    }

    // Pass 2: Greedy fill across nearest adjacent rows
    const result: PhysicalSeatDef[] = [];
    const sortedRowNums = Array.from(rowMap.keys()).sort((a, b) => a - b);

    for (const rowNum of sortedRowNums) {
      const seatsInRow = rowMap.get(rowNum) || [];
      for (const s of seatsInRow) {
        result.push(s);
        if (result.length === partySize) {
          return result;
        }
      }
    }

    return result;
  }
}
