import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SeatMapModalComponent } from '../../shared/components/seat-map-modal/seat-map-modal.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { User, UserRole } from '../../core/models/user.model';
import {
  FlightSearchResult,
  FormattedFlightResult,
  ConnectingRouteOption,
  ConnectingLeg,
  CabinClass,
  FlightInventory,
  FlightStatus,
} from '../../core/models/flight.model';
import {
  Booking,
  BookingStatus,
  BookingType,
  PassengerType,
  PassengerInput,
  FlightLegSelection,
} from '../../core/models/booking.model';

interface StaffPassengerForm {
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport: string;
  nationality: string;
  date_of_birth: string;
  outbound_seat: string;
  return_seat: string;
}

@Component({
  selector: 'app-reservation-desk',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    SeatMapModalComponent,
    CurrencyFormatPipe,
  ],
  template: `
    <div class="space-y-6">
      <!-- Top Title & Mode Selector -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.reservationDesk.title') }}</h1>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 uppercase">
              {{ lang.t('admin.reservationDesk.staffOnly') }}
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">{{ lang.t('admin.reservationDesk.subtitle') }}</p>
        </div>

        <!-- Mode Toggle Tabs -->
        <div class="flex items-center p-1 bg-slate-200/80 rounded-2xl border border-slate-300/60">
          <button
            type="button"
            (click)="setMode('NEW_BOOKING')"
            [ngClass]="deskMode() === 'NEW_BOOKING' ? 'bg-navy text-white shadow-md' : 'text-slate-600 hover:text-navy'"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <app-icon name="usercheck" class="w-3.5 h-3.5" />
            <span>{{ lang.t('admin.reservationDesk.modeNewBooking') }}</span>
          </button>
          <button
            type="button"
            (click)="setMode('RESCHEDULE')"
            [ngClass]="deskMode() === 'RESCHEDULE' ? 'bg-navy text-white shadow-md' : 'text-slate-600 hover:text-navy'"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <app-icon name="calendar" class="w-3.5 h-3.5" />
            <span>{{ lang.t('admin.reservationDesk.modeReschedule') }}</span>
          </button>
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- MODE 1: NEW RESERVATION ON BEHALF OF CUSTOMER (STEP-BY-STEP WORKFLOW)    -->
      <!-- ========================================================================= -->
      @if (deskMode() === 'NEW_BOOKING') {
        
        <!-- STEP 1: SELECT REGISTERED CUSTOMER -->
        <div class="card-luxury p-6 border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs flex items-center justify-center font-mono">1</span>
              <span>{{ lang.t('admin.reservationDesk.stepCustomer') }}</span>
            </h2>
            @if (selectedCustomer()) {
              <button
                type="button"
                (click)="selectedCustomer.set(null)"
                class="btn-outline-navy !py-1 !px-3 text-xs"
              >
                {{ lang.t('admin.reservationDesk.changeCustomer') }}
              </button>
            }
          </div>

          @if (!selectedCustomer()) {
            <!-- Customer Search Input -->
            <div class="space-y-4">
              <div class="flex flex-col sm:flex-row gap-3">
                <div class="relative flex-1">
                  <app-icon name="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    [(ngModel)]="customerSearchQuery"
                    (keyup.enter)="searchCustomers()"
                    [placeholder]="lang.t('admin.reservationDesk.searchCustomerPlaceholder')"
                    class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                </div>
                <button
                  type="button"
                  (click)="searchCustomers()"
                  [disabled]="searchingCustomers()"
                  class="btn-navy !py-2 !px-5 text-xs font-bold"
                >
                  @if (searchingCustomers()) {
                    <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                  } @else {
                    <app-icon name="search" class="w-3.5 h-3.5" />
                  }
                  <span>{{ lang.t('admin.reservationDesk.searchBtn') }}</span>
                </button>
              </div>

              <!-- Customer Search Results -->
              @if (customerList().length > 0) {
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  @for (cust of customerList(); track cust._id) {
                    <div
                      (click)="selectCustomer(cust)"
                      class="p-4 rounded-2xl border border-slate-200 hover:border-gold hover:shadow-md bg-white cursor-pointer transition-all flex flex-col justify-between group"
                    >
                      <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-amber-50 text-navy group-hover:text-amber-600 flex items-center justify-center shrink-0 transition-colors">
                          <app-icon name="user" class="w-5 h-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="font-bold text-xs text-navy truncate">
                            {{ cust.first_name }} {{ cust.last_name }}
                          </div>
                          <div class="text-[11px] text-slate-500 font-mono truncate">@{{ cust.username }}</div>
                          <div class="text-[11px] text-slate-400 truncate">{{ cust.email }}</div>
                          @if (cust.phone_number) {
                            <div class="text-[11px] text-slate-500 mt-0.5">{{ cust.phone_number }}</div>
                          }
                        </div>
                      </div>
                      <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span class="text-amber-700 font-bold font-mono">
                          {{ cust.sky_miles | number }} {{ lang.t('nav.miles') }}
                        </span>
                        <span class="text-navy group-hover:text-gold font-bold flex items-center gap-1">
                          <span>{{ lang.t('admin.reservationDesk.select') }}</span>
                          <app-icon name="arrowright" class="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  }
                </div>
              } @else if (!searchingCustomers()) {
                <div class="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                  {{ lang.t('admin.reservationDesk.noCustomersFound') }}
                </div>
              }
            </div>
          } @else {
            <!-- Selected Customer Card -->
            <div class="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-navy text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-full bg-gold/20 border border-gold text-gold flex items-center justify-center shrink-0">
                  <app-icon name="usercheck" class="w-6 h-6" />
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="font-bold text-base text-white">
                      {{ selectedCustomer()?.first_name }} {{ selectedCustomer()?.last_name }}
                    </h3>
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-white/10 text-amber-400">
                      @{{ selectedCustomer()?.username }}
                    </span>
                  </div>
                  <div class="text-xs text-slate-300 flex flex-wrap items-center gap-3 mt-1">
                    <span>{{ lang.t('admin.reservationDesk.emailLabel') }} {{ selectedCustomer()?.email }}</span>
                    <span>•</span>
                    <span>{{ selectedCustomer()?.phone_number || lang.t('admin.reservationDesk.noPhone') }}</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-4 bg-white/10 px-4 py-2.5 rounded-xl border border-white/15">
                <div>
                  <div class="text-[10px] text-slate-300 uppercase tracking-wider">{{ lang.t('admin.reservationDesk.milesBalance') }}</div>
                  <div class="text-base font-black font-mono text-gold">
                    {{ selectedCustomer()?.sky_miles | number }} {{ lang.t('nav.miles') }}
                  </div>
                </div>
                @if (selectedCustomer()?.preferred_credit_card) {
                  <div class="border-l border-white/20 pl-4">
                    <div class="text-[10px] text-slate-300 uppercase tracking-wider">{{ lang.t('profile.creditCard') }}</div>
                    <div class="text-xs font-mono text-white">
                      **** {{ selectedCustomer()?.preferred_credit_card?.slice(-4) }}
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        @if (selectedCustomer()) {
          <!-- STEP 2: TRIP SEARCH -->
          <div class="card-luxury p-6 border-slate-200">
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs flex items-center justify-center font-mono">2</span>
                <span>{{ lang.t('admin.reservationDesk.stepSearch') }}</span>
              </h2>
              
              <!-- Trip Type Toggle -->
              <div class="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  (click)="isRoundTrip.set(false)"
                  [ngClass]="!isRoundTrip() ? 'bg-navy text-white font-bold' : 'bg-slate-100 text-slate-600'"
                  class="px-3 py-1 rounded-full transition-colors"
                >
                  {{ lang.t('search.oneWay') }}
                </button>
                <button
                  type="button"
                  (click)="isRoundTrip.set(true)"
                  [ngClass]="isRoundTrip() ? 'bg-navy text-white font-bold' : 'bg-slate-100 text-slate-600'"
                  class="px-3 py-1 rounded-full transition-colors"
                >
                  {{ lang.t('search.roundTrip') }}
                </button>
              </div>
            </div>

            <!-- Search Form Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <!-- Origin -->
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.origin') }}</label>
                <div class="relative">
                  <app-icon name="mappin" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    [(ngModel)]="searchOrigin"
                    placeholder="HAN, SGN, Da Nang..."
                    class="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs uppercase font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                </div>
              </div>

              <!-- Destination -->
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.destination') }}</label>
                <div class="relative">
                  <app-icon name="mappin" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    [(ngModel)]="searchDest"
                    placeholder="SGN, HAN, SIN..."
                    class="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs uppercase font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                </div>
              </div>

              <!-- Departure Date -->
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.departureDate') }}</label>
                <input
                  type="date"
                  [(ngModel)]="searchDepartureDate"
                  [min]="minDateStr"
                  [max]="maxDateStr"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>

              <!-- Return Date (if round-trip) -->
              @if (isRoundTrip()) {
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.returnDate') }}</label>
                  <input
                    type="date"
                    [(ngModel)]="searchReturnDate"
                    [min]="searchDepartureDate || minDateStr"
                    [max]="maxDateStr"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                  />
                </div>
              }

              <!-- Cabin Class -->
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.cabinClass') }}</label>
                <select
                  [(ngModel)]="searchCabin"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  <option value="ECONOMY">{{ lang.t('search.economy') }}</option>
                  <option value="BUSINESS">{{ lang.t('search.business') }}</option>
                  <option value="FIRST">{{ lang.t('search.first') }}</option>
                </select>
              </div>

              <!-- Passenger Counts -->
              <div class="lg:col-span-2 flex items-center gap-3">
                <div class="flex-1">
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.adults') }}</label>
                  <input
                    type="number"
                    min="1"
                    [(ngModel)]="adultCount"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div class="flex-1">
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.children') }}</label>
                  <input
                    type="number"
                    min="0"
                    [(ngModel)]="childCount"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div class="flex-1">
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('search.seniors') }}</label>
                  <input
                    type="number"
                    min="0"
                    [(ngModel)]="seniorCount"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <!-- Submit Search Button -->
              <div class="flex items-end">
                <button
                  type="button"
                  (click)="searchFlightsForCustomer()"
                  [disabled]="searchingFlights()"
                  class="btn-gold w-full !py-2 text-xs font-bold"
                >
                  @if (searchingFlights()) {
                    <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                    <span>{{ lang.t('common.loading') }}</span>
                  } @else {
                    <app-icon name="plane" class="w-4 h-4" />
                    <span>{{ lang.t('search.searchFlights') }}</span>
                  }
                </button>
              </div>
            </div>
          </div>

          <!-- STEP 3: FLIGHT RESULTS SELECTION -->
          @if (flightResults()) {
            <div class="card-luxury p-6 border-slate-200 space-y-6">
              <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs flex items-center justify-center font-mono">3</span>
                  <span>{{ lang.t('admin.reservationDesk.stepSelectFlight') }}</span>
                </h2>
                <div class="text-xs text-slate-500">
                  {{ (flightResults()?.onward_flights?.length || 0) + (flightResults()?.connecting_routes?.length || 0) }} {{ lang.t('results.flightsFound') }}
                </div>
              </div>

              <!-- OUTBOUND FLIGHT OPTIONS -->
              <div>
                <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <app-icon name="planetakeoff" class="w-4 h-4 text-amber-500" />
                  <span>{{ lang.t('results.outbound') }}: {{ searchOrigin }} → {{ searchDest }}</span>
                </h3>

                <div class="space-y-3">
                  <!-- Direct flights -->
                  @for (f of flightResults()?.onward_flights; track f.flight_id) {
                    <div
                      (click)="selectOutboundDirect(f)"
                      [ngClass]="selectedOutbound()?.flight_id === f.flight_id ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                      class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-navy text-gold flex flex-col items-center justify-center font-mono font-bold text-xs shrink-0">
                          <span>{{ f.flight_number }}</span>
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-navy text-sm">{{ f.origin_iata }}</span>
                            <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                            <span class="font-bold text-navy text-sm">{{ f.dest_iata }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                              {{ lang.t('results.direct') }}
                            </span>
                          </div>
                          <div class="text-xs text-slate-500 mt-0.5">
                            {{ f.scheduled_departure | date: 'HH:mm' }} – {{ f.scheduled_arrival | date: 'HH:mm' }} • {{ f.duration_minutes }}m • {{ f.aircraft?.model_name || 'Airbus A321' }}
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center justify-between md:justify-end gap-6">
                        <div class="text-right">
                          <div class="text-[11px] text-slate-500">
                            {{ f.available_seats }} {{ lang.t('results.seatsLeft') }} ({{ searchCabin }})
                          </div>
                          <div class="text-base font-black font-mono text-navy">
                            {{ f.total_party_price | currencyFormat }}
                          </div>
                          <div class="text-[10px] text-slate-400">
                            {{ f.base_price_per_adult | currencyFormat }}{{ lang.t('admin.reservationDesk.perAdult') }}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                          [ngClass]="selectedOutbound()?.flight_id === f.flight_id ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                        >
                          {{ selectedOutbound()?.flight_id === f.flight_id ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                        </button>
                      </div>
                    </div>
                  }

                  <!-- Connecting routes -->
                  @for (c of flightResults()?.connecting_routes; track $index) {
                    <div
                      (click)="selectOutboundConnecting(c)"
                      [ngClass]="selectedOutboundConnectingRoute() === c ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                      class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-slate-800 text-gold flex flex-col items-center justify-center font-mono font-bold text-[10px] shrink-0">
                          <span>{{ lang.t('results.transit') }}</span>
                          <span>{{ c.legs.length || 2 }} {{ lang.t('admin.reservationDesk.legsCount') }}</span>
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-navy text-sm">{{ c.legs[0].origin_iata }}</span>
                            <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                            <span class="font-bold text-navy text-sm">{{ c.legs[c.legs.length - 1].dest_iata }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                              {{ lang.t('admin.reservationDesk.viaTransit') }} {{ c.transit_airport || c.legs[0].dest_iata }} ({{ c.total_duration_minutes }}m)
                            </span>
                          </div>
                          <div class="text-xs text-slate-500 mt-0.5">
                            {{ c.legs[0].flight_number }} + {{ c.legs[1]?.flight_number }} • {{ lang.t('admin.reservationDesk.totalLabel') }} {{ getConnectingPartyPrice(c) | currencyFormat }}
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center justify-between md:justify-end gap-6">
                        <div class="text-right">
                          <div class="text-base font-black font-mono text-navy">
                            {{ getConnectingPartyPrice(c) | currencyFormat }}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                          [ngClass]="selectedOutboundConnectingRoute() === c ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                        >
                          {{ selectedOutboundConnectingRoute() === c ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>

              <!-- RETURN FLIGHT OPTIONS (IF ROUND TRIP) -->
              @if (isRoundTrip() && ((flightResults()?.return_flights?.length || 0) > 0 || (flightResults()?.return_connecting_routes?.length || 0) > 0)) {
                <div class="pt-4 border-t border-slate-100">
                  <h3 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <app-icon name="planelanding" class="w-4 h-4 text-emerald-600" />
                    <span>{{ lang.t('results.return') }}: {{ searchDest }} → {{ searchOrigin }}</span>
                  </h3>

                  <div class="space-y-3">
                    <!-- Direct return flights -->
                    @for (rf of flightResults()?.return_flights; track rf.flight_id) {
                      <div
                        (click)="selectReturnDirect(rf)"
                        [ngClass]="selectedReturn()?.flight_id === rf.flight_id ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                        class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div class="flex items-center gap-4">
                          <div class="w-12 h-12 rounded-xl bg-navy text-gold flex flex-col items-center justify-center font-mono font-bold text-xs shrink-0">
                            <span>{{ rf.flight_number }}</span>
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <span class="font-bold text-navy text-sm">{{ rf.origin_iata }}</span>
                              <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                              <span class="font-bold text-navy text-sm">{{ rf.dest_iata }}</span>
                              <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                                {{ lang.t('results.direct') }}
                              </span>
                            </div>
                            <div class="text-xs text-slate-500 mt-0.5">
                              {{ rf.scheduled_departure | date: 'HH:mm' }} – {{ rf.scheduled_arrival | date: 'HH:mm' }} • {{ rf.duration_minutes }}m
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center justify-between md:justify-end gap-6">
                          <div class="text-right">
                            <div class="text-[11px] text-slate-500">
                              {{ rf.available_seats }} {{ lang.t('results.seatsLeft') }} ({{ searchCabin }})
                            </div>
                            <div class="text-base font-black font-mono text-navy">
                              {{ rf.total_party_price | currencyFormat }}
                            </div>
                            <div class="text-[10px] text-slate-400">
                              {{ rf.base_price_per_adult | currencyFormat }}{{ lang.t('admin.reservationDesk.perAdult') }}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                            [ngClass]="selectedReturn()?.flight_id === rf.flight_id ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ selectedReturn()?.flight_id === rf.flight_id ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                          </button>
                        </div>
                      </div>
                    }

                    <!-- Connecting return routes -->
                    @for (rc of flightResults()?.return_connecting_routes; track $index) {
                      <div
                        (click)="selectReturnConnecting(rc)"
                        [ngClass]="selectedReturnConnectingRoute() === rc ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                        class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div class="flex items-center gap-4">
                          <div class="w-12 h-12 rounded-xl bg-slate-800 text-gold flex flex-col items-center justify-center font-mono font-bold text-[10px] shrink-0">
                            <span>{{ lang.t('results.transit') }}</span>
                            <span>{{ rc.legs.length || 2 }} {{ lang.t('admin.reservationDesk.legsCount') }}</span>
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <span class="font-bold text-navy text-sm">{{ rc.legs[0].origin_iata }}</span>
                              <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                              <span class="font-bold text-navy text-sm">{{ rc.legs[rc.legs.length - 1].dest_iata }}</span>
                              <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                                {{ lang.t('admin.reservationDesk.viaTransit') }} {{ rc.transit_airport || rc.legs[0].dest_iata }} ({{ rc.total_duration_minutes }}m)
                              </span>
                            </div>
                            <div class="text-xs text-slate-500 mt-0.5">
                              {{ rc.legs[0].flight_number }} + {{ rc.legs[1]?.flight_number }} • {{ lang.t('admin.reservationDesk.totalLabel') }} {{ getConnectingPartyPrice(rc) | currencyFormat }}
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center justify-between md:justify-end gap-6">
                          <div class="text-right">
                            <div class="text-base font-black font-mono text-navy">
                              {{ getConnectingPartyPrice(rc) | currencyFormat }}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                            [ngClass]="selectedReturnConnectingRoute() === rc ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ selectedReturnConnectingRoute() === rc ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }

          <!-- STEP 4: PASSENGER INFORMATION & SEAT SELECTION -->
          @if (hasSelectedFlights()) {
            <div class="card-luxury p-6 border-slate-200 space-y-6">
              <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs flex items-center justify-center font-mono">4</span>
                  <span>{{ lang.t('admin.reservationDesk.stepPassengers') }}</span>
                </h2>
                <div class="text-xs text-slate-500 font-semibold">
                  {{ passengersList().length }} {{ lang.t('admin.bookings.passengersCount') }}
                </div>
              </div>

              <!-- Passengers Form Roster -->
              <div class="space-y-4">
                @for (p of passengersList(); track $index) {
                  <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div class="flex items-center justify-between pb-2 border-b border-slate-200/60">
                      <span class="text-xs font-bold text-navy uppercase tracking-wider">
                        {{ lang.t('booking.passenger') }} {{ $index + 1 }} ({{ p.passenger_type }})
                      </span>
                      <div class="flex items-center gap-2">
                        @if (p.outbound_seat) {
                          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            {{ lang.t('admin.reservationDesk.outboundSeatLabel') }}: {{ p.outbound_seat }}
                          </span>
                        }
                        <button
                          type="button"
                          (click)="openSeatMap($index)"
                          class="btn-outline-gold !py-1 !px-3 text-xs"
                        >
                          <app-icon name="armchair" class="w-3.5 h-3.5" />
                          <span>{{ p.outbound_seat ? lang.t('admin.reservationDesk.changeOutboundSeat') : lang.t('admin.reservationDesk.selectOutboundSeat') }}</span>
                        </button>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.lastName') }} *</label>
                        <input
                          type="text"
                          [(ngModel)]="p.last_name"
                          placeholder="NGUYEN"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs uppercase"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.firstName') }} *</label>
                        <input
                          type="text"
                          [(ngModel)]="p.first_name"
                          placeholder="VAN AN"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs uppercase"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.idPassport') }} *</label>
                        <input
                          type="text"
                          [(ngModel)]="p.id_card_or_passport"
                          placeholder="001200001234"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.dob') }} {{ lang.t('admin.reservationDesk.optional') }}</label>
                        <input
                          type="date"
                          [(ngModel)]="p.date_of_birth"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- STEP 5: HOLD (BLOCK) OR BUY (RESERVE) -->
            <div class="card-luxury p-6 border-slate-200 space-y-6">
              <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs flex items-center justify-center font-mono">5</span>
                  <span>{{ lang.t('admin.reservationDesk.stepFinalize') }}</span>
                </h2>
                <div class="text-right">
                  <span class="text-xs text-slate-500 block">{{ lang.t('results.totalParty') }}</span>
                  <span class="text-xl font-black font-mono text-navy">{{ calculatedTotalPartyPrice() | currencyFormat }}</span>
                </div>
              </div>

              <!-- Action Split Cards: Hold vs Buy -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Option A: Hold / Block Ticket (Giữ chỗ 14 ngày) -->
                <div class="p-5 rounded-3xl border border-amber-200 bg-amber-50/40 space-y-3 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                        <app-icon name="clock" class="w-4 h-4" />
                      </span>
                      <h3 class="font-bold text-navy text-sm">{{ lang.t('booking.holdFreeTitle') }}</h3>
                    </div>
                    <p class="text-xs text-slate-600 mt-2">
                      {{ lang.t('admin.reservationDesk.holdDescription') }}
                    </p>
                    
                    @if (canHold()) {
                      <div class="mt-3 p-3 rounded-xl bg-white/80 border border-amber-200 text-xs text-amber-800">
                        {{ lang.t('admin.reservationDesk.holdAllowedNotice') }}
                      </div>
                    } @else {
                      <div class="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                        {{ lang.t('booking.cannotHoldNotice') }}
                      </div>
                    }
                  </div>

                  <button
                    type="button"
                    (click)="submitHoldBooking()"
                    [disabled]="!canHold() || submittingBooking()"
                    class="btn-navy w-full !py-2.5 text-xs font-bold disabled:opacity-50"
                  >
                    @if (submittingBooking()) {
                      <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                    } @else {
                      <app-icon name="clock" class="w-3.5 h-3.5" />
                    }
                    <span>{{ lang.t('admin.reservationDesk.executeHoldBtn') }}</span>
                  </button>
                </div>

                <!-- Option B: Direct Buy / Reserve (Đặt & Xuất vé ngay) -->
                <div class="p-5 rounded-3xl border border-emerald-200 bg-emerald-50/30 space-y-3 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                        <app-icon name="creditcard" class="w-4 h-4" />
                      </span>
                      <h3 class="font-bold text-navy text-sm">{{ lang.t('booking.buyNowTitle') }}</h3>
                    </div>
                    <p class="text-xs text-slate-600 mt-2">
                      {{ lang.t('admin.reservationDesk.buyDescription') }}
                    </p>

                    <!-- Card input for clerk -->
                    <div class="mt-3">
                      <label class="block text-xs font-semibold text-slate-700 mb-1">{{ lang.t('profile.creditCard') }} {{ lang.t('admin.reservationDesk.creditCardDigits') }}</label>
                      <input
                        type="text"
                        [(ngModel)]="paymentCardNumber"
                        placeholder="4111 2222 3333 4444"
                        class="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    (click)="submitDirectPurchase()"
                    [disabled]="submittingBooking()"
                    class="btn-gold w-full !py-2.5 text-xs font-bold disabled:opacity-50"
                  >
                    @if (submittingBooking()) {
                      <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                    } @else {
                      <app-icon name="checkcircle2" class="w-3.5 h-3.5" />
                    }
                    <span>{{ lang.t('admin.reservationDesk.executeBuyBtn') }}</span>
                  </button>
                </div>
              </div>
            </div>
          }
        }
      }

      <!-- ========================================================================= -->
      <!-- MODE 2: STAFF RESCHEDULE WORKFLOW (FOR CONFIRMED BOOKINGS)               -->
      <!-- ========================================================================= -->
      @if (deskMode() === 'RESCHEDULE') {
        <div class="space-y-6">
          <!-- Lookup Booking to Reschedule -->
          <div class="card-luxury p-6 border-slate-200 space-y-4">
            <h2 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
              <app-icon name="search" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('admin.reservationDesk.rescheduleLookupTitle') }}</span>
            </h2>

            <div class="flex flex-col sm:flex-row gap-3">
              <div class="relative flex-1">
                <app-icon name="ticket" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  [(ngModel)]="rescheduleLookupCode"
                  (keyup.enter)="lookupBookingForReschedule()"
                  [placeholder]="lang.t('admin.reservationDesk.rescheduleCodePlaceholder')"
                  class="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
              <button
                type="button"
                (click)="lookupBookingForReschedule()"
                [disabled]="loadingRescheduleBooking()"
                class="btn-navy !py-2 !px-5 text-xs font-bold shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                @if (loadingRescheduleBooking()) {
                  <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                } @else {
                  <app-icon name="search" class="w-3.5 h-3.5" />
                }
                <span>{{ lang.t('admin.reservationDesk.lookupBtn') }}</span>
              </button>
            </div>
          </div>

          <!-- Reschedule Target Details -->
          @if (targetRescheduleBooking()) {
            <div class="card-luxury p-6 border-slate-200 space-y-6">
              <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div class="text-[11px] text-slate-400 uppercase tracking-wide font-mono">{{ lang.t('admin.reservationDesk.currentTicket') }}</div>
                  <div class="text-base font-bold text-navy flex items-center gap-2 mt-0.5">
                    <span>{{ targetRescheduleBooking()?.confirmation_number || targetRescheduleBooking()?.pnr_code }}</span>
                    <span class="badge-status bg-emerald-100 text-emerald-800 border border-emerald-300">
                      {{ targetRescheduleBooking()?.status }}
                    </span>
                  </div>
                  <div class="text-xs text-slate-500 mt-1">
                    {{ lang.t('admin.reservationDesk.customerLabel') }} {{ targetRescheduleCustomerName() }} • {{ targetRescheduleBooking()?.passengers?.length || 1 }} {{ lang.t('admin.reservationDesk.passengers') }} • {{ lang.t('admin.reservationDesk.fareLabel') }} {{ targetRescheduleBooking()?.total_amount | currencyFormat }}
                  </div>
                </div>

                <div class="text-right space-y-1">
                  <div class="text-[11px] text-slate-400 uppercase tracking-wide font-mono">{{ lang.t('admin.reservationDesk.currentRoute') }}</div>
                  @if (targetRescheduleOutbound()) {
                    <div class="text-xs font-bold text-navy">
                      <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 mr-1.5">
                        {{ lang.t('admin.reservationDesk.outboundRoute') }}
                      </span>
                      <span>{{ targetRescheduleOutbound()?.origin_iata }} → {{ targetRescheduleOutbound()?.dest_iata }}</span>
                      <span class="text-[11px] text-slate-500 font-mono ml-2">
                        {{ targetRescheduleOutbound()?.departure_date | date: 'dd/MM/yyyy' }}
                      </span>
                    </div>
                  }
                  @if (isRoundTripReschedule() && targetRescheduleReturn()) {
                    <div class="text-xs font-bold text-navy">
                      <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 mr-1.5">
                        {{ lang.t('admin.reservationDesk.returnRoute') }}
                      </span>
                      <span>{{ targetRescheduleReturn()?.origin_iata }} → {{ targetRescheduleReturn()?.dest_iata }}</span>
                      <span class="text-[11px] text-slate-500 font-mono ml-2">
                        {{ targetRescheduleReturn()?.departure_date | date: 'dd/MM/yyyy' }}
                      </span>
                    </div>
                  }
                </div>
              </div>

              <!-- Outbound Replacement Flight Search -->
              <div class="p-5 rounded-2xl bg-white border border-slate-200 space-y-4">
                <h3 class="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                  <app-icon name="calendar" class="w-4 h-4 text-amber-500" />
                  <span>{{ lang.t('admin.reservationDesk.rescheduleOutboundTitle') }} ({{ targetRescheduleOutbound()?.origin_iata }} → {{ targetRescheduleOutbound()?.dest_iata }})</span>
                </h3>

                <div class="flex flex-col sm:flex-row gap-4 items-end">
                  <div class="flex-1">
                    <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('track.newDepartureDate') }} *</label>
                    <input
                      type="date"
                      [(ngModel)]="rescheduleNewDate"
                      [min]="minDateStr"
                      [max]="maxDateStr"
                      class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>
                  <button
                    type="button"
                    (click)="searchReplacementFlights()"
                    [disabled]="searchingAlternatives() || !rescheduleNewDate"
                    class="btn-navy !py-2 text-xs font-bold shrink-0 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                  >
                    @if (searchingAlternatives()) {
                      <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                    } @else {
                      <app-icon name="search" class="w-3.5 h-3.5" />
                    }
                    <span>{{ lang.t('track.searchAlternatives') }}</span>
                  </button>
                </div>

                <!-- Outbound Alternative Flights List -->
                @if (!outboundIsConnectingReschedule() && alternativeFlights().length > 0) {
                  <div class="space-y-3 pt-2">
                    <h4 class="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      {{ lang.t('track.availableFlights') }} ({{ alternativeFlights().length }})
                    </h4>

                    @for (alt of alternativeFlights(); track alt.flight_id) {
                      <div
                        (click)="selectedReplacementFlight.set(alt); selectedReplacementConnectingRoute.set(null)"
                        [ngClass]="selectedReplacementFlight()?.flight_id === alt.flight_id ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                        class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                      >
                        <div class="flex items-center gap-3">
                          <div class="w-10 h-10 rounded-xl bg-navy text-gold flex items-center justify-center font-mono font-bold text-xs shrink-0">
                            {{ alt.flight_number }}
                          </div>
                          <div>
                            <div class="text-xs font-bold text-navy">
                              {{ alt.origin_iata }} → {{ alt.dest_iata }}
                              <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                                {{ lang.t('results.direct') }}
                              </span>
                            </div>
                            <div class="text-[11px] text-slate-500">
                              {{ alt.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }} • {{ alt.duration_minutes }}m • {{ alt.aircraft?.model_name || 'A321' }}
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center gap-4">
                          <div class="text-right">
                            <div class="text-xs font-bold font-mono text-navy">
                              {{ alt.available_seats }} {{ lang.t('results.seatsLeft') }}
                            </div>
                            <div class="text-[11px] text-slate-500 font-mono">
                              {{ lang.t('admin.reservationDesk.fareLabel') }} {{ alt.base_price_per_adult | currencyFormat }}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                            [ngClass]="selectedReplacementFlight()?.flight_id === alt.flight_id ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ selectedReplacementFlight()?.flight_id === alt.flight_id ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- Outbound Alternative Connecting Routes List -->
                @if (outboundIsConnectingReschedule() && alternativeConnectingRoutes().length > 0) {
                  <div class="space-y-3 pt-2">
                    <h4 class="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      {{ lang.t('results.transit') }} ({{ alternativeConnectingRoutes().length }})
                    </h4>

                    @for (cr of alternativeConnectingRoutes(); track $index) {
                      <div
                        (click)="selectedReplacementConnectingRoute.set(cr); selectedReplacementFlight.set(null)"
                        [ngClass]="selectedReplacementConnectingRoute() === cr ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                        class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                      >
                        <div class="flex items-center gap-3">
                          <div class="w-10 h-10 rounded-xl bg-slate-800 text-gold flex flex-col items-center justify-center font-mono font-bold text-[9px] shrink-0">
                            <span>{{ lang.t('results.transit') }}</span>
                            <span>{{ cr.legs.length || 2 }}</span>
                          </div>
                          <div>
                            <div class="text-xs font-bold text-navy">
                              {{ cr.legs[0].origin_iata }} → {{ cr.legs[cr.legs.length - 1].dest_iata }}
                              <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                                {{ lang.t('admin.reservationDesk.viaTransit') }} {{ cr.transit_airport || cr.legs[0].dest_iata }} ({{ cr.total_duration_minutes }}m)
                              </span>
                            </div>
                            <div class="text-[11px] text-slate-500">
                              {{ cr.legs[0].flight_number }} + {{ cr.legs[1]?.flight_number }}
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center gap-4">
                          <div class="text-right">
                            <div class="text-xs font-bold font-mono text-navy">
                              {{ getConnectingPartyPrice(cr) | currencyFormat }}
                            </div>
                          </div>
                          <button
                            type="button"
                            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                            [ngClass]="selectedReplacementConnectingRoute() === cr ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ selectedReplacementConnectingRoute() === cr ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }

                @if (searchedAlternatives() && ((!outboundIsConnectingReschedule() && !alternativeFlights().length) || (outboundIsConnectingReschedule() && !alternativeConnectingRoutes().length))) {
                  <div class="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                    {{ lang.t('track.noAlternativesFound') }}
                  </div>
                }
              </div>

              <!-- Return Leg Reschedule Section (For Round-Trip bookings) -->
              @if (isRoundTripReschedule() && targetRescheduleReturn()) {
                <div class="p-5 rounded-2xl bg-white border border-slate-200 space-y-4">
                  <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <h3 class="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                      <app-icon name="planelanding" class="w-4 h-4 text-emerald-600" />
                      <span>{{ lang.t('admin.reservationDesk.rescheduleReturnTitle') }} ({{ targetRescheduleReturn()?.origin_iata }} → {{ targetRescheduleReturn()?.dest_iata }})</span>
                    </h3>

                    <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        [checked]="keepReturnLeg()"
                        (change)="keepReturnLeg.set(!keepReturnLeg())"
                        class="rounded text-gold focus:ring-gold"
                      />
                      <span>{{ lang.t('admin.reservationDesk.keepReturnLeg') }}</span>
                    </label>
                  </div>

                  @if (!keepReturnLeg()) {
                    <div class="flex flex-col sm:flex-row gap-4 items-end">
                      <div class="flex-1">
                        <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('admin.reservationDesk.selectNewReturnDate') }} *</label>
                        <input
                          type="date"
                          [(ngModel)]="rescheduleReturnDate"
                          [min]="rescheduleNewDate || minDateStr"
                          [max]="maxDateStr"
                          class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>
                      <button
                        type="button"
                        (click)="searchReturnReplacementFlights()"
                        [disabled]="searchingReturnAlternatives() || !rescheduleReturnDate"
                        class="btn-navy !py-2 text-xs font-bold shrink-0 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                      >
                        @if (searchingReturnAlternatives()) {
                          <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                        } @else {
                          <app-icon name="search" class="w-3.5 h-3.5" />
                        }
                        <span>{{ lang.t('track.searchAlternatives') }}</span>
                      </button>
                    </div>

                    <!-- Direct Return Alternatives List -->
                    @if (!returnIsConnectingReschedule() && availableReturnAlternativeFlights().length > 0) {
                      <div class="space-y-3 pt-2">
                        @for (rf of availableReturnAlternativeFlights(); track rf.flight_id) {
                          <div
                            (click)="selectedReplacementReturnFlight.set(rf); selectedReplacementReturnConnectingRoute.set(null)"
                            [ngClass]="selectedReplacementReturnFlight()?.flight_id === rf.flight_id ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                            class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                          >
                            <div class="flex items-center gap-3">
                              <div class="w-10 h-10 rounded-xl bg-navy text-gold flex items-center justify-center font-mono font-bold text-xs shrink-0">
                                {{ rf.flight_number }}
                              </div>
                              <div>
                                <div class="text-xs font-bold text-navy">
                                  {{ rf.origin_iata }} → {{ rf.dest_iata }}
                                </div>
                                <div class="text-[11px] text-slate-500">
                                  {{ rf.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }} • {{ rf.duration_minutes }}m
                                </div>
                              </div>
                            </div>

                            <div class="flex items-center gap-4">
                              <div class="text-right">
                                <div class="text-xs font-bold font-mono text-navy">
                                  {{ rf.available_seats }} {{ lang.t('results.seatsLeft') }}
                                </div>
                                <div class="text-[11px] text-slate-500 font-mono">
                                  {{ lang.t('admin.reservationDesk.fareLabel') }} {{ rf.base_price_per_adult | currencyFormat }}
                                </div>
                              </div>
                              <button
                                type="button"
                                class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                                [ngClass]="selectedReplacementReturnFlight()?.flight_id === rf.flight_id ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                              >
                                {{ selectedReplacementReturnFlight()?.flight_id === rf.flight_id ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    <!-- Connecting Return Alternatives List -->
                    @if (returnIsConnectingReschedule() && availableReturnConnectingAlternatives().length > 0) {
                      <div class="space-y-3 pt-2">
                        @for (cr of availableReturnConnectingAlternatives(); track $index) {
                          <div
                            (click)="selectedReplacementReturnConnectingRoute.set(cr); selectedReplacementReturnFlight.set(null)"
                            [ngClass]="selectedReplacementReturnConnectingRoute() === cr ? 'border-gold bg-amber-50/40 shadow-sm ring-2 ring-gold/40' : 'border-slate-200 hover:border-slate-300 bg-white'"
                            class="p-4 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                          >
                            <div class="flex items-center gap-3">
                              <div class="w-10 h-10 rounded-xl bg-slate-800 text-gold flex flex-col items-center justify-center font-mono font-bold text-[9px] shrink-0">
                                <span>{{ lang.t('results.transit') }}</span>
                                <span>{{ cr.legs.length || 2 }}</span>
                              </div>
                              <div>
                                <div class="text-xs font-bold text-navy">
                                  {{ cr.legs[0].origin_iata }} → {{ cr.legs[cr.legs.length - 1].dest_iata }}
                                  <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                                    {{ lang.t('admin.reservationDesk.viaTransit') }} {{ cr.transit_airport || cr.legs[0].dest_iata }}
                                  </span>
                                </div>
                                <div class="text-[11px] text-slate-500">
                                  {{ cr.legs[0].flight_number }} + {{ cr.legs[1]?.flight_number }}
                                </div>
                              </div>
                            </div>

                            <div class="flex items-center gap-4">
                              <div class="text-right">
                                <div class="text-xs font-bold font-mono text-navy">
                                  {{ getConnectingPartyPrice(cr) | currencyFormat }}
                                </div>
                              </div>
                              <button
                                type="button"
                                class="px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 inline-flex items-center justify-center whitespace-nowrap"
                                [ngClass]="selectedReplacementReturnConnectingRoute() === cr ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-700'"
                              >
                                {{ selectedReplacementReturnConnectingRoute() === cr ? lang.t('admin.reservationDesk.selected') : lang.t('admin.reservationDesk.select') }}
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    @if (searchedReturnAlternatives() && ((!returnIsConnectingReschedule() && !availableReturnAlternativeFlights().length) || (returnIsConnectingReschedule() && !availableReturnConnectingAlternatives().length))) {
                      <div class="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                        {{ lang.t('track.noAlternativesFound') }}
                      </div>
                    }
                  }
                </div>
              }

              <!-- Execute Reschedule Summary & Action -->
              @if (canSubmitReschedule()) {
                <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div class="text-xs text-slate-700 space-y-0.5">
                    <div>
                      {{ lang.t('admin.reservationDesk.replacement') }}
                      <strong class="text-navy">
                        {{ replacementOutboundSummary() }}
                      </strong>
                      {{ lang.t('admin.reservationDesk.onDate') }} {{ rescheduleNewDate | date: 'dd/MM/yyyy' }}.
                    </div>
                    @if (isRoundTripReschedule()) {
                      <div class="text-[11px] text-slate-500">
                        @if (keepReturnLeg()) {
                          <span>• {{ lang.t('admin.reservationDesk.keepReturnLeg') }}</span>
                        } @else {
                          <span>• {{ lang.t('admin.reservationDesk.returnRoute') }}: {{ replacementReturnSummary() }} {{ lang.t('admin.reservationDesk.onDate') }} {{ rescheduleReturnDate | date: 'dd/MM/yyyy' }}</span>
                        }
                      </div>
                    }
                  </div>
                  <button
                    type="button"
                    (click)="submitStaffReschedule()"
                    [disabled]="executingReschedule()"
                    class="btn-navy !py-2.5 !px-6 text-xs font-bold shadow-sm hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    @if (executingReschedule()) {
                      <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                    } @else {
                      <app-icon name="checkcircle2" class="w-3.5 h-3.5" />
                    }
                    <span>{{ lang.t('track.confirmReschedule') }}</span>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Interactive Seat Map Modal (Reusable shared component) -->
      @if (showSeatMapModal() && seatMapFlightId()) {
        <app-seat-map-modal
          [isOpen]="showSeatMapModal()"
          [flightId]="seatMapFlightId()"
          [flightNumber]="seatMapFlightNumber()"
          [routeInfo]="seatMapRouteInfo()"
          [aircraftModel]="seatMapAircraftModel()"
          [passengerList]="seatMapPassengerList()"
          [initialSeats]="seatMapInitialSeats()"
          [allowedCabinClass]="seatMapAllowedCabinClass()"
          (closeEvent)="showSeatMapModal.set(false)"
          (seatsConfirmed)="onSeatsConfirmed($event)"
          (seatAssignmentsSanitized)="onSeatsSanitized($event)"
        />
      }
    </div>
  `,
})
export class ReservationDeskComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly deskMode = signal<'NEW_BOOKING' | 'RESCHEDULE'>('NEW_BOOKING');

  // Customer Selection state
  customerSearchQuery = '';
  readonly searchingCustomers = signal(false);
  readonly customerList = signal<User[]>([]);
  readonly selectedCustomer = signal<User | null>(null);

  // Search parameters
  readonly isRoundTrip = signal(false);
  searchOrigin = 'HAN';
  searchDest = 'SGN';
  searchDepartureDate = '';
  searchReturnDate = '';
  searchCabin = 'ECONOMY';
  adultCount = 1;
  childCount = 0;
  seniorCount = 0;

  // Booking Horizon
  minDateStr = '';
  maxDateStr = '';

  // Flights Results
  readonly searchingFlights = signal(false);
  readonly flightResults = signal<FlightSearchResult | null>(null);
  readonly selectedOutbound = signal<FormattedFlightResult | null>(null);
  readonly selectedOutboundConnectingRoute = signal<ConnectingRouteOption | null>(null);
  readonly selectedReturn = signal<FormattedFlightResult | null>(null);
  readonly selectedReturnConnectingRoute = signal<ConnectingRouteOption | null>(null);

  // Passengers list
  readonly passengersList = signal<StaffPassengerForm[]>([]);
  paymentCardNumber = '';
  readonly submittingBooking = signal(false);

  // Seat Map Modal
  readonly showSeatMapModal = signal(false);
  readonly seatMapFlightId = signal('');
  readonly seatMapFlightNumber = signal('');
  readonly seatMapRouteInfo = signal('');
  readonly seatMapAircraftModel = signal('');
  readonly seatMapPassengerList = signal<Array<{ name: string; type?: string }>>([]);
  readonly seatMapInitialSeats = signal<Record<number, string>>({});
  readonly seatMapAllowedCabinClass = signal('');
  activeSeatLeg: 'OUTBOUND' | 'RETURN' = 'OUTBOUND';

  // Reschedule State
  rescheduleLookupCode = '';
  readonly loadingRescheduleBooking = signal(false);
  readonly targetRescheduleBooking = signal<any | null>(null);
  readonly targetRescheduleCoupons = signal<any[]>([]);

  // Outbound reschedule
  rescheduleNewDate = '';
  readonly searchingAlternatives = signal(false);
  readonly searchedAlternatives = signal(false);
  readonly alternativeFlights = signal<FormattedFlightResult[]>([]);
  readonly alternativeConnectingRoutes = signal<ConnectingRouteOption[]>([]);
  readonly selectedReplacementFlight = signal<FormattedFlightResult | null>(null);
  readonly selectedReplacementConnectingRoute = signal<ConnectingRouteOption | null>(null);

  // Return reschedule (for round-trip)
  readonly keepReturnLeg = signal(true);
  rescheduleReturnDate = '';
  readonly searchingReturnAlternatives = signal(false);
  readonly searchedReturnAlternatives = signal(false);
  readonly availableReturnAlternativeFlights = signal<FormattedFlightResult[]>([]);
  readonly availableReturnConnectingAlternatives = signal<ConnectingRouteOption[]>([]);
  readonly selectedReplacementReturnFlight = signal<FormattedFlightResult | null>(null);
  readonly selectedReplacementReturnConnectingRoute = signal<ConnectingRouteOption | null>(null);

  readonly executingReschedule = signal(false);

  constructor() {
    const today = new Date();
    this.minDateStr = today.toISOString().slice(0, 10);
    
    // Default departure date to today + 16 days (so 14-day hold demo is available)
    const defDep = new Date();
    defDep.setDate(defDep.getDate() + 16);
    this.searchDepartureDate = defDep.toISOString().slice(0, 10);

    const defRet = new Date(defDep);
    defRet.setDate(defRet.getDate() + 3);
    this.searchReturnDate = defRet.toISOString().slice(0, 10);

    // 330-day booking horizon rule
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 330);
    this.maxDateStr = maxDate.toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    // Initial fetch of customer list
    this.searchCustomers();

    // Check query params: e.g. /admin/reservation-desk?booking=<id>
    this.route.queryParams.subscribe((params) => {
      if (params['booking']) {
        this.deskMode.set('RESCHEDULE');
        this.rescheduleLookupCode = params['booking'];
        this.lookupBookingForReschedule();
      }
    });

    // Reactively update passenger roster when counts change
    this.updatePassengerRoster();
  }

  setMode(mode: 'NEW_BOOKING' | 'RESCHEDULE'): void {
    this.deskMode.set(mode);
  }

  // ===================== STEP 1: CUSTOMER SELECTION =====================
  searchCustomers(): void {
    this.searchingCustomers.set(true);
    this.api.getUsers(this.customerSearchQuery.trim() || undefined, UserRole.CUSTOMER).subscribe({
      next: (users) => {
        this.searchingCustomers.set(false);
        this.customerList.set(users || []);
      },
      error: () => {
        this.searchingCustomers.set(false);
        this.customerList.set([]);
      },
    });
  }

  selectCustomer(cust: User): void {
    this.selectedCustomer.set(cust);
    if (cust.preferred_credit_card) {
      this.paymentCardNumber = cust.preferred_credit_card;
    }
  }

  // ===================== STEP 2 & 3: TRIP SEARCH & FLIGHTS =====================
  searchFlightsForCustomer(): void {
    if (!this.searchOrigin.trim() || !this.searchDest.trim()) {
      this.toast.warning(this.lang.isVietnamese() ? 'Vui lòng nhập điểm đi và điểm đến' : 'Please enter origin and destination');
      return;
    }
    if (this.searchOrigin.trim().toUpperCase() === this.searchDest.trim().toUpperCase()) {
      this.toast.warning(this.lang.isVietnamese() ? 'Điểm đi và điểm đến không thể trùng nhau' : 'Origin and destination cannot be the same');
      return;
    }

    this.searchingFlights.set(true);
    this.selectedOutbound.set(null);
    this.selectedOutboundConnectingRoute.set(null);
    this.selectedReturn.set(null);
    this.selectedReturnConnectingRoute.set(null);

    this.api
      .searchFlights({
        origin: this.searchOrigin.trim().toUpperCase(),
        destination: this.searchDest.trim().toUpperCase(),
        departure_date: this.searchDepartureDate,
        return_date: this.isRoundTrip() ? this.searchReturnDate : undefined,
        cabin_class: this.searchCabin,
        adults: this.adultCount,
        children: this.childCount,
        seniors: this.seniorCount,
        include_connecting: true,
      })
      .subscribe({
        next: (res) => {
          this.searchingFlights.set(false);
          this.flightResults.set(res);
          this.updatePassengerRoster();
        },
        error: (err) => {
          this.searchingFlights.set(false);
          this.toast.error(err?.error?.message || (this.lang.isVietnamese() ? 'Lỗi tìm kiếm chuyến bay' : 'Error searching flights'));
        },
      });
  }

  selectOutboundDirect(flight: FormattedFlightResult): void {
    this.selectedOutboundConnectingRoute.set(null);
    this.selectedOutbound.set(flight);
  }

  selectOutboundConnecting(route: ConnectingRouteOption): void {
    this.selectedOutbound.set(null);
    this.selectedOutboundConnectingRoute.set(route);
  }

  selectReturnDirect(flight: FormattedFlightResult): void {
    this.selectedReturnConnectingRoute.set(null);
    this.selectedReturn.set(flight);
  }

  selectReturnConnecting(route: ConnectingRouteOption): void {
    this.selectedReturn.set(null);
    this.selectedReturnConnectingRoute.set(route);
  }

  hasSelectedFlights(): boolean {
    const hasOutbound = !!this.selectedOutbound() || !!this.selectedOutboundConnectingRoute();
    if (!this.isRoundTrip()) return hasOutbound;
    return hasOutbound && (!!this.selectedReturn() || !!this.selectedReturnConnectingRoute());
  }

  // ===================== STEP 4: PASSENGERS =====================
  updatePassengerRoster(): void {
    const total = Math.max(1, Number(this.adultCount) + Number(this.childCount) + Number(this.seniorCount));
    const current = [...this.passengersList()];

    const updated: StaffPassengerForm[] = [];
    let adultRemaining = Number(this.adultCount);
    let childRemaining = Number(this.childCount);
    let seniorRemaining = Number(this.seniorCount);

    for (let i = 0; i < total; i++) {
      let type = PassengerType.ADULT;
      if (adultRemaining > 0) {
        type = PassengerType.ADULT;
        adultRemaining--;
      } else if (childRemaining > 0) {
        type = PassengerType.CHILD;
        childRemaining--;
      } else if (seniorRemaining > 0) {
        type = PassengerType.SENIOR;
        seniorRemaining--;
      }

      if (current[i]) {
        updated.push({ ...current[i], passenger_type: type });
      } else {
        updated.push({
          first_name: '',
          last_name: '',
          passenger_type: type,
          id_card_or_passport: '',
          nationality: 'Vietnam',
          date_of_birth: '',
          outbound_seat: '',
          return_seat: '',
        });
      }
    }
    this.passengersList.set(updated);
  }

  // Open Seat Map Modal
  openSeatMap(passengerIndex: number): void {
    const outboundDirect = this.selectedOutbound();
    const outboundConnecting = this.selectedOutboundConnectingRoute()?.legs?.[0];
    if (!outboundDirect && !outboundConnecting) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnSelectFlightFirst'));
      return;
    }

    const flightId = outboundDirect ? outboundDirect.flight_id : outboundConnecting!.flight_id;
    const flightNumber = outboundDirect ? outboundDirect.flight_number : outboundConnecting!.flight_number;
    const routeInfo = outboundDirect
      ? `${outboundDirect.origin_iata} → ${outboundDirect.dest_iata}`
      : `${outboundConnecting!.origin_iata} → ${outboundConnecting!.dest_iata}`;
    const aircraftModel = outboundDirect?.aircraft?.model_name || 'Airbus A321';

    this.activeSeatLeg = 'OUTBOUND';
    this.seatMapFlightId.set(flightId);
    this.seatMapFlightNumber.set(flightNumber);
    this.seatMapRouteInfo.set(routeInfo);
    this.seatMapAircraftModel.set(aircraftModel);
    this.seatMapPassengerList.set(
      this.passengersList().map((p, idx) => ({
        name: `${p.first_name || 'Passenger'} ${p.last_name || idx + 1}`.trim(),
        type: p.passenger_type,
      })),
    );

    const initialSeats: Record<number, string> = {};
    this.passengersList().forEach((p, idx) => {
      if (p.outbound_seat) initialSeats[idx] = p.outbound_seat;
    });
    this.seatMapInitialSeats.set(initialSeats);

    let allowedCabin = '';
    if (outboundDirect) {
      allowedCabin = outboundDirect.cabin_class || '';
    } else if (outboundConnecting) {
      const actualInventory = this.resolveConnectingInventory(outboundConnecting.inventories, this.searchCabin);
      allowedCabin = actualInventory?.cabin_class || '';
    }
    this.seatMapAllowedCabinClass.set(allowedCabin);

    this.showSeatMapModal.set(true);
  }

  onSeatsConfirmed(assigned: Record<number, string>): void {
    this.showSeatMapModal.set(false);
    const list = [...this.passengersList()];
    Object.entries(assigned).forEach(([idxStr, seatCode]) => {
      const idx = parseInt(idxStr, 10);
      if (list[idx]) {
        list[idx].outbound_seat = seatCode;
      }
    });
    this.passengersList.set(list);
    this.toast.success(this.lang.isVietnamese() ? 'Đã gán ghế thành công' : 'Seats assigned successfully');
  }

  onSeatsSanitized(assigned: Record<number, string>): void {
    const list = [...this.passengersList()];
    let modified = false;
    list.forEach((p, idx) => {
      const validSeat = assigned[idx] || '';
      if (p.outbound_seat && p.outbound_seat !== validSeat) {
        p.outbound_seat = validSeat;
        modified = true;
      }
    });
    if (modified) {
      this.passengersList.set(list);
    }
  }

  // ===================== STEP 5: FINALIZE (HOLD OR BUY) =====================
  canHold(): boolean {
    const depStr =
      this.selectedOutbound()?.departure_date ||
      this.selectedOutbound()?.scheduled_departure ||
      this.selectedOutboundConnectingRoute()?.departure_date ||
      this.selectedOutboundConnectingRoute()?.legs?.[0]?.departure;
    if (!depStr) return false;
    const depTime = new Date(depStr).getTime();
    const now = Date.now();
    const diffDays = (depTime - now) / (1000 * 60 * 60 * 24);
    return diffDays > 14;
  }

  resolveConnectingInventory(
    inventories?: FlightInventory[],
    requestedCabin?: string,
  ): FlightInventory | null {
    if (!inventories || inventories.length === 0) return null;
    const match = inventories.find((i) => i.cabin_class === requestedCabin);
    return match || inventories[0] || null;
  }

  pickConnectingInventoryId(inventories?: FlightInventory[], cabinClass?: string): string {
    const inv = this.resolveConnectingInventory(inventories, cabinClass);
    return inv?._id || (inv as any)?.id || '';
  }

  calculatedTotalPartyPrice(): number {
    let total = 0;
    if (this.selectedOutbound()) {
      total += Number(this.selectedOutbound()!.total_party_price || 0);
    } else if (this.selectedOutboundConnectingRoute()) {
      total += this.getConnectingPartyPrice(this.selectedOutboundConnectingRoute()!);
    }
    if (this.isRoundTrip()) {
      if (this.selectedReturn()) {
        total += Number(this.selectedReturn()!.total_party_price || 0);
      } else if (this.selectedReturnConnectingRoute()) {
        total += this.getConnectingPartyPrice(this.selectedReturnConnectingRoute()!);
      }
    }
    return total;
  }

  getConnectingPartyPrice(route: ConnectingRouteOption): number {
    let total = 0;
    for (const leg of route.legs || []) {
      const inv = this.resolveConnectingInventory(leg.inventories, this.searchCabin);
      const base = Number(inv?.base_price || 0);
      total += (base * this.adultCount) + (base * 0.75 * this.childCount) + (base * 0.85 * this.seniorCount);
    }
    return Math.round(total);
  }

  validatePassengerForms(): boolean {
    const list = this.passengersList();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.first_name.trim() || !p.last_name.trim()) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? `Vui lòng nhập họ tên cho Hành khách ${i + 1}`
            : `Please enter name for Passenger ${i + 1}`,
        );
        return false;
      }
      if (!p.id_card_or_passport.trim()) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? `Vui lòng nhập CCCD/Hộ chiếu cho Hành khách ${i + 1}`
            : `Please enter ID / Passport for Passenger ${i + 1}`,
        );
        return false;
      }
      // Requirement 1.3.4: optional DOB validity
      if (p.date_of_birth && p.date_of_birth.trim()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth.trim())) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh phải đúng định dạng YYYY-MM-DD`
              : `Passenger ${i + 1}: Date of birth format must be YYYY-MM-DD`,
          );
          return false;
        }
        const [yStr, mStr, dStr] = p.date_of_birth.trim().split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        if (m < 1 || m > 12 || d < 1 || d > 31) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không hợp lệ`
              : `Passenger ${i + 1}: Invalid date of birth`,
          );
          return false;
        }
        const parsed = new Date(Date.UTC(y, m - 1, d));
        if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không tồn tại trên lịch thực tế`
              : `Passenger ${i + 1}: Date of birth does not exist on calendar`,
          );
          return false;
        }
        const now = new Date();
        const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        if (parsed > todayUtc) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không được ở tương lai`
              : `Passenger ${i + 1}: Date of birth cannot be in the future`,
          );
          return false;
        }
      }
    }
    return true;
  }

  buildLegsPayload(): FlightLegSelection[] {
    const legs: FlightLegSelection[] = [];
    if (this.selectedOutbound()) {
      const ob = this.selectedOutbound()!;
      legs.push({
        flight_id: ob.flight_id,
        inventory_id: ob.inventory_id,
        leg_type: 'OUTBOUND',
      });
    } else if (this.selectedOutboundConnectingRoute()) {
      this.selectedOutboundConnectingRoute()!.legs.forEach((l: ConnectingLeg, idx: number) => {
        const invId = this.pickConnectingInventoryId(l.inventories, this.searchCabin);
        legs.push({
          flight_id: l.flight_id,
          inventory_id: invId,
          leg_type: `CONNECTING_${idx + 1}`,
        });
      });
    }
    if (this.isRoundTrip()) {
      if (this.selectedReturn()) {
        const ret = this.selectedReturn()!;
        legs.push({
          flight_id: ret.flight_id,
          inventory_id: ret.inventory_id,
          leg_type: 'INBOUND',
        });
      } else if (this.selectedReturnConnectingRoute()) {
        this.selectedReturnConnectingRoute()!.legs.forEach((l: ConnectingLeg, idx: number) => {
          const invId = this.pickConnectingInventoryId(l.inventories, this.searchCabin);
          legs.push({
            flight_id: l.flight_id,
            inventory_id: invId,
            leg_type: `INBOUND_${idx + 1}`,
          });
        });
      }
    }
    return legs;
  }

  buildPassengerPayload(): PassengerInput[] {
    const isOutboundConn = !!this.selectedOutboundConnectingRoute();
    return this.passengersList().map((p) => {
      const seatCodes: Record<string, string> = {};
      const seat = (p.outbound_seat || '').trim().toUpperCase();
      if (seat) {
        if (isOutboundConn) {
          seatCodes['CONNECTING_1'] = seat;
        } else {
          seatCodes['OUTBOUND'] = seat;
        }
      }
      return {
        first_name: p.first_name.trim().toUpperCase(),
        last_name: p.last_name.trim().toUpperCase(),
        passenger_type: p.passenger_type,
        id_card_or_passport: p.id_card_or_passport.trim(),
        nationality: p.nationality.trim(),
        date_of_birth: p.date_of_birth.trim() || undefined,
        seat_code: seat || undefined,
        seat_codes: Object.keys(seatCodes).length > 0 ? seatCodes : undefined,
      };
    });
  }

  submitHoldBooking(): void {
    if (!this.selectedCustomer()) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnSelectCustomerFirst'));
      return;
    }
    if (!this.validatePassengerForms()) return;
    const legs = this.buildLegsPayload();
    if (!legs.length) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnSelectFlightLegs'));
      return;
    }

    this.submittingBooking.set(true);
    const payload = {
      user_id: this.selectedCustomer()!._id, // Selected customer's user_id!
      booking_type: this.isRoundTrip() ? BookingType.ROUND_TRIP : (this.selectedOutboundConnectingRoute() ? BookingType.CONNECTING : BookingType.ONE_WAY),
      is_block: true,
      passengers: this.buildPassengerPayload(),
      legs: legs,
    };

    this.api.createBooking(payload).subscribe({
      next: (b) => {
        this.submittingBooking.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Giữ chỗ thành công! Mã giữ chỗ: ${b.blocking_number}`
            : `Hold successful! Blocking code: ${b.blocking_number}`,
        );
        this.router.navigate(['/admin/bookings']);
      },
      error: (err) => {
        this.submittingBooking.set(false);
        this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorHoldReservation'));
      },
    });
  }

  submitDirectPurchase(): void {
    if (!this.selectedCustomer()) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnSelectCustomerFirst'));
      return;
    }
    if (!this.validatePassengerForms()) return;

    // Requirement 1.3.4: Payment Card validation (12-19 digits)
    const cardRaw = this.paymentCardNumber.trim();
    const cardRegex = /^(?=(?:\D*\d){12,19}\D*$)[0-9\s-]+$/;
    if (!cardRegex.test(cardRaw)) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? 'Số thẻ thanh toán không hợp lệ (cần 12–19 chữ số)'
          : 'Invalid credit card number (12–19 digits required)',
      );
      return;
    }

    const legs = this.buildLegsPayload();
    if (!legs.length) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnSelectFlightLegs'));
      return;
    }

    this.submittingBooking.set(true);
    const payload = {
      user_id: this.selectedCustomer()!._id, // Selected customer's user_id!
      booking_type: this.isRoundTrip() ? BookingType.ROUND_TRIP : (this.selectedOutboundConnectingRoute() ? BookingType.CONNECTING : BookingType.ONE_WAY),
      is_block: false,
      passengers: this.buildPassengerPayload(),
      legs: legs,
      credit_card_number: cardRaw.replace(/\D/g, ''),
    };

    this.api.createBooking(payload).subscribe({
      next: (b) => {
        this.submittingBooking.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Đặt vé và thanh toán thành công! Mã xác nhận: ${b.confirmation_number}`
            : `Ticket confirmed and purchased! Code: ${b.confirmation_number}`,
        );
        this.router.navigate(['/admin/bookings']);
      },
      error: (err) => {
        this.submittingBooking.set(false);
        this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorExecutePurchase'));
      },
    });
  }

  // ===================== MODE 2: STAFF RESCHEDULE =====================
  lookupBookingForReschedule(): void {
    const code = this.rescheduleLookupCode.trim();
    if (!code) {
      this.toast.warning(this.lang.t('admin.reservationDesk.warnEnterPnr'));
      return;
    }

    this.loadingRescheduleBooking.set(true);
    this.targetRescheduleBooking.set(null);
    this.targetRescheduleCoupons.set([]);
    this.alternativeFlights.set([]);
    this.alternativeConnectingRoutes.set([]);
    this.selectedReplacementFlight.set(null);
    this.selectedReplacementConnectingRoute.set(null);
    this.searchedAlternatives.set(false);

    this.keepReturnLeg.set(true);
    this.availableReturnAlternativeFlights.set([]);
    this.availableReturnConnectingAlternatives.set([]);
    this.selectedReplacementReturnFlight.set(null);
    this.selectedReplacementReturnConnectingRoute.set(null);
    this.searchedReturnAlternatives.set(false);

    // If mongo id length (24 hex), fetch via getBookingById, else trackBooking by code
    const isMongoId = /^[0-9a-fA-F]{24}$/.test(code);
    if (isMongoId) {
      this.api.getBookingById(code).subscribe({
        next: (b: any) => {
          if (!b) {
            this.loadingRescheduleBooking.set(false);
            this.toast.error(this.lang.t('admin.reservationDesk.errorBookingNotFound'));
            return;
          }
          if (b.status !== BookingStatus.CONFIRMED) {
            this.loadingRescheduleBooking.set(false);
            this.toast.warning(
              this.lang.isVietnamese()
                ? `Chỉ có vé đã xác nhận (CONFIRMED) mới được đổi chuyến. Vé này hiện ở trạng thái: ${b.status}`
                : `Only CONFIRMED tickets can be rescheduled. Current status: ${b.status}`,
            );
            return;
          }
          const pnrOrCnf = b.confirmation_number || b.pnr_code;
          if (!pnrOrCnf) {
            this.loadingRescheduleBooking.set(false);
            this.toast.error(this.lang.t('admin.reservationDesk.errorCannotResolveRoute'));
            return;
          }
          this.fetchTrackAndSetup(pnrOrCnf);
        },
        error: (err) => {
          this.loadingRescheduleBooking.set(false);
          this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorRetrieveBooking'));
        },
      });
    } else {
      this.fetchTrackAndSetup(code);
    }
  }

  private fetchTrackAndSetup(pnrOrCode: string): void {
    this.api.trackBooking(pnrOrCode).subscribe({
      next: (res: any) => {
        this.loadingRescheduleBooking.set(false);
        const b = res?.booking_info || res;
        if (!b) {
          this.toast.error(this.lang.t('admin.reservationDesk.errorBookingNotFound'));
          return;
        }
        if (b.status !== BookingStatus.CONFIRMED) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Chỉ có vé đã xác nhận (CONFIRMED) mới được đổi chuyến. Vé này hiện ở trạng thái: ${b.status}`
              : `Only CONFIRMED tickets can be rescheduled. Current status: ${b.status}`,
          );
          return;
        }

        const coupons = res?.flight_coupons || [];
        this.targetRescheduleBooking.set(b);
        this.targetRescheduleCoupons.set(coupons);

        const out = this.targetRescheduleOutbound();
        if (!out) {
          this.toast.error(this.lang.t('admin.reservationDesk.errorCannotResolveRoute'));
          this.targetRescheduleBooking.set(null);
          this.targetRescheduleCoupons.set([]);
          return;
        }

        if (out.departure_date) {
          this.rescheduleNewDate = out.departure_date;
        }

        const ret = this.targetRescheduleReturn();
        if (ret?.departure_date) {
          this.rescheduleReturnDate = ret.departure_date;
        }
      },
      error: (err) => {
        this.loadingRescheduleBooking.set(false);
        this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorRetrieveBooking'));
      },
    });
  }

  targetRescheduleCustomerName(): string {
    const b = this.targetRescheduleBooking();
    if (b?.user_id && typeof b.user_id === 'object') {
      return `${b.user_id.first_name} ${b.user_id.last_name}`;
    }
    const p1 = b?.passengers?.[0];
    return p1 ? `${p1.first_name} ${p1.last_name}` : 'Customer';
  }

  targetRescheduleDistinctLegs(): any[] {
    const coupons = this.targetRescheduleCoupons();
    const seen = new Set<string>();
    const distinct: any[] = [];
    for (const c of coupons) {
      const key = `${c.flight_id}_${c.leg_type || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(c);
      }
    }
    return distinct;
  }

  targetRescheduleOutboundLegs(): any[] {
    const legs = this.targetRescheduleDistinctLegs();
    const isOutbound = (lt?: string) => {
      const t = (lt || '').trim().toUpperCase();
      return t === 'OUTBOUND' || /^CONNECTING_\d+$/.test(t) || /^OUTBOUND_\d+$/.test(t);
    };
    const outbound = legs.filter((l) => isOutbound(l.leg_type));
    if (outbound.length > 0) return outbound;
    const b = this.targetRescheduleBooking();
    if (b?.booking_type === BookingType.ROUND_TRIP) {
      return legs.slice(0, Math.ceil(legs.length / 2));
    }
    return legs;
  }

  targetRescheduleReturnLegs(): any[] {
    const b = this.targetRescheduleBooking();
    if (!b || b.booking_type !== BookingType.ROUND_TRIP) return [];
    const legs = this.targetRescheduleDistinctLegs();
    const isInbound = (lt?: string) => {
      const t = (lt || '').trim().toUpperCase();
      return t === 'INBOUND' || /^INBOUND_\d+$/.test(t);
    };
    const inbound = legs.filter((l) => isInbound(l.leg_type));
    if (inbound.length > 0) return inbound;
    return legs.slice(Math.ceil(legs.length / 2));
  }

  isRoundTripReschedule(): boolean {
    const b = this.targetRescheduleBooking();
    return b?.booking_type === BookingType.ROUND_TRIP && this.targetRescheduleReturnLegs().length > 0;
  }

  outboundIsConnectingReschedule(): boolean {
    const outLegs = this.targetRescheduleOutboundLegs();
    return outLegs.length > 1 || outLegs.some((l) => /^CONNECTING_\d+$/.test((l.leg_type || '').toUpperCase()));
  }

  returnIsConnectingReschedule(): boolean {
    const retLegs = this.targetRescheduleReturnLegs();
    return retLegs.length > 1 || retLegs.some((l) => /^INBOUND_\d+$/.test((l.leg_type || '').toUpperCase()));
  }

  targetRescheduleOutbound(): {
    origin_iata: string;
    dest_iata: string;
    departure_date: string;
    cabin_class: string;
  } | null {
    const outLegs = this.targetRescheduleOutboundLegs();
    if (!outLegs.length) return null;
    const first = outLegs[0];
    const last = outLegs[outLegs.length - 1];
    if (!first?.origin_iata || !last?.dest_iata) return null;
    const depDate = first.departure_date || (first.scheduled_departure ? first.scheduled_departure.slice(0, 10) : '');
    return {
      origin_iata: first.origin_iata,
      dest_iata: last.dest_iata,
      departure_date: depDate,
      cabin_class: first.cabin_class || 'ECONOMY',
    };
  }

  targetRescheduleReturn(): {
    origin_iata: string;
    dest_iata: string;
    departure_date: string;
    cabin_class: string;
  } | null {
    const retLegs = this.targetRescheduleReturnLegs();
    if (!retLegs.length) return null;
    const first = retLegs[0];
    const last = retLegs[retLegs.length - 1];
    if (!first?.origin_iata || !last?.dest_iata) return null;
    const depDate = first.departure_date || (first.scheduled_departure ? first.scheduled_departure.slice(0, 10) : '');
    return {
      origin_iata: first.origin_iata,
      dest_iata: last.dest_iata,
      departure_date: depDate,
      cabin_class: first.cabin_class || 'ECONOMY',
    };
  }

  searchReplacementFlights(): void {
    const out = this.targetRescheduleOutbound();
    if (!out) {
      this.toast.error(this.lang.t('admin.reservationDesk.errorCannotResolveRoute'));
      return;
    }

    this.searchingAlternatives.set(true);
    this.selectedReplacementFlight.set(null);
    this.selectedReplacementConnectingRoute.set(null);
    this.searchedAlternatives.set(true);

    const passengerCount = this.targetRescheduleBooking()?.passengers?.length || 1;

    this.api
      .searchFlights({
        origin: out.origin_iata,
        destination: out.dest_iata,
        departure_date: this.rescheduleNewDate,
        cabin_class: out.cabin_class,
        adults: passengerCount,
        include_connecting: true,
      })
      .subscribe({
        next: (res) => {
          this.searchingAlternatives.set(false);
          const flights = (res?.onward_flights || []).filter(
            (f) => f.status !== FlightStatus.CANCELLED && f.available_seats >= passengerCount,
          );
          this.alternativeFlights.set(flights);
          this.alternativeConnectingRoutes.set(res?.connecting_routes || []);
        },
        error: (err) => {
          this.searchingAlternatives.set(false);
          this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorSearchReplacement'));
        },
      });
  }

  searchReturnReplacementFlights(): void {
    const ret = this.targetRescheduleReturn();
    if (!ret) {
      this.toast.error(this.lang.t('admin.reservationDesk.errorCannotResolveRoute'));
      return;
    }

    this.searchingReturnAlternatives.set(true);
    this.selectedReplacementReturnFlight.set(null);
    this.selectedReplacementReturnConnectingRoute.set(null);
    this.searchedReturnAlternatives.set(true);

    const passengerCount = this.targetRescheduleBooking()?.passengers?.length || 1;

    this.api
      .searchFlights({
        origin: ret.origin_iata,
        destination: ret.dest_iata,
        departure_date: this.rescheduleReturnDate,
        cabin_class: ret.cabin_class,
        adults: passengerCount,
        include_connecting: true,
      })
      .subscribe({
        next: (res) => {
          this.searchingReturnAlternatives.set(false);
          const flights = (res?.onward_flights || []).filter(
            (f) => f.status !== FlightStatus.CANCELLED && f.available_seats >= passengerCount,
          );
          this.availableReturnAlternativeFlights.set(flights);
          this.availableReturnConnectingAlternatives.set(res?.connecting_routes || []);
        },
        error: (err) => {
          this.searchingReturnAlternatives.set(false);
          this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorSearchReplacement'));
        },
      });
  }

  replacementOutboundSummary(): string {
    const fl = this.selectedReplacementFlight();
    if (fl) return fl.flight_number;
    const cr = this.selectedReplacementConnectingRoute();
    if (cr && cr.legs && cr.legs.length > 0) {
      return cr.legs.map((l) => l.flight_number).join(' + ');
    }
    return '';
  }

  replacementReturnSummary(): string {
    const fl = this.selectedReplacementReturnFlight();
    if (fl) return fl.flight_number;
    const cr = this.selectedReplacementReturnConnectingRoute();
    if (cr && cr.legs && cr.legs.length > 0) {
      return cr.legs.map((l) => l.flight_number).join(' + ');
    }
    return '';
  }

  canSubmitReschedule(): boolean {
    if (!this.targetRescheduleBooking()) return false;

    if (this.outboundIsConnectingReschedule()) {
      if (!this.selectedReplacementConnectingRoute()) return false;
    } else {
      if (!this.selectedReplacementFlight()) return false;
    }

    if (this.isRoundTripReschedule() && !this.keepReturnLeg()) {
      if (this.returnIsConnectingReschedule()) {
        if (!this.selectedReplacementReturnConnectingRoute()) return false;
      } else {
        if (!this.selectedReplacementReturnFlight()) return false;
      }
    }

    return true;
  }

  submitStaffReschedule(): void {
    const b = this.targetRescheduleBooking();
    if (!b || !this.canSubmitReschedule()) return;

    const out = this.targetRescheduleOutbound();
    const ret = this.targetRescheduleReturn();
    const targetCabin = out?.cabin_class || 'ECONOMY';

    const payload: any = {
      confirmation_number: b.confirmation_number,
    };

    // 1. Outbound direction
    if (this.selectedReplacementConnectingRoute()) {
      payload.new_legs = this.selectedReplacementConnectingRoute()!.legs.map((leg, idx) => ({
        flight_id: leg.flight_id,
        inventory_id: this.pickConnectingInventoryId(leg.inventories, targetCabin),
        leg_type: `CONNECTING_${idx + 1}`,
      }));
    } else if (this.selectedReplacementFlight()) {
      payload.new_flight_id = this.selectedReplacementFlight()!.flight_id;
      payload.new_inventory_id = this.selectedReplacementFlight()!.inventory_id;
    }

    // 2. Return direction (if round trip and not keeping old leg)
    if (this.isRoundTripReschedule() && !this.keepReturnLeg()) {
      const retCabin = ret?.cabin_class || targetCabin;
      if (this.selectedReplacementReturnConnectingRoute()) {
        payload.new_return_legs = this.selectedReplacementReturnConnectingRoute()!.legs.map((leg, idx) => ({
          flight_id: leg.flight_id,
          inventory_id: this.pickConnectingInventoryId(leg.inventories, retCabin),
          leg_type: `INBOUND_${idx + 1}`,
        }));
      } else if (this.selectedReplacementReturnFlight()) {
        payload.new_return_flight_id = this.selectedReplacementReturnFlight()!.flight_id;
        payload.new_return_inventory_id = this.selectedReplacementReturnFlight()!.inventory_id;
      }
    }

    this.executingReschedule.set(true);
    this.api.rescheduleBooking(payload).subscribe({
      next: (res: any) => {
        this.executingReschedule.set(false);
        const diff = Number(res?.price_difference) || 0;
        const diffText = diff > 0
          ? (this.lang.isVietnamese() ? `Thu thêm chênh lệch: ${new Intl.NumberFormat('vi-VN').format(diff)} VND` : `Surcharge: ${new Intl.NumberFormat('en-US').format(diff)} VND`)
          : diff < 0
          ? (this.lang.isVietnamese() ? `Hoàn tiền chênh lệch: ${new Intl.NumberFormat('vi-VN').format(Math.abs(diff))} VND` : `Refunded: ${new Intl.NumberFormat('en-US').format(Math.abs(diff))} VND`)
          : (this.lang.isVietnamese() ? 'Không có chênh lệch giá vé' : 'No fare difference');

        this.toast.success(
          this.lang.isVietnamese()
            ? `Đổi chuyến bay thành công! ${diffText}`
            : `Rescheduled successfully! ${diffText}`,
        );
        this.router.navigate(['/admin/bookings']);
      },
      error: (err) => {
        this.executingReschedule.set(false);
        this.toast.error(err?.error?.message || this.lang.t('admin.reservationDesk.errorExecuteReschedule'));
      },
    });
  }
}
