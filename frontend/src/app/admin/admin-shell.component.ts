import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LanguageService } from '../core/language.service';
import { UiLanguageDirective } from '../shared/ui-language.directive';

interface NavItem {
  path: string;
  vi: string;
  en: string;
  hintVi?: string;
  hintEn?: string;
  admin?: boolean;
  exact?: boolean;
}

interface NavGroup { vi: string; en: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { vi: 'Tổng quan', en: 'Overview', items: [
    { path: '/admin', vi: 'Bảng điều khiển', en: 'Dashboard & reports', hintVi: 'Doanh thu, tải ghế, báo cáo', hintEn: 'Revenue, load factor and reports', admin: true, exact: true },
  ] },
  { vi: 'Nghiệp vụ quầy vé', en: 'Ticket desk', items: [
    { path: '/admin/reservation-desk', vi: 'Đặt vé hộ khách', en: 'Book for customer' },
    { path: '/admin/bookings', vi: 'Danh sách đặt chỗ', en: 'All bookings' },
    { path: '/admin/seat-operations', vi: 'Điều phối ghế', en: 'Flight seat operations', hintVi: 'Khóa/mở ghế, giá ghế theo chuyến', hintEn: 'Block/unblock seats and manage flight seat pricing' },
  ] },
  { vi: 'Lịch bay & đường bay', en: 'Schedule & network', items: [
    { path: '/admin/flights', vi: 'Chuyến bay', en: 'Flights (manual / status)', hintVi: 'Tạo tay, sửa, đổi trạng thái trễ/hủy', hintEn: 'Create, edit and update delay/cancellation status', admin: true },
    { path: '/admin/commercial', vi: 'Lịch bay định kỳ', en: 'Recurring commercial schedule', hintVi: 'Khung lịch bay thương mại lặp lại', hintEn: 'Recurring commercial flight templates', admin: true },
    { path: '/admin/airports', vi: 'Sân bay & thành phố', en: 'Airports & cities', admin: true },
  ] },
  { vi: 'Giá & chính sách', en: 'Pricing & policy', items: [
    { path: '/admin/fare-pricing', vi: 'Giá vé động', en: 'Dynamic fares', hintVi: 'Mua sớm / mức lấp đầy ghế', hintEn: 'Advance purchase and load-factor pricing', admin: true },
    { path: '/admin/seat-pricing', vi: 'Phụ phí chọn ghế', en: 'Seat surcharges', admin: true },
    { path: '/admin/policies', vi: 'Chính sách hoàn hủy', en: 'Refund & cancellation rules', hintVi: '% hoàn tiền theo ngày hủy', hintEn: 'Refund percentage by cancellation date', admin: true },
  ] },
  { vi: 'Tài khoản & email', en: 'Accounts & notifications', items: [
    { path: '/admin/users', vi: 'Khách hàng', en: 'Customers', admin: true },
    { path: '/admin/staff', vi: 'Nhân viên', en: 'Staff & roles', hintVi: 'Tài khoản CLERK/ADMIN, khóa, reset mật khẩu', hintEn: 'CLERK/ADMIN accounts, locking and password resets', admin: true },
    { path: '/admin/emails', vi: 'Email & tự động', en: 'Emails & automation', hintVi: 'Mẫu email, lịch sử gửi, chạy job demo', hintEn: 'Email templates, send history and demo jobs', admin: true },
  ] },
];

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, UiLanguageDirective],
  template: `
    <div class="admin-shell" appUiLanguage>
      <aside class="admin-nav">
        <div class="admin-brand">APTECH AIRLINES</div>
        <div class="admin-language" role="group" [attr.aria-label]="t('Chuyển đổi ngôn ngữ', 'Language selector')">
          <button type="button" [class.active]="lang.language()==='vi'" (click)="lang.setLanguage('vi')">VI</button>
          <button type="button" [class.active]="lang.language()==='en'" (click)="lang.setLanguage('en')">EN</button>
        </div>
        @for(g of groups;track g.vi){
          @if(visible(g).length){
            <div class="nav-group">{{t(g.vi,g.en)}}</div>
            @for(i of visible(g);track i.path){
              <a [routerLink]="i.path" [title]="t(i.hintVi||i.vi,i.hintEn||i.en)" routerLinkActive="active" [routerLinkActiveOptions]="{exact:!!i.exact}">{{t(i.vi,i.en)}}</a>
            }
          }
        }
        <div class="nav-group"></div>
        <a routerLink="/">{{t('← Về trang khách hàng','← Customer site')}}</a>
        <a (click)="auth.logout()">{{t('Đăng xuất','Logout')}}</a>
      </aside>
      <main class="admin-main"><router-outlet/></main>
    </div>
  `,
  styles: [`.admin-nav{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}.admin-nav a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;padding:8px 12px;margin:1px 0}.admin-brand{margin-bottom:20px}.admin-language{display:flex;gap:4px;padding:3px;margin:-12px 0 18px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04)}.admin-language button{flex:1;border:0;border-radius:999px;padding:7px 8px;background:transparent;color:#afbfcc;font-size:10px;font-weight:900}.admin-language button.active{background:#d6b35a;color:#071b2e}.nav-group{font-size:9.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#d6b35a;margin:14px 0 3px;padding:0 12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:860px){.admin-language{min-width:92px;margin:0 4px 0 0}.admin-language button{padding:6px}.nav-group{display:none}}`],
})
export class AdminShellComponent {
  auth = inject(AuthService);
  lang = inject(LanguageService);
  groups = NAV;
  t(vi: string, en: string) { return this.lang.pick(vi, en); }
  visible(g: NavGroup) { return g.items.filter(i => !i.admin || this.auth.admin()); }
}
