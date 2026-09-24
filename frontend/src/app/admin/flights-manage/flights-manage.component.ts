import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatPipe } from '../../shared/pipes/currency-format.pipe';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { Flight, FlightStatus, CabinClass } from '../../core/models/flight.model';
import { Airport } from '../../core/models/airport.model';
import {
  isValidIanaTimeZone,
  utcToWallTime,
  extractWallDate,
  wallTimeToUtc,
  computePhysicalDurationMinutes,
  getTimezoneGmtOffset,
  getTimezoneOffsetMinutes,
} from '../../core/utils/timezone.util';

/** Giá trị mặc định của form tạo/sửa chuyến bay (reset lại mỗi lần mở modal). */
const FLIGHT_FORM_DEFAULTS = {
  econPrice: 1250000,
  econSeats: 150,
  busPrice: 3800000,
  busSeats: 24,
  distanceMiles: 710,
};

@Component({
  selector: 'app-flights-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent, CurrencyFormatPipe, PaginationComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.flights') }}</h1>
          <p class="text-xs text-slate-500">{{ lang.isVietnamese() ? 'Quản lý lịch bay, giá vé, cấu hình hạng ghế và cập nhật trạng thái thời tiết khẩn cấp.' : 'Manage flight schedules, fares, cabin classes, and update emergency weather status.' }}</p>
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            (click)="openCreateModal()"
            class="btn-gold text-xs !py-2.5 !px-5 font-bold"
          >
            <app-icon name="plus" class="w-4 h-4" />
            <span>{{ lang.t('admin.addFlight') }}</span>
          </button>
        </div>
      </div>

      <!-- Filters Row -->
      <div class="card-luxury p-4 border-slate-200 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">{{ lang.t('common.status') }}:</label>
          <select
            [(ngModel)]="filterStatus"
            (change)="loadFlights(true)"
            class="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
          >
            <option value="">{{ lang.isVietnamese() ? 'Tất cả' : 'All' }}</option>
            <option [value]="FlightStatus.SCHEDULED">SCHEDULED ({{ lang.t('status.scheduled') }})</option>
            <option [value]="FlightStatus.DELAYED">DELAYED ({{ lang.t('status.delayed') }})</option>
            <option [value]="FlightStatus.CANCELLED">CANCELLED ({{ lang.t('status.cancelled') }})</option>
            <option [value]="FlightStatus.COMPLETED">COMPLETED ({{ lang.t('status.completed') }})</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">{{ lang.t('search.from') }}:</label>
          <input
            type="text"
            [(ngModel)]="filterOrigin"
            (keyup.enter)="loadFlights(true)"
            placeholder="HAN, SGN..."
            class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
          />
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-slate-600">{{ lang.t('search.to') }}:</label>
          <input
            type="text"
            [(ngModel)]="filterDest"
            (keyup.enter)="loadFlights(true)"
            placeholder="SGN, DAD..."
            class="w-24 uppercase px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
          />
        </div>

        <button
          (click)="loadFlights(true)"
          class="btn-navy text-xs !py-1.5 !px-3"
        >
          {{ lang.isVietnamese() ? 'Lọc' : 'Filter' }}
        </button>

        @if (flights().length) {
          <span class="text-[11px] text-slate-400 font-medium ml-auto">
            {{ displayedRangeText }}
          </span>
        }
      </div>

      <!-- Flights Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">{{ lang.t('admin.dashboard.flightNumber') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.dashboard.route') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.flights.colProvenance') }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Ngày bay' : 'Flight Date' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Giờ cất cánh' : 'Departure Time' }}</th>
                <th class="py-3.5 px-4">{{ lang.isVietnamese() ? 'Hạng vé & Giá' : 'Cabin & Fare' }}</th>
                <th class="py-3.5 px-4">{{ lang.t('common.status') }}</th>
                <th class="py-3.5 px-4 text-right">{{ lang.t('common.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="8" class="text-center py-12 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.isVietnamese() ? 'Đang tải dữ liệu chuyến bay...' : 'Loading flights data...' }}
                  </td>
                </tr>
              } @else if (!flights().length) {
                <tr>
                  <td colspan="8" class="text-center py-12 text-slate-400">
                    {{ lang.isVietnamese() ? 'Không tìm thấy chuyến bay nào phù hợp.' : 'No matching flights found.' }}
                  </td>
                </tr>
              } @else {
                @for (fl of pagedFlights(); track fl._id) {
                  <tr class="hover:bg-slate-50/80 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy text-sm">
                      {{ fl.flight_number }}
                    </td>
                    <td class="py-3.5 px-4">
                      <div class="flex items-center gap-1.5 font-bold text-slate-800">
                        <span>{{ fl.origin_iata }}</span>
                        <app-icon name="arrowright" class="w-3.5 h-3.5 text-slate-400" />
                        <span>{{ fl.dest_iata }}</span>
                      </div>
                      <span class="text-[10px] text-slate-400">{{ formatAircraftDisplay(fl.aircraft) }}</span>
                      <span class="text-[10px] text-slate-400 block">{{ fl.duration_minutes }} {{ lang.t('lookup.min') }} • {{ fl.distance_miles }} {{ lang.t('nav.miles') }}</span>
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap"
                        [ngClass]="getProvenanceBadgeClass(fl)"
                      >
                        {{ getProvenanceLabel(fl) }}
                      </span>
                      @if (fl.operator) {
                        <span class="text-[10px] text-slate-400 block mt-0.5 font-mono">{{ fl.operator }}</span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-slate-600">
                      {{ fl.departure_date | date: 'dd/MM/yyyy' }}
                    </td>
                    <td class="py-3.5 px-4 text-slate-700">
                      {{ fl.scheduled_departure | date: 'HH:mm' }} &rarr; {{ fl.scheduled_arrival | date: 'HH:mm' }}
                    </td>
                    <td class="py-3.5 px-4">
                      <div class="space-y-1">
                        @for (inv of fl.inventories; track inv._id || inv.cabin_class) {
                          <div class="flex items-center gap-1.5 text-[11px]">
                            <span class="font-bold text-slate-600 w-16">{{ inv.cabin_class }}:</span>
                            <span class="text-amber-600 font-mono font-bold">{{ inv.base_price | currencyFormat }}</span>
                            <span class="text-slate-400">({{ inv.available_seats }}/{{ inv.allocated_seats }} {{ lang.t('seatmap.seatsCount') }})</span>
                          </div>
                        }
                      </div>
                    </td>
                    <td class="py-3.5 px-4">
                      <span
                        class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider block text-center"
                        [ngClass]="statusBadgeClass(fl.status)"
                      >
                        {{ statusLabel(fl.status) }}
                      </span>
                      @if (fl.delay_reason || fl.delay_minutes) {
                        <span class="text-[10px] text-rose-600 block mt-1 font-medium truncate max-w-[140px]" [title]="delayText(fl.delay_reason, fl.delay_minutes)">
                          {{ delayText(fl.delay_reason, fl.delay_minutes) }}
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <!-- Edit Flight Button -->
                        <button
                          type="button"
                          (click)="openEditModal(fl)"
                          class="p-1.5 bg-slate-50 hover:bg-slate-100 text-navy rounded-full border border-slate-200 transition-colors"
                          [title]="lang.isVietnamese() ? 'Sửa chuyến bay' : 'Edit flight'"
                        >
                          <app-icon name="edit" class="w-4 h-4" />
                        </button>

                        <!-- Emergency Status Override Button -->
                        <button
                          type="button"
                          (click)="openEmergencyStatusModal(fl)"
                          class="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-full border border-amber-300 transition-colors"
                          [title]="lang.isVietnamese() ? 'Cập nhật Thời tiết / Trạng thái khẩn cấp' : 'Update Weather / Emergency Status'"
                        >
                          <app-icon name="alerttriangle" class="w-4 h-4" />
                        </button>

                        <!-- Delete Flight Button -->
                        <button
                          type="button"
                          (click)="deleteFlight(fl)"
                          class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-full border border-rose-200 transition-colors"
                          [title]="lang.isVietnamese() ? 'Xóa chuyến bay' : 'Delete flight'"
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

        @if (flights().length) {
          <app-pagination
            [total]="flights().length"
            [page]="page"
            [pageSize]="pageSize"
            (pageChange)="page = $event"
            (pageSizeChange)="onPageSize($event)"
          />
        }
      </div>

    </div>

    <!-- Modal: Emergency Status Update -->
    @if (showStatusModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="alerttriangle" class="w-5 h-5 text-amber-500" />
              <span>{{ lang.isVietnamese() ? 'Cập nhật Khẩn cấp: ' : 'Emergency Update: ' }}{{ activeFlight()?.flight_number }}</span>
            </h3>
            <button (click)="showStatusModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <div class="space-y-4 text-xs">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Trạng thái mới' : 'New Status' }}</label>
              <select
                [(ngModel)]="newStatus"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:ring-2 focus:ring-gold"
              >
                <option [value]="FlightStatus.SCHEDULED">SCHEDULED ({{ lang.isVietnamese() ? 'Theo lịch bay' : 'Scheduled' }})</option>
                <option [value]="FlightStatus.DELAYED">DELAYED ({{ lang.isVietnamese() ? 'Hoãn chuyến do thời tiết/kỹ thuật' : 'Delayed due to weather/technical' }})</option>
                <option [value]="FlightStatus.CANCELLED">CANCELLED ({{ lang.isVietnamese() ? 'Hủy chuyến khẩn cấp do bão' : 'Cancelled due to storm emergency' }})</option>
                <option [value]="FlightStatus.COMPLETED">COMPLETED ({{ lang.isVietnamese() ? 'Đã hoàn thành / hạ cánh' : 'Completed / Arrived' }})</option>
              </select>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Lý do hoãn / hủy (Hiển thị cho khách hàng)' : 'Delay / Cancellation Reason (Shown to passengers)' }}</label>
              <textarea
                [(ngModel)]="newDelayReason"
                rows="3"
                [placeholder]="lang.isVietnamese() ? 'VD: Do bão số 4 gây mưa to gió lớn tại sân bay Nội Bài, chuyến bay tạm hoãn 120 phút...' : 'E.g.: Due to severe weather at Noi Bai airport, flight is delayed by 120 minutes...'"
                class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gold"
              ></textarea>
              <p class="text-[11px] text-slate-400 mt-1">
                {{ lang.isVietnamese() ? 'Bắt buộc khi chọn DELAYED/CANCELLED. Khi đưa chuyến bay về SCHEDULED, lý do cũ sẽ được xoá.' : 'Required when choosing DELAYED/CANCELLED. Reverting to SCHEDULED clears previous reason.' }}
              </p>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6 pt-3 border-t border-slate-100">
            <button (click)="showStatusModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
            <button
              [disabled]="submitting()"
              (click)="saveFlightStatus()"
              class="btn-gold text-xs !py-2.5 !px-5 font-bold"
            >
              @if (submitting()) {
                <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
              }
              <span>{{ lang.isVietnamese() ? 'Lưu trạng thái' : 'Save Status' }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Create / Edit Flight -->
    @if (showFlightModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div class="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-6 border border-slate-200 my-auto">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="plane" class="w-5 h-5 text-gold" />
              <span>{{ editingId() ? (lang.isVietnamese() ? 'Sửa Chuyến Bay' : 'Edit Flight') : (lang.isVietnamese() ? 'Thêm Chuyến Bay Mới' : 'Add New Flight') }}</span>
            </h3>
            <button (click)="showFlightModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveFlightForm()" class="space-y-4 text-xs">
            @if (editingFlight()?.data_source === 'AIRLABS_COMMERCIALIZED') {
              <!-- Commercial Flight Summary Card -->
              <div class="p-4 bg-emerald-50/80 border border-emerald-300 rounded-2xl space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-600 text-white tracking-wider">
                      {{ lang.t('admin.flights.commercialScheduleBadge') }}
                    </span>
                    <strong class="font-mono text-sm font-black text-navy">{{ editingFlight()?.flight_number }}</strong>
                  </div>
                  <a
                    routerLink="/admin/commercial-flights"
                    (click)="showFlightModal.set(false)"
                    class="btn-navy text-[11px] !py-1 !px-3 font-bold inline-flex items-center gap-1.5"
                  >
                    <app-icon name="planetakeoff" class="w-3.5 h-3.5" />
                    <span>{{ lang.t('admin.flights.openCommercialFlights') }}</span>
                  </a>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200/60 text-[11px]">
                  <div>
                    <span class="text-slate-500 block">{{ lang.t('admin.dashboard.route') }}</span>
                    <strong class="text-slate-800 font-bold">{{ editingFlight()?.origin_iata }} &rarr; {{ editingFlight()?.dest_iata }}</strong>
                  </div>
                  <div>
                    <span class="text-slate-500 block">{{ lang.t('admin.flights.flightDateLabel') }}</span>
                    <strong class="text-slate-800 font-bold">{{ newFlight.departure_date }}</strong>
                  </div>
                  <div class="sm:col-span-2">
                    <span class="text-slate-500 block">{{ lang.t('admin.dashboard.aircraft') }}</span>
                    <strong class="text-slate-800 font-bold">{{ formatAircraftDisplay(editingFlight()?.aircraft) }}</strong>
                  </div>
                </div>
                <p class="text-[10px] text-emerald-800 leading-relaxed pt-1">
                  {{ lang.t('admin.flights.commercialSyncDesc') }}
                </p>
              </div>
            } @else if (!editingId()) {
              <div class="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                <app-icon name="alerttriangle" class="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div class="space-y-1 text-slate-700 flex-1">
                  <h4 class="font-bold text-amber-900 text-xs">
                    {{ lang.t('admin.flights.manualWarningTitle') }}
                  </h4>
                  <p class="text-[11px] leading-relaxed text-amber-800">
                    {{ lang.t('admin.flights.manualWarningDesc') }}
                  </p>
                  <p class="text-[11px] leading-relaxed text-slate-600">
                    {{ lang.t('admin.flights.customerInvariantNotice') }}
                  </p>
                  <div class="pt-1.5">
                    <a
                      routerLink="/admin/commercial-flights"
                      (click)="showFlightModal.set(false)"
                      class="btn-navy text-xs !py-1.5 !px-4 font-bold"
                    >
                      <app-icon name="planetakeoff" class="w-3.5 h-3.5" />
                      <span>{{ lang.t('admin.flights.goToCommercial') }}</span>
                    </a>
                  </div>
                </div>
              </div>
            }

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('lookup.flightNumber') }}</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.flight_number"
                  (ngModelChange)="onFlightNumberChange($event)"
                  name="flight_number"
                  required
                  placeholder="VN-234"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase disabled:opacity-60"
                  [disabled]="!!editingId() && editingFlight()?.data_source === 'AIRLABS_COMMERCIALIZED'"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airlabs.depIata') }}</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.origin_iata"
                  name="origin_iata"
                  required
                  list="iata-list"
                  placeholder="HAN"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase disabled:opacity-60"
                  [disabled]="!!editingId()"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.airlabs.arrIata') }}</label>
                <input
                  type="text"
                  [(ngModel)]="newFlight.dest_iata"
                  name="dest_iata"
                  required
                  list="iata-list"
                  placeholder="SGN"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase disabled:opacity-60"
                  [disabled]="!!editingId()"
                />
              </div>
            </div>

            <datalist id="iata-list">
              @for (ap of airports(); track ap.iata_code) {
                <option [value]="ap.iata_code">{{ ap.city_name }} - {{ ap.airport_name }}</option>
              }
            </datalist>

            <p class="text-[11px] text-slate-400 -mt-1">
              {{ lang.t('admin.flights.iataInputNotice') }}
              @if (editingId()) {
                <span>{{ lang.t('admin.flights.iataNoChangeNotice') }}</span>
              }
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.flights.departureDateInputLabel') }}</label>
                @if (editingFlight()?.data_source === 'AIRLABS_COMMERCIALIZED') {
                  <div class="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-700 font-bold flex items-center justify-between">
                    <span>{{ newFlight.departure_date || '—' }}</span>
                    <span class="text-[10px] text-slate-500 uppercase font-sans font-medium px-2 py-0.5 bg-slate-200/70 rounded-full">{{ lang.isVietnamese() ? 'Tự động từ giờ bay' : 'From dep time' }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-1">
                    {{ lang.isVietnamese() ? 'Ngày khai thác đồng bộ trực tiếp từ giờ cất cánh tại sân bay đi.' : 'Operating date is derived directly from origin departure time.' }}
                  </p>
                } @else {
                  <input
                    type="date"
                    [(ngModel)]="newFlight.departure_date"
                    name="departure_date"
                    required
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                }
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1 flex items-center justify-between">
                  <span>{{ lang.t('admin.flights.depTimeLocal') }}</span>
                  <span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    {{ newFlight.origin_iata || 'DEP' }}: {{ getAirportGmtOffset(newFlight.origin_iata, newFlight.scheduled_departure, editingFlight()?.scheduled_departure) }}
                  </span>
                </label>
                <input
                  type="datetime-local"
                  [(ngModel)]="newFlight.scheduled_departure"
                  (ngModelChange)="syncDepartureDate()"
                  name="scheduled_departure"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
                <span class="text-[10px] text-slate-400 block mt-0.5">{{ getAirportTimeZone(newFlight.origin_iata) || lang.t('admin.flights.timezoneUndefined') }}</span>
              </div>

              <div>
                <label class="block font-semibold text-slate-600 mb-1 flex items-center justify-between">
                  <span>{{ lang.t('admin.flights.arrTimeLocal') }}</span>
                  <span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    {{ newFlight.dest_iata || 'ARR' }}: {{ getAirportGmtOffset(newFlight.dest_iata, newFlight.scheduled_arrival, editingFlight()?.scheduled_arrival) }}
                  </span>
                </label>
                <input
                  type="datetime-local"
                  [(ngModel)]="newFlight.scheduled_arrival"
                  name="scheduled_arrival"
                  required
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
                <span class="text-[10px] text-slate-400 block mt-0.5">{{ getAirportTimeZone(newFlight.dest_iata) || lang.t('admin.flights.timezoneUndefined') }}</span>
              </div>
            </div>

            <!-- Explicit notice that times are local and duration includes timezone diff -->
            <div class="p-2.5 bg-blue-50/70 border border-blue-200 rounded-xl text-[11px] text-blue-800 flex items-start gap-2">
              <app-icon name="info" class="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>{{ lang.t('admin.flights.localTimeNotice') }}</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.flights.computedDurationLabel') }}</label>
                <input
                  type="number"
                  [value]="computedDurationMinutes()"
                  readonly
                  tabindex="-1"
                  class="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-600"
                />
                @if (getDurationHint()) {
                  <p class="text-[11px] text-slate-500 mt-1 font-medium">
                    {{ getDurationHint() }}
                  </p>
                }
              </div>

              <div class="sm:col-span-2">
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Số dặm bay (distance_miles)' : 'Flight Distance (distance_miles)' }}</label>
                @if (editingFlight()?.data_source === 'AIRLABS_COMMERCIALIZED') {
                  <div class="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-700 font-bold flex items-center justify-between">
                    <span>{{ distanceMiles }} miles</span>
                    <span class="text-[10px] text-slate-500 uppercase font-sans font-medium px-2 py-0.5 bg-slate-200/70 rounded-full">{{ lang.isVietnamese() ? 'Cố định' : 'Read-only' }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-1">
                    {{ lang.isVietnamese() ? 'Khoảng cách bay thương mại cố định theo mẫu lịch để tính dặm SkyMiles.' : 'Commercial flight distance is fixed according to template for SkyMiles calculation.' }}
                  </p>
                } @else {
                  <input
                    type="number"
                    [(ngModel)]="distanceMiles"
                    name="distance_miles"
                    required
                    min="0"
                    step="1"
                    placeholder="710"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                  <p class="text-[11px] text-slate-400 mt-1">
                    {{ lang.isVietnamese() ? 'Số dặm bay dùng để tính dặm SkyMiles tích luỹ cho khách (mặc định 710 cho HAN–SGN).' : 'Flight distance is used to calculate SkyMiles earned for passengers (default 710 for HAN-SGN).' }}
                  </p>
                }
              </div>
            </div>

            @if (editingFlight()?.data_source !== 'AIRLABS_COMMERCIALIZED') {
              <div class="grid grid-cols-1 gap-3 pb-2 mt-2">
                <div>
                  <label class="block font-semibold text-slate-600 mb-1">
                    {{ getFleetDropdownLabel() }} ({{ lang.t('admin.dashboard.aircraft') }})
                  </label>
                  <select
                    [(ngModel)]="selectedFleetModel"
                    (change)="onFleetModelChange()"
                    name="fleetModel"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="">-- {{ getFleetDropdownLabel() }} --</option>
                    @for (m of fleetModels(); track m.icao + m.model) {
                      <option [value]="m.icao + '|' + m.model">{{ m.model }} ({{ m.icao }}) - {{ m.count }} {{ lang.isVietnamese() ? 'chiếc' : 'units' }}</option>
                    }
                    <option value="MANUAL">{{ lang.t('admin.flights.manualEntryOption') }}</option>
                  </select>
                </div>
              </div>

              @if (selectedFleetModel === 'MANUAL') {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2 mt-2">
                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.flights.aircraftModelCodeLabel') }}</label>
                    <input
                      type="text"
                      [(ngModel)]="newFlight.aircraft_model_code"
                      name="aircraft_model_code"
                      [placeholder]="lang.isVietnamese() ? 'VD: A321' : 'E.g.: A321'"
                      class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.flights.aircraftModelNameLabel') }}</label>
                    <input
                      type="text"
                      [(ngModel)]="newFlight.aircraft_model_name"
                      name="aircraft_model_name"
                      [placeholder]="lang.isVietnamese() ? 'VD: Airbus A321' : 'E.g.: Airbus A321'"
                      class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
              }
            }

            @if (editingFlight()?.data_source === 'AIRLABS_COMMERCIALIZED') {
              <!-- Read-only Commercial Cabins, Fares & Capacities -->
              <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="font-bold text-navy uppercase text-[11px] flex items-center gap-1.5">
                    <app-icon name="tag" class="w-3.5 h-3.5 text-gold" />
                    <span>{{ lang.t('admin.flights.seatsFaresConfig') }}</span>
                  </h4>
                  <span class="text-[10px] text-slate-500 font-medium px-2 py-0.5 bg-slate-200/60 rounded-full">
                    {{ lang.t('admin.flights.fixedCapacityHint') }}
                  </span>
                </div>

                <!-- Dynamic Grid for ALL Existing Cabins -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  @for (inv of editingFlight()?.inventories || []; track inv._id || inv.cabin_class) {
                    <div class="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-xs">
                      <div class="space-y-1">
                        <span class="inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded border" [ngClass]="getCabinBadgeClass(inv.cabin_class)">
                          {{ getCabinLabel(inv.cabin_class) }}
                        </span>
                        <div class="text-[11px] font-mono text-slate-500">
                          <span class="font-bold text-navy">{{ inv.allocated_seats }}</span> {{ lang.t('seatmap.seatsCount') }}
                          <span class="text-slate-300 mx-1">|</span>
                          <span class="text-emerald-700 font-medium">{{ inv.available_seats }} {{ lang.t('admin.flights.availableSeatsCount') }}</span>
                        </div>
                      </div>
                      <div class="text-right">
                        <span class="text-xs font-mono font-bold text-amber-600 block">{{ inv.base_price | currencyFormat }}</span>
                        <span class="text-[9px] text-slate-400 uppercase font-medium">{{ lang.t('seatmap.baseFare') }}</span>
                      </div>
                    </div>
                  }
                </div>

                <!-- Explanatory text & CTA link to Commercial Templates -->
                <div class="pt-2 border-t border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <p class="text-[11px] text-slate-500 leading-relaxed flex-1">
                    {{ lang.t('admin.flights.commercialManagedNotice') }}
                  </p>
                  <a
                    routerLink="/admin/commercial-flights"
                    (click)="showFlightModal.set(false)"
                    class="btn-navy text-xs !py-1.5 !px-3 font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    <app-icon name="planetakeoff" class="w-3.5 h-3.5 text-gold" />
                    <span>{{ lang.t('admin.flights.manageCommercialTemplates') }}</span>
                  </a>
                </div>
              </div>
            } @else {
              <!-- Regular Manual Flight: Fares & Seats Editable Grid -->
              <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <h4 class="font-bold text-navy uppercase text-[11px]">{{ lang.t('admin.flights.manualSeatsFaresConfig') }}</h4>
                
                <!-- Economy -->
                <div class="grid grid-cols-3 gap-2 items-center">
                  <span class="font-bold text-slate-700">{{ lang.t('search.economy') }}:</span>
                  <input
                    type="number"
                    [(ngModel)]="econPrice"
                    name="econPrice"
                    required
                    min="0"
                    step="1000"
                    [placeholder]="lang.isVietnamese() ? 'Giá vé VND (1200000)' : 'Fare VND (1200000)'"
                    class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    [(ngModel)]="econSeats"
                    name="econSeats"
                    required
                    min="1"
                    step="1"
                    [placeholder]="lang.isVietnamese() ? 'Số ghế (140)' : 'Seat count (140)'"
                    class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                  />
                </div>

                <!-- Business -->
                <div class="grid grid-cols-3 gap-2 items-center">
                  <span class="font-bold text-amber-700">{{ lang.t('search.business') }}:</span>
                  <input
                    type="number"
                    [(ngModel)]="busPrice"
                    name="busPrice"
                    required
                    min="0"
                    step="1000"
                    [placeholder]="lang.isVietnamese() ? 'Giá vé VND (3500000)' : 'Fare VND (3500000)'"
                    class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    [(ngModel)]="busSeats"
                    name="busSeats"
                    required
                    min="1"
                    step="1"
                    [placeholder]="lang.isVietnamese() ? 'Số ghế (20)' : 'Seat count (20)'"
                    class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <p class="text-[11px] text-slate-400">
                  {{ lang.t('admin.flights.manualSeatsFaresHint') }}
                </p>
              </div>
            }

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showFlightModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
              <button
                type="submit"
                [disabled]="submitting()"
                class="btn-gold text-xs !py-2.5 !px-5 font-bold"
              >
                @if (submitting()) {
                  <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                }
                <span>{{ editingId() ? lang.t('admin.flights.saveChangesBtn') : lang.t('admin.flights.createFlightBtn') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class FlightsManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly lang = inject(LanguageService);
  private readonly toast = inject(ToastService);

  readonly flights = signal<Flight[]>([]);
  readonly airports = signal<Airport[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);

  readonly pageSignal = signal(1);
  readonly pageSizeSignal = signal(20);

  get page(): number {
    return this.pageSignal();
  }
  set page(v: number) {
    this.pageSignal.set(v);
  }

  get pageSize(): number {
    return this.pageSizeSignal();
  }
  set pageSize(v: number) {
    this.pageSizeSignal.set(v);
  }

  readonly pagedFlights = computed(() => {
    const list = this.flights();
    const start = (this.pageSignal() - 1) * this.pageSizeSignal();
    return list.slice(start, start + this.pageSizeSignal());
  });

  onPageSize(size: number): void {
    this.pageSize = size;
    const maxPage = Math.max(1, Math.ceil(this.flights().length / size));
    if (this.page > maxPage) {
      this.page = maxPage;
    }
  }

  get displayedRangeText(): string {
    const total = this.flights().length;
    if (!total) return '';
    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(total, this.page * this.pageSize);
    return this.lang.isVietnamese()
      ? `Hiển thị ${start}–${end} / tổng ${total}`
      : `Showing ${start}–${end} of ${total}`;
  }

  FlightStatus = FlightStatus;
  CabinClass = CabinClass;

  filterStatus = '';
  filterOrigin = '';
  filterDest = '';

  // Emergency status modal
  readonly showStatusModal = signal(false);
  readonly activeFlight = signal<Flight | null>(null);
  newStatus: FlightStatus = FlightStatus.DELAYED;
  newDelayReason = '';

  // Create / Edit flight modal
  readonly showFlightModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly editingFlight = signal<Flight | null>(null);
  newFlight: any = {};
  distanceMiles: number = FLIGHT_FORM_DEFAULTS.distanceMiles;
  econPrice: number = FLIGHT_FORM_DEFAULTS.econPrice;
  econSeats: number = FLIGHT_FORM_DEFAULTS.econSeats;
  busPrice: number = FLIGHT_FORM_DEFAULTS.busPrice;
  busSeats: number = FLIGHT_FORM_DEFAULTS.busSeats;

  readonly fleetModels = signal<any[]>([]);
  selectedFleetModel = '';
  readonly currentAirlineCode = signal('VN');

  ngOnInit(): void {
    this.loadFlights();
    this.loadAirports();
  }

  formatAircraftDisplay(aircraft: any): string {
    if (!aircraft || !aircraft.model_name) return this.lang.t('admin.dashboard.unassignedAircraft');
    if (aircraft.registration) {
      return `${aircraft.model_name} (${aircraft.registration})`;
    }
    return aircraft.model_name;
  }

  getProvenanceLabel(fl: Flight): string {
    if (fl.data_source === 'AIRLABS_COMMERCIALIZED') {
      return this.lang.t('admin.flights.badgeCommercial');
    }
    if (fl.data_source === 'AIRLABS_EXTERNAL') {
      return this.lang.t('admin.flights.badgeExternal');
    }
    if (fl.data_source === 'INTERNAL_GENERATED' && fl.is_generated === true && fl.generated_source === 'seed_schedule_330') {
      return this.lang.t('admin.flights.badgeLegacy');
    }
    if (fl.data_source === 'INTERNAL_GENERATED' && fl.is_generated !== true) {
      return this.lang.t('admin.flights.badgeManual');
    }
    return this.lang.t('admin.flights.badgeUnknown');
  }

  getProvenanceBadgeClass(fl: Flight): string {
    if (fl.data_source === 'AIRLABS_COMMERCIALIZED') {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (fl.data_source === 'AIRLABS_EXTERNAL') {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    if (fl.data_source === 'INTERNAL_GENERATED' && fl.is_generated === true && fl.generated_source === 'seed_schedule_330') {
      return 'bg-slate-100 text-slate-600 border-slate-200';
    }
    if (fl.data_source === 'INTERNAL_GENERATED' && fl.is_generated !== true) {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
    return 'bg-slate-100 text-slate-500 border-slate-200';
  }

  getCabinLabel(cabin: string): string {
    const c = (cabin || '').toUpperCase();
    if (c === 'ECONOMY') return this.lang.isVietnamese() ? 'Phổ thông' : 'Economy';
    if (c === 'BUSINESS') return this.lang.isVietnamese() ? 'Thương gia' : 'Business';
    if (c === 'FIRST') return this.lang.isVietnamese() ? 'Hạng nhất' : 'First Class';
    if (c === 'CLUB') return this.lang.isVietnamese() ? 'Hạng Club' : 'Club Class';
    return c;
  }

  getCabinBadgeClass(cabin: string): string {
    const c = (cabin || '').toUpperCase();
    if (c === 'BUSINESS') return 'border-amber-200 bg-amber-50 text-amber-800';
    if (c === 'FIRST') return 'border-purple-200 bg-purple-50 text-purple-800';
    if (c === 'CLUB') return 'border-sky-200 bg-sky-50 text-sky-800';
    return 'border-slate-200 bg-slate-50 text-slate-700';
  }

  delayText(reason?: string | null, minutes?: number | null): string {
    const mins = minutes && minutes > 0 ? minutes : Number((reason || '').match(/trễ\s+(\d+)\s+phút/i)?.[1] || 0);
    if (mins > 0) return this.lang.t('track.delayMinutes').replace('{n}', String(mins));
    return reason || '';
  }

  onFleetModelChange(): void {
    if (this.selectedFleetModel && this.selectedFleetModel !== 'MANUAL') {
      const [icao, model] = this.selectedFleetModel.split('|');
      this.newFlight.aircraft_model_code = icao;
      this.newFlight.aircraft_model_name = model;
    } else {
      this.newFlight.aircraft_model_code = '';
      this.newFlight.aircraft_model_name = '';
    }
  }

  loadFlights(resetPage = true): void {
    if (resetPage) {
      this.page = 1;
    }
    this.loading.set(true);
    this.api
      .getFlights({
        status: (this.filterStatus as FlightStatus) || undefined,
        origin: this.filterOrigin || undefined,
        dest: this.filterDest || undefined,
      })
      .subscribe({
        next: (list) => {
          this.flights.set(list || []);
          const maxPage = Math.max(1, Math.ceil((list?.length || 0) / this.pageSize));
          if (this.page > maxPage) {
            this.page = maxPage;
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(this.describeError(err, this.lang.t('admin.dashboard.loadFlightsError')));
        },
      });
  }

  /** Danh sách IATA chỉ là gợi ý cho input, lỗi tải không cần chặn màn hình. */
  loadAirports(): void {
    this.api.getAirports().subscribe({
      next: (list) => this.airports.set(list || []),
      error: () => this.airports.set([]),
    });
  }

  /** Class Tailwind cho badge trạng thái (chỉ 4 giá trị enum của backend). */
  statusBadgeClass(status: FlightStatus | string): string {
    switch (status) {
      case FlightStatus.SCHEDULED:
        return 'bg-emerald-100 text-emerald-800 border border-emerald-300';
      case FlightStatus.DELAYED:
        return 'bg-amber-100 text-amber-800 border border-amber-300';
      case FlightStatus.CANCELLED:
        return 'bg-rose-100 text-rose-800 border border-rose-300';
      case FlightStatus.COMPLETED:
        return 'bg-blue-100 text-blue-800 border border-blue-300';
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200';
    }
  }

  /** Nhãn đa ngôn ngữ cho trạng thái chuyến bay */
  statusLabel(status?: string): string {
    switch (status) {
      case FlightStatus.SCHEDULED:
        return this.lang.t('status.scheduled');
      case FlightStatus.DELAYED:
        return this.lang.t('status.delayed');
      case FlightStatus.CANCELLED:
        return this.lang.t('status.cancelled');
      case FlightStatus.COMPLETED:
        return this.lang.t('status.completed');
      default:
        return status || '—';
    }
  }

  openEmergencyStatusModal(fl: Flight): void {
    this.activeFlight.set(fl);
    this.newStatus = fl.status;
    this.newDelayReason = fl.delay_reason || '';
    this.showStatusModal.set(true);
  }

  saveFlightStatus(): void {
    const fl = this.activeFlight();
    if (!fl) return;

    const status = this.newStatus;
    const needsReason = status === FlightStatus.DELAYED || status === FlightStatus.CANCELLED;
    if (needsReason && !this.newDelayReason.trim()) {
      this.toast.error(this.lang.isVietnamese() ? 'Vui lòng nhập lý do hoãn/hủy để thông báo cho khách hàng.' : 'Please enter delay/cancellation reason to inform passengers.');
      return;
    }

    // Về SCHEDULED/COMPLETED thì xoá lý do cũ, tránh dính lý do thời tiết của lần trước.
    const delayReason = needsReason ? this.newDelayReason.trim() : '';

    this.submitting.set(true);
    this.api
      .updateFlightStatus(fl._id, {
        status,
        delay_reason: delayReason,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.showStatusModal.set(false);
          const msg = this.lang.isVietnamese() ? `Đã cập nhật trạng thái chuyến bay ${fl.flight_number} thành ${status}!` : `Updated flight status ${fl.flight_number} to ${status}!`;
          this.toast.success(msg);
          this.loadFlights();
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(this.describeError(err, this.lang.isVietnamese() ? 'Cập nhật trạng thái thất bại.' : 'Failed to update flight status.'));
        },
      });
  }

  openCreateModal(): void {
    const originTz = this.getAirportTimeZone('HAN');
    const destTz = this.getAirportTimeZone('SGN');

    if (!originTz) {
      this.toast.error(this.lang.t('admin.flights.errOriginTzNotFound').replace('{origin}', 'HAN'));
      return;
    }
    if (!destTz) {
      this.toast.error(this.lang.t('admin.flights.errDestTzNotFound').replace('{dest}', 'SGN'));
      return;
    }

    const now = new Date();
    const depUtc = new Date(now.getTime() + 24 * 3600000);
    depUtc.setUTCMinutes(0, 0, 0);
    const arrUtc = new Date(depUtc.getTime() + 130 * 60000);

    const depLocal = utcToWallTime(depUtc, originTz);
    const arrLocal = utcToWallTime(arrUtc, destTz);

    this.editingId.set(null);
    this.editingFlight.set(null);
    this.newFlight = {
      flight_number: 'VN-' + Math.floor(100 + Math.random() * 900),
      origin_iata: 'HAN',
      dest_iata: 'SGN',
      departure_date: extractWallDate(depLocal) || '',
      scheduled_departure: depLocal,
      scheduled_arrival: arrLocal,
      aircraft_model_code: '',
      aircraft_model_name: '',
    };

    // Reset toàn bộ giá/ghế/dặm về mặc định mỗi lần mở modal.
    this.econPrice = FLIGHT_FORM_DEFAULTS.econPrice;
    this.econSeats = FLIGHT_FORM_DEFAULTS.econSeats;
    this.busPrice = FLIGHT_FORM_DEFAULTS.busPrice;
    this.busSeats = FLIGHT_FORM_DEFAULTS.busSeats;
    this.distanceMiles = FLIGHT_FORM_DEFAULTS.distanceMiles;
    this.selectedFleetModel = '';
    this.fleetModels.set([]);

    const code = this.deriveAirlineCode(this.newFlight.flight_number);
    this.updateAirlineFleet(code);

    this.showFlightModal.set(true);
  }

  openEditModal(fl: Flight): void {
    const originTz = this.getAirportTimeZone(fl.origin_iata);
    const destTz = this.getAirportTimeZone(fl.dest_iata);

    if (!originTz) {
      this.toast.error(this.lang.t('admin.flights.errOriginTzNotFound').replace('{origin}', fl.origin_iata));
      return;
    }
    if (!destTz) {
      this.toast.error(this.lang.t('admin.flights.errDestTzNotFound').replace('{dest}', fl.dest_iata));
      return;
    }

    const depLocal = utcToWallTime(fl.scheduled_departure, originTz);
    const arrLocal = utcToWallTime(fl.scheduled_arrival, destTz);
    const wallDate = extractWallDate(depLocal);

    const econ = fl.inventories?.find((i) => i.cabin_class === CabinClass.ECONOMY);
    const bus = fl.inventories?.find((i) => i.cabin_class === CabinClass.BUSINESS);

    this.editingId.set(fl._id);
    this.editingFlight.set(fl);
    this.newFlight = {
      flight_number: fl.flight_number,
      origin_iata: fl.origin_iata,
      dest_iata: fl.dest_iata,
      departure_date: wallDate || (fl.departure_date ? String(fl.departure_date).slice(0, 10) : ''),
      scheduled_departure: depLocal,
      scheduled_arrival: arrLocal,
      aircraft_model_code: fl.aircraft?.model_code || '',
      aircraft_model_name: fl.aircraft?.model_name || '',
    };

    this.econPrice = econ?.base_price ?? FLIGHT_FORM_DEFAULTS.econPrice;
    this.econSeats = econ?.allocated_seats ?? FLIGHT_FORM_DEFAULTS.econSeats;
    this.busPrice = bus?.base_price ?? FLIGHT_FORM_DEFAULTS.busPrice;
    this.busSeats = bus?.allocated_seats ?? FLIGHT_FORM_DEFAULTS.busSeats;
    this.distanceMiles = fl.distance_miles ?? FLIGHT_FORM_DEFAULTS.distanceMiles;
    this.selectedFleetModel = fl.aircraft?.model_code && fl.aircraft?.model_name ? `${fl.aircraft.model_code}|${fl.aircraft.model_name}` : 'MANUAL';
    this.fleetModels.set([]);

    const code = this.deriveAirlineCode(fl.flight_number);
    this.updateAirlineFleet(code);

    this.showFlightModal.set(true);
  }

  deriveAirlineCode(flightNumber?: string): string {
    if (!flightNumber) return 'VN';
    const cleaned = flightNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = cleaned.match(/^([A-Z]+)/);
    return match ? match[1] : 'VN';
  }

  updateAirlineFleet(code: string): void {
    const target = code || 'VN';
    this.currentAirlineCode.set(target);
    this.api.getAirlineFleet(target).subscribe({
      next: (res) => this.fleetModels.set(res?.models || []),
      error: () => this.fleetModels.set([]),
    });
  }

  onFlightNumberChange(value: string): void {
    const code = this.deriveAirlineCode(value);
    if (code !== this.currentAirlineCode()) {
      this.updateAirlineFleet(code);
    }
  }

  getFleetDropdownLabel(): string {
    return this.lang.t('admin.flights.fleetOf').replace('{code}', this.currentAirlineCode());
  }

  getAirportTimeZone(iata?: string): string {
    if (!iata) return '';
    const code = iata.trim().toUpperCase();
    const ap = this.airports().find((a) => a.iata_code === code);
    const candidate = ap?.time_zone || '';
    return isValidIanaTimeZone(candidate) ? candidate : '';
  }

  getAirportGmtOffset(iata?: string, wallTime?: string, preferUtc?: string | Date): string {
    const tz = this.getAirportTimeZone(iata);
    if (!tz) return '—';
    try {
      if (wallTime && wallTime.trim()) {
        const res = wallTimeToUtc(wallTime, tz, preferUtc);
        if (!res.success || !res.date) return '—';
        return getTimezoneGmtOffset(tz, res.date);
      }
      return getTimezoneGmtOffset(tz);
    } catch {
      return '—';
    }
  }

  /**
   * Thời gian bay vật lý (phút) giữa 2 mốc UTC của chuyến bay.
   */
  computedDurationMinutes(): number {
    const depRaw = String(this.newFlight?.scheduled_departure ?? '').trim();
    const arrRaw = String(this.newFlight?.scheduled_arrival ?? '').trim();
    if (!depRaw || !arrRaw) return 0;

    const originTz = this.getAirportTimeZone(this.newFlight?.origin_iata);
    const destTz = this.getAirportTimeZone(this.newFlight?.dest_iata);
    if (!originTz || !destTz) return 0;

    const original = this.editingFlight();
    const preferDep = original?.scheduled_departure ? new Date(original.scheduled_departure) : undefined;
    const preferArr = original?.scheduled_arrival ? new Date(original.scheduled_arrival) : undefined;

    const depRes = wallTimeToUtc(depRaw, originTz, preferDep);
    const arrRes = wallTimeToUtc(arrRaw, destTz, preferArr);
    if (!depRes.success || !depRes.date || !arrRes.success || !arrRes.date) return 0;

    return computePhysicalDurationMinutes(depRes.date, arrRes.date);
  }

  getDurationHint(): string {
    const duration = this.computedDurationMinutes();
    if (!duration) return '';
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durStr = hours > 0 ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) : `${mins}m`;

    const originTz = this.getAirportTimeZone(this.newFlight?.origin_iata);
    const destTz = this.getAirportTimeZone(this.newFlight?.dest_iata);
    if (!originTz || !destTz) return durStr;

    const depRaw = String(this.newFlight?.scheduled_departure ?? '').trim();
    const arrRaw = String(this.newFlight?.scheduled_arrival ?? '').trim();
    const original = this.editingFlight();
    const preferDep = original?.scheduled_departure ? new Date(original.scheduled_departure) : undefined;
    const preferArr = original?.scheduled_arrival ? new Date(original.scheduled_arrival) : undefined;

    const depRes = wallTimeToUtc(depRaw, originTz, preferDep);
    const arrRes = wallTimeToUtc(arrRaw, destTz, preferArr);
    const depUtc = depRes.success && depRes.date ? depRes.date : new Date();
    const arrUtc = arrRes.success && arrRes.date ? arrRes.date : new Date();

    const originOffset = getTimezoneOffsetMinutes(originTz, depUtc);
    const destOffset = getTimezoneOffsetMinutes(destTz, arrUtc);
    const diff = destOffset - originOffset;

    let diffStr = '0h';
    if (diff !== 0) {
      const sign = diff > 0 ? '+' : '-';
      const abs = Math.abs(diff);
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      diffStr = `${sign}${h}h${m ? m + 'm' : ''}`;
    }

    return this.lang
      .t('admin.flights.durationEstimateHint')
      .replace('{duration}', durStr)
      .replace('{diff}', diffStr);
  }

  /** Giữ departure_date khớp với ngày địa phương của sân bay đi. */
  syncDepartureDate(): void {
    const depRaw = String(this.newFlight?.scheduled_departure ?? '').trim();
    const wallDate = extractWallDate(depRaw);
    if (wallDate) {
      this.newFlight.departure_date = wallDate;
    }
  }

  saveFlightForm(): void {
    const depRaw = String(this.newFlight?.scheduled_departure ?? '').trim();
    const arrRaw = String(this.newFlight?.scheduled_arrival ?? '').trim();

    if (!depRaw || !arrRaw) {
      this.toast.error(this.lang.isVietnamese() ? 'Vui lòng chọn giờ cất cánh và giờ hạ cánh.' : 'Please select departure and arrival times.');
      return;
    }

    const flightNumber = String(this.newFlight?.flight_number ?? '').trim().toUpperCase();
    if (!flightNumber) {
      this.toast.error(this.lang.isVietnamese() ? 'Vui lòng nhập số hiệu chuyến bay.' : 'Please enter flight number.');
      return;
    }

    const id = this.editingId();
    const origin = String(this.newFlight?.origin_iata ?? '').trim().toUpperCase();
    const dest = String(this.newFlight?.dest_iata ?? '').trim().toUpperCase();
    if (!id && (!origin || !dest)) {
      this.toast.error(this.lang.t('admin.airlabs.inputAirportsWarning'));
      return;
    }

    const originTz = this.getAirportTimeZone(origin);
    const destTz = this.getAirportTimeZone(dest);
    if (!originTz) {
      this.toast.error(this.lang.t('admin.flights.errOriginTzNotFound').replace('{origin}', origin));
      return;
    }
    if (!destTz) {
      this.toast.error(this.lang.t('admin.flights.errDestTzNotFound').replace('{dest}', dest));
      return;
    }

    const original = this.editingFlight();
    const preferDep = original?.scheduled_departure ? new Date(original.scheduled_departure) : undefined;
    const preferArr = original?.scheduled_arrival ? new Date(original.scheduled_arrival) : undefined;

    const depRes = wallTimeToUtc(depRaw, originTz, preferDep);
    if (!depRes.success || !depRes.date) {
      if (depRes.error === 'NONEXISTENT_WALL_TIME') {
        this.toast.error(
          this.lang.t('admin.flights.errDepSpringForward').replace('{time}', depRaw).replace('{tz}', originTz)
        );
      } else if (depRes.error === 'AMBIGUOUS_WALL_TIME') {
        this.toast.error(
          this.lang.t('admin.flights.errDepFallBack').replace('{time}', depRaw).replace('{tz}', originTz)
        );
      } else {
        this.toast.error(
          this.lang.isVietnamese()
            ? `Giờ cất cánh không hợp lệ: ${depRes.error}`
            : `Invalid departure time: ${depRes.error}`
        );
      }
      return;
    }

    const arrRes = wallTimeToUtc(arrRaw, destTz, preferArr);
    if (!arrRes.success || !arrRes.date) {
      if (arrRes.error === 'NONEXISTENT_WALL_TIME') {
        this.toast.error(
          this.lang.t('admin.flights.errArrSpringForward').replace('{time}', arrRaw).replace('{tz}', destTz)
        );
      } else if (arrRes.error === 'AMBIGUOUS_WALL_TIME') {
        this.toast.error(
          this.lang.t('admin.flights.errArrFallBack').replace('{time}', arrRaw).replace('{tz}', destTz)
        );
      } else {
        this.toast.error(
          this.lang.isVietnamese()
            ? `Giờ hạ cánh không hợp lệ: ${arrRes.error}`
            : `Invalid arrival time: ${arrRes.error}`
        );
      }
      return;
    }

    const depUtc = depRes.date;
    const arrUtc = arrRes.date;

    if (arrUtc.getTime() <= depUtc.getTime()) {
      this.toast.error(this.lang.t('admin.flights.errArrAfterDepUtc'));
      return;
    }

    const wallDate = extractWallDate(depRaw);
    if (!wallDate) {
      this.toast.error(this.lang.t('admin.flights.errExtractLocalDate'));
      return;
    }

    const isCommercial = original?.data_source === 'AIRLABS_COMMERCIALIZED';
    const durationMinutes = Math.max(1, computePhysicalDurationMinutes(depUtc, arrUtc));

    let payload: any;
    if (isCommercial) {
      // Chuyến bay thương mại AirLabs:
      // Chỉ cập nhật các trường điều hành an toàn (ngày bay địa phương, giờ cất/hạ cánh UTC, thời lượng bay).
      // TUYỆT ĐỐI KHÔNG gửi `flight_number`, `inventories`, `aircraft`, `distance_miles`, `origin_iata`, `dest_iata`.
      // Bảo toàn nguyên vẹn subdocuments, _id của từng inventory và saga_markers trong MongoDB.
      payload = {
        departure_date: wallDate,
        scheduled_departure: depUtc.toISOString(),
        scheduled_arrival: arrUtc.toISOString(),
        duration_minutes: durationMinutes,
      };
    } else {
      const miles = Number(this.distanceMiles);
      if (!Number.isInteger(miles) || miles < 0) {
        this.toast.error(this.lang.isVietnamese() ? 'Số dặm bay phải là số nguyên không âm.' : 'Flight distance must be a non-negative integer.');
        return;
      }

      const econP = Number(this.econPrice);
      const busP = Number(this.busPrice);
      if (!Number.isFinite(econP) || econP < 0 || !Number.isFinite(busP) || busP < 0) {
        this.toast.error(this.lang.isVietnamese() ? 'Giá vé phải là số không âm.' : 'Ticket fare must be a non-negative number.');
        return;
      }

      const econS = Number(this.econSeats);
      const busS = Number(this.busSeats);
      if (!Number.isInteger(econS) || econS < 1 || !Number.isInteger(busS) || busS < 1) {
        this.toast.error(this.lang.isVietnamese() ? 'Số ghế mỗi hạng phải là số nguyên lớn hơn hoặc bằng 1.' : 'Seat count for each cabin must be an integer >= 1.');
        return;
      }

      const inventories = this.buildInventories(original, econP, econS, busP, busS);

      payload = {
        flight_number: flightNumber,
        departure_date: wallDate,
        scheduled_departure: depUtc.toISOString(),
        scheduled_arrival: arrUtc.toISOString(),
        duration_minutes: durationMinutes,
        distance_miles: miles,
        inventories,
      };

      const acCode = String(this.newFlight.aircraft_model_code || '').trim();
      const acName = String(this.newFlight.aircraft_model_name || '').trim();
      if (acCode || acName) {
        payload.aircraft = {
          model_code: acCode,
          model_name: acName,
          total_capacity: econS + busS,
        };
      } else {
        if (id) {
          payload.aircraft = null; // Clear aircraft if fields are empty on edit
        }
      }
    }

    const request$ = id
      ? this.api.updateFlight(id, payload)
      : this.api.createFlight({
          ...payload,
          origin_iata: origin,
          dest_iata: dest,
        });

    this.submitting.set(true);
    request$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.showFlightModal.set(false);
        const successMsg = id
          ? (this.lang.isVietnamese() ? `Đã cập nhật chuyến bay ${flightNumber}!` : `Updated flight ${flightNumber}!`)
          : (this.lang.isVietnamese() ? `Đã thêm chuyến bay ${flightNumber} thành công!` : `Successfully added flight ${flightNumber}!`);
        this.toast.success(successMsg);
        this.loadFlights();
      },
      error: (err) => {
        this.submitting.set(false);
        const fallback = id
          ? (this.lang.isVietnamese() ? 'Không thể cập nhật chuyến bay.' : 'Failed to update flight.')
          : (this.lang.isVietnamese() ? 'Không thể tạo chuyến bay.' : 'Failed to create flight.');
        this.toast.error(this.describeError(err, fallback));
      },
    });
  }

  deleteFlight(fl: Flight): void {
    const confirmPrompt = this.lang.isVietnamese() ? `Bạn có chắc chắn muốn xóa chuyến bay ${fl.flight_number} không?` : `Are you sure you want to delete flight ${fl.flight_number}?`;
    if (!confirm(confirmPrompt)) return;

    this.api.deleteFlight(fl._id).subscribe({
      next: () => {
        const msg = this.lang.isVietnamese() ? `Đã xóa chuyến bay ${fl.flight_number}` : `Deleted flight ${fl.flight_number}`;
        this.toast.success(msg);
        this.loadFlights();
      },
      error: (err) => {
        this.toast.error(this.describeError(err, this.lang.isVietnamese() ? 'Xóa chuyến bay không thành công.' : 'Failed to delete flight.'));
      },
    });
  }

  /**
   * Khi sửa: giữ nguyên số ghế đã bán, chỉ điều chỉnh ghế trống theo chênh lệch allocated.
   * Khi tạo: toàn bộ ghế đều trống.
   */
  private buildInventories(
    original: Flight | null,
    econP: number,
    econS: number,
    busP: number,
    busS: number,
  ): any[] {
    const make = (cabin: CabinClass, price: number, seats: number) => {
      const existing = original?.inventories?.find((i) => i.cabin_class === cabin);
      const allocatedBefore = existing?.allocated_seats ?? seats;
      const availableBefore = existing?.available_seats ?? seats;
      const available = Math.max(0, availableBefore + (seats - allocatedBefore));
      return {
        cabin_class: cabin,
        is_smoking: existing?.is_smoking ?? false,
        bucket_code: existing?.bucket_code,
        base_price: Math.round(price),
        allocated_seats: seats,
        available_seats: available,
      };
    };

    return [make(CabinClass.ECONOMY, econP, econS), make(CabinClass.BUSINESS, busP, busS)];
  }

  /** err.error.message của NestJS có thể là string hoặc mảng lỗi validate. */
  private describeError(err: any, fallback: string): string {
    const raw = err?.error?.message ?? err?.message;
    if (Array.isArray(raw)) return raw.join(', ');
    if (typeof raw === 'string' && raw.trim()) return raw;
    return fallback;
  }
}
