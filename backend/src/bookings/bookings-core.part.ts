import { Model } from 'mongoose';
import { BookingDocument, ExternalPaymentProof } from './bookings.schema';
import { FlightDocument } from '../flights/flights.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { BookingSeatSagaOperationDocument } from '../seat-allocation/booking-seat-saga-operation.schema';

export interface BookingsCoreDependencies {
  bookingModel: Model<BookingDocument>;
  flightsService: FlightsService;
  usersService: UsersService;
  seatAllocationService?: SeatAllocationService;
  sagaModel?: Model<BookingSeatSagaOperationDocument>;
}

export interface BookingsCoreBridge {
  generateCode(prefix: string): string;
  normalizeLegType(legType?: string): string;
  assertPayPalPaymentProof(
    proof: ExternalPaymentProof | undefined | null,
    authoritativeAmountVnd: number,
    context: string,
  ): void;
  assertBookableFlight(flight: FlightDocument, context?: string): void;
  validateBookingWindow(flightOrFlights: FlightDocument | FlightDocument[], directionName?: string): void;
  validateConnectingFlights(flights: FlightDocument[]): void;
  validateRoundTripLegs(selectedLegs: any[]): any;
  cancelExpiredBlockStrict(booking: BookingDocument): Promise<void>;
}

export abstract class BookingsCorePart {
  protected constructor(
    protected readonly deps: BookingsCoreDependencies,
    protected readonly bridge: BookingsCoreBridge,
  ) {}

  protected get bookingModel() { return this.deps.bookingModel; }
  protected get flightsService() { return this.deps.flightsService; }
  protected get usersService() { return this.deps.usersService; }
  protected get seatAllocationService() { return this.deps.seatAllocationService; }
  protected get sagaModel() { return this.deps.sagaModel; }
}
