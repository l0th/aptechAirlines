import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingStateService } from '../core/booking-state.service';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
    <div class="eyebrow">CLERK / ADMIN</div>
    <h1 class="title">Reservation Desk</h1>
    <p class="subtitle">Đặt vé thay khách hàng đã đăng ký và xử lý vé tại quầy.</p>

    <div class="desk-grid">
      <section class="card customer-panel">
        <div class="panel-head">
          <div><span class="step">1</span><strong>Chọn khách hàng</strong></div>
          <span class="pill pill-gold">{{customers.length}} khách hàng</span>
        </div>
        <div class="search-row">
          <input class="control" [(ngModel)]="query" (ngModelChange)="page=1" placeholder="Tên, tên đăng nhập, email, điện thoại">
          <button class="btn btn-outline" (click)="load()" [disabled]="loading">Làm mới</button>
        </div>

        @if(error){<p class="error">{{error}}</p>}
        @if(loading){<div class="empty muted">Đang tải khách hàng…</div>}
        @else{
          <div class="customers">
            @for(c of paged;track c._id){
              <button class="customer" [class.selected]="selected?._id===c._id" (click)="selected=c">
                <span class="avatar">{{initials(c)}}</span>
                <span class="identity"><strong>{{c.first_name}} {{c.last_name}}</strong><small>@{{c.username}} · {{c.email}}</small></span>
                <span class="meta"><b>{{number(c.sky_miles)}} mi</b><small>{{c.has_preferred_credit_card?'Có thẻ hồ sơ':'Chưa có thẻ'}}</small></span>
              </button>
            }
            @if(!filtered.length){<div class="empty muted">Không tìm thấy CUSTOMER phù hợp.</div>}
          </div>
          <app-pagination [total]="filtered.length" [(page)]="page" [(pageSize)]="pageSize" />
        }
      </section>

      <section class="actions-panel">
        <div class="card action-card">
          <div class="panel-head"><div><span class="step">2</span><strong>Tạo đặt chỗ mới</strong></div></div>
          @if(selected){
            <div class="selected-customer">
              <span class="avatar large">{{initials(selected)}}</span>
              <div><strong>{{selected.first_name}} {{selected.last_name}}</strong><small>@{{selected.username}} · {{selected.email}}</small><small>{{selected.phone_number||'Không có số điện thoại'}}</small></div>
            </div>
            <p class="muted">Luồng tìm chuyến → hành khách → ghế → kiểm tra sẽ giữ đúng khách hàng này làm chủ đặt chỗ.</p>
            <button class="btn btn-primary full" (click)="startBooking()">Bắt đầu đặt vé cho khách</button>
          }@else{
            <div class="empty muted">Chọn khách hàng ở cột bên trái trước.</div>
          }
        </div>

        <div class="card action-card">
          <div class="panel-head"><div><span class="step">3</span><strong>Đổi / hủy đặt chỗ</strong></div></div>
          <div class="field"><span>PNR / Confirmation / Blocking code</span><input class="control" [(ngModel)]="bookingCode" placeholder="CNF-XXXXXX"></div>
          <div class="ticket-actions">
            <button class="btn btn-outline" (click)="track()" [disabled]="!bookingCode.trim()">Tra cứu</button>
            <button class="btn btn-dark" (click)="reschedule()" [disabled]="!bookingCode.trim()">Đổi chuyến</button>
          </div>
        </div>

        <div class="card info-card">
          <strong>Nghiệp vụ nhân viên</strong>
          <p>Đặt chỗ mới dùng <b>user_id của KHÁCH HÀNG được chọn</b>. PayPal chỉ dành cho thanh toán của khách hàng; tại quầy dùng giữ chỗ hoặc thẻ hồ sơ khách hàng.</p>
        </div>
      </section>
    </div>
  `,
  styles:[`
    .desk-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(340px,.75fr);gap:18px;margin-top:22px}.customer-panel,.action-card,.info-card{padding:20px}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.panel-head>div{display:flex;align-items:center;gap:9px;color:#071b2e}.step{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#f2c85f;font-size:11px;font-weight:900}.search-row{display:flex;gap:8px}.search-row input{flex:1}.customers{display:grid;gap:8px;max-height:570px;overflow:auto;margin-top:14px;padding-right:3px}.customer{border:1px solid #e0e7ed;background:#fff;border-radius:16px;padding:12px;display:grid;grid-template-columns:42px 1fr auto;gap:11px;align-items:center;text-align:left;color:#203446}.customer:hover,.customer.selected{border-color:#d6b35a;background:#fffaf0;box-shadow:0 0 0 3px rgba(214,179,90,.1)}.avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#0e3150;color:#f2c85f;font-weight:900}.avatar.large{width:52px;height:52px}.identity,.meta,.selected-customer>div{display:grid;gap:3px;min-width:0}.identity strong,.selected-customer strong{color:#071b2e}.identity small,.meta small,.selected-customer small{color:#718093;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{text-align:right}.meta b{font-size:11px;color:#a67717}.actions-panel{display:grid;gap:14px;align-content:start}.selected-customer{display:flex;gap:12px;align-items:center;background:#f7f9fb;border-radius:16px;padding:13px}.action-card p{line-height:1.6}.full{width:100%;margin-top:8px}.ticket-actions{display:flex;gap:8px;margin-top:12px}.ticket-actions .btn{flex:1}.info-card{background:#0b2740;color:#d3e0ea;border:0}.info-card strong{color:#f2c85f}.info-card p{font-size:12px;line-height:1.65;margin-bottom:0}.empty{padding:25px;text-align:center}.btn:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.desk-grid{grid-template-columns:1fr}}@media(max-width:560px){.customer{grid-template-columns:42px 1fr}.meta{grid-column:2;text-align:left}.search-row,.ticket-actions{flex-direction:column}}
  `]
})
export class ReservationDeskComponent{
  api=inject(ApiService);
  state=inject(BookingStateService);
  router=inject(Router);
  customers:any[]=[]; selected:any=null; query=''; bookingCode=''; loading=true; error='';page=1;pageSize=20;

  constructor(){this.load()}
  get filtered(){
    const q=this.query.trim().toLowerCase();
    if(!q)return this.customers;
    return this.customers.filter(c=>[c.first_name,c.last_name,c.username,c.email,c.phone_number].some(v=>String(v||'').toLowerCase().includes(q)));
  }
  get paged(){const start=(this.page-1)*this.pageSize;return this.filtered.slice(start,start+this.pageSize)}
  load(){
    this.loading=true;this.error='';
    this.api.users().subscribe({
      next:r=>{this.customers=(r||[]).filter((u:any)=>u.role==='CUSTOMER');this.page=1;this.loading=false},
      error:e=>{this.error=this.msg(e,'Không tải được danh sách khách hàng.');this.loading=false}
    })
  }
  startBooking(){if(!this.selected)return;this.state.beginStaffBooking(this.selected);this.router.navigate(['/'])}
  track(){const code=this.bookingCode.trim();if(code)this.router.navigate(['/track'],{queryParams:{code}})}
  reschedule(){const code=this.bookingCode.trim();if(code)this.router.navigate(['/reschedule'],{queryParams:{code}})}
  initials(c:any){return`${c?.first_name?.[0]||''}${c?.last_name?.[0]||c?.username?.[0]||''}`.toUpperCase()}
  number(v:number){return new Intl.NumberFormat('vi-VN').format(v||0)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
