import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CommercialScheduleTemplate,
  MaterializeTemplateResponse,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-single-template-materialize-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 class="text-base font-bold text-navy flex items-center gap-2">
            <app-icon name="calendar" class="w-5 h-5 text-gold" />
            <span>{{ lang.t('admin.commercial.materializeModalTitle') }}</span>
          </h3>
          <button (click)="closeModal.emit()" class="text-slate-400 hover:text-slate-600">
            <app-icon name="x" class="w-5 h-5" />
          </button>
        </div>

        <!-- Template Mini Info -->
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs font-mono">
          <div>
            <strong class="text-navy text-sm font-bold">{{ template.flight_number }}</strong>
            <span class="text-slate-400 mx-1">({{ template.template_id }})</span>
          </div>
          <span class="font-bold text-slate-700">{{ template.origin_iata }} ➔ {{ template.dest_iata }} ({{ template.aircraft_type }})</span>
        </div>

        <!-- Controls -->
        <div class="space-y-3 text-xs">
          <!-- Horizon Presets -->
          <div class="space-y-1.5">
            <label class="block font-semibold text-slate-700">{{ lang.t('admin.commercial.horizonLabel') }}:</label>
            <div class="flex items-center gap-2 flex-wrap">
              @for (preset of [30, 90, 180, 330]; track preset) {
                <button
                  type="button"
                  (click)="daysChange.emit(preset)"
                  class="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                  [ngClass]="days === preset ? 'bg-navy text-gold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
                >
                  {{ preset }} {{ lang.t('admin.commercial.daysUnit') }}
                </button>
              }
            </div>
          </div>

          <!-- Custom Days & Start Date -->
          <div class="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label class="block font-medium text-slate-600 mb-1">{{ lang.t('admin.commercial.horizonDaysCustom') }}:</label>
              <input
                type="number"
                min="1"
                max="330"
                [ngModel]="days"
                (ngModelChange)="daysChange.emit(+$event)"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-1 focus:ring-gold"
              />
              @if (!isDaysValid) {
                <p class="text-rose-600 text-[11px] mt-1">{{ lang.t('admin.commercial.customDaysInvalid') }}</p>
              }
            </div>
            <div>
              <label class="block font-medium text-slate-600 mb-1">{{ lang.t('admin.commercial.horizonStartDate') }}:</label>
              <input
                type="date"
                [ngModel]="startDate"
                (ngModelChange)="startDateChange.emit($event)"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>
        </div>

        <!-- Result Stats -->
        @if (materializeResult; as res) {
          <div class="p-4 bg-amber-50 border border-gold/40 rounded-2xl space-y-2 text-xs">
            <div class="flex items-center gap-2 font-bold text-navy">
              <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
              <span>{{ lang.t('admin.commercial.generationSummary') }}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 font-mono text-slate-700 pt-1">
              <div class="p-2 bg-white rounded border border-slate-200">
                <span class="text-slate-400 block text-[10px]">{{ lang.t('admin.commercial.statInserted') }}</span>
                <strong class="text-emerald-600 text-sm">+{{ res.inserted_count }}</strong>
              </div>
              <div class="p-2 bg-white rounded border border-slate-200">
                <span class="text-slate-400 block text-[10px]">{{ lang.t('admin.commercial.statMatched') }}</span>
                <strong class="text-navy text-sm">{{ res.matched_count }}</strong>
              </div>
              <div class="p-2 bg-white rounded border border-slate-200">
                <span class="text-slate-400 block text-[10px]">{{ lang.t('admin.commercial.statTotalDays') }}</span>
                <strong class="text-slate-800 text-sm">{{ res.total_days }}</strong>
              </div>
            </div>
          </div>
        }

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
            (click)="executeMaterialize.emit()"
            [disabled]="submitting || !isDaysValid"
            class="btn-gold text-xs !py-2.5 !px-6 font-bold disabled:opacity-50"
          >
            @if (submitting) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
            }
            <span>{{ lang.t('admin.commercial.btnExecuteMaterialize') }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class SingleTemplateMaterializeModalComponent {
  readonly lang = inject(LanguageService);

  @Input() template!: CommercialScheduleTemplate;
  @Input() days = 30;
  @Input() startDate = '';
  @Input() isDaysValid = true;
  @Input() submitting = false;
  @Input() materializeResult: MaterializeTemplateResponse | null = null;

  @Output() closeModal = new EventEmitter<void>();
  @Output() daysChange = new EventEmitter<number>();
  @Output() startDateChange = new EventEmitter<string>();
  @Output() executeMaterialize = new EventEmitter<void>();
}
