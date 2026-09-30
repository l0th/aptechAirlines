import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { PaypalService } from '../core/paypal.service';
import { AuthService } from '../core/auth.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
  <div class="container page">
    <div class="eyebrow">TICKET STATUS</div>
    <h1 class="title">Tra cứu vé</h1>
    <p class="subtitle">Nhập mã giữ chỗ, confirmation number hoặc PNR để xem trạng thái và quyền xử lý hiện tại.</p>

    <div class="card finder">
      <input class="control" [(ngModel)]="code" (keyup.enter)="search()" placeholder="BLK-... / CNF-... / PNR">
      <button class="btn btn-primary" (click)="search()" [disabled]="loading||!code.trim()">{{loading?'Đang tra…':'Tra cứu'}}</button>
    </div>

    @if(error){<p class="error notice">{{error}}</p>}
    @if(result){
      <section class="card ticket">
        <header class="ticket-head">
          <div>
            <div class="eyebrow">BOOKING</div>
            <h2>{{result.pnr_code||result.confirmation_number||result.blocking_number}}</h2>
            <p>{{result.booking_type}} · {{result.passengers?.length||0}} hành khách</p>
          </div>
          <span class="status" [class.ok]="result.status==='CONFIRMED'||result.status==='RESCHEDULED'" [class.warn]="result.status==='BLOCKED'" [class.cancel]="result.status==='CANCELLED'">{{result.status}}</span>
        </header>

        <div class="codes">
          <div><span>PNR</span><b>{{result.pnr_code||'—'}}</b></div>
          <div><span>Confirmation</span><b>{{result.confirmation_number||'—'}}</b></div>
          <div><span>Blocking</span><b>{{result.blocking_number||'—'}}</b></div>
          <div><span>Cancellation</span><b>{{result.cancellation_number||'—'}}</b></div>
          <div><span>Tổng tiền</span><b>{{money(result.total_amount)}}</b></div>
        </div>

        @if(result.status==='BLOCKED'&&(result.time_limit_deadline||result.blocking_deadline)){
          <div class="deadline">Giữ chỗ đến <strong>{{dateTime(result.time_limit_deadline||result.blocking_deadline)}}</strong></div>
        }

        @if(tracked?.has_emergency_changes){<div class="change-alert">Có thay đổi lịch bay hoặc trạng thái chuyến. Kiểm tra các chặng được đánh dấu bên dưới.</div>}
        <div class="ticket-grid">
          <div>
            <h3>Hành khách</h3>
            @for(p of result.passengers||[];track $index){
              <div class="person"><span>{{$index+1}}. {{p.first_name}} {{p.last_name}}</span><small>{{p.passenger_type}} · {{p.nationality}}</small></div>
            }
          </div>
          <div>
            <h3>Chặng bay & coupon</h3>
            @for(c of coupons;track c.coupon_number){
              <div class="coupon" [class.changed]="c.is_highlighted_change">
                <div><strong>{{c.flight_number}}</strong><small>{{legLabel(c.leg_type)}} · {{c.cabin_class}}</small></div>
                <div><b>{{c.origin_iata||'—'}} → {{c.dest_iata||'—'}}</b><small>{{dateTime(c.scheduled_departure_local||c.scheduled_departure)}} · {{c.flight_status||c.coupon_status}}</small></div>
              </div>
            }
          </div>
        </div>

        <footer class="ticket-actions">
          @if(result.status==='BLOCKED'){
            <button class="btn btn-dark" [disabled]="busy" (click)="confirmHoldCard()">Xác nhận bằng thẻ</button>
            @if(!auth.staff()){<button class="btn btn-outline" [disabled]="busy||!paypalEnabled" (click)="confirmHoldPaypal()">PayPal {{paypalEnabled?'':'(chưa bật)'}}</button>}
          }
          @if(result.status==='CONFIRMED'){
            <button class="btn btn-outline" (click)="router.navigate(['/reschedule'],{queryParams:{code:result.confirmation_number||result.pnr_code}})">Đổi chuyến</button>
          }
          @if(result.status!=='CANCELLED'){
            <button class="btn btn-outline danger" [disabled]="busy" (click)="cancel()">Hủy booking</button>
          }
        </footer>
      </section>
    }
    @if(message){<p class="success notice">{{message}}</p>}
  </div>
  `,
  styles:[`
    .finder{display:flex;gap:10px;padding:18px;margin-top:18px}.finder input{flex:1}.notice{padding:11px 14px;border-radius:12px}.error.notice{background:#fff0f0;border:1px solid #efcaca}.success.notice{background:#eaf8f1;border:1px solid #c8ead9}.ticket{padding:0;margin-top:18px;overflow:hidden}.ticket-head{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px 24px;background:linear-gradient(120deg,#071b2e,#123957);color:#fff}.ticket-head h2{font-size:28px;margin:4px 0}.ticket-head p{margin:0;color:#b9c8d3}.status{border-radius:999px;padding:8px 12px;background:#e9eef3;color:#4f6173;font-size:11px;font-weight:900}.status.ok{background:#dff5e9;color:#126b49}.status.warn{background:#fff0bd;color:#7b5a05}.status.cancel{background:#ffe2e2;color:#a12a2a}.codes{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#e7edf2}.codes>div{background:#fff;padding:16px}.codes span{display:block;font-size:10px;text-transform:uppercase;color:#718093;font-weight:800}.codes b{display:block;color:#071b2e;margin-top:5px}.deadline{margin:16px 20px 0;background:#fff7df;color:#73550e;padding:11px 13px;border-radius:12px}.change-alert{margin:16px 20px 0;background:#fff1df;color:#8a4f13;border:1px solid #f0cfaa;padding:11px 13px;border-radius:12px;font-weight:700}.ticket-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:26px;padding:22px 24px}.ticket-grid h3{color:#071b2e;margin:0 0 12px}.person,.coupon{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #edf1f4}.coupon.changed{background:#fff8e8;padding-left:8px;padding-right:8px;border-radius:10px}.person>span,.coupon strong{font-weight:800;color:#203446}.person small,.coupon small{display:block;color:#718093;font-size:11px;margin-top:3px}.coupon>div:last-child{text-align:right}.ticket-actions{display:flex;justify-content:flex-end;gap:9px;padding:16px 24px;border-top:1px solid #edf1f4;background:#fafbfd}.danger{color:#a83030;border-color:#e4bebe}.btn:disabled{opacity:.5}@media(max-width:900px){.codes{grid-template-columns:1fr 1fr}}@media(max-width:760px){.ticket-grid{grid-template-columns:1fr}.finder{flex-direction:column}.ticket-head{align-items:flex-start;flex-direction:column}.ticket-actions{flex-direction:column}.ticket-actions .btn{width:100%}}
  `]
})
export class TrackComponent{
  api=inject(ApiService);
  paypal=inject(PaypalService);
  auth=inject(AuthService);
  route=inject(ActivatedRoute);
  router=inject(Router);
  code=''; result:any=null; tracked:any=null; policies:any[]=[]; error=''; message=''; loading=false; busy=false; paypalEnabled=false;
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
      error:e=>{this.tracked=null;this.error=this.msg(e,'Không tìm thấy vé hoặc bạn không có quyền xem booking này.');this.loading=false}
    })
  }
  async confirmHoldCard(){
    if(!this.result?.blocking_number)return;
    this.busy=true;this.error='';this.message='';
    try{
      const r=await firstValueFrom(this.api.confirm({blocking_number:this.result.blocking_number,payment_method:'PROFILE_CARD'}));
      this.message=`Đã xác nhận vé. Confirmation: ${r?.confirmation_number||r?.booking?.confirmation_number||'đã tạo'}.`;
      this.search();
    }catch(e:any){this.error=this.msg(e,'Không xác nhận được vé.')}
    finally{this.busy=false}
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
      this.message='Đã xác nhận vé bằng PayPal.';
      this.search();
    }catch(e:any){this.error=this.msg(e,'Không xác nhận được vé bằng PayPal.')}
    finally{this.busy=false}
  }
  async cancel(){
    if(!this.result)return;
    const percent=this.refundPercent();
    const question=this.result.status==='BLOCKED'
      ?'Hủy vé đang giữ sẽ giải phóng toàn bộ ghế và không phát sinh khoản hoàn tiền. Bạn muốn tiếp tục?'
      :`Theo chính sách hiện tại, mức hoàn dự kiến là ${percent}%. Bạn muốn hủy booking này?`;
    if(!confirm(question))return;
    const id=this.result.confirmation_number||this.result.blocking_number||this.result.pnr_code;
    this.busy=true;this.error='';this.message='';
    try{
      const r=await firstValueFrom(this.api.cancel(id));
      this.message=`Đã hủy vé. Mã hủy: ${r.cancellation_number}. Hoàn ${this.money(r.refund_amount)} (${r.refund_percentage}%).`;
      this.search();
    }catch(e:any){this.error=this.msg(e,'Không hủy được booking.')}
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
  legLabel(v:string){if(v==='OUTBOUND')return'Chiều đi';if(v==='INBOUND')return'Chiều về';if(v?.startsWith('CONNECTING_'))return`Đi · chặng ${v.split('_')[1]}`;if(v?.startsWith('INBOUND_'))return`Về · chặng ${v.split('_')[1]}`;return v||'Chặng bay'}
  dateTime(v:string){if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?v:new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short'}).format(d)}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
