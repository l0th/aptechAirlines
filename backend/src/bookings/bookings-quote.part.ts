import { Model } from 'mongoose';
import { BookingDocument } from './bookings.schema';
import { FlightDocument } from '../flights/flights.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { PaypalService } from '../paypal/paypal.service';

export interface BookingsQuoteDependencies {
  bookingModel: Model<BookingDocument>;
  flightsService: FlightsService;
  usersService: UsersService;
  seatAllocationService?: SeatAllocationService;
  paypalService?: PaypalService;
}

export interface BookingsQuoteBridge {
  loadDistinctCouponFlights(coupons: any[]): Promise<FlightDocument[]>;
  normalizeLegType(legType?: string): string;
  assertBookableFlight(flight: FlightDocument, context?: string): void;
  validateBookingWindow(flightOrFlights: FlightDocument | FlightDocument[], directionName?: string): void;
  validateConnectingFlights(flights: FlightDocument[]): void;
  validateConnectingSequence(flights: FlightDocument[], label: string): void;
  validateRoundTripLegs(selectedLegs: any[]): any;
}

export abstract class BookingsQuotePart {
  protected constructor(
    protected readonly deps: BookingsQuoteDependencies,
    protected readonly bridge: BookingsQuoteBridge,
  ) {}

  protected get bookingModel() { return this.deps.bookingModel; }
  protected get flightsService() { return this.deps.flightsService; }
  protected get usersService() { return this.deps.usersService; }
  protected get seatAllocationService() { return this.deps.seatAllocationService; }
  protected get paypalService() { return this.deps.paypalService; }
}
