import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error' | 'confirm';

export interface ToastContent {
  titleVi: string;
  titleEn: string;
  messageVi?: string;
  messageEn?: string;
}

export interface ConfirmToastContent extends ToastContent {
  confirmVi?: string;
  confirmEn?: string;
  cancelVi?: string;
  cancelEn?: string;
}

export interface ToastItem extends ToastContent {
  kind: ToastKind;
  confirmVi?: string;
  confirmEn?: string;
  cancelVi?: string;
  cancelEn?: string;
  resolve?: (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<ToastItem | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  confirm(content: ConfirmToastContent): Promise<boolean> {
    this.dismiss(false);
    return new Promise<boolean>((resolve) => {
      this.current.set({
        kind: 'confirm',
        ...content,
        confirmVi: content.confirmVi || 'Xác nhận',
        confirmEn: content.confirmEn || 'Confirm',
        cancelVi: content.cancelVi || 'Hủy',
        cancelEn: content.cancelEn || 'Cancel',
        resolve,
      });
    });
  }

  success(content: ToastContent, duration = 3500) {
    this.show('success', content, duration);
  }

  error(content: ToastContent, duration = 4500) {
    this.show('error', content, duration);
  }

  info(content: ToastContent, duration = 3500) {
    this.show('info', content, duration);
  }

  /** Show a plain error text (validation or API error) as a toast. Empty text is ignored. */
  notifyError(text: string) {
    if (!text) return;
    this.error({ titleVi: 'Không thể thực hiện', titleEn: 'Action failed', messageVi: text, messageEn: text }, 5500);
  }

  /** Show a plain success text as a toast. Empty text is ignored. */
  notifySuccess(text: string) {
    if (!text) return;
    this.success({ titleVi: 'Thành công', titleEn: 'Success', messageVi: text, messageEn: text });
  }

  accept() {
    const item = this.current();
    if (item?.kind === 'confirm') item.resolve?.(true);
    this.clearTimer();
    this.current.set(null);
  }

  reject() {
    this.dismiss(false);
  }

  dismiss(confirmResult = false) {
    const item = this.current();
    if (item?.kind === 'confirm') item.resolve?.(confirmResult);
    this.clearTimer();
    this.current.set(null);
  }

  private show(kind: Exclude<ToastKind, 'confirm'>, content: ToastContent, duration: number) {
    this.dismiss(false);
    this.current.set({ kind, ...content });
    this.timer = setTimeout(() => {
      this.current.set(null);
      this.timer = null;
    }, duration);
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
