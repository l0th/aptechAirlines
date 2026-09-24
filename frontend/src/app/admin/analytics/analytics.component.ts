import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="space-y-8 pb-12">
      <!-- Page Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-navy text-gold text-xs font-bold mb-2 border border-gold/30">
            <app-icon name="chartbar" class="w-3.5 h-3.5 text-gold" />
            <span>{{ lang.isVietnamese() ? 'Hệ Thống Phân Tích Dữ Liệu Chuyên Sâu' : 'Executive Business Analytics' }}</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-navy tracking-tight">
            {{ lang.isVietnamese() ? 'Phân Tích Xu Hướng & Hiệu Suất Tải Bay' : 'Travel Patterns & Capacity Analytics' }}
          </h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">
            {{ lang.isVietnamese() ? 'Theo dõi hành vi đặt vé hành khách (Mục 1.2.3) và tối ưu hóa tỷ lệ lấp đầy ghế trống (Mục 1.2.4.2).' : 'Track customer travel trends (Req 1.2.3) and optimize flight seat capacity utilization (Req 1.2.4.2).' }}
          </p>
        </div>

        <button
          type="button"
          (click)="loadAllData()"
          [disabled]="loading()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold self-start sm:self-auto rounded-full shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 inline-flex items-center gap-2"
        >
          <app-icon name="refreshcw" class="w-4 h-4" [class.animate-spin]="loading()" />
          <span>{{ lang.isVietnamese() ? 'Làm mới dữ liệu' : 'Refresh Metrics' }}</span>
        </button>
      </div>

      <!-- Loading State -->
      @if (loading() && !overviewData()) {
        <div class="card-luxury p-12 text-center border-slate-200">
          <div class="w-12 h-12 rounded-full border-4 border-gold border-t-transparent animate-spin mx-auto mb-4"></div>
          <p class="text-sm font-bold text-navy">{{ lang.isVietnamese() ? 'Đang trích xuất dữ liệu tổng hợp...' : 'Aggregating operational data...' }}</p>
        </div>
      } @else {
        <!-- Top Metrics Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <!-- Net Revenue -->
          <div class="card-luxury p-5 border-slate-200">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.isVietnamese() ? 'Doanh Thu Thực Thu' : 'Net Revenue' }}</span>
              <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <app-icon name="creditcard" class="w-5 h-5" />
              </div>
            </div>
            <div class="text-2xl font-black text-navy mt-2 font-mono">
              {{ (overviewData()?.net_revenue_vnd || 0) | number }} <span class="text-xs font-bold text-slate-400">VND</span>
            </div>
            <span class="text-[11px] text-emerald-600 font-semibold mt-1 block">
              {{ lang.isVietnamese() ? 'Tổng thanh toán trừ hoàn tiền' : 'Payments net of refunds' }}
            </span>
          </div>

          <!-- Total Bookings -->
          <div class="card-luxury p-5 border-slate-200">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.isVietnamese() ? 'Tổng Lượng Đơn Đặt' : 'Total Bookings' }}</span>
              <div class="w-9 h-9 rounded-xl bg-navy/10 text-navy flex items-center justify-center">
                <app-icon name="ticket" class="w-5 h-5" />
              </div>
            </div>
            <div class="text-2xl font-black text-navy mt-2 font-mono">
              {{ overviewData()?.total_bookings || 0 }}
            </div>
            <div class="flex items-center gap-3 text-[11px] text-slate-500 font-medium mt-1">
              <span>{{ overviewData()?.status_breakdown?.confirmed || 0 }} CNF</span>
              <span>&bull;</span>
              <span>{{ overviewData()?.status_breakdown?.blocked || 0 }} BLK</span>
            </div>
          </div>

          <!-- Overall Load Factor -->
          <div class="card-luxury p-5 border-slate-200">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.isVietnamese() ? 'Hiệu Suất Tải Ghế (Load Factor)' : 'Fleet Load Factor' }}</span>
              <div class="w-9 h-9 rounded-xl bg-amber-500/15 text-gold flex items-center justify-center">
                <app-icon name="plane" class="w-5 h-5" />
              </div>
            </div>
            <div class="text-2xl font-black text-navy mt-2 font-mono">
              {{ capacityData()?.overall_load_factor_percent || 0 }}%
            </div>
            <span class="text-[11px] text-slate-500 font-medium mt-1 block">
              {{ capacityData()?.total_confirmed_occupied_seats || 0 }} / {{ capacityData()?.total_seat_capacity || 0 }} {{ lang.isVietnamese() ? 'ghế được lấp đầy' : 'seats occupied' }}
            </span>
          </div>

          <!-- Repeat Customer Rate -->
          <div class="card-luxury p-5 border-slate-200">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">{{ lang.isVietnamese() ? 'Khách Hàng Quay Lại' : 'Repeat Customers' }}</span>
              <div class="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <app-icon name="users" class="w-5 h-5" />
              </div>
            </div>
            <div class="text-2xl font-black text-navy mt-2 font-mono">
              {{ overviewData()?.repeat_customer_stats?.repeat_customer_rate_percent || 0 }}%
            </div>
            <span class="text-[11px] text-slate-500 font-medium mt-1 block">
              {{ overviewData()?.repeat_customer_stats?.repeat_customers || 0 }} {{ lang.isVietnamese() ? 'khách đặt từ 2 lần trở lên' : 'customers with >1 booking' }}
            </span>
          </div>
        </div>

        <!-- Section 1: Travel Patterns & Route Demand (Req 1.2.3) -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Top Booked Routes Table (2 Columns) -->
          <div class="lg:col-span-2 card-luxury p-6 border-slate-200 shadow-sm">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-navy flex items-center gap-2">
                <app-icon name="map" class="w-4 h-4 text-gold" />
                <span>{{ lang.isVietnamese() ? 'Chặng Bay Được Đặt Nhiều Nhất (Xu Hướng Nhu Cầu)' : 'Most Booked Routes (Demand Patterns)' }}</span>
              </h3>
              <span class="text-xs text-slate-400 font-medium">{{ lang.isVietnamese() ? 'Top 10 chặng dẫn đầu' : 'Top 10 Routes' }}</span>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500 uppercase border-y border-slate-200 font-semibold">
                  <tr>
                    <th class="py-3 px-4">{{ lang.isVietnamese() ? 'Chặng bay' : 'Route' }}</th>
                    <th class="py-3 px-4 text-center">{{ lang.isVietnamese() ? 'Số đơn đặt' : 'Bookings' }}</th>
                    <th class="py-3 px-4 text-center">{{ lang.isVietnamese() ? 'Lượng khách' : 'Passengers' }}</th>
                    <th class="py-3 px-4 text-right">{{ lang.isVietnamese() ? 'Giá trị đặt vé' : 'Active Booking Value' }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 font-medium">
                  @if (!overviewData()?.top_routes?.length) {
                    <tr>
                      <td colspan="4" class="py-8 text-center text-slate-400">
                        {{ lang.isVietnamese() ? 'Chưa ghi nhận dữ liệu chặng bay' : 'No route booking data recorded yet.' }}
                      </td>
                    </tr>
                  } @else {
                    @for (r of overviewData()?.top_routes; track r.route) {
                      <tr class="hover:bg-slate-50/80 transition-colors">
                        <td class="py-3 px-4 font-bold text-navy flex items-center gap-2">
                          <span class="px-2 py-0.5 rounded bg-navy/10 text-navy font-mono text-[11px]">{{ r.origin_iata }}</span>
                          <span class="text-slate-400">&rarr;</span>
                          <span class="px-2 py-0.5 rounded bg-gold/20 text-navy font-mono text-[11px]">{{ r.dest_iata }}</span>
                        </td>
                        <td class="py-3 px-4 text-center font-mono font-bold text-slate-700">{{ r.bookings_count }}</td>
                        <td class="py-3 px-4 text-center font-mono text-emerald-600 font-bold">{{ r.passenger_volume }}</td>
                        <td class="py-3 px-4 text-right font-mono font-bold text-navy">{{ (r.active_booking_value_vnd || 0) | number }} VND</td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Customer Preferences & Demographics (1 Column) -->
          <div class="space-y-6">
            <!-- Cabin Preference Card -->
            <div class="card-luxury p-5 border-slate-200">
              <h3 class="text-sm font-bold text-navy flex items-center gap-2 mb-4">
                <app-icon name="armchair" class="w-4 h-4 text-gold" />
                <span>{{ lang.isVietnamese() ? 'Sở Thích Hạng Vé' : 'Cabin Class Preferences' }}</span>
              </h3>
              <div class="space-y-3 text-xs">
                <div>
                  <div class="flex justify-between font-semibold mb-1">
                    <span class="text-slate-600">Economy (Phổ thông)</span>
                    <span class="font-mono text-navy font-bold">{{ overviewData()?.cabin_preferences?.economy || 0 }}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      class="bg-navy h-2 rounded-full"
                      [style.width.%]="getCabinPercentage(overviewData()?.cabin_preferences?.economy)"
                    ></div>
                  </div>
                </div>

                <div>
                  <div class="flex justify-between font-semibold mb-1">
                    <span class="text-slate-600">Business (Thương gia)</span>
                    <span class="font-mono text-gold font-bold">{{ overviewData()?.cabin_preferences?.business || 0 }}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      class="bg-gold h-2 rounded-full"
                      [style.width.%]="getCabinPercentage(overviewData()?.cabin_preferences?.business)"
                    ></div>
                  </div>
                </div>

                <div>
                  <div class="flex justify-between font-semibold mb-1">
                    <span class="text-slate-600">First Class (Hạng nhất)</span>
                    <span class="font-mono text-amber-600 font-bold">{{ overviewData()?.cabin_preferences?.first || 0 }}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      class="bg-amber-600 h-2 rounded-full"
                      [style.width.%]="getCabinPercentage(overviewData()?.cabin_preferences?.first)"
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Booking Demographics & Lead Time -->
            <div class="card-luxury p-5 border-slate-200">
              <h3 class="text-sm font-bold text-navy flex items-center gap-2 mb-3">
                <app-icon name="clock" class="w-4 h-4 text-gold" />
                <span>{{ lang.isVietnamese() ? 'Thời Gian Đặt Trước & Cơ Cấu' : 'Lead Time & Demographics' }}</span>
              </h3>
              <div class="divide-y divide-slate-100 text-xs">
                <div class="py-2.5 flex justify-between items-center">
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Thời gian đặt trước trung bình' : 'Avg. Booking Advance' }}</span>
                  <span class="font-mono font-bold text-navy text-sm">{{ overviewData()?.average_lead_time_days || 0 }} {{ lang.isVietnamese() ? 'ngày' : 'days' }}</span>
                </div>
                <div class="py-2.5 flex justify-between items-center">
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Người lớn (Adults)' : 'Adult Passengers' }}</span>
                  <span class="font-mono font-bold text-slate-700">{{ overviewData()?.passenger_demographics?.adults || 0 }}</span>
                </div>
                <div class="py-2.5 flex justify-between items-center">
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Trẻ em (Children)' : 'Child Passengers' }}</span>
                  <span class="font-mono font-bold text-slate-700">{{ overviewData()?.passenger_demographics?.children || 0 }}</span>
                </div>
                <div class="py-2.5 flex justify-between items-center">
                  <span class="text-slate-500">{{ lang.isVietnamese() ? 'Người cao tuổi (Seniors)' : 'Senior Passengers' }}</span>
                  <span class="font-mono font-bold text-slate-700">{{ overviewData()?.passenger_demographics?.seniors || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 2: Capacity Utilization & Minimizing Vacant Seats (Req 1.2.4.2) -->
        <div class="space-y-6 pt-4 border-t border-slate-200">
          <div>
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-700 text-xs font-bold mb-1 border border-amber-200">
              <app-icon name="armchair" class="w-3.5 h-3.5 text-gold" />
              <span>{{ lang.isVietnamese() ? 'Quy chuẩn 1.2.4.2: Tối Đa Hóa Công Suất Ghế' : 'Requirement 1.2.4.2: Capacity Utilization' }}</span>
            </div>
            <h2 class="text-xl font-bold text-navy">
              {{ lang.isVietnamese() ? 'Tình Trạng Ghế Trống & Tỷ Lệ Lấp Đầy Chuyến Bay' : 'Seat Vacancy & Flight Load Performance' }}
            </h2>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- High-Load Flights (Priority monitoring) -->
            <div class="card-luxury p-6 border-slate-200 shadow-sm">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-bold text-navy flex items-center gap-2">
                  <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                  <span>{{ lang.isVietnamese() ? 'Chuyến Bay Tải Cao (Sắp Kín Ghế)' : 'High-Load Flights (High Occupancy)' }}</span>
                </h3>
                <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {{ capacityData()?.high_load_flights?.length || 0 }} {{ lang.isVietnamese() ? 'chuyến' : 'flights' }}
                </span>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500 uppercase border-y border-slate-200 font-semibold">
                    <tr>
                      <th class="py-2.5 px-3">{{ lang.isVietnamese() ? 'Số hiệu' : 'Flight' }}</th>
                      <th class="py-2.5 px-3">{{ lang.isVietnamese() ? 'Chặng' : 'Route' }}</th>
                      <th class="py-2.5 px-3 text-center">{{ lang.isVietnamese() ? 'Đã đặt' : 'Booked' }}</th>
                      <th class="py-2.5 px-3 text-right">{{ lang.isVietnamese() ? 'Tải (%)' : 'Load %' }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 font-medium">
                    @if (!capacityData()?.high_load_flights?.length) {
                      <tr>
                        <td colspan="4" class="py-6 text-center text-slate-400">
                          {{ lang.isVietnamese() ? 'Không có chuyến bay sắp đầy ghế.' : 'No high-load flights recorded.' }}
                        </td>
                      </tr>
                    } @else {
                      @for (f of capacityData()?.high_load_flights; track f.flight_id) {
                        <tr class="hover:bg-slate-50 transition-colors">
                          <td class="py-2.5 px-3 font-mono font-bold text-navy">{{ f.flight_number }}</td>
                          <td class="py-2.5 px-3 font-semibold text-slate-700">{{ f.route }}</td>
                          <td class="py-2.5 px-3 text-center font-mono">{{ f.occupied_seats }} / {{ f.total_capacity }}</td>
                          <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                            {{ f.load_factor_percent }}%
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Low-Load Flights (Marketing / Dynamic Pricing Opportunity) -->
            <div class="card-luxury p-6 border-slate-200 shadow-sm">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-bold text-navy flex items-center gap-2">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-amber-500" />
                  <span>{{ lang.isVietnamese() ? 'Chuyến Bay Tải Thấp (Cần Kích Cầu)' : 'Low-Load Flights (Vacant Seats Alert)' }}</span>
                </h3>
                <span class="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  {{ capacityData()?.low_load_flights?.length || 0 }} {{ lang.isVietnamese() ? 'chuyến' : 'flights' }}
                </span>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 text-slate-500 uppercase border-y border-slate-200 font-semibold">
                    <tr>
                      <th class="py-2.5 px-3">{{ lang.isVietnamese() ? 'Số hiệu' : 'Flight' }}</th>
                      <th class="py-2.5 px-3">{{ lang.isVietnamese() ? 'Chặng' : 'Route' }}</th>
                      <th class="py-2.5 px-3 text-center">{{ lang.isVietnamese() ? 'Đã đặt' : 'Booked' }}</th>
                      <th class="py-2.5 px-3 text-right">{{ lang.isVietnamese() ? 'Tải (%)' : 'Load %' }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 font-medium">
                    @if (!capacityData()?.low_load_flights?.length) {
                      <tr>
                        <td colspan="4" class="py-6 text-center text-slate-400">
                          {{ lang.isVietnamese() ? 'Không có chuyến bay tải thấp.' : 'No low-load flights recorded.' }}
                        </td>
                      </tr>
                    } @else {
                      @for (f of capacityData()?.low_load_flights; track f.flight_id) {
                        <tr class="hover:bg-slate-50 transition-colors">
                          <td class="py-2.5 px-3 font-mono font-bold text-navy">{{ f.flight_number }}</td>
                          <td class="py-2.5 px-3 font-semibold text-slate-700">{{ f.route }}</td>
                          <td class="py-2.5 px-3 text-center font-mono">{{ f.occupied_seats }} / {{ f.total_capacity }}</td>
                          <td class="py-2.5 px-3 text-right font-mono font-bold text-amber-600">
                            {{ f.load_factor_percent }}%
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AnalyticsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly overviewData = signal<any>(null);
  readonly capacityData = signal<any>(null);

  ngOnInit(): void {
    this.loadAllData();
  }

  loadAllData(): void {
    this.loading.set(true);

    this.api.getAnalyticsOverview().subscribe({
      next: (data) => {
        this.overviewData.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(
          err?.error?.message ||
            (this.lang.isVietnamese() ? 'Lỗi tải phân tích kinh doanh' : 'Failed to load business analytics'),
        );
      },
    });

    this.api.getCapacityUtilization().subscribe({
      next: (data) => {
        this.capacityData.set(data);
      },
      error: (err) => {
        console.error('Failed to load capacity utilization:', err);
      },
    });
  }

  getCabinPercentage(count?: number): number {
    if (!count) return 0;
    const total =
      (this.overviewData()?.cabin_preferences?.economy || 0) +
      (this.overviewData()?.cabin_preferences?.business || 0) +
      (this.overviewData()?.cabin_preferences?.first || 0) +
      (this.overviewData()?.cabin_preferences?.club || 0);
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }
}
