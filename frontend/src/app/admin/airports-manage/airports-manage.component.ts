import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  AirportImportCountriesResponse,
  AirportFixCityNamesResponse,
} from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { Airport, CountrySuggestion } from '../../core/models/airport.model';

@Component({
  selector: 'app-airports-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PaginationComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.airports.title') }}</h1>
          <p class="text-xs text-slate-500">{{ lang.t('admin.airports.subtitle') }}</p>
        </div>

        <div class="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            (click)="fixCityNames()"
            [disabled]="fixingCityNames() || loading()"
            class="btn-navy text-xs !py-2.5 !px-4 font-bold inline-flex items-center gap-2 shadow-sm"
            [title]="lang.t('admin.airports.fixCityNamesHint')"
          >
            <app-icon name="edit" class="w-4 h-4" [class.animate-spin]="fixingCityNames()" />
            <span>{{ fixingCityNames() ? lang.t('admin.airports.fixingCityNames') : lang.t('admin.airports.fixCityNames') }}</span>
          </button>

          <button
            type="button"
            (click)="openBulkImportModal()"
            [disabled]="importing() || loading()"
            class="btn-navy text-xs !py-2.5 !px-4 font-bold inline-flex items-center gap-2 shadow-sm"
          >
            <app-icon name="planetakeoff" class="w-4 h-4" />
            <span>{{ lang.t('admin.airports.importByCountry') }}</span>
          </button>

          <button
            type="button"
            (click)="syncAllAirports()"
            [disabled]="syncingAll() || loading()"
            class="btn-navy text-xs !py-2.5 !px-4 font-bold inline-flex items-center gap-2 shadow-sm"
            [title]="lang.t('admin.airports.syncAllWarning')"
          >
            <app-icon name="refreshcw" class="w-4 h-4" [class.animate-spin]="syncingAll()" />
            <span>{{ syncingAll() ? lang.t('admin.airports.syncAllSyncing') : lang.t('admin.airports.syncAllFromAirLabs') }}</span>
          </button>

          <button
            type="button"
            (click)="openCreateModal()"
            class="btn-gold text-xs !py-2.5 !px-5 font-bold"
          >
            <app-icon name="plus" class="w-4 h-4" />
            <span>{{ lang.t('admin.airports.addAirport') }}</span>
          </button>
        </div>
      </div>

      <!-- Search & Filter Bar -->
      <div class="card-luxury p-4 border-slate-200 flex items-center gap-3">
        <div class="relative flex-1 max-w-sm">
          <app-icon name="search" class="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchQueryChange()"
            (keyup.enter)="loadAirports(true)"
            [placeholder]="lang.t('admin.airports.searchPlaceholder')"
            class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-gold"
          />
        </div>
        <button (click)="loadAirports(true)" class="btn-navy text-xs !py-2 !px-4">{{ lang.t('admin.airports.searchBtn') }}</button>
      </div>

      <!-- Airports Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.iataCode') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.icaoCode') }}</th>
                <th class="py-3.5 px-3">{{ lang.t('admin.airports.cityName') }}</th>
                <th class="py-3.5 px-3">{{ lang.t('admin.airports.airportName') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.countryCode') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.coordinates') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.dataSource') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.directService') }}</th>
                <th class="py-3.5 px-3 whitespace-nowrap">{{ lang.t('admin.airports.nearestAirport') }}</th>
                <th class="py-3.5 px-3 text-right whitespace-nowrap">{{ lang.t('common.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="10" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.t('admin.airports.loadingList') }}
                  </td>
                </tr>
              } @else {
                @for (ap of pagedAirports(); track ap.iata_code) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3 px-3 font-mono font-bold text-navy text-sm whitespace-nowrap">{{ ap.iata_code }}</td>
                    <td class="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">{{ ap.icao_code || '-' }}</td>
                    <td class="py-3 px-3 font-bold text-slate-800">{{ ap.city_name }}</td>
                    <td class="py-3 px-3 text-slate-600">{{ ap.airport_name }}</td>
                    <td class="py-3 px-3 font-mono uppercase text-slate-700 whitespace-nowrap">{{ ap.country_code || '-' }}</td>
                    <td class="py-3 px-3 font-mono text-slate-600 whitespace-nowrap text-[11px]">{{ formatCoordinates(ap) }}</td>
                    <td class="py-3 px-3 whitespace-nowrap">
                      @if (ap.data_source === 'airlabs') {
                        <span class="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold border border-sky-300">
                          AirLabs
                        </span>
                      } @else {
                        <span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">
                          {{ lang.isVietnamese() ? 'Nội bộ' : 'Internal' }}
                        </span>
                      }
                    </td>
                    <td class="py-3 px-3 whitespace-nowrap">
                      @if (ap.is_serviced_directly) {
                        <span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          {{ lang.t('admin.airports.direct') }}
                        </span>
                      } @else {
                        <span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          {{ lang.t('admin.airports.transitNearby') }}
                        </span>
                      }
                    </td>
                    <td class="py-3 px-3 text-slate-500 font-mono whitespace-nowrap">
                      {{ ap.nearest_airport_code ? (ap.nearest_airport_code + ' (' + ap.distance_to_nearest_km + 'km)') : '-' }}
                    </td>
                    <td class="py-3 px-3 text-right whitespace-nowrap">
                      <div class="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          (click)="syncAirport(ap)"
                          [disabled]="syncingIata() === ap.iata_code"
                          class="p-1.5 hover:bg-sky-50 text-sky-600 rounded-lg transition-colors"
                          [title]="lang.t('admin.airports.syncFromAirLabs')"
                        >
                          <app-icon name="refreshcw" class="w-4 h-4" [class.animate-spin]="syncingIata() === ap.iata_code" />
                        </button>
                        <button
                          type="button"
                          (click)="openEditModal(ap)"
                          class="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          [title]="lang.t('common.edit')"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          (click)="deleteAirport(ap)"
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
          [total]="airports().length"
          [page]="page()"
          [pageSize]="pageSize()"
          [pageSizeOptions]="pageSizeOptions"
          (pageChange)="onPageChange($event)"
          (pageSizeChange)="onPageSizeChange($event)"
        />
      </div>

    </div>

    <!-- Modal Create / Edit Airport -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="mappin" class="w-5 h-5 text-gold" />
              <span>{{ isEditMode ? lang.t('admin.airports.editAirport') : lang.t('admin.airports.addNewAirport') }}</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveAirport()" class="space-y-3 text-xs">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airports.iataLabel') }}</label>
              <input
                type="text"
                [(ngModel)]="formData.iata_code"
                name="iata"
                [disabled]="isEditMode"
                required
                maxlength="3"
                placeholder="HAN"
                class="w-full uppercase font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airports.icaoCode') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formData.icao_code"
                  name="icao"
                  maxlength="4"
                  placeholder="VVNB"
                  class="w-full uppercase font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airports.countryCode') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formData.country_code"
                  name="country"
                  maxlength="2"
                  placeholder="VN"
                  class="w-full uppercase font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airports.cityLabel') }}</label>
              <input
                type="text"
                [(ngModel)]="formData.city_name"
                name="city"
                required
                [placeholder]="lang.isVietnamese() ? 'Hà Nội' : 'Hanoi'"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airports.airportNameLabel') }}</label>
              <input
                type="text"
                [(ngModel)]="formData.airport_name"
                name="airport_name"
                required
                [placeholder]="lang.isVietnamese() ? 'Sân bay Quốc tế Nội Bài' : 'Noi Bai International Airport'"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div class="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                [(ngModel)]="formData.is_serviced_directly"
                name="serviced"
                id="serviced_check"
                class="rounded text-gold focus:ring-gold"
              />
              <label for="serviced_check" class="font-semibold text-slate-700">{{ lang.t('admin.airports.directFlightCheck') }}</label>
            </div>

            @if (!formData.is_serviced_directly) {
              <div class="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                <div>
                  <label class="block font-semibold text-amber-900 mb-1">{{ lang.t('admin.airports.nearestIataLabel') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formData.nearest_airport_code"
                    name="nearest_iata"
                    placeholder="DAD"
                    class="w-full uppercase font-mono px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label class="block font-semibold text-amber-900 mb-1">{{ lang.t('admin.airports.distanceKmLabel') }}</label>
                  <input
                    type="number"
                    [(ngModel)]="formData.distance_to_nearest_km"
                    name="dist_km"
                    placeholder="30"
                    class="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                </div>
              </div>
            }

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">{{ lang.t('admin.airports.saveInfo') }}</button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- Modal Bulk Import by Country -->
    @if (showBulkModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl p-6 border border-slate-200">
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="planetakeoff" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.airports.importModalTitle') }}</span>
            </h3>
            <button (click)="closeBulkModal()" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Body -->
          <div class="overflow-y-auto py-4 space-y-4 text-xs pr-1">
            <!-- Warning -->
            <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
              <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div class="leading-relaxed">{{ lang.t('admin.airports.importWarning') }}</div>
            </div>

            <!-- Rate Limited Banner (if applicable) -->
            @if (importResult()?.rate_limited) {
              <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-start gap-2.5 shadow-sm animate-fade-in">
                <app-icon name="alerttriangle" class="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div class="font-semibold leading-relaxed">{{ lang.t('admin.airports.importRateLimitedBanner') }}</div>
              </div>
            }

            <!-- Result Summary & Table (if results available) -->
            @if (importResult(); as res) {
              <div class="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl animate-fade-in">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <h4 class="font-bold text-navy text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                    <span>{{ lang.t('admin.airports.importResultTableTitle') }}</span>
                  </h4>
                  <span class="text-slate-600 font-semibold text-[11px] bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {{ getImportSummaryText(res) }}
                  </span>
                </div>

                <div class="overflow-x-auto border border-slate-200 rounded-xl bg-white max-h-52 overflow-y-auto">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-700 font-semibold sticky top-0 border-b border-slate-200">
                      <tr>
                        <th class="py-2 px-3">{{ lang.t('admin.airports.colCountry') }}</th>
                        <th class="py-2 px-3 text-center">{{ lang.t('admin.airports.colFetched') }}</th>
                        <th class="py-2 px-3 text-center">{{ lang.t('admin.airports.colImported') }}</th>
                        <th class="py-2 px-3 text-center">{{ lang.t('admin.airports.colUpdated') }}</th>
                        <th class="py-2 px-3 text-center">{{ lang.t('admin.airports.colSkipped') }}</th>
                        <th class="py-2 px-3">{{ lang.t('admin.airports.colError') }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 font-medium">
                      @for (r of res.results || []; track r.country_code) {
                        <tr class="hover:bg-slate-50 transition-colors">
                          <td class="py-2 px-3 font-mono font-bold text-navy">{{ r.country_code }}</td>
                          <td class="py-2 px-3 text-center text-slate-700 font-mono">{{ r.fetched }}</td>
                          <td class="py-2 px-3 text-center text-emerald-700 font-bold font-mono">{{ r.imported }}</td>
                          <td class="py-2 px-3 text-center text-sky-700 font-mono">{{ r.updated }}</td>
                          <td class="py-2 px-3 text-center text-amber-700 font-mono">{{ r.skipped_without_iata }}</td>
                          <td class="py-2 px-3 text-slate-500">
                            @if (r.error) {
                              <span class="text-rose-600 font-semibold">{{ r.error }}</span>
                            } @else {
                              <span class="text-slate-400">-</span>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            <!-- Known Countries Section -->
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <label class="font-bold text-slate-700">{{ lang.t('admin.airports.importKnownCountries') }}</label>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="selectAllFilteredCountries()"
                    class="text-gold hover:underline font-semibold text-[11px]"
                  >
                    {{ lang.t('admin.airports.importSelectAll') }}
                  </button>
                  <span class="text-slate-300">|</span>
                  <button
                    type="button"
                    (click)="deselectAllCountries()"
                    class="text-slate-500 hover:underline font-semibold text-[11px]"
                  >
                    {{ lang.t('admin.airports.importDeselectAll') }}
                  </button>
                </div>
              </div>

              <!-- Search country filter -->
              <div class="relative">
                <app-icon name="search" class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  [(ngModel)]="countrySearchQuery"
                  [placeholder]="lang.t('admin.airports.importSearchCountry')"
                  class="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-1 focus:ring-gold"
                />
              </div>

              <!-- Checkbox List -->
              <div class="border border-slate-200 rounded-2xl p-2.5 max-h-48 overflow-y-auto bg-slate-50/50 space-y-1">
                @if (loadingCountries()) {
                  <div class="py-6 text-center text-slate-400 flex items-center justify-center gap-2">
                    <app-icon name="refreshcw" class="w-4 h-4 animate-spin text-gold" />
                    <span>{{ lang.isVietnamese() ? 'Đang tải quốc gia...' : 'Loading countries...' }}</span>
                  </div>
                } @else if (filteredCountries().length === 0) {
                  <div class="py-4 text-center text-slate-400">
                    {{ lang.isVietnamese() ? 'Không tìm thấy quốc gia phù hợp' : 'No matching countries found' }}
                  </div>
                } @else {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    @for (c of filteredCountries(); track c.code) {
                      <label
                        class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer border border-transparent hover:border-slate-200"
                        [class.bg-sky-50]="isCountrySelected(c.code)"
                        [class.border-sky-200]="isCountrySelected(c.code)"
                      >
                        <input
                          type="checkbox"
                          [checked]="isCountrySelected(c.code)"
                          (change)="toggleCountrySelection(c.code)"
                          class="rounded text-gold focus:ring-gold"
                        />
                        <span class="font-mono font-bold text-navy text-[11px]">{{ c.code }}</span>
                        <span class="text-slate-700 truncate" [title]="c.name_vi || c.name">
                          {{ c.name_vi || c.name }}
                        </span>
                      </label>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Extra ISO codes free-text input -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                {{ lang.t('admin.airports.importExtraCodes') }}
              </label>
              <input
                type="text"
                [(ngModel)]="extraCodesInput"
                placeholder="KR,TH,SG"
                class="w-full uppercase font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
            <span class="text-[11px] text-slate-500">
              {{ lang.isVietnamese() ? 'Đã chọn:' : 'Selected:' }}
              <strong class="text-navy">{{ getSelectedTotalCount() }}</strong>
              {{ lang.isVietnamese() ? 'quốc gia' : 'countries' }}
            </span>
            <div class="flex items-center gap-2.5">
              <button
                type="button"
                (click)="closeBulkModal()"
                class="btn-ghost text-xs !py-2 !px-4"
              >
                {{ lang.t('common.cancel') }}
              </button>
              <button
                type="button"
                (click)="submitBulkImport()"
                [disabled]="importing() || getSelectedTotalCount() === 0"
                class="btn-gold text-xs !py-2 !px-5 font-bold inline-flex items-center gap-2"
              >
                @if (importing()) {
                  <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                  <span>{{ lang.t('admin.airports.importingBtn') }}</span>
                } @else {
                  <app-icon name="planetakeoff" class="w-4 h-4" />
                  <span>{{ lang.t('admin.airports.importStartBtn') }}</span>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- Modal Fix City Names Result -->
    @if (showFixCityModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 border border-slate-200 space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="edit" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.airports.fixCityModalTitle') }}</span>
            </h3>
            <button (click)="showFixCityModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          @if (fixCityResult(); as res) {
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700">
              {{ getFixCitySummaryText(res) }}
            </div>

            @if (getSampleRows(res).length > 0) {
              <div class="space-y-2 text-xs">
                <p class="font-bold text-slate-700">{{ lang.t('admin.airports.fixCitySampleTitle') }}</p>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th class="py-2 px-3">{{ lang.t('admin.airports.fixCityColIata') }}</th>
                        <th class="py-2 px-3">{{ lang.t('admin.airports.fixCityColOld') }}</th>
                        <th class="py-2 px-3">{{ lang.t('admin.airports.fixCityColNew') }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white font-medium">
                      @for (s of getSampleRows(res); track $index) {
                        <tr>
                          <td class="py-2 px-3 font-mono font-bold text-navy">{{ getSampleIata(s) }}</td>
                          <td class="py-2 px-3 text-slate-400 line-through">{{ getSampleOld(s) }}</td>
                          <td class="py-2 px-3 text-emerald-700 font-semibold">{{ getSampleNew(s) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            } @else {
              <p class="text-xs text-slate-500 italic py-2">
                {{ lang.t('admin.airports.fixCityNoChanges') }}
              </p>
            }
          }

          <div class="flex justify-end pt-3 border-t border-slate-100">
            <button
              type="button"
              (click)="showFixCityModal.set(false)"
              class="btn-gold text-xs !py-2 !px-5 font-bold"
            >
              {{ lang.isVietnamese() ? 'Đóng' : 'Close' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AirportsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly airports = signal<Airport[]>([]);
  readonly loading = signal(false);
  readonly syncingAll = signal(false);
  readonly syncingIata = signal<string | null>(null);
  searchQuery = '';

  // Pagination (Task 1)
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly pageSizeOptions = [10, 20, 30, 50, 100];

  readonly pagedAirports = computed(() => {
    const list = this.airports();
    const p = this.page();
    const size = this.pageSize();
    const start = (p - 1) * size;
    return list.slice(start, start + size);
  });

  // Bulk Import Modal (Task 3)
  readonly showBulkModal = signal(false);
  readonly knownCountries = signal<CountrySuggestion[]>([]);
  readonly loadingCountries = signal(false);
  readonly selectedCountryCodes = signal<string[]>([]);
  countrySearchQuery = '';
  extraCodesInput = '';
  readonly importing = signal(false);
  readonly importResult = signal<AirportImportCountriesResponse | null>(null);

  readonly filteredCountries = computed(() => {
    const q = this.countrySearchQuery.trim().toLowerCase();
    const list = this.knownCountries();
    if (!q) return list;
    return list.filter(
      (c) =>
        (c.code && c.code.toLowerCase().includes(q)) ||
        (c.name_vi && c.name_vi.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)),
    );
  });

  // Fix City Names (Task 3)
  readonly fixingCityNames = signal(false);
  readonly showFixCityModal = signal(false);
  readonly fixCityResult = signal<AirportFixCityNamesResponse | null>(null);

  readonly showModal = signal(false);
  isEditMode = false;
  formData: any = {};

  ngOnInit(): void {
    this.loadAirports();
  }

  onSearchQueryChange(): void {
    this.page.set(1);
  }

  onPageChange(newPage: number): void {
    this.page.set(newPage);
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize.set(newSize);
    this.page.set(1);
  }

  loadAirports(resetPage = false): void {
    if (resetPage) {
      this.page.set(1);
    }
    this.loading.set(true);
    this.api.getAirports(this.searchQuery).subscribe({
      next: (list) => {
        this.airports.set(list || []);
        this.loading.set(false);
        const maxPage = Math.max(1, Math.ceil((list?.length || 0) / this.pageSize()));
        if (this.page() > maxPage) {
          this.page.set(maxPage);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.airports.loadError'));
      },
    });
  }

  openBulkImportModal(): void {
    this.showBulkModal.set(true);
    this.importResult.set(null);
    this.selectedCountryCodes.set([]);
    this.countrySearchQuery = '';
    this.extraCodesInput = '';
    this.loadingCountries.set(true);
    this.api.getCountries().subscribe({
      next: (list) => {
        this.knownCountries.set(list || []);
        this.loadingCountries.set(false);
      },
      error: () => {
        this.loadingCountries.set(false);
      },
    });
  }

  closeBulkModal(): void {
    this.showBulkModal.set(false);
  }

  isCountrySelected(code: string): boolean {
    return this.selectedCountryCodes().includes(code.toUpperCase());
  }

  toggleCountrySelection(code: string): void {
    const upper = code.toUpperCase();
    const current = this.selectedCountryCodes();
    if (current.includes(upper)) {
      this.selectedCountryCodes.set(current.filter((c) => c !== upper));
    } else {
      this.selectedCountryCodes.set([...current, upper]);
    }
  }

  selectAllFilteredCountries(): void {
    const current = new Set(this.selectedCountryCodes());
    this.filteredCountries().forEach((c) => current.add(c.code.toUpperCase()));
    this.selectedCountryCodes.set(Array.from(current));
  }

  deselectAllCountries(): void {
    this.selectedCountryCodes.set([]);
  }

  getSelectedTotalCount(): number {
    const fromCheckboxes = this.selectedCountryCodes().length;
    const fromInput = this.extraCodesInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length >= 2 && !this.selectedCountryCodes().includes(s));
    return fromCheckboxes + fromInput.length;
  }

  submitBulkImport(): void {
    const fromCheckboxes = this.selectedCountryCodes();
    const fromInput = this.extraCodesInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length >= 2);
    const combined = Array.from(new Set([...fromCheckboxes, ...fromInput]));

    if (combined.length === 0) {
      this.toast.warning(this.lang.t('admin.airports.importNoCountrySelected'));
      return;
    }

    this.importing.set(true);
    this.api.importAirportsForCountries(combined).subscribe({
      next: (res) => {
        this.importing.set(false);
        this.importResult.set(res);
        this.toast.success(this.lang.t('admin.airports.importSuccessToast'));
        this.loadAirports();
      },
      error: (err) => {
        this.importing.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.airports.importErrorToast'));
      },
    });
  }

  getImportSummaryText(res: AirportImportCountriesResponse): string {
    return this.lang.t('admin.airports.importSummary')
      .replace('{requested}', String(res.requested ?? 0))
      .replace('{done}', String(res.done ?? 0))
      .replace('{failed}', String(res.failed ?? 0));
  }

  fixCityNames(): void {
    this.fixingCityNames.set(true);
    this.api.fixAirportCityNames().subscribe({
      next: (res) => {
        this.fixingCityNames.set(false);
        this.fixCityResult.set(res);
        this.showFixCityModal.set(true);
        this.toast.success(this.lang.t('admin.airports.fixCitySuccessToast'));
        this.loadAirports();
      },
      error: (err) => {
        this.fixingCityNames.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.airports.fixCityErrorToast'));
      },
    });
  }

  getFixCitySummaryText(res: AirportFixCityNamesResponse): string {
    return this.lang.t('admin.airports.fixCitySummary')
      .replace('{checked}', String(res.checked ?? 0))
      .replace('{fixed}', String(res.fixed ?? 0));
  }

  getSampleRows(res: AirportFixCityNamesResponse): any[] {
    const list = res.samples || res.sample_fixes || [];
    return Array.isArray(list) ? list.slice(0, 3) : [];
  }

  getSampleIata(s: any): string {
    return s?.iata_code || s?.iata || s?.code || '-';
  }

  getSampleOld(s: any): string {
    return s?.old_city || s?.old_name || s?.old || s?.before || '-';
  }

  getSampleNew(s: any): string {
    return s?.new_city || s?.new_name || s?.new || s?.after || '-';
  }

  formatCoordinates(ap: Airport): string {
    if (ap.lat != null && ap.lng != null && !isNaN(Number(ap.lat)) && !isNaN(Number(ap.lng))) {
      return `${Number(ap.lat).toFixed(4)}, ${Number(ap.lng).toFixed(4)}`;
    }
    return '-';
  }

  getFieldLabel(field: string): string {
    switch (field) {
      case 'airport_name':
      case 'name':
        return this.lang.t('admin.airports.fieldAirportName');
      case 'city_name':
      case 'city':
        return this.lang.t('admin.airports.fieldCityName');
      case 'icao_code':
      case 'icao':
        return this.lang.t('admin.airports.fieldIcaoCode');
      case 'country_code':
      case 'country':
        return this.lang.t('admin.airports.fieldCountryCode');
      case 'lat':
      case 'lng':
      case 'lat_lng':
      case 'coordinates':
        return this.lang.t('admin.airports.fieldCoordinates');
      default:
        return field;
    }
  }

  syncAirport(ap: Airport): void {
    this.syncingIata.set(ap.iata_code);
    this.api.syncAirportFromAirLabs(ap.iata_code).subscribe({
      next: (res: any) => {
        this.syncingIata.set(null);
        const updated: Airport = res?.airport || res;
        const changes: string[] = [];

        if (res?.changes) {
          if (Array.isArray(res.changes)) {
            changes.push(...res.changes.map(String));
          } else if (typeof res.changes === 'object') {
            for (const [key, val] of Object.entries(res.changes)) {
              const fieldLabel = this.getFieldLabel(key);
              if (val && typeof val === 'object' && ('new' in (val as any) || 'to' in (val as any))) {
                const newVal = (val as any).new ?? (val as any).to;
                changes.push(`${fieldLabel}: ${newVal}`);
              } else {
                changes.push(`${fieldLabel}: ${val}`);
              }
            }
          }
        }

        if (changes.length === 0 && updated && typeof updated === 'object') {
          if (updated.airport_name && updated.airport_name !== ap.airport_name) {
            changes.push(`${this.lang.t('admin.airports.fieldAirportName')}: ${updated.airport_name}`);
          }
          if (updated.city_name && updated.city_name !== ap.city_name) {
            changes.push(`${this.lang.t('admin.airports.fieldCityName')}: ${updated.city_name}`);
          }
          if (updated.icao_code && updated.icao_code !== ap.icao_code) {
            changes.push(`${this.lang.t('admin.airports.fieldIcaoCode')}: ${updated.icao_code}`);
          }
          if (updated.country_code && updated.country_code !== ap.country_code) {
            changes.push(`${this.lang.t('admin.airports.fieldCountryCode')}: ${updated.country_code}`);
          }
          const oldCoords = (ap.lat != null && ap.lng != null) ? `${ap.lat}, ${ap.lng}` : '';
          const newCoords = (updated.lat != null && updated.lng != null) ? `${updated.lat}, ${updated.lng}` : '';
          if (newCoords && newCoords !== oldCoords) {
            changes.push(`${this.lang.t('admin.airports.fieldCoordinates')}: ${newCoords}`);
          }
        }

        if (changes.length > 0) {
          const toastMsg = `${this.lang.t('admin.airports.syncSuccessChanged')} ${changes.join(', ')}`;
          this.toast.success(toastMsg);
        } else {
          this.toast.info(`${ap.iata_code}: ${this.lang.t('admin.airports.noChanges')}`);
        }

        this.loadAirports();
      },
      error: (err) => {
        this.syncingIata.set(null);
        this.toast.error(err.error?.message || this.lang.t('admin.airports.updateError'));
      },
    });
  }

  syncAllAirports(): void {
    const warningMsg = this.lang.t('admin.airports.syncAllWarning');
    if (!confirm(warningMsg)) return;

    this.syncingAll.set(true);
    this.api.syncAllAirportsFromAirLabs().subscribe({
      next: (res) => {
        this.syncingAll.set(false);
        const checked = res.checked ?? 0;
        const updated = res.updated ?? 0;
        const failed = res.failed ?? 0;
        const msg = this.lang.isVietnamese()
          ? `Đồng bộ toàn bộ hoàn tất: Đã kiểm tra ${checked} sân bay, cập nhật ${updated}, thất bại ${failed}.`
          : `Sync all completed: Checked ${checked} airports, updated ${updated}, failed ${failed}.`;
        this.toast.success(msg);
        this.loadAirports();
      },
      error: (err) => {
        this.syncingAll.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.airports.updateError'));
      },
    });
  }

  openCreateModal(): void {
    this.isEditMode = false;
    this.formData = {
      iata_code: '',
      city_name: '',
      airport_name: '',
      icao_code: '',
      country_code: '',
      is_serviced_directly: true,
      time_zone: 'Asia/Ho_Chi_Minh',
    };
    this.showModal.set(true);
  }

  openEditModal(ap: Airport): void {
    this.isEditMode = true;
    this.formData = { ...ap };
    this.showModal.set(true);
  }

  saveAirport(): void {
    if (!this.formData.iata_code || !this.formData.city_name) {
      this.toast.warning(this.lang.t('admin.airports.validationWarning'));
      return;
    }

    if (this.isEditMode) {
      this.api.updateAirport(this.formData.iata_code, this.formData).subscribe({
        next: () => {
          this.toast.success(this.lang.t('admin.airports.updateSuccess'));
          this.showModal.set(false);
          this.loadAirports();
        },
        error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.airports.updateError')),
      });
    } else {
      this.api.createAirport(this.formData).subscribe({
        next: () => {
          this.toast.success(this.lang.t('admin.airports.createSuccess'));
          this.showModal.set(false);
          this.loadAirports();
        },
        error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.airports.createError')),
      });
    }
  }

  deleteAirport(ap: Airport): void {
    const confirmPrompt = this.lang.isVietnamese() ? `Bạn có chắc muốn xóa sân bay ${ap.iata_code} (${ap.city_name})?` : `Are you sure you want to delete airport ${ap.iata_code} (${ap.city_name})?`;
    if (!confirm(confirmPrompt)) return;

    this.api.deleteAirport(ap.iata_code).subscribe({
      next: () => {
        const successMsg = this.lang.isVietnamese() ? `Đã xóa sân bay ${ap.iata_code}` : `Deleted airport ${ap.iata_code}`;
        this.toast.success(successMsg);
        this.loadAirports();
      },
      error: (err) => this.toast.error(err.error?.message || this.lang.t('admin.airports.deleteError')),
    });
  }
}
