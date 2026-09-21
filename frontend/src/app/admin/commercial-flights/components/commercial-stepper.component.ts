import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-commercial-stepper',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="card-luxury p-4 sm:p-5">
      <div class="flex items-center justify-between gap-2 sm:gap-4 overflow-x-auto pb-1 sm:pb-0">
        <!-- Step 1 -->
        <div
          class="flex items-center gap-3 text-left p-2.5 rounded-2xl transition-all duration-200 shrink-0 select-none"
          [ngClass]="{
            'bg-navy text-white shadow-md': currentStep === 1,
            'bg-emerald-50 text-emerald-900 border border-emerald-200/80': currentStep > 1 && step1Done,
            'text-slate-400 opacity-60': currentStep !== 1 && !step1Done
          }"
        >
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs transition-colors shrink-0"
            [ngClass]="{
              'bg-gold text-navy shadow-sm': currentStep === 1,
              'bg-emerald-500 text-white': currentStep > 1 && step1Done,
              'bg-slate-100 text-slate-500': currentStep !== 1 && !step1Done
            }"
          >
            @if (step1Done && currentStep > 1) {
              <app-icon name="checkcircle2" class="w-5 h-5 text-white" />
            } @else {
              <app-icon name="search" class="w-4 h-4" />
            }
          </div>
          <div>
            <span class="block text-xs font-bold leading-tight" [class.text-white]="currentStep === 1">
              {{ lang.t('admin.commercial.step1Title') }}
            </span>
            <span class="text-[11px] leading-tight hidden lg:block" [ngClass]="currentStep === 1 ? 'text-slate-300' : 'text-slate-400'">
              {{ lang.t('admin.commercial.step1Desc') }}
            </span>
          </div>
        </div>

        <div class="h-0.5 w-6 sm:w-10 bg-slate-200 shrink-0" [class.bg-emerald-400]="step1Done"></div>

        <!-- Step 2 -->
        <button
          type="button"
          (click)="onStepClick(2)"
          [class.cursor-pointer]="step2Done"
          [disabled]="!step2Done && currentStep !== 2"
          class="flex items-center gap-3 text-left p-2.5 rounded-2xl transition-all duration-200 shrink-0 select-none group"
          [ngClass]="{
            'bg-navy text-white shadow-md': currentStep === 2,
            'bg-emerald-50 text-emerald-900 border border-emerald-200/80': currentStep > 2 && step2Done,
            'text-slate-400 opacity-60': currentStep !== 2 && !step2Done
          }"
        >
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs transition-colors shrink-0"
            [ngClass]="{
              'bg-gold text-navy shadow-sm': currentStep === 2,
              'bg-emerald-500 text-white': currentStep > 2 && step2Done,
              'bg-slate-100 text-slate-500': currentStep !== 2 && !step2Done
            }"
          >
            @if (step2Done && currentStep > 2) {
              <app-icon name="checkcircle2" class="w-5 h-5 text-white" />
            } @else {
              <app-icon name="compass" class="w-4 h-4" />
            }
          </div>
          <div>
            <span class="block text-xs font-bold leading-tight" [class.text-white]="currentStep === 2">
              {{ lang.t('admin.commercial.step2Title') }}
            </span>
            <span class="text-[11px] leading-tight hidden lg:block" [ngClass]="currentStep === 2 ? 'text-slate-300' : 'text-slate-400'">
              {{ lang.t('admin.commercial.step2Desc') }}
            </span>
          </div>
        </button>

        <div class="h-0.5 w-6 sm:w-10 bg-slate-200 shrink-0" [class.bg-emerald-400]="step2Done"></div>

        <!-- Step 3 -->
        <div
          class="flex items-center gap-3 text-left p-2.5 rounded-2xl transition-all duration-200 shrink-0 select-none"
          [ngClass]="{
            'bg-navy text-white shadow-md': currentStep === 3,
            'bg-emerald-50 text-emerald-900 border border-emerald-200/80': currentStep > 3 && step3Done,
            'text-slate-400 opacity-60': currentStep !== 3 && !step3Done
          }"
        >
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs transition-colors shrink-0"
            [ngClass]="{
              'bg-gold text-navy shadow-sm': currentStep === 3,
              'bg-emerald-500 text-white': currentStep > 3 && step3Done,
              'bg-slate-100 text-slate-500': currentStep !== 3 && !step3Done
            }"
          >
            @if (step3Done && currentStep > 3) {
              <app-icon name="checkcircle2" class="w-5 h-5 text-white" />
            } @else {
              <app-icon name="slidershorizontal" class="w-4 h-4" />
            }
          </div>
          <div>
            <span class="block text-xs font-bold leading-tight" [class.text-white]="currentStep === 3">
              {{ lang.t('admin.commercial.step3Title') }}
            </span>
            <span class="text-[11px] leading-tight hidden lg:block" [ngClass]="currentStep === 3 ? 'text-slate-300' : 'text-slate-400'">
              {{ lang.t('admin.commercial.step3Desc') }}
            </span>
          </div>
        </div>

        <div class="h-0.5 w-6 sm:w-10 bg-slate-200 shrink-0" [class.bg-emerald-400]="step3Done"></div>

        <!-- Step 4 -->
        <div
          class="flex items-center gap-3 text-left p-2.5 rounded-2xl transition-all duration-200 shrink-0 select-none"
          [ngClass]="{
            'bg-navy text-white shadow-md': currentStep === 4,
            'bg-emerald-50 text-emerald-900 border border-emerald-200/80': step4Done,
            'text-slate-400 opacity-60': currentStep !== 4 && !step4Done
          }"
        >
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs transition-colors shrink-0"
            [ngClass]="{
              'bg-gold text-navy shadow-sm': currentStep === 4,
              'bg-emerald-500 text-white': step4Done,
              'bg-slate-100 text-slate-500': currentStep !== 4 && !step4Done
            }"
          >
            @if (step4Done) {
              <app-icon name="checkcircle2" class="w-5 h-5 text-white" />
            } @else {
              <app-icon name="calendar" class="w-4 h-4" />
            }
          </div>
          <div>
            <span class="block text-xs font-bold leading-tight" [class.text-white]="currentStep === 4">
              {{ lang.t('admin.commercial.step4Title') }}
            </span>
            <span class="text-[11px] leading-tight hidden lg:block" [ngClass]="currentStep === 4 ? 'text-slate-300' : 'text-slate-400'">
              {{ lang.t('admin.commercial.step4Desc') }}
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CommercialStepperComponent {
  readonly lang = inject(LanguageService);

  @Input() currentStep = 1;
  @Input() step1Done = false;
  @Input() step2Done = false;
  @Input() step3Done = false;
  @Input() step4Done = false;

  @Output() stepClick = new EventEmitter<number>();

  onStepClick(step: number): void {
    if (step === 2) {
      this.stepClick.emit(step);
    }
  }
}
