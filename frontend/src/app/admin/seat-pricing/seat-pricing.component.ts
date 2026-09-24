import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

export interface SeatPricingRule {
  _id?: string;
  rule_id: string;
  pricing_dimension: 'CABIN_BASE' | 'WINDOW' | 'AISLE' | 'MIDDLE' | 'FRONT_ZONE' | 'EXIT_ROW' | 'EXTRA_LEGROOM' | 'BULKHEAD';
  amount: number;
  cabin_class: string;
  priority: number;
  effective_from: string | Date;
  effective_to?: string | Date;
  version: number;
  supersedes_rule_id?: string;
  is_active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-seat-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy flex items-center gap-2.5">
            <app-icon name="tag" class="w-6 h-6 text-gold" />
            <span>{{ lang.isVietnamese() ? 'Quy Tắc Giá Ghế Động (8 Chiều)' : 'Dynamic Seat Pricing Rules (8 Dimensions)' }}</span>
          </h1>
          <p class="text-xs text-slate-500 mt-1">
            {{ lang.isVietnamese()
              ? 'Quản lý 8 chiều định giá ghế độc lập: Hạng vé, Cửa sổ, Lối đi, Giữa, Khu vực đầu, Thoát hiểm, Chân rộng, và Vách ngăn.'
              : 'Configure additive seat fee stacking across the 8 authoritative pricing dimensions.' }}
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            (click)="loadRules()"
            class="btn-outline-navy text-xs !py-2.5 !px-3 font-semibold"
            [disabled]="loading()"
          >
            <app-icon name="refreshcw" class="w-3.5 h-3.5" [class.animate-spin]="loading()" />
            <span>{{ lang.isVietnamese() ? 'Làm mới' : 'Refresh' }}</span>
          </button>

          <button
            type="button"
            (click)="openCreateModal()"
            class="btn-gold text-xs !py-2.5 !px-4 font-bold"
          >
            <app-icon name="plus" class="w-4 h-4" />
            <span>{{ lang.isVietnamese() ? 'Thêm Quy Tắc Giá' : 'Add Pricing Rule' }}</span>
          </button>
        </div>
      </div>

      <!-- Dimension Badges Overview Bar -->
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        @for (dim of standardDimensions; track dim.key) {
          <div
            class="p-2.5 rounded-xl border text-center transition-all"
            [ngClass]="hasRuleForDimension(dim.key) ? 'bg-white border-slate-200 shadow-xs' : 'bg-slate-50 border-dashed border-slate-300 opacity-60'"
          >
            <span class="block text-[10px] font-mono font-bold uppercase" [class]="dim.color">
              {{ dim.key }}
            </span>
            <span class="block text-[11px] font-semibold text-slate-700 mt-0.5 truncate">
              {{ lang.isVietnamese() ? dim.labelVi : dim.labelEn }}
            </span>
            <span class="block text-[10px] font-mono mt-1" [class]="hasRuleForDimension(dim.key) ? 'text-emerald-600 font-bold' : 'text-slate-400'">
              {{ getDimensionRuleCount(dim.key) }} {{ lang.isVietnamese() ? 'quy tắc' : 'rules' }}
            </span>
          </div>
        }
      </div>

      <!-- KPI Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            {{ lang.isVietnamese() ? 'Tổng số quy tắc' : 'Total Rules' }}
          </div>
          <div class="text-2xl font-black text-navy mt-1">
            {{ rules().length }}
          </div>
          <div class="text-[11px] text-slate-500 mt-1">
            {{ activeRulesCount() }} {{ lang.isVietnamese() ? 'quy tắc đang kích hoạt' : 'active rules' }}
          </div>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
          <div class="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
            {{ lang.isVietnamese() ? 'Độ phủ 8 chiều' : '8-Dimension Coverage' }}
          </div>
          <div class="text-2xl font-black text-emerald-600 mt-1">
            {{ coveredDimensionsCount() }} / 8
          </div>
          <div class="text-[11px] text-emerald-700/80 mt-1">
            {{ coveredDimensionsCount() === 8 ? (lang.isVietnamese() ? 'Đầy đủ tất cả chiều định giá' : 'Full dimension coverage') : (lang.isVietnamese() ? 'Một số chiều chưa có quy tắc' : 'Missing some dimensions') }}
          </div>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            {{ lang.isVietnamese() ? 'Đơn vị tiền tệ chính thức' : 'Settlement Currency' }}
          </div>
          <div class="text-2xl font-black text-slate-700 mt-1 font-mono">
            VND (₫)
          </div>
          <div class="text-[11px] text-slate-500 mt-1">
            {{ lang.isVietnamese() ? 'Cố định theo quy chuẩn hệ thống' : 'Fixed system standard' }}
          </div>
        </div>
      </div>

      <!-- Main Rules Table -->
      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Mã quy tắc' : 'Rule ID' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Chiều định giá' : 'Dimension' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Hạng vé' : 'Cabin' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Giá phụ phí' : 'Amount' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Độ ưu tiên' : 'Priority' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Phiên bản' : 'Version' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Hiệu lực' : 'Effective' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Trạng thái' : 'Status' }}</th>
                <th class="py-3.5 px-4 text-right">{{ lang.isVietnamese() ? 'Thao tác' : 'Actions' }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="9" class="text-center py-12 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.isVietnamese() ? 'Đang tải danh sách quy tắc giá...' : 'Loading pricing rules...' }}
                  </td>
                </tr>
              } @else if (rules().length === 0) {
                <tr>
                  <td colspan="9" class="text-center py-12 text-slate-400">
                    <app-icon name="tag" class="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    {{ lang.isVietnamese() ? 'Chưa có quy tắc giá nào được cấu hình.' : 'No pricing rules configured.' }}
                  </td>
                </tr>
              } @else {
                @for (r of rules(); track r._id || r.rule_id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy">
                      {{ r.rule_id }}
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                        [ngClass]="getDimensionBadgeClass(r.pricing_dimension)"
                      >
                        {{ r.pricing_dimension }}
                      </span>
                    </td>
                    <td class="py-3.5 px-4 font-mono text-slate-600">
                      {{ r.cabin_class || 'ALL' }}
                    </td>
                    <td class="py-3.5 px-4 font-mono font-black text-amber-600">
                      {{ r.amount | number }} VND
                    </td>
                    <td class="py-3.5 px-4 font-mono text-slate-700">
                      {{ r.priority }}
                    </td>
                    <td class="py-3.5 px-4 font-mono text-slate-600">
                      v{{ r.version }}
                      @if (r.supersedes_rule_id) {
                        <span class="text-[10px] text-slate-400 block" [title]="'Thay thế ' + r.supersedes_rule_id">
                          (ex: {{ r.supersedes_rule_id }})
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                      <div>{{ r.effective_from | date:'yyyy-MM-dd' }}</div>
                      @if (r.effective_to) {
                        <div class="text-[10px] text-slate-400">→ {{ r.effective_to | date:'yyyy-MM-dd' }}</div>
                      }
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        [ngClass]="r.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'"
                      >
                        {{ r.is_active ? (lang.isVietnamese() ? 'Hoạt động' : 'Active') : (lang.isVietnamese() ? 'Vô hiệu' : 'Inactive') }}
                      </span>
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          (click)="openEditModal(r)"
                          class="p-1.5 hover:bg-slate-100 text-slate-600 rounded-full transition-colors"
                          [title]="lang.isVietnamese() ? 'Chỉnh sửa (Tạo phiên bản mới)' : 'Edit (Creates immutable successor)'"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>
                        @if (r.is_active) {
                          <button
                            type="button"
                            (click)="deactivateRule(r)"
                            class="p-1.5 hover:bg-rose-50 text-rose-600 rounded-full transition-colors"
                            [title]="lang.isVietnamese() ? 'Hủy kích hoạt' : 'Deactivate'"
                          >
                            <app-icon name="trash2" class="w-4 h-4" />
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create / Edit Modal -->
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto animate-fade-in">
            <!-- Modal Header -->
            <div class="bg-navy p-5 text-white flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-gold/20 border border-gold text-gold flex items-center justify-center">
                  <app-icon name="tag" class="w-4 h-4" />
                </div>
                <div>
                  <h3 class="font-bold text-white text-sm">
                    {{ isEditing()
                      ? (lang.isVietnamese() ? 'Chỉnh Sửa Quy Tắc (Tạo Phiên Bản Mới)' : 'Edit Pricing Rule (New Version)')
                      : (lang.isVietnamese() ? 'Tạo Quy Tắc Giá Mới' : 'Create New Pricing Rule') }}
                  </h3>
                  @if (isEditing()) {
                    <p class="text-[11px] text-slate-300 mt-0.5">
                      {{ lang.isVietnamese()
                        ? 'Cập nhật bất biến: Tạo phiên bản kế tiếp và vô hiệu hóa quy tắc cũ.'
                        : 'Immutable update: Creates successor version and deactivates current rule.' }}
                    </p>
                  }
                </div>
              </div>
              <button
                type="button"
                (click)="closeModal()"
                class="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-navy-light transition-colors"
              >
                <app-icon name="x" class="w-4 h-4" />
              </button>
            </div>

            <!-- Modal Form Body -->
            <div class="p-6 space-y-4 text-xs">
              <!-- Rule ID -->
              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.isVietnamese() ? 'Mã quy tắc (Rule ID):' : 'Rule ID:' }}
                </label>
                <input
                  type="text"
                  [(ngModel)]="formRuleId"
                  [disabled]="isEditing()"
                  placeholder="e.g., R-ECO-WINDOW-02"
                  class="w-full rounded-xl border border-slate-300 py-2 px-3 font-mono uppercase"
                  [class.bg-slate-100]="isEditing()"
                />
              </div>

              <!-- Pricing Dimension -->
              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.isVietnamese() ? 'Chiều định giá (8 Dimensions):' : 'Pricing Dimension (8 Dimensions):' }}
                </label>
                <select
                  [(ngModel)]="formPricingDimension"
                  [disabled]="isEditing()"
                  class="w-full rounded-xl border border-slate-300 py-2 px-3 bg-white font-mono"
                  [class.bg-slate-100]="isEditing()"
                >
                  <option value="CABIN_BASE">CABIN_BASE ({{ lang.isVietnamese() ? 'Giá nền theo hạng ghế' : 'Cabin base baseline' }})</option>
                  <option value="WINDOW">WINDOW ({{ lang.isVietnamese() ? 'Ghế cạnh cửa sổ' : 'Window seat' }})</option>
                  <option value="AISLE">AISLE ({{ lang.isVietnamese() ? 'Ghế cạnh lối đi' : 'Aisle seat' }})</option>
                  <option value="MIDDLE">MIDDLE ({{ lang.isVietnamese() ? 'Ghế ở giữa' : 'Middle seat' }})</option>
                  <option value="FRONT_ZONE">FRONT_ZONE ({{ lang.isVietnamese() ? 'Khu vực phía trước máy bay' : 'Front cabin zone' }})</option>
                  <option value="EXIT_ROW">EXIT_ROW ({{ lang.isVietnamese() ? 'Hàng ghế thoát hiểm khẩn cấp' : 'Emergency exit row' }})</option>
                  <option value="EXTRA_LEGROOM">EXTRA_LEGROOM ({{ lang.isVietnamese() ? 'Khoảng để chân rộng' : 'Extra legroom' }})</option>
                  <option value="BULKHEAD">BULKHEAD ({{ lang.isVietnamese() ? 'Hàng ghế sát vách ngăn' : 'Bulkhead wall row' }})</option>
                </select>
              </div>

              <!-- Cabin Class -->
              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.isVietnamese() ? 'Hạng vé áp dụng (Cabin Class):' : 'Cabin Class:' }}
                </label>
                <select
                  [(ngModel)]="formCabinClass"
                  [disabled]="isEditing()"
                  class="w-full rounded-xl border border-slate-300 py-2 px-3 bg-white font-mono"
                  [class.bg-slate-100]="isEditing()"
                >
                  <option value="ALL">ALL (Áp dụng tất cả hạng vé)</option>
                  <option value="ECONOMY">ECONOMY (Phổ thông)</option>
                  <option value="BUSINESS">BUSINESS (Thương gia)</option>
                  <option value="FIRST">FIRST (Hạng nhất)</option>
                  <option value="CLUB">CLUB (Aptech Club)</option>
                </select>
              </div>

              <!-- Amount & Priority -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-semibold text-slate-700 mb-1">
                    {{ lang.isVietnamese() ? 'Phụ phí (Amount VND):' : 'Amount (VND):' }}
                  </label>
                  <input
                    type="number"
                    [(ngModel)]="formAmount"
                    step="5000"
                    min="0"
                    class="w-full rounded-xl border border-slate-300 py-2 px-3 font-mono font-bold text-amber-600"
                  />
                </div>

                <div>
                  <label class="block font-semibold text-slate-700 mb-1">
                    {{ lang.isVietnamese() ? 'Độ ưu tiên (Priority):' : 'Priority:' }}
                  </label>
                  <input
                    type="number"
                    [(ngModel)]="formPriority"
                    step="1"
                    min="0"
                    class="w-full rounded-xl border border-slate-300 py-2 px-3 font-mono"
                  />
                </div>
              </div>

              <!-- Effective From & Effective To -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-semibold text-slate-700 mb-1">
                    {{ lang.isVietnamese() ? 'Hiệu lực từ ngày:' : 'Effective From:' }}
                  </label>
                  <input
                    type="date"
                    [(ngModel)]="formEffectiveFrom"
                    class="w-full rounded-xl border border-slate-300 py-2 px-3 font-mono"
                  />
                </div>

                <div>
                  <label class="block font-semibold text-slate-700 mb-1">
                    {{ lang.isVietnamese() ? 'Hiệu lực đến ngày (Tùy chọn):' : 'Effective To (Optional):' }}
                  </label>
                  <input
                    type="date"
                    [(ngModel)]="formEffectiveTo"
                    class="w-full rounded-xl border border-slate-300 py-2 px-3 font-mono"
                  />
                </div>
              </div>

              <!-- Action buttons -->
              <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  (click)="closeModal()"
                  class="btn-outline-navy text-xs !py-2.5 !px-4"
                >
                  {{ lang.isVietnamese() ? 'Hủy' : 'Cancel' }}
                </button>
                <button
                  type="button"
                  (click)="saveRule()"
                  [disabled]="modalSubmitting()"
                  class="btn-gold text-xs !py-2.5 !px-5 font-bold"
                >
                  <app-icon name="check" class="w-4 h-4" />
                  <span>{{ lang.isVietnamese() ? 'Lưu Quy Tắc' : 'Save Rule' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class SeatPricingComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly rules = signal<SeatPricingRule[]>([]);
  readonly loading = signal<boolean>(false);
  readonly showModal = signal<boolean>(false);
  readonly isEditing = signal<boolean>(false);
  readonly modalSubmitting = signal<boolean>(false);

  editingRuleId = '';

  // Form bindings matching backend schema
  formRuleId = '';
  formPricingDimension: SeatPricingRule['pricing_dimension'] = 'WINDOW';
  formAmount = 50000;
  formPriority = 10;
  formCabinClass = 'ECONOMY';
  formEffectiveFrom = '';
  formEffectiveTo = '';

  readonly standardDimensions = [
    { key: 'CABIN_BASE', labelVi: 'Hạng vé', labelEn: 'Cabin Base', color: 'text-blue-600' },
    { key: 'WINDOW', labelVi: 'Cửa sổ', labelEn: 'Window', color: 'text-indigo-600' },
    { key: 'AISLE', labelVi: 'Lối đi', labelEn: 'Aisle', color: 'text-sky-600' },
    { key: 'MIDDLE', labelVi: 'Ghế giữa', labelEn: 'Middle', color: 'text-slate-600' },
    { key: 'FRONT_ZONE', labelVi: 'Khu vực đầu', labelEn: 'Front Zone', color: 'text-amber-600' },
    { key: 'EXIT_ROW', labelVi: 'Thoát hiểm', labelEn: 'Exit Row', color: 'text-emerald-600' },
    { key: 'EXTRA_LEGROOM', labelVi: 'Chân rộng', labelEn: 'Extra Legroom', color: 'text-teal-600' },
    { key: 'BULKHEAD', labelVi: 'Vách ngăn', labelEn: 'Bulkhead', color: 'text-purple-600' },
  ];

  readonly activeRulesCount = computed(() => this.rules().filter((r) => r.is_active).length);

  readonly coveredDimensionsCount = computed(() => {
    const set = new Set(this.rules().filter((r) => r.is_active).map((r) => r.pricing_dimension));
    return set.size;
  });

  ngOnInit(): void {
    this.loadRules();
  }

  loadRules(): void {
    this.loading.set(true);
    this.api.getSeatPricingRules().subscribe({
      next: (data) => {
        this.rules.set(data || []);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Failed to fetch pricing rules');
      },
    });
  }

  hasRuleForDimension(dimension: string): boolean {
    return this.rules().some((r) => r.pricing_dimension === dimension && r.is_active);
  }

  getDimensionRuleCount(dimension: string): number {
    return this.rules().filter((r) => r.pricing_dimension === dimension && r.is_active).length;
  }

  getDimensionBadgeClass(dim: string): string {
    switch (dim) {
      case 'CABIN_BASE': return 'bg-blue-100 text-blue-800';
      case 'WINDOW': return 'bg-indigo-100 text-indigo-800';
      case 'AISLE': return 'bg-sky-100 text-sky-800';
      case 'MIDDLE': return 'bg-slate-100 text-slate-700';
      case 'FRONT_ZONE': return 'bg-amber-100 text-amber-800';
      case 'EXIT_ROW': return 'bg-emerald-100 text-emerald-800';
      case 'EXTRA_LEGROOM': return 'bg-teal-100 text-teal-800';
      case 'BULKHEAD': return 'bg-purple-100 text-purple-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  }

  openCreateModal(): void {
    this.isEditing.set(false);
    this.editingRuleId = '';
    this.formRuleId = '';
    this.formPricingDimension = 'WINDOW';
    this.formAmount = 50000;
    this.formPriority = 10;
    this.formCabinClass = 'ECONOMY';
    this.formEffectiveFrom = new Date().toISOString().substring(0, 10);
    this.formEffectiveTo = '';
    this.showModal.set(true);
  }

  openEditModal(rule: SeatPricingRule): void {
    this.isEditing.set(true);
    this.editingRuleId = rule.rule_id;
    this.formRuleId = rule.rule_id;
    this.formPricingDimension = rule.pricing_dimension;
    this.formAmount = rule.amount;
    this.formPriority = rule.priority;
    this.formCabinClass = rule.cabin_class || 'ALL';
    this.formEffectiveFrom = rule.effective_from ? new Date(rule.effective_from).toISOString().substring(0, 10) : '';
    this.formEffectiveTo = rule.effective_to ? new Date(rule.effective_to).toISOString().substring(0, 10) : '';
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  saveRule(): void {
    if (this.formAmount < 0) {
      this.toast.error('Amount cannot be negative');
      return;
    }

    this.modalSubmitting.set(true);

    if (this.isEditing()) {
      // EDIT: only supported immutable-successor update fields
      const payload: {
        amount: number;
        priority: number;
        effective_from?: Date;
        effective_to?: Date;
      } = {
        amount: this.formAmount,
        priority: this.formPriority,
        effective_from: this.formEffectiveFrom ? new Date(this.formEffectiveFrom) : undefined,
        effective_to: this.formEffectiveTo ? new Date(this.formEffectiveTo) : undefined,
      };

      this.api.updateSeatPricingRule(this.editingRuleId, payload).subscribe({
        next: () => {
          this.modalSubmitting.set(false);
          this.closeModal();
          this.toast.success(
            this.lang.isVietnamese() ? 'Đã tạo phiên bản mới của quy tắc giá!' : 'Pricing rule updated with new version!'
          );
          this.loadRules();
        },
        error: (err) => {
          this.modalSubmitting.set(false);
          this.toast.error(err?.error?.message || 'Failed to update rule');
        },
      });
    } else {
      // CREATE: rule_id, pricing_dimension, amount, cabin_class, priority, effective_from, effective_to?
      if (!this.formRuleId.trim()) {
        this.toast.error('Rule ID is required');
        this.modalSubmitting.set(false);
        return;
      }

      const payload = {
        rule_id: this.formRuleId.trim().toUpperCase(),
        pricing_dimension: this.formPricingDimension,
        amount: this.formAmount,
        cabin_class: this.formCabinClass || 'ALL',
        priority: this.formPriority,
        effective_from: this.formEffectiveFrom ? new Date(this.formEffectiveFrom) : new Date(),
        effective_to: this.formEffectiveTo ? new Date(this.formEffectiveTo) : undefined,
      };

      this.api.createSeatPricingRule(payload).subscribe({
        next: () => {
          this.modalSubmitting.set(false);
          this.closeModal();
          this.toast.success(
            this.lang.isVietnamese() ? 'Đã thêm quy tắc giá mới!' : 'Pricing rule created successfully!'
          );
          this.loadRules();
        },
        error: (err) => {
          this.modalSubmitting.set(false);
          this.toast.error(err?.error?.message || 'Failed to create rule');
        },
      });
    }
  }

  deactivateRule(rule: SeatPricingRule): void {
    const id = rule.rule_id;
    if (!confirm(this.lang.isVietnamese() ? `Hủy kích hoạt quy tắc ${id}?` : `Deactivate rule ${id}?`)) {
      return;
    }

    this.api.deleteSeatPricingRule(id).subscribe({
      next: () => {
        this.toast.success(
          this.lang.isVietnamese() ? 'Đã hủy kích hoạt quy tắc!' : 'Rule deactivated!'
        );
        this.loadRules();
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to deactivate rule');
      },
    });
  }
}
