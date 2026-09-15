import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-sm pointer-events-none">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 p-4 rounded-2xl shadow-xl border backdrop-blur-md transition-all duration-300 animate-slide-in"
          [ngClass]="{
            'bg-emerald-50 border-emerald-200 text-emerald-900': toast.type === 'success',
            'bg-rose-50 border-rose-200 text-rose-900': toast.type === 'error',
            'bg-amber-50 border-amber-200 text-amber-900': toast.type === 'warning',
            'bg-navy text-white border-slate-700': toast.type === 'info'
          }"
        >
          <div class="mt-0.5 shrink-0">
            @if (toast.type === 'success') {
              <app-icon name="checkcircle2" class="w-5 h-5 text-emerald-600" />
            } @else if (toast.type === 'error') {
              <app-icon name="alerttriangle" class="w-5 h-5 text-rose-600" />
            } @else if (toast.type === 'warning') {
              <app-icon name="alerttriangle" class="w-5 h-5 text-amber-500" />
            } @else {
              <app-icon name="info" class="w-5 h-5 text-gold" />
            }
          </div>
          <div class="flex-1 min-w-0">
            @if (toast.title) {
              <h4 class="text-sm font-bold">{{ toast.title }}</h4>
            }
            <p class="text-xs mt-0.5 leading-relaxed opacity-90">{{ toast.message }}</p>
          </div>
          <button
            (click)="toastService.remove(toast.id)"
            class="shrink-0 p-1 hover:opacity-75 transition-opacity"
          >
            <app-icon name="x" class="w-4 h-4" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
