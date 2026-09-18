import { Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import {
  Booking,
  BookingStatus,
  LegType,
  TicketCoupon,
} from '../../core/models/booking.model';

/** One itinerary leg rebuilt from `ticket_coupons` (there is no `legs` array). */
interface ItineraryLeg {
  key: string;
  leg_type: string;
  label: string;
  flight_number: string;
  cabin_class: string;
  fare_total: number;
  coupon_count: number;
  seats: string[];
}

@Component({
  selector: 'app-booking-success',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyFormatPipe],
  // Encapsulation.None so the print rules below can target `body` / the document.
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @media print {
        /* Print ONLY the boarding-pass stub (#ticket-print-area). */
        body * {
          visibility: hidden !important;
        }
        #ticket-print-area,
        #ticket-print-area * {
          visibility: visible !important;
        }
        #ticket-print-area {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          border: none !important;
          box-shadow: none !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        @page {
          margin: 12mm;
        }
      }
    `,
  ],
  template: `
    <div class="min-h-screen bg-slate-50 py-12">
      <div class="max-w-3xl mx-auto px-4 sm:px-6">
        
        @if (booking(); as bk) {
          <!-- Success Header Card -->
          <div class="card-luxury p-6 sm:p-8 text-center shadow-xl border-slate-200 mb-8 overflow-hidden relative">
            <div
              class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              [ngClass]="{
                'bg-emerald-100 text-emerald-600': bk.status === BookingStatus.CONFIRMED,
                'bg-amber-100 text-amber-600': bk.status === BookingStatus.BLOCKED,
                'bg-rose-100 text-rose-600': bk.status === BookingStatus.CANCELLED,
                'bg-sky-100 text-sky-600': bk.status === BookingStatus.RESCHEDULED
              }"
            >
              <app-icon [name]="statusIcon()" class="w-9 h-9" />
            </div>

            <h1 class="text-2xl sm:text-3xl font-black text-navy">
              {{ statusTitle() }}
            </h1>
            <p class="text-xs sm:text-sm text-slate-500 mt-1">
              @if (bk.status === BookingStatus.BLOCKED) {
                {{ lang.t('success.holdNotice') }}
              } @else {
                {{ lang.t('success.subtitle') }}
              }
            </p>

            <!-- Prominent Reference Codes Box -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6 p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80">
              <!-- PNR Code -->
              <div class="p-3 bg-white rounded-xl border border-amber-200 shadow-sm text-center">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {{ lang.t('success.pnr') }}
                </span>
                <span class="text-2xl font-black font-mono text-navy tracking-widest mt-1 block">
                  {{ bk.pnr_code }}
                </span>
              </div>

              <!-- Transaction Code (CNF / BLK) -->
              <div class="p-3 bg-white rounded-xl border border-amber-200 shadow-sm text-center">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {{ bk.status === BookingStatus.BLOCKED ? (lang.isVietnamese() ? 'Mã Giữ chỗ (Hold Code):' : 'Hold Code:') : (lang.isVietnamese() ? 'Mã Xác nhận (Ticket Code):' : 'Ticket Code:') }}
                </span>
                <span class="text-xl sm:text-2xl font-black font-mono text-amber-600 tracking-wide mt-1 block">
                  {{ statusCode() || '—' }}
                </span>
              </div>
            </div>

            @if (bk.status === BookingStatus.BLOCKED) {
              <div class="p-4 rounded-2xl bg-amber-100/70 border border-amber-300 text-amber-900 text-xs text-left mb-6 flex items-start gap-3">
                <app-icon name="alerttriangle" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong class="font-bold">{{ lang.isVietnamese() ? 'Lưu ý vé giữ chỗ miễn phí:' : 'Notice for complimentary hold ticket:' }}</strong>
                  <p class="mt-0.5 leading-relaxed text-[11px]">
                    @if (lang.isVietnamese()) {
                      {{ lang.t('success.holdNoticeExtended1') }}
                      <strong>{{ bk.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</strong>
                      {{ lang.t('success.holdNoticeExtended2') }}
                    } @else {
                      Your ticket is currently on HOLD. Please complete payment before
                      <strong>{{ bk.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</strong>
                      (hold deadline = departure date − 14 days). After this deadline, the system will automatically release your seats.
                    }
                  </p>
                  <a
                    [routerLink]="['/track']"
                    [queryParams]="{ code: bk.blocking_number }"
                    class="btn-gold mt-3 !py-2 !px-4 text-[11px] inline-flex"
                  >
                    <app-icon name="creditcard" class="w-3.5 h-3.5" />
                    <span>{{ lang.isVietnamese() ? 'Xác nhận vé' : 'Confirm ticket' }}</span>
                  </a>
                </div>
              </div>
            }

            <!-- SkyMiles Accrual Badge (mileage is computed by the backend) -->
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-navy text-white text-xs font-semibold shadow-md">
              <app-icon name="award" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('success.milesEarned') }}</span>
              <span class="text-gold font-bold font-mono">+{{ milesEarned() | number }} {{ lang.t('nav.miles') }}</span>
            </div>

          </div>

          <!-- Printable Boarding Pass Stub -->
          <div class="card-luxury p-6 sm:p-8 shadow-md border-slate-200 mb-8 bg-white relative print:border-none print:shadow-none" id="ticket-print-area">
            <div class="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div class="flex items-center gap-2">
                <app-icon name="plane" class="w-5 h-5 text-gold" />
                <span class="font-black text-navy text-base">{{ lang.isVietnamese() ? 'Thẻ Lên Tàu Bay (E-Boarding Pass Stub)' : 'E-Boarding Pass Stub' }}</span>
              </div>
              <span
                class="text-xs font-mono font-bold px-3 py-1 rounded-full"
                [ngClass]="{
                  'bg-navy text-gold': bk.status === BookingStatus.CONFIRMED,
                  'bg-amber-500 text-white': bk.status === BookingStatus.BLOCKED,
                  'bg-rose-100 text-rose-700': bk.status === BookingStatus.CANCELLED,
                  'bg-sky-100 text-sky-700': bk.status === BookingStatus.RESCHEDULED
                }"
              >
                {{ bk.status }}
              </span>
            </div>

            <!-- Itinerary rebuilt from ticket_coupons (grouped leg_type + flight_number) -->
            <div class="space-y-4 mb-6">
              @for (leg of itinerary(); track leg.key) {
                <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <div class="flex items-center gap-2 text-sm font-bold text-navy">
                      <span class="text-[10px] font-black text-gold bg-navy px-2 py-0.5 rounded-full uppercase">
                        {{ leg.label }}
                      </span>
                      <span class="font-mono text-amber-600 font-black">{{ leg.flight_number }}</span>
                    </div>
                    <div class="text-xs text-slate-500 mt-1">
                      {{ leg.coupon_count }} {{ lang.isVietnamese() ? 'hành khách' : 'passenger(s)' }}
                      @if (leg.seats.length) {
                        • {{ lang.isVietnamese() ? 'Ghế:' : 'Seats:' }} <span class="font-mono font-semibold">{{ leg.seats.join(', ') }}</span>
                      }
                    </div>
                  </div>

                  <div class="text-left sm:text-right space-y-1">
                    <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 block w-fit sm:ml-auto">
                      {{ leg.cabin_class }}
                    </span>
                    <span class="text-[10px] text-slate-400 block">{{ lang.isVietnamese() ? 'Giá vé (tổng chặng):' : 'Fare (total leg):' }}</span>
                    <span class="text-xs font-bold text-navy block">
                      {{ leg.fare_total | currencyFormat }}
                    </span>
                  </div>
                </div>
              } @empty {
                <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 text-xs text-slate-500">
                  {{ lang.isVietnamese() ? 'Không có thông tin chặng bay cho đơn vé này.' : 'No flight leg information available for this booking.' }}
                </div>
              }
            </div>

            <!-- Passengers & Assigned Seats (seats come from ticket_coupons) -->
            <div class="border-t border-slate-100 pt-4 mb-6">
              <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3">{{ lang.isVietnamese() ? 'Danh sách Hành khách & Chỗ ngồi' : 'Passengers & Seats List' }}</h4>
              <div class="space-y-2">
                @for (p of bk.passengers; track $index) {
                  <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 text-xs">
                    <div>
                      <strong class="text-slate-800 font-bold uppercase">{{ p.last_name }} {{ p.first_name }}</strong>
                      <span class="text-slate-400 block text-[11px]">{{ lang.isVietnamese() ? 'CCCD/HC: ' : 'ID/Passport: ' }}{{ p.id_card_or_passport || 'N/A' }}</span>
                    </div>
                    <div class="text-right">
                      <span class="inline-flex items-center gap-1 font-mono font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        <app-icon name="armchair" class="w-3.5 h-3.5" />
                        {{ lang.isVietnamese() ? 'Ghế: ' : 'Seat: ' }}{{ seatFor(p.first_name, p.last_name) }}
                      </span>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Final Applied Pricing Details (Requirement 6) -->
            @if (bk.early_bird_percent !== undefined || bk.ff_tier || bk.pricing_note) {
              <div class="border-t border-slate-100 pt-4 mb-3 space-y-2 text-xs">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-2">
                  {{ lang.t('success.pricingAppliedTitle') }}
                </h4>

                @if (bk.early_bird_percent !== undefined && bk.early_bird_percent !== null) {
                  <div class="flex items-center justify-between text-slate-600">
                    <span>
                      {{ lang.t('success.earlyBirdRule') }}:
                      <span class="font-semibold text-slate-800">
                        {{ (lang.isVietnamese() ? bk.early_bird_label : bk.early_bird_label_en) || (bk.early_bird_percent < 0 ? lang.t('results.earlyBirdDiscount') : (bk.early_bird_percent > 0 ? lang.t('results.earlyBirdSurcharge') : lang.t('results.earlyBirdStandard'))) }}
                      </span>
                    </span>
                    <span
                      class="font-bold font-mono px-2.5 py-0.5 rounded-full text-[11px] border"
                      [ngClass]="bk.early_bird_percent < 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : (bk.early_bird_percent > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200')"
                    >
                      {{ bk.early_bird_percent > 0 ? '+' : '' }}{{ bk.early_bird_percent }}%
                    </span>
                  </div>
                }

                @if (bk.ff_tier) {
                  <div class="flex items-center justify-between text-slate-600">
                    <span class="flex items-center gap-1.5">
                      <app-icon name="award" class="w-3.5 h-3.5 text-gold" />
                      <span>{{ lang.t('success.ffTier') }}: <strong class="text-navy font-bold">{{ bk.ff_tier }}</strong></span>
                    </span>
                    <span class="font-bold font-mono text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-[11px] border border-emerald-200">
                      -{{ bk.ff_discount_percent ?? 0 }}%
                    </span>
                  </div>
                }

                @if (bk.pricing_note) {
                  <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 italic">
                    {{ bk.pricing_note }}
                  </div>
                }
              </div>
            }

            <!-- Total Amount -->
            <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-sm">
              <span class="text-slate-500 font-medium">{{ lang.isVietnamese() ? 'Tổng tiền thanh toán:' : 'Total amount paid:' }}</span>
              <span class="text-xl font-black text-navy">{{ bk.total_amount | currencyFormat }}</span>
            </div>

          </div>

          <!-- Bottom Action Buttons -->
          <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              (click)="printTicket()"
              class="btn-outline-navy w-full sm:w-auto text-xs sm:text-sm"
            >
              <app-icon name="printer" class="w-4 h-4" />
              <span>{{ lang.t('success.print') }}</span>
            </button>

            <a
              [routerLink]="['/track']"
              [queryParams]="{ code: bk.pnr_code }"
              class="btn-navy w-full sm:w-auto text-xs sm:text-sm"
            >
              <app-icon name="ticket" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('success.trackNow') }}</span>
            </a>

            <a
              routerLink="/"
              class="btn-ghost w-full sm:w-auto text-center text-xs sm:text-sm"
            >
              <app-icon name="plane" class="w-4 h-4" />
              <span>{{ lang.t('success.home') }}</span>
            </a>
          </div>

        } @else {
          <div class="card-luxury p-12 text-center">
            <app-icon name="info" class="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h3 class="text-lg font-bold text-navy">{{ lang.isVietnamese() ? 'Chưa có thông tin đơn đặt vé' : 'No booking information available' }}</h3>
            <p class="text-xs text-slate-500 mt-1">{{ lang.isVietnamese() ? 'Vui lòng quay về trang chủ để thực hiện tìm kiếm và đặt vé.' : 'Please return to home page to search and book flights.' }}</p>
            <a routerLink="/" class="btn-gold mt-5 text-xs">{{ lang.t('success.home') }}</a>
          </div>
        }

      </div>
    </div>
  `,
})
export class BookingSuccessComponent implements OnInit {
  readonly lang = inject(LanguageService);

  readonly booking = signal<Booking | null>(null);
  /** Backend-computed mileage — never estimated on the client. */
  readonly milesEarned = computed(() => this.booking()?.total_miles_accrued ?? 0);
  readonly itinerary = computed<ItineraryLeg[]>(() => this.buildItinerary());
  /** passenger_name (normalised) → seats found in ticket_coupons. */
  readonly seatsByPassenger = computed<Record<string, string[]>>(() => this.buildSeatMap());

  BookingStatus = BookingStatus;

  private static readonly LEG_ORDER: string[] = [
    LegType.OUTBOUND,
    LegType.CONNECTING_1,
    LegType.CONNECTING_2,
    LegType.CONNECTING_3,
    LegType.INBOUND,
    LegType.INBOUND_1,
    LegType.INBOUND_2,
    LegType.INBOUND_3,
  ];

  ngOnInit(): void {
    const raw = sessionStorage.getItem('confirmed_booking');
    if (raw) {
      try {
        this.booking.set(JSON.parse(raw) as Booking);
      } catch {
        this.booking.set(null);
      }
    }
  }

  /** BLK for a blocked booking, CNF otherwise (spec: confirmation number). */
  statusCode(): string {
    const b = this.booking();
    if (!b) return '';
    return b.status === BookingStatus.BLOCKED
      ? b.blocking_number || ''
      : b.confirmation_number || b.blocking_number || '';
  }

  /** Headline that matches the real booking status. */
  statusTitle(): string {
    const b = this.booking();
    if (!b) return '';
    switch (b.status) {
      case BookingStatus.BLOCKED:
        return this.lang.isVietnamese() ? 'Giữ chỗ thành công!' : 'Reserved Successfully!';
      case BookingStatus.CANCELLED:
        return this.lang.isVietnamese() ? 'Đơn vé đã được hủy' : 'Booking Cancelled';
      case BookingStatus.RESCHEDULED:
        return this.lang.isVietnamese() ? 'Đổi chuyến thành công!' : 'Rescheduled Successfully!';
      default:
        return this.lang.t('success.title');
    }
  }

  statusIcon(): string {
    const b = this.booking();
    switch (b?.status) {
      case BookingStatus.BLOCKED:
        return 'clock';
      case BookingStatus.CANCELLED:
        return 'xcircle';
      case BookingStatus.RESCHEDULED:
        return 'refreshcw';
      default:
        return 'checkcircle2';
    }
  }

  /** Seat(s) of a passenger, read from `ticket_coupons[].seat_code`. */
  seatFor(firstName?: string, lastName?: string): string {
    const key = this.normalizeName(`${firstName || ''} ${lastName || ''}`);
    const seats = this.seatsByPassenger()[key];
    return seats?.length ? seats.join(', ') : (this.lang.isVietnamese() ? 'Chưa gán' : 'Unassigned');
  }

  printTicket(): void {
    window.print();
  }

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  /**
   * The backend stores one coupon per passenger per leg, so the itinerary is
   * rebuilt by grouping coupons on `leg_type` + `flight_number`
   * (backend passenger_name = `${first_name} ${last_name}`).
   */
  private buildItinerary(): ItineraryLeg[] {
    const coupons: TicketCoupon[] = this.booking()?.ticket_coupons || [];
    const groups = new Map<string, ItineraryLeg>();

    for (const coupon of coupons) {
      const legType = this.normalizeLegType((coupon.leg_type || LegType.OUTBOUND) as string);
      const flightNumber = coupon.flight_number || 'N/A';
      const key = `${legType}|${flightNumber}`;

      const existing = groups.get(key);
      if (existing) {
        existing.fare_total += coupon.fare_paid || 0;
        existing.coupon_count += 1;
        if (coupon.seat_code) existing.seats.push(coupon.seat_code);
        continue;
      }

      groups.set(key, {
        key,
        leg_type: legType,
        label: this.legTypeLabel(legType),
        flight_number: flightNumber,
        cabin_class: coupon.cabin_class || 'ECONOMY',
        fare_total: coupon.fare_paid || 0,
        coupon_count: 1,
        seats: coupon.seat_code ? [coupon.seat_code] : [],
      });
    }

    return Array.from(groups.values()).sort(
      (a, b) => this.legRank(a.leg_type) - this.legRank(b.leg_type),
    );
  }

  private buildSeatMap(): Record<string, string[]> {
    const coupons: TicketCoupon[] = this.booking()?.ticket_coupons || [];
    const map: Record<string, string[]> = {};

    for (const coupon of coupons) {
      if (!coupon.seat_code) continue;
      const key = this.normalizeName(coupon.passenger_name || '');
      if (!key) continue;
      map[key] = map[key] || [];
      if (!map[key].includes(coupon.seat_code)) map[key].push(coupon.seat_code);
    }

    return map;
  }

  private legRank(legType: string): number {
    const index = BookingSuccessComponent.LEG_ORDER.indexOf(legType);
    return index === -1 ? BookingSuccessComponent.LEG_ORDER.length : index;
  }

  /** Normalize legacy CONNECTING_LEG_X variants to CONNECTING_X. */
  private normalizeLegType(legType: string): string {
    const t = (legType || 'OUTBOUND').trim().toUpperCase();
    const match = t.match(/^CONNECTING[_\s]*(?:LEG[_\s]*)?(\d+)$/);
    if (match) return `CONNECTING_${match[1]}`;
    return t || 'OUTBOUND';
  }

  private legTypeLabel(legType: string): string {
    const normalized = this.normalizeLegType(legType);
    switch (normalized) {
      case LegType.OUTBOUND:
        return this.lang.isVietnamese() ? 'Chặng đi' : 'Outbound';
      case LegType.INBOUND:
        return this.lang.isVietnamese() ? 'Chặng về' : 'Inbound';
      case LegType.CONNECTING_1:
        return this.lang.isVietnamese() ? 'Nối chuyến 1' : 'Connecting 1';
      case LegType.CONNECTING_2:
        return this.lang.isVietnamese() ? 'Nối chuyến 2' : 'Connecting 2';
      case LegType.CONNECTING_3:
        return this.lang.isVietnamese() ? 'Nối chuyến 3' : 'Connecting 3';
      case LegType.INBOUND_1:
        return this.lang.isVietnamese() ? 'Chặng về 1' : 'Return 1';
      case LegType.INBOUND_2:
        return this.lang.isVietnamese() ? 'Chặng về 2' : 'Return 2';
      case LegType.INBOUND_3:
        return this.lang.isVietnamese() ? 'Chặng về 3' : 'Return 3';
      default:
        return normalized;
    }
  }
}
