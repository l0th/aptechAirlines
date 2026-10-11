import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone:true,
  template:`
    <div class="eyebrow">{{t('VẬN HÀNH','OPERATIONS')}}</div>
    <div class="section-head">
      <div><h1 class="title">{{t('Bảng điều khiển','Dashboard')}}</h1><p class="subtitle">{{t('Tổng quan đặt chỗ, doanh thu, hành vi khách hàng và mức sử dụng ghế.','Overview of bookings, revenue, customer behavior and seat utilization.')}}</p></div>
      <button class="btn btn-outline" (click)="load()">{{t('Làm mới','Refresh')}}</button>
    </div>

    
    <div class="grid grid-4 stats">
      <div class="card"><span>{{t('Đặt chỗ','Bookings')}}</span><strong>{{data?.total_bookings??'—'}}</strong><small>{{data?.status_breakdown?.confirmed||0}} {{t('đã xác nhận','confirmed')}}</small></div>
      <div class="card"><span>{{t('Doanh thu ròng','Net revenue')}}</span><strong>{{money(data?.net_revenue_vnd||0)}}</strong><small>{{t('Dựa trên sổ giao dịch','Based on the transaction ledger')}}</small></div>
      <div class="card"><span>{{t('Giá trị đang hoạt động','Active booking value')}}</span><strong>{{money(data?.active_booking_value_vnd||0)}}</strong><small>{{t('Đã xác nhận + đã đổi chuyến','Confirmed + rescheduled')}}</small></div>
      <div class="card"><span>{{t('Hệ số lấp đầy','Load factor')}}</span><strong>{{capacity?.overall_load_factor_percent??'—'}}{{capacity?'%':''}}</strong><small>{{capacity?.total_scheduled_flights||0}} {{t('chuyến bay theo lịch','scheduled flights')}}</small></div>
    </div>

    <div class="dashboard-grid">
      <section class="card panel">
        <div class="panel-head"><h2>{{t('Trạng thái đặt chỗ','Booking status')}}</h2><span>{{t('Tỷ lệ hủy','Cancellation rate')}} {{data?.cancellation_rate_percent||0}}%</span></div>
        <div class="status-grid">
          <div><span>{{t('Đã xác nhận','Confirmed')}}</span><b>{{data?.status_breakdown?.confirmed||0}}</b></div>
          <div><span>{{t('Đang giữ chỗ','On hold')}}</span><b>{{data?.status_breakdown?.blocked||0}}</b></div>
          <div><span>{{t('Đã đổi chuyến','Rescheduled')}}</span><b>{{data?.status_breakdown?.rescheduled||0}}</b></div>
          <div><span>{{t('Đã hủy','Cancelled')}}</span><b>{{data?.status_breakdown?.cancelled||0}}</b></div>
        </div>
      </section>

      <section class="card panel">
        <div class="panel-head"><h2>{{t('Cơ cấu hành khách','Passenger demographics')}}</h2><span>{{t('Đặt trước','Lead time')}} {{data?.average_lead_time_days||0}} {{t('ngày','days')}}</span></div>
        <div class="status-grid">
          <div><span>{{t('Người lớn','Adults')}}</span><b>{{data?.passenger_demographics?.adults||0}}</b></div>
          <div><span>{{t('Trẻ em','Children')}}</span><b>{{data?.passenger_demographics?.children||0}}</b></div>
          <div><span>{{t('Cao tuổi','Seniors')}}</span><b>{{data?.passenger_demographics?.seniors||0}}</b></div>
          <div><span>{{t('Tỷ lệ quay lại','Repeat customer rate')}}</span><b>{{data?.repeat_customer_stats?.repeat_customer_rate_percent||0}}%</b></div>
        </div>
      </section>
    </div>

    <section class="card routes">
      <div class="panel-head"><h2>{{t('Tuyến phổ biến','Top routes')}}</h2><span>{{t('Lượng hành khách','Passenger volume')}}</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{{t('Tuyến','Route')}}</th><th>{{t('Đặt chỗ','Bookings')}}</th><th>{{t('Hành khách','Passengers')}}</th><th>{{t('Giá trị đang hoạt động','Active booking value')}}</th></tr></thead>
          <tbody>
            @for(r of data?.top_routes||[];track r.route){
              <tr><td><strong>{{r.origin_iata}} → {{r.dest_iata}}</strong></td><td>{{r.bookings_count}}</td><td>{{r.passenger_volume}}</td><td>{{money(r.active_booking_value_vnd)}}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles:[`
    .notice{background:#fff;padding:10px 13px;border-radius:12px}.stats{margin-top:18px}.stats>div{padding:20px}.stats span{display:block;font-size:10px;text-transform:uppercase;font-weight:900;color:#6a7a8b}.stats strong{display:block;font-size:25px;color:#071b2e;margin-top:8px}.stats small{display:block;color:#82909d;margin-top:5px}.dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.panel,.routes{padding:20px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.panel-head h2{margin:0;color:#071b2e}.panel-head span{font-size:11px;color:#718093}.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.status-grid div{background:#f6f8fa;border-radius:13px;padding:13px}.status-grid span{display:block;color:#6f7e8d;font-size:11px}.status-grid b{display:block;color:#071b2e;font-size:23px;margin-top:5px}.routes{margin-top:18px}.routes .table-wrap{margin-top:12px}@media(max-width:900px){.dashboard-grid{grid-template-columns:1fr}}@media(max-width:650px){.status-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
  `]
})
export class DashboardComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  api=inject(ApiService);
  auth=inject(AuthService);
  language=inject(LanguageService);
  router=inject(Router);
  data:any=null;capacity:any=null;private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  constructor(){if(!this.auth.admin()){this.router.navigate(['/admin/reservation-desk']);return}this.load()}
  load(){
    this.error='';
    this.api.analytics().subscribe({next:r=>this.data=r,error:e=>this.error=this.msg(e,this.language.pick('Không tải được dữ liệu phân tích.','Unable to load analytics.'))});
    this.api.analyticsCapacity().subscribe({next:r=>this.capacity=r,error:()=>{}})
  }
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  t(vi:string,en:string){return this.language.pick(vi,en)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
