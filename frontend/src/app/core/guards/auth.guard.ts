import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isStaff()) {
    return true;
  }

  // Not authorized to access admin portal
  router.navigate(['/'], { queryParams: { auth: 'required' } });
  return false;
};
