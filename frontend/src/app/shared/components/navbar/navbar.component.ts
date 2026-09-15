import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../icon/icon.component';
import { AuthModalComponent } from '../auth-modal/auth-modal.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, AuthModalComponent],
  template: `
    <header class="bg-navy sticky top-0 z-40 shadow-lg border-b border-navy-light/40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-20">
          <!-- Brand Logo -->
          <a routerLink="/" class="flex items-center gap-3 group">
            <div class="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-navy shadow-md group-hover:scale-105 transition-transform duration-200">
              <app-icon name="plane" class="w-6 h-6 text-navy" />
            </div>
            <div>
              <span class="text-xl font-black tracking-wider text-white flex items-center gap-1.5">
                APTECH <span class="text-gold">AIRLINES</span>
              </span>
              <span class="block text-[10px] uppercase tracking-widest text-slate-300 font-medium -mt-1">
                5-Star Aviation
              </span>
            </div>
          </a>

          <!-- Desktop Navigation Menu -->
          <nav class="hidden md:flex items-center gap-1 lg:gap-2">
            <a
              routerLink="/"
              routerLinkActive="text-gold font-semibold bg-navy-light/30"
              [routerLinkActiveOptions]="{ exact: true }"
              class="px-3.5 py-2 text-sm text-slate-200 hover:text-gold hover:bg-navy-light/40 rounded-full transition-all duration-150 flex items-center gap-1.5"
            >
              <app-icon name="search" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('nav.searchFlights') }}</span>
            </a>

            <a
              routerLink="/track"
              routerLinkActive="text-gold font-semibold bg-navy-light/30"
              class="px-3.5 py-2 text-sm text-slate-200 hover:text-gold hover:bg-navy-light/40 rounded-full transition-all duration-150 flex items-center gap-1.5"
            >
              <app-icon name="ticket" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('nav.myTrips') }}</span>
            </a>

            <a
              routerLink="/skymiles"
              routerLinkActive="text-gold font-semibold bg-navy-light/30"
              class="px-3.5 py-2 text-sm text-slate-200 hover:text-gold hover:bg-navy-light/40 rounded-full transition-all duration-150 flex items-center gap-1.5"
            >
              <app-icon name="award" class="w-4 h-4 text-gold" />
              <span>{{ lang.t('nav.skyMiles') }}</span>
            </a>
          </nav>

          <!-- Right Action Center -->
          <div class="hidden md:flex items-center gap-3">
            <!-- Language Switcher -->
            <button
              (click)="lang.toggleLang()"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 bg-navy-light/30 text-xs font-semibold text-slate-200 hover:text-white hover:border-gold transition-colors"
              title="Chuyển ngôn ngữ / Switch Language"
            >
              <app-icon name="languages" class="w-4 h-4 text-gold" />
              <span class="uppercase font-bold">{{ lang.currentLang() === 'vi' ? 'VI' : 'EN' }}</span>
            </button>

            @if (auth.isAuthenticated()) {
              <!-- User Profile Pill -->
              <div class="flex items-center gap-2 bg-navy-light/50 border border-slate-700 rounded-full pl-3 pr-1 py-1">
                <div class="text-right pr-1">
                  <div class="text-xs font-bold text-white flex items-center gap-1">
                    <span>{{ auth.currentUser()?.first_name }} {{ auth.currentUser()?.last_name }}</span>
                    @if (auth.isStaff()) {
                      <span class="bg-amber-500/20 text-gold text-[10px] px-1.5 py-0.2 rounded font-mono uppercase">
                        {{ auth.userRole() }}
                      </span>
                    }
                  </div>
                  <div class="text-[11px] text-amber-400 flex items-center justify-end gap-1">
                    <app-icon name="crown" class="w-3 h-3 text-gold" />
                    <span>{{ auth.currentUser()?.sky_miles | number }} {{ lang.t('nav.miles') }}</span>
                  </div>
                </div>

                @if (auth.isStaff()) {
                  <a
                    routerLink="/admin"
                    class="p-2 bg-navy-dark hover:bg-gold hover:text-navy text-gold rounded-full transition-all"
                    title="{{ lang.t('nav.adminPortal') }}"
                  >
                    <app-icon name="settings" class="w-4 h-4" />
                  </a>
                }

                <button
                  (click)="auth.logout()"
                  class="p-2 bg-navy-dark hover:bg-rose-600 text-slate-300 hover:text-white rounded-full transition-all"
                  title="{{ lang.t('nav.logout') }}"
                >
                  <app-icon name="logout" class="w-4 h-4" />
                </button>
              </div>
            } @else {
              <!-- Login / Register Trigger -->
              <button
                (click)="isAuthModalOpen.set(true)"
                class="btn-gold !py-2 !px-5 text-sm"
              >
                <app-icon name="user" class="w-4 h-4" />
                <span>{{ lang.t('nav.login') }}</span>
              </button>
            }
          </div>

          <!-- Mobile Hamburger Menu Button -->
          <div class="md:hidden flex items-center gap-2">
            <button
              (click)="lang.toggleLang()"
              class="p-2 rounded-full border border-slate-700 text-gold text-xs font-bold"
            >
              {{ lang.currentLang() === 'vi' ? 'VI' : 'EN' }}
            </button>
            <button
              (click)="mobileMenuOpen.set(!mobileMenuOpen())"
              class="p-2 rounded-full text-slate-300 hover:text-white hover:bg-navy-light"
            >
              <app-icon [name]="mobileMenuOpen() ? 'x' : 'slidershorizontal'" class="w-6 h-6" />
            </button>
          </div>
        </div>

        <!-- Mobile Drawer -->
        @if (mobileMenuOpen()) {
          <div class="md:hidden pb-6 pt-2 border-t border-navy-light/40 space-y-2">
            <a
              routerLink="/"
              (click)="mobileMenuOpen.set(false)"
              class="block px-4 py-2.5 rounded-2xl text-slate-200 hover:bg-navy-light font-medium text-sm flex items-center gap-2"
            >
              <app-icon name="search" class="w-4 h-4 text-gold" />
              {{ lang.t('nav.searchFlights') }}
            </a>
            <a
              routerLink="/track"
              (click)="mobileMenuOpen.set(false)"
              class="block px-4 py-2.5 rounded-2xl text-slate-200 hover:bg-navy-light font-medium text-sm flex items-center gap-2"
            >
              <app-icon name="ticket" class="w-4 h-4 text-gold" />
              {{ lang.t('nav.myTrips') }}
            </a>
            <a
              routerLink="/skymiles"
              (click)="mobileMenuOpen.set(false)"
              class="block px-4 py-2.5 rounded-2xl text-slate-200 hover:bg-navy-light font-medium text-sm flex items-center gap-2"
            >
              <app-icon name="award" class="w-4 h-4 text-gold" />
              {{ lang.t('nav.skyMiles') }}
            </a>

            @if (auth.isAuthenticated()) {
              @if (auth.isStaff()) {
                <a
                  routerLink="/admin"
                  (click)="mobileMenuOpen.set(false)"
                  class="block px-4 py-2.5 rounded-2xl text-gold hover:bg-navy-light font-medium text-sm flex items-center gap-2"
                >
                  <app-icon name="settings" class="w-4 h-4" />
                  {{ lang.t('nav.adminPortal') }}
                </a>
              }
              <button
                (click)="auth.logout(); mobileMenuOpen.set(false)"
                class="w-full text-left px-4 py-2.5 rounded-2xl text-rose-400 hover:bg-navy-light font-medium text-sm flex items-center gap-2"
              >
                <app-icon name="logout" class="w-4 h-4" />
                {{ lang.t('nav.logout') }}
              </button>
            } @else {
              <div class="pt-2">
                <button
                  (click)="isAuthModalOpen.set(true); mobileMenuOpen.set(false)"
                  class="btn-gold w-full text-center text-sm"
                >
                  <app-icon name="user" class="w-4 h-4" />
                  {{ lang.t('nav.login') }}
                </button>
              </div>
            }
          </div>
        }
      </div>
    </header>

    <!-- Auth Modal -->
    <app-auth-modal
      [isOpen]="isAuthModalOpen()"
      (closeEvent)="isAuthModalOpen.set(false)"
    />
  `,
})
export class NavbarComponent {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);

  readonly isAuthModalOpen = signal(false);
  readonly mobileMenuOpen = signal(false);
}
