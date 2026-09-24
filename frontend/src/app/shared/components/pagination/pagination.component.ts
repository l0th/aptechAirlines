import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border-t border-slate-200 text-xs text-slate-600">
      <!-- Left: Range display -->
      <div class="font-medium text-slate-500 order-1 sm:order-none">
        {{ rangeText }}
      </div>

      <!-- Middle: Page size selector -->
      <div class="flex items-center gap-2 order-3 sm:order-none">
        <label [for]="selectId" class="text-slate-500 font-medium">
          {{ isVi ? 'Cỡ trang:' : 'Page size:' }}
        </label>
        <select
          [id]="selectId"
          [value]="pageSize"
          (change)="onPageSizeSelect($event)"
          class="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-gold"
        >
          @for (opt of pageSizeOptions; track opt) {
            <!-- [selected] cần thiết vì [value] trên <select> được áp trước khi @for render options,
                 khiến select hiển thị sai (luôn về option đầu = 10). -->
            <option [value]="opt" [selected]="opt === pageSize">{{ opt }} / {{ isVi ? 'trang' : 'page' }}</option>
          }
        </select>
      </div>

      <!-- Right: Navigation buttons -->
      <nav [attr.aria-label]="isVi ? 'Phân trang' : 'Pagination'" class="flex items-center gap-1 order-2 sm:order-none">
        <!-- First Page -->
        <button
          type="button"
          (click)="goToPage(1)"
          [disabled]="page <= 1"
          [attr.aria-label]="isVi ? 'Trang đầu' : 'First page'"
          class="w-7 h-7 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <app-icon name="chevronsleft" class="w-3.5 h-3.5" />
        </button>

        <!-- Previous Page -->
        <button
          type="button"
          (click)="goToPage(page - 1)"
          [disabled]="page <= 1"
          [attr.aria-label]="isVi ? 'Trang trước' : 'Previous page'"
          class="w-7 h-7 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <app-icon name="chevronleft" class="w-3.5 h-3.5" />
        </button>

        <!-- Numbered Buttons when totalPages <= 7 -->
        @if (totalPages <= 7) {
          @for (p of pageNumbers; track p) {
            <button
              type="button"
              (click)="goToPage(p)"
              [attr.aria-label]="(isVi ? 'Trang ' : 'Page ') + p"
              [attr.aria-current]="p === page ? 'page' : null"
              class="w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-colors"
              [ngClass]="p === page
                ? 'bg-navy text-gold border border-navy shadow-xs'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'"
            >
              {{ p }}
            </button>
          }
        }

        <!-- Current Page Indicator -->
        <span class="text-xs font-semibold text-slate-700 px-2 whitespace-nowrap">
          {{ isVi ? 'Trang' : 'Page' }} {{ page }} / {{ totalPages }}
        </span>

        <!-- Next Page -->
        <button
          type="button"
          (click)="goToPage(page + 1)"
          [disabled]="page >= totalPages"
          [attr.aria-label]="isVi ? 'Trang kế tiếp' : 'Next page'"
          class="w-7 h-7 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <app-icon name="chevronright" class="w-3.5 h-3.5" />
        </button>

        <!-- Last Page -->
        <button
          type="button"
          (click)="goToPage(totalPages)"
          [disabled]="page >= totalPages"
          [attr.aria-label]="isVi ? 'Trang cuối' : 'Last page'"
          class="w-7 h-7 flex items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <app-icon name="chevronsright" class="w-3.5 h-3.5" />
        </button>
      </nav>
    </div>
  `,
})
export class PaginationComponent {
  private readonly lang = inject(LanguageService, { optional: true });

  @Input() total = 0;
  @Input() page = 1;
  @Input() pageSize = 20;
  @Input() pageSizeOptions: number[] = [10, 20, 30, 50, 100];

  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  readonly selectId = `page-size-${Math.random().toString(36).slice(2, 8)}`;

  get isVi(): boolean {
    return this.lang?.isVietnamese?.() ?? true;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil((this.total || 0) / (this.pageSize || 1)));
  }

  get fromItem(): number {
    if (this.total <= 0) return 0;
    return (this.page - 1) * this.pageSize + 1;
  }

  get toItem(): number {
    if (this.total <= 0) return 0;
    return Math.min(this.total, this.page * this.pageSize);
  }

  get rangeText(): string {
    if (this.isVi) {
      return `Hiển thị ${this.fromItem}–${this.toItem} / tổng ${this.total}`;
    }
    return `Showing ${this.fromItem}–${this.toItem} of ${this.total}`;
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  goToPage(targetPage: number): void {
    const clamped = Math.max(1, Math.min(targetPage, this.totalPages));
    if (clamped !== this.page) {
      this.pageChange.emit(clamped);
    }
  }

  onPageSizeSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newSize = Number(select.value);
    if (!newSize || newSize <= 0 || newSize === this.pageSize) return;

    const firstItemIndex = Math.max(0, (this.page - 1) * this.pageSize);
    const newTotalPages = Math.max(1, Math.ceil((this.total || 0) / newSize));
    const newPage = Math.min(Math.max(1, Math.floor(firstItemIndex / newSize) + 1), newTotalPages);

    this.pageSizeChange.emit(newSize);
    if (newPage !== this.page) {
      this.pageChange.emit(newPage);
    }
  }
}
