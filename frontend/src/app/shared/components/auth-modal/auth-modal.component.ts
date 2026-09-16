import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    @if (isOpen) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative">
          <!-- Header Bar -->
          <div class="bg-navy p-6 text-white text-center relative">
            <button
              (click)="close()"
              class="absolute top-5 right-5 text-slate-400 hover:text-white transition-colors"
            >
              <app-icon name="x" class="w-5 h-5" />
            </button>
            <div class="w-12 h-12 bg-amber-500/20 text-gold rounded-full flex items-center justify-center mx-auto mb-3 border border-gold/40">
              <app-icon name="plane" class="w-6 h-6" />
            </div>
            <h3 class="text-xl font-bold tracking-tight">Aptech Airlines</h3>
            <p class="text-xs text-slate-300 mt-1">{{ lang.t('nav.slogan') }}</p>

            <!-- Mode Tabs -->
            <div class="flex bg-navy-dark/60 p-1 rounded-full mt-5 max-w-xs mx-auto border border-slate-700">
              <button
                (click)="isRegister.set(false)"
                [class.bg-gold]="!isRegister()"
                [class.text-navy]="!isRegister()"
                [class.font-bold]="!isRegister()"
                [class.text-slate-300]="isRegister()"
                class="flex-1 py-1.5 text-xs rounded-full transition-all duration-200"
              >
                {{ lang.t('nav.login') }}
              </button>
              <button
                (click)="isRegister.set(true)"
                [class.bg-gold]="isRegister()"
                [class.text-navy]="isRegister()"
                [class.font-bold]="isRegister()"
                [class.text-slate-300]="!isRegister()"
                class="flex-1 py-1.5 text-xs rounded-full transition-all duration-200"
              >
                {{ lang.t('nav.register') }}
              </button>
            </div>
          </div>

          <!-- Form Content -->
          <div class="p-6">
            @if (!isRegister()) {
              <!-- Login Form -->
              <form (ngSubmit)="handleLogin()" class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('auth.usernameLabel') }}</label>
                  <div class="relative">
                    <app-icon name="user" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      [(ngModel)]="loginUsername"
                      name="username"
                      required
                      [placeholder]="lang.t('auth.usernamePlaceholder')"
                      class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('auth.passwordLabel') }}</label>
                  <div class="relative">
                    <app-icon name="lock" class="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type="password"
                      [(ngModel)]="loginPassword"
                      name="password"
                      required
                      [placeholder]="lang.t('auth.passwordPlaceholder')"
                      class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold transition-all"
                    />
                  </div>
                </div>

                <!-- Demo credentials removed for security: production bundles must never expose test logins -->

                <button
                  type="submit"
                  [disabled]="loading()"
                  class="btn-gold w-full mt-2"
                >
                  @if (loading()) {
                    <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                    <span>{{ lang.t('common.loading') }}</span>
                  } @else {
                    <app-icon name="logout" class="w-4 h-4 rotate-180" />
                    <span>{{ lang.t('nav.login') }}</span>
                  }
                </button>
              </form>
            } @else {
              <!-- Register Form -->
              <form (ngSubmit)="handleRegister()" class="space-y-3">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.lastName') }}</label>
                    <input
                      type="text"
                      [(ngModel)]="regLastName"
                      name="lastName"
                      required
                      [placeholder]="lang.t('auth.lastNamePlaceholder')"
                      class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold/50"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('booking.firstName') }}</label>
                    <input
                      type="text"
                      [(ngModel)]="regFirstName"
                      name="firstName"
                      required
                      [placeholder]="lang.t('auth.firstNamePlaceholder')"
                      class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold/50"
                    />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('auth.usernameLabelOnly') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="regUsername"
                    name="username"
                    required
                    placeholder="nguyenvanan"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold/50"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    [(ngModel)]="regEmail"
                    name="email"
                    required
                    placeholder="an.nguyen@example.com"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold/50"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">{{ lang.t('auth.passwordLabelOnly') }}</label>
                  <input
                    type="password"
                    [(ngModel)]="regPassword"
                    name="password"
                    required
                    [placeholder]="lang.t('auth.passwordMin')"
                    class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-gold/50"
                  />
                </div>

                <button
                  type="submit"
                  [disabled]="loading()"
                  class="btn-gold w-full mt-3"
                >
                  @if (loading()) {
                    <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                    <span>{{ lang.t('common.loading') }}</span>
                  } @else {
                    <app-icon name="usercheck" class="w-4 h-4" />
                    <span>{{ lang.t('nav.register') }}</span>
                  }
                </button>
              </form>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class AuthModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closeEvent = new EventEmitter<void>();

  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  readonly toast = inject(ToastService);
  private readonly el = inject(ElementRef);

  readonly isRegister = signal(false);
  readonly loading = signal(false);

  loginUsername = '';
  loginPassword = '';

  regUsername = '';
  regPassword = '';
  regFirstName = '';
  regLastName = '';
  regEmail = '';

  // Reset form and focus first input whenever modal is reopened (isOpen becomes true)
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true && !changes['isOpen']?.previousValue) {
      this.resetForm();
      this.focusFirstInput();
    }
  }

  // Clear form state to prevent stale credentials or tab selection from persisting
  private resetForm(): void {
    this.isRegister.set(false);
    this.loginUsername = '';
    this.loginPassword = '';
    this.regUsername = '';
    this.regPassword = '';
    this.regFirstName = '';
    this.regLastName = '';
    this.regEmail = '';
  }

  // Autofocus the first input on modal open for improved UX
  private focusFirstInput(): void {
    setTimeout(() => {
      const input = this.el.nativeElement.querySelector('input') as HTMLInputElement | null;
      input?.focus();
    }, 0);
  }

  close(): void {
    this.closeEvent.emit();
  }

  handleLogin(): void {
    if (!this.loginUsername || !this.loginPassword) {
      this.toast.warning(this.lang.t('auth.loginEmpty'));
      return;
    }

    this.loading.set(true);
    this.auth
      .login({ username: this.loginUsername, password: this.loginPassword })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.toast.success(`${this.lang.t('auth.loginSuccess')} ${res.user.first_name} ${res.user.last_name}`);
          this.close();
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || this.lang.t('auth.loginError'));
        },
      });
  }

  handleRegister(): void {
    if (!this.regUsername || !this.regPassword || !this.regFirstName || !this.regLastName || !this.regEmail) {
      this.toast.warning(this.lang.t('auth.registerEmpty'));
      return;
    }

    this.loading.set(true);
    this.auth
      .register({
        username: this.regUsername,
        password: this.regPassword,
        first_name: this.regFirstName,
        last_name: this.regLastName,
        email: this.regEmail,
      })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.toast.success(`${this.lang.t('auth.registerSuccess')} ${res.user.first_name}`);
          this.close();
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(err.error?.message || 'this.lang.t(\'auth.registerError\')');
        },
      });
  }
}
