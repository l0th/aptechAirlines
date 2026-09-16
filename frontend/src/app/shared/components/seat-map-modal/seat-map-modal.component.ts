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
                <p class="text-xs text-slate-300">{{ routeInfo }} • {{ aircraftModel || seatMapData()?.aircraft_model || this.lang.t('lookup.unknownAircraft') }}</p>
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

              <!-- Color Legend (Tuân thủ bảng màu GUI Standards) -->
              <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h4 class="text-xs font-bold text-navy uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <app-icon name="info" class="w-4 h-4 text-navy" />
                  <span>{{ lang.t('seatmap.legendTitle') }}</span>
                </h4>
                <div class="space-y-2 text-xs">
                  <!-- Business / Skyboss (Gold) -->
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

                  <!-- Exit Row (Navy/Sky) -->
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
                </div>
              </div>

              <!-- Safety Notices -->
              <div class="bg-amber-50/70 p-4 rounded-2xl border border-amber-200/80 text-xs space-y-2">
                <div class="font-bold text-amber-900 flex items-center gap-1.5">
                  <app-icon name="alerttriangle" class="w-4 h-4 text-amber-600" />
                  <span>{{ lang.t('seatmap.safetyRegulations') }}</span>
                </div>
                <p class="text-slate-600 leading-relaxed text-[11px]">
                  {{ seatMapData()?.notice?.exit_row_warning || lang.t('seatmap.notice.exit') }}
                </p>
                <div class="text-amber-800 font-semibold text-[11px] pt-1">
                  {{ seatMapData()?.notice?.skyboss_benefit || lang.t('seatmap.notice.skyboss') }}
                </div>
              </div>

            </div>

            <!-- Right / Center: Airplane Fuselage (Thân máy bay Vietjet x Aptech Style) -->
            <div class="flex-1 flex flex-col items-center justify-start order-1 md:order-2 overflow-x-auto pb-4">
              
              <!-- Airplane Fuselage Outer Container -->
              <div class="w-full max-w-md aircraft-fuselage shadow-xl p-4 sm:p-6 relative">
                
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

                <!-- Column Headers (A B C | Lối đi | D E F) -->
                <div class="grid grid-cols-7 gap-1.5 sm:gap-2 my-4 text-center text-xs font-bold text-slate-500">
                  <span>A</span>
                  <span>B</span>
                  <span>C</span>
                  <span class="text-[10px] uppercase tracking-wider text-slate-400">{{ lang.t('seatmap.aisle') }}</span>
                  <span>D</span>
                  <span>E</span>
                  <span>F</span>
                </div>

                <!-- Rows List -->
                @if (loading()) {
                  <div class="py-20 text-center text-slate-400">
                    <app-icon name="refreshcw" class="w-8 h-8 animate-spin mx-auto text-gold mb-2" />
                    <p class="text-xs">{{ lang.t('common.loading') }}</p>
                  </div>
                } @else {
                  <div class="space-y-2">
                    @for (row of displayRows(); track row.row_number) {
                      
                      <!-- Exit Row Divider Alert before row 12 or 14 -->
                      @if (row.is_exit_row) {
                        <div class="flex items-center justify-between py-1 px-2 my-1 bg-sky-50 border-y border-sky-200 text-sky-800 text-[10px] font-bold rounded">
                          <span>{{ lang.t('seatmap.emergencyExit') }}</span>
                          <span class="font-mono">EXIT ROW {{ row.row_number }}</span>
                        </div>
                      }

                      <!-- Row item with 7 cols: 3 seats + aisle label + 3 seats -->
                      <div class="grid grid-cols-7 gap-1.5 sm:gap-2 items-center">
                        <!-- Left Seats: A, B, C -->
                        @for (col of ['A', 'B', 'C']; track col) {
                          @let seat = getSeat(row, col);
                          <button
                            type="button"
                            [disabled]="isSeatDisabled(seat)"
                            (click)="selectSeat(seat)"
                            [title]="getSeatTooltip(seat, row)"
                            [ngClass]="getSeatClasses(seat, row)"
                            class="aspect-square rounded-lg flex flex-col items-center justify-center text-[10px] sm:text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                          >
                            @if (seat?.is_occupied) {
                              <app-icon name="lock" class="w-3 h-3 text-slate-500" />
                            } @else if (isSeatSelectedByActive(seat?.seat_code)) {
                              <app-icon name="armchair" class="w-3.5 h-3.5 text-navy" />
                            } @else {
                              <span class="leading-none">{{ col }}</span>
                            }
                          </button>
                        }

                        <!-- Aisle Column (Row Number Indicator) -->
                        <div class="text-center font-mono text-[11px] font-bold text-slate-400">
                          {{ row.row_number }}
                        </div>

                        <!-- Right Seats: D, E, F -->
                        @for (col of ['D', 'E', 'F']; track col) {
                          @let seat = getSeat(row, col);
                          <button
                            type="button"
                            [disabled]="isSeatDisabled(seat)"
                            (click)="selectSeat(seat)"
                            [title]="getSeatTooltip(seat, row)"
                            [ngClass]="getSeatClasses(seat, row)"
                            class="aspect-square rounded-lg flex flex-col items-center justify-center text-[10px] sm:text-xs font-bold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                          >
                            @if (seat?.is_occupied) {
                              <app-icon name="lock" class="w-3 h-3 text-slate-500" />
                            } @else if (isSeatSelectedByActive(seat?.seat_code)) {
                              <app-icon name="armchair" class="w-3.5 h-3.5 text-navy" />
                            } @else {
                              <span class="leading-none">{{ col }}</span>
                            }
                          </button>
                        }
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
                class="btn-gold !py-2.5 !px-6 text-xs sm:text-sm"
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

  @Output() closeEvent = new EventEmitter<void>();
  @Output() seatsConfirmed = new EventEmitter<Record<number, string>>();

  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(false);
  readonly seatMapData = signal<SeatMapResponse | null>(null);
  readonly activePassengerIndex = signal(0);
  readonly assignedSeats = signal<Record<number, string>>({});

  readonly selectedCount = computed(() => Object.keys(this.assignedSeats()).length);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.assignedSeats.set({ ...this.initialSeats });
      if (this.flightId) {
        this.fetchSeatMap();
      }
    }
  }

  fetchSeatMap(): void {
    this.loading.set(true);
    this.api.getSeatMap(this.flightId).subscribe({
      next: (data) => {
        this.seatMapData.set(data);
        this.loading.set(false);
      },
      error: () => {
        // Fallback to local default map if flightId not in backend
        this.seatMapData.set(this.generateDefaultSeatMap());
        this.loading.set(false);
      },
    });
  }

  displayRows = computed<SeatRow[]>(() => {
    if (this.seatMapData()?.rows?.length) {
      return this.seatMapData()!.rows;
    }
    return this.generateDefaultSeatMap().rows;
  });

  getSeat(row: SeatRow, col: string): SeatItem | undefined {
    return row.seats.find((s) => s.column === col);
  }

  isSeatDisabled(seat?: SeatItem): boolean {
    if (!seat) return true;
    return seat.is_occupied;
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

    // 2. Currently selected by active passenger (Gold Glow ring)
    if (isCurrentActive) {
      return 'bg-amber-400 text-navy ring-4 ring-amber-400 font-extrabold seat-glow border-2 border-amber-600 shadow-md scale-105';
    }

    // 3. Selected by another passenger in group
    if (isSelectedByOther) {
      return 'bg-amber-300 text-navy border-2 border-amber-500 font-bold opacity-90';
    }

    // 4. Business / Skyboss rows 1-5 (Royal Gold)
    if (row.row_number <= 5) {
      return 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm border border-amber-600 hover:scale-105';
    }

    // 5. Emergency Exit rows 12 & 14 (Sky Navy)
    if (row.is_exit_row) {
      return 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm border border-sky-700 hover:scale-105';
    }

    // 6. Standard available seat (Emerald green)
    return 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm border border-emerald-600 hover:scale-105';
  }

  getSeatTooltip(seat: SeatItem | undefined, row: SeatRow): string {
    if (!seat) return '';
    if (seat.is_occupied) return `${this.lang.t('seatmap.seat')} ${seat.seat_code}: ${this.lang.t('seatmap.occupied')}`;
    let type = this.lang.t('seatmap.economy');
    if (row.row_number <= 5) type = this.lang.t('seatmap.business');
    if (row.is_exit_row) type = this.lang.t('seatmap.exitRow');
    return `${this.lang.t('seatmap.seat')} ${seat.seat_code} (${type})`;
  }

  selectSeat(seat?: SeatItem): void {
    if (!seat || seat.is_occupied) return;

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

  private generateDefaultSeatMap(): SeatMapResponse {
    const rows: SeatRow[] = [];
    const exitRows = [12, 14];
    const skippedRows = [13];

    for (let r = 1; r <= 31; r++) {
      if (skippedRows.includes(r)) continue;

      const isExit = exitRows.includes(r);
      const isBusiness = r <= 5;
      const seats: SeatItem[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((col) => ({
        seat_code: `${r}${col}`,
        column: col,
        is_occupied: false,
        cabin_class: isBusiness ? CabinClass.BUSINESS : CabinClass.ECONOMY,
      }));

      rows.push({
        row_number: r,
        is_exit_row: isExit,
        is_special: isBusiness,
        seats,
      });
    }

    return {
      flight_id: this.flightId,
      flight_number: this.flightNumber || '',
      route: this.routeInfo || '',
      aircraft_model: this.aircraftModel || this.lang.t('seatmap.mockNotice'),
      departure_time: new Date().toISOString(),
      legend: [],
      notice: {
        skyboss_benefit: this.lang.t('seatmap.notice.skyboss'),
        exit_row_warning: this.lang.t('seatmap.notice.exit'),
      },
      layout: {
        left_columns: ['A', 'B', 'C'],
        right_columns: ['D', 'E', 'F'],
        exit_rows: [12, 14],
        special_rows: [1, 2, 3, 4, 5],
        skipped_rows: [13],
      },
      rows,
    };
  }
}
