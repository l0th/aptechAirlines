import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CommercialNetworkItinerary,
  CommercialNetworkLeg,
  CommercialScheduleTemplate,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-commercial-selected-journey',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="card-luxury p-6 sm:p-7 space-y-6">
      <!-- Section Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs font-black flex items-center justify-center">3</span>
            <h2 class="text-lg font-bold text-navy">{{ lang.t('admin.commercial.step3Heading') }}</h2>
          </div>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">
            {{ lang.t('admin.commercial.step3Subheading') }}
          </p>
        </div>

        <button
          type="button"
          (click)="changeItinerary.emit()"
          class="btn-outline-navy !py-2 !px-4 text-xs font-semibold self-start sm:self-auto"
        >
          <app-icon name="refreshcw" class="w-3.5 h-3.5" />
          <span>{{ lang.t('admin.commercial.btnChangeItinerary') }}</span>
        </button>
      </div>

      <!-- Selected Journey Banner -->
      <div class="p-4 bg-navy text-white rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div class="space-y-1">
          <span class="text-gold text-[11px] uppercase tracking-wider font-bold block">
            {{ lang.t('admin.commercial.selectedJourneyCardTitle') }}
          </span>
          <div class="flex items-center gap-2 font-mono text-lg sm:text-xl font-black">
            @for (airport of itinerary.airports; track airport; let i = $index) {
              <span>{{ airport }}</span>
              @if (i < itinerary.airports.length - 1) {
                <span class="text-gold">→</span>
              }
            }
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="px-3 py-1 bg-white/10 rounded-full text-xs font-mono">
            {{ getStopsLabel() }}
          </span>
        </div>
      </div>

      <!-- Inactive Template Warning Banner -->
      @if (hasInactiveTemplate) {
        <div class="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start justify-between gap-3 text-amber-900 animate-fade-in shadow-sm">
          <div class="flex items-start gap-3">
            <app-icon name="alerttriangle" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p class="text-xs sm:text-sm font-bold text-amber-950">
                {{ lang.t('admin.commercial.activateInactiveNotice') }}
              </p>
            </div>
          </div>
        </div>
      }

      <!-- Queue Action Banner (if pending legs exist) -->
      @if (!allCommercialized && uncommercializedCount > 0) {
        <div class="p-4 bg-amber-500/10 border border-gold/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-0.5">
            <p class="text-xs sm:text-sm font-bold text-navy">
              {{ lang.t('admin.commercial.btnCreateRemainingLegs').replace('{count}', String(uncommercializedCount)) }}
            </p>
            <p class="text-xs text-slate-500">
              {{ lang.t('admin.commercial.queueAutoAdvance') }}
            </p>
          </div>

          <button
            type="button"
            (click)="createRemainingQueue.emit()"
            class="btn-gold !py-2.5 !px-6 text-xs font-bold self-start sm:self-auto shadow-sm hover:shadow"
          >
            <app-icon name="slidershorizontal" class="w-4 h-4" />
            <span>{{ lang.t('admin.commercial.btnCreateRemainingLegs').replace('{count}', String(uncommercializedCount)) }}</span>
          </button>
        </div>
      }

      <!-- Vertical Leg Cards -->
      <div class="space-y-4">
        @for (leg of itinerary.legs; track leg.source_key; let legIdx = $index) {
          @let tpl = templateMap.get(leg.source_key);
          @let isCommercialized = !!tpl;
          @let isActive = tpl ? tpl.is_active : false;

          <div
            class="p-5 rounded-2xl border-2 transition-all space-y-3"
            [ngClass]="{
              'bg-emerald-50/40 border-emerald-200': isCommercialized && isActive,
              'bg-slate-50 border-slate-200': isCommercialized && !isActive,
              'bg-white border-gold/40 shadow-sm': !isCommercialized
            }"
          >
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <!-- Leg Title & Path -->
              <div class="flex items-center gap-2.5">
                <span class="w-7 h-7 rounded-xl bg-navy text-gold font-mono font-bold text-xs flex items-center justify-center">
                  {{ legIdx + 1 }}
                </span>
                <span class="font-mono text-base sm:text-lg font-black text-navy">
                  {{ leg.dep_iata }} → {{ leg.arr_iata }}
                </span>
                <span class="text-xs text-slate-400 font-mono">
                  ({{ leg.airline_iata || leg.airline_icao || 'AirLabs' }} {{ leg.flight_iata || leg.flight_number || '-' }})
                </span>
              </div>

              <!-- Status Badge & Main Action -->
              <div class="flex items-center gap-2 self-end sm:self-auto">
                @if (isCommercialized && isActive) {
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <app-icon name="checkcircle2" class="w-3.5 h-3.5 text-emerald-600" />
                    <span>{{ tpl?.flight_number }}</span>
                    <span class="text-[10px] font-mono text-emerald-600 uppercase">({{ lang.t('admin.commercial.statusActive') }})</span>
                  </span>
                  <button
                    type="button"
                    (click)="viewTemplate.emit(tpl!.flight_number)"
                    class="btn-ghost !py-1.5 !px-3 text-xs font-semibold"
                  >
                    <app-icon name="eye" class="w-3.5 h-3.5 text-navy" />
                    <span>{{ lang.t('admin.commercial.btnViewTemplate') }}</span>
                  </button>
                } @else if (isCommercialized && !isActive) {
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300">
                    <app-icon name="alerttriangle" class="w-3.5 h-3.5 text-amber-600" />
                    <span>{{ tpl?.flight_number }}</span>
                    <span class="text-[10px] font-mono text-slate-500 uppercase">({{ lang.t('admin.commercial.statusInactive') }})</span>
                  </span>
                  <button
                    type="button"
                    (click)="viewTemplate.emit(tpl!.flight_number)"
                    class="btn-ghost !py-1.5 !px-3 text-xs font-semibold"
                  >
                    <app-icon name="eye" class="w-3.5 h-3.5 text-navy" />
                    <span>{{ lang.t('admin.commercial.btnViewTemplate') }}</span>
                  </button>
                } @else {
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-gold/40">
                    <app-icon name="slidershorizontal" class="w-3.5 h-3.5 text-amber-600" />
                    <span>{{ lang.t('admin.commercial.statusNotCommercialized') }}</span>
                  </span>
                  <button
                    type="button"
                    [disabled]="loadingLegSourceKey === leg.source_key"
                    (click)="configureLeg.emit(leg)"
                    class="btn-gold !py-1.5 !px-4 text-xs font-bold shadow-sm"
                  >
                    @if (loadingLegSourceKey === leg.source_key) {
                      <app-icon name="refreshcw" class="w-3.5 h-3.5 animate-spin" />
                      <span>{{ lang.t('admin.commercial.loadingRouteRef') }}</span>
                    } @else {
                      <app-icon name="plus" class="w-3.5 h-3.5" />
                      <span>{{ lang.t('admin.commercial.btnConfigureLeg') }}</span>
                    }
                  </button>
                }
              </div>
            </div>

            <!-- Leg Details Metadata Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/60 text-xs font-mono text-slate-600">
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.scheduleUtc') }}</span>
                <span class="font-bold text-navy">{{ leg.dep_time_utc || '-' }}Z → {{ leg.arr_time_utc || '-' }}Z</span>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.durationLabel') }}</span>
                <span class="font-bold text-navy">{{ formatDuration(leg.duration_minutes) }}</span>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.aircraftIcao') }}</span>
                <span class="font-bold text-navy">{{ leg.aircraft_icao || '-' }}</span>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.operatingDaysHeader') }}</span>
                <span class="font-bold text-navy">{{ formatDays(leg.days) }}</span>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class CommercialSelectedJourneyComponent {
  readonly lang = inject(LanguageService);
  protected readonly String = String;

  @Input() itinerary!: CommercialNetworkItinerary;
  @Input() templateMap = new Map<string, CommercialScheduleTemplate>();
  @Input() loadingLegSourceKey: string | null = null;
  @Input() allCommercialized = false;
  @Input() allReadyToPublish = false;
  @Input() hasInactiveTemplate = false;
  @Input() uncommercializedCount = 0;

  @Output() changeItinerary = new EventEmitter<void>();
  @Output() configureLeg = new EventEmitter<CommercialNetworkLeg>();
  @Output() createRemainingQueue = new EventEmitter<void>();
  @Output() viewTemplate = new EventEmitter<string>();

  getStopsLabel(): string {
    const stops = this.itinerary?.stops?.length ?? 0;
    if (stops === 0) {
      return this.lang.t('admin.commercial.directFlight');
    }
    const template = stops === 1
      ? this.lang.t('admin.commercial.stopsCount')
      : this.lang.t('admin.commercial.stopsPlural');
    return template.replace('{stops}', String(stops));
  }

  formatDuration(minutes?: number): string {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatDays(days?: Array<number | string>): string {
    if (!days || days.length === 0) return '-';
    return days
      .map((d) => {
        const num = typeof d === 'number' ? d : parseInt(d, 10);
        return isNaN(num) ? String(d) : this.getDayLabel(num) || String(d);
      })
      .join(', ');
  }

  private getDayLabel(d: number): string {
    const map: Record<number, string> = {
      1: this.lang.t('admin.commercial.daysMonday'),
      2: this.lang.t('admin.commercial.daysTuesday'),
      3: this.lang.t('admin.commercial.daysWednesday'),
      4: this.lang.t('admin.commercial.daysThursday'),
      5: this.lang.t('admin.commercial.daysFriday'),
      6: this.lang.t('admin.commercial.daysSaturday'),
      7: this.lang.t('admin.commercial.daysSunday'),
    };
    return map[d] || d.toString();
  }
}
