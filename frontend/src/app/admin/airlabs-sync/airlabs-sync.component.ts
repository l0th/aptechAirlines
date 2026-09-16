import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ApiService,
  AirLabsSyncMode,
  AirLabsSyncResponse,
} from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-airlabs-sync',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <div class="max-w-4xl mx-auto space-y-6">
      
      <!-- Header -->
      <div>
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-gold/40 text-gold text-xs font-semibold mb-2">
          <app-icon name="refreshcw" class="w-3.5 h-3.5" />
          <span>AirLabs Aviation Intelligence</span>
        </div>
        <h1 class="text-2xl font-black text-navy">{{ lang.t('admin.airlabs.title') }}</h1>
        <p class="text-xs text-slate-500 mt-1">
          {{ lang.t('admin.airlabs.subtitle') }}
        </p>
      </div>

      <!-- Sync Settings Card -->
      <div class="card-luxury p-6 sm:p-8 border-slate-200 shadow-md space-y-5">
        <h3 class="text-sm font-bold text-navy uppercase tracking-wider flex items-center gap-2">
          <app-icon name="slidershorizontal" class="w-4 h-4 text-gold" />
          <span>{{ lang.t('admin.airlabs.configParams') }}</span>
        </h3>

        <!-- Mode selector -->
        <div>
          <label class="block font-semibold text-slate-700 mb-1.5 text-xs">{{ lang.t('admin.airlabs.mode') }}</label>
          <select
            [(ngModel)]="mode"
            class="w-full sm:max-w-md px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-xs font-bold text-slate-800"
          >
            <option value="route">{{ lang.t('admin.airlabs.modeRoute') }}</option>
            <option value="departure">{{ lang.t('admin.airlabs.modeDeparture') }}</option>
            <option value="arrival">{{ lang.t('admin.airlabs.modeArrival') }}</option>
            <option value="airline">{{ lang.t('admin.airlabs.modeAirline') }}</option>
            <option value="flight">{{ lang.t('admin.airlabs.modeFlight') }}</option>
          </select>
        </div>

        <!-- Mode-specific inputs -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          @if (mode === 'route') {
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.depIata') }}</label>
              <input
                type="text"
                [(ngModel)]="depIata"
                placeholder="HAN"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.depIataHint') }}</span>
            </div>

            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.arrIata') }}</label>
              <input
                type="text"
                [(ngModel)]="arrIata"
                placeholder="SGN"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.arrIataHint') }}</span>
            </div>
          }

          @if (mode === 'departure') {
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.depIata') }}</label>
              <input
                type="text"
                [(ngModel)]="depIata"
                placeholder="HAN"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.depIataHint') }}</span>
            </div>
          }

          @if (mode === 'arrival') {
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.arrIata') }}</label>
              <input
                type="text"
                [(ngModel)]="arrIata"
                placeholder="SGN"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.arrIataHint') }}</span>
            </div>
          }

          @if (mode === 'airline') {
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.airlineIata') }}</label>
              <input
                type="text"
                [(ngModel)]="airlineIata"
                placeholder="VN"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.airlineIataHint') }}</span>
            </div>
          }

          @if (mode === 'flight') {
            <div>
              <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.flightIata') }}</label>
              <input
                type="text"
                [(ngModel)]="flightIata"
                placeholder="VN123"
                class="w-full uppercase font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-sm font-bold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.t('admin.airlabs.flightIataHint') }}</span>
            </div>
          }
        </div>

        <!-- Limit, Offset, API Key -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2 border-t border-slate-100">
          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.limit') }}</label>
            <input
              type="number"
              [(ngModel)]="limit"
              placeholder="VD: 50"
              min="1"
              class="w-full font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-xs"
            />
            <span class="text-[10px] text-slate-400 mt-1 block leading-tight">{{ lang.t('admin.airlabs.limitHint') }}</span>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.offset') }}</label>
            <input
              type="number"
              [(ngModel)]="offset"
              placeholder="0"
              min="0"
              class="w-full font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-xs"
            />
            <span class="text-[10px] text-slate-400 mt-1 block leading-tight">{{ lang.t('admin.airlabs.offsetHint') }}</span>
          </div>

          <div>
            <label class="block font-semibold text-slate-700 mb-1.5">{{ lang.t('admin.airlabs.apiKeyLabel') }}</label>
            <input
              type="password"
              [(ngModel)]="apiKey"
              [placeholder]="lang.t('admin.airlabs.apiKeyPlaceholder')"
              class="w-full font-mono px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold text-xs"
            />
            <span class="text-[10px] text-slate-500 mt-1 block leading-tight">
              {{ lang.t('admin.airlabs.apiKeyNote') }}
            </span>
          </div>
        </div>

        <!-- 1-Click Sync Trigger Button -->
        <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="text-xs text-slate-500">
            {{ lang.t('admin.airlabs.autoConfigDesc') }}
          </div>

          <button
            type="button"
            (click)="executeSync()"
            [disabled]="loading()"
            class="btn-gold !py-3 !px-8 text-sm uppercase tracking-wider font-bold w-full sm:w-auto shrink-0 shadow-lg"
          >
            @if (loading()) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              <span>{{ lang.t('admin.airlabs.syncing') }}</span>
            } @else {
              <app-icon name="plane" class="w-4 h-4" />
              <span>{{ lang.t('admin.airlabs.syncNowBtn') }}</span>
            }
          </button>
        </div>
      </div>

      <!-- Sync Results Card -->
      @if (syncResult()) {
        <div class="card-luxury p-6 border-slate-200 shadow-md animate-fade-in space-y-5">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                <app-icon name="checkcircle2" class="w-6 h-6" />
              </div>
              <div>
                <h4 class="text-sm font-bold text-navy">{{ lang.t('admin.airlabs.resultTitle') }}</h4>
                <p class="text-xs text-slate-500">{{ syncResult()?.message }}</p>
              </div>
            </div>

            @if (syncResult()?.has_more) {
              <button
                type="button"
                (click)="executeSync(syncResult()?.next_offset)"
                [disabled]="loading()"
                class="btn-gold text-xs !py-2.5 !px-5 font-bold inline-flex items-center gap-2 shadow-sm"
              >
                <app-icon name="refreshcw" class="w-3.5 h-3.5" [class.animate-spin]="loading()" />
                <span>{{ lang.t('admin.airlabs.loadNextOffset') }} (offset: {{ syncResult()?.next_offset }})</span>
              </button>
            }
          </div>

          <!-- Stats Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span class="text-[11px] text-slate-500 block mb-1 font-medium">{{ lang.t('admin.airlabs.fetchedCount') }}</span>
              <div class="text-xl font-black text-navy">
                {{ getFetchedCount() }}
              </div>
            </div>

            <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span class="text-[11px] text-emerald-700 block mb-1 font-medium">{{ lang.t('admin.airlabs.createdOrUpdatedCount') }}</span>
              <div class="text-xl font-black text-emerald-700">
                {{ getCreatedOrUpdatedCount() }}
              </div>
            </div>

            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span class="text-[11px] text-slate-500 block mb-1 font-medium">{{ lang.t('admin.airlabs.hasMore') }}</span>
              <div>
                @if (syncResult()?.has_more) {
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    {{ lang.isVietnamese() ? 'Còn dữ liệu' : 'Yes' }} (Next: {{ syncResult()?.next_offset }})
                  </span>
                } @else {
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                    {{ lang.isVietnamese() ? 'Hết dữ liệu' : 'No' }}
                  </span>
                }
              </div>
            </div>

            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span class="text-[11px] text-slate-500 block mb-1 font-medium">{{ lang.t('admin.airlabs.nextOffset') }}</span>
              <div class="text-xl font-bold text-slate-700 font-mono">
                {{ syncResult()?.next_offset != null ? syncResult()?.next_offset : '-' }}
              </div>
            </div>
          </div>

          <!-- Window note verbatim in highlighted info box -->
          @if (syncResult()?.window_note) {
            <div class="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-900 text-xs flex items-start gap-3">
              <app-icon name="info" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div class="space-y-1">
                <span class="font-bold text-amber-900 block">{{ lang.t('admin.airlabs.windowNoteTitle') }}</span>
                <p class="leading-relaxed whitespace-pre-wrap">{{ syncResult()?.window_note }}</p>
              </div>
            </div>
          }

          @if (syncResult()?.flights?.length) {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th class="py-2.5 px-3">{{ lang.t('admin.dashboard.flightNumber') }}</th>
                    <th class="py-2.5 px-3">{{ lang.t('admin.airlabs.airline') }}</th>
                    <th class="py-2.5 px-3">{{ lang.t('admin.airlabs.depTime') }}</th>
                    <th class="py-2.5 px-3">{{ lang.t('admin.airlabs.arrTime') }}</th>
                    <th class="py-2.5 px-3">{{ lang.t('common.status') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (f of syncResult()?.flights; track f._id || f.flight_number) {
                    <tr class="hover:bg-slate-50">
                      <td class="py-2.5 px-3 font-mono font-bold text-navy">{{ f.flight_number }}</td>
                      <td class="py-2.5 px-3 font-semibold text-slate-700">{{ f.airline_iata || '-' }}</td>
                      <td class="py-2.5 px-3 text-slate-600">{{ f.scheduled_departure | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td class="py-2.5 px-3 text-slate-600">{{ f.scheduled_arrival | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
                          {{ statusLabel(f.status || 'SCHEDULED') }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="pt-3 border-t border-slate-100 text-right">
              <a routerLink="/admin/flights" class="btn-navy text-xs !py-2 !px-4 font-bold inline-flex items-center gap-1.5">
                <span>{{ lang.t('admin.airlabs.goFlightList') }}</span>
                <app-icon name="arrowright" class="w-3.5 h-3.5" />
              </a>
            </div>
          }
        </div>
      }

    </div>
  `,
})
export class AirlabsSyncComponent {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  mode: AirLabsSyncMode = 'route';
  depIata = 'HAN';
  arrIata = 'SGN';
  airlineIata = '';
  flightIata = '';
  limit: number | null = null;
  offset: number | null = 0;
  apiKey = '';

  readonly loading = signal(false);
  readonly syncResult = signal<AirLabsSyncResponse | null>(null);

  getFetchedCount(): number {
    const res = this.syncResult();
    if (!res) return 0;
    return res.fetched_count ?? res.flights?.length ?? 0;
  }

  getCreatedOrUpdatedCount(): number {
    const res = this.syncResult();
    if (!res) return 0;
    return res.created_or_updated_count ?? res.synchronized_count ?? 0;
  }

  /** Nhãn đa ngôn ngữ cho trạng thái chuyến bay */
  statusLabel(status?: string): string {
    switch (status) {
      case 'SCHEDULED':
        return this.lang.t('status.scheduled');
      case 'DELAYED':
        return this.lang.t('status.delayed');
      case 'CANCELLED':
        return this.lang.t('status.cancelled');
      case 'COMPLETED':
        return this.lang.t('status.completed');
      default:
        return status || '—';
    }
  }

  executeSync(nextOffset?: number): void {
    if (nextOffset !== undefined && nextOffset !== null) {
      this.offset = nextOffset;
    }

    if (this.mode === 'route') {
      if (!this.depIata?.trim() || !this.arrIata?.trim()) {
        this.toast.warning(this.lang.t('admin.airlabs.inputAirportsWarning'));
        return;
      }
    } else if (this.mode === 'departure') {
      if (!this.depIata?.trim()) {
        this.toast.warning(this.lang.t('admin.airlabs.inputDepWarning'));
        return;
      }
    } else if (this.mode === 'arrival') {
      if (!this.arrIata?.trim()) {
        this.toast.warning(this.lang.t('admin.airlabs.inputArrWarning'));
        return;
      }
    } else if (this.mode === 'airline') {
      if (!this.airlineIata?.trim()) {
        this.toast.warning(this.lang.t('admin.airlabs.inputAirlineWarning'));
        return;
      }
    } else if (this.mode === 'flight') {
      if (!this.flightIata?.trim()) {
        this.toast.warning(this.lang.t('admin.airlabs.inputFlightWarning'));
        return;
      }
    }

    this.loading.set(true);
    this.api
      .syncAirLabsModes({
        mode: this.mode,
        dep_iata: (this.mode === 'route' || this.mode === 'departure') ? this.depIata.trim().toUpperCase() : undefined,
        arr_iata: (this.mode === 'route' || this.mode === 'arrival') ? this.arrIata.trim().toUpperCase() : undefined,
        airline_iata: this.mode === 'airline' ? this.airlineIata.trim().toUpperCase() : undefined,
        flight_iata: this.mode === 'flight' ? this.flightIata.trim().toUpperCase() : undefined,
        limit: this.limit != null && this.limit > 0 ? Number(this.limit) : undefined,
        offset: this.offset != null && this.offset >= 0 ? Number(this.offset) : undefined,
        api_key: this.apiKey.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.syncResult.set(res);
          const fetched = res.fetched_count ?? res.flights?.length ?? 0;
          const createdOrUpdated = res.created_or_updated_count ?? res.synchronized_count ?? 0;
          const successMsg = this.lang.isVietnamese()
            ? `Đồng bộ hoàn tất: AirLabs trả về ${fetched} chuyến bay, đã tạo/cập nhật ${createdOrUpdated} chuyến trong CSDL.`
            : `Sync completed: AirLabs returned ${fetched} flights, created/updated ${createdOrUpdated} flights in database.`;
          this.toast.success(successMsg);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || this.lang.t('admin.airlabs.syncError'));
        },
      });
  }
}
