import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { PaypalService } from '../../core/services/paypal.service';
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
  PresentmentAmount,
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
    legs?: ContextConnectingLeg[];
    transit_airport?: string;
    layover_minutes?: number | number[];
    seats_by_leg?: Record<number, Record<number, string>>;
  } | null;
  return_connecting?: {
    leg1?: ContextConnectingLeg;
    leg2?: ContextConnectingLeg;
    legs?: ContextConnectingLeg[];
    transit_airport?: string;
    layover_minutes?: number | number[];
    seats_by_leg?: Record<number, Record<number, string>>;
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
                        <div
                          class="w-full px-3.5 py-2.5 bg-slate-100/80 border border-slate-200 rounded-xl flex items-center justify-between text-xs font-bold text-navy select-none"
                        >
                          <span class="inline-flex items-center gap-2">
                            <span
                              class="inline-block w-2 h-2 rounded-full"
                              [ngClass]="{
                                'bg-navy': p.passenger_type === PassengerType.ADULT,
                                'bg-amber-500': p.passenger_type === PassengerType.CHILD,
                                'bg-teal-600': p.passenger_type === PassengerType.SENIOR
                              }"
                            ></span>
                            <span>{{ getPassengerTypeLabel(p.passenger_type) }}</span>
                          </span>
                          <span
                            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/80 text-slate-600"
                            [title]="lang.t('booking.passengerTypeLockedHelp')"
                          >
                            <app-icon name="lock" class="w-3 h-3 text-slate-500" />
                            <span>{{ lang.t('booking.passengerTypeLocked') }}</span>
                          </span>
                        </div>
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
                  (click)="canHoldTicket && setBookingMode(true)"
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
                  (click)="setBookingMode(false)"
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
                <div class="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                  <h3 class="text-base font-bold text-navy flex items-center gap-2">
                    <app-icon name="creditcard" class="w-5 h-5 text-gold" />
                    <span>{{ lang.t('booking.paymentMethod') }}</span>
                  </h3>
                  <span class="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <app-icon name="shieldcheck" class="w-4 h-4" />
                    {{ lang.isVietnamese() ? 'Cổng thanh toán bảo mật' : 'Secure Payment Gateway' }}
                  </span>
                </div>

                <!-- Payment Method Selection Radios -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  <!-- Option 1: Profile Card -->
                  <div
                    (click)="selectPaymentMethod('PROFILE_CARD')"
                    [class.border-gold]="selectedPaymentMethod() === 'PROFILE_CARD'"
                    [class.bg-amber-50/40]="selectedPaymentMethod() === 'PROFILE_CARD'"
                    class="p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                          <app-icon name="creditcard" class="w-4 h-4 text-gold" />
                          <span class="text-xs font-bold text-navy">{{ lang.t('booking.paymentPreferredCard') }}</span>
                        </div>
                        <input
                          type="radio"
                          name="paymentMethodSelector"
                          [checked]="selectedPaymentMethod() === 'PROFILE_CARD'"
                          class="text-gold focus:ring-gold"
                        />
                      </div>
                      <p class="text-[11px] text-slate-500 leading-relaxed">
                        {{ lang.t('booking.paymentPreferredCardDesc') }}
                      </p>
                    </div>
                    <div class="mt-3 text-[11px] font-mono text-slate-600">
                      @if (!auth.isAuthenticated()) {
                        <span class="text-slate-400 font-sans">{{ lang.isVietnamese() ? 'Yêu cầu đăng nhập' : 'Sign in required' }}</span>
                      } @else if (auth.currentUser()?.has_preferred_credit_card) {
                        {{ auth.currentUser()?.preferred_credit_card_masked || '•••• •••• •••• ••••' }}
                      } @else {
                        <span class="text-rose-500 font-sans">{{ lang.isVietnamese() ? 'Chưa có thẻ trong hồ sơ' : 'No card on file' }}</span>
                      }
                    </div>
                  </div>

                  <!-- Option 2: PayPal Sandbox (Strictly customer only) -->
                  @if (!auth.isStaff() && (!auth.isAuthenticated() || auth.currentUser()?.role === 'CUSTOMER')) {
                    <div
                      (click)="selectPaymentMethod('PAYPAL')"
                      [class.border-gold]="selectedPaymentMethod() === 'PAYPAL'"
                      [class.bg-amber-50/40]="selectedPaymentMethod() === 'PAYPAL'"
                      class="p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div class="flex items-center justify-between mb-2">
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-xs text-blue-800">PayPal</span>
                            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Sandbox</span>
                          </div>
                          <input
                            type="radio"
                            name="paymentMethodSelector"
                            [checked]="selectedPaymentMethod() === 'PAYPAL'"
                            class="text-gold focus:ring-gold"
                          />
                        </div>
                        <p class="text-[11px] text-slate-500 leading-relaxed">
                          {{ lang.t('booking.paymentPaypalDesc') }}
                        </p>
                      </div>
                      <div class="mt-3 text-[11px] text-slate-600 flex flex-col gap-1">
                        @if (serverQuotePresentment()) {
                          <div class="flex items-center justify-between">
                            <span class="font-semibold text-navy">&#36;{{ serverQuotePresentment()?.provider_amount }} USD</span>
                            <span class="text-[10px] text-slate-400">1 USD = {{ serverQuotePresentment()?.exchange_rate_vnd_per_unit | number }} VND</span>
                          </div>
                        } @else {
                          <span class="text-[10px] text-slate-400 italic">
                            {{ lang.isVietnamese() ? 'Giá PayPal sẽ được xác nhận trước khi mở thanh toán.' : 'PayPal amount will be confirmed before payment opens.' }}
                          </span>
                        }
                      </div>
                    </div>
                  }
                </div>

                @if (selectedPaymentMethod() === 'PROFILE_CARD') {
                  <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 leading-relaxed">
                    {{ lang.isVietnamese() ? 'Thanh toán trực tiếp bằng thẻ đã lưu trong hồ sơ thành viên.' : 'Charged directly to the saved credit card on your member profile.' }}
                    @if (auth.isAuthenticated() && !auth.currentUser()?.has_preferred_credit_card) {
                      <div class="mt-1 text-rose-600 font-medium">
                        {{ lang.isVietnamese() ? 'Vui lòng cập nhật thẻ tín dụng trong Hồ sơ cá nhân trước khi thanh toán.' : 'Please update your credit card in Profile before instant purchase.' }}
                      </div>
                    }
                  </div>
                } @else {
                  @if (serverQuotePresentment(); as quote) {
                    <div class="p-3.5 bg-blue-50/50 border border-blue-200/70 rounded-xl text-xs text-slate-700 space-y-1">
                      <div class="flex items-center justify-between font-semibold text-navy">
                        <span>{{ lang.t('booking.providerAmount') }}</span>
                        <span class="text-sm font-mono text-blue-800">&#36;{{ quote.provider_amount }} {{ quote.provider_currency }}</span>
                      </div>
                      <div class="text-[11px] text-slate-500">
                        @if (quote.exchange_rate_vnd_per_unit > 0) {
                          {{ (lang.t('booking.paymentRateNotice') || '').replace('{rate}', (quote.exchange_rate_vnd_per_unit | number) || '') }}
                        }
                      </div>
                      <div class="text-[10px] text-amber-700 italic pt-1 border-t border-blue-100">
                        * {{ lang.t('booking.paymentSandboxBadge') }}
                      </div>
                    </div>
                  } @else {
                    <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 leading-relaxed">
                      {{ lang.isVietnamese() ? 'Giá PayPal sẽ được xác nhận trước khi mở thanh toán.' : 'PayPal amount will be confirmed before payment opens.' }}
                    </div>
                  }
                }
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
                } @else if (context?.return_connecting; as retConn) {
                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
                    <div class="font-bold text-navy">{{ lang.isVietnamese() ? 'Chuyến bay về nối chuyến:' : 'Return connecting flight:' }}</div>
                    
                    <!-- Leg 1 -->
                    <div class="border-b border-slate-200/60 pb-1.5 space-y-0.5">
                      <div class="text-[11px] text-slate-700 flex items-center justify-between">
                        <div>
                          {{ lang.isVietnamese() ? 'Chặng về 1: ' : 'Return Leg 1: ' }}<strong class="font-mono text-navy">{{ retConn.leg1?.flight?.flight_number }}</strong>
                        </div>
                        <span class="text-slate-400">({{ retConn.leg1?.flight?.origin_iata }} → {{ retConn.leg1?.flight?.dest_iata }})</span>
                      </div>
                      <div class="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{{ lang.isVietnamese() ? 'Khởi hành: ' : 'Dep: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(retConn.leg1?.flight?.scheduled_departure_local || retConn.leg1?.flight?.departure) }}</strong> ({{ formatAirportGmt(retConn.leg1?.flight?.origin_iata, retConn.leg1?.flight?.origin_time_zone) }})</span>
                        <span>{{ lang.isVietnamese() ? 'Đến: ' : 'Arr: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(retConn.leg1?.flight?.scheduled_arrival_local || retConn.leg1?.flight?.arrival) }}</strong> ({{ formatAirportGmt(retConn.leg1?.flight?.dest_iata, retConn.leg1?.flight?.dest_time_zone) }})</span>
                      </div>
                    </div>

                    <!-- Leg 2 -->
                    <div class="space-y-0.5">
                      <div class="text-[11px] text-slate-700 flex items-center justify-between">
                        <div>
                          {{ lang.isVietnamese() ? 'Chặng về 2: ' : 'Return Leg 2: ' }}<strong class="font-mono text-navy">{{ retConn.leg2?.flight?.flight_number }}</strong>
                        </div>
                        <span class="text-slate-400">({{ retConn.leg2?.flight?.origin_iata }} → {{ retConn.leg2?.flight?.dest_iata }})</span>
                      </div>
                      <div class="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{{ lang.isVietnamese() ? 'Khởi hành: ' : 'Dep: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(retConn.leg2?.flight?.scheduled_departure_local || retConn.leg2?.flight?.departure) }}</strong> ({{ formatAirportGmt(retConn.leg2?.flight?.origin_iata, retConn.leg2?.flight?.origin_time_zone) }})</span>
                        <span>{{ lang.isVietnamese() ? 'Đến: ' : 'Arr: ' }}<strong class="text-slate-700">{{ formatLegLocalTime(retConn.leg2?.flight?.scheduled_arrival_local || retConn.leg2?.flight?.arrival) }}</strong> ({{ formatAirportGmt(retConn.leg2?.flight?.dest_iata, retConn.leg2?.flight?.dest_time_zone) }})</span>
                      </div>
                    </div>

                    <div class="text-[10px] text-amber-600 font-semibold pt-1 border-t border-slate-200/60">
                      {{ lang.isVietnamese() ? 'Điểm dừng: ' : 'Transit airport: ' }}{{ retConn.transit_airport }}
                    </div>
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

                <!-- Current Fare (Clean customer total) -->
                <div class="flex items-center justify-between text-slate-700">
                  <span>{{ lang.isVietnamese() ? 'Giá vé hiện tại' : 'Current Fare' }} ({{ passengers.length }} {{ lang.isVietnamese() ? 'khách' : 'passenger(s)' }}):</span>
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

              <!-- Action Submit Button / PayPal Buttons -->
              <div class="mt-6">
                @if (!isBlock() && selectedPaymentMethod() === 'PAYPAL') {
                  <div class="space-y-3">
                    @if (!auth.isAuthenticated()) {
                      <button
                        type="button"
                        (click)="authModal.open()"
                        class="btn-gold w-full text-sm !py-3.5 uppercase tracking-wider font-bold"
                      >
                        <app-icon name="user" class="w-4 h-4" />
                        <span>{{ lang.t('booking.loginRequired') }}</span>
                      </button>
                    } @else if (!isPayPalEligible()) {
                      <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        {{ lang.isVietnamese() ? 'PayPal hiện không khả dụng cho giao dịch này. Vui lòng thanh toán bằng Thẻ hồ sơ.' : 'PayPal is currently unavailable for this transaction. Please use Profile Card payment.' }}
                      </div>
                    } @else {
                      <button
                        type="button"
                        (click)="startPayPalBookingPayment()"
                        [disabled]="loading() || isPayPalProcessing()"
                        class="w-full flex items-center justify-center gap-2.5 bg-[#ffc439] hover:bg-[#f4bb33] active:bg-[#e0ab2e] text-[#003087] font-black py-3.5 px-4 rounded-full shadow-md transition-all uppercase tracking-wider text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        @if (isPayPalProcessing()) {
                          <app-icon name="loader-2" class="w-5 h-5 animate-spin" />
                          <span>{{ lang.isVietnamese() ? 'Đang kết nối PayPal...' : 'Connecting to PayPal...' }}</span>
                        } @else {
                          <span>Pay with</span>
                          <span class="font-extrabold italic text-base">PayPal</span>
                          @if (serverQuotePresentment()) {
                            <span class="text-xs font-semibold text-slate-700">(&#36;{{ serverQuotePresentment()?.provider_amount }} USD)</span>
                          }
                        }
                      </button>
                    }
                  </div>
                } @else {
                  <button
                    type="button"
                    (click)="submitBooking()"
                    [disabled]="loading() || (!isBlock() && auth.isAuthenticated() && !auth.currentUser()?.has_preferred_credit_card)"
                    class="btn-gold w-full text-sm !py-3.5 uppercase tracking-wider font-bold disabled:opacity-50 disabled:cursor-not-allowed"
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
                  @if (!isBlock() && auth.isAuthenticated() && !auth.currentUser()?.has_preferred_credit_card) {
                    <div class="mt-2 text-xs text-rose-600 text-center font-medium">
                      {{ lang.isVietnamese() ? 'Cần cập nhật thẻ tín dụng ưa thích trong hồ sơ để mua vé ngay.' : 'A preferred credit card in your profile is required for instant purchase.' }}
                    </div>
                  }
                }
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
        [allowedCabinClass]="seatMapCabinClass"
        (closeEvent)="isSeatMapOpen.set(false)"
        (seatsConfirmed)="handleSeatsConfirmed($event)"
        (seatAssignmentsSanitized)="handleSeatsSanitized($event)"
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
  readonly paypalService = inject(PaypalService);

  readonly isBlock = signal(false);
  readonly isSeatMapOpen = signal(false);
  readonly loading = signal(false);
  readonly selectedPaymentMethod = signal<'PROFILE_CARD' | 'PAYPAL'>('PROFILE_CARD');
  readonly isPayPalEligible = signal<boolean>(false);
  readonly isPayPalProcessing = signal<boolean>(false);
  readonly serverQuotePresentment = signal<PresentmentAmount | null>(null);

  private currentPayPalCheckoutId: string = '';
  private currentPayPalClientRequestId: string = '';

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

  constructor() {
    // Requirement 1.3.3: Reactively prefill passenger 1 name when user logs in via auth modal
    effect(() => {
      const u = this.auth.currentUser();
      if (u && this.passengers && this.passengers.length > 0) {
        if (!this.passengers[0].first_name) {
          this.passengers[0].first_name = u.first_name || '';
        }
        if (!this.passengers[0].last_name) {
          this.passengers[0].last_name = u.last_name || '';
        }
      }
    });

    // Auto-check PayPal eligibility when PayPal payment method is selected in Buy Now mode
    effect(() => {
      const isBlk = this.isBlock();
      const method = this.selectedPaymentMethod();
      const isAuth = this.auth.isAuthenticated();
      if (!isBlk && method === 'PAYPAL' && isAuth) {
        this.paypalService.checkEligibility().then((eligible) => this.isPayPalEligible.set(eligible));
      }
    });
  }

  get holdDeadlineText(): string {
    if (!this.holdDeadline) return this.lang.isVietnamese() ? 'ngày khởi hành − 14 ngày' : 'departure date − 14 days';
    const d = this.holdDeadline;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  get seatMapCabinClass(): string {
    const ctx = this.context;
    if (!ctx) return '';
    if (ctx.mode === 'CONNECTING' || ctx.connecting) {
      const leg1 = ctx.connecting?.legs?.[0] || ctx.connecting?.leg1;
      return leg1?.inventory?.cabin_class || '';
    }
    return ctx.flight?.cabin_class || '';
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
        this.passengers[0].id_card_or_passport = '';
      }
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
    const adults = ctx?.adults ?? 1;
    const children = ctx?.children ?? 0;
    const seniors = ctx?.seniors ?? 0;
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
        date_of_birth: '',
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
        date_of_birth: '',
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
        date_of_birth: '',
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
      const connLegs = ctx.connecting?.legs?.length
        ? ctx.connecting.legs
        : [ctx.connecting?.leg1, ctx.connecting?.leg2].filter(Boolean) as ContextConnectingLeg[];
      for (const leg of connLegs) {
        scheduleCandidates.push(leg.flight?.departure, leg.flight?.scheduled_departure);
      }
    } else {
      scheduleCandidates.push(
        ctx.flight?.scheduled_departure,
        ctx.return_flight?.scheduled_departure,
      );
    }

    if (ctx.return_connecting) {
      const retConnLegs = ctx.return_connecting.legs?.length
        ? ctx.return_connecting.legs
        : [ctx.return_connecting.leg1, ctx.return_connecting.leg2].filter(Boolean) as ContextConnectingLeg[];
      for (const leg of retConnLegs) {
        scheduleCandidates.push(leg.flight?.departure, leg.flight?.scheduled_departure);
      }
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
    const diffDays = (earliest.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    this.canHoldTicket = diffDays > 14;
    this.isBlock.set(this.canHoldTicket);
  }

  getPassengerTypeLabel(type: PassengerType): string {
    switch (type) {
      case PassengerType.ADULT:
        return this.lang.t('booking.passengerTypeAdult');
      case PassengerType.CHILD:
        return this.lang.t('booking.passengerTypeChild');
      case PassengerType.SENIOR:
        return this.lang.t('booking.passengerTypeSenior');
      default:
        return type;
    }
  }

  /**
   * Validates that the passenger composition strictly matches the original search
   * parameters stored in booking_context. Prevents mismatch between displayed price and backend fare.
   */
  validatePassengerComposition(): boolean {
    const ctx = this.context;
    if (!ctx) return false;

    const expectedAdults = ctx.adults ?? 1;
    const expectedChildren = ctx.children ?? 0;
    const expectedSeniors = ctx.seniors ?? 0;

    let actualAdults = 0;
    let actualChildren = 0;
    let actualSeniors = 0;

    for (const p of this.passengers) {
      if (p.passenger_type === PassengerType.ADULT) {
        actualAdults++;
      } else if (p.passenger_type === PassengerType.CHILD) {
        actualChildren++;
      } else if (p.passenger_type === PassengerType.SENIOR) {
        actualSeniors++;
      }
    }

    return (
      actualAdults === expectedAdults &&
      actualChildren === expectedChildren &&
      actualSeniors === expectedSeniors
    );
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
    this.serverQuotePresentment.set(null);
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

  handleSeatsSanitized(seats: Record<number, string>): void {
    this.serverQuotePresentment.set(null);
    let changed = false;
    this.passengers.forEach((p, i) => {
      const validSeat = seats[i] || '';
      if (p.seat_code && p.seat_code !== validSeat) {
        p.seat_code = validSeat;
        changed = true;
      }
    });
    if (changed && this.context) {
      this.context.seats = { ...seats };
    }
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
      const connectingLegs = ctx.connecting?.legs?.length
        ? ctx.connecting.legs
        : [ctx.connecting?.leg1, ctx.connecting?.leg2].filter(Boolean) as ContextConnectingLeg[];
      connectingLegs.forEach((leg, index) => {
        const flightId = leg.flight?.flight_id || '';
        const inventoryId = leg.inventory?._id || '';
        if (flightId && inventoryId) {
          legs.push({
            flight_id: flightId,
            inventory_id: inventoryId,
            leg_type: `CONNECTING_${index + 1}`,
          });
        }
      });
    } else {
      const outboundFlightId = ctx.flight?.flight_id || '';
      const outboundInventoryId = ctx.flight?.inventory_id || '';
      if (outboundFlightId && outboundInventoryId) {
        legs.push({
          flight_id: outboundFlightId,
          inventory_id: outboundInventoryId,
          leg_type: LegType.OUTBOUND,
        });
      }
    }

    if (ctx.return_connecting?.legs?.length) {
      ctx.return_connecting.legs.forEach((leg, index) => {
        const flightId = leg.flight?.flight_id || '';
        const inventoryId = leg.inventory?._id || '';
        if (flightId && inventoryId) {
          legs.push({
            flight_id: flightId,
            inventory_id: inventoryId,
            leg_type: `INBOUND_${index + 1}`,
          });
        }
      });
    } else if (ctx.return_connecting?.leg1 && ctx.return_connecting?.leg2) {
      [ctx.return_connecting.leg1, ctx.return_connecting.leg2].forEach((leg, index) => {
        const flightId = leg.flight?.flight_id || '';
        const inventoryId = leg.inventory?._id || '';
        if (flightId && inventoryId) {
          legs.push({
            flight_id: flightId,
            inventory_id: inventoryId,
            leg_type: `INBOUND_${index + 1}`,
          });
        }
      });
    } else {
      const returnFlightId = ctx.return_flight?.flight_id || '';
      const returnInventoryId = ctx.return_flight?.inventory_id || '';
      if (returnFlightId && returnInventoryId) {
        legs.push({
          flight_id: returnFlightId,
          inventory_id: returnInventoryId,
          leg_type: LegType.INBOUND,
        });
      }
    }

    return legs;
  }

  private resolveBookingType(): BookingType {
    const ctx = this.context;
    if (!ctx) return BookingType.ONE_WAY;
    if (ctx.return_flight?.flight_id || ctx.return_connecting) return BookingType.ROUND_TRIP;
    if (ctx.mode === 'CONNECTING' || ctx.connecting) return BookingType.CONNECTING;
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
    const bookingType = this.resolveBookingType();
    const hasOutboundConnecting = !!(ctx?.connecting);
    const isRoundTrip = bookingType === BookingType.ROUND_TRIP;

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

      // Backward compatibility: single seat_code for the first leg
      if (firstLegSeat) {
        payload.seat_code = firstLegSeat;
      }

      // Per-leg seat mapping with valid leg types: omit keys with empty values
      const seatCodes: Record<string, string> = {};
      if (hasOutboundConnecting) {
        const seatsByLeg = ctx?.connecting?.seats_by_leg || {};
        const connectingLegs = ctx?.connecting?.legs?.length
          ? ctx.connecting.legs
          : [ctx?.connecting?.leg1, ctx?.connecting?.leg2].filter(Boolean);
        connectingLegs.forEach((_leg, index) => {
          const legacySeat = index === 1
            ? ((ctx as any)?.connecting_seats?.[i] || (ctx as any)?.leg2_seats?.[i] || '')
            : '';
          const seat = (seatsByLeg[index]?.[i] || (index === 0 ? firstLegSeat : legacySeat)).trim().toUpperCase();
          if (seat) seatCodes[`CONNECTING_${index + 1}`] = seat;
        });
      } else {
        // DIRECT outbound
        if (firstLegSeat) seatCodes[LegType.OUTBOUND] = firstLegSeat;
      }

      if (ctx?.return_connecting) {
        const retSeatsByLeg = ctx.return_connecting.seats_by_leg || {};
        const returnConnLegs = ctx.return_connecting.legs?.length
          ? ctx.return_connecting.legs
          : [ctx.return_connecting.leg1, ctx.return_connecting.leg2].filter(Boolean);
        returnConnLegs.forEach((_leg, index) => {
          const seat = (retSeatsByLeg[index]?.[i] || '').trim().toUpperCase();
          if (seat) seatCodes[`INBOUND_${index + 1}`] = seat;
        });
      } else if (isRoundTrip && returnSeat) {
        seatCodes[LegType.INBOUND] = returnSeat;
      }

      if (Object.keys(seatCodes).length > 0) {
        payload.seat_codes = seatCodes;
      }

      return payload;
    });
  }

  private buildSeatRequests(legs: FlightLegSelection[]): Array<{
    passenger_index: number;
    flight_id: string;
    selection_type: 'AUTO' | 'CHOOSE';
    seat_code?: string;
  }> {
    const requests: Array<{
      passenger_index: number;
      flight_id: string;
      selection_type: 'AUTO' | 'CHOOSE';
      seat_code?: string;
    }> = [];

    const ctx = this.context;
    const isRoundTrip = this.resolveBookingType() === BookingType.ROUND_TRIP;

    for (let pIdx = 0; pIdx < this.passengers.length; pIdx++) {
      const p = this.passengers[pIdx];
      const outboundSeat = (p.seat_code || ctx?.seats?.[pIdx] || '').trim().toUpperCase();
      const returnSeat = (p.return_seat_code || ctx?.return_seats?.[pIdx] || '').trim().toUpperCase();

      for (let lIdx = 0; lIdx < legs.length; lIdx++) {
        const leg = legs[lIdx];
        const isReturnLeg = leg.leg_type === LegType.INBOUND || (isRoundTrip && lIdx === 1 && !leg.leg_type?.startsWith('CONNECTING'));

        let chosenCode = '';
        if (isReturnLeg) {
          chosenCode = returnSeat;
        } else if (lIdx === 0) {
          chosenCode = outboundSeat;
        }

        if (chosenCode) {
          requests.push({
            passenger_index: pIdx,
            flight_id: leg.flight_id,
            selection_type: 'CHOOSE',
            seat_code: chosenCode,
          });
        } else {
          requests.push({
            passenger_index: pIdx,
            flight_id: leg.flight_id,
            selection_type: 'AUTO',
          });
        }
      }
    }

    return requests;
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

  setBookingMode(block: boolean): void {
    this.serverQuotePresentment.set(null);
    this.isBlock.set(block);
  }

  selectPaymentMethod(method: 'PROFILE_CARD' | 'PAYPAL'): void {
    if (method === 'PAYPAL' && (this.auth.isStaff() || (this.auth.isAuthenticated() && this.auth.currentUser()?.role !== 'CUSTOMER'))) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? 'Thanh toán trực tiếp PayPal chỉ dành riêng cho tài khoản hành khách.'
          : 'Interactive PayPal payments are exclusively reserved for customer accounts.',
      );
      return;
    }
    this.serverQuotePresentment.set(null);
    this.selectedPaymentMethod.set(method);
    if (method === 'PAYPAL') {
      this.isPayPalEligible.set(false);
      this.paypalService.checkEligibility().then((eligible) => this.isPayPalEligible.set(eligible));
    }
  }

  async startPayPalBookingPayment(): Promise<void> {
    if (!this.auth.isAuthenticated() || !this.auth.currentUser()?._id) {
      this.toast.warning(this.lang.t('booking.loginRequired'));
      this.authModal.open();
      return;
    }
    if (this.auth.isStaff() || this.auth.currentUser()?.role !== 'CUSTOMER') {
      this.toast.error(
        this.lang.isVietnamese()
          ? 'Thanh toán trực tiếp PayPal chỉ dành riêng cho tài khoản hành khách.'
          : 'Interactive PayPal payments are exclusively reserved for customer accounts.',
      );
      return;
    }
    if (!this.validateBookingForm()) {
      return;
    }

    this.serverQuotePresentment.set(null);

    if (!this.currentPayPalClientRequestId) {
      this.currentPayPalClientRequestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }

    this.isPayPalProcessing.set(true);

    const legs = this.buildLegs();
    const payload = {
      user_id: this.auth.currentUser()!._id,
      booking_type: this.resolveBookingType(),
      is_block: false,
      passengers: this.buildPassengerPayload(),
      legs: legs,
      seat_requests: this.buildSeatRequests(legs),
      client_request_id: this.currentPayPalClientRequestId,
    };

    let quote: any;
    try {
      quote = await firstValueFrom(this.api.quoteBooking(payload));
    } catch (quoteErr: any) {
      this.isPayPalProcessing.set(false);
      console.error('Pre-checkout quote fetch failed:', quoteErr);
      const errMsg = quoteErr?.error?.message || quoteErr?.message || this.lang.t('booking.quoteFailed') || 'Failed to fetch quote';
      this.toast.error(errMsg);
      return;
    }

    if (!quote || typeof quote.total_amount !== 'number') {
      this.isPayPalProcessing.set(false);
      this.toast.error('Invalid quote response received.');
      return;
    }

    this.totalAmount = quote.total_amount;
    if (quote.presentment) {
      this.serverQuotePresentment.set(quote.presentment);
    }

    // Zero-external-charge customer flow (Fix 2)
    if (quote.total_amount === 0) {
      this.loading.set(true);
      try {
        const createPayload = {
          ...payload,
          payment_method: 'PAYPAL' as const,
        };
        const booking = await firstValueFrom(this.api.createBooking(createPayload));
        this.toast.success(this.lang.t('booking.captureSuccess') || 'Booking completed successfully');
        this.currentPayPalClientRequestId = '';
        this.handleBookingSuccess(booking);
      } catch (err: any) {
        console.error('Zero amount booking failed:', err);
        this.toast.error(err?.error?.message || err?.message || 'Booking failed');
      } finally {
        this.loading.set(false);
        this.isPayPalProcessing.set(false);
      }
      return;
    }

    // Authoritative total > 0: proceed to PayPal SDK startOneTimePayment
    try {
      await this.paypalService.startOneTimePayment({
        presentationMode: 'auto',
        createOrder: async () => {
          const res = await firstValueFrom(this.api.createPayPalBookingOrder(payload));
          this.currentPayPalCheckoutId = res.checkout_id;
          return { orderId: res.order_id };
        },
        onApprove: async (data: { orderId: string }) => {
          this.loading.set(true);
          try {
            const res = await firstValueFrom(
              this.api.capturePayPalBooking(this.currentPayPalCheckoutId, data.orderId),
            );
            this.toast.success(this.lang.t('booking.captureSuccess'));
            this.currentPayPalClientRequestId = '';
            this.handleBookingSuccess(res.booking);
          } catch (err: any) {
            console.error('PayPal capture error:', err);
            this.toast.error(err?.error?.message || this.lang.t('booking.captureFailed'));
          } finally {
            this.loading.set(false);
          }
        },
        onCancel: () => {
          console.log('PayPal checkout session cancelled by user');
        },
        onError: (err: any) => {
          console.error('PayPal checkout session error:', err);
          this.toast.error(this.lang.t('booking.captureFailed'));
        },
      });
    } catch (err: any) {
      console.error('Failed to initiate PayPal checkout:', err);
      this.toast.error(err?.message || this.lang.t('booking.captureFailed'));
    } finally {
      this.isPayPalProcessing.set(false);
    }
  }

  validateBookingForm(): boolean {
    const ctx = this.context;
    if (!ctx) {
      this.toast.error(this.lang.isVietnamese() ? 'Không tìm thấy thông tin chuyến bay đã chọn' : 'Selected flight information not found');
      return false;
    }

    if (!this.validatePassengerComposition()) {
      this.toast.error(this.lang.t('booking.compositionMismatchError'));
      return false;
    }

    for (let i = 0; i < this.passengers.length; i++) {
      const p = this.passengers[i];
      if (!p.first_name.trim() || !p.last_name.trim()) {
        this.toast.warning(this.lang.isVietnamese() ? `Vui lòng nhập họ và tên của Hành khách ${i + 1}` : `Please enter full name for Passenger ${i + 1}`);
        return false;
      }
      if (!p.id_card_or_passport.trim()) {
        this.toast.warning(this.lang.isVietnamese() ? `Vui lòng nhập số CCCD / Hộ chiếu của Hành khách ${i + 1}` : `Please enter ID / Passport number for Passenger ${i + 1}`);
        return false;
      }

      if (p.date_of_birth && p.date_of_birth.trim()) {
        const dobStr = p.date_of_birth.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không đúng định dạng YYYY-MM-DD`
              : `Passenger ${i + 1}: Date of birth format must be YYYY-MM-DD`,
          );
          return false;
        }
        const [yStr, mStr, dStr] = dobStr.split('-');
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
        const parsedDate = new Date(Date.UTC(y, m - 1, d));
        if (
          parsedDate.getUTCFullYear() !== y ||
          parsedDate.getUTCMonth() !== m - 1 ||
          parsedDate.getUTCDate() !== d
        ) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không tồn tại trong lịch thực tế`
              : `Passenger ${i + 1}: Date of birth does not exist on the calendar`,
          );
          return false;
        }
        const now = new Date();
        const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        if (parsedDate > todayUtc) {
          this.toast.warning(
            this.lang.isVietnamese()
              ? `Hành khách ${i + 1}: Ngày sinh không thể là ngày trong tương lai`
              : `Passenger ${i + 1}: Date of birth cannot be in the future`,
          );
          return false;
        }
      }
    }

    if (this.isBlock() && !this.canHoldTicket) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? this.lang.t('booking.cannotHoldNotice')
          : 'Flight departs within 14 days and cannot be held. Please choose "Instant Purchase".',
      );
      this.isBlock.set(false);
      return false;
    }

    return true;
  }

  submitBooking(): void {
    if (!this.auth.isAuthenticated() || !this.auth.currentUser()?._id) {
      this.toast.warning(this.lang.t('booking.loginRequired'));
      this.authModal.open();
      return;
    }

    if (!this.validateBookingForm()) {
      return;
    }

    if (!this.isBlock()) {
      const u = this.auth.currentUser();
      if (!u?.has_preferred_credit_card) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? 'Vui lòng cập nhật thẻ tín dụng ưa thích trong hồ sơ trước khi mua vé.'
            : 'Please update your preferred credit card in your profile before purchasing tickets.',
        );
        return;
      }
    }

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
      seat_requests: this.buildSeatRequests(legs),
      payment_method: this.isBlock() ? undefined : ('PROFILE_CARD' as const),
    };

    this.api.createBooking(payload).subscribe({
      next: (booking) => {
        this.loading.set(false);
        this.handleBookingSuccess(booking);
      },
      error: (err) => {
        this.loading.set(false);
        if (err?.status === 401) {
          this.toast.warning(this.lang.t('booking.sessionExpired'));
          this.authModal.open();
          return;
        }
        this.toast.error(this.extractErrorMessage(err));
      },
    });
  }

  private handleBookingSuccess(booking: any): void {
    sessionStorage.removeItem('booking_context');
    sessionStorage.setItem('confirmed_booking', JSON.stringify(booking));
    this.auth.refreshProfile();
    this.router.navigate(['/booking-success']);
  }
}
