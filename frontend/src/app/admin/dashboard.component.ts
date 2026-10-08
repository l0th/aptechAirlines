import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  standalone:true,
  template:`
    <div class="eyebrow">VẬN HÀNH</div>
    <div class="section-head">
      <div><h1 class="title">Bảng điều khiển</h1><p class="subtitle">Tổng quan đặt chỗ, doanh thu, hành vi khách hàng và mức sử dụng ghế.</p></div>
      <button class="btn btn-outline" (click)="load()">Làm mới</button>
    </div>

    
    <div class="grid grid-4 stats">
      <div class="card"><span>Đặt chỗ</span><strong>{{data?.total_bookings??'—'}}</strong><small>{{data?.status_breakdown?.confirmed||0}} đã xác nhận</small></div>
      <div class="card"><span>Doanh thu ròng</span><strong>{{money(data?.net_revenue_vnd||0)}}</strong><small>Dựa trên sổ giao dịch</small></div>
      <div class="card"><span>Giá trị đang hoạt động</span><strong>{{money(data?.active_booking_value_vnd||0)}}</strong><small>Đã xác nhận + đã đổi chuyến</small></div>
      <div class="card"><span>Hệ số lấp đầy</span><strong>{{capacity?.overall_load_factor_percent??'—'}}{{capacity?'%':''}}</strong><small>{{capacity?.total_scheduled_flights||0}} chuyến bay theo lịch</small></div>
    </div>

    <div class="dashboard-grid">
      <section class="card panel">
        <div class="panel-head"><h2>Trạng thái đặt chỗ</h2><span>Tỷ lệ hủy {{data?.cancellation_rate_percent||0}}%</span></div>
        <div class="status-grid">
          <div><span>Đã xác nhận</span><b>{{data?.status_breakdown?.confirmed||0}}</b></div>
          <div><span>Đang giữ chỗ</span><b>{{data?.status_breakdown?.blocked||0}}</b></div>
          <div><span>Đã đổi chuyến</span><b>{{data?.status_breakdown?.rescheduled||0}}</b></div>
          <div><span>Đã hủy</span><b>{{data?.status_breakdown?.cancelled||0}}</b></div>
        </div>
      </section>

      <section class="card panel">
        <div class="panel-head"><h2>Cơ cấu hành khách</h2><span>Đặt trước {{data?.average_lead_time_days||0}} ngày</span></div>
        <div class="status-grid">
          <div><span>Người lớn</span><b>{{data?.passenger_demographics?.adults||0}}</b></div>
          <div><span>Trẻ em</span><b>{{data?.passenger_demographics?.children||0}}</b></div>
          <div><span>Cao tuổi</span><b>{{data?.passenger_demographics?.seniors||0}}</b></div>
          <div><span>Tỷ lệ quay lại</span><b>{{data?.repeat_customer_stats?.repeat_customer_rate_percent||0}}%</b></div>
        </div>
      </section>
    </div>

    <section class="card routes">
      <div class="panel-head"><h2>Tuyến phổ biến</h2><span>Lượng hành khách</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Tuyến</th><th>Đặt chỗ</th><th>Hành khách</th><th>Giá trị đang hoạt động</th></tr></thead>
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
  router=inject(Router);
  data:any=null;capacity:any=null;private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  constructor(){if(!this.auth.admin()){this.router.navigate(['/admin/reservation-desk']);return}this.load()}
  load(){
    this.error='';
    this.api.analytics().subscribe({next:r=>this.data=r,error:e=>this.error=this.msg(e,'Không tải được analytics.')});
    this.api.analyticsCapacity().subscribe({next:r=>this.capacity=r,error:()=>{}})
  }
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
