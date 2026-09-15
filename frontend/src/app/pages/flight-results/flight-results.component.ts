import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { FlightDurationPipe } from '../../shared/pipes/duration.pipe';
import { SeatMapModalComponent } from '../../shared/components/seat-map-modal/seat-map-modal.component';
import {
  FlightSearchResult,
  FormattedFlightResult,
  ConnectingRouteOption,
} from '../../core/models/flight.model';

@Component({
  selector: 'app-flight-results',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    CurrencyFormatPipe,
    FlightDurationPipe,
    SeatMapModalComponent,
  ],
  template: `
    <div class="min-h-screen bg-slate-50 py-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <!-- Search Criteria Summary Header -->
        <div class="bg-navy rounded-3xl p-6 text-white shadow-xl mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-navy-light">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/20 border border-gold/40 text-gold flex items-center justify-center shrink-0">
              <app-icon name="planetakeoff" class="w-6 h-6" />
            </div>
            <div>
              <div class="flex items-center gap-2 text-xl sm:text-2xl font-black text-white">
                <span>{{ origin }}</span>
                <app-icon name="arrowright" class="w-5 h-5 text-gold" />
                <span>{{ destination }}</span>
                @if (isRoundTrip) {
                  <span class="text-xs bg-navy-light px-2.5 py-0.5 rounded-full font-mono text-gold border border-gold/30">
                    Khứ hồi
                  </span>
                }
              </div>
              <p class="text-xs text-slate-300 mt-1 flex items-center gap-3">
                <span>{{ departureDate }}</span>
                @if (returnDate) { <span>- {{ returnDate }}</span> }
                <span>•</span>
                <span>{{ totalPassengers }} hành khách ({{ adults }} lớn, {{ children }} trẻ em, {{ seniors }} cao tuổi)</span>
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

        <!-- Main Loading Indicator -->
        @if (loading()) {
          <div class="py-24 text-center">
            <app-icon name="refreshcw" class="w-12 h-12 animate-spin text-gold mx-auto mb-4" />
            <h3 class="text-lg font-bold text-navy">Đang tìm kiếm chuyến bay tốt nhất...</h3>
            <p class="text-xs text-slate-400 mt-1">Hệ thống đang kiểm tra tình trạng chỗ ngồi và giá vé thời gian thực.</p>
          </div>
        } @else {
          
          <!-- Direct Outbound Flights Section -->
          <div class="space-y-6 mb-12">
            <div class="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 class="text-xl font-bold text-navy flex items-center gap-2">
                <app-icon name="plane" class="w-5 h-5 text-gold" />
                <span>{{ lang.t('results.outbound') }}: {{ origin }} - {{ destination }}</span>
              </h2>
              <span class="text-xs font-semibold text-slate-500">
                {{ results()?.onward_flights?.length || 0 }} chuyến bay thẳng
              </span>
            </div>

            @if (!results()?.onward_flights?.length) {
              <div class="card-luxury p-8 text-center">
                <app-icon name="info" class="w-10 h-10 text-amber-500 mx-auto mb-2" />
                <h4 class="text-base font-bold text-slate-700">{{ lang.t('results.noFlights') }}</h4>
                <p class="text-xs text-slate-400 mt-1">Vui lòng thử chọn một ngày bay khác hoặc xem phương án nối chuyến bên dưới.</p>
              </div>
            } @else {
              <div class="space-y-4">
                @for (flight of results()?.onward_flights; track flight.flight_id + flight.inventory_id) {
                  <div class="card-luxury p-5 sm:p-6 hover:border-gold/60 transition-all">
                    <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                      
                      <!-- Flight Route & Timing Info -->
                      <div class="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-6 sm:gap-10 w-full">
                        
                        <!-- Airline Branding & Flight Number -->
                        <div class="flex items-center gap-3 shrink-0">
                          <div class="w-11 h-11 rounded-2xl bg-navy text-gold flex items-center justify-center shadow-sm">
                            <app-icon name="plane" class="w-6 h-6" />
                          </div>
                          <div>
                            <span class="font-mono font-bold text-navy text-sm sm:text-base block">
                              {{ flight.flight_number }}
                            </span>
                            <span class="text-[11px] text-slate-500 font-medium">
                              {{ flight.aircraft?.model_name || 'Airbus A321' }}
                            </span>
                          </div>
                        </div>

                        <!-- Schedule Timeline -->
                        <div class="flex-1 flex items-center justify-between sm:justify-start gap-4 sm:gap-8 w-full">
                          <!-- Departure Time -->
                          <div>
                            <div class="text-xl sm:text-2xl font-black text-navy">
                              {{ flight.scheduled_departure | date: 'HH:mm' }}
                            </div>
                            <div class="text-xs font-bold text-slate-600 uppercase">
                              {{ flight.origin_iata }}
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
                            <div class="text-xl sm:text-2xl font-black text-navy">
                              {{ flight.scheduled_arrival | date: 'HH:mm' }}
                            </div>
                            <div class="text-xs font-bold text-slate-600 uppercase">
                              {{ flight.dest_iata }}
                            </div>
                          </div>
                        </div>

                      </div>

                      <!-- Class & Pricing & Booking Action -->
                      <div class="flex flex-row lg:flex-col items-center lg:items-end justify-between w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100 gap-4">
                        <div class="text-left lg:text-right">
                          <span class="text-xs font-bold px-2.5 py-1 rounded-full uppercase"
                            [ngClass]="flight.cabin_class === 'BUSINESS' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ flight.cabin_class }}
                          </span>
                          <div class="text-lg sm:text-2xl font-black text-navy mt-1">
                            {{ flight.pricing.total_party_price | currencyFormat }}
                          </div>
                          <span class="text-[11px] text-slate-400 block">
                            {{ flight.available_seats }} {{ lang.t('results.seatsLeft') }}
                          </span>
                        </div>

                        <button
                          type="button"
                          (click)="selectFlightAndOpenSeats(flight)"
                          class="btn-gold !py-2.5 !px-5 text-xs sm:text-sm font-bold shrink-0"
                        >
                          <app-icon name="armchair" class="w-4 h-4" />
                          <span>{{ lang.t('results.selectSeatBtn') }}</span>
                        </button>
                      </div>

                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Connecting Routes Section (Requirement 3.3.1: Route Selection Algorithm) -->
          @if (results()?.connecting_routes?.length) {
            <div class="space-y-6 mb-12">
              <div class="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h2 class="text-xl font-bold text-navy flex items-center gap-2">
                    <app-icon name="compass" class="w-5 h-5 text-gold" />
                    <span>{{ lang.t('results.connecting') }}</span>
                  </h2>
                  <p class="text-xs text-slate-500 mt-0.5">{{ lang.t('results.connectingNotice') }}</p>
                </div>
              </div>

              <div class="space-y-4">
                @for (cr of results()?.connecting_routes; track cr.leg_1.flight_id + cr.leg_2.flight_id) {
                  <div class="card-luxury p-5 sm:p-6 border-amber-200/80 bg-gradient-to-br from-white to-amber-50/20">
                    
                    <!-- Transit Header -->
                    <div class="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-100">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-bold bg-navy text-white px-3 py-1 rounded-full">
                          1 Điểm dừng tại {{ cr.transit_airport }}
                        </span>
                        <span class="text-xs text-slate-500">
                          Thời gian quá cảnh: {{ cr.transit_layover_minutes | flightDuration }}
                        </span>
                      </div>
                      <div class="text-right">
                        <span class="text-xs text-slate-400">Tổng thời gian hành trình: </span>
                        <strong class="text-xs text-navy font-bold">{{ cr.total_journey_duration_minutes | flightDuration }}</strong>
                      </div>
                    </div>

                    <!-- 2 Legs Display -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <!-- Leg 1 -->
                      <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                        <div class="text-xs font-bold text-slate-500 mb-1">Chặng 1: {{ cr.leg_1.flight_number }}</div>
                        <div class="flex items-center justify-between">
                          <div>
                            <span class="text-base font-bold text-navy">{{ cr.leg_1.scheduled_departure | date: 'HH:mm' }}</span>
                            <span class="text-xs text-slate-500 block">{{ cr.leg_1.origin_iata }}</span>
                          </div>
                          <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                          <div>
                            <span class="text-base font-bold text-navy">{{ cr.leg_1.scheduled_arrival | date: 'HH:mm' }}</span>
                            <span class="text-xs text-slate-500 block">{{ cr.leg_1.dest_iata }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Leg 2 -->
                      <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                        <div class="text-xs font-bold text-slate-500 mb-1">Chặng 2: {{ cr.leg_2.flight_number }}</div>
                        <div class="flex items-center justify-between">
                          <div>
                            <span class="text-base font-bold text-navy">{{ cr.leg_2.scheduled_departure | date: 'HH:mm' }}</span>
                            <span class="text-xs text-slate-500 block">{{ cr.leg_2.origin_iata }}</span>
                          </div>
                          <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                          <div>
                            <span class="text-base font-bold text-navy">{{ cr.leg_2.scheduled_arrival | date: 'HH:mm' }}</span>
                            <span class="text-xs text-slate-500 block">{{ cr.leg_2.dest_iata }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Price & Selection Action -->
                    <div class="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span class="text-xs text-slate-400">Tổng giá vé nối chuyến:</span>
                        <div class="text-xl font-black text-navy">{{ cr.pricing.total_party_price | currencyFormat }}</div>
                      </div>

                      <button
                        type="button"
                        (click)="selectConnectingRoute(cr)"
                        class="btn-gold !py-2.5 !px-5 text-xs sm:text-sm font-bold"
                      >
                        <app-icon name="checkcircle2" class="w-4 h-4" />
                        <span>Chọn hành trình này</span>
                      </button>
                    </div>

                  </div>
                }
              </div>
            </div>
          }

        }

      </div>
    </div>

    <!-- Seat Map Modal -->
    <app-seat-map-modal
      [isOpen]="isSeatMapOpen()"
      [flightId]="selectedFlight()?.flight_id || ''"
      [flightNumber]="selectedFlight()?.flight_number || ''"
      [routeInfo]="origin + ' - ' + destination"
      [passengerList]="generatedPassengerList()"
      [initialSeats]="assignedSeats()"
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
  readonly results = signal<FlightSearchResult | null>(null);

  origin = 'HAN';
  destination = 'SGN';
  departureDate = '';
  returnDate = '';
  isRoundTrip = false;
  adults = 1;
  children = 0;
  seniors = 0;
  totalPassengers = 1;
  cabinClass = 'ECONOMY';

  readonly isSeatMapOpen = signal(false);
  readonly selectedFlight = signal<FormattedFlightResult | null>(null);
  readonly assignedSeats = signal<Record<number, string>>({});

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.origin = params['origin'] || 'HAN';
      this.destination = params['destination'] || 'SGN';
      this.departureDate = params['departure_date'] || '';
      this.returnDate = params['return_date'] || '';
      this.isRoundTrip = !!this.returnDate;
      this.cabinClass = params['cabin_class'] || 'ECONOMY';
      this.adults = Number(params['adults']) || 1;
      this.children = Number(params['children']) || 0;
      this.seniors = Number(params['seniors']) || 0;
      this.totalPassengers = this.adults + this.children + this.seniors;

      this.executeSearch();
    });
  }

  executeSearch(): void {
    this.loading.set(true);
    this.api
      .searchFlights({
        origin: this.origin,
        destination: this.destination,
        departure_date: this.departureDate,
        return_date: this.returnDate || undefined,
        cabin_class: this.cabinClass,
        adults: this.adults,
        children: this.children,
        seniors: this.seniors,
      })
      .subscribe({
        next: (res) => {
          this.results.set(res);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || 'Không thể tìm kiếm chuyến bay.');
        },
      });
  }

  generatedPassengerList(): Array<{ name: string; type: string }> {
    const list: Array<{ name: string; type: string }> = [];
    for (let i = 1; i <= this.adults; i++) {
      list.push({ name: `Người lớn ${i}`, type: 'ADULT' });
    }
    for (let i = 1; i <= this.children; i++) {
      list.push({ name: `Trẻ em ${i}`, type: 'CHILD' });
    }
    for (let i = 1; i <= this.seniors; i++) {
      list.push({ name: `Người cao tuổi ${i}`, type: 'SENIOR' });
    }
    return list;
  }

  selectFlightAndOpenSeats(flight: FormattedFlightResult): void {
    this.selectedFlight.set(flight);
    this.isSeatMapOpen.set(true);
  }

  handleSeatsConfirmed(seats: Record<number, string>): void {
    this.assignedSeats.set(seats);
    this.toast.success('Đã lưu lựa chọn ghế ngồi!');

    // Proceed to booking checkout with flight & seat data
    const fl = this.selectedFlight();
    if (!fl) return;

    sessionStorage.setItem(
      'booking_context',
      JSON.stringify({
        flight: fl,
        origin: this.origin,
        destination: this.destination,
        departure_date: this.departureDate,
        adults: this.adults,
        children: this.children,
        seniors: this.seniors,
        totalPassengers: this.totalPassengers,
        seats: seats,
        pricing: fl.pricing,
      }),
    );

    this.router.navigate(['/booking']);
  }

  selectConnectingRoute(cr: ConnectingRouteOption): void {
    sessionStorage.setItem(
      'booking_context',
      JSON.stringify({
        connecting: cr,
        origin: this.origin,
        destination: this.destination,
        departure_date: this.departureDate,
        adults: this.adults,
        children: this.children,
        seniors: this.seniors,
        totalPassengers: this.totalPassengers,
        seats: {},
        pricing: cr.pricing,
      }),
    );

    this.router.navigate(['/booking']);
  }
}
