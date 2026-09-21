import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AirLabsRouteRef } from '../../../core/models/flight.model';

@Component({
  selector: 'app-route-inspect-drawer',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-lg h-full shadow-2xl p-6 border-l border-slate-200 overflow-y-auto flex flex-col justify-between">
        <div class="space-y-5">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="compass" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.commercial.drawerInspectTitle') }}</span>
            </h3>
            <button (click)="closeDrawer.emit()" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 font-mono text-xs text-slate-700">
            <div class="flex items-center justify-between font-bold text-navy text-sm">
              <span>{{ route.dep_iata }} ➔ {{ route.arr_iata }}</span>
              <span class="text-xs text-slate-500 font-normal">({{ route.airline_iata || route.airline_icao || 'AirLabs' }})</span>
            </div>
            <div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <div>{{ lang.t('admin.commercial.lblFlight') }} <strong class="text-navy">{{ route.flight_iata || route.flight_number || '-' }}</strong></div>
              <div>{{ lang.t('admin.commercial.lblAircraft') }} <strong>{{ route.aircraft_icao || '-' }}</strong></div>
              <div>{{ lang.t('admin.commercial.localTimes') }}: <span>{{ route.dep_time || '-' }} ➔ {{ route.arr_time || '-' }}</span></div>
              <div>{{ lang.t('admin.commercial.utcTimes') }}: <span>{{ route.dep_time_utc ? route.dep_time_utc + 'Z' : '-' }} ➔ {{ route.arr_time_utc ? route.arr_time_utc + 'Z' : '-' }}</span></div>
              <div>{{ lang.t('admin.commercial.durationLabel') }}: <strong>{{ route.duration ? route.duration + 'm' : '-' }}</strong></div>
              <div>{{ lang.t('admin.commercial.operatingDaysHeader') }}: <span>{{ route.days?.join(', ') || '-' }}</span></div>
            </div>
            <div class="pt-2 border-t border-slate-200">
              <span class="text-slate-400 block text-[10px] uppercase mb-1">{{ lang.t('admin.commercial.technicalKey') }}:</span>
              <code class="text-[10px] break-all bg-white p-2 rounded border border-slate-200 block">{{ route.source_key }}</code>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            (click)="closeDrawer.emit()"
            class="btn-navy text-xs !py-2 !px-5"
          >
            {{ lang.t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class RouteInspectDrawerComponent {
  readonly lang = inject(LanguageService);

  @Input() route!: AirLabsRouteRef;
  @Output() closeDrawer = new EventEmitter<void>();
}
