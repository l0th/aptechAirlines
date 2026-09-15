import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { Booking, BookingStatus } from '../../core/models/booking.model';

@Component({
  selector: 'app-booking-success',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyFormatPipe],
  template: `
    <div class="min-h-screen bg-slate-50 py-12">
      <div class="max-w-3xl mx-auto px-4 sm:px-6">
        
        @if (booking()) {
          <!-- Success Header Card -->
          <div class="card-luxury p-6 sm:p-8 text-center shadow-xl border-slate-200 mb-8 overflow-hidden relative">
            <div class="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <app-icon name="checkcircle2" class="w-9 h-9" />
            </div>

            <h1 class="text-2xl sm:text-3xl font-black text-navy">
              {{ lang.t('success.title') }}
            </h1>
            <p class="text-xs sm:text-sm text-slate-500 mt-1">
              {{ lang.t('success.subtitle') }}
            </p>

            <!-- Prominent Reference Codes Box -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6 p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80">
              <!-- PNR Number -->
              <div class="p-3 bg-white rounded-xl border border-amber-200 shadow-sm text-center">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {{ lang.t('success.pnr') }}
                </span>
                <span class="text-2xl font-black font-mono text-navy tracking-widest mt-1 block">
                  {{ booking()?.pnr_number }}
                </span>
              </div>

              <!-- Transaction Code (CNF / BLK) -->
              <div class="p-3 bg-white rounded-xl border border-amber-200 shadow-sm text-center">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {{ booking()?.status === BookingStatus.BLOCKED ? 'Mã Giữ chỗ (Hold Code):' : 'Mã Xác nhận (Ticket Code):' }}
                </span>
                <span class="text-xl sm:text-2xl font-black font-mono text-amber-600 tracking-wide mt-1 block">
                  {{ booking()?.confirmation_number || booking()?.blocking_number }}
                </span>
              </div>
            </div>

            @if (booking()?.status === BookingStatus.BLOCKED) {
              <div class="p-4 rounded-2xl bg-amber-100/70 border border-amber-300 text-amber-900 text-xs text-left mb-6 flex items-start gap-3">
                <app-icon name="alerttriangle" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong class="font-bold">Lưu ý vé giữ chỗ miễn phí:</strong>
                  <p class="mt-0.5 leading-relaxed text-[11px]">
                    Vé của quý khách đang ở trạng thái GIỮ CHỖ. Vui lòng hoàn tất thanh toán trước thời hạn
                    <strong>{{ booking()?.blocking_expires_at | date: 'dd/MM/yyyy HH:mm' }}</strong>. Quá thời hạn này, hệ thống sẽ tự động giải phóng chỗ ngồi.
                  </p>
                </div>
              </div>
            }

            <!-- SkyMiles Accrual Badge -->
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-navy text-white text-xs font-semibold shadow-md">
              <app-icon name="award" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('success.milesEarned') }}</span>
              <span class="text-gold font-bold font-mono">+{{ milesEarned() | number }} dặm</span>
            </div>

          </div>

          <!-- Printable Boarding Pass Stub -->
          <div class="card-luxury p-6 sm:p-8 shadow-md border-slate-200 mb-8 bg-white relative print:border-none print:shadow-none" id="ticket-print-area">
            <div class="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div class="flex items-center gap-2">
                <app-icon name="plane" class="w-5 h-5 text-gold" />
                <span class="font-black text-navy text-base">Thẻ Lên Tàu Bay (E-Boarding Pass Stub)</span>
              </div>
              <span class="text-xs font-mono font-bold bg-navy text-gold px-3 py-1 rounded-full">
                {{ booking()?.status }}
              </span>
            </div>

            <!-- Legs Itinerary -->
            <div class="space-y-4 mb-6">
              @for (leg of booking()?.legs; track $index) {
                <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <div class="flex items-center gap-2 text-sm font-bold text-navy">
                      <span class="font-mono text-amber-600 font-black">{{ leg.flight_number }}</span>
                      <span>•</span>
                      <span>{{ leg.origin_iata }}</span>
                      <app-icon name="arrowright" class="w-4 h-4 text-slate-400" />
                      <span>{{ leg.dest_iata }}</span>
                    </div>
                    <div class="text-xs text-slate-500 mt-1">
                      Giờ khởi hành: {{ leg.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}
                    </div>
                  </div>

                  <div class="text-left sm:text-right">
                    <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {{ leg.cabin_class }}
                    </span>
                  </div>
                </div>
              }
            </div>

            <!-- Passengers & Assigned Seats -->
            <div class="border-t border-slate-100 pt-4 mb-6">
              <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3">Danh sách Hành khách & Chỗ ngồi</h4>
              <div class="space-y-2">
                @for (p of booking()?.passengers; track $index) {
                  <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 text-xs">
                    <div>
                      <strong class="text-slate-800 font-bold uppercase">{{ p.last_name }} {{ p.first_name }}</strong>
                      <span class="text-slate-400 block text-[11px]">CCCD/HC: {{ p.id_card_or_passport || 'N/A' }}</span>
                    </div>
                    <div class="text-right">
                      <span class="inline-flex items-center gap-1 font-mono font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        <app-icon name="armchair" class="w-3.5 h-3.5" />
                        Ghế: {{ p.seat_code || 'Chưa gán' }}
                      </span>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Total Amount -->
            <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-sm">
              <span class="text-slate-500 font-medium">Tổng tiền thanh toán:</span>
              <span class="text-xl font-black text-navy">{{ booking()?.total_amount | currencyFormat }}</span>
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
              [queryParams]="{ code: booking()?.pnr_number }"
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
            <h3 class="text-lg font-bold text-navy">Chưa có thông tin đơn đặt vé</h3>
            <p class="text-xs text-slate-500 mt-1">Vui lòng quay về trang chủ để thực hiện tìm kiếm và đặt vé.</p>
            <a routerLink="/" class="btn-gold mt-5 text-xs">Về trang chủ</a>
          </div>
        }

      </div>
    </div>
  `,
})
export class BookingSuccessComponent implements OnInit {
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly booking = signal<Booking | null>(null);
  readonly milesEarned = signal(0);
  BookingStatus = BookingStatus;

  ngOnInit(): void {
    const raw = sessionStorage.getItem('confirmed_booking');
    if (raw) {
      const b: Booking = JSON.parse(raw);
      this.booking.set(b);
      // Accrue approx 1 mile per 5,000 VND
      this.milesEarned.set(Math.max(250, Math.round(b.total_amount / 5000)));
    }
  }

  printTicket(): void {
    window.print();
  }
}
