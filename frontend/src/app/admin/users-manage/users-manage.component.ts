import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { User, UserRole } from '../../core/models/user.model';

@Component({
  selector: 'app-users-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-navy">Quản lý Tài khoản & Phân quyền</h1>
          <p class="text-xs text-slate-500">
            Quản lý danh sách người dùng, cấp quyền Clerk/Nhân viên. Tài khoản SUPER_ADMIN được bảo vệ tuyệt đối.
          </p>
        </div>

        <button
          type="button"
          (click)="openCreateModal()"
          class="btn-gold text-xs !py-2.5 !px-5 font-bold"
        >
          <app-icon name="plus" class="w-4 h-4" />
          <span>Thêm Nhân viên / Người dùng</span>
        </button>
      </div>

      <!-- Users Table -->
      <div class="card-luxury border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy text-slate-200 uppercase font-semibold">
              <tr>
                <th class="py-3.5 px-4">Tên đăng nhập</th>
                <th class="py-3.5 px-4">Họ và Tên</th>
                <th class="py-3.5 px-4">Email</th>
                <th class="py-3.5 px-4">Vai trò (Role)</th>
                <th class="py-3.5 px-4">Điểm SkyMiles</th>
                <th class="py-3.5 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium bg-white">
              @if (loading()) {
                <tr>
                  <td colspan="6" class="text-center py-10 text-slate-400">
                    <app-icon name="refreshcw" class="w-6 h-6 animate-spin mx-auto text-gold mb-2" />
                    Đang tải danh sách người dùng...
                  </td>
                </tr>
              } @else {
                @for (u of users(); track u._id) {
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
                          SUPER_ADMIN
                        </span>
                      } @else if (u.role === UserRole.ADMIN) {
                        <span class="px-2.5 py-0.5 rounded-full bg-navy text-white text-[10px] font-bold">
                          ADMIN
                        </span>
                      } @else if (u.role === UserRole.CLERK) {
                        <span class="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold">
                          CLERK (Điều phối)
                        </span>
                      } @else {
                        <span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                          CUSTOMER
                        </span>
                      }
                    </td>
                    <td class="py-3.5 px-4 font-mono font-bold text-amber-600">
                      {{ u.sky_miles | number }} dặm
                    </td>
                    <td class="py-3.5 px-4 text-right">
                      @if (u.role === UserRole.SUPER_ADMIN) {
                        <span class="text-[10px] text-slate-400 italic px-2">Bảo vệ (Hệ thống)</span>
                      } @else {
                        <button
                          type="button"
                          (click)="deleteUser(u)"
                          class="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                          title="Xóa tài khoản"
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
      </div>

    </div>

    <!-- Modal Create User -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-200">
          <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-navy flex items-center gap-2">
              <app-icon name="users" class="w-5 h-5 text-gold" />
              <span>Thêm Tài khoản Mới</span>
            </h3>
            <button (click)="showModal.set(false)" class="text-slate-400 hover:text-slate-600">
              <app-icon name="x" class="w-5 h-5" />
            </button>
          </div>

          <form (ngSubmit)="saveUser()" class="space-y-3 text-xs">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">Họ</label>
                <input
                  type="text"
                  [(ngModel)]="formData.last_name"
                  name="last_name"
                  required
                  placeholder="Lê"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">Tên</label>
                <input
                  type="text"
                  [(ngModel)]="formData.first_name"
                  name="first_name"
                  required
                  placeholder="Minh"
                  class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Tên đăng nhập</label>
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
              <label class="block font-semibold text-slate-600 mb-1">Email</label>
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
              <label class="block font-semibold text-slate-600 mb-1">Mật khẩu</label>
              <input
                type="password"
                [(ngModel)]="formData.password"
                name="password"
                required
                placeholder="Tối thiểu 6 ký tự"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Phân quyền vai trò (Role)</label>
              <select
                [(ngModel)]="formData.role"
                name="role"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-navy"
              >
                <option [value]="UserRole.CLERK">CLERK (Nhân viên Điều phối/Quầy)</option>
                <option [value]="UserRole.CUSTOMER">CUSTOMER (Khách hàng thông thường)</option>
                <!-- SUPER_ADMIN is intentionally NOT allowed to be created -->
              </select>
              <span class="text-[10px] text-amber-700 font-semibold mt-1 block">
                * Quy định bảo mật: Không được phép tạo thêm tài khoản SUPER_ADMIN.
              </span>
            </div>

            <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button type="button" (click)="showModal.set(false)" class="btn-ghost text-xs">Hủy</button>
              <button type="submit" class="btn-gold text-xs !py-2 !px-5 font-bold">Tạo tài khoản</button>
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

  readonly users = signal<User[]>([]);
  readonly loading = signal(false);
  UserRole = UserRole;

  readonly showModal = signal(false);
  formData: any = {};

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading.set(true);
    this.api.getUsers().subscribe({
      next: (list) => {
        this.users.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err.error?.message || 'Không thể tải danh sách người dùng.');
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
      this.toast.warning('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    if (this.formData.role === UserRole.SUPER_ADMIN) {
      this.toast.error('Không được phép tạo tài khoản SUPER_ADMIN');
      return;
    }

    this.api.createUser(this.formData).subscribe({
      next: () => {
        this.toast.success('Tạo tài khoản thành công!');
        this.showModal.set(false);
        this.loadUsers();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Tạo tài khoản thất bại.');
      },
    });
  }

  deleteUser(u: User): void {
    if (u.role === UserRole.SUPER_ADMIN) {
      this.toast.error('Tài khoản SUPER_ADMIN là duy nhất và bất khả xâm phạm (không được phép xóa)');
      return;
    }

    if (!confirm(`Bạn có chắc muốn xóa tài khoản ${u.username}?`)) return;

    this.api.deleteUser(u._id).subscribe({
      next: () => {
        this.toast.success(`Đã xóa tài khoản ${u.username}`);
        this.loadUsers();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Xóa tài khoản thất bại.');
      },
    });
  }
}
