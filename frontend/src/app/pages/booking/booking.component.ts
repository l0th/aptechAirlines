import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { AuthModalService } from '../../shared/services/auth-modal.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { SeatMapModalComponent } from '../../shared/components/seat-map-modal/seat-map-modal.component';
import {
  PassengerType,
  BookingType,
  LegType,
  FlightLegSelection,
  PassengerInput,
} from '../../core/models/booking.model';

interface PassengerFormModel {
  first_name: string;
  last_name: string;
  passenger_type: PassengerType;
  id_card_or_passport: string;
  nationality: string;
  date_of_birth: string;
  seat_code: string;
  /** Seat code assigned for the return flight in round-trip bookings. */
  return_seat_code?: string;
}

/** Passenger payload sent to POST /api/bookings supporting per-leg seat mapping. */
interface BookingPassengerPayload extends PassengerInput {
  seat_codes?: Record<string, string>;
}

/** GET-formatted flight written into sessionStorage['booking_context'] by /results. */
interface ContextFlight {
  flight_id: string;
  flight_number: string;
  origin_iata?: string;
  dest_iata?: string;
  departure_date?: string;
  scheduled_departure?: string;
  scheduled_arrival?: string;
  scheduled_departure_local?: string;
  scheduled_arrival_local?: string;
  origin_time_zone?: string;
  dest_time_zone?: string;
  time_zone_diff_minutes?: number;
  duration_minutes?: number;
  distance_miles?: number;
  inventory_id: string;
  cabin_class?: string;
  available_seats?: number;
  base_price_per_adult?: number;
  total_party_price?: number;
  early_bird_percent?: number;
  early_bird_label?: string;
  days_until_departure?: number;
}

/** One leg of a CONNECTING itinerary as written by /results. */
interface ContextConnectingLeg {
  flight?: {
    flight_id?: string;
    flight_number?: string;
    origin_iata?: string;
    dest_iata?: string;
    departure?: string;
    scheduled_departure?: string;
    arrival?: string;
    scheduled_arrival?: string;
    scheduled_departure_local?: string;
    scheduled_arrival_local?: string;
    origin_time_zone?: string;
    dest_time_zone?: string;
    time_zone_diff_minutes?: number;
    inventories?: any[];
  };
  inventory?: {
    _id?: string;
    cabin_class?: string;
    base_price?: number;
    early_bird_percent?: number;
    early_bird_label?: string;
    days_until_departure?: number;
  };
}

/** sessionStorage['booking_context'] contract (see /results). */
interface BookingContext {
  mode?: 'DIRECT' | 'CONNECTING';
  flight?: ContextFlight | null;
  return_flight?: ContextFlight | null;
  connecting?: {
    leg1?: ContextConnectingLeg;
    leg2?: ContextConnectingLeg;
    transit_airport?: string;
    layover_minutes?: number;
  } | null;
  origin?: string;
  destination?: string;
  departure_date?: string;
  adults?: number;
  children?: number;
  seniors?: number;
  totalPassengers?: number;
  seats?: Record<number, string>;
  return_seats?: Record<number, string>;
  total_party_price?: number;
  /** Legacy key kept only as a read-only fallback while /results migrates. */
  pricing?: { total_party_price?: number };
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
            {{ lang.isVietnamese() ? 'Vui lòng điền thông tin chính xác theo giấy tờ tùy thân (CCCD / Hộ chiếu) của từng hành khách.' : 'Please enter accurate information according to official travel documents (National ID / Passport) for each passenger.' }}
          </p>
        </div>

        <!-- Guest notice: login is required before buying or holding a ticket -->
        @if (!auth.isAuthenticated()) {
          <div class="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-xs font-semibold text-amber-900">
              <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600 shrink-0" />
              <span>{{ lang.t('booking.loginRequired') }}</span>
            </div>
            <button
              type="button"
              (click)="authModal.open()"
              class="btn-gold !py-2 !px-5 text-xs shrink-0"
            >
              <app-icon name="user" class="w-4 h-4" />
              <span>{{ lang.t('nav.login') }} / {{ lang.t('nav.register') }}</span>
            </button>
          </div>
        }

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
                  {{ passengers.length }} {{ lang.isVietnamese() ? 'hành khách' : 'passenger(s)' }}
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
                          {{ lang.isVietnamese() ? 'Hành khách ' : 'Passenger ' }}{{ $index + 1 }} ({{ getPassengerTypeLabel(p.passenger_type) }})
                        </span>
                      </div>

                      <!-- Seat Badge or Trigger (hidden when the flight is unknown) -->
                      @if (seatMapFlightId) {
                        <button
                          type="button"
                          (click)="openSeatMap()"
                          class="text-xs font-semibold px-3 py-1 rounded-full border transition-all flex items-center gap-1.5"
                          [ngClass]="hasAssignedSeat(p, $index) ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-navy border-slate-300 hover:border-gold'"
                        >
                          <app-icon name="armchair" class="w-3.5 h-3.5" />
                          <span>{{ getPassengerSeatBadgeLabel(p, $index) }}</span>
                        </button>
                      } @else {
                        <span class="text-[11px] font-semibold text-slate-400 italic">
                          {{ lang.isVietnamese() ? 'Không xác định được chuyến bay để chọn ghế' : 'Cannot identify flight to select seats' }}
                        </span>
                      }
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
                          [placeholder]="lang.isVietnamese() ? 'Số CCCD hoặc Hộ chiếu' : 'National ID or Passport number'"
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
                          [placeholder]="lang.isVietnamese() ? 'Việt Nam' : 'Vietnam'"
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
                          <option [value]="PassengerType.ADULT">{{ lang.isVietnamese() ? 'Người lớn (Adult)' : 'Adult' }}</option>
                          <option [value]="PassengerType.CHILD">{{ lang.isVietnamese() ? 'Trẻ em (Child)' : 'Child' }}</option>
                          <option [value]="PassengerType.SENIOR">{{ lang.isVietnamese() ? 'Người cao tuổi (Senior)' : 'Senior' }}</option>
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
                      {{ lang.isVietnamese() ? 'Miễn phí' : 'Free' }}
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
                      <span>{{ lang.isVietnamese() ? 'Chuyến bay khởi hành trong vòng 14 ngày (không hỗ trợ giữ chỗ).' : 'Flight departs within 14 days (seat hold not supported).' }}</span>
                    </div>
                  } @else {
                    <div class="mt-3 text-[11px] text-emerald-700 font-medium leading-relaxed">
                      @if (lang.isVietnamese()) {
                        {{ lang.t('booking.holdFreeNotice1') }} <strong>{{ lang.t('booking.holdFreeNotice2') }}</strong>. {{ lang.t('booking.holdFreeNotice3') }}
                        <strong>{{ holdDeadlineText }}</strong>
                        {{ lang.t('booking.holdFreeNotice4') }}
                      } @else {
                        <strong>Free</strong> reservation. You must confirm &amp; complete payment before
                        <strong>{{ holdDeadlineText }}</strong>
                        (hold deadline = departure date − 14 days). Expired holds will be automatically released.
                      }
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
                      {{ lang.isVietnamese() ? 'Xuất vé ngay' : 'Instant Ticket' }}
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
                    {{ lang.isVietnamese() ? 'Nhận mã vé chính thức, tích lũy dặm bay SkyMiles ngay sau thanh toán.' : 'Receive official ticket code and earn SkyMiles immediately after payment.' }}
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
                    {{ lang.isVietnamese() ? 'Bảo mật 256-bit SSL' : '256-bit SSL Security' }}
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
                      {{ lang.t('booking.cardName') }}
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

                <div class="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-[11px] text-slate-500 space-y-1">
                  <div>
                    {{ lang.isVietnamese() ? 'Gợi ý kiểm thử: Sử dụng số thẻ visa mẫu ' : 'Testing hint: Use sample Visa card ' }}<strong>4111222233334444</strong>{{ lang.isVietnamese() ? ' (hệ thống mô phỏng thanh toán trực tuyến).' : ' (online payment simulation).' }}
                  </div>
                  <div>
                    @if (lang.isVietnamese()) {
                      {{ lang.t('booking.paymentMockNotice1') }}
                      <strong>{{ lang.t('booking.paymentMockNotice2') }}</strong> {{ lang.t('booking.paymentMockNotice3') }}
                    } @else {
                      Expiration date &amp; CVV are only format-checked in the browser — the simulated system only requires
                      the <strong>card number</strong> (12–19 digits) to process payment.
                    }
                  </div>
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
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Chặng bay:' : 'Route:' }}</span>
                  <strong class="text-navy font-bold">{{ context?.origin }} - {{ context?.destination }}</strong>
                </div>

                @if (context?.flight; as fl) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Chuyến bay:' : 'Flight:' }}</span>
                    <strong class="text-navy font-mono font-bold">{{ fl.flight_number }}</strong>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Khởi hành:' : 'Departure:' }}</span>
                    <span class="text-slate-800">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Hạng vé:' : 'Cabin Class:' }}</span>
                    <span class="font-bold text-amber-600">{{ fl.cabin_class }}</span>
                  </div>
                } @else if (context?.connecting; as conn) {
                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
                    <div class="font-bold text-navy">{{ lang.isVietnamese() ? 'Chuyến bay nối chuyến:' : 'Connecting flight:' }}</div>
                    
                    <!-- Leg 1 -->
                    <div class="border-b border-slate-200/60 pb-1.5 space-y-0.5">
                      <div class="text-[11px] text-slate-700 flex items-center justify-between">
                        <div>
                          {{ lang.isVietnamese() ? 'Chặng 1: ' : 'Leg 1: ' }}<strong class="font-mono text-navy">{{ conn.leg1?.flight?.flight_number }}</strong>
                        </div>
                        <span class="text-slate-400">({{ conn.leg1?.flight?.origin_iata }} → {{ conn.leg1?.flight?.dest_iata }})</span>
                      </div>
                      <div class="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{{ lang.isVietnamese() ? 'Khởi hành: ' : 'Dep: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(conn.leg1?.flight?.scheduled_departure_local || conn.leg1?.flight?.departure) }}</strong> ({{ formatAirportGmt(conn.leg1?.flight?.origin_iata, conn.leg1?.flight?.origin_time_zone) }})</span>
                        <span>{{ lang.isVietnamese() ? 'Đến: ' : 'Arr: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(conn.leg1?.flight?.scheduled_arrival_local || conn.leg1?.flight?.arrival) }}</strong> ({{ formatAirportGmt(conn.leg1?.flight?.dest_iata, conn.leg1?.flight?.dest_time_zone) }})</span>
                      </div>
                    </div>

                    <!-- Leg 2 -->
                    <div class="space-y-0.5">
                      <div class="text-[11px] text-slate-700 flex items-center justify-between">
                        <div>
                          {{ lang.isVietnamese() ? 'Chặng 2: ' : 'Leg 2: ' }}<strong class="font-mono text-navy">{{ conn.leg2?.flight?.flight_number }}</strong>
                        </div>
                        <span class="text-slate-400">({{ conn.leg2?.flight?.origin_iata }} → {{ conn.leg2?.flight?.dest_iata }})</span>
                      </div>
                      <div class="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{{ lang.isVietnamese() ? 'Khởi hành: ' : 'Dep: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(conn.leg2?.flight?.scheduled_departure_local || conn.leg2?.flight?.departure) }}</strong> ({{ formatAirportGmt(conn.leg2?.flight?.origin_iata, conn.leg2?.flight?.origin_time_zone) }})</span>
                        <span>{{ lang.isVietnamese() ? 'Đến: ' : 'Arr: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(conn.leg2?.flight?.scheduled_arrival_local || conn.leg2?.flight?.arrival) }}</strong> ({{ formatAirportGmt(conn.leg2?.flight?.dest_iata, conn.leg2?.flight?.dest_time_zone) }})</span>
                      </div>
                    </div>

                    <div class="text-[10px] text-amber-600 font-semibold pt-1 border-t border-slate-200/60">
                      {{ lang.isVietnamese() ? 'Điểm dừng: ' : 'Transit airport: ' }}{{ conn.transit_airport }}
                      @if (conn.layover_minutes) {
                        • {{ lang.isVietnamese() ? 'Nối chuyến ' : 'Layover ' }}{{ conn.layover_minutes }} {{ lang.isVietnamese() ? 'phút (đã tính theo múi giờ)' : 'mins (computed across time zones)' }}
                      }
                    </div>
                  </div>
                }

                @if (context?.return_flight; as ret) {
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Chuyến về:' : 'Return flight:' }}</span>
                    <strong class="text-navy font-mono font-bold">{{ ret.flight_number }}</strong>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Khởi hành về:' : 'Return departure:' }}</span>
                    <span class="text-slate-800">{{ ret.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                }

                <div class="flex items-center justify-between">
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Số lượng khách:' : 'Total passengers:' }}</span>
                  <span class="text-slate-800 font-medium">{{ passengers.length }} {{ lang.isVietnamese() ? 'người' : 'passenger(s)' }}</span>
                </div>
              </div>

              <!-- Pricing Summary Block -->
              <div class="border-t border-slate-100 pt-4 space-y-2.5 text-xs">
                <h4 class="font-bold text-navy uppercase tracking-wider text-[11px] mb-1">
                  {{ lang.t('booking.pricingSummaryTitle') }}
                </h4>

                <!-- Base Fare -->
                <div class="flex items-center justify-between text-slate-600">
                  <span>{{ lang.t('booking.baseFare') }} ({{ passengers.length }} {{ lang.isVietnamese() ? 'khách' : 'passengers' }}):</span>
                  <span class="font-semibold text-slate-800">{{ baseFareAmount | currencyFormat }}</span>
                </div>

                <!-- Early-Booking Adjustment (percent + amount) -->
                @if (earlyBirdAdjustment.percent !== 0) {
                  <div class="flex items-center justify-between text-slate-600">
                    <span>
                      {{ lang.t('booking.earlyBirdAdjustment') }}
                      <strong [ngClass]="earlyBirdAdjustment.percent < 0 ? 'text-emerald-600' : 'text-amber-600'">
                        ({{ earlyBirdAdjustment.percent > 0 ? '+' : '' }}{{ earlyBirdAdjustment.percent }}%)
                      </strong>:
                    </span>
                    <span class="font-bold font-mono" [ngClass]="earlyBirdAdjustment.amount < 0 ? 'text-emerald-600' : 'text-amber-600'">
                      {{ earlyBirdAdjustment.amount > 0 ? '+' : '' }}{{ earlyBirdAdjustment.amount | currencyFormat }}
                    </span>
                  </div>
                }

                <!-- Subtotal / Applicable Fare -->
                <div class="flex items-center justify-between text-slate-700 pt-1 border-t border-slate-100">
                  <span>{{ lang.t('booking.currentTotalFare') }}:</span>
                  <span class="font-bold text-navy">{{ totalAmount | currencyFormat }}</span>
                </div>

                <!-- Frequent-Flyer Tier & Discount (compute tier client-side ONLY for display) -->
                @if (frequentFlyerTier; as ff) {
                  <div class="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/80 space-y-1.5 mt-2">
                    <div class="flex items-center justify-between text-amber-900 font-semibold text-[11px]">
                      <span class="flex items-center gap-1">
                        <app-icon name="award" class="w-3.5 h-3.5 text-gold" />
                        <span>{{ lang.t('booking.ffTierLabel') }}: <strong class="font-bold">{{ ff.tier }}</strong></span>
                      </span>
                      <span class="font-bold font-mono text-emerald-700">
                        @if (ff.discountPercent > 0) {
                          -{{ ff.discountPercent }}%
                        } @else {
                          0%
                        }
                      </span>
                    </div>

                    @if (ff.discountPercent > 0) {
                      <div class="flex items-center justify-between text-[11px] text-emerald-700 font-semibold">
                        <span>{{ lang.t('booking.ffDiscountEst') }}:</span>
                        <span class="font-mono">-{{ ff.estimatedDiscount | currencyFormat }}</span>
                      </div>
                    }

                    <div class="text-[10px] text-amber-800 leading-tight">
                      * {{ lang.t('booking.ffTierDisclaimer') }}
                    </div>
                  </div>
                }

                <div class="text-[10px] text-slate-500 leading-relaxed pt-1">
                  {{ lang.isVietnamese() ? 'Đã bao gồm thuế & phí sân bay theo quy định.' : 'Includes taxes & airport fees.' }}
                </div>

                <!-- Fare Total -->
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

    <!-- Seat Map Modal (DIRECT: outbound flight • CONNECTING: leg 1) -->
    @if (seatMapFlightId) {
      <app-seat-map-modal
        [isOpen]="isSeatMapOpen()"
        [flightId]="seatMapFlightId"
        [flightNumber]="seatMapFlightNumber"
        [routeInfo]="(context?.origin || '') + ' - ' + (context?.destination || '')"
        [passengerList]="getSeatMapPassengerList()"
        [initialSeats]="assignedSeatsMap()"
        (closeEvent)="isSeatMapOpen.set(false)"
        (seatsConfirmed)="handleSeatsConfirmed($event)"
      />
    }
  `,
})
export class BookingComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);
  readonly authModal = inject(AuthModalService);

  readonly isBlock = signal(false);
  readonly isSeatMapOpen = signal(false);
  readonly loading = signal(false);

  context: BookingContext | null = null;
  passengers: PassengerFormModel[] = [];
  canHoldTicket = false;
  totalAmount = 0;

  /** Earliest departure of the itinerary (backend uses it for the 14-day rule). */
  earliestDeparture: Date | null = null;
  /** Hold deadline = earliest departure − 14 days (mirrors backend `time_limit_deadline`). */
  holdDeadline: Date | null = null;
  /** Flight used by the seat map: DIRECT outbound, or CONNECTING leg 1. */
  seatMapFlightId = '';
  seatMapFlightNumber = '';

  PassengerType = PassengerType;
  LegType = LegType;

  creditCardNumber = '';
  cardName = '';
  /** Collected for on-screen format validation only — never sent to the API. */
  cardExp = '';
  cardCvv = '';

  get holdDeadlineText(): string {
    if (!this.holdDeadline) return this.lang.isVietnamese() ? 'ngày khởi hành − 14 ngày' : 'departure date − 14 days';
    const d = this.holdDeadline;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  get earlyBirdAdjustment(): { percent: number; amount: number; label: string } {
    let percent = 0;
    let label = '';
    const ctx = this.context;
    if (ctx?.flight && ctx.flight.early_bird_percent !== undefined) {
      percent = ctx.flight.early_bird_percent;
      label = ctx.flight.early_bird_label || '';
    } else if (ctx?.connecting?.leg1?.inventory?.early_bird_percent !== undefined) {
      percent = ctx.connecting.leg1.inventory.early_bird_percent;
      label = ctx.connecting.leg1.inventory.early_bird_label || '';
    }

    if (percent === 0 || !this.totalAmount) {
      return { percent: 0, amount: 0, label: label || (this.lang.isVietnamese() ? 'Giá chuẩn' : 'Standard fare') };
    }

    // Since totalAmount is already the early-booking price: totalAmount = baseFare * (1 + percent / 100)
    const ratio = 1 + percent / 100;
    const baseFare = Math.round(this.totalAmount / ratio);
    const amount = this.totalAmount - baseFare;
    return { percent, amount, label };
  }

  get baseFareAmount(): number {
    return this.totalAmount - this.earlyBirdAdjustment.amount;
  }

  get frequentFlyerTier(): { tier: string; miles: number; discountPercent: number; estimatedDiscount: number } | null {
    const user = this.auth.currentUser();
    if (!user) return null;
    const miles = user.sky_miles || 0;
    let tier = 'MEMBER';
    let discountPercent = 0;
    if (miles >= 100000) {
      tier = 'PLATINUM';
      discountPercent = 12;
    } else if (miles >= 50000) {
      tier = 'GOLD';
      discountPercent = 7;
    } else if (miles >= 20000) {
      tier = 'SILVER';
      discountPercent = 3;
    } else {
      tier = 'MEMBER';
      discountPercent = 0;
    }

    const estimatedDiscount = Math.round(this.totalAmount * (discountPercent / 100));
    return { tier, miles, discountPercent, estimatedDiscount };
  }

  formatLegLocalTime(val?: string): string {
    if (!val) return '—';
    const trimmed = val.trim();
    if (trimmed.includes('T')) {
      const parts = trimmed.split('T');
      return parts[1]?.slice(0, 5) || trimmed;
    }
    if (trimmed.includes(' ')) {
      const parts = trimmed.split(' ');
      return parts[1]?.slice(0, 5) || trimmed;
    }
    return trimmed.slice(0, 5);
  }

  formatAirportGmt(iata?: string, tz?: string): string {
    const timeZone = tz || (iata === 'SIN' ? 'Asia/Singapore' : (iata === 'BKK' ? 'Asia/Bangkok' : 'Asia/Ho_Chi_Minh'));
    if (timeZone.includes('Singapore') || timeZone.includes('Kuala_Lumpur') || timeZone.includes('Hong_Kong') || timeZone.includes('Shanghai') || timeZone.includes('Taipei') || timeZone.includes('Manila')) {
      return 'GMT+8';
    }
    if (timeZone.includes('Tokyo') || timeZone.includes('Seoul')) {
      return 'GMT+9';
    }
    if (timeZone.includes('London')) return 'GMT+0';
    if (timeZone.includes('Paris') || timeZone.includes('Berlin')) return 'GMT+1';
    if (timeZone.includes('Dubai')) return 'GMT+4';
    return 'GMT+7';
  }

  ngOnInit(): void {
    const raw = sessionStorage.getItem('booking_context');
    if (!raw) {
      this.toast.warning(this.lang.isVietnamese() ? 'Không tìm thấy thông tin chuyến bay đã chọn' : 'No flight selection information found');
      this.router.navigate(['/']);
      return;
    }

    try {
      this.context = JSON.parse(raw) as BookingContext;
    } catch {
      this.toast.error(this.lang.isVietnamese() ? 'Dữ liệu chuyến bay đã chọn không hợp lệ. Vui lòng tìm kiếm lại.' : 'Selected flight data is invalid. Please search again.');
      this.router.navigate(['/']);
      return;
    }

    this.initPassengers();
    this.resolveSeatMapTarget();
    this.checkHoldEligibility();
    // Total party price is provided by /results — never recompute tax/fees here.
    this.totalAmount =
      Number(this.context.total_party_price ?? this.context.pricing?.total_party_price ?? 0) || 0;

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

  /** Resolve the flight whose seat map can be opened (never pass an empty id). */
  private resolveSeatMapTarget(): void {
    const ctx = this.context;
    if (!ctx) return;

    if (ctx.mode === 'CONNECTING' || ctx.connecting) {
      // Only leg 1 of a connecting itinerary is selectable by the passenger.
      this.seatMapFlightId = ctx.connecting?.leg1?.flight?.flight_id || '';
      this.seatMapFlightNumber = ctx.connecting?.leg1?.flight?.flight_number || '';
      return;
    }

    this.seatMapFlightId = ctx.flight?.flight_id || '';
    this.seatMapFlightNumber = ctx.flight?.flight_number || '';
  }

  private initPassengers(): void {
    const ctx = this.context;
    const adults = ctx?.adults || 1;
    const children = ctx?.children || 0;
    const seniors = ctx?.seniors || 0;
    const seats = ctx?.seats || {};
    // Safely read return seats for round-trip itineraries (defaults to empty object if missing)
    const returnSeats = ctx?.return_seats || {};

    const list: PassengerFormModel[] = [];
    let idx = 0;

    for (let i = 0; i < adults; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.ADULT,
        id_card_or_passport: '',
        nationality: this.lang.isVietnamese() ? 'Việt Nam' : 'Vietnam',
        date_of_birth: '1990-01-01',
        seat_code: seats[idx] || '',
        return_seat_code: returnSeats[idx] || '',
      });
      idx++;
    }

    for (let i = 0; i < children; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.CHILD,
        id_card_or_passport: '',
        nationality: this.lang.isVietnamese() ? 'Việt Nam' : 'Vietnam',
        date_of_birth: '2016-01-01',
        seat_code: seats[idx] || '',
        return_seat_code: returnSeats[idx] || '',
      });
      idx++;
    }

    for (let i = 0; i < seniors; i++) {
      list.push({
        first_name: '',
        last_name: '',
        passenger_type: PassengerType.SENIOR,
        id_card_or_passport: '',
        nationality: this.lang.isVietnamese() ? 'Việt Nam' : 'Vietnam',
        date_of_birth: '1960-01-01',
        seat_code: seats[idx] || '',
        return_seat_code: returnSeats[idx] || '',
      });
      idx++;
    }

    this.passengers = list;
  }

  private checkHoldEligibility(): void {
    const ctx = this.context;
    this.earliestDeparture = null;
    this.holdDeadline = null;

    if (!ctx) {
      this.canHoldTicket = false;
      this.isBlock.set(false);
      return;
    }

    // Backend computes the rule on the EARLIEST departure of all legs.
    const scheduleCandidates: Array<string | undefined> = [];
    if (ctx.mode === 'CONNECTING' || ctx.connecting) {
      scheduleCandidates.push(
        ctx.connecting?.leg1?.flight?.departure,
        ctx.connecting?.leg1?.flight?.scheduled_departure,
        ctx.connecting?.leg2?.flight?.departure,
        ctx.connecting?.leg2?.flight?.scheduled_departure,
      );
    } else {
      scheduleCandidates.push(
        ctx.flight?.scheduled_departure,
        ctx.return_flight?.scheduled_departure,
      );
    }

    const toTime = (v?: string): number | null => {
      if (!v) return null;
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? null : t;
    };

    let times = scheduleCandidates
      .map(toTime)
      .filter((t): t is number => t !== null);

    // Fall back to the coarse search date only when no schedule was provided.
    if (!times.length) {
      const fallback = toTime(ctx.departure_date);
      if (fallback !== null) times = [fallback];
    }

    if (!times.length) {
      this.canHoldTicket = false;
      this.isBlock.set(false);
      return;
    }

    const earliest = new Date(Math.min(...times));
    this.earliestDeparture = earliest;
    // Mirrors backend `time_limit_deadline = earliestDeparture − 14 days`.
    this.holdDeadline = new Date(earliest.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Requirement 3.3.4 & 3.5: free hold only when days-until-departure > 14.
    // Math.floor keeps the frontend STRICTER than the backend (float compare
    // `<= 14`), so a hold can never bounce back with a 400.
    const diffDays = (earliest.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    this.canHoldTicket = Math.floor(diffDays) > 14;
    this.isBlock.set(this.canHoldTicket);
  }

  getPassengerTypeLabel(type: PassengerType): string {
    switch (type) {
      case PassengerType.ADULT:
        return this.lang.isVietnamese() ? 'Người lớn' : 'Adult';
      case PassengerType.CHILD:
        return this.lang.isVietnamese() ? 'Trẻ em' : 'Child';
      case PassengerType.SENIOR:
        return this.lang.isVietnamese() ? 'Người cao tuổi' : 'Senior';
    }
  }

  openSeatMap(): void {
    this.isSeatMapOpen.set(true);
  }

  getSeatMapPassengerList(): Array<{ name: string; type: string }> {
    return this.passengers.map((p, i) => ({
      name: (p.first_name && p.last_name) ? `${p.last_name} ${p.first_name}` : (this.lang.isVietnamese() ? `Hành khách ${i + 1}` : `Passenger ${i + 1}`),
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

  /** Whether the current booking is a round-trip direct flight with return flight info. */
  hasReturnFlight(): boolean {
    const ctx = this.context;
    if (!ctx || ctx.mode === 'CONNECTING' || ctx.connecting) return false;
    return !!(ctx.return_flight?.flight_id || ctx.return_flight);
  }

  /**
   * Return leg seat code for passenger index (falls back gracefully to empty string
   * if context.return_seats is missing from older session data).
   */
  getReturnSeat(index: number): string {
    const p = this.passengers[index];
    return (p?.return_seat_code || this.context?.return_seats?.[index] || '').trim().toUpperCase();
  }

  /** Check if a passenger has an assigned seat for any leg. */
  hasAssignedSeat(p: PassengerFormModel, index: number): boolean {
    return !!(p.seat_code?.trim() || this.getReturnSeat(index));
  }

  /**
   * Badge label shown in the passenger review card:
   * If round-trip with return seat: e.g. "Ghế đi: 9A - Ghế về: 14C".
   * If no return seats: keeps today's behaviour ("Ghế: 9A" or "Chọn ghế ngay").
   */
  getPassengerSeatBadgeLabel(p: PassengerFormModel, index: number): string {
    const returnSeat = this.getReturnSeat(index);
    const outboundSeat = (p.seat_code || '').trim().toUpperCase();

    if (this.hasReturnFlight() && returnSeat) {
      if (outboundSeat) {
        return this.lang.isVietnamese() ? `Ghế đi: ${outboundSeat} - Ghế về: ${returnSeat}` : `Outbound: ${outboundSeat} - Return: ${returnSeat}`;
      }
      return this.lang.isVietnamese() ? `Ghế về: ${returnSeat}` : `Return: ${returnSeat}`;
    }

    return outboundSeat ? (this.lang.isVietnamese() ? `Ghế: ${outboundSeat}` : `Seat: ${outboundSeat}`) : this.lang.t('booking.selectSeatNow');
  }

  handleSeatsConfirmed(seats: Record<number, string>): void {
    this.passengers.forEach((p, i) => {
      p.seat_code = seats[i] || '';
    });
    // Sync context.seats with user's modal selection so the first-leg seat stays consistent
    if (this.context) {
      this.context.seats = { ...(this.context.seats || {}) };
      this.passengers.forEach((p, i) => {
        if (p.seat_code) {
          this.context!.seats![i] = p.seat_code;
        } else if (this.context!.seats) {
          delete this.context!.seats[i];
        }
      });
    }
    this.toast.success(this.lang.isVietnamese() ? 'Đã cập nhật vị trí ghế ngồi cho từng hành khách' : 'Updated seat assignments for all passengers');
  }

  /**
   * Build the `legs` array for `POST /api/bookings`.
   *  DIRECT              → OUTBOUND (+ INBOUND when a return flight was chosen)
   *  CONNECTING          → CONNECTING_1 + CONNECTING_2 (leg ids come from the
   *                        nested `flight` / `inventory` objects of the context)
   */
  private buildLegs(): FlightLegSelection[] {
    const ctx = this.context;
    if (!ctx) return [];

    const legs: FlightLegSelection[] = [];

    if (ctx.mode === 'CONNECTING' || ctx.connecting) {
      const leg1 = ctx.connecting?.leg1;
      const leg2 = ctx.connecting?.leg2;

      const leg1FlightId = leg1?.flight?.flight_id || '';
      const leg1InventoryId = leg1?.inventory?._id || '';
      if (leg1FlightId && leg1InventoryId) {
        legs.push({
          flight_id: leg1FlightId,
          inventory_id: leg1InventoryId,
          leg_type: LegType.CONNECTING_1,
        });
      }

      const leg2FlightId = leg2?.flight?.flight_id || '';
      const leg2InventoryId = leg2?.inventory?._id || '';
      if (leg2FlightId && leg2InventoryId) {
        legs.push({
          flight_id: leg2FlightId,
          inventory_id: leg2InventoryId,
          leg_type: LegType.CONNECTING_2,
        });
      }

      return legs;
    }

    const outboundFlightId = ctx.flight?.flight_id || '';
    const outboundInventoryId = ctx.flight?.inventory_id || '';
    if (outboundFlightId && outboundInventoryId) {
      legs.push({
        flight_id: outboundFlightId,
        inventory_id: outboundInventoryId,
        leg_type: LegType.OUTBOUND,
      });
    }

    const returnFlightId = ctx.return_flight?.flight_id || '';
    const returnInventoryId = ctx.return_flight?.inventory_id || '';
    if (returnFlightId && returnInventoryId) {
      legs.push({
        flight_id: returnFlightId,
        inventory_id: returnInventoryId,
        leg_type: LegType.INBOUND,
      });
    }

    return legs;
  }

  private resolveBookingType(): BookingType {
    const ctx = this.context;
    if (!ctx) return BookingType.ONE_WAY;
    if (ctx.mode === 'CONNECTING' || ctx.connecting) return BookingType.CONNECTING;
    if (ctx.return_flight?.flight_id) return BookingType.ROUND_TRIP;
    return BookingType.ONE_WAY;
  }

  /**
   * Passengers sent to the API. Optional fields are only included when filled so
   * the backend never tries to cast an empty string into a Date.
   * Send both:
   *  - `seat_code`: seat for the first leg (for backward compatibility).
   *  - `seat_codes`: per-leg seat mapping with valid leg types (OUTBOUND, INBOUND, CONNECTING_1, CONNECTING_2).
   */
  private buildPassengerPayload(): BookingPassengerPayload[] {
    const ctx = this.context;
    const isConnecting = ctx?.mode === 'CONNECTING' || !!ctx?.connecting;
    const isRoundTrip = !isConnecting && !!(ctx?.return_flight?.flight_id || ctx?.return_flight);

    return this.passengers.map((p, i) => {
      const payload: BookingPassengerPayload = {
        first_name: p.first_name.trim(),
        last_name: p.last_name.trim(),
        passenger_type: p.passenger_type,
      };

      const idCard = p.id_card_or_passport.trim();
      if (idCard) payload.id_card_or_passport = idCard;

      const nationality = p.nationality.trim();
      if (nationality) payload.nationality = nationality;

      if (/^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth.trim())) {
        payload.date_of_birth = p.date_of_birth.trim();
      }

      // First leg seat: prioritize user's selection in this page (p.seat_code), fallback to context.seats[i]
      const firstLegSeat = (p.seat_code || ctx?.seats?.[i] || '').trim().toUpperCase();

      // Return leg seat: from passenger model or context.return_seats[i] (handles missing return_seats safely)
      const returnSeat = (p.return_seat_code || ctx?.return_seats?.[i] || '').trim().toUpperCase();

      // Optional connecting leg 2 seat when available from context
      const leg2Seat = (
        (ctx as any)?.connecting_seats?.[i] ||
        (ctx as any)?.leg2_seats?.[i] ||
        (ctx as any)?.connecting?.leg2_seats?.[i] ||
        ''
      ).trim().toUpperCase();

      // Backward compatibility: single seat_code for the first leg
      if (firstLegSeat) {
        payload.seat_code = firstLegSeat;
      }

      // Per-leg seat mapping with valid leg types: omit keys with empty values
      const seatCodes: Record<string, string> = {};
      if (isConnecting) {
        if (firstLegSeat) seatCodes[LegType.CONNECTING_1] = firstLegSeat;
        if (leg2Seat) seatCodes[LegType.CONNECTING_2] = leg2Seat;
      } else if (isRoundTrip) {
        if (firstLegSeat) seatCodes[LegType.OUTBOUND] = firstLegSeat;
        if (returnSeat) seatCodes[LegType.INBOUND] = returnSeat;
      } else {
        // ONE_WAY direct
        if (firstLegSeat) seatCodes[LegType.OUTBOUND] = firstLegSeat;
      }

      if (Object.keys(seatCodes).length > 0) {
        payload.seat_codes = seatCodes;
      }

      return payload;
    });
  }

  /** Surface the real backend message ({ statusCode, message, error }). */
  private extractErrorMessage(err: any): string {
    const message = err?.error?.message ?? err?.message;
    if (Array.isArray(message)) {
      const joined = message.filter(Boolean).join(' • ');
      if (joined) return joined;
    }
    if (typeof message === 'string' && message.trim()) return message.trim();
    if (err?.status === 0) {
      return this.lang.isVietnamese() ? 'Không kết nối được tới máy chủ. Vui lòng kiểm tra kết nối và thử lại.' : 'Cannot connect to server. Please check your network and try again.';
    }
    return this.lang.isVietnamese() ? 'Đặt vé không thành công. Vui lòng thử lại.' : 'Booking failed. Please try again.';
  }

  submitBooking(): void {
    // Spec: guests must register / login before buying or blocking a ticket.
    // Do NOT call the API with a fake fallback user id — prompt login instead.
    if (!this.auth.isAuthenticated() || !this.auth.currentUser()?._id) {
      this.toast.warning(this.lang.t('booking.loginRequired'));
      this.authModal.open();
      return;
    }

    const ctx = this.context;
    if (!ctx) {
      this.toast.error(this.lang.isVietnamese() ? 'Không tìm thấy thông tin chuyến bay đã chọn' : 'Selected flight information not found');
      return;
    }

    // Validate passengers
    for (let i = 0; i < this.passengers.length; i++) {
      const p = this.passengers[i];
      if (!p.first_name.trim() || !p.last_name.trim()) {
        this.toast.warning(this.lang.isVietnamese() ? `Vui lòng nhập họ và tên của Hành khách ${i + 1}` : `Please enter full name for Passenger ${i + 1}`);
        return;
      }
      if (!p.id_card_or_passport.trim()) {
        this.toast.warning(this.lang.isVietnamese() ? `Vui lòng nhập số CCCD / Hộ chiếu của Hành khách ${i + 1}` : `Please enter ID / Passport number for Passenger ${i + 1}`);
        return;
      }
    }

    // Free hold is only allowed when departure is more than 14 days away
    // (same rule the backend enforces with a 400).
    if (this.isBlock() && !this.canHoldTicket) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? this.lang.t('booking.cannotHoldNotice')
          : 'Flight departs within 14 days and cannot be held. Please choose "Instant Purchase".',
      );
      this.isBlock.set(false);
      return;
    }

    if (!this.isBlock()) {
      const cardDigits = this.creditCardNumber.replace(/\D/g, '');
      if (!cardDigits) {
        this.toast.warning(this.lang.isVietnamese() ? 'Vui lòng nhập số thẻ tín dụng thanh toán' : 'Please enter payment credit card number');
        return;
      }
      if (cardDigits.length < 12 || cardDigits.length > 19) {
        this.toast.warning(this.lang.isVietnamese() ? 'Số thẻ tín dụng không hợp lệ (cần 12–19 chữ số)' : 'Invalid credit card number (12–19 digits required)');
        return;
      }
      // Expiry / CVV are display-only (never transmitted) but still format-checked.
      if (this.cardExp.trim() && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(this.cardExp.trim())) {
        this.toast.warning(this.lang.isVietnamese() ? 'Ngày hết hạn thẻ không hợp lệ. Định dạng đúng: MM/YY' : 'Invalid expiration date. Expected format: MM/YY');
        return;
      }
      if (this.cardCvv.trim() && !/^\d{3,4}$/.test(this.cardCvv.trim())) {
        this.toast.warning(this.lang.isVietnamese() ? 'CVV không hợp lệ (cần 3–4 chữ số)' : 'Invalid CVV (3–4 digits required)');
        return;
      }
    }

    // Prepare flight legs (backend takes `legs: [{ flight_id, inventory_id, leg_type }]`)
    const legs = this.buildLegs();
    if (!legs.length) {
      this.toast.error(this.lang.isVietnamese() ? 'Không xác định được chuyến bay đã chọn. Vui lòng tìm kiếm lại.' : 'Unable to identify selected flight. Please search again.');
      return;
    }

    this.loading.set(true);

    const payload = {
      user_id: this.auth.currentUser()!._id,
      booking_type: this.resolveBookingType(),
      is_block: this.isBlock(),
      passengers: this.buildPassengerPayload(),
      legs: legs,
      // Only the card number is sent: the backend stores a masked value.
      credit_card_number: this.isBlock() ? undefined : this.creditCardNumber.replace(/\D/g, ''),
    };

    this.api.createBooking(payload).subscribe({
      next: (booking) => {
        this.loading.set(false);
        sessionStorage.removeItem('booking_context');
        sessionStorage.setItem('confirmed_booking', JSON.stringify(booking));
        // Backend vừa cộng dặm SkyMiles cho hồ sơ → làm mới cache user để
        // thanh điều hướng/hồ sơ hiển thị số dặm đúng ngay sau khi đặt vé.
        this.auth.refreshProfile();
        this.router.navigate(['/booking-success']);
      },
      error: (err) => {
        this.loading.set(false);
        if (err?.status === 401) {
          // Session expired or token invalid — prompt re-login.
          this.toast.warning(this.lang.t('booking.sessionExpired'));
          this.authModal.open();
          return;
        }
        this.toast.error(this.extractErrorMessage(err));
      },
    });
  }
}
