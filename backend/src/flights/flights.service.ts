import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirportsService } from '../airports/airports.service';
import { Booking, BookingDocument } from '../bookings/bookings.schema';
import { MailService } from '../mail/mail.service';
import { PaypalService } from '../paypal/paypal.service';
import { ReferenceService } from '../reference/reference.service';
import { RouteGraphService } from '../reference/route-graph.service';
import { RouteScheduleValidatorService } from '../reference/route-schedule-validator.service';
import { SeatAllocationService } from '../seat-allocation/seat-allocation.service';
import { UsersService } from '../users/users.service';
import { FlightsAdminService } from './flights-admin.service';
import { FlightsAirlabsService } from './flights-airlabs.service';
import { FlightsInventoryService } from './flights-inventory.service';
import { FlightsNetworkService } from './flights-network.service';
import { FlightsRouteQueryService } from './flights-route-query.service';
import { FlightsSearchService } from './flights-search.service';
import { FlightsServiceBridge, FlightsServiceDependencies } from './flights-service.part';
import { Flight, FlightDocument } from './flights.schema';

/**
 * Stable public facade for flight operations.
 *
 * The implementation is split by responsibility so no individual service grows into
 * a multi-thousand-line maintenance hotspot. Constructor shape and public methods are
 * intentionally preserved because several tests and consumers instantiate FlightsService
 * directly.
 */
@Injectable()
export class FlightsService {
  private readonly adminService: FlightsAdminService;
  private readonly inventoryService: FlightsInventoryService;
  private readonly routeQueryService: FlightsRouteQueryService;
  private readonly searchService: FlightsSearchService;
  private readonly networkService: FlightsNetworkService;
  private readonly airlabsService: FlightsAirlabsService;

  constructor(
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly airportsService: AirportsService,
    private readonly referenceService: ReferenceService,
    private readonly usersService: UsersService,
    @Optional() private readonly routeGraphService?: RouteGraphService,
    @Optional() private readonly routeScheduleValidatorService?: RouteScheduleValidatorService,
    @Optional() private readonly seatAllocationService?: SeatAllocationService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly paypalService?: PaypalService,
  ) {
    const self = this;
    const deps: FlightsServiceDependencies = {
      get flightModel() { return self.flightModel; },
      get bookingModel() { return self.bookingModel; },
      get airportsService() { return self.airportsService; },
      get referenceService() { return self.referenceService; },
      get usersService() { return self.usersService; },
      get routeGraphService() { return self.routeGraphService; },
      get routeScheduleValidatorService() { return self.routeScheduleValidatorService; },
      get seatAllocationService() { return self.seatAllocationService; },
      get mailService() { return self.mailService; },
      get paypalService() { return self.paypalService; },
    };

    const bridge: FlightsServiceBridge = {
      findById: (...args) => this.findById(...args as Parameters<FlightsAdminService['findById']>),
      getAirportTimeZone: (...args) => this.getAirportTimeZone(...args as Parameters<FlightsAdminService['getAirportTimeZone']>),
      updateAvailableSeats: (...args) => this.updateAvailableSeats(...args as Parameters<FlightsInventoryService['updateAvailableSeats']>),
      cancelBookingsForFlight: (...args) => this.cancelBookingsForFlight(...args as Parameters<FlightsAdminService['cancelBookingsForFlight']>),
      findDirectFlights: (...args) => this.findDirectFlights(...args as Parameters<FlightsRouteQueryService['findDirectFlights']>),
      findConnectingRoutes: (...args) => this.findConnectingRoutes(...args as Parameters<FlightsRouteQueryService['findConnectingRoutes']>),
    };

    this.inventoryService = new FlightsInventoryService(deps, bridge);
    this.routeQueryService = new FlightsRouteQueryService(deps);
    this.networkService = new FlightsNetworkService(deps, bridge);
    this.adminService = new FlightsAdminService(deps, bridge);
    this.searchService = new FlightsSearchService(deps, this.networkService, bridge);
    this.airlabsService = new FlightsAirlabsService(deps, bridge);
  }

  findAll(...args: Parameters<FlightsAdminService['findAll']>) { return this.adminService.findAll(...args); }
  findById(...args: Parameters<FlightsAdminService['findById']>) { return this.adminService.findById(...args); }
  getAirportTimeZone(...args: Parameters<FlightsAdminService['getAirportTimeZone']>) { return this.adminService.getAirportTimeZone(...args); }
  findByFlightNumberAndDate(...args: Parameters<FlightsAdminService['findByFlightNumberAndDate']>) { return this.adminService.findByFlightNumberAndDate(...args); }
  create(...args: Parameters<FlightsAdminService['create']>) { return this.adminService.create(...args); }
  update(...args: Parameters<FlightsAdminService['update']>) { return this.adminService.update(...args); }
  deleteFlight(...args: Parameters<FlightsAdminService['deleteFlight']>) { return this.adminService.deleteFlight(...args); }
  updateStatus(...args: Parameters<FlightsAdminService['updateStatus']>) { return this.adminService.updateStatus(...args); }
  cancelBookingsForFlight(...args: Parameters<FlightsAdminService['cancelBookingsForFlight']>) { return this.adminService.cancelBookingsForFlight(...args); }
  delete(...args: Parameters<FlightsAdminService['delete']>) { return this.adminService.delete(...args); }

  updateAvailableSeats(...args: Parameters<FlightsInventoryService['updateAvailableSeats']>) { return this.inventoryService.updateAvailableSeats(...args); }
  reserveSeats(...args: Parameters<FlightsInventoryService['reserveSeats']>) { return this.inventoryService.reserveSeats(...args); }
  compensateInventoryReservation(...args: Parameters<FlightsInventoryService['compensateInventoryReservation']>) { return this.inventoryService.compensateInventoryReservation(...args); }
  restoreSeatsWithSaga(...args: Parameters<FlightsInventoryService['restoreSeatsWithSaga']>) { return this.inventoryService.restoreSeatsWithSaga(...args); }
  getSeatMap(...args: Parameters<FlightsInventoryService['getSeatMap']>) { return this.inventoryService.getSeatMap(...args); }

  searchFlights(...args: Parameters<FlightsSearchService['searchFlights']>) { return this.searchService.searchFlights(...args); }

  private findDirectFlights(...args: Parameters<FlightsRouteQueryService['findDirectFlights']>) { return this.routeQueryService.findDirectFlights(...args); }
  private findConnectingRoutes(...args: Parameters<FlightsRouteQueryService['findConnectingRoutes']>) { return this.routeQueryService.findConnectingRoutes(...args); }

  discoverNetworkRoutes(...args: Parameters<FlightsNetworkService['discoverNetworkRoutes']>) { return this.networkService.discoverNetworkRoutes(...args); }
  discoverCommercialNetwork(...args: Parameters<FlightsNetworkService['discoverCommercialNetwork']>) { return this.networkService.discoverCommercialNetwork(...args); }
  getNearbyAvailability(...args: Parameters<FlightsNetworkService['getNearbyAvailability']>) { return this.networkService.getNearbyAvailability(...args); }

  syncFromAirLabs(...args: Parameters<FlightsAirlabsService['syncFromAirLabs']>) { return this.airlabsService.syncFromAirLabs(...args); }
  greatCircleMiles(...args: Parameters<FlightsAirlabsService['greatCircleMiles']>) { return this.airlabsService.greatCircleMiles(...args); }
  enrichAircraftFromAirLabs(...args: Parameters<FlightsAirlabsService['enrichAircraftFromAirLabs']>) { return this.airlabsService.enrichAircraftFromAirLabs(...args); }
  getAirlineFleet(...args: Parameters<FlightsAirlabsService['getAirlineFleet']>) { return this.airlabsService.getAirlineFleet(...args); }
  enrichAirborneFlightsForToday(...args: Parameters<FlightsAirlabsService['enrichAirborneFlightsForToday']>) { return this.airlabsService.enrichAirborneFlightsForToday(...args); }
}
