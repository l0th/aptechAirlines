import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CommercialNetworkDiscoveryResponse,
  CommercialNetworkItinerary,
} from '../../../core/models/flight.model';

@Component({
  selector: 'app-commercial-itinerary-results',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="space-y-4">
      <!-- Section Header -->
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs font-black flex items-center justify-center">2</span>
          <h2 class="text-lg font-bold text-navy">{{ lang.t('admin.commercial.step2Heading') }}</h2>
        </div>
        @if (discoveryResponse?.itineraries?.length) {
          <span class="px-3 py-1 bg-amber-500/10 border border-gold/30 rounded-full text-xs font-bold text-amber-900">
            {{ discoveryResponse!.itineraries.length }} {{ lang.t('admin.commercial.step2Title').toLowerCase() }}
          </span>
        }
      </div>

      <!-- Loading State -->
      @if (isDiscovering) {
        <div class="card-luxury p-8 sm:p-12 text-center space-y-4 animate-pulse">
          <div class="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto text-gold">
            <app-icon name="refreshcw" class="w-6 h-6 animate-spin" />
          </div>
          <div>
            <h3 class="text-base font-bold text-navy">{{ lang.t('admin.commercial.btnSearchingRoutes') }}</h3>
            <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              {{ lang.t('admin.commercial.step1Subheading') }}
            </p>
          </div>
        </div>
      }

      <!-- Error State -->
      @if (!isDiscovering && discoveryError) {
        <div class="p-5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3.5 text-rose-900 animate-fade-in shadow-sm">
          <app-icon name="alerttriangle" class="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div class="space-y-1">
            <h3 class="font-bold text-sm text-rose-950">{{ lang.t('common.error') }}</h3>
            <p class="text-xs text-rose-800 leading-relaxed">{{ discoveryError }}</p>
          </div>
        </div>
      }

      <!-- Response Content -->
      @if (!isDiscovering && discoveryResponse; as resp) {
        <!-- Incomplete Network Warning -->
        @if (resp.status === 'NETWORK_DATA_INCOMPLETE') {
          <div class="p-4 sm:p-5 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3.5 text-amber-900 animate-fade-in shadow-sm">
            <app-icon name="alerttriangle" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div class="space-y-1">
              <h3 class="font-bold text-sm text-amber-950">
                {{ lang.t('admin.commercial.incompleteWarningTitle') }}
              </h3>
              <p class="text-xs text-amber-800 leading-relaxed">
                {{ lang.t('admin.commercial.incompleteWarningDesc') }}
              </p>
            </div>
          </div>
        }

        <!-- Empty State (No Itineraries) -->
        @if (!resp.itineraries || resp.itineraries.length === 0) {
          <div class="card-luxury p-8 sm:p-12 text-center space-y-4">
            <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
              <app-icon name="compass" class="w-7 h-7" />
            </div>
            <div class="space-y-1 max-w-md mx-auto">
              <h3 class="text-base font-bold text-navy">{{ lang.t('admin.commercial.noRoutesTitle') }}</h3>
              <p class="text-xs text-slate-500 leading-relaxed">
                {{ lang.t('admin.commercial.noRoutesDesc') }}
              </p>
            </div>
          </div>
        }

        <!-- Itineraries List -->
        @if (resp.itineraries && resp.itineraries.length > 0) {
          <div class="space-y-3.5">
            @for (itin of resp.itineraries; track itinTrackKey(itin); let itinIdx = $index) {
              @let isSelected = selectedItinerary && itinTrackKey(selectedItinerary) === itinTrackKey(itin);

              <div
                class="card-luxury p-5 sm:p-6 transition-all duration-200 border-2"
                [ngClass]="{
                  'border-gold bg-amber-500/5 shadow-md': isSelected,
                  'border-slate-200/80 hover:border-slate-300': !isSelected
                }"
              >
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <!-- Visual Route Path & Details -->
                  <div class="space-y-3 flex-1 min-w-0">
                    <!-- Badges Row -->
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="px-2.5 py-0.5 rounded-full bg-navy text-gold text-xs font-mono font-bold">
                        #{{ itinIdx + 1 }}
                      </span>
                      <span
                        class="px-2.5 py-0.5 rounded-full text-xs font-bold"
                        [ngClass]="itin.stops.length === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'"
                      >
                        {{ getStopsLabel(itin) }}
                      </span>
                      @if (itin.total_duration_minutes) {
                        <span class="text-xs text-slate-500 flex items-center gap-1">
                          <app-icon name="clock" class="w-3.5 h-3.5 text-slate-400" />
                          <span>{{ lang.t('admin.commercial.totalDuration') }} <strong class="text-slate-700">{{ formatDuration(itin.total_duration_minutes) }}</strong></span>
                        </span>
                      }
                    </div>

                    <!-- Strong Visual Route Line -->
                    <div class="flex items-center gap-2 sm:gap-3 flex-wrap py-1">
                      @for (airport of itin.airports; track airport; let i = $index) {
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-lg sm:text-xl font-black text-navy px-2.5 py-1 bg-slate-100 rounded-xl border border-slate-200 shadow-sm">
                            {{ airport }}
                          </span>
                          @if (i < itin.airports.length - 1) {
                            <div class="flex flex-col items-center px-1">
                              <div class="flex items-center text-gold">
                                <span class="h-0.5 w-6 sm:w-12 bg-gold"></span>
                                <app-icon name="arrowright" class="w-3.5 h-3.5 -ml-1 text-gold" />
                              </div>
                              @if (itin.layover_minutes && itin.layover_minutes[i]) {
                                <span class="text-[10px] font-mono text-slate-400 mt-0.5 flex items-center gap-0.5 whitespace-nowrap">
                                  <app-icon name="hourglass" class="w-3 h-3 text-amber-500" />
                                  {{ itin.layover_minutes[i] }}m
                                </span>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>

                    <!-- Legs Mini Summary -->
                    <div class="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                      <span class="font-medium text-slate-600">{{ lang.t('admin.commercial.carrierFlight') }}</span>
                      @for (leg of itin.legs; track leg.source_key; let lIdx = $index) {
                        <span class="inline-flex items-center gap-1 font-mono text-slate-700 bg-white px-2 py-0.5 rounded-lg border border-slate-200 text-xs">
                          <strong class="text-navy">{{ leg.airline_iata || leg.airline_icao || 'AirLabs' }}</strong>
                          <span>{{ leg.flight_iata || leg.flight_number || '-' }}</span>
                          <span class="text-slate-400 text-[11px]">({{ leg.dep_iata }}→{{ leg.arr_iata }})</span>
                        </span>
                      }
                    </div>
                  </div>

                  <!-- Select Action Button -->
                  <div class="self-end md:self-center shrink-0">
                    <button
                      type="button"
                      (click)="onSelectItinerary(itin)"
                      class="!py-3 !px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all inline-flex items-center gap-2 rounded-full"
                      [ngClass]="{
                        'bg-emerald-600 text-white hover:bg-emerald-700': isSelected,
                        'btn-navy': !isSelected
                      }"
                    >
                      @if (isSelected) {
                        <app-icon name="checkcircle2" class="w-4 h-4 text-white" />
                        <span>{{ lang.t('admin.commercial.btnItinerarySelected') }}</span>
                      } @else {
                        <app-icon name="arrowright" class="w-4 h-4 text-gold" />
                        <span>{{ lang.t('admin.commercial.btnSelectItinerary') }}</span>
                      }
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Collapsible Network Data Details (Troubleshooting) -->
        <details class="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-3">
          <summary class="cursor-pointer font-bold text-navy select-none flex items-center gap-2">
            <app-icon name="info" class="w-4 h-4 text-gold" />
            <span>{{ lang.t('admin.commercial.networkDetailsLabel') }}</span>
          </summary>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono pt-3 border-t border-slate-200 text-slate-700">
            <div>
              <span class="text-slate-400 block text-[11px] uppercase">{{ lang.t('admin.commercial.colCoverage') }}</span>
              <strong [class]="resp.coverage.complete ? 'text-emerald-600' : 'text-amber-600'">
                {{ resp.coverage.complete ? lang.t('admin.commercial.coverageComplete') : lang.t('admin.commercial.coverageIncomplete') }}
              </strong>
            </div>
            <div>
              <span class="text-slate-400 block text-[11px] uppercase">{{ lang.t('admin.commercial.coverageExpanded') }}</span>
              <strong class="text-navy">{{ resp.coverage.expanded_airports.join(', ') || lang.t('admin.commercial.noneLabel') }}</strong>
            </div>
            <div>
              <span class="text-slate-400 block text-[11px] uppercase">{{ lang.t('admin.commercial.coverageMissingSync') }}</span>
              <strong class="text-navy">{{ resp.coverage.missing_sync_state_airports.join(', ') || lang.t('admin.commercial.noneLabel') }}</strong>
            </div>
            <div>
              <span class="text-slate-400 block text-[11px] uppercase">{{ lang.t('admin.commercial.scopeResolvedIatas') }}</span>
              <strong class="text-navy">{{ resp.origin_scope.iata_codes.join(', ') }} ➔ {{ resp.destination_scope.iata_codes.join(', ') }}</strong>
            </div>
          </div>
        </details>
      }
    </div>
  `,
})
export class CommercialItineraryResultsComponent {
  readonly lang = inject(LanguageService);
  protected readonly String = String;

  @Input() isDiscovering = false;
  @Input() discoveryError: string | null = null;
  @Input() discoveryResponse: CommercialNetworkDiscoveryResponse | null = null;
  @Input() selectedItinerary: CommercialNetworkItinerary | null = null;

  @Output() itinerarySelect = new EventEmitter<CommercialNetworkItinerary>();

  onSelectItinerary(itin: CommercialNetworkItinerary): void {
    this.itinerarySelect.emit(itin);
  }

  itinTrackKey(itin: CommercialNetworkItinerary): string {
    return itin.legs.map((l) => l.source_key).join('>');
  }

  getStopsLabel(itin: CommercialNetworkItinerary): string {
    const stops = itin.stops?.length ?? 0;
    if (stops === 0) {
      return this.lang.t('admin.commercial.directFlight');
    }
    const template = stops === 1
      ? this.lang.t('admin.commercial.stopsCount')
      : this.lang.t('admin.commercial.stopsPlural');
    return template.replace('{stops}', String(stops));
  }

  formatDuration(minutes: number): string {
    if (!minutes || minutes <= 0) return this.lang.t('admin.commercial.durationNA');
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
}
