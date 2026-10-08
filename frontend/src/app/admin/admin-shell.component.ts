import { Component,inject } from '@angular/core';import { RouterLink,RouterLinkActive,RouterOutlet } from '@angular/router';import { AuthService } from '../core/auth.service';import { LanguageService } from '../core/language.service';import { UiLanguageDirective } from '../shared/ui-language.directive';

/** One sidebar entry. `admin` = only visible to ADMIN/SUPER_ADMIN. */
interface NavItem{path:string;vi:string;en:string;hint?:string;admin?:boolean;exact?:boolean}
/** Sidebar groups, ordered by daily workflow so labels describe the business task, not the module name. */
interface NavGroup{vi:string;en:string;items:NavItem[]}

const NAV:NavGroup[]=[
  {vi:'Tổng quan',en:'Overview',items:[
    {path:'/admin',vi:'Bảng điều khiển',hint:'Doanh thu, tải ghế, báo cáo',en:'Dashboard & reports',admin:true,exact:true},
  ]},
  {vi:'Nghiệp vụ quầy vé',en:'Ticket desk',items:[
    {path:'/admin/reservation-desk',vi:'Đặt vé hộ khách',en:'Book for customer'},
    {path:'/admin/bookings',vi:'Danh sách đặt chỗ',en:'All bookings'},
    {path:'/admin/seat-operations',vi:'Điều phối ghế',hint:'Khóa/mở ghế, giá ghế theo chuyến',en:'Flight seat operations'},
  ]},
  {vi:'Lịch bay & đường bay',en:'Schedule & network',items:[
    {path:'/admin/flights',vi:'Chuyến bay',hint:'Tạo tay, sửa, đổi trạng thái trễ/hủy',en:'Flights (manual / status)',admin:true},
    {path:'/admin/commercial',vi:'Lịch bay định kỳ',hint:'Khung lịch bay thương mại lặp lại',en:'Recurring commercial schedule',admin:true},
    {path:'/admin/airports',vi:'Sân bay & thành phố',en:'Airports & cities',admin:true},
  ]},
  {vi:'Giá & chính sách',en:'Pricing & policy',items:[
    {path:'/admin/fare-pricing',vi:'Giá vé động',hint:'Mua sớm / mức lấp đầy ghế',en:'Dynamic fares',admin:true},
    {path:'/admin/seat-pricing',vi:'Phụ phí chọn ghế',en:'Seat surcharges',admin:true},
    {path:'/admin/policies',vi:'Chính sách hoàn hủy',hint:'% hoàn tiền theo ngày hủy',en:'Refund & cancellation rules',admin:true},
  ]},
  {vi:'Tài khoản & email',en:'Accounts & notifications',items:[
    {path:'/admin/users',vi:'Khách hàng',en:'Customers',admin:true},
    {path:'/admin/staff',vi:'Nhân viên',hint:'Tài khoản CLERK/ADMIN, khóa, reset mật khẩu',en:'Staff & roles',admin:true},
    {path:'/admin/emails',vi:'Email & tự động',hint:'Mẫu email, lịch sử gửi, chạy job demo',en:'Emails & automation',admin:true},
  ]},
];

@Component({standalone:true,imports:[RouterLink,RouterLinkActive,RouterOutlet,UiLanguageDirective],template:`<div class="admin-shell" appUiLanguage><aside class="admin-nav"><div class="admin-brand">APTECH AIRLINES</div><div class="admin-language" role="group" aria-label="Chuyển đổi ngôn ngữ"><button type="button" [class.active]="lang.language()==='vi'" (click)="lang.setLanguage('vi')">VI</button><button type="button" [class.active]="lang.language()==='en'" (click)="lang.setLanguage('en')">EN</button></div>@for(g of groups;track g.vi){@if(visible(g).length){<div class="nav-group">{{vi?g.vi:g.en}}</div>@for(i of visible(g);track i.path){<a [routerLink]="i.path" [title]="i.hint||(vi?i.vi:i.en)" routerLinkActive="active" [routerLinkActiveOptions]="{exact:!!i.exact}">{{vi?i.vi:i.en}}</a>}}}<div class="nav-group"></div><a routerLink="/">{{vi?'← Về trang khách hàng':'← Customer site'}}</a><a (click)="auth.logout()">{{vi?'Đăng xuất':'Logout'}}</a></aside><main class="admin-main"><router-outlet/></main></div>`,styles:[`.admin-nav{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}.admin-nav a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;padding:8px 12px;margin:1px 0}.admin-brand{margin-bottom:20px}.admin-language{display:flex;gap:4px;padding:3px;margin:-12px 0 18px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04)}.admin-language button{flex:1;border:0;border-radius:999px;padding:7px 8px;background:transparent;color:#afbfcc;font-size:10px;font-weight:900}.admin-language button.active{background:#d6b35a;color:#071b2e}.nav-group{font-size:9.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#d6b35a;margin:14px 0 3px;padding:0 12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:860px){.admin-language{min-width:92px;margin:0 4px 0 0}.admin-language button{padding:6px}.nav-group{display:none}}`]})export class AdminShellComponent{auth=inject(AuthService);lang=inject(LanguageService);groups=NAV;get vi(){return this.lang.language()==='vi'}visible(g:NavGroup){return g.items.filter(i=>!i.admin||this.auth.admin())}}
