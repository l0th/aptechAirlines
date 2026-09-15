import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Airport } from '../../core/models/airport.model';

@Component({
  selector: 'app-airports-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">Quản lý Sân bay & Thành phố</h1>
          <p class="text-xs text-slate-500">Danh mục cảng hàng không trực tiếp và các thành phố lân cận kết nối.</p>
        </div>

        <button
          type="button"
          (click)="openCreateModal()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold"
        >
          <app-icon name="plus" class="w-4 h-4" />
          <span>Thêm Sân bay</span>
        </button>
      </div>

      <!-- Search & Filter Bar -->
      <div class="card-luxury p-4 border-slate-200 flex items-center gap-3">
        <div class="relative flex-1 max-w-sm">
          <app-icon name="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (keyup.enter)="loadAirports()"
            placeholder="Tìm theo mã IATA hoặc tên thành phố..."
            class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-gold"
          />
        </div>
        <button (click)="loadAirports()" class="btn-navy text-xs !py-2 !px-4">Tìm kiếm</button>
      </div>

      <!-- Airports Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">Mã IATA</th>
                <th class="py-3.5 px-4">Thành phố</th>
                <th class="py-3.5 px-4">Tên Sân bay</th>
                <th class="py-3.5 px-4">Phục vụ trực tiếp</th>
                <th class="py-3.5 px-4">Sân bay gần nhất</th>
                <th class="py-3.5 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="6" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    Đang tải danh sách sân bay...
                  </td>
                </tr>
              } @else {
                @for (ap of airports(); track ap.iata_code) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3 px-4 font-mono font-bold text-navy text-sm">{{ ap.iata_code }}</td>
                    <td class="py-3 px-4 font-bold text-slate-800">{{ ap.city_name }}</td>
                    <td class="py-3 px-4 text-slate-600">{{ ap.airport_name }}</td>
                    <td class="py-3 px-4">
                      @if (ap.is_serviced_directly) {
                        <span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Trực tiếp
                        </span>
                      } @else {
                        <span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          Chuyển tiếp lân cận
                        </span>
                      }
                    </td>
                    <td class="py-3 px-4 text-slate-500 font-mono">
                      {{ ap.nearest_airport_code ? (ap.nearest_airport_code + ' (' + ap.distance_to_nearest_km + 'km)') : '-' }}
                    </td>
                    <td class="py-3 px-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          (click)="openEditModal(ap)"
                          class="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          title="Chỉnh sửa"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          (click)="deleteAirport(ap)"
                          class="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                          title="Xóa"
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

    <!-- Modal Create / Edit Airport -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="mappin" class="w-5 h-5 text-gold" />
              <span>{{ isEditMode ? 'Chỉnh sửa Sân bay' : 'Thêm Sân bay Mới' }}</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveAirport()" class="space-y-3 text-xs">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Mã IATA (3 ký tự viết hoa)</label>
              <input
                type="text"
                [(ngModel)]="formData.iata_code"
                name="iata"
                [disabled]="isEditMode"
                required
                maxlength="3"
                placeholder="HAN"
                class="w-full uppercase font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Tên Thành phố</label>
              <input
                type="text"
                [(ngModel)]="formData.city_name"
                name="city"
                required
                placeholder="Hà Nội"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Tên Sân bay đầy đủ</label>
              <input
                type="text"
                [(ngModel)]="formData.airport_name"
                name="airport_name"
                required
                placeholder="Sân bay Quốc tế Nội Bài"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div class="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                [(ngModel)]="formData.is_serviced_directly"
                name="serviced"
                id="serviced_check"
                class="rounded text-gold focus:ring-gold"
              />
              <label for="serviced_check" class="font-semibold text-slate-700">Có đường bay thương mại trực tiếp</label>
            </div>

            @if (!formData.is_serviced_directly) {
              <div class="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                <div>
                  <label class="block font-semibold text-amber-900 mb-1">Mã sân bay phục vụ lân cận</label>
                  <input
                    type="text"
                    [(ngModel)]="formData.nearest_airport_code"
                    name="nearest_iata"
                    placeholder="DAD"
                    class="w-full uppercase font-mono px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label class="block font-semibold text-amber-900 mb-1">Khoảng cách tới sân bay gần nhất (km)</label>
                  <input
                    type="number"
                    [(ngModel)]="formData.distance_to_nearest_km"
                    name="dist_km"
                    placeholder="30"
                    class="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                </div>
              </div>
            }

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">Hủy</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">Lưu thông tin</button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class AirportsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly airports = signal<Airport[]>([]);
  readonly loading = signal(false);
  searchQuery = '';

  readonly showModal = signal(false);
  isEditMode = false;
  formData: any = {};

  ngOnInit(): void {
    this.loadAirports();
  }

  loadAirports(): void {
    this.loading.set(true);
    this.api.getAirports(this.searchQuery).subscribe({
      next: (list) => {
        this.airports.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || 'Không thể tải danh sách sân bay.');
      },
    });
  }

  openCreateModal(): void {
    this.isEditMode = false;
    this.formData = {
      iata_code: '',
      city_name: '',
      airport_name: '',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
    };
    this.showModal.set(true);
  }

  openEditModal(ap: Airport): void {
    this.isEditMode = true;
    this.formData = { ...ap };
    this.showModal.set(true);
  }

  saveAirport(): void {
    if (!this.formData.iata_code || !this.formData.city_name) {
      this.toast.warning('Vui lòng nhập đầy đủ mã IATA và tên thành phố');
      return;
    }

    if (this.isEditMode) {
      this.api.updateAirport(this.formData.iata_code, this.formData).subscribe({
        next: () => {
          this.toast.success('Cập nhật sân bay thành công!');
          this.showModal.set(false);
          this.loadAirports();
        },
        error: (err) => this.toast.error(err.error?.message || 'Cập nhật thất bại.'),
      });
    } else {
      this.api.createAirport(this.formData).subscribe({
        next: () => {
          this.toast.success('Thêm sân bay thành công!');
          this.showModal.set(false);
          this.loadAirports();
        },
        error: (err) => this.toast.error(err.error?.message || 'Thêm sân bay thất bại.'),
      });
    }
  }

  deleteAirport(ap: Airport): void {
    if (!confirm(`Bạn có chắc muốn xóa sân bay ${ap.iata_code} (${ap.city_name})?`)) return;

    this.api.deleteAirport(ap.iata_code).subscribe({
      next: () => {
        this.toast.success(`Đã xóa sân bay ${ap.iata_code}`);
        this.loadAirports();
      },
      error: (err) => this.toast.error(err.error?.message || 'Xóa sân bay thất bại.'),
    });
  }
}
