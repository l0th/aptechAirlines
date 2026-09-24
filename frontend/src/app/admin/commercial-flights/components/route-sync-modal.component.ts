import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-route-sync-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200 space-y-4">
        <!-- Header -->
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 class="text-base font-bold text-navy flex items-center gap-2">
            <app-icon name="refreshcw" class="w-5 h-5 text-gold" />
            <span>{{ lang.t('admin.commercial.syncModalTitle') }}</span>
          </h3>
          <button (click)="closeModal.emit()" class="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100">
            <app-icon name="x" class="w-5 h-5" />
          </button>
        </div>

        <p class="text-xs text-slate-500 leading-relaxed">
          {{ lang.t('admin.commercial.routeSyncNotice') }}
        </p>

        <!-- Form Fields -->
        <div class="space-y-3 text-xs">
          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">
              {{ lang.t('admin.commercial.syncDepIataLabel') }}
            </label>
            <input
              type="text"
              [ngModel]="depIata"
              (ngModelChange)="depIataChange.emit($event.trim().toUpperCase())"
              [placeholder]="lang.t('admin.commercial.airportIataPlaceholder')"
              maxlength="4"
              class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy uppercase focus:bg-white focus:ring-1 focus:ring-gold"
            />
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">
              {{ lang.t('admin.commercial.syncLimitLabel') }}
            </label>
            <input
              type="number"
              min="10"
              max="500"
              step="10"
              [ngModel]="limit"
              (ngModelChange)="limitChange.emit(+$event)"
              class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:bg-white focus:ring-1 focus:ring-gold"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            (click)="closeModal.emit()"
            class="btn-ghost text-xs"
          >
            {{ lang.t('common.cancel') }}
          </button>
          <button
            type="button"
            (click)="executeSync.emit()"
            [disabled]="syncing || !depIata.trim()"
            class="btn-gold text-xs !py-2.5 !px-6 font-bold disabled:opacity-50"
          >
            @if (syncing) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
            }
            <span>{{ lang.t('admin.commercial.syncExecuteBtn') }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class RouteSyncModalComponent {
  readonly lang = inject(LanguageService);

  @Input() depIata = 'SGN';
  @Input() limit = 200;
  @Input() syncing = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() depIataChange = new EventEmitter<string>();
  @Output() limitChange = new EventEmitter<number>();
  @Output() executeSync = new EventEmitter<void>();
}
