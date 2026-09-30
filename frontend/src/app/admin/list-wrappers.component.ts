import { Component } from '@angular/core';import { AdminListComponent } from './list-pages.component';
@Component({standalone:true,imports:[AdminListComponent],template:`<app-admin-list kind="bookings" title="Bookings"/>`})export class BookingsAdminComponent{}
@Component({standalone:true,imports:[AdminListComponent],template:`<app-admin-list kind="users" title="Users"/>`})export class UsersAdminComponent{}
@Component({standalone:true,imports:[AdminListComponent],template:`<app-admin-list kind="flights" title="Flights"/>`})export class FlightsAdminComponent{}
@Component({standalone:true,imports:[AdminListComponent],template:`<app-admin-list kind="airports" title="Airports"/>`})export class AirportsAdminComponent{}
