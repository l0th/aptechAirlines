import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingLeg, BookingStateService } from '../core/booking-state.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  standalone:true,
  imports:[IconComponent],
  template:`
  <div class="container page">
    <div class="eyebrow">BƯỚC 3 / 4</div>
    <h1 class="title">Chọn chỗ ngồi</h1>
    <p class="subtitle">Chọn ghế cho từng hành khách trên từng chặng. Sơ đồ cuộn ngang bên trong thân máy bay, không làm tràn toàn trang.</p>

    <div class="leg-tabs">
      @for(leg of legs;track leg.flight_id;let i=$index){
        <button [class.on]="legIndex===i" [class.done]="coveredForLeg(leg)" (click)="openLeg(i)">
          <span>{{i+1}}</span>
          <b>{{leg.flight_number||'Flight'}}</b>
          <small>{{leg.origin_iata}} → {{leg.dest_iata}}</small>
        </button>
      }
    </div>

    @if(loading){<div class="card empty">Đang tải sơ đồ ghế…</div>}
    @else if(error){<div class="card empty"><p class="error">{{error}}</p><button class="btn btn-outline" (click)="loadLeg()">Tải lại</button></div>}
    @else{
      <section class="seat-toolbar card">
        <div>
          <div class="eyebrow">CHẶNG {{legIndex+1}} / {{legs.length}}</div>
          <strong>{{currentLeg.flight_number}} · {{currentLeg.origin_iata}} → {{currentLeg.dest_iata}}</strong>
        </div>
        <div class="pass-tabs">
          @for(p of state.passengers();track $index;let i=$index){
            <button [class.on]="passengerIndex===i" [class.done]="requestFor(i,currentLeg.flight_id)" (click)="passengerIndex=i">{{i+1}}. {{p.first_name}} {{p.last_name}}</button>
          }
        </div>
      </section>

      <div class="legend">
        <span><i class="available"></i>Còn trống</span>
        <span><i class="selected"></i>Đang chọn</span>
        <span><i class="occupied"></i>Đã bán / giữ</span>
        <span><i class="other"></i>Người cùng booking đã chọn</span>
        <span><i class="wrong-cabin"></i>Hạng ghế khác</span>
      </div>

      <div class="aircraft-shell">
        <div class="aircraft">
          <div class="nose">NOSE</div>
          <div class="rows">
            @for(row of rows;track row.row_number){
              <div class="seat-row">
                <b>{{row.row_number}}</b>
                <div class="seat-groups">
                  @for(group of seatGroups(row);track $index;let last=$last){
                    <div class="seat-group">
                      @for(s of group;track s.seat_code){
                        <button
                          [disabled]="s.is_occupied||selectedByOther(s.seat_code)||!seatEligible(s)"
                          [class.selected]="selectedForPassenger(s.seat_code)"
                          [class.occupied]="s.is_occupied"
                          [class.other]="selectedByOther(s.seat_code)"
                          [class.wrong-cabin]="!seatEligible(s)"
                          [class.exit]="s.is_exit_row"
                          [attr.aria-label]="seatAria(s)"
                          (click)="choose(s)">
                          @if(selectedForPassenger(s.seat_code)){
                            <span class="seat-check"><app-icon name="check" [size]="12"/></span>
                          }
                          <span class="seat-column">{{s.column||s.seat_code}}</span>
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
          <div class="tail">TAIL</div>
        </div>
      </div>

      <div class="seat-actions card">
        <div class="selection">
          <strong>{{currentPassengerName}}</strong>
          <span>{{currentSelectionText}}</span>
        </div>
        <button class="btn btn-outline" (click)="autoCurrent()">Tự động xếp ghế</button>
      </div>

      <div class="summary card">
        <div><strong>Tổng phụ phí ghế đã chọn</strong><p class="muted">{{summaryText}}</p></div>
        <strong>{{money(totalSeatFee)}}</strong>
      </div>

      <div class="actions">
        <button class="btn btn-outline" (click)="router.navigate(['/booking/passengers'])">Quay lại</button>
        <button class="btn btn-primary" (click)="next()">Kiểm tra & thanh toán</button>
      </div>
    }
  </div>
  `,
  styles:[`
    .leg-tabs{display:flex;gap:9px;overflow-x:auto;padding:4px 2px 12px;margin:18px 0}.leg-tabs button{min-width:180px;border:1px solid #d9e2e9;background:#fff;border-radius:16px;padding:11px 13px;text-align:left;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;color:#667588}.leg-tabs button>span{grid-row:1/3;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#edf2f6;font-weight:900}.leg-tabs b{color:#071b2e}.leg-tabs small{font-size:11px}.leg-tabs button.on{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.leg-tabs button.done>span{background:#e9f7f1;color:#16845b}.seat-toolbar{padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:18px}.seat-toolbar strong{display:block;color:#071b2e;margin-top:4px}.pass-tabs{display:flex;gap:8px;overflow:auto;max-width:64%}.pass-tabs button{white-space:nowrap;border:1px solid #d9e2e9;background:white;border-radius:999px;padding:9px 13px;font-weight:800;color:#667588}.pass-tabs button.on{background:#071b2e;color:white}.pass-tabs button.done:not(.on){border-color:#a9d9c5;color:#16845b;background:#f1fbf6}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#617185;margin:16px 0}.legend span{display:flex;align-items:center;gap:7px}.legend i{width:14px;height:14px;border-radius:4px;background:#e8f4ef;border:1px solid #75c3a5}.legend i.selected{background:#f1c75c;border-color:#d19d1d}.legend i.occupied{background:#cbd5df;border-color:#a8b5c1}.legend i.other{background:#e9eef4;border-color:#7490a7}.legend i.wrong-cabin{background:#f3f4f5;border-color:#d7dde2}.aircraft-shell{max-width:100%;overflow:hidden}.aircraft{display:flex;align-items:stretch;overflow-x:auto;background:white;border:2px solid #ced8e1;border-radius:110px 24px 24px 110px;padding:20px;min-height:290px;max-width:100%}.nose,.tail{display:grid;place-items:center;color:#8b99a8;font-size:10px;font-weight:900;letter-spacing:.12em;padding:10px;position:sticky;background:#fff;z-index:3}.nose{left:0}.tail{right:0}.rows{display:flex;gap:8px;align-items:flex-start}.seat-row{min-width:48px;text-align:center}.seat-row>b{font-size:11px;color:#768698}.seat-groups{display:flex;flex-direction:column;align-items:center;margin-top:10px}.seat-group{display:flex;flex-direction:column;gap:6px}.aisle{height:18px;min-height:18px;width:100%;position:relative}.aisle::after{content:'';position:absolute;left:7px;right:7px;top:50%;border-top:1px dashed #d7e0e8}.seat-group button{position:relative;width:36px;height:48px;border-radius:9px;border:1px solid #9ccdb8;background:#edf8f3;color:#176b4e;display:grid;place-items:center;padding:3px}.seat-group button small{font-size:7px;color:#657487}.seat-column{font-weight:900}.seat-check{position:absolute;right:-5px;top:-5px;width:17px;height:17px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(7,27,46,.25)}.seat-group button.selected{background:#f1c75c;border-color:#be8e17;color:#533b00;box-shadow:0 0 0 3px rgba(241,199,92,.25)}.seat-group button.occupied{background:#d8dee5;border-color:#bdc7d0;color:#8b98a4}.seat-group button.other{background:#e9eef4;border-color:#7490a7;color:#52687c}.seat-group button.wrong-cabin{background:#f3f4f5;border-color:#d7dde2;color:#a4adb5;opacity:.72}.seat-group button.exit{outline:2px solid #69a7cf}.seat-group button:focus-visible{outline:3px solid #071b2e;outline-offset:2px}.seat-actions,.summary{margin-top:14px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:15px}.selection{display:grid;gap:4px}.selection span,.summary p{font-size:12px;color:#68778a;margin:0}.summary>strong{font-size:20px;color:#071b2e}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}@media(max-width:760px){.seat-toolbar{align-items:flex-start;flex-direction:column}.pass-tabs{max-width:100%;width:100%}.seat-actions,.summary{align-items:flex-start;flex-direction:column}.actions{flex-direction:column}.actions .btn{width:100%}}
  `]
})
export class SeatsComponent{
  api=inject(ApiService); state=inject(BookingStateService); router=inject(Router);
  legs:BookingLeg[]=[]; legIndex=0; passengerIndex=0; rows:any[]=[]; loading=true; error='';
  requests:any[]=[]; private cache=new Map<string,any[]>();

  constructor(){
    this.legs=this.state.selectedLegs();
    this.requests=[...this.state.seatRequests()];
    if(!this.legs.length||!this.state.passengers().length){this.router.navigate(['/']);return}
    this.loadLeg();
  }

  get currentLeg(){return this.legs[this.legIndex]}
  get currentPassengerName(){const p=this.state.passengers()[this.passengerIndex];return p?`${p.first_name} ${p.last_name}`:''}
  get currentSelectionText(){const r=this.requestFor(this.passengerIndex,this.currentLeg?.flight_id);return !r?'Chưa chọn cách xếp ghế':r.selection_type==='AUTO'?'Hệ thống sẽ tự động xếp ghế':`Ghế ${r.seat_code} · ${this.money(r.fee||0)}`}
  get totalSeatFee(){return this.requests.reduce((s,r)=>s+Number(r.fee||0),0)}
  get summaryText(){const covered=this.requests.length;const total=this.legs.length*this.state.passengers().length;return `${covered}/${total} lựa chọn đã xác nhận. Mục chưa chọn sẽ tự động xếp ghế.`}

  openLeg(i:number){this.legIndex=i;this.passengerIndex=0;this.loadLeg()}

  loadLeg(){
    const id=this.currentLeg?.flight_id;if(!id)return;
    const cached=this.cache.get(id);if(cached){this.rows=cached;this.syncRequestFees(id);this.loading=false;this.error='';return}
    this.loading=true;this.error='';
    this.api.seatMap(id).subscribe({next:r=>{this.rows=r.rows||[];this.cache.set(id,this.rows);this.syncRequestFees(id);this.loading=false},error:e=>{this.error=this.message(e,'Không tải được sơ đồ ghế.');this.loading=false}})
  }

  requestFor(passenger:number,flightId?:string){return this.requests.find(r=>r.passenger_index===passenger&&r.flight_id===flightId)}
  coveredForLeg(leg:BookingLeg){return this.state.passengers().every((_:any,i:number)=>!!this.requestFor(i,leg.flight_id))}
  selectedForPassenger(code:string){return this.requestFor(this.passengerIndex,this.currentLeg?.flight_id)?.seat_code===code}
  selectedByOther(code:string){return this.requests.some(r=>r.flight_id===this.currentLeg?.flight_id&&r.passenger_index!==this.passengerIndex&&r.selection_type==='CHOOSE'&&r.seat_code===code)}
  get currentCabin(){return this.currentLeg?.['cabin_class']||this.state.search()?.cabin_class||''}
  seatEligible(s:any){return !this.currentCabin||!s?.cabin_class||s.cabin_class===this.currentCabin}
  seatGroups(row:any){return Array.isArray(row?.column_groups)&&row.column_groups.length?row.column_groups:[row?.seats||[]]}
  seatAria(s:any){const state=!this.seatEligible(s)?`thuộc hạng ${s.cabin_class}`:s.is_occupied?'đã bán hoặc giữ':this.selectedByOther(s.seat_code)?'đã được hành khách khác chọn':this.selectedForPassenger(s.seat_code)?'đang chọn':'còn trống';return `Ghế ${s.seat_code}, ${state}, phí ${this.money(this.feeValue(s))}`}

  choose(s:any){
    if(!this.seatEligible(s))return;
    const id=this.currentLeg.flight_id;
    this.requests=this.requests.filter(r=>!(r.passenger_index===this.passengerIndex&&r.flight_id===id));
    this.requests.push({passenger_index:this.passengerIndex,flight_id:id,selection_type:'CHOOSE',seat_code:s.seat_code,fee:this.feeValue(s)});
    this.advance();
  }

  autoCurrent(){
    const id=this.currentLeg.flight_id;
    this.requests=this.requests.filter(r=>!(r.passenger_index===this.passengerIndex&&r.flight_id===id));
    this.requests.push({passenger_index:this.passengerIndex,flight_id:id,selection_type:'AUTO',fee:0});
    this.advance();
  }

  private advance(){
    if(this.passengerIndex<this.state.passengers().length-1){this.passengerIndex++;return}
    if(this.legIndex<this.legs.length-1){this.legIndex++;this.passengerIndex=0;this.loadLeg()}
  }

  feeValue(s:any){return Number(s.fee??s.seat_fee??s.price??0)}
  fee(v:number){return v?`+${Math.round(v/1000)}k`:'0'}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}

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

  private message(e:any,fallback:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||fallback}
}
