import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flight, FlightDocument, FlightStatus, CabinClass, getCustomerBookableFlightFilter } from './flights.schema';
import {
  CreateFlightDto,
  SearchFlightDto,
  UpdateFlightDto,
  UpdateFlightStatusDto,
  isValidCalendarDateString,
} from './flights.dto';
import {
  CommercialNetworkDiscoveryDto,
  CommercialNetworkDiscoveryResponse,
} from './airlabs-commercial.dto';
import { AirportsService } from '../airports/airports.service';
import { Booking, BookingDocument, BookingStatus, PaymentMethod } from '../bookings/bookings.schema';
import { localWallTimeToUtc, parseUtcWallTime, localDateKey, utcOffsetMinutes, formatLocalTime } from '../common/timezone.util';
import { earlyBirdQuote, getBookingWindowLimits, maxAdvanceBookingDays } from '../common/pricing.util';

import { ReferenceService } from '../reference/reference.service';
import { RouteGraphCoverage, RouteGraphResult, RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService, ValidatedItinerary } from '../reference/route-schedule-validator.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { FLEET_LAYOUT_CATALOG } from '../seat-allocation/fleet-layout.catalog';
import { MailService, ItineraryLegData, isValidMaskedCard } from '../mail/mail.service';
import { PaypalService, assertPayPalRefundExecutionSnapshot, classifyPayPalRefundStatus } from '../paypal/paypal.service';
import { allocateRefundSources, AllocatedRefundItem } from '../bookings/refund-allocation.util';
import { FlightsServiceBridge, FlightsServiceDependencies, FlightsServicePart } from './flights-service.part';

export class FlightsInventoryService extends FlightsServicePart {
  constructor(
    deps: FlightsServiceDependencies,
    private readonly bridge: FlightsServiceBridge,
  ) {
    super(deps);
  }
  async findById(id: string): Promise<FlightDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid flight ID format');
    }
    const flight = await this.flightModel.findById(id).exec();
    if (!flight) {
      throw new NotFoundException(`Flight with ID ${id} not found`);
    }
    return flight;
  }
  async updateAvailableSeats(
    flightId: string,
    inventoryId: string,
    seatCountChange: number, // Negative to reserve/block, positive to release/cancel
  ): Promise<boolean> {
    const flight = await this.bridge.findById(flightId);
    const inv = flight.inventories.find(
      (i: any) => i._id.toString() === inventoryId || i.id === inventoryId,
    );
    if (!inv) {
      throw new NotFoundException(`Inventory with ID ${inventoryId} not found on flight`);
    }

    if (seatCountChange < 0 && inv.available_seats < Math.abs(seatCountChange)) {
      throw new BadRequestException(`Not enough available seats in ${inv.cabin_class}. Only ${inv.available_seats} left.`);
    }

    inv.available_seats += seatCountChange;
    await flight.save();
    return true;
  }

  // Yêu cầu B.1: Đặt chỗ an toàn (atomic)
  async reserveSeats(
    flightId: string,
    inventoryId: string,
    count: number,
    sagaOptions?: { operation_id: string; mutation_key: string },
  ): Promise<boolean> {
    if (!sagaOptions) {
      const result = await this.flightModel.findOneAndUpdate(
        {
          _id: flightId,
          inventories: {
            $elemMatch: { _id: inventoryId, available_seats: { $gte: count } },
          },
        },
        {
          $inc: { 'inventories.$.available_seats': -count },
        },
        { new: true },
      );
      return !!result;
    }

    const invObjId = new Types.ObjectId(inventoryId);

    // Atomic update filter requires:
    // 1. the exact inventory via $elemMatch
    // 2. available_seats >= count
    // 3. that exact inventory does NOT already contain mutation_key
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            available_seats: { $gte: count },
            'saga_markers.mutation_key': { $ne: sagaOptions.mutation_key },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': -count },
        $push: {
          'inventories.$[inv].saga_markers': {
            mutation_key: sagaOptions.mutation_key,
            operation_id: sagaOptions.operation_id,
            action: 'RESERVE_NEW',
            seat_count: count,
            state: 'APPLIED',
            created_at: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }],
        new: true,
      },
    );

    if (result) {
      return true;
    }

    // If atomic update returned null: query for the exact marker
    // marker APPLIED => ALREADY_APPLIED / idempotent success
    // marker absent => genuine capacity failure
    const existingFlight = await this.flightModel.findOne({
      _id: flightId,
      inventories: {
        $elemMatch: {
          _id: inventoryId,
          saga_markers: {
            $elemMatch: { mutation_key: sagaOptions.mutation_key, state: 'APPLIED' },
          },
        },
      },
    }).exec();

    if (existingFlight) {
      return true; // ALREADY_APPLIED / idempotent success
    }

    return false; // Genuine capacity or flight failure
  }

  /**
   * Phase B SAGA: Atomically compensates an inventory reservation if the marker is APPLIED.
   */
  async compensateInventoryReservation(
    flightId: string | Types.ObjectId,
    inventoryId: string,
    mutationKey: string,
    count: number,
  ): Promise<boolean> {
    const invObjId = new Types.ObjectId(inventoryId);
    const now = new Date();
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            saga_markers: {
              $elemMatch: { mutation_key: mutationKey, state: 'APPLIED' },
            },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': +count },
        $set: {
          'inventories.$[inv].saga_markers.$[m].state': 'COMPENSATED',
          'inventories.$[inv].saga_markers.$[m].compensated_at': now,
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }, { 'm.mutation_key': mutationKey, 'm.state': 'APPLIED' }],
        new: true,
      },
    );
    if (result) {
      return true;
    }

    // Idempotent recovery inspection:
    // If findOneAndUpdate didn't match, check whether already compensated or never applied
    const flight = await this.flightModel.findOne({ _id: flightId }).lean();
    if (!flight) {
      return false;
    }
    const inv = flight.inventories?.find((i: any) => String(i._id) === String(inventoryId));
    if (!inv) {
      return false;
    }
    const marker = inv.saga_markers?.find((m: any) => m.mutation_key === mutationKey);
    if (!marker) {
      // Marker absent: mutation never reached flight inventory -> NO-OP SUCCESS
      return true;
    }
    if (marker.state === 'COMPENSATED') {
      // Already compensated -> IDEMPOTENT SUCCESS
      return true;
    }
    return false;
  }

  /**
   * Phase B SAGA: Atomically restores inventory with an idempotent saga marker.
   * Two concurrent identical restore calls must never increment twice.
   */
  async restoreSeatsWithSaga(
    flightId: string | Types.ObjectId,
    inventoryId: string,
    count: number,
    sagaOptions: { operation_id: string; mutation_key: string },
  ): Promise<boolean> {
    const invObjId = new Types.ObjectId(inventoryId);

    // Atomic update filter requires:
    // 1. exact inventory via $elemMatch
    // 2. that exact inventory does NOT already contain mutation_key
    const result = await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: {
          $elemMatch: {
            _id: inventoryId,
            'saga_markers.mutation_key': { $ne: sagaOptions.mutation_key },
          },
        },
      },
      {
        $inc: { 'inventories.$[inv].available_seats': +count },
        $push: {
          'inventories.$[inv].saga_markers': {
            mutation_key: sagaOptions.mutation_key,
            operation_id: sagaOptions.operation_id,
            action: 'RESTORE_OLD',
            seat_count: count,
            state: 'APPLIED',
            created_at: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'inv._id': invObjId }],
        new: true,
      },
    );

    if (result) {
      return true;
    }

    // Check if marker was already APPLIED (idempotent retry)
    const existing = await this.flightModel.findOne({
      _id: flightId,
      inventories: {
        $elemMatch: {
          _id: inventoryId,
          saga_markers: {
            $elemMatch: { mutation_key: sagaOptions.mutation_key, state: 'APPLIED' },
          },
        },
      },
    }).exec();

    return !!existing;
  }

  /**
   * Requirement 3.3: Advanced Flight Search & Route Selection Algorithm
   */
  async getSeatMap(flightId: string) {
    const flight = await this.bridge.findById(flightId);
    if (flight.is_bookable === false || (flight.operator && flight.operator !== 'APTECH_AIRLINES')) {
      throw new BadRequestException(
        'Seat map is only available for bookable Aptech Airlines flights.',
      );
    }

    // Lấy danh sách ghế đã được đặt trong DB từ Bookings
    const bookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $ne: 'CANCELLED' },
      })
      .exec();

    const occupiedSet = new Set<string>();
    for (const b of bookings) {
      for (const coupon of (b.ticket_coupons || [])) {
        if (coupon.flight_id?.toString() === flight._id.toString() && coupon.seat_code) {
          occupiedSet.add(coupon.seat_code.toUpperCase());
        }
      }
    }

    // Resolve real aircraft type
    let aircraftType: string | null = null;
    const modelCode = flight.aircraft?.model_code?.toUpperCase();
    const modelName = flight.aircraft?.model_name;

    if (modelCode && FLEET_LAYOUT_CATALOG[modelCode]) {
      aircraftType = modelCode;
    } else if (modelName) {
      if (/A321/i.test(modelName)) aircraftType = 'A21N';
      else if (/A320/i.test(modelName)) aircraftType = 'A20N';
      else if (/787/i.test(modelName)) aircraftType = 'B789';
      else if (/A350/i.test(modelName)) aircraftType = 'A359';
      else if (/737/i.test(modelName)) aircraftType = 'B738';
      else if (/ATR/i.test(modelName)) aircraftType = 'AT76';
    }

    let enrichedMap: any = null;
    if (aircraftType && this.seatAllocationService) {
      try {
        enrichedMap = await this.seatAllocationService.getSeatMap(flight._id, aircraftType);
      } catch (err: any) {
        this.logger.error(
          `Authoritative seat map and pricing resolution failed for flight ${flight._id}: ${err?.message || err}`,
        );
        throw new ServiceUnavailableException(
          'Authoritative seat map and pricing are temporarily unavailable. Please try again later.',
        );
      }
    }

    const rows: any[] = [];

    if (!aircraftType) {
      return {
        flight_id: flight._id,
        flight_number: flight.flight_number,
        route: `${flight.origin_iata} - ${flight.dest_iata}`,
        aircraft_model: flight.aircraft?.model_name ?? null,
        aircraft_known: false,
        layout_available: false,
        layout_notice: 'Aircraft model is not configured or recognized for this flight.',
        departure_time: flight.scheduled_departure,
        rows: [],
      };
    }

    const layout = FLEET_LAYOUT_CATALOG[aircraftType];

    for (const rConfig of layout.rows) {
      const isExit = rConfig.is_exit_row ?? false;
      const isSpecial = rConfig.cabin_class === CabinClass.BUSINESS || (rConfig.is_extra_legroom ?? false);

      const seats: any[] = [];
      const columnGroups: any[][] = [];

      for (const group of rConfig.column_groups) {
        const groupSeats: any[] = [];
        for (const col of group) {
          const seatCode = `${rConfig.row_number}${col}`;
          let isOccupied = occupiedSet.has(seatCode);
          let fee = 0;
          let type: 'SPECIAL' | 'EXIT_ROW' | 'STANDARD' = 'STANDARD';
          let typeLabel = 'Còn trống';

          if (isExit) {
            type = 'EXIT_ROW';
            typeLabel = 'Hàng ghế gần lối thoát hiểm';
          } else if (isSpecial) {
            type = 'SPECIAL';
            typeLabel = rConfig.cabin_class === CabinClass.BUSINESS ? 'Thương gia' : 'Đặc biệt';
          }

          if (enrichedMap) {
            const enrichedRow = enrichedMap.rows?.find((r: any) => r.row_number === rConfig.row_number);
            if (enrichedRow) {
              for (const grp of enrichedRow.column_groups) {
                const enrichedSeat = grp.find((s: any) => s.seat_code === seatCode);
                if (enrichedSeat) {
                  if (enrichedSeat.status === 'OCCUPIED' || enrichedSeat.status === 'HELD' || enrichedSeat.status === 'BLOCKED') {
                    isOccupied = true;
                  }
                  if (enrichedSeat.seat_fee !== undefined) {
                    fee = enrichedSeat.seat_fee;
                  }
                }
              }
            }
          }

          const seatObj = {
            seat_code: seatCode,
            row: rConfig.row_number,
            column: col,
            type,
            type_label: typeLabel,
            cabin_class: rConfig.cabin_class,
            fee,
            is_occupied: isOccupied,
            is_exit_row: isExit,
            is_special: isSpecial,
          };

          seats.push(seatObj);
          groupSeats.push(seatObj);
        }
        columnGroups.push(groupSeats);
      }

      rows.push({
        row_number: rConfig.row_number,
        is_exit_row: isExit,
        is_special: isSpecial,
        column_groups: columnGroups,
        seats,
      });
    }

    return {
      flight_id: flight._id,
      flight_number: flight.flight_number,
      route: `${flight.origin_iata} - ${flight.dest_iata}`,
      aircraft_model: flight.aircraft?.model_name ?? null,
      aircraft_known: !!flight.aircraft?.model_name,
      aircraft_type: aircraftType,
      total_capacity: layout.total_capacity,
      cabin_capacities: layout.cabin_capacities,
      layout_notice: `Aircraft cabin layout for ${layout.model_name} (${layout.total_capacity} seats).`,
      departure_time: flight.scheduled_departure,
      legend: [
        { type: 'AVAILABLE', label: 'Còn trống', color: '#22c55e', bg: 'bg-green-500' },
        { type: 'SELECTED', label: 'Đã chọn', color: '#eab308', bg: 'bg-yellow-400' },
        { type: 'EXIT_ROW', label: 'Hàng ghế gần lối thoát hiểm', color: '#3b82f6', bg: 'bg-blue-500' },
        { type: 'SPECIAL', label: 'Đặc biệt', color: '#ef4444', bg: 'bg-red-500' },
        { type: 'OCCUPIED', label: 'Đã bị chọn / không có', color: '#9ca3af', bg: 'bg-gray-400' },
      ],
      rows,
    };
  }

  /**
   * Đồng bộ chuyến bay thật từ AirLabs API (airlabs.co)
   * @param depIata Mã sân bay đi (VD: 'HAN')
   * @param arrIata Mã sân bay đến (VD: 'SGN')
   * @param customApiKey API Key do người dùng truyền vào (nếu không dùng file .env)
   */
}
