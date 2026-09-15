import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { SeatMapModalComponent } from '../../shared/components/seat-map-modal/seat-map-modal.component';
import { PassengerType, BookingType } from '../../core/models/booking.model';

interface PassengerFormModel {
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport: string;
  nationality: string;
  date_of_birth: string;
  seat_code: string;
}

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    CurrencyFormatPipe,
    SeatMapModalComponent,
  ],
  template: `
    <div class="min-h-screen bg-slate-50 py-10">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div class="mb-8">
          <h1 class="text-2xl sm:text-3xl font-black text-navy">
            {{ lang.t('booking.title') }}
          </h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">
            Vui lòng điền thông tin chính xác theo giấy tờ tùy thân (CCCD / Hộ chiếu) của từng hành khách.
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          <!-- Left Column: Forms (8 cols) -->
          <div class="lg:col-span-8 space-y-6">
            
            <!-- Step 1: Passenger Details Card -->
            <div class="card-luxury p-6 shadow-sm border-slate-200">
              <div class="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                <h3 class="text-base font-bold text-navy flex items-center gap-2">
                  <app-icon name="users" class="w-5 h-5 text-gold" />
                  <span>{{ lang.t('booking.step1') }}</span>
                </h3>
                <span class="text-xs font-semibold text-slate-500">
                  {{ passengers.length }} hành khách
                </span>
              </div>

              <div class="space-y-6">
                @for (p of passengers; track $index) {
                  <div class="p-5 rounded-2xl bg-slate-50/70 border border-slate-200/80 space-y-4">
                    
                    <!-- Passenger Header -->
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center">
                          {{ $index + 1 }}
                        </div>
                        <span class="text-sm font-bold text-slate-800">
                          Hành khách {{ $index + 1 }} ({{ getPassengerTypeLabel(p.passenger_type) }})
                        </span>
                      </div>

                      <!-- Seat Badge or Trigger -->
                      <button
                        type="button"
                        (click)="openSeatMap()"
                        class="text-xs font-semibold px-3 py-1 rounded-full border transition-all flex items-center gap-1.5"
                        [ngClass]="p.seat_code ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-navy border-slate-300 hover:border-gold'"
                      >
                        <app-icon name="armchair" class="w-3.5 h-3.5" />
                        <span>{{ p.seat_code ? ('Ghế: ' + p.seat_code) : lang.t('booking.selectSeatNow') }}</span>
                      </button>
                    </div>

                    <!-- Input Grid -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.lastName') }} <span class="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          [(ngModel)]="p.last_name"
                          placeholder="NGUYEN"
                          class="w-full uppercase px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>

                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.firstName') }} <span class="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          [(ngModel)]="p.first_name"
                          placeholder="VAN AN"
                          class="w-full uppercase px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>

                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.idPassport') }} <span class="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          [(ngModel)]="p.id_card_or_passport"
                          placeholder="Số CCCD hoặc Hộ chiếu"
                          class="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>

                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.nationality') }}
                        </label>
                        <input
                          type="text"
                          [(ngModel)]="p.nationality"
                          placeholder="Việt Nam"
                          class="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>

                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.dob') }}
                        </label>
                        <input
                          type="date"
                          [(ngModel)]="p.date_of_birth"
                          class="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                      </div>

                      <div>
                        <label class="block font-semibold text-slate-600 mb-1">
                          {{ lang.t('booking.passengerType') }}
                        </label>
                        <select
                          [(ngModel)]="p.passenger_type"
                          class="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                        >
                          <option [value]="PassengerType.ADULT">Người lớn (Adult)</option>
                          <option [value]="PassengerType.CHILD">Trẻ em (Child)</option>
                          <option [value]="PassengerType.SENIOR">Người cao tuổi (Senior)</option>
                        </select>
                      </div>
                    </div>

                  </div>
                }
              </div>
            </div>

            <!-- Step 2: Booking Mode Selection (Hold vs Buy Now) -->
            <div class="card-luxury p-6 shadow-sm border-slate-200">
              <h3 class="text-base font-bold text-navy flex items-center gap-2 mb-4">
                <app-icon name="ticket" class="w-5 h-5 text-gold" />
                <span>{{ lang.t('booking.step2') }}</span>
              </h3>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <!-- Option 1: Hold Ticket (Block) -->
                <div
                  (click)="canHoldTicket && isBlock.set(true)"
                  [class.border-gold]="isBlock()"
                  [class.bg-amber-50/50]="isBlock()"
                  [class.opacity-60]="!canHoldTicket"
                  [class.cursor-not-allowed]="!canHoldTicket"
                  [class.cursor-pointer]="canHoldTicket"
                  class="p-5 rounded-2xl border-2 transition-all relative"
                >
                  <div class="flex items-start justify-between mb-2">
                    <span class="text-xs font-bold text-amber-600 bg-amber-100 px-2.5 py-0.5 rounded-full">
                      Miễn phí
                    </span>
                    <input
                      type="radio"
                      [checked]="isBlock()"
                      [disabled]="!canHoldTicket"
                      name="bookingMode"
                      class="text-gold focus:ring-gold"
                    />
                  </div>
                  <h4 class="text-sm font-bold text-navy">{{ lang.t('booking.holdOption') }}</h4>
                  <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                    {{ lang.t('booking.holdDesc') }}
                  </p>
                  @if (!canHoldTicket) {
                    <div class="mt-3 text-[11px] font-semibold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-200 flex items-center gap-1.5">
                      <app-icon name="alerttriangle" class="w-3.5 h-3.5" />
                      <span>Chuyến bay khởi hành trong vòng 14 ngày (không hỗ trợ giữ chỗ).</span>
                    </div>
                  } @else {
                    <div class="mt-3 text-[11px] text-emerald-700 font-medium">
                      Thời hạn giữ chỗ: Tối đa 24h hoặc trước ngày bay 14 ngày.
                    </div>
                  }
                </div>

                <!-- Option 2: Buy Immediately -->
                <div
                  (click)="isBlock.set(false)"
                  [class.border-gold]="!isBlock()"
                  [class.bg-amber-50/50]="!isBlock()"
                  class="p-5 rounded-2xl border-2 cursor-pointer transition-all relative"
                >
                  <div class="flex items-start justify-between mb-2">
                    <span class="text-xs font-bold text-emerald-600 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      Xuất vé ngay
                    </span>
                    <input
                      type="radio"
                      [checked]="!isBlock()"
                      name="bookingMode"
                      class="text-gold focus:ring-gold"
                    />
                  </div>
                  <h4 class="text-sm font-bold text-navy">{{ lang.t('booking.buyOption') }}</h4>
                  <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                    {{ lang.t('booking.buyDesc') }}
                  </p>
                  <div class="mt-3 text-[11px] text-slate-500">
                    Nhận mã vé chính thức, tích lũy dặm bay SkyMiles ngay sau thanh toán.
                  </div>
                </div>
              </div>
            </div>

            <!-- Step 3: Payment Details (Only required if Buy Now) -->
            @if (!isBlock()) {
              <div class="card-luxury p-6 shadow-sm border-slate-200 animate-fade-in">
                <div class="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                  <h3 class="text-base font-bold text-navy flex items-center gap-2">
                    <app-icon name="creditcard" class="w-5 h-5 text-gold" />
                    <span>{{ lang.t('booking.cardInfo') }}</span>
                  </h3>
                  <span class="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <app-icon name="shieldcheck" class="w-4 h-4" />
                    Bảo mật 256-bit SSL
                  </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div class="sm:col-span-2">
                    <label class="block font-semibold text-slate-600 mb-1">
                      {{ lang.t('booking.cardNumber') }} <span class="text-rose-500">*</span>
                    </label>
                    <div class="relative">
                      <app-icon name="creditcard" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        [(ngModel)]="creditCardNumber"
                        maxlength="19"
                        placeholder="4111 2222 3333 4444"
                        class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">
                      {{ lang.t('booking.cardName') }} <span class="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="cardName"
                      placeholder="NGUYEN VAN AN"
                      class="w-full uppercase px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block font-semibold text-slate-600 mb-1">
                        {{ lang.t('booking.cardExp') }}
                      </label>
                      <input
                        type="text"
                        [(ngModel)]="cardExp"
                        placeholder="12/28"
                        maxlength="5"
                        class="w-full text-center px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold font-mono"
                      />
                    </div>
                    <div>
                      <label class="block font-semibold text-slate-600 mb-1">
                        {{ lang.t('booking.cardCvv') }}
                      </label>
                      <input
                        type="password"
                        [(ngModel)]="cardCvv"
                        placeholder="•••"
                        maxlength="4"
                        class="w-full text-center px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div class="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-[11px] text-slate-500">
                  Gợi ý kiểm thử: Sử dụng số thẻ visa mẫu <strong>4111222233334444</strong> (hệ thống mô phỏng thanh toán trực tuyến).
                </div>
              </div>
            }

          </div>

          <!-- Right Column: Summary & Checkout Button (4 cols) -->
          <div class="lg:col-span-4 sticky top-24 space-y-4">
            <div class="card-luxury p-6 shadow-lg border-slate-200">
              <h3 class="text-base font-bold text-navy border-b border-slate-100 pb-3 mb-4">
                {{ lang.t('booking.summary') }}
              </h3>

              <!-- Flight Itinerary Details -->
              <div class="space-y-3 text-xs mb-5">
                <div class="flex items-center justify-between">
                  <span class="text-slate-500">Chặng bay:</span>
                  <strong class="text-navy font-bold">{{ context?.origin }} - {{ context?.destination }}</strong>
                </div>

                @if (context?.flight) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Chuyến bay:</span>
                    <strong class="text-navy font-mono font-bold">{{ context.flight.flight_number }}</strong>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Khởi hành:</span>
                    <span class="text-slate-800">{{ context.flight.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">Hạng vé:</span>
                    <span class="font-bold text-amber-600">{{ context.flight.cabin_class }}</span>
                  </div>
                } @else if (context?.connecting) {
                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                    <div class="font-bold text-navy">Chuyến bay nối chuyến:</div>
                    <div class="text-[11px] text-slate-600">Chặng 1: {{ context.connecting.leg_1.flight_number }}</div>
                    <div class="text-[11px] text-slate-600">Chặng 2: {{ context.connecting.leg_2.flight_number }}</div>
                    <div class="text-[10px] text-amber-600 font-semibold">Điểm dừng: {{ context.connecting.transit_airport }}</div>
                  </div>
                }

                <div class="flex items-center justify-between">
                  <span class="text-slate-500">Số lượng khách:</span>
                  <span class="text-slate-800 font-medium">{{ passengers.length }} người</span>
                </div>
              </div>

              <!-- Price Breakdown -->
              <div class="border-t border-slate-100 pt-4 space-y-2 text-xs">
                <div class="flex items-center justify-between text-slate-600">
                  <span>Giá vé cơ bản:</span>
                  <span>{{ (totalAmount * 0.9) | currencyFormat }}</span>
                </div>
                <div class="flex items-center justify-between text-slate-600">
                  <span>Thuế, phí sân bay & VAT:</span>
                  <span>{{ (totalAmount * 0.1) | currencyFormat }}</span>
                </div>
                <div class="flex items-center justify-between text-sm font-black text-navy pt-2 border-t border-slate-100">
                  <span>{{ lang.t('booking.fareTotal') }}</span>
                  <span class="text-lg text-amber-600">{{ totalAmount | currencyFormat }}</span>
                </div>
              </div>

              <!-- Action Submit Button -->
              <div class="mt-6">
                <button
                  type="button"
                  (click)="submitBooking()"
                  [disabled]="loading()"
                  class="btn-gold w-full text-sm !py-3.5 uppercase tracking-wider font-bold"
                >
                  @if (loading()) {
                    <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                    <span>{{ lang.t('common.loading') }}</span>
                  } @else if (isBlock()) {
                    <app-icon name="shieldcheck" class="w-4 h-4" />
                    <span>{{ lang.t('booking.btnHolding') }}</span>
                  } @else {
                    <app-icon name="creditcard" class="w-4 h-4" />
                    <span>{{ lang.t('booking.btnConfirm') }}</span>
                  }
                </button>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>

    <!-- Seat Map Modal for updating seats -->
    <app-seat-map-modal
      [isOpen]="isSeatMapOpen()"
      [flightId]="context?.flight?.flight_id || ''"
      [flightNumber]="context?.flight?.flight_number || ''"
      [routeInfo]="(context?.origin || '') + ' - ' + (context?.destination || '')"
      [passengerList]="getSeatMapPassengerList()"
      [initialSeats]="assignedSeatsMap()"
      (closeEvent)="isSeatMapOpen.set(false)"
      (seatsConfirmed)="handleSeatsConfirmed($event)"
    />
  `,
})
export class BookingComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly isBlock = signal(false);
  readonly isSeatMapOpen = signal(false);
  readonly loading = signal(false);

  context: any = null;
  passengers: PassengerFormModel[] = [];
  canHoldTicket = false;
  totalAmount = 0;

  PassengerType = PassengerType;

  creditCardNumber = '';
  cardName = '';
  cardExp = '12/28';
  cardCvv = '888';

  ngOnInit(): void {
    const raw = sessionStorage.getItem('booking_context');
    if (!raw) {
      this.toast.warning('Không tìm thấy thông tin chuyến bay đã chọn');
      this.router.navigate(['/']);
      return;
    }

    this.context = JSON.parse(raw);
    this.initPassengers();
    this.checkHoldEligibility();
    this.totalAmount = this.context.pricing?.total_party_price || 0;

    // Prefill user data if logged in
    const u = this.auth.currentUser();
    if (u) {
      if (this.passengers[0]) {
        this.passengers[0].first_name = u.first_name || '';
        this.passengers[0].last_name = u.last_name || '';
        this.passengers[0].id_card_or_passport = u.phone_number || '';
      }
      this.cardName = `${u.first_name} ${u.last_name}`.toUpperCase();
      this.creditCardNumber = u.preferred_credit_card || '4111222233334444';
    } else {
      this.creditCardNumber = '4111222233334444';
      this.cardName = 'NGUYEN VAN AN';
    }
  }

  private initPassengers(): void {
    const total = this.context.totalPassengers || 1;
    const adults = this.context.adults || 1;
    const children = this.context.children || 0;
    const seniors = this.context.seniors || 0;
    const seats = this.context.seats || {};

    const list: PassengerFormModel[] = [];
    let idx = 0;

    for (let i = 0; i < adults; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.ADULT,
        id_card_or_passport: '',
        nationality: 'Việt Nam',
        date_of_birth: '1990-01-01',
        seat_code: seats[idx] || '',
      });
      idx++;
    }

    for (let i = 0; i < children; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.CHILD,
        id_card_or_passport: '',
        nationality: 'Việt Nam',
        date_of_birth: '2016-01-01',
        seat_code: seats[idx] || '',
      });
      idx++;
    }

    for (let i = 0; i < seniors; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.SENIOR,
        id_card_or_passport: '',
        nationality: 'Việt Nam',
        date_of_birth: '1960-01-01',
        seat_code: seats[idx] || '',
      });
      idx++;
    }

    this.passengers = list;
  }

  private checkHoldEligibility(): void {
    if (!this.context.departure_date) {
      this.canHoldTicket = false;
      return;
    }
    const dep = new Date(this.context.departure_date).getTime();
    const now = new Date().getTime();
    const diffDays = Math.ceil((dep - now) / (1000 * 60 * 60 * 24));

    // Requirement 3.3.4 & 3.5: Free reservation only permitted if departure > 14 days
    this.canHoldTicket = diffDays > 14;
    this.isBlock.set(this.canHoldTicket);
  }

  getPassengerTypeLabel(type: PassengerType): string {
    switch (type) {
      case PassengerType.ADULT:
        return 'Người lớn';
      case PassengerType.CHILD:
        return 'Trẻ em';
      case PassengerType.SENIOR:
        return 'Người cao tuổi';
    }
  }

  openSeatMap(): void {
    this.isSeatMapOpen.set(true);
  }

  getSeatMapPassengerList(): Array<{ name: string; type: string }> {
    return this.passengers.map((p, i) => ({
      name: (p.first_name && p.last_name) ? `${p.last_name} ${p.first_name}` : `Hành khách ${i + 1}`,
      type: this.getPassengerTypeLabel(p.passenger_type),
    }));
  }

  assignedSeatsMap(): Record<number, string> {
    const map: Record<number, string> = {};
    this.passengers.forEach((p, i) => {
      if (p.seat_code) map[i] = p.seat_code;
    });
    return map;
  }

  handleSeatsConfirmed(seats: Record<number, string>): void {
    this.passengers.forEach((p, i) => {
      p.seat_code = seats[i] || '';
    });
    this.toast.success('Đã cập nhật vị trí ghế ngồi cho từng hành khách');
  }

  submitBooking(): void {
    // Validate passengers
    for (let i = 0; i < this.passengers.length; i++) {
      const p = this.passengers[i];
      if (!p.first_name || !p.last_name) {
        this.toast.warning(`Vui lòng nhập họ và tên của Hành khách ${i + 1}`);
        return;
      }
      if (!p.id_card_or_passport) {
        this.toast.warning(`Vui lòng nhập số CCCD / Hộ chiếu của Hành khách ${i + 1}`);
        return;
      }
    }

    if (!this.isBlock() && !this.creditCardNumber) {
      this.toast.warning('Vui lòng nhập số thẻ tín dụng thanh toán');
      return;
    }

    this.loading.set(true);

    // Prepare flight legs
    const legs: any[] = [];
    if (this.context.flight) {
      legs.push({
        flight_id: this.context.flight.flight_id,
        inventory_id: this.context.flight.inventory_id,
        leg_type: 'OUTBOUND',
      });
    } else if (this.context.connecting) {
      legs.push(
        {
          flight_id: this.context.connecting.leg_1.flight_id,
          inventory_id: this.context.connecting.leg_1.inventory_id,
          leg_type: 'CONNECTING_1',
        },
        {
          flight_id: this.context.connecting.leg_2.flight_id,
          inventory_id: this.context.connecting.leg_2.inventory_id,
          leg_type: 'CONNECTING_2',
        },
      );
    }

    const payload = {
      user_id: this.auth.currentUser()?._id || '6614bb53443a5951d1112222', // Seed or guest user id
      booking_type: this.context.connecting ? BookingType.CONNECTING : BookingType.ONE_WAY,
      is_block: this.isBlock(),
      passengers: this.passengers,
      legs: legs,
      credit_card_number: this.isBlock() ? undefined : this.creditCardNumber.replace(/\s+/g, ''),
    };

    this.api.createBooking(payload).subscribe({
      next: (booking) => {
        this.loading.set(false);
        sessionStorage.removeItem('booking_context');
        sessionStorage.setItem('confirmed_booking', JSON.stringify(booking));
        this.router.navigate(['/booking-success']);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || 'Đặt vé không thành công. Vui lòng thử lại.');
      },
    });
  }
}
