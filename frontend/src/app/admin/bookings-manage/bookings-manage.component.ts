import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { Booking, BookingStatus } from '../../core/models/booking.model';

@Component({
  selector: 'app-bookings-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, CurrencyFormatPipe],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">Quản lý Đặt chỗ & Đơn Vé</h1>
          <p class="text-xs text-slate-500">Xem tất cả các đơn đặt vé của khách hàng, theo dõi trạng thái thanh toán và giữ chỗ.</p>
        </div>
      </div>

      <!-- Filters -->
      <div class="card-luxury p-4 border-slate-200 flex items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">Trạng thái vé:</label>
          <select
            [(ngModel)]="filterStatus"
            (change)="loadBookings()"
            class="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
          >
            <option value="">Tất cả trạng thái</option>
            <option [value]="BookingStatus.CONFIRMED">CONFIRMED (Đã thanh toán)</option>
            <option [value]="BookingStatus.BLOCKED">BLOCKED (Giữ chỗ miễn phí)</option>
            <option [value]="BookingStatus.CANCELLED">CANCELLED (Đã hủy)</option>
            <option [value]="BookingStatus.RESCHEDULED">RESCHEDULED (Đã đổi chuyến)</option>
          </select>
        </div>
      </div>

      <!-- Bookings Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">Mã PNR</th>
                <th class="py-3.5 px-4">Mã Vé / Giữ chỗ</th>
                <th class="py-3.5 px-4">Hành trình</th>
                <th class="py-3.5 px-4">Số khách & Tên</th>
                <th class="py-3.5 px-4">Tổng tiền</th>
                <th class="py-3.5 px-4">Trạng thái</th>
                <th class="py-3.5 px-4 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="7" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    Đang tải danh sách đặt chỗ...
                  </td>
                </tr>
              } @else if (!bookings().length) {
                <tr>
                  <td colspan="7" class="text-center py-10 text-slate-400">
                    Không có đơn đặt vé nào.
                  </td>
                </tr>
              } @else {
                @for (b of bookings(); track b._id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-black text-navy text-sm">{{ b.pnr_number }}</td>
                    <td class="py-3.5 px-4 font-mono font-bold text-amber-600">
                      {{ b.confirmation_number || b.blocking_number }}
                    </td>
                    <td class="py-3.5 px-4">
                      @if (b.legs[0]) {
                        <span class="font-bold text-slate-800">{{ b.legs[0].origin_iata }} &rarr; {{ b.legs[0].dest_iata }}</span>
                        <span class="text-[10px] text-slate-400 block">{{ b.legs[0].scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-slate-700">
                      <strong>{{ b.passengers.length }} khách</strong>
                      <span class="text-[11px] text-slate-400 block truncate max-w-[150px]">
                        {{ b.passengers[0]?.last_name }} {{ b.passengers[0]?.first_name }}
                      </span>
                    </td>
                    <td class="py-3.5 px-4 font-bold text-navy">
                      {{ b.total_amount | currencyFormat }}
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                        [ngClass]="{
                          'bg-emerald-100 text-emerald-800 border border-emerald-300': b.status === BookingStatus.CONFIRMED,
                          'bg-amber-100 text-amber-800 border border-amber-300': b.status === BookingStatus.BLOCKED,
                          'bg-rose-100 text-rose-800 border border-rose-300': b.status === BookingStatus.CANCELLED,
                          'bg-blue-100 text-blue-800 border border-blue-300': b.status === BookingStatus.RESCHEDULED
                        }"
                      >
                        {{ b.status }}
                      </span>
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        (click)="viewDetails(b)"
                        class="p-1.5 hover:bg-slate-100 text-navy rounded-lg transition-colors"
                        title="Xem chi tiết đơn vé"
                      >
                        <app-icon name="eye" class="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- Booking Details Modal -->
    @if (selectedBooking()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="ticket" class="w-5 h-5 text-gold" />
              <span>Chi tiết Đơn vé: {{ selectedBooking()?.pnr_number }}</span>
            </h3>
            <button (click)="selectedBooking.set(null)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <div class="space-y-4 text-xs">
            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-slate-500">Mã giao dịch:</span>
                <strong class="font-mono text-amber-600">{{ selectedBooking()?.confirmation_number || selectedBooking()?.blocking_number }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Trạng thái:</span>
                <span class="font-bold">{{ selectedBooking()?.status }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Tổng tiền:</span>
                <strong class="text-navy font-bold text-sm">{{ selectedBooking()?.total_amount | currencyFormat }}</strong>
              </div>
            </div>

            <div>
              <h4 class="font-bold text-navy uppercase text-[11px] mb-2">Hành khách & Ghế ngồi</h4>
              <div class="space-y-1.5">
                @for (p of selectedBooking()?.passengers; track $index) {
                  <div class="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                    <div>
                      <span class="font-bold text-slate-800">{{ p.last_name }} {{ p.first_name }}</span>
                      <span class="text-[10px] text-slate-400 block">{{ p.passenger_type }} • CCCD: {{ p.id_card_or_passport || 'N/A' }}</span>
                    </div>
                    <span class="font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {{ p.seat_code || 'Chưa gán' }}
                    </span>
                  </div>
                }
              </div>
            </div>

            @if (selectedBooking()?.cancelled_at) {
              <div class="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-900 space-y-1">
                <div class="font-bold">Đã hủy vào: {{ selectedBooking()?.cancelled_at | date: 'dd/MM/yyyy HH:mm' }}</div>
                <div>Lý do: {{ selectedBooking()?.cancel_reason }}</div>
                <div>Đã hoàn lại: {{ selectedBooking()?.refund_percentage }}% ({{ selectedBooking()?.refund_amount | currencyFormat }})</div>
              </div>
            }
          </div>

          <div class="flex justify-end pt-4 mt-4 border-t border-slate-100">
            <button (click)="selectedBooking.set(null)" class="btn-navy text-xs !py-2 !px-5">Đóng</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class BookingsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly bookings = signal<Booking[]>([]);
  readonly loading = signal(false);
  filterStatus = '';

  readonly selectedBooking = signal<Booking | null>(null);
  BookingStatus = BookingStatus;

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
          this.bookings.set(list);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || 'Không thể tải danh sách đặt vé.');
        },
      });
  }

  viewDetails(b: Booking): void {
    this.selectedBooking.set(b);
  }
}
