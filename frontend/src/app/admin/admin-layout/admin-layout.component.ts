import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      <!-- Dark Navy Sidebar -->
      <aside class="w-full md:w-64 bg-navy text-slate-300 flex flex-col shrink-0 border-r border-navy-light/50">
        <!-- Sidebar Brand -->
        <div class="p-6 border-b border-navy-light/40 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-navy shadow-md font-bold">
              <app-icon name="plane" class="w-5 h-5 text-navy" />
            </div>
            <div>
              <span class="font-bold text-white tracking-wider text-sm block">
                {{ auth.isClerk() ? 'APTECH DESK' : 'APTECH ADMIN' }}
              </span>
              <span class="text-[10px] text-amber-400 font-mono">
                {{ auth.isClerk()
                  ? (lang.isVietnamese() ? 'Bàn Làm Việc Nhân Viên' : 'Staff Console')
                  : (lang.isVietnamese() ? 'Quản Trị Hàng Không' : 'Aviation Administration') }}
              </span>
            </div>
          </div>

          <button
            (click)="sidebarOpen.set(!sidebarOpen())"
            class="md:hidden text-slate-400 hover:text-white inline-flex items-center justify-center"
          >
            <app-icon [name]="sidebarOpen() ? 'x' : 'slidershorizontal'" class="w-5 h-5" />
          </button>
        </div>

        <!-- Navigation Links -->
        <nav
          [class.hidden]="!sidebarOpen()"
          class="md:flex flex-col flex-1 p-4 space-y-1.5 overflow-y-auto"
        >
          <a
            routerLink="/admin/dashboard"
            routerLinkActive="bg-gold text-navy font-bold shadow-md"
            [routerLinkActiveOptions]="{ exact: true }"
            class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
          >
            <app-icon name="slidershorizontal" class="w-4 h-4" />
            <span>{{ lang.t('admin.dashboard') }}</span>
          </a>

          <!-- Operational Staff Links: Reservation Desk & Bookings -->
          <a
            routerLink="/admin/reservation-desk"
            routerLinkActive="bg-gold text-navy font-bold shadow-md"
            class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
          >
            <app-icon name="usercheck" class="w-4 h-4" />
            <span>{{ lang.t('admin.reservationDesk') }}</span>
          </a>

          <a
            routerLink="/admin/bookings"
            routerLinkActive="bg-gold text-navy font-bold shadow-md"
            class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
          >
            <app-icon name="ticket" class="w-4 h-4" />
            <span>{{ lang.t('admin.bookings') }}</span>
          </a>

          <a
            routerLink="/admin/seat-operations"
            routerLinkActive="bg-gold text-navy font-bold shadow-md"
            class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
          >
            <app-icon name="armchair" class="w-4 h-4" />
            <span>{{ lang.t('admin.seatOperations') }}</span>
          </a>

          <!-- Admin Management Links (ADMIN & SUPER_ADMIN only) -->
          @if (auth.isAdmin()) {
            <a
              routerLink="/admin/analytics"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="chartbar" class="w-4 h-4" />
              <span>{{ lang.t('admin.analytics') }}</span>
            </a>

            <a
              routerLink="/admin/commercial-flights"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="planetakeoff" class="w-4 h-4" />
              <span>{{ lang.t('admin.commercial') }}</span>
            </a>

            <a
              routerLink="/admin/flights"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="plane" class="w-4 h-4" />
              <span>{{ lang.t('admin.flights') }}</span>
            </a>

            <a
              routerLink="/admin/seat-pricing"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="tag" class="w-4 h-4" />
              <span>{{ lang.t('admin.seatPricing') }}</span>
            </a>

            <a
              routerLink="/admin/airports"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="mappin" class="w-4 h-4" />
              <span>{{ lang.t('admin.airports') }}</span>
            </a>

            <a
              routerLink="/admin/users"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="users" class="w-4 h-4" />
              <span>{{ lang.t('admin.users') }}</span>
            </a>

            <a
              routerLink="/admin/policies"
              routerLinkActive="bg-gold text-navy font-bold shadow-md"
              class="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-white transition-all duration-150"
            >
              <app-icon name="shieldcheck" class="w-4 h-4" />
              <span>{{ lang.t('admin.policies') }}</span>
            </a>
          }
        </nav>

        <!-- Sidebar Bottom Footer -->
        <div class="p-4 border-t border-navy-light/40 space-y-2">
          <a
            routerLink="/"
            class="w-full inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold text-slate-300 hover:bg-navy-light hover:text-gold transition-colors whitespace-nowrap"
          >
            <app-icon name="arrowright" class="w-4 h-4 rotate-180" />
            <span>{{ lang.t('admin.backClient') }}</span>
          </a>

          <button
            (click)="auth.logout()"
            class="w-full inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold text-rose-400 hover:bg-rose-900/30 transition-colors whitespace-nowrap"
          >
            <app-icon name="logout" class="w-4 h-4" />
            <span>{{ lang.t('nav.logout') }}</span>
          </button>
        </div>
      </aside>

      <!-- Main Content Area with Top Header -->
      <div class="flex-1 flex flex-col min-w-0">
        <header class="bg-white border-b border-slate-200/80 px-6 py-4 flex items-center justify-between shadow-sm">
          <div>
            <h2 class="text-lg font-bold text-navy">{{ lang.isVietnamese() ? 'Bảng Điều Khiển Quản Trị Aptech Airlines' : 'Aptech Airlines Management Console' }}</h2>
            <p class="text-xs text-slate-400">{{ lang.isVietnamese() ? 'Phiên bản Hệ thống v2.4 • Cập nhật chuyến bay & trạng thái thời gian thực' : 'System Version v2.4 • Real-time flight & status updates' }}</p>
          </div>

          <div class="flex items-center gap-4">
            <button
              type="button"
              (click)="lang.toggleLang()"
              class="px-3 py-1 text-xs font-semibold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              [title]="lang.isVietnamese() ? 'Chuyển sang Tiếng Anh' : 'Switch to Vietnamese'"
            >
              <!-- GUI Standards: 100% icon vector Lucide, không dùng emoji -->
              <app-icon name="languages" class="w-3.5 h-3.5" />
              <span class="font-mono text-[11px] font-bold">{{ lang.label() }}</span>
            </button>

            <div class="text-right">
              <div class="text-xs font-bold text-slate-800">
                {{ auth.currentUser()?.first_name }} {{ auth.currentUser()?.last_name }}
              </div>
              <span class="text-[10px] bg-navy text-gold px-2 py-0.5 rounded font-mono font-bold uppercase">
                {{ auth.userRole() }}
              </span>
            </div>
            <div class="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-navy font-bold">
              <app-icon name="user" class="w-4 h-4" />
            </div>
          </div>
        </header>

        <main class="flex-1 p-6 overflow-y-auto min-w-0">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AdminLayoutComponent {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  readonly sidebarOpen = signal(false);
}
