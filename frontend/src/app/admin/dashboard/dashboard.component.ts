import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Flight } from '../../core/models/flight.model';
import { Booking, BookingStatus } from '../../core/models/booking.model';

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
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng Chuyến Bay</span>
            <div class="w-9 h-9 rounded-xl bg-navy/10 text-navy flex items-center justify-center">
              <app-icon name="plane" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-navy mt-2">{{ flights().length }}</div>
          <span class="text-[11px] text-emerald-600 font-semibold mt-1 block">Hoạt động trong CSDL</span>
        </div>

        <!-- Bookings Count -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng Đơn Đặt Vé</span>
            <div class="w-9 h-9 rounded-xl bg-amber-500/15 text-gold flex items-center justify-center">
              <app-icon name="ticket" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-navy mt-2">{{ bookings().length }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">Toàn bộ khách hàng</span>
        </div>

        <!-- Confirmed Tickets -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Vé Đã Xác Nhận</span>
            <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <app-icon name="checkcircle2" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-emerald-600 mt-2">{{ confirmedCount() }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">Đã thanh toán thành công</span>
        </div>

        <!-- Blocked / Holding Tickets -->
        <div class="card-luxury p-5 border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">Vé Giữ Chỗ Miễn Phí</span>
            <div class="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <app-icon name="clock" class="w-5 h-5" />
            </div>
          </div>
          <div class="text-2xl font-black text-amber-600 mt-2">{{ blockedCount() }}</div>
          <span class="text-[11px] text-slate-500 font-medium mt-1 block">Đang chờ thanh toán</span>
        </div>
      </div>

      <!-- Quick Actions Bar -->
      <div class="card-luxury p-5 border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-bold text-navy">Thao tác Nhanh</h3>
          <p class="text-xs text-slate-500">Các tác vụ thường nhật của Điều phối viên (Clerk) và Quản trị viên (Admin)</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <a routerLink="/admin/airlabs-sync" class="btn-gold text-xs !py-2 !px-4 font-bold">
            <app-icon name="refreshcw" class="w-3.5 h-3.5" />
            <span>Đồng bộ Chuyến bay từ AirLabs</span>
          </a>

          <a routerLink="/admin/flights" class="btn-navy text-xs !py-2 !px-4 font-bold">
            <app-icon name="plus" class="w-3.5 h-3.5" />
            <span>Thêm chuyến bay thủ công</span>
          </a>
        </div>
      </div>

      <!-- Recent Flights Table Preview -->
      <div class="card-luxury p-6 border-slate-200 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-bold text-navy flex items-center gap-2">
            <app-icon name="plane" class="w-4 h-4 text-gold" />
            <span>Lịch Bay Gần Đây</span>
          </h3>
          <a routerLink="/admin/flights" class="text-xs font-bold text-navy hover:text-gold transition-colors">
            Xem tất cả &rarr;
          </a>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase border-y border-slate-200">
              <tr>
                <th class="py-3 px-4 font-semibold">Số hiệu</th>
                <th class="py-3 px-4 font-semibold">Chặng bay</th>
                <th class="py-3 px-4 font-semibold">Khởi hành</th>
                <th class="py-3 px-4 font-semibold">Máy bay</th>
                <th class="py-3 px-4 font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              @for (fl of flights().slice(0, 6); track fl._id) {
                <tr class="hover:bg-slate-50/80 transition-colors">
                  <td class="py-3 px-4 font-mono font-bold text-navy">{{ fl.flight_number }}</td>
                  <td class="py-3 px-4">
                    <span class="font-bold text-slate-800">{{ fl.origin_iata }}</span>
                    <span class="text-slate-400 mx-1">&rarr;</span>
                    <span class="font-bold text-slate-800">{{ fl.dest_iata }}</span>
                  </td>
                  <td class="py-3 px-4 text-slate-600">{{ fl.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</td>
                  <td class="py-3 px-4 text-slate-500">{{ fl.aircraft?.model_name || 'Airbus A321' }}</td>
                  <td class="py-3 px-4">
                    <span
                      class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase"
                      [ngClass]="{
                        'bg-emerald-100 text-emerald-800': fl.status === 'SCHEDULED' || fl.status === 'ACTIVE',
                        'bg-amber-100 text-amber-800': fl.status === 'DELAYED',
                        'bg-rose-100 text-rose-800': fl.status === 'CANCELLED'
                      }"
                    >
                      {{ fl.status }}
                    </span>
                  </td>
                </tr>
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

  readonly flights = signal<Flight[]>([]);
  readonly bookings = signal<Booking[]>([]);

  readonly confirmedCount = signal(0);
  readonly blockedCount = signal(0);

  ngOnInit(): void {
    this.api.getFlights().subscribe({
      next: (fls) => this.flights.set(fls),
    });

    this.api.getBookings().subscribe({
      next: (bks) => {
        this.bookings.set(bks);
        this.confirmedCount.set(
          bks.filter((b) => b.status === BookingStatus.CONFIRMED).length,
        );
        this.blockedCount.set(
          bks.filter((b) => b.status === BookingStatus.BLOCKED).length,
        );
      },
    });
  }
}
