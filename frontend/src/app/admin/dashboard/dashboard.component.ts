import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Flight } from '../../core/models/flight.model';

/**
 * Dashboard chỉ cần 2 field của booking; khai báo cục bộ để không phụ thuộc
 * shape Booking trong core/models/booking.model.ts (đang được cập nhật nơi khác).
 */
type DashboardBookingStatus = 'BLOCKED' | 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED';

interface DashboardBooking {
  _id?: string;
  status?: DashboardBookingStatus | string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Metrics Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <!-- Flights Count -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.t('admin.dashboard.totalFlights') }}</span>
            <div class="w-9 h-9 rounded-xl bg-navy/10 text-navy flex items-center justify-center">
              <app-icon name="plane" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-navy mt-2">{{ flights().length }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">{{ lang.t('admin.dashboard.allFlightsDb') }}</span>
        </div>

        <!-- Bookings Count -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.t('admin.dashboard.totalBookings') }}</span>
            <div class="w-9 h-9 rounded-xl bg-amber-500/15 text-gold flex items-center justify-center">
              <app-icon name="ticket" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-navy mt-2">{{ bookings().length }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">{{ lang.t('admin.dashboard.allCustomers') }}</span>
        </div>

        <!-- Confirmed Tickets -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.t('admin.dashboard.confirmedTickets') }}</span>
            <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <app-icon name="checkcircle2" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-emerald-600 mt-2">{{ confirmedCount() }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">{{ lang.t('admin.dashboard.paidSuccessfully') }}</span>
        </div>

        <!-- Blocked / Holding Tickets -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.t('admin.dashboard.blockedTickets') }}</span>
            <div class="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <app-icon name="clock" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-amber-600 mt-2">{{ blockedCount() }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">{{ lang.t('admin.dashboard.pendingPayment') }}</span>
        </div>
      </div>

      <!-- Quick Actions Bar -->
      <div class="card-luxury p-5 border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-bold text-navy">{{ lang.t('admin.dashboard.quickActions') }}</h3>
          <p class="text-xs text-slate-500">{{ lang.t('admin.dashboard.quickActionsDesc') }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          @if (auth.isAdmin()) {
            <a routerLink="/admin/commercial-flights" class="btn-gold text-xs !py-2 !px-4 font-bold">
              <app-icon name="planetakeoff" class="w-3.5 h-3.5" />
              <span>{{ lang.t('admin.commercial') }}</span>
            </a>

            <a routerLink="/admin/flights" class="btn-navy text-xs !py-2 !px-4 font-bold">
              <app-icon name="plus" class="w-3.5 h-3.5" />
              <span>{{ lang.t('admin.dashboard.addFlightManual') }}</span>
            </a>
          } @else {
            <a routerLink="/admin/reservation-desk" class="btn-gold text-xs !py-2 !px-4 font-bold">
              <app-icon name="usercheck" class="w-3.5 h-3.5" />
              <span>{{ lang.t('admin.reservationDesk') }}</span>
            </a>

            <a routerLink="/admin/bookings" class="btn-navy text-xs !py-2 !px-4 font-bold">
              <app-icon name="ticket" class="w-3.5 h-3.5" />
              <span>{{ lang.t('admin.bookings') }}</span>
            </a>
          }
        </div>
      </div>

      <!-- Upcoming Flights Table Preview -->
      <div class="card-luxury p-6 border-slate-200 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-bold text-navy flex items-center gap-2">
            <app-icon name="plane" class="w-4 h-4 text-gold" />
            <span>{{ lang.t('admin.dashboard.recentSchedule') }}</span>
            <span class="text-[11px] font-semibold text-slate-400 normal-case">{{ lang.t('admin.dashboard.upcomingFlightsNotice') }}</span>
          </h3>
          @if (auth.isAdmin()) {
            <a routerLink="/admin/flights" class="text-xs font-bold text-navy hover:text-gold transition-colors">
              {{ lang.t('admin.dashboard.viewAll') }} &rarr;
            </a>
          }
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase border-y border-slate-200">
              <tr>
                <th class="py-3 px-4 font-semibold">{{ lang.t('admin.dashboard.flightNumber') }}</th>
                <th class="py-3 px-4 font-semibold">{{ lang.t('admin.dashboard.route') }}</th>
                <th class="py-3 px-4 font-semibold">{{ lang.t('admin.dashboard.departure') }}</th>
                <th class="py-3 px-4 font-semibold">{{ lang.t('admin.dashboard.aircraft') }}</th>
                <th class="py-3 px-4 font-semibold">{{ lang.t('common.status') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              @if (!upcomingFlights().length) {
                <tr>
                  <td colspan="5" class="py-8 px-4 text-center text-slate-400">
                    {{ lang.t('admin.dashboard.noUpcomingFlights') }}
                  </td>
                </tr>
              } @else {
                @for (fl of upcomingFlights(); track fl._id) {
                  <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="py-3 px-4 font-mono font-bold text-navy">{{ fl.flight_number }}</td>
                    <td class="py-3 px-4">
                      <span class="font-bold text-slate-800">{{ fl.origin_iata }}</span>
                      <span class="text-slate-400 mx-1">&rarr;</span>
                      <span class="font-bold text-slate-800">{{ fl.dest_iata }}</span>
                    </td>
                    <td class="py-3 px-4 text-slate-600">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</td>
                    <td class="py-3 px-4 text-slate-500">{{ fl.aircraft?.model_name || lang.t('admin.dashboard.unassignedAircraft') }}</td>
                    <td class="py-3 px-4">
                      <span
                        class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase"
                        [ngClass]="statusBadgeClass(fl.status)"
                        [title]="fl.status"
                      >
                        {{ statusLabel(fl.status) }}
                      </span>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly flights = signal<Flight[]>([]);
  readonly bookings = signal<DashboardBooking[]>([]);

  readonly confirmedCount = signal(0);
  readonly blockedCount = signal(0);

  /**
   * 6 chuyến SẮP khởi hành: chỉ lấy chuyến có scheduled_departure >= hiện tại,
   * sắp xếp TĂNG dần theo giờ khởi hành rồi lấy 6 (trước đây slice(0,6) trên
   * danh sách tăng dần nên hiển thị 6 chuyến cũ nhất, rồi bị sửa thành 6 chuyến
   * xa nhất trong tương lai — cả hai đều sai).
   */
  readonly upcomingFlights = computed(() => {
    const now = Date.now();
    return this.flights()
      .filter((fl) => {
        const departure = new Date(fl.scheduled_departure).getTime();
        return !isNaN(departure) && departure >= now;
      })
      // Tăng dần = chuyến khởi hành SỚM NHẤT trong tương lai lên đầu.
      .sort(
        (a, b) =>
          new Date(a.scheduled_departure).getTime() - new Date(b.scheduled_departure).getTime(),
      )
      .slice(0, 6);
  });

  ngOnInit(): void {
    this.api.getFlights().subscribe({
      next: (fls) => this.flights.set(fls || []),
      error: (err) =>
        this.toast.error(this.describeError(err, this.lang.t('admin.dashboard.loadFlightsError'))),
    });

    this.api.getBookings().subscribe({
      next: (bks) => {
        const list = (bks as unknown as DashboardBooking[]) || [];
        this.bookings.set(list);
        this.confirmedCount.set(list.filter((b) => b.status === 'CONFIRMED').length);
        this.blockedCount.set(list.filter((b) => b.status === 'BLOCKED').length);
      },
      error: (err) =>
        this.toast.error(this.describeError(err, this.lang.t('admin.dashboard.loadBookingsError'))),
    });
  }

  /** Class Tailwind cho badge trạng thái (4 giá trị enum của backend). */
  statusBadgeClass(status?: string): string {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-emerald-100 text-emerald-800';
      case 'DELAYED':
        return 'bg-amber-100 text-amber-800';
      case 'CANCELLED':
        return 'bg-rose-100 text-rose-800';
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  /** Nhãn đa ngôn ngữ cho 4 trạng thái enum của backend (SCHEDULED, DELAYED, CANCELLED, COMPLETED). */
  statusLabel(status?: string): string {
    switch (status) {
      case 'SCHEDULED':
        return this.lang.t('status.scheduled');
      case 'DELAYED':
        return this.lang.t('status.delayed');
      case 'CANCELLED':
        return this.lang.t('status.cancelled');
      case 'COMPLETED':
        return this.lang.t('status.completed');
      default:
        return status || '—';
    }
  }

  /** err.error.message của NestJS có thể là string hoặc mảng lỗi validate. */
  private describeError(err: any, fallback: string): string {
    const raw = err?.error?.message ?? err?.message;
    if (Array.isArray(raw)) return raw.join(', ');
    if (typeof raw === 'string' && raw.trim()) return raw;
    return fallback;
  }
}
