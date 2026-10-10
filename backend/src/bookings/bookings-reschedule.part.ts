import { Model } from 'mongoose';
import {
  BookingDocument,
  ExternalPaymentProof,
} from './bookings.schema';
import { RescheduleTicketDto } from './bookings.dto';
import { FlightDocument } from '../flights/flights.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { BookingSeatSagaOperationDocument } from '../seat-allocation/booking-seat-saga-operation.schema';
import { PaypalService } from '../paypal/paypal.service';
import { AllocatedRefundItem } from './refund-allocation.util';

export interface BookingsRescheduleDependencies {
  bookingModel: Model<BookingDocument>;
  flightsService: FlightsService;
  usersService: UsersService;
  seatAllocationService?: SeatAllocationService;
  sagaModel?: Model<BookingSeatSagaOperationDocument>;
  paypalService?: PaypalService;
}

export interface BookingsRescheduleBridge {
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
  validateConnectingSequence(flights: FlightDocument[], label: string): void;
  loadDistinctCouponFlights(coupons: any[]): Promise<FlightDocument[]>;
  distinctCouponLegs(coupons: any[]): Array<{ flightId: string; inventoryId: string }>;
  buildCouponWithFare(
    passenger: any,
    flight: FlightDocument,
    inventory: any,
    legType: string,
    fare: number,
  ): any;
  executePostCommitRefunds(
    bookingId: any,
    refundAllocations: AllocatedRefundItem[],
    pnrCode: string,
  ): Promise<void>;
  rescheduleMixedRoundTrip(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    outboundCoupons: any[],
    inboundCoupons: any[],
    outboundIsConnecting: boolean,
    returnIsConnecting: boolean,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<any>;
  rescheduleConnectingTicket(
    booking: BookingDocument,
    dto: RescheduleTicketDto,
    externalPaymentProof?: ExternalPaymentProof,
  ): Promise<any>;
}

export abstract class BookingsReschedulePart {
  protected constructor(
    protected readonly deps: BookingsRescheduleDependencies,
    protected readonly bridge: BookingsRescheduleBridge,
  ) {}

  protected get bookingModel() { return this.deps.bookingModel; }
  protected get flightsService() { return this.deps.flightsService; }
  protected get usersService() { return this.deps.usersService; }
  protected get seatAllocationService() { return this.deps.seatAllocationService; }
  protected get sagaModel() { return this.deps.sagaModel; }
  protected get paypalService() { return this.deps.paypalService; }
}
