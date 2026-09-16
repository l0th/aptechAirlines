import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { CancellationPolicy } from '../../core/models/booking.model';

@Component({
  selector: 'app-policies-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PaginationComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.policies.title') }}</h1>
          <p class="text-xs text-slate-500">
            {{ lang.t('admin.policies.subtitle') }}
          </p>
        </div>

        <button
          type="button"
          (click)="openCreateModal()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold"
        >
          <app-icon name="plus" class="w-4 h-4" />
          <span>{{ lang.t('admin.policies.addPolicy') }}</span>
        </button>
      </div>

      <!-- Policies Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">{{ lang.t('admin.policies.minDays') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.policies.maxDays') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.policies.refundPercentage') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.policies.description') }}</th>
                <th class="py-3.5 px-4 text-right">{{ lang.t('common.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="5" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.t('admin.policies.loading') }}
                  </td>
                </tr>
              } @else {
                @for (p of pagedPolicies(); track p._id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy">
                      >= {{ p.min_days_before }} {{ lang.t('admin.policies.days') }}
                    </td>
                    <td class="py-3.5 px-4 font-mono text-slate-600">
                      {{ p.max_days_before !== null ? ('<= ' + p.max_days_before + ' ' + lang.t('admin.policies.days')) : lang.t('admin.policies.unlimited') }}
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
                      {{ (!lang.isVietnamese() && p.description_en) ? p.description_en : p.description }}
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          (click)="openEditModal(p)"
                          class="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          [title]="lang.t('common.edit')"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          (click)="deletePolicy(p)"
                          class="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                          [title]="lang.t('common.delete')"
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

        <app-pagination
          [total]="policies().length"
          [page]="page()"
          [pageSize]="pageSize()"
          [pageSizeOptions]="pageSizeOptions"
          (pageChange)="onPageChange($event)"
          (pageSizeChange)="onPageSizeChange($event)"
        />
      </div>

    </div>

    <!-- Modal Create / Edit Policy -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="shieldcheck" class="w-5 h-5 text-gold" />
              <span>{{ isEditMode ? lang.t('admin.policies.editPolicy') : lang.t('admin.policies.addNewPolicy') }}</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="savePolicy()" class="space-y-3 text-xs">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.policies.minDaysLabel') }}</label>
                <input
                  type="number"
                  [(ngModel)]="formData.min_days_before"
                  name="min_days"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.policies.maxDaysLabel') }}</label>
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
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.policies.refundPctLabel') }}</label>
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
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.policies.descLabel') || 'Mô tả (VI)' }}</label>
              <textarea
                [(ngModel)]="formData.description"
                name="desc"
                rows="2"
                required
                [placeholder]="lang.t('admin.policies.descPlaceholder')"
                class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              ></textarea>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Mô tả (EN)</label>
              <textarea
                [(ngModel)]="formData.description_en"
                name="desc_en"
                rows="2"
                placeholder="English description"
                class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              ></textarea>
            </div>

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">{{ lang.t('admin.policies.savePolicyBtn') }}</button>
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
  readonly lang = inject(LanguageService);

  readonly policies = signal<CancellationPolicy[]>([]);
  readonly loading = signal(false);

  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly pageSizeOptions = [10, 20, 30, 50, 100];

  readonly pagedPolicies = computed(() => {
    const list = this.policies();
    const p = this.page();
    const size = this.pageSize();
    const start = (p - 1) * size;
    return list.slice(start, start + size);
  });

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
        const maxPage = Math.max(1, Math.ceil(list.length / this.pageSize()));
        if (this.page() > maxPage) {
          this.page.set(maxPage);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.policies.loadError'));
      },
    });
  }

  onPageChange(newPage: number): void {
    this.page.set(newPage);
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize.set(newSize);
    this.page.set(1);
  }

  openCreateModal(): void {
    this.isEditMode = false;
    this.formData = {
      min_days_before: 7,
      max_days_before: 14,
      refund_percentage: 50,
      description: '',
      description_en: '',
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
      this.toast.warning(this.lang.t('admin.policies.fillAllWarning'));
      return;
    }

    if (this.isEditMode && this.formData._id) {
      this.api.updatePolicy(this.formData._id, this.formData).subscribe({
        next: () => {
          this.toast.success(this.lang.t('admin.policies.updateSuccess'));
          this.showModal.set(false);
          this.loadPolicies();
        },
        error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.policies.updateError')),
      });
    } else {
      this.api.createPolicy(this.formData).subscribe({
        next: () => {
          this.toast.success(this.lang.t('admin.policies.createSuccess'));
          this.showModal.set(false);
          this.loadPolicies();
        },
        error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.policies.createError')),
      });
    }
  }

  deletePolicy(p: CancellationPolicy): void {
    if (!p._id) return;
    const confirmMsg = `${this.lang.t('admin.policies.confirmDelete')} ${p.refund_percentage}%?`;
    if (!confirm(confirmMsg)) return;

    this.api.deletePolicy(p._id).subscribe({
      next: () => {
        this.toast.success(this.lang.t('admin.policies.deleteSuccess'));
        this.loadPolicies();
      },
      error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.policies.deleteError')),
    });
  }
}
