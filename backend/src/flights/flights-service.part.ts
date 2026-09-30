import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { AirportsService } from '../airports/airports.service';
import { BookingDocument } from '../bookings/bookings.schema';
import { MailService } from '../mail/mail.service';
import { PaypalService } from '../paypal/paypal.service';
import { ReferenceService } from '../reference/reference.service';
import { RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService } from '../reference/route-schedule-validator.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { UsersService } from '../users/users.service';
import { FlightDocument } from './flights.schema';

export interface FlightsServiceDependencies {
  flightModel: Model<FlightDocument>;
  bookingModel: Model<BookingDocument>;
  airportsService: AirportsService;
  referenceService: ReferenceService;
  usersService: UsersService;
  routeGraphService?: RouteGraphService;
  routeScheduleValidatorService?: RouteScheduleValidatorService;
  seatAllocationService?: SeatAllocationService;
  mailService?: MailService;
  paypalService?: PaypalService;
}

export interface FlightsServiceBridge {
  findById: (...args: any[]) => any;
  getAirportTimeZone: (...args: any[]) => any;
  updateAvailableSeats: (...args: any[]) => any;
  cancelBookingsForFlight: (...args: any[]) => any;
  findDirectFlights: (...args: any[]) => any;
  findConnectingRoutes: (...args: any[]) => any;
}

/** Shared dependency holder for the split FlightsService implementation. */
export abstract class FlightsServicePart {
  protected readonly logger = new Logger('FlightsService');
  protected get flightModel() { return this.deps.flightModel; }
  protected get bookingModel() { return this.deps.bookingModel; }
  protected get airportsService() { return this.deps.airportsService; }
  protected get referenceService() { return this.deps.referenceService; }
  protected get usersService() { return this.deps.usersService; }
  protected get routeGraphService() { return this.deps.routeGraphService; }
  protected get routeScheduleValidatorService() { return this.deps.routeScheduleValidatorService; }
  protected get seatAllocationService() { return this.deps.seatAllocationService; }
  protected get mailService() { return this.deps.mailService; }
  protected get paypalService() { return this.deps.paypalService; }

  protected constructor(protected readonly deps: FlightsServiceDependencies) {}
}
