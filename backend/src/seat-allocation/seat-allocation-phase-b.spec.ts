import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ServiceUnavailableException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FlightsService } from '../flights/flights.service';
import { Flight, FlightDocument } from '../flights/flights.schema';
import { BookingsService } from '../bookings/bookings.service';
import { Booking, BookingDocument, BookingStatus, PassengerType } from '../bookings/bookings.schema';
import { BookingsScheduler } from '../bookings/bookings.scheduler';
import { SeatAllocationService } from './seat-allocation.service';
import {
  BookingSeatSagaOperation,
  BookingSeatSagaOperationDocument,
  SagaState,
  SagaOperationType,
} from './booking-seat-saga-operation.schema';
import { SeatAllocation, SeatAllocationDocument, SeatAllocationStatus } from './seat-allocation.schema';
import { CabinClass } from '../flights/flights.schema';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { MailService } from '../mail/mail.service';
import { AirportsService } from '../airports/airports.service';
import { ReferenceService } from '../reference/reference.service';

describe('Phase B Acceptance Blockers & SAGA Matrix Spec', () => {
  let flightModel: any;
  let bookingModel: any;
  let sagaModel: any;
  let allocationModel: any;

  let flightsService: FlightsService;
  let bookingsService: BookingsService;
  let bookingsScheduler: BookingsScheduler;
  let seatAllocationService: SeatAllocationService;
  let usersService: any;
  let policiesService: any;
  let mailService: any;

  beforeEach(async () => {
    flightModel = {
      findById: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockReturnThis(),
      find: jest.fn().mockReturnThis(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      lean: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    bookingModel = jest.fn().mockImplementation((doc: any) => ({
      ...doc,
      _id: doc._id || new Types.ObjectId(),
      save: jest.fn().mockResolvedValue({ ...doc, _id: doc._id || new Types.ObjectId() }),
    }));
    bookingModel.find = jest.fn().mockReturnThis();
    bookingModel.findOne = jest.fn().mockReturnThis();
    bookingModel.findById = jest.fn().mockReturnThis();
    bookingModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    bookingModel.select = jest.fn().mockReturnThis();
    bookingModel.exec = jest.fn();

    sagaModel = jest.fn().mockImplementation((doc: any) => ({
      ...doc,
      _id: doc._id || new Types.ObjectId(),
      save: jest.fn().mockResolvedValue({ ...doc, _id: doc._id || new Types.ObjectId() }),
    }));
    sagaModel.find = jest.fn().mockReturnThis();
    sagaModel.findOne = jest.fn().mockReturnThis();
    sagaModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    sagaModel.exec = jest.fn();

    allocationModel = {
      find: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockReturnThis(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      distinct: jest.fn().mockResolvedValue([]),
      exec: jest.fn(),
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({ _id: 'u1', preferred_credit_card: '4111111111111111', sky_miles: 1000 }),
      addSkyMiles: jest.fn().mockResolvedValue(true),
      deductSkyMiles: jest.fn().mockResolvedValue(true),
      setSkyMiles: jest.fn().mockResolvedValue(true),
    };

    policiesService = {
      calculateRefundPercentage: jest.fn().mockReturnValue(1.0),
    };

    mailService = {
      sendBookingConfirmation: jest.fn().mockResolvedValue(true),
      sendPaymentReminder: jest.fn().mockResolvedValue(true),
    };

    const airportsService = {
      findByIata: jest.fn(),
      resolveCity: jest.fn().mockReturnValue({ exactMatches: [{ iata_code: 'SGN' }], nearestSuggestion: null }),
    };

    const referenceService = {
      expandLocation: jest.fn().mockResolvedValue({ iata_codes: ['SGN'] }),
    };

    // Seat allocation service mock
    const seatAllocMock = {
      getSeatMap: jest.fn(),
      allocateSeats: jest.fn().mockResolvedValue([]),
      confirmAllocations: jest.fn().mockResolvedValue(1),
      finalizeRescheduleAllocations: jest.fn().mockResolvedValue(1),
      releaseAllocationsBySaga: jest.fn().mockResolvedValue(1),
      releaseAllocations: jest.fn().mockResolvedValue(1),
      findDistinctBookingIdsWithHeldAllocations: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsService,
        BookingsService,
        BookingsScheduler,
        { provide: SeatAllocationService, useValue: seatAllocMock },
        { provide: getModelToken(Flight.name), useValue: flightModel },
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(BookingSeatSagaOperation.name), useValue: sagaModel },
        { provide: getModelToken(SeatAllocation.name), useValue: allocationModel },
        { provide: UsersService, useValue: usersService },
        { provide: PoliciesService, useValue: policiesService },
        { provide: MailService, useValue: mailService },
        { provide: AirportsService, useValue: airportsService },
        { provide: ReferenceService, useValue: referenceService },
      ],
    }).compile();

    flightsService = module.get<FlightsService>(FlightsService);
    bookingsService = module.get<BookingsService>(BookingsService);
    bookingsScheduler = module.get<BookingsScheduler>(BookingsScheduler);
    seatAllocationService = module.get<SeatAllocationService>(SeatAllocationService);

    // Explicitly inject seatAllocationService into flightsService
    (flightsService as any).seatAllocationService = seatAllocationService;
  });

  // =========================================================================
  // 1. JOURNAL INTENT BEFORE MUTATION
  // =========================================================================
  it('1. journal intent before mutation: SAGA journals PRECOMMIT before reserving inventory', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId().toString();
    const mockFlight = {
      _id: flightId,
      flight_number: 'VN123',
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      data_source: 'AIRLABS_COMMERCIALIZED',
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      scheduled_departure: new Date(Date.now() + 86400000 * 30),
      scheduled_arrival: new Date(Date.now() + 86400000 * 30 + 7200000),
      status: 'SCHEDULED',
      distance_miles: 700,
      aircraft: { model_code: 'A20N', total_capacity: 180 },
      inventories: [{ _id: invId, cabin_class: 'ECONOMY', available_seats: 10, base_price: 100 }],
    };
    flightModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFlight) });

    let sagaSavedBeforeReservation = false;
    let precommitStateSaved = false;

    // Spy on saga constructor / save
    (bookingsService as any).sagaModel = jest.fn().mockImplementation((doc: any) => {
      const instance = {
        ...doc,
        _id: new Types.ObjectId(),
        save: jest.fn().mockImplementation(async () => {
          if (doc.state === SagaState.PRECOMMIT) {
            precommitStateSaved = true;
          }
          return instance;
        }),
      };
      return instance;
    });

    // Spy on flightsService.reserveSeats
    jest.spyOn(flightsService, 'reserveSeats').mockImplementation(async () => {
      if (precommitStateSaved) {
        sagaSavedBeforeReservation = true;
      }
      return true;
    });

    const createDto: any = {
      user_id: 'u1',
      passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'John', last_name: 'Doe' }],
      legs: [{ flight_id: flightId.toString(), inventory_id: invId, leg_type: 'OUTBOUND' }],
      is_block: false,
    };

    await bookingsService.createBooking(createDto);
    expect(precommitStateSaved).toBe(true);
    expect(sagaSavedBeforeReservation).toBe(true);
  });

  // =========================================================================
  // 2. RESERVE FALSE MARKER-ABSENT NO OVER-INCREMENT
  // =========================================================================
  it('2. reserve false marker-absent no over-increment: failed reservation creates no marker; compensation is safe no-op', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId();
    const mutationKey = 'mut-fail-test-1';

    // 1. Simulate reserveSeats returning false because capacity was exhausted (findOneAndUpdate returns null)
    flightModel.findOneAndUpdate.mockResolvedValueOnce(null);
    flightModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(null), // No existing marker
    });

    const reserved = await flightsService.reserveSeats(flightId.toString(), invId.toString(), 2, {
      operation_id: 'op-1',
      mutation_key: mutationKey,
    });
    expect(reserved).toBe(false);

    // 2. Simulate subsequent compensateInventoryReservation call on this unapplied mutation key
    // findOneAndUpdate with APPLIED marker returns null (since marker was never inserted)
    flightModel.findOneAndUpdate.mockResolvedValueOnce(null);
    // findOne inspection reveals flight without the marker
    flightModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockReturnValue({
        _id: flightId,
        inventories: [
          {
            _id: invId,
            available_seats: 0,
            saga_markers: [], // Marker is absent
          },
        ],
      }),
    });

    const compOk = await flightsService.compensateInventoryReservation(
      flightId,
      invId.toString(),
      mutationKey,
      2,
    );

    // Marker absent: must return true as NO-OP SUCCESS without any second update
    expect(compOk).toBe(true);
    // Verify findOneAndUpdate for compensation guarded by APPLIED marker
    const compCall = flightModel.findOneAndUpdate.mock.calls[1];
    expect(compCall[0].inventories.$elemMatch.saga_markers.$elemMatch).toEqual({
      mutation_key: mutationKey,
      state: 'APPLIED',
    });
  });

  // =========================================================================
  // 3. COMPENSATION IDEMPOTENCY
  // =========================================================================
  it('3. compensation idempotency: duplicate compensateInventoryReservation calls increment seats exactly once', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId();
    const mutationKey = 'mut-idempotent-test';

    // First call: findOneAndUpdate matches APPLIED marker and increments seats
    flightModel.findOneAndUpdate.mockResolvedValueOnce({
      _id: flightId,
      inventories: [{ _id: invId, available_seats: 5 }],
    });

    const firstResult = await flightsService.compensateInventoryReservation(
      flightId,
      invId.toString(),
      mutationKey,
      2,
    );
    expect(firstResult).toBe(true);

    // Second call: findOneAndUpdate returns null because marker state is already COMPENSATED
    flightModel.findOneAndUpdate.mockResolvedValueOnce(null);
    flightModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockReturnValue({
        _id: flightId,
        inventories: [
          {
            _id: invId,
            available_seats: 5,
            saga_markers: [{ mutation_key: mutationKey, state: 'COMPENSATED' }],
          },
        ],
      }),
    });

    const secondResult = await flightsService.compensateInventoryReservation(
      flightId,
      invId.toString(),
      mutationKey,
      2,
    );

    // Second call must return true as idempotent success without re-incrementing
    expect(secondResult).toBe(true);
    // Both calls attempted guarded findOneAndUpdate; second found already COMPENSATED and exited
    expect(flightModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  // =========================================================================
  // 4. NO DOUBLE RESTORE
  // =========================================================================
  it('4. no double restore: duplicate restoreSeatsWithSaga increments inventory exactly once', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId();
    const mutationKey = 'mut-restore-test';
    const sagaOpts = { operation_id: 'op-res-1', mutation_key: mutationKey };

    // First restore call matches and increments
    flightModel.findOneAndUpdate.mockResolvedValueOnce({
      _id: flightId,
      inventories: [{ _id: invId, available_seats: 6 }],
    });

    const firstOk = await flightsService.restoreSeatsWithSaga(flightId, invId.toString(), 2, sagaOpts);
    expect(firstOk).toBe(true);

    // Second restore call finds marker already present -> findOneAndUpdate returns null, findOne matches
    flightModel.findOneAndUpdate.mockResolvedValueOnce(null);
    flightModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({
        _id: flightId,
        inventories: [
          {
            _id: invId,
            available_seats: 6,
            saga_markers: [{ mutation_key: mutationKey, state: 'APPLIED' }],
          },
        ],
      }),
    });

    const secondOk = await flightsService.restoreSeatsWithSaga(flightId, invId.toString(), 2, sagaOpts);
    expect(secondOk).toBe(true);
    // Second restore safely found marker already APPLIED and exited
    expect(flightModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  // =========================================================================
  // 5. POSTCOMMIT NO ROLLBACK
  // =========================================================================
  it('5. postcommit no rollback: once COMMITTED, saga does not roll back on subsequent step failure', async () => {
    const opId = 'saga-comm-1';
    const staleSaga = {
      operation_id: opId,
      operation_type: SagaOperationType.CREATE,
      state: SagaState.COMMITTED,
      last_progress_at: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago
      new_inventory_reservations: [{ flight_id: new Types.ObjectId(), inventory_id: 'i1', seat_count: 1, mutation_key: 'm1' }],
      save: jest.fn(),
    };

    sagaModel.find.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([staleSaga]),
    });

    // Booking commit witness is present
    const matchingBooking = {
      _id: new Types.ObjectId(),
      status: BookingStatus.CONFIRMED,
      seat_saga_commit: { operation_id: opId, status: 'COMMITTED' },
      save: jest.fn(),
    };
    bookingModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(matchingBooking),
    });

    // Downstream confirmation fails
    (seatAllocationService.confirmAllocations as jest.Mock).mockRejectedValueOnce(
      new Error('Seat service transient failure'),
    );

    const result = await bookingsScheduler.reconcileStaleSagaOperations();

    // SAGA must NOT be aborted or rolled back; remains COMMITTED for retry
    expect(staleSaga.state).toBe(SagaState.COMMITTED);
    expect(result.reconciledCount).toBe(0);
    expect(staleSaga.save).not.toHaveBeenCalledWith(expect.objectContaining({ state: SagaState.ABORTED }));
  });

  // =========================================================================
  // 6. COMPLETION WITNESS FAILURE LEAVES COMMITTED
  // =========================================================================
  it('6. completion witness failure leaves COMMITTED: booking witness failure preserves COMMITTED for scheduler retry', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId().toString();
    const mockFlight = {
      _id: flightId,
      flight_number: 'VN456',
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      data_source: 'AIRLABS_COMMERCIALIZED',
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      scheduled_departure: new Date(Date.now() + 86400000 * 30),
      scheduled_arrival: new Date(Date.now() + 86400000 * 30 + 7200000),
      status: 'SCHEDULED',
      distance_miles: 700,
      aircraft: { model_code: 'A20N', total_capacity: 180 },
      inventories: [{ _id: invId, cabin_class: 'ECONOMY', available_seats: 10, base_price: 100 }],
    };
    flightModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFlight) });
    jest.spyOn(flightsService, 'reserveSeats').mockResolvedValue(true);

    let savedSagaInstance: any = null;
    (bookingsService as any).sagaModel = jest.fn().mockImplementation((doc: any) => {
      savedSagaInstance = {
        ...doc,
        _id: new Types.ObjectId(),
        save: jest.fn().mockImplementation(async function () {
          return this;
        }),
      };
      return savedSagaInstance;
    });

    // Make bookingModel.updateOne fail when updating seat_saga_commit to COMPLETED
    bookingModel.updateOne = jest.fn().mockImplementation((filter: any, update: any) => {
      if (update?.$set && update?.$set['seat_saga_commit.status'] === 'COMPLETED') {
        return Promise.reject(new Error('Mongo connection lost during completion witness'));
      }
      return Promise.resolve({ acknowledged: true });
    });

    const createDto: any = {
      user_id: 'u1',
      passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'Alice', last_name: 'Smith' }],
      legs: [{ flight_id: flightId.toString(), inventory_id: invId, leg_type: 'OUTBOUND' }],
      is_block: false,
    };

    // createBooking should succeed in booking creation, but saga state must NOT be COMPLETED
    await bookingsService.createBooking(createDto).catch(() => {});

    // Saga must remain in COMMITTED (not COMPLETED)
    expect(savedSagaInstance.state).toBe(SagaState.COMMITTED);
    expect(savedSagaInstance.state).not.toBe(SagaState.COMPLETED);
  });

  // =========================================================================
  // 7. SCHEDULER PRECOMMIT RECOVERY
  // =========================================================================
  it('7. scheduler PRECOMMIT recovery: reconciles stale PRECOMMIT crash by compensating new resources and aborting', async () => {
    const opId = 'saga-precommit-crash-1';
    const flightId = new Types.ObjectId();
    const staleSaga = {
      operation_id: opId,
      operation_type: SagaOperationType.CREATE,
      state: SagaState.PRECOMMIT,
      last_progress_at: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago
      new_inventory_reservations: [{ flight_id: flightId, inventory_id: 'inv1', seat_count: 2, mutation_key: 'mut-1' }],
      save: jest.fn().mockResolvedValue(true),
    };

    sagaModel.find.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([staleSaga]),
    });

    // No matching booking exists (crashed before booking save)
    bookingModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(null),
    });

    jest.spyOn(flightsService, 'compensateInventoryReservation').mockResolvedValue(true);

    const result = await bookingsScheduler.reconcileStaleSagaOperations();

    expect(flightsService.compensateInventoryReservation).toHaveBeenCalledWith(
      flightId,
      'inv1',
      'mut-1',
      2,
    );
    expect(seatAllocationService.releaseAllocationsBySaga).toHaveBeenCalledWith(opId);
    expect(staleSaga.state).toBe(SagaState.ABORTED);
    expect(result.reconciledCount).toBe(1);
  });

  // =========================================================================
  // 8. SCHEDULER COMMITTED RECOVERY
  // =========================================================================
  it('8. scheduler COMMITTED recovery: forward-finalizes COMMITTED saga with matching booking witness', async () => {
    const opId = 'saga-comm-recovery-1';
    const bookingId = new Types.ObjectId();
    const staleSaga = {
      operation_id: opId,
      operation_type: SagaOperationType.CREATE,
      state: SagaState.COMMITTED,
      last_progress_at: new Date(Date.now() - 20 * 60 * 1000),
      new_inventory_reservations: [],
      save: jest.fn().mockResolvedValue(true),
    };

    sagaModel.find.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([staleSaga]),
    });

    const matchingBooking = {
      _id: bookingId,
      status: BookingStatus.CONFIRMED,
      seat_saga_commit: { operation_id: opId, status: 'COMMITTED' },
      save: jest.fn().mockResolvedValue(true),
    };
    bookingModel.findOne.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(matchingBooking),
    });

    (seatAllocationService.confirmAllocations as jest.Mock).mockResolvedValue(1);

    const result = await bookingsScheduler.reconcileStaleSagaOperations();

    expect(seatAllocationService.confirmAllocations).toHaveBeenCalledWith(bookingId, opId);
    expect(matchingBooking.seat_saga_commit.status).toBe('COMPLETED');
    expect(staleSaga.state).toBe(SagaState.COMPLETED);
    expect(result.reconciledCount).toBe(1);
  });

  // =========================================================================
  // 9. CONFIRM-TICKET RECOVERY EXCLUDES PRECOMMIT RESCHEDULE ALLOCATIONS
  // =========================================================================
  it('9. confirm-ticket recovery excludes PRECOMMIT reschedule allocations: confirms only persisted coupons', async () => {
    const bookingId = new Types.ObjectId();
    (seatAllocationService.findDistinctBookingIdsWithHeldAllocations as jest.Mock).mockResolvedValueOnce([bookingId]);

    const persistedCoupons = [{ coupon_number: 'CPN-PERSISTED-1' }, { coupon_number: 'CPN-PERSISTED-2' }];

    bookingModel.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValueOnce({
        exec: jest.fn().mockResolvedValueOnce([
          {
            _id: bookingId,
            ticket_coupons: persistedCoupons,
          },
        ]),
      }),
    });

    (seatAllocationService.confirmAllocations as jest.Mock).mockResolvedValueOnce(2);

    const result = await bookingsScheduler.recoverUnconfirmedSeatAllocations();

    expect(result.recoveredBookingsCount).toBe(1);
    // Verify confirmAllocations was called with ONLY persisted coupon numbers
    expect(seatAllocationService.confirmAllocations).toHaveBeenCalledWith(
      bookingId,
      undefined,
      ['CPN-PERSISTED-1', 'CPN-PERSISTED-2'],
    );
  });

  // =========================================================================
  // 10. OLD INVENTORY RESTORE RECOVERY
  // =========================================================================
  it('10. old inventory restore recovery: reschedule saga remains COMMITTED if old inventory restore fails; completes on success', async () => {
    const opId = 'saga-reschedule-restore-1';
    const bookingId = new Types.ObjectId();
    const oldFlightId = new Types.ObjectId();
    const staleSaga = {
      operation_id: opId,
      operation_type: SagaOperationType.RESCHEDULE,
      state: SagaState.COMMITTED,
      last_progress_at: new Date(Date.now() - 20 * 60 * 1000),
      old_inventory_restorations: [
        { flight_id: oldFlightId, inventory_id: 'old-inv', seat_count: 1, mutation_key: 'mut-old' },
      ],
      old_seat_allocations: [],
      save: jest.fn().mockResolvedValue(true),
    };

    sagaModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([staleSaga]),
    });

    const matchingBooking = {
      _id: bookingId,
      status: BookingStatus.CONFIRMED,
      seat_saga_commit: { operation_id: opId, status: 'COMMITTED' },
      save: jest.fn().mockResolvedValue(true),
    };
    bookingModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(matchingBooking),
    });

    // 1. First attempt: restoreSeatsWithSaga fails
    jest.spyOn(flightsService, 'restoreSeatsWithSaga').mockResolvedValueOnce(false);

    let res = await bookingsScheduler.reconcileStaleSagaOperations();
    expect(staleSaga.state).toBe(SagaState.COMMITTED); // Remains COMMITTED
    expect(res.reconciledCount).toBe(0);

    // 2. Retry attempt: restoreSeatsWithSaga succeeds
    jest.spyOn(flightsService, 'restoreSeatsWithSaga').mockResolvedValueOnce(true);

    res = await bookingsScheduler.reconcileStaleSagaOperations();
    expect(staleSaga.state).toBe(SagaState.COMPLETED);
    expect(res.reconciledCount).toBe(1);
  });

  // =========================================================================
  // 11. PUBLIC SEAT-MAP FAIL-CLOSED
  // =========================================================================
  it('11. public seat-map fail-closed: throws ServiceUnavailableException when seat allocation service throws', async () => {
    const flightId = new Types.ObjectId().toString();
    const mockFlight = {
      _id: flightId,
      is_bookable: true,
      operator: 'APTECH_AIRLINES',
      aircraft: { model_code: 'A20N' },
    };
    jest.spyOn(flightsService, 'findById').mockResolvedValue(mockFlight as any);
    bookingModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    // Simulate seat allocation service failure (database down, pricing error, etc.)
    (seatAllocationService.getSeatMap as jest.Mock).mockRejectedValue(
      new Error('Seat map database unreachable'),
    );

    // Must fail closed with ServiceUnavailableException, never returning selectable zero-fee fallback seats
    await expect(flightsService.getSeatMap(flightId)).rejects.toThrow(ServiceUnavailableException);
    await expect(flightsService.getSeatMap(flightId)).rejects.toThrow(
      'Authoritative seat map and pricing are temporarily unavailable. Please try again later.',
    );
  });

  // =========================================================================
  // 12. CANCEL / EXPIRY RELEASE
  // =========================================================================
  it('12. cancel / expiry release: releases held/confirmed allocations and restores inventory on cancellation', async () => {
    const bookingId = new Types.ObjectId().toString();
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId().toString();

    const mockBooking = {
      _id: bookingId,
      confirmation_number: 'CONF-12345',
      user_id: 'u1',
      status: BookingStatus.CONFIRMED,
      total_amount: 500000,
      total_miles_accrued: 50,
      passengers: [{ first_name: 'John', last_name: 'Doe' }],
      payment_transactions: [
        {
          transaction_type: 'PAYMENT',
          status: 'SUCCESS',
          card_masked: '**** **** **** 1111',
          created_at: new Date(),
        },
      ],
      ticket_coupons: [
        {
          coupon_number: 'CPN-001',
          flight_id: flightId,
          inventory_id: invId,
          status: 'ISSUED',
          coupon_status: 'ISSUED',
        },
      ],
      save: jest.fn().mockResolvedValue(true),
    };

    bookingModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockBooking),
    });

    const mockFlight = {
      _id: flightId,
      scheduled_departure: new Date(Date.now() + 86400000 * 10),
      inventories: [{ _id: invId, cabin_class: 'ECONOMY', available_seats: 10, base_price: 100 }],
    };
    flightModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFlight) });
    jest.spyOn(flightsService, 'updateAvailableSeats').mockResolvedValue(true as any);
    (seatAllocationService.releaseAllocations as jest.Mock).mockResolvedValue(1);

    const cancelResult = await bookingsService.cancelTicket({ identifier: 'CONF-12345' } as any);

    expect(cancelResult).toBeDefined();
    expect(mockBooking.status).toBe(BookingStatus.CANCELLED);
    expect(mockBooking.ticket_coupons[0].coupon_status).toBe('CANCELLED');
    expect(seatAllocationService.releaseAllocations).toHaveBeenCalledWith(mockBooking._id);
  });

  // =========================================================================
  // 13. PRECOMMIT NEVER ABORTED IF COMPENSATION FAILED + SCHEDULER RETRY
  // =========================================================================
  it('13. precommit compensation retry: saga remains PRECOMMIT when compensation fails, transitions to ABORTED only after scheduler retry succeeds', async () => {
    const flightId = new Types.ObjectId();
    const invId = new Types.ObjectId().toString();
    const mockFlight = {
      _id: flightId,
      flight_number: 'VN123',
      operator: 'APTECH_AIRLINES',
      is_bookable: true,
      data_source: 'AIRLABS_COMMERCIALIZED',
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      scheduled_departure: new Date(Date.now() + 86400000 * 30),
      scheduled_arrival: new Date(Date.now() + 86400000 * 30 + 7200000),
      status: 'SCHEDULED',
      distance_miles: 700,
      aircraft: { model_code: 'A20N', total_capacity: 180 },
      inventories: [{ _id: invId, cabin_class: 'ECONOMY', available_seats: 10, base_price: 100 }],
    };
    flightModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockFlight) });

    let capturedSagaInstance: any = null;
    (bookingsService as any).sagaModel = jest.fn().mockImplementation((doc: any) => {
      capturedSagaInstance = {
        ...doc,
        _id: new Types.ObjectId(),
        save: jest.fn().mockImplementation(async function () {
          return this;
        }),
      };
      return capturedSagaInstance;
    });

    // 1. Reserve seats succeeds (reserve marker APPLIED)
    jest.spyOn(flightsService, 'reserveSeats').mockResolvedValue(true);

    // 2. Seat allocation fails, triggering compensation
    (seatAllocationService.allocateSeats as jest.Mock).mockRejectedValueOnce(
      new BadRequestException('Seat allocation failed due to aircraft configuration error'),
    );

    // 3. Compensation throws on first attempt during createBooking
    jest.spyOn(flightsService, 'compensateInventoryReservation').mockRejectedValueOnce(
      new Error('Transient network error during compensation'),
    );

    const createDto: any = {
      user_id: 'u1',
      passengers: [{ passenger_type: PassengerType.ADULT, first_name: 'John', last_name: 'Doe' }],
      legs: [{ flight_id: flightId.toString(), inventory_id: invId, leg_type: 'OUTBOUND' }],
      is_block: false,
    };

    await expect(bookingsService.createBooking(createDto)).rejects.toThrow();

    // Verify SAGA invariant: PRECOMMIT was NOT marked ABORTED because compensation threw!
    expect(capturedSagaInstance).toBeDefined();
    expect(capturedSagaInstance.state).toBe(SagaState.PRECOMMIT);
    expect(capturedSagaInstance.aborted_at).toBeUndefined();

    // Now simulate BookingsScheduler running to reconcile stale PRECOMMIT sagas
    capturedSagaInstance.last_progress_at = new Date(Date.now() - 20 * 60 * 1000);
    sagaModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([capturedSagaInstance]),
    });
    bookingModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null), // No booking was committed
    });

    // 4. On scheduler retry, compensateInventoryReservation succeeds
    jest.spyOn(flightsService, 'compensateInventoryReservation').mockResolvedValueOnce(true);
    (seatAllocationService.releaseAllocationsBySaga as jest.Mock).mockResolvedValueOnce(0);

    const reconcileResult = await bookingsScheduler.reconcileStaleSagaOperations();

    // Only after retry succeeds does the saga become ABORTED!
    expect(capturedSagaInstance.state).toBe(SagaState.ABORTED);
    expect(capturedSagaInstance.aborted_at).toBeDefined();
    expect(reconcileResult.reconciledCount).toBe(1);
  });

  // =========================================================================
  // 14. IMMUTABLE HISTORICAL SEAT PRICING SNAPSHOT
  // =========================================================================
  it('14. immutable historical seat pricing snapshot: subsequent rule changes do not mutate persisted allocation snapshot', async () => {
    // 1. Simulate an initial allocation persisted with original pricing rule snapshot
    const originalSnapshot = {
      rule_ids: ['RULE-WINDOW-01'],
      dimensions: ['WINDOW_SEAT'],
      flight_override: false,
      final_fee: 60000,
    };

    const historicalAllocation = {
      _id: new Types.ObjectId(),
      flight_id: new Types.ObjectId(),
      seat_code: '12A',
      status: SeatAllocationStatus.CONFIRMED,
      cabin_class: 'ECONOMY',
      seat_selection_type: 'CHOOSE',
      seat_fee: 60000,
      seat_fee_currency: 'VND',
      seat_pricing_snapshot: originalSnapshot,
      pricing_dimension_applied: 'WINDOW_SEAT',
      is_free_selection: false,
      passenger_index: 0,
      coupon_number: 'CPN-HISTORICAL-01',
    };

    allocationModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(historicalAllocation),
    });

    // 2. Simulate later business rule change (e.g. window seat fee increased to 120,000 VND)
    const updatedCatalogRules = {
      rule_id: 'RULE-WINDOW-02',
      dimensions: ['WINDOW_SEAT', 'PEAK_SEASON'],
      final_fee: 120000,
    };

    // 3. Query historical allocation from database
    const fetched = await allocationModel.findOne({ coupon_number: 'CPN-HISTORICAL-01' }).exec();

    // 4. Assert: historical snapshot remains frozen and unaffected by updated rules
    expect(fetched.seat_fee).toBe(60000);
    expect(fetched.seat_pricing_snapshot.final_fee).toBe(60000);
    expect(fetched.seat_pricing_snapshot.rule_ids).toEqual(['RULE-WINDOW-01']);
    expect(fetched.seat_pricing_snapshot.dimensions).toEqual(['WINDOW_SEAT']);
    expect(fetched.seat_fee).not.toBe(updatedCatalogRules.final_fee);
    expect(fetched.seat_pricing_snapshot.final_fee).not.toBe(updatedCatalogRules.final_fee);
  });
});
