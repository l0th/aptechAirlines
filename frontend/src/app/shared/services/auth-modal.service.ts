import { Injectable, signal } from '@angular/core';

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

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.update((v) => !v);
  }
}
