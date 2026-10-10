import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="eyebrow">{{t('VẬN HÀNH GHẾ','SEAT OPERATIONS')}}</div>
    <div class="section-head">
      <div>
        <h1 class="title">{{t('Vận hành ghế theo chuyến bay','Seat operations by flight')}}</h1>
        <p class="subtitle">{{t('Khóa/mở ghế vật lý và ghi đè phụ phí cho một chuyến cụ thể.','Block or unblock physical seats and override seat fees for a specific flight.')}}</p>
      </div>
      <button class="btn btn-outline" (click)="loadMap()" [disabled]="busy||!flightId">{{t('Làm mới','Refresh')}}</button>
    </div>

    <section class="card flight-picker">
      <div class="field grow"><span>{{t('Chuyến bay','Flight')}}</span><select class="control" [(ngModel)]="flightId" (ngModelChange)="selectFlight($event)"><option value="">{{t('Chọn chuyến bay','Select flight')}}</option>@for(f of flights;track f._id){<option [value]="f._id">{{f.flight_number}} · {{f.origin_iata}} → {{f.dest_iata}} · {{dateTime(f.scheduled_departure)}}</option>}</select></div>
      <div class="field aircraft"><span>{{t('Máy bay','Aircraft')}}</span><input class="control" [(ngModel)]="aircraftType" placeholder="A20N"></div>
      <button class="btn btn-primary" (click)="loadMap()" [disabled]="busy||!flightId||!aircraftType.trim()">{{t('Tải sơ đồ','Load seat map')}}</button>
    </section>

    
    

    @if(map){
      <div class="stats">
        <div class="card"><span>{{t('Tổng ghế','Total seats')}}</span><strong>{{map.total_capacity||seatCount}}</strong></div>
        <div class="card"><span>{{t('Khả dụng','Available')}}</span><strong>{{map.total_available??countStatus('AVAILABLE')}}</strong></div>
        <div class="card"><span>{{t('Đã giữ / đặt','Held / occupied')}}</span><strong>{{map.total_occupied_or_held??(countStatus('HELD')+countStatus('OCCUPIED'))}}</strong></div>
        <div class="card"><span>{{t('Nhân viên khóa','Staff blocked')}}</span><strong>{{map.total_blocked??countStatus('BLOCKED')}}</strong></div>
      </div>

      <div class="ops-grid">
        <section class="card map-card">
          <div class="map-head"><div><b>{{selectedFlight?.flight_number||t('Chuyến bay','Flight')}}</b><small>{{selectedFlight?.origin_iata}} → {{selectedFlight?.dest_iata}}</small></div><span class="pill pill-gold">{{map.model_name||map.aircraft_type||aircraftType}}</span></div>
          <div class="legend"><span><i class="available"></i>{{seatStatus('AVAILABLE')}}</span><span><i class="held"></i>{{seatStatus('HELD')}}</span><span><i class="occupied"></i>{{seatStatus('OCCUPIED')}}</span><span><i class="blocked"></i>{{seatStatus('BLOCKED')}}</span></div>
          <div class="aircraft-shell">
            <div class="nose">{{t('ĐẦU','NOSE')}}</div>
            <div class="rows">
              @for(row of map.rows||[];track row.row_number){
                <div class="seat-row">
                  <b>{{row.row_number}}</b>
                  <div class="groups">
                    @for(group of row.column_groups||[];track $index){
                      <div class="group">
                        @for(seat of group;track seat.seat_code){
                          <button type="button" [class]="seatClass(seat)" [class.active]="activeSeat?.seat_code===seat.seat_code" (click)="chooseSeat(seat)" [title]="seat.seat_code+' · '+seatStatus(seat.status)+' · '+money(seat.seat_fee)">
                            <span>{{seat.column_letter||seat.seat_code}}</span><small>{{seat.seat_fee?shortMoney(seat.seat_fee):'0'}}</small>
                          </button>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
            <div class="tail">{{t('ĐUÔI','TAIL')}}</div>
          </div>
        </section>

        <aside class="card actions-card">
          @if(activeSeat){
            <div class="seat-title"><div><span>{{t('Ghế','Seat')}}</span><strong>{{activeSeat.seat_code}}</strong></div><span class="pill">{{seatStatus(activeSeat.status)}}</span></div>
            <div class="seat-meta"><div><span>{{t('Hạng ghế','Cabin')}}</span><b>{{language.cabinLabel(activeSeat.cabin_class||'—')}}</b></div><div><span>{{t('Vị trí','Position')}}</span><b>{{activeSeat.position||'—'}}</b></div><div><span>{{t('Phí hiện tại','Current fee')}}</span><b>{{money(activeSeat.seat_fee)}}</b></div><div><span>{{t('Lý do khóa','Block reason')}}</span><b>{{activeSeat.staff_block_reason||'—'}}</b></div></div>

            @if(activeSeat.status==='BLOCKED'){
              <button class="btn btn-outline wide" (click)="unblock()" [disabled]="busy">{{t('Mở khóa ghế','Unblock seat')}}</button>
            }@else{
              <div class="action-box">
                <h3>{{t('Khóa ghế','Block seat')}}</h3>
                <select class="control" [(ngModel)]="blockReason"><option value="BLOCKED_MAINTENANCE">{{t('Bảo trì','Maintenance')}}</option><option value="CREW_REST">{{t('Nghỉ tổ bay','Crew rest')}}</option><option value="VIP_HOLD">{{t('Giữ cho VIP','VIP hold')}}</option></select>
                <input class="control" [(ngModel)]="blockNotes" [placeholder]="t('Ghi chú (không bắt buộc)','Notes (optional)')">
                <button class="btn btn-dark wide" (click)="block()" [disabled]="busy||activeSeat.status!=='AVAILABLE'">{{t('Khóa ghế này','Block this seat')}}</button>
                @if(activeSeat.status!=='AVAILABLE'){<small>{{t('Chỉ ghế còn trống mới có thể khóa.','Only available seats can be blocked.')}}</small>}
              </div>
            }

            <div class="action-box">
              <h3>{{t('Ghi đè phụ phí','Override seat fee')}}</h3>
              <input class="control" type="number" min="0" step="1000" [(ngModel)]="overrideFee" [placeholder]="t('Phí VND','Fee in VND')">
              <input class="control" [(ngModel)]="overrideReason" [placeholder]="t('Lý do điều chỉnh','Reason for adjustment')">
              <button class="btn btn-primary wide" (click)="overridePrice()" [disabled]="busy||overrideFee<0||!overrideReason.trim()">{{t('Lưu giá riêng','Save custom fee')}}</button>
              <button class="btn btn-outline wide" (click)="removeOverride()" [disabled]="busy">{{t('Xóa giá riêng','Remove custom fee')}}</button>
            </div>
          }@else{
            <div class="empty-panel"><strong>{{t('Chọn một ghế','Select a seat')}}</strong><p>{{t('Thông tin vận hành và các thao tác sẽ xuất hiện tại đây.','Seat operations and details will appear here.')}}</p></div>
          }
        </aside>
      </div>
    }@else if(!busy){<div class="card empty">{{t('Chọn chuyến bay để tải sơ đồ ghế.','Select a flight to load its seat map.')}}</div>}
  `,
  styles: [`
    .flight-picker{padding:16px 18px;margin:18px 0;display:flex;align-items:end;gap:12px}.grow{flex:1}.aircraft{width:150px}.notice{padding:11px 14px;border-radius:12px;background:#fff}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.stats .card{padding:16px}.stats span{display:block;color:#768696;font-size:10px;font-weight:800;text-transform:uppercase}.stats strong{display:block;color:#071b2e;font-size:25px;margin-top:5px}.ops-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px}.map-card,.actions-card{padding:18px}.map-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.map-head b,.map-head small{display:block}.map-head b{color:#071b2e;font-size:19px}.map-head small{color:#768696;margin-top:3px}.legend{display:flex;gap:14px;flex-wrap:wrap;margin:16px 0;font-size:11px;color:#657487}.legend span{display:flex;align-items:center;gap:6px}.legend i{width:12px;height:12px;border-radius:3px;display:inline-block}.legend .available{background:#e8f4ef;border:1px solid #75c3a5}.legend .held{background:#fff0bd;border:1px solid #d8b245}.legend .occupied{background:#d8dee5;border:1px solid #afbbc6}.legend .blocked{background:#ffe2e2;border:1px solid #d88d8d}.aircraft-shell{display:flex;align-items:stretch;overflow-x:auto;border:2px solid #ced8e1;border-radius:90px 24px 24px 90px;background:#fff;min-height:300px;padding:18px}.nose,.tail{display:grid;place-items:center;padding:10px;color:#8795a3;font-size:9px;font-weight:900;letter-spacing:.12em;position:sticky;background:#fff;z-index:2}.nose{left:0}.tail{right:0}.rows{display:flex;gap:8px;align-items:flex-start}.seat-row{min-width:50px;text-align:center}.seat-row>b{font-size:10px;color:#7d8b98}.groups{display:flex;flex-direction:column;gap:18px;margin-top:8px}.group{display:flex;flex-direction:column;gap:5px}.group button{width:38px;height:45px;border-radius:9px;display:grid;place-items:center;padding:3px;font-weight:900}.group button small{font-size:7px}.group button.available{background:#edf8f3;border:1px solid #8bc8ae;color:#176b4e}.group button.held{background:#fff4ce;border:1px solid #d8b74d;color:#765910}.group button.occupied{background:#dce2e7;border:1px solid #bdc7d0;color:#7c8995}.group button.blocked{background:#ffe6e6;border:1px solid #d99b9b;color:#9b3030}.group button.active{outline:3px solid #071b2e;outline-offset:2px}.seat-title{display:flex;justify-content:space-between;align-items:center}.seat-title span{font-size:10px;color:#758493;text-transform:uppercase;font-weight:800}.seat-title strong{display:block;font-size:27px;color:#071b2e}.seat-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.seat-meta>div{background:#f6f8fa;border-radius:11px;padding:10px}.seat-meta span{display:block;font-size:9px;color:#778695;text-transform:uppercase;font-weight:800}.seat-meta b{display:block;color:#193247;margin-top:4px;overflow-wrap:anywhere}.action-box{border-top:1px solid #e7edf2;padding-top:15px;margin-top:15px;display:grid;gap:9px}.action-box h3{margin:0;color:#0a2540}.action-box small{color:#8a6b18}.wide{width:100%}.empty-panel{min-height:260px;display:grid;place-content:center;text-align:center;color:#708091}.empty-panel strong{color:#20384c}.empty-panel p{max-width:230px;font-size:12px;line-height:1.5}@media(max-width:1050px){.ops-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}@media(max-width:720px){.flight-picker{align-items:stretch;flex-direction:column}.aircraft{width:auto}.stats{grid-template-columns:1fr}.section-head{align-items:flex-start}.seat-meta{grid-template-columns:1fr}}
  `]
})
export class SeatOperationsComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api=inject(ApiService);
  language=inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  flights:any[]=[];flightId='';aircraftType='A20N';selectedFlight:any=null;map:any=null;activeSeat:any=null;
  blockReason='BLOCKED_MAINTENANCE';blockNotes='';overrideFee=0;overrideReason='';busy=false;private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  constructor(){this.loadFlights()}
  get seatCount(){return (this.map?.rows||[]).reduce((sum:number,row:any)=>sum+(row.column_groups||[]).reduce((n:number,g:any[])=>n+g.length,0),0)}
  loadFlights(){this.api.flights().subscribe({next:r=>{this.flights=r||[];if(this.flights.length&&!this.flightId){this.flightId=this.flights[0]._id;this.selectFlight(this.flightId)}},error:e=>this.fail(e,this.t('Không tải được danh sách chuyến bay.','Unable to load flights.'))})}
  selectFlight(id:string){this.flightId=id;this.selectedFlight=this.flights.find(f=>f._id===id)||null;this.aircraftType=this.selectedFlight?.aircraft?.model_code||'A20N';this.activeSeat=null;this.map=null;if(id)this.loadMap()}
  async loadMap(clearMessages=true){if(!this.flightId||!this.aircraftType.trim())return;if(clearMessages)this.start();else{this.busy=true;this.error=''}try{this.map=await firstValueFrom(this.api.seatOperationsMap(this.flightId,this.aircraftType.trim().toUpperCase()));if(this.activeSeat){const code=this.activeSeat.seat_code;this.activeSeat=this.findSeat(code)}}catch(e:any){this.fail(e,this.t('Không tải được sơ đồ ghế.','Unable to load seat map.'))}finally{this.busy=false}}
  chooseSeat(seat:any){this.activeSeat=seat;this.overrideFee=Number(seat.seat_fee||0);this.overrideReason='';this.blockNotes=''}
  async block(){if(!this.activeSeat||this.activeSeat.status!=='AVAILABLE')return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.blockSeat(this.flightId,{seat_code:code,reason:this.blockReason,aircraft_type:this.map?.aircraft_type||this.aircraftType,notes:this.blockNotes.trim()}));await this.loadMap(false);this.message=this.t(`Đã khóa ghế ${code}.`,`Seat ${code} blocked.`)}catch(e:any){this.fail(e,this.t('Không khóa được ghế.','Unable to block seat.'))}finally{this.busy=false}}
  async unblock(){if(!this.activeSeat)return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.unblockSeat(this.flightId,code));await this.loadMap(false);this.message=this.t(`Đã mở khóa ghế ${code}.`,`Seat ${code} unblocked.`)}catch(e:any){this.fail(e,this.t('Không mở khóa được ghế.','Unable to unblock seat.'))}finally{this.busy=false}}
  async overridePrice(){if(!this.activeSeat||this.overrideFee<0||!this.overrideReason.trim())return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.setSeatPriceOverride(this.flightId,{seat_code:code,override_fee:Number(this.overrideFee),reason:this.overrideReason.trim()}));await this.loadMap(false);this.message=this.t(`Đã cập nhật phụ phí riêng cho ghế ${code}.`,`Custom fee updated for seat ${code}.`)}catch(e:any){this.fail(e,this.t('Không cập nhật được phụ phí ghế.','Unable to update seat fee.'))}finally{this.busy=false}}
  async removeOverride(){if(!this.activeSeat)return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.removeSeatPriceOverride(this.flightId,code));await this.loadMap(false);this.message=this.t(`Đã xóa phụ phí riêng của ghế ${code}.`,`Custom fee removed from seat ${code}.`)}catch(e:any){this.fail(e,this.t('Không xóa được phụ phí riêng.','Unable to remove custom fee.'))}finally{this.busy=false}}
  countStatus(status:string){let count=0;for(const row of this.map?.rows||[])for(const group of row.column_groups||[])for(const seat of group)if(seat.status===status)count++;return count}
  findSeat(code:string){for(const row of this.map?.rows||[])for(const group of row.column_groups||[]){const hit=group.find((s:any)=>s.seat_code===code);if(hit)return hit}return null}
  seatClass(seat:any){return String(seat.status||'AVAILABLE').toLowerCase()}
  seatStatus(status:string){return this.language.seatStatusLabel(status)}
  shortMoney(v:number){return v>=1000?`${Math.round(v/1000)}k`:String(v||0)}
  money(v:number){return new Intl.NumberFormat(this.language.language()==='vi'?'vi-VN':'en-US',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  dateTime(v:any){if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?String(v):new Intl.DateTimeFormat(this.language.language()==='vi'?'vi-VN':'en-US',{dateStyle:'short',timeStyle:'short'}).format(d)}
  start(){this.busy=true;this.error='';this.message=''}
  fail(e:any,fallback:string){const m=e?.error?.message;this.error=Array.isArray(m)?m.join(' · '):m||fallback;this.busy=false}
}
