import { Injectable, signal } from '@angular/core';

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

  success(message: string, title = 'Thành công'): void {
    this.show(message, 'success', title);
  }

  error(message: string, title = 'Lỗi'): void {
    this.show(message, 'error', title);
  }

  warning(message: string, title = 'Cảnh báo'): void {
    this.show(message, 'warning', title);
  }

  info(message: string, title = 'Thông báo'): void {
    this.show(message, 'info', title);
  }

  remove(id: number): void {
    this.toasts.update((current) => current.filter((t) => t.id !== id));
  }
}
