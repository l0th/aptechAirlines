import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { Flight, FlightStatus, CabinClass } from '../../core/models/flight.model';
import { Airport } from '../../core/models/airport.model';

@Component({
  selector: 'app-flights-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, CurrencyFormatPipe],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.flights') }}</h1>
          <p class="text-xs text-slate-500">Quản lý lịch bay, giá vé, cấu hình hạng ghế và cập nhật trạng thái thời tiết khẩn cấp.</p>
        </div>

        <button
          type="button"
          (click)="openCreateModal()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold"
        >
          <app-icon name="plus" class="w-4 h-4" />
          <span>{{ lang.t('admin.addFlight') }}</span>
        </button>
      </div>

      <!-- Filters Row -->
      <div class="card-luxury p-4 border-slate-200 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">Trạng thái:</label>
          <select
            [(ngModel)]="filterStatus"
            (change)="loadFlights()"
            class="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
          >
            <option value="">Tất cả</option>
            <option [value]="FlightStatus.SCHEDULED">SCHEDULED</option>
            <option [value]="FlightStatus.ACTIVE">ACTIVE</option>
            <option [value]="FlightStatus.DELAYED">DELAYED</option>
            <option [value]="FlightStatus.CANCELLED">CANCELLED</option>
            <option [value]="FlightStatus.LANDED">LANDED</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">Điểm đi:</label>
          <input
            type="text"
            [(ngModel)]="filterOrigin"
            (keyup.enter)="loadFlights()"
            placeholder="HAN, SGN..."
            class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
          />
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">Điểm đến:</label>
          <input
            type="text"
            [(ngModel)]="filterDest"
            (keyup.enter)="loadFlights()"
            placeholder="SGN, DAD..."
            class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
          />
        </div>

        <button
          (click)="loadFlights()"
          class="btn-navy text-xs !py-1.5 !px-3 ml-auto"
        >
          Lọc
        </button>
      </div>

      <!-- Flights Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">Số hiệu</th>
                <th class="py-3.5 px-4">Chặng bay</th>
                <th class="py-3.5 px-4">Ngày bay</th>
                <th class="py-3.5 px-4">Giờ cất cánh</th>
                <th class="py-3.5 px-4">Hạng vé & Giá</th>
                <th class="py-3.5 px-4">Trạng thái</th>
                <th class="py-3.5 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="7" class="text-center py-12 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    Đang tải dữ liệu chuyến bay...
                  </td>
                </tr>
              } @else if (!flights().length) {
                <tr>
                  <td colspan="7" class="text-center py-12 text-slate-400">
                    Không tìm thấy chuyến bay nào phù hợp.
                  </td>
                </tr>
              } @else {
                @for (fl of flights(); track fl._id) {
                  <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy text-sm">
                      {{ fl.flight_number }}
                    </td>
                    <td class="py-3.5 px-4">
                      <div class="flex items-center gap-1.5 font-bold text-slate-800">
                        <span>{{ fl.origin_iata }}</span>
                        <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                        <span>{{ fl.dest_iata }}</span>
                      </div>
                      <span class="text-[10px] text-slate-400">{{ fl.aircraft?.model_name }}</span>
                    </td>
                    <td class="py-3.5 px-4 text-slate-600">
                      {{ fl.departure_date }}
                    </td>
                    <td class="py-3.5 px-4 text-slate-700">
                      {{ fl.scheduled_departure | date: 'HH:mm' }} &rarr; {{ fl.scheduled_arrival | date: 'HH:mm' }}
                    </td>
                    <td class="py-3.5 px-4">
                      <div class="space-y-1">
                        @for (inv of fl.inventories; track inv._id || inv.cabin_class) {
                          <div class="flex items-center gap-1.5 text-[11px]">
                            <span class="font-bold text-slate-600 w-16">{{ inv.cabin_class }}:</span>
                            <span class="text-amber-600 font-mono font-bold">{{ inv.base_price | currencyFormat }}</span>
                            <span class="text-slate-400">({{ inv.available_seats }}/{{ inv.allocated_seats }} ghế)</span>
                          </div>
                        }
                      </div>
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider block text-center"
                        [ngClass]="{
                          'bg-emerald-100 text-emerald-800 border border-emerald-300': fl.status === 'SCHEDULED' || fl.status === 'ACTIVE',
                          'bg-amber-100 text-amber-800 border border-amber-300': fl.status === 'DELAYED',
                          'bg-rose-100 text-rose-800 border border-rose-300': fl.status === 'CANCELLED',
                          'bg-slate-100 text-slate-800': fl.status === 'LANDED'
                        }"
                      >
                        {{ fl.status }}
                      </span>
                      @if (fl.delay_reason) {
                        <span class="text-[10px] text-rose-600 block mt-1 font-medium truncate max-w-[140px]" [title]="fl.delay_reason">
                          {{ fl.delay_reason }}
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <!-- Emergency Status Override Button -->
                        <button
                          type="button"
                          (click)="openEmergencyStatusModal(fl)"
                          class="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg border border-amber-300 transition-colors"
                          title="Cập nhật Thời tiết / Trạng thái khẩn cấp"
                        >
                          <app-icon name="alerttriangle" class="w-4 h-4" />
                        </button>

                        <!-- Delete Flight Button -->
                        <button
                          type="button"
                          (click)="deleteFlight(fl)"
                          class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 transition-colors"
                          title="Xóa chuyến bay"
                        >
                          <app-icon name="trash2" class="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- Modal: Emergency Status Update (Thời tiết hoãn/hủy) -->
    @if (showStatusModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="alerttriangle" class="w-5 h-5 text-amber-500" />
              <span>Cập nhật Khẩn cấp: {{ activeFlight()?.flight_number }}</span>
            </h3>
            <button (click)="showStatusModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <div class="space-y-4 text-xs">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Trạng thái mới</label>
              <select
                [(ngModel)]="newStatus"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:ring-2 focus:ring-gold"
              >
                <option [value]="FlightStatus.SCHEDULED">SCHEDULED (Theo lịch bay)</option>
                <option [value]="FlightStatus.ACTIVE">ACTIVE (Đang bay)</option>
                <option [value]="FlightStatus.DELAYED">DELAYED (Hoãn chuyến do thời tiết/kỹ thuật)</option>
                <option [value]="FlightStatus.CANCELLED">CANCELLED (Hủy chuyến khẩn cấp do bão)</option>
                <option [value]="FlightStatus.LANDED">LANDED (Đã hạ cánh)</option>
              </select>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Lý do hoãn / hủy (Hiển thị cho khách hàng)</label>
              <textarea
                [(ngModel)]="newDelayReason"
                rows="3"
                placeholder="VD: Do bão số 4 gây mưa to gió lớn tại sân bay Nội Bài, chuyến bay tạm hoãn 120 phút..."
                class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold"
              ></textarea>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6 pt-3 border-t border-slate-100">
            <button (click)="showStatusModal.set(false)" class="btn-ghost text-xs">Hủy</button>
            <button
              [disabled]="submitting()"
              (click)="saveFlightStatus()"
              class="btn-gold text-xs !py-2.5 !px-5 font-bold"
            >
              @if (submitting()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>Lưu trạng thái</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Create Flight -->
    @if (showCreateModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div class="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-6 border border-slate-200 my-auto">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="plane" class="w-5 h-5 text-gold" />
              <span>Thêm Chuyến Bay Mới</span>
            </h3>
            <button (click)="showCreateModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveCreateFlight()" class="space-y-4 text-xs">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">Số hiệu chuyến bay</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.flight_number"
                  name="flight_number"
                  required
                  placeholder="VN-234"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">Sân bay đi (IATA)</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.origin_iata"
                  name="origin_iata"
                  required
                  placeholder="HAN"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">Sân bay đến (IATA)</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.dest_iata"
                  name="dest_iata"
                  required
                  placeholder="SGN"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">Ngày bay (YYYY-MM-DD)</label>
                <input
                  type="date"
                  [(ngModel)]="newFlight.departure_date"
                  name="departure_date"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">Giờ cất cánh (ISO / Date)</label>
                <input
                  type="datetime-local"
                  [(ngModel)]="newFlight.scheduled_departure"
                  name="scheduled_departure"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">Giờ hạ cánh (ISO / Date)</label>
                <input
                  type="datetime-local"
                  [(ngModel)]="newFlight.scheduled_arrival"
                  name="scheduled_arrival"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <h4 class="font-bold text-navy uppercase text-[11px]">Cấu hình Giá vé & Ghế</h4>
              
              <!-- Economy -->
              <div class="grid grid-cols-3 gap-2 items-center">
                <span class="font-bold text-slate-700">Phổ thông (Economy):</span>
                <input
                  type="number"
                  [(ngModel)]="econPrice"
                  name="econPrice"
                  placeholder="Giá vé VND (1200000)"
                  class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                />
                <input
                  type="number"
                  [(ngModel)]="econSeats"
                  name="econSeats"
                  placeholder="Số ghế (140)"
                  class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                />
              </div>

              <!-- Business -->
              <div class="grid grid-cols-3 gap-2 items-center">
                <span class="font-bold text-amber-700">Thương gia (Business):</span>
                <input
                  type="number"
                  [(ngModel)]="busPrice"
                  name="busPrice"
                  placeholder="Giá vé VND (3500000)"
                  class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                />
                <input
                  type="number"
                  [(ngModel)]="busSeats"
                  name="busSeats"
                  placeholder="Số ghế (20)"
                  class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showCreateModal.set(false)" class="btn-ghost text-xs">Hủy</button>
              <button
                type="submit"
                [disabled]="submitting()"
                class="btn-gold text-xs !py-2.5 !px-5 font-bold"
              >
                @if (submitting()) {
                  <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                }
                <span>Tạo Chuyến Bay</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class FlightsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly flights = signal<Flight[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);

  FlightStatus = FlightStatus;
  CabinClass = CabinClass;

  filterStatus = '';
  filterOrigin = '';
  filterDest = '';

  // Emergency status modal
  readonly showStatusModal = signal(false);
  readonly activeFlight = signal<Flight | null>(null);
  newStatus: FlightStatus = FlightStatus.DELAYED;
  newDelayReason = '';

  // Create flight modal
  readonly showCreateModal = signal(false);
  newFlight: any = {};
  econPrice = 1250000;
  econSeats = 150;
  busPrice = 3800000;
  busSeats = 24;

  ngOnInit(): void {
    this.loadFlights();
  }

  loadFlights(): void {
    this.loading.set(true);
    this.api
      .getFlights({
        status: (this.filterStatus as FlightStatus) || undefined,
        origin: this.filterOrigin || undefined,
        dest: this.filterDest || undefined,
      })
      .subscribe({
        next: (list) => {
          this.flights.set(list);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || 'Không thể tải danh sách chuyến bay.');
        },
      });
  }

  openEmergencyStatusModal(fl: Flight): void {
    this.activeFlight.set(fl);
    this.newStatus = fl.status;
    this.newDelayReason = fl.delay_reason || 'Ảnh hưởng thời tiết xấu và gió giật mạnh.';
    this.showStatusModal.set(true);
  }

  saveFlightStatus(): void {
    const fl = this.activeFlight();
    if (!fl) return;

    this.submitting.set(true);
    this.api
      .updateFlightStatus(fl._id, {
        status: this.newStatus,
        delay_reason: this.newDelayReason,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.showStatusModal.set(false);
          this.toast.success(`Đã cập nhật trạng thái chuyến bay ${fl.flight_number} thành ${this.newStatus}!`);
          this.loadFlights();
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(err.error?.message || 'Cập nhật trạng thái thất bại.');
        },
      });
  }

  openCreateModal(): void {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const depStr = tomorrow.toISOString().split('T')[0];

    this.newFlight = {
      flight_number: 'VN-' + Math.floor(100 + Math.random() * 900),
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      departure_date: depStr,
      scheduled_departure: `${depStr}T08:00:00.000Z`,
      scheduled_arrival: `${depStr}T10:10:00.000Z`,
      duration_minutes: 130,
      distance_miles: 720,
      aircraft: {
        model_code: 'A321',
        model_name: 'Airbus A321 Neo',
        total_capacity: 180,
      },
    };
    this.showCreateModal.set(true);
  }

  saveCreateFlight(): void {
    this.submitting.set(true);
    const payload = {
      ...this.newFlight,
      inventories: [
        {
          cabin_class: CabinClass.ECONOMY,
          base_price: Number(this.econPrice),
          allocated_seats: Number(this.econSeats),
          available_seats: Number(this.econSeats),
        },
        {
          cabin_class: CabinClass.BUSINESS,
          base_price: Number(this.busPrice),
          allocated_seats: Number(this.busSeats),
          available_seats: Number(this.busSeats),
        },
      ],
    };

    this.api.createFlight(payload).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showCreateModal.set(false);
        this.toast.success('Đã thêm chuyến bay mới thành công!');
        this.loadFlights();
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(err.error?.message || 'Không thể tạo chuyến bay.');
      },
    });
  }

  deleteFlight(fl: Flight): void {
    if (!confirm(`Bạn có chắc chắn muốn xóa chuyến bay ${fl.flight_number} không?`)) return;

    this.api.deleteFlight(fl._id).subscribe({
      next: () => {
        this.toast.success(`Đã xóa chuyến bay ${fl.flight_number}`);
        this.loadFlights();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Xóa chuyến bay không thành công.');
      },
    });
  }
}
