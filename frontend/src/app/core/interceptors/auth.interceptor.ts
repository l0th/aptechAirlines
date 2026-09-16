import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Gắn JWT vào mọi request tới /api/.
 *
 * LƯU Ý QUAN TRỌNG: KHÔNG inject AuthService ở đây.
 * AuthService gọi GET /api/auth/me ngay trong constructor để làm mới hồ sơ, nên
 * nếu interceptor lại inject(AuthService) thì phát sinh phụ thuộc vòng khi request
 * đầu tiên chạy → request làm mới hồ sơ thất bại (dặm SkyMiles, tên... không cập
 * nhật) và trước đây còn khiến người dùng bị đăng xuất ngay khi tải lại trang.
 * Token luôn được AuthService đồng bộ vào localStorage khi đăng nhập/đăng xuất.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = readToken();

  if (token && req.url.includes('/api/')) {
    const cloned = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
    return next(cloned);
  }

  return next(req);
};

function readToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}
