import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../../shared/components/pagination/pagination.component';
import {
  AirLabsRouteRef,
  CommercialScheduleTemplate,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-commercial-advanced-tools',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PaginationComponent],
  template: `
    <div class="card-luxury p-5 sm:p-6 space-y-4">
      <!-- Header with Expand/Collapse Trigger -->
      <button
        type="button"
        (click)="isOpen.set(!isOpen())"
        class="w-full flex items-center justify-between gap-4 text-left select-none group focus:outline-none"
      >
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-amber-100 text-navy group-hover:text-gold flex items-center justify-center transition-colors">
            <app-icon name="settings" class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-navy group-hover:text-gold-dark transition-colors">
              {{ lang.t('admin.commercial.btnAdvancedTools') }}
            </h3>
            <p class="text-xs text-slate-500 mt-0.5">
              {{ lang.t('admin.commercial.btnAdvancedToolsDesc') }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-slate-400 hidden sm:inline">
            {{ isOpen() ? lang.t('common.hide') : lang.t('common.show') }}
          </span>
          <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-slate-200 transition-colors">
            <app-icon [name]="isOpen() ? 'chevronup' : 'chevrondown'" class="w-4 h-4" />
          </div>
        </div>
      </button>

      <!-- Expandable Body -->
      @if (isOpen()) {
        <div class="pt-4 border-t border-slate-100 space-y-6 animate-fade-in">
          <!-- Compact System Statistics (The 4 KPIs) -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {{ lang.t('admin.commercial.kpiCachedRoutes') }}
              </span>
              <div class="flex items-baseline justify-between">
                <span class="text-xl font-black text-navy font-mono">{{ matchingRoutesCount }}</span>
                <app-icon name="compass" class="w-4 h-4 text-slate-300" />
              </div>
            </div>

            <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {{ lang.t('admin.commercial.kpiTemplatesTotal') }}
              </span>
              <div class="flex items-baseline justify-between">
                <span class="text-xl font-black text-navy font-mono">{{ templates.length }}</span>
                <app-icon name="slidershorizontal" class="w-4 h-4 text-slate-300" />
              </div>
            </div>

            <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {{ lang.t('admin.commercial.kpiActiveTemplates') }}
              </span>
              <div class="flex items-baseline justify-between">
                <span class="text-xl font-black text-emerald-600 font-mono">{{ activeTemplatesCount }}</span>
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-500" />
              </div>
            </div>

            <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {{ lang.t('admin.commercial.kpiCommercializedRoutes') }}
              </span>
              <div class="flex items-baseline justify-between">
                <span class="text-xl font-black text-gold-dark font-mono">{{ commercializedRoutesCount }}</span>
                <app-icon name="tag" class="w-4 h-4 text-gold" />
              </div>
            </div>
          </div>

          <!-- Secondary Sub-Tab Switcher -->
          <div class="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              (click)="activeSubTab.set('cache')"
              class="px-4 py-2 rounded-full text-xs font-bold transition-all"
              [ngClass]="activeSubTab() === 'cache' ? 'bg-navy text-gold shadow-sm' : 'text-slate-600 hover:bg-slate-100'"
            >
              <app-icon name="compass" class="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              <span>{{ lang.t('admin.commercial.tabRouteCache') }}</span>
            </button>

            <button
              type="button"
              (click)="activeSubTab.set('templates')"
              class="px-4 py-2 rounded-full text-xs font-bold transition-all"
              [ngClass]="activeSubTab() === 'templates' ? 'bg-navy text-gold shadow-sm' : 'text-slate-600 hover:bg-slate-100'"
            >
              <app-icon name="slidershorizontal" class="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              <span>{{ lang.t('admin.commercial.tabTemplates') }} ({{ templates.length }})</span>
            </button>
          </div>

          <!-- SUB-TAB 1: AirLabs Route Cache -->
          @if (activeSubTab() === 'cache') {
            <div class="space-y-4">
              <!-- Informational Notice on Single Airport Sync -->
              <div class="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5 text-xs text-blue-900">
                <app-icon name="info" class="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p class="leading-relaxed">
                  {{ lang.t('admin.commercial.routeSyncNotice') }}
                </p>
              </div>

              <!-- Filter Bar & Sync Action -->
              <div class="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-3">
                  <div class="flex items-center gap-1.5">
                    <label class="font-bold text-slate-600">{{ lang.t('admin.commercial.filterDep') }}:</label>
                    <input
                      type="text"
                      [ngModel]="filterDep"
                      (ngModelChange)="filterDepChange.emit($event.toUpperCase().trim())"
                      (keyup.enter)="loadRoutes.emit(1)"
                      placeholder="SGN, HAN..."
                      class="w-24 uppercase px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-navy focus:ring-1 focus:ring-gold"
                    />
                  </div>

                  <div class="flex items-center gap-1.5">
                    <label class="font-bold text-slate-600">{{ lang.t('admin.commercial.filterArr') }}:</label>
                    <input
                      type="text"
                      [ngModel]="filterArr"
                      (ngModelChange)="filterArrChange.emit($event.toUpperCase().trim())"
                      (keyup.enter)="loadRoutes.emit(1)"
                      placeholder="DAD, CXR..."
                      class="w-24 uppercase px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-navy focus:ring-1 focus:ring-gold"
                    />
                  </div>

                  <label class="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      [ngModel]="filterHasSchedule"
                      (ngModelChange)="filterHasScheduleChange.emit($event); loadRoutes.emit(1)"
                      class="rounded text-gold focus:ring-gold"
                    />
                    <span class="font-semibold text-slate-700">{{ lang.t('admin.commercial.filterHasSchedule') }}</span>
                  </label>

                  <button
                    type="button"
                    (click)="loadRoutes.emit(1)"
                    class="btn-navy !py-1.5 !px-3.5 text-xs font-bold"
                  >
                    <app-icon name="search" class="w-3.5 h-3.5" />
                    <span>{{ lang.t('admin.commercial.filterBtn') }}</span>
                  </button>
                </div>

                <!-- Single Airport Sync Button -->
                <button
                  type="button"
                  (click)="openSyncModal.emit()"
                  class="btn-gold !py-1.5 !px-4 text-xs font-bold"
                >
                  <app-icon name="refreshcw" class="w-3.5 h-3.5" />
                  <span>{{ lang.t('admin.commercial.syncHubBtn') }}</span>
                </button>
              </div>

              <!-- Routes Table with Horizontal Scroll Wrapper -->
              <div class="overflow-x-auto border border-slate-200 rounded-2xl bg-white">
                <table class="w-full text-xs text-left">
                  <thead class="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase text-[11px]">
                    <tr>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colRoute') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colAirline') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colFlight') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colTimes') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colDays') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colDuration') }}</th>
                      <th class="px-4 py-3 text-right">{{ lang.t('admin.commercial.colAction') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @if (routesLoading) {
                      <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400">
                          <app-icon name="refreshcw" class="w-5 h-5 animate-spin mx-auto mb-2 text-gold" />
                          <span>{{ lang.t('admin.commercial.loadingCachedRoutes') }}</span>
                        </td>
                      </tr>
                    } @else if (routes.length === 0) {
                      <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400">
                          {{ lang.t('admin.commercial.emptyRoutes') }}
                        </td>
                      </tr>
                    } @else {
                      @for (r of routes; track r.source_key) {
                        <tr class="hover:bg-slate-50/80 transition-colors font-mono">
                          <td class="px-4 py-3 font-bold text-navy">
                            {{ r.dep_iata }} ➔ {{ r.arr_iata }}
                          </td>
                          <td class="px-4 py-3 text-slate-700">
                            {{ r.airline_iata || r.airline_icao || '-' }}
                          </td>
                          <td class="px-4 py-3 text-navy font-bold">
                            {{ r.flight_iata || r.flight_number || '-' }}
                          </td>
                          <td class="px-4 py-3 text-slate-600">
                            {{ r.dep_time || '-' }} ➔ {{ r.arr_time || '-' }}
                          </td>
                          <td class="px-4 py-3 text-slate-600">
                            {{ formatDaysList(r.days) }}
                          </td>
                          <td class="px-4 py-3 text-slate-600">
                            {{ formatDuration(r.duration) }}
                          </td>
                          <td class="px-4 py-3 text-right">
                            <button
                              type="button"
                              (click)="inspectRoute.emit(r)"
                              class="btn-ghost !py-1 !px-2.5 text-xs text-navy"
                            >
                              <app-icon name="eye" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.btnInspect') }}</span>
                            </button>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              @if (routesTotal > routesLimit) {
                <div class="flex justify-end pt-2">
                  <app-pagination
                    [total]="routesTotal"
                    [pageSize]="routesLimit"
                    [page]="routesPage"
                    (pageChange)="loadRoutes.emit($event)"
                  />
                </div>
              }
            </div>
          }

          <!-- SUB-TAB 2: Commercial Templates -->
          @if (activeSubTab() === 'templates') {
            <div class="space-y-4">
              <!-- Search Bar -->
              <div class="flex items-center justify-between gap-3">
                <input
                  type="text"
                  [ngModel]="templateSearch"
                  (ngModelChange)="templateSearchChange.emit($event)"
                  [placeholder]="lang.t('admin.commercial.searchTemplatesPlaceholder')"
                  class="w-full max-w-md px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:ring-1 focus:ring-gold"
                />
              </div>

              <!-- Templates Table with Horizontal Scroll Wrapper -->
              <div class="overflow-x-auto border border-slate-200 rounded-2xl bg-white">
                <table class="w-full text-xs text-left">
                  <thead class="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase text-[11px]">
                    <tr>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colFlightNumber') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colRoute') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colAircraft') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colCabins') }}</th>
                      <th class="px-4 py-3">{{ lang.t('admin.commercial.colStatus') }}</th>
                      <th class="px-4 py-3 text-right">{{ lang.t('admin.commercial.colAction') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @if (templatesLoading) {
                      <tr>
                        <td colspan="6" class="p-8 text-center text-slate-400">
                          <app-icon name="refreshcw" class="w-5 h-5 animate-spin mx-auto mb-2 text-gold" />
                          <span>{{ lang.t('admin.commercial.loadingTemplates') }}</span>
                        </td>
                      </tr>
                    } @else if (filteredTemplates.length === 0) {
                      <tr>
                        <td colspan="6" class="p-8 text-center text-slate-400">
                          {{ lang.t('admin.commercial.emptyTemplates') }}
                        </td>
                      </tr>
                    } @else {
                      @for (t of filteredTemplates; track t.template_id) {
                        <tr class="hover:bg-slate-50/80 transition-colors font-mono">
                          <td class="px-4 py-3 font-bold text-navy">
                            {{ t.flight_number }}
                            <details class="text-[10px] text-slate-400 font-normal mt-0.5">
                              <summary class="cursor-pointer hover:text-slate-600">ID</summary>
                              <span>{{ t.template_id }}</span>
                            </details>
                          </td>
                          <td class="px-4 py-3 font-bold text-slate-800">
                            {{ t.origin_iata }} ➔ {{ t.dest_iata }}
                          </td>
                          <td class="px-4 py-3 text-slate-600">
                            {{ t.aircraft_type }}
                          </td>
                          <td class="px-4 py-3 text-slate-600">
                            {{ t.cabin_classes.join(', ') || 'ECONOMY' }}
                          </td>
                          <td class="px-4 py-3">
                            <label class="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                [checked]="t.is_active"
                                (change)="toggleTemplateStatus.emit({ id: t.template_id, isActive: !t.is_active })"
                                class="rounded text-gold focus:ring-gold"
                              />
                              <span
                                class="text-[11px] font-bold px-2 py-0.5 rounded-full"
                                [ngClass]="t.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'"
                              >
                                {{ t.is_active ? lang.t('admin.commercial.statusActive') : lang.t('admin.commercial.statusInactive') }}
                              </span>
                            </label>
                          </td>
                          <td class="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              (click)="openEditTemplate.emit(t)"
                              class="btn-ghost !py-1 !px-2 text-xs text-navy mr-1"
                              title="Edit Parameters"
                            >
                              <app-icon name="edit" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.btnEdit') }}</span>
                            </button>
                            <button
                              type="button"
                              (click)="openMaterializeTemplate.emit(t)"
                              class="btn-ghost !py-1 !px-2 text-xs text-gold-dark"
                              title="Materialize Horizon"
                            >
                              <app-icon name="calendar" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.btnMaterialize') }}</span>
                            </button>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class CommercialAdvancedToolsComponent {
  readonly lang = inject(LanguageService);

  readonly isOpen = signal(false);
  readonly activeSubTab = signal<'cache' | 'templates'>('cache');

  @Input() routes: AirLabsRouteRef[] = [];
  @Input() routesLoading = false;
  @Input() filterDep = '';
  @Input() filterArr = '';
  @Input() filterHasSchedule = true;
  @Input() routesPage = 1;
  @Input() routesLimit = 20;
  @Input() routesTotal = 0;
  @Input() templates: CommercialScheduleTemplate[] = [];
  @Input() filteredTemplates: CommercialScheduleTemplate[] = [];
  @Input() templatesLoading = false;
  @Input() templateSearch = '';
  @Input() matchingRoutesCount = 0;
  @Input() activeTemplatesCount = 0;
  @Input() commercializedRoutesCount = 0;

  @Output() filterDepChange = new EventEmitter<string>();
  @Output() filterArrChange = new EventEmitter<string>();
  @Output() filterHasScheduleChange = new EventEmitter<boolean>();
  @Output() loadRoutes = new EventEmitter<number>();
  @Output() openSyncModal = new EventEmitter<void>();
  @Output() inspectRoute = new EventEmitter<AirLabsRouteRef>();
  @Output() templateSearchChange = new EventEmitter<string>();
  @Output() toggleTemplateStatus = new EventEmitter<{ id: string; isActive: boolean }>();
  @Output() openEditTemplate = new EventEmitter<CommercialScheduleTemplate>();
  @Output() openMaterializeTemplate = new EventEmitter<CommercialScheduleTemplate>();

  formatDuration(minutes?: number): string {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatDaysList(days?: string[]): string {
    if (!days || days.length === 0) return '-';
    return days.join(', ');
  }
}
