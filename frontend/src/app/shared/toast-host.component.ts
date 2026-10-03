import { Component, inject } from '@angular/core';
import { LanguageService } from '../core/language.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  template: `
    @if(toast.current(); as item) {
      <div class="toast-wrap" role="status" aria-live="polite">
        <section
          class="toast-card"
          [class.success]="item.kind==='success'"
          [class.error]="item.kind==='error'"
          [class.confirm]="item.kind==='confirm'">
          <div class="toast-copy">
            <strong>{{text(item.titleVi,item.titleEn)}}</strong>
            @if(item.messageVi || item.messageEn) {
              <span>{{text(item.messageVi||'',item.messageEn||item.messageVi||'')}}</span>
            }
          </div>

          @if(item.kind==='confirm') {
            <div class="toast-actions">
              <button type="button" class="toast-btn" (click)="toast.reject()">
                {{text(item.cancelVi||'Hủy',item.cancelEn||'Cancel')}}
              </button>
              <button type="button" class="toast-btn danger" (click)="toast.accept()">
                {{text(item.confirmVi||'Xác nhận',item.confirmEn||'Confirm')}}
              </button>
            </div>
          } @else {
            <button type="button" class="toast-close" [attr.aria-label]="text('Đóng','Close')" (click)="toast.dismiss()">×</button>
          }
        </section>
      </div>
    }
  `,
  styles: [`
    .toast-wrap{position:fixed;top:22px;right:22px;z-index:10000;width:min(410px,calc(100vw - 32px));pointer-events:none}
    .toast-card{pointer-events:auto;display:flex;align-items:flex-start;gap:14px;padding:16px;border:1px solid #ead7a3;border-radius:16px;background:#fff;box-shadow:0 18px 55px rgba(4,18,31,.24)}
    .toast-card.success{border-color:#b9dbc5}.toast-card.error{border-color:#e5baba}.toast-card.error .toast-copy strong{color:#9b3030}
    .toast-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.toast-copy strong{color:#071b2e;font-size:14px}.toast-copy span{color:#627184;font-size:12px;line-height:1.45}
    .toast-actions{display:flex;gap:7px;align-self:center}.toast-btn,.toast-close{border:0;font:inherit;font-weight:800;cursor:pointer}
    .toast-btn{padding:8px 11px;border-radius:10px;background:#eef2f5;color:#24384d;font-size:12px}.toast-btn.danger{background:#b43a3a;color:#fff}
    .toast-close{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#eef2f5;color:#506176;font-size:18px}
    @media(max-width:700px){.toast-wrap{top:12px;right:12px;width:calc(100vw - 24px)}.toast-card{flex-wrap:wrap}.toast-actions{width:100%;justify-content:flex-end}}
  `],
})
export class ToastHostComponent {
  readonly toast = inject(ToastService);
  private readonly language = inject(LanguageService);
  text(vi: string, en: string) { return this.language.language() === 'vi' ? vi : en; }
}
