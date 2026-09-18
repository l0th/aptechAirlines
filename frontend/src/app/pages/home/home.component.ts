import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  of,
  switchMap,
} from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import {
  Airport,
  AirportSuggestion,
  CitySuggestion,
  CountrySuggestion,
  LocationScope,
  LocationSuggestResponse,
} from '../../core/models/airport.model';
import { CabinClass } from '../../core/models/flight.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <div class="min-h-screen bg-slate-50 flex flex-col">
      <!-- Hero Banner Section -->
      <section class="relative bg-navy text-white pt-12 pb-32 sm:pb-40 overflow-hidden">
        <!-- Subtle aviation background gradient & accents -->
        <div class="absolute inset-0 opacity-15 bg-[radial-gradient(#D4AF37_1px,transparent_1px)] [background-size:24px_24px]"></div>
        <div class="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>

        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy-light/60 border border-gold/40 text-xs font-semibold text-gold mb-6 shadow-sm">
            <app-icon name="crown" class="w-4 h-4 text-gold" />
            <span>{{ lang.t('nav.slogan') }}</span>
          </div>

          <h1 class="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight max-w-4xl mx-auto">
            {{ lang.t('hero.title') }}
          </h1>

          <p class="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto mt-4 leading-relaxed font-normal">
            {{ lang.t('hero.subtitle') }}
          </p>
        </div>
      </section>

      <!-- Flight Search Engine (Floating Card) -->
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 sm:-mt-28 relative z-20 w-full mb-16">
        <div class="card-luxury p-6 sm:p-8 shadow-2xl border-slate-200">
          
          <!-- Tab selector: One-way / Round-trip -->
          <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
            <div class="flex items-center gap-2 bg-slate-100 p-1 rounded-full">
              <button
                type="button"
                (click)="isRoundTrip.set(false)"
                [class.bg-navy]="!isRoundTrip()"
                [class.text-white]="!isRoundTrip()"
                [class.shadow-sm]="!isRoundTrip()"
                [class.text-slate-600]="isRoundTrip()"
                class="px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2"
              >
                <app-icon name="arrowright" class="w-4 h-4" />
                <span>{{ lang.t('search.oneWay') }}</span>
              </button>

              <button
                type="button"
                (click)="isRoundTrip.set(true)"
                [class.bg-navy]="isRoundTrip()"
                [class.text-white]="isRoundTrip()"
                [class.shadow-sm]="isRoundTrip()"
                [class.text-slate-600]="!isRoundTrip()"
                class="px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2"
              >
                <app-icon name="arrowrightleft" class="w-4 h-4" />
                <span>{{ lang.t('search.roundTrip') }}</span>
              </button>
            </div>

            <!-- Cabin Class Picker -->
            <div class="flex items-center gap-2">
              <label class="text-xs font-bold text-slate-500 hidden sm:block">{{ lang.t('search.cabinClass') }}:</label>
              <select
                [(ngModel)]="cabinClass"
                class="bg-slate-50 border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gold/50"
              >
                <option [value]="CabinClass.ECONOMY">{{ lang.t('search.economy') }}</option>
                <option [value]="CabinClass.BUSINESS">{{ lang.t('search.business') }}</option>
                <option [value]="CabinClass.FIRST">{{ lang.t('search.first') }}</option>
                <option [value]="CabinClass.CLUB">{{ lang.t('search.club') }}</option>
              </select>
            </div>

            <!-- Smoking Preference Picker -->
            <div class="flex items-center gap-2">
              <label class="text-xs font-bold text-slate-500 hidden sm:block">{{ lang.t('search.smoking') }}:</label>
              <select
                [(ngModel)]="isSmoking"
                class="bg-slate-50 border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gold/50"
              >
                <option [ngValue]="undefined">{{ lang.t('search.smokingAll') }}</option>
                <option [ngValue]="true">{{ lang.t('search.smokingYes') }}</option>
                <option [ngValue]="false">{{ lang.t('search.smokingNo') }}</option>
              </select>
            </div>
          </div>

          <!-- Main Search Grid -->
          <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            
            <!-- Origin -->
            <div class="md:col-span-3 relative" #originContainer>
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center justify-between">
                <span class="flex items-center gap-1.5">
                  <app-icon name="planetakeoff" class="w-4 h-4 text-gold" />
                  <span>{{ lang.t('search.from') }}</span>
                </span>
                @if (originLoading()) {
                  <span class="text-[10px] text-slate-400 flex items-center gap-1 font-normal">
                    <app-icon name="refreshcw" class="w-3 h-3 animate-spin text-gold" />
                    <span>{{ lang.t('search.searchingLocations') }}</span>
                  </span>
                }
              </label>

              <div class="relative">
                <input
                  type="text"
                  [(ngModel)]="origin"
                  (input)="onOriginInput($event)"
                  (focus)="onOriginFocus()"
                  (keydown)="onOriginKeydown($event)"
                  [placeholder]="lang.t('search.inputOriginPlaceholder')"
                  role="combobox"
                  aria-autocomplete="list"
                  [attr.aria-expanded]="originOpen()"
                  aria-controls="origin-suggestions-panel"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl pl-4 pr-9 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
                />
                @if (origin) {
                  <button
                    type="button"
                    (click)="clearOrigin($event)"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    [title]="lang.t('search.clearSelection')"
                  >
                    <app-icon name="x" class="w-3.5 h-3.5" />
                  </button>
                } @else {
                  <div class="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <app-icon name="search" class="w-4 h-4" />
                  </div>
                }
              </div>

              <!-- Scope Hint Chip under Origin -->
              @if (originScope()) {
                <div class="mt-1.5 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-full px-2.5 py-0.5 w-fit">
                  <app-icon name="info" class="w-3 h-3 text-amber-600 shrink-0" />
                  <span class="font-medium truncate max-w-[200px]" [title]="originScope()?.label">
                    {{ originScope()?.label }}
                  </span>
                  <button
                    type="button"
                    (click)="originScope.set(null)"
                    class="text-amber-500 hover:text-amber-800 font-bold ml-0.5 leading-none"
                  >
                    &times;
                  </button>
                </div>
              }

              <!-- Dropdown Suggestion Panel for Origin -->
              @if (originOpen()) {
                <div
                  id="origin-suggestions-panel"
                  role="listbox"
                  class="absolute left-0 top-full mt-1.5 w-full sm:min-w-[320px] max-w-full sm:max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden divide-y divide-slate-100 max-h-80 overflow-y-auto"
                >
                  @if (hasOriginSuggestions()) {
                    <!-- Group 1: Countries -->
                    @if (originSuggestions()?.countries && originSuggestions()!.countries.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="compass" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupCountries') }}</span>
                        </div>
                        @for (country of originSuggestions()!.countries; track country.code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isOriginHighlighted('country', country.code)"
                            (click)="selectCountry('origin', country)"
                            (mouseenter)="setOriginHighlighted('country', country.code)"
                            [class.bg-amber-50]="isOriginHighlighted('country', country.code)"
                            [class.text-navy]="isOriginHighlighted('country', country.code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ lang.isVietnamese() ? (country.name_vi || country.name) : (country.name || country.name_vi) }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                @if (country.airport_count !== undefined) {
                                  {{ country.airport_count }} {{ lang.t('search.airportsCount') }}
                                } @else {
                                  {{ country.code }} · {{ lang.t('search.countryScopeHint') }}
                                }
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                              {{ country.code }}
                            </span>
                          </div>
                        }
                      </div>
                    }

                    <!-- Group 2: Cities (multi-airport) -->
                    @if (originSuggestions()?.cities && originSuggestions()!.cities.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="mappin" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupCities') }}</span>
                        </div>
                        @for (city of originSuggestions()!.cities; track city.city_code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isOriginHighlighted('city', city.city_code)"
                            (click)="selectCity('origin', city)"
                            (mouseenter)="setOriginHighlighted('city', city.city_code)"
                            [class.bg-amber-50]="isOriginHighlighted('city', city.city_code)"
                            [class.text-navy]="isOriginHighlighted('city', city.city_code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ lang.isVietnamese() ? (city.name_vi || city.name) : (city.name || city.name_vi) }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                {{ city.iata_codes && city.iata_codes.length > 0 ? city.iata_codes.join(', ') : city.city_code }}
                                @if (city.airport_count) {
                                  · {{ city.airport_count }} {{ lang.t('search.airportsCount') }}
                                }
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                              {{ city.city_code }}
                            </span>
                          </div>
                        }
                      </div>
                    }

                    <!-- Group 3: Airports -->
                    @if (originSuggestions()?.airports && originSuggestions()!.airports.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="plane" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupAirports') }}</span>
                        </div>
                        @for (ap of originSuggestions()!.airports; track ap.iata_code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isOriginHighlighted('airport', ap.iata_code)"
                            (click)="selectAirport('origin', ap)"
                            (mouseenter)="setOriginHighlighted('airport', ap.iata_code)"
                            [class.bg-amber-50]="isOriginHighlighted('airport', ap.iata_code)"
                            [class.text-navy]="isOriginHighlighted('airport', ap.iata_code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ ap.iata_code }} - {{ ap.airport_name }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                {{ ap.city_name }}{{ ap.country_code ? ' · ' + ap.country_code : '' }}
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                              {{ ap.iata_code }}
                            </span>
                          </div>
                        }
                      </div>
                    }
                  } @else if (!originLoading()) {
                    <div class="p-4 text-center text-xs text-slate-400">
                      {{ lang.t('search.noSuggestions') }}
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Swap Button -->
            <div class="md:col-span-1 flex justify-center pb-2">
              <button
                type="button"
                (click)="swapAirports()"
                class="w-10 h-10 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-navy hover:text-gold shadow-sm flex items-center justify-center transition-all hover:rotate-180"
                [title]="lang.t('search.swap')"
              >
                <app-icon name="arrowrightleft" class="w-4 h-4" />
              </button>
            </div>

            <!-- Destination -->
            <div class="md:col-span-3 relative" #destContainer>
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center justify-between">
                <span class="flex items-center gap-1.5">
                  <app-icon name="planelanding" class="w-4 h-4 text-gold" />
                  <span>{{ lang.t('search.to') }}</span>
                </span>
                @if (destLoading()) {
                  <span class="text-[10px] text-slate-400 flex items-center gap-1 font-normal">
                    <app-icon name="refreshcw" class="w-3 h-3 animate-spin text-gold" />
                    <span>{{ lang.t('search.searchingLocations') }}</span>
                  </span>
                }
              </label>

              <div class="relative">
                <input
                  type="text"
                  [(ngModel)]="destination"
                  (input)="onDestInput($event)"
                  (focus)="onDestFocus()"
                  (keydown)="onDestKeydown($event)"
                  [placeholder]="lang.t('search.inputDestPlaceholder')"
                  role="combobox"
                  aria-autocomplete="list"
                  [attr.aria-expanded]="destOpen()"
                  aria-controls="dest-suggestions-panel"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl pl-4 pr-9 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
                />
                @if (destination) {
                  <button
                    type="button"
                    (click)="clearDestination($event)"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    [title]="lang.t('search.clearSelection')"
                  >
                    <app-icon name="x" class="w-3.5 h-3.5" />
                  </button>
                } @else {
                  <div class="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <app-icon name="search" class="w-4 h-4" />
                  </div>
                }
              </div>

              <!-- Scope Hint Chip under Destination -->
              @if (destScope()) {
                <div class="mt-1.5 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-full px-2.5 py-0.5 w-fit">
                  <app-icon name="info" class="w-3 h-3 text-amber-600 shrink-0" />
                  <span class="font-medium truncate max-w-[200px]" [title]="destScope()?.label">
                    {{ destScope()?.label }}
                  </span>
                  <button
                    type="button"
                    (click)="destScope.set(null)"
                    class="text-amber-500 hover:text-amber-800 font-bold ml-0.5 leading-none"
                  >
                    &times;
                  </button>
                </div>
              }

              <!-- Dropdown Suggestion Panel for Destination -->
              @if (destOpen()) {
                <div
                  id="dest-suggestions-panel"
                  role="listbox"
                  class="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-full sm:min-w-[320px] max-w-full sm:max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden divide-y divide-slate-100 max-h-80 overflow-y-auto"
                >
                  @if (hasDestSuggestions()) {
                    <!-- Group 1: Countries -->
                    @if (destSuggestions()?.countries && destSuggestions()!.countries.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="compass" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupCountries') }}</span>
                        </div>
                        @for (country of destSuggestions()!.countries; track country.code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isDestHighlighted('country', country.code)"
                            (click)="selectCountry('destination', country)"
                            (mouseenter)="setDestHighlighted('country', country.code)"
                            [class.bg-amber-50]="isDestHighlighted('country', country.code)"
                            [class.text-navy]="isDestHighlighted('country', country.code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ lang.isVietnamese() ? (country.name_vi || country.name) : (country.name || country.name_vi) }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                @if (country.airport_count !== undefined) {
                                  {{ country.code }} · {{ country.airport_count }} {{ lang.t('search.airportsCount') }}
                                } @else {
                                  {{ country.code }} · {{ lang.t('search.countryScopeHint') }}
                                }
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                              {{ country.code }}
                            </span>
                          </div>
                        }
                      </div>
                    }

                    <!-- Group 2: Cities (multi-airport) -->
                    @if (destSuggestions()?.cities && destSuggestions()!.cities.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="mappin" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupCities') }}</span>
                        </div>
                        @for (city of destSuggestions()!.cities; track city.city_code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isDestHighlighted('city', city.city_code)"
                            (click)="selectCity('destination', city)"
                            (mouseenter)="setDestHighlighted('city', city.city_code)"
                            [class.bg-amber-50]="isDestHighlighted('city', city.city_code)"
                            [class.text-navy]="isDestHighlighted('city', city.city_code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ lang.isVietnamese() ? (city.name_vi || city.name) : (city.name || city.name_vi) }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                {{ city.iata_codes && city.iata_codes.length > 0 ? city.iata_codes.join(', ') : city.city_code }}
                                @if (city.airport_count) {
                                  · {{ city.airport_count }} {{ lang.t('search.airportsCount') }}
                                }
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                              {{ city.city_code }}
                            </span>
                          </div>
                        }
                      </div>
                    }

                    <!-- Group 3: Airports -->
                    @if (destSuggestions()?.airports && destSuggestions()!.airports.length > 0) {
                      <div class="py-1">
                        <div class="px-3.5 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 flex items-center gap-1.5">
                          <app-icon name="plane" class="w-3.5 h-3.5 text-gold" />
                          <span>{{ lang.t('search.groupAirports') }}</span>
                        </div>
                        @for (ap of destSuggestions()!.airports; track ap.iata_code) {
                          <div
                            role="option"
                            [attr.aria-selected]="isDestHighlighted('airport', ap.iata_code)"
                            (click)="selectAirport('destination', ap)"
                            (mouseenter)="setDestHighlighted('airport', ap.iata_code)"
                            [class.bg-amber-50]="isDestHighlighted('airport', ap.iata_code)"
                            [class.text-navy]="isDestHighlighted('airport', ap.iata_code)"
                            class="px-3.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-left"
                          >
                            <div class="min-w-0">
                              <div class="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                                {{ ap.iata_code }} - {{ ap.airport_name }}
                              </div>
                              <div class="text-[11px] text-slate-400 truncate">
                                {{ ap.city_name }}{{ ap.country_code ? ' · ' + ap.country_code : '' }}
                              </div>
                            </div>
                            <span class="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                              {{ ap.iata_code }}
                            </span>
                          </div>
                        }
                      </div>
                    }
                  } @else if (!destLoading()) {
                    <div class="p-4 text-center text-xs text-slate-400">
                      {{ lang.t('search.noSuggestions') }}
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Departure Date -->
            <div [class.md:col-span-2]="isRoundTrip()" [class.md:col-span-3]="!isRoundTrip()">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="calendar" class="w-4 h-4 text-gold" />
                <span>{{ lang.t('search.depDate') }}</span>
              </label>
              <input
                type="date"
                [(ngModel)]="departureDate"
                [min]="minBookingDate || todayStr"
                [max]="maxBookingDate"
                class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3.5 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
              />
              <p class="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1 truncate" [title]="bookingWindowCaption">
                <app-icon name="info" class="w-3.5 h-3.5 text-gold shrink-0" />
                <span>{{ bookingWindowCaption }}</span>
              </p>
            </div>

            <!-- Return Date (Only if Round Trip) -->
            @if (isRoundTrip()) {
              <div class="md:col-span-3">
                <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <app-icon name="calendar" class="w-4 h-4 text-gold" />
                  <span>{{ lang.t('search.retDate') }}</span>
                </label>
                <input
                  type="date"
                  [(ngModel)]="returnDate"
                  [min]="departureDate || minBookingDate || todayStr"
                  [max]="maxBookingDate"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3.5 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
            }

            <!-- Passengers Dropdown Pill -->
            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <app-icon name="users" class="w-4 h-4 text-gold" />
                <span>{{ lang.t('home.passengersLabel') }}</span>
              </label>
              <div class="relative">
                <button
                  type="button"
                  (click)="showPassengerPicker.set(!showPassengerPicker())"
                  class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-3 py-3 text-xs sm:text-sm font-semibold text-left flex items-center justify-between"
                >
                  <span>{{ totalPassengers() }} {{ lang.t('home.guests') }}</span>
                  <app-icon name="chevrondown" class="w-4 h-4 text-slate-400" />
                </button>

                <!-- Passenger Popover -->
                @if (showPassengerPicker()) {
                  <div class="absolute right-0 bottom-full mb-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-30 space-y-3 animate-fade-in">
                    <!-- Adults -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">{{ lang.t('home.adults') }}</div>
                        <div class="text-[10px] text-slate-400">{{ lang.t('home.adultsDesc') }}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="adults = adults > 1 ? adults - 1 : 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ adults }}</span>
                        <button
                          type="button"
                          (click)="adults = adults + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <!-- Children -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">{{ lang.t('home.children') }}</div>
                        <div class="text-[10px] text-amber-600 font-medium">{{ lang.t('home.childrenDesc') }}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="children = children > 0 ? children - 1 : 0"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ children }}</span>
                        <button
                          type="button"
                          (click)="children = children + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <!-- Seniors -->
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-bold text-slate-800">{{ lang.t('home.seniors') }}</div>
                        <div class="text-[10px] text-amber-600 font-medium">{{ lang.t('home.seniorsDesc') }}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          (click)="seniors = seniors > 0 ? seniors - 1 : 0"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span class="w-5 text-center font-bold text-xs">{{ seniors }}</span>
                        <button
                          type="button"
                          (click)="seniors = seniors + 1"
                          class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      (click)="showPassengerPicker.set(false)"
                      class="w-full py-2 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light mt-2"
                    >
                      {{ lang.t('home.done') }}
                    </button>
                  </div>
                }
              </div>
            </div>

          </div>

          <!-- Compact Quick-Select Row for Popular Cities -->
          <div class="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span class="font-bold text-slate-500 flex items-center gap-1.5 shrink-0">
              <app-icon name="compass" class="w-3.5 h-3.5 text-gold" />
              <span>{{ lang.t('search.quickSelect') }}</span>
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
              @for (city of popularCityChips; track city.token) {
                <button
                  type="button"
                  (click)="selectQuickCity(city)"
                  class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 hover:bg-gold/20 hover:text-navy text-slate-700 transition-all border border-slate-200/80 flex items-center gap-1"
                  [class.bg-amber-100]="destination === city.token || origin === city.token"
                  [class.text-amber-900]="destination === city.token || origin === city.token"
                  [class.border-amber-300]="destination === city.token || origin === city.token"
                >
                  <span>{{ lang.t(city.langKey) }}</span>
                  <span class="text-[10px] font-mono text-slate-500">({{ city.token }})</span>
                </button>
              }
            </div>
          </div>

          <!-- Action Submit Button -->
          <div class="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="text-xs text-slate-500 flex items-center gap-2">
              <app-icon name="shieldcheck" class="w-4 h-4 text-emerald-600" />
              <span>{{ lang.t('home.taxIncluded') }}</span>
            </div>

            <button
              type="button"
              (click)="onSearch()"
              class="btn-gold w-full sm:w-auto !py-3.5 !px-8 text-sm uppercase tracking-wider font-bold"
            >
              <app-icon name="search" class="w-4 h-4" />
              <span>{{ lang.t('search.btn') }}</span>
            </button>
          </div>

        </div>
      </div>

      <!-- Popular Routes Section -->
      <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div class="text-center mb-10">
          <span class="text-xs font-bold uppercase tracking-widest text-gold block mb-1">{{ lang.t('home.popular.subtitle') }}</span>
          <h2 class="text-2xl sm:text-3xl font-bold text-navy">{{ lang.t('home.popular.title') }}</h2>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          @for (route of popularRoutes; track route.from + route.to) {
            <div
              (click)="selectPopularRoute(route.from, route.to)"
              class="card-luxury p-5 cursor-pointer hover:border-gold group transition-all duration-200"
            >
              <div class="flex items-center justify-between mb-4">
                <span class="text-xs font-mono font-bold bg-slate-100 text-navy px-2.5 py-1 rounded-full">
                  {{ route.from }} - {{ route.to }}
                </span>
                <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {{ lang.t('home.popular.daily') }}
                </span>
              </div>
              <h3 class="text-base font-bold text-navy group-hover:text-amber-600 transition-colors">
                {{ route.fromCity }} 
                <app-icon name="arrowright" class="w-3.5 h-3.5 inline text-slate-400 mx-1" />
                {{ route.toCity }}
              </h3>
              <p class="text-xs text-slate-500 mt-1">{{ lang.t('home.popular.duration') }} ~{{ route.duration }}</p>
              <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span class="text-slate-400">{{ lang.t('home.popular.priceFrom') }}</span>
                <span class="font-bold text-navy text-sm">{{ route.price }}</span>
              </div>
            </div>
          }
        </div>
      </section>

      <!-- Why Choose Aptech Airlines Section -->
      <section class="bg-white py-16 border-t border-slate-200/80 mt-auto">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-gold flex items-center justify-center shrink-0 border border-gold/30">
                <app-icon name="shieldcheck" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">{{ lang.t('home.feature1.title') }}</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {{ lang.t('home.feature1.desc') }}
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0 border border-navy/20">
                <app-icon name="armchair" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">{{ lang.t('home.feature2.title') }}</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {{ lang.t('home.feature2.desc') }}
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-gold flex items-center justify-center shrink-0 border border-gold/30">
                <app-icon name="award" class="w-6 h-6" />
              </div>
              <div>
                <h3 class="text-base font-bold text-navy">{{ lang.t('home.feature3.title') }}</h3>
                <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {{ lang.t('home.feature3.desc') }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  @ViewChild('originContainer') originContainer?: ElementRef<HTMLElement>;
  @ViewChild('destContainer') destContainer?: ElementRef<HTMLElement>;

  readonly isRoundTrip = signal(false);
  readonly showPassengerPicker = signal(false);

  origin = 'HAN';
  destination = 'SGN';
  departureDate = '';
  returnDate = '';
  cabinClass: CabinClass = CabinClass.ECONOMY;
  CabinClass = CabinClass;
  isSmoking: boolean | undefined = undefined;

  adults = 1;
  children = 0;
  seniors = 0;

  todayStr = new Date().toISOString().split('T')[0];
  minBookingDate = new Date().toISOString().split('T')[0];
  maxAdvanceDays = 330;
  maxBookingDate = this.computeFallbackMaxDate();

  // Autocomplete state
  readonly originSuggestions = signal<LocationSuggestResponse | null>(null);
  readonly destSuggestions = signal<LocationSuggestResponse | null>(null);
  readonly originOpen = signal(false);
  readonly destOpen = signal(false);
  readonly originLoading = signal(false);
  readonly destLoading = signal(false);
  readonly originScope = signal<LocationScope | null>(null);
  readonly destScope = signal<LocationScope | null>(null);

  originHighlightedIndex = -1;
  destHighlightedIndex = -1;
  activeField: 'origin' | 'destination' = 'destination';

  private readonly originQuery$ = new Subject<string>();
  private readonly destQuery$ = new Subject<string>();
  private readonly sub = new Subscription();

  readonly popularCityChips = [
    { langKey: 'search.city.hanoi', token: 'HAN', isMulti: false },
    { langKey: 'search.city.sgn', token: 'SGN', isMulti: false },
    { langKey: 'search.city.danang', token: 'DAD', isMulti: false },
    { langKey: 'search.city.singapore', token: 'SIN', isMulti: false },
    { langKey: 'search.city.bangkok', token: 'BKK', isMulti: false },
    { langKey: 'search.city.tokyo', token: 'Tokyo', isMulti: true },
  ];

  get bookingWindowCaption(): string {
    const days = (this.maxAdvanceDays || 330).toString();
    const maxDate = this.maxBookingDate;
    return this.lang.t('home.bookingWindowNotice')
      .replace('{days}', days)
      .replace('{maxDate}', maxDate);
  }

  private computeFallbackMaxDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 330);
    return d.toISOString().split('T')[0];
  }

  popularRoutes = [
    { from: 'HAN', to: 'SGN', fromCity: 'Hà Nội', toCity: 'TP. Hồ Chí Minh', duration: '2h 10m', price: '1.250.000 VND' },
    { from: 'SGN', to: 'DAD', fromCity: 'TP. Hồ Chí Minh', toCity: 'Đà Nẵng', duration: '1h 20m', price: '890.000 VND' },
    { from: 'HAN', to: 'CXR', fromCity: 'Hà Nội', toCity: 'Nha Trang', duration: '1h 50m', price: '1.150.000 VND' },
    { from: 'DAD', to: 'PQC', fromCity: 'Đà Nẵng', toCity: 'Phú Quốc', duration: '1h 45m', price: '1.350.000 VND' },
    { from: 'HAN', to: 'SIN', fromCity: 'Hà Nội', toCity: 'Singapore', duration: '3h 30m', price: '2.450.000 VND' },
    { from: 'SGN', to: 'BKK', fromCity: 'TP. Hồ Chí Minh', toCity: 'Bangkok', duration: '1h 30m', price: '1.850.000 VND' },
  ];

  ngOnInit(): void {
    // Set default departure date tomorrow
    const d = new Date();
    d.setDate(d.getDate() + 1);
    this.departureDate = d.toISOString().split('T')[0];

    const ret = new Date(d);
    ret.setDate(ret.getDate() + 3);
    this.returnDate = ret.toISOString().split('T')[0];

    // Không tải toàn bộ danh sách sân bay nữa: sau khi nhập hàng loạt quốc gia,
    // /api/airports trả hơn 5.000 dòng (~2 MB) và trang chủ chỉ cần ô gợi ý
    // (GET /reference/suggest) + danh sách chọn nhanh tĩnh.
    this.loadBookingWindow();

    this.sub.add(
      this.originQuery$
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((q) => {
            const trimmed = q.trim();
            if (trimmed.length < 1) {
              this.originSuggestions.set(null);
              this.originLoading.set(false);
              return of(null);
            }
            this.originLoading.set(true);
            return this.api.suggestLocations(trimmed).pipe(
              catchError(() => of({ countries: [], cities: [], airports: [] }))
            );
          })
        )
        .subscribe((res) => {
          this.originLoading.set(false);
          if (res) {
            this.originSuggestions.set(res);
            this.originOpen.set(true);
            this.originHighlightedIndex = -1;
          }
        })
    );

    this.sub.add(
      this.destQuery$
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((q) => {
            const trimmed = q.trim();
            if (trimmed.length < 1) {
              this.destSuggestions.set(null);
              this.destLoading.set(false);
              return of(null);
            }
            this.destLoading.set(true);
            return this.api.suggestLocations(trimmed).pipe(
              catchError(() => of({ countries: [], cities: [], airports: [] }))
            );
          })
        )
        .subscribe((res) => {
          this.destLoading.set(false);
          if (res) {
            this.destSuggestions.set(res);
            this.destOpen.set(true);
            this.destHighlightedIndex = -1;
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.originContainer && !this.originContainer.nativeElement.contains(target)) {
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
    }
    if (this.destContainer && !this.destContainer.nativeElement.contains(target)) {
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
    }
  }

  hasOriginSuggestions(): boolean {
    const s = this.originSuggestions();
    if (!s) return false;
    return (
      (s.countries && s.countries.length > 0) ||
      (s.cities && s.cities.length > 0) ||
      (s.airports && s.airports.length > 0)
    );
  }

  hasDestSuggestions(): boolean {
    const s = this.destSuggestions();
    if (!s) return false;
    return (
      (s.countries && s.countries.length > 0) ||
      (s.cities && s.cities.length > 0) ||
      (s.airports && s.airports.length > 0)
    );
  }

  onOriginInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.origin = val;
    this.activeField = 'origin';
    if (this.originScope() && !val.includes(this.originScope()!.token)) {
      this.originScope.set(null);
    }
    if (!val.trim()) {
      this.originSuggestions.set(null);
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
      return;
    }
    this.originQuery$.next(val);
  }

  onDestInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.destination = val;
    this.activeField = 'destination';
    if (this.destScope() && !val.includes(this.destScope()!.token)) {
      this.destScope.set(null);
    }
    if (!val.trim()) {
      this.destSuggestions.set(null);
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
      return;
    }
    this.destQuery$.next(val);
  }

  onOriginFocus(): void {
    this.activeField = 'origin';
    if (this.origin && this.origin.trim().length >= 1) {
      if (this.originSuggestions()) {
        this.originOpen.set(true);
      } else {
        this.originQuery$.next(this.origin);
      }
    }
  }

  onDestFocus(): void {
    this.activeField = 'destination';
    if (this.destination && this.destination.trim().length >= 1) {
      if (this.destSuggestions()) {
        this.destOpen.set(true);
      } else {
        this.destQuery$.next(this.destination);
      }
    }
  }

  clearOrigin(event: MouseEvent): void {
    event.stopPropagation();
    this.origin = '';
    this.originScope.set(null);
    this.originSuggestions.set(null);
    this.originOpen.set(false);
    this.originHighlightedIndex = -1;
  }

  clearDestination(event: MouseEvent): void {
    event.stopPropagation();
    this.destination = '';
    this.destScope.set(null);
    this.destSuggestions.set(null);
    this.destOpen.set(false);
    this.destHighlightedIndex = -1;
  }

  getFlattenedList(field: 'origin' | 'destination'): Array<{
    type: 'country' | 'city' | 'airport';
    data: any;
  }> {
    const res = field === 'origin' ? this.originSuggestions() : this.destSuggestions();
    if (!res) return [];
    const list: Array<{ type: 'country' | 'city' | 'airport'; data: any }> = [];
    if (res.countries) {
      for (const c of res.countries) {
        list.push({ type: 'country', data: c });
      }
    }
    if (res.cities) {
      for (const c of res.cities) {
        list.push({ type: 'city', data: c });
      }
    }
    if (res.airports) {
      for (const a of res.airports) {
        list.push({ type: 'airport', data: a });
      }
    }
    return list;
  }

  onOriginKeydown(event: KeyboardEvent): void {
    if (!this.originOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.origin.trim().length >= 1) {
          this.originQuery$.next(this.origin);
          this.originOpen.set(true);
        }
      }
      return;
    }

    const list = this.getFlattenedList('origin');
    if (list.length === 0) {
      if (event.key === 'Escape') {
        this.originOpen.set(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIdx = this.originHighlightedIndex < list.length - 1 ? this.originHighlightedIndex + 1 : 0;
      this.originHighlightedIndex = nextIdx;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIdx = this.originHighlightedIndex > 0 ? this.originHighlightedIndex - 1 : list.length - 1;
      this.originHighlightedIndex = prevIdx;
    } else if (event.key === 'Enter') {
      if (this.originHighlightedIndex >= 0 && this.originHighlightedIndex < list.length) {
        event.preventDefault();
        const item = list[this.originHighlightedIndex];
        this.pickItem('origin', item);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
    }
  }

  onDestKeydown(event: KeyboardEvent): void {
    if (!this.destOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.destination.trim().length >= 1) {
          this.destQuery$.next(this.destination);
          this.destOpen.set(true);
        }
      }
      return;
    }

    const list = this.getFlattenedList('destination');
    if (list.length === 0) {
      if (event.key === 'Escape') {
        this.destOpen.set(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIdx = this.destHighlightedIndex < list.length - 1 ? this.destHighlightedIndex + 1 : 0;
      this.destHighlightedIndex = nextIdx;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIdx = this.destHighlightedIndex > 0 ? this.destHighlightedIndex - 1 : list.length - 1;
      this.destHighlightedIndex = prevIdx;
    } else if (event.key === 'Enter') {
      if (this.destHighlightedIndex >= 0 && this.destHighlightedIndex < list.length) {
        event.preventDefault();
        const item = list[this.destHighlightedIndex];
        this.pickItem('destination', item);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
    }
  }

  pickItem(field: 'origin' | 'destination', item: { type: 'country' | 'city' | 'airport'; data: any }): void {
    if (item.type === 'country') {
      this.selectCountry(field, item.data);
    } else if (item.type === 'city') {
      this.selectCity(field, item.data);
    } else if (item.type === 'airport') {
      this.selectAirport(field, item.data);
    }
  }

  selectCountry(field: 'origin' | 'destination', country: CountrySuggestion): void {
    const countryName = this.lang.isVietnamese() ? (country.name_vi || country.name) : (country.name || country.name_vi);
    const scope: LocationScope = {
      kind: 'country',
      token: countryName,
      label: this.lang.t('search.allAirportsScope').replace('{name}', countryName),
    };

    if (field === 'origin') {
      this.origin = countryName;
      this.originScope.set(scope);
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
    } else {
      this.destination = countryName;
      this.destScope.set(scope);
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
    }
  }

  selectCity(field: 'origin' | 'destination', city: CitySuggestion): void {
    const cityName = this.lang.isVietnamese() ? (city.name_vi || city.name) : (city.name || city.name_vi);
    const isMulti = (city.airport_count && city.airport_count > 1) || (city.iata_codes && city.iata_codes.length > 1);
    const scope: LocationScope | null = isMulti ? {
      kind: 'city',
      token: cityName,
      label: this.lang.t('search.allAirportsScope').replace('{name}', cityName),
      iata_codes: city.iata_codes,
    } : null;

    if (field === 'origin') {
      this.origin = cityName;
      this.originScope.set(scope);
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
    } else {
      this.destination = cityName;
      this.destScope.set(scope);
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
    }
  }

  selectAirport(field: 'origin' | 'destination', ap: AirportSuggestion): void {
    if (field === 'origin') {
      this.origin = ap.iata_code;
      this.originScope.set(null);
      this.originOpen.set(false);
      this.originHighlightedIndex = -1;
    } else {
      this.destination = ap.iata_code;
      this.destScope.set(null);
      this.destOpen.set(false);
      this.destHighlightedIndex = -1;
    }
  }

  selectQuickCity(chip: { langKey: string; token: string; isMulti?: boolean }): void {
    const labelName = this.lang.t(chip.langKey);
    const scope: LocationScope | null = chip.isMulti ? {
      kind: 'city',
      token: chip.token,
      label: this.lang.t('search.allAirportsScope').replace('{name}', labelName),
    } : null;

    if (this.activeField === 'origin') {
      this.origin = chip.token;
      this.originScope.set(scope);
      this.originOpen.set(false);
    } else {
      this.destination = chip.token;
      this.destScope.set(scope);
      this.destOpen.set(false);
    }
  }

  isOriginHighlighted(type: 'country' | 'city' | 'airport', id: string): boolean {
    if (this.originHighlightedIndex < 0) return false;
    const list = this.getFlattenedList('origin');
    const item = list[this.originHighlightedIndex];
    if (!item || item.type !== type) return false;
    if (type === 'country') return item.data.code === id;
    if (type === 'city') return item.data.city_code === id;
    if (type === 'airport') return item.data.iata_code === id;
    return false;
  }

  setOriginHighlighted(type: 'country' | 'city' | 'airport', id: string): void {
    const list = this.getFlattenedList('origin');
    this.originHighlightedIndex = list.findIndex((item) => {
      if (item.type !== type) return false;
      if (type === 'country') return item.data.code === id;
      if (type === 'city') return item.data.city_code === id;
      if (type === 'airport') return item.data.iata_code === id;
      return false;
    });
  }

  isDestHighlighted(type: 'country' | 'city' | 'airport', id: string): boolean {
    if (this.destHighlightedIndex < 0) return false;
    const list = this.getFlattenedList('destination');
    const item = list[this.destHighlightedIndex];
    if (!item || item.type !== type) return false;
    if (type === 'country') return item.data.code === id;
    if (type === 'city') return item.data.city_code === id;
    if (type === 'airport') return item.data.iata_code === id;
    return false;
  }

  setDestHighlighted(type: 'country' | 'city' | 'airport', id: string): void {
    const list = this.getFlattenedList('destination');
    this.destHighlightedIndex = list.findIndex((item) => {
      if (item.type !== type) return false;
      if (type === 'country') return item.data.code === id;
      if (type === 'city') return item.data.city_code === id;
      if (type === 'airport') return item.data.iata_code === id;
      return false;
    });
  }

  loadBookingWindow(): void {
    this.api.getBookingWindow().subscribe({
      next: (res) => {
        if (res?.min_date) {
          this.minBookingDate = res.min_date;
        }
        if (res?.max_date) {
          this.maxBookingDate = res.max_date;
        }
        if (res?.max_advance_days) {
          this.maxAdvanceDays = res.max_advance_days;
        }
      },
      error: () => {
        this.minBookingDate = this.todayStr;
        this.maxBookingDate = this.computeFallbackMaxDate();
      },
    });
  }

  swapAirports(): void {
    const temp = this.origin;
    this.origin = this.destination;
    this.destination = temp;

    const tempScope = this.originScope();
    this.originScope.set(this.destScope());
    this.destScope.set(tempScope);
  }

  selectPopularRoute(from: string, to: string): void {
    this.origin = from;
    this.destination = to;
    this.originScope.set(null);
    this.destScope.set(null);
    window.scrollTo({ top: 120, behavior: 'smooth' });
  }

  totalPassengers(): number {
    return this.adults + this.children + this.seniors;
  }

  onSearch(): void {
    if (!this.origin || !this.destination) {
      this.toast.warning(this.lang.t('home.validation.empty'));
      return;
    }
    if (this.origin === this.destination) {
      this.toast.warning(this.lang.t('home.validation.same'));
      return;
    }
    if (!this.departureDate) {
      this.toast.warning(this.lang.t('home.validation.date'));
      return;
    }
    const minDate = this.minBookingDate || this.todayStr;
    if (minDate && this.departureDate < minDate) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? `Ngày khởi hành không được trước ngày ${minDate}`
          : `Departure date cannot be earlier than ${minDate}`,
      );
      return;
    }
    if (this.maxBookingDate && this.departureDate > this.maxBookingDate) {
      this.toast.warning(
        this.lang.isVietnamese()
          ? `Ngày khởi hành vượt quá thời hạn mở bán (${this.maxBookingDate})`
          : `Departure date exceeds booking window (${this.maxBookingDate})`,
      );
      return;
    }

    if (this.isRoundTrip()) {
      if (!this.returnDate) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? 'Vui lòng chọn ngày về cho chuyến bay khứ hồi'
            : 'Please select a return date for round trip',
        );
        return;
      }
      if (this.returnDate < this.departureDate) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? 'Ngày về không được trước ngày khởi hành'
            : 'Return date cannot be earlier than departure date',
        );
        return;
      }
      if (this.maxBookingDate && this.returnDate > this.maxBookingDate) {
        this.toast.warning(
          this.lang.isVietnamese()
            ? `Ngày về vượt quá thời hạn mở bán (${this.maxBookingDate})`
            : `Return date exceeds booking window (${this.maxBookingDate})`,
        );
        return;
      }
    }

    const queryParams: any = {
      origin: this.origin,
      destination: this.destination,
      departure_date: this.departureDate,
      cabin_class: this.cabinClass,
      adults: this.adults,
      children: this.children,
      seniors: this.seniors,
    };

    if (this.isSmoking !== undefined) {
      queryParams.is_smoking = this.isSmoking;
    }

    if (this.isRoundTrip() && this.returnDate) {
      queryParams.return_date = this.returnDate;
    }

    this.router.navigate(['/results'], { queryParams });
  }
}

