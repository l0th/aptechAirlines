import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { BookingStateService } from '../core/booking-state.service';
import { PaypalService } from '../core/paypal.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
  <div class="container page">
    <div class="eyebrow">BƯỚC 4 / 4</div>
    <h1 class="title">Kiểm tra & thanh toán</h1>
    <p class="subtitle">Xác nhận hành trình, hành khách, ghế và phương thức thanh toán trước khi hoàn tất đặt vé.</p>

    @if(isStaffBooking){
      <div class="staff-banner">
        <span>ĐẶT VÉ TẠI QUẦY</span>
        <div><strong>{{staffCustomer.first_name}} {{staffCustomer.last_name}}</strong><small>@{{staffCustomer.username}} · {{staffCustomer.email}}</small></div>
      </div>
    }@else if(auth.staff()){
      <div class="staff-banner warning">
        <span>NHÂN VIÊN</span>
        <div><strong>Chưa chọn khách hàng</strong><small>Vào Quầy đặt vé và chọn KHÁCH HÀNG trước khi tạo đặt chỗ.</small></div>
        <button class="btn btn-dark" (click)="router.navigate(['/admin/reservation-desk'])">Quầy đặt vé</button>
      </div>
    }

    <div class="review-grid">
      <section class="card main">
        <h2>Hành trình</h2>
        <div class="route-title"><strong>{{routeText}}</strong><span class="pill pill-gold">{{bookingTypeLabel(state.selection()?.booking_type)}}</span></div>
        <div class="legs">
          @for(l of state.selectedLegs();track l.flight_id;let i=$index){
            <div class="leg">
              <span class="leg-no">{{i+1}}</span>
              <div><strong>{{l.flight_number||'Flight'}}</strong><small>{{legLabel(l.leg_type)}}</small></div>
              <div class="route-pair"><b>{{l.origin_iata||'—'}}</b><span>→</span><b>{{l.dest_iata||'—'}}</b></div>
              <div class="time">{{dateTime(l.scheduled_departure_local||l.scheduled_departure)}}</div>
            </div>
          }
        </div>

        <h2>Hành khách</h2>
        @for(p of state.passengers();track $index;let i=$index){
          <div class="person">
            <div><span>{{i+1}}. {{p.first_name}} {{p.last_name}}</span><small>{{passengerTypeLabel(p.passenger_type)}} · {{p.nationality}}</small></div>
            <small>{{p.id_card_or_passport||'Chưa nhập giấy tờ'}}</small>
          </div>
        }

        <h2>Chỗ ngồi</h2>
        <div class="seat-list">
          @for(l of state.selectedLegs();track l.flight_id){
            <div><strong>{{l.flight_number}}</strong><span>{{seatTextFor(l.flight_id)}}</span></div>
          }
        </div>
      </section>

      <aside class="card side">
        <h2>Tổng quan giá</h2>
        @if(isStaffBooking){
          <div class="estimate-note">Báo giá được tính trực tiếp theo hồ sơ khách hàng đang được phục vụ, gồm SkyMiles, giá động và phụ phí ghế.</div>
        }
        @if(!auth.authenticated()){
          <div class="login-note">Đăng nhập để lấy báo giá theo SkyMiles và hoàn tất giao dịch.</div>
        }@else if(loadingQuote){
          <p class="muted">Đang cập nhật giá vé…</p>
        }@else if(quote){
          <div class="price-line"><span>Giá vé</span><strong>{{money(quote.total_fare)}}</strong></div>
          <div class="price-line"><span>Phụ phí ghế</span><strong>{{money(quote.total_seat_fees)}}</strong></div>
          @if(quote.early_bird_percent){
            <div class="discount"><span>Điều chỉnh theo ngày bay</span><b>{{quote.early_bird_percent>0?'+':''}}{{quote.early_bird_percent}}%</b></div>
          }
          @if(quote.load_adjustment_percent){
            <div class="discount"><span>{{quote.load_adjustment_label}} · tải {{quote.load_factor_percent}}%</span><b>{{quote.load_adjustment_percent>0?'+':''}}{{quote.load_adjustment_percent}}%</b></div>
          }
          @if(quote.ff_discount_percent){
            <div class="discount"><span>SkyMiles {{quote.ff_tier}}</span><b>-{{quote.ff_discount_percent}}%</b></div>
          }
          @if(quote.pricing_profile_name){<small class="presentment">Pricing profile: {{quote.pricing_profile_name}}</small>}
          <div class="total"><span>Tổng</span><strong>{{money(quote.total_amount)}}</strong></div>
          @if(quote.presentment?.amount){
            <small class="presentment">Thanh toán PayPal: {{quote.presentment.amount}} {{quote.presentment.currency}}</small>
          }
        }

        <div class="choice">
          <label><input type="radio" name="mode" value="buy" [(ngModel)]="mode"> Mua vé ngay</label>
          <label [class.disabled]="!canBlock"><input type="radio" name="mode" value="block" [(ngModel)]="mode" [disabled]="!canBlock"> Giữ chỗ</label>
        </div>
        @if(!canBlock){<p class="hold-note">Giữ chỗ chỉ áp dụng khi chuyến khởi hành sớm nhất còn hơn 14 ngày.</p>}

        <button class="btn btn-outline full" (click)="router.navigate(['/booking/seats'])" [disabled]="busy">Quay lại chọn ghế</button>

        @if(!auth.authenticated()){
          <button class="btn btn-dark full" (click)="login()">Đăng nhập để tiếp tục</button>
        }@else if(auth.staff()&&!isStaffBooking){
          <button class="btn btn-dark full" (click)="router.navigate(['/admin/reservation-desk'])">Chọn khách hàng</button>
        }@else{
          @if(mode==='buy'){
            @if(isStaffBooking){
              <div class="staff-payment"><strong>Thanh toán hỗ trợ tại quầy</strong><span>Nhân viên xử lý giao dịch tại quầy; PayPal Checkout chỉ mở cho tài khoản khách hàng.</span></div>
            }@else{
              <div class="payment-options" [class.disabled]="!paypalEnabled">
                <div class="paypal-option">
                  <span class="paypal-dot"></span>
                  <span><b>PayPal Checkout</b><small>{{paypalReady?'Sẵn sàng thanh toán':paypalEnabled?'Đang chuẩn bị PayPal…':'PayPal hiện chưa sẵn sàng'}}</small></span>
                </div>
              </div>
              <p class="payment-note">Thanh toán được xử lý bảo mật qua PayPal. Aptech Airlines không lưu thông tin thẻ của bạn.</p>
            }
          }
          <button class="btn btn-primary full" (click)="submit()" [disabled]="busy">
            {{busy?'Đang xử lý…':mode==='block'?'Giữ chỗ':'Thanh toán & đặt vé'}}
          </button>
        }
        
      </aside>
    </div>
  </div>
  `,
  styles:[`
    .staff-banner{display:flex;align-items:center;gap:14px;background:#071b2e;color:#fff;border-radius:18px;padding:14px 18px;margin-top:18px}.staff-banner>span{font-size:10px;letter-spacing:.12em;font-weight:900;color:#f2c85f}.staff-banner div{display:grid;gap:3px;flex:1}.staff-banner small{color:#b9c8d4}.staff-banner.warning{background:#fff4d4;color:#49360a;border:1px solid #e7ca78}.staff-banner.warning small{color:#745f2f}.review-grid{display:grid;grid-template-columns:1fr 370px;gap:20px;margin-top:20px}.main,.side{padding:24px}.main h2,.side h2{color:#071b2e;font-size:18px;margin:4px 0 14px}.main h2:not(:first-child){margin-top:28px}.route-title,.person,.price-line,.total{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #edf1f4}.legs{border:1px solid #e8edf1;border-radius:16px;overflow:hidden}.leg{display:grid;grid-template-columns:32px 1fr auto 150px;gap:12px;align-items:center;padding:13px 14px;border-bottom:1px solid #edf1f4}.leg:last-child{border-bottom:0}.leg-no{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#fff;font-size:11px;font-weight:900}.leg div{display:grid;gap:3px}.leg small,.time{font-size:11px;color:#718093}.route-pair{grid-template-columns:auto auto auto!important;display:flex!important;align-items:center;gap:8px;color:#435569}.route-pair span{color:#c09228}.person>div{display:grid;gap:4px}.person span{font-weight:800;color:#182c3f}.person small{color:#68778a}.seat-list{display:grid;gap:8px}.seat-list>div{display:flex;justify-content:space-between;gap:16px;background:#f7f9fb;border-radius:12px;padding:11px 13px}.seat-list span{color:#68778a;font-size:12px}.estimate-note,.login-note,.hold-note{background:#fff7df;color:#75570f;padding:11px 12px;border-radius:12px;font-size:12px;line-height:1.5;margin-bottom:12px}.price-line span{color:#627286}.discount{display:flex;justify-content:space-between;padding:8px 0;font-size:12px;color:#4d745e}.total{margin-top:6px;font-size:18px;color:#071b2e;border-bottom:0}.presentment{display:block;text-align:right;color:#68778a;margin-top:4px}.choice{display:grid;gap:10px;margin:18px 0}.choice label{font-weight:700;color:#435468}.choice .disabled{opacity:.45}.payment-options{margin-top:12px}.payment-options.disabled{opacity:.5}.paypal-option{display:flex;align-items:center;gap:10px;padding:13px 14px;border:1px solid #d6b35a;background:#fff8e5;border-radius:14px}.paypal-dot{width:12px;height:12px;border:3px solid #fff;border-radius:50%;background:#2878ff;box-shadow:0 0 0 1px #2878ff;flex:0 0 auto}.paypal-option>span:last-child{display:grid;gap:2px}.payment-options b{color:#17344c}.payment-options small{color:#718093}.payment-note{font-size:11px;color:#6b7d8e;line-height:1.5;margin:8px 2px 0}.staff-payment{display:grid;gap:4px;background:#f4f7f9;border-radius:12px;padding:11px 12px;margin-top:12px}.staff-payment span{font-size:11px;color:#68778a}.full{width:100%;margin-top:12px}.error{margin-top:12px}@media(max-width:900px){.review-grid{grid-template-columns:1fr}.leg{grid-template-columns:32px 1fr auto}.time{grid-column:2/-1}.staff-banner{align-items:flex-start;flex-wrap:wrap}}@media(max-width:560px){.leg{grid-template-columns:32px 1fr}.route-pair,.time{grid-column:2}.person{align-items:flex-start;flex-direction:column}.staff-banner .btn{width:100%}}
  `]
})
export class ReviewComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  state=inject(BookingStateService);
  api=inject(ApiService);
  auth=inject(AuthService);
  paypal=inject(PaypalService);
  router=inject(Router);

  quote:any=null; loadingQuote=true; mode='buy'; payment='PAYPAL';
  paypalEnabled=false; paypalReady=false; busy=false; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)}; canBlock=false;

  constructor(){
    if(!this.state.selection()){this.router.navigate(['/']);return}
    this.canBlock=this.computeCanBlock();
    if(!this.canBlock&&this.mode==='block')this.mode='buy';
    this.api.paypalConfig().subscribe({next:c=>{
      this.paypalEnabled=!!c?.enabled;
      if(this.paypalEnabled&&!this.auth.staff()){
        void this.paypal.prepare().then(ready=>{
          this.paypalReady=ready;
          this.syncDefaultPayment();
        }).catch(()=>{
          this.paypalReady=false;
          this.syncDefaultPayment();
        });
      }else{
        this.syncDefaultPayment();
      }
    },error:()=>this.syncDefaultPayment()});
    this.syncDefaultPayment();

    if(!this.auth.authenticated()||(this.auth.staff()&&!this.isStaffBooking)){
      this.loadingQuote=false;
      return;
    }
    this.loadQuote();
  }

  get staffCustomer(){return this.state.staffCustomer()}
  get isStaffBooking(){return !!this.auth.staff()&&!!this.staffCustomer?._id}
  get routeText(){const s=this.state.search();return`${s?.origin||''} → ${s?.destination||''}`}
  get staffFareEstimate(){
    const sel=this.state.selection();
    return this.optionPrice(sel?.outbound)+(sel?.inbound?this.optionPrice(sel.inbound):0);
  }

  loadQuote(){
    this.loadingQuote=true;this.error='';
    const customerId=this.isStaffBooking?this.staffCustomer._id:'self';
    const paymentMethod=this.isStaffBooking?'PROFILE_CARD':'PAYPAL';
    this.api.quoteBooking(this.state.buildPayload(false,paymentMethod,customerId)).subscribe({
      next:q=>{this.quote=q;this.state.quote.set(q);this.loadingQuote=false},
      error:e=>{this.error=this.msg(e,'Không lấy được báo giá.');this.loadingQuote=false}
    });
  }

  login(){this.router.navigate(['/auth'],{queryParams:{next:'/booking/review'}})}
  bookingTypeLabel(value?:string){return({ONE_WAY:'Một chiều',ROUND_TRIP:'Khứ hồi',CONNECTING:'Nối chuyến'} as Record<string,string>)[value||'']||value||'Hành trình'}
  passengerTypeLabel(value?:string){return({ADULT:'Người lớn',CHILD:'Trẻ em',SENIOR:'Cao tuổi'} as Record<string,string>)[value||'']||value||'Hành khách'}
  legLabel(t:string){if(t==='OUTBOUND')return'Chiều đi';if(t==='INBOUND')return'Chiều về';if(t?.startsWith('INBOUND_'))return`Chiều về · chặng ${t.split('_')[1]}`;if(t?.startsWith('CONNECTING_'))return`Chiều đi · chặng ${t.split('_')[1]}`;return t||'Chặng bay'}
  dateTime(v?:string){if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?v:new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)}
  seatTextFor(flightId:string){const req=this.state.seatRequests().filter((r:any)=>r.flight_id===flightId).sort((a:any,b:any)=>Number(a.passenger_index)-Number(b.passenger_index));if(!req.length)return'Tự động';return req.map((r:any)=>`HK${Number(r.passenger_index)+1}: ${r.selection_type==='CHOOSE'?r.seat_code:'AUTO'}`).join(' · ')}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}

  async submit(){
    if(this.auth.staff()&&!this.isStaffBooking){this.error='Nhân viên phải chọn khách hàng tại Quầy đặt vé trước.';return}
    if(this.mode==='block'&&!this.canBlock){this.error='Chuyến này không còn đủ điều kiện giữ chỗ hơn 14 ngày.';return}
    if(this.mode==='buy'&&!this.isStaffBooking&&!this.paypalEnabled){this.error='Thanh toán PayPal hiện chưa sẵn sàng. Vui lòng thử lại sau.';return}
    this.busy=true;this.error='';
    const customerId=this.isStaffBooking?this.staffCustomer._id:'self';
    try{
      if(this.mode==='block'){
        const b=await firstValueFrom(this.api.createBooking(this.state.buildPayload(true,undefined,customerId)));
        this.router.navigate(['/booking/success'],{state:{booking:b,staffCustomer:this.staffCustomer}});
        return;
      }
      if(!this.isStaffBooking){
        let checkout='';
        await this.paypal.pay(
          async()=>{
            const payload={...this.state.buildPayload(false,'PAYPAL'),client_request_id:crypto.randomUUID()};
            const created=await firstValueFrom(this.api.paypalCreate(payload));
            checkout=created.checkout_id;
            return{orderId:created.order_id};
          },
          async orderId=>{
            const captured=await firstValueFrom(this.api.paypalCapture(checkout,orderId));
            this.router.navigate(['/booking/success'],{state:{booking:captured.booking}});
          }
        );
        return;
      }
      const b=await firstValueFrom(this.api.createBooking(this.state.buildPayload(false,'PROFILE_CARD',customerId)));
      this.router.navigate(['/booking/success'],{state:{booking:b,staffCustomer:this.staffCustomer}});
    }catch(e:any){this.error=this.msg(e,'Không hoàn tất được đặt vé.')}
    finally{this.busy=false}
  }

  private computeCanBlock(){
    const times=this.state.selectedLegs().map(l=>new Date(l.scheduled_departure||l.scheduled_departure_local||'').getTime()).filter(Number.isFinite);
    if(!times.length)return false;
    const earliest=Math.min(...times);
    return(earliest-Date.now())/(1000*60*60*24)>14;
  }
  private optionPrice(option:any){
    if(!option)return 0;
    const legsTotal=(option?.legs||[]).reduce((s:number,l:any)=>s+Number(l.total_party_price||0),0);
    if(legsTotal>0)return legsTotal;
    const sourceTotal=Number(option?.source?.total_party_price);
    return Number.isFinite(sourceTotal)?sourceTotal:0;
  }
  private syncDefaultPayment(){
    if(this.isStaffBooking)return;
    this.payment='PAYPAL';
  }
  private msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||e?.message||f}
}
