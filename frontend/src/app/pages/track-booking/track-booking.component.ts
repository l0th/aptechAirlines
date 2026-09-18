import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { AuthModalService } from '../../shared/services/auth-modal.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { FlightDurationPipe } from '../../shared/pipes/duration.pipe';
import { BookingStatus, CancellationPolicy } from '../../core/models/booking.model';
import { ConnectingRouteOption, Flight, FlightStatus } from '../../core/models/flight.model';

/* ------------------------------------------------------------------ *
 * LOCAL SHAPES — khớp CHÍNH XÁC shape thật của backend.
 * (Không import type vé từ booking.model.ts để tránh phụ thuộc chéo.)
 * ------------------------------------------------------------------ */

/** Hạng ghế trên phiếu vé (booking_info.ticket_coupons[]). */
interface LocalTicketCoupon {
  coupon_number: string;
  passenger_name: string;
  flight_id: string;
  flight_number: string;
  inventory_id: string;
  cabin_class: string;
  is_smoking?: boolean;
  fare_paid: number;
  seat_code?: string;
  /** OUTBOUND | INBOUND | CONNECTING_1 | CONNECTING_2 */
  leg_type?: string;
  coupon_status?: string;
}

interface LocalPassenger {
  first_name: string;
  last_name: string;
  passenger_type: string;
  id_card_or_passport?: string;
  nationality?: string;
  date_of_birth?: string;
}

interface LocalPaymentTransaction {
  transaction_type: string;
  amount: number;
  card_masked?: string;
  status?: string;
  created_at?: string;
}

/** Document Booking trần (không phải envelope) — backend trả ở confirm/reschedule/cancel. */
interface LocalBooking {
  _id: string;
  pnr_code: string;
  booking_type: string;
  status: string;
  blocking_number?: string | null;
  confirmation_number?: string | null;
  cancellation_number?: string | null;
  time_limit_deadline?: string | null;
  total_amount: number;
  total_miles_accrued?: number;
  passengers: LocalPassenger[];
  ticket_coupons: LocalTicketCoupon[];
  payment_transactions: LocalPaymentTransaction[];
}

/**
 * Một phần tử của envelope.flight_coupons[].
 * LƯU Ý shape thật: backend spread một Mongoose subdocument
 * (`{ ...coupon, origin_iata, ... }`) nên CHỈ các field làm giàu là own-property;
 * `flight_number` / `leg_type` nằm trong `_doc`. Vì vậy ta luôn đọc hành trình
 * chính từ `booking_info.ticket_coupons` và chỉ dùng mảng này để lấy giờ bay /
 * điểm đi-đến / tình trạng chuyến theo `flight_id`.
 */
interface LocalFlightCouponEnrichment {
  flight_id?: string;
  origin_iata?: string;
  dest_iata?: string;
  departure_date?: string;
  scheduled_departure?: string;
  scheduled_arrival?: string;
  actual_departure?: string;
  actual_arrival?: string;
  flight_status?: string;
  delay_reason?: string;
  is_highlighted_change?: boolean;
}

/** envelope thật của GET /api/bookings/track/:code */
interface TrackBookingEnvelope {
  booking_info: LocalBooking;
  has_emergency_changes: boolean;
  flight_coupons: LocalFlightCouponEnrichment[];
}

/** Model đã gộp sẵn để render template (mỗi chặng bay = 1 nhóm coupon). */
interface TrackedLegView {
  key: string;
  leg_type: string;
  leg_label: string;
  flight_id: string;
  flight_number: string;
  origin_iata: string;
  dest_iata: string;
  departure_date?: string;
  scheduled_departure?: string;
  scheduled_arrival?: string;
  actual_departure?: string;
  actual_arrival?: string;
  flight_status?: string;
  delay_reason?: string;
  delay_minutes?: number;
  is_highlighted_change: boolean;
  cabin_class: string;
  passenger_names: string[];
  seat_codes: string[];
  fare_paid: number;
  coupon_count: number;
}

interface TrackedPassengerView {
  first_name: string;
  last_name: string;
  passenger_type: string;
  id_card_or_passport?: string;
  nationality?: string;
  seat_code?: string;
  fare_paid?: number;
  cabin_class?: string;
}

@Component({
  selector: 'app-track-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent, CurrencyFormatPipe, FlightDurationPipe],
  template: `
    <div class="min-h-screen bg-slate-50 py-10">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        <!-- Header -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-navy text-gold text-xs font-semibold mb-3">
            <app-icon name="ticket" class="w-4 h-4 text-gold" />
            <span>{{ lang.t('nav.myTrips') }}</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-navy">
            {{ lang.t('track.title') }}
          </h1>
          <p class="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto mt-1">
            {{ lang.t('track.subtitle') }}
          </p>
        </div>

        <!-- Search Input Box -->
        <div class="card-luxury p-4 sm:p-6 shadow-md border-slate-200 mb-8">
          <form (ngSubmit)="handleSearch()" class="flex flex-col sm:flex-row gap-3">
            <div class="relative flex-1">
              <app-icon name="search" class="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
              <input
                type="text"
                [(ngModel)]="searchCode"
                name="searchCode"
                placeholder="{{ lang.t('track.inputPlaceholder') }}"
                class="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-full font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold uppercase"
              />
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="btn-gold !py-3 !px-8 text-sm shrink-0 font-bold"
            >
              @if (loading()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                <span>{{ lang.t('common.loading') }}</span>
              } @else {
                <app-icon name="search" class="w-4 h-4" />
                <span>{{ lang.t('track.btnSearch') }}</span>
              }
            </button>
          </form>
        </div>

        <!-- Empty state: đã tra cứu nhưng không còn kết quả -->
        @if (searched() && !loading() && !bookingInfo()) {
          <div class="card-luxury p-8 text-center border-slate-200">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-100 text-slate-400 mb-3">
              <app-icon name="search" class="w-7 h-7" />
            </div>
            <h3 class="text-sm font-bold text-navy mb-1">{{ lang.isVietnamese() ? 'Không tìm thấy vé phù hợp' : 'No matching ticket found' }}</h3>
            <p class="text-xs text-slate-500">
              {{ lang.isVietnamese() ? 'Vui lòng kiểm tra lại mã PNR / mã giữ chỗ (BLK) / mã xác nhận (CNF) rồi tra cứu lại.' : 'Please verify your PNR code / hold code (BLK) / ticket confirmation code (CNF) and try again.' }}
            </p>
          </div>
        }

        <!-- Results Display -->
        @if (bookingInfo(); as b) {
          <div class="space-y-6 animate-fade-in">

            <!-- ===== 3.9 EMERGENCY DELAY / CANCELLATION ALERT ===== -->
            @if (hasEmergencyChanges()) {
              <div class="p-5 rounded-3xl border shadow-lg"
                [ngClass]="alertSeverity() === 'cancelled'
                  ? 'bg-red-50 border-red-300 text-red-950'
                  : (alertSeverity() === 'delayed' ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-blue-50 border-blue-300 text-blue-950')"
              >
                <div class="flex items-start gap-3">
                  <div class="p-2 rounded-full shrink-0"
                    [ngClass]="alertSeverity() === 'cancelled'
                      ? 'bg-red-100 text-red-600'
                      : (alertSeverity() === 'delayed' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600')"
                  >
                    <app-icon name="alerttriangle" class="w-6 h-6" />
                  </div>
                  <div class="flex-1">
                    <h3 class="text-sm sm:text-base font-black uppercase tracking-wide">
                      {{ lang.t('track.weatherAlert') }}
                      {{ alertSeverity() === 'cancelled'
                        ? (lang.isVietnamese() ? 'CHUYẾN BAY ĐÃ BỊ HỦY' : 'FLIGHT HAS BEEN CANCELLED')
                        : (alertSeverity() === 'delayed'
                            ? (lang.isVietnamese() ? 'CHUYẾN BAY BỊ HOÃN CHUYẾN' : 'FLIGHT HAS BEEN DELAYED')
                            : (lang.isVietnamese() ? 'CHUYẾN BAY CÓ THAY ĐỔI KHẨN CẤP' : 'FLIGHT HAS EMERGENCY CHANGES')) }}
                    </h3>
                    <p class="text-xs sm:text-sm mt-1 leading-relaxed font-semibold">
                      {{ lang.isVietnamese() ? 'Hãng hàng không vừa cập nhật tình trạng các chuyến bay trong hành trình của quý khách. Vui lòng kiểm tra chi tiết bên dưới trước khi ra sân bay.' : 'The airline has updated the status of flights in your itinerary. Please review the details below before heading to the airport.' }}
                    </p>

                    <!-- Danh sách chuyến bị ảnh hưởng: số hiệu + giờ dự kiến/thực tế -->
                    <ul class="mt-3 space-y-2">
                      @for (leg of affectedLegs(); track leg.key) {
                        <li class="text-xs bg-white/80 p-2.5 rounded-xl border"
                          [ngClass]="leg.flight_status === 'CANCELLED' ? 'border-red-200' : 'border-amber-200'">
                          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold">
                            <span class="font-mono text-navy">{{ leg.flight_number || '—' }}</span>
                            <span>{{ leg.origin_iata }} → {{ leg.dest_iata }}</span>
                            <span class="px-2 py-0.5 rounded-full text-[11px] font-black"
                              [ngClass]="leg.flight_status === 'CANCELLED' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'">
                              {{ leg.flight_status === 'CANCELLED' ? (lang.isVietnamese() ? 'ĐÃ HỦY' : 'CANCELLED') : (leg.flight_status || (lang.isVietnamese() ? 'THAY ĐỔI' : 'CHANGED')) }}
                            </span>
                          </div>
                          <div class="mt-1 text-[11px]">
                            {{ lang.isVietnamese() ? 'Giờ dự kiến: ' : 'Scheduled: ' }}
                            <strong>{{ leg.scheduled_departure ? (leg.scheduled_departure | date: 'dd/MM/yyyy HH:mm') : '—' }}</strong>
                            @if (leg.actual_departure != null) {
                              <span class="mx-1">•</span>
                              {{ lang.isVietnamese() ? 'Giờ thực tế: ' : 'Actual: ' }}
                              <strong class="text-rose-700">{{ leg.actual_departure | date: 'dd/MM/yyyy HH:mm' }}</strong>
                            }
                          </div>
                          @if (leg.delay_reason || leg.delay_minutes) {
                            <div class="mt-1 text-[11px] italic">
                              {{ lang.isVietnamese() ? 'Lý do từ hãng hàng không: ' : 'Airline reason: ' }}<strong>{{ delayText(leg.delay_reason, leg.delay_minutes) }}</strong>
                            </div>
                          }
                        </li>
                      }
                    </ul>
                  </div>
                </div>
              </div>
            }

            <!-- Ticket Card -->
            <div class="card-luxury p-6 sm:p-8 shadow-xl border-slate-200">

              <!-- Ticket Header -->
              <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
                <div>
                  <div class="text-xs text-slate-400 font-semibold uppercase tracking-wider">{{ lang.isVietnamese() ? 'Mã đặt chỗ (PNR)' : 'Booking Reference (PNR)' }}</div>
                  <div class="text-2xl font-black font-mono text-navy tracking-wider">
                    {{ b.pnr_code }}
                  </div>
                  <div class="text-xs text-slate-500 mt-0.5">
                    {{ lang.isVietnamese() ? 'Mã số vé: ' : 'Ticket code: ' }}
                    <strong class="font-mono text-amber-600">
                      {{ b.confirmation_number || b.blocking_number || b.cancellation_number || '—' }}
                    </strong>
                  </div>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    {{ lang.isVietnamese() ? 'Loại đặt chỗ: ' : 'Booking type: ' }}<strong>{{ bookingTypeLabel(b.booking_type) }}</strong>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <span
                    class="badge-status"
                    [ngClass]="{
                      'bg-emerald-100 text-emerald-800 border border-emerald-300': b.status === BookingStatus.CONFIRMED,
                      'bg-amber-100 text-amber-800 border border-amber-300': b.status === BookingStatus.BLOCKED,
                      'bg-rose-100 text-rose-800 border border-rose-300': b.status === BookingStatus.CANCELLED,
                      'bg-blue-100 text-blue-800 border border-blue-300': b.status === BookingStatus.RESCHEDULED
                    }"
                  >
                    {{ b.status }}
                  </span>
                </div>
              </div>

              <!-- Thông tin giữ chỗ / xác nhận / hủy -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 text-xs">
                @if (b.blocking_number) {
                  <div class="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                    <div class="text-[11px] text-amber-700 font-semibold uppercase tracking-wide">
                      {{ b.status === BookingStatus.BLOCKED ? (lang.isVietnamese() ? 'Mã giữ chỗ' : 'Hold Code') : (lang.isVietnamese() ? 'Mã giữ chỗ (đã xác nhận)' : 'Hold Code (confirmed)') }}
                    </div>
                    <div class="font-mono font-black text-amber-900">{{ b.blocking_number }}</div>
                  </div>
                }
                @if (b.confirmation_number) {
                  <div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                    <div class="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide">{{ lang.isVietnamese() ? 'Mã xác nhận' : 'Confirmation code' }}</div>
                    <div class="font-mono font-black text-emerald-900">{{ b.confirmation_number }}</div>
                  </div>
                }
                @if (b.cancellation_number) {
                  <div class="p-3 rounded-2xl bg-rose-50 border border-rose-200">
                    <div class="text-[11px] text-rose-700 font-semibold uppercase tracking-wide">{{ lang.isVietnamese() ? 'Số hủy vé' : 'Cancellation code' }}</div>
                    <div class="font-mono font-black text-rose-900">{{ b.cancellation_number }}</div>
                  </div>
                }
                @if (b.status === BookingStatus.BLOCKED && b.blocking_number && b.time_limit_deadline) {
                  <div class="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                    <div class="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">{{ lang.isVietnamese() ? 'Hạn thanh toán' : 'Payment deadline' }}</div>
                    <div class="font-bold text-navy">{{ b.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</div>
                  </div>
                }
              </div>

              <!-- ===== Hành trình: gom ticket_coupons theo leg_type ===== -->
              <div class="space-y-4 mb-6">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-2">{{ lang.isVietnamese() ? 'Hành trình chuyến bay' : 'Flight Itinerary' }}</h4>

                @if (journeyLegs().length === 0) {
                  <div class="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-500">
                    {{ lang.isVietnamese() ? 'Chưa có thông tin chặng bay cho vé này.' : 'No flight leg information available for this ticket.' }}
                  </div>
                }

                @for (group of journeyGroups(); track group.leg_type) {
                  <div class="space-y-3">
                    <div class="flex items-center gap-2">
                      <span class="text-[11px] font-black uppercase tracking-wider text-navy bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                        {{ legTypeLabel(group.leg_type) }}
                      </span>
                      <span class="h-px flex-1 bg-slate-100"></span>
                    </div>

                    @for (leg of group.legs; track leg.key) {
                      <div class="p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                        [ngClass]="leg.is_highlighted_change ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200/80'"
                      >
                        <div class="flex items-center gap-4">
                          <div class="w-10 h-10 rounded-xl bg-navy text-gold flex items-center justify-center font-mono font-bold text-xs shrink-0">
                            {{ leg.origin_iata || '??' }}
                          </div>
                          <div>
                            <div class="text-sm font-black text-navy flex flex-wrap items-center gap-2">
                              <span class="text-amber-600 font-mono">{{ leg.flight_number || '—' }}</span>
                              <span>•</span>
                              <span>{{ leg.origin_iata || '—' }}</span>
                              <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                              <span>{{ leg.dest_iata || '—' }}</span>
                              @if (leg.is_highlighted_change) {
                                <span class="text-[10px] font-black px-2 py-0.5 rounded-full"
                                  [ngClass]="leg.flight_status === 'CANCELLED' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'">
                                  {{ leg.flight_status === 'CANCELLED' ? (lang.isVietnamese() ? 'ĐÃ HỦY' : 'CANCELLED') : (leg.flight_status || (lang.isVietnamese() ? 'THAY ĐỔI' : 'CHANGED')) }}
                                </span>
                              }
                            </div>
                            <div class="text-xs text-slate-500 mt-1">
                              {{ lang.isVietnamese() ? 'Khởi hành: ' : 'Departure: ' }}<strong>{{ leg.scheduled_departure ? (leg.scheduled_departure | date: 'dd/MM/yyyy HH:mm') : '—' }}</strong>
                              <span class="mx-1">•</span>
                              {{ lang.isVietnamese() ? 'Đến: ' : 'Arrival: ' }}<strong>{{ leg.scheduled_arrival ? (leg.scheduled_arrival | date: 'dd/MM/yyyy HH:mm') : '—' }}</strong>
                            </div>
                            @if (leg.actual_departure != null) {
                              <div class="text-[11px] text-rose-600 mt-0.5">
                                {{ lang.isVietnamese() ? 'Thực tế: ' : 'Actual: ' }}<strong>{{ leg.actual_departure | date: 'dd/MM/yyyy HH:mm' }}</strong>
                                @if (leg.delay_reason || leg.delay_minutes) {
                                  <span> — {{ delayText(leg.delay_reason, leg.delay_minutes) }}</span>
                                }
                              </div>
                            }
                            <div class="text-[11px] text-slate-400 mt-0.5">
                              {{ lang.isVietnamese() ? 'Phiếu vé: ' : 'Coupons: ' }}<span class="font-mono">{{ leg.coupon_count }}</span>
                              <span class="mx-1">•</span>
                              {{ lang.isVietnamese() ? 'Ghế: ' : 'Seat: ' }}
                              <strong class="font-mono text-amber-600">{{ leg.seat_codes.length ? leg.seat_codes.join(', ') : (lang.isVietnamese() ? 'Chưa chọn' : 'Not selected') }}</strong>
                            </div>
                          </div>
                        </div>

                        <div class="text-right shrink-0">
                          <span class="text-xs font-semibold px-3 py-1 rounded-full bg-slate-200 text-slate-700">
                            {{ lang.isVietnamese() ? 'Hạng ' : 'Class ' }}{{ leg.cabin_class || '—' }}
                          </span>
                          <div class="text-xs font-black text-navy mt-1.5">{{ leg.fare_paid | currencyFormat }}</div>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- ===== Hành khách: ghế lấy từ ticket_coupons theo passenger_name ===== -->
              <div class="border-t border-slate-100 pt-5 mb-6">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3">{{ lang.isVietnamese() ? 'Danh sách hành khách' : 'Passenger List' }}</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  @for (p of passengerViews(); track $index) {
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between text-xs">
                      <div>
                        <div class="font-bold text-slate-800 uppercase">{{ p.last_name }} {{ p.first_name }}</div>
                        <span class="text-slate-400 text-[11px]">
                          {{ passengerTypeLabel(p.passenger_type) }} • {{ p.id_card_or_passport || 'N/A' }}
                        </span>
                        @if (p.cabin_class) {
                          <div class="text-[11px] text-slate-400">{{ lang.isVietnamese() ? 'Hạng ' : 'Class ' }}{{ p.cabin_class }}</div>
                        }
                      </div>
                      <span class="font-mono font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        {{ p.seat_code || (lang.isVietnamese() ? 'Chưa chọn' : 'Not selected') }}
                      </span>
                    </div>
                  }
                </div>
              </div>

              <!-- ===== Giao dịch thanh toán & tổng tiền ===== -->
              @if (paymentTransactions().length) {
                <div class="border-t border-slate-100 pt-5 mb-6">
                  <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3">{{ lang.isVietnamese() ? 'Lịch sử giao dịch' : 'Transaction History' }}</h4>
                  <div class="space-y-2">
                    @for (tx of paymentTransactions(); track $index) {
                      <div class="flex items-center justify-between text-xs p-3 rounded-xl border"
                        [ngClass]="tx.transaction_type === 'REFUND' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200/60'"
                      >
                        <div>
                          <strong class="text-slate-800">{{ transactionLabel(tx.transaction_type) }}</strong>
                          <div class="text-[11px] text-slate-400">
                            {{ tx.card_masked || '—' }}
                            @if (tx.created_at) {
                              <span> • {{ tx.created_at | date: 'dd/MM/yyyy HH:mm' }}</span>
                            }
                          </div>
                        </div>
                        <span class="font-mono font-black"
                          [ngClass]="tx.transaction_type === 'REFUND' ? 'text-emerald-600' : 'text-navy'">
                          {{ tx.transaction_type === 'REFUND' ? '+' : '' }}{{ tx.amount | currencyFormat }}
                        </span>
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-xs text-slate-600">
                <span>{{ lang.isVietnamese() ? 'Tổng giá trị đơn vé:' : 'Total ticket value:' }}</span>
                <span class="text-lg font-black text-navy">{{ b.total_amount | currencyFormat }}</span>
              </div>

              <!-- ===== Nút hành động theo trạng thái ===== -->
              <div class="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-end gap-3">

                @if (b.status === BookingStatus.BLOCKED) {
                  <button
                    type="button"
                    (click)="openConfirmHoldModal()"
                    class="btn-gold text-xs !py-2.5 !px-5"
                  >
                    <app-icon name="creditcard" class="w-4 h-4" />
                    <span>{{ lang.isVietnamese() ? 'Xác nhận vé' : 'Confirm ticket' }}</span>
                  </button>

                  <button
                    type="button"
                    (click)="openCancelModal()"
                    class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                  >
                    <app-icon name="xcircle" class="w-4 h-4" />
                    <span>{{ lang.isVietnamese() ? 'Huỷ giữ chỗ' : 'Cancel hold' }}</span>
                  </button>
                }

                @if (b.status === BookingStatus.CONFIRMED) {
                  <button
                    type="button"
                    (click)="openRescheduleModal()"
                    class="btn-outline-navy text-xs !py-2.5 !px-5"
                  >
                    <app-icon name="calendar" class="w-4 h-4 text-navy" />
                    <span>{{ lang.t('track.rescheduleBtn') }}</span>
                  </button>

                  <button
                    type="button"
                    (click)="openCancelModal()"
                    class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                  >
                    <app-icon name="xcircle" class="w-4 h-4" />
                    <span>{{ lang.t('track.cancelBtn') }}</span>
                  </button>
                }

                @if (b.status === BookingStatus.CANCELLED) {
                  <div class="w-full flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs">
                    <div>
                      <div class="text-[11px] text-rose-700 font-semibold uppercase tracking-wide">{{ lang.isVietnamese() ? 'Số hủy vé' : 'Cancellation code' }}</div>
                      <div class="font-mono font-black text-rose-900">{{ b.cancellation_number || '—' }}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-[11px] text-rose-700 font-semibold uppercase tracking-wide">{{ lang.isVietnamese() ? 'Số tiền đã hoàn' : 'Refunded amount' }}</div>
                      <div class="font-black text-emerald-600">
                        {{ refundedAmount() | currencyFormat }}
                        @if (refundedPercentage() !== null) {
                          <span class="text-rose-700 font-semibold">({{ refundedPercentage() }}%)</span>
                        }
                      </div>
                    </div>
                  </div>
                }

                @if (b.status === BookingStatus.RESCHEDULED) {
                  <div class="w-full text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl p-3">
                    {{ lang.isVietnamese() ? 'Vé đã được đổi lịch trình. Vui lòng kiểm tra lại hành trình và mã xác nhận mới.' : 'Ticket itinerary has been changed. Please check the updated itinerary and new confirmation code.' }}
                  </div>
                }
              </div>

              <!-- Thông báo kết quả hành động gần nhất -->
              @if (actionMessage()) {
                <div class="mt-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  {{ actionMessage() }}
                </div>
              }

            </div>
          </div>
        }

      </div>
    </div>

    <!-- Modal 1: Confirm Hold Ticket (Thanh toán vé giữ chỗ) -->
    @if (showConfirmHoldModal() && bookingInfo(); as b) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="creditcard" class="w-5 h-5 text-gold" />
              <span>{{ lang.isVietnamese() ? 'Thanh toán vé giữ chỗ' : 'Pay for Hold Booking' }}</span>
            </h3>
            <button (click)="showConfirmHoldModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <p class="text-xs text-slate-500 mb-4 leading-relaxed">
            @if (lang.isVietnamese()) {
              {{ lang.t('track.holdPaymentNotice1') }} <strong>{{ b.blocking_number }}</strong> {{ lang.t('track.holdPaymentNotice2') }}
            } @else {
              Enter credit card details to convert hold booking <strong>{{ b.blocking_number }}</strong> into a confirmed ticket.
            }
          </p>

          @if (b.time_limit_deadline) {
            <div class="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              @if (lang.isVietnamese()) {
                {{ lang.t('track.holdDeadlineLabel') }} <strong>{{ b.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</strong>.
                {{ lang.t('track.holdExpiredNotice') }}
              } @else {
                Payment deadline: <strong>{{ b.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</strong>.
                After expiry, the hold reservation will be cancelled automatically.
              }
            </div>
          }

          <div class="space-y-3 text-xs mb-5">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">
                {{ lang.isVietnamese() ? 'Số thẻ tín dụng (16 số)' : 'Credit Card Number (16 digits)' }}
              </label>
              <input
                type="text"
                [(ngModel)]="confirmCardNumber"
                placeholder="4111222233334444"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold font-mono"
              />
            </div>
            <div class="text-right text-xs">
              <span class="text-slate-500">{{ lang.isVietnamese() ? 'Số tiền cần thanh toán: ' : 'Amount to pay: ' }}</span>
              <strong class="text-navy font-bold">{{ b.total_amount | currencyFormat }}</strong>
            </div>
          </div>

          <div class="flex justify-end gap-3">
            <button (click)="showConfirmHoldModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
            <button
              [disabled]="submittingAction()"
              (click)="executeConfirmHold()"
              class="btn-gold text-xs !py-2.5 !px-5"
            >
              @if (submittingAction()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.isVietnamese() ? 'Xác nhận thanh toán' : 'Confirm Payment' }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal 2: Reschedule Modal (Đổi chuyến bay) — 2-step for round-trip -->
    @if (showRescheduleModal() && bookingInfo(); as b) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="calendar" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('track.rescheduleModalTitle') }}</span>
            </h3>
            <button (click)="showRescheduleModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Step indicator for round-trip -->
          @if (isRoundTrip()) {
            <div class="flex items-center gap-2 mb-4 text-[11px]">
              <span class="px-2.5 py-1 rounded-full font-bold"
                [ngClass]="rescheduleStep() === 1 ? 'bg-navy text-white' : 'bg-slate-100 text-slate-400'">
                {{ lang.t('track.rescheduleStepOutbound') }}
              </span>
              <span class="h-px flex-1 bg-slate-200"></span>
              <span class="px-2.5 py-1 rounded-full font-bold"
                [ngClass]="rescheduleStep() === 2 ? 'bg-navy text-white' : 'bg-slate-100 text-slate-400'">
                {{ lang.t('track.rescheduleStepReturn') }}
              </span>
            </div>
          }

          <p class="text-xs text-slate-500 mb-4">
            {{ rescheduleStep() === 1 ? lang.t('track.rescheduleNotice') : lang.t('track.selectReturnNotice') }}
            <strong>{{ b.confirmation_number }}</strong>.
          </p>

          <!-- Step 1: Outbound flight selection -->
          @if (rescheduleStep() === 1) {
            <!-- §3.6.2 New outbound date selection -->
            @if (loadingBookingWindow()) {
              <div class="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center gap-2">
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin text-gold" />
                <span>{{ lang.isVietnamese() ? 'Đang tải chính sách khung ngày của hãng...' : 'Loading airline booking window policy...' }}</span>
              </div>
            } @else if (bookingWindowError()) {
              <div class="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-rose-600" />
                  <span>{{ lang.isVietnamese() ? 'Không thể tải chính sách thời hạn đặt vé.' : 'Failed to load booking window policy.' }}</span>
                </div>
                <button type="button" (click)="loadBookingWindow()" class="text-xs text-rose-700 font-bold underline ml-2">
                  {{ lang.isVietnamese() ? 'Thử lại' : 'Retry' }}
                </button>
              </div>
            }

            <div class="mb-4 flex items-center gap-3">
              <label class="text-xs font-semibold text-slate-600 shrink-0">
                <app-icon name="calendar" class="w-4 h-4 inline-block mr-1 text-navy" />
                {{ lang.isVietnamese() ? 'Ngày đi mới' : 'New departure date' }}
              </label>
              <input
                type="date"
                [value]="rescheduleOutboundDate()"
                (change)="onOutboundDateChange($any($event.target).value)"
                [min]="bookingWindowMinDate() || todayDateStr"
                [max]="bookingWindowMaxDate()"
                [disabled]="loadingBookingWindow() || !bookingWindowLoaded()"
                class="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-gold focus:ring-1 focus:ring-gold outline-none disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>

            @if (loadingAlternatives()) {
              <div class="py-8 text-center text-xs text-slate-500">
                <app-icon name="refreshcw" class="w-5 h-5 animate-spin mx-auto mb-2 text-gold" />
                {{ lang.t('track.loadingAlternatives') }}
              </div>
            } @else if (isConnecting() || (isRoundTrip() && outboundIsConnecting())) {
              @if (availableConnectingAlternatives().length === 0) {
                <div class="py-8 px-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300 mb-4">
                  {{ lang.isVietnamese() ? 'Không có hành trình nối chuyến phù hợp để đổi.' : 'No valid connecting itinerary is available for rescheduling.' }}
                </div>
              } @else {
                <div class="space-y-2 max-h-72 overflow-y-auto mb-4">
                  @for (route of availableConnectingAlternatives(); track $index) {
                    <button
                      type="button"
                      (click)="selectConnectingAlternative(route)"
                      [class.border-gold]="selectedConnectingAlternative() === route"
                      [class.bg-amber-50]="selectedConnectingAlternative() === route"
                      class="w-full p-3 text-left rounded-xl border border-slate-200 hover:border-gold transition-all text-xs"
                    >
                      <div class="font-bold text-navy mb-2">{{ route.route_type }} · {{ route.total_duration_minutes | flightDuration }}</div>
                      <div class="flex flex-wrap gap-2">
                        @for (leg of route.legs; track leg.flight_id; let index = $index) {
                          <span class="px-2 py-1 rounded bg-white border border-slate-200">
                            {{ index + 1 }}. {{ leg.flight_number }} · {{ leg.origin_iata }} → {{ leg.dest_iata }}
                          </span>
                        }
                      </div>
                    </button>
                  }
                </div>
              }
            } @else if (availableAlternativeFlights().length === 0) {
              <div class="py-8 px-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300 mb-4">
                <app-icon name="alerttriangle" class="w-6 h-6 mx-auto mb-2 text-slate-400" />
                @if (lang.isVietnamese()) {
                  {{ lang.t('track.noRescheduleOptions1') }}
                  <strong>{{ currentCabinClass() || '—' }}</strong>, {{ lang.t('track.seatsAvailable') }}
                  <strong>{{ passengerCount() }}</strong> {{ lang.t('track.noRescheduleOptions2') }}
                } @else {
                  No suitable alternative flight available (same cabin
                  <strong>{{ currentCabinClass() || '—' }}</strong>, with at least
                  <strong>{{ passengerCount() }}</strong> seats). Please consider cancellation or contact support.
                }
              </div>
            } @else {
              <div class="space-y-2 max-h-60 overflow-y-auto mb-4">
                @for (fl of availableAlternativeFlights(); track fl._id) {
                  <button
                    type="button"
                    (click)="selectAlternativeFlight(fl)"
                    [class.border-gold]="selectedNewFlightId() === fl._id"
                    [class.bg-amber-50]="selectedNewFlightId() === fl._id"
                    class="w-full p-3 text-left rounded-xl border border-slate-200 hover:border-gold transition-all flex items-center justify-between text-xs"
                  >
                    <div>
                      <strong class="font-mono font-bold text-navy">{{ fl.flight_number }}</strong>
                      <span class="text-slate-500 ml-2">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                      <div class="text-[11px] text-slate-400 mt-0.5">
                        {{ lang.t('track.cabin') }} {{ selectedInventory(fl)?.cabin_class }} •
                        {{ lang.t('track.remaining') }} {{ selectedInventory(fl)?.available_seats }} {{ lang.t('track.seats') }}
                      </div>
                    </div>
                    <div class="text-right">
                      <span class="text-amber-600 font-bold font-mono">
                        {{ selectedInventory(fl)?.base_price | currencyFormat }}
                      </span>
                    </div>
                  </button>
                }
              </div>
            }
          }

          <!-- Step 2: Return flight selection (round-trip only) -->
          @if (rescheduleStep() === 2) {
            <!-- Keep current return toggle -->
            <div class="mb-4 p-3 rounded-xl border text-xs flex items-center gap-3"
              [ngClass]="keepReturnLeg() ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'">
              <button type="button" (click)="keepReturnLeg.set(!keepReturnLeg())"
                class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0"
                [ngClass]="keepReturnLeg() ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'">
                @if (keepReturnLeg()) { <app-icon name="check" class="w-3 h-3" /> }
              </button>
              <span class="font-semibold">
                {{ lang.t('track.keepCurrentReturn') }}
              </span>
            </div>

            @if (!keepReturnLeg()) {
              <!-- §3.6.2 New return date selection -->
              <div class="mb-4 flex items-center gap-3">
                <label class="text-xs font-semibold text-slate-600 shrink-0">
                  <app-icon name="calendar" class="w-4 h-4 inline-block mr-1 text-navy" />
                  {{ lang.isVietnamese() ? 'Ngày về mới' : 'New return date' }}
                </label>
                <input
                  type="date"
                  [value]="rescheduleReturnDate()"
                  (change)="onReturnDateChange($any($event.target).value)"
                  [min]="rescheduleOutboundDate() || bookingWindowMinDate() || todayDateStr"
                  [max]="bookingWindowMaxDate()"
                  [disabled]="loadingBookingWindow() || !bookingWindowLoaded()"
                  class="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:border-gold focus:ring-1 focus:ring-gold outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              @if (loadingReturnAlternatives()) {
                <div class="py-8 text-center text-xs text-slate-500">
                  <app-icon name="refreshcw" class="w-5 h-5 animate-spin mx-auto mb-2 text-gold" />
                  {{ lang.t('track.loadingReturnFlights') }}
                </div>
              } @else if (returnIsConnecting()) {
                <!-- Connecting return direction -->
                @if (availableReturnConnectingAlternatives().length === 0) {
                  <div class="py-6 px-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300 mb-4">
                    {{ lang.t('track.noReturnAlternative') }}
                  </div>
                } @else {
                  <div class="space-y-2 max-h-72 overflow-y-auto mb-4">
                    @for (route of availableReturnConnectingAlternatives(); track $index) {
                      <button
                        type="button"
                        (click)="selectReturnConnectingAlternative(route)"
                        [class.border-gold]="selectedReturnConnectingAlternative() === route"
                        [class.bg-amber-50]="selectedReturnConnectingAlternative() === route"
                        class="w-full p-3 text-left rounded-xl border border-slate-200 hover:border-gold transition-all text-xs"
                      >
                        <div class="font-bold text-navy mb-2">{{ route.route_type }} · {{ route.total_duration_minutes | flightDuration }}</div>
                        <div class="flex flex-wrap gap-2">
                          @for (leg of route.legs; track leg.flight_id; let index = $index) {
                            <span class="px-2 py-1 rounded bg-white border border-slate-200">
                              {{ index + 1 }}. {{ leg.flight_number }} · {{ leg.origin_iata }} → {{ leg.dest_iata }}
                            </span>
                          }
                        </div>
                      </button>
                    }
                  </div>
                }
              } @else if (availableReturnAlternativeFlights().length === 0) {
                <div class="py-6 px-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300 mb-4">
                  {{ lang.t('track.noReturnAlternative') }}
                </div>
              } @else {
                <div class="space-y-2 max-h-60 overflow-y-auto mb-4">
                  @for (fl of availableReturnAlternativeFlights(); track fl._id) {
                    <button
                      type="button"
                      (click)="selectReturnAlternativeFlight(fl)"
                      [class.border-gold]="selectedNewReturnFlightId() === fl._id"
                      [class.bg-amber-50]="selectedNewReturnFlightId() === fl._id"
                      class="w-full p-3 text-left rounded-xl border border-slate-200 hover:border-gold transition-all flex items-center justify-between text-xs"
                    >
                      <div>
                        <strong class="font-mono font-bold text-navy">{{ fl.flight_number }}</strong>
                        <span class="text-slate-500 ml-2">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                        <div class="text-[11px] text-slate-400 mt-0.5">
                          {{ lang.t('track.cabin') }} {{ selectedReturnInventory(fl)?.cabin_class }} ·
                          {{ lang.t('track.remaining') }} {{ selectedReturnInventory(fl)?.available_seats }} {{ lang.t('track.seats') }}
                        </div>
                      </div>
                      <div class="text-right">
                        <span class="text-amber-600 font-bold font-mono">
                          {{ selectedReturnInventory(fl)?.base_price | currencyFormat }}
                        </span>
                      </div>
                    </button>
                  }
                </div>
              }
            }
          }

          @if (keepReturnLeg() && keepReturnInvalid()) {
            <div class="p-3 mb-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              <app-icon name="alerttriangle" class="w-4 h-4 inline-block mr-1" />
              {{ lang.t('track.returnInvalidNotice') }}
            </div>
          }

          <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
            @if (rescheduleStep() === 2) {
              <button (click)="rescheduleStep.set(1)" class="btn-ghost text-xs">
                {{ lang.t('track.back') }}
              </button>
            }
            <button (click)="showRescheduleModal.set(false)" class="btn-ghost text-xs">{{ lang.t('track.close') }}</button>

            @if (rescheduleStep() === 1 && isRoundTrip()) {
              <!-- Next step for round-trip -->
              <button
                [disabled]="!(outboundIsConnecting() ? selectedConnectingAlternative() : selectedNewFlightId()) || loadingAlternatives()"
                (click)="goToReturnStep()"
                class="btn-navy text-xs !py-2.5 !px-5"
              >
                <span>{{ lang.t('track.nextReturn') }}</span>
                <app-icon name="arrowright" class="w-4 h-4" />
              </button>
            } @else {
              <!-- Final confirm (one-way step 1 OR round-trip step 2) -->
              <button
                [disabled]="!canConfirmReschedule() || submittingAction() || loadingAlternatives() || keepReturnInvalid()"
                (click)="executeReschedule()"
                class="btn-navy text-xs !py-2.5 !px-5"
              >
                @if (submittingAction()) {
                  <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                }
                <span>{{ lang.t('track.confirmReschedule') }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    }

    <!-- Modal 3: Cancel Ticket Modal (Hủy vé & Tính % hoàn tiền) -->
    @if (showCancelModal() && bookingInfo(); as b) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-rose-600 flex items-center gap-2">
              <app-icon name="alerttriangle" class="w-5 h-5 text-rose-600" />
              <span>{{ lang.isVietnamese() ? 'Xác nhận Yêu cầu Hủy vé' : 'Confirm Ticket Cancellation' }}</span>
            </h3>
            <button (click)="showCancelModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Refund Calculation Preview (chính sách thật từ GET /api/policies) -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 mb-4 space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500">{{ lang.isVietnamese() ? 'Mã vé:' : 'Ticket Code:' }}</span>
              <strong class="font-mono text-navy">
                {{ b.confirmation_number || b.blocking_number || b.pnr_code }}
              </strong>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-500">{{ lang.isVietnamese() ? 'Tổng tiền vé đã trả:' : 'Total paid fare:' }}</span>
              <span>{{ b.total_amount | currencyFormat }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-500">{{ lang.isVietnamese() ? 'Chuyến khởi hành sớm nhất:' : 'Earliest departure:' }}</span>
              <strong>{{ earliestDeparture() ? (earliestDeparture() | date: 'dd/MM/yyyy HH:mm') : '—' }}</strong>
            </div>

            @if (calculatingRefund()) {
              <div class="flex items-center gap-2 pt-2 border-t border-slate-200 text-slate-500">
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                {{ lang.isVietnamese() ? 'Đang tính chính sách hoàn tiền...' : 'Calculating refund policy...' }}
              </div>
            } @else {
              <div class="flex items-center justify-between pt-2 border-t border-slate-200">
                <span class="text-slate-500">{{ lang.t('track.cancelPolicyInfo') }}</span>
                <span class="font-bold text-amber-600">{{ estimatedRefundPercent() }}% {{ lang.isVietnamese() ? 'hoàn tiền' : 'refund' }}</span>
              </div>
              <div class="flex items-center justify-between text-sm font-bold pt-1">
                <span class="text-slate-700">{{ lang.t('track.refundEstimate') }}</span>
                <span class="text-emerald-600">{{ estimatedRefundAmount() | currencyFormat }}</span>
              </div>
              @if (matchedPolicyDescription()) {
                <div class="text-[11px] text-slate-400 italic pt-1">{{ matchedPolicyDescription() }}</div>
              }
            }

            @if (b.status === BookingStatus.BLOCKED) {
              <div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2 mt-1">
                {{ lang.isVietnamese() ? 'Vé đang giữ chỗ chưa thanh toán nên sẽ không được hoàn tiền.' : 'Unpaid hold booking will not be refunded.' }}
              </div>
            }
          </div>

          <div class="mb-5 text-xs">
            <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Lý do hủy vé' : 'Cancellation Reason' }}</label>
            <textarea
              [(ngModel)]="cancelReason"
              rows="3"
              placeholder="{{ lang.t('track.reasonPlaceholder') }}"
              class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400"
            ></textarea>
          </div>

          <div class="flex justify-end gap-3">
            <button (click)="showCancelModal.set(false)" class="btn-ghost text-xs">{{ lang.isVietnamese() ? 'Không hủy' : 'Keep Booking' }}</button>
            <button
              [disabled]="submittingAction()"
              (click)="executeCancel()"
              class="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              @if (submittingAction()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.t('track.confirmCancel') }}</span>
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class TrackBookingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly authModal = inject(AuthModalService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  /** Today's date as YYYY-MM-DD for date picker min attribute */
  readonly todayDateStr = new Date().toISOString().slice(0, 10);

  searchCode = '';
  readonly loading = signal(false);
  /** true khi đã thực hiện ít nhất 1 lần tra cứu (để hiện empty-state). */
  readonly searched = signal(false);

  /** Envelope thật của GET /api/bookings/track/:code. */
  readonly trackResult = signal<TrackBookingEnvelope | null>(null);
  readonly submittingAction = signal(false);
  readonly actionMessage = signal('');

  /** booking_info đã đọc từ envelope. */
  readonly bookingInfo = computed<LocalBooking | null>(
    () => this.trackResult()?.booking_info ?? null,
  );
  readonly hasEmergencyChanges = computed(() => !!this.trackResult()?.has_emergency_changes);

  BookingStatus = BookingStatus;

  // Modals
  readonly showConfirmHoldModal = signal(false);
  readonly showRescheduleModal = signal(false);
  readonly showCancelModal = signal(false);

  confirmCardNumber = '4111222233334444';
  cancelReason = this.lang.isVietnamese() ? this.lang.t('track.personalPlanChanged') || '' : 'Personal plans changed';

  // Reschedule alternatives
  readonly availableAlternativeFlights = signal<Flight[]>([]);
  readonly loadingAlternatives = signal(false);
  readonly selectedNewFlightId = signal('');
  readonly selectedNewInventoryId = signal('');
  readonly availableConnectingAlternatives = signal<ConnectingRouteOption[]>([]);
  readonly selectedConnectingAlternative = signal<ConnectingRouteOption | null>(null);

  // Round-trip reschedule (G5)
  readonly rescheduleStep = signal<1 | 2>(1);
  readonly selectedNewReturnFlightId = signal('');
  readonly selectedNewReturnInventoryId = signal('');
  readonly availableReturnAlternativeFlights = signal<Flight[]>([]);
  readonly loadingReturnAlternatives = signal(false);
  readonly keepReturnLeg = signal(true);
  readonly isRoundTrip = computed(() => (this.bookingInfo()?.booking_type || '').toUpperCase() === 'ROUND_TRIP');
  readonly isConnecting = computed(() => (this.bookingInfo()?.booking_type || '').toUpperCase() === 'CONNECTING');

  /** Detect outbound direction topology from journeyLegs */
  readonly outboundIsConnecting = computed(() => {
    const legs = this.journeyLegs();
    return legs.some((l) => /^CONNECTING_\d+$/.test(l.leg_type));
  });
  /** Detect return direction topology from journeyLegs */
  readonly returnIsConnecting = computed(() => {
    const legs = this.journeyLegs();
    return legs.some((l) => /^INBOUND_\d+$/.test(l.leg_type));
  });

  // Return connecting alternatives
  readonly availableReturnConnectingAlternatives = signal<ConnectingRouteOption[]>([]);
  readonly selectedReturnConnectingAlternative = signal<ConnectingRouteOption | null>(null);

  // §3.6.2 New date selection for reschedule
  readonly rescheduleOutboundDate = signal('');
  readonly rescheduleReturnDate = signal('');
  readonly bookingWindowMinDate = signal('');
  readonly bookingWindowMaxDate = signal('');
  readonly loadingBookingWindow = signal(false);
  readonly bookingWindowLoaded = signal(false);
  readonly bookingWindowError = signal(false);

  /** Final arrival of the selected new outbound (direct or connecting) */
  readonly selectedOutboundFinalArrival = computed<Date | null>(() => {
    if (this.outboundIsConnecting()) {
      const route = this.selectedConnectingAlternative();
      if (!route?.legs?.length) return null;
      const lastLeg = route.legs[route.legs.length - 1];
      return lastLeg?.arrival ? new Date(lastLeg.arrival) : null;
    }
    const flight = this.availableAlternativeFlights()
      .find((f) => String(f._id) === this.selectedNewFlightId());
    return flight?.scheduled_arrival ? new Date(flight.scheduled_arrival) : null;
  });

  /** Can confirm reschedule: booking window valid + outbound selected + (one-way OR keepReturn OR return selected) */
  readonly canConfirmReschedule = computed(() => {
    if (!this.bookingWindowLoaded()) return false;
    if (this.isConnecting()) return !!this.selectedConnectingAlternative();
    // Mixed ROUND_TRIP: outbound direction selection
    const outOk = this.outboundIsConnecting()
      ? !!this.selectedConnectingAlternative()
      : !!this.selectedNewFlightId();
    if (!outOk) return false;
    if (!this.isRoundTrip()) return true;
    if (this.rescheduleStep() === 1) return true;
    // Return direction selection
    if (this.keepReturnLeg()) return true;
    return this.returnIsConnecting()
      ? !!this.selectedReturnConnectingAlternative()
      : !!this.selectedNewReturnFlightId();
  });

  // Refund estimates (tính từ chính sách thật + ngày khởi hành sớm nhất)
  readonly estimatedRefundPercent = signal(0);
  readonly estimatedRefundAmount = signal(0);
  readonly calculatingRefund = signal(false);
  readonly matchedPolicyDescription = signal('');
  private policies: CancellationPolicy[] | null = null;

  // ------------------------- derived view models -------------------------

  /** Chặng bay đã gộp: ticket_coupons (nguồn chính) + flight_coupons (giờ bay/tình trạng). */
  readonly journeyLegs = computed<TrackedLegView[]>(() => {
    const b = this.bookingInfo();
    if (!b) return [];

    const enrichments = this.getFlightCoupons();
    const byFlightId = new Map<string, LocalFlightCouponEnrichment>();
    const byFlightNumber = new Map<string, LocalFlightCouponEnrichment>();
    for (const fc of enrichments) {
      if (fc.flight_id) byFlightId.set(String(fc.flight_id), fc);
      const num = (fc as any).flight_number || (fc as any)._doc?.flight_number;
      if (num) byFlightNumber.set(String(num), fc);
    }

    const coupons = b.ticket_coupons || [];
    const order: string[] = [];
    const grouped = new Map<string, LocalTicketCoupon[]>();

    for (const c of coupons) {
      const legType = this.normalizeLegType(c.leg_type);
      const key = `${legType}::${c.flight_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
        order.push(key);
      }
      grouped.get(key)!.push(c);
    }

    return order.map((key) => {
      const group = grouped.get(key)!;
      const first = group[0];
      const info =
        byFlightId.get(String(first.flight_id)) ||
        (first.flight_number ? byFlightNumber.get(String(first.flight_number)) : undefined) ||
        {};

      const isAltered =
        info.is_highlighted_change === true ||
        (info.flight_status !== undefined && info.flight_status !== FlightStatus.SCHEDULED) ||
        !!info.delay_reason;

      return {
        key,
        leg_type: this.normalizeLegType(first.leg_type),
        leg_label: this.legTypeLabel(first.leg_type),
        flight_id: String(first.flight_id),
        flight_number: first.flight_number,
        origin_iata: info.origin_iata || '',
        dest_iata: info.dest_iata || '',
        departure_date: info.departure_date || (info.scheduled_departure ? info.scheduled_departure.slice(0, 10) : ''),
        scheduled_departure: info.scheduled_departure,
        scheduled_arrival: info.scheduled_arrival,
        actual_departure: info.actual_departure,
        actual_arrival: info.actual_arrival,
        flight_status: info.flight_status,
        delay_reason: info.delay_reason || '',
        is_highlighted_change: isAltered,
        cabin_class: first.cabin_class,
        passenger_names: group.map((c) => c.passenger_name),
        seat_codes: group.map((c) => c.seat_code || '').filter((s) => !!s),
        fare_paid: group.reduce((sum, c) => sum + (Number(c.fare_paid) || 0), 0),
        coupon_count: group.length,
      } as TrackedLegView;
    });
  });

  /** Nhóm chặng bay theo leg_type để render theo chặng đi / chặng về / nối chuyến. */
  readonly journeyGroups = computed<{ leg_type: string; legs: TrackedLegView[] }[]>(() => {
    const groups: { leg_type: string; legs: TrackedLegView[] }[] = [];
    for (const leg of this.journeyLegs()) {
      const existing = groups.find((g) => g.leg_type === leg.leg_type);
      if (existing) existing.legs.push(leg);
      else groups.push({ leg_type: leg.leg_type, legs: [leg] });
    }
    return groups;
  });

  /** Chỉ những chặng bị ảnh hưởng khẩn cấp (delay / huỷ / đổi giờ). */
  readonly affectedLegs = computed(() =>
    this.journeyLegs().filter(
      (l) => l.is_highlighted_change || l.flight_status === FlightStatus.DELAYED || l.flight_status === FlightStatus.CANCELLED,
    ),
  );

  readonly alertSeverity = computed<'cancelled' | 'delayed' | 'changed'>(() => {
    const legs = this.affectedLegs();
    if (legs.some((l) => l.flight_status === FlightStatus.CANCELLED)) return 'cancelled';
    if (legs.some((l) => l.flight_status === FlightStatus.DELAYED)) return 'delayed';
    return 'changed';
  });

  /** Hành khách + ghế/giá lấy từ ticket_coupons theo passenger_name. */
  readonly passengerViews = computed<TrackedPassengerView[]>(() => {
    const b = this.bookingInfo();
    if (!b) return [];
    const used = new Set<number>();
    const coupons = b.ticket_coupons || [];

    return (b.passengers || []).map((p) => {
      const match = this.findCouponForPassenger(coupons, p, used);
      return {
        first_name: p.first_name,
        last_name: p.last_name,
        passenger_type: p.passenger_type,
        id_card_or_passport: p.id_card_or_passport,
        nationality: p.nationality,
        seat_code: match?.seat_code || '',
        fare_paid: match?.fare_paid,
        cabin_class: match?.cabin_class,
      } as TrackedPassengerView;
    });
  });

  readonly paymentTransactions = computed<LocalPaymentTransaction[]>(
    () => this.bookingInfo()?.payment_transactions || [],
  );

  /** Số tiền hoàn thực tế (từ giao dịch REFUND trong payment_transactions). */
  readonly refundedAmount = computed(() => {
    const refunds = this.paymentTransactions().filter((t) => t.transaction_type === 'REFUND');
    return refunds.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  });

  readonly refundedPercentage = computed<number | null>(() => {
    const b = this.bookingInfo();
    if (!b || this.refundedAmount() <= 0 || !b.total_amount) return null;
    return Math.round((this.refundedAmount() / b.total_amount) * 100);
  });

  readonly passengerCount = computed(() => this.bookingInfo()?.passengers?.length || 1);

  /** Hạng khoang của chặng đi (dùng để lọc chuyến thay thế). */
  readonly currentCabinClass = computed(() => {
    const b = this.bookingInfo();
    if (!b) return '';
    const outbound = (b.ticket_coupons || []).find(
      (c) => this.normalizeLegType(c.leg_type) === 'OUTBOUND',
    );
    return (outbound || (b.ticket_coupons || [])[0])?.cabin_class || '';
  });

  readonly earliestDeparture = computed<string | null>(() => {
    const times = this.journeyLegs()
      .map((l) => l.scheduled_departure)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d).getTime())
      .filter((t) => !isNaN(t));
    if (!times.length) return null;
    return new Date(Math.min(...times)).toISOString();
  });

  // ------------------------------- lifecycle -------------------------------

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const code = params['code'];
      if (code) {
        this.searchCode = code;
        this.handleSearch();
      }
    });
  }

  // -------------------------------- search --------------------------------

  handleSearch(): void {
    const code = (this.searchCode || '').trim().toUpperCase();
    this.searchCode = code;

    if (!code) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? this.lang.t('track.requirePnr') || ''
          : 'Please enter PNR or ticket code to track',
      );
      return;
    }

    // Tra cứu mới: xoá kết quả cũ + thông báo cũ
    this.trackResult.set(null);
    this.actionMessage.set('');
    this.searched.set(true);
    this.loading.set(true);

    this.api.trackBooking(code).subscribe({
      next: (res) => {
        const env = res as unknown as TrackBookingEnvelope;
        this.loading.set(false);
        if (!env?.booking_info) {
          this.trackResult.set(null);
          this.toast.error(
            this.lang.isVietnamese()
              ? this.lang.t('track.invalidData') || ''
              : 'Invalid ticket data returned. Please try again.',
          );
          return;
        }
        this.trackResult.set(env);
      },
      error: (err) => {
        this.loading.set(false);
        this.trackResult.set(null);
        this.toast.error(
          err?.error?.message ||
            (this.lang.isVietnamese()
              ? this.lang.t('track.notFound') || ''
              : 'No booking found with the provided code.'),
        );
      },
    });
  }

  /** Luôn nạp lại state bằng envelope thật sau mỗi hành động. */
  private reloadBooking(successMessage?: string): void {
    const b = this.bookingInfo();
    const code = (b?.pnr_code || this.searchCode || '').trim().toUpperCase();
    if (!code) return;

    this.api.trackBooking(code).subscribe({
      next: (res) => {
        const env = res as unknown as TrackBookingEnvelope;
        if (env?.booking_info) this.trackResult.set(env);
        this.loading.set(false);
        this.searched.set(true);
        if (successMessage) {
          this.actionMessage.set(successMessage);
          this.toast.success(successMessage);
        }
      },
      error: (err) => {
        this.loading.set(false);
        // Vé vừa bị huỷ vẫn tra cứu được, nhưng nếu lỗi ta thông báo rõ ràng.
        this.toast.warning(
          err?.error?.message ||
            (this.lang.isVietnamese()
              ? this.lang.t('track.actionCompleteReloadFailed') || ''
              : 'Action completed, but failed to reload ticket details. Please track again.'),
        );
      },
    });
  }

  // ------------------------------ action guards ------------------------------

  /**
   * confirm/reschedule/cancel đều yêu cầu JWT. Chủ động mở modal đăng nhập
   * nếu chưa đăng nhập, và xử lý 401 khi token hết hạn.
   */
  private requireLogin(): boolean {
    if (this.auth.isAuthenticated()) return true;
    this.authModal.open();
    this.toast.warning(
      this.lang.isVietnamese()
        ? this.lang.t('track.loginRequired') || ''
        : 'Please sign in to manage your booking (confirm / reschedule / cancel).',
    );
    return false;
  }

  private handleUnauthorized(err: any): boolean {
    if (err?.status === 401 || err?.status === 403) {
      this.toast.error(
        err?.status === 401
          ? (this.lang.isVietnamese()
              ? this.lang.t('track.sessionExpired') || ''
              : 'Session expired. Please sign in again to continue.')
          : (err?.error?.message ||
              (this.lang.isVietnamese()
                ? this.lang.t('track.noPermission') || ''
                : 'You do not have permission to manage this booking.')),
      );
      this.authModal.open();
      return true;
    }
    return false;
  }

  // ----------------------------- confirm (BLOCKED) -----------------------------

  openConfirmHoldModal(): void {
    if (!this.requireLogin()) return;
    this.showConfirmHoldModal.set(true);
  }

  executeConfirmHold(): void {
    const b = this.bookingInfo();
    if (!b?.blocking_number) {
      this.toast.error(
        this.lang.isVietnamese()
          ? this.lang.t('track.noBlockingNumber') || ''
          : 'Blocking number not found for this booking.',
      );
      return;
    }
    if (!this.requireLogin()) return;

    this.submittingAction.set(true);
    this.api
      .confirmBooking({
        blocking_number: b.blocking_number,
        credit_card_number: (this.confirmCardNumber || '').replace(/\s+/g, ''),
      })
      .subscribe({
        next: () => {
          // Backend trả document Booking trần → KHÔNG gán wrapper, nạp lại envelope.
          this.submittingAction.set(false);
          this.showConfirmHoldModal.set(false);
          // Xác nhận vé làm backend cộng dặm SkyMiles → làm mới cache hồ sơ.
          this.auth.refreshProfile();
          this.reloadBooking(
            this.lang.isVietnamese()
              ? this.lang.t('track.holdPaymentSuccess') || ''
              : 'Hold payment successful! Ticket has been confirmed.',
          );
        },
        error: (err) => {
          this.submittingAction.set(false);
          if (this.handleUnauthorized(err)) return;
          this.toast.error(
            err?.error?.message ||
              (this.lang.isVietnamese()
                ? this.lang.t('track.holdPaymentFailed') || ''
                : 'Hold payment failed.'),
          );
        },
      });
  }

  // ------------------------------ reschedule ------------------------------

  openRescheduleModal(): void {
    if (!this.requireLogin()) return;

    const legs = this.journeyLegs();
    const outbound = legs.find((l) => l.leg_type === 'OUTBOUND') || legs[0];
    if (!outbound) {
      this.toast.error(
        this.lang.isVietnamese()
          ? this.lang.t('track.noFlightInfoForReschedule') || ''
          : 'No flight leg info found to reschedule.',
      );
      return;
    }
    if (!outbound.origin_iata || !outbound.dest_iata) {
      this.toast.error(
        this.lang.isVietnamese()
          ? this.lang.t('track.unknownFlightSegment') || ''
          : 'Flight route not identified. Please track again.',
      );
      return;
    }

    this.selectedNewFlightId.set('');
    this.selectedNewInventoryId.set('');
    this.availableAlternativeFlights.set([]);
    this.availableConnectingAlternatives.set([]);
    this.selectedConnectingAlternative.set(null);
    this.rescheduleStep.set(1);
    this.selectedNewReturnFlightId.set('');
    this.selectedNewReturnInventoryId.set('');
    this.availableReturnAlternativeFlights.set([]);
    this.keepReturnLeg.set(true);
    this.showRescheduleModal.set(true);

    // §3.6.2 Initialize new date from current outbound departure_date
    const initDate = outbound.departure_date || (outbound.scheduled_departure ? outbound.scheduled_departure.slice(0, 10) : '');
    this.rescheduleOutboundDate.set(initDate);
    this.rescheduleReturnDate.set('');

    const loadOutboundData = () => {
      this.loadingAlternatives.set(true);
      // Reset return connecting state
      this.availableReturnConnectingAlternatives.set([]);
      this.selectedReturnConnectingAlternative.set(null);

      if (this.isConnecting() || (this.isRoundTrip() && this.outboundIsConnecting())) {
        const outboundLegs = legs.filter((l) => l.leg_type === 'OUTBOUND' || /^CONNECTING_\d+$/.test(l.leg_type));
        const firstOut = outboundLegs[0] || outbound;
        const lastOut = outboundLegs[outboundLegs.length - 1] || outbound;
        this.api.searchFlights({
          origin: firstOut.origin_iata,
          destination: lastOut.dest_iata,
          departure_date: this.rescheduleOutboundDate(),
          adults: this.passengerCount(),
          include_connecting: true,
        }).subscribe({
          next: (result) => {
            this.loadingAlternatives.set(false);
            this.availableConnectingAlternatives.set(result.connecting_routes || []);
          },
          error: (err) => {
            this.loadingAlternatives.set(false);
            this.toast.error(err?.error?.message || this.lang.t('track.failedToLoadAlternative'));
          },
        });
        if (this.isConnecting()) return;
        return;
      }

      this.api
        .getFlights({ origin: outbound.origin_iata, dest: outbound.dest_iata })
        .subscribe({
          next: (flights) => {
            this.loadingAlternatives.set(false);
            this.availableAlternativeFlights.set(
              this.filterAlternativeFlightsForDate(flights, outbound, this.rescheduleOutboundDate()),
            );
          },
          error: (err) => {
            this.loadingAlternatives.set(false);
            this.availableAlternativeFlights.set([]);
            this.toast.error(
              err?.error?.message ||
                (this.lang.isVietnamese()
                  ? this.lang.t('track.failedToLoadAlternative') || ''
                  : 'Failed to load alternative flights.'),
            );
          },
        });
    };

    if (this.bookingWindowLoaded()) {
      loadOutboundData();
    } else {
      this.loadingAlternatives.set(true);
      this.loadBookingWindow(() => {
        loadOutboundData();
      });
    }
  }

  /** Load booking window policy from backend authoritatively */
  loadBookingWindow(callback?: () => void): void {
    this.loadingBookingWindow.set(true);
    this.bookingWindowError.set(false);
    this.api.getBookingWindow().subscribe({
      next: (bw) => {
        this.bookingWindowMinDate.set(bw.min_date || this.todayDateStr);
        this.bookingWindowMaxDate.set(bw.max_date || '');
        this.bookingWindowLoaded.set(true);
        this.loadingBookingWindow.set(false);
        if (callback) callback();
      },
      error: () => {
        this.bookingWindowLoaded.set(false);
        this.loadingBookingWindow.set(false);
        this.bookingWindowError.set(true);
        this.loadingAlternatives.set(false);
        this.toast.error(
          this.lang.isVietnamese()
            ? 'Không thể tải chính sách thời hạn đặt vé của hãng. Vui lòng thử lại.'
            : 'Could not load airline booking window policy. Please try again.',
        );
      },
    });
  }

  /** §3.6.2 Reload outbound alternatives when selected date changes */
  onOutboundDateChange(newDate: string): void {
    this.rescheduleOutboundDate.set(newDate);
    // Clear stale selections
    this.selectedNewFlightId.set('');
    this.selectedNewInventoryId.set('');
    this.selectedConnectingAlternative.set(null);
    this.availableAlternativeFlights.set([]);
    this.availableConnectingAlternatives.set([]);
    if (!newDate) return;

    if (!this.bookingWindowLoaded() || !this.bookingWindowMaxDate()) {
      this.toast.error(
        this.lang.isVietnamese()
          ? 'Chưa tải được khung thời gian đặt vé hợp lệ.'
          : 'Booking window policy has not loaded yet.',
      );
      return;
    }

    const minDate = this.bookingWindowMinDate() || this.todayDateStr;
    const maxDate = this.bookingWindowMaxDate();

    if (newDate < minDate) {
      this.toast.error(
        this.lang.isVietnamese()
          ? `Ngày đi không thể ở trong quá khứ (sớm nhất: ${minDate}).`
          : `Departure date cannot be in the past (earliest: ${minDate}).`,
      );
      return;
    }

    if (newDate > maxDate) {
      this.toast.error(
        this.lang.isVietnamese()
          ? `Ngày đi vượt quá thời hạn đặt vé tối đa (${maxDate}).`
          : `Departure date exceeds maximum booking window (${maxDate}).`,
      );
      return;
    }

    // If return date is already selected and now earlier than new outbound date, clear it
    if (this.rescheduleReturnDate() && this.rescheduleReturnDate() < newDate) {
      this.rescheduleReturnDate.set('');
      this.selectedNewReturnFlightId.set('');
      this.selectedNewReturnInventoryId.set('');
      this.selectedReturnConnectingAlternative.set(null);
      this.availableReturnAlternativeFlights.set([]);
      this.availableReturnConnectingAlternatives.set([]);
    }

    this.loadingAlternatives.set(true);
    const legs = this.journeyLegs();
    const outbound = legs.find((l) => l.leg_type === 'OUTBOUND') || legs[0];
    if (!outbound) { this.loadingAlternatives.set(false); return; }

    if (this.isConnecting() || (this.isRoundTrip() && this.outboundIsConnecting())) {
      const outboundLegs = legs.filter((l) => l.leg_type === 'OUTBOUND' || /^CONNECTING_\d+$/.test(l.leg_type));
      const firstOut = outboundLegs[0] || outbound;
      const lastOut = outboundLegs[outboundLegs.length - 1] || outbound;
      this.api.searchFlights({
        origin: firstOut.origin_iata,
        destination: lastOut.dest_iata,
        departure_date: newDate,
        adults: this.passengerCount(),
        include_connecting: true,
      }).subscribe({
        next: (result) => {
          this.loadingAlternatives.set(false);
          this.availableConnectingAlternatives.set(result.connecting_routes || []);
        },
        error: () => {
          this.loadingAlternatives.set(false);
          this.availableConnectingAlternatives.set([]);
        },
      });
    } else {
      this.api
        .getFlights({ origin: outbound.origin_iata, dest: outbound.dest_iata })
        .subscribe({
          next: (flights) => {
            this.loadingAlternatives.set(false);
            this.availableAlternativeFlights.set(
              this.filterAlternativeFlightsForDate(flights, outbound, newDate),
            );
          },
          error: () => {
            this.loadingAlternatives.set(false);
            this.availableAlternativeFlights.set([]);
          },
        });
    }
  }

  /** Filter direct alternatives restricted to a specific date using flight.departure_date */
  private filterAlternativeFlightsForDate(flights: Flight[], current: TrackedLegView, dateStr: string): Flight[] {
    const base = this.filterAlternativeFlights(flights, current);
    if (!dateStr) return base;
    return base.filter((f) => (f.departure_date || (f.scheduled_departure ? f.scheduled_departure.slice(0, 10) : '')) === dateStr);
  }

  /** §3.6.2 Reload return alternatives when selected return date changes */
  onReturnDateChange(newDate: string): void {
    this.rescheduleReturnDate.set(newDate);
    // Clear stale return selections
    this.selectedNewReturnFlightId.set('');
    this.selectedNewReturnInventoryId.set('');
    this.selectedReturnConnectingAlternative.set(null);
    this.availableReturnAlternativeFlights.set([]);
    this.availableReturnConnectingAlternatives.set([]);
    if (!newDate) return;

    if (!this.bookingWindowLoaded() || !this.bookingWindowMaxDate()) {
      this.toast.error(
        this.lang.isVietnamese()
          ? 'Chưa tải được khung thời gian đặt vé hợp lệ.'
          : 'Booking window policy has not loaded yet.',
      );
      return;
    }

    const minDate = this.bookingWindowMinDate() || this.todayDateStr;
    const maxDate = this.bookingWindowMaxDate();
    const outDate = this.rescheduleOutboundDate();

    if (newDate < minDate) {
      this.toast.error(
        this.lang.isVietnamese()
          ? `Ngày về không thể ở trong quá khứ (sớm nhất: ${minDate}).`
          : `Return date cannot be in the past (earliest: ${minDate}).`,
      );
      return;
    }

    if (newDate > maxDate) {
      this.toast.error(
        this.lang.isVietnamese()
          ? `Ngày về vượt quá thời hạn đặt vé tối đa (${maxDate}).`
          : `Return date exceeds maximum booking window (${maxDate}).`,
      );
      return;
    }

    if (outDate && newDate < outDate) {
      this.toast.error(
        this.lang.isVietnamese()
          ? `Ngày về (${newDate}) không thể trước ngày đi (${outDate}).`
          : `Return date (${newDate}) cannot be earlier than outbound date (${outDate}).`,
      );
      return;
    }

    this.loadingReturnAlternatives.set(true);
    const legs = this.journeyLegs();
    const returnLegs = legs.filter((l) => l.leg_type === 'INBOUND' || /^INBOUND_\d+$/.test(l.leg_type));
    const firstReturn = returnLegs[0];
    const lastReturn = returnLegs[returnLegs.length - 1];
    if (!firstReturn) { this.loadingReturnAlternatives.set(false); return; }

    if (this.returnIsConnecting()) {
      this.api.searchFlights({
        origin: firstReturn.origin_iata,
        destination: lastReturn?.dest_iata || firstReturn.dest_iata,
        departure_date: newDate,
        adults: this.passengerCount(),
        include_connecting: true,
      }).subscribe({
        next: (result) => {
          this.loadingReturnAlternatives.set(false);
          this.availableReturnConnectingAlternatives.set(
            this.filterReturnConnectingRoutes(result.connecting_routes || []),
          );
        },
        error: () => {
          this.loadingReturnAlternatives.set(false);
          this.availableReturnConnectingAlternatives.set([]);
        },
      });
    } else {
      this.api
        .getFlights({ origin: firstReturn.origin_iata, dest: firstReturn.dest_iata })
        .subscribe({
          next: (flights) => {
            this.loadingReturnAlternatives.set(false);
            this.availableReturnAlternativeFlights.set(
              this.filterReturnAlternativeFlightsForDate(flights, firstReturn, newDate),
            );
          },
          error: () => {
            this.loadingReturnAlternatives.set(false);
            this.availableReturnAlternativeFlights.set([]);
          },
        });
    }
  }

  /** Filter return alternatives restricted to a specific date using flight.departure_date */
  private filterReturnAlternativeFlightsForDate(flights: Flight[], current: TrackedLegView, dateStr: string): Flight[] {
    const base = this.filterReturnAlternativeFlights(flights, current);
    if (!dateStr) return base;
    return base.filter((f) => (f.departure_date || (f.scheduled_departure ? f.scheduled_departure.slice(0, 10) : '')) === dateStr);
  }

  /** Lọc chuyến thay thế: khác chuyến hiện tại, không huỷ, đúng hạng khoang và đủ ghế. */
  private filterAlternativeFlights(flights: Flight[], current: TrackedLegView): Flight[] {
    const needed = this.passengerCount();
    const cabin = current.cabin_class;
    const currentFlightId = String(current.flight_id);
    const now = new Date();

    return (flights || [])
      .filter((f) => String(f._id) !== currentFlightId)
      .filter((f) => f.status !== FlightStatus.CANCELLED)
      .filter((f) => new Date(f.scheduled_departure) > now) // §3: exclude past flights
      .filter((f) => this.pickInventory(f, cabin, needed) !== null);
  }

  /** Inventory khớp cabin_class của coupon cũ và còn đủ ghế cho số khách. */
  private pickInventory(flight: Flight, cabinClass: string, needed: number) {
    const inventories = flight?.inventories || [];
    return (
      inventories.find(
        (inv) =>
          (!cabinClass || inv.cabin_class === cabinClass) &&
          (Number(inv.available_seats) || 0) >= needed,
      ) || null
    );
  }

  /** Inventory hiển thị cho 1 chuyến thay thế (dùng chung logic chọn). */
  selectedInventory(flight: Flight) {
    return this.pickInventory(flight, this.currentCabinClass(), this.passengerCount());
  }

  selectAlternativeFlight(flight: Flight): void {
    const inv = this.selectedInventory(flight);
    this.selectedNewFlightId.set(flight._id);
    this.selectedNewInventoryId.set(inv?._id || '');
  }

  selectConnectingAlternative(route: ConnectingRouteOption): void {
    const allReservable = route.legs?.length >= 2 && route.legs.every(
      (leg) => !!this.pickConnectingInventory(leg.inventories),
    );
    if (!allReservable) return;
    this.selectedConnectingAlternative.set(route);
  }

  private pickConnectingInventory(inventories: any[]) {
    const cabin = this.currentCabinClass();
    const needed = this.passengerCount();
    return (inventories || []).find(
      (inventory) => (!cabin || inventory.cabin_class === cabin) && inventory.available_seats >= needed,
    ) || null;
  }

  /** Cabin class of the return leg (for filtering return alternatives). */
  private currentReturnCabinClass(): string {
    const b = this.bookingInfo();
    if (!b) return '';
    const inbound = (b.ticket_coupons || []).find(
      (c) => {
        const t = this.normalizeLegType(c.leg_type);
        return t === 'INBOUND' || /^INBOUND_\d+$/.test(t);
      },
    );
    return inbound?.cabin_class || this.currentCabinClass();
  }

  /** Inventory cho chuyến return thay thế. */
  selectedReturnInventory(flight: Flight) {
    return this.pickInventory(flight, this.currentReturnCabinClass(), this.passengerCount());
  }

  selectReturnAlternativeFlight(flight: Flight): void {
    const inv = this.selectedReturnInventory(flight);
    this.selectedNewReturnFlightId.set(flight._id);
    this.selectedNewReturnInventoryId.set(inv?._id || '');
  }

  /**
   * §3.6.2 / Requirement 1: Validate connecting return route against selected outbound final arrival.
   * Return first leg departure must be valid timestamp and strictly later than outbound arrival.
   * Layover rules are NOT applied across the destination stay.
   */
  isValidReturnConnectingRoute(route: ConnectingRouteOption): boolean {
    if (!route?.legs || route.legs.length < 2) return false;
    const firstLeg = route.legs[0];
    if (!firstLeg?.departure) return false;
    const depTime = new Date(firstLeg.departure);
    if (isNaN(depTime.getTime())) return false;

    const outArr = this.selectedOutboundFinalArrival();
    if (outArr && depTime <= outArr) {
      return false;
    }
    return true;
  }

  filterReturnConnectingRoutes(routes: ConnectingRouteOption[]): ConnectingRouteOption[] {
    return (routes || []).filter((r) => this.isValidReturnConnectingRoute(r));
  }

  selectReturnConnectingAlternative(route: ConnectingRouteOption): void {
    if (!this.isValidReturnConnectingRoute(route)) return;
    const allReservable = route.legs?.length >= 2 && route.legs.every(
      (leg) => !!this.pickConnectingInventory(leg.inventories),
    );
    if (!allReservable) return;
    this.selectedReturnConnectingAlternative.set(route);
  }

  /** Transition from step 1 (outbound) to step 2 (return) — load return alternatives. */
  goToReturnStep(): void {
    const legs = this.journeyLegs();
    const returnLegs = legs.filter((l) => l.leg_type === 'INBOUND' || /^INBOUND_\d+$/.test(l.leg_type));
    const firstReturn = returnLegs[0];
    const lastReturn = returnLegs[returnLegs.length - 1];
    if (!firstReturn || !firstReturn.origin_iata) {
      this.keepReturnLeg.set(true);
      this.rescheduleStep.set(2);
      return;
    }

    this.rescheduleStep.set(2);
    this.keepReturnLeg.set(true);
    this.selectedNewReturnFlightId.set('');
    this.selectedNewReturnInventoryId.set('');
    this.selectedReturnConnectingAlternative.set(null);
    this.loadingReturnAlternatives.set(true);

    // §3.6.2 Initialize return date from existing return leg departure_date
    const returnDate = firstReturn.departure_date || (firstReturn.scheduled_departure ? firstReturn.scheduled_departure.slice(0, 10) : '');
    this.rescheduleReturnDate.set(returnDate);

    if (this.returnIsConnecting()) {
      // Return direction is connecting — search connecting alternatives in return direction
      this.api.searchFlights({
        origin: firstReturn.origin_iata,
        destination: lastReturn?.dest_iata || firstReturn.dest_iata,
        departure_date: this.rescheduleReturnDate(),
        adults: this.passengerCount(),
        include_connecting: true,
      }).subscribe({
        next: (result) => {
          this.loadingReturnAlternatives.set(false);
          this.availableReturnConnectingAlternatives.set(
            this.filterReturnConnectingRoutes(result.connecting_routes || []),
          );
        },
        error: () => {
          this.loadingReturnAlternatives.set(false);
          this.availableReturnConnectingAlternatives.set([]);
        },
      });
    } else {
      // Return direction is direct
      this.api
        .getFlights({ origin: firstReturn.origin_iata, dest: firstReturn.dest_iata })
        .subscribe({
          next: (flights) => {
            this.loadingReturnAlternatives.set(false);
            this.availableReturnAlternativeFlights.set(
              this.filterReturnAlternativeFlightsForDate(flights, firstReturn, this.rescheduleReturnDate()),
            );
          },
          error: () => {
            this.loadingReturnAlternatives.set(false);
            this.availableReturnAlternativeFlights.set([]);
          },
        });
    }
  }

  /** Filter return flight alternatives: same cabin, enough seats, not current flight, not past, after outbound arrival. */
  private filterReturnAlternativeFlights(flights: Flight[], current: TrackedLegView): Flight[] {
    const needed = this.passengerCount();
    const cabin = this.currentReturnCabinClass();
    const currentFlightId = String(current.flight_id);
    const now = new Date();

    // Get selected outbound final arrival (handles both direct and connecting)
    const outboundArr = this.selectedOutboundFinalArrival() || now;

    return (flights || [])
      .filter((f) => String(f._id) !== currentFlightId)
      .filter((f) => f.status !== FlightStatus.CANCELLED)
      .filter((f) => new Date(f.scheduled_departure) > now) // exclude past
      .filter((f) => new Date(f.scheduled_departure) > outboundArr) // return must depart after outbound ARRIVAL
      .filter((f) => this.pickInventory(f, cabin, needed) !== null);
  }

  /** Whether keeping the current return is invalid because it departs before the new outbound arrives */
  keepReturnInvalid(): boolean {
    if (!this.isRoundTrip() || !this.keepReturnLeg()) return false;
    const tracked = this.journeyLegs();
    // Find actual return legs (INBOUND or INBOUND_N), not just "first non-OUTBOUND"
    const inbound = tracked.find((l) =>
      l.leg_type === 'INBOUND' || /^INBOUND_\d+$/.test(l.leg_type),
    );
    if (!inbound?.scheduled_departure) return false;

    const outArr = this.selectedOutboundFinalArrival();
    if (!outArr) return false;

    return new Date(inbound.scheduled_departure) <= outArr;
  }

  executeReschedule(): void {
    const b = this.bookingInfo();
    if (!b?.confirmation_number) return;
    if (!this.requireLogin()) return;

    // Pure CONNECTING booking type
    if (this.isConnecting()) {
      const route = this.selectedConnectingAlternative();
      if (!route?.legs?.length) return;
      const newLegs = route.legs.map((leg, index) => ({
        flight_id: leg.flight_id,
        inventory_id: this.pickConnectingInventory(leg.inventories)?._id || '',
        leg_type: `CONNECTING_${index + 1}`,
      }));
      if (newLegs.some((leg) => !leg.inventory_id)) return;
      this.submittingAction.set(true);
      this.submitReschedulePayload({ confirmation_number: b.confirmation_number, new_legs: newLegs });
      return;
    }

    // Mixed ROUND_TRIP: build payload based on direction topology
    if (this.isRoundTrip() && (this.outboundIsConnecting() || this.returnIsConnecting())) {
      const payload: any = { confirmation_number: b.confirmation_number };

      // Outbound direction
      if (this.outboundIsConnecting()) {
        const route = this.selectedConnectingAlternative();
        if (!route?.legs?.length) return;
        payload.new_legs = route.legs.map((leg, index) => ({
          flight_id: leg.flight_id,
          inventory_id: this.pickConnectingInventory(leg.inventories)?._id || '',
          leg_type: `CONNECTING_${index + 1}`,
        }));
        if (payload.new_legs.some((leg: any) => !leg.inventory_id)) return;
      } else {
        if (!this.selectedNewFlightId()) return;
        payload.new_flight_id = this.selectedNewFlightId();
        payload.new_inventory_id = this.selectedNewInventoryId();
      }

      // Return direction (if not keeping)
      if (!this.keepReturnLeg()) {
        if (this.returnIsConnecting()) {
          const retRoute = this.selectedReturnConnectingAlternative();
          if (!retRoute?.legs?.length) return;
          payload.new_return_legs = retRoute.legs.map((leg, index) => ({
            flight_id: leg.flight_id,
            inventory_id: this.pickConnectingInventory(leg.inventories)?._id || '',
            leg_type: `INBOUND_${index + 1}`,
          }));
          if (payload.new_return_legs.some((leg: any) => !leg.inventory_id)) return;
        } else {
          if (this.selectedNewReturnFlightId()) {
            payload.new_return_flight_id = this.selectedNewReturnFlightId();
            payload.new_return_inventory_id = this.selectedNewReturnInventoryId();
          }
        }
      }

      this.submittingAction.set(true);
      this.submitReschedulePayload(payload);
      return;
    }

    // Direct outbound (ONE_WAY or direct ROUND_TRIP)
    if (!this.selectedNewFlightId()) return;

    const targetFlightId = this.selectedNewFlightId();
    const targetCabin = this.currentCabinClass();
    const needed = this.passengerCount();
    this.submittingAction.set(true);

    this.api.getFlightById(targetFlightId).subscribe({
      next: (flight) => {
        const inv = this.pickInventory(flight, targetCabin, needed);
        const inventoryId = inv?._id || this.selectedNewInventoryId();
        if (!inventoryId) {
          this.submittingAction.set(false);
          this.toast.error(
            this.lang.isVietnamese()
              ? this.lang.t('track.notEnoughSeats') || ''
              : 'Selected flight no longer has enough seats for the booked cabin. Please choose another flight.',
          );
          return;
        }
        this.submitReschedule(b, targetFlightId, inventoryId);
      },
      error: (err) => {
        this.submittingAction.set(false);
        if (this.handleUnauthorized(err)) return;
        this.toast.error(
          err?.error?.message ||
            (this.lang.isVietnamese()
              ? this.lang.t('track.failedToCheckFlight') || ''
              : 'Failed to verify selected flight.'),
        );
      },
    });
  }

  private submitReschedule(b: LocalBooking, flightId: string, inventoryId: string): void {
    const payload: any = {
      confirmation_number: b.confirmation_number,
      new_flight_id: flightId,
      new_inventory_id: inventoryId,
    };

    // Round-trip: include return leg if user chose a new return flight
    if (this.isRoundTrip() && !this.keepReturnLeg() && this.selectedNewReturnFlightId()) {
      payload.new_return_flight_id = this.selectedNewReturnFlightId();
      payload.new_return_inventory_id = this.selectedNewReturnInventoryId();
    }

    this.submitReschedulePayload(payload);
  }

  private submitReschedulePayload(payload: any): void {
    this.api.rescheduleBooking(payload).subscribe({
      next: (res: any) => {
        // Response thật: { booking, price_difference, message }
        this.submittingAction.set(false);
        this.showRescheduleModal.set(false);
        const diff = Number(res?.price_difference) || 0;
        const isVi = this.lang.isVietnamese();
        const diffText = diff === 0
          ? this.lang.t('track.noFareDifference')
          : (diff > 0
              ? (isVi
                  ? (this.lang.t('track.surcharge') || '').replace('{amount}', new Intl.NumberFormat('vi-VN').format(Math.abs(diff)))
                  : `Additional fare: ${new Intl.NumberFormat('en-US').format(Math.abs(diff))} VND.`)
              : (isVi
                  ? (this.lang.t('track.refundDifference') || '').replace('{amount}', new Intl.NumberFormat('vi-VN').format(Math.abs(diff)))
                  : `Fare difference refunded: ${new Intl.NumberFormat('en-US').format(Math.abs(diff))} VND.`));
        const defaultMsg = this.lang.t('track.rescheduleSuccess');
        const msg = res?.message || defaultMsg;
        this.reloadBooking(`${msg} ${diffText}`);
      },
      error: (err) => {
        this.submittingAction.set(false);
        if (this.handleUnauthorized(err)) return;
        this.toast.error(
          err?.error?.message || this.lang.t('track.rescheduleError'),
        );
      },
    });
  }

  // -------------------------------- cancel --------------------------------

  openCancelModal(): void {
    if (!this.requireLogin()) return;
    const b = this.bookingInfo();
    if (!b) return;

    this.cancelReason = this.lang.isVietnamese()
      ? this.lang.t('track.personalPlanChanged') || ''
      : 'Personal plans changed';
    this.showCancelModal.set(true);
    void this.computeRefundEstimate(b);
  }

  /** % hoàn tiền lấy từ chính sách thật (GET /api/policies) + ngày khởi hành sớm nhất. */
  private async computeRefundEstimate(b: LocalBooking): Promise<void> {
    this.calculatingRefund.set(true);
    this.matchedPolicyDescription.set('');

    const total = Number(b.total_amount) || 0;

    // Vé giữ chỗ (chưa thanh toán) không được hoàn tiền (backend cũng trả 0%).
    if (b.status === BookingStatus.BLOCKED) {
      this.estimatedRefundPercent.set(0);
      this.estimatedRefundAmount.set(0);
      this.matchedPolicyDescription.set(
        this.lang.isVietnamese()
          ? this.lang.t('track.unpaidHoldNoRefund') || ''
          : 'Unpaid hold booking: refund not applicable.',
      );
      this.calculatingRefund.set(false);
      return;
    }

    const policies = await this.loadPolicies();
    const departure = this.earliestDeparture();

    if (!policies.length || !departure) {
      this.estimatedRefundPercent.set(0);
      this.estimatedRefundAmount.set(0);
      this.matchedPolicyDescription.set(
        policies.length
          ? ''
          : (this.lang.isVietnamese()
              ? this.lang.t('track.failedToLoadRefundPolicy') || ''
              : 'Failed to load refund policy table from system.'),
      );
      this.calculatingRefund.set(false);
      return;
    }

    const days = Math.max(
      0,
      (new Date(departure).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    const policy = this.matchRefundPolicy(policies, days);
    const pct = policy?.refund_percentage ?? 0;

    this.estimatedRefundPercent.set(pct);
    this.estimatedRefundAmount.set(Math.round((total * pct) / 100));
    const isVi = this.lang.isVietnamese();
    this.matchedPolicyDescription.set(
      policy
        ? (isVi
            ? (this.lang.t('track.refundPolicyDesc') || '').replace('{desc}', policy.description).replace('{days}', Math.floor(days).toString())
            : `${policy.description} (${Math.floor(days)} days before departure)`)
        : (isVi
            ? this.lang.t('track.noMatchingRefundPolicy') || ''
            : 'No refund policy applicable at this time.'),
    );
    this.calculatingRefund.set(false);
  }

  /**
   * Đúng thứ tự backend: sắp xếp min_days_before GIẢM DẦN và lấy dòng khớp đầu tiên.
   * max_days_before = null/undefined nghĩa là không giới hạn trên.
   */
  private matchRefundPolicy(policies: CancellationPolicy[], days: number): CancellationPolicy | null {
    const sorted = [...policies].sort((a, b) => b.min_days_before - a.min_days_before);
    for (const p of sorted) {
      if (p.max_days_before !== null && p.max_days_before !== undefined) {
        if (days >= p.min_days_before && days <= p.max_days_before) return p;
      } else if (days >= p.min_days_before) {
        return p;
      }
    }
    return null;
  }

  private loadPolicies(): Promise<CancellationPolicy[]> {
    if (this.policies) return Promise.resolve(this.policies);
    return new Promise((resolve) => {
      this.api.getPolicies().subscribe({
        next: (policies) => {
          this.policies = policies || [];
          resolve(this.policies);
        },
        error: () => resolve([]),
      });
    });
  }
  
  delayText(reason?: string | null, minutes?: number | null): string {
    const mins = minutes && minutes > 0 ? minutes : Number((reason || '').match(/trễ\s+(\d+)\s+phút/i)?.[1] || 0);
    if (mins > 0) return this.lang.t('track.delayMinutes').replace('{n}', String(mins));
    return reason || '';
  }

  executeCancel(): void {
    const b = this.bookingInfo();
    if (!b) return;
    if (!this.requireLogin()) return;

    const identifier = b.confirmation_number || b.blocking_number || b.pnr_code;
    if (!identifier) {
      this.toast.error(
        this.lang.isVietnamese()
          ? this.lang.t('track.unknownTicketToCancel') || ''
          : 'Cannot identify ticket code to cancel.',
      );
      return;
    }

    this.submittingAction.set(true);
    this.api
      .cancelBooking({ identifier })
      .subscribe({
        next: (res: any) => {
          // Response thật: { booking, refund_amount, refund_percentage, cancellation_number, message }
          this.submittingAction.set(false);
          this.showCancelModal.set(false);

          const pct = Number(res?.refund_percentage) || 0;
          const amount = Number(res?.refund_amount) || 0;
          const cancellationNo = res?.cancellation_number || '';
          const isVi = this.lang.isVietnamese();
          const formatAmt = new Intl.NumberFormat(isVi ? 'vi-VN' : 'en-US').format(amount);
          const tpl = this.lang.t('track.cancelSuccessFull');
          const message = tpl
            ? tpl
                .replace('{no}', cancellationNo || '—')
                .replace('{pct}', pct.toString())
                .replace('{amount}', formatAmt)
            : `Booking cancelled successfully! Cancellation no: ${cancellationNo || '—'}. Refund ${pct}% (${formatAmt} VND).`;

          this.reloadBooking(message);
        },
        error: (err) => {
          this.submittingAction.set(false);
          if (this.handleUnauthorized(err)) return;
          this.toast.error(
            err?.error?.message ||
              (this.lang.isVietnamese() ? 'Hủy vé không thành công.' : 'Ticket cancellation failed.'),
          );
        },
      });
  }

  // -------------------------------- helpers --------------------------------

  /**
   * Mảng flight_coupons của envelope. Shape thật chỉ đảm bảo các field làm giàu
   * (origin_iata, dest_iata, scheduled_departure, flight_status, ...).
   */
  private getFlightCoupons(): LocalFlightCouponEnrichment[] {
    const raw = this.trackResult()?.flight_coupons;
    return Array.isArray(raw) ? raw : [];
  }

  private normalizeLegType(legType?: string): string {
    const t = (legType || 'OUTBOUND').trim().toUpperCase();
    const connectingMatch = t.match(/^CONNECTING[_\s]*(?:LEG[_\s]*)?(\d+)$/);
    if (connectingMatch) {
      return `CONNECTING_${connectingMatch[1]}`;
    }
    const inboundMatch = t.match(/^INBOUND[_\s]*(?:LEG[_\s]*)?(\d+)$/);
    if (inboundMatch) {
      return `INBOUND_${inboundMatch[1]}`;
    }
    return t || 'OUTBOUND';
  }

  legTypeLabel(legType?: string): string {
    const isVi = this.lang.isVietnamese();
    switch (this.normalizeLegType(legType)) {
      case 'OUTBOUND':
        return this.lang.t('track.outboundLeg') || '';
      case 'INBOUND':
        return this.lang.t('track.inboundLeg') || '';
      case 'CONNECTING_1':
        return this.lang.t('track.connectingLeg1') || '';
      case 'CONNECTING_2':
        return this.lang.t('track.connectingLeg2') || '';
      case 'CONNECTING_3':
        return this.lang.t('track.connectingLeg3') || '';
      case 'INBOUND_1':
        return isVi ? 'Chặng về 1' : 'Return 1';
      case 'INBOUND_2':
        return isVi ? 'Chặng về 2' : 'Return 2';
      case 'INBOUND_3':
        return isVi ? 'Chặng về 3' : 'Return 3';
      default:
        return this.normalizeLegType(legType).replace(/_/g, ' ');
    }
  }

  bookingTypeLabel(type?: string): string {
    const isVi = this.lang.isVietnamese();
    switch ((type || '').toUpperCase()) {
      case 'ONE_WAY':
        return this.lang.t('track.oneWay') || '';
      case 'ROUND_TRIP':
        return this.lang.t('track.roundTrip') || '';
      case 'CONNECTING':
        return this.lang.t('track.connecting') || '';
      default:
        return type || '—';
    }
  }

  passengerTypeLabel(type?: string): string {
    const isVi = this.lang.isVietnamese();
    switch ((type || '').toUpperCase()) {
      case 'ADULT':
        return this.lang.t('track.adult') || '';
      case 'CHILD':
        return this.lang.t('track.child') || '';
      case 'SENIOR':
        return this.lang.t('track.senior') || '';
      default:
        return type || '—';
    }
  }

  transactionLabel(type?: string): string {
    const isVi = this.lang.isVietnamese();
    switch ((type || '').toUpperCase()) {
      case 'PAYMENT':
        return this.lang.t('track.ticketPayment') || '';
      case 'REFUND':
        return this.lang.t('track.refund') || '';
      case 'RESCHEDULE_CHARGE':
        return this.lang.t('track.rescheduleSurcharge') || '';
      case 'RESCHEDULE_REFUND':
        return this.lang.t('track.rescheduleRefund') || '';
      default:
        return type || '—';
    }
  }

  /** Ghép hành khách ↔ phiếu vé theo passenger_name (coupon lưu "first last"). */
  private findCouponForPassenger(
    coupons: LocalTicketCoupon[],
    passenger: LocalPassenger,
    used: Set<number>,
  ): LocalTicketCoupon | undefined {
    const first = (passenger.first_name || '').trim();
    const last = (passenger.last_name || '').trim();
    const exact = `${first} ${last}`.trim().toLowerCase();

    let idx = coupons.findIndex(
      (c, i) => !used.has(i) && (c.passenger_name || '').trim().toLowerCase() === exact,
    );

    if (idx < 0) {
      const norm = (s: string) =>
        (s || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\u0111/gi, 'd')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();
      idx = coupons.findIndex((c, i) => {
        if (used.has(i)) return false;
        const name = norm(c.passenger_name);
        return (
          (!!exact && name === norm(exact)) ||
          (!!first && name === norm(`${last} ${first}`))
        );
      });
    }

    if (idx < 0) {
      idx = coupons.findIndex((_, i) => !used.has(i));
    }
    if (idx < 0) return undefined;

    used.add(idx);
    return coupons[idx];
  }
}
