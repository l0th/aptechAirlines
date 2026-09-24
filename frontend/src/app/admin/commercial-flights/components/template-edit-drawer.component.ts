import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CommercialScheduleTemplate,
  CommercialAircraftLayout,
  CabinClass,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-template-edit-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-xl h-full shadow-2xl p-6 border-l border-slate-200 overflow-y-auto flex flex-col justify-between">
        <div class="space-y-5">
          <!-- Drawer Header -->
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="edit" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.commercial.drawerEditTitle') }}</span>
            </h3>
            <button (click)="closeDrawer.emit()" class="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Template Route Header -->
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span class="font-black text-navy text-sm font-mono">{{ template.flight_number }}</span>
              <span class="text-slate-400 mx-1.5 font-mono">({{ template.template_id }})</span>
            </div>
            <div class="font-mono font-bold text-navy">
              {{ template.origin_iata }} → {{ template.dest_iata }}
            </div>
          </div>

          <!-- Form Fields -->
          <div class="space-y-4 text-xs">
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">
                {{ lang.t('admin.commercial.flightNumber') }} *
              </label>
              <input
                type="text"
                [ngModel]="editFlightNumber"
                (ngModelChange)="flightNumberChange.emit($event.trim().toUpperCase())"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy uppercase focus:ring-1 focus:ring-gold"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">
                {{ lang.t('admin.commercial.aircraftType') }} *
              </label>
              <select
                [ngModel]="editAircraftType"
                (ngModelChange)="aircraftTypeChange.emit($event)"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-navy focus:ring-1 focus:ring-gold cursor-pointer"
              >
                <option value="">{{ lang.t('admin.commercial.selectAircraft') }}</option>
                @for (layout of aircraftLayouts; track layout.aircraft_type) {
                  <option [value]="layout.aircraft_type">
                    {{ layout.aircraft_type }} - {{ layout.model_name }} ({{ layout.total_capacity }} seats)
                  </option>
                }
              </select>
            </div>

            <!-- Incompatibility & Overcapacity Warnings -->
            @if (editIncompatibleCabins.length > 0) {
              <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-center justify-between">
                <span>{{ lang.t('admin.commercial.incompatibleCabinsNotice') }}: {{ editIncompatibleCabins.join(', ') }}</span>
                <button
                  type="button"
                  (click)="removeIncompatibleCabins.emit()"
                  class="btn-navy !py-1 !px-2 text-[11px]"
                >
                  {{ lang.t('admin.commercial.btnRemove') }}
                </button>
              </div>
            }

            @if (editOvercapacityDetails.length > 0) {
              <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <span class="font-bold">{{ lang.t('admin.commercial.overcapacityWarning') }}</span>
                @for (item of editOvercapacityDetails; track item.cabin) {
                  <p class="font-mono">• {{ item.cabin }}: {{ item.allocated }} > max {{ item.max }}</p>
                }
              </div>
            }

            <!-- Cabins List -->
            <div class="space-y-3 pt-2">
              <span class="font-bold text-navy block uppercase text-[11px] tracking-wider">
                {{ lang.t('admin.commercial.cabinInventoryHeading') }}
              </span>
              @for (cabin of allCabins; track cabin) {
                @let isSelected = editSelectedCabins.has(cabin);
                @let physCap = getPhysicalCap(cabin);

                <div
                  class="p-3 rounded-xl border transition-all"
                  [ngClass]="isSelected ? 'bg-slate-50 border-gold/40' : 'bg-white border-slate-200 opacity-60'"
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
                      <span class="font-bold text-navy text-xs">{{ cabin }}</span>
                    </label>
                    <span class="text-[11px] font-mono text-slate-500">{{ lang.t('admin.commercial.maxPhysicalSeats').replace('{count}', String(physCap)) }}</span>
                  </div>

                  @if (isSelected) {
                    <div class="grid grid-cols-2 gap-2.5 pt-2 mt-2 border-t border-slate-200/60">
                      <div>
                        <label class="block text-[11px] font-medium text-slate-600 mb-1">
                          {{ lang.t('admin.commercial.allocatedSeats') }}
                        </label>
                        <input
                          type="number"
                          min="1"
                          [max]="physCap"
                          [ngModel]="editAllocatedSeats[cabin] || 0"
                          (ngModelChange)="allocatedSeatsChange.emit({ cabin, count: +$event })"
                          class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                        />
                      </div>
                      <div>
                        <label class="block text-[11px] font-medium text-slate-600 mb-1">
                          {{ lang.t('admin.commercial.baseFare') }} (₫)
                        </label>
                        <input
                          type="number"
                          [ngModel]="editBasePrices[cabin]"
                          (ngModelChange)="basePriceChange.emit({ cabin, price: $event ? +$event : null })"
                          [placeholder]="cabin === 'ECONOMY' ? (lang.t('admin.commercial.fareRequiredPlaceholder')) : (lang.t('admin.commercial.autoPricing'))"
                          class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                        />
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Active Status Toggle -->
            <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span class="font-bold text-navy text-xs">{{ lang.t('admin.commercial.colActiveToggle') }}</span>
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  [ngModel]="editIsActive"
                  (ngModelChange)="isActiveChange.emit($event)"
                  class="rounded text-gold focus:ring-gold"
                />
                <span class="text-xs font-semibold text-slate-700">
                  {{ editIsActive ? lang.t('admin.commercial.statusActive') : lang.t('admin.commercial.statusInactive') }}
                </span>
              </label>
            </div>
          </div>
        </div>

        <!-- Sticky Footer -->
        <div class="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            (click)="closeDrawer.emit()"
            class="btn-ghost text-xs"
          >
            {{ lang.t('common.cancel') }}
          </button>
          <button
            type="button"
            (click)="saveEdit.emit()"
            [disabled]="submittingEdit || !isEditFormValid"
            class="btn-gold text-xs !py-2.5 !px-6 font-bold disabled:opacity-50"
          >
            @if (submittingEdit) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
            }
            <span>{{ lang.t('admin.commercial.btnSaveTemplate') }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class TemplateEditDrawerComponent {
  readonly lang = inject(LanguageService);
  protected readonly String = String;

  readonly allCabins: CabinClass[] = [
    CabinClass.ECONOMY,
    CabinClass.BUSINESS,
    CabinClass.CLUB,
    CabinClass.FIRST,
  ];

  @Input() template!: CommercialScheduleTemplate;
  @Input() aircraftLayouts: CommercialAircraftLayout[] = [];
  @Input() editFlightNumber = '';
  @Input() editAircraftType = '';
  @Input() editSelectedCabins = new Set<CabinClass>();
  @Input() editAllocatedSeats: Record<string, number> = {};
  @Input() editBasePrices: Record<string, number | null> = {};
  @Input() editIsActive = true;
  @Input() submittingEdit = false;
  @Input() editIncompatibleCabins: CabinClass[] = [];
  @Input() editOvercapacityDetails: Array<{ cabin: string; allocated: number; max: number }> = [];
  @Input() editAircraftLayout: CommercialAircraftLayout | null = null;
  @Input() isEditFormValid = false;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() flightNumberChange = new EventEmitter<string>();
  @Output() aircraftTypeChange = new EventEmitter<string>();
  @Output() toggleCabin = new EventEmitter<CabinClass>();
  @Output() allocatedSeatsChange = new EventEmitter<{ cabin: string; count: number }>();
  @Output() basePriceChange = new EventEmitter<{ cabin: string; price: number | null }>();
  @Output() isActiveChange = new EventEmitter<boolean>();
  @Output() removeIncompatibleCabins = new EventEmitter<void>();
  @Output() saveEdit = new EventEmitter<void>();

  getPhysicalCap(cabin: CabinClass): number {
    if (!this.editAircraftLayout) return 0;
    return this.editAircraftLayout.cabin_capacities[cabin] || 0;
  }
}
