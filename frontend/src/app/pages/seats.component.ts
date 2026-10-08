import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingLeg, BookingStateService } from '../core/booking-state.service';
import { LanguageService } from '../core/language.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  standalone:true,
  imports:[IconComponent],
  template:`
  <div class="container page">
    <div class="eyebrow">{{t('BƯỚC 3 / 4','STEP 3 / 4')}}</div>
    <h1 class="title">{{t('Chọn chỗ ngồi','Seat selection')}}</h1>
    <p class="subtitle">{{t('Chọn hạng vé và ghế cho từng chặng. Bạn vẫn có thể đổi hạng vé ngay tại đây trước khi thanh toán.','Choose the cabin and seat for each leg. You can still change cabin here before payment.')}}</p>

    <div class="leg-tabs">
      @for(leg of legs;track leg.flight_id;let i=$index){
        <button [class.on]="legIndex===i" [class.done]="coveredForLeg(leg)" (click)="openLeg(i)">
          <span>{{i+1}}</span>
          <b>{{leg.flight_number||t('Chuyến bay','Flight')}}</b>
          <small>{{leg.origin_iata}} → {{leg.dest_iata}}</small>
        </button>
      }
    </div>

    @if(loading){<div class="card empty">{{t('Đang tải sơ đồ ghế…','Loading seat map…')}}</div>}
    @else if(error){<div class="card empty"><p class="error">{{error}}</p><button class="btn btn-outline" (click)="loadLeg()">{{t('Tải lại','Retry')}}</button></div>}
    @else{
      <section class="seat-toolbar card">
        <div>
          <div class="eyebrow">{{t('CHẶNG','LEG')}} {{legIndex+1}} / {{legs.length}}</div>
          <strong>{{currentLeg.flight_number}} · {{currentLeg.origin_iata}} → {{currentLeg.dest_iata}}</strong>
          @if(seatMap){<small class="aircraft-meta">{{seatMap.aircraft_model||seatMap.aircraft_type||t('Máy bay','Aircraft')}} · {{seatMap.total_capacity||0}} {{t('ghế','seats')}}</small>}
        </div>
        <div class="pass-tabs">
          @for(p of state.passengers();track $index;let i=$index){
            <button [class.on]="passengerIndex===i" [class.done]="requestFor(i,currentLeg.flight_id)" (click)="passengerIndex=i">{{i+1}}. {{p.first_name}} {{p.last_name}}</button>
          }
        </div>
      </section>

      @if(currentCabinOptions.length){
        <section class="cabin-selector card">
          <div class="cabin-copy">
            <span class="eyebrow">{{t('HẠNG VÉ CỦA CHẶNG','CABIN FOR THIS LEG')}}</span>
            <strong>{{t('Bạn có thể đổi hạng vé trước khi chọn ghế','You can change cabin before selecting a seat')}}</strong>
            <small>{{t('Đổi hạng sẽ cập nhật lại giá vé và xóa các ghế đã chọn trên riêng chặng này.','Changing cabin updates the fare and clears seat selections for this leg only.')}}</small>
          </div>
          <div class="cabin-options">
            @for(c of currentCabinOptions;track c.inventory_id){
              <button type="button" [class.on]="currentCabin===c.cabin_class" (click)="switchCabin(c)">
                <span>{{cabinLabel(c.cabin_class)}}</span>
                <b>{{money(c.total_party_price)}}</b>
                <small>{{c.available_seats}} {{t('ghế còn','seats left')}}</small>
              </button>
            }
          </div>
        </section>
      }

      <section class="map-guide card">
        <div><span class="guide-label">{{t('CÁCH ĐỌC SƠ ĐỒ','HOW TO READ THE MAP')}}</span><strong>{{t('Mũi máy bay → các hàng ghế → đuôi máy bay','Aircraft nose → seat rows → aircraft tail')}}</strong></div>
        <div class="guide-example"><b>18A</b><span><strong>18</strong> {{t('= hàng ghế','= seat row')}} · <strong>A</strong> {{t('= vị trí ghế','= seat position')}}</span></div>
        <div class="guide-example aisle-example"><i></i><span>{{t('Khoảng trống nét đứt = lối đi','Dashed gap = aisle')}}</span></div>
      </section>

      <div class="legend">
        <span><i class="available"></i>{{t('Còn trống','Available')}}</span>
        <span><i class="selected"></i>{{t('Đang chọn','Selected now')}}</span>
        <span><i class="occupied"></i>{{t('Đã bán / giữ','Sold / held')}}</span>
        <span><i class="other"></i>{{t('Người cùng đặt chỗ đã chọn','Selected by another passenger')}}</span>
        <span><i class="wrong-cabin"></i>{{t('Hạng khác — bấm ghế để đổi hạng','Different cabin — click a seat to switch')}}</span>
        <span><i class="exit-row"></i>{{t('Hàng thoát hiểm','Exit row')}}</span>
      </div>

      @if(changingSeat){
        <div class="change-banner"><strong>{{t('Đang đổi ghế','Changing seat')}} {{currentRequest?.seat_code}}</strong><span>{{t('Chọn một ghế còn trống khác trên sơ đồ. Ghế cũ chỉ được thay thế sau khi bạn chọn ghế mới.','Choose another available seat on the map. Your current seat is replaced only after you select a new one.')}}</span></div>
      }

      <div class="aircraft-shell" id="seat-map-area">
        <div class="aircraft">
          <div class="nose">{{t('MŨI','NOSE')}}</div>
          <div class="rows">
            @for(row of rows;track row.row_number){
              <div class="seat-row">
                <b><span>{{t('Hàng','Row')}}</span>{{row.row_number}}</b>
                <div class="seat-groups">
                  @for(group of seatGroups(row);track $index;let last=$last){
                    <div class="seat-group">
                      @for(s of group;track s.seat_code){
                        <button
                          [disabled]="s.is_occupied||selectedByOther(s.seat_code)||!seatSelectable(s)"
                          [class.selected]="selectedForPassenger(s.seat_code)"
                          [class.occupied]="s.is_occupied"
                          [class.other]="selectedByOther(s.seat_code)"
                          [class.wrong-cabin]="!seatEligible(s)"
                          [class.exit]="s.is_exit_row"
                          [attr.aria-label]="seatAria(s)"
                          [attr.title]="seatTooltip(s)"
                          (click)="choose(s)">
                          @if(selectedForPassenger(s.seat_code)){
                            <span class="seat-check"><app-icon name="check" [size]="12"/></span>
                          }
                          <span class="seat-code">{{s.seat_code}}</span>
                          <small>{{fee(feeValue(s))}}</small>
                        </button>
                      }
                    </div>
                    @if(!last){<div class="aisle" aria-hidden="true"></div>}
                  }
                </div>
              </div>
            }
          </div>
          <div class="tail">{{t('ĐUÔI','TAIL')}}</div>
        </div>
      </div>

      <div class="seat-actions card">
        <div class="selection">
          <strong>{{currentPassengerName}}</strong>
          @if(currentSelectedSeat){
            <div class="selected-seat-detail">
              <div class="selected-code">{{currentSelectedSeat.seat_code}}</div>
              <div class="selected-meta">
                <b>{{seatPositionLabel(currentSelectedSeat)}} · {{cabinLabel(currentSelectedSeat.cabin_class)}}</b>
                <span>{{t('Hàng','Row')}} {{seatRowNumber(currentSelectedSeat)}} · {{t('Ghế','Seat')}} {{seatLetter(currentSelectedSeat)}} · {{seatFeatureLabel(currentSelectedSeat)}}</span>
                <span>{{t('Phụ phí','Seat fee')}}: <strong>{{money(feeValue(currentSelectedSeat))}}</strong></span>
              </div>
            </div>
            <p class="change-copy">{{t('Muốn đổi ghế? Bạn có thể bấm trực tiếp một ghế còn trống khác, hoặc dùng nút “Đổi ghế” để quay về sơ đồ.','Want to change seats? Click any other available seat, or use “Change seat” to return to the map.')}}</p>
          }@else{
            <span>{{currentSelectionText}}</span>
          }
        </div>
        <div class="seat-action-buttons">
          @if(currentSelectedSeat){<button class="btn btn-dark" (click)="beginChange()">{{t('Đổi ghế','Change seat')}}</button>}
          @else if(currentRequest?.selection_type==='AUTO'){<button class="btn btn-dark" (click)="beginChange()">{{t('Chọn ghế cụ thể','Choose a specific seat')}}</button>}
          <button class="btn btn-outline" (click)="autoCurrent()">{{t('Tự động xếp ghế','Auto-assign seat')}}</button>
        </div>
      </div>

      <div class="summary card price-summary">
        <div class="summary-copy"><strong>{{t('Tổng giá cho lựa chọn hiện tại','Total for current selection')}}</strong><p class="muted">{{summaryText}}</p></div>
        <div class="fare-breakdown">
          @for(leg of legs;track leg.flight_id){
            <div class="fare-line"><span>{{leg.flight_number}} · {{cabinLabel(leg['cabin_class'])}}</span><b>{{money(leg['total_party_price']||0)}}</b></div>
          }
          @if(selectedSeatFeeRows.length){
            @for(item of selectedSeatFeeRows;track item.key){
              <div class="fare-line seat-fee-line"><span>{{item.label}}</span><b>{{money(item.fee)}}</b></div>
            }
          }@else{
            <div class="fare-line"><span>{{t('Phụ phí ghế đã chọn','Selected seat fees')}}</span><b>{{money(0)}}</b></div>
          }
          @if(selectedSeatFeeRows.length>1){<div class="fare-line"><span>{{t('Tổng phụ phí ghế','Total seat fees')}}</span><b>{{money(totalSeatFee)}}</b></div>}
          <div class="fare-line grand"><span>{{t('Tổng tạm tính','Estimated total')}}</span><strong>{{money(grandTotal)}}</strong></div>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-outline" (click)="router.navigate(['/booking/passengers'])">{{t('Quay lại','Back')}}</button>
        <button class="btn btn-primary" (click)="next()">{{t('Kiểm tra & thanh toán','Review & payment')}}</button>
      </div>
    }
  </div>
  `,
  styles:[`
    .leg-tabs{display:flex;gap:9px;overflow-x:auto;padding:4px 2px 12px;margin:18px 0}.leg-tabs button{min-width:180px;border:1px solid #d9e2e9;background:#fff;border-radius:16px;padding:11px 13px;text-align:left;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;color:#667588}.leg-tabs button>span{grid-row:1/3;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#edf2f6;font-weight:900}.leg-tabs b{color:#071b2e}.leg-tabs small{font-size:11px}.leg-tabs button.on{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.leg-tabs button.done>span{background:#e9f7f1;color:#16845b}.seat-toolbar{padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:18px}.seat-toolbar strong{display:block;color:#071b2e;margin-top:4px}.aircraft-meta{display:block;color:#748596;margin-top:5px}.pass-tabs{display:flex;gap:8px;overflow:auto;max-width:64%}.pass-tabs button{white-space:nowrap;border:1px solid #d9e2e9;background:white;border-radius:999px;padding:9px 13px;font-weight:800;color:#667588}.pass-tabs button.on{background:#071b2e;color:white}.pass-tabs button.done:not(.on){border-color:#a9d9c5;color:#16845b;background:#f1fbf6}.cabin-selector{margin-top:12px;padding:16px 18px;display:grid;grid-template-columns:minmax(240px,.8fr) 1.4fr;gap:18px;align-items:center;border-color:#dbe5ec}.cabin-copy{display:grid;gap:5px}.cabin-copy strong{color:#0b2942}.cabin-copy small{color:#6a7c8d;line-height:1.45}.cabin-options{display:flex;gap:8px;overflow-x:auto;padding:3px}.cabin-options button{min-width:150px;border:1px solid #d9e2e9;background:#fff;border-radius:14px;padding:10px 12px;display:grid;gap:3px;text-align:left;color:#5f7284;cursor:pointer}.cabin-options button span{font-size:11px;font-weight:900;color:#18364d}.cabin-options button b{font-size:15px;color:#071b2e}.cabin-options button small{font-size:9px;color:#748596}.cabin-options button.on{border-color:#d6b35a;background:#fff9e6;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.map-guide{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:18px;align-items:center;padding:14px 18px;margin-top:12px;background:#fbfcfd}.map-guide>div{display:grid;gap:3px}.guide-label{font-size:9px;letter-spacing:.12em;font-weight:900;color:#a67613}.map-guide strong{color:#17344d}.guide-example{grid-template-columns:auto 1fr!important;align-items:center;column-gap:10px}.guide-example>b{font-size:18px;color:#0a2540;background:#fff3c5;border-radius:9px;padding:7px 9px}.guide-example span{font-size:11px;color:#647789}.aisle-example i{width:36px;border-top:2px dashed #aab8c4}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#617185;margin:16px 0}.legend span{display:flex;align-items:center;gap:7px}.legend i{width:14px;height:14px;border-radius:4px;background:#e8f4ef;border:1px solid #75c3a5}.legend i.selected{background:#f1c75c;border-color:#d19d1d}.legend i.occupied{background:#cbd5df;border-color:#a8b5c1}.legend i.other{background:#e9eef4;border-color:#7490a7}.legend i.wrong-cabin{background:#f3f4f5;border-color:#d7dde2}.legend i.exit-row{background:#edf8f3;border:2px solid #69a7cf}.change-banner{display:flex;gap:10px;align-items:center;background:#fff7df;border:1px solid #ecd58b;color:#705313;border-radius:14px;padding:11px 14px;margin:-4px 0 12px}.change-banner span{font-size:11px;line-height:1.5}.aircraft-shell{max-width:100%;overflow:hidden}.aircraft{display:flex;align-items:stretch;overflow-x:auto;background:white;border:2px solid #ced8e1;border-radius:110px 24px 24px 110px;padding:20px;min-height:290px;max-width:100%;scroll-behavior:smooth}.nose,.tail{display:grid;place-items:center;color:#8b99a8;font-size:10px;font-weight:900;letter-spacing:.12em;padding:10px;position:sticky;background:#fff;z-index:3}.nose{left:0}.tail{right:0}.rows{display:flex;gap:8px;align-items:flex-start}.seat-row{min-width:50px;text-align:center}.seat-row>b{display:grid;gap:1px;font-size:12px;color:#51677a}.seat-row>b span{font-size:7px;text-transform:uppercase;letter-spacing:.08em;color:#98a5b1;font-weight:800}.seat-groups{display:flex;flex-direction:column;align-items:center;margin-top:8px}.seat-group{display:flex;flex-direction:column;gap:6px}.aisle{height:22px;min-height:22px;width:100%;position:relative}.aisle::after{content:'';position:absolute;left:5px;right:5px;top:50%;border-top:1px dashed #c7d2dc}.seat-group button{position:relative;width:42px;height:50px;border-radius:9px;border:1px solid #9ccdb8;background:#edf8f3;color:#176b4e;display:grid;place-items:center;padding:3px}.seat-group button small{font-size:7px;color:#657487}.seat-code{font-weight:900;font-size:11px;letter-spacing:-.02em}.seat-check{position:absolute;right:-5px;top:-5px;width:17px;height:17px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(7,27,46,.25)}.seat-group button.selected{background:#f1c75c;border-color:#be8e17;color:#533b00;box-shadow:0 0 0 3px rgba(241,199,92,.25)}.seat-group button.occupied{background:#d8dee5;border-color:#bdc7d0;color:#8b98a4}.seat-group button.other{background:#e9eef4;border-color:#7490a7;color:#52687c}.seat-group button.wrong-cabin{background:#f3f4f5;border-color:#d7dde2;color:#a4adb5;opacity:.72}.seat-group button.exit{outline:2px solid #69a7cf}.seat-group button:focus-visible{outline:3px solid #071b2e;outline-offset:2px}.seat-actions,.summary{margin-top:14px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:18px}.selection{display:grid;gap:6px;min-width:0}.selection>strong{color:#0a2540}.selection>span,.summary p{font-size:12px;color:#68778a;margin:0}.selected-seat-detail{display:flex;align-items:center;gap:13px;margin-top:4px}.selected-code{min-width:58px;height:58px;border-radius:14px;background:#fff0b5;border:1px solid #e1ba4a;color:#533b00;display:grid;place-items:center;font-size:19px;font-weight:900}.selected-meta{display:grid;gap:3px}.selected-meta>b{color:#17344d}.selected-meta span{font-size:11px;color:#687b8c}.selected-meta span strong{color:#17344d}.change-copy{font-size:11px;color:#66798a;line-height:1.45;margin:2px 0 0}.seat-action-buttons{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.price-summary{align-items:flex-start}.summary-copy{display:grid;gap:6px;min-width:220px}.summary-copy>strong{color:#0a2540}.fare-breakdown{display:grid;gap:7px;min-width:min(100%,440px);width:440px}.fare-line{display:flex;justify-content:space-between;align-items:center;gap:20px;color:#607486;font-size:12px}.fare-line b{color:#16344c}.fare-line.grand{border-top:1px solid #e4eaf0;padding-top:9px;margin-top:2px;font-size:14px}.fare-line.grand span,.fare-line.grand strong{color:#071b2e;font-weight:900}.fare-line.grand strong{font-size:20px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}@media(max-width:900px){.cabin-selector{grid-template-columns:1fr}.map-guide{grid-template-columns:1fr 1fr}.map-guide>div:first-child{grid-column:1/-1}}@media(max-width:760px){.seat-toolbar{align-items:flex-start;flex-direction:column}.pass-tabs{max-width:100%;width:100%}.map-guide{grid-template-columns:1fr}.map-guide>div:first-child{grid-column:auto}.change-banner,.seat-actions,.summary{align-items:flex-start;flex-direction:column}.seat-action-buttons{justify-content:flex-start;width:100%}.fare-breakdown{min-width:0;width:100%}.actions{flex-direction:column}.actions .btn{width:100%}}
  `]
})
export class SeatsComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  api=inject(ApiService); state=inject(BookingStateService); router=inject(Router); lang=inject(LanguageService);
  legs:BookingLeg[]=[]; legIndex=0; passengerIndex=0; rows:any[]=[]; loading=true; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  requests:any[]=[]; seatMap:any=null; changingSeat=false; private cache=new Map<string,any>();

  constructor(){
    this.legs=this.state.selectedLegs();
    this.requests=[...this.state.seatRequests()];
    if(!this.legs.length||!this.state.passengers().length){this.router.navigate(['/']);return}
    this.loadLeg();
  }

  get currentLeg(){return this.legs[this.legIndex]}
  get currentPassengerName(){const p=this.state.passengers()[this.passengerIndex];return p?`${p.first_name} ${p.last_name}`:''}
  get currentRequest(){return this.requestFor(this.passengerIndex,this.currentLeg?.flight_id)}
  get currentSelectedSeat(){
    const req=this.currentRequest;if(req?.selection_type!=='CHOOSE'||!req?.seat_code)return null;
    for(const row of this.rows){const seat=(row?.seats||[]).find((s:any)=>s.seat_code===req.seat_code);if(seat)return seat}
    return null;
  }
  get currentSelectionText(){const r=this.requestFor(this.passengerIndex,this.currentLeg?.flight_id);return !r?this.t('Chưa chọn cách xếp ghế','No seat assignment selected'):r.selection_type==='AUTO'?this.t('Hệ thống sẽ tự động xếp ghế','The system will assign a seat automatically'):`${this.t('Ghế','Seat')} ${r.seat_code} · ${this.money(r.fee||0)}`}
  get totalSeatFee(){return this.requests.reduce((s,r)=>s+Number(r.fee||0),0)}
  get totalTicketFare(){return this.legs.reduce((sum,leg)=>sum+Number(leg?.['total_party_price']||0),0)}
  get grandTotal(){return this.totalTicketFare+this.totalSeatFee}
  get selectedSeatFeeRows(){
    return this.requests.filter(r=>r.selection_type==='CHOOSE'&&r.seat_code).map((r:any)=>{
      const leg=this.legs.find(l=>String(l.flight_id)===String(r.flight_id));
      const passenger=this.state.passengers()[Number(r.passenger_index)];
      const passengerName=passenger?`${passenger.first_name} ${passenger.last_name}`.trim():`${this.t('Hành khách','Passenger')} ${Number(r.passenger_index)+1}`;
      return{key:`${r.flight_id}:${r.passenger_index}:${r.seat_code}`,label:`${leg?.flight_number||''} · ${passengerName} · ${this.t('Ghế','Seat')} ${r.seat_code}`,fee:Number(r.fee||0)};
    });
  }
  get summaryText(){const covered=this.requests.length;const total=this.legs.length*this.state.passengers().length;return this.lang.language()==='vi'?`${covered}/${total} lựa chọn đã xác nhận. Mục chưa chọn sẽ tự động xếp ghế.`:`${covered}/${total} selections confirmed. Unselected seats will be assigned automatically.`}

  openLeg(i:number){this.legIndex=i;this.passengerIndex=0;this.changingSeat=false;this.loadLeg()}

  loadLeg(){
    const id=this.currentLeg?.flight_id;if(!id)return;
    const cached=this.cache.get(id);if(cached){this.seatMap=cached;this.rows=cached.rows||[];this.syncRequestFees(id);this.loading=false;this.error='';return}
    this.loading=true;this.error='';
    this.api.seatMap(id).subscribe({next:r=>{this.seatMap=r;this.rows=r.rows||[];this.cache.set(id,r);this.syncRequestFees(id);this.loading=false},error:e=>{this.error=this.message(e,'Không tải được sơ đồ ghế.');this.loading=false}})
  }

  requestFor(passenger:number,flightId?:string){return this.requests.find(r=>r.passenger_index===passenger&&r.flight_id===flightId)}
  coveredForLeg(leg:BookingLeg){return this.state.passengers().every((_:any,i:number)=>!!this.requestFor(i,leg.flight_id))}
  selectedForPassenger(code:string){return this.requestFor(this.passengerIndex,this.currentLeg?.flight_id)?.seat_code===code}
  selectedByOther(code:string){return this.requests.some(r=>r.flight_id===this.currentLeg?.flight_id&&r.passenger_index!==this.passengerIndex&&r.selection_type==='CHOOSE'&&r.seat_code===code)}
  get currentCabin(){return this.currentLeg?.['cabin_class']||''}
  get currentCabinOptions(){
    const source=this.currentLeg?.['cabin_options']||this.currentLeg?.['inventories']||[];
    return(source||[]).map((c:any)=>({
      ...c,
      inventory_id:String(c.inventory_id||c._id||c.id||''),
      cabin_class:String(c.cabin_class||''),
      available_seats:Number(c.available_seats||0),
      total_party_price:Number(c.total_party_price||0),
    })).filter((c:any)=>c.inventory_id&&c.cabin_class&&c.available_seats>=this.state.passengers().length).sort((a:any,b:any)=>this.cabinRank(a.cabin_class)-this.cabinRank(b.cabin_class));
  }
  seatEligible(s:any){return !this.currentCabin||!s?.cabin_class||s.cabin_class===this.currentCabin}
  seatSelectable(s:any){return !s?.cabin_class||this.currentCabinOptions.some((c:any)=>c.cabin_class===s.cabin_class)}
  seatGroups(row:any){return Array.isArray(row?.column_groups)&&row.column_groups.length?row.column_groups:[row?.seats||[]]}
  seatAria(s:any){const en=this.lang.language()==='en';const state=!this.seatEligible(s)?(en?`different cabin ${this.cabinLabel(s.cabin_class)}, click to switch`:`thuộc hạng ${this.cabinLabel(s.cabin_class)}, bấm để đổi hạng`):s.is_occupied?this.t('đã bán hoặc giữ','sold or held'):this.selectedByOther(s.seat_code)?this.t('đã được hành khách khác chọn','selected by another passenger'):this.selectedForPassenger(s.seat_code)?this.t('đang chọn','selected now'):this.t('còn trống','available');return `${this.t('Ghế','Seat')} ${s.seat_code}, ${this.seatPositionLabel(s)}, ${state}, ${this.t('phí','fee')} ${this.money(this.feeValue(s))}`}
  seatTooltip(s:any){return `${this.t('Ghế','Seat')} ${s.seat_code} · ${this.t('Hàng','Row')} ${this.seatRowNumber(s)} · ${this.seatPositionLabel(s)} · ${this.cabinLabel(s.cabin_class)} · ${this.seatFeatureLabel(s)} · ${this.money(this.feeValue(s))}`}
  seatRowNumber(s:any){return Number(s?.row ?? s?.row_number ?? (String(s?.seat_code||'').match(/^\d+/)?.[0] || 0))}
  seatLetter(s:any){return String(s?.column ?? s?.column_letter ?? (String(s?.seat_code||'').replace(/^\d+/,'') || '—'))}
  seatPositionLabel(s:any){const p=String(s?.position||'').toUpperCase();return p==='WINDOW'?this.t('Cửa sổ','Window'):p==='AISLE'?this.t('Lối đi','Aisle'):p==='MIDDLE'?this.t('Ghế giữa','Middle seat'):this.t('Vị trí tiêu chuẩn','Standard position')}
  seatFeatureLabel(s:any){const tags:string[]=[];if(s?.is_exit_row)tags.push(this.t('Hàng thoát hiểm','Exit row'));if(s?.is_extra_legroom)tags.push(this.t('Chỗ để chân rộng','Extra legroom'));return tags.length?tags.join(' · '):this.t('Ghế tiêu chuẩn','Standard seat')}
  cabinLabel(c:any){const v=String(c||'').toUpperCase();if(this.lang.language()==='en')return v==='ECONOMY'?'Economy':v==='BUSINESS'?'Business':v==='FIRST'?'First class':v==='CLUB'?'Premium / Club':c||'—';return v==='ECONOMY'?'Phổ thông':v==='BUSINESS'?'Thương gia':v==='FIRST'?'Hạng nhất':v==='CLUB'?'Premium / Club':c||'—'}

  switchCabin(option:any){
    if(!option||option.cabin_class===this.currentCabin)return;
    const current=this.currentLeg;if(!current)return;
    const patch={
      inventory_id:String(option.inventory_id||option._id||option.id||''),
      cabin_class:String(option.cabin_class||''),
      available_seats:Number(option.available_seats||0),
      total_party_price:Number(option.total_party_price||0),
      base_price_per_adult:Number(option.base_price_per_adult||option.base_price||0),
    };
    const updated={...current,...patch};
    this.legs=this.legs.map((leg,i)=>i===this.legIndex?updated:leg);
    this.replaceLegInSelection(updated);
    this.requests=this.requests.filter(r=>r.flight_id!==updated.flight_id);
    this.state.seatRequests.set(this.requests.map(({fee,...request})=>request));
    this.state.seatFeeTotal.set(this.totalSeatFee);
    this.passengerIndex=0;
    this.changingSeat=false;
  }

  choose(s:any){
    if(!this.seatSelectable(s))return;
    if(!this.seatEligible(s)){
      const option=this.currentCabinOptions.find((c:any)=>c.cabin_class===s.cabin_class);
      if(!option)return;
      const passenger=this.passengerIndex;
      this.switchCabin(option);
      this.passengerIndex=passenger;
    }
    const id=this.currentLeg.flight_id;
    this.requests=this.requests.filter(r=>!(r.passenger_index===this.passengerIndex&&r.flight_id===id));
    this.requests.push({passenger_index:this.passengerIndex,flight_id:id,selection_type:'CHOOSE',seat_code:s.seat_code,fee:this.feeValue(s)});
    this.changingSeat=false;
    this.advance();
  }

  autoCurrent(){
    const id=this.currentLeg.flight_id;
    this.requests=this.requests.filter(r=>!(r.passenger_index===this.passengerIndex&&r.flight_id===id));
    this.requests.push({passenger_index:this.passengerIndex,flight_id:id,selection_type:'AUTO',fee:0});
    this.changingSeat=false;
    this.advance();
  }

  beginChange(){
    this.changingSeat=true;
    setTimeout(()=>document.getElementById('seat-map-area')?.scrollIntoView({behavior:'smooth',block:'center'}));
  }

  private advance(){
    if(this.passengerIndex<this.state.passengers().length-1){this.passengerIndex++;this.changingSeat=false;return}
    if(this.legIndex<this.legs.length-1){this.legIndex++;this.passengerIndex=0;this.changingSeat=false;this.loadLeg()}
  }

  feeValue(s:any){return Number(s.fee??s.seat_fee??s.price??0)}
  fee(v:number){return v?`+${Math.round(v/1000)}k`:'0'}
  money(v:number){return new Intl.NumberFormat(this.lang.language()==='vi'?'vi-VN':'en-US',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  t(vi:string,en:string){return this.lang.language()==='vi'?vi:en}

  next(){
    this.state.seatFeeTotal.set(this.totalSeatFee);
    const clean=this.requests.map(({fee,...r})=>r);
    for(const leg of this.legs){
      for(let i=0;i<this.state.passengers().length;i++){
        if(!clean.some(r=>r.passenger_index===i&&r.flight_id===leg.flight_id))clean.push({passenger_index:i,flight_id:leg.flight_id,selection_type:'AUTO'});
      }
    }
    this.state.seatRequests.set(clean);
    this.router.navigate(['/booking/review']);
  }

  private syncRequestFees(flightId:string){
    const fees=new Map<string,number>();
    for(const row of this.rows){
      for(const seat of (row?.seats||[]))fees.set(String(seat.seat_code||''),this.feeValue(seat));
    }
    this.requests=this.requests.map(r=>{
      if(r.flight_id!==flightId)return r;
      if(r.selection_type!=='CHOOSE'||!r.seat_code)return{...r,fee:0};
      return{...r,fee:fees.get(String(r.seat_code))??Number(r.fee||0)};
    });
  }

  private replaceLegInSelection(updatedLeg:BookingLeg){
    const selection=this.state.selection();if(!selection)return;
    const replace=(items:any[]|undefined)=>(items||[]).map((leg:any)=>String(leg.flight_id)===String(updatedLeg.flight_id)?{...leg,...updatedLeg}:leg);
    const updateOption=(option:any)=>{
      if(!option)return option;
      const legs=replace(option.legs);
      const source=String(option?.source?.flight_id||option?.source?._id||'')===String(updatedLeg.flight_id)?{...option.source,...updatedLeg}:option.source;
      return{...option,legs,source};
    };
    this.state.selection.set({...selection,legs:replace(selection.legs),outbound:updateOption(selection.outbound),inbound:updateOption(selection.inbound)});
    this.state.quote.set(null);
  }

  private cabinRank(cabin:string){return({ECONOMY:1,CLUB:2,BUSINESS:3,FIRST:4} as Record<string,number>)[String(cabin||'').toUpperCase()]||99}

  private message(e:any,fallback:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||fallback}
}
