import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { SeatAllocationModule } from './seat-allocation.module';
import { SeatAllocationService } from './seat-allocation.service';
import { SeatAllocation, SeatAllocationDocument, SeatAllocationStatus } from './seat-allocation.schema';
import { CabinClass } from '../flights/flights.schema';

describe('SeatAllocationService Concurrency Integration (Real MongoDB)', () => {
  let moduleRef: TestingModule;
  let service: SeatAllocationService;
  let allocationModel: Model<SeatAllocationDocument>;
  let connection: Connection;

  const mongoUri = process.env.TEST_MONGO_URI || 'mongodb://localhost:27018/airline_db_test';
  const testFlightId = new Types.ObjectId();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoUri),
        SeatAllocationModule,
      ],
    }).compile();

    service = moduleRef.get<SeatAllocationService>(SeatAllocationService);
    allocationModel = moduleRef.get<Model<SeatAllocationDocument>>(getModelToken(SeatAllocation.name));
    connection = moduleRef.get<Connection>(getConnectionToken());

    // Ensure MongoDB indexes are actively built (specifically { flight_id: 1, seat_code: 1 } unique)
    await allocationModel.createIndexes();
  }, 30000);

  afterAll(async () => {
    if (allocationModel) {
      await allocationModel.deleteMany({ flight_id: testFlightId });
    }
    if (connection) {
      await connection.close();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  beforeEach(async () => {
    await allocationModel.deleteMany({ flight_id: testFlightId });
  });

  it('Test 1: 20 concurrent requests for the exact same seat (12A) on A20N — exactly 1 succeeds and 19 fail with ConflictException', async () => {
    const concurrentRequests = 20;
    const targetSeat = '12A';

    const promises = Array.from({ length: concurrentRequests }, (_, i) => {
      const bookingId = new Types.ObjectId();
      return service.allocateSeats({
        flight_id: testFlightId,
        aircraft_type: 'A20N',
        booking_id: bookingId,
        passengers: [
          {
            passenger_name: `Passenger ${i + 1}`,
            coupon_number: `CPN-${i + 1}`,
            cabin_class: CabinClass.ECONOMY,
            selection_type: 'CHOOSE',
            seat_code: targetSeat,
          },
        ],
      });
    });

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(19);

    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ConflictException);
    }

    // Verify database state: exactly 1 allocation exists in MongoDB
    const inDb = await allocationModel.find({ flight_id: testFlightId, seat_code: targetSeat }).exec();
    expect(inDb.length).toBe(1);
    expect(inDb[0].seat_code).toBe(targetSeat);
  });

  it('Test 2: Exactly 5 groups x 2 passengers on exactly 10 available physical seats — zero duplicate seat allocations', async () => {
    const numParties = 5;
    const partySize = 2;
    const expectedAllocated = numParties * partySize; // 10

    // Pre-block all Economy seats except exactly 10 seats to force high-concurrency race on bounded capacity
    const physicalSeats = service['fleetLayoutService'].getPhysicalSeats('A20N');
    const ecoSeats = physicalSeats.filter((s) => s.cabin_class === CabinClass.ECONOMY);
    const targetTen = ecoSeats.slice(0, 10).map((s) => s.seat_code.toUpperCase());
    const seatsToPreBlock = ecoSeats.slice(10);

    const preBlocks = seatsToPreBlock.map((s) => ({
      flight_id: testFlightId,
      seat_code: s.seat_code.toUpperCase(),
      status: SeatAllocationStatus.BLOCKED_MAINTENANCE,
      cabin_class: CabinClass.ECONOMY,
      staff_block_reason: 'TEST_CONCURRENCY_ISOLATION',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await allocationModel.insertMany(preBlocks);

    const promises = Array.from({ length: numParties }, (_, partyIdx) => {
      const bookingId = new Types.ObjectId();
      return service.allocateSeats({
        flight_id: testFlightId,
        aircraft_type: 'A20N',
        booking_id: bookingId,
        passengers: Array.from({ length: partySize }, (__, paxIdx) => ({
          passenger_name: `Party ${partyIdx + 1} Pax ${paxIdx + 1}`,
          coupon_number: `CPN-P${partyIdx + 1}-${paxIdx + 1}`,
          cabin_class: CabinClass.ECONOMY,
          selection_type: 'AUTO',
        })),
      });
    });

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(numParties);

    // Collect all allocated seats across all parties
    const allAllocatedSeats: string[] = [];
    for (const res of fulfilled) {
      const partySeats = (res as PromiseFulfilledResult<any>).value;
      expect(partySeats.length).toBe(partySize);

      for (const seat of partySeats) {
        allAllocatedSeats.push(seat.seat_code);
      }
    }

    // Total seats allocated must equal numParties * partySize (10)
    expect(allAllocatedSeats.length).toBe(expectedAllocated);

    // Verify ZERO duplicate seat codes
    const uniqueSeats = new Set(allAllocatedSeats);
    expect(uniqueSeats.size).toBe(expectedAllocated);

    // Verify all allocated seats were chosen from the target 10 seats
    for (const seatCode of allAllocatedSeats) {
      expect(targetTen).toContain(seatCode.toUpperCase());
    }

    // Verify database state: 158 pre-blocked + 10 allocated = 168 total
    const inDb = await allocationModel.find({ flight_id: testFlightId }).exec();
    expect(inDb.length).toBe(ecoSeats.length);
  });
});
