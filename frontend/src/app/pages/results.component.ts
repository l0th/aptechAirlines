import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingLeg, BookingStateService } from '../core/booking-state.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  standalone:true,
  imports:[CommonModule,IconComponent],
  template:`
    <section class="results-head">
      <div class="container result-bar">
        <button class="btn back" (click)="router.navigate(['/'])">← Sửa tìm kiếm</button>
        <div class="summary-title">
          <div class="eyebrow gold">KẾT QUẢ CHUYẾN BAY</div>
          <h1>{{q['origin']}} <span>→</span> {{q['destination']}}</h1>
          <p>{{outboundDateLabel}}{{q['return_date'] ? ' → '+q['return_date'] : ''}} · {{passengers}} hành khách · {{label(q['cabin_class'])}}</p>
        </div>
      </div>
    </section>

    <main class="container page">
      @if(loading){
        <div class="card empty"><h2>Đang tìm chuyến phù hợp…</h2><p class="muted">Kiểm tra chuyến thẳng, nối chuyến, giá và số ghế.</p></div>
      }@else if(error){
        <div class="card empty"><h2>Không tải được kết quả</h2><p class="error">{{error}}</p></div>
      }@else{
        @if(unresolvedLocations.length){
          <div class="card location-alert location-error">
            <app-icon name="search" [size]="20"/>
            <div><strong>Chưa nhận diện được {{unresolvedLocations.join(' và ')}}</strong><p>Hãy quay lại và chọn thành phố hoặc sân bay từ danh sách gợi ý để tìm chính xác hơn.</p></div>
          </div>
        }
        @for(message of locationNotices;track message){
          <div class="card location-alert">
            <app-icon name="pin" [size]="20"/>
            <div><strong>Điểm bay đã được xác định</strong><p>{{message}}</p></div>
          </div>
        }
        <section class="direction">
          <div class="section-head">
            <div><div class="eyebrow">CHIỀU ĐI · {{outboundDateLabel}}</div><h2>{{q['origin']}} → {{q['destination']}}</h2></div>
            @if(selectedOutbound){<span class="pill pill-success">Đã chọn chiều đi</span>}
          </div>
          <ng-container *ngTemplateOutlet="flightGroup; context:{direct:direct, connections:connections, direction:'OUTBOUND'}"/>
        </section>

        @if(isRoundTrip){
          <section class="direction return-block" [class.dimmed]="!selectedOutbound">
            <div class="section-head">
              <div><div class="eyebrow">CHIỀU VỀ · {{q['return_date']}}</div><h2>{{q['destination']}} → {{q['origin']}}</h2></div>
              @if(selectedInbound){<span class="pill pill-success">Đã chọn chiều về</span>}
            </div>
            @if(!selectedOutbound){<div class="notice">Chọn chuyến đi trước, sau đó chọn chuyến về.</div>}
            <ng-container *ngTemplateOutlet="flightGroup; context:{direct:returnDirect, connections:returnConnections, direction:'INBOUND'}"/>
          </section>
        }

        @if(policies.length){
          <section class="card policies">
            <div><div class="eyebrow">CHÍNH SÁCH HỦY VÉ</div><h3>Hoàn tiền theo thời điểm hủy</h3><p>Áp dụng theo số ngày còn lại trước chuyến khởi hành sớm nhất.</p></div>
            <div class="policy-list">
              @for(p of policies;track p._id){<span><b>{{p.refund_percentage}}%</b><small>{{p.min_days_before}} – {{p.max_days_before??'∞'}} ngày</small></span>}
            </div>
          </section>
        }

        @if(isRoundTrip && selectedOutbound && selectedInbound){
          <div class="continue card">
            <div><strong>Đã chọn đủ hành trình khứ hồi</strong><span>{{selectionText(selectedOutbound)}} · {{selectionText(selectedInbound)}}</span></div>
            <button class="btn btn-primary" (click)="continueRoundTrip()">Tiếp tục nhập hành khách</button>
          </div>
        }

        <ng-template #flightGroup let-direct="direct" let-connections="connections" let-direction="direction">
          @if(direct.length){
            <div class="group-title">Chuyến bay thẳng</div>
            @for(f of direct;track f.flight_id+f.inventory_id){
              <article class="card flight" [class.chosen]="isChosen(f,direction)">
                <div class="code"><small>APTECH AIRLINES · {{dateLabel(f)}}</small><strong>{{f.flight_number}}</strong>@if(f.early_bird_label){<span class="pill pill-gold">{{f.early_bird_label}}</span>}</div>
                <div class="time"><strong>{{clock(f.scheduled_departure_local||f.scheduled_departure)}}</strong><span>{{f.origin_iata}}</span></div>
                <div class="line"><span>{{duration(f.duration_minutes)}}</span><i></i><small>Bay thẳng</small></div>
                <div class="time right"><strong>{{clock(f.scheduled_arrival_local||f.scheduled_arrival)}}</strong><span>{{f.dest_iata}}</span></div>
                <div class="price"><span class="pill pill-success">Còn {{f.available_seats}} ghế</span><strong>{{money(f.total_party_price)}}</strong><button class="btn btn-primary" [disabled]="direction==='INBOUND'&&!selectedOutbound" (click)="chooseDirect(f,direction)">{{isChosen(f,direction)?'Đã chọn':'Chọn'}}</button></div>
              </article>
            }
          }

          @if(connections.length){
            <div class="group-title connect-title">Chuyến bay nối</div>
            @for(r of connections;track routeKey(r,$index)){
              <article class="card connection" [class.chosen]="isChosen(r,direction)">
                <div class="conn-head"><div><span class="pill pill-gold">{{r.legs?.length||2}} chặng · {{dateLabel(r.legs?.[0])}}</span><h3>{{r.legs?.[0]?.origin_iata}} → {{r.transit_airport||'Transit'}} → {{r.legs?.[r.legs.length-1]?.dest_iata}}</h3></div><b>{{duration(r.total_duration_minutes)}}</b></div>
                @for(l of r.legs;track l.flight_id){<div class="leg"><strong>{{l.flight_number}}</strong><span>{{l.origin_iata}} {{clock(l.scheduled_departure_local||l.scheduled_departure||l.departure)}}</span><app-icon name="arrow" [size]="15"/><span>{{l.dest_iata}} {{clock(l.scheduled_arrival_local||l.scheduled_arrival||l.arrival)}}</span></div>}
                <div class="conn-foot"><span class="muted">Nối chuyến: {{duration(layover(r))}} · còn tối thiểu {{connectionSeats(r)}} ghế</span><strong class="conn-price">{{money(connectionPrice(r))}}</strong><button class="btn btn-primary" [disabled]="direction==='INBOUND'&&!selectedOutbound" (click)="chooseConnection(r,direction)">{{isChosen(r,direction)?'Đã chọn':'Chọn hành trình'}}</button></div>
              </article>
            }
          }

          @if(!direct.length&&!connections.length){
            <div class="card empty"><h2>Chưa có chuyến có thể đặt</h2><p class="muted">Backend chưa có commercial flight phù hợp cho ngày/tuyến này. Thử ngày khác hoặc sân bay khác.</p></div>
          }
        </ng-template>
      }
    </main>
  `,
  styles:[`
    .results-head{background:linear-gradient(120deg,#071b2e,#103b5e);color:#fff;padding:28px 0}.result-bar{display:flex;align-items:center;gap:22px}.back{background:transparent;border:1px solid #365169;color:#fff}.summary-title h1{margin:3px 0;font-size:30px}.summary-title h1 span{color:#d6b35a}.summary-title p{margin:5px 0 0;color:#b7c6d1}.gold{color:#e6c56d}.location-alert{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;margin-bottom:14px;border-color:#d9e7ef;background:#f7fbfd}.location-alert app-icon{color:#1f607f;flex:0 0 auto}.location-alert strong{color:#12344d}.location-alert p{margin:4px 0 0;color:#60788a;font-size:12px;line-height:1.5}.location-error{border-color:#efd0d0;background:#fff7f7}.location-error app-icon,.location-error strong{color:#993737}.direction{scroll-margin-top:20px}.return-block{margin-top:42px}.return-block.dimmed{opacity:.68}.notice{border:1px solid #e6d6a7;background:#fff9e9;color:#795d18;padding:12px 15px;border-radius:14px;margin-bottom:14px}.group-title{font-size:12px;font-weight:900;color:#5b6c7e;text-transform:uppercase;letter-spacing:.06em;margin:22px 0 10px}.connect-title{margin-top:34px}.flight{display:grid;grid-template-columns:150px 1fr 1.4fr 1fr 220px;align-items:center;gap:18px;margin-bottom:12px;padding:22px;transition:.2s}.flight.chosen,.connection.chosen{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.code small{display:block;font-size:9px;color:#8b98a7;font-weight:800}.code strong{display:block;margin:5px 0 8px;color:#071b2e}.time strong{display:block;font-size:27px;color:#071b2e}.time span{font-weight:800;color:#68778a}.right{text-align:right}.line{text-align:center;color:#68778a;font-size:11px}.line i{display:block;height:1px;background:#cfd8e0;margin:8px 0;position:relative}.line i:before,.line i:after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:#071b2e;top:-2px}.line i:before{left:0}.line i:after{right:0}.price{border-left:1px solid #edf1f4;padding-left:20px;display:grid;justify-items:end;gap:8px}.price strong{font-size:22px;color:#071b2e}.connection{padding:22px;margin-bottom:12px}.conn-head,.conn-foot{display:flex;justify-content:space-between;align-items:center;gap:15px}.conn-head h3{margin:10px 0 0;color:#071b2e}.leg{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px dashed #e2e8ee;font-size:13px}.leg:first-of-type{margin-top:16px}.leg strong{min-width:70px;color:#071b2e}.conn-foot{border-top:1px solid #edf1f4;padding-top:15px}.conn-price{color:#071b2e;font-size:18px;white-space:nowrap}.policies{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px 20px;margin-top:30px}.policies h3{color:#071b2e;margin:5px 0}.policies p{margin:0;color:#68778a;font-size:12px}.policy-list{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.policy-list span{display:grid;gap:2px;min-width:90px;text-align:center;background:#f6f8fa;border-radius:12px;padding:9px 11px}.policy-list b{color:#08734f}.policy-list small{font-size:10px;color:#718093}.continue{position:sticky;bottom:18px;margin-top:26px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;z-index:5;border-color:#d6b35a}.continue div{display:grid;gap:5px}.continue span{font-size:12px;color:#68778a}.btn:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.flight{grid-template-columns:1fr 1fr}.code,.line,.price{grid-column:1/-1}.price{border:0;border-top:1px solid #edf1f4;padding:15px 0 0;justify-items:start}.leg{flex-wrap:wrap}.conn-foot{align-items:flex-start;flex-direction:column}.policies{align-items:flex-start;flex-direction:column}.policy-list{justify-content:flex-start}.continue{position:static;align-items:stretch;flex-direction:column}}@media(max-width:620px){.result-bar{align-items:flex-start;flex-direction:column}.summary-title h1{font-size:24px}}
  `]
})
export class ResultsComponent{
  private route=inject(ActivatedRoute);
  private api=inject(ApiService);
  private state=inject(BookingStateService);
  router=inject(Router);
  q:any={}; data:any; policies:any[]=[]; loading=true; error=''; selectedOutbound:any=null; selectedInbound:any=null;

  constructor(){this.api.policies().subscribe({next:r=>this.policies=r,error:()=>{}});this.route.queryParamMap.subscribe(p=>{this.q={};p.keys.forEach(k=>this.q[k]=p.get(k));this.restoreSelection();this.load()})}
  get direct(){return this.data?.onward_flights||[]}
  get connections(){return this.data?.connecting_routes||[]}
  get returnDirect(){return this.data?.return_flights||[]}
  get returnConnections(){return this.data?.return_connecting_routes||[]}
  get isRoundTrip(){return !!this.q['return_date']}
  get passengers(){return Number(this.q['adults']||1)+Number(this.q['children']||0)+Number(this.q['seniors']||0)}
  get outboundDateLabel(){return this.q['departure_date_end']?`${this.q['departure_date']} – ${this.q['departure_date_end']}`:this.q['departure_date']}
  get unresolvedLocations(){const x:string[]=[];if(this.data?.origin_scope?.kind==='none')x.push('nơi đi');if(this.data?.dest_scope?.kind==='none')x.push('nơi đến');return x}
  get locationNotices(){const x:string[]=[];const o=this.locationNotice(this.data?.origin_info,this.data?.origin_scope,'Nơi đi');const d=this.locationNotice(this.data?.dest_info,this.data?.dest_scope,'Nơi đến');if(o)x.push(o);if(d)x.push(d);return x}

  load(){this.loading=true;this.error='';this.api.searchFlights({...this.q,adults:Number(this.q['adults']||1),children:Number(this.q['children']||0),seniors:Number(this.q['seniors']||0),include_connecting:true}).subscribe({next:r=>{this.data=r;this.loading=false},error:e=>{this.error=this.message(e,'Backend không phản hồi.');this.loading=false}})}

  chooseDirect(f:any,direction:'OUTBOUND'|'INBOUND'){
    const option={kind:'DIRECT',source:f,legs:this.normalizeDirect(f,direction)};
    this.choose(option,direction);
  }

  chooseConnection(r:any,direction:'OUTBOUND'|'INBOUND'){
    const option={kind:'CONNECTING',source:r,legs:this.normalizeConnection(r,direction)};
    this.choose(option,direction);
  }

  private choose(option:any,direction:'OUTBOUND'|'INBOUND'){
    if(direction==='INBOUND'&&!this.selectedOutbound)return;
    if(direction==='OUTBOUND'){
      const previousOutboundKey=this.optionKey(this.selectedOutbound);
      const nextOutboundKey=this.optionKey(option);
      this.selectedOutbound=option;
      if(previousOutboundKey&&previousOutboundKey!==nextOutboundKey)this.selectedInbound=null;
    }else this.selectedInbound=option;
    if(!this.isRoundTrip){
      const type=option.legs.length>1?'CONNECTING':'ONE_WAY';
      this.commit(type,option.legs,option,null);
    }
  }

  continueRoundTrip(){if(!this.selectedOutbound||!this.selectedInbound)return;this.commit('ROUND_TRIP',[...this.selectedOutbound.legs,...this.selectedInbound.legs],this.selectedOutbound,this.selectedInbound)}

  private commit(bookingType:string,legs:BookingLeg[],outbound:any,inbound:any){
    const preservePassengers=this.samePassengerComposition(this.state.passengers());
    this.state.search.set(this.q);
    this.state.selection.set({booking_type:bookingType,legs,outbound,inbound});
    if(!preservePassengers)this.state.passengers.set([]);
    this.state.seatRequests.set([]);
    this.state.seatFeeTotal.set(0);
    this.state.quote.set(null);
    this.router.navigate(['/booking/passengers']);
  }

  private normalizeDirect(f:any,direction:'OUTBOUND'|'INBOUND'):BookingLeg[]{const inventory=this.inventory(f);return[{...f,flight_id:f.flight_id||f._id,inventory_id:f.inventory_id||inventory?._id||inventory?.id,leg_type:direction}]}

  private normalizeConnection(r:any,direction:'OUTBOUND'|'INBOUND'):BookingLeg[]{return(r.legs||[]).map((l:any,i:number)=>{const inventory=this.inventory(l);const prefix=direction==='INBOUND'?'INBOUND':'CONNECTING';return{...l,flight_id:l.flight_id||l._id,inventory_id:l.inventory_id||inventory?._id||inventory?.id,total_party_price:inventory?.total_party_price||0,available_seats:inventory?.available_seats,leg_type:`${prefix}_${i+1}`}})}

  private inventory(f:any){return(f.inventories||[]).find((i:any)=>i.cabin_class===this.q['cabin_class'])||(f.inventories||[])[0]}
  isChosen(item:any,direction:string){const chosen=direction==='OUTBOUND'?this.selectedOutbound:this.selectedInbound;if(!chosen)return false;if(item.flight_id)return chosen.legs?.[0]?.flight_id===(item.flight_id||item._id);const itemFlights=(item?.legs||[]).map((l:any)=>String(l.flight_id||l._id||''));const chosenFlights=(chosen?.legs||[]).map((l:any)=>String(l.flight_id||l._id||''));return itemFlights.length>0&&itemFlights.join('>')===chosenFlights.join('>')}
  selectionText(x:any){const legs=x?.legs||[];return legs.map((l:any)=>l.flight_number).filter(Boolean).join(' + ')||'Hành trình đã chọn'}
  private optionKey(option:any){return(option?.legs||[]).map((l:any)=>`${l.flight_id||''}:${l.inventory_id||''}`).join('>')}
  private restoreSelection(){
    this.selectedOutbound=null;this.selectedInbound=null;
    if(!this.sameSearch(this.state.search(),this.q))return;
    const selection=this.state.selection();
    if(!selection?.legs?.length)return;
    this.selectedOutbound=selection.outbound||null;
    this.selectedInbound=selection.booking_type==='ROUND_TRIP'?(selection.inbound||null):null;
  }
  private sameSearch(a:any,b:any){
    if(!a||!b)return false;
    const keys=['origin','destination','departure_date','departure_date_end','return_date','cabin_class','adults','children','seniors'];
    return keys.every(k=>String(a?.[k]??'')===String(b?.[k]??''));
  }
  private samePassengerComposition(passengers:any[]){
    const expected:string[]=[];
    for(let i=0;i<Number(this.q['adults']||1);i++)expected.push('ADULT');
    for(let i=0;i<Number(this.q['children']||0);i++)expected.push('CHILD');
    for(let i=0;i<Number(this.q['seniors']||0);i++)expected.push('SENIOR');
    return passengers.length===expected.length&&passengers.every((p:any,i:number)=>p?.passenger_type===expected[i]);
  }
  routeKey(r:any,i:number){return(r.legs||[]).map((l:any)=>l.flight_id).join('-')||i}
  connectionPrice(r:any){return(r.legs||[]).reduce((sum:number,l:any)=>sum+Number(this.inventory(l)?.total_party_price||0),0)}
  connectionSeats(r:any){const values=(r.legs||[]).map((l:any)=>Number(this.inventory(l)?.available_seats||0)).filter((v:number)=>v>0);return values.length?Math.min(...values):0}
  label(v:string){return({ECONOMY:'Phổ thông',CLUB:'Club',BUSINESS:'Thương gia',FIRST:'Hạng nhất'} as any)[v]||v}
  duration(m:number){m=Number(m||0);return`${Math.floor(m/60)}h ${m%60}m`}
  layover(r:any){const x=r.layover_minutes;return Array.isArray(x)?x.reduce((a:number,b:number)=>a+b,0):Number(x||0)}
  clock(v:string){const m=(v||'').match(/(?:T|\s)(\d{2}:\d{2})/);return m?.[1]||'--:--'}
  dateLabel(f:any){const direct=f?.departure_date;if(direct)return direct;const v=f?.scheduled_departure_local||f?.scheduled_departure||f?.departure||'';const m=String(v).match(/^(\d{4}-\d{2}-\d{2})/);return m?.[1]||this.q['departure_date']||'—'}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  private locationNotice(info:any,scope:any,prefix:string){
    if(!info||scope?.kind==='none')return '';
    const suggestion=info.nearest_suggestion;
    if(info.using_nearest_airport&&suggestion?.airport?.iata_code){
      const distance=suggestion.distance_km!=null?` (${suggestion.distance_km} km)`:'';
      return `${prefix} “${info.query}” chưa được khai thác trực tiếp. Hệ thống đang dùng ${suggestion.airport.iata_code} – ${suggestion.airport.airport_name||suggestion.airport.city_name||'sân bay gần nhất'}${distance}.`;
    }
    const query=String(info.query||'').trim();
    const resolved=String(info.resolved_iata||'').trim();
    if(query&&resolved&&query.toUpperCase()!==resolved.toUpperCase()){
      return `${prefix} “${query}” được xác định là ${scope?.label||resolved}${scope?.iata_codes?.length===1?` (${resolved})`:''}.`;
    }
    return '';
  }
  private message(e:any,fallback:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||fallback}
}
