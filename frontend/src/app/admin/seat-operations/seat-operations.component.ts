import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Flight } from '../../core/models/flight.model';

interface EnrichedSeatItem {
  seat_code: string;
  row_number: number;
  column_letter: string;
  cabin_class: string;
  is_exit_row?: boolean;
  is_extra_legroom?: boolean;
  position?: 'WINDOW' | 'AISLE' | 'MIDDLE';
  status: 'AVAILABLE' | 'HELD' | 'OCCUPIED' | 'BLOCKED';
  staff_block_reason?: string;
  seat_fee: number;
  pricing_dimensions?: string[];
}

interface EnrichedSeatRow {
  row_number: number;
  cabin_class: string;
  is_exit_row: boolean;
  is_extra_legroom: boolean;
  column_groups: EnrichedSeatItem[][];
}

interface EnrichedSeatMap {
  aircraft_type: string;
  model_name: string;
  total_capacity: number;
  cabin_capacities: Record<string, number>;
  total_available: number;
  total_occupied_or_held: number;
  total_blocked: number;
  rows: EnrichedSeatRow[];
}

@Component({
  selector: 'app-seat-operations',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy flex items-center gap-2.5">
            <app-icon name="armchair" class="w-6 h-6 text-gold" />
            <span>{{ lang.isVietnamese() ? 'Trung Tâm Vận Hành Ghế' : 'Seat Operations Console' }}</span>
          </h1>
          <p class="text-xs text-slate-500 mt-1">
            {{ lang.isVietnamese()
              ? 'Quản lý sơ đồ ghế theo chuyến bay, khóa ghế bảo trì/nghỉ ngơi phi hành đoàn/VIP và thiết lập giá điều chỉnh riêng.'
              : 'Flight-level seat map management, maintenance/crew/VIP holds, and per-seat fee overrides.' }}
          </p>
        </div>

        <div class="flex items-center gap-2">
          @if (selectedFlight()) {
            <button
              type="button"
              (click)="loadSeatMap()"
              class="btn-outline-navy text-xs !py-2 !px-3 font-semibold"
              [disabled]="loadingMap()"
            >
              <app-icon name="refreshcw" class="w-3.5 h-3.5" [class.animate-spin]="loadingMap()" />
              <span>{{ lang.isVietnamese() ? 'Làm mới' : 'Refresh' }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Flight Selection Card -->
      <div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <h2 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <app-icon name="plane" class="w-4 h-4 text-gold" />
          <span>{{ lang.isVietnamese() ? 'Chọn chuyến bay để kiểm tra ghế' : 'Select Flight for Seat Operations' }}</span>
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-700 mb-1">
              {{ lang.isVietnamese() ? 'Chuyến bay khả dụng (30 ngày tới)' : 'Upcoming Flights (Next 30 Days)' }}
            </label>
            <select
              [ngModel]="selectedFlightId()"
              (ngModelChange)="onFlightSelected($event)"
              class="w-full text-xs rounded-xl border border-slate-300 py-2 px-3 bg-white focus:outline-none focus:ring-2 focus:ring-navy font-mono"
            >
              <option value="">-- {{ lang.isVietnamese() ? 'Chọn chuyến bay' : 'Select a flight' }} --</option>
              @for (f of flights(); track f._id) {
                <option [value]="f._id">
                  {{ f.flight_number }} | {{ f.origin_iata }} -> {{ f.dest_iata }} | {{ f.scheduled_departure | date:'dd/MM HH:mm' }} | {{ f.aircraft?.model_code || 'A20N' }}
                </option>
              }
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">
              {{ lang.isVietnamese() ? 'Hoặc nhập Flight ID' : 'Or enter Flight ID' }}
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                [(ngModel)]="manualFlightId"
                [placeholder]="lang.isVietnamese() ? 'Nhập ID chuyến bay...' : 'Enter Flight ObjectId...'"
                class="flex-1 text-xs rounded-xl border border-slate-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-navy font-mono"
              />
              <button
                type="button"
                (click)="loadManualFlight()"
                class="btn-gold text-xs !py-2 !px-3 shrink-0"
              >
                {{ lang.isVietnamese() ? 'Tải' : 'Load' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Selected Flight Banner -->
        @if (selectedFlight()) {
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-navy text-gold flex items-center justify-center font-black">
                {{ selectedFlight()?.flight_number?.slice(0, 2) }}
              </div>
              <div>
                <span class="font-bold text-navy text-sm">{{ selectedFlight()?.flight_number }}</span>
                <span class="text-slate-400 mx-1.5">•</span>
                <span class="font-mono font-bold text-slate-700">
                  {{ selectedFlight()?.origin_iata }} -> {{ selectedFlight()?.dest_iata }}
                </span>
                <span class="text-slate-400 mx-1.5">•</span>
                <span class="text-slate-500">{{ selectedFlight()?.scheduled_departure | date:'medium' }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="px-2.5 py-1 rounded-lg bg-navy/10 text-navy font-bold font-mono">
                {{ seatMap()?.model_name || selectedFlight()?.aircraft?.model_name || selectedFlight()?.aircraft?.model_code || 'A320neo' }}
              </span>
              <span class="px-2.5 py-1 rounded-lg bg-gold/20 text-navy font-mono font-bold">
                {{ seatMap()?.aircraft_type || selectedFlight()?.aircraft?.model_code || 'A20N' }}
              </span>
            </div>
          </div>
        }
      </div>

      <!-- Capacity & Seat Statistics Summary -->
      @if (seatMap()) {
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {{ lang.isVietnamese() ? 'Tổng số ghế' : 'Total Capacity' }}
            </div>
            <div class="text-2xl font-black text-navy mt-1">
              {{ seatMap()?.total_capacity }}
            </div>
            <div class="text-[11px] text-slate-500 mt-1">
              {{ seatMap()?.model_name }}
            </div>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm">
            <div class="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
              {{ lang.isVietnamese() ? 'Ghế khả dụng' : 'Available Seats' }}
            </div>
            <div class="text-2xl font-black text-emerald-600 mt-1">
              {{ seatMap()?.total_available }}
            </div>
            <div class="text-[11px] text-emerald-700/80 mt-1">
              {{ ((seatMap()!.total_available / seatMap()!.total_capacity) * 100).toFixed(0) }}% {{ lang.isVietnamese() ? 'còn trống' : 'open' }}
            </div>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {{ lang.isVietnamese() ? 'Đã giữ / Đặt chỗ' : 'Occupied / Held' }}
            </div>
            <div class="text-2xl font-black text-slate-700 mt-1">
              {{ seatMap()?.total_occupied_or_held }}
            </div>
            <div class="text-[11px] text-slate-400 mt-1">
              {{ ((seatMap()!.total_occupied_or_held / seatMap()!.total_capacity) * 100).toFixed(0) }}% {{ lang.isVietnamese() ? 'đã bán/giữ' : 'claimed' }}
            </div>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm">
            <div class="text-[11px] font-bold text-rose-600 uppercase tracking-wider">
              {{ lang.isVietnamese() ? 'Ghế bị khóa (Staff)' : 'Staff Blocked' }}
            </div>
            <div class="text-2xl font-black text-rose-600 mt-1">
              {{ seatMap()?.total_blocked }}
            </div>
            <div class="text-[11px] text-rose-700/80 mt-1">
              {{ lang.isVietnamese() ? 'Bảo trì / Nghỉ ngơi / VIP' : 'Maint / Crew / VIP' }}
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4 text-xs">
          <span class="font-bold text-slate-600">{{ lang.isVietnamese() ? 'Chú giải:' : 'Legend:' }}</span>
          
          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-emerald-500 border border-emerald-600"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Trống (Có thể chọn)' : 'Available' }}</span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-slate-300 border border-slate-400"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Đã đặt (Occupied)' : 'Occupied' }}</span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-amber-400 border border-amber-500"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Đang giữ chỗ (Held)' : 'Held' }}</span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-rose-500 border border-rose-600"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Khóa (Bảo trì/Crew/VIP)' : 'Blocked (Staff)' }}</span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-sky-500 border border-sky-600"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Hàng thoát hiểm (Exit Row)' : 'Exit Row' }}</span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="w-3.5 h-3.5 rounded bg-amber-500 border border-amber-600"></span>
            <span class="text-slate-600">{{ lang.isVietnamese() ? 'Thương gia (Business)' : 'Business' }}</span>
          </div>
        </div>

        <!-- Seat Map Grid & Interactive Panel -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Seat Map Layout -->
          <div class="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
            <div class="min-w-[400px] max-w-lg mx-auto space-y-3">
              <!-- Cockpit representation -->
              <div class="w-32 h-10 mx-auto rounded-t-full bg-slate-200 border border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6">
                Cockpit
              </div>

              <!-- Rows -->
              @for (r of seatMap()?.rows; track r.row_number) {
                <div class="flex items-center justify-center gap-3 py-1 px-2 rounded-xl transition-colors"
                  [class.bg-sky-50]="r.is_exit_row"
                  [class.border]="r.is_exit_row"
                  [class.border-sky-200]="r.is_exit_row"
                >
                  <!-- Row Number Label Left -->
                  <div class="w-6 text-right font-mono font-bold text-xs text-slate-400">
                    {{ r.row_number }}
                  </div>

                  <!-- Column Groups (e.g. ABC and DEF, with Aisle between) -->
                  <div class="flex items-center gap-6">
                    @for (grp of r.column_groups; track $index) {
                      <div class="flex items-center gap-1.5">
                        @for (seat of grp; track seat.seat_code) {
                          <button
                            type="button"
                            (click)="selectSeatForAction(seat, r)"
                            [class]="getSeatClasses(seat, r)"
                            class="w-8 h-9 rounded-lg flex flex-col items-center justify-center transition-all duration-150 relative text-[11px] font-bold select-none cursor-pointer focus:outline-none"
                            [title]="getSeatTooltip(seat, r)"
                          >
                            <span>{{ seat.column_letter }}</span>
                            <span class="text-[8px] font-mono leading-none opacity-80 mt-0.5">
                              @if (seat.status === 'BLOCKED') {
                                BLK
                              } @else if (seat.status === 'OCCUPIED') {
                                OCC
                              } @else if (seat.seat_fee > 0) {
                                {{ (seat.seat_fee / 1000).toFixed(0) }}k
                              } @else {
                                0
                              }
                            </span>
                          </button>
                        }
                      </div>
                    }
                  </div>

                  <!-- Row Number Label Right -->
                  <div class="w-6 text-left font-mono font-bold text-xs text-slate-400">
                    {{ r.row_number }}
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Seat Operational Action Drawer / Panel -->
          <div class="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            @if (activeSeat()) {
              <div>
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-navy text-gold flex items-center justify-center font-mono font-black text-sm">
                      {{ activeSeat()?.seat_code }}
                    </span>
                    <div>
                      <h3 class="font-bold text-navy text-sm">
                        {{ lang.isVietnamese() ? 'Chi tiết Ghế' : 'Seat Details' }} {{ activeSeat()?.seat_code }}
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        {{ activeSeat()?.cabin_class }} • {{ activeSeat()?.position }}
                      </p>
                    </div>
                  </div>

                  <span
                    class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase"
                    [ngClass]="{
                      'bg-emerald-100 text-emerald-800': activeSeat()?.status === 'AVAILABLE',
                      'bg-slate-100 text-slate-700': activeSeat()?.status === 'OCCUPIED',
                      'bg-amber-100 text-amber-800': activeSeat()?.status === 'HELD',
                      'bg-rose-100 text-rose-800': activeSeat()?.status === 'BLOCKED'
                    }"
                  >
                    {{ activeSeat()?.status }}
                  </span>
                </div>

                <!-- Seat Attributes Snapshot -->
                <div class="mt-4 p-3 bg-slate-50 rounded-xl space-y-2 text-xs">
                  <div class="flex justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Hạng ghế:' : 'Cabin Class:' }}</span>
                    <span class="font-bold text-slate-800">{{ activeSeat()?.cabin_class }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Vị trí:' : 'Position:' }}</span>
                    <span class="font-bold text-slate-800">{{ activeSeat()?.position }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-slate-500">{{ lang.isVietnamese() ? 'Phí hiện hành:' : 'Current Fee:' }}</span>
                    <span class="font-mono font-bold text-amber-600">{{ activeSeat()?.seat_fee | number }} VND</span>
                  </div>
                  @if (activeSeat()?.pricing_dimensions?.length) {
                    <div class="pt-1 border-t border-slate-200/60">
                      <span class="text-slate-500 block mb-1">{{ lang.isVietnamese() ? 'Thành phần giá áp dụng:' : 'Applied Pricing Dimensions:' }}</span>
                      <div class="flex flex-wrap gap-1">
                        @for (dim of activeSeat()?.pricing_dimensions; track dim) {
                          <span class="px-2 py-0.5 rounded bg-navy/10 text-navy font-mono text-[10px] font-bold">
                            {{ dim }}
                          </span>
                        }
                      </div>
                    </div>
                  }
                  @if (activeSeat()?.staff_block_reason) {
                    <div class="pt-1 border-t border-slate-200/60 text-rose-600 font-semibold">
                      {{ lang.isVietnamese() ? 'Lý do khóa:' : 'Block Reason:' }} {{ activeSeat()?.staff_block_reason }}
                    </div>
                  }
                </div>

                <!-- ACTIONS -->
                <div class="mt-6 space-y-4">
                  <!-- ACTION 1: UNBLOCK (if blocked) -->
                  @if (activeSeat()?.status === 'BLOCKED') {
                    <div class="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
                      <div class="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                        <app-icon name="lock" class="w-4 h-4 text-rose-600" />
                        <span>{{ lang.isVietnamese() ? 'Ghế đang bị khóa' : 'Seat is Currently Blocked' }}</span>
                      </div>
                      <p class="text-[11px] text-rose-700">
                        {{ lang.isVietnamese()
                          ? 'Mở khóa ghế này để đưa lại vào danh mục ghế khả dụng cho hành khách.'
                          : 'Unblock this seat to return it to the bookable inventory.' }}
                      </p>
                      <button
                        type="button"
                        (click)="executeUnblock()"
                        [disabled]="actionLoading()"
                        class="w-full btn-luxury text-xs !py-2.5 !px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-full"
                      >
                        <app-icon name="checkcircle2" class="w-4 h-4" />
                        <span>{{ lang.isVietnamese() ? 'Mở Khóa Ghế Này' : 'Unblock Seat' }}</span>
                      </button>
                    </div>
                  }

                  <!-- ACTION 2: BLOCK SEAT (if available) -->
                  @if (activeSeat()?.status === 'AVAILABLE') {
                    <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                      <div class="text-xs font-bold text-navy flex items-center gap-1.5">
                        <app-icon name="lock" class="w-4 h-4 text-slate-700" />
                        <span>{{ lang.isVietnamese() ? 'Khóa Ghế (Vận hành / Bảo trì)' : 'Staff Block Seat' }}</span>
                      </div>

                      <div class="space-y-2">
                        <div>
                          <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                            {{ lang.isVietnamese() ? 'Lý do khóa:' : 'Block Reason:' }}
                          </label>
                          <select
                            [(ngModel)]="blockReason"
                            class="w-full text-xs rounded-xl border border-slate-300 py-2 px-2.5 bg-white font-medium"
                          >
                            <option value="BLOCKED_MAINTENANCE">{{ lang.isVietnamese() ? 'Bảo trì / Hỏng hóc (BLOCKED_MAINTENANCE)' : 'Inoperable / Maintenance (BLOCKED_MAINTENANCE)' }}</option>
                            <option value="CREW_REST">{{ lang.isVietnamese() ? 'Chỗ nghỉ phi hành đoàn (CREW_REST)' : 'Crew Rest Space (CREW_REST)' }}</option>
                            <option value="VIP_HOLD">{{ lang.isVietnamese() ? 'Giữ chỗ đặc biệt / VIP (VIP_HOLD)' : 'VIP / Special Hold (VIP_HOLD)' }}</option>
                          </select>
                        </div>

                        <div>
                          <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                            {{ lang.isVietnamese() ? 'Ghi chú thêm:' : 'Optional Notes:' }}
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="blockNotes"
                            [placeholder]="lang.isVietnamese() ? 'VD: Lỗi ngả ghế, dành cho cơ trưởng...' : 'e.g., Broken recline, captain hold...'"
                            class="w-full text-xs rounded-xl border border-slate-300 py-2 px-2.5 bg-white"
                          />
                        </div>

                        <button
                          type="button"
                          (click)="executeBlock()"
                          [disabled]="actionLoading()"
                          class="w-full btn-luxury text-xs !py-2.5 !px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-full"
                        >
                          <app-icon name="lock" class="w-4 h-4" />
                          <span>{{ lang.isVietnamese() ? 'Khóa Ghế Ngay' : 'Confirm Block' }}</span>
                        </button>
                      </div>
                    </div>

                    <!-- ACTION 3: SET PRICE OVERRIDE -->
                    <div class="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-3">
                      <div class="text-xs font-bold text-navy flex items-center gap-1.5">
                        <app-icon name="tag" class="w-4 h-4 text-amber-600" />
                        <span>{{ lang.isVietnamese() ? 'Điều Chỉnh Giá Ghế Riêng (Override)' : 'Flight-Level Seat Fee Override' }}</span>
                      </div>

                      <div class="space-y-2">
                        <div>
                          <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                            {{ lang.isVietnamese() ? 'Phí mới (VND):' : 'Override Fee (VND):' }}
                          </label>
                          <input
                            type="number"
                            [(ngModel)]="overrideFee"
                            step="10000"
                            min="0"
                            class="w-full text-xs rounded-xl border border-slate-300 py-2 px-2.5 bg-white font-mono"
                          />
                        </div>

                        <div>
                          <label class="block text-[11px] font-semibold text-slate-600 mb-1">
                            {{ lang.isVietnamese() ? 'Lý do điều chỉnh giá:' : 'Override Reason:' }}
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="overrideReason"
                            [placeholder]="lang.isVietnamese() ? 'VD: Chương trình ưu đãi, ghế hot dịp lễ...' : 'e.g., Holiday promo, high demand seat...'"
                            class="w-full text-xs rounded-xl border border-slate-300 py-2 px-2.5 bg-white"
                          />
                        </div>

                        <div class="flex gap-2 pt-1">
                          <button
                            type="button"
                            (click)="executePriceOverride()"
                            [disabled]="actionLoading()"
                            class="flex-1 btn-gold text-xs !py-2.5 !px-3 font-bold"
                          >
                            <app-icon name="check" class="w-4 h-4" />
                            <span>{{ lang.isVietnamese() ? 'Lưu Giá Mới' : 'Apply Override' }}</span>
                          </button>

                          <button
                            type="button"
                            (click)="executeRemoveOverride()"
                            [disabled]="actionLoading()"
                            class="btn-outline-navy text-xs !py-2.5 !px-3 font-semibold"
                            [title]="lang.isVietnamese() ? 'Xóa giá điều chỉnh, hoàn về quy tắc mặc định' : 'Revert to dynamic rules'"
                          >
                            <app-icon name="trash2" class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  }

                  <!-- ACTION 4: OCCUPIED SEAT NOTICE -->
                  @if (activeSeat()?.status === 'OCCUPIED' || activeSeat()?.status === 'HELD') {
                    <div class="p-4 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                      <div class="font-bold text-slate-800 flex items-center gap-1.5">
                        <app-icon name="info" class="w-4 h-4 text-slate-500" />
                        <span>{{ lang.isVietnamese() ? 'Ghế đã được hành khách đặt' : 'Seat Reserved by Passenger' }}</span>
                      </div>
                      <p class="text-[11px] text-slate-500 leading-relaxed">
                        {{ lang.isVietnamese()
                          ? 'Ghế này đã gắn liền với vé đặt của hành khách. Để đổi ghế, vui lòng xử lý qua Bàn Đặt Chỗ (Reservation Desk) hoặc Đổi Vé (Reschedule).'
                          : 'This seat is attached to a passenger booking coupon. To adjust, use Reservation Desk or the Reschedule workflow.' }}
                      </p>
                    </div>
                  }
                </div>
              </div>
            } @else {
              <div class="text-center py-12 text-slate-400 space-y-2">
                <app-icon name="armchair" class="w-10 h-10 mx-auto text-slate-300" />
                <p class="text-xs font-semibold">
                  {{ lang.isVietnamese() ? 'Chọn một ghế trên sơ đồ để quản lý' : 'Click a seat on the map to inspect or block' }}
                </p>
              </div>
            }
          </div>
        </div>
      } @else if (loadingMap()) {
        <div class="text-center py-16 bg-white rounded-3xl border border-slate-200">
          <app-icon name="refreshcw" class="w-8 h-8 animate-spin mx-auto text-gold mb-3" />
          <p class="text-xs text-slate-500">{{ lang.isVietnamese() ? 'Đang tải sơ đồ ghế...' : 'Loading seat layout...' }}</p>
        </div>
      }
    </div>
  `,
})
export class SeatOperationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly flights = signal<Flight[]>([]);
  readonly selectedFlightId = signal<string>('');
  readonly selectedFlight = signal<Flight | null>(null);
  readonly seatMap = signal<EnrichedSeatMap | null>(null);
  readonly loadingMap = signal<boolean>(false);
  readonly actionLoading = signal<boolean>(false);

  manualFlightId = '';

  // Active seat action panel
  readonly activeSeat = signal<EnrichedSeatItem | null>(null);
  readonly activeRow = signal<EnrichedSeatRow | null>(null);

  // Block form
  blockReason = 'BLOCKED_MAINTENANCE';
  blockNotes = '';

  // Price override form
  overrideFee = 0;
  overrideReason = '';

  ngOnInit(): void {
    this.loadUpcomingFlights();
  }

  loadUpcomingFlights(): void {
    this.api.getFlights().subscribe({
      next: (list) => {
        this.flights.set(list || []);
        if (list?.length > 0 && !this.selectedFlightId()) {
          this.onFlightSelected(list[0]._id);
        }
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to fetch flights');
      },
    });
  }

  onFlightSelected(flightId: string): void {
    this.selectedFlightId.set(flightId);
    const flight = this.flights().find((f) => f._id === flightId) || null;
    this.selectedFlight.set(flight);
    this.activeSeat.set(null);
    if (flightId) {
      this.loadSeatMap();
    } else {
      this.seatMap.set(null);
    }
  }

  loadManualFlight(): void {
    if (!this.manualFlightId.trim()) return;
    const fId = this.manualFlightId.trim();
    this.selectedFlightId.set(fId);
    this.api.getFlightById(fId).subscribe({
      next: (flight) => {
        this.selectedFlight.set(flight);
        this.loadSeatMap();
      },
      error: () => {
        // Still attempt to load seat map with default aircraft
        this.selectedFlight.set(null);
        this.loadSeatMap();
      },
    });
  }

  loadSeatMap(): void {
    const flightId = this.selectedFlightId();
    if (!flightId) return;

    this.loadingMap.set(true);
    const aircraftType = this.selectedFlight()?.aircraft?.model_code || 'A20N';

    this.api.getEnrichedSeatMap(flightId, aircraftType).subscribe({
      next: (map) => {
        this.seatMap.set(map);
        this.loadingMap.set(false);
        // Refresh active seat if still selected
        if (this.activeSeat()) {
          const currentCode = this.activeSeat()!.seat_code;
          for (const r of map.rows) {
            for (const grp of r.column_groups) {
              const match = grp.find((s: EnrichedSeatItem) => s.seat_code === currentCode);
              if (match) {
                this.activeSeat.set(match);
                break;
              }
            }
          }
        }
      },
      error: (err) => {
        this.loadingMap.set(false);
        this.toast.error(err?.error?.message || 'Failed to load seat map');
      },
    });
  }

  selectSeatForAction(seat: EnrichedSeatItem, row: EnrichedSeatRow): void {
    this.activeSeat.set(seat);
    this.activeRow.set(row);
    this.overrideFee = seat.seat_fee || 0;
    this.overrideReason = '';
    this.blockNotes = '';
  }

  executeBlock(): void {
    const seat = this.activeSeat();
    const flightId = this.selectedFlightId();
    if (!seat || !flightId) return;

    this.actionLoading.set(true);
    const aircraftType = this.seatMap()?.aircraft_type || 'A20N';

    this.api.blockSeat(flightId, {
      seat_code: seat.seat_code,
      reason: this.blockReason,
      aircraft_type: aircraftType,
      notes: this.blockNotes,
    }).subscribe({
      next: () => {
        this.actionLoading.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Đã khóa ghế ${seat.seat_code} thành công!`
            : `Seat ${seat.seat_code} blocked successfully!`
        );
        this.loadSeatMap();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(err?.error?.message || 'Failed to block seat');
      },
    });
  }

  executeUnblock(): void {
    const seat = this.activeSeat();
    const flightId = this.selectedFlightId();
    if (!seat || !flightId) return;

    this.actionLoading.set(true);
    this.api.unblockSeat(flightId, seat.seat_code).subscribe({
      next: () => {
        this.actionLoading.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Đã mở khóa ghế ${seat.seat_code} thành công!`
            : `Seat ${seat.seat_code} unblocked successfully!`
        );
        this.loadSeatMap();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(err?.error?.message || 'Failed to unblock seat');
      },
    });
  }

  executePriceOverride(): void {
    const seat = this.activeSeat();
    const flightId = this.selectedFlightId();
    if (!seat || !flightId) return;

    if (this.overrideFee < 0) {
      this.toast.error('Override fee cannot be negative');
      return;
    }

    if (!this.overrideReason.trim()) {
      this.toast.error(
        this.lang.isVietnamese()
          ? 'Vui lòng nhập lý do điều chỉnh giá'
          : 'Please enter an override reason'
      );
      return;
    }

    this.actionLoading.set(true);
    this.api.setSeatPriceOverride(flightId, {
      seat_code: seat.seat_code,
      override_fee: this.overrideFee,
      reason: this.overrideReason.trim(),
    }).subscribe({
      next: () => {
        this.actionLoading.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Đã thiết lập giá riêng cho ghế ${seat.seat_code}!`
            : `Custom price override set for seat ${seat.seat_code}!`
        );
        this.loadSeatMap();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(err?.error?.message || 'Failed to set price override');
      },
    });
  }

  executeRemoveOverride(): void {
    const seat = this.activeSeat();
    const flightId = this.selectedFlightId();
    if (!seat || !flightId) return;

    this.actionLoading.set(true);
    this.api.removeSeatPriceOverride(flightId, seat.seat_code).subscribe({
      next: () => {
        this.actionLoading.set(false);
        this.toast.success(
          this.lang.isVietnamese()
            ? `Đã xóa giá riêng cho ghế ${seat.seat_code}!`
            : `Price override removed for seat ${seat.seat_code}!`
        );
        this.loadSeatMap();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(err?.error?.message || 'Failed to remove price override');
      },
    });
  }

  getSeatClasses(seat: EnrichedSeatItem, row: EnrichedSeatRow): string {
    const isSelected = this.activeSeat()?.seat_code === seat.seat_code;
    const baseBorder = isSelected ? 'ring-2 ring-navy ring-offset-2 scale-105 z-10' : '';

    if (seat.status === 'BLOCKED') {
      return `bg-rose-500 hover:bg-rose-600 text-white border border-rose-600 ${baseBorder}`;
    }
    if (seat.status === 'OCCUPIED') {
      return `bg-slate-300 text-slate-500 border border-slate-300 opacity-80 ${baseBorder}`;
    }
    if (seat.status === 'HELD') {
      return `bg-amber-400 hover:bg-amber-500 text-navy border border-amber-500 ${baseBorder}`;
    }
    if (row.cabin_class === 'BUSINESS') {
      return `bg-amber-500 hover:bg-amber-600 text-white shadow-sm border border-amber-600 ${baseBorder}`;
    }
    if (row.is_exit_row) {
      return `bg-sky-600 hover:bg-sky-700 text-white shadow-sm border border-sky-700 ${baseBorder}`;
    }
    return `bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm border border-emerald-600 ${baseBorder}`;
  }

  getSeatTooltip(seat: EnrichedSeatItem, row: EnrichedSeatRow): string {
    return `${seat.seat_code} | ${seat.status} | ${seat.cabin_class} | ${seat.seat_fee?.toLocaleString()} VND`;
  }
}
