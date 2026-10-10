import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { PaypalService } from '../core/paypal.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { LanguageService } from '../core/language.service';
import { cancellationOutcomeMessages } from '../core/refund-copy';
import { formatDateTimeDayFirst } from '../core/date-format.util';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
  <div class="container page">
    <div class="eyebrow">{{language.pick('TRẠNG THÁI VÉ','TICKET STATUS')}}</div>
    <h1 class="title">{{language.pick('Tra cứu vé','Track your booking')}}</h1>
    <p class="subtitle">{{language.pick('Nhập mã giữ chỗ, mã xác nhận hoặc PNR để xem trạng thái và thông tin hành trình.','Enter your hold code, confirmation number or PNR to view your itinerary and status.')}}</p>

    <div class="card finder">
      <input class="control" [(ngModel)]="code" (keyup.enter)="search()" placeholder="BLK-... / CNF-... / PNR">
      <button class="btn btn-primary" (click)="search()" [disabled]="loading||!code.trim()">{{loading?language.pick('Đang tra…','Searching…'):language.pick('Tra cứu','Search')}}</button>
    </div>

    
    @if(result){
      <section class="card ticket">
        <header class="ticket-head">
          <div>
            <div class="eyebrow">{{language.pick('ĐẶT CHỖ','BOOKING')}}</div>
            <h2 translate="no">{{result.pnr_code||result.confirmation_number||result.blocking_number}}</h2>
            <p><span>{{bookingTypeLabel(result.booking_type)}}</span> · {{result.passengers?.length||0}} {{language.pick('hành khách','passenger(s)')}}</p>
          </div>
          <span class="status" translate="no" [class.ok]="result.status==='CONFIRMED'||result.status==='RESCHEDULED'" [class.warn]="result.status==='BLOCKED'" [class.cancel]="result.status==='CANCELLED'">{{statusLabel(result.status)}}</span>
        </header>

        <div class="codes">
          <div><span>PNR</span><b>{{result.pnr_code||'—'}}</b></div>
          <div><span>{{language.pick('Mã xác nhận','Confirmation')}}</span><b>{{result.confirmation_number||'—'}}</b></div>
          <div><span>{{language.pick('Mã giữ chỗ','Hold code')}}</span><b>{{result.blocking_number||'—'}}</b></div>
          <div><span>{{language.pick('Mã hủy','Cancellation')}}</span><b>{{result.cancellation_number||'—'}}</b></div>
          <div><span>{{language.pick('Tổng tiền','Total fare')}}</span><b>{{money(result.total_amount)}}</b></div>
        </div>

        @if(result.status==='BLOCKED'&&(result.time_limit_deadline||result.blocking_deadline)){
          <div class="deadline">{{language.pick('Giữ chỗ đến','Hold expires at')}} <strong>{{dateTime(result.time_limit_deadline||result.blocking_deadline)}}</strong></div>
        }

        @if(tracked?.has_emergency_changes){<div class="change-alert">{{language.pick('Có thay đổi lịch bay hoặc trạng thái chuyến. Kiểm tra các chặng được đánh dấu bên dưới.','There are changes to your flight schedule or status. Please review the highlighted segments below.')}}</div>}
        <div class="ticket-grid">
          <div>
            <h3>{{language.pick('Hành khách','Passengers')}}</h3>
            @for(p of result.passengers||[];track $index){
              <div class="person"><span translate="no">{{$index+1}}. {{p.first_name}} {{p.last_name}}</span><small><span>{{passengerTypeLabel(p.passenger_type)}}</span> · <span translate="no">{{p.nationality}}</span></small></div>
            }
          </div>
          <div>
            <h3>{{language.pick('Chặng bay và vé','Flights & coupons')}}</h3>
            @for(c of coupons;track c.coupon_number){
              <div class="coupon" [class.changed]="c.is_highlighted_change">
                <div><strong translate="no">{{c.flight_number}}</strong><small><span>{{legLabel(c.leg_type)}}</span> · <span>{{language.cabinLabel(c.cabin_class)}}</span></small></div>
                <div><b>{{c.origin_iata||'—'}} → {{c.dest_iata||'—'}}</b><small>{{dateTime(c.scheduled_departure_local||c.scheduled_departure)}} · {{c.flight_status?language.flightStatusLabel(c.flight_status):language.couponStatusLabel(c.coupon_status)}}</small></div>
              </div>
            }
          </div>
        </div>

        <footer class="ticket-actions">
          @if(result.status==='BLOCKED'){
            @if(auth.staff()){
              <span>{{language.pick('Khách thanh toán PayPal từ email giữ chỗ','Customer pays with PayPal using the hold email')}}</span>
            }@else{
              <button class="btn btn-dark" [disabled]="busy||!paypalEnabled" (click)="confirmHoldPaypal()">{{language.pick('Thanh toán PayPal','Pay with PayPal')}} {{paypalEnabled?'':language.pick('(chưa bật)','(unavailable)')}}</button>
            }
          }
          @if(result.status==='CONFIRMED'){
            <button class="btn btn-outline" (click)="router.navigate(['/reschedule'],{queryParams:{code:result.confirmation_number||result.pnr_code}})">{{language.pick('Đổi chuyến','Reschedule')}}</button>
          }
          @if(result.status!=='CANCELLED'){
            <button class="btn btn-outline danger" [disabled]="busy" (click)="cancel()">{{language.pick('Hủy vé','Cancel booking')}}</button>
          }
        </footer>
      </section>
    }
    
  </div>
  `,
  styles:[`
    .finder{display:flex;gap:10px;padding:18px;margin-top:18px}.finder input{flex:1}.notice{padding:11px 14px;border-radius:12px}.error.notice{background:#fff0f0;border:1px solid #efcaca}.success.notice{background:#eaf8f1;border:1px solid #c8ead9}.ticket{padding:0;margin-top:18px;overflow:hidden}.ticket-head{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px 24px;background:linear-gradient(120deg,#071b2e,#123957);color:#fff}.ticket-head h2{font-size:28px;margin:4px 0}.ticket-head p{margin:0;color:#b9c8d3}.status{border-radius:999px;padding:8px 12px;background:#e9eef3;color:#4f6173;font-size:11px;font-weight:900}.status.ok{background:#dff5e9;color:#126b49}.status.warn{background:#fff0bd;color:#7b5a05}.status.cancel{background:#ffe2e2;color:#a12a2a}.codes{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#e7edf2}.codes>div{background:#fff;padding:16px}.codes span{display:block;font-size:10px;text-transform:uppercase;color:#718093;font-weight:800}.codes b{display:block;color:#071b2e;margin-top:5px}.deadline{margin:16px 20px 0;background:#fff7df;color:#73550e;padding:11px 13px;border-radius:12px}.change-alert{margin:16px 20px 0;background:#fff1df;color:#8a4f13;border:1px solid #f0cfaa;padding:11px 13px;border-radius:12px;font-weight:700}.ticket-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:26px;padding:22px 24px}.ticket-grid h3{color:#071b2e;margin:0 0 12px}.person,.coupon{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #edf1f4}.coupon.changed{background:#fff8e8;padding-left:8px;padding-right:8px;border-radius:10px}.person>span,.coupon strong{font-weight:800;color:#203446}.person small,.coupon small{display:block;color:#718093;font-size:11px;margin-top:3px}.coupon>div:last-child{text-align:right}.ticket-actions{display:flex;justify-content:flex-end;gap:9px;padding:16px 24px;border-top:1px solid #edf1f4;background:#fafbfd}.danger{color:#a83030;border-color:#e4bebe}.btn:disabled{opacity:.5}@media(max-width:900px){.codes{grid-template-columns:1fr 1fr}}@media(max-width:760px){.ticket-grid{grid-template-columns:1fr}.finder{flex-direction:column}.ticket-head{align-items:flex-start;flex-direction:column}.ticket-actions{flex-direction:column}.ticket-actions .btn{width:100%}}
  `]
})
export class TrackComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  readonly language=inject(LanguageService);
  api=inject(ApiService);
  paypal=inject(PaypalService);
  auth=inject(AuthService);
  toast=inject(ToastService);
  route=inject(ActivatedRoute);
  router=inject(Router);
  code=''; result:any=null; tracked:any=null; policies:any[]=[]; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;if(v)this.__toast.notifyError(v)}; private __message='';get message(){return this.__message}set message(v:string){this.__message=v;if(v)this.__toast.notifySuccess(v)}; loading=false; busy=false; paypalEnabled=false;
  get coupons(){return this.tracked?.flight_coupons||this.result?.ticket_coupons||[]}

  constructor(){
    this.code=this.route.snapshot.queryParamMap.get('code')||'';
    this.api.policies().subscribe({next:r=>this.policies=r||[],error:()=>{}});
    this.api.paypalConfig().subscribe({next:r=>this.paypalEnabled=!!r?.enabled,error:()=>{}});
    if(this.code)this.search();
  }
  search(){
    const code=this.code.trim();if(!code)return;
    this.loading=true;this.error='';this.result=null;
    this.api.track(code).subscribe({
      next:r=>{this.tracked=r;this.result=r?.booking_info||r;this.loading=false},
      error:e=>{this.tracked=null;this.error=this.msg(e,this.language.pick('Không tìm thấy vé hoặc bạn không có quyền xem đặt chỗ này.','Booking not found or you do not have permission to view it.'));this.loading=false}
    })
  }
  async confirmHoldPaypal(){
    if(this.auth.staff()||!this.result?.blocking_number)return;
    this.busy=true;this.error='';this.message='';
    try{
      let checkout='';
      await this.paypal.pay(
        async()=>{
          const created=await firstValueFrom(this.api.paypalConfirmHoldCreate({blocking_number:this.result.blocking_number,client_request_id:crypto.randomUUID()}));
          checkout=created.checkout_id;
          return{orderId:created.order_id};
        },
        async orderId=>{await firstValueFrom(this.api.paypalConfirmHoldCapture(checkout,orderId))}
      );
      this.message=this.language.pick('Đã xác nhận vé bằng PayPal.','Booking confirmed through PayPal.');
      this.search();
    }catch(e:any){this.error=this.msg(e,this.language.pick('Không xác nhận được vé bằng PayPal.','Unable to confirm this booking through PayPal.'))}
    finally{this.busy=false}
  }
  async cancel(){
    if(!this.result)return;
    const percent=this.refundPercent();
    const question=this.result.status==='BLOCKED'
      ?'Hủy vé đang giữ sẽ giải phóng toàn bộ ghế và không phát sinh khoản hoàn tiền. Bạn muốn tiếp tục?'
      :`Theo chính sách hiện tại, mức hoàn dự kiến là ${percent}%. Bạn muốn hủy vé này?`;
    const questionEn=this.result.status==='BLOCKED'
      ?'Cancelling this hold will release all seats and no refund will be issued. Do you want to continue?'
      :`The current policy estimates a ${percent}% refund. Do you want to cancel this booking?`;
    const confirmed=await this.toast.confirm({
      titleVi:'Xác nhận hủy vé',
      titleEn:'Confirm cancellation',
      messageVi:question,
      messageEn:questionEn,
      confirmVi:'Hủy vé',
      confirmEn:'Cancel booking',
    });
    if(!confirmed)return;
    const id=this.result.confirmation_number||this.result.blocking_number||this.result.pnr_code;
    this.busy=true;this.error='';this.message='';
    try{
      const r=await firstValueFrom(this.api.cancel(id));
      const outcome=cancellationOutcomeMessages(r);
      this.message=this.language.pick(outcome.vi,outcome.en);
      this.search();
    }catch(e:any){this.error=this.msg(e,this.language.pick('Không hủy được vé.','Unable to cancel this booking.'))}
    finally{this.busy=false}
  }
  refundPercent(){
    if(this.result?.status!=='CONFIRMED')return 0;
    const departures=this.coupons.map((c:any)=>new Date(c.scheduled_departure).getTime()).filter((v:number)=>Number.isFinite(v));
    if(!departures.length)return 0;
    const days=Math.max(0,(Math.min(...departures)-Date.now())/86400000);
    const matched=this.policies.filter(p=>days>=Number(p.min_days_before??0)&&days<=(p.max_days_before==null?Infinity:Number(p.max_days_before))).sort((a,b)=>Number(b.min_days_before)-Number(a.min_days_before))[0];
    return Number(matched?.refund_percentage||0)
  }
  bookingTypeLabel(v:string){return this.language.bookingTypeLabel(v)||this.language.pick('Hành trình','Itinerary')}
  statusLabel(v:string){return this.language.bookingStatusLabel(v)}
  passengerTypeLabel(v:string){return this.language.passengerTypeLabel(v)||this.language.pick('Hành khách','Passenger')}
  legLabel(v:string){return this.language.itineraryLegLabel(v)}
  dateTime(v:string){return formatDateTimeDayFirst(v)}
  money(v:number){return new Intl.NumberFormat(this.language.isEnglish()?'en-US':'vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
