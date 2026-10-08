import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="eyebrow">VẬN HÀNH GHẾ</div>
    <div class="section-head">
      <div>
        <h1 class="title">Vận hành ghế theo chuyến bay</h1>
        <p class="subtitle">Khóa/mở ghế vật lý và ghi đè phụ phí cho một chuyến cụ thể.</p>
      </div>
      <button class="btn btn-outline" (click)="loadMap()" [disabled]="busy||!flightId">Làm mới</button>
    </div>

    <section class="card flight-picker">
      <div class="field grow"><span>Chuyến bay</span><select class="control" [(ngModel)]="flightId" (ngModelChange)="selectFlight($event)"><option value="">Chọn chuyến bay</option>@for(f of flights;track f._id){<option [value]="f._id">{{f.flight_number}} · {{f.origin_iata}} → {{f.dest_iata}} · {{dateTime(f.scheduled_departure)}}</option>}</select></div>
      <div class="field aircraft"><span>Máy bay</span><input class="control" [(ngModel)]="aircraftType" placeholder="A20N"></div>
      <button class="btn btn-primary" (click)="loadMap()" [disabled]="busy||!flightId||!aircraftType.trim()">Tải sơ đồ</button>
    </section>

    
    

    @if(map){
      <div class="stats">
        <div class="card"><span>Tổng ghế</span><strong>{{map.total_capacity||seatCount}}</strong></div>
        <div class="card"><span>Khả dụng</span><strong>{{map.total_available??countStatus('AVAILABLE')}}</strong></div>
        <div class="card"><span>Đã giữ / đặt</span><strong>{{map.total_occupied_or_held??(countStatus('HELD')+countStatus('OCCUPIED'))}}</strong></div>
        <div class="card"><span>Nhân viên khóa</span><strong>{{map.total_blocked??countStatus('BLOCKED')}}</strong></div>
      </div>

      <div class="ops-grid">
        <section class="card map-card">
          <div class="map-head"><div><b>{{selectedFlight?.flight_number||'Chuyến bay'}}</b><small>{{selectedFlight?.origin_iata}} → {{selectedFlight?.dest_iata}}</small></div><span class="pill pill-gold">{{map.model_name||map.aircraft_type||aircraftType}}</span></div>
          <div class="legend"><span><i class="available"></i>Trống</span><span><i class="held"></i>Đang giữ</span><span><i class="occupied"></i>Đã đặt</span><span><i class="blocked"></i>Đã khóa</span></div>
          <div class="aircraft-shell">
            <div class="nose">ĐẦU</div>
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
            <div class="tail">ĐUÔI</div>
          </div>
        </section>

        <aside class="card actions-card">
          @if(activeSeat){
            <div class="seat-title"><div><span>Ghế</span><strong>{{activeSeat.seat_code}}</strong></div><span class="pill">{{seatStatus(activeSeat.status)}}</span></div>
            <div class="seat-meta"><div><span>Hạng ghế</span><b>{{activeSeat.cabin_class||'—'}}</b></div><div><span>Vị trí</span><b>{{activeSeat.position||'—'}}</b></div><div><span>Phí hiện tại</span><b>{{money(activeSeat.seat_fee)}}</b></div><div><span>Lý do khóa</span><b>{{activeSeat.staff_block_reason||'—'}}</b></div></div>

            @if(activeSeat.status==='BLOCKED'){
              <button class="btn btn-outline wide" (click)="unblock()" [disabled]="busy">Mở khóa ghế</button>
            }@else{
              <div class="action-box">
                <h3>Khóa ghế</h3>
                <select class="control" [(ngModel)]="blockReason"><option value="BLOCKED_MAINTENANCE">Bảo trì</option><option value="CREW_REST">Nghỉ tổ bay</option><option value="VIP_HOLD">Giữ cho VIP</option></select>
                <input class="control" [(ngModel)]="blockNotes" placeholder="Ghi chú (không bắt buộc)">
                <button class="btn btn-dark wide" (click)="block()" [disabled]="busy||activeSeat.status!=='AVAILABLE'">Khóa ghế này</button>
                @if(activeSeat.status!=='AVAILABLE'){<small>Chỉ ghế còn trống mới có thể khóa.</small>}
              </div>
            }

            <div class="action-box">
              <h3>Ghi đè phụ phí</h3>
              <input class="control" type="number" min="0" step="1000" [(ngModel)]="overrideFee" placeholder="Phí VND">
              <input class="control" [(ngModel)]="overrideReason" placeholder="Lý do điều chỉnh">
              <button class="btn btn-primary wide" (click)="overridePrice()" [disabled]="busy||overrideFee<0||!overrideReason.trim()">Lưu giá riêng</button>
              <button class="btn btn-outline wide" (click)="removeOverride()" [disabled]="busy">Xóa giá riêng</button>
            </div>
          }@else{
            <div class="empty-panel"><strong>Chọn một ghế</strong><p>Thông tin vận hành và các thao tác sẽ xuất hiện tại đây.</p></div>
          }
        </aside>
      </div>
    }@else if(!busy){<div class="card empty">Chọn chuyến bay để tải sơ đồ ghế.</div>}
  `,
  styles: [`
    .flight-picker{padding:16px 18px;margin:18px 0;display:flex;align-items:end;gap:12px}.grow{flex:1}.aircraft{width:150px}.notice{padding:11px 14px;border-radius:12px;background:#fff}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.stats .card{padding:16px}.stats span{display:block;color:#768696;font-size:10px;font-weight:800;text-transform:uppercase}.stats strong{display:block;color:#071b2e;font-size:25px;margin-top:5px}.ops-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px}.map-card,.actions-card{padding:18px}.map-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.map-head b,.map-head small{display:block}.map-head b{color:#071b2e;font-size:19px}.map-head small{color:#768696;margin-top:3px}.legend{display:flex;gap:14px;flex-wrap:wrap;margin:16px 0;font-size:11px;color:#657487}.legend span{display:flex;align-items:center;gap:6px}.legend i{width:12px;height:12px;border-radius:3px;display:inline-block}.legend .available{background:#e8f4ef;border:1px solid #75c3a5}.legend .held{background:#fff0bd;border:1px solid #d8b245}.legend .occupied{background:#d8dee5;border:1px solid #afbbc6}.legend .blocked{background:#ffe2e2;border:1px solid #d88d8d}.aircraft-shell{display:flex;align-items:stretch;overflow-x:auto;border:2px solid #ced8e1;border-radius:90px 24px 24px 90px;background:#fff;min-height:300px;padding:18px}.nose,.tail{display:grid;place-items:center;padding:10px;color:#8795a3;font-size:9px;font-weight:900;letter-spacing:.12em;position:sticky;background:#fff;z-index:2}.nose{left:0}.tail{right:0}.rows{display:flex;gap:8px;align-items:flex-start}.seat-row{min-width:50px;text-align:center}.seat-row>b{font-size:10px;color:#7d8b98}.groups{display:flex;flex-direction:column;gap:18px;margin-top:8px}.group{display:flex;flex-direction:column;gap:5px}.group button{width:38px;height:45px;border-radius:9px;display:grid;place-items:center;padding:3px;font-weight:900}.group button small{font-size:7px}.group button.available{background:#edf8f3;border:1px solid #8bc8ae;color:#176b4e}.group button.held{background:#fff4ce;border:1px solid #d8b74d;color:#765910}.group button.occupied{background:#dce2e7;border:1px solid #bdc7d0;color:#7c8995}.group button.blocked{background:#ffe6e6;border:1px solid #d99b9b;color:#9b3030}.group button.active{outline:3px solid #071b2e;outline-offset:2px}.seat-title{display:flex;justify-content:space-between;align-items:center}.seat-title span{font-size:10px;color:#758493;text-transform:uppercase;font-weight:800}.seat-title strong{display:block;font-size:27px;color:#071b2e}.seat-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.seat-meta>div{background:#f6f8fa;border-radius:11px;padding:10px}.seat-meta span{display:block;font-size:9px;color:#778695;text-transform:uppercase;font-weight:800}.seat-meta b{display:block;color:#193247;margin-top:4px;overflow-wrap:anywhere}.action-box{border-top:1px solid #e7edf2;padding-top:15px;margin-top:15px;display:grid;gap:9px}.action-box h3{margin:0;color:#0a2540}.action-box small{color:#8a6b18}.wide{width:100%}.empty-panel{min-height:260px;display:grid;place-content:center;text-align:center;color:#708091}.empty-panel strong{color:#20384c}.empty-panel p{max-width:230px;font-size:12px;line-height:1.5}@media(max-width:1050px){.ops-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}@media(max-width:720px){.flight-picker{align-items:stretch;flex-direction:column}.aircraft{width:auto}.stats{grid-template-columns:1fr}.section-head{align-items:flex-start}.seat-meta{grid-template-columns:1fr}}
  `]
})
export class SeatOperationsComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api=inject(ApiService);
  flights:any[]=[];flightId='';aircraftType='A20N';selectedFlight:any=null;map:any=null;activeSeat:any=null;
  blockReason='BLOCKED_MAINTENANCE';blockNotes='';overrideFee=0;overrideReason='';busy=false;private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  constructor(){this.loadFlights()}
  get seatCount(){return (this.map?.rows||[]).reduce((sum:number,row:any)=>sum+(row.column_groups||[]).reduce((n:number,g:any[])=>n+g.length,0),0)}
  loadFlights(){this.api.flights().subscribe({next:r=>{this.flights=r||[];if(this.flights.length&&!this.flightId){this.flightId=this.flights[0]._id;this.selectFlight(this.flightId)}},error:e=>this.fail(e,'Không tải được danh sách chuyến bay.')})}
  selectFlight(id:string){this.flightId=id;this.selectedFlight=this.flights.find(f=>f._id===id)||null;this.aircraftType=this.selectedFlight?.aircraft?.model_code||'A20N';this.activeSeat=null;this.map=null;if(id)this.loadMap()}
  async loadMap(clearMessages=true){if(!this.flightId||!this.aircraftType.trim())return;if(clearMessages)this.start();else{this.busy=true;this.error=''}try{this.map=await firstValueFrom(this.api.seatOperationsMap(this.flightId,this.aircraftType.trim().toUpperCase()));if(this.activeSeat){const code=this.activeSeat.seat_code;this.activeSeat=this.findSeat(code)}}catch(e:any){this.fail(e,'Không tải được sơ đồ ghế.')}finally{this.busy=false}}
  chooseSeat(seat:any){this.activeSeat=seat;this.overrideFee=Number(seat.seat_fee||0);this.overrideReason='';this.blockNotes=''}
  async block(){if(!this.activeSeat||this.activeSeat.status!=='AVAILABLE')return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.blockSeat(this.flightId,{seat_code:code,reason:this.blockReason,aircraft_type:this.map?.aircraft_type||this.aircraftType,notes:this.blockNotes.trim()}));await this.loadMap(false);this.message=`Đã khóa ghế ${code}.`}catch(e:any){this.fail(e,'Không khóa được ghế.')}finally{this.busy=false}}
  async unblock(){if(!this.activeSeat)return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.unblockSeat(this.flightId,code));await this.loadMap(false);this.message=`Đã mở khóa ghế ${code}.`}catch(e:any){this.fail(e,'Không mở khóa được ghế.')}finally{this.busy=false}}
  async overridePrice(){if(!this.activeSeat||this.overrideFee<0||!this.overrideReason.trim())return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.setSeatPriceOverride(this.flightId,{seat_code:code,override_fee:Number(this.overrideFee),reason:this.overrideReason.trim()}));await this.loadMap(false);this.message=`Đã cập nhật phụ phí riêng cho ghế ${code}.`}catch(e:any){this.fail(e,'Không cập nhật được phụ phí ghế.')}finally{this.busy=false}}
  async removeOverride(){if(!this.activeSeat)return;const code=this.activeSeat.seat_code;this.start();try{await firstValueFrom(this.api.removeSeatPriceOverride(this.flightId,code));await this.loadMap(false);this.message=`Đã xóa phụ phí riêng của ghế ${code}.`}catch(e:any){this.fail(e,'Không xóa được phụ phí riêng.')}finally{this.busy=false}}
  countStatus(status:string){let count=0;for(const row of this.map?.rows||[])for(const group of row.column_groups||[])for(const seat of group)if(seat.status===status)count++;return count}
  findSeat(code:string){for(const row of this.map?.rows||[])for(const group of row.column_groups||[]){const hit=group.find((s:any)=>s.seat_code===code);if(hit)return hit}return null}
  seatClass(seat:any){return String(seat.status||'AVAILABLE').toLowerCase()}
  seatStatus(status:string){return({AVAILABLE:'Trống',HELD:'Đang giữ',OCCUPIED:'Đã đặt',BLOCKED:'Đã khóa'} as Record<string,string>)[status]||status}
  shortMoney(v:number){return v>=1000?`${Math.round(v/1000)}k`:String(v||0)}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  dateTime(v:any){if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(d)}
  start(){this.busy=true;this.error='';this.message=''}
  fail(e:any,fallback:string){const m=e?.error?.message;this.error=Array.isArray(m)?m.join(' · '):m||fallback;this.busy=false}
}
