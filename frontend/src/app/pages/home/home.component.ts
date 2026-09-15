import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Airport } from '../../core/models/airport.model';
import { CabinClass } from '../../core/models/flight.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <div class="min-h-screen bg-slate-50 flex flex-col">
      <!-- Hero Banner Section -->
      <section class="relative bg-navy text-white pt-12 pb-32 sm:pb-40 overflow-hidden">
        <!-- Subtle aviation background gradient & accents -->
        <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#D4AF37_1px,transparent_1px)] [background-size:24px_24px]"></div>
        <div class="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy-light/60 border border-gold/40 text-xs font-semibold text-gold mb-6 shadow-sm">
            <app-icon name="crown" class="w-4 h-4 text-gold" />
            <span>{{ lang.t('nav.slogan') }}</span>
          </div>

          <h1 class="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight max-w-4xl mx-auto">
            {{ lang.t('hero.title') }}
          </h1>

          <p class="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto mt-4 leading-relaxed font-normal">
            {{ lang.t('hero.subtitle') }}
          </p>
        </div>
      </section>

      <!-- Flight Search Engine (Floating Card) -->
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 sm:-mt-28 relative z-20 w-full mb-16">
        <div class="card-luxury p-6 sm:p-8 shadow-2xl border-slate-200">
          
          <!-- Tab selector: One-way / Round-trip -->
          <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
            <div class="flex items-center gap-2 bg-slate-100 p-1 rounded-full">
              <button
                type="button"
                (click)="isRoundTrip.set(false)"
                [class.bg-navy]="!isRoundTrip()"
                [class.text-white]="!isRoundTrip()"
                [class.shadow-sm]="!isRoundTrip()"
                [class.text-slate-600]="isRoundTrip()"
                class="px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2"
              >
                <app-icon name="arrowright" class="w-4 h-4" />
                <span>{{ lang.t('search.oneWay') }}</span>
              </button>

              <button
                type="button"
                (click)="isRoundTrip.set(true)"
                [class.bg-navy]="isRoundTrip()"
                [class.text-white]="isRoundTrip()"
                [class.shadow-sm]="isRoundTrip()"
                [class.text-slate-600]="!isRoundTrip()"
                class="px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2"
              >
                <app-icon name="arrowrightleft" class="w-4 h-4" />
                <span>{{ lang.t('search.roundTrip') }}</span>
              </button>
            </div>

            <!-- Cabin Class Picker -->
            <div class="flex items-center gap-2">
              <label class="text-xs font-bold text-slate-500 hidden sm:block">{{ lang.t('search.cabinClass') }}:</label>
              <select
                [(ngModel)]="cabinClass"
                class="bg-slate-50 border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gold/50"
              >
                <option [value]="CabinClass.ECONOMY">{{ lang.t('search.economy') }}</option>
                <option [value]="CabinClass.BUSINESS">{{ lang.t('search.business') }}</option>
                <option [value]="CabinClass.FIRST">{{ lang.t('search.first') }}</option>
              </select>
            </div>
          </div>

          <!-- Main Search Grid -->
          <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            
            <!-- Origin (5 cols in tablet/desktop) -->
            <div class="md:col-span-3">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="planetakeoff" class="w-4 h-4 text-gold" />
                <span>{{ lang.t('search.from') }}</span>
              </label>
              <div class="relative">
                <select
                  [(ngModel)]="origin"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold appearance-none"
                >
                  <option value="" disabled>{{ lang.t('search.selectCity') }}</option>
                  @for (ap of airports(); track ap.iata_code) {
                    <option [value]="ap.iata_code">
                      {{ ap.city_name }} ({{ ap.iata_code }})
                    </option>
                  }
                </select>
                <div class="absolute right-3.5 top-3.5 pointer-events-none text-slate-400">
                  <app-icon name="chevrondown" class="w-5 h-5" />
                </div>
              </div>
            </div>

            <!-- Swap Button -->
            <div class="md:col-span-1 flex justify-center pb-2">
              <button
                type="button"
                (click)="swapAirports()"
                class="w-10 h-10 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-navy hover:text-gold shadow-sm flex items-center justify-center transition-all hover:rotate-180"
                title="{{ lang.t('search.swap') }}"
              >
                <app-icon name="arrowrightleft" class="w-4 h-4" />
              </button>
            </div>

            <!-- Destination -->
            <div class="md:col-span-3">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="planelanding" class="w-4 h-4 text-gold" />
                <span>{{ lang.t('search.to') }}</span>
              </label>
              <div class="relative">
                <select
                  [(ngModel)]="destination"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold appearance-none"
                >
                  <option value="" disabled>{{ lang.t('search.selectCity') }}</option>
                  @for (ap of airports(); track ap.iata_code) {
                    <option [value]="ap.iata_code">
                      {{ ap.city_name }} ({{ ap.iata_code }})
                    </option>
                  }
                </select>
                <div class="absolute right-3.5 top-3.5 pointer-events-none text-slate-400">
                  <app-icon name="chevrondown" class="w-5 h-5" />
                </div>
              </div>
            </div>

            <!-- Departure Date -->
            <div [class.md:col-span-2]="isRoundTrip()" [class.md:col-span-3]="!isRoundTrip()">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="calendar" class="w-4 h-4 text-gold" />
                <span>{{ lang.t('search.depDate') }}</span>
              </label>
              <input
                type="date"
                [(ngModel)]="departureDate"
                [min]="todayStr"
                class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3.5 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>

            <!-- Return Date (Only if Round Trip) -->
            @if (isRoundTrip()) {
              <div class="md:col-span-3">
                <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <app-icon name="calendar" class="w-4 h-4 text-gold" />
                  <span>{{ lang.t('search.retDate') }}</span>
                </label>
                <input
                  type="date"
                  [(ngModel)]="returnDate"
                  [min]="departureDate || todayStr"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3.5 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
            }

            <!-- Passengers Dropdown Pill -->
            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="users" class="w-4 h-4 text-gold" />
                <span>Hành khách</span>
              </label>
              <div class="relative">
                <button
                  type="button"
                  (click)="showPassengerPicker.set(!showPassengerPicker())"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3 py-3 text-xs sm:text-sm font-semibold text-left flex items-center justify-between"
                >
                  <span>{{ totalPassengers() }} khách</span>
                  <app-icon name="chevrondown" class="w-4 h-4 text-slate-400" />
                </button>

                <!-- Passenger Popover -->
                @if (showPassengerPicker()) {
                  <div class="absolute right-0 bottom-full mb-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-30 space-y-3 animate-fade-in">
                    <!-- Adults -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">Người lớn</div>
                        <div class="text-[10px] text-slate-400">Từ 12 tuổi trở lên</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="adults = adults > 1 ? adults - 1 : 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ adults }}</span>
                        <button
                          type="button"
                          (click)="adults = adults + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <!-- Children -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">Trẻ em</div>
                        <div class="text-[10px] text-amber-600 font-medium">2 - 11 tuổi (Giảm 25%)</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="children = children > 0 ? children - 1 : 0"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ children }}</span>
                        <button
                          type="button"
                          (click)="children = children + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <!-- Seniors -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">Người cao tuổi</div>
                        <div class="text-[10px] text-amber-600 font-medium">>= 60 tuổi (Giảm 15%)</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="seniors = seniors > 0 ? seniors - 1 : 0"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ seniors }}</span>
                        <button
                          type="button"
                          (click)="seniors = seniors + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      (click)="showPassengerPicker.set(false)"
                      class="w-full py-2 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light mt-2"
                    >
                      Xong
                    </button>
                  </div>
                }
              </div>
            </div>

          </div>

          <!-- Action Submit Button -->
          <div class="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="text-xs text-slate-500 flex items-center gap-2">
              <app-icon name="shieldcheck" class="w-4 h-4 text-emerald-600" />
              <span>Giá vé đã bao gồm thuế & phí sân bay theo quy định.</span>
            </div>

            <button
              type="button"
              (click)="onSearch()"
              class="btn-gold w-full sm:w-auto !py-3.5 !px-8 text-sm uppercase tracking-wider font-bold"
            >
              <app-icon name="search" class="w-4 h-4" />
              <span>{{ lang.t('search.btn') }}</span>
            </button>
          </div>

        </div>
      </div>

      <!-- Popular Routes Section -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div class="text-center mb-10">
          <span class="text-xs font-bold uppercase tracking-widest text-gold block mb-1">Mạng đường bay nổi bật</span>
          <h2 class="text-2xl sm:text-3xl font-bold text-navy">Khám Phá Các Chặng Bay Được Yêu Thích Nhất</h2>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          @for (route of popularRoutes; track route.from + route.to) {
            <div
              (click)="selectPopularRoute(route.from, route.to)"
              class="card-luxury p-5 cursor-pointer hover:border-gold group transition-all duration-200"
            >
              <div class="flex items-center justify-between mb-4">
                <span class="text-xs font-mono font-bold bg-slate-100 text-navy px-2.5 py-1 rounded-full">
                  {{ route.from }} - {{ route.to }}
                </span>
                <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  Mỗi ngày
                </span>
              </div>
              <h3 class="text-base font-bold text-navy group-hover:text-amber-600 transition-colors">
                {{ route.fromCity }} 
                <app-icon name="arrowright" class="w-3.5 h-3.5 inline text-slate-400 mx-1" />
                {{ route.toCity }}
              </h3>
              <p class="text-xs text-slate-500 mt-1">Thời gian bay: ~{{ route.duration }}</p>
              <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span class="text-slate-400">Giá chỉ từ</span>
                <span class="font-bold text-navy text-sm">{{ route.price }}</span>
              </div>
            </div>
          }
        </div>
      </section>

      <!-- Why Choose Aptech Airlines Section -->
      <section class="bg-white py-16 border-t border-slate-200/80 mt-auto">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-gold flex items-center justify-center shrink-0 border border-gold/30">
                <app-icon name="shieldcheck" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">An Toàn Tuyệt Đối</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Đội tàu bay hiện đại Airbus A321 Neo & Boeing 787 bảo dưỡng định kỳ theo tiêu chuẩn nghiêm ngặt hàng đầu thế giới.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0 border border-navy/20">
                <app-icon name="armchair" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">Tiện Nghi 5 Sao</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Ghế ngồi êm ái rộng rãi, ẩm thực hàng không hảo hạng và dịch vụ chăm sóc hành khách chu đáo từ phi hành đoàn.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-gold flex items-center justify-center shrink-0 border border-gold/30">
                <app-icon name="award" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">Tích Lũy Dặm Bay SkyMiles</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Tích lũy dặm thưởng cho mọi hành trình bay, nâng hạng thẻ hội viên VIP và đổi vé máy bay miễn phí bất kỳ lúc nào.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly isRoundTrip = signal(false);
  readonly showPassengerPicker = signal(false);
  readonly airports = signal<Airport[]>([]);

  origin = 'HAN';
  destination = 'SGN';
  departureDate = '';
  returnDate = '';
  cabinClass: CabinClass = CabinClass.ECONOMY;
  CabinClass = CabinClass;

  adults = 1;
  children = 0;
  seniors = 0;

  todayStr = new Date().toISOString().split('T')[0];

  popularRoutes = [
    { from: 'HAN', to: 'SGN', fromCity: 'Hà Nội', toCity: 'TP. Hồ Chí Minh', duration: '2h 10m', price: '1.250.000 VND' },
    { from: 'SGN', to: 'DAD', fromCity: 'TP. Hồ Chí Minh', toCity: 'Đà Nẵng', duration: '1h 20m', price: '890.000 VND' },
    { from: 'HAN', to: 'CXR', fromCity: 'Hà Nội', toCity: 'Nha Trang', duration: '1h 50m', price: '1.150.000 VND' },
    { from: 'DAD', to: 'PQC', fromCity: 'Đà Nẵng', toCity: 'Phú Quốc', duration: '1h 45m', price: '1.350.000 VND' },
  ];

  ngOnInit(): void {
    // Set default departure date tomorrow
    const d = new Date();
    d.setDate(d.getDate() + 1);
    this.departureDate = d.toISOString().split('T')[0];

    const ret = new Date(d);
    ret.setDate(ret.getDate() + 3);
    this.returnDate = ret.toISOString().split('T')[0];

    this.fetchAirports();
  }

  fetchAirports(): void {
    this.api.getAirports().subscribe({
      next: (list) => {
        if (list && list.length > 0) {
          this.airports.set(list);
        } else {
          // Default fallbacks if backend db is newly initiated
          this.airports.set([
            { iata_code: 'HAN', city_name: 'Hà Nội', airport_name: 'Nội Bài', is_serviced_directly: true },
            { iata_code: 'SGN', city_name: 'Hồ Chí Minh', airport_name: 'Tân Sơn Nhất', is_serviced_directly: true },
            { iata_code: 'DAD', city_name: 'Đà Nẵng', airport_name: 'Đà Nẵng', is_serviced_directly: true },
            { iata_code: 'CXR', city_name: 'Nha Trang', airport_name: 'Cam Ranh', is_serviced_directly: true },
            { iata_code: 'PQC', city_name: 'Phú Quốc', airport_name: 'Phú Quốc', is_serviced_directly: true },
          ]);
        }
      },
      error: () => {
        this.airports.set([
          { iata_code: 'HAN', city_name: 'Hà Nội', airport_name: 'Nội Bài', is_serviced_directly: true },
          { iata_code: 'SGN', city_name: 'Hồ Chí Minh', airport_name: 'Tân Sơn Nhất', is_serviced_directly: true },
          { iata_code: 'DAD', city_name: 'Đà Nẵng', airport_name: 'Đà Nẵng', is_serviced_directly: true },
          { iata_code: 'CXR', city_name: 'Nha Trang', airport_name: 'Cam Ranh', is_serviced_directly: true },
          { iata_code: 'PQC', city_name: 'Phú Quốc', airport_name: 'Phú Quốc', is_serviced_directly: true },
        ]);
      },
    });
  }

  swapAirports(): void {
    const temp = this.origin;
    this.origin = this.destination;
    this.destination = temp;
  }

  selectPopularRoute(from: string, to: string): void {
    this.origin = from;
    this.destination = to;
    window.scrollTo({ top: 120, behavior: 'smooth' });
  }

  totalPassengers(): number {
    return this.adults + this.children + this.seniors;
  }

  onSearch(): void {
    if (!this.origin || !this.destination) {
      this.toast.warning('Vui lòng chọn cả điểm đi và điểm đến');
      return;
    }
    if (this.origin === this.destination) {
      this.toast.warning('Điểm đi và điểm đến không được trùng nhau');
      return;
    }
    if (!this.departureDate) {
      this.toast.warning('Vui lòng chọn ngày khởi hành');
      return;
    }

    const queryParams: any = {
      origin: this.origin,
      destination: this.destination,
      departure_date: this.departureDate,
      cabin_class: this.cabinClass,
      adults: this.adults,
      children: this.children,
      seniors: this.seniors,
    };

    if (this.isRoundTrip() && this.returnDate) {
      queryParams.return_date = this.returnDate;
    }

    this.router.navigate(['/results'], { queryParams });
  }
}
