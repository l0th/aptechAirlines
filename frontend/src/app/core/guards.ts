import { inject } from '@angular/core';import { CanActivateFn,Router } from '@angular/router';import { AuthService } from './auth.service';
export const authGuard:CanActivateFn=()=>{const a=inject(AuthService);return a.authenticated()?true:inject(Router).createUrlTree(['/auth'])};
export const staffGuard:CanActivateFn=()=>{const a=inject(AuthService);return a.staff()?true:inject(Router).createUrlTree(['/'])};
export const adminGuard:CanActivateFn=()=>{const a=inject(AuthService);return a.admin()?true:inject(Router).createUrlTree(['/admin'])};
