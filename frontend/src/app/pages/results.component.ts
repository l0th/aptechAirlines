import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingLeg, BookingStateService } from '../core/booking-state.service';
import { IconComponent } from '../shared/icon.component';
import { LanguageService } from '../core/language.service';
import { formatCalendarDate } from '../core/date-format.util';

@Component({
  standalone:true,
  imports:[CommonModule,IconComponent],
  template:`
    <section class="results-head">
      <div class="container result-bar">
        <button class="btn back" (click)="router.navigate(['/'])">{{t('← Sửa tìm kiếm','← Edit search')}}</button>
        <div class="summary-title">
          <div class="eyebrow gold">{{t('KẾT QUẢ CHUYẾN BAY','FLIGHT RESULTS')}}</div>
          <h1 translate="no">{{q['origin']}} <span>→</span> {{q['destination']}}</h1>
          <p><span translate="no">{{outboundDateLabel}}{{returnDateLabel ? ' → '+returnDateLabel : ''}} · {{passengers}} {{t('hành khách', 'passengers')}}</span> · {{t('So sánh mọi hạng vé','Compare all cabins')}}</p>
        </div>
      </div>
    </section>

    <main class="container page">
      @if(loading){
        <div class="card empty"><h2>{{t('Đang tìm chuyến phù hợp…','Searching for eligible flights…')}}</h2><p class="muted">{{t('Kiểm tra chuyến thẳng, nối chuyến, giá và số ghế.','Checking direct and connecting flights, fares and seat availability.')}}</p></div>
      }@else if(error){
        <div class="card empty"><h2>{{t('Không tải được kết quả','Unable to load results')}}</h2><p class="error">{{error}}</p></div>
      }@else{
        @if(unresolvedLocations.length){
          <div class="card location-alert location-error">
            <app-icon name="search" [size]="20"/>
            <div><strong>{{t('Chưa nhận diện được','Could not identify')}} {{unresolvedLocations.join(t(' và ',' and '))}}</strong><p>{{t('Hãy quay lại và chọn thành phố hoặc sân bay từ danh sách gợi ý để tìm chính xác hơn.','Go back and select a city or airport from the suggestions for an accurate search.')}}</p></div>
          </div>
        }
        @for(message of locationNotices;track message){
          <div class="card location-alert">
            <app-icon name="pin" [size]="20"/>
            <div><strong>{{language.pick('Điểm bay đã được xác định','Airport resolved')}}</strong><p translate="no">{{message}}</p></div>
          </div>
        }
        <section class="direction">
          <div class="section-head">
            <div><div class="eyebrow">{{language.pick('CHIỀU ĐI','OUTBOUND')}} · {{outboundDateLabel}}</div><h2 translate="no">{{q['origin']}} → {{q['destination']}}</h2></div>
            @if(selectedOutbound){<span class="pill pill-success">{{t('Đã chọn chiều đi','Outbound selected')}}</span>}
          </div>
          <ng-container *ngTemplateOutlet="flightGroup; context:{direct:direct, connections:connections, direction:'OUTBOUND'}"/>
        </section>

        @if(isRoundTrip){
          <section class="direction return-block" [class.dimmed]="!selectedOutbound">
            <div class="section-head">
              <div><div class="eyebrow">{{language.pick('CHIỀU VỀ','RETURN')}} · {{returnDateLabel}}</div><h2 translate="no">{{q['destination']}} → {{q['origin']}}</h2></div>
              @if(selectedInbound){<span class="pill pill-success">{{t('Đã chọn chiều về','Return selected')}}</span>}
            </div>
            @if(!selectedOutbound){<div class="notice">{{t('Chọn chuyến đi trước, sau đó chọn chuyến về.','Select the outbound flight before choosing the return flight.')}}</div>}
            <ng-container *ngTemplateOutlet="flightGroup; context:{direct:returnDirect, connections:returnConnections, direction:'INBOUND'}"/>
          </section>
        }

        @if(policies.length){
          <section class="card policies">
            <div><div class="eyebrow">{{t('CHÍNH SÁCH HỦY VÉ','CANCELLATION POLICY')}}</div><h3>{{t('Hoàn tiền theo thời điểm hủy','Refund based on cancellation time')}}</h3><p>{{t('Áp dụng theo số ngày còn lại trước chuyến khởi hành sớm nhất.','Calculated from the number of days before the earliest departure.')}}</p></div>
            <div class="policy-list">
              @for(p of policies;track p._id){<span><b>{{p.refund_percentage}}%</b><small>{{p.min_days_before}} – {{p.max_days_before??'∞'}} {{language.pick('ngày','days')}}</small></span>}
            </div>
          </section>
        }

        @if(isRoundTrip && selectedOutbound && selectedInbound){
          <div class="continue card">
            <div><strong>{{t('Đã chọn đủ hành trình khứ hồi','Round trip selected')}}</strong><span translate="no">{{selectionText(selectedOutbound)}} · {{selectionText(selectedInbound)}}</span></div>
            <button class="btn btn-primary" (click)="continueRoundTrip()">{{t('Tiếp tục nhập hành khách','Continue to passengers')}}</button>
          </div>
        }

        <ng-template #flightGroup let-direct="direct" let-connections="connections" let-direction="direction">
          @if(direct.length){
            <div class="group-title">{{t('Chuyến bay thẳng','Direct flights')}}</div>
            @for(f of direct;track directKey(f)){
              <article class="card flight" [class.chosen]="isDirectChosen(f,direction)">
                <div class="code"><small>APTECH AIRLINES · {{dateLabel(f)}}</small><strong translate="no">{{f.flight_number}}</strong>@if(f.early_bird_label){<span class="pill pill-gold">{{f.early_bird_label}}</span>}@if(f.load_adjustment_percent){<span class="pill pill-success">{{f.load_adjustment_label}} {{f.load_adjustment_percent>0?'+':''}}{{f.load_adjustment_percent}}%</span>}@if(f.pricing_profile_name){<small translate="no">{{f.pricing_profile_name}}</small>}</div>
                <div class="time"><strong>{{clock(f.scheduled_departure_local||f.scheduled_departure)}}</strong><span>{{f.origin_iata}}</span></div>
                <div class="line"><span>{{duration(f.duration_minutes)}}</span><i></i><small>{{t('Bay thẳng','Direct')}}</small></div>
                <div class="time right"><strong>{{clock(f.scheduled_arrival_local||f.scheduled_arrival)}}</strong><span>{{f.dest_iata}}</span></div>
                <div class="fare-options">
                  <span class="fare-heading">{{t('Chọn hạng vé','Select cabin')}}</span>
                  @for(v of f.variants;track v.inventory_id){
                    <div class="fare-option" [class.on]="isDirectCabinChosen(f,v,direction)">
                      <div><b translate="no">{{label(v.cabin_class)}}</b><small translate="no">{{language.pick('Còn', 'Available:')}} {{v.available_seats}} {{language.pick('ghế', 'seats')}}</small></div>
                      <strong>{{money(v.total_party_price)}}</strong>
                      <button class="btn btn-primary" translate="no" [disabled]="direction==='INBOUND'&&!selectedOutbound" (click)="chooseDirect(f,v,direction)">{{isDirectCabinChosen(f,v,direction)?language.pick('Đã chọn', 'Selected'):language.pick('Chọn', 'Select')}}</button>
                    </div>
                  }
                </div>
              </article>
            }
          }

          @if(connections.length){
            <div class="group-title connect-title">{{t('Chuyến bay nối','Connecting flights')}}</div>
            @for(r of connections;track routeKey(r,$index)){
              <article class="card connection" [class.chosen]="isConnectionChosen(r,direction)">
                <div class="conn-head"><div><span class="pill pill-gold">{{r.legs?.length||2}} {{language.pick('chặng','legs')}} · {{dateLabel(r.legs?.[0])}}</span><h3 translate="no">{{r.legs?.[0]?.origin_iata}} → {{r.transit_airport||'Transit'}} → {{r.legs?.[r.legs.length-1]?.dest_iata}}</h3></div><b>{{duration(r.total_duration_minutes)}}</b></div>
                @for(l of r.legs;track l.flight_id){<div class="leg"><strong>{{l.flight_number}}</strong><span>{{l.origin_iata}} {{clock(l.scheduled_departure_local||l.scheduled_departure||l.departure)}}</span><app-icon name="arrow" [size]="15"/><span>{{l.dest_iata}} {{clock(l.scheduled_arrival_local||l.scheduled_arrival||l.arrival)}}</span></div>}
                <div class="conn-foot">
                  <span class="muted">{{language.pick('Nối chuyến','Layover')}}: {{duration(layover(r))}}</span>
                  <div class="connection-fares">
                    @for(v of connectionCabinOptions(r);track v.cabin_class){
                      <div class="fare-option" [class.on]="isConnectionCabinChosen(r,v.cabin_class,direction)">
                        <div><b translate="no">{{label(v.cabin_class)}}</b><small translate="no">{{language.pick('Còn tối thiểu', 'At least')}} {{v.available_seats}} {{language.pick('ghế', 'seats')}} {{language.pick('còn trống', 'available')}}</small></div>
                        <strong>{{money(v.total_party_price)}}</strong>
                        <button class="btn btn-primary" translate="no" [disabled]="direction==='INBOUND'&&!selectedOutbound" (click)="chooseConnection(r,v.cabin_class,direction)">{{isConnectionCabinChosen(r,v.cabin_class,direction)?language.pick('Đã chọn', 'Selected'):language.pick('Chọn', 'Select')}}</button>
                      </div>
                    }
                  </div>
                </div>
              </article>
            }
          }

          @if(!direct.length&&!connections.length){
            <div class="card empty"><h2>{{t('Không tìm thấy chuyến bay phù hợp','No eligible flights found')}}</h2><p class="muted">{{t('Hiện chưa có chuyến bay phù hợp với ngày và hành trình bạn đã chọn. Vui lòng thử ngày khác hoặc sân bay khác.','No flight currently matches your selected date and route. Try another date or airport.')}}</p></div>
          }
        </ng-template>
      }
    </main>
  `,
  styles:[`
    .results-head{background:linear-gradient(120deg,#071b2e,#103b5e);color:#fff;padding:28px 0}.result-bar{display:flex;align-items:center;gap:22px}.back{background:transparent;border:1px solid #365169;color:#fff}.summary-title h1{margin:3px 0;font-size:30px}.summary-title h1 span{color:#d6b35a}.summary-title p{margin:5px 0 0;color:#b7c6d1}.gold{color:#e6c56d}.location-alert{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;margin-bottom:14px;border-color:#d9e7ef;background:#f7fbfd}.location-alert app-icon{color:#1f607f;flex:0 0 auto}.location-alert strong{color:#12344d}.location-alert p{margin:4px 0 0;color:#60788a;font-size:12px;line-height:1.5}.location-error{border-color:#efd0d0;background:#fff7f7}.location-error app-icon,.location-error strong{color:#993737}.direction{scroll-margin-top:20px}.return-block{margin-top:42px}.return-block.dimmed{opacity:.68}.notice{border:1px solid #e6d6a7;background:#fff9e9;color:#795d18;padding:12px 15px;border-radius:14px;margin-bottom:14px}.group-title{font-size:12px;font-weight:900;color:#5b6c7e;text-transform:uppercase;letter-spacing:.06em;margin:22px 0 10px}.connect-title{margin-top:34px}.flight{display:grid;grid-template-columns:150px 1fr 1.4fr 1fr minmax(330px,440px);align-items:center;gap:18px;margin-bottom:12px;padding:22px;transition:.2s}.flight.chosen,.connection.chosen{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.code small{display:block;font-size:9px;color:#8b98a7;font-weight:800}.code strong{display:block;margin:5px 0 8px;color:#071b2e}.time strong{display:block;font-size:27px;color:#071b2e}.time span{font-weight:800;color:#68778a}.right{text-align:right}.line{text-align:center;color:#68778a;font-size:11px}.line i{display:block;height:1px;background:#cfd8e0;margin:8px 0;position:relative}.line i:before,.line i:after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:#071b2e;top:-2px}.line i:before{left:0}.line i:after{right:0}.fare-options{border-left:1px solid #edf1f4;padding-left:18px;display:grid;gap:7px}.fare-heading{font-size:9px;font-weight:900;letter-spacing:.08em;color:#78899a;text-transform:uppercase}.fare-option{display:grid;grid-template-columns:minmax(92px,1fr) auto auto;align-items:center;gap:10px;border:1px solid #e4eaf0;background:#fbfcfd;border-radius:12px;padding:8px 9px}.fare-option.on{border-color:#d6b35a;background:#fff9e8;box-shadow:0 0 0 2px rgba(214,179,90,.1)}.fare-option>div{display:grid;gap:2px}.fare-option b{color:#16344c;font-size:12px}.fare-option small{color:#718293;font-size:9px}.fare-option>strong{color:#071b2e;font-size:14px;white-space:nowrap}.fare-option .btn{padding:8px 10px;font-size:10px;white-space:nowrap}.connection{padding:22px;margin-bottom:12px}.conn-head,.conn-foot{display:flex;justify-content:space-between;align-items:center;gap:15px}.conn-head h3{margin:10px 0 0;color:#071b2e}.leg{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px dashed #e2e8ee;font-size:13px}.leg:first-of-type{margin-top:16px}.leg strong{min-width:70px;color:#071b2e}.conn-foot{border-top:1px solid #edf1f4;padding-top:15px;align-items:flex-start}.connection-fares{display:grid;gap:7px;min-width:min(100%,460px)}.policies{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px 20px;margin-top:30px}.policies h3{color:#071b2e;margin:5px 0}.policies p{margin:0;color:#68778a;font-size:12px}.policy-list{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.policy-list span{display:grid;gap:2px;min-width:90px;text-align:center;background:#f6f8fa;border-radius:12px;padding:9px 11px}.policy-list b{color:#08734f}.policy-list small{font-size:10px;color:#718093}.continue{position:sticky;bottom:18px;margin-top:26px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;z-index:5;border-color:#d6b35a}.continue div{display:grid;gap:5px}.continue span{font-size:12px;color:#68778a}.btn:disabled{opacity:.45;cursor:not-allowed}@media(max-width:1050px){.flight{grid-template-columns:1fr 1fr}.code,.line,.fare-options{grid-column:1/-1}.fare-options{border:0;border-top:1px solid #edf1f4;padding:15px 0 0}}@media(max-width:900px){.leg{flex-wrap:wrap}.conn-foot{align-items:stretch;flex-direction:column}.connection-fares{min-width:0;width:100%}.policies{align-items:flex-start;flex-direction:column}.policy-list{justify-content:flex-start}.continue{position:static;align-items:stretch;flex-direction:column}}@media(max-width:620px){.result-bar{align-items:flex-start;flex-direction:column}.summary-title h1{font-size:24px}.fare-option{grid-template-columns:1fr auto}.fare-option .btn{grid-column:1/-1;width:100%}}
  `]
})
export class ResultsComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  readonly language=inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  private route=inject(ActivatedRoute);
  private api=inject(ApiService);
  private state=inject(BookingStateService);
  router=inject(Router);
  q:any={}; data:any; policies:any[]=[]; loading=true; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)}; selectedOutbound:any=null; selectedInbound:any=null;

  constructor(){this.api.policies().subscribe({next:r=>this.policies=r,error:()=>{}});this.route.queryParamMap.subscribe(p=>{this.q={};p.keys.forEach(k=>this.q[k]=p.get(k));delete this.q['cabin_class'];this.restoreSelection();this.load()})}
  get direct(){return this.groupDirect(this.data?.onward_flights||[])}
  get connections(){return this.data?.connecting_routes||[]}
  get returnDirect(){return this.groupDirect(this.data?.return_flights||[])}
  get returnConnections(){return this.data?.return_connecting_routes||[]}
  get isRoundTrip(){return !!this.q['return_date']}
  get passengers(){return Number(this.q['adults']||1)+Number(this.q['children']||0)+Number(this.q['seniors']||0)}
  get outboundDateLabel(){const start=formatCalendarDate(this.q['departure_date']);return this.q['departure_date_end']?`${start} – ${formatCalendarDate(this.q['departure_date_end'])}`:start}
  get returnDateLabel(){return this.q['return_date']?formatCalendarDate(this.q['return_date']):''}
  get unresolvedLocations(){const x:string[]=[];if(this.data?.origin_scope?.kind==='none')x.push(this.language.pick('nơi đi','origin'));if(this.data?.dest_scope?.kind==='none')x.push(this.language.pick('nơi đến','destination'));return x}
  get locationNotices(){const x:string[]=[];const o=this.locationNotice(this.data?.origin_info,this.data?.origin_scope,'Nơi đi','Origin');const d=this.locationNotice(this.data?.dest_info,this.data?.dest_scope,'Nơi đến','Destination');if(o)x.push(o);if(d)x.push(d);return x}

  load(){this.loading=true;this.error='';this.api.searchFlights({...this.q,adults:Number(this.q['adults']||1),children:Number(this.q['children']||0),seniors:Number(this.q['seniors']||0),include_connecting:true}).subscribe({next:r=>{this.data=r;this.loading=false},error:e=>{this.error=this.message(e,this.language.pick('Không thể tải kết quả tìm kiếm. Vui lòng thử lại.','Unable to load search results. Please try again.'));this.loading=false}})}

  chooseDirect(group:any,variant:any,direction:'OUTBOUND'|'INBOUND'){
    const option={kind:'DIRECT',source:variant,legs:this.normalizeDirect(group,variant,direction)};
    this.choose(option,direction);
  }

  chooseConnection(r:any,cabinClass:string,direction:'OUTBOUND'|'INBOUND'){
    const fare=this.connectionCabinOptions(r).find(x=>x.cabin_class===cabinClass);
    const option={kind:'CONNECTING',source:{...r,selected_cabin:cabinClass,total_party_price:fare?.total_party_price||0},legs:this.normalizeConnection(r,direction,cabinClass)};
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

  private normalizeDirect(group:any,variant:any,direction:'OUTBOUND'|'INBOUND'):BookingLeg[]{
    const cabinOptions=(group?.variants||[]).map((v:any)=>this.toCabinOption(v));
    return[{...group,...variant,variants:undefined,flight_id:variant.flight_id||group.flight_id||variant._id,inventory_id:String(variant.inventory_id||variant._id||''),cabin_class:variant.cabin_class,cabin_options:cabinOptions,leg_type:direction}]
  }

  private normalizeConnection(r:any,direction:'OUTBOUND'|'INBOUND',cabinClass:string):BookingLeg[]{
    return(r.legs||[]).map((l:any,i:number)=>{
      const inventory=this.inventory(l,cabinClass);
      const prefix=direction==='INBOUND'?'INBOUND':'CONNECTING';
      return{...l,flight_id:l.flight_id||l._id,inventory_id:String(inventory?._id||inventory?.id||''),cabin_class:inventory?.cabin_class||cabinClass,cabin_options:(l.inventories||[]).map((x:any)=>this.toCabinOption(x)),total_party_price:Number(inventory?.total_party_price||0),available_seats:Number(inventory?.available_seats||0),leg_type:`${prefix}_${i+1}`}
    })
  }

  private inventory(f:any,cabinClass?:string){return(f.inventories||[]).find((i:any)=>i.cabin_class===cabinClass)||(f.inventories||[])[0]}
  isDirectChosen(group:any,direction:string){const chosen=direction==='OUTBOUND'?this.selectedOutbound:this.selectedInbound;return !!chosen?.legs?.some((l:any)=>String(l.flight_id)===String(group.flight_id||group._id))}
  isDirectCabinChosen(group:any,variant:any,direction:string){const chosen=direction==='OUTBOUND'?this.selectedOutbound:this.selectedInbound;const leg=chosen?.legs?.find((l:any)=>String(l.flight_id)===String(group.flight_id||group._id));return !!leg&&String(leg.inventory_id)===String(variant.inventory_id)}
  isConnectionChosen(route:any,direction:string){const chosen=direction==='OUTBOUND'?this.selectedOutbound:this.selectedInbound;if(!chosen)return false;const itemFlights=(route?.legs||[]).map((l:any)=>String(l.flight_id||l._id||''));const chosenFlights=(chosen?.legs||[]).map((l:any)=>String(l.flight_id||l._id||''));return itemFlights.length>0&&itemFlights.join('>')===chosenFlights.join('>')}
  isConnectionCabinChosen(route:any,cabinClass:string,direction:string){return this.isConnectionChosen(route,direction)&&((direction==='OUTBOUND'?this.selectedOutbound:this.selectedInbound)?.legs||[]).every((l:any)=>l.cabin_class===cabinClass)}
  selectionText(x:any){const legs=x?.legs||[];return legs.map((l:any)=>l.flight_number).filter(Boolean).join(' + ')||this.language.pick('Hành trình đã chọn','Selected itinerary')}
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
    const keys=['origin','destination','departure_date','departure_date_end','return_date','adults','children','seniors'];
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
  directKey(f:any){return`${f.flight_id||f._id||f.flight_number}:${f.scheduled_departure||f.departure_date||''}`}
  connectionCabinOptions(r:any){
    const legs=r?.legs||[];if(!legs.length)return[];
    const common=new Set<string>((legs[0].inventories||[]).map((i:any)=>String(i.cabin_class||'')));
    for(const leg of legs.slice(1))for(const cabin of [...common])if(!(leg.inventories||[]).some((i:any)=>i.cabin_class===cabin))common.delete(cabin);
    return[...common].map(cabin=>{
      const inventories=legs.map((l:any)=>this.inventory(l,cabin));
      return{cabin_class:cabin,total_party_price:inventories.reduce((s:number,i:any)=>s+Number(i?.total_party_price||0),0),available_seats:Math.min(...inventories.map((i:any)=>Number(i?.available_seats||0)))};
    }).filter(x=>x.available_seats>=this.passengers).sort((a,b)=>this.cabinRank(a.cabin_class)-this.cabinRank(b.cabin_class));
  }
  label(v:string){return this.language.cabinLabel(v)}
  duration(m:number){m=Number(m||0);return`${Math.floor(m/60)}h ${m%60}m`}
  layover(r:any){const x=r.layover_minutes;return Array.isArray(x)?x.reduce((a:number,b:number)=>a+b,0):Number(x||0)}
  clock(v:string){const m=(v||'').match(/(?:T|\s)(\d{2}:\d{2})/);return m?.[1]||'--:--'}
  dateLabel(f:any){const direct=f?.departure_date;if(direct)return formatCalendarDate(direct);const v=f?.scheduled_departure_local||f?.scheduled_departure||f?.departure||this.q['departure_date'];return formatCalendarDate(v)}
  money(v:number){return new Intl.NumberFormat(this.language.language()==='vi'?'vi-VN':'en-US',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  private groupDirect(rows:any[]){
    const groups=new Map<string,any>();
    for(const row of rows){
      const key=this.directKey(row);let group=groups.get(key);
      if(!group){group={...row,variants:[]};groups.set(key,group)}
      group.variants.push(row);
    }
    return[...groups.values()].map(g=>({...g,variants:[...g.variants].sort((a:any,b:any)=>this.cabinRank(a.cabin_class)-this.cabinRank(b.cabin_class))}));
  }
  private toCabinOption(v:any){return{inventory_id:String(v?.inventory_id||v?._id||v?.id||''),cabin_class:v?.cabin_class,available_seats:Number(v?.available_seats||0),total_party_price:Number(v?.total_party_price||0),base_price_per_adult:Number(v?.base_price_per_adult||v?.base_price||0)}}
  private cabinRank(cabin:string){return({ECONOMY:1,CLUB:2,BUSINESS:3,FIRST:4} as Record<string,number>)[String(cabin||'').toUpperCase()]||99}
  private locationNotice(info:any,scope:any,prefixVi:string,prefixEn:string){
    if(!info||scope?.kind==='none')return '';
    const suggestion=info.nearest_suggestion;
    if(info.using_nearest_airport&&suggestion?.airport?.iata_code){
      const distance=suggestion.distance_km!=null?` (${suggestion.distance_km} km)`:'';
      const airportName=suggestion.airport.airport_name||suggestion.airport.city_name||this.language.pick('sân bay gần nhất','nearest airport');
      return this.language.pick(
        `${prefixVi} “${info.query}” chưa được khai thác trực tiếp. Hệ thống đang dùng ${suggestion.airport.iata_code} – ${airportName}${distance}.`,
        `${prefixEn} “${info.query}” is not served directly. Using ${suggestion.airport.iata_code} – ${airportName}${distance}.`,
      );
    }
    const query=String(info.query||'').trim();
    const resolved=String(info.resolved_iata||'').trim();
    if(query&&resolved&&query.toUpperCase()!==resolved.toUpperCase()){
      return this.language.pick(
        `${prefixVi} “${query}” được xác định là ${scope?.label||resolved}${scope?.iata_codes?.length===1?` (${resolved})`:''}.`,
        `${prefixEn} “${query}” was resolved as ${scope?.label||resolved}${scope?.iata_codes?.length===1?` (${resolved})`:''}.`,
      );
    }
    return '';
  }
  private message(e:any,fallback:string){const m=e?.error?.message;return this.language.translateNotice(Array.isArray(m)?m.join(' · '):m||fallback)}
}
