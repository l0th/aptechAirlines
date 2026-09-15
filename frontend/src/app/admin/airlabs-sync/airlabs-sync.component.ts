import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-airlabs-sync',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <div class="max-w-4xl mx-auto space-y-6">
      
      <!-- Header -->
      <div>
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-gold/40 text-gold text-xs font-semibold mb-2">
          <app-icon name="refreshcw" class="w-3.5 h-3.5" />
          <span>AirLabs Aviation Intelligence</span>
        </div>
        <h1 class="text-2xl font-black text-navy">Đồng bộ Chuyến bay Thật (AirLabs Real-Time API)</h1>
        <p class="text-xs text-slate-500 mt-1">
          Kéo dữ liệu lịch bay thực tế từ cơ sở dữ liệu hàng không toàn cầu AirLabs vào hệ thống CSDL Aptech Airlines.
        </p>
      </div>

      <!-- Sync Settings Card -->
      <div class="card-luxury p-6 sm:p-8 border-slate-200 shadow-md">
        <h3 class="text-sm font-bold text-navy uppercase tracking-wider mb-4 flex items-center gap-2">
          <app-icon name="slidershorizontal" class="w-4 h-4 text-gold" />
          <span>Cấu hình Tham số Đồng bộ</span>
        </h3>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs mb-6">
          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">Sân bay khởi hành (IATA)</label>
            <input
              type="text"
              [(ngModel)]="depIata"
              placeholder="HAN"
              class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
            />
            <span class="text-[10px] text-slate-400 mt-1 block">VD: HAN (Nội Bài - Hà Nội)</span>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">Sân bay hạ cánh (IATA)</label>
            <input
              type="text"
              [(ngModel)]="arrIata"
              placeholder="SGN"
              class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
            />
            <span class="text-[10px] text-slate-400 mt-1 block">VD: SGN (Tân Sơn Nhất - TP.HCM)</span>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">AirLabs API Key</label>
            <input
              type="text"
              [(ngModel)]="apiKey"
              class="w-full font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-xs"
            />
            <span class="text-[10px] text-emerald-600 font-semibold mt-1 block">Khóa API chuẩn được cấu hình sẵn</span>
          </div>
        </div>

        <!-- 1-Click Sync Trigger Button -->
        <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="text-xs text-slate-500">
            Hệ thống sẽ tự động cấu hình các khoang ghế (Phổ thông, Thương gia) và bảng giá chuẩn cho các chuyến bay kéo về.
          </div>

          <button
            type="button"
            (click)="executeSync()"
            [disabled]="loading()"
            class="btn-gold !py-3 !px-8 text-sm uppercase tracking-wider font-bold w-full sm:w-auto shrink-0 shadow-lg"
          >
            @if (loading()) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              <span>Đang đồng bộ từ AirLabs...</span>
            } @else {
              <app-icon name="plane" class="w-4 h-4" />
              <span>Đồng bộ từ AirLabs ngay</span>
            }
          </button>
        </div>
      </div>

      <!-- Sync Results Card -->
      @if (syncResult()) {
        <div class="card-luxury p-6 border-slate-200 shadow-md animate-fade-in space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                <app-icon name="checkcircle2" class="w-6 h-6" />
              </div>
              <div>
                <h4 class="text-sm font-bold text-navy">Kết quả Đồng bộ</h4>
                <p class="text-xs text-slate-500">{{ syncResult()?.message }}</p>
              </div>
            </div>

            <div class="text-right">
              <span class="text-xs text-slate-400">Số lượng nạp mới:</span>
              <div class="text-xl font-black text-emerald-600">
                +{{ syncResult()?.synchronized_count }} chuyến bay
              </div>
            </div>
          </div>

          @if (syncResult()?.flights?.length) {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th class="py-2.5 px-3">Số hiệu</th>
                    <th class="py-2.5 px-3">Hãng</th>
                    <th class="py-2.5 px-3">Giờ cất cánh</th>
                    <th class="py-2.5 px-3">Giờ hạ cánh</th>
                    <th class="py-2.5 px-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (f of syncResult()?.flights; track f._id || f.flight_number) {
                    <tr class="hover:bg-slate-50">
                      <td class="py-2.5 px-3 font-mono font-bold text-navy">{{ f.flight_number }}</td>
                      <td class="py-2.5 px-3 font-semibold text-slate-700">{{ f.airline_iata || 'VN' }}</td>
                      <td class="py-2.5 px-3 text-slate-600">{{ f.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td class="py-2.5 px-3 text-slate-600">{{ f.scheduled_arrival | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                          {{ f.status || 'SCHEDULED' }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="pt-3 border-t border-slate-100 text-right">
              <a routerLink="/admin/flights" class="btn-navy text-xs !py-2 !px-4 font-bold inline-flex items-center gap-1.5">
                <span>Đi đến danh sách chuyến bay</span>
                <app-icon name="arrowright" class="w-3.5 h-3.5" />
              </a>
            </div>
          }
        </div>
      }

    </div>
  `,
})
export class AirlabsSyncComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  depIata = 'HAN';
  arrIata = 'SGN';
  apiKey = '8b45eda3-b158-40d3-a6fa-892632ed8075';

  readonly loading = signal(false);
  readonly syncResult = signal<{
    message: string;
    synchronized_count: number;
    flights: any[];
  } | null>(null);

  executeSync(): void {
    if (!this.depIata || !this.arrIata) {
      this.toast.warning('Vui lòng nhập mã sân bay đi và đến');
      return;
    }

    this.loading.set(true);
    this.api
      .syncAirLabs(this.depIata.trim(), this.arrIata.trim(), this.apiKey.trim())
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.syncResult.set(res);
          this.toast.success(`Đã kéo thành công ${res.synchronized_count} chuyến bay thật về CSDL!`);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || 'Không thể đồng bộ từ AirLabs.');
        },
      });
  }
}
