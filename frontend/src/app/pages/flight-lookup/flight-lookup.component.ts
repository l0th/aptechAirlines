import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { Flight, FlightStatus } from '../../core/models/flight.model';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { isValidIanaTimeZone, getTimezoneGmtOffset, utcToWallTime } from '../../core/utils/timezone.util';

@Component({
  selector: 'app-flight-lookup',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="min-h-screen bg-slate-50 flex flex-col pt-12 pb-20">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <!-- Header -->
        <div class="text-center mb-10">
          <h1 class="text-3xl font-black text-navy mb-3">{{ lang.t('lookup.title') }}</h1>
          <p class="text-slate-500">{{ lang.t('lookup.subtitle') }}</p>
        </div>

        <!-- Search Form -->
        <div class="card-luxury p-6 mb-8">
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div class="sm:col-span-5">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2">
                {{ lang.t('lookup.flightNumber') }}
              </label>
              <input
                type="text"
                [(ngModel)]="flightNumber"
                placeholder="VN101"
                class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-full px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>
            <div class="sm:col-span-4">
              <label class="block text-xs font-bold text-navy uppercase tracking-wider mb-2">
                {{ lang.t('lookup.date') }}
              </label>
              <input
                type="date"
                [(ngModel)]="lookupDate"
                class="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-full px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>
            <div class="sm:col-span-3">
              <button
                (click)="onSearch()"
                [disabled]="isLoading()"
                class="btn-gold w-full !py-3.5 rounded-full flex items-center justify-center gap-2"
              >
                @if (isLoading()) {
                  <app-icon name="loader2" class="w-4 h-4 animate-spin" />
                } @else {
                  <app-icon name="search" class="w-4 h-4" />
                  <span>{{ lang.t('lookup.searchBtn') }}</span>
                }
              </button>
            </div>
          </div>
        </div>

        <!-- Results / States -->
        <div class="space-y-4">
          @if (hasSearched() && !isLoading()) {
            @if (flights().length === 0) {
              <div class="card-luxury p-8 text-center text-slate-500">
                <app-icon name="plane" class="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p>{{ notFound() ? lang.t('lookup.notFound') : lang.t('lookup.error') }}</p>
              </div>
            } @else {
              @for (flight of flights(); track flight._id) {
                <div 
                  class="card-luxury p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  [ngClass]="{
                    'border-amber-400 border-2 bg-amber-50/30': flight.status === FlightStatus.DELAYED,
                    'border-rose-400 border-2 bg-rose-50/30': flight.status === FlightStatus.CANCELLED
                  }"
                >
                  <div>
                    <div class="flex items-center gap-3 mb-2">
                      <span class="text-lg font-black text-navy">{{ flight.flight_number }}</span>
                      <span class="px-2.5 py-1 text-[10px] uppercase font-bold rounded-full"
                        [ngClass]="{
                          'bg-emerald-100 text-emerald-700': flight.status === FlightStatus.SCHEDULED || flight.status === FlightStatus.COMPLETED,
                          'bg-amber-100 text-amber-700': flight.status === FlightStatus.DELAYED,
                          'bg-rose-100 text-rose-700': flight.status === FlightStatus.CANCELLED
                        }">
                        {{ getStatusLabel(flight.status) }}
                      </span>
                    </div>
                    
                    <div class="flex items-center gap-2 text-sm text-slate-600 font-medium mb-1">
                      <span class="text-navy font-bold">{{ flight.origin_iata }}</span>
                      <app-icon name="arrowright" class="w-3 h-3 text-slate-400" />
                      <span class="text-navy font-bold">{{ flight.dest_iata }}</span>
                      <span class="mx-2 text-slate-300">|</span>
                      <span>{{ flight.duration_minutes }} {{ lang.t('lookup.min') || 'min' }}</span>
                    </div>

                    <div class="text-xs text-slate-500 flex items-center gap-2 mt-2">
                      <app-icon name="plane" class="w-3.5 h-3.5" />
                      {{ flight.aircraft?.model_name ? flight.aircraft!.model_name + ' (' + (flight.aircraft!.registration || 'N/A') + ')' : lang.t('lookup.unknownAircraft') }}
                    </div>

                    @if (flight.delay_reason || flight.delay_minutes) {
                      <div class="text-xs text-rose-600 font-bold mt-2">
                        {{ lang.t('lookup.reason') || 'Reason' }}: {{ delayText(flight.delay_reason, flight.delay_minutes) }}
                      </div>
                    }
                  </div>

                  <div class="flex items-center gap-6 text-sm text-right">
                    <div>
                      <div class="text-xs text-slate-500 mb-1">{{ lang.t('lookup.departure') || 'Departure' }}</div>
                      <div class="font-bold text-base font-mono text-navy" [class.line-through]="flight.actual_departure_local || flight.actual_departure">
                        {{ formatLocalTimeOnly(flight.scheduled_departure_local, flight.scheduled_departure, flight.origin_time_zone) }}
                      </div>
                      <div class="text-[11px] text-slate-400 font-medium">
                        {{ getAirportTzContext(flight.origin_iata, flight.origin_time_zone, flight.scheduled_departure) }}
                      </div>
                      @if (flight.actual_departure_local || flight.actual_departure) {
                        <div class="font-bold text-base font-mono text-amber-600 mt-1">
                          {{ formatLocalTimeOnly(flight.actual_departure_local, flight.actual_departure, flight.origin_time_zone) }}
                        </div>
                      }
                    </div>
                    <div>
                      <div class="text-xs text-slate-500 mb-1">{{ lang.t('lookup.arrival') || 'Arrival' }}</div>
                      <div class="font-bold text-base font-mono text-navy" [class.line-through]="flight.actual_arrival_local || flight.actual_arrival">
                        {{ formatLocalTimeOnly(flight.scheduled_arrival_local, flight.scheduled_arrival, flight.dest_time_zone) }}
                      </div>
                      <div class="text-[11px] text-slate-400 font-medium">
                        {{ getAirportTzContext(flight.dest_iata, flight.dest_time_zone, flight.scheduled_arrival) }}
                      </div>
                      @if (flight.actual_arrival_local || flight.actual_arrival) {
                        <div class="font-bold text-base font-mono text-amber-600 mt-1">
                          {{ formatLocalTimeOnly(flight.actual_arrival_local, flight.actual_arrival, flight.dest_time_zone) }}
                        </div>
                      }
                    </div>
                  </div>
                </div>
              }
            }
          }
        </div>
      </div>
    </div>
  `
})
export class FlightLookupComponent {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  
  flightNumber = '';
  lookupDate = new Date().toISOString().split('T')[0];
  
  readonly flights = signal<Flight[]>([]);
  readonly isLoading = signal(false);
  readonly hasSearched = signal(false);
  readonly notFound = signal(false);

  readonly FlightStatus = FlightStatus;

  onSearch(): void {
    const num = this.flightNumber.trim().toUpperCase();
    if (!num || !this.lookupDate) return;

    this.isLoading.set(true);
    this.hasSearched.set(true);
    this.notFound.set(false);

    this.api.lookupFlights(num, this.lookupDate).subscribe({
      next: (res) => {
        this.flights.set(res || []);
        if (!res || res.length === 0) {
          this.notFound.set(true);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.flights.set([]);
        this.notFound.set(err.status === 404);
        this.isLoading.set(false);
      }
    });
  }

  getStatusLabel(status: FlightStatus): string {
    switch (status) {
      case FlightStatus.SCHEDULED: return this.lang.t('lookup.status.scheduled') || this.lang.t('status.scheduled');
      case FlightStatus.DELAYED: return this.lang.t('lookup.status.delayed') || this.lang.t('status.delayed');
      case FlightStatus.CANCELLED: return this.lang.t('lookup.status.cancelled') || this.lang.t('status.cancelled');
      case FlightStatus.COMPLETED: return this.lang.t('lookup.status.completed') || this.lang.t('status.completed');
      default: return status;
    }
  }

  delayText(reason?: string | null, minutes?: number | null): string {
    const mins = minutes && minutes > 0 ? minutes : Number((reason || '').match(/trễ\s+(\d+)\s+phút/i)?.[1] || 0);
    if (mins > 0) return this.lang.t('track.delayMinutes').replace('{n}', String(mins));
    return reason || '';
  }

  formatLocalTimeOnly(localStr?: string | null, utcInstant?: string | Date | null, tz?: string | null): string {
    if (!tz || !isValidIanaTimeZone(tz)) {
      return '--:--';
    }
    if (localStr) {
      const match = localStr.match(/\b(\d{2}:\d{2})\b/);
      if (match) return match[1];
    }
    if (utcInstant) {
      const wall = utcToWallTime(utcInstant, tz);
      if (wall && wall.includes('T')) {
        return wall.split('T')[1].substring(0, 5);
      }
    }
    return '--:--';
  }

  getAirportTzContext(iata?: string | null, tz?: string | null, refDate?: string | Date | null): string {
    const code = iata || '---';
    if (!tz || !isValidIanaTimeZone(tz)) {
      return `${code} · ${this.lang.isVietnamese() ? 'Không có dữ liệu múi giờ' : 'Timezone unavailable'}`;
    }
    const d = refDate ? new Date(refDate) : undefined;
    const offset = getTimezoneGmtOffset(tz, d && !isNaN(d.getTime()) ? d : undefined);
    if (!offset || offset === 'INVALID_TZ') {
      return `${code} · ${this.lang.isVietnamese() ? 'Không có dữ liệu múi giờ' : 'Timezone unavailable'}`;
    }
    return `${code} · ${offset}`;
  }
}

