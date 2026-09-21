import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  AirLabsRouteRef,
  CommercialAircraftLayout,
  CommercialNetworkLeg,
  CabinClass,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-commercialize-route-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between">
        <!-- Sticky Header -->
        <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white/95 backdrop-blur z-10">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-full bg-navy text-gold flex items-center justify-center">
              <app-icon name="plane" class="w-5 h-5 text-gold" />
            </div>
            <div>
              <h3 class="text-base font-bold text-navy">
                {{ lang.t('admin.commercial.drawerCommercializeTitle') }}
              </h3>
              <span class="text-xs font-mono font-bold text-slate-500">
                {{ route.dep_iata }} ➔ {{ route.arr_iata }}
              </span>
            </div>
          </div>

          <button
            type="button"
            (click)="onClose()"
            class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
          >
            <app-icon name="x" class="w-5 h-5" />
          </button>
        </div>

        <!-- Scrollable Body with 5 Sections -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <!-- Queue Progress Banner if in Queue -->
          @if (queue; as q) {
            <div class="p-3.5 bg-amber-500/10 border border-gold/40 rounded-2xl flex items-center gap-3 text-xs text-amber-950">
              <app-icon name="slidershorizontal" class="w-4 h-4 text-gold shrink-0" />
              <div>
                <strong class="block text-amber-950">
                  {{ lang.t('admin.commercial.queueStep')
                      .replace('{current}', String(q.currentIndex + 1))
                      .replace('{total}', String(q.legs.length))
                      .replace('{route}', route.dep_iata + ' ➔ ' + route.arr_iata) }}
                </strong>
                <span class="text-[11px] text-amber-800">
                  {{ lang.t('admin.commercial.queueAutoAdvance') }}
                </span>
              </div>
            </div>
          }

          <!-- SECTION 1: Source Route (Read-only) -->
          <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">
              {{ lang.t('admin.commercial.sectionSource') }}
            </span>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono text-slate-700">
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.colAirline') }}</span>
                <strong class="text-navy">{{ route.airline_iata || route.airline_icao || 'AirLabs' }}</strong>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.colFlight') }}</span>
                <strong class="text-navy">{{ route.flight_iata || route.flight_number || '-' }}</strong>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.aircraftIcao') }}</span>
                <strong>{{ route.aircraft_icao || '-' }}</strong>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.localTimes') }}</span>
                <span>{{ route.dep_time || '-' }} ➔ {{ route.arr_time || '-' }}</span>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.utcTimes') }}</span>
                <span>{{ route.dep_time_utc ? route.dep_time_utc + 'Z' : '-' }} ➔ {{ route.arr_time_utc ? route.arr_time_utc + 'Z' : '-' }}</span>
              </div>
              <div>
                <span class="text-slate-400 block text-[10px] uppercase">{{ lang.t('admin.commercial.durationLabel') }}</span>
                <span>{{ formatDuration(route.duration) }}</span>
              </div>
            </div>

            <!-- Operating Days Chips -->
            <div class="pt-1 border-t border-slate-200/60">
              <span class="text-[10px] uppercase text-slate-400 font-bold block mb-1.5">{{ lang.t('admin.commercial.operatingDaysHeader') }}</span>
              <div class="flex items-center gap-1 flex-wrap">
                @for (d of formatDayChips(route.days); track d.dayNum) {
                  <span
                    class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
                    [class]="d.active ? 'bg-amber-100 text-amber-900 border border-gold/40' : 'bg-slate-200 text-slate-400'"
                  >
                    {{ d.label }}
                  </span>
                }
              </div>
            </div>

            <!-- Technical source key in details -->
            <details class="text-[11px] text-slate-400 pt-1">
              <summary class="cursor-pointer hover:text-slate-600 select-none">{{ lang.t('admin.commercial.technicalKey') }}</summary>
              <code class="font-mono text-[10px] block mt-1 break-all bg-white p-2 rounded border border-slate-200">{{ route.source_key }}</code>
            </details>
          </div>

          <!-- SECTION 2: APTECH Flight -->
          <div class="p-4 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-sm">
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">
              {{ lang.t('admin.commercial.sectionAptech') }}
            </span>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Flight Number -->
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                  {{ lang.t('admin.commercial.flightNumber') }} *
                </label>
                <input
                  type="text"
                  [ngModel]="formFlightNumber"
                  (ngModelChange)="flightNumberChange.emit($event.trim().toUpperCase())"
                  [placeholder]="lang.t('admin.commercial.flightNumberPlaceholder')"
                  maxlength="10"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy uppercase focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold"
                />
              </div>

              <!-- Aircraft Type Selection -->
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                  {{ lang.t('admin.commercial.aircraftType') }} *
                </label>
                <select
                  [ngModel]="formAircraftType"
                  (ngModelChange)="aircraftTypeChange.emit($event)"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-navy focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold cursor-pointer"
                >
                  <option value="">{{ lang.t('admin.commercial.selectAircraft') }}</option>
                  @for (layout of aircraftLayouts; track layout.aircraft_type) {
                    <option [value]="layout.aircraft_type">
                      {{ layout.aircraft_type }} - {{ layout.model_name }} ({{ layout.total_capacity }} seats)
                    </option>
                  }
                </select>
              </div>
            </div>
          </div>

          <!-- SECTION 3: Cabin & Inventory -->
          <div class="p-4 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-navy uppercase tracking-wider block">
                {{ lang.t('admin.commercial.sectionCabins') }}
              </span>
              @if (selectedAircraftLayout; as lay) {
                <span class="text-xs font-mono font-bold text-navy bg-slate-100 px-2.5 py-1 rounded-lg">
                  {{ lang.t('admin.commercial.totalSeats').replace('{count}', String(lay.total_capacity)) }}
                </span>
              }
            </div>

            <!-- Incompatible warning -->
            @if (formIncompatibleCabins.length > 0) {
              <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-900">
                <span>{{ lang.t('admin.commercial.incompatibleCabinsNotice') }}: {{ formIncompatibleCabins.join(', ') }}</span>
                <button
                  type="button"
                  (click)="removeIncompatibleCabins.emit()"
                  class="btn-navy !py-1 !px-2.5 text-xs font-semibold shrink-0"
                >
                  {{ lang.t('admin.commercial.btnRemove') }}
                </button>
              </div>
            }

            <!-- Overcapacity Notice -->
            @if (formOvercapacityDetails.length > 0) {
              <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <span class="font-bold block">{{ lang.t('admin.commercial.overcapacityWarning') }}</span>
                @for (item of formOvercapacityDetails; track item.cabin) {
                  <p class="font-mono">• {{ item.cabin }}: {{ item.allocated }} > max {{ item.max }}</p>
                }
              </div>
            }

            <!-- Cabins List -->
            <div class="space-y-3">
              @for (cabin of allCabins; track cabin) {
                @let isSelected = formSelectedCabins.has(cabin);
                @let physCap = getPhysicalCap(cabin);

                <div
                  class="p-3.5 rounded-xl border transition-all"
                  [ngClass]="isSelected ? 'bg-slate-50 border-gold/40' : 'bg-white border-slate-200 opacity-70'"
                >
                  <div class="flex items-center justify-between">
                    <label class="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        [checked]="isSelected"
                        [disabled]="cabin === 'ECONOMY'"
                        (change)="toggleCabin.emit(cabin)"
                        class="rounded text-gold focus:ring-gold"
                      />
                      <span class="text-xs font-bold text-navy">{{ cabin }}</span>
                    </label>
                    <span class="text-xs font-mono text-slate-500">{{ lang.t('admin.commercial.maxPhysicalSeats').replace('{count}', String(physCap)) }}</span>
                  </div>

                  @if (isSelected) {
                    <div class="grid grid-cols-2 gap-3 pt-3 mt-2 border-t border-slate-200/60">
                      <div>
                        <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                          {{ lang.t('admin.commercial.allocatedSeats') }}
                        </label>
                        <input
                          type="number"
                          min="1"
                          [max]="physCap"
                          [ngModel]="formAllocatedSeats[cabin] || 0"
                          (ngModelChange)="allocatedSeatsChange.emit({ cabin, count: +$event })"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs font-bold text-navy focus:ring-1 focus:ring-gold"
                        />
                      </div>
                      <div>
                        <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                          {{ lang.t('admin.commercial.baseFare') }} (₫)
                        </label>
                        <input
                          type="number"
                          [ngModel]="formBasePrices[cabin]"
                          (ngModelChange)="basePriceChange.emit({ cabin, price: $event ? +$event : null })"
                          [placeholder]="cabin === 'ECONOMY' ? (lang.t('admin.commercial.fareRequiredPlaceholder')) : (lang.t('admin.commercial.autoPricing'))"
                          class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs font-bold text-navy focus:ring-1 focus:ring-gold"
                        />
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <!-- SECTION 4: Fares Note -->
          <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">
              {{ lang.t('admin.commercial.sectionFares') }}
            </span>
            <p class="text-slate-600">
              {{ lang.t('admin.commercial.faresExplainer') }}
            </p>
          </div>

          <!-- SECTION 5: Review Summary -->
          <div class="p-4 bg-amber-500/10 border border-gold/30 rounded-2xl space-y-2 text-xs">
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">
              {{ lang.t('admin.commercial.sectionReview') }}
            </span>
            <div class="grid grid-cols-2 gap-2 font-mono text-slate-800">
              <div>{{ lang.t('admin.commercial.lblFlight') }} <strong class="text-navy">{{ formFlightNumber || '-' }}</strong></div>
              <div>{{ lang.t('admin.commercial.lblRoute') }} <strong class="text-navy">{{ route.dep_iata }} ➔ {{ route.arr_iata }}</strong></div>
              <div>{{ lang.t('admin.commercial.lblAircraft') }} <strong class="text-navy">{{ formAircraftType || '-' }}</strong></div>
              <div>{{ lang.t('admin.commercial.lblCabins') }} <strong>{{ getSelectedCabinsList() }}</strong></div>
            </div>
          </div>
        </div>

        <!-- Sticky Footer -->
        <div class="p-4 sm:p-5 border-t border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          @if (queue) {
            <button
              type="button"
              (click)="cancelQueue.emit()"
              class="btn-ghost !py-2.5 !px-5 text-xs text-rose-600 hover:bg-rose-50"
            >
              {{ lang.t('admin.commercial.btnCancelQueue') }}
            </button>
          } @else {
            <button
              type="button"
              (click)="onClose()"
              class="btn-ghost !py-2.5 !px-5 text-xs"
            >
              {{ lang.t('common.cancel') }}
            </button>
          }

          <button
            type="button"
            (click)="submitCommercialize.emit()"
            [disabled]="submitting || !isFormValid"
            class="btn-gold !py-3 !px-7 text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-50"
          >
            @if (submitting) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              <span>{{ lang.t('admin.commercial.creating') }}</span>
            } @else if (queue && queue.currentIndex < queue.legs.length - 1) {
              <app-icon name="arrowright" class="w-4 h-4" />
              <span>{{ lang.t('admin.commercial.btnCreateAndContinue').replace('{next}', String(queue.currentIndex + 2)).replace('{total}', String(queue.legs.length)) }}</span>
            } @else {
              <app-icon name="checkcircle2" class="w-4 h-4" />
              <span>{{ lang.t('admin.commercial.btnCommercializeLeg') }}</span>
            }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CommercializeRouteDrawerComponent {
  readonly lang = inject(LanguageService);
  protected readonly String = String;

  readonly allCabins: CabinClass[] = [
    CabinClass.ECONOMY,
    CabinClass.BUSINESS,
    CabinClass.CLUB,
    CabinClass.FIRST,
  ];

  @Input() route!: AirLabsRouteRef;
  @Input() queue: { itineraryKey: string; legs: CommercialNetworkLeg[]; currentIndex: number } | null = null;
  @Input() aircraftLayouts: CommercialAircraftLayout[] = [];
  @Input() formFlightNumber = '';
  @Input() formAircraftType = '';
  @Input() formSelectedCabins = new Set<CabinClass>([CabinClass.ECONOMY]);
  @Input() formAllocatedSeats: Record<string, number> = {};
  @Input() formBasePrices: Record<string, number | null> = {};
  @Input() formMaterializeImmediately = false;
  @Input() formIncompatibleCabins: CabinClass[] = [];
  @Input() formOvercapacityDetails: Array<{ cabin: string; allocated: number; max: number }> = [];
  @Input() selectedAircraftLayout: CommercialAircraftLayout | null = null;
  @Input() isFormValid = false;
  @Input() submitting = false;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() cancelQueue = new EventEmitter<void>();
  @Output() flightNumberChange = new EventEmitter<string>();
  @Output() aircraftTypeChange = new EventEmitter<string>();
  @Output() toggleCabin = new EventEmitter<CabinClass>();
  @Output() allocatedSeatsChange = new EventEmitter<{ cabin: string; count: number }>();
  @Output() basePriceChange = new EventEmitter<{ cabin: string; price: number | null }>();
  @Output() materializeImmediatelyChange = new EventEmitter<boolean>();
  @Output() removeIncompatibleCabins = new EventEmitter<void>();
  @Output() submitCommercialize = new EventEmitter<void>();

  onClose(): void {
    this.closeDrawer.emit();
  }

  formatDuration(minutes?: number): string {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  getPhysicalCap(cabin: CabinClass): number {
    if (!this.selectedAircraftLayout) return 0;
    return this.selectedAircraftLayout.cabin_capacities[cabin] || 0;
  }

  getSelectedCabinsList(): string {
    return Array.from(this.formSelectedCabins).join(', ') || this.lang.t('admin.commercial.noneLabel');
  }

  formatDayChips(days?: string[]): Array<{ dayNum: number; label: string; active: boolean }> {
    const active = new Set<number>();
    if (days && Array.isArray(days)) {
      for (const raw of days) {
        if (!raw) continue;
        const d = raw.trim().toLowerCase();
        if (d === 'daily') {
          for (let i = 1; i <= 7; i++) active.add(i);
          continue;
        }
        if (d === '1' || d === 'mon' || d === 'monday') active.add(1);
        else if (d === '2' || d === 'tue' || d === 'tuesday') active.add(2);
        else if (d === '3' || d === 'wed' || d === 'wednesday') active.add(3);
        else if (d === '4' || d === 'thu' || d === 'thursday') active.add(4);
        else if (d === '5' || d === 'fri' || d === 'friday') active.add(5);
        else if (d === '6' || d === 'sat' || d === 'saturday') active.add(6);
        else if (d === '7' || d === 'sun' || d === 'sunday') active.add(7);
      }
    }
    const dayLabels: Record<number, string> = {
      1: this.lang.t('admin.commercial.daysMonday'),
      2: this.lang.t('admin.commercial.daysTuesday'),
      3: this.lang.t('admin.commercial.daysWednesday'),
      4: this.lang.t('admin.commercial.daysThursday'),
      5: this.lang.t('admin.commercial.daysFriday'),
      6: this.lang.t('admin.commercial.daysSaturday'),
      7: this.lang.t('admin.commercial.daysSunday'),
    };
    return [1, 2, 3, 4, 5, 6, 7].map((num) => ({
      dayNum: num,
      label: dayLabels[num] || String(num),
      active: active.has(num),
    }));
  }
}
