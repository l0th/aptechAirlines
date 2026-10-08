import { Component, inject, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  selector:'app-admin-list',
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
    <div class="eyebrow">ADMIN</div>
    <div class="section-head">
      <div><h1 class="title">{{title}}</h1><p class="subtitle">{{subtitle}}</p></div>
      <div class="head-actions">
        @if(kind==='bookings'&&auth.admin()){
          <button class="btn btn-outline" (click)="runScheduler('run-expiry')" [disabled]="busy">Quét vé hết hạn</button>
        }
        @if(kind!=='bookings'){<button class="btn btn-primary" (click)="openCreate()" [disabled]="busy">+ Thêm mới</button>}
        <button class="btn btn-outline" (click)="load()" [disabled]="busy">Làm mới</button>
      </div>
    </div>

    <div class="card toolbar">
      <input class="control" [(ngModel)]="query" (ngModelChange)="page=1" [placeholder]="searchPlaceholder">
      <span class="pill pill-gold">{{filtered.length}} bản ghi</span>
    </div>
    
    

    @if(editor){
      <div class="modal" (click)="editor=null">
      <section class="card editor-panel" (click)="$event.stopPropagation()">
        <button class="close" (click)="editor=null">×</button>
        <div class="editor-head"><div><div class="eyebrow">{{editorMode==='create'?'CREATE':'EDIT'}} {{kind.toUpperCase()}}</div><h2>{{editorMode==='create'?'Thêm mới':'Cập nhật'}}</h2></div></div>
        @if(kind==='users'){
          <div class="form-grid">
            @if(editorMode==='create'){<div class="field"><span>Username</span><input class="control" [(ngModel)]="editor.username"></div><div class="field"><span>Password</span><input class="control" type="password" [(ngModel)]="editor.password"></div>}
            <div class="field"><span>Họ</span><input class="control" [(ngModel)]="editor.last_name"></div><div class="field"><span>Tên</span><input class="control" [(ngModel)]="editor.first_name"></div>
            <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="editor.email"></div><div class="field"><span>Điện thoại</span><input class="control" [(ngModel)]="editor.phone_number"></div>
            <div class="field full"><span>Địa chỉ</span><input class="control" [(ngModel)]="editor.address"></div><div class="field"><span>Role</span><select class="control" [(ngModel)]="editor.role" [disabled]="editor.originalRole==='SUPER_ADMIN'"><option value="CUSTOMER">CUSTOMER</option><option value="CLERK">CLERK</option><option value="ADMIN">ADMIN</option>@if(editor.originalRole==='SUPER_ADMIN'){<option value="SUPER_ADMIN">SUPER_ADMIN</option>}</select></div>
            @if(editorMode==='edit'){<div class="field"><span>SkyMiles · đặt số dư</span><input class="control" type="number" min="0" step="1" [(ngModel)]="editor.sky_miles"></div>}
          </div>
        }@else if(kind==='airports'){
          <div class="form-grid"><div class="field"><span>IATA</span><input class="control" [(ngModel)]="editor.iata_code" [disabled]="editorMode==='edit'"></div><div class="field"><span>ICAO</span><input class="control" [(ngModel)]="editor.icao_code"></div><div class="field"><span>Airport</span><input class="control" [(ngModel)]="editor.airport_name"></div><div class="field"><span>City</span><input class="control" [(ngModel)]="editor.city_name"></div><div class="field"><span>Country code</span><input class="control" [(ngModel)]="editor.country_code"></div><div class="field"><span>Timezone</span><input class="control" [(ngModel)]="editor.time_zone"></div><div class="field"><span>Latitude</span><input class="control" type="number" [(ngModel)]="editor.lat"></div><div class="field"><span>Longitude</span><input class="control" type="number" [(ngModel)]="editor.lng"></div><label class="check full"><input type="checkbox" [(ngModel)]="editor.is_serviced_directly"> Phục vụ trực tiếp</label></div>
        }@else if(kind==='flights'){
          @if(editor.commercial){<p class="info">Chuyến thương mại theo ngày. Có thể đổi máy bay riêng cho ngày này khi chưa có ghế HELD/CONFIRMED; commercial template 330 ngày không bị thay đổi.</p>}
          <div class="form-grid">
            <div class="field"><span>Flight number</span><input class="control" [(ngModel)]="editor.flight_number" [disabled]="editor.commercial"></div>
            @if(editorMode==='create'){<div class="field"><span>Origin IATA</span><input class="control" [(ngModel)]="editor.origin_iata"></div><div class="field"><span>Destination IATA</span><input class="control" [(ngModel)]="editor.dest_iata"></div>}
            <div class="field"><span>Departure date</span><input class="control" type="date" [(ngModel)]="editor.departure_date"></div>
            <div class="field"><span>Máy bay</span><select class="control" [(ngModel)]="editor.aircraft_code" (ngModelChange)="flightAircraftChanged()"><option value="">Chọn máy bay</option>@for(a of layouts;track a.aircraft_type){<option [value]="a.aircraft_type">{{a.aircraft_type}} · {{a.model_name}} · {{a.total_capacity}} ghế</option>}</select></div>
            <div class="field"><span>Giờ cất cánh (giờ địa phương {{originIata||'nơi đi'}} · {{tzOf(originIata)}})</span><input class="control" type="datetime-local" [(ngModel)]="editor.dep_local" (ngModelChange)="syncDepartureDate()"></div>
            <div class="field"><span>Thời gian bay (phút)</span><input class="control" type="number" min="1" [(ngModel)]="editor.duration_input"></div>
            <div class="field full info">
              @if(previewTimes; as p){
                Cất cánh <b>{{p.depLocal}}</b> ({{tzOf(originIata)}}) → Hạ cánh <b>{{p.arrLocal}}</b> ({{tzOf(destIata)}}) · UTC {{p.depUtc}} → {{p.arrUtc}}
              } @else { Nhập nơi đi/đến, giờ cất cánh và thời gian bay để xem giờ hạ cánh theo giờ địa phương. }
            </div>
            @if(connectionHints.length){
              <div class="field full info">
                <b>Có thể nối chuyến (chờ 45–720 phút):</b>
                @for(h of connectionHints;track h.id){<div>{{h.text}}</div>}
              </div>
            }
            <div class="field"><span>Distance miles</span><input class="control" type="number" min="0" [(ngModel)]="editor.distance_miles" [disabled]="editor.commercial"></div>
          </div>
          <div class="inventory-head"><strong>Inventory theo cabin</strong><small>Available được tự tính lại để giữ nguyên số ghế đã bán.</small></div>
          <div class="table-wrap inner-table"><table class="table"><thead><tr><th>Cabin</th><th>Đã bán</th><th>Số ghế bán</th><th>Giá cơ bản</th><th>Sức chứa máy bay</th></tr></thead><tbody>
            @for(inv of editor.inventory_rows;track inv.cabin_class){<tr><td><strong>{{inv.cabin_class}}</strong></td><td>{{soldSeats(inv)}}</td><td><input class="mini-number" type="number" min="0" [(ngModel)]="inv.allocated_seats"></td><td><input class="mini-price" type="number" min="0" [(ngModel)]="inv.base_price"></td><td>{{layoutCapacity(inv.cabin_class)||'—'}}</td></tr>}
          </tbody></table></div>
        }
        <button class="btn btn-primary save" (click)="saveEditor()" [disabled]="busy">Lưu thay đổi</button>
      </section>
      </div>
    }

    <div class="card table-wrap">
      <table class="table">
        @if(kind==='bookings'){
          <thead><tr><th>PNR</th><th>Customer</th><th>Type</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>@for(x of paged;track x._id){<tr><td><strong>{{x.pnr_code}}</strong><small>{{x.confirmation_number||x.blocking_number||'—'}}</small></td><td>{{customerLabel(x)}}</td><td>{{x.booking_type}}</td><td><span class="pill" [class.pill-success]="x.status==='CONFIRMED'||x.status==='RESCHEDULED'" [class.pill-gold]="x.status==='BLOCKED'">{{x.status}}</span></td><td>{{money(x.total_amount)}}</td><td><div class="row-actions"><button class="btn btn-outline" (click)="selected=x">Chi tiết</button>@if(x.status==='BLOCKED'){<button class="btn btn-dark" (click)="confirmHold(x)" [disabled]="busy">Xác nhận</button>}@if(x.status!=='CANCELLED'){<button class="btn btn-outline danger" (click)="cancelBooking(x)" [disabled]="busy">Hủy</button>}</div></td></tr>}</tbody>
        }@else if(kind==='users'){
          <thead><tr><th>User</th><th>Contact</th><th>Role</th><th>SkyMiles</th><th></th></tr></thead>
          <tbody>@for(x of paged;track x._id){<tr><td><strong>{{x.first_name}} {{x.last_name}}</strong><small>@{{x.username}}</small></td><td>{{x.email}}<small>{{x.phone_number||'—'}}</small></td><td><span class="pill">{{x.role}}</span></td><td><strong>{{num(x.sky_miles)}}</strong><small>{{skyTier(x.sky_miles)}}</small></td><td><div class="row-actions"><button class="btn btn-outline" (click)="selected=x">Chi tiết</button><button class="btn btn-outline" (click)="openEdit(x)">Sửa</button><button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy||x.role==='SUPER_ADMIN'">Xóa</button></div></td></tr>}</tbody>
        }@else if(kind==='flights'){
          <thead><tr><th>Số hiệu chuyến bay</th><th>Tuyến</th><th>Khởi hành</th><th>Trạng thái</th><th>Nguồn</th><th></th></tr></thead>
          <tbody>@for(x of paged;track x._id){<tr><td><strong>{{x.flight_number}}</strong><small>{{x.operator||'APTECH_AIRLINES'}}</small></td><td>{{x.origin_iata}} → {{x.dest_iata}}</td><td>{{dateTime(x.scheduled_departure)}}</td><td><span class="pill" [class.pill-success]="x.status==='SCHEDULED'">{{x.status}}</span></td><td>{{x.data_source||'—'}}</td><td><div class="row-actions"><button class="btn btn-outline" (click)="selected=x">Chi tiết</button><button class="btn btn-outline" (click)="openEdit(x)">Sửa</button><button class="btn btn-dark" (click)="openStatus(x)">Trạng thái</button><button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy">Xóa</button></div></td></tr>}</tbody>
        }@else{
          <thead><tr><th>IATA</th><th>Airport</th><th>City</th><th>Country</th><th>Timezone</th><th></th></tr></thead>
          <tbody>@for(x of paged;track x._id||x.iata_code){<tr><td><strong>{{x.iata_code}}</strong></td><td>{{x.airport_name||x.name||'—'}}</td><td>{{x.city_name||x.city||'—'}}</td><td>{{x.country_code||x.country_name||x.country||'—'}}</td><td>{{x.time_zone||'—'}}</td><td><div class="row-actions"><button class="btn btn-outline" (click)="selected=x">Chi tiết</button><button class="btn btn-outline" (click)="openEdit(x)">Sửa</button><button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy">Xóa</button></div></td></tr>}</tbody>
        }
      </table>
    </div>
    <app-pagination [total]="filtered.length" [(page)]="page" [(pageSize)]="pageSize" />

    @if(selected){
      <div class="modal">
        <section class="card detail">
          <button class="close" (click)="selected=null">×</button>
          <div class="eyebrow">{{kind.toUpperCase()}} DETAIL</div>
          <h2>{{primary(selected)}}</h2>

          @if(kind==='bookings'){
            <div class="detail-grid">
              <div><span>Status</span><b>{{selected.status}}</b></div><div><span>Booking type</span><b>{{selected.booking_type}}</b></div>
              <div><span>PNR</span><b>{{selected.pnr_code}}</b></div><div><span>Confirmation / Block</span><b>{{selected.confirmation_number||selected.blocking_number||'—'}}</b></div>
              <div><span>Passengers</span><b>{{selected.passengers?.length||0}}</b></div><div><span>Total</span><b>{{money(selected.total_amount)}}</b></div>
              <div><span>Email khách hàng</span><b>{{bookingEmail(selected)}}</b></div><div><span>Loại email nhắc</span><b>{{selected.status==='BLOCKED'?'Nhắc thanh toán giữ chỗ':(selected.status==='CONFIRMED'||selected.status==='RESCHEDULED'?'Nhắc lịch bay':'Không áp dụng')}}</b></div>
            </div>
            <div class="detail-actions"><button class="btn btn-outline" (click)="trackBooking(selected)">Tra cứu ticket</button>@if(auth.admin()&&selected.status==='BLOCKED'){<button class="btn btn-outline" (click)="sendReminder(selected)" [disabled]="busy">Gửi email nhắc thanh toán</button>}@if(auth.admin()&&(selected.status==='CONFIRMED'||selected.status==='RESCHEDULED')){<button class="btn btn-outline" (click)="sendReminder(selected)" [disabled]="busy">Gửi email nhắc lịch bay</button>}@if(selected.status==='CONFIRMED'||selected.status==='RESCHEDULED'){<button class="btn btn-dark" (click)="rescheduleBooking(selected)">Đổi chuyến</button>}</div>
          }@else if(kind==='users'){
            <div class="detail-grid">
              <div><span>Username</span><b>@{{selected.username}}</b></div><div><span>Role</span><b>{{selected.role}}</b></div>
              <div><span>Full name</span><b>{{selected.first_name}} {{selected.last_name}}</b></div><div><span>Email</span><b>{{selected.email}}</b></div>
              <div><span>Phone</span><b>{{selected.phone_number||'—'}}</b></div><div><span>SkyMiles</span><b>{{num(selected.sky_miles)}} · {{skyTier(selected.sky_miles)}}</b></div>
              <div><span>Address</span><b>{{selected.address||'—'}}</b></div><div><span>Payment</span><b>Customer checkout via PayPal</b></div>
            </div>
            <div class="detail-actions"><button class="btn btn-primary" (click)="editFromDetail(selected)">Sửa tài khoản</button></div>
          }@else if(kind==='flights'){
            <div class="detail-grid">
              <div><span>Route</span><b>{{selected.origin_iata}} → {{selected.dest_iata}}</b></div><div><span>Status</span><b>{{selected.status}}</b></div>
              <div><span>Departure</span><b>{{dateTime(selected.scheduled_departure)}}</b></div><div><span>Arrival</span><b>{{dateTime(selected.scheduled_arrival)}}</b></div>
              <div><span>Aircraft</span><b>{{selected.aircraft?.model_code||selected.aircraft?.type||'—'}}</b></div><div><span>Bookable</span><b>{{selected.is_bookable?'Yes':'No'}}</b></div>
              <div><span>Source</span><b>{{selected.data_source||'—'}}</b></div><div><span>Operator</span><b>{{selected.operator||'—'}}</b></div>
            </div>
            <div class="detail-actions"><button class="btn btn-primary" (click)="editFromDetail(selected)">Sửa chuyến bay</button></div>
          }@else{
            <div class="detail-grid">
              <div><span>IATA</span><b>{{selected.iata_code}}</b></div><div><span>Timezone</span><b>{{selected.time_zone||'—'}}</b></div>
              <div><span>Airport</span><b>{{selected.airport_name||selected.name||'—'}}</b></div><div><span>City</span><b>{{selected.city_name||selected.city||'—'}}</b></div>
              <div><span>Country</span><b>{{selected.country_name||selected.country||'—'}}</b></div><div><span>Coordinates</span><b>{{coords(selected)}}</b></div>
            </div>
            <div class="detail-actions"><button class="btn btn-primary" (click)="editFromDetail(selected)">Sửa sân bay</button></div>
          }
        </section>
      </div>
    }

    @if(statusEditor){
      <div class="modal" (click)="statusEditor=null">
        <section class="card status-editor" (click)="$event.stopPropagation()">
          <button class="close" (click)="statusEditor=null">×</button><div class="eyebrow">FLIGHT STATUS</div><h2>{{statusEditor.flight_number}}</h2>
          <div class="field"><span>Trạng thái</span><select class="control" [(ngModel)]="statusEditor.status"><option>SCHEDULED</option><option>DELAYED</option><option>CANCELLED</option><option>COMPLETED</option></select></div>
          @if(statusEditor.status==='DELAYED'){<div class="field"><span>Số phút trễ</span><input class="control" type="number" min="0" [(ngModel)]="statusEditor.delay_minutes"></div>}
          <div class="field"><span>Lý do / ghi chú</span><input class="control" [(ngModel)]="statusEditor.delay_reason"></div>
          @if(statusEditor.status==='DELAYED'){<p class="info">Khi lưu trạng thái DELAYED, hệ thống tự gửi email thông báo hoãn chuyến đến khách có booking liên quan, gồm giờ cũ, giờ mới và lý do.</p>}
          @if(statusEditor.status==='CANCELLED'){<p class="info">Khi hủy chuyến, hệ thống xử lý booking liên quan và gửi email thông báo hủy/hoàn tiền theo trạng thái vé.</p>}
          <button class="btn btn-primary save" (click)="saveStatus()" [disabled]="busy">Cập nhật trạng thái</button>
        </section>
      </div>
    }
  `,
  styles:[`
    .head-actions,.row-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.toolbar{display:flex;align-items:center;gap:12px;padding:14px 16px;margin:18px 0}.toolbar input{flex:1}.table td small{display:block;color:#7a8997;margin-top:4px}.notice{background:#fff;padding:10px 13px;border-radius:12px}.editor-panel{width:min(920px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.editor-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.editor-head h2{margin:5px 0 16px;color:#071b2e}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field.full,.check.full{grid-column:1/-1}.check{display:flex;gap:8px;align-items:center;padding:10px 0}.save{width:100%;margin-top:16px}.info{background:#fff7df;color:#72540d;border-radius:12px;padding:11px 13px}.inventory-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin:20px 0 8px;color:#0a2540}.inventory-head small{color:#718093}.inner-table{border:1px solid #e1e8ee;border-radius:12px}.mini-number,.mini-price{border:1px solid #d8e1e8;border-radius:8px;padding:8px;width:110px}.mini-price{width:150px}.inventory-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin:20px 0 8px;color:#0a2540}.inventory-head small{color:#718093}.inner-table{border:1px solid #e1e8ee;border-radius:12px}.mini-number,.mini-price{border:1px solid #d8e1e8;border-radius:8px;padding:8px;width:110px}.mini-price{width:150px}.danger{color:#9b3030;border-color:#e4c0c0}.modal{position:fixed;inset:0;background:rgba(4,18,31,.55);display:grid;place-items:center;padding:20px;z-index:90}.detail,.status-editor{width:min(700px,100%);max-height:90vh;overflow:auto;padding:24px;position:relative}.status-editor{width:min(480px,100%)}.detail h2,.status-editor h2{color:#071b2e;margin:7px 0 18px}.status-editor .field{margin-bottom:12px}.close{position:absolute;right:14px;top:10px;border:0;background:transparent;font-size:28px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.detail-grid>div{background:#f6f8fa;border-radius:12px;padding:12px;min-width:0}.detail-grid span{display:block;font-size:10px;text-transform:uppercase;color:#718093;font-weight:800}.detail-grid b{display:block;color:#142b3e;margin-top:5px;overflow-wrap:anywhere}.detail-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.btn:disabled{opacity:.5}@media(max-width:850px){.section-head{align-items:flex-start;flex-direction:column}.head-actions,.row-actions{justify-content:flex-start}}@media(max-width:650px){.toolbar{align-items:stretch;flex-direction:column}.detail-grid,.form-grid{grid-template-columns:1fr}.field.full,.check.full{grid-column:auto}.detail-actions{flex-direction:column}.inventory-head{align-items:flex-start;flex-direction:column}}
  `]
})
export class AdminListComponent implements OnInit{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  @Input() kind='bookings';
  @Input() title='';
  api=inject(ApiService);
  auth=inject(AuthService);
  router=inject(Router);
  toast=inject(ToastService);
  rows:any[]=[];layouts:any[]=[];selected:any=null;editor:any=null;statusEditor:any=null;editorMode:'create'|'edit'='create';private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};query='';busy=false;page=1;pageSize=20;

  ngOnInit(){
    this.load();
    if(this.kind==='flights'){
      this.api.commercialAircraftLayouts().subscribe({next:r=>this.layouts=Array.isArray(r)?r:[],error:e=>this.error=this.msg(e,'Không tải được aircraft layouts.')});
      this.api.airports().subscribe({next:(r:any)=>{const list=Array.isArray(r)?r:(r?.items||r?.data||[]);for(const a of list)if(a?.iata_code)this.tzMap[a.iata_code]=a.time_zone||'UTC'}});
    }
  }
  tzMap:Record<string,string>={};
  get originIata(){return String(this.editor?.origin_iata||'').trim().toUpperCase()}
  get destIata(){return String(this.editor?.dest_iata||'').trim().toUpperCase()}
  tzOf(iata:string){return (iata&&this.tzMap[String(iata).toUpperCase()])||'UTC'}
  /** Offset (minutes) of a timezone at a given instant, using Intl. */
  tzOffset(d:Date,tz:string){const parts:any={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(d))parts[p.type]=p.value;const asUtc=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);return Math.round((asUtc-d.getTime())/60000)}
  /** Convert "YYYY-MM-DDTHH:mm" wall-clock time in tz to a UTC Date. */
  localToUtc(local:string,tz:string){if(!local)return null;const naive=new Date(local+':00Z');if(isNaN(naive.getTime()))return null;let utc=new Date(naive.getTime()-this.tzOffset(naive,tz)*60000);utc=new Date(naive.getTime()-this.tzOffset(utc,tz)*60000);return utc}
  localInput(d:Date,tz:string){if(isNaN(d.getTime()))return'';return new Date(d.getTime()+this.tzOffset(d,tz)*60000).toISOString().slice(0,16)}
  fmtLocal(d:Date,tz:string){return this.localInput(d,tz).replace('T',' ')}
  computeTimes(){const e=this.editor;if(!e)return null;const tz=this.tzOf(e.origin_iata);const dep=this.localToUtc(e.dep_local,tz);const duration=Math.round(Number(e.duration_input||0));if(!dep||duration<1)return null;return{dep,arr:new Date(dep.getTime()+duration*60000),duration}}
  get previewTimes(){const p=this.computeTimes();if(!p)return null;return{depLocal:this.fmtLocal(p.dep,this.tzOf(this.originIata)),arrLocal:this.fmtLocal(p.arr,this.tzOf(this.destIata)),depUtc:p.dep.toISOString().slice(0,16).replace('T',' '),arrUtc:p.arr.toISOString().slice(0,16).replace('T',' ')}}
  syncDepartureDate(){if(this.editor?.dep_local)this.editor.departure_date=String(this.editor.dep_local).slice(0,10)}
  /** Existing flights that can connect to/from the one being edited (45–720 min layover, same rule as backend search). */
  get connectionHints(){
    const p=this.computeTimes();const o=this.originIata,d=this.destIata;if(!p||!o||!d)return[];
    const out:any[]=[];
    for(const f of this.rows){
      if(f._id===this.editor._id||f.status==='CANCELLED')continue;
      const fd=new Date(f.scheduled_departure).getTime(),fa=new Date(f.scheduled_arrival).getTime();
      if(f.origin_iata===d&&f.dest_iata!==o){const w=(fd-p.arr.getTime())/60000;if(w>=45&&w<=720)out.push({id:f._id,text:`${o} → ${d} → ${f.dest_iata}: nối ${f.flight_number}, chờ ${Math.round(w)} phút`})}
      if(f.dest_iata===o&&f.origin_iata!==d){const w=(p.dep.getTime()-fa)/60000;if(w>=45&&w<=720)out.push({id:f._id+'-in',text:`${f.origin_iata} → ${o} → ${d}: sau ${f.flight_number}, chờ ${Math.round(w)} phút`})}
    }
    return out.slice(0,8);
  }
  get subtitle(){return({bookings:'Các đặt chỗ đang lưu trong hệ thống và các tác vụ theo lịch.',users:'Tài khoản và hồ sơ khách hàng/nhân viên.',flights:'Chuyến bay, lịch vận hành và trạng thái khẩn cấp.',airports:'Danh mục sân bay, múi giờ và phạm vi phục vụ.'} as any)[this.kind]||'Dữ liệu trực tiếp từ máy chủ.'}
  get searchPlaceholder(){return({bookings:'PNR, mã xác nhận, trạng thái',users:'Tên, tên đăng nhập, email, vai trò',flights:'Số hiệu chuyến bay, tuyến bay, trạng thái',airports:'IATA, thành phố, quốc gia'} as any)[this.kind]||'Tìm kiếm'}
  get filtered(){const q=this.query.trim().toLowerCase();if(!q)return this.rows;return this.rows.filter(x=>JSON.stringify(this.searchable(x)).toLowerCase().includes(q))}
  get paged(){const start=(this.page-1)*this.pageSize;return this.filtered.slice(start,start+this.pageSize)}
  skyTier(value:any){const miles=Number(value||0);return miles<20000?'MEMBER':miles<50000?'SILVER':miles<100000?'GOLD':'PLATINUM'}
  load(){
    this.error='';
    const req=this.kind==='users'?this.api.users():this.kind==='flights'?this.api.flights():this.kind==='airports'?this.api.airports():this.api.bookings();
    req.subscribe({next:(r:any)=>{this.rows=Array.isArray(r)?r:(r?.items||r?.data||[]);this.page=1},error:e=>this.error=this.msg(e,'Không tải được dữ liệu.')})
  }
  openCreate(){
    this.editorMode='create';this.error='';this.message='';
    if(this.kind==='users')this.editor={username:'',password:'User@2026',first_name:'',last_name:'',email:'',phone_number:'',address:'',role:'CUSTOMER'};
    else if(this.kind==='airports')this.editor={iata_code:'',icao_code:'',airport_name:'',city_name:'',country_code:'VN',time_zone:'Asia/Ho_Chi_Minh',lat:null,lng:null,is_serviced_directly:true};
    else if(this.kind==='flights'){
      this.editor={flight_number:'',origin_iata:'',dest_iata:'',departure_date:'',dep_local:'',duration_input:120,distance_miles:0,aircraft_code:'A20N',commercial:false,inventory_rows:[]};
      this.flightAircraftChanged(true);
    }
  }
  openEdit(x:any){
    this.editorMode='edit';this.error='';this.message='';
    if(this.kind==='users')this.editor={...x,originalRole:x.role};
    else if(this.kind==='airports')this.editor={...x};
    else if(this.kind==='flights'){
      this.editor={
        ...x,
        commercial:x.data_source==='AIRLABS_COMMERCIALIZED',
        dep_local:this.localInput(new Date(x.scheduled_departure),this.tzOf(x.origin_iata)),
        duration_input:Math.max(1,Math.round((new Date(x.scheduled_arrival).getTime()-new Date(x.scheduled_departure).getTime())/60000)),
        aircraft_code:x.aircraft?.model_code||'',
        inventory_rows:(x.inventories||[]).map((inv:any)=>({
          cabin_class:inv.cabin_class,
          allocated_seats:Number(inv.allocated_seats||0),
          available_seats:Number(inv.available_seats||0),
          base_price:Number(inv.base_price||0),
          bucket_code:inv.bucket_code||String(inv.cabin_class||'Y')[0],
          _original_allocated:Number(inv.allocated_seats||0),
          _original_available:Number(inv.available_seats||0),
        })),
      };
    }
  }
  editFromDetail(x:any){this.selected=null;this.openEdit(x)}
  saveEditor(){if(!this.editor)return;if(this.kind==='users')this.saveUser();else if(this.kind==='airports')this.saveAirport();else if(this.kind==='flights')this.saveFlight()}
  saveUser(){
    const e=this.editor;
    if(!e.first_name?.trim()||!e.last_name?.trim()||!e.email?.trim()||(this.editorMode==='create'&&(!e.username?.trim()||!e.password))){this.error='Vui lòng nhập đủ username/password/họ tên/email.';return}
    const phone=e.phone_number?.trim();
    const body:any={first_name:e.first_name.trim(),last_name:e.last_name.trim(),email:e.email.trim(),address:e.address?.trim()||'',role:e.role};
    if(phone)body.phone_number=phone;
    else if(this.editorMode==='edit')body.phone_number='';
    if(this.editorMode==='create'){body.username=e.username.trim();body.password=e.password}else body.sky_miles=Math.max(0,Number(e.sky_miles||0));
    if(this.editorMode==='edit'&&e.originalRole==='SUPER_ADMIN')delete body.role;
    this.busy=true;
    const req=this.editorMode==='create'?this.api.createUser(body):this.api.updateUser(e._id,body);
    req.subscribe({next:()=>this.done(this.editorMode==='create'?'Đã tạo tài khoản.':'Đã cập nhật tài khoản.'),error:x=>this.fail(x,'Không lưu được tài khoản.')});
  }
  saveAirport(){
    const e=this.editor;
    if(!e.iata_code?.trim()||!e.city_name?.trim()||!e.airport_name?.trim()){this.error='IATA, tên sân bay và thành phố là bắt buộc.';return}
    const body:any={city_name:e.city_name.trim(),airport_name:e.airport_name.trim(),is_serviced_directly:!!e.is_serviced_directly,time_zone:e.time_zone?.trim()||undefined,icao_code:e.icao_code?.trim()||undefined,country_code:e.country_code?.trim().toUpperCase()||undefined,lat:e.lat==null||e.lat===''?undefined:Number(e.lat),lng:e.lng==null||e.lng===''?undefined:Number(e.lng)};
    this.busy=true;
    const req=this.editorMode==='create'?this.api.createAirport({iata_code:e.iata_code.trim().toUpperCase(),...body}):this.api.updateAirport(e.iata_code,body);
    req.subscribe({next:()=>this.done(this.editorMode==='create'?'Đã tạo sân bay.':'Đã cập nhật sân bay.'),error:x=>this.fail(x,'Không lưu được sân bay.')});
  }
  saveFlight(){
    const e=this.editor;
    const p=this.computeTimes();
    if(!p){this.error='Nhập nơi đi/đến, giờ cất cánh (giờ địa phương) và thời gian bay hợp lệ.';return}
    const dep=p.dep,arr=p.arr;
    if(!e.departure_date){this.error='Departure date là bắt buộc.';return}
    const duration=p.duration;
    if(!e.aircraft_code?.trim()){this.error='Chọn máy bay cho chuyến bay.';return}
    const layout=this.selectedFlightLayout;
    if(!layout){this.error='Loại máy bay không tồn tại trong fleet layout.';return}
    const inventories:any[]=[];
    for(const inv of (e.inventory_rows||[])){
      const target=Math.max(0,Math.round(Number(inv.allocated_seats||0)));
      const sold=this.soldSeats(inv);
      const capacity=this.layoutCapacity(inv.cabin_class);
      if(target<sold){this.error=`${inv.cabin_class}: không thể giảm dưới ${sold} ghế đã bán.`;return}
      if(target>0&&!capacity){this.error=`${layout.aircraft_type} không hỗ trợ cabin ${inv.cabin_class}.`;return}
      if(target>capacity){this.error=`${inv.cabin_class}: tối đa ${capacity} ghế trên ${layout.aircraft_type}.`;return}
      if(target>0)inventories.push({cabin_class:inv.cabin_class,is_smoking:false,bucket_code:inv.bucket_code||String(inv.cabin_class||'Y')[0],base_price:Math.max(0,Number(inv.base_price||0)),allocated_seats:target,available_seats:Math.max(0,target-sold)});
    }
    if(!inventories.length){this.error='Phải có ít nhất một cabin có ghế bán.';return}
    const base:any={
      departure_date:e.departure_date,
      scheduled_departure:dep.toISOString(),
      scheduled_arrival:arr.toISOString(),
      duration_minutes:duration,
      aircraft:{model_code:layout.aircraft_type,model_name:layout.model_name,total_capacity:Number(layout.total_capacity)},
      inventories,
    };
    let body:any=base;
    if(!e.commercial){
      if(!e.flight_number?.trim()){this.error='Flight number là bắt buộc.';return}
      body={...base,flight_number:e.flight_number.trim().toUpperCase(),distance_miles:Math.max(0,Math.round(Number(e.distance_miles||0)))};
    }
    if(this.editorMode==='create'){
      if(!e.origin_iata?.trim()||!e.dest_iata?.trim()){this.error='Origin và destination là bắt buộc.';return}
      body.flight_number=e.flight_number.trim().toUpperCase();
      body.origin_iata=e.origin_iata.trim().toUpperCase();body.dest_iata=e.dest_iata.trim().toUpperCase();
      body.distance_miles=Math.max(0,Math.round(Number(e.distance_miles||0)));
    }
    this.busy=true;
    const req=this.editorMode==='create'?this.api.createFlight(body):this.api.updateFlight(e._id,body);
    req.subscribe({next:()=>this.done(this.editorMode==='create'?'Đã tạo chuyến bay.':'Đã cập nhật chuyến bay.'),error:x=>this.fail(x,'Không lưu được chuyến bay.')});
  }
  openStatus(x:any){this.statusEditor={_id:x._id,flight_number:x.flight_number,status:x.status,delay_minutes:x.delay_minutes||0,delay_reason:x.delay_reason||''}}
  saveStatus(){
    const e=this.statusEditor;if(!e)return;
    const body:any={status:e.status,delay_reason:e.delay_reason||''};
    if(e.status==='DELAYED')body.delay_minutes=Math.max(0,Math.round(Number(e.delay_minutes||0)));
    this.busy=true;
    this.api.updateFlightStatus(e._id,body).subscribe({next:()=>{this.statusEditor=null;this.done('Đã cập nhật trạng thái chuyến bay.')},error:x=>this.fail(x,'Không cập nhật được trạng thái.')});
  }
  async remove(x:any){
    if(this.kind==='users'&&x.role==='SUPER_ADMIN'){this.error='SUPER_ADMIN không thể bị xóa.';return}
    const label=this.primary(x);
    const confirmed=await this.toast.confirm({
      titleVi:'Xác nhận xóa',
      titleEn:'Confirm deletion',
      messageVi:'Bạn có chắc muốn xóa '+label+'?',
      messageEn:'Are you sure you want to delete '+label+'?',
      confirmVi:'Xóa',
      confirmEn:'Delete',
    });
    if(!confirmed)return;
    this.busy=true;
    const req=this.kind==='users'?this.api.deleteUser(x._id):this.kind==='flights'?this.api.deleteFlight(x._id):this.api.deleteAirport(x.iata_code);
    req.subscribe({next:()=>this.done('Đã xóa '+label+'.'),error:e=>this.fail(e,'Không xóa được dữ liệu.')});
  }
  runScheduler(job:'run-expiry'){
    this.busy=true;this.error='';
    this.api.runBookingScheduler(job).subscribe({next:r=>{this.busy=false;this.message=r?.message||'Scheduler đã chạy.';this.load()},error:e=>this.fail(e,'Không chạy được scheduler.')});
  }
  sendReminder(x:any){
    if(!x?._id)return;
    this.busy=true;this.error='';this.message='';
    const isHold=x.status==='BLOCKED';
    this.api.sendBookingReminder(x._id).subscribe({
      next:r=>{this.busy=false;this.message=r?.message||(isHold?'Đã gửi email nhắc thanh toán giữ chỗ.':'Đã gửi email nhắc lịch bay.');this.selected=null;this.load()},
      error:e=>this.fail(e,isHold?'Không gửi được email nhắc thanh toán giữ chỗ.':'Không gửi được email nhắc lịch bay.')
    });
  }
  confirmHold(x:any){
    const blocking=x.blocking_number||x.pnr_code;if(!blocking)return;
    this.busy=true;
    this.api.confirm({blocking_number:blocking,payment_method:'PROFILE_CARD'}).subscribe({next:()=>this.done('Đã xác nhận '+blocking+'.'),error:e=>this.fail(e,'Không xác nhận được booking.')});
  }
  async cancelBooking(x:any){
    const code=x.confirmation_number||x.blocking_number||x.pnr_code;
    if(!code)return;
    const confirmed=await this.toast.confirm({
      titleVi:'Hủy booking?',
      titleEn:'Cancel booking?',
      messageVi:'Hủy booking '+code+' theo chính sách hiện hành?',
      messageEn:'Cancel booking '+code+' under the current policy?',
      confirmVi:'Hủy booking',
      confirmEn:'Cancel booking',
    });
    if(!confirmed)return;
    this.busy=true;
    this.api.cancel(code).subscribe({next:r=>this.done('Đã hủy booking. Mã hủy: '+(r?.cancellation_number||'đã tạo')+'.'),error:e=>this.fail(e,'Không hủy được booking.')});
  }
  searchable(x:any){
    if(this.kind==='bookings')return[x.pnr_code,x.confirmation_number,x.blocking_number,x.status,x.booking_type];
    if(this.kind==='users')return[x.username,x.first_name,x.last_name,x.email,x.phone_number,x.role];
    if(this.kind==='flights')return[x.flight_number,x.origin_iata,x.dest_iata,x.status,x.data_source,x.operator];
    return[x.iata_code,x.airport_name,x.name,x.city_name,x.city,x.country_name,x.country,x.time_zone];
  }
  primary(x:any){return x.pnr_code||x.username||x.flight_number||x.iata_code||x._id}
  customerLabel(x:any){const u=x.user_id;return typeof u==='object'?(u.username||u.email||u._id):String(u||'—')}
  bookingEmail(x:any){const u=x?.user_id;return typeof u==='object'?(u.email||'—'):'—'}
  trackBooking(x:any){const code=x.confirmation_number||x.blocking_number||x.pnr_code;this.router.navigate(['/track'],{queryParams:{code}})}
  rescheduleBooking(x:any){const code=x.confirmation_number||x.pnr_code;this.router.navigate(['/reschedule'],{queryParams:{code}})}
  inventory(x:any,cabin:string){return(x?.inventories||[]).find((i:any)=>i.cabin_class===cabin)}
  inventoryPayload(e:any,cabin:string,target:number,price:number){
    const old=this.inventory(e,cabin),beforeAllocated=Number(old?.allocated_seats||0),beforeAvailable=Number(old?.available_seats||0);
    return{cabin_class:cabin,is_smoking:false,bucket_code:old?.bucket_code||cabin[0],base_price:Math.max(0,Number(price||0)),allocated_seats:target,available_seats:this.editorMode==='create'?target:Math.max(0,beforeAvailable+(target-beforeAllocated))};
  }
  get selectedFlightLayout(){return this.layouts.find(a=>a.aircraft_type===this.editor?.aircraft_code)||null}
  layoutCapacity(cabin:string){return Number(this.selectedFlightLayout?.cabin_capacities?.[cabin]||0)}
  soldSeats(inv:any){return Math.max(0,Number(inv?._original_allocated??inv?.allocated_seats??0)-Number(inv?._original_available??inv?.available_seats??0))}
  flightAircraftChanged(initial=false){
    if(!this.editor)return;
    const layout=this.selectedFlightLayout;if(!layout)return;
    const current:any[]=Array.isArray(this.editor.inventory_rows)?this.editor.inventory_rows:[];
    const byCabin=new Map(current.map(inv=>[inv.cabin_class,inv]));
    const next:any[]=[];
    for(const cabin of (layout.supported_cabins||Object.keys(layout.cabin_capacities||{}))){
      const old:any=byCabin.get(cabin);
      if(old){next.push(old);continue}
      const cap=Number(layout.cabin_capacities?.[cabin]||0);
      next.push({cabin_class:cabin,allocated_seats:initial?(cabin==='ECONOMY'?cap:0):0,available_seats:initial?(cabin==='ECONOMY'?cap:0):0,base_price:0,bucket_code:String(cabin)[0],_original_allocated:0,_original_available:0});
    }
    for(const old of current){
      if(!next.some(inv=>inv.cabin_class===old.cabin_class)&&this.soldSeats(old)>0)next.push(old);
    }
    this.editor.inventory_rows=next;
  }
  parseIso(v:any){const s=String(v||'').trim();if(!/(Z|[+-]\d{2}:\d{2})$/i.test(s))return null;const d=new Date(s);return isNaN(d.getTime())?null:d}
  iso(v:any){if(!v)return'';const d=new Date(v);return isNaN(d.getTime())?String(v):d.toISOString()}
  coords(x:any){const lat=x.latitude??x.lat;const lon=x.longitude??x.lng??x.lon;return lat!=null&&lon!=null?`${lat}, ${lon}`:'—'}
  dateTime(v:any){if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(d)}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  num(v:number){return new Intl.NumberFormat('vi-VN').format(v||0)}
  done(text:string){this.busy=false;this.editor=null;this.selected=null;this.message=text;this.error='';this.load()}
  fail(e:any,f:string){this.busy=false;this.error=this.msg(e,f)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
