import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CancellationPolicy } from '../../core/models/booking.model';

@Component({
  selector: 'app-policies-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">Chính sách Hoàn Tiền Hủy Vé</h1>
          <p class="text-xs text-slate-500">
            Quy định tỷ lệ hoàn tiền theo số ngày khách hàng gửi yêu cầu hủy vé trước ngày khởi hành.
          </p>
        </div>

        <button
          type="button"
          (click)="openCreateModal()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold"
        >
          <app-icon name="plus" class="w-4 h-4" />
          <span>Thêm Chính Sách</span>
        </button>
      </div>

      <!-- Policies Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">Số ngày tối thiểu</th>
                <th class="py-3.5 px-4">Số ngày tối đa</th>
                <th class="py-3.5 px-4">Tỷ lệ Hoàn tiền (%)</th>
                <th class="py-3.5 px-4">Mô tả chi tiết</th>
                <th class="py-3.5 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="5" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    Đang tải danh sách chính sách...
                  </td>
                </tr>
              } @else {
                @for (p of policies(); track p._id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy">
                      >= {{ p.min_days_before }} ngày
                    </td>
                    <td class="py-3.5 px-4 font-mono text-slate-600">
                      {{ p.max_days_before !== null ? ('<= ' + p.max_days_before + ' ngày') : 'Không giới hạn' }}
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                        [ngClass]="p.refund_percentage > 50 ? 'bg-emerald-100 text-emerald-800' : p.refund_percentage > 0 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'"
                      >
                        {{ p.refund_percentage }}%
                      </span>
                    </td>
                    <td class="py-3.5 px-4 text-slate-600">
                      {{ p.description }}
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          (click)="openEditModal(p)"
                          class="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          title="Chỉnh sửa"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          (click)="deletePolicy(p)"
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

    <!-- Modal Create / Edit Policy -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="shieldcheck" class="w-5 h-5 text-gold" />
              <span>{{ isEditMode ? 'Sửa Chính Sách' : 'Thêm Chính Sách Mới' }}</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="savePolicy()" class="space-y-3 text-xs">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">Số ngày tối thiểu (min)</label>
                <input
                  type="number"
                  [(ngModel)]="formData.min_days_before"
                  name="min_days"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">Số ngày tối đa (max - để trống nếu vô hạn)</label>
                <input
                  type="number"
                  [(ngModel)]="formData.max_days_before"
                  name="max_days"
                  placeholder="null"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">% Hoàn tiền (0 - 100)</label>
              <input
                type="number"
                [(ngModel)]="formData.refund_percentage"
                name="refund_pct"
                required
                min="0"
                max="100"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold font-mono"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Mô tả điều kiện áp dụng</label>
              <textarea
                [(ngModel)]="formData.description"
                name="desc"
                rows="2"
                required
                placeholder="VD: Hủy trước ngày bay trên 30 ngày: hoàn 90% giá vé"
                class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              ></textarea>
            </div>

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">Hủy</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">Lưu chính sách</button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class PoliciesManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly policies = signal<CancellationPolicy[]>([]);
  readonly loading = signal(false);

  readonly showModal = signal(false);
  isEditMode = false;
  formData: any = {};

  ngOnInit(): void {
    this.loadPolicies();
  }

  loadPolicies(): void {
    this.loading.set(true);
    this.api.getPolicies().subscribe({
      next: (list) => {
        this.policies.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || 'Không thể tải chính sách hủy vé.');
      },
    });
  }

  openCreateModal(): void {
    this.isEditMode = false;
    this.formData = {
      min_days_before: 7,
      max_days_before: 14,
      refund_percentage: 50,
      description: '',
    };
    this.showModal.set(true);
  }

  openEditModal(p: CancellationPolicy): void {
    this.isEditMode = true;
    this.formData = { ...p };
    this.showModal.set(true);
  }

  savePolicy(): void {
    if (this.formData.refund_percentage === undefined || this.formData.min_days_before === undefined) {
      this.toast.warning('Vui lòng điền đầy đủ thông tin');
      return;
    }

    if (this.isEditMode && this.formData._id) {
      this.api.updatePolicy(this.formData._id, this.formData).subscribe({
        next: () => {
          this.toast.success('Cập nhật chính sách thành công!');
          this.showModal.set(false);
          this.loadPolicies();
        },
        error: (err) => this.toast.error(err.error?.message || 'Cập nhật thất bại.'),
      });
    } else {
      this.api.createPolicy(this.formData).subscribe({
        next: () => {
          this.toast.success('Tạo chính sách mới thành công!');
          this.showModal.set(false);
          this.loadPolicies();
        },
        error: (err) => this.toast.error(err.error?.message || 'Tạo chính sách thất bại.'),
      });
    }
  }

  deletePolicy(p: CancellationPolicy): void {
    if (!p._id) return;
    if (!confirm(`Bạn có chắc muốn xóa chính sách hoàn ${p.refund_percentage}%?`)) return;

    this.api.deletePolicy(p._id).subscribe({
      next: () => {
        this.toast.success('Đã xóa chính sách');
        this.loadPolicies();
      },
      error: (err) => this.toast.error(err.error?.message || 'Xóa thất bại.'),
    });
  }
}
