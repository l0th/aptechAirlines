import { Injectable, inject, signal } from '@angular/core';
import { LanguageService } from '../../core/services/language.service';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private readonly lang = inject(LanguageService);
  readonly toasts = signal<Toast[]>([]);
  private counter = 0;

  show(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', title?: string): void {
    const id = ++this.counter;
    const toast: Toast = { id, type, title, message };
    this.toasts.update((current) => [...current, toast]);

    setTimeout(() => {
      this.remove(id);
    }, 4500);
  }

  success(message: string, title?: string): void {
    this.show(message, 'success', title ?? (this.lang.isVietnamese() ? 'Thành công' : 'Success'));
  }

  error(message: string, title?: string): void {
    this.show(message, 'error', title ?? (this.lang.isVietnamese() ? 'Lỗi' : 'Error'));
  }

  warning(message: string, title?: string): void {
    this.show(message, 'warning', title ?? (this.lang.isVietnamese() ? 'Cảnh báo' : 'Warning'));
  }

  info(message: string, title?: string): void {
    this.show(message, 'info', title ?? (this.lang.isVietnamese() ? 'Thông báo' : 'Information'));
  }

  remove(id: number): void {
    this.toasts.update((current) => current.filter((t) => t.id !== id));
  }
}
