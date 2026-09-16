import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { BookingStatus } from '../../core/models/booking.model';

/*
 * Model Booking trong core/models/booking.model.ts đang được cập nhật ở nơi khác
 * và KHÔNG khớp document thật của backend, nên component này khai báo interface
 * cục bộ đúng theo bookings.schema.ts + populate user_id của GET /api/bookings.
 */
interface AdminBookingUser {
  _id?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface AdminPassenger {
  first_name?: string;
  last_name?: string;
  passenger_type?: string;
  id_card_or_passport?: string;
  nationality?: string;
  date_of_birth?: string;
}

interface AdminTicketCoupon {
  coupon_number?: string;
  passenger_name?: string;
  flight_id?: string;
  flight_number?: string;
  inventory_id?: string;
  cabin_class?: string;
  is_smoking?: boolean;
  fare_paid?: number;
  seat_code?: string;
  leg_type?: string;
  coupon_status?: string;
}

interface AdminPaymentTransaction {
  transaction_type?: string;
  amount?: number;
  card_masked?: string;
  status?: string;
  created_at?: string;
}

interface AdminBooking {
  _id: string;
  pnr_code: string;
  user_id?: AdminBookingUser | string | null;
  booking_type?: string;
  status?: BookingStatus | string;
  blocking_number?: string;
  confirmation_number?: string;
  cancellation_number?: string;
  time_limit_deadline?: string;
  total_amount?: number;
  total_miles_accrued?: number;
  passengers?: AdminPassenger[];
  ticket_coupons?: AdminTicketCoupon[];
  payment_transactions?: AdminPaymentTransaction[];
  created_at?: string;
}

/** Một chặng được gom từ ticket_coupons theo leg_type + flight_number. */
interface AdminItinerary {
  key: string;
  leg_type: string;
  flight_number: string;
  cabin_classes: string[];
  seats: string[];
  coupons: number;
}

@Component({
  selector: 'app-bookings-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, CurrencyFormatPipe, PaginationComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.bookings.title') }}</h1>
          <p class="text-xs text-slate-500">{{ lang.t('admin.bookings.subtitle') }}</p>
        </div>

        @if (auth.isAdmin()) {
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              (click)="runSchedulerJob('run-reminders')"
              [disabled]="!!schedulerJob()"
              class="btn-navy text-xs !py-2 !px-4 font-bold disabled:opacity-50"
              [title]="lang.t('admin.bookings.remindersJobTitle')"
            >
              @if (schedulerJob() === 'run-reminders') {
                <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
              } @else {
                <app-icon name="clock" class="w-3.5 h-3.5" />
              }
              <span>{{ lang.t('admin.bookings.runReminders') }}</span>
            </button>

            <button
              type="button"
              (click)="runSchedulerJob('run-expiry')"
              [disabled]="!!schedulerJob()"
              class="btn-gold text-xs !py-2 !px-4 font-bold disabled:opacity-50"
              [title]="lang.t('admin.bookings.expiryJobTitle')"
            >
              @if (schedulerJob() === 'run-expiry') {
                <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
              } @else {
                <app-icon name="xcircle" class="w-3.5 h-3.5" />
              }
              <span>{{ lang.t('admin.bookings.runExpiry') }}</span>
            </button>
          </div>
        }
      </div>

      <!-- Filters -->
      <div class="card-luxury p-4 border-slate-200 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">{{ lang.t('admin.bookings.statusFilterLabel') }}</label>
          <select
            [(ngModel)]="filterStatus"
            (change)="onFilterStatusChange()"
            class="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
          >
            <option value="">{{ lang.t('admin.bookings.allStatuses') }}</option>
            <option [value]="BookingStatus.CONFIRMED">{{ lang.t('admin.bookings.optConfirmed') }}</option>
            <option [value]="BookingStatus.BLOCKED">{{ lang.t('admin.bookings.optBlocked') }}</option>
            <option [value]="BookingStatus.CANCELLED">{{ lang.t('admin.bookings.optCancelled') }}</option>
            <option [value]="BookingStatus.RESCHEDULED">{{ lang.t('admin.bookings.optRescheduled') }}</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">{{ lang.t('admin.bookings.searchLabel') }}</label>
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearchChange($event)"
            [placeholder]="lang.t('admin.bookings.searchPlaceholder')"
            class="w-48 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none"
          />
        </div>

        <span class="text-[11px] text-slate-400 ml-auto">
          @if (filteredBookings().length) {
            <span class="font-medium text-slate-600">{{ displayedRangeText }}</span> &bull;
          }
          {{ lang.t('admin.bookings.showing') }} {{ filteredBookings().length }}/{{ bookings().length }} {{ lang.t('admin.bookings.orders') }}
        </span>
      </div>

      <!-- Bookings Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.pnrCode') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.ticketHoldCode') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.route') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.customer') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.seats') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.bookings.totalAmount') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('common.status') }}</th>
                <th class="py-3.5 px-4 text-right">{{ lang.t('common.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="8" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.t('admin.bookings.loading') }}
                  </td>
                </tr>
              } @else if (!filteredBookings().length) {
                <tr>
                  <td colspan="8" class="text-center py-10 text-slate-400">
                    @if (bookings().length) {
                      {{ lang.t('admin.bookings.noMatching') }}
                    } @else {
                      {{ lang.t('admin.bookings.noBookings') }}
                    }
                  </td>
                </tr>
              } @else {
                @for (b of pagedBookings(); track b._id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-black text-navy text-sm">
                      {{ b.pnr_code }}
                      @if (b.booking_type) {
                        <span class="block text-[10px] text-slate-400 font-bold">{{ b.booking_type }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 font-mono font-bold text-amber-600">
                      <span class="block">{{ b.confirmation_number || b.blocking_number || '—' }}</span>
                      @if (b.cancellation_number) {
                        <span class="block text-[10px] text-rose-500 font-semibold">{{ lang.t('admin.bookings.cancelledPrefix') }}{{ b.cancellation_number }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4">
                      @if (itineraries(b).length) {
                        @for (leg of itineraries(b); track leg.key) {
                          <span class="block font-bold text-slate-800">
                            {{ leg.flight_number || '—' }}
                            <span class="text-[10px] font-semibold text-slate-400">({{ leg.leg_type }})</span>
                          </span>
                          @if (leg.cabin_classes.length) {
                            <span class="block text-[10px] text-slate-400">{{ leg.cabin_classes.join(', ') }}</span>
                          }
                        }
                      } @else {
                        <span class="text-slate-400">{{ lang.t('admin.bookings.noLegs') }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-slate-700">
                      <strong>{{ passengerCount(b) }} {{ lang.t('admin.bookings.passengersCount') }}</strong>
                      <span class="text-[11px] text-slate-400 block truncate max-w-[180px]" [title]="customerLabel(b)">
                        {{ customerLabel(b) }}
                      </span>
                      @if (userEmail(b)) {
                        <span class="text-[10px] text-slate-400 block truncate max-w-[180px]">{{ userEmail(b) }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 font-mono text-[11px] text-slate-600">{{ seatLabel(b) }}</td>
                    <td class="py-3.5 px-4 font-bold text-navy">
                      {{ b.total_amount | currencyFormat }}
                      @if (refundTotal(b) > 0) {
                        <span class="block text-[10px] text-emerald-600 font-semibold">
                          {{ lang.t('admin.bookings.refundPrefix') }}{{ refundTotal(b) | currencyFormat }}
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border"
                        [ngClass]="statusClass(b.status)"
                      >
                        {{ statusLabel(b.status) }}
                      </span>
                      @if (isBlocked(b) && b.time_limit_deadline) {
                        <span class="block text-[10px] text-amber-600 font-semibold mt-1">
                          {{ lang.t('admin.bookings.deadlinePrefix') }}{{ b.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}
                        </span>
                      }
                      @if (isCancelled(b)) {
                        <span class="block text-[10px] text-rose-500 font-semibold mt-1">{{ lang.t('admin.bookings.ticketCancelledBadge') }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-1.5">
                        @if (isBlocked(b)) {
                          <button
                            type="button"
                            (click)="confirmTicket(b)"
                            [disabled]="submitting()"
                            class="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 transition-colors disabled:opacity-50"
                            [title]="lang.t('admin.bookings.confirmTicketTitle')"
                          >
                            <app-icon name="checkcircle2" class="w-4 h-4" />
                          </button>
                        }

                        @if (canCancel(b)) {
                          <button
                            type="button"
                            (click)="cancelTicket(b)"
                            [disabled]="submitting()"
                            class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 transition-colors disabled:opacity-50"
                            [title]="lang.t('admin.bookings.cancelTicketTitle')"
                          >
                            <app-icon name="xcircle" class="w-4 h-4" />
                          </button>
                        }

                        <button
                          type="button"
                          (click)="viewDetails(b)"
                          class="p-1.5 hover:bg-slate-100 text-navy rounded-lg transition-colors"
                          [title]="lang.t('admin.bookings.viewDetailsTitle')"
                        >
                          <app-icon name="eye" class="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (filteredBookings().length) {
          <app-pagination
            [total]="filteredBookings().length"
            [page]="page"
            [pageSize]="pageSize"
            (pageChange)="page = $event"
            (pageSizeChange)="onPageSize($event)"
          />
        }
      </div>

    </div>

    <!-- Booking Details Modal -->
    @if (selectedBooking(); as sb) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div class="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-6 border border-slate-200 my-auto">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="ticket" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.bookings.detailTitle') }}{{ sb.pnr_code }}</span>
            </h3>
            <button (click)="selectedBooking.set(null)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <div class="space-y-4 text-xs">
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.pnrCode') }}:</span>
                <strong class="font-mono text-navy">{{ sb.pnr_code }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.bookingType') }}</span>
                <span class="font-bold">{{ sb.booking_type || '—' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.confirmHoldCode') }}</span>
                <strong class="font-mono text-amber-600">{{ sb.confirmation_number || sb.blocking_number || '—' }}</strong>
              </div>
              @if (sb.cancellation_number) {
                <div class="flex justify-between">
                  <span class="text-slate-500">{{ lang.t('admin.bookings.cancelCode') }}</span>
                  <strong class="font-mono text-rose-600">{{ sb.cancellation_number }}</strong>
                </div>
              }
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('common.status') }}:</span>
                <span class="font-bold uppercase">{{ statusLabel(sb.status) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.totalAmount') }}:</span>
                <strong class="text-navy font-bold text-sm">{{ sb.total_amount | currencyFormat }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.skyMilesAccrued') }}</span>
                <strong class="text-amber-600">{{ sb.total_miles_accrued || 0 }} {{ lang.t('nav.miles') }}</strong>
              </div>
              @if (isBlocked(sb) && sb.time_limit_deadline) {
                <div class="flex justify-between">
                  <span class="text-slate-500">{{ lang.t('admin.bookings.holdDeadline') }}</span>
                  <strong class="text-amber-700">{{ sb.time_limit_deadline | date: 'dd/MM/yyyy HH:mm' }}</strong>
                </div>
              }
              <div class="flex justify-between">
                <span class="text-slate-500">{{ lang.t('admin.bookings.customerLabel') }}</span>
                <span class="font-semibold">{{ customerLabel(sb) }}</span>
              </div>
            </div>

            @if (isCancelled(sb)) {
              <div class="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-900 space-y-1">
                <div class="font-bold">{{ lang.t('admin.bookings.cancelledNotice') }}{{ sb.cancellation_number ? ' (' + lang.t('admin.bookings.cancelCodeNotice') + sb.cancellation_number + ')' : '' }}</div>
                <div>
                  {{ lang.t('admin.bookings.totalRefundedTrans') }}
                  <strong>{{ refundTotal(sb) | currencyFormat }}</strong>
                </div>
              </div>
            }

            <div>
              <h4 class="font-bold text-navy uppercase text-[11px] mb-2">{{ lang.t('admin.bookings.legsTitle') }}</h4>
              <div class="space-y-2">
                @for (leg of itineraries(sb); track leg.key) {
                  <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200/70">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-slate-800 font-mono">{{ leg.flight_number || '—' }}</span>
                      <span class="text-[10px] font-bold uppercase text-slate-500">{{ leg.leg_type }}</span>
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5">
                      {{ leg.coupons }} {{ lang.t('admin.bookings.couponText') }} • {{ lang.t('admin.bookings.classLabel') }}{{ leg.cabin_classes.join(', ') || '—' }} • {{ lang.t('admin.bookings.seatLabel') }}{{ leg.seats.join(', ') || lang.t('admin.bookings.unassignedSeat') }}
                    </div>
                  </div>
                }
                @if (!itineraries(sb).length) {
                  <div class="text-slate-400">{{ lang.t('admin.bookings.noCoupons') }}</div>
                }
              </div>
            </div>

            <div>
              <h4 class="font-bold text-navy uppercase text-[11px] mb-2">{{ lang.t('admin.bookings.passengersSeats') }}</h4>
              <div class="space-y-1.5">
                @for (p of sb.passengers || []; track $index) {
                  <div class="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                    <div>
                      <span class="font-bold text-slate-800">{{ p.last_name }} {{ p.first_name }}</span>
                      <span class="text-[10px] text-slate-400 block">
                        {{ p.passenger_type || 'ADULT' }} • {{ lang.t('admin.bookings.idPassportPrefix') }}{{ p.id_card_or_passport || 'N/A' }}
                      </span>
                    </div>
                    <span class="font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {{ seatsForPassenger(sb, p) || lang.t('admin.bookings.unassignedSeat') }}
                    </span>
                  </div>
                }
                @if (!(sb.passengers || []).length) {
                  <div class="text-slate-400">{{ lang.t('admin.bookings.noPassengers') }}</div>
                }
              </div>
            </div>

            <div>
              <h4 class="font-bold text-navy uppercase text-[11px] mb-2">{{ lang.t('admin.bookings.paymentTransactions') }}</h4>
              <div class="space-y-1.5">
                @for (t of sb.payment_transactions || []; track $index) {
                  <div class="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                    <div>
                      <span class="font-bold" [ngClass]="transactionClass(t.transaction_type)">{{ t.transaction_type }}</span>
                      <span class="text-[10px] text-slate-400 block">
                        {{ t.card_masked || 'N/A' }} • {{ t.status || 'SUCCESS' }}
                        @if (t.created_at) {
                          <span> • {{ t.created_at | date: 'dd/MM/yyyy HH:mm' }}</span>
                        }
                      </span>
                    </div>
                    <span class="font-mono font-bold text-navy">{{ t.amount | currencyFormat }}</span>
                  </div>
                }
                @if (!(sb.payment_transactions || []).length) {
                  <div class="text-slate-400">{{ lang.t('admin.bookings.noTransactions') }}</div>
                }
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-100">
            @if (isBlocked(sb)) {
              <button
                type="button"
                (click)="confirmTicket(sb)"
                [disabled]="submitting()"
                class="btn-gold text-xs !py-2 !px-5 font-bold disabled:opacity-50"
              >
                <app-icon name="checkcircle2" class="w-3.5 h-3.5" />
                <span>{{ lang.t('admin.bookings.confirmBtn') }}</span>
              </button>
            }
            @if (canCancel(sb)) {
              <button
                type="button"
                (click)="cancelTicket(sb)"
                [disabled]="submitting()"
                class="text-xs !py-2 !px-5 font-bold rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors disabled:opacity-50"
              >
                <app-icon name="xcircle" class="w-3.5 h-3.5" />
                <span>{{ lang.t('admin.bookings.cancelBtn') }}</span>
              </button>
            }
            <button (click)="selectedBooking.set(null)" class="btn-navy text-xs !py-2 !px-5">{{ lang.t('seatmap.closeBtn') }}</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class BookingsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  private readonly baseUrl = '/api';

  readonly bookings = signal<AdminBooking[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly schedulerJob = signal<'run-reminders' | 'run-expiry' | null>(null);

  filterStatus = '';
  readonly searchTerm = signal('');

  readonly selectedBooking = signal<AdminBooking | null>(null);
  BookingStatus = BookingStatus;

  readonly pageSignal = signal(1);
  readonly pageSizeSignal = signal(20);

  get page(): number {
    return this.pageSignal();
  }
  set page(v: number) {
    this.pageSignal.set(v);
  }

  get pageSize(): number {
    return this.pageSizeSignal();
  }
  set pageSize(v: number) {
    this.pageSizeSignal.set(v);
  }

  /** Lọc phía client theo PNR / số xác nhận / số giữ chỗ / số hủy. */
  readonly filteredBookings = computed(() => {
    const term = this.searchTerm().trim().toUpperCase();
    const list = this.bookings();
    if (!term) return list;
    return list.filter((b) =>
      [b.pnr_code, b.confirmation_number, b.blocking_number, b.cancellation_number].some((value) =>
        (value || '').toUpperCase().includes(term),
      ),
    );
  });

  readonly pagedBookings = computed(() => {
    const list = this.filteredBookings();
    const start = (this.pageSignal() - 1) * this.pageSizeSignal();
    return list.slice(start, start + this.pageSizeSignal());
  });

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.page = 1;
  }

  onFilterStatusChange(): void {
    this.page = 1;
    this.loadBookings();
  }

  onPageSize(size: number): void {
    this.pageSize = size;
    const maxPage = Math.max(1, Math.ceil(this.filteredBookings().length / size));
    if (this.page > maxPage) {
      this.page = maxPage;
    }
  }

  get displayedRangeText(): string {
    const total = this.filteredBookings().length;
    if (!total) return '';
    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(total, this.page * this.pageSize);
    return this.lang.isVietnamese()
      ? `Hiển thị ${start}–${end}`
      : `Showing ${start}–${end}`;
  }

  ngOnInit(): void {
    this.loadBookings();
  }

  loadBookings(): void {
    this.loading.set(true);
    this.api
      .getBookings({
        status: (this.filterStatus as BookingStatus) || undefined,
      })
      .subscribe({
        next: (list) => {
          this.bookings.set((list as unknown as AdminBooking[]) || []);
          const maxPage = Math.max(1, Math.ceil(this.filteredBookings().length / this.pageSize));
          if (this.page > maxPage) {
            this.page = maxPage;
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(this.describeError(err, this.lang.t('admin.bookings.loadError')));
        },
      });
  }

  viewDetails(b: AdminBooking): void {
    this.selectedBooking.set(b);
  }

  // ===================== Helpers cho template =====================

  /** Gom ticket_coupons theo leg_type + flight_number (KHÔNG dùng b.legs). */
  itineraries(b: AdminBooking | null): AdminItinerary[] {
    const coupons = b?.ticket_coupons || [];
    if (!coupons.length) return [];

    const groups = new Map<string, AdminItinerary>();
    for (const coupon of coupons) {
      const legType = coupon.leg_type || 'OUTBOUND';
      const flightNumber = coupon.flight_number || '';
      const key = `${legType}|${flightNumber}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          leg_type: legType,
          flight_number: flightNumber,
          cabin_classes: [],
          seats: [],
          coupons: 0,
        };
        groups.set(key, group);
      }
      group.coupons += 1;
      if (coupon.cabin_class && !group.cabin_classes.includes(coupon.cabin_class)) {
        group.cabin_classes.push(coupon.cabin_class);
      }
      if (coupon.seat_code && !group.seats.includes(coupon.seat_code)) {
        group.seats.push(coupon.seat_code);
      }
    }
    return Array.from(groups.values());
  }

  /** Tên khách: ưu tiên user đã populate, sau đó hành khách đầu tiên. */
  customerLabel(b: AdminBooking | null): string {
    const user = b?.user_id;
    if (user && typeof user === 'object') {
      const fullName = `${user.last_name || ''} ${user.first_name || ''}`.trim();
      if (fullName) return fullName;
      if (user.username) return user.username;
    }
    const first = b?.passengers?.[0];
    if (first) {
      const name = `${first.last_name || ''} ${first.first_name || ''}`.trim();
      if (name) return name;
    }
    if (typeof user === 'string' && user) return user;
    return '—';
  }

  userEmail(b: AdminBooking | null): string {
    const user = b?.user_id;
    if (user && typeof user === 'object') return user.email || '';
    return '';
  }

  passengerCount(b: AdminBooking | null): number {
    return (b?.passengers || []).length;
  }

  /** Ghế lấy từ ticket_coupons[].seat_code. */
  seatLabel(b: AdminBooking | null): string {
    const seats = (b?.ticket_coupons || [])
      .map((coupon) => coupon.seat_code)
      .filter((seat): seat is string => !!seat);
    return seats.length ? seats.join(', ') : this.lang.t('admin.bookings.unassignedSeat');
  }

  seatsForPassenger(b: AdminBooking | null, p: AdminPassenger): string {
    const fullName = `${p.last_name || ''} ${p.first_name || ''}`.trim().toUpperCase();
    if (!fullName) return '';
    const seats = (b?.ticket_coupons || [])
      .filter((coupon) => (coupon.passenger_name || '').trim().toUpperCase() === fullName)
      .map((coupon) => coupon.seat_code)
      .filter((seat): seat is string => !!seat);
    return seats.join(', ');
  }

  /** Tiền hoàn = tổng payment_transactions loại REFUND. */
  refundTotal(b: AdminBooking | null): number {
    return (b?.payment_transactions || [])
      .filter((t) => (t.transaction_type || '').toUpperCase() === 'REFUND')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }

  isBlocked(b: AdminBooking | null): boolean {
    return b?.status === BookingStatus.BLOCKED;
  }

  isCancelled(b: AdminBooking | null): boolean {
    return b?.status === BookingStatus.CANCELLED;
  }

  canCancel(b: AdminBooking | null): boolean {
    return (
      b?.status === BookingStatus.BLOCKED ||
      b?.status === BookingStatus.CONFIRMED ||
      b?.status === BookingStatus.RESCHEDULED
    );
  }

  statusClass(status?: string): string {
    switch (status) {
      case BookingStatus.CONFIRMED:
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case BookingStatus.BLOCKED:
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case BookingStatus.CANCELLED:
        return 'bg-rose-100 text-rose-800 border-rose-300';
      case BookingStatus.RESCHEDULED:
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  }

  /** Nhãn đa ngôn ngữ cho trạng thái đặt vé (CONFIRMED, BLOCKED, CANCELLED, RESCHEDULED) */
  statusLabel(status?: string): string {
    switch (status) {
      case BookingStatus.CONFIRMED:
        return this.lang.t('status.confirmed');
      case BookingStatus.BLOCKED:
        return this.lang.t('status.blocked');
      case BookingStatus.CANCELLED:
        return this.lang.t('status.cancelled');
      case BookingStatus.RESCHEDULED:
        return this.lang.t('status.rescheduled');
      default:
        return status || '—';
    }
  }

  transactionClass(type?: string): string {
    switch ((type || '').toUpperCase()) {
      case 'REFUND':
      case 'RESCHEDULE_REFUND':
        return 'text-emerald-600';
      case 'RESCHEDULE_CHARGE':
        return 'text-amber-600';
      default:
        return 'text-navy';
    }
  }

  /** identifier = confirmation_number || blocking_number || pnr_code */
  identifierFor(b: AdminBooking): string {
    return b.confirmation_number || b.blocking_number || b.pnr_code;
  }

  // ===================== Thao tác nhân viên =====================

  confirmTicket(b: AdminBooking): void {
    const blockingNumber = b.blocking_number || b.pnr_code;
    if (!blockingNumber) {
      this.toast.error(this.lang.t('admin.bookings.noHoldCodeToConfirm'));
      return;
    }

    const promptMsg = this.lang.isVietnamese() ? `Nhập số thẻ thanh toán để xác nhận vé ${blockingNumber} (12-19 chữ số):` : `Enter payment card number to confirm ticket ${blockingNumber} (12-19 digits):`;
    const rawCard = prompt(promptMsg, '');
    if (rawCard === null) return;
    const creditCard = rawCard.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(creditCard)) {
      this.toast.error(this.lang.t('admin.bookings.invalidCardNumber'));
      return;
    }

    this.submitting.set(true);
    this.api
      .confirmBooking({ blocking_number: blockingNumber, credit_card_number: creditCard })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          const successMsg = this.lang.isVietnamese() ? `Đã xác nhận vé giữ chỗ ${blockingNumber} thành công!` : `Hold booking ${blockingNumber} confirmed successfully!`;
          this.toast.success(successMsg);
          this.selectedBooking.set(null);
          this.loadBookings();
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(this.describeError(err, this.lang.t('admin.bookings.confirmError')));
        },
      });
  }

  cancelTicket(b: AdminBooking): void {
    const identifier = this.identifierFor(b);
    if (!identifier) {
      this.toast.error(this.lang.t('admin.bookings.noIdentifierToCancel'));
      return;
    }
    const confirmMsg = this.lang.isVietnamese() ? `Bạn có chắc chắn muốn hủy vé ${identifier}?\nHệ thống sẽ giải phóng ghế và hoàn tiền theo chính sách hủy hiện hành.` : `Are you sure you want to cancel ticket ${identifier}?\nThe system will release seats and refund according to current policy.`;
    if (!confirm(confirmMsg)) {
      return;
    }

    this.submitting.set(true);
    this.api.cancelBooking({ identifier }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        const refundAmount = Number(res?.refund_amount ?? 0);
        const refundPercent = res?.refund_percentage;
        let refundText = '';
        if (refundAmount > 0) {
          const formatted = new Intl.NumberFormat(this.lang.isVietnamese() ? 'vi-VN' : 'en-US').format(refundAmount);
          refundText = this.lang.isVietnamese() ? ` Đã hoàn ${formatted} VND${refundPercent !== undefined && refundPercent !== null ? ` (${refundPercent}%)` : ''}.` : ` Refunded ${formatted} VND${refundPercent !== undefined && refundPercent !== null ? ` (${refundPercent}%)` : ''}.`;
        }
        const successMsg = this.lang.isVietnamese() ? `Đã hủy vé ${identifier}.${refundText}` : `Ticket ${identifier} cancelled.${refundText}`;
        this.toast.success(successMsg);
        this.selectedBooking.set(null);
        this.loadBookings();
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(this.describeError(err, this.lang.t('admin.bookings.cancelError')));
      },
    });
  }

  /** Gọi trực tiếp endpoint scheduler (ApiService chưa có wrapper). */
  runSchedulerJob(job: 'run-reminders' | 'run-expiry'): void {
    if (this.schedulerJob()) return;
    this.schedulerJob.set(job);
    this.http.post<{ message?: string }>(`${this.baseUrl}/bookings/scheduler/${job}`, {}).subscribe({
      next: (res) => {
        this.schedulerJob.set(null);
        this.toast.success(res?.message || this.lang.t('admin.bookings.schedulerSuccess'));
        this.loadBookings();
      },
      error: (err) => {
        this.schedulerJob.set(null);
        this.toast.error(this.describeError(err, this.lang.t('admin.bookings.schedulerError')));
      },
    });
  }

  /** err.error.message của NestJS có thể là string hoặc mảng lỗi validate. */
  private describeError(err: any, fallback: string): string {
    const raw = err?.error?.message ?? err?.message;
    if (Array.isArray(raw)) return raw.join(', ');
    if (typeof raw === 'string' && raw.trim()) return raw;
    return fallback;
  }
}
