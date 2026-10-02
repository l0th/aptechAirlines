import { Component, inject } from '@angular/core';
import { RouterLink,RouterLinkActive,RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LanguageService } from '../core/language.service';
import { IconComponent } from './icon.component';
import { UiLanguageDirective } from './ui-language.directive';
import { BrandLogoComponent } from './brand-logo.component';

@Component({selector:'app-site-shell',standalone:true,imports:[RouterLink,RouterLinkActive,RouterOutlet,IconComponent,UiLanguageDirective,BrandLogoComponent],template:`
<div appUiLanguage class="site-language-root">
  <header class="topbar">
    <div class="container nav">
      <a routerLink="/" class="brand" aria-label="Aptech Airlines"><app-brand-logo [compact]="true"/></a>
      <nav>
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Tìm chuyến</a>
        <a routerLink="/lookup" routerLinkActive="active">Lịch bay</a>
        <a routerLink="/trips" routerLinkActive="active">Chuyến đi</a>
        <a routerLink="/skymiles" routerLinkActive="active">SkyMiles</a>
      </nav>
      <div class="account">
        <div class="language-switch" role="group" aria-label="Chuyển đổi ngôn ngữ"><button type="button" [class.active]="lang.language()==='vi'" (click)="lang.setLanguage('vi')">VI</button><button type="button" [class.active]="lang.language()==='en'" (click)="lang.setLanguage('en')">EN</button></div>
        @if(auth.staff()){<a class="admin-link" routerLink="/admin">Staff Portal</a>}
        @if(auth.authenticated()){<button class="user-btn" routerLink="/profile"><app-icon name="user" [size]="16"/>{{auth.user()?.first_name||auth.user()?.username}}</button><button class="logout" (click)="auth.logout()">Thoát</button>}@else{<a class="login" routerLink="/auth">Đăng nhập</a>}
      </div>
    </div>
  </header>
  <main><router-outlet/></main>
  <footer>
    <div class="footer-topline"></div>
    <div class="container footer-main">
      <div class="footer-about">
        <app-brand-logo/>
        <p>Bay thông minh hơn với hành trình rõ ràng, quản lý vé trực tuyến, ghế linh hoạt và SkyMiles cho khách hàng thân thiết.</p>
        <div class="trust-row"><span>330 ngày đặt trước</span><span>PayPal Checkout</span><span>VI / EN</span></div>
      </div>
      <div class="footer-col"><strong>Khám phá</strong><a routerLink="/">Tìm chuyến bay</a><a routerLink="/lookup">Lịch bay</a><a routerLink="/skymiles">SkyMiles</a></div>
      <div class="footer-col"><strong>Quản lý chuyến đi</strong><a routerLink="/trips">Chuyến đi của tôi</a><a routerLink="/reschedule-info">Đổi chuyến</a><a routerLink="/cancellation-refund">Hủy vé & hoàn tiền</a></div>
      <div class="footer-col"><strong>Trải nghiệm bay</strong><a routerLink="/seat-fees">Chọn ghế & phụ phí</a><a routerLink="/track">Tra cứu vé</a><a routerLink="/profile">Hồ sơ khách hàng</a></div>
      <div class="footer-col"><strong>Hỗ trợ</strong><span>Giữ chỗ khi chuyến còn hơn 14 ngày</span><span>Hoàn tiền theo nguồn thanh toán gốc</span><span>Thanh toán online qua PayPal</span></div>
    </div>
    <div class="container footer-bottom"><span>© 2026 Aptech Airlines</span><span>Fly Beyond · Travel with confidence</span></div>
  </footer>
</div>`,styles:[`
.topbar{background:#071b2e;color:white;position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,.08);box-shadow:0 10px 30px rgba(7,27,46,.08)}.nav{height:74px;display:flex;align-items:center;gap:26px}.brand{display:flex;align-items:center}.nav nav{display:flex;gap:8px;flex:1}.nav nav a{padding:10px 12px;border-radius:10px;font-size:13px;color:#cbd8e2;font-weight:700}.nav nav a.active,.nav nav a:hover{background:#102f4a;color:white}.account{display:flex;gap:8px;align-items:center}.login,.admin-link,.user-btn,.logout{border:1px solid rgba(255,255,255,.15);background:transparent;color:white;border-radius:999px;padding:9px 13px;font-size:12px;font-weight:800}.admin-link{color:#f2c85f}.user-btn{display:flex;align-items:center;gap:6px}.logout{color:#bfcbd4}.language-switch{display:flex;padding:3px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(255,255,255,.04)}.language-switch button{border:0;background:transparent;color:#aebdca;border-radius:999px;padding:6px 8px;font-size:10px;font-weight:900;letter-spacing:.04em}.language-switch button.active{background:#d6b35a;color:#071b2e}footer{background:#04131f;color:#aebdca}.footer-topline{height:4px;background:linear-gradient(90deg,#d4af37,#f2c85f 45%,#a67817)}.footer-main{display:grid;grid-template-columns:1.8fr repeat(4,1fr);gap:36px;padding:54px 0 40px}.footer-about p{max-width:390px;line-height:1.75;font-size:13px;margin:20px 0}.trust-row{display:flex;gap:7px;flex-wrap:wrap}.trust-row span{border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:7px 10px;font-size:10px;color:#c6d1da}.footer-col strong{display:block;color:#fff;margin-bottom:15px;font-size:13px}.footer-col a,.footer-col span{display:block;margin:9px 0;font-size:12px;line-height:1.45;color:#9eafbd}.footer-col a:hover{color:#f2c85f}.footer-bottom{border-top:1px solid rgba(255,255,255,.08);padding:18px 0 26px;display:flex;justify-content:space-between;gap:16px;font-size:10px;color:#708493}@media(max-width:1100px){.footer-main{grid-template-columns:2fr repeat(2,1fr)}.footer-about{grid-row:span 2}}@media(max-width:980px){.nav{gap:12px}.nav nav{gap:2px}.nav nav a{padding:9px 8px}}@media(max-width:820px){.nav nav{display:none}.account{margin-left:auto}.footer-main{grid-template-columns:1fr 1fr}.footer-about{grid-column:1/-1;grid-row:auto}.admin-link{display:none}}@media(max-width:520px){.user-btn{max-width:120px;overflow:hidden}.logout{display:none}.language-switch button{padding:6px 7px}.footer-main{grid-template-columns:1fr}.footer-about{grid-column:auto}.footer-bottom{flex-direction:column}}
`]
})export class SiteShellComponent{auth=inject(AuthService);lang=inject(LanguageService)}
