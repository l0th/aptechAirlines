import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-commercial-network-search',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="card-luxury p-6 sm:p-7 space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-navy text-gold text-xs font-black flex items-center justify-center">1</span>
            <h2 class="text-lg font-bold text-navy">{{ lang.t('admin.commercial.step1Heading') }}</h2>
          </div>
          <p class="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
            {{ lang.t('admin.commercial.step1Subheading') }}
          </p>
        </div>
      </div>

      <form (ngSubmit)="onSubmit()" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Origin -->
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <app-icon name="planetakeoff" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('admin.commercial.originLabel') }}</span>
            </label>
            <input
              type="text"
              [ngModel]="origin"
              (ngModelChange)="onOriginChange($event)"
              name="origin"
              [placeholder]="lang.t('admin.commercial.originPlaceholder')"
              required
              class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all"
            />
          </div>

          <!-- Destination -->
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <app-icon name="planelanding" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('admin.commercial.destLabel') }}</span>
            </label>
            <input
              type="text"
              [ngModel]="destination"
              (ngModelChange)="onDestinationChange($event)"
              name="destination"
              [placeholder]="lang.t('admin.commercial.destPlaceholder')"
              required
              class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all"
            />
          </div>

          <!-- Date -->
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <app-icon name="calendar" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('admin.commercial.dateLabel') }}</span>
            </label>
            <input
              type="date"
              [ngModel]="departureDate"
              (ngModelChange)="departureDateChange.emit($event)"
              name="departureDate"
              required
              class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-navy focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all"
            />
          </div>

          <!-- Max Stops -->
          <div>
            <label class="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <app-icon name="slidershorizontal" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('admin.commercial.maxStopsLabel') }}</span>
            </label>
            <select
              [ngModel]="maxStops"
              (ngModelChange)="maxStopsChange.emit($event)"
              name="maxStops"
              class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-navy focus:bg-white focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all cursor-pointer"
            >
              <option [ngValue]="null">{{ lang.t('admin.commercial.maxStopsAny') }}</option>
              <option [ngValue]="0">{{ lang.t('admin.commercial.maxStopsDirect') }}</option>
              <option [ngValue]="1">{{ lang.t('admin.commercial.maxStops1') }}</option>
              <option [ngValue]="2">{{ lang.t('admin.commercial.maxStops2') }}</option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-end pt-2">
          <button
            type="submit"
            [disabled]="isSearching || !origin.trim() || !destination.trim() || !departureDate"
            class="btn-gold !px-8 !py-3.5 text-sm font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            @if (isSearching) {
              <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              <span>{{ lang.t('admin.commercial.btnSearchingRoutes') }}</span>
            } @else {
              <app-icon name="search" class="w-4 h-4" />
              <span>{{ lang.t('admin.commercial.btnSearchRoutes') }}</span>
            }
          </button>
        </div>
      </form>
    </div>
  `,
})
export class CommercialNetworkSearchComponent {
  readonly lang = inject(LanguageService);

  @Input() origin = 'HAN';
  @Input() destination = 'SGN';
  @Input() departureDate = new Date().toISOString().slice(0, 10);
  @Input() maxStops: number | null = null;
  @Input() isSearching = false;

  @Output() originChange = new EventEmitter<string>();
  @Output() destinationChange = new EventEmitter<string>();
  @Output() departureDateChange = new EventEmitter<string>();
  @Output() maxStopsChange = new EventEmitter<number | null>();
  @Output() searchSubmit = new EventEmitter<void>();

  onOriginChange(val: string): void {
    this.originChange.emit(val);
  }

  onDestinationChange(val: string): void {
    this.destinationChange.emit(val);
  }

  onSubmit(): void {
    if (this.isSearching || !this.origin.trim() || !this.destination.trim() || !this.departureDate) {
      return;
    }
    this.searchSubmit.emit();
  }
}
