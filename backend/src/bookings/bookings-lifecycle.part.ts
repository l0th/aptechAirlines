import { Model } from 'mongoose';
import { BookingDocument } from './bookings.schema';
import { FlightsService } from '../flights/flights.service';
import { UsersService } from '../users/users.service';
import { PoliciesService } from '../policies/policies.service';
import { AirportsService } from '../airports/airports.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { MailService } from '../mail/mail.service';
import { PaypalService } from '../paypal/paypal.service';
import { AllocatedRefundItem } from './refund-allocation.util';

export interface BookingsLifecycleDependencies {
  bookingModel: Model<BookingDocument>;
  flightsService: FlightsService;
  usersService: UsersService;
  policiesService: PoliciesService;
  airportsService?: AirportsService;
  seatAllocationService?: SeatAllocationService;
  mailService?: MailService;
  paypalService?: PaypalService;
}

export interface BookingsLifecycleBridge {
  generateCode(prefix: string): string;
  getEarliestDeparture(booking: BookingDocument): Promise<Date>;
  executePostCommitRefunds(
    bookingId: any,
    refundAllocations: AllocatedRefundItem[],
    pnrCode: string,
  ): Promise<void>;
  releaseSeatsForCouponsStrict(passengerCount: number, coupons: any[]): Promise<void>;
}

export abstract class BookingsLifecyclePart {
  protected constructor(
    protected readonly deps: BookingsLifecycleDependencies,
    protected readonly bridge: BookingsLifecycleBridge,
  ) {}

  protected get bookingModel() { return this.deps.bookingModel; }
  protected get flightsService() { return this.deps.flightsService; }
  protected get usersService() { return this.deps.usersService; }
  protected get policiesService() { return this.deps.policiesService; }
  protected get airportsService() { return this.deps.airportsService; }
  protected get seatAllocationService() { return this.deps.seatAllocationService; }
  protected get mailService() { return this.deps.mailService; }
  protected get paypalService() { return this.deps.paypalService; }
}
