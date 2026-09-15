import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { Booking, BookingStatus } from '../../core/models/booking.model';
import { Flight } from '../../core/models/flight.model';

@Component({
  selector: 'app-track-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent, CurrencyFormatPipe],
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
            Tra cứu thông tin vé máy bay, kiểm tra tình trạng chuyến bay thời gian thực, đổi lịch trình hoặc yêu cầu hoàn hủy vé.
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

        <!-- Results Display -->
        @if (booking()) {
          <div class="space-y-6 animate-fade-in">
            
            <!-- EMERGENCY DELAY / CANCEL WEATHER ALERT (Highlight cam/đỏ theo yêu cầu) -->
            @if (booking()?.delay_or_cancellation_info?.is_affected) {
              <div class="p-5 rounded-3xl border shadow-lg animate-pulse"
                [ngClass]="booking()?.delay_or_cancellation_info?.flight_status === 'CANCELLED' ? 'bg-red-50 border-red-300 text-red-950' : 'bg-amber-50 border-amber-300 text-amber-950'"
              >
                <div class="flex items-start gap-3">
                  <div class="p-2 rounded-full shrink-0"
                    [ngClass]="booking()?.delay_or_cancellation_info?.flight_status === 'CANCELLED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'"
                  >
                    <app-icon name="alerttriangle" class="w-6 h-6" />
                  </div>
                  <div>
                    <h3 class="text-sm sm:text-base font-black uppercase tracking-wide">
                      {{ lang.t('track.weatherAlert') }} CHUYẾN BAY {{ booking()?.delay_or_cancellation_info?.flight_status === 'CANCELLED' ? 'ĐÃ BỊ HỦY' : 'BỊ HOÃN CHUYẾN' }}
                    </h3>
                    <p class="text-xs sm:text-sm mt-1 leading-relaxed font-semibold">
                      {{ booking()?.delay_or_cancellation_info?.message }}
                    </p>
                    @if (booking()?.delay_or_cancellation_info?.delay_reason) {
                      <div class="mt-2 text-xs bg-white/80 p-2.5 rounded-xl border border-amber-200">
                        <strong>Lý do từ hãng hàng không:</strong> {{ booking()?.delay_or_cancellation_info?.delay_reason }}
                      </div>
                    }
                  </div>
                </div>
              </div>
            }

            <!-- Ticket Card -->
            <div class="card-luxury p-6 sm:p-8 shadow-xl border-slate-200">
              
              <!-- Ticket Header -->
              <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
                <div>
                  <div class="text-xs text-slate-400 font-semibold uppercase tracking-wider">Mã đặt chỗ (PNR)</div>
                  <div class="text-2xl font-black font-mono text-navy tracking-wider">
                    {{ booking()?.pnr_number }}
                  </div>
                  <div class="text-xs text-slate-500 mt-0.5">
                    Mã số vé: <strong class="font-mono text-amber-600">{{ booking()?.confirmation_number || booking()?.blocking_number }}</strong>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <span
                    class="badge-status"
                    [ngClass]="{
                      'bg-emerald-100 text-emerald-800 border border-emerald-300': booking()?.status === BookingStatus.CONFIRMED,
                      'bg-amber-100 text-amber-800 border border-amber-300': booking()?.status === BookingStatus.BLOCKED,
                      'bg-rose-100 text-rose-800 border border-rose-300': booking()?.status === BookingStatus.CANCELLED,
                      'bg-blue-100 text-blue-800 border border-blue-300': booking()?.status === BookingStatus.RESCHEDULED
                    }"
                  >
                    {{ booking()?.status }}
                  </span>
                </div>
              </div>

              <!-- Flight Legs Timeline -->
              <div class="space-y-4 mb-6">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-2">Hành trình chuyến bay</h4>
                @for (leg of booking()?.legs; track $index) {
                  <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div class="flex items-center gap-4">
                      <div class="w-10 h-10 rounded-xl bg-navy text-gold flex items-center justify-center font-mono font-bold text-xs">
                        {{ leg.origin_iata }}
                      </div>
                      <div>
                        <div class="text-sm font-black text-navy flex items-center gap-2">
                          <span class="text-amber-600 font-mono">{{ leg.flight_number }}</span>
                          <span>•</span>
                          <span>{{ leg.origin_iata }}</span>
                          <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                          <span>{{ leg.dest_iata }}</span>
                        </div>
                        <div class="text-xs text-slate-500 mt-1">
                          Khởi hành: <strong>{{ leg.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      <span class="text-xs font-semibold px-3 py-1 rounded-full bg-slate-200 text-slate-700">
                        Hạng {{ leg.cabin_class }}
                      </span>
                    </div>
                  </div>
                }
              </div>

              <!-- Passengers and Seats -->
              <div class="border-t border-slate-100 pt-5 mb-6">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3">Danh sách hành khách</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  @for (p of booking()?.passengers; track $index) {
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between text-xs">
                      <div>
                        <div class="font-bold text-slate-800 uppercase">{{ p.last_name }} {{ p.first_name }}</div>
                        <span class="text-slate-400 text-[11px]">{{ p.passenger_type }} • {{ p.id_card_or_passport || 'N/A' }}</span>
                      </div>
                      <span class="font-mono font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        {{ p.seat_code || 'Chưa chọn' }}
                      </span>
                    </div>
                  }
                </div>
              </div>

              <!-- Payment Summary -->
              <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-xs text-slate-600">
                <span>Tổng giá trị đơn vé:</span>
                <span class="text-lg font-black text-navy">{{ booking()?.total_amount | currencyFormat }}</span>
              </div>

              <!-- ACTION BUTTONS: Reschedule, Cancel, Confirm Hold -->
              <div class="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-end gap-3">
                <!-- If Blocked: Confirm Payment -->
                @if (booking()?.status === BookingStatus.BLOCKED) {
                  <button
                    type="button"
                    (click)="showConfirmHoldModal.set(true)"
                    class="btn-gold text-xs !py-2.5 !px-5"
                  >
                    <app-icon name="creditcard" class="w-4 h-4" />
                    <span>{{ lang.t('track.payHoldBtn') }}</span>
                  </button>
                }

                <!-- If Confirmed: Reschedule -->
                @if (booking()?.status === BookingStatus.CONFIRMED) {
                  <button
                    type="button"
                    (click)="openRescheduleModal()"
                    class="btn-outline-navy text-xs !py-2.5 !px-5"
                  >
                    <app-icon name="calendar" class="w-4 h-4 text-navy" />
                    <span>{{ lang.t('track.rescheduleBtn') }}</span>
                  </button>
                }

                <!-- If not already Cancelled: Cancel Ticket -->
                @if (booking()?.status !== BookingStatus.CANCELLED) {
                  <button
                    type="button"
                    (click)="openCancelModal()"
                    class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                  >
                    <app-icon name="xcircle" class="w-4 h-4" />
                    <span>{{ lang.t('track.cancelBtn') }}</span>
                  </button>
                }
              </div>

            </div>
          </div>
        }

      </div>
    </div>

    <!-- Modal 1: Confirm Hold Ticket (Thanh toán vé giữ chỗ) -->
    @if (showConfirmHoldModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="creditcard" class="w-5 h-5 text-gold" />
              <span>Thanh toán vé giữ chỗ</span>
            </h3>
            <button (click)="showConfirmHoldModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <p class="text-xs text-slate-500 mb-4 leading-relaxed">
            Nhập thẻ tín dụng để chuyển đổi mã vé giữ chỗ <strong>{{ booking()?.blocking_number }}</strong> thành vé máy bay chính thức.
          </p>

          <div class="space-y-3 text-xs mb-5">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Số thẻ tín dụng (16 số)</label>
              <input
                type="text"
                [(ngModel)]="confirmCardNumber"
                placeholder="4111222233334444"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold font-mono"
              />
            </div>
            <div class="text-right text-xs">
              <span class="text-slate-500">Số tiền cần thanh toán: </span>
              <strong class="text-navy font-bold">{{ booking()?.total_amount | currencyFormat }}</strong>
            </div>
          </div>

          <div class="flex justify-end gap-3">
            <button (click)="showConfirmHoldModal.set(false)" class="btn-ghost text-xs">Hủy</button>
            <button
              [disabled]="submittingAction()"
              (click)="executeConfirmHold()"
              class="btn-gold text-xs !py-2.5 !px-5"
            >
              @if (submittingAction()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>Xác nhận thanh toán</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal 2: Reschedule Modal (Đổi chuyến bay) -->
    @if (showRescheduleModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="calendar" class="w-5 h-5 text-gold" />
              <span>Đổi chuyến bay (Reschedule)</span>
            </h3>
            <button (click)="showRescheduleModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <p class="text-xs text-slate-500 mb-4">
            Chọn chuyến bay thay thế khả dụng trên cùng chặng bay cho mã xác nhận <strong>{{ booking()?.confirmation_number }}</strong>.
          </p>

          <div class="space-y-2 max-h-60 overflow-y-auto mb-4">
            @for (fl of availableAlternativeFlights(); track fl._id) {
              <button
                type="button"
                (click)="selectedNewFlightId.set(fl._id); selectedNewInventoryId.set(fl.inventories[0]?._id || '')"
                [class.border-gold]="selectedNewFlightId() === fl._id"
                [class.bg-amber-50]="selectedNewFlightId() === fl._id"
                class="w-full p-3 text-left rounded-xl border border-slate-200 hover:border-gold transition-all flex items-center justify-between text-xs"
              >
                <div>
                  <strong class="font-mono font-bold text-navy">{{ fl.flight_number }}</strong>
                  <span class="text-slate-500 ml-2">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                </div>
                <div class="text-right">
                  <span class="text-amber-600 font-bold font-mono">{{ fl.inventories[0]?.base_price | currencyFormat }}</span>
                </div>
              </button>
            }
          </div>

          <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button (click)="showRescheduleModal.set(false)" class="btn-ghost text-xs">Đóng</button>
            <button
              [disabled]="!selectedNewFlightId() || submittingAction()"
              (click)="executeReschedule()"
              class="btn-navy text-xs !py-2.5 !px-5"
            >
              @if (submittingAction()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>Xác nhận đổi chuyến</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal 3: Cancel Ticket Modal (Hủy vé & Tính % hoàn tiền) -->
    @if (showCancelModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-rose-600 flex items-center gap-2">
              <app-icon name="alerttriangle" class="w-5 h-5 text-rose-600" />
              <span>Xác nhận Yêu cầu Hủy vé</span>
            </h3>
            <button (click)="showCancelModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Refund Calculation Preview -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 mb-4 space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500">Mã vé:</span>
              <strong class="font-mono text-navy">{{ booking()?.confirmation_number || booking()?.blocking_number }}</strong>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-500">Tổng tiền vé đã trả:</span>
              <span>{{ booking()?.total_amount | currencyFormat }}</span>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-slate-200">
              <span class="text-slate-500">{{ lang.t('track.cancelPolicyInfo') }}</span>
              <span class="font-bold text-amber-600">{{ estimatedRefundPercent() }}% hoàn tiền</span>
            </div>
            <div class="flex items-center justify-between text-sm font-bold pt-1">
              <span class="text-slate-700">{{ lang.t('track.refundEstimate') }}</span>
              <span class="text-emerald-600">{{ estimatedRefundAmount() | currencyFormat }}</span>
            </div>
          </div>

          <div class="mb-5 text-xs">
            <label class="block font-semibold text-slate-600 mb-1">Lý do hủy vé</label>
            <textarea
              [(ngModel)]="cancelReason"
              rows="3"
              placeholder="{{ lang.t('track.reasonPlaceholder') }}"
              class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400"
            ></textarea>
          </div>

          <div class="flex justify-end gap-3">
            <button (click)="showCancelModal.set(false)" class="btn-ghost text-xs">Không hủy</button>
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
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  searchCode = '';
  readonly loading = signal(false);
  readonly booking = signal<Booking | null>(null);
  readonly submittingAction = signal(false);

  BookingStatus = BookingStatus;

  // Modals
  readonly showConfirmHoldModal = signal(false);
  readonly showRescheduleModal = signal(false);
  readonly showCancelModal = signal(false);

  confirmCardNumber = '4111222233334444';
  cancelReason = 'Kế hoạch cá nhân thay đổi';

  // Reschedule alternatives
  readonly availableAlternativeFlights = signal<Flight[]>([]);
  readonly selectedNewFlightId = signal('');
  readonly selectedNewInventoryId = signal('');

  // Refund estimates
  readonly estimatedRefundPercent = signal(75);
  readonly estimatedRefundAmount = signal(0);

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const code = params['code'];
      if (code) {
        this.searchCode = code;
        this.handleSearch();
      }
    });
  }

  handleSearch(): void {
    if (!this.searchCode) {
      this.toast.warning('Vui lòng nhập mã PNR hoặc mã vé cần tra cứu');
      return;
    }

    this.loading.set(true);
    this.api.trackBooking(this.searchCode.trim()).subscribe({
      next: (b) => {
        this.booking.set(b);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || 'Không tìm thấy vé tương ứng với mã cung cấp.');
      },
    });
  }

  executeConfirmHold(): void {
    const b = this.booking();
    if (!b?.blocking_number) return;

    this.submittingAction.set(true);
    this.api
      .confirmBooking({
        blocking_number: b.blocking_number,
        credit_card_number: this.confirmCardNumber,
      })
      .subscribe({
        next: (updated) => {
          this.submittingAction.set(false);
          this.booking.set(updated);
          this.showConfirmHoldModal.set(false);
          this.toast.success('Thanh toán giữ chỗ thành công! Vé đã được xác nhận.');
        },
        error: (err) => {
          this.submittingAction.set(false);
          this.toast.error(err.error?.message || 'Thanh toán giữ chỗ không thành công.');
        },
      });
  }

  openRescheduleModal(): void {
    const b = this.booking();
    if (!b?.legs?.[0]) return;

    this.showRescheduleModal.set(true);
    // Fetch alternative flights on same route
    const firstLeg = b.legs[0];
    this.api
      .getFlights({ origin: firstLeg.origin_iata, dest: firstLeg.dest_iata })
      .subscribe({
        next: (flights) => {
          this.availableAlternativeFlights.set(
            flights.filter((f) => f._id !== firstLeg.flight_id),
          );
        },
      });
  }

  executeReschedule(): void {
    const b = this.booking();
    if (!b?.confirmation_number || !this.selectedNewFlightId()) return;

    this.submittingAction.set(true);
    this.api
      .rescheduleBooking({
        confirmation_number: b.confirmation_number,
        new_flight_id: this.selectedNewFlightId(),
        new_inventory_id: this.selectedNewInventoryId(),
      })
      .subscribe({
        next: (updated) => {
          this.submittingAction.set(false);
          this.booking.set(updated);
          this.showRescheduleModal.set(false);
          this.toast.success('Đổi chuyến bay thành công!');
        },
        error: (err) => {
          this.submittingAction.set(false);
          this.toast.error(err.error?.message || 'Đổi chuyến bay thất bại.');
        },
      });
  }

  openCancelModal(): void {
    const b = this.booking();
    if (!b) return;

    // Calculate approximate days before flight
    const depTime = b.legs?.[0]?.scheduled_departure;
    let days = 15;
    if (depTime) {
      days = Math.max(0, Math.ceil((new Date(depTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    let pct = 0;
    if (days >= 30) pct = 90;
    else if (days >= 15) pct = 75;
    else if (days >= 7) pct = 50;
    else pct = 0;

    this.estimatedRefundPercent.set(pct);
    this.estimatedRefundAmount.set(Math.round((b.total_amount * pct) / 100));
    this.showCancelModal.set(true);
  }

  executeCancel(): void {
    const b = this.booking();
    if (!b) return;

    const identifier = b.confirmation_number || b.blocking_number || b.pnr_number;
    this.submittingAction.set(true);

    this.api
      .cancelBooking({
        identifier,
        reason: this.cancelReason,
      })
      .subscribe({
        next: (res) => {
          this.submittingAction.set(false);
          this.booking.set(res.booking);
          this.showCancelModal.set(false);
          this.toast.success(
            `Hủy vé thành công! Đã xử lý hoàn ${res.refund_percentage}% (${new Intl.NumberFormat('vi-VN').format(res.refund_amount)} VND)`,
          );
        },
        error: (err) => {
          this.submittingAction.set(false);
          this.toast.error(err.error?.message || 'Hủy vé không thành công.');
        },
      });
  }
}
