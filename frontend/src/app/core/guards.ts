import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Preserve a requested route through login without allowing an external redirect. */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(candidate)) {
    return '/';
  }
  return candidate;
}

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.authenticated()
    ? true
    : inject(Router).createUrlTree(['/auth'], { queryParams: { next: safeReturnPath(state.url) } });
};

export const staffGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.staff() ? true : inject(Router).createUrlTree(['/']);
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.admin() ? true : inject(Router).createUrlTree(['/admin']);
};
