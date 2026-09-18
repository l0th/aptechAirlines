import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResponse, RegisterPayload, User, UserRole } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(this.getStoredToken());
  readonly currentUser = signal<User | null>(this.getStoredUser());

  readonly isAuthenticated = computed(() => !!this.token() && !!this.currentUser());
  readonly userRole = computed(() => this.currentUser()?.role || null);
  readonly isAdmin = computed(
    () => this.userRole() === UserRole.ADMIN || this.userRole() === UserRole.SUPER_ADMIN,
  );
  readonly isClerk = computed(() => this.userRole() === UserRole.CLERK);
  readonly isStaff = computed(
    () =>
      this.userRole() === UserRole.CLERK ||
      this.userRole() === UserRole.ADMIN ||
      this.userRole() === UserRole.SUPER_ADMIN,
  );
  readonly isSuperAdmin = computed(() => this.userRole() === UserRole.SUPER_ADMIN);

  constructor() {
    if (this.token()) {
      this.refreshProfile();
    }
  }

  login(credentials: { username: string; password: string }): Observable<AuthResponse> {
    return this.api.login(credentials).pipe(
      tap((res) => {
        this.setSession(res.access_token, res.user);
      }),
    );
  }

  register(userData: RegisterPayload): Observable<AuthResponse> {
    return this.api.register(userData).pipe(
      tap((res) => {
        this.setSession(res.access_token, res.user);
      }),
    );
  }

  refreshProfile(): void {
    this.api.getProfile().subscribe({
      next: (user) => {
        const normalized = this.normalizeUser(user);
        this.currentUser.set(normalized);
        localStorage.setItem('auth_user', JSON.stringify(normalized));
      },
      error: (err) => {
        // Chỉ đăng xuất khi token thực sự không hợp lệ (401/403).
        // Lỗi mạng/backend đang khởi động lại không được phép xoá phiên đăng nhập,
        // vì như vậy người dùng đang thao tác sẽ bị đá ra ngoài.
        if (err?.status === 401 || err?.status === 403) {
          this.logout();
        }
      },
    });
  }

  logout(): void {
    this.token.set(null);
    this.currentUser.set(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    this.router.navigate(['/']);
  }

  private setSession(token: string, user: User): void {
    const normalized = this.normalizeUser(user);
    this.token.set(token);
    this.currentUser.set(normalized);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(normalized));
  }

  /**
   * Backend cũ trả `user.id` trong khi mọi component dùng `user._id`
   * (khớp document User và GET /api/auth/me). Chuẩn hoá tại đây để khách vừa
   * đăng nhập/đăng ký không bị coi là "chưa đăng nhập".
   */
  private normalizeUser(user: any): User {
    if (user && !user._id && user.id) {
      return { ...user, _id: user.id } as User;
    }
    return user as User;
  }

  private getStoredToken(): string | null {
    try {
      return localStorage.getItem('auth_token');
    } catch {
      return null;
    }
  }

  private getStoredUser(): User | null {
    try {
      const u = localStorage.getItem('auth_user');
      return u ? this.normalizeUser(JSON.parse(u)) : null;
    } catch {
      return null;
    }
  }
}
