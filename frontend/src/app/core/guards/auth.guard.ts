import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard cho phép nhân viên vận hành (CLERK, ADMIN, SUPER_ADMIN)
 * truy cập vào phân hệ /admin chung hoặc các trang nghiệp vụ quầy vé.
 */
export const staffGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isStaff()) {
    return true;
  }

  // Chưa đăng nhập hoặc không phải nhân viên
  router.navigate(['/'], { queryParams: { auth: 'required' } });
  return false;
};

/**
 * Guard chỉ cho phép ADMIN và SUPER_ADMIN quản trị hệ thống
 * (Chuyến bay, Đồng bộ AirLabs, Sân bay, Người dùng, Chính sách).
 * Nếu CLERK vô tình truy cập, chuyển hướng về Bàn làm việc (/admin/reservation-desk).
 */
export const adminOnlyGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isAdmin()) {
    return true;
  }

  // Nếu là CLERK, điều hướng an toàn về bàn làm việc nghiệp vụ
  if (authService.isAuthenticated() && authService.isClerk()) {
    router.navigate(['/admin/reservation-desk']);
    return false;
  }

  // Khách hoặc chưa xác thực
  router.navigate(['/'], { queryParams: { auth: 'required' } });
  return false;
};

/** Giữ bí danh adminGuard để tương thích ngược */
export const adminGuard = staffGuard;
