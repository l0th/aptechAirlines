import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CommercialNetworkItinerary,
  CommercialScheduleTemplate,
  MaterializeTemplateResponse,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-commercial-publish-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="card-luxury p-6 sm:p-7 space-y-6">
      <!-- Section Header -->
      <div class="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs font-black flex items-center justify-center">4</span>
            <h2 class="text-lg font-bold text-navy">{{ lang.t('admin.commercial.step4Heading') }}</h2>
          </div>
          <p class="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
            {{ lang.t('admin.commercial.step4Subheading') }}
          </p>
        </div>
      </div>

      <!-- State: Locked if not ready -->
      @if (!readyToPublish) {
        <div class="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-3">
          <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center mx-auto text-slate-400">
            <app-icon name="lock" class="w-5 h-5" />
          </div>
          <div class="space-y-1 max-w-md mx-auto">
            <h3 class="font-bold text-sm text-navy">
              {{ hasInactiveTemplate ? lang.t('admin.commercial.activateInactiveNotice') : lang.t('admin.commercial.step3Subheading') }}
            </h3>
            <p class="text-xs text-slate-500">
              {{ lang.t('admin.commercial.step4Desc') }}
            </p>
          </div>
        </div>
      }

      <!-- State: Ready to Publish Form -->
      @if (readyToPublish) {
        <div class="space-y-6">
          <!-- Horizon & Date Controls -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 bg-slate-50 rounded-2xl border border-slate-200/80">
            <!-- Preset & Custom Days -->
            <div class="space-y-2.5">
              <label class="block text-xs sm:text-sm font-semibold text-slate-700">
                {{ lang.t('admin.commercial.horizonLabel') }}
              </label>

              <!-- Presets -->
              <div class="flex items-center gap-2 flex-wrap">
                @for (preset of [30, 90, 180, 330]; track preset) {
                  <button
                    type="button"
                    (click)="daysChange.emit(preset)"
                    [disabled]="submitting"
                    class="px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    [ngClass]="{
                      'bg-navy text-gold shadow-md': days === preset,
                      'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200': days !== preset
                    }"
                  >
                    {{ preset }} {{ lang.t('admin.commercial.statTotalDays').toLowerCase() }}
                  </button>
                }
              </div>

              <!-- Custom Days Input -->
              <div class="pt-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-slate-500 font-medium whitespace-nowrap">
                    {{ lang.t('admin.commercial.horizonDaysCustom') }}:
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="330"
                    step="1"
                    [disabled]="submitting"
                    [ngModel]="days"
                    (ngModelChange)="daysChange.emit(+$event)"
                    class="w-24 px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-mono text-xs font-bold text-navy focus:ring-1 focus:ring-gold disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                @if (!isDaysValid) {
                  <p class="text-rose-600 text-xs mt-1">
                    {{ lang.t('admin.commercial.customDaysInvalid') }}
                  </p>
                }
              </div>
            </div>

            <!-- Start Date -->
            <div class="space-y-2.5">
              <label class="block text-xs sm:text-sm font-semibold text-slate-700">
                {{ lang.t('admin.commercial.horizonStartDate') }}
              </label>
              <input
                type="date"
                [disabled]="submitting"
                [ngModel]="startDate"
                (ngModelChange)="startDateChange.emit($event)"
                class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p class="text-xs text-slate-400">
                {{ lang.t('admin.commercial.materializeIdempotentNotice') }}
              </p>
            </div>
          </div>

          <!-- APTECH Flight Checklist Before Publish -->
          <div class="space-y-2">
            <span class="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              {{ lang.t('admin.commercial.legsToPublish') }}
            </span>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              @for (leg of itinerary.legs; track leg.source_key; let lIdx = $index) {
                @let tpl = templateMap.get(leg.source_key);
                <div class="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-2 shadow-sm">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-lg bg-navy text-gold font-mono text-xs font-bold flex items-center justify-center">
                      {{ lIdx + 1 }}
                    </span>
                    <strong class="font-mono text-sm text-navy">{{ tpl?.flight_number }}</strong>
                    <span class="font-mono text-xs text-slate-500">({{ tpl?.origin_iata }} ➔ {{ tpl?.dest_iata }})</span>
                  </div>
                  <span class="text-xs font-mono text-slate-400">{{ tpl?.aircraft_type }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Execute Button (Before First Run) -->
          @if (!summary) {
            <div class="flex items-center justify-end pt-2">
              <button
                type="button"
                (click)="generateSubmit.emit()"
                [disabled]="submitting || !isDaysValid"
                class="btn-gold !py-3 !px-8 text-sm font-bold shadow-md hover:shadow-lg disabled:opacity-50"
              >
                @if (submitting) {
                  <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                  <span>{{ lang.t('admin.commercial.btnGeneratingSchedule') }}</span>
                } @else {
                  <app-icon name="calendar" class="w-4 h-4" />
                  <span>{{ lang.t('admin.commercial.btnGenerateSchedule') }}</span>
                }
              </button>
            </div>
          }

          <!-- Per-Leg Progress Display -->
          @if (progress.length > 0) {
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              <span class="text-xs font-bold text-slate-700 block uppercase tracking-wider">
                {{ lang.t('admin.commercial.matProgressPerLeg') }}
              </span>
              <div class="space-y-2">
                @for (item of progress; track item.legIndex) {
                  <div class="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-bold text-navy">
                        {{ lang.t('admin.commercial.legNum').replace('{num}', String(item.legIndex + 1)) }}: {{ item.flightNumber }}
                      </span>
                    </div>

                    <div>
                      @if (item.status === 'PENDING') {
                        <span class="text-slate-400 font-semibold">{{ lang.t('admin.commercial.statusPending') }}</span>
                      } @else if (item.status === 'RUNNING') {
                        <span class="text-blue-600 font-bold inline-flex items-center gap-1">
                          <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                          <span>{{ lang.t('admin.commercial.statusRunning') }}</span>
                        </span>
                      } @else if (item.status === 'SUCCESS') {
                        <span class="text-emerald-600 font-bold inline-flex items-center gap-1">
                          <app-icon name="checkcircle2" class="w-3.5 h-3.5" />
                          <span>+{{ item.stats?.inserted_count || 0 }} {{ lang.t('admin.commercial.statNewFlights').toLowerCase() }}</span>
                        </span>
                      } @else if (item.status === 'ERROR') {
                        <span class="text-rose-600 font-bold inline-flex items-center gap-1">
                          <app-icon name="xcircle" class="w-3.5 h-3.5" />
                          <span>{{ item.error || lang.t('common.error') }}</span>
                        </span>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Post-Generation Results View -->
          @if (summary; as sum) {
            <!-- CASE 1: Full Success -->
            @if (sum.completedCount === itinerary.legs.length && !hasErrors) {
              <div class="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-2 border-emerald-300 rounded-3xl space-y-4 animate-fade-in shadow-md">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md">
                      <app-icon name="checkcircle2" class="w-7 h-7" />
                    </div>
                    <div>
                      <h3 class="text-lg font-black text-emerald-950">
                        {{ lang.t('admin.commercial.scheduleReadyTitle') }}
                      </h3>
                      <p class="text-xs sm:text-sm text-emerald-800 mt-0.5">
                        {{ lang.t('admin.commercial.scheduleReadyDesc') }}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    (click)="viewFlights.emit()"
                    class="btn-navy !py-3 !px-7 text-sm font-bold shadow-md hover:shadow-lg self-start shrink-0"
                  >
                    <app-icon name="plane" class="w-4 h-4 text-gold" />
                    <span>{{ lang.t('admin.commercial.btnViewFlights') }}</span>
                  </button>
                </div>

                <!-- High Level Metric Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono">
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-emerald-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statNewFlights') }}
                    </span>
                    <span class="text-2xl font-black text-emerald-600">+{{ sum.totalInserted }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-emerald-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statExistingKept') }}
                    </span>
                    <span class="text-2xl font-black text-navy">{{ sum.totalMatched }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-emerald-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statCompletedLegs') }}
                    </span>
                    <span class="text-2xl font-black text-slate-800">{{ sum.completedCount }} / {{ itinerary.legs.length }}</span>
                  </div>
                </div>

                <!-- Expandable Technical Details -->
                <details class="p-4 bg-white/60 rounded-2xl border border-emerald-200 text-xs space-y-3">
                  <summary class="cursor-pointer font-bold text-navy select-none flex items-center gap-1.5">
                    <app-icon name="info" class="w-4 h-4 text-gold" />
                    <span>{{ lang.t('admin.commercial.technicalStatsHeading') }}</span>
                  </summary>
                  <div class="space-y-3 pt-2">
                    @for (item of progress; track item.legIndex) {
                      @if (item.stats; as st) {
                        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                          <span class="font-bold text-navy font-mono text-xs block">
                            {{ item.flightNumber }}:
                          </span>
                          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-slate-700 text-[11px]">
                            <div>{{ lang.t('admin.commercial.statInserted') }}: <strong class="text-emerald-600">{{ st.inserted_count }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statMatched') }}: <strong class="text-navy">{{ st.matched_count }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statSkipped') }}: <strong>{{ st.skipped_existing }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statTotalOps') }}: <strong>{{ st.total_operations }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statTotalDays') }}: <strong>{{ st.total_days }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statDuration') }}: <strong>{{ st.duration_ms }}ms</strong></div>
                            <div>{{ lang.t('admin.commercial.statStartDate') }}: <strong>{{ st.start_date }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statEndDate') }}: <strong>{{ st.end_date }}</strong></div>
                          </div>
                        </div>
                      }
                    }
                  </div>
                </details>
              </div>
            } @else if (sum.completedCount > 0) {
              <!-- CASE 2: Partial Success -->
              <div class="p-6 bg-gradient-to-br from-amber-50 to-amber-100/50 border-2 border-amber-300 rounded-3xl space-y-4 animate-fade-in shadow-md">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md">
                      <app-icon name="alerttriangle" class="w-7 h-7" />
                    </div>
                    <div>
                      <h3 class="text-lg font-black text-amber-950">
                        {{ lang.t('admin.commercial.partialSuccessTitle') }}
                      </h3>
                      <p class="text-xs sm:text-sm text-amber-900 mt-0.5">
                        {{ lang.t('admin.commercial.partialSuccessDesc') }}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    (click)="generateSubmit.emit()"
                    [disabled]="submitting"
                    class="btn-gold !py-3 !px-7 text-sm font-bold shadow-md hover:shadow-lg self-start shrink-0"
                  >
                    @if (submitting) {
                      <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                      <span>{{ lang.t('admin.commercial.btnGeneratingSchedule') }}</span>
                    } @else {
                      <app-icon name="refreshcw" class="w-4 h-4" />
                      <span>{{ lang.t('admin.commercial.btnRetryFailedLegs') }}</span>
                    }
                  </button>
                </div>

                <!-- High Level Metric Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono">
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-amber-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statNewFlights') }}
                    </span>
                    <span class="text-2xl font-black text-emerald-600">+{{ sum.totalInserted }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-amber-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statExistingKept') }}
                    </span>
                    <span class="text-2xl font-black text-navy">{{ sum.totalMatched }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-amber-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statCompletedLegs') }}
                    </span>
                    <span class="text-2xl font-black text-amber-700">{{ sum.completedCount }} / {{ itinerary.legs.length }}</span>
                  </div>
                </div>

                <!-- Expandable Technical Details -->
                <details class="p-4 bg-white/60 rounded-2xl border border-amber-200 text-xs space-y-3">
                  <summary class="cursor-pointer font-bold text-navy select-none flex items-center gap-1.5">
                    <app-icon name="info" class="w-4 h-4 text-gold" />
                    <span>{{ lang.t('admin.commercial.technicalStatsHeading') }}</span>
                  </summary>
                  <div class="space-y-3 pt-2">
                    @for (item of progress; track item.legIndex) {
                      @if (item.stats; as st) {
                        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                          <span class="font-bold text-navy font-mono text-xs block">
                            {{ item.flightNumber }}:
                          </span>
                          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-slate-700 text-[11px]">
                            <div>{{ lang.t('admin.commercial.statInserted') }}: <strong class="text-emerald-600">{{ st.inserted_count }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statMatched') }}: <strong class="text-navy">{{ st.matched_count }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statSkipped') }}: <strong>{{ st.skipped_existing }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statTotalOps') }}: <strong>{{ st.total_operations }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statTotalDays') }}: <strong>{{ st.total_days }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statDuration') }}: <strong>{{ st.duration_ms }}ms</strong></div>
                            <div>{{ lang.t('admin.commercial.statStartDate') }}: <strong>{{ st.start_date }}</strong></div>
                            <div>{{ lang.t('admin.commercial.statEndDate') }}: <strong>{{ st.end_date }}</strong></div>
                          </div>
                        </div>
                      }
                    }
                  </div>
                </details>
              </div>
            } @else {
              <!-- CASE 3: All Failed -->
              <div class="p-6 bg-gradient-to-br from-rose-50 to-rose-100/50 border-2 border-rose-300 rounded-3xl space-y-4 animate-fade-in shadow-md">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-md">
                      <app-icon name="alerttriangle" class="w-7 h-7" />
                    </div>
                    <div>
                      <h3 class="text-lg font-black text-rose-950">
                        {{ lang.t('admin.commercial.allFailedTitle') }}
                      </h3>
                      <p class="text-xs sm:text-sm text-rose-900 mt-0.5">
                        {{ lang.t('admin.commercial.allFailedDesc') }}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    (click)="generateSubmit.emit()"
                    [disabled]="submitting"
                    class="btn-gold !py-3 !px-7 text-sm font-bold shadow-md hover:shadow-lg self-start shrink-0"
                  >
                    @if (submitting) {
                      <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                      <span>{{ lang.t('admin.commercial.btnGeneratingSchedule') }}</span>
                    } @else {
                      <app-icon name="refreshcw" class="w-4 h-4" />
                      <span>{{ lang.t('admin.commercial.btnRetryFailedLegs') }}</span>
                    }
                  </button>
                </div>

                <!-- High Level Metric Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono">
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-rose-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statNewFlights') }}
                    </span>
                    <span class="text-2xl font-black text-emerald-600">+{{ sum.totalInserted }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-rose-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statExistingKept') }}
                    </span>
                    <span class="text-2xl font-black text-navy">{{ sum.totalMatched }}</span>
                  </div>
                  <div class="p-3.5 bg-white/80 rounded-2xl border border-rose-200">
                    <span class="text-[11px] font-bold text-slate-500 uppercase block">
                      {{ lang.t('admin.commercial.statCompletedLegs') }}
                    </span>
                    <span class="text-2xl font-black text-rose-700">{{ sum.completedCount }} / {{ itinerary.legs.length }}</span>
                  </div>
                </div>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
})
export class CommercialPublishScheduleComponent {
  readonly lang = inject(LanguageService);
  protected readonly String = String;

  @Input() itinerary!: CommercialNetworkItinerary;
  @Input() templateMap = new Map<string, CommercialScheduleTemplate>();
  @Input() readyToPublish = false;
  @Input() hasInactiveTemplate = false;
  @Input() days = 30;
  @Input() startDate = '';
  @Input() isDaysValid = true;
  @Input() submitting = false;
  @Input() progress: Array<{
    legIndex: number;
    flightNumber: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR';
    stats?: MaterializeTemplateResponse;
    error?: string;
  }> = [];
  @Input() summary: { totalInserted: number; totalMatched: number; completedCount: number } | null = null;
  @Input() hasErrors = false;

  @Output() daysChange = new EventEmitter<number>();
  @Output() startDateChange = new EventEmitter<string>();
  @Output() generateSubmit = new EventEmitter<void>();
  @Output() viewFlights = new EventEmitter<void>();
  @Output() viewTemplate = new EventEmitter<string>();
}
