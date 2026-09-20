import { Injectable, signal } from '@angular/core';

export type AuthModalMode = 'LOGIN' | 'REGISTER';

/**
 * Global state for the Auth Modal (login / register).
 * The modal itself is rendered once inside the global NavbarComponent,
 * but any page (e.g. Booking page requiring login before purchase)
 * can open it via this shared service.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthModalService {
  readonly isOpen = signal(false);
  readonly mode = signal<AuthModalMode>('LOGIN');

  open(mode: AuthModalMode = 'LOGIN'): void {
    this.mode.set(mode);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(mode: AuthModalMode = 'LOGIN'): void {
    if (!this.isOpen()) {
      this.mode.set(mode);
      this.isOpen.set(true);
    } else {
      this.isOpen.set(false);
    }
  }
}
