import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../shared/components/pagination/pagination.component';
import { User, UserRole } from '../../core/models/user.model';

@Component({
  selector: 'app-users-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PaginationComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">{{ lang.t('admin.users.title') }}</h1>
          <p class="text-xs text-slate-500">
            {{ lang.t('admin.users.subtitle') }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          @if (users().length) {
            <span class="text-[11px] text-slate-500 font-medium">
              {{ displayedRangeText }}
            </span>
          }
          <button
            type="button"
            (click)="openCreateModal()"
            class="btn-gold text-xs !py-2.5 !px-5 font-bold"
          >
            <app-icon name="plus" class="w-4 h-4" />
            <span>{{ lang.t('admin.users.addUser') }}</span>
          </button>
        </div>
      </div>

      <!-- Users Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">{{ lang.t('admin.users.username') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.users.fullName') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.users.email') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.users.role') }}</th>
                <th class="py-3.5 px-4">{{ lang.t('admin.users.skyMiles') }}</th>
                <th class="py-3.5 px-4 text-right">{{ lang.t('common.action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="6" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    {{ lang.t('admin.users.loading') }}
                  </td>
                </tr>
              } @else {
                @for (u of pagedUsers(); track u._id) {
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-3.5 px-4 font-mono font-bold text-navy">
                      {{ u.username }}
                    </td>
                    <td class="py-3.5 px-4 font-bold text-slate-800">
                      {{ u.first_name }} {{ u.last_name }}
                    </td>
                    <td class="py-3.5 px-4 text-slate-500 font-mono">
                      {{ u.email }}
                    </td>
                    <td class="py-3.5 px-4">
                      @if (u.role === UserRole.SUPER_ADMIN) {
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                          <app-icon name="crown" class="w-3 h-3 text-gold" />
                          {{ lang.t('role.superAdmin') }}
                        </span>
                      } @else if (u.role === UserRole.ADMIN) {
                        <span class="px-2.5 py-0.5 rounded-full bg-navy text-white text-[10px] font-bold">
                          {{ lang.t('role.admin') }}
                        </span>
                      } @else if (u.role === UserRole.CLERK) {
                        <span class="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold">
                          {{ lang.t('role.clerk') }}
                        </span>
                      } @else {
                        <span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                          {{ lang.t('role.customer') }}
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4 font-mono font-bold text-amber-600">
                      {{ u.sky_miles | number }} {{ lang.t('nav.miles') }}
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      @if (u.role === UserRole.SUPER_ADMIN) {
                        <span class="text-[10px] text-slate-400 italic px-2">{{ lang.t('admin.users.protected') }}</span>
                      } @else {
                        <button
                          type="button"
                          (click)="deleteUser(u)"
                          class="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                          [title]="lang.t('admin.users.deleteTitle')"
                        >
                          <app-icon name="trash2" class="w-4 h-4" />
                        </button>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (users().length) {
          <app-pagination
            [total]="users().length"
            [page]="page"
            [pageSize]="pageSize"
            (pageChange)="page = $event"
            (pageSizeChange)="onPageSize($event)"
          />
        }
      </div>

    </div>

    <!-- Modal Create User -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="users" class="w-5 h-5 text-gold" />
              <span>{{ lang.t('admin.users.createModalTitle') }}</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveUser()" class="space-y-3 text-xs">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.lastName') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formData.last_name"
                  name="last_name"
                  required
                  [placeholder]="lang.isVietnamese() ? 'Lê' : 'Doe'"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.firstName') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formData.first_name"
                  name="first_name"
                  required
                  [placeholder]="lang.isVietnamese() ? 'Minh' : 'John'"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.usernameLabel') }}</label>
              <input
                type="text"
                [(ngModel)]="formData.username"
                name="username"
                required
                placeholder="clerk_minh"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.emailLabel') }}</label>
              <input
                type="email"
                [(ngModel)]="formData.email"
                name="email"
                required
                placeholder="minh.le@airline.com"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.password') }}</label>
              <input
                type="password"
                [(ngModel)]="formData.password"
                name="password"
                required
                [placeholder]="lang.t('admin.users.passwordPlaceholder')"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('admin.users.roleLabel') }}</label>
              <select
                [(ngModel)]="formData.role"
                name="role"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-navy"
              >
                <option [value]="UserRole.CLERK">{{ lang.t('admin.users.optClerk') }}</option>
                <option [value]="UserRole.CUSTOMER">{{ lang.t('admin.users.optCustomer') }}</option>
                <!-- SUPER_ADMIN is intentionally NOT allowed to be created -->
              </select>
              <span class="text-[10px] text-amber-700 font-semibold mt-1 block">
                {{ lang.t('admin.users.securityNote') }}
              </span>
            </div>

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">{{ lang.t('common.cancel') }}</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">{{ lang.t('admin.users.createAccountBtn') }}</button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class UsersManageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly lang = inject(LanguageService);

  readonly users = signal<User[]>([]);
  readonly loading = signal(false);
  UserRole = UserRole;

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

  readonly pagedUsers = computed(() => {
    const list = this.users();
    const start = (this.pageSignal() - 1) * this.pageSizeSignal();
    return list.slice(start, start + this.pageSizeSignal());
  });

  onPageSize(size: number): void {
    this.pageSize = size;
    const maxPage = Math.max(1, Math.ceil(this.users().length / size));
    if (this.page > maxPage) {
      this.page = maxPage;
    }
  }

  get displayedRangeText(): string {
    const total = this.users().length;
    if (!total) return '';
    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(total, this.page * this.pageSize);
    return this.lang.isVietnamese()
      ? `Hiển thị ${start}–${end} / tổng ${total}`
      : `Showing ${start}–${end} of ${total}`;
  }

  readonly showModal = signal(false);
  formData: any = {};

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(resetPage = false): void {
    if (resetPage) {
      this.page = 1;
    }
    this.loading.set(true);
    this.api.getUsers().subscribe({
      next: (list) => {
        this.users.set(list || []);
        const maxPage = Math.max(1, Math.ceil((list?.length || 0) / this.pageSize));
        if (this.page > maxPage) {
          this.page = maxPage;
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || this.lang.t('admin.users.loadError'));
      },
    });
  }

  openCreateModal(): void {
    this.formData = {
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      password: 'User@2026',
      role: UserRole.CLERK,
    };
    this.showModal.set(true);
  }

  saveUser(): void {
    if (!this.formData.username || !this.formData.email || !this.formData.password) {
      this.toast.warning(this.lang.t('admin.users.fillAllWarning'));
      return;
    }

    if (this.formData.role === UserRole.SUPER_ADMIN) {
      this.toast.error(this.lang.t('admin.users.superAdminError'));
      return;
    }

    this.api.createUser(this.formData).subscribe({
      next: () => {
        this.toast.success(this.lang.t('admin.users.createSuccess'));
        this.showModal.set(false);
        this.loadUsers();
      },
      error: (err) => {
        this.toast.error(err.error?.message || this.lang.t('admin.users.createError'));
      },
    });
  }

  deleteUser(u: User): void {
    if (u.role === UserRole.SUPER_ADMIN) {
      this.toast.error(this.lang.t('admin.users.cannotDeleteSuperAdmin'));
      return;
    }

    const confirmMsg = `${this.lang.t('admin.users.confirmDelete')} ${u.username}?`;
    if (!confirm(confirmMsg)) return;

    this.api.deleteUser(u._id).subscribe({
      next: () => {
        this.toast.success(`${this.lang.t('admin.users.deleteSuccess')} ${u.username}`);
        this.loadUsers();
      },
      error: (err) => {
        this.toast.error(err.error?.message || this.lang.t('admin.users.deleteError'));
      },
    });
  }
}
