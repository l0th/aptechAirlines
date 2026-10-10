import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BookingStateService } from '../core/booking-state.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="container page"><div class="card success-card">
      <div class="check">✓</div>
      <div class="eyebrow">HOÀN TẤT</div>
      <h1 translate="no">{{completionTitle}}</h1>
      <p class="muted">Lưu mã bên dưới để tra cứu và quản lý hành trình.</p>
      <div class="code" translate="no">{{booking?.blocking_number||booking?.confirmation_number||booking?.pnr_code||'—'}}</div>
      <div class="actions"><a class="btn btn-dark" routerLink="/trips">Chuyến đi của tôi</a><a class="btn btn-outline" routerLink="/">Về trang chủ</a></div>
    </div></div>
  `,
  styles: [`.success-card{max-width:650px;margin:40px auto;padding:45px;text-align:center}.check{width:70px;height:70px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:#e8f7f0;color:#16845b;font-size:34px;font-weight:900}.success-card h1{color:#071b2e}.code{margin:22px auto;padding:15px 20px;border:1px dashed #d6b35a;background:#fff9e8;border-radius:14px;font:900 24px ui-monospace,monospace;color:#805a0b}.actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}`],
})
export class SuccessComponent {
  readonly language = inject(LanguageService);
  booking: any;

  get completionTitle() {
    return this.booking?.status === 'BLOCKED'
      ? this.language.pick('Đã giữ chỗ thành công', 'Booking held successfully')
      : this.language.pick('Đặt vé thành công', 'Booking successful');
  }

  constructor() {
    const router = inject(Router);
    const state = inject(BookingStateService);
    this.booking = router.getCurrentNavigation()?.extras.state?.['booking'] || history.state?.booking;
    state.reset();
  }
}
