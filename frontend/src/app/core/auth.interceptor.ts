import { HttpInterceptorFn } from '@angular/common/http';

/** Website language (VI/EN switch) — sent so the backend can email customers in the same language. */
function currentLanguage(): 'vi' | 'en' {
  try {
    return localStorage.getItem('aptech-airlines-language') === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('auth_token');
  const setHeaders: Record<string, string> = { 'X-Lang': currentLanguage() };
  if (token) setHeaders['Authorization'] = `Bearer ${token}`;
  return next(req.clone({ setHeaders }));
};
