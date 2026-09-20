import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import {
  AirLabsRouteRef,
  CommercialAircraftLayout,
  CommercialScheduleTemplate,
  CommercializeRoutePayload,
  UpdateCommercialTemplatePayload,
  MaterializeTemplateResponse,
  CabinClass,
} from '../../core/models/flight.model';

@Component({
  selector: 'app-commercial-flights',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent, PaginationComponent],
  template: `
    <div class="space-y-6">

      <!-- Header & Navigation -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-gold/40 text-gold text-xs font-semibold mb-2">
            <app-icon name="plane" class="w-3.5 h-3.5" />
            <span>{{ lang.t('admin.commercial.tag') }}</span>
          </div>
          <h1 class="text-2xl font-black text-navy">{{ lang.t('admin.commercial.title') }}</h1>
          <p class="text-xs text-slate-500 mt-1 max-w-2xl">
            {{ lang.t('admin.commercial.subtitle') }}
          </p>
        </div>

        <div class="flex items-center gap-2.5 flex-wrap">
          <a
            routerLink="/admin/airlabs-sync"
            class="btn-outline-navy text-xs !py-2.5 !px-4 font-semibold inline-flex items-center gap-2"
          >
            <app-icon name="refreshcw" class="w-4 h-4" />
            <span>{{ lang.t('admin.commercial.rawSyncLink') }}</span>
          </a>
        </div>
      </div>

      <!-- Notice Banner: Separation of Commercial Operations vs Raw Reference Sync -->
      <div class="p-4 bg-navy text-slate-200 rounded-2xl border border-navy-light/40 flex items-start gap-3 text-xs shadow-sm">
        <app-icon name="info" class="w-5 h-5 text-gold shrink-0 mt-0.5" />
        <div class="space-y-1">
          <p class="font-bold text-white tracking-wide">
            {{ lang.t('admin.commercial.bannerTitle') }}
          </p>
          <p class="text-slate-300 leading-relaxed">
            {{ lang.t('admin.commercial.rawSyncNotice') }}
          </p>
        </div>
      </div>

      <!-- Grounded Summary Metric Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="card-luxury p-5 space-y-2">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            {{ lang.t('admin.commercial.kpiCachedRoutes') }}
          </span>
          <div class="flex items-baseline justify-between">
            <span class="text-2xl sm:text-3xl font-black text-navy font-mono">
              {{ matchingRoutesCount() }}
            </span>
            <app-icon name="compass" class="w-5 h-5 text-slate-300" />
          </div>
          <span class="text-[10px] text-slate-400 block truncate">
            {{ filterHasSchedule() ? lang.t('admin.commercial.kpiSubActiveRoutes') : lang.t('admin.commercial.kpiSubFilteredRoutes') }}
          </span>
        </div>

        <div class="card-luxury p-5 space-y-2">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            {{ lang.t('admin.commercial.kpiTemplatesTotal') }}
          </span>
          <div class="flex items-baseline justify-between">
            <span class="text-2xl sm:text-3xl font-black text-navy font-mono">
              {{ templates().length }}
            </span>
            <app-icon name="slidershorizontal" class="w-5 h-5 text-slate-300" />
          </div>
          <span class="text-[10px] text-slate-400 block truncate">
            {{ lang.t('admin.commercial.kpiSubCatalogTemplates') }}
          </span>
        </div>

        <div class="card-luxury p-5 space-y-2">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            {{ lang.t('admin.commercial.kpiActiveTemplates') }}
          </span>
          <div class="flex items-baseline justify-between">
            <span class="text-2xl sm:text-3xl font-black text-emerald-600 font-mono">
              {{ activeTemplatesCount() }}
            </span>
            <app-icon name="checkcircle2" class="w-5 h-5 text-emerald-500" />
          </div>
          <span class="text-[10px] text-slate-400 block truncate">
            {{ lang.t('admin.commercial.kpiSubActiveTemplates') }}
          </span>
        </div>

        <div class="card-luxury p-5 space-y-2">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            {{ lang.t('admin.commercial.kpiCommercializedRoutes') }}
          </span>
          <div class="flex items-baseline justify-between">
            <span class="text-2xl sm:text-3xl font-black text-gold font-mono">
              {{ commercializedRoutesCount() }}
            </span>
            <app-icon name="plane" class="w-5 h-5 text-gold" />
          </div>
          <span class="text-[10px] text-slate-400 block truncate">
            {{ lang.t('admin.commercial.kpiSubUniqueCommercialized') }}
          </span>
        </div>
      </div>

      <!-- Navigation Tabs (Pill style) -->
      <div class="flex items-center gap-3 border-b border-slate-200 pb-3 flex-wrap">
        <button
          type="button"
          (click)="activeTab.set('routes')"
          [class]="activeTab() === 'routes' ? 'btn-navy text-xs !py-2 !px-4 shadow-md' : 'btn-ghost text-xs !py-2 !px-4 text-slate-600 hover:text-navy'"
        >
          <app-icon name="compass" class="w-4 h-4" />
          <span>{{ lang.t('admin.commercial.tabRoutes') }}</span>
        </button>

        <button
          type="button"
          (click)="activeTab.set('templates')"
          [class]="activeTab() === 'templates' ? 'btn-navy text-xs !py-2 !px-4 shadow-md' : 'btn-ghost text-xs !py-2 !px-4 text-slate-600 hover:text-navy'"
        >
          <app-icon name="calendar" class="w-4 h-4" />
          <span>{{ lang.t('admin.commercial.tabTemplates') }} ({{ templates().length }})</span>
        </button>
      </div>

      <!-- TAB 1: AirLabs Route Network & Commercialization -->
      @if (activeTab() === 'routes') {
        <div class="space-y-4">

          <!-- Filters Row -->
          <div class="card-luxury p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex items-center gap-1.5">
                <label class="font-bold text-slate-600">{{ lang.t('admin.commercial.filterDep') }}:</label>
                <input
                  type="text"
                  [ngModel]="filterDep()"
                  (ngModelChange)="filterDep.set($event.toUpperCase().trim())"
                  (keyup.enter)="loadRoutes(1)"
                  placeholder="SGN, HAN..."
                  class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-navy focus:ring-1 focus:ring-gold"
                />
              </div>

              <div class="flex items-center gap-1.5">
                <label class="font-bold text-slate-600">{{ lang.t('admin.commercial.filterArr') }}:</label>
                <input
                  type="text"
                  [ngModel]="filterArr()"
                  (ngModelChange)="filterArr.set($event.toUpperCase().trim())"
                  (keyup.enter)="loadRoutes(1)"
                  placeholder="DAD, CXR..."
                  class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-navy focus:ring-1 focus:ring-gold"
                />
              </div>

              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  [ngModel]="filterHasSchedule()"
                  (ngModelChange)="filterHasSchedule.set($event); loadRoutes(1)"
                  class="rounded text-gold focus:ring-gold"
                />
                <span class="font-semibold text-slate-700">{{ lang.t('admin.commercial.filterHasSchedule') }}</span>
              </label>

              <button
                type="button"
                (click)="loadRoutes(1)"
                class="btn-navy text-xs !py-1.5 !px-3.5 font-bold"
              >
                <app-icon name="search" class="w-3.5 h-3.5" />
                <span>{{ lang.t('admin.commercial.filterBtn') }}</span>
              </button>
            </div>

            <!-- On-Demand Hub Sync Action -->
            <button
              type="button"
              (click)="openSyncModal()"
              class="btn-gold text-xs !py-1.5 !px-4 font-bold"
            >
              <app-icon name="refreshcw" class="w-3.5 h-3.5" />
              <span>{{ lang.t('admin.commercial.syncHubBtn') }}</span>
            </button>
          </div>

          <!-- Routes Table -->
          <div class="card-luxury overflow-hidden border-slate-200">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-navy text-slate-200 uppercase font-semibold">
                  <tr>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colCarrier') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colRoute') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colLocalTimes') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colUtcTimes') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colOperatingDays') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colDuration') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colStatus') }}</th>
                    <th class="py-3 px-4 text-right">{{ lang.t('admin.commercial.colActions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 font-medium bg-white">
                  @if (routesLoading()) {
                    <tr>
                      <td colspan="8" class="text-center py-12 text-slate-400">
                        <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                        <span>{{ lang.t('admin.commercial.loadingRoutes') }}</span>
                      </td>
                    </tr>
                  } @else if (!routes().length) {
                    <tr>
                      <td colspan="8" class="text-center py-12 text-slate-400">
                        <app-icon name="compass" class="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <span>{{ lang.t('admin.commercial.noRoutesFound') }}</span>
                      </td>
                    </tr>
                  } @else {
                    @for (r of routes(); track r.source_key) {
                      @let matchedTemplate = templateMapByRouteKey().get(r.source_key);
                      <tr class="hover:bg-slate-50/80 transition-colors">
                        <td class="py-3 px-4">
                          <div class="font-bold text-navy font-mono">
                            {{ r.airline_iata || r.airline_icao || 'AirLabs' }}
                            <span class="text-slate-500 font-normal">({{ r.flight_iata || r.flight_number || '-' }})</span>
                          </div>
                          @if (r.aircraft_icao) {
                            <span class="text-[10px] text-slate-400 font-mono block">A/C: {{ r.aircraft_icao }}</span>
                          }
                        </td>
                        <td class="py-3 px-4">
                          <div class="flex items-center gap-1 font-bold text-navy font-mono">
                            <span>{{ r.dep_iata }}</span>
                            <span class="text-slate-400 font-normal">→</span>
                            <span>{{ r.arr_iata }}</span>
                          </div>
                        </td>
                        <td class="py-3 px-4 font-mono">
                          {{ r.dep_time || '-' }} – {{ r.arr_time || '-' }}
                        </td>
                        <td class="py-3 px-4 font-mono text-slate-500 text-[11px]">
                          {{ r.dep_time_utc ? r.dep_time_utc + 'Z' : '-' }} – {{ r.arr_time_utc ? r.arr_time_utc + 'Z' : '-' }}
                        </td>
                        <td class="py-3 px-4">
                          <div class="flex items-center gap-1 flex-wrap">
                            @for (d of formatDayChips(r.days); track d.dayNum) {
                              <span
                                class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                                [class]="d.active ? 'bg-amber-100 text-amber-900 border border-gold/40' : 'bg-slate-100 text-slate-300'"
                              >
                                {{ d.label }}
                              </span>
                            }
                          </div>
                        </td>
                        <td class="py-3 px-4 font-mono text-slate-600">
                          {{ r.duration ? r.duration + ' ' + lang.t('admin.commercial.minsUnit') : '-' }}
                        </td>
                        <td class="py-3 px-4">
                          @if (matchedTemplate) {
                            <div class="space-y-0.5">
                              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <app-icon name="checkcircle2" class="w-3 h-3 text-emerald-600" />
                                <span>{{ lang.t('admin.commercial.statusCommercialized') }}</span>
                              </span>
                              <span class="text-[10px] font-mono text-slate-500 block font-semibold">
                                {{ matchedTemplate.flight_number }} ({{ matchedTemplate.template_id }})
                              </span>
                            </div>
                          } @else {
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              <span>{{ lang.t('admin.commercial.statusAvailable') }}</span>
                            </span>
                          }
                        </td>
                        <td class="py-3 px-4 text-right">
                          <div class="inline-flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              (click)="inspectRoute(r)"
                              class="btn-ghost text-[11px] !py-1 !px-2.5 font-semibold text-slate-600"
                            >
                              <app-icon name="info" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.actionInspect') }}</span>
                            </button>

                            @if (matchedTemplate) {
                              <!-- C3.1 BOUNDARY: NO Re-commercialize action. Show View Template only. -->
                              <button
                                type="button"
                                (click)="viewTemplate(matchedTemplate)"
                                class="btn-outline-navy text-[11px] !py-1 !px-3 font-semibold"
                              >
                                <app-icon name="calendar" class="w-3.5 h-3.5 text-gold" />
                                <span>{{ lang.t('admin.commercial.actionViewTemplate') }}</span>
                              </button>
                            } @else {
                              <button
                                type="button"
                                (click)="openCommercializeDrawer(r)"
                                class="btn-gold text-[11px] !py-1 !px-3 font-bold"
                              >
                                <app-icon name="plane" class="w-3.5 h-3.5" />
                                <span>{{ lang.t('admin.commercial.actionCommercialize') }}</span>
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

            <!-- Pagination -->
            @if (routesTotal() > 0) {
              <app-pagination
                [total]="routesTotal()"
                [page]="routesPage()"
                [pageSize]="routesLimit()"
                [pageSizeOptions]="[10, 20, 50, 100]"
                (pageChange)="loadRoutes($event)"
                (pageSizeChange)="onRoutesLimitChange($event)"
              />
            }
          </div>

        </div>
      }

      <!-- TAB 2: Aptech Commercial Templates & Materialization -->
      @if (activeTab() === 'templates') {
        <div class="space-y-4">

          <!-- Filter & Search Bar -->
          <div class="card-luxury p-4 flex items-center justify-between gap-3 flex-wrap text-xs">
            <div class="flex items-center gap-2 flex-1 min-w-[240px]">
              <app-icon name="search" class="w-4 h-4 text-slate-400" />
              <input
                type="text"
                [ngModel]="templateSearch()"
                (ngModelChange)="templateSearch.set($event)"
                [placeholder]="lang.t('admin.commercial.templateSearch')"
                class="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-1 focus:ring-gold"
              />
            </div>

            <button
              type="button"
              (click)="refreshTemplatesCatalog()"
              [disabled]="templatesLoading()"
              class="btn-outline-navy text-xs !py-1.5 !px-3 font-semibold inline-flex items-center gap-1.5"
            >
              <app-icon name="refreshcw" class="w-3.5 h-3.5" [class.animate-spin]="templatesLoading()" />
              <span>{{ lang.t('admin.commercial.reloadCatalog') }}</span>
            </button>
          </div>

          <!-- Templates Table -->
          <div class="card-luxury overflow-hidden border-slate-200">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-navy text-slate-200 uppercase font-semibold">
                  <tr>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colTemplateId') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colFlightNumber') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colRoute') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colLocalTimes') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colAircraft') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.colOperatingDays') }}</th>
                    <th class="py-3 px-4">{{ lang.t('admin.commercial.cabinsAndInventory') }}</th>
                    <th class="py-3 px-4 text-center">{{ lang.t('admin.commercial.colActiveToggle') }}</th>
                    <th class="py-3 px-4 text-right">{{ lang.t('admin.commercial.colActions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 font-medium bg-white">
                  @if (templatesLoading()) {
                    <tr>
                      <td colspan="9" class="text-center py-12 text-slate-400">
                        <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                        <span>{{ lang.t('admin.commercial.loadingTemplates') }}</span>
                      </td>
                    </tr>
                  } @else if (!filteredTemplates().length) {
                    <tr>
                      <td colspan="9" class="text-center py-12 text-slate-400">
                        <app-icon name="calendar" class="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <span>{{ lang.t('admin.commercial.noTemplatesFound') }}</span>
                      </td>
                    </tr>
                  } @else {
                    @for (t of filteredTemplates(); track t.template_id) {
                      <tr class="hover:bg-slate-50/80 transition-colors">
                        <td class="py-3 px-4 font-mono font-bold text-navy">
                          {{ t.template_id }}
                          @if (t.source_route_key) {
                            <div class="text-[10px] font-normal text-slate-400 truncate max-w-[140px]" [title]="t.source_route_key">
                              {{ lang.t('admin.commercial.labelSrc') }} {{ t.source_route_key }}
                            </div>
                          }
                        </td>
                        <td class="py-3 px-4">
                          <span class="font-black text-navy font-mono text-sm px-2 py-0.5 rounded-lg bg-amber-500/15 border border-gold/40 text-gold">
                            {{ t.flight_number }}
                          </span>
                        </td>
                        <td class="py-3 px-4">
                          <span class="font-bold text-navy font-mono">{{ t.origin_iata }}</span>
                          <span class="text-slate-400 mx-1">→</span>
                          <span class="font-bold text-navy font-mono">{{ t.dest_iata }}</span>
                        </td>
                        <td class="py-3 px-4 font-mono">
                          {{ t.std_dep_time || '-' }} – {{ t.std_arr_time || '-' }}
                        </td>
                        <td class="py-3 px-4 font-bold text-navy font-mono">
                          {{ t.aircraft_type }}
                        </td>
                        <td class="py-3 px-4">
                          <div class="flex items-center gap-1 flex-wrap">
                            @for (d of formatTemplateDaysChips(t.days_of_week); track d.dayNum) {
                              <span
                                class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                                [class]="d.active ? 'bg-amber-100 text-amber-900 border border-gold/40' : 'bg-slate-100 text-slate-300'"
                              >
                                {{ d.label }}
                              </span>
                            }
                          </div>
                        </td>
                        <td class="py-3 px-4">
                          <div class="space-y-1">
                            @for (inv of t.commercial_inventories; track inv.cabin_class) {
                              <div class="text-[11px] flex items-center gap-1.5">
                                <span class="font-bold text-slate-700">{{ inv.cabin_class }}:</span>
                                <span class="font-mono text-slate-600">{{ inv.allocated_seats }} {{ lang.t('admin.commercial.seatsUnit') }}</span>
                                <span class="text-[10px] text-slate-400 font-mono">({{ formatCabinFareDisplay(t.base_price_economy, inv.cabin_class, t) }})</span>
                              </div>
                            }
                          </div>
                        </td>
                        <td class="py-3 px-4 text-center">
                          <button
                            type="button"
                            (click)="toggleTemplateStatus(t)"
                            class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold transition-all"
                            [class]="t.is_active ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                          >
                            <span class="w-1.5 h-1.5 rounded-full mr-1.5" [class]="t.is_active ? 'bg-emerald-600' : 'bg-slate-400'"></span>
                            <span>{{ t.is_active ? lang.t('admin.commercial.statusActive') : lang.t('admin.commercial.statusInactive') }}</span>
                          </button>
                        </td>
                        <td class="py-3 px-4 text-right">
                          <div class="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              (click)="openEditDrawer(t)"
                              class="btn-outline-navy text-[11px] !py-1 !px-2.5 font-semibold"
                            >
                              <app-icon name="edit" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.btnEditTemplate') }}</span>
                            </button>

                            <button
                              type="button"
                              (click)="openMaterializeModal(t)"
                              [disabled]="!t.is_active"
                              class="btn-gold text-[11px] !py-1 !px-3 font-bold disabled:opacity-40"
                            >
                              <app-icon name="calendar" class="w-3.5 h-3.5" />
                              <span>{{ lang.t('admin.commercial.btnMaterialize') }}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>

        </div>
      }

    </div>

    <!-- MODAL 1: On-Demand Hub Route Sync -->
    @if (syncModalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200 space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="refreshcw" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.commercial.syncModalTitle') }}</span>
            </h3>
            <button (click)="syncModalOpen.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <p class="text-xs text-slate-500 leading-relaxed">
            {{ lang.t('admin.commercial.syncModalDesc') }}
          </p>

          <div class="space-y-3 text-xs">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">
                {{ lang.t('admin.commercial.syncDepLabel') }}
              </label>
              <input
                type="text"
                [ngModel]="syncDepIata()"
                (ngModelChange)="syncDepIata.set($event.toUpperCase().trim())"
                placeholder="SGN, HAN, DAD..."
                maxlength="3"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1">
                {{ lang.t('admin.commercial.syncLimitLabel') }}
              </label>
              <input
                type="number"
                [ngModel]="syncLimit()"
                (ngModelChange)="syncLimit.set(+$event)"
                min="1"
                max="200"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
              />
            </div>
          </div>

          <div class="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              (click)="syncModalOpen.set(false)"
              class="btn-ghost text-xs"
            >
              {{ lang.t('common.cancel') }}
            </button>
            <button
              type="button"
              (click)="executeAirportSync()"
              [disabled]="syncing() || !syncDepIata()"
              class="btn-gold text-xs !py-2.5 !px-5 font-bold"
            >
              @if (syncing()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.t('admin.commercial.syncBtn') }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- DRAWER 1: Inspect AirLabs RouteRef Detail -->
    @if (inspectingRoute(); as r) {
      <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg h-full shadow-2xl p-6 border-l border-slate-200 overflow-y-auto flex flex-col justify-between">
          <div class="space-y-5">
            <div class="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 class="text-base font-bold text-navy flex items-center gap-2">
                <app-icon name="compass" class="w-5 h-5 text-gold" />
                <span>{{ lang.t('admin.commercial.drawerInspectTitle') }}</span>
              </h3>
              <button (click)="inspectingRoute.set(null)" class="text-slate-400 hover:text-slate-600">
                <app-icon name="x" class="w-5 h-5" />
              </button>
            </div>

            <!-- Route Header Banner -->
            <div class="p-4 bg-navy text-white rounded-2xl flex items-center justify-between">
              <div>
                <span class="text-xs text-gold uppercase tracking-wider block font-bold">
                  {{ r.airline_iata || r.airline_icao || lang.t('admin.commercial.airlabsPartner') }}
                </span>
                <span class="text-lg font-black font-mono">
                  {{ r.flight_iata || r.flight_number || lang.t('admin.commercial.notAvailable') }}
                </span>
              </div>
              <div class="text-right">
                <span class="text-xl font-black font-mono">{{ r.dep_iata }} → {{ r.arr_iata }}</span>
                <span class="text-xs text-slate-300 block font-mono">
                  {{ r.duration ? r.duration + ' ' + lang.t('admin.commercial.minsUnit') : lang.t('admin.commercial.durationNA') }}
                </span>
              </div>
            </div>

            <!-- Provenance Detail Grid -->
            <div class="card-luxury p-4 space-y-2.5 text-xs">
              <span class="font-bold text-navy uppercase tracking-wider text-[11px] block border-b border-slate-100 pb-1.5">
                {{ lang.t('admin.commercial.sourceProvenance') }}
              </span>

              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceCarrier') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.airline_iata || r.airline_icao || '-' }}</span>
                </div>
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceFlight') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.flight_iata || r.flight_number || '-' }}</span>
                </div>
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceLocalClocks') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.dep_time || '-' }} → {{ r.arr_time || '-' }}</span>
                </div>
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceUtcClocks') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.dep_time_utc ? r.dep_time_utc + 'Z' : '-' }} → {{ r.arr_time_utc ? r.arr_time_utc + 'Z' : '-' }}</span>
                </div>
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceAircraft') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.aircraft_icao || '-' }}</span>
                </div>
                <div>
                  <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceSyncedAt') }}</span>
                  <span class="font-bold text-navy font-mono">{{ r.synced_at ? (r.synced_at | date:'yyyy-MM-dd HH:mm') : '-' }}</span>
                </div>
              </div>

              <div class="pt-2 border-t border-slate-100">
                <span class="text-slate-400 block">{{ lang.t('admin.commercial.sourceKey') }}</span>
                <span class="font-mono text-[11px] text-slate-700 break-all select-all font-semibold">{{ r.source_key }}</span>
              </div>
            </div>
          </div>

          <div class="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              (click)="inspectingRoute.set(null)"
              class="btn-navy text-xs !py-2 !px-5"
            >
              {{ lang.t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- DRAWER 2: Commercialize Route Configuration -->
    @if (commercializingRoute(); as r) {
      <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-xl h-full shadow-2xl p-6 border-l border-slate-200 overflow-y-auto flex flex-col justify-between">
          <div class="space-y-5">
            <div class="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 class="text-base font-bold text-navy flex items-center gap-2">
                <app-icon name="plane" class="w-5 h-5 text-gold" />
                <span>{{ lang.t('admin.commercial.drawerCommercializeTitle') }}</span>
              </h3>
              <button (click)="commercializingRoute.set(null)" class="text-slate-400 hover:text-slate-600">
                <app-icon name="x" class="w-5 h-5" />
              </button>
            </div>

            <!-- Read-only Source Summary Banner -->
            <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div class="flex items-center justify-between font-bold text-navy">
                <span>{{ r.airline_iata || r.airline_icao || 'AirLabs' }} ({{ r.flight_iata || r.flight_number || '-' }})</span>
                <span class="font-mono">{{ r.dep_iata }} → {{ r.arr_iata }}</span>
              </div>
              <div class="flex items-center justify-between text-slate-500 font-mono text-[11px]">
                <span>{{ lang.t('admin.commercial.labelLocal') }} {{ r.dep_time || '-' }} → {{ r.arr_time || '-' }}</span>
                <span>{{ lang.t('admin.commercial.labelUtc') }} {{ r.dep_time_utc ? r.dep_time_utc + 'Z' : '-' }} → {{ r.arr_time_utc ? r.arr_time_utc + 'Z' : '-' }}</span>
              </div>
              <div>
                <span class="text-slate-500 font-medium block mb-1">{{ lang.t('admin.commercial.sourceOperatingDays') }}</span>
                <div class="flex items-center gap-1 flex-wrap">
                  @for (d of formatDayChips(r.days); track d.dayNum) {
                    <span
                      class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                      [class]="d.active ? 'bg-amber-100 text-amber-900 border border-gold/40' : 'bg-slate-200 text-slate-400'"
                    >
                      {{ d.label }}
                    </span>
                  }
                </div>
              </div>
            </div>

            <!-- Incompatibility Warning Banner if any -->
            @if (formIncompatibleCabins().length > 0 || formOvercapacityDetails().length > 0) {
              <div class="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 text-xs text-amber-900 animate-fade-in">
                <div class="flex items-start gap-2.5">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div class="space-y-1.5 flex-1">
                    <p class="font-bold text-amber-950">{{ lang.t('admin.commercial.incompatibleAircraftWarning') }}</p>

                    @if (formIncompatibleCabins().length > 0) {
                      <div class="flex items-center justify-between gap-2 bg-amber-100/70 p-2.5 rounded-xl border border-amber-200">
                        <span>
                          {{ lang.t('admin.commercial.incompatibleCabinsLabel') }}:
                          <strong class="font-mono text-amber-950">{{ getIncompatibleCabinsString(formIncompatibleCabins()) }}</strong>
                        </span>
                        <button
                          type="button"
                          (click)="removeIncompatibleFormCabins()"
                          class="btn-navy !py-1 !px-2.5 text-[11px] shrink-0 font-semibold"
                        >
                          {{ lang.t('admin.commercial.removeIncompatibleCabins') }}
                        </button>
                      </div>
                    }

                    @if (formOvercapacityDetails().length > 0) {
                      <div class="space-y-1 bg-amber-100/70 p-2.5 rounded-xl border border-amber-200">
                        <p class="font-medium text-[11px] text-amber-950">{{ lang.t('admin.commercial.overcapacityNotice') }}:</p>
                        @for (item of formOvercapacityDetails(); track item.cabin) {
                          <p class="font-mono text-[11px] text-amber-900">
                            • {{ item.cabin }}: {{ lang.t('admin.commercial.allocatedSeats') }} <strong>{{ item.allocated }}</strong> > {{ lang.t('admin.commercial.maxCapacity') }} <strong>{{ item.max }}</strong>
                          </p>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>
            }

            <!-- Commercial Configuration Form -->
            <form class="space-y-4 text-xs">
              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.t('admin.commercial.aptFlightNumber') }}
                </label>
                <input
                  type="text"
                  [ngModel]="formFlightNumber()"
                  (ngModelChange)="formFlightNumber.set($event.toUpperCase().trim())"
                  name="aptech_flight_number"
                  placeholder="APT231"
                  required
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
                />
                <p class="text-[10px] text-slate-400 mt-1 font-mono">
                  {{ lang.t('admin.commercial.flightNumberFormatHelp') }}
                </p>
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.t('admin.commercial.aircraftType') }}
                </label>
                <select
                  [ngModel]="formAircraftType()"
                  (ngModelChange)="onAircraftTypeSelected($event)"
                  name="aircraft_type"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
                >
                  <option value="">{{ lang.t('admin.commercial.selectAircraft') }}</option>
                  @for (layout of aircraftLayouts(); track layout.aircraft_type) {
                    <option [value]="layout.aircraft_type">
                      {{ layout.aircraft_type }} – {{ layout.model_name }} ({{ layout.total_capacity }} {{ lang.t('admin.commercial.seatsUnit') }})
                    </option>
                  }
                </select>
              </div>

              <!-- Dynamic Cabins & Allocations based on chosen Aircraft -->
              @if (selectedAircraftLayout(); as layout) {
                <div class="card-luxury p-4 space-y-3">
                  <div class="border-b border-slate-100 pb-2">
                    <span class="font-bold text-navy uppercase tracking-wider text-[11px] block">
                      {{ lang.t('admin.commercial.cabinsAndInventory') }}
                    </span>
                    <p class="text-[11px] text-slate-400 mt-0.5">
                      {{ lang.t('admin.commercial.cabinHelp') }}
                    </p>
                  </div>

                  @for (cabin of layout.supported_cabins; track cabin) {
                    @let physicalCap = layout.cabin_capacities[cabin] || 0;
                    @let isSelected = formSelectedCabins().has(cabinAsEnum(cabin));
                    <div class="p-3 rounded-xl border transition-all" [class]="isSelected ? 'border-gold bg-amber-50/20' : 'border-slate-100 bg-slate-50/60'">
                      <div class="flex items-center justify-between mb-2">
                        <label class="inline-flex items-center gap-2 cursor-pointer font-bold text-navy">
                          <input
                            type="checkbox"
                            [checked]="isSelected"
                            [disabled]="cabin === 'ECONOMY'"
                            (change)="toggleCabinSelection(cabinAsEnum(cabin))"
                            class="rounded text-gold focus:ring-gold"
                          />
                          <span>{{ cabin }}</span>
                        </label>
                        <span class="text-[11px] text-slate-500 font-mono">
                          {{ lang.t('admin.commercial.physicalCapacity') }} <strong class="text-navy">{{ physicalCap }}</strong>
                        </span>
                      </div>

                      @if (isSelected) {
                        <div class="grid grid-cols-2 gap-2.5 pt-1.5">
                          <div>
                            <label class="block text-[11px] font-medium text-slate-600 mb-1">
                              {{ lang.t('admin.commercial.allocatedSeats') }}
                            </label>
                            <input
                              type="number"
                              [ngModel]="formAllocatedSeats()[cabin]"
                              (ngModelChange)="updateAllocatedSeats(cabin, +$event)"
                              [name]="'allocated_' + cabin"
                              min="1"
                              [max]="physicalCap"
                              class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] font-medium text-slate-600 mb-1">
                              {{ lang.t('admin.commercial.baseFare') }}
                              @if (cabin === 'ECONOMY') {
                                <span class="text-rose-500 font-bold">*</span>
                              }
                            </label>
                            <input
                              type="number"
                              [ngModel]="formBasePrices()[cabin]"
                              (ngModelChange)="updateBasePrice(cabin, $event ? +$event : null)"
                              [name]="'price_' + cabin"
                              [placeholder]="cabin === 'ECONOMY' ? '1500000' : lang.t('admin.commercial.autoPricing')"
                              class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                            />
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Immediate Materialization Option -->
              <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5">
                <input
                  type="checkbox"
                  [ngModel]="formMaterializeImmediately()"
                  (ngModelChange)="formMaterializeImmediately.set($event)"
                  name="materialize_immediately"
                  id="mat_now"
                  class="rounded text-gold focus:ring-gold mt-0.5"
                />
                <label for="mat_now" class="cursor-pointer select-none">
                  <span class="font-bold text-navy block text-xs">{{ lang.t('admin.commercial.optMaterializeNow') }}</span>
                  <span class="text-[11px] text-slate-500 block">
                    {{ lang.t('admin.commercial.materializeImmediatelyHelp') }}
                  </span>
                </label>
              </div>
            </form>
          </div>

          <div class="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              (click)="commercializingRoute.set(null)"
              class="btn-ghost text-xs"
            >
              {{ lang.t('common.cancel') }}
            </button>

            <button
              type="button"
              (click)="submitCommercialize()"
              [disabled]="submittingCommercialize() || !isCommercializeFormValid()"
              class="btn-gold text-xs !py-2.5 !px-6 font-bold"
            >
              @if (submittingCommercialize()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.t('admin.commercial.btnCreateTemplate') }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- DRAWER 3: Edit Commercial Template Drawer -->
    @if (editingTemplate(); as t) {
      <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-xl h-full shadow-2xl p-6 border-l border-slate-200 overflow-y-auto flex flex-col justify-between">
          <div class="space-y-5">
            <div class="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 class="text-base font-bold text-navy flex items-center gap-2">
                <app-icon name="edit" class="w-5 h-5 text-gold" />
                <span>{{ lang.t('admin.commercial.drawerEditTitle') }}: {{ t.template_id }}</span>
              </h3>
              <button (click)="editingTemplate.set(null)" class="text-slate-400 hover:text-slate-600">
                <app-icon name="x" class="w-5 h-5" />
              </button>
            </div>

            <!-- Read-only Provenance Banner -->
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
              <p class="font-bold text-navy">
                {{ lang.t('admin.commercial.routeReadOnly') }}
                <span class="font-mono">{{ t.origin_iata }} → {{ t.dest_iata }}</span>
              </p>
              <p class="text-[11px] text-slate-500 font-mono">
                {{ lang.t('admin.commercial.standardTime') }} {{ t.std_dep_time || '-' }} → {{ t.std_arr_time || '-' }} |
                {{ lang.t('admin.commercial.operatingDaysLabel') }} {{ t.days_of_week.join(', ') }}
              </p>
              <p class="text-[11px] text-amber-800 font-medium">
                {{ lang.t('admin.commercial.editNotice') }}
              </p>
            </div>

            <!-- Incompatibility Warning Banner if any -->
            @if (editIncompatibleCabins().length > 0 || editOvercapacityDetails().length > 0) {
              <div class="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 text-xs text-amber-900 animate-fade-in">
                <div class="flex items-start gap-2.5">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div class="space-y-1.5 flex-1">
                    <p class="font-bold text-amber-950">{{ lang.t('admin.commercial.incompatibleAircraftWarning') }}</p>

                    @if (editIncompatibleCabins().length > 0) {
                      <div class="flex items-center justify-between gap-2 bg-amber-100/70 p-2.5 rounded-xl border border-amber-200">
                        <span>
                          {{ lang.t('admin.commercial.incompatibleCabinsLabel') }}:
                          <strong class="font-mono text-amber-950">{{ getIncompatibleCabinsString(editIncompatibleCabins()) }}</strong>
                        </span>
                        <button
                          type="button"
                          (click)="removeIncompatibleEditCabins()"
                          class="btn-navy !py-1 !px-2.5 text-[11px] shrink-0 font-semibold"
                        >
                          {{ lang.t('admin.commercial.removeIncompatibleCabins') }}
                        </button>
                      </div>
                    }

                    @if (editOvercapacityDetails().length > 0) {
                      <div class="space-y-1 bg-amber-100/70 p-2.5 rounded-xl border border-amber-200">
                        <p class="font-medium text-[11px] text-amber-950">{{ lang.t('admin.commercial.overcapacityNotice') }}:</p>
                        @for (item of editOvercapacityDetails(); track item.cabin) {
                          <p class="font-mono text-[11px] text-amber-900">
                            • {{ item.cabin }}: {{ lang.t('admin.commercial.allocatedSeats') }} <strong>{{ item.allocated }}</strong> > {{ lang.t('admin.commercial.maxCapacity') }} <strong>{{ item.max }}</strong>
                          </p>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>
            }

            <form class="space-y-4 text-xs">
              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.t('admin.commercial.colFlightNumber') }}
                </label>
                <input
                  type="text"
                  [ngModel]="editFlightNumber()"
                  (ngModelChange)="editFlightNumber.set($event.toUpperCase().trim())"
                  name="edit_flight_number"
                  required
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">
                  {{ lang.t('admin.commercial.aircraftType') }}
                </label>
                <select
                  [ngModel]="editAircraftType()"
                  (ngModelChange)="onEditAircraftTypeSelected($event)"
                  name="edit_aircraft_type"
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-navy focus:ring-2 focus:ring-gold"
                >
                  @for (layout of aircraftLayouts(); track layout.aircraft_type) {
                    <option [value]="layout.aircraft_type">
                      {{ layout.aircraft_type }} – {{ layout.model_name }} ({{ layout.total_capacity }} {{ lang.t('admin.commercial.seatsUnit') }})
                    </option>
                  }
                </select>
              </div>

              <!-- Dynamic Cabins & Allocations for Edit -->
              @if (editAircraftLayout(); as layout) {
                <div class="card-luxury p-4 space-y-3">
                  <div class="border-b border-slate-100 pb-2">
                    <span class="font-bold text-navy uppercase tracking-wider text-[11px] block">
                      {{ lang.t('admin.commercial.cabinsAndInventory') }}
                    </span>
                  </div>

                  @for (cabin of layout.supported_cabins; track cabin) {
                    @let physicalCap = layout.cabin_capacities[cabin] || 0;
                    @let isSelected = editSelectedCabins().has(cabinAsEnum(cabin));
                    <div class="p-3 rounded-xl border transition-all" [class]="isSelected ? 'border-gold bg-amber-50/20' : 'border-slate-100 bg-slate-50/60'">
                      <div class="flex items-center justify-between mb-2">
                        <label class="inline-flex items-center gap-2 cursor-pointer font-bold text-navy">
                          <input
                            type="checkbox"
                            [checked]="isSelected"
                            [disabled]="cabin === 'ECONOMY'"
                            (change)="toggleEditCabinSelection(cabinAsEnum(cabin))"
                            class="rounded text-gold focus:ring-gold"
                          />
                          <span>{{ cabin }}</span>
                        </label>
                        <span class="text-[11px] text-slate-500 font-mono">
                          {{ lang.t('admin.commercial.physicalCapacity') }} <strong class="text-navy">{{ physicalCap }}</strong>
                        </span>
                      </div>

                      @if (isSelected) {
                        <div class="grid grid-cols-2 gap-2.5 pt-1.5">
                          <div>
                            <label class="block text-[11px] font-medium text-slate-600 mb-1">
                              {{ lang.t('admin.commercial.allocatedSeats') }}
                            </label>
                            <input
                              type="number"
                              [ngModel]="editAllocatedSeats()[cabin]"
                              (ngModelChange)="updateEditAllocatedSeats(cabin, +$event)"
                              [name]="'edit_allocated_' + cabin"
                              min="1"
                              [max]="physicalCap"
                              class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                            />
                          </div>
                          <div>
                            <label class="block text-[11px] font-medium text-slate-600 mb-1">
                              {{ lang.t('admin.commercial.baseFare') }}
                            </label>
                            <input
                              type="number"
                              [ngModel]="editBasePrices()[cabin]"
                              (ngModelChange)="updateEditBasePrice(cabin, $event ? +$event : null)"
                              [name]="'edit_price_' + cabin"
                              [placeholder]="cabin === 'ECONOMY' ? '1500000' : lang.t('admin.commercial.autoPricing')"
                              class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs focus:ring-1 focus:ring-gold"
                            />
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Active status toggle in edit -->
              <div class="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span class="font-bold text-navy text-xs">{{ lang.t('admin.commercial.colActiveToggle') }}</span>
                <label class="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [ngModel]="editIsActive()"
                    (ngModelChange)="editIsActive.set($event)"
                    name="edit_is_active"
                    class="rounded text-gold focus:ring-gold"
                  />
                  <span class="text-xs font-semibold text-slate-700">{{ editIsActive() ? lang.t('admin.commercial.statusActive') : lang.t('admin.commercial.statusInactive') }}</span>
                </label>
              </div>
            </form>
          </div>

          <div class="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              (click)="editingTemplate.set(null)"
              class="btn-ghost text-xs"
            >
              {{ lang.t('common.cancel') }}
            </button>

            <button
              type="button"
              (click)="saveTemplateEdit()"
              [disabled]="submittingEdit() || !isEditFormValid()"
              class="btn-gold text-xs !py-2.5 !px-6 font-bold"
            >
              @if (submittingEdit()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.t('admin.commercial.btnSaveTemplate') }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- MODAL 2: Materialize Flights Horizon Modal -->
    @if (materializingTemplate(); as t) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200 space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="calendar" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.commercial.materializeModalTitle') }}</span>
            </h3>
            <button (click)="closeMaterializeModal()" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Template Mini Header -->
          <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
            <div>
              <span class="font-black text-navy text-sm font-mono">{{ t.flight_number }}</span>
              <span class="text-slate-400 mx-1.5 font-mono">({{ t.template_id }})</span>
            </div>
            <div class="font-mono font-bold text-navy">
              {{ t.origin_iata }} → {{ t.dest_iata }} ({{ t.aircraft_type }})
            </div>
          </div>

          <!-- Informational Notice on Idempotency -->
          <div class="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-900">
            <app-icon name="shieldcheck" class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div class="space-y-1">
              <p class="font-bold">{{ lang.t('admin.commercial.safeIdempotentTitle') }}</p>
              <p class="text-emerald-800 leading-relaxed">{{ lang.t('admin.commercial.materializeIdempotentNotice') }}</p>
            </div>
          </div>

          <!-- Horizon Selector with Presets & Custom Days -->
          <div class="space-y-3 text-xs">
            <label class="block font-semibold text-slate-700">
              {{ lang.t('admin.commercial.horizonPreset') }}
            </label>
            <div class="grid grid-cols-4 gap-2">
              @for (preset of [30, 90, 180, 330]; track preset) {
                <button
                  type="button"
                  (click)="materializeDays.set(preset)"
                  class="px-3 py-2 rounded-xl font-bold font-mono text-center border transition-all text-xs"
                  [class]="materializeDays() === preset ? 'bg-navy text-white border-navy shadow-sm' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'"
                >
                  {{ preset }}d
                </button>
              }
            </div>

            <div>
              <label class="block font-medium text-slate-600 mb-1">
                {{ lang.t('admin.commercial.customDaysLabel') }}
              </label>
              <input
                type="number"
                min="1"
                max="330"
                step="1"
                [ngModel]="materializeDays()"
                (ngModelChange)="materializeDays.set(+$event)"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-1 focus:ring-gold"
              />
              @if (!isMaterializeDaysValid()) {
                <p class="text-rose-600 text-[11px] mt-1">
                  {{ lang.t('admin.commercial.customDaysInvalid') }}
                </p>
              }
            </div>

            <div>
              <label class="block font-medium text-slate-600 mb-1">
                {{ lang.t('admin.commercial.customStartDate') }}
              </label>
              <input
                type="date"
                [ngModel]="materializeStartDate()"
                (ngModelChange)="materializeStartDate.set($event)"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>

          <!-- Complete GenerationStats Display -->
          @if (materializeResult(); as res) {
            <div class="p-4 bg-amber-50 border border-gold/40 rounded-2xl space-y-2 text-xs">
              <div class="flex items-center gap-2 font-bold text-navy">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.t('admin.commercial.statHeader') }}</span>
              </div>
              <p class="text-[11px] text-emerald-800 font-semibold">
                {{ lang.t('admin.commercial.missingDatesMaterialized') }}
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px] font-mono pt-1 text-slate-700">
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statInserted') }}</span>
                  <strong class="text-emerald-600 text-sm">{{ res.inserted_count }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statMatched') }}</span>
                  <strong class="text-navy text-sm">{{ res.matched_count }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statSkipped') }}</span>
                  <strong class="text-slate-700 text-sm">{{ res.skipped_existing }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statTotalOps') }}</span>
                  <strong class="text-slate-800 text-sm">{{ res.total_operations }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statTotalDays') }}</span>
                  <strong class="text-slate-800 text-sm">{{ res.total_days }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statTemplatesCount') }}</span>
                  <strong class="text-slate-800 text-sm">{{ res.templates_count }}</strong>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statStartDate') }}</span>
                  <span class="text-slate-700 font-bold">{{ res.start_date }}</span>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statEndDate') }}</span>
                  <span class="text-slate-700 font-bold">{{ res.end_date }}</span>
                </div>
                <div class="p-2 bg-white/80 rounded-lg border border-slate-200">
                  <span class="text-slate-500 block text-[10px]">{{ lang.t('admin.commercial.statDuration') }}</span>
                  <span class="text-slate-700 font-bold">{{ res.duration_ms }}ms</span>
                </div>
              </div>
            </div>
          }

          <div class="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              (click)="closeMaterializeModal()"
              class="btn-ghost text-xs"
            >
              {{ lang.t('common.cancel') }}
            </button>
            <button
              type="button"
              (click)="executeMaterialize()"
              [disabled]="submittingMaterialize() || !isMaterializeDaysValid()"
              class="btn-gold text-xs !py-2.5 !px-6 font-bold"
            >
              @if (submittingMaterialize()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.t('admin.commercial.btnExecuteMaterialize') }}</span>
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class CommercialFlightsComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  // Tabs
  activeTab = signal<'routes' | 'templates'>('routes');

  // KPI & Global Catalog
  templates = signal<CommercialScheduleTemplate[]>([]);
  matchingRoutesCount = signal<number>(0);
  activeTemplatesCount = computed(() => this.templates().filter((t) => t.is_active).length);
  commercializedRoutesCount = computed(() => {
    const set = new Set(this.templates().map((t) => t.source_route_key).filter(Boolean));
    return set.size;
  });
  templateMapByRouteKey = computed(() => {
    const map = new Map<string, CommercialScheduleTemplate>();
    for (const t of this.templates()) {
      if (t.source_route_key) {
        map.set(t.source_route_key, t);
      }
    }
    return map;
  });

  // Aircraft Layouts (backend authoritative)
  aircraftLayouts = signal<CommercialAircraftLayout[]>([]);

  // TAB 1: RouteRef Explorer
  routes = signal<AirLabsRouteRef[]>([]);
  routesLoading = signal<boolean>(false);
  filterDep = signal<string>('');
  filterArr = signal<string>('');
  filterHasSchedule = signal<boolean>(true);
  routesPage = signal<number>(1);
  routesLimit = signal<number>(20);
  routesTotal = signal<number>(0);

  inspectingRoute = signal<AirLabsRouteRef | null>(null);
  commercializingRoute = signal<AirLabsRouteRef | null>(null);

  // Sync Modal
  syncModalOpen = signal<boolean>(false);
  syncDepIata = signal<string>('SGN');
  syncLimit = signal<number>(200);
  syncing = signal<boolean>(false);

  // Commercialize Form
  formFlightNumber = signal<string>('');
  formAircraftType = signal<string>('');
  formSelectedCabins = signal<Set<CabinClass>>(new Set([CabinClass.ECONOMY]));
  formAllocatedSeats = signal<Record<string, number>>({});
  formBasePrices = signal<Record<string, number | null>>({ [CabinClass.ECONOMY]: null });
  formMaterializeImmediately = signal<boolean>(false);
  submittingCommercialize = signal<boolean>(false);
  formIncompatibleCabins = signal<CabinClass[]>([]);
  formOvercapacityDetails = signal<Array<{ cabin: string; allocated: number; max: number }>>([]);

  selectedAircraftLayout = computed(() => {
    const code = this.formAircraftType();
    return this.aircraftLayouts().find((l) => l.aircraft_type === code) || null;
  });

  // TAB 2: Templates
  templatesLoading = signal<boolean>(false);
  templateSearch = signal<string>('');
  filteredTemplates = computed(() => {
    const q = this.templateSearch().toLowerCase().trim();
    if (!q) return this.templates();
    return this.templates().filter(
      (t) =>
        t.flight_number.toLowerCase().includes(q) ||
        t.template_id.toLowerCase().includes(q) ||
        t.origin_iata.toLowerCase().includes(q) ||
        t.dest_iata.toLowerCase().includes(q) ||
        (t.aircraft_type && t.aircraft_type.toLowerCase().includes(q)),
    );
  });

  // Edit Template Drawer
  editingTemplate = signal<CommercialScheduleTemplate | null>(null);
  editFlightNumber = signal<string>('');
  editAircraftType = signal<string>('');
  editSelectedCabins = signal<Set<CabinClass>>(new Set());
  editAllocatedSeats = signal<Record<string, number>>({});
  editBasePrices = signal<Record<string, number | null>>({});
  editIsActive = signal<boolean>(true);
  submittingEdit = signal<boolean>(false);
  editIncompatibleCabins = signal<CabinClass[]>([]);
  editOvercapacityDetails = signal<Array<{ cabin: string; allocated: number; max: number }>>([]);

  editAircraftLayout = computed(() => {
    const code = this.editAircraftType();
    return this.aircraftLayouts().find((l) => l.aircraft_type === code) || null;
  });

  // Materialize Modal
  materializingTemplate = signal<CommercialScheduleTemplate | null>(null);
  materializeDays = signal<number>(30);
  materializeStartDate = signal<string>('');
  submittingMaterialize = signal<boolean>(false);
  materializeResult = signal<MaterializeTemplateResponse | null>(null);

  ngOnInit(): void {
    this.loadAircraftLayouts();
    this.refreshTemplatesCatalog();
    this.loadRoutes(1);
  }

  // ===================== AIRCRAFT LAYOUTS =====================
  loadAircraftLayouts(): void {
    this.api.getCommercialAircraftLayouts().subscribe({
      next: (layouts) => {
        this.aircraftLayouts.set(layouts || []);
      },
      error: (err) => {
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadLayouts'), 'error');
      },
    });
  }

  // ===================== TEMPLATES CATALOG (EXHAUSTIVE) =====================
  refreshTemplatesCatalog(): void {
    this.templatesLoading.set(true);
    this.api.fetchAllCommercialTemplates().subscribe({
      next: (allTemplates) => {
        this.templates.set(allTemplates || []);
        this.templatesLoading.set(false);
      },
      error: (err) => {
        this.templatesLoading.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadTemplates'), 'error');
      },
    });
  }

  // ===================== ROUTEREF EXPLORER =====================
  loadRoutes(page = 1): void {
    this.routesPage.set(page);
    this.routesLoading.set(true);
    const offset = (page - 1) * this.routesLimit();

    this.api
      .getAirLabsRoutes({
        dep_iata: this.filterDep() || undefined,
        arr_iata: this.filterArr() || undefined,
        has_schedule: this.filterHasSchedule(),
        limit: this.routesLimit(),
        offset,
      })
      .subscribe({
        next: (res) => {
          this.routes.set(res.items || []);
          this.routesTotal.set(res.total || 0);
          this.matchingRoutesCount.set(res.total || 0);
          this.routesLoading.set(false);
        },
        error: (err) => {
          this.routesLoading.set(false);
          this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorLoadRoutes'), 'error');
        },
      });
  }

  onRoutesLimitChange(newLimit: number): void {
    this.routesLimit.set(newLimit);
    this.loadRoutes(1);
  }

  inspectRoute(r: AirLabsRouteRef): void {
    this.inspectingRoute.set(r);
  }

  viewTemplate(template: CommercialScheduleTemplate): void {
    this.activeTab.set('templates');
    this.templateSearch.set(template.flight_number);
  }

  // ===================== ON-DEMAND AIRPORT SYNC =====================
  openSyncModal(): void {
    this.syncModalOpen.set(true);
  }

  executeAirportSync(): void {
    const depIata = this.syncDepIata().trim().toUpperCase();
    if (!depIata) {
      this.toast.show(this.lang.t('admin.commercial.airportIataRequired'), 'warning');
      return;
    }

    this.syncing.set(true);
    this.api.syncRoutesForAirport(depIata, this.syncLimit()).subscribe({
      next: (res) => {
        this.syncing.set(false);
        this.syncModalOpen.set(false);

        const countStr = String(res.updated || 0);
        if (res.complete === true) {
          this.toast.show(
            this.lang.t('admin.commercial.syncComplete')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'success',
          );
        } else if (res.truncated === true) {
          this.toast.show(
            this.lang.t('admin.commercial.syncTruncated')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'warning',
          );
        } else {
          // complete === false && truncated === false
          this.toast.show(
            this.lang.t('admin.commercial.syncIncomplete')
              .replace('{count}', countStr)
              .replace('{airport}', res.dep_iata),
            'warning',
          );
        }

        // Refresh RouteRef table
        this.filterDep.set(depIata);
        this.loadRoutes(1);
      },
      error: (err) => {
        this.syncing.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorSyncRoutes'), 'error');
      },
    });
  }

  // ===================== COMMERCIALIZATION WORKFLOW =====================
  openCommercializeDrawer(r: AirLabsRouteRef): void {
    this.commercializingRoute.set(r);
    this.formMaterializeImmediately.set(false);
    this.formIncompatibleCabins.set([]);
    this.formOvercapacityDetails.set([]);

    // Section 10 Suggestion rule:
    // If source flight contains usable digits, suggest APT + digits.
    // If no usable digits, use "APT" or blank. Do NOT use Math.random().
    const digits = (r.flight_number || r.flight_iata || '').replace(/\D/g, '');
    const aptNumber = digits ? `APT${digits}` : 'APT';
    this.formFlightNumber.set(aptNumber);

    // Select first aircraft layout by default (or A21N)
    const defaultLayout = this.aircraftLayouts().find((l) => l.aircraft_type === 'A21N') || this.aircraftLayouts()[0];
    if (defaultLayout) {
      this.formAircraftType.set(defaultLayout.aircraft_type);
      const newCabins = new Set<CabinClass>([CabinClass.ECONOMY]);
      if (defaultLayout.supported_cabins.includes('BUSINESS')) {
        newCabins.add(CabinClass.BUSINESS);
      }
      this.formSelectedCabins.set(newCabins);

      const seats: Record<string, number> = {};
      for (const c of defaultLayout.supported_cabins) {
        seats[c] = defaultLayout.cabin_capacities[c] || 0;
      }
      this.formAllocatedSeats.set(seats);

      // Section 12: Admin enters Economy fare; Premium can be left blank for automated pricing
      this.formBasePrices.set({
        [CabinClass.ECONOMY]: null,
        [CabinClass.BUSINESS]: null,
        [CabinClass.CLUB]: null,
        [CabinClass.FIRST]: null,
      });
      this.formIncompatibleCabins.set([]);
      this.formOvercapacityDetails.set([]);
    }
  }

  getIncompatibleCabinsString(cabins: CabinClass[]): string {
    return cabins.join(', ');
  }

  onAircraftTypeSelected(aircraftType: string): void {
    this.formAircraftType.set(aircraftType);
    const layout = this.aircraftLayouts().find((l) => l.aircraft_type === aircraftType);
    if (!layout) return;

    this.recheckFormIncompatibility(layout);
  }

  removeIncompatibleFormCabins(): void {
    const incomp = new Set(this.formIncompatibleCabins());
    const remaining = new Set(
      Array.from(this.formSelectedCabins()).filter((c) => !incomp.has(c)),
    );
    this.formSelectedCabins.set(remaining);

    const seats = { ...this.formAllocatedSeats() };
    const prices = { ...this.formBasePrices() };
    for (const c of incomp) {
      delete seats[c];
      delete prices[c];
    }
    this.formAllocatedSeats.set(seats);
    this.formBasePrices.set(prices);

    const layout = this.selectedAircraftLayout();
    if (layout) {
      this.recheckFormIncompatibility(layout);
    }
  }

  toggleCabinSelection(cabin: CabinClass): void {
    if (cabin === CabinClass.ECONOMY) return; // Economy is mandatory
    const set = new Set(this.formSelectedCabins());
    if (set.has(cabin)) {
      set.delete(cabin);
    } else {
      set.add(cabin);
    }
    this.formSelectedCabins.set(set);

    const layout = this.selectedAircraftLayout();
    if (layout) {
      const seats = { ...this.formAllocatedSeats() };
      if (!seats[cabin]) {
        seats[cabin] = layout.cabin_capacities[cabin] || 0;
        this.formAllocatedSeats.set(seats);
      }
      this.recheckFormIncompatibility(layout);
    }
  }

  updateAllocatedSeats(cabin: string, val: number): void {
    const current = { ...this.formAllocatedSeats() };
    current[cabin] = val;
    this.formAllocatedSeats.set(current);
    const layout = this.selectedAircraftLayout();
    if (layout) {
      this.recheckFormIncompatibility(layout);
    }
  }

  updateBasePrice(cabin: string, val: number | null): void {
    const current = { ...this.formBasePrices() };
    current[cabin] = val;
    this.formBasePrices.set(current);
  }

  private recheckFormIncompatibility(layout: CommercialAircraftLayout): void {
    const incompCabins: CabinClass[] = [];
    const overcap: Array<{ cabin: string; allocated: number; max: number }> = [];

    for (const c of this.formSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) {
        incompCabins.push(c);
      } else {
        const cap = layout.cabin_capacities[c] || 0;
        const curSeats = this.formAllocatedSeats()[c];
        if (curSeats && curSeats > cap) {
          overcap.push({ cabin: c, allocated: curSeats, max: cap });
        }
      }
    }
    this.formIncompatibleCabins.set(incompCabins);
    this.formOvercapacityDetails.set(overcap);
  }

  isCommercializeFormValid(): boolean {
    const flNum = this.formFlightNumber().trim();
    if (!/^APT[A-Z0-9]+$/i.test(flNum)) return false;

    const layout = this.selectedAircraftLayout();
    if (!layout) return false;

    // Must not have incompatible cabins or overcapacity
    if (this.formIncompatibleCabins().length > 0) return false;
    if (this.formOvercapacityDetails().length > 0) return false;

    // Economy price required, finite, >= 0
    const ecoPrice = this.formBasePrices()[CabinClass.ECONOMY];
    if (ecoPrice === null || ecoPrice === undefined || isNaN(Number(ecoPrice)) || Number(ecoPrice) < 0) return false;

    // Must have Economy selected
    if (!this.formSelectedCabins().has(CabinClass.ECONOMY)) return false;

    // Validate allocated seats for all selected cabins against physical capacity
    for (const c of this.formSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) return false;

      const seats = this.formAllocatedSeats()[c];
      const maxCap = layout.cabin_capacities[c] || 0;
      if (!seats || seats < 1 || seats > maxCap) return false;

      // Premium price: optional; if entered, must be finite > 0
      if (c !== CabinClass.ECONOMY) {
        const p = this.formBasePrices()[c];
        if (p !== null && p !== undefined && p !== ('' as any) && (isNaN(Number(p)) || Number(p) <= 0)) return false;
      }
    }

    return true;
  }

  submitCommercialize(): void {
    const r = this.commercializingRoute();
    if (!r || !this.isCommercializeFormValid()) return;

    this.submittingCommercialize.set(true);

    const cabinClasses = Array.from(this.formSelectedCabins());
    const inventories = cabinClasses.map((c) => ({
      cabin_class: c,
      allocated_seats: this.formAllocatedSeats()[c] || 0,
    }));

    const prices = this.formBasePrices();
    const ecoPrice = Number(prices[CabinClass.ECONOMY]);

    const payload: CommercializeRoutePayload = {
      source_key: r.source_key,
      aptech_flight_number: this.formFlightNumber().trim().toUpperCase(),
      aircraft_type: this.formAircraftType(),
      base_price_economy: ecoPrice,
      base_price_business: prices[CabinClass.BUSINESS] !== null && prices[CabinClass.BUSINESS] !== undefined && prices[CabinClass.BUSINESS] !== ('' as any) ? Number(prices[CabinClass.BUSINESS]) : undefined,
      base_price_club: prices[CabinClass.CLUB] !== null && prices[CabinClass.CLUB] !== undefined && prices[CabinClass.CLUB] !== ('' as any) ? Number(prices[CabinClass.CLUB]) : undefined,
      base_price_first: prices[CabinClass.FIRST] !== null && prices[CabinClass.FIRST] !== undefined && prices[CabinClass.FIRST] !== ('' as any) ? Number(prices[CabinClass.FIRST]) : undefined,
      cabin_classes: cabinClasses,
      inventories,
    };

    this.api.commercializeAirLabsRoute(payload).subscribe({
      next: (createdTemplate) => {
        this.toast.show(
          this.lang.t('admin.commercial.templateCreated')
            .replace('{route}', `${r.dep_iata} → ${r.arr_iata}`)
            .replace('{flightNumber}', createdTemplate.flight_number || createdTemplate.template_id),
          'success',
        );

        // Refresh template catalog
        this.refreshTemplatesCatalog();

        // Optional Sequential Step 2: Materialize immediately
        if (this.formMaterializeImmediately()) {
          this.api.materializeCommercialTemplate(createdTemplate.template_id, { days_ahead: 30 }).subscribe({
            next: (matRes) => {
              this.submittingCommercialize.set(false);
              this.commercializingRoute.set(null);
              this.toast.show(
                this.lang.t('admin.commercial.materializeSuccess')
                  .replace('{inserted}', matRes.inserted_count.toString())
                  .replace('{matched}', matRes.matched_count.toString()),
                'success',
              );
              this.activeTab.set('templates');
            },
            error: (matErr) => {
              this.submittingCommercialize.set(false);
              this.commercializingRoute.set(null);
              // Partial success resilience: preserve template and guide admin
              this.toast.show(
                `${this.lang.t('admin.commercial.partialMaterializeWarn')} (${matErr?.error?.message || this.lang.t('admin.commercial.errorMaterializeGeneric')})`,
                'warning',
              );
              this.activeTab.set('templates');
            },
          });
        } else {
          this.submittingCommercialize.set(false);
          this.commercializingRoute.set(null);
          this.activeTab.set('templates');
        }
      },
      error: (err) => {
        this.submittingCommercialize.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorCommercialize'), 'error');
      },
    });
  }

  // ===================== TEMPLATE EDITING =====================
  openEditDrawer(t: CommercialScheduleTemplate): void {
    this.editingTemplate.set(t);
    this.editFlightNumber.set(t.flight_number);
    this.editAircraftType.set(t.aircraft_type);
    this.editIsActive.set(t.is_active);

    const cabins = new Set<CabinClass>(t.cabin_classes || [CabinClass.ECONOMY]);
    this.editSelectedCabins.set(cabins);

    const seats: Record<string, number> = {};
    if (t.commercial_inventories) {
      for (const inv of t.commercial_inventories) {
        seats[inv.cabin_class] = inv.allocated_seats;
      }
    }
    this.editAllocatedSeats.set(seats);

    const prices: Record<string, number | null> = {
      [CabinClass.ECONOMY]: t.base_price_economy,
      [CabinClass.BUSINESS]: t.base_price_business ?? null,
      [CabinClass.CLUB]: t.base_price_club ?? null,
      [CabinClass.FIRST]: t.base_price_first ?? null,
    };
    this.editBasePrices.set(prices);
    this.editIncompatibleCabins.set([]);
    this.editOvercapacityDetails.set([]);
  }

  onEditAircraftTypeSelected(aircraftType: string): void {
    this.editAircraftType.set(aircraftType);
    const layout = this.aircraftLayouts().find((l) => l.aircraft_type === aircraftType);
    if (!layout) return;

    this.recheckEditIncompatibility(layout);
  }

  removeIncompatibleEditCabins(): void {
    const incomp = new Set(this.editIncompatibleCabins());
    const remaining = new Set(
      Array.from(this.editSelectedCabins()).filter((c) => !incomp.has(c)),
    );
    this.editSelectedCabins.set(remaining);

    const seats = { ...this.editAllocatedSeats() };
    const prices = { ...this.editBasePrices() };
    for (const c of incomp) {
      delete seats[c];
      delete prices[c];
    }
    this.editAllocatedSeats.set(seats);
    this.editBasePrices.set(prices);

    const layout = this.editAircraftLayout();
    if (layout) {
      this.recheckEditIncompatibility(layout);
    }
  }

  toggleEditCabinSelection(cabin: CabinClass): void {
    if (cabin === CabinClass.ECONOMY) return;
    const set = new Set(this.editSelectedCabins());
    if (set.has(cabin)) {
      set.delete(cabin);
    } else {
      set.add(cabin);
    }
    this.editSelectedCabins.set(set);

    const layout = this.editAircraftLayout();
    if (layout) {
      const seats = { ...this.editAllocatedSeats() };
      if (!seats[cabin]) {
        seats[cabin] = layout.cabin_capacities[cabin] || 0;
        this.editAllocatedSeats.set(seats);
      }
      this.recheckEditIncompatibility(layout);
    }
  }

  updateEditAllocatedSeats(cabin: string, val: number): void {
    const current = { ...this.editAllocatedSeats() };
    current[cabin] = val;
    this.editAllocatedSeats.set(current);

    const layout = this.editAircraftLayout();
    if (layout) {
      this.recheckEditIncompatibility(layout);
    }
  }

  updateEditBasePrice(cabin: string, val: number | null): void {
    const current = { ...this.editBasePrices() };
    current[cabin] = val;
    this.editBasePrices.set(current);
  }

  private recheckEditIncompatibility(layout: CommercialAircraftLayout): void {
    const incompCabins: CabinClass[] = [];
    const overcap: Array<{ cabin: string; allocated: number; max: number }> = [];

    for (const c of this.editSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) {
        incompCabins.push(c);
      } else {
        const cap = layout.cabin_capacities[c] || 0;
        const curSeats = this.editAllocatedSeats()[c];
        if (curSeats && curSeats > cap) {
          overcap.push({ cabin: c, allocated: curSeats, max: cap });
        }
      }
    }
    this.editIncompatibleCabins.set(incompCabins);
    this.editOvercapacityDetails.set(overcap);
  }

  isEditFormValid(): boolean {
    const flNum = this.editFlightNumber().trim();
    if (!/^APT[A-Z0-9]+$/i.test(flNum)) return false;

    const layout = this.editAircraftLayout();
    if (!layout) return false;

    // Must not have incompatible cabins or overcapacity
    if (this.editIncompatibleCabins().length > 0) return false;
    if (this.editOvercapacityDetails().length > 0) return false;

    const ecoPrice = this.editBasePrices()[CabinClass.ECONOMY];
    if (ecoPrice === null || ecoPrice === undefined || isNaN(Number(ecoPrice)) || Number(ecoPrice) < 0) return false;

    if (!this.editSelectedCabins().has(CabinClass.ECONOMY)) return false;

    for (const c of this.editSelectedCabins()) {
      if (!layout.supported_cabins.includes(c)) return false;

      const seats = this.editAllocatedSeats()[c];
      const maxCap = layout.cabin_capacities[c] || 0;
      if (!seats || seats < 1 || seats > maxCap) return false;

      if (c !== CabinClass.ECONOMY) {
        const p = this.editBasePrices()[c];
        if (p !== null && p !== undefined && p !== ('' as any) && (isNaN(Number(p)) || Number(p) <= 0)) return false;
      }
    }

    return true;
  }

  saveTemplateEdit(): void {
    const t = this.editingTemplate();
    if (!t || !this.isEditFormValid()) return;

    this.submittingEdit.set(true);

    const cabinClasses = Array.from(this.editSelectedCabins());
    const inventories = cabinClasses.map((c) => ({
      cabin_class: c,
      allocated_seats: this.editAllocatedSeats()[c] || 0,
    }));
    const prices = this.editBasePrices();
    const ecoPrice = Number(prices[CabinClass.ECONOMY]);

    const resolvePremiumPrice = (cabin: CabinClass, originalVal?: number): number | null | undefined => {
      const inputVal = prices[cabin];
      if (inputVal === null || inputVal === undefined || (inputVal as any) === '') {
        // Field is empty in the UI. If it was previously set, send null to clear it:
        if (originalVal !== undefined && originalVal !== null) {
          return null;
        }
        return undefined;
      }
      const num = Number(inputVal);
      return !isNaN(num) && num >= 0 ? num : null;
    };

    const payload: UpdateCommercialTemplatePayload = {
      flight_number: this.editFlightNumber().trim().toUpperCase(),
      aircraft_type: this.editAircraftType(),
      base_price_economy: ecoPrice,
      base_price_business: resolvePremiumPrice(CabinClass.BUSINESS, t.base_price_business),
      base_price_club: resolvePremiumPrice(CabinClass.CLUB, t.base_price_club),
      base_price_first: resolvePremiumPrice(CabinClass.FIRST, t.base_price_first),
      cabin_classes: cabinClasses,
      is_active: this.editIsActive(),
      inventories,
    };

    this.api.updateCommercialTemplate(t.template_id, payload).subscribe({
      next: (updated) => {
        this.submittingEdit.set(false);
        this.editingTemplate.set(null);
        this.toast.show(
          this.lang.t('admin.commercial.templateUpdated').replace('{id}', updated.template_id),
          'success',
        );
        this.refreshTemplatesCatalog();
      },
      error: (err) => {
        this.submittingEdit.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorUpdateTemplate'), 'error');
      },
    });
  }

  toggleTemplateStatus(t: CommercialScheduleTemplate): void {
    const newStatus = !t.is_active;
    this.api.toggleCommercialTemplateStatus(t.template_id, newStatus).subscribe({
      next: () => {
        // Section 16: Immutable signal update so active count KPI and table update reactively
        this.templates.update((list) =>
          list.map((item) =>
            item.template_id === t.template_id ? { ...item, is_active: newStatus } : item,
          ),
        );
        this.toast.show(
          (newStatus ? this.lang.t('admin.commercial.templateStatusActive') : this.lang.t('admin.commercial.templateStatusInactive')).replace('{id}', t.template_id),
          'info',
        );
      },
      error: (err) => {
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorToggleStatus'), 'error');
      },
    });
  }

  // ===================== MATERIALIZATION =====================
  openMaterializeModal(t: CommercialScheduleTemplate): void {
    this.materializingTemplate.set(t);
    this.materializeDays.set(30);
    this.materializeStartDate.set('');
    this.materializeResult.set(null);
  }

  closeMaterializeModal(): void {
    this.materializingTemplate.set(null);
    this.materializeResult.set(null);
  }

  isMaterializeDaysValid(): boolean {
    const d = this.materializeDays();
    return Number.isInteger(d) && d >= 1 && d <= 330;
  }

  executeMaterialize(): void {
    const t = this.materializingTemplate();
    if (!t || !this.isMaterializeDaysValid()) return;

    const days = this.materializeDays();
    const startDate = this.materializeStartDate().trim() || undefined;

    this.submittingMaterialize.set(true);
    this.api.materializeCommercialTemplate(t.template_id, { days_ahead: days, start_date: startDate }).subscribe({
      next: (res) => {
        this.submittingMaterialize.set(false);
        this.materializeResult.set(res);
        this.toast.show(
          this.lang.t('admin.commercial.materializeSuccess')
            .replace('{inserted}', res.inserted_count.toString())
            .replace('{matched}', res.matched_count.toString()),
          'success',
        );
      },
      error: (err) => {
        this.submittingMaterialize.set(false);
        this.toast.show(err?.error?.message || this.lang.t('admin.commercial.errorMaterialize'), 'error');
      },
    });
  }

  // ===================== HELPERS =====================
  cabinAsEnum(val: string): CabinClass {
    return val as CabinClass;
  }

  // Section 8: Real provider operating days normalization (mon, tuesday, 1, daily, etc.)
  normalizeOperatingDays(days?: string[]): Set<number> {
    const active = new Set<number>();
    if (!days || !Array.isArray(days)) return active;

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
      // Unknown provider value: do not fabricate a day
    }
    return active;
  }

  formatDayChips(days?: string[]): Array<{ dayNum: number; label: string; active: boolean }> {
    const activeSet = this.normalizeOperatingDays(days);
    return [1, 2, 3, 4, 5, 6, 7].map((num) => ({
      dayNum: num,
      label: this.getDayLabel(num),
      active: activeSet.has(num),
    }));
  }

  formatTemplateDaysChips(daysOfWeek?: number[]): Array<{ dayNum: number; label: string; active: boolean }> {
    const activeSet = new Set(daysOfWeek || []);
    return [1, 2, 3, 4, 5, 6, 7].map((num) => ({
      dayNum: num,
      label: this.getDayLabel(num),
      active: activeSet.has(num),
    }));
  }

  getDayLabel(d: number): string {
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

  // Section 12: Truthful fare display. Economy shows explicit fare; unpriced premium shows "Auto pricing"
  formatCabinFareDisplay(ecoPrice: number, cabin: CabinClass, t: CommercialScheduleTemplate): string {
    if (cabin === CabinClass.ECONOMY) {
      return this.formatCurrency(ecoPrice);
    }
    let explicitPrice: number | undefined;
    if (cabin === CabinClass.BUSINESS) explicitPrice = t.base_price_business;
    else if (cabin === CabinClass.CLUB) explicitPrice = t.base_price_club;
    else if (cabin === CabinClass.FIRST) explicitPrice = t.base_price_first;

    if (explicitPrice !== undefined && explicitPrice !== null && !isNaN(explicitPrice) && explicitPrice > 0) {
      return this.formatCurrency(explicitPrice);
    }
    return this.lang.t('admin.commercial.autoPricing');
  }

  formatCurrency(val?: number): string {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return `${val.toLocaleString('vi-VN')} ₫`;
  }
}
