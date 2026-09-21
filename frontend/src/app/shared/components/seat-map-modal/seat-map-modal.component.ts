import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { LanguageService } from '../../../core/services/language.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../icon/icon.component';
import { SeatMapResponse, SeatRow, SeatItem, CabinClass } from '../../../core/models/flight.model';

export interface PassengerSeatSelection {
  passengerIndex: number;
  passengerName: string;
  seatCode: string;
}

@Component({
  selector: 'app-seat-map-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div class="bg-white w-full max-w-4xl max-h-[94vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden my-auto">
          
          <!-- Modal Header -->
          <div class="bg-navy p-4 sm:p-5 text-white flex items-center justify-between border-b border-navy-light shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-amber-500/20 border border-gold text-gold flex items-center justify-center">
                <app-icon name="armchair" class="w-5 h-5" />
              </div>
              <div>
                <h3 class="text-lg font-bold text-white flex items-center gap-2">
                  <span>{{ lang.t('seatmap.title') }}</span>
                  <span class="text-xs bg-amber-500/20 text-gold border border-gold/40 px-2 py-0.5 rounded-full font-mono">
                    {{ flightNumber || seatMapData()?.flight_number }}
                  </span>
                </h3>
                <p class="text-xs text-slate-300 flex items-center gap-2">
                  <span>{{ routeInfo }} • {{ aircraftModel || seatMapData()?.aircraft_model || this.lang.t('lookup.unknownAircraft') }}</span>
                  @if (allowedCabinClass) {
                    <span class="text-[10px] bg-amber-500/20 text-gold border border-gold/40 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      {{ allowedCabinClass }}
                    </span>
                  }
                </p>
              </div>
            </div>

            <button
              (click)="close()"
              class="p-2 text-slate-400 hover:text-white rounded-full hover:bg-navy-light transition-colors"
            >
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Main Scrollable Area -->
          <div class="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 flex flex-col md:flex-row gap-6">
            
            <!-- Left / Sidebar Info: Passenger selection & Legend & Notices -->
            <div class="w-full md:w-80 shrink-0 space-y-4 order-2 md:order-1">
              
              <!-- Passenger Selector -->
              <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <app-icon name="users" class="w-4 h-4 text-gold" />
                  <span>{{ lang.t('seatmap.selectingFor') }}</span>
                </h4>
                <div class="space-y-2">
                  @for (p of passengerList; track $index) {
                    <button
                      type="button"
                      (click)="activePassengerIndex.set($index)"
                      [class.border-gold]="activePassengerIndex() === $index"
                      [class.bg-amber-50]="activePassengerIndex() === $index"
                      [class.border-slate-200]="activePassengerIndex() !== $index"
                      class="w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all"
                    >
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-slate-800 truncate">
                          {{ p.name || (lang.t('seatmap.passenger') + ' ' + ($index + 1)) }}
                        </div>
                        <div class="text-[11px] text-slate-500">
                          {{ p.type || lang.t('seatmap.adult') }}
                        </div>
                      </div>
                      <div class="shrink-0 pl-2">
                        @if (assignedSeats()[$index]) {
                          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-white font-mono font-bold text-xs shadow-sm">
                            <app-icon name="armchair" class="w-3 h-3" />
                            {{ assignedSeats()[$index] }}
                          </span>
                        } @else {
                          <span class="text-[11px] text-slate-400 italic">{{ lang.t('seatmap.unselected') }}</span>
                        }
                      </div>
                    </button>
                  }
                </div>
              </div>

              <!-- Color Legend -->
              <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <app-icon name="info" class="w-4 h-4 text-navy" />
                  <span>{{ lang.t('seatmap.legendTitle') }}</span>
                </h4>
                <div class="space-y-2 text-xs">
                  <!-- Business Class (Gold) -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-amber-500 text-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                      <app-icon name="crown" class="w-3 h-3" />
                    </div>
                    <span class="text-slate-700 font-medium">{{ lang.t('seatmap.legend.businessDesc') }}</span>
                  </div>

                  <!-- Available (Emerald) -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                      <app-icon name="check" class="w-3 h-3" />
                    </div>
                    <span class="text-slate-700 font-medium">{{ lang.t('seatmap.legend.availableDesc') }}</span>
                  </div>

                  <!-- Exit Row (Sky) -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-sky-600 text-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                      <app-icon name="shieldcheck" class="w-3 h-3" />
                    </div>
                    <span class="text-slate-700 font-medium">{{ lang.t('seatmap.legend.exitDesc') }}</span>
                  </div>

                  <!-- Currently Selected (Gold Glow) -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-amber-400 text-navy ring-2 ring-amber-500 seat-glow flex items-center justify-center text-[10px] font-bold">
                      <app-icon name="armchair" class="w-3 h-3" />
                    </div>
                    <span class="text-slate-700 font-medium">{{ lang.t('seatmap.legend.selectedDesc') }}</span>
                  </div>

                  <!-- Occupied / Locked (Gray with lock) -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-slate-300 text-slate-500 flex items-center justify-center">
                      <app-icon name="lock" class="w-3 h-3" />
                    </div>
                    <span class="text-slate-500 font-medium">{{ lang.t('seatmap.legend.occupiedDesc') }}</span>
                  </div>

                  <!-- Mismatched Cabin / Locked -->
                  <div class="flex items-center gap-2.5">
                    <div class="w-5 h-5 rounded-md bg-slate-200 text-slate-400 border border-slate-300 flex items-center justify-center text-[10px] font-bold">
                      <app-icon name="lock" class="w-3 h-3 text-slate-400" />
                    </div>
                    <span class="text-slate-500 font-medium">
                      {{ lang.t('seatmap.legend.lockedOtherCabin') }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Selection Policy & Safety Notices -->
              <div class="bg-amber-50/70 p-4 rounded-2xl border border-amber-200/80 text-xs space-y-2">
                <div class="font-bold text-amber-900 flex items-center gap-1.5">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600" />
                  <span>{{ lang.t('seatmap.safetyRegulations') }}</span>
                </div>
                <div class="text-slate-700 space-y-1 text-[11px] leading-relaxed">
                  <p><strong>AUTO (Tự động):</strong> Miễn phí 100%. Hệ thống tự xếp ghế gần nhau khi hoàn tất.</p>
                  <p><strong>CHOOSE (Tự chọn):</strong> Chọn vị trí mong muốn, áp dụng phụ phí niêm yết theo sơ đồ.</p>
                </div>
                @if (seatMapData()?.notice?.exit_row_warning) {
                  <p class="text-slate-600 leading-relaxed text-[11px] pt-1 border-t border-amber-200/60">
                    {{ seatMapData()?.notice?.exit_row_warning }}
                  </p>
                }
              </div>

            </div>

            <!-- Right / Center: Airplane Fuselage -->
            <div class="flex-1 flex flex-col items-center justify-start order-1 md:order-2 overflow-x-auto pb-4">
              
              <!-- Airplane Fuselage Outer Container -->
              <div class="w-full max-w-lg aircraft-fuselage shadow-xl p-4 sm:p-6 relative">
                
                <!-- Airplane Nose / Cockpit Cone -->
                <div class="text-center pb-6 border-b border-slate-200/80 relative">
                  <div class="w-20 h-10 bg-slate-200/60 rounded-t-full mx-auto flex items-end justify-center pb-1 text-slate-500 mb-2">
                    <app-icon name="plane" class="w-5 h-5 text-navy" />
                  </div>
                  <span class="text-[11px] uppercase tracking-widest text-slate-400 font-bold block">
                    {{ lang.t('seatmap.nose') }}
                  </span>
                  
                  <!-- Emergency Exits Front -->
                  <div class="flex justify-between items-center text-[10px] text-sky-700 font-bold px-2 mt-2">
                    <span class="flex items-center gap-1"><app-icon name="shieldcheck" class="w-3 h-3" /> EXIT</span>
                    <span class="flex items-center gap-1">EXIT <app-icon name="shieldcheck" class="w-3 h-3" /></span>
                  </div>
                </div>

                <!-- Rows List -->
                @if (loading()) {
                  <div class="py-20 text-center text-slate-400">
                    <app-icon name="refreshcw" class="w-8 h-8 animate-spin mx-auto text-gold mb-2" />
                    <p class="text-xs">{{ lang.t('common.loading') }}</p>
                  </div>
                } @else if (!displayRows().length || seatMapData()?.layout_available === false) {
                  <div class="py-16 text-center text-slate-500">
                    <app-icon name="plane" class="w-10 h-10 mx-auto text-slate-300 mb-3" />
                    <p class="text-sm font-semibold text-slate-700">Sơ đồ chỗ ngồi chưa sẵn sàng cho chuyến bay này</p>
                    <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Hệ thống sẽ tự động xếp chỗ miễn phí cho quý khách khi hoàn tất đặt vé.</p>
                  </div>
                } @else {
                  <div class="space-y-1.5 py-4">
                    @for (row of displayRows(); track row.row_number) {
                      
                      <!-- Exit Row Alert Header -->
                      @if (row.is_exit_row) {
                        <div class="flex items-center justify-between py-1 px-3 my-1.5 bg-sky-50 border-y border-sky-200 text-sky-800 text-[10px] font-bold rounded">
                          <span>{{ lang.t('seatmap.emergencyExit') }}</span>
                          <span class="font-mono">EXIT ROW {{ row.row_number }}</span>
                        </div>
                      }

                      <!-- Dynamic Row by column_groups -->
                      <div class="flex items-center justify-center gap-1.5 sm:gap-2">
                        <!-- Left Row Number -->
                        <div class="w-5 text-right font-mono text-[11px] font-bold text-slate-400 shrink-0 select-none">
                          {{ row.row_number }}
                        </div>

                        <!-- Column Groups -->
                        @for (group of (row.column_groups || [row.seats]); track $index; let gIdx = $index) {
                          <div class="flex items-center gap-1 sm:gap-1.5">
                            @for (seat of group; track seat.seat_code) {
                              <button
                                type="button"
                                [disabled]="isSeatDisabled(seat)"
                                (click)="selectSeat(seat)"
                                [class]="getSeatClasses(seat, row)"
                                [title]="getSeatTooltip(seat, row)"
                                class="w-8 h-9 sm:w-9 sm:h-10 rounded-lg flex flex-col items-center justify-center relative font-mono text-xs font-bold transition-all"
                              >
                                <!-- Seat Code Label -->
                                <span class="text-[11px] leading-none">{{ seat.seat_code }}</span>

                                <!-- Seat State Icons -->
                                @if (seat.is_occupied) {
                                  <app-icon name="lock" class="w-3 h-3 text-slate-400" />
                                } @else if (!isCabinAllowed(seat.cabin_class)) {
                                  <app-icon name="lock" class="w-3 h-3 text-slate-400" />
                                } @else if (isSeatSelectedByActive(seat.seat_code)) {
                                  <app-icon name="armchair" class="w-3.5 h-3.5 text-navy" />
                                } @else {
                                  <span class="leading-none">{{ seat.column }}</span>
                                }
                              </button>
                            }
                          </div>

                          <!-- Aisle Spacer between Groups -->
                          @if (gIdx < (row.column_groups?.length || 1) - 1) {
                            <div class="w-3 sm:w-4 flex items-center justify-center shrink-0">
                              <div class="w-0.5 h-4 bg-slate-200 rounded-full"></div>
                            </div>
                          }
                        }

                        <!-- Right Row Number -->
                        <div class="w-5 text-left font-mono text-[11px] font-bold text-slate-400 shrink-0 select-none">
                          {{ row.row_number }}
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- Airplane Tail -->
                <div class="text-center pt-8 mt-6 border-t border-slate-200/80">
                  <span class="text-[10px] uppercase tracking-widest text-slate-400 font-bold block">
                    {{ lang.t('seatmap.tail') }}
                  </span>
                  <div class="w-12 h-6 bg-slate-200/60 rounded-b-full mx-auto mt-2"></div>
                </div>

              </div>
            </div>

          </div>

          <!-- Modal Footer with Confirm Button -->
          <div class="bg-white p-4 sm:p-5 border-t border-slate-200 flex items-center justify-between shrink-0">
            <div class="text-xs text-slate-600">
              <span>{{ lang.t('seatmap.selectedLabel') }}</span>
              <strong class="text-navy font-bold">{{ selectedCount() }}/{{ passengerList.length }} {{ lang.t('seatmap.seatsCount') }}</strong>
            </div>

            <div class="flex items-center gap-3">
              <button
                (click)="close()"
                class="btn-ghost text-xs"
              >
                {{ lang.t('seatmap.closeBtn') }}
              </button>

              <button
                (click)="confirmSelection()"
                class="btn-gold !py-2.5 !px-6 text-xs sm:text-sm font-bold"
              >
                <app-icon name="checkcircle2" class="w-4 h-4" />
                <span>{{ lang.t('seatmap.confirmBtn') }}</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    }
  `,
})
export class SeatMapModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() flightId = '';
  @Input() flightNumber = '';
  @Input() routeInfo = '';
  @Input() aircraftModel = '';
  @Input() passengerList: Array<{ name: string; type?: string }> = [{ name: 'Passenger 1' }];
  @Input() initialSeats: Record<number, string> = {};
  @Input() allowedCabinClass?: CabinClass | string | null = null;

  @Output() closeEvent = new EventEmitter<void>();
  @Output() seatsConfirmed = new EventEmitter<Record<number, string>>();
  @Output() seatAssignmentsSanitized = new EventEmitter<Record<number, string>>();

  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);

  readonly loading = signal(false);
  readonly seatMapData = signal<SeatMapResponse | null>(null);
  readonly activePassengerIndex = signal(0);
  readonly assignedSeats = signal<Record<number, string>>({});

  readonly selectedCount = computed(() => Object.keys(this.assignedSeats()).length);
  readonly selectedSeatsDisplay = computed(() => `${this.selectedCount()}/${this.passengerList.length} ${this.lang.t('seatmap.seatsCount')}`);
  readonly hasValidSelection = computed(() => this.selectedCount() > 0);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.assignedSeats.set({ ...this.initialSeats });
      this.activePassengerIndex.set(0);
      if (this.flightId) {
        this.fetchSeatMap();
      }
    } else if (changes['initialSeats'] && this.isOpen) {
      this.assignedSeats.set({ ...this.initialSeats });
      const data = this.seatMapData();
      if (data) {
        this.sanitizeInitialAssignments(data);
      }
    } else if (changes['allowedCabinClass'] && this.isOpen) {
      const data = this.seatMapData();
      if (data) {
        this.sanitizeInitialAssignments(data);
      }
    }
  }

  fetchSeatMap(): void {
    this.loading.set(true);
    this.api.getSeatMap(this.flightId).subscribe({
      next: (data) => {
        this.seatMapData.set(data);
        this.loading.set(false);
        if (data) {
          this.sanitizeInitialAssignments(data);
        }
      },
      error: () => {
        this.seatMapData.set(null);
        this.loading.set(false);
      },
    });
  }

  /**
   * Sanitizes initial seat assignments against the actual seat map data and allowedCabinClass.
   * Purges seats that are:
   * 1. Not found in layout
   * 2. Marked is_occupied
   * 3. Belonging to a cabin class that does NOT match allowedCabinClass (fail-safe)
   *
   * Immediately notifies parent components via seatAssignmentsSanitized output so
   * invalid seats are wiped from parent state even if the modal is closed without "Confirm".
   */
  sanitizeInitialAssignments(data: SeatMapResponse): void {
    const current = { ...this.assignedSeats() };
    let changed = false;
    const allSeats = new Map<string, SeatItem>();
    for (const row of data.rows || []) {
      for (const s of row.seats || []) {
        if (s.seat_code) {
          allSeats.set(s.seat_code.toUpperCase(), s);
        }
      }
    }

    for (const [idxStr, code] of Object.entries(current)) {
      const seat = allSeats.get((code || '').toUpperCase());
      if (!seat || seat.is_occupied || !this.isCabinAllowed(seat.cabin_class)) {
        delete current[Number(idxStr)];
        changed = true;
      }
    }

    if (changed) {
      this.assignedSeats.set(current);
      this.seatAssignmentsSanitized.emit(current);
    }
  }

  displayRows = computed<SeatRow[]>(() => {
    return this.seatMapData()?.rows || [];
  });

  getSeat(row: SeatRow, col: string): SeatItem | undefined {
    return row.seats.find((s) => s.column === col);
  }

  normalizeCabin(cabin?: string | null): string {
    return (cabin || '').trim().toUpperCase();
  }

  /**
   * FAIL-SAFE CABIN INTEGRITY RULE:
   * If allowedCabinClass is missing, null, or empty, ALL seats are disallowed (fail closed).
   * If seatCabin is missing, null, or empty, the seat is NEVER inferred as ECONOMY and is disallowed (fail closed).
   * Otherwise, the seat's cabin must strictly match the allowed cabin class.
   */
  isCabinAllowed(seatCabin?: string | null): boolean {
    const allowed = this.normalizeCabin(this.allowedCabinClass);
    const actual = this.normalizeCabin(seatCabin);
    if (!allowed || !actual) return false;
    return actual === allowed;
  }

  isSeatDisabled(seat?: SeatItem): boolean {
    if (!seat) return true;
    if (seat.is_occupied) return true;
    if (!this.isCabinAllowed(seat.cabin_class)) return true;
    return false;
  }

  isSeatSelectedByActive(seatCode?: string): boolean {
    if (!seatCode) return false;
    const current = this.assignedSeats()[this.activePassengerIndex()];
    return current === seatCode;
  }

  isSeatSelectedByAny(seatCode?: string): boolean {
    if (!seatCode) return false;
    return Object.values(this.assignedSeats()).includes(seatCode);
  }

  getSeatClasses(seat: SeatItem | undefined, row: SeatRow): string {
    if (!seat) return 'bg-transparent invisible';

    const isCurrentActive = this.isSeatSelectedByActive(seat.seat_code);
    const isSelectedByOther = this.isSeatSelectedByAny(seat.seat_code) && !isCurrentActive;

    // 1. Occupied / Locked (Gray with lock icon)
    if (seat.is_occupied) {
      return 'bg-slate-300 text-slate-500 border border-slate-300 opacity-80';
    }

    // 2. Mismatched Cabin Class (Disabled / Locked with reduced opacity)
    if (!this.isCabinAllowed(seat.cabin_class)) {
      return 'bg-slate-200/70 text-slate-400 border border-slate-300 cursor-not-allowed opacity-40';
    }

    // 3. Currently selected by active passenger (Gold Glow ring)
    if (isCurrentActive) {
      return 'bg-amber-400 text-navy ring-4 ring-amber-400 font-extrabold seat-glow border-2 border-amber-600 shadow-md scale-105';
    }

    // 4. Selected by another passenger in group
    if (isSelectedByOther) {
      return 'bg-amber-300 text-navy border-2 border-amber-500 font-bold opacity-90';
    }

    // 5. Business class by cabin_class (Gold)
    if (this.normalizeCabin(seat.cabin_class) === 'BUSINESS') {
      return 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm border border-amber-600 hover:scale-105';
    }

    // 6. Emergency Exit rows (Sky Blue)
    if (seat.is_exit_row || row.is_exit_row) {
      return 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm border border-sky-700 hover:scale-105';
    }

    // 7. Standard available seat (Emerald green)
    return 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm border border-emerald-600 hover:scale-105';
  }

  getCabinDisplayLabel(cabin: string): string {
    const c = this.normalizeCabin(cabin);
    if (!c) return '';
    if (c === 'ECONOMY') return this.lang.t('search.economy');
    if (c === 'BUSINESS') return this.lang.t('search.business');
    if (c === 'CLUB') return this.lang.t('search.club');
    if (c === 'FIRST') return this.lang.t('search.first');
    return c;
  }

  getSeatTooltip(seat: SeatItem | undefined, row: SeatRow): string {
    if (!seat) return '';
    if (seat.is_occupied) return `${this.lang.t('seatmap.seat')} ${seat.seat_code}: ${this.lang.t('seatmap.occupied')}`;

    const seatCabin = this.normalizeCabin(seat.cabin_class);
    const allowedCabin = this.normalizeCabin(this.allowedCabinClass);

    if (!allowedCabin) {
      return this.lang.t('seatmap.tooltipCabinUndefined');
    }

    if (!this.isCabinAllowed(seat.cabin_class)) {
      if (!seatCabin) {
        return this.lang.t('seatmap.tooltipSeatCabinUnavailable');
      }
      const seatCabinLabel = this.getCabinDisplayLabel(seatCabin);
      const allowedCabinLabel = this.getCabinDisplayLabel(allowedCabin);
      return this.lang
        .t('seatmap.tooltipCabinMismatch')
        .replace('{seat}', seat.seat_code)
        .replace('{seatCabin}', seatCabinLabel)
        .replace('{allowedCabin}', allowedCabinLabel);
    }

    let type = this.getCabinDisplayLabel(seatCabin) || this.lang.t('search.economy');
    if (seat.is_exit_row || row.is_exit_row) {
      type = `${type} • ${this.lang.t('seatmap.exitRow')}`;
    }
    const feeStr = seat.fee ? ` • +${seat.fee.toLocaleString()} VND` : '';
    return `${this.lang.t('seatmap.seat')} ${seat.seat_code} (${type}${feeStr})`;
  }

  selectSeat(seat?: SeatItem): void {
    if (!seat || this.isSeatDisabled(seat)) return;

    const currentAssignments = { ...this.assignedSeats() };
    const pIdx = this.activePassengerIndex();

    // Check if another passenger already has this seat
    for (const [idx, code] of Object.entries(currentAssignments)) {
      if (code === seat.seat_code && Number(idx) !== pIdx) {
        delete currentAssignments[Number(idx)];
      }
    }

    // Toggle or set for current passenger
    if (currentAssignments[pIdx] === seat.seat_code) {
      delete currentAssignments[pIdx];
    } else {
      currentAssignments[pIdx] = seat.seat_code;
      // Auto advance to next unassigned passenger if any
      const nextIdx = this.passengerList.findIndex(
        (_, i) => i !== pIdx && !currentAssignments[i],
      );
      if (nextIdx !== -1) {
        this.activePassengerIndex.set(nextIdx);
      }
    }

    this.assignedSeats.set(currentAssignments);
  }

  confirmSelection(): void {
    this.seatsConfirmed.emit(this.assignedSeats());
    this.close();
  }

  close(): void {
    this.closeEvent.emit();
  }
}
