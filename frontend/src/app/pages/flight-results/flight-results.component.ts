import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { FlightDurationPipe } from '../../shared/pipes/duration.pipe';
import { SeatMapModalComponent } from '../../shared/components/seat-map-modal/seat-map-modal.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import {
  FlightSearchResult,
  FormattedFlightResult,
  ConnectingRouteOption,
  ConnectingLeg,
  FlightInventory,
} from '../../core/models/flight.model';
import { Airport } from '../../core/models/airport.model';
import { CancellationPolicy } from '../../core/models/booking.model';

export interface SearchScope {
  kind: 'airport' | 'city' | 'country' | 'iata_list' | 'none';
  label?: string;
  iata_codes?: string[];
}

export interface RouteNetworkLeg {
  airline_iata?: string;
  dep_iata?: string;
  arr_iata?: string;
}

export interface RouteNetworkSuggestion {
  transit_airport: string;
  leg1?: RouteNetworkLeg;
  leg2?: RouteNetworkLeg;
  note?: string;
}

export interface ExtendedFlightResult extends FormattedFlightResult {
  origin_city?: string;
  dest_city?: string;
  origin_country?: string;
  dest_country?: string;
}

export interface ExtendedFlightSearchResult extends FlightSearchResult {
  origin_scope?: SearchScope;
  dest_scope?: SearchScope;
  route_network_suggestions?: RouteNetworkSuggestion[];
  onward_flights: ExtendedFlightResult[];
  return_flights?: ExtendedFlightResult[];
}

/** Chuyến nào đang được chọn ghế trên seat map. */
type SeatMapTarget = 'ONWARD' | 'RETURN' | 'CONNECTING_LEG1' | 'CONNECTING_LEG2';
type FlightDirection = 'ONWARD' | 'RETURN';

/** 1 phương án nối chuyến đã được phân giải inventory + giá cho cả đoàn. */
interface ConnectingOption {
  route: ConnectingRouteOption;
  leg1: ConnectingLeg;
  leg2: ConnectingLeg;
  leg1Inventory: FlightInventory | null;
  leg2Inventory: FlightInventory | null;
  leg1BasePrice: number;
  leg2BasePrice: number;
  totalPartyPrice: number;
}

/**
 * Hợp đồng sessionStorage['booking_context'] đã chốt với trang /booking.
 * Xem yêu cầu mục 5.
 */
interface BookingContext {
  mode: 'DIRECT' | 'CONNECTING';
  flight: FormattedFlightResult | null;
  connecting: {
    leg1: { flight: ConnectingLeg; inventory: FlightInventory };
    leg2: { flight: ConnectingLeg; inventory: FlightInventory };
    transit_airport: string;
    layover_minutes: number;
    leg2_seats?: Record<number, string>;
  } | null;
  return_flight: FormattedFlightResult | null;
  return_seats: Record<number, string>;
  connecting_seats?: Record<number, string>;
  leg2_seats?: Record<number, string>;
  origin: string;
  destination: string;
  departure_date: string;
  adults: number;
  children: number;
  seniors: number;
  totalPassengers: number;
  seats: Record<number, string>;
  total_party_price: number;
}

@Component({
  selector: 'app-flight-results',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    CurrencyFormatPipe,
    FlightDurationPipe,
    SeatMapModalComponent,
    PaginationComponent,
  ],
  template: `
    <div class="min-h-screen bg-slate-50 py-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <!-- Search Criteria Summary Header -->
        <div class="bg-navy rounded-3xl p-6 text-white shadow-xl mb-6 border border-navy-light space-y-5">
          <!-- Top Row: Route, Passengers, Class, Modify Search -->
          <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/20 border border-gold/40 text-gold flex items-center justify-center shrink-0">
                <app-icon name="planetakeoff" class="w-6 h-6" />
              </div>
              <div>
                <div class="flex items-center gap-2 text-xl sm:text-2xl font-black text-white flex-wrap">
                  <span>{{ originScopeTitle() }}</span>
                  <app-icon name="arrowright" class="w-5 h-5 text-gold shrink-0" />
                  <span>{{ destScopeTitle() }}</span>
                  @if (isRoundTrip) {
                    <span class="text-xs bg-navy-light px-2.5 py-0.5 rounded-full font-mono text-gold border border-gold/30">{{ lang.t('results.roundTrip') }}</span>
                  }
                </div>
                <p class="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-2 sm:gap-3">
                  <span>{{ departureDate }}</span>
                  @if (departureDateEnd() && departureDateEnd() !== departureDate) {
                    <span class="text-gold font-semibold">→ {{ departureDateEnd() }}</span>
                  }
                  @if (returnDate) { <span>- {{ returnDate }}</span> }
                  <span>•</span>
                  <span>{{ lang.t('results.adultsLabel') }},</span>
                  <span>•</span>
                  <span class="uppercase font-semibold text-gold">{{ cabinClass }}</span>
                  @if (isSmokingFilter !== 'ALL') {
                    <span>•</span>
                    <span class="text-gold font-medium">
                      {{ isSmokingFilter === 'SMOKING' ? lang.t('results.smokingYesText') : lang.t('results.smokingNoText') }}
                    </span>
                  }
                </p>
              </div>
            </div>

            <a
              routerLink="/"
              class="btn-outline-gold !py-2 !px-5 text-xs text-white border-gold hover:bg-gold hover:text-navy shrink-0"
            >
              <app-icon name="edit" class="w-3.5 h-3.5" />
              <span>{{ lang.t('results.modifySearch') }}</span>
            </a>
          </div>

          <!-- Multi-Airport Scope Coverage Hints (Task 1) -->
          @if (scopeCoverageHints().length > 0) {
            <div class="space-y-2 pt-2 border-t border-white/10">
              @for (hint of scopeCoverageHints(); track hint.type) {
                <div class="flex items-start sm:items-center gap-2.5 text-xs text-amber-200 bg-navy-light/90 border border-gold/30 rounded-2xl px-4 py-2.5 shadow-sm">
                  <app-icon name="info" class="w-4 h-4 text-gold shrink-0 mt-0.5 sm:mt-0" />
                  <div class="leading-relaxed">
                    <span class="font-bold text-gold mr-1.5">{{ hint.badge }}:</span>
                    <span class="text-slate-200">{{ hint.text }}</span>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Bottom Row: Date Range Control (Task 2) & Smoking Filter (Task 3) -->
          <div class="border-t border-white/10 pt-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <!-- Date Range Controls -->
            <div class="flex flex-wrap items-center gap-3 text-xs w-full lg:w-auto">
              <span class="text-slate-300 font-semibold flex items-center gap-1.5 shrink-0">
                <app-icon name="calendar" class="w-3.5 h-3.5 text-gold" />
                <span>{{ lang.t('results.dateRange') }}</span>
              </span>
              <div class="flex items-center gap-1.5">
                <span class="text-slate-400">{{ lang.t('results.fromDate') }}</span>
                <input
                  type="date"
                  [(ngModel)]="filterStartDate"
                  class="bg-navy-light text-white px-2.5 py-1.5 rounded-xl border border-gold/30 focus:outline-none focus:border-gold text-xs"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-slate-400">{{ lang.t('results.toDate') }}</span>
                <input
                  type="date"
                  [(ngModel)]="filterEndDate"
                  class="bg-navy-light text-white px-2.5 py-1.5 rounded-xl border border-gold/30 focus:outline-none focus:border-gold text-xs"
                />
              </div>
              <button
                type="button"
                (click)="applyDateRange()"
                class="btn-gold !py-1.5 !px-3.5 text-xs font-bold shrink-0"
              >
                <span>{{ lang.t('results.apply') }}</span>
              </button>
            </div>

            <!-- Smoking Filter (3 options: Tất cả / Hút thuốc / Không hút thuốc) -->
            <div class="flex items-center gap-2 text-xs shrink-0">
              <span class="text-slate-300 font-semibold">{{ lang.t('results.smokingCabin') }}</span>
              <div class="inline-flex rounded-full bg-navy-light p-0.5 border border-gold/30">
                <button
                  type="button"
                  (click)="setSmokingFilter('ALL')"
                  [ngClass]="isSmokingFilter === 'ALL' ? 'bg-gold text-navy font-bold shadow-sm' : 'text-slate-300 hover:text-white'"
                  class="px-3 py-1 rounded-full text-xs transition-colors"
                >{{ lang.t('results.smokingAll') }}</button>
                <button
                  type="button"
                  (click)="setSmokingFilter('SMOKING')"
                  [ngClass]="isSmokingFilter === 'SMOKING' ? 'bg-gold text-navy font-bold shadow-sm' : 'text-slate-300 hover:text-white'"
                  class="px-3 py-1 rounded-full text-xs transition-colors"
                >{{ lang.t('results.smokingYesText') }}</button>
                <button
                  type="button"
                  (click)="setSmokingFilter('NON_SMOKING')"
                  [ngClass]="isSmokingFilter === 'NON_SMOKING' ? 'bg-gold text-navy font-bold shadow-sm' : 'text-slate-300 hover:text-white'"
                  class="px-3 py-1 rounded-full text-xs transition-colors"
                >{{ lang.t('results.smokingNoText') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ============ Task 1: City Ambiguity Chooser & Nearest Airport Suggestion Banners ============ -->
        <!-- Origin Ambiguity Chooser (when more than 1 exactMatch) -->
        @if (originExactMatches().length > 1) {
          <div class="card-luxury p-5 mb-6 border-amber-300 bg-amber-50/50 shadow-sm">
            <div class="flex items-center gap-2 mb-3 text-amber-900 font-bold text-sm">
              <app-icon name="compass" class="w-4 h-4 text-amber-600" />
              <span>{{ lang.t('results.originAirportPicker') }} "{{ origin }}". {{ lang.t('results.originAirportPickerHint') }}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              @for (ap of originExactMatches(); track ap.iata_code) {
                <button
                  type="button"
                  (click)="selectOriginAirport(ap.iata_code)"
                  class="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-gold hover:shadow-md transition-all text-left flex flex-col justify-between group"
                >
                  <div>
                    <div class="flex items-center justify-between">
                      <span class="font-black text-navy text-base group-hover:text-gold transition-colors">{{ ap.iata_code }}</span>
                      <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{{ ap.city_name }}</span>
                    </div>
                    <div class="text-xs font-semibold text-slate-700 mt-1">{{ ap.airport_name }}</div>
                  </div>
                  @if (ap.time_zone) {
                    <div class="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
                      <app-icon name="clock" class="w-3 h-3 text-slate-400" />
                      <span>{{ lang.t('results.timeZoneLabel') }} {{ ap.time_zone }}</span>
                    </div>
                  }
                </button>
              }
            </div>
          </div>
        }

        <!-- Destination Ambiguity Chooser (when more than 1 exactMatch) -->
        @if (destExactMatches().length > 1) {
          <div class="card-luxury p-5 mb-6 border-amber-300 bg-amber-50/50 shadow-sm">
            <div class="flex items-center gap-2 mb-3 text-amber-900 font-bold text-sm">
              <app-icon name="compass" class="w-4 h-4 text-amber-600" />
              <span>{{ lang.t('results.originAirportPicker') }} "{{ destination }}". {{ lang.t('results.destAirportPickerHint') }}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              @for (ap of destExactMatches(); track ap.iata_code) {
                <button
                  type="button"
                  (click)="selectDestAirport(ap.iata_code)"
                  class="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-gold hover:shadow-md transition-all text-left flex flex-col justify-between group"
                >
                  <div>
                    <div class="flex items-center justify-between">
                      <span class="font-black text-navy text-base group-hover:text-gold transition-colors">{{ ap.iata_code }}</span>
                      <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{{ ap.city_name }}</span>
                    </div>
                    <div class="text-xs font-semibold text-slate-700 mt-1">{{ ap.airport_name }}</div>
                  </div>
                  @if (ap.time_zone) {
                    <div class="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
                      <app-icon name="clock" class="w-3 h-3 text-slate-400" />
                      <span>{{ lang.t('results.timeZoneLabel') }} {{ ap.time_zone }}</span>
                    </div>
                  }
                </button>
              }
            </div>
          </div>
        }

        <!-- Origin Nearest Airport Suggestion Banner -->
        @if (results()?.origin_info?.using_nearest_airport) {
          @if (results()?.origin_info?.nearest_suggestion; as sugg) {
            <div class="card-luxury p-4 sm:p-5 mb-6 border-blue-200 bg-blue-50/60 flex items-center gap-3">
              <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <app-icon name="info" class="w-4 h-4" />
              </div>
              <p class="text-xs sm:text-sm text-slate-700 leading-relaxed"
                 [innerHTML]="lang.t('results.noDirectFlightFrom').replace('{query}', results()?.origin_info?.query || '').replace('{iata}', sugg.airport.iata_code).replace('{city}', sugg.airport.city_name).replace('{distance}', sugg.distance_km.toString())">
              </p>
            </div>
          }
        }

        <!-- Destination Nearest Airport Suggestion Banner -->
        @if (results()?.dest_info?.using_nearest_airport) {
          @if (results()?.dest_info?.nearest_suggestion; as sugg) {
            <div class="card-luxury p-4 sm:p-5 mb-6 border-blue-200 bg-blue-50/60 flex items-center gap-3">
              <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <app-icon name="info" class="w-4 h-4" />
              </div>
              <p class="text-xs sm:text-sm text-slate-700 leading-relaxed"
                 [innerHTML]="lang.t('results.noDirectFlightTo').replace('{query}', results()?.dest_info?.query || '').replace('{iata}', sugg.airport.iata_code).replace('{city}', sugg.airport.city_name).replace('{distance}', sugg.distance_km.toString())">
              </p>
            </div>
          }
        }

        <!-- Main Loading Indicator -->
        @if (loading()) {
          <div class="py-24 text-center">
            <app-icon name="refreshcw" class="w-12 h-12 animate-spin text-gold mx-auto mb-4" />
            <h3 class="text-lg font-bold text-navy">{{ lang.t('results.searchingTitle') }}</h3>
            <p class="text-xs text-slate-400 mt-1">{{ lang.t('results.searchingSubtitle') }}</p>
          </div>
        } @else {

          <!-- API error state (không im lặng hiển thị "0 chuyến bay") -->
          @if (errorMessage()) {
            <div class="card-luxury p-8 text-center border-rose-200 bg-rose-50/40 mb-12">
              <app-icon name="alerttriangle" class="w-10 h-10 text-rose-500 mx-auto mb-2" />
              <h4 class="text-base font-bold text-rose-700">{{ lang.t('results.loadError') }}</h4>
              <p class="text-xs text-rose-600 mt-1">{{ errorMessage() }}</p>
              <button
                type="button"
                (click)="executeSearch()"
                class="btn-gold !py-2 !px-5 text-xs mt-4"
              >
                <app-icon name="refreshcw" class="w-4 h-4" />
                <span>{{ lang.t('results.retry') }}</span>
              </button>
            </div>
          } @else {

            <!-- Hàng khứ hồi: nhắc chọn chuyến về -->
            @if (isRoundTrip && selectedFlight() && !selectedReturnFlight()) {
              <div class="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2">
                <app-icon name="info" class="w-4 h-4 text-amber-600 shrink-0" />
                <span>{{ lang.t('results.selectReturnNotice1') }} <strong>{{ lang.t('results.selectReturnNotice2') }}</strong> {{ lang.t('results.selectReturnNotice3') }}</span>
              </div>
            }

            <!-- ============ Direct Outbound Flights Section ("Bay thẳng" - Task 2) ============ -->
            <div class="space-y-6 mb-12">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shrink-0">
                    <app-icon name="plane" class="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h2 class="text-xl font-bold text-navy">
                        {{ lang.t('results.directFlights') }}
                      </h2>
                      <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        {{ lang.t('results.direct') }}
                      </span>
                    </div>
                    <p class="text-xs text-slate-500 mt-0.5">
                      {{ lang.t('results.outbound') }}: {{ originScopeShort() }} &rarr; {{ destScopeShort() }}
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-xs font-semibold text-slate-600 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                    {{ onwardFlightCount() }} {{ lang.t('results.directFlights') }}
                  </span>
                </div>
              </div>

              @if (!results()?.onward_flights?.length) {
                <div class="card-luxury p-8 text-center">
                  <app-icon name="info" class="w-10 h-10 text-amber-500 mx-auto mb-2" />
                  <h4 class="text-base font-bold text-slate-700">{{ lang.t('results.noFlights') }}</h4>
                  <p class="text-xs text-slate-400 mt-1">{{ lang.t('results.tryOtherDate') }}</p>
                </div>
              } @else if (isDateRangeActive()) {
                <!-- Task 2: Grouped onward results by departure_date when range search is active -->
                <div class="space-y-8">
                  @for (group of groupedOnwardFlights(); track group.date) {
                    <div class="space-y-4">
                      <div class="flex items-center gap-2 bg-slate-100/80 px-4 py-2.5 rounded-2xl border border-slate-200/80">
                        <app-icon name="calendar" class="w-4 h-4 text-gold" />
                        <h3 class="text-sm sm:text-base font-bold text-navy">
                          {{ group.displayDate }}
                        </h3>
                        <span class="text-xs text-slate-500 font-medium">
                          ({{ group.flights.length }} {{ lang.t('results.flightsCount') }})
                        </span>
                      </div>
                      <div class="space-y-4">
                        @for (flight of group.flights; track flight.flight_id + flight.inventory_id) {
                          <ng-container
                            *ngTemplateOutlet="flightCard; context: { $implicit: flight, direction: 'ONWARD' }"
                          />
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <!-- Paginated flat list when single date is searched (Task 4) -->
                <div class="space-y-4">
                  @for (flight of paginatedOnwardFlights(); track flight.flight_id + flight.inventory_id) {
                    <ng-container
                      *ngTemplateOutlet="flightCard; context: { $implicit: flight, direction: 'ONWARD' }"
                    />
                  }
                </div>
              }

              <!-- Pagination of direct flight rows (Task 4) -->
              @if ((results()?.onward_flights ?? []).length > 0) {
                <div class="mt-4 rounded-2xl overflow-hidden border border-slate-200 shadow-xs bg-white">
                  <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 font-medium">
                    <span class="flex items-center gap-1.5">
                      <app-icon name="plane" class="w-3.5 h-3.5 text-gold" />
                      <span class="font-semibold text-navy">{{ lang.t('results.paginationDirectOnly') }}</span>
                    </span>
                    <span class="text-slate-400 text-[11px]">
                      {{ (results()?.onward_flights ?? []).length }} {{ lang.t('results.directOptionsCount') }}
                    </span>
                  </div>
                  <app-pagination
                    [total]="(results()?.onward_flights ?? []).length"
                    [page]="directPage()"
                    [pageSize]="directPageSize()"
                    [pageSizeOptions]="directPageSizeOptions"
                    (pageChange)="onDirectPageChange($event)"
                    (pageSizeChange)="onDirectPageSizeChange($event)"
                  />
                </div>
              }
            </div>

            <!-- ============ Direct Return Flights Section (round-trip) ============ -->
            @if (results()?.return_flights?.length) {
              <div class="space-y-6 mb-12">
                <div class="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shrink-0">
                      <app-icon name="plane" class="w-5 h-5 text-emerald-600 rotate-180" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <h2 class="text-xl font-bold text-navy">
                          {{ lang.t('results.return') }}
                        </h2>
                        <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          {{ lang.t('results.direct') }}
                        </span>
                      </div>
                      <p class="text-xs text-slate-500 mt-0.5">
                        {{ destScopeShort() }} &rarr; {{ originScopeShort() }}
                      </p>
                    </div>
                  </div>
                  <span class="text-xs font-semibold text-slate-500">
                    {{ returnFlightCount() }} {{ lang.t('results.directFlightsCount') }}
                  </span>
                </div>

                <div class="space-y-4">
                  @for (flight of results()?.return_flights ?? []; track flight.flight_id + flight.inventory_id) {
                    <ng-container
                      *ngTemplateOutlet="flightCard; context: { $implicit: flight, direction: 'RETURN' }"
                    />
                  }
                </div>
              </div>
            }

            <!-- ============ Connecting Routes Section ("Nối chuyến" - Task 2) ============ -->
            @if (connectingOptions().length) {
              <div class="space-y-6 mb-12">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-50 text-gold flex items-center justify-center border border-gold/30 shrink-0">
                      <app-icon name="compass" class="w-5 h-5 text-gold" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <h2 class="text-xl font-bold text-navy">
                          {{ lang.t('results.connecting') }}
                        </h2>
                        <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          1 {{ lang.t('results.stopsOne') }}
                        </span>
                      </div>
                      <p class="text-xs text-slate-500 mt-0.5">{{ lang.t('results.connectingNotice') }}</p>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="text-xs font-semibold text-slate-600 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                      {{ connectingOptions().length }} {{ lang.t('results.connectingItineraries') }}
                    </span>
                  </div>
                </div>

                <div class="space-y-4">
                  @for (opt of connectingOptions(); track opt.route.leg1.flight_id + opt.route.leg2.flight_id) {
                    <div class="card-luxury p-5 sm:p-6 border-amber-200/80 bg-gradient-to-br from-white to-amber-50/20">

                      <!-- Transit Header -->
                      <div class="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-100">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-xs font-bold bg-navy text-white px-3 py-1 rounded-full">
                            {{ lang.t('results.stopoverAt') }}{{ opt.route.transit_airport }}
                          </span>
                          <span class="text-xs text-slate-600 font-medium flex items-center gap-1">
                            <app-icon name="clock" class="w-3.5 h-3.5 text-gold" />
                            <span>{{ lang.t('results.layoverTime') }}: <strong>{{ opt.route.layover_minutes | flightDuration }}</strong></span>
                            <span class="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              {{ lang.t('results.layoverAcrossTz') }}
                            </span>
                          </span>
                        </div>
                        <div class="text-right">
                          <span class="text-xs text-slate-400">{{ lang.t('results.totalJourneyTime') }}: </span>
                          <strong class="text-xs text-navy font-bold">{{ opt.route.total_duration_minutes | flightDuration }}</strong>
                        </div>
                      </div>

                      <!-- 2 Legs Display -->
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <!-- Leg 1 -->
                        <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                          <div class="flex items-center justify-between mb-1.5">
                            <div class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <span>{{ lang.t('results.leg1') }}:</span>
                              <span class="font-mono text-navy font-bold">{{ opt.leg1.flight_number }}</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 uppercase">
                                {{ opt.leg1Inventory?.cabin_class || cabinClass }}
                              </span>
                              @if (opt.leg1Inventory?.early_bird_percent !== undefined && opt.leg1Inventory?.early_bird_percent !== null) {
                                <span
                                  class="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                  [ngClass]="getEarlyBirdBadgeClass(opt.leg1Inventory?.early_bird_percent)"
                                >
                                  {{ getEarlyBirdBadgeText(opt.leg1Inventory) }}
                                </span>
                              }
                            </div>
                          </div>
                          <div class="flex items-center justify-between">
                            <div>
                              <span class="text-base font-bold text-navy">{{ opt.leg1.scheduled_departure_local ? extractTime(opt.leg1.scheduled_departure_local) : (opt.leg1.departure | date: 'HH:mm') }}</span>
                              <span class="text-xs text-slate-600 block font-semibold">{{ opt.leg1.origin_iata }}</span>
                              <span class="text-[10px] text-slate-400 block font-medium">{{ formatAirportTimeZone(opt.leg1.origin_iata, null, opt.leg1.origin_time_zone, opt.leg1.departure) }}</span>
                            </div>
                            <div class="flex flex-col items-center">
                              <span class="text-[10px] text-slate-400 italic mb-0.5">{{ lang.t('results.localTimeBadge') }}</span>
                              <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                            </div>
                            <div class="text-right">
                              <span class="text-base font-bold text-navy">{{ opt.leg1.scheduled_arrival_local ? extractTime(opt.leg1.scheduled_arrival_local) : (opt.leg1.arrival | date: 'HH:mm') }}</span>
                              <span class="text-xs text-slate-600 block font-semibold">{{ opt.leg1.dest_iata }}</span>
                              <span class="text-[10px] text-slate-400 block font-medium">{{ formatAirportTimeZone(opt.leg1.dest_iata, null, opt.leg1.dest_time_zone, opt.leg1.arrival) }}</span>
                            </div>
                          </div>
                          <div class="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-200/40">
                            {{ opt.leg1Inventory?.available_seats ?? 0 }} {{ lang.t('results.seatsLeft') }} ·
                            {{ opt.leg1BasePrice | currencyFormat }}/{{ lang.t('results.guestSuffix') }}
                          </div>
                        </div>

                        <!-- Leg 2 -->
                        <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                          <div class="flex items-center justify-between mb-1.5">
                            <div class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <span>{{ lang.t('results.leg2') }}:</span>
                              <span class="font-mono text-navy font-bold">{{ opt.leg2.flight_number }}</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 uppercase">
                                {{ opt.leg2Inventory?.cabin_class || cabinClass }}
                              </span>
                              @if (opt.leg2Inventory?.early_bird_percent !== undefined && opt.leg2Inventory?.early_bird_percent !== null) {
                                <span
                                  class="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                  [ngClass]="getEarlyBirdBadgeClass(opt.leg2Inventory?.early_bird_percent)"
                                >
                                  {{ getEarlyBirdBadgeText(opt.leg2Inventory) }}
                                </span>
                              }
                            </div>
                          </div>
                          <div class="flex items-center justify-between">
                            <div>
                              <span class="text-base font-bold text-navy">{{ opt.leg2.scheduled_departure_local ? extractTime(opt.leg2.scheduled_departure_local) : (opt.leg2.departure | date: 'HH:mm') }}</span>
                              <span class="text-xs text-slate-600 block font-semibold">{{ opt.leg2.origin_iata }}</span>
                              <span class="text-[10px] text-slate-400 block font-medium">{{ formatAirportTimeZone(opt.leg2.origin_iata, null, opt.leg2.origin_time_zone, opt.leg2.departure) }}</span>
                            </div>
                            <div class="flex flex-col items-center">
                              <span class="text-[10px] text-slate-400 italic mb-0.5">{{ lang.t('results.localTimeBadge') }}</span>
                              <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                            </div>
                            <div class="text-right">
                              <span class="text-base font-bold text-navy">{{ opt.leg2.scheduled_arrival_local ? extractTime(opt.leg2.scheduled_arrival_local) : (opt.leg2.arrival | date: 'HH:mm') }}</span>
                              <span class="text-xs text-slate-600 block font-semibold">{{ opt.leg2.dest_iata }}</span>
                              <span class="text-[10px] text-slate-400 block font-medium">{{ formatAirportTimeZone(opt.leg2.dest_iata, null, opt.leg2.dest_time_zone, opt.leg2.arrival) }}</span>
                            </div>
                          </div>
                          <div class="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-200/40">
                            {{ opt.leg2Inventory?.available_seats ?? 0 }} {{ lang.t('results.seatsLeft') }} ·
                            {{ opt.leg2BasePrice | currencyFormat }}/{{ lang.t('results.guestSuffix') }}
                          </div>
                        </div>
                      </div>

                      <!-- Price & Selection Action -->
                      <div class="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <span class="text-xs text-slate-400">{{ lang.t('results.totalConnectingFareParty') }} {{ totalPassengers }} {{ lang.t('results.totalConnectingFare2') }}):</span>
                          <div class="text-xl font-black text-navy">{{ opt.totalPartyPrice | currencyFormat }}</div>
                          <span class="text-[11px] text-slate-400 block">
                            {{ lang.t('results.pricePerAdult') }}: {{ opt.leg1BasePrice + opt.leg2BasePrice | currencyFormat }}
                          </span>
                        </div>

                        <button
                          type="button"
                          [disabled]="!opt.leg1Inventory || !opt.leg2Inventory"
                          (click)="selectConnectingRoute(opt)"
                          [ngClass]="(!opt.leg1Inventory || !opt.leg2Inventory) ? 'opacity-50 cursor-not-allowed' : ''"
                          class="btn-gold !py-2.5 !px-5 text-xs sm:text-sm font-bold shrink-0"
                        >
                          <app-icon name="checkcircle2" class="w-4 h-4" />
                          <span>{{ lang.t('results.selectJourney') }}</span>
                        </button>
                      </div>

                    </div>
                  }
                </div>
              </div>
            }

            <!-- ============ Route-Network Suggestions Section (Task 3) ============ -->
            @if (routeNetworkSuggestions().length > 0) {
              <div class="space-y-6 mb-12">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-200 shrink-0">
                      <app-icon name="compass" class="w-5 h-5 text-sky-600" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <h2 class="text-xl font-bold text-navy">
                          {{ lang.t('results.routeNetworkSuggestions') }}
                        </h2>
                        <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-sky-100 text-sky-800 border border-sky-300">
                          AirLabs Network
                        </span>
                      </div>
                      <p class="text-xs text-slate-500 mt-0.5">
                        {{ lang.t('results.routeNetworkNoSchedule') }}
                      </p>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="text-xs font-semibold text-slate-600 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                      {{ routeNetworkSuggestions().length }} {{ lang.t('results.routeSuggestionsCount') }}
                    </span>
                  </div>
                </div>

                <div class="space-y-4">
                  @for (sugg of routeNetworkSuggestions(); track $index) {
                    <div class="card-luxury p-5 sm:p-6 border-sky-200/80 bg-gradient-to-br from-white to-sky-50/20 shadow-sm">
                      <!-- Transit & Airline Header -->
                      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-xs font-bold bg-navy text-white px-3 py-1 rounded-full flex items-center gap-1.5">
                            <app-icon name="mappin" class="w-3.5 h-3.5 text-gold" />
                            <span>{{ lang.t('results.transitAt') }}{{ sugg.transit_airport }}</span>
                          </span>
                          @if (sugg.leg1?.airline_iata || sugg.leg2?.airline_iata) {
                            <span class="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                              {{ lang.t('results.operatedBy') }}
                              {{ sugg.leg1?.airline_iata || sugg.leg2?.airline_iata }}
                            </span>
                          }
                        </div>
                        <div class="text-xs text-slate-400 font-medium">
                          {{ lang.t('results.noFixedSchedule') }}
                        </div>
                      </div>

                      <!-- 2 Legs Display (dep -> transit -> arr) -->
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <!-- Leg 1 -->
                        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 flex items-center justify-between">
                          <div>
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                              {{ lang.t('results.leg1') }}
                              @if (sugg.leg1?.airline_iata) { ({{ sugg.leg1?.airline_iata }}) }
                            </span>
                            <div class="text-lg font-black text-navy mt-1">
                              {{ sugg.leg1?.dep_iata || origin }}
                            </div>
                          </div>
                          <div class="flex flex-col items-center px-3">
                            <span class="text-[10px] text-slate-400 font-medium mb-0.5">{{ lang.t('results.leg1') }}</span>
                            <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                          </div>
                          <div class="text-right">
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                              {{ lang.t('results.transit') }}
                            </span>
                            <div class="text-lg font-black text-navy mt-1">
                              {{ sugg.transit_airport || sugg.leg1?.arr_iata }}
                            </div>
                          </div>
                        </div>

                        <!-- Leg 2 -->
                        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 flex items-center justify-between">
                          <div>
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                              {{ lang.t('results.transit') }}
                            </span>
                            <div class="text-lg font-black text-navy mt-1">
                              {{ sugg.transit_airport || sugg.leg2?.dep_iata }}
                            </div>
                          </div>
                          <div class="flex flex-col items-center px-3">
                            <span class="text-[10px] text-slate-400 font-medium mb-0.5">{{ lang.t('results.leg2') }}</span>
                            <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                          </div>
                          <div class="text-right">
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                              {{ lang.t('results.leg2') }}
                              @if (sugg.leg2?.airline_iata) { ({{ sugg.leg2?.airline_iata }}) }
                            </span>
                            <div class="text-lg font-black text-navy mt-1">
                              {{ sugg.leg2?.arr_iata || destination }}
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- Verbatim Note in Highlighted Warning Box (Task 3) -->
                      @if (sugg.note) {
                        <div class="p-3.5 mb-4 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
                          <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div class="flex-1 font-medium leading-relaxed whitespace-pre-line">
                            {{ sugg.note }}
                          </div>
                        </div>
                      }

                      <!-- Action: "Xem lịch bay theo ngày khác" (No booking, no price!) -->
                      <div class="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <span class="text-xs text-slate-500 italic">
                          * {{ lang.t('results.connectingNoSchedule') }}
                        </span>
                        <div class="flex items-center gap-2 self-end sm:self-auto">
                          <input
                            type="date"
                            [value]="filterStartDate || departureDate"
                            (change)="onSuggestionDateChange($event)"
                            class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-gold font-medium"
                          />
                          <button
                            type="button"
                            (click)="searchDifferentDate()"
                            class="btn-outline-gold !py-1.5 !px-3.5 text-xs font-bold flex items-center gap-1.5 shrink-0"
                          >
                            <app-icon name="calendar" class="w-3.5 h-3.5 text-gold" />
                            <span>{{ lang.t('results.checkOtherDate') }}</span>
                          </button>
                        </div>
                      </div>

                    </div>
                  }
                </div>
              </div>
            }

            <!-- ============ Task 4: Cancellation / Refund Rules Panel (Requirement 3.3.7.1) ============ -->
            @if (policies().length > 0) {
              <div class="card-luxury p-5 sm:p-6 border-slate-200 mt-8 mb-12 shadow-sm">
                <button
                  type="button"
                  (click)="isPoliciesCollapsed.set(!isPoliciesCollapsed())"
                  class="w-full flex items-center justify-between text-left group"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-50 text-gold flex items-center justify-center border border-gold/30 shrink-0">
                      <app-icon name="shieldcheck" class="w-5 h-5" />
                    </div>
                    <div>
                      <h3 class="text-base font-bold text-navy group-hover:text-gold transition-colors">
                        {{ lang.t('results.refundRulesTitle') }}
                      </h3>
                      <p class="text-xs text-slate-400">
                        {{ lang.t('results.refundRulesSubtitle') }}
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <span>{{ isPoliciesCollapsed() ? this.lang.t('results.seeDetails') : lang.t('results.collapse') }}</span>
                    <app-icon
                      name="chevronright"
                      class="w-4 h-4 transition-transform duration-200"
                      [class.rotate-90]="!isPoliciesCollapsed()"
                    />
                  </div>
                </button>

                @if (!isPoliciesCollapsed()) {
                  <div class="mt-4 pt-4 border-t border-slate-100 overflow-x-auto">
                    <table class="w-full text-left text-xs border-collapse min-w-[500px]">
                      <thead>
                        <tr class="border-b border-slate-200 text-slate-500 bg-slate-50/80">
                          <th class="py-2.5 px-4 font-semibold">{{ lang.t('results.refundFromHeader') }}</th>
                          <th class="py-2.5 px-4 font-semibold">{{ lang.t('results.refundToHeader') }}</th>
                          <th class="py-2.5 px-4 font-semibold">{{ lang.t('results.refundPctHeader') }}</th>
                          <th class="py-2.5 px-4 font-semibold">{{ lang.t('results.desc') }}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        @for (p of policies(); track p._id || p.min_days_before) {
                          <tr class="hover:bg-slate-50/60 transition-colors">
                            <td class="py-3 px-4 font-medium text-navy">{{ lang.t('results.fromPrefix') }} {{ p.min_days_before }} {{ lang.t('results.daysSuffix') }}</td>
                            <td class="py-3 px-4 text-slate-600">
                              {{ p.max_days_before === null || p.max_days_before === undefined ? this.lang.t('results.unlimited') : p.max_days_before + ' ' + lang.t('results.daysSuffix') }}
                            </td>
                            <td class="py-3 px-4 font-bold text-emerald-600">
                              {{ p.refund_percentage }}%
                            </td>
                            <td class="py-3 px-4 text-slate-500">
                              {{ (!lang.isVietnamese() && p.description_en) ? p.description_en : p.description }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            }

          }
        }

      </div>
    </div>

    <!-- ============ Shared flight card (outbound + return) ============ -->
    <ng-template #flightCard let-flight let-direction="direction">
      <div
        class="card-luxury p-5 sm:p-6 hover:border-gold/60 transition-all"
        [ngClass]="isFlightSelected(flight, direction) ? 'border-gold ring-1 ring-gold/40' : ''"
      >
        <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">

          <!-- Flight Route & Timing Info -->
          <div class="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-6 sm:gap-10 w-full">

            <!-- Airline Branding & Flight Number -->
            <div class="flex items-center gap-3 shrink-0">
              <div class="w-11 h-11 rounded-2xl bg-navy text-gold flex items-center justify-center shadow-sm">
                <app-icon name="plane" class="w-6 h-6" [class.rotate-180]="direction === 'RETURN'" />
              </div>
              <div>
                <span class="font-mono font-bold text-navy text-sm sm:text-base block">
                  {{ flight.flight_number }}
                </span>
                <span class="text-[11px] text-slate-500 font-medium">
                  {{ flight.aircraft?.model_name
                    ? (flight.aircraft?.registration
                        ? flight.aircraft?.model_name + ' (' + flight.aircraft?.registration + ')'
                        : flight.aircraft?.model_name)
                    : this.lang.t('lookup.unknownAircraft') }}
                </span>
                @if (isFlightSelected(flight, direction)) {
                  <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1 mt-1">
                    <app-icon name="checkcircle2" class="w-3 h-3" />
                    {{ lang.t('results.selected') }}
                  </span>
                }
              </div>
            </div>

            <!-- Schedule Timeline -->
            <div class="flex-1 flex flex-col justify-center gap-1.5 w-full">
              <div class="flex items-center justify-between sm:justify-start gap-4 sm:gap-8 w-full">
                <!-- Departure Time -->
                <div>
                  <div class="text-xl sm:text-2xl font-black text-navy">
                    {{ flight.scheduled_departure_local ? extractTime(flight.scheduled_departure_local) : (flight.scheduled_departure | date: 'HH:mm') }}
                  </div>
                  <div class="text-xs font-bold text-slate-600 uppercase">
                    {{ flight.origin_iata }}
                    @if (flight.origin_city) {
                      <span class="font-normal text-[11px] text-slate-400 capitalize">· {{ flight.origin_city }}</span>
                    }
                  </div>
                </div>

                <!-- Flight Path Visual -->
                <div class="flex-1 flex flex-col items-center max-w-[140px]">
                  <span class="text-[11px] text-slate-400 font-medium">
                    {{ flight.duration_minutes | flightDuration }}
                  </span>
                  <div class="w-full flex items-center gap-1 my-1">
                    <div class="h-0.5 w-full bg-slate-200"></div>
                    <app-icon name="plane" class="w-3.5 h-3.5 text-gold shrink-0 rotate-90" />
                    <div class="h-0.5 w-full bg-slate-200"></div>
                  </div>
                  <span class="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.2 rounded-full">
                    {{ lang.t('results.direct') }}
                  </span>
                </div>

                <!-- Arrival Time -->
                <div>
                  <div class="text-xl sm:text-2xl font-black text-navy flex items-baseline gap-1.5">
                    <span>{{ flight.scheduled_arrival_local ? extractTime(flight.scheduled_arrival_local) : (flight.scheduled_arrival | date: 'HH:mm') }}</span>
                    @if (isDifferentDay(flight)) {
                      <span class="text-xs font-bold text-amber-600 font-sans" [title]="lang.t('results.localTime')">
                        ({{ getDayDiffLabel(flight) }})
                      </span>
                    }
                  </div>
                  <div class="text-xs font-bold text-slate-600 uppercase">
                    {{ flight.dest_iata }}
                    @if (flight.dest_city) {
                      <span class="font-normal text-[11px] text-slate-400 capitalize">· {{ flight.dest_city }}</span>
                    }
                  </div>
                </div>
              </div>

              <!-- Under the route line: airport time zones and diff badge -->
              <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 pt-0.5">
                <span class="font-medium">
                  {{ formatAirportTimeZone(flight.origin_iata, flight.scheduled_departure_local ? extractTime(flight.scheduled_departure_local) : (flight.scheduled_departure | date: 'HH:mm'), flight.origin_time_zone, flight.scheduled_departure) }}
                </span>
                <app-icon name="arrowright" class="w-3 h-3 text-slate-400" />
                <span class="font-medium">
                  {{ formatAirportTimeZone(flight.dest_iata, flight.scheduled_arrival_local ? extractTime(flight.scheduled_arrival_local) : (flight.scheduled_arrival | date: 'HH:mm'), flight.dest_time_zone, flight.scheduled_arrival) }}
                </span>
                @if (getTimeZoneDiff(flight) !== 0) {
                  <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    {{ formatTzDiff(getTimeZoneDiff(flight)) }} {{ lang.t('results.timeZoneDiff') }}
                  </span>
                }
              </div>

              @if (isInternationalFlight(flight)) {
                <div class="text-[10px] text-slate-400 italic">
                  * {{ lang.t('results.localTime') }}
                </div>
              }
            </div>

          </div>

          <!-- Class & Pricing & Booking Action -->
          <div class="flex flex-row lg:flex-col items-center lg:items-end justify-between w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100 gap-4">
            <div class="text-left lg:text-right">
              <div class="flex flex-wrap items-center lg:justify-end gap-1.5">
                <span class="text-xs font-bold px-2.5 py-1 rounded-full uppercase"
                  [ngClass]="flight.cabin_class === 'BUSINESS' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'"
                >
                  {{ flight.cabin_class }}
                </span>
                @if (flight.early_bird_percent !== undefined && flight.early_bird_percent !== null) {
                  <span
                    class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1"
                    [ngClass]="getEarlyBirdBadgeClass(flight.early_bird_percent)"
                  >
                    {{ getEarlyBirdBadgeText(flight) }}
                  </span>
                }
              </div>
              <div class="text-lg sm:text-2xl font-black text-navy mt-1">
                {{ flight.total_party_price | currencyFormat }}
              </div>
              <span class="text-[11px] text-slate-400 block">
                {{ lang.t('results.totalParty') }} · {{ flight.base_price_per_adult | currencyFormat }}/{{ lang.t('results.guestSuffix') }}</span>
              <span class="text-[11px] text-slate-400 block">
                {{ flight.available_seats }} {{ lang.t('results.seatsLeft') }}
              </span>
            </div>

            <button
              type="button"
              (click)="onSelectFlight(flight, direction)"
              class="btn-gold !py-2.5 !px-5 text-xs sm:text-sm font-bold shrink-0"
            >
              <app-icon name="armchair" class="w-4 h-4" />
              <span>{{ lang.t('results.selectSeatBtn') }}</span>
            </button>
          </div>

        </div>
      </div>
    </ng-template>

    <!-- Seat Map Modal -->
    <app-seat-map-modal
      [isOpen]="isSeatMapOpen()"
      [flightId]="seatMapFlightId()"
      [flightNumber]="seatMapFlightNumber()"
      [routeInfo]="seatMapRouteInfo()"
      [passengerList]="generatedPassengerList()"
      [initialSeats]="seatMapInitialSeats()"
      (closeEvent)="isSeatMapOpen.set(false)"
      (seatsConfirmed)="handleSeatsConfirmed($event)"
    />
  `,
})
export class FlightResultsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly results = signal<ExtendedFlightSearchResult | null>(null);
  readonly errorMessage = signal('');

  origin = 'HAN';
  destination = 'SGN';
  departureDate = '';
  readonly departureDateEnd = signal('');
  returnDate = '';
  isRoundTrip = false;
  adults = 1;
  children = 0;
  seniors = 0;
  totalPassengers = 1;
  cabinClass = 'ECONOMY';

  // Task 4: Pagination of direct flight rows
  readonly directPage = signal(1);
  readonly directPageSize = signal(20);
  readonly directPageSizeOptions: number[] = [10, 20, 30, 50, 100];

  readonly paginatedOnwardFlights = computed<ExtendedFlightResult[]>(() => {
    const flights = this.results()?.onward_flights ?? [];
    const page = this.directPage();
    const pageSize = this.directPageSize();
    const start = (page - 1) * pageSize;
    return flights.slice(start, start + pageSize);
  });

  onDirectPageChange(page: number): void {
    this.directPage.set(page);
  }

  onDirectPageSizeChange(size: number): void {
    this.directPageSize.set(size);
    this.directPage.set(1);
  }

  // Task 2: Compact date-range control inputs
  filterStartDate = '';
  filterEndDate = '';

  // Task 3: Smoking filter
  isSmokingFilter: 'ALL' | 'SMOKING' | 'NON_SMOKING' = 'ALL';
  isSmoking: boolean | undefined = undefined;

  // Task 1: Scope header and multi-airport resolution
  formatScope(scope?: SearchScope, fallbackIata = ''): string {
    if (!scope || scope.kind === 'none') {
      return fallbackIata;
    }
    if (scope.kind === 'airport') {
      return scope.label || fallbackIata;
    }
    const label = scope.label || fallbackIata;
    if (scope.iata_codes && scope.iata_codes.length > 1) {
      if (label.includes('(')) {
        return label;
      }
      const codes = scope.iata_codes.slice(0, 3).join(', ');
      const suffix = scope.iata_codes.length > 3 ? '...' : '';
      return `${label} (${codes}${suffix})`;
    }
    return label;
  }

  readonly originScopeTitle = computed<string>(() => {
    const scope = this.results()?.origin_scope;
    if (!scope || scope.kind === 'none') {
      return this.origin;
    }
    return this.formatScope(scope, this.origin);
  });

  readonly destScopeTitle = computed<string>(() => {
    const scope = this.results()?.dest_scope;
    if (!scope || scope.kind === 'none') {
      return this.destination;
    }
    return this.formatScope(scope, this.destination);
  });

  readonly originScopeShort = computed<string>(() => {
    const scope = this.results()?.origin_scope;
    if (!scope || scope.kind === 'none') return this.origin;
    return scope.label || this.origin;
  });

  readonly destScopeShort = computed<string>(() => {
    const scope = this.results()?.dest_scope;
    if (!scope || scope.kind === 'none') return this.destination;
    return scope.label || this.destination;
  });

  readonly scopeCoverageHints = computed<Array<{
    type: 'origin' | 'dest';
    badge: string;
    count: number;
    iatas: string[];
    text: string;
  }>>(() => {
    const res = this.results();
    if (!res) return [];
    const hints: Array<{
      type: 'origin' | 'dest';
      badge: string;
      count: number;
      iatas: string[];
      text: string;
    }> = [];

    const checkScope = (scope: SearchScope | undefined, type: 'origin' | 'dest') => {
      if (!scope || scope.kind === 'none') return;
      const count = scope.iata_codes?.length ?? 0;
      const isMulti =
        scope.kind === 'country' ||
        (scope.kind === 'city' && count > 1) ||
        (scope.kind === 'iata_list' && count > 1) ||
        count > 1;

      if (isMulti) {
        const iatas = scope.iata_codes ?? [];
        const iataListStr = iatas.join(', ');
        
        let badge = '';
        let text = '';

        if (type === 'origin') {
          badge = scope.kind === 'country' ? this.lang.t('results.originCountryScope') : this.lang.t('results.originCityScope');
          text = this.lang.t('results.paginationAirportsIncluded').replace('{count}', count.toString()).replace('{list}', iataListStr);
        } else {
          badge = scope.kind === 'country' ? this.lang.t('results.destCountryScope') : this.lang.t('results.destCityScope');
          text = this.lang.t('results.paginationAirportsArriving').replace('{count}', count.toString()).replace('{list}', iataListStr);
        }

        hints.push({ type, badge, count, iatas, text });
      }
    };

    checkScope(res.origin_scope, 'origin');
    checkScope(res.dest_scope, 'dest');

    return hints;
  });

  // Task 3: Route-network suggestions
  readonly routeNetworkSuggestions = computed<RouteNetworkSuggestion[]>(() => {
    const res = this.results();
    return Array.isArray(res?.route_network_suggestions) ? res!.route_network_suggestions! : [];
  });

  suggestionSelectedDate = '';

  onSuggestionDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input?.value) {
      this.suggestionSelectedDate = input.value;
    }
  }

  searchDifferentDate(dateStr?: string): void {
    const target = dateStr || this.suggestionSelectedDate || this.filterStartDate || this.departureDate;
    if (!target) return;
    this.directPage.set(1);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        departure_date: target,
        departure_date_end: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  // Task 1: City ambiguity chooser & nearest airport suggestions
  readonly originExactMatches = signal<Airport[]>([]);
  readonly destExactMatches = signal<Airport[]>([]);

  // Task 4: Cancellation and refund policies
  readonly policies = signal<CancellationPolicy[]>([]);
  readonly isPoliciesCollapsed = signal(false);
  private policiesLoaded = false;

  // Task 5: Connecting itinerary leg 2 seats
  readonly connectingLeg2Seats = signal<Record<number, string>>({});

  readonly isSeatMapOpen = signal(false);
  readonly seatMapTarget = signal<SeatMapTarget>('ONWARD');
  readonly seatMapFlightId = signal('');
  readonly seatMapFlightNumber = signal('');
  readonly seatMapRouteInfo = signal('');

  readonly selectedFlight = signal<FormattedFlightResult | null>(null);
  readonly selectedReturnFlight = signal<FormattedFlightResult | null>(null);
  readonly selectedConnecting = signal<ConnectingOption | null>(null);

  readonly assignedSeats = signal<Record<number, string>>({});
  readonly returnSeats = signal<Record<number, string>>({});

  /** Ghế đã chọn cho chuyến đang mở seat map. */
  readonly seatMapInitialSeats = computed<Record<number, string>>(() => {
    switch (this.seatMapTarget()) {
      case 'RETURN':
        return this.returnSeats();
      case 'ONWARD':
      case 'CONNECTING_LEG1':
        return this.assignedSeats();
      case 'CONNECTING_LEG2':
        return this.connectingLeg2Seats();
      default:
        return {};
    }
  });

  /** Số {{ lang.t('results.directFlightsCount') }} DISTINCT (theo flight_id), không phải số dòng inventory. */
  readonly onwardFlightCount = computed<number>(() => this.countDistinctFlights(this.results()?.onward_flights));
  readonly returnFlightCount = computed<number>(() => this.countDistinctFlights(this.results()?.return_flights));

  /** Kiểm tra có đang kích hoạt tìm kiếm theo dải ngày hay không (Task 2). */
  readonly isDateRangeActive = computed<boolean>(() => !!this.departureDateEnd());

  /** Gom nhóm chuyến bay đi theo departure_date khi tìm kiếm theo dải ngày (Task 2). */
  readonly groupedOnwardFlights = computed<Array<{ date: string; displayDate: string; flights: ExtendedFlightResult[] }>>(() => {
    const flights = this.paginatedOnwardFlights();
    if (!flights.length) return [];

    const map = new Map<string, ExtendedFlightResult[]>();
    for (const fl of flights) {
      const date = fl.departure_date || this.departureDate;
      if (!map.has(date)) {
        map.set(date, []);
      }
      map.get(date)!.push(fl);
    }

    const groups: Array<{ date: string; displayDate: string; flights: ExtendedFlightResult[] }> = [];
    const sortedDates = Array.from(map.keys()).sort();
    for (const d of sortedDates) {
      groups.push({
        date: d,
        displayDate: this.formatDateDisplay(d),
        flights: map.get(d)!,
      });
    }
    return groups;
  });

  /** Phương án nối chuyến đã phân giải inventory + giá cho cả đoàn. */
  readonly connectingOptions = computed<ConnectingOption[]>(() => {
    const routes = this.results()?.connecting_routes ?? [];
    return routes.map((route) => {
      const leg1Inventory = this.pickInventory(route.leg1.inventories);
      const leg2Inventory = this.pickInventory(route.leg2.inventories);
      const leg1BasePrice = leg1Inventory?.base_price ?? 0;
      const leg2BasePrice = leg2Inventory?.base_price ?? 0;
      return {
        route,
        leg1: route.leg1,
        leg2: route.leg2,
        leg1Inventory,
        leg2Inventory,
        leg1BasePrice,
        leg2BasePrice,
        totalPartyPrice:
          (leg1Inventory ? this.partyPriceFor(leg1BasePrice) : 0) +
          (leg2Inventory ? this.partyPriceFor(leg2BasePrice) : 0),
      };
    });
  });

  ngOnInit(): void {
    // Task 4: Tải danh sách chính sách hủy vé một lần duy nhất
    this.loadPolicies();
    this.loadAirports();

    this.route.queryParams.subscribe((params) => {
      this.origin = (params['origin'] || 'HAN').toString().toUpperCase();
      this.destination = (params['destination'] || 'SGN').toString().toUpperCase();
      // Thiếu departure_date -> dùng ngày mai (ISO yyyy-mm-dd) để backend không trả 400.
      this.departureDate = (params['departure_date'] || '').toString().trim() || this.tomorrowIso();

      // Task 2: departure_date_end
      const endParam = (params['departure_date_end'] || '').toString().trim();
      this.departureDateEnd.set(endParam);
      this.filterStartDate = this.departureDate;
      this.filterEndDate = endParam || this.departureDate;

      this.returnDate = (params['return_date'] || '').toString().trim();
      this.isRoundTrip = !!this.returnDate;
      this.cabinClass = (params['cabin_class'] || 'ECONOMY').toString().toUpperCase();
      this.adults = Number(params['adults']) || 1;
      this.children = Number(params['children']) || 0;
      this.seniors = Number(params['seniors']) || 0;
      this.totalPassengers = this.adults + this.children + this.seniors;

      // Task 3: is_smoking query param
      const smokingParam = params['is_smoking'];
      if (smokingParam === 'true' || smokingParam === true) {
        this.isSmokingFilter = 'SMOKING';
        this.isSmoking = true;
      } else if (smokingParam === 'false' || smokingParam === false) {
        this.isSmokingFilter = 'NON_SMOKING';
        this.isSmoking = false;
      } else {
        this.isSmokingFilter = 'ALL';
        this.isSmoking = undefined;
      }

      // Task 1: Phân giải sân bay / thành phố khi tải trang
      this.resolveCityAmbiguity(this.origin, this.destination);

      this.executeSearch();
    });
  }

  executeSearch(): void {
    if (!this.departureDate) {
      this.departureDate = this.tomorrowIso();
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.results.set(null);
    this.directPage.set(1);
    this.selectedFlight.set(null);
    this.selectedReturnFlight.set(null);
    this.selectedConnecting.set(null);
    this.assignedSeats.set({});
    this.returnSeats.set({});
    this.connectingLeg2Seats.set({});

    this.api
      .searchFlights({
        origin: this.origin,
        destination: this.destination,
        departure_date: this.departureDate,
        departure_date_end: this.departureDateEnd() || undefined,
        return_date: this.returnDate || undefined,
        cabin_class: this.cabinClass,
        is_smoking: this.isSmoking,
        adults: this.adults,
        children: this.children,
        seniors: this.seniors,
      })
      .subscribe({
        next: (res) => {
          this.results.set(res as ExtendedFlightSearchResult);
          this.loading.set(false);

          const onwardCount = this.countDistinctFlights(res?.onward_flights);
          const connectingCount = res?.connecting_routes?.length ?? 0;
          if (onwardCount === 0 && connectingCount === 0) {
            this.toast.info(
              this.lang.t('results.toastNoFlightsQuery').replace('{origin}', this.origin).replace('{destination}', this.destination).replace('{date}', this.departureDate),
            );
          }
        },
        error: (err) => {
          this.loading.set(false);
          const rawMessage = err?.error?.message ?? err?.message;
          const message =
            typeof rawMessage === 'string' && rawMessage.trim()
              ? rawMessage
              : this.lang.t('results.toastSearchErrorQuery').replace('{origin}', this.origin).replace('{destination}', this.destination).replace('{date}', this.departureDate);
          this.errorMessage.set(message);
          this.toast.error(message);
        },
      });
  }

  // ===================== Task 1: City Ambiguity & Nearest Suggestions =====================
  resolveCityAmbiguity(originQuery: string, destQuery: string): void {
    this.api.resolveCity(originQuery).subscribe({
      next: (res) => {
        const matches = res?.exactMatches || [];
        this.originExactMatches.set(matches);
      },
      error: () => {
        this.originExactMatches.set([]);
      },
    });

    this.api.resolveCity(destQuery).subscribe({
      next: (res) => {
        const matches = res?.exactMatches || [];
        this.destExactMatches.set(matches);
      },
      error: () => {
        this.destExactMatches.set([]);
      },
    });
  }

  selectOriginAirport(iata: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { origin: iata },
      queryParamsHandling: 'merge',
    });
  }

  selectDestAirport(iata: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { destination: iata },
      queryParamsHandling: 'merge',
    });
  }



  // ===================== Task 2: Date Range Search =====================
  applyDateRange(): void {
    const start = this.filterStartDate || this.departureDate;
    const end = this.filterEndDate || start;
    if (end < start) {
      this.toast.error(this.lang.t('results.toastInvalidDate'));
      return;
    }
    this.directPage.set(1);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        departure_date: start,
        departure_date_end: end,
      },
      queryParamsHandling: 'merge',
    });
  }

  formatDateDisplay(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  // ===================== Task 3: Smoking Filter =====================
  setSmokingFilter(filter: 'ALL' | 'SMOKING' | 'NON_SMOKING'): void {
    let isSmokingVal: string | null = null;
    if (filter === 'SMOKING') isSmokingVal = 'true';
    else if (filter === 'NON_SMOKING') isSmokingVal = 'false';

    this.directPage.set(1);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        is_smoking: isSmokingVal,
      },
      queryParamsHandling: 'merge',
    });
  }

  // ===================== Task 4: Cancellation Policies =====================
  private loadPolicies(): void {
    if (this.policiesLoaded) return;
    this.policiesLoaded = true;
    this.api.getPolicies().subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          const sorted = [...data].sort((a, b) => (b.min_days_before ?? 0) - (a.min_days_before ?? 0));
          this.policies.set(sorted);
        }
      },
      error: () => {
        this.policies.set([]);
      },
    });
  }

  // ===================== Booking & Passenger Flow =====================
  generatedPassengerList(): Array<{ name: string; type: string }> {
    const list: Array<{ name: string; type: string }> = [];
    for (let i = 1; i <= this.adults; i++) {
      list.push({ name: this.lang.t('results.passengerAdult') + ' ' + i, type: 'ADULT' });
    }
    for (let i = 1; i <= this.children; i++) {
      list.push({ name: this.lang.t('results.passengerChild') + ' ' + i, type: 'CHILD' });
    }
    for (let i = 1; i <= this.seniors; i++) {
      list.push({ name: this.lang.t('results.passengerSenior') + ' ' + i, type: 'SENIOR' });
    }
    return list;
  }

  isFlightSelected(flight: FormattedFlightResult, direction: FlightDirection): boolean {
    const current = direction === 'RETURN' ? this.selectedReturnFlight() : this.selectedFlight();
    return !!current && current.flight_id === flight.flight_id && current.inventory_id === flight.inventory_id;
  }

  onSelectFlight(flight: FormattedFlightResult, direction: FlightDirection): void {
    if (direction === 'RETURN') {
      this.selectReturnFlightAndOpenSeats(flight);
    } else {
      this.selectFlightAndOpenSeats(flight);
    }
  }

  /** Chọn chuyến đi (onward) rồi mở seat map. */
  selectFlightAndOpenSeats(flight: FormattedFlightResult): void {
    this.selectedConnecting.set(null);
    this.selectedFlight.set(flight);
    this.seatMapTarget.set('ONWARD');
    // Ghế của chuyến trước không được dính lại.
    this.assignedSeats.set({});
    this.openSeatMapFor(flight.flight_id, flight.flight_number, `${flight.origin_iata} - ${flight.dest_iata}`);
  }

  /** Chọn chuyến về (return) rồi mở seat map. */
  selectReturnFlightAndOpenSeats(flight: FormattedFlightResult): void {
    this.selectedReturnFlight.set(flight);
    this.seatMapTarget.set('RETURN');
    this.returnSeats.set({});
    this.openSeatMapFor(flight.flight_id, flight.flight_number, `${flight.origin_iata} - ${flight.dest_iata}`);
  }

  /**
   * Task 5: Chọn hành trình nối chuyến: phân giải inventory hợp lệ cho TỪNG chặng
   * rồi mở seat map của chặng 1.
   */
  selectConnectingRoute(option: ConnectingOption): void {
    const { leg1Inventory, leg2Inventory } = option;
    if (!leg1Inventory || !leg2Inventory) {
      this.toast.error(this.lang.t('results.toastConnectingClassError'));
      return;
    }

    this.selectedConnecting.set(option);
    this.seatMapTarget.set('CONNECTING_LEG1');
    this.assignedSeats.set({});
    this.connectingLeg2Seats.set({});
    this.openSeatMapFor(
      option.leg1.flight_id,
      option.leg1.flight_number,
      `${option.leg1.origin_iata} - ${option.leg1.dest_iata}`,
    );
  }

  /**
   * Xử lý khi người dùng bấm xác nhận ghế trên Seat Map Modal.
   * Hỗ trợ tuần tự chọn ghế chặng 1 -> chặng 2 cho hành trình nối chuyến (Task 5).
   */
  handleSeatsConfirmed(seats: Record<number, string>): void {
    const target = this.seatMapTarget();

    // Task 5: Sau khi xác nhận chặng 1, chuyển tiếp mở sơ đồ ghế cho chặng 2
    if (target === 'CONNECTING_LEG1') {
      const option = this.selectedConnecting();
      if (!option || !option.leg1Inventory || !option.leg2Inventory) {
        this.toast.error(this.lang.t('results.toastConnectingNotReady'));
        return;
      }
      this.assignedSeats.set(seats);
      this.toast.info(
        this.lang.t('results.connectingLeg1SavedWithNumber').replace('{flight}', option.leg1.flight_number).replace('{flight2}', option.leg2.flight_number),
      );
      // Đợi modal chặng 1 hoàn tất đóng, mở tiếp modal cho chặng 2 ở tick tiếp theo
      setTimeout(() => {
        this.seatMapTarget.set('CONNECTING_LEG2');
        this.openSeatMapFor(
          option.leg2.flight_id,
          option.leg2.flight_number,
          `${option.leg2.origin_iata} - ${option.leg2.dest_iata}`,
        );
      }, 50);
      return;
    }

    // Task 5: Sau khi xác nhận chặng 2, lưu leg2_seats vào booking_context.connecting.leg2_seats và chuyển tiếp sang /booking
    if (target === 'CONNECTING_LEG2') {
      const option = this.selectedConnecting();
      if (!option || !option.leg1Inventory || !option.leg2Inventory) {
        this.toast.error(this.lang.t('results.toastConnectingNotReady'));
        return;
      }
      this.connectingLeg2Seats.set(seats);
      const leg1Seats = this.assignedSeats();
      const leg2Seats = seats;

      this.writeBookingContext({
        mode: 'CONNECTING',
        flight: null,
        connecting: {
          leg1: { flight: option.leg1, inventory: option.leg1Inventory },
          leg2: { flight: option.leg2, inventory: option.leg2Inventory },
          transit_airport: option.route.transit_airport,
          layover_minutes: option.route.layover_minutes,
          leg2_seats: leg2Seats,
        },
        return_flight: null,
        return_seats: {},
        connecting_seats: leg2Seats,
        leg2_seats: leg2Seats,
        origin: this.origin,
        destination: this.destination,
        departure_date: this.departureDate,
        adults: this.adults,
        children: this.children,
        seniors: this.seniors,
        totalPassengers: this.totalPassengers,
        seats: leg1Seats,
        total_party_price: option.totalPartyPrice,
      });

      this.toast.success(this.lang.t('results.toastConnectingAllSaved'));
      this.router.navigate(['/booking']);
      return;
    }

    if (target === 'RETURN') {
      this.returnSeats.set(seats);
      const onward = this.selectedFlight();
      if (!onward) {
        this.toast.info(this.lang.t('results.toastReturnSaved'));
        return;
      }
      this.toast.success(this.lang.t('results.toastBothSaved'));
      this.writeDirectContext(onward, this.selectedReturnFlight());
      this.router.navigate(['/booking']);
      return;
    }

    // target === 'ONWARD'
    this.assignedSeats.set(seats);
    const onward = this.selectedFlight();
    if (!onward) {
      this.toast.error(this.lang.t('results.toastFlightUnknown'));
      return;
    }

    if (this.isRoundTrip && !this.selectedReturnFlight()) {
      this.toast.info(this.lang.t('results.toastOutboundSaved'));
      return;
    }

    this.toast.success(this.lang.t('results.toastSeatSaved'));
    this.writeDirectContext(onward, this.isRoundTrip ? this.selectedReturnFlight() : null);
    this.router.navigate(['/booking']);
  }

  // ===================== Helpers =====================
  private writeDirectContext(
    onward: FormattedFlightResult,
    returnFlight: FormattedFlightResult | null,
  ): void {
    const totalPartyPrice =
      (onward.total_party_price ?? 0) + (returnFlight ? returnFlight.total_party_price ?? 0 : 0);

    this.writeBookingContext({
      mode: 'DIRECT',
      flight: onward,
      connecting: null,
      return_flight: returnFlight,
      return_seats: returnFlight ? this.returnSeats() : {},
      origin: this.origin,
      destination: this.destination,
      departure_date: this.departureDate,
      adults: this.adults,
      children: this.children,
      seniors: this.seniors,
      totalPassengers: this.totalPassengers,
      seats: this.assignedSeats(),
      total_party_price: totalPartyPrice,
    });
  }

  private writeBookingContext(context: BookingContext): void {
    sessionStorage.setItem('booking_context', JSON.stringify(context));
  }

  private openSeatMapFor(flightId: string, flightNumber: string, routeInfo: string): void {
    this.seatMapFlightId.set(flightId || '');
    this.seatMapFlightNumber.set(flightNumber || '');
    this.seatMapRouteInfo.set(routeInfo || '');
    this.isSeatMapOpen.set(!!flightId);
  }

  private countDistinctFlights(flights?: FormattedFlightResult[]): number {
    if (!flights?.length) return 0;
    return new Set(flights.map((f) => f.flight_id)).size;
  }

  /**
   * Chọn inventory tốt nhất cho 1 chặng:
   * ưu tiên đúng cabin_class đang tìm + còn đủ ghế, sau đó nới dần điều kiện.
   */
  private pickInventory(inventories?: FlightInventory[]): FlightInventory | null {
    if (!inventories?.length) return null;
    const enoughSeats = inventories.filter((inv) => inv.available_seats >= this.totalPassengers);
    const matchesCabin = (inv: FlightInventory) => String(inv.cabin_class) === this.cabinClass;

    const cabinAndSeats = enoughSeats.filter(matchesCabin);
    if (cabinAndSeats.length) return cabinAndSeats[0];

    if (enoughSeats.length) return enoughSeats[0];

    const cabinOnly = inventories.filter(matchesCabin);
    if (cabinOnly.length) {
      return cabinOnly.reduce((best, inv) => (inv.available_seats > best.available_seats ? inv : best));
    }

    return inventories.reduce((best, inv) => (inv.available_seats > best.available_seats ? inv : best));
  }

  /** Công thức backend: người lớn 100%, trẻ em 75%, cao tuổi 85% (Math.round từng phần). */
  private partyPriceFor(basePricePerAdult: number): number {
    const childPrice = Math.round(basePricePerAdult * 0.75);
    const seniorPrice = Math.round(basePricePerAdult * 0.85);
    return this.adults * basePricePerAdult + this.children * childPrice + this.seniors * seniorPrice;
  }

  private tomorrowIso(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  }

  readonly airportTimeZoneMap = new Map<string, string>([
    ['HAN', 'Asia/Ho_Chi_Minh'],
    ['SGN', 'Asia/Ho_Chi_Minh'],
    ['DAD', 'Asia/Ho_Chi_Minh'],
    ['CXR', 'Asia/Ho_Chi_Minh'],
    ['PQC', 'Asia/Ho_Chi_Minh'],
    ['HOI', 'Asia/Ho_Chi_Minh'],
    ['SIN', 'Asia/Singapore'],
    ['BKK', 'Asia/Bangkok'],
    ['KUL', 'Asia/Kuala_Lumpur'],
    ['NRT', 'Asia/Tokyo'],
    ['ICN', 'Asia/Seoul'],
    ['HKG', 'Asia/Hong_Kong'],
    ['PVG', 'Asia/Shanghai'],
    ['TPE', 'Asia/Taipei'],
    ['MNL', 'Asia/Manila'],
    ['CGK', 'Asia/Jakarta'],
    ['DEL', 'Asia/Kolkata'],
    ['DXB', 'Asia/Dubai'],
    ['DOH', 'Asia/Qatar'],
    ['LHR', 'Europe/London'],
    ['CDG', 'Europe/Paris'],
    ['FRA', 'Europe/Berlin'],
    ['SYD', 'Australia/Sydney'],
    ['MEL', 'Australia/Melbourne'],
    ['LAX', 'America/Los_Angeles'],
    ['JFK', 'America/New_York'],
  ]);

  loadAirports(): void {
    this.api.getAirports().subscribe({
      next: (list) => {
        if (list) {
          for (const ap of list) {
            if (ap.iata_code && ap.time_zone) {
              this.airportTimeZoneMap.set(ap.iata_code, ap.time_zone);
            }
          }
        }
      },
      error: () => {},
    });
  }

  extractTime(dateOrTimeStr?: string): string {
    if (!dateOrTimeStr) return '';
    const trimmed = dateOrTimeStr.trim();
    if (trimmed.includes(' ')) {
      const parts = trimmed.split(' ');
      return parts[1]?.slice(0, 5) || trimmed;
    }
    if (trimmed.includes('T')) {
      const parts = trimmed.split('T');
      return parts[1]?.slice(0, 5) || trimmed;
    }
    return trimmed.slice(0, 5);
  }

  formatGmtOffset(timeZone?: string, refDate?: Date | string): string {
    if (!timeZone) return '';
    if (timeZone.startsWith('GMT') || timeZone.startsWith('UTC')) {
      return timeZone.replace('UTC', 'GMT');
    }
    try {
      const d = refDate ? new Date(refDate) : new Date();
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
      });
      const parts = dtf.formatToParts(isNaN(d.getTime()) ? new Date() : d);
      const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
      if (tz) return tz === 'GMT' ? 'GMT+0' : tz;
    } catch {}
    try {
      const d = refDate ? new Date(refDate) : new Date();
      const dtfLong = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      });
      const parts = dtfLong.formatToParts(isNaN(d.getTime()) ? new Date() : d);
      const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
      if (tz) {
        const match = tz.match(/GMT([+-])(\d{1,2}):(\d{2})/);
        if (match) {
          const sign = match[1];
          const h = parseInt(match[2], 10);
          const m = parseInt(match[3], 10);
          return m === 0 ? `GMT${sign}${h}` : `GMT${sign}${h}:${match[3]}`;
        }
        return tz;
      }
    } catch {}
    return '';
  }

  getUtcOffsetMinutes(date: Date, timeZone: string): number {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      });
      const parts = dtf.formatToParts(date);
      const tzName = parts.find((p) => p.type === 'timeZoneName')?.value;
      if (!tzName || tzName === 'GMT') return 0;
      const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
      if (!match) return 0;
      const sign = match[1] === '+' ? 1 : -1;
      const hours = parseInt(match[2], 10);
      const minutes = parseInt(match[3], 10);
      return sign * (hours * 60 + minutes);
    } catch {
      return 420;
    }
  }

  formatDateInTimeZone(date: Date, timeZone: string): string {
    try {
      const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return dtf.format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  formatAirportTimeZone(
    iata: string,
    // Pipe `date` của Angular trả về string | null nên phải chấp nhận null.
    timeStr?: string | null,
    timeZone?: string,
    refDate?: Date | string,
  ): string {
    const timePart = timeStr ? ` ${timeStr}` : '';
    const tz = timeZone || this.airportTimeZoneMap.get(iata) || 'Asia/Ho_Chi_Minh';
    const gmt = this.formatGmtOffset(tz, refDate);
    return gmt ? `${iata}${timePart} (${gmt})` : `${iata}${timePart}`;
  }

  getEarlyBirdBadgeClass(percent?: number): string {
    if (percent === undefined || percent === null) return '';
    if (percent < 0) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    }
    if (percent > 0) {
      return 'bg-amber-100 text-amber-900 border-amber-300';
    }
    return 'bg-slate-100 text-slate-700 border-slate-300';
  }

  getEarlyBirdBadgeText(item?: { early_bird_percent?: number; early_bird_label?: string; early_bird_label_en?: string } | null): string {
    if (!item) return '';
    const pct = item.early_bird_percent ?? 0;
    const label = (this.lang.isVietnamese() ? item.early_bird_label : item.early_bird_label_en)?.trim();
    if (pct === 0) {
      return label || this.lang.t('results.earlyBirdStandard');
    }
    const pctStr = pct > 0 ? `+${pct}%` : `${pct}%`;
    if (label) {
      if (label.includes('%')) return label;
      return `${label} ${pctStr}`;
    }
    const defaultLabel = pct < 0
      ? this.lang.t('results.earlyBirdDiscount')
      : this.lang.t('results.earlyBirdSurcharge');
    return `${defaultLabel} ${pctStr}`;
  }

  getTimeZoneDiff(flight: FormattedFlightResult): number {
    if (typeof flight.time_zone_diff_minutes === 'number') {
      return flight.time_zone_diff_minutes;
    }
    const originTz = flight.origin_time_zone || this.airportTimeZoneMap.get(flight.origin_iata) || 'Asia/Ho_Chi_Minh';
    const destTz = flight.dest_time_zone || this.airportTimeZoneMap.get(flight.dest_iata) || 'Asia/Ho_Chi_Minh';
    const refDate = flight.scheduled_departure ? new Date(flight.scheduled_departure) : new Date();
    const originOffset = this.getUtcOffsetMinutes(refDate, originTz);
    const destOffset = this.getUtcOffsetMinutes(refDate, destTz);
    return destOffset - originOffset;
  }

  formatTzDiff(diffMinutes?: number): string {
    if (diffMinutes === undefined || diffMinutes === null || diffMinutes === 0) return '';
    const sign = diffMinutes > 0 ? '+' : '-';
    const abs = Math.abs(diffMinutes);
    const hours = Math.floor(abs / 60);
    const mins = abs % 60;
    if (mins === 0) {
      return `${sign}${hours}h`;
    }
    if (hours === 0) {
      return `${sign}${mins}m`;
    }
    return `${sign}${hours}h${mins}m`;
  }

  isInternationalFlight(flight: FormattedFlightResult): boolean {
    if (this.getTimeZoneDiff(flight) !== 0) return true;
    const originTz = flight.origin_time_zone || this.airportTimeZoneMap.get(flight.origin_iata) || 'Asia/Ho_Chi_Minh';
    const destTz = flight.dest_time_zone || this.airportTimeZoneMap.get(flight.dest_iata) || 'Asia/Ho_Chi_Minh';
    return originTz !== 'Asia/Ho_Chi_Minh' || destTz !== 'Asia/Ho_Chi_Minh';
  }

  getDayDiffDays(flight: FormattedFlightResult): number {
    let depDateStr = '';
    let arrDateStr = '';
    if (flight.scheduled_departure_local && flight.scheduled_arrival_local) {
      depDateStr = flight.scheduled_departure_local.split(/[T ]/)[0];
      arrDateStr = flight.scheduled_arrival_local.split(/[T ]/)[0];
    } else if (flight.scheduled_departure && flight.scheduled_arrival) {
      const originTz = flight.origin_time_zone || this.airportTimeZoneMap.get(flight.origin_iata) || 'Asia/Ho_Chi_Minh';
      const destTz = flight.dest_time_zone || this.airportTimeZoneMap.get(flight.dest_iata) || 'Asia/Ho_Chi_Minh';
      depDateStr = this.formatDateInTimeZone(new Date(flight.scheduled_departure), originTz);
      arrDateStr = this.formatDateInTimeZone(new Date(flight.scheduled_arrival), destTz);
    }
    if (!depDateStr || !arrDateStr || depDateStr === arrDateStr) return 0;
    const d1 = new Date(depDateStr + 'T00:00:00Z').getTime();
    const d2 = new Date(arrDateStr + 'T00:00:00Z').getTime();
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.round((d2 - d1) / 86400000);
  }

  isDifferentDay(flight: FormattedFlightResult): boolean {
    return this.getDayDiffDays(flight) !== 0;
  }

  getDayDiffLabel(flight: FormattedFlightResult): string {
    const diff = this.getDayDiffDays(flight);
    if (diff === 1) return this.lang.t('results.nextDay');
    if (diff === -1) return this.lang.t('results.prevDay');
    if (diff > 1) return `+${diff} ${this.lang.t('results.daysSuffix')}`;
    if (diff < -1) return `${diff} ${this.lang.t('results.daysSuffix')}`;
    return '';
  }
}


