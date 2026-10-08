import { Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';
import { explainPricing } from './pricing/fare-calc';

type AdvanceRule={min_days:number;max_days:number|null;adjustment_percent:number;label:string;label_en:string};
type LoadRule={min_load_percent:number;max_load_percent:number;adjustment_percent:number;label:string;label_en:string};

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent,NgTemplateOutlet],
  template:`
  <div class="eyebrow">QUẢN TRỊ DOANH THU</div>
  <div class="section-head"><div><h1 class="title">Hồ sơ giá vé</h1><p class="subtitle">Tạo chính sách giá một lần, lưu vào hệ thống và tái sử dụng cho nhiều chuyến bay hoặc commercial template.</p></div><button class="btn btn-primary" (click)="newProfile()">Tạo cấu hình mới</button></div>
  <div class="workflow card"><div><b>1</b><span><strong>Tạo chính sách</strong><small>Đặt tên dễ hiểu và các mốc tăng/giảm giá.</small></span></div><div><b>2</b><span><strong>Gán nơi áp dụng</strong><small>Tick chuyến bay hoặc lịch bay mẫu cần dùng.</small></span></div><div><b>3</b><span><strong>Hệ thống tự tính</strong><small>Giá được tính theo ngày mua + độ lấp đầy + SkyMiles.</small></span></div></div>
  

  <div class="explain card">
    <h3>Giá vé được tính như thế nào?</h3>
    <ol>
      <li><b>Giá gốc</b> của hạng ghế (do chuyến bay quy định).</li>
      <li>× <b>điều chỉnh theo thời điểm mua</b>: còn bao nhiêu ngày đến ngày bay → tìm mốc phù hợp (ví dụ mua trước ≥ 61 ngày: −15%).</li>
      <li>× <b>điều chỉnh theo độ lấp đầy</b>: % ghế đã bán của chuyến → tìm mốc phù hợp (ví dụ lấp đầy ≥ 80%: +10%).</li>
      <li>× <b>giảm giá hội viên SkyMiles</b>: Silver −3%, Gold −7%, Platinum −12%.</li>
      <li>Làm tròn đến đồng. Chuyến chưa gán hồ sơ sẽ dùng mốc mặc định của hệ thống.</li>
    </ol>
  </div>

  <div class="card table-wrap profile-table">
    <table class="table">
      <thead><tr><th>Hồ sơ giá</th><th>Theo thời điểm mua</th><th>Theo độ lấp đầy</th><th>Đang dùng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody>
        @for(p of pagedProfiles;track p._id){<tr>
          <td><strong>{{p.name}}</strong><small>{{p.description||'Không có mô tả'}}</small><small class="code">mã: {{p.code}}</small></td>
          <td><div class="rule-lines">@for(r of sortedAdvance(p.advance_rules);track $index){<span>{{advanceText(r)}}</span>}@empty{<span>—</span>}</div></td>
          <td><div class="rule-lines">@for(r of sortedLoad(p.load_factor_rules);track $index){<span>{{loadText(r)}}</span>}@empty{<span>—</span>}</div></td>
          <td>{{p.assigned_flights||0}} chuyến<small>{{p.assigned_templates||0}} lịch bay mẫu</small></td>
          <td><span class="pill" [class.pill-success]="p.is_active" [class.pill-danger]="!p.is_active">{{p.is_active?'Đang bật':'Đang tắt'}}</span></td>
          <td><div class="row-actions"><button class="btn btn-outline small" (click)="edit(p)">Chi tiết / Sửa</button><button class="btn btn-dark small" (click)="openAssign(p)" [disabled]="!p.is_active">Gán</button></div></td>
        </tr>}
        @if(!profiles.length&&!loading){<tr><td colspan="6"><div class="empty">Chưa có pricing profile. Hãy tạo cấu hình đầu tiên.</div></td></tr>}
      </tbody>
    </table>
  </div>
  <app-pagination [total]="profiles.length" [(page)]="profilePage" [(pageSize)]="profilePageSize" [pageSizeOptions]="[5,10,20,50]" />

  <section class="card calc-card">
    <div class="rules-head first"><div><h3>Máy tính thử giá</h3><p>Nhập thử số liệu để xem từng bước điều chỉnh. Công thức giống hệt máy chủ (applyPricing).</p></div>
      <label class="field inline"><span>Hồ sơ dùng để tính</span><select class="control" [(ngModel)]="calcProfileId"><option value="">Mặc định hệ thống (chưa gán hồ sơ)</option>@for(p of profiles;track p._id){<option [value]="p._id">{{p.name}}</option>}</select></label>
    </div>
    <ng-container *ngTemplateOutlet="calcTpl; context:{$implicit: calcProfile}" />
  </section>

  <ng-template #calcTpl let-profile>
    <div class="calc">
      <div class="calc-inputs">
        <label class="field"><span>Giá gốc (VND)</span><input class="control" type="number" min="0" step="10000" [(ngModel)]="calc.base"></label>
        <label class="field"><span>Còn bao nhiêu ngày đến ngày bay</span><input class="control" type="number" min="0" [(ngModel)]="calc.days"></label>
        <label class="field"><span>% ghế đã bán (độ lấp đầy)</span><input class="control" type="number" min="0" max="100" [(ngModel)]="calc.load"></label>
        <label class="field"><span>Điểm SkyMiles của khách (tuỳ chọn)</span><input class="control" type="number" min="0" step="1000" [(ngModel)]="calc.miles"></label>
      </div>
      @let q = quote(profile);
      <table class="table steps">
        <thead><tr><th>Bước</th><th>Mốc áp dụng</th><th>Điều chỉnh</th><th>Giá sau bước</th></tr></thead>
        <tbody>
          <tr><td>Giá gốc</td><td>—</td><td>—</td><td>{{money(calc.base)}}</td></tr>
          @for(s of q.steps;track $index){<tr><td>{{s.title}}</td><td>{{s.detail}}</td><td><span class="pill" [class.pill-success]="s.percent<0" [class.pill-danger]="s.percent>0">{{pct(s.percent)}}</span></td><td>{{money(s.after)}}</td></tr>}
        </tbody>
        <tfoot><tr><td colspan="3"><b>Giá cuối cùng (làm tròn)</b></td><td><b class="final">{{money(q.final)}}</b></td></tr></tfoot>
      </table>
    </div>
  </ng-template>

  @if(editorOpen){
    <div class="modal" (click)="closeEditor()">
    <div class="card editor" (click)="$event.stopPropagation()">
      <button class="close" (click)="closeEditor()">×</button>
      <div class="editor-head">
        <div><span>{{editingId?'CHỈNH SỬA PROFILE':'PROFILE MỚI'}}</span><h2>{{form.name||'Chính sách giá mới'}}</h2></div>
        <div class="editor-actions">
          @if(editingId){<button class="btn btn-outline danger" (click)="remove()" [disabled]="busy">Xóa</button>}
          <button class="btn btn-primary" [disabled]="busy||validationErrors.length>0" (click)="save()">{{busy?'Đang lưu…':editingId?'Lưu thay đổi':'Lưu cấu hình'}}</button>
        </div>
      </div>
      <div class="grid grid-2">
        <label class="field"><span>Mã cấu hình</span><input class="control" [(ngModel)]="form.code" [disabled]="!!editingId" placeholder="STANDARD_2026"></label>
        <label class="field"><span>Tên cấu hình</span><input class="control" [(ngModel)]="form.name" placeholder="Giá tiêu chuẩn 2026"></label>
      </div>
      <label class="field"><span>Mô tả</span><input class="control" [(ngModel)]="form.description" placeholder="Áp dụng cho các chuyến nội địa tiêu chuẩn"></label>
      <label class="toggle"><input type="checkbox" [(ngModel)]="form.is_active"> Cho phép gán profile này cho chuyến bay</label>

      <div class="rules-head"><div><h3>1. Điều chỉnh theo thời điểm mua vé</h3><p>Số ngày = còn bao nhiêu ngày nữa đến ngày bay. Nhập số âm để giảm giá (−20 = giảm 20%), số dương để tăng giá. Để trống “Đến ngày” nghĩa là không giới hạn.</p></div><button class="btn btn-outline small" (click)="addAdvance()">+ Thêm mốc</button></div>
      <div class="table-wrap"><table class="table rules"><thead><tr><th>Từ ngày</th><th>Đến ngày</th><th>Tăng / giảm (%)</th><th>Tên hiển thị cho khách</th><th>Tên tiếng Anh</th><th>Khách sẽ thấy</th><th></th></tr></thead><tbody>
        @for(r of form.advance_rules;track $index;let i=$index){<tr [class.bad]="advanceRowError(r)">
          <td><input class="mini" type="number" min="0" [(ngModel)]="r.min_days"></td>
          <td><input class="mini" type="number" min="0" [ngModel]="r.max_days" (ngModelChange)="r.max_days=nullableNumber($event)" placeholder="∞"></td>
          <td><input class="mini" type="number" min="-100" [(ngModel)]="r.adjustment_percent">%</td>
          <td><input class="text-mini" [(ngModel)]="r.label"></td><td><input class="text-mini" [(ngModel)]="r.label_en"></td>
          <td><span class="preview">{{advanceText(r)}}</span>@if(advanceRowError(r)){<small class="row-err">{{advanceRowError(r)}}</small>}</td>
          <td><button class="icon-btn" title="Xóa mốc" (click)="form.advance_rules.splice(i,1)">×</button></td>
        </tr>}@empty{<tr><td colspan="7"><div class="empty">Chưa có mốc nào – hệ thống sẽ dùng mốc mặc định.</div></td></tr>}</tbody></table></div>

      <div class="rules-head"><div><h3>2. Điều chỉnh theo độ lấp đầy chuyến bay</h3><p>Độ lấp đầy = % ghế đã bán. Ví dụ chuyến vắng giảm giá để bán thêm, chuyến gần kín tăng giá. Mốc cuối cùng bao gồm cả giá trị “Đến %”.</p></div><button class="btn btn-outline small" (click)="addLoad()">+ Thêm mốc</button></div>
      <div class="table-wrap"><table class="table rules"><thead><tr><th>Từ % ghế đã bán</th><th>Đến dưới %</th><th>Tăng / giảm (%)</th><th>Tên hiển thị cho khách</th><th>Tên tiếng Anh</th><th>Khách sẽ thấy</th><th></th></tr></thead><tbody>
        @for(r of form.load_factor_rules;track $index;let i=$index){<tr [class.bad]="loadRowError(r)">
          <td><input class="mini" type="number" min="0" max="100" step="0.01" [(ngModel)]="r.min_load_percent"></td>
          <td><input class="mini" type="number" min="0" max="100" step="0.01" [(ngModel)]="r.max_load_percent"></td>
          <td><input class="mini" type="number" min="-100" [(ngModel)]="r.adjustment_percent">%</td>
          <td><input class="text-mini" [(ngModel)]="r.label"></td><td><input class="text-mini" [(ngModel)]="r.label_en"></td>
          <td><span class="preview">{{loadText(r)}}</span>@if(loadRowError(r)){<small class="row-err">{{loadRowError(r)}}</small>}</td>
          <td><button class="icon-btn" title="Xóa mốc" (click)="form.load_factor_rules.splice(i,1)">×</button></td>
        </tr>}@empty{<tr><td colspan="7"><div class="empty">Chưa có mốc nào – độ lấp đầy sẽ không ảnh hưởng giá.</div></td></tr>}</tbody></table></div>

      @if(validationErrors.length){<div class="notice error-box"><b>Cần sửa trước khi lưu:</b><ul>@for(m of validationErrors;track $index){<li>{{m}}</li>}</ul></div>}

      <div class="rules-head"><div><h3>3. Thử giá với cấu hình đang sửa</h3><p>Kết quả cập nhật ngay khi bạn sửa bảng ở trên (chưa cần lưu).</p></div></div>
      <ng-container *ngTemplateOutlet="calcTpl; context:{$implicit: form}" />

      <div class="actions"><button class="btn btn-primary" [disabled]="busy||validationErrors.length>0" (click)="save()">{{busy?'Đang lưu…':editingId?'Lưu & cập nhật chuyến đang dùng':'Lưu cấu hình'}}</button></div>
    </div>
    </div>
  }

  @if(assignOpen){
  <div class="modal" (click)="closeAssign()">
  <section class="card assign" (click)="$event.stopPropagation()">
    <button class="close" (click)="closeAssign()">×</button>
    <div class="section-head assign-head"><div><h2>Áp dụng: {{assignProfile?.name}}</h2><p class="subtitle">Chọn bằng checkbox. Lịch bay mẫu sẽ truyền profile cho các chuyến được sinh từ lịch đó.</p></div><span class="pill pill-gold" title="Mã nội bộ">{{assignProfile?.code}}</span></div>
    <div class="target-grid">
      <div class="target-column"><div class="target-title"><strong>Chuyến bay cụ thể</strong><small>{{selectedFlightIds.length}} đã chọn</small></div><div class="target-list">@for(f of flights;track f._id){<label class="target"><input type="checkbox" [checked]="selectedFlightIds.includes(f._id)" (change)="toggleTarget(selectedFlightIds,f._id,$event)"><span><b>{{f.flight_number}} · {{f.origin_iata}} → {{f.dest_iata}}</b><small>{{f.departure_date}} · Hiện tại: {{profileCode(f)}}</small></span></label>}</div></div>
      <div class="target-column"><div class="target-title"><strong>Lịch bay mẫu</strong><small>{{selectedTemplateIds.length}} đã chọn</small></div><div class="target-list">@for(t of templates;track t._id){<label class="target"><input type="checkbox" [checked]="selectedTemplateIds.includes(t._id)" (change)="toggleTarget(selectedTemplateIds,t._id,$event)"><span><b>{{t.flight_number}} · {{t.origin_iata}} → {{t.dest_iata}}</b><small>Máy bay {{t.aircraft_type||'—'}} · Hiện tại: {{profileCode(t)}}</small></span></label>}</div></div>
    </div>
    <div class="assign-actions"><small>Tổng: {{selectedFlightIds.length+selectedTemplateIds.length}} mục được chọn.</small><button class="btn btn-dark" [disabled]="busy||!assignProfileId||(!selectedFlightIds.length&&!selectedTemplateIds.length)" (click)="assign()">Áp dụng giá động</button></div>
  </section>
  </div>
  }
  `,
  styles:[`
    .workflow{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dfe7ed;margin-top:18px;overflow:hidden}.workflow>div{display:flex;gap:11px;align-items:center;background:#fff;padding:15px}.workflow b{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#f2c85f}.workflow span{display:grid;gap:3px}.workflow strong{font-size:12px;color:#17344c}.workflow small{font-size:10px;color:#718093}.notice{padding:12px 14px;border-radius:12px;margin:12px 0}.error-box{background:#fff0f0;color:#a62f2f}.success-box{background:#edf8f2;color:#237050}.profile-table{margin:18px 0}.profile-table td small{display:block;color:#7b8a98;margin-top:4px}.row-actions{display:flex;gap:7px;flex-wrap:wrap}.empty{padding:18px;text-align:center;color:#728293}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}.editor{width:min(1050px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.editor-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.editor-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.editor-head span{font-size:9px;letter-spacing:.12em;color:#a57916;font-weight:900}.editor-head h2{margin:4px 0 18px;color:#0a2540}.close{position:absolute;right:14px;top:9px;border:0;background:transparent;font-size:28px}.field{margin-bottom:12px}.toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#465b6d;margin:8px 0 24px}.rules-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin:24px 0 10px}.rules-head h3{margin:0;color:#0a2540}.rules-head p{margin:5px 0 0;font-size:11px;color:#6f7f8f}.small{padding:8px 12px;font-size:10px}.rules{min-width:790px}.rules th,.rules td{padding:8px}.mini,.text-mini{border:1px solid #d8e1e8;border-radius:8px;padding:8px;width:86px}.text-mini{width:135px}.icon-btn{border:0;background:#f7eaea;color:#a12c2c;width:29px;height:29px;border-radius:50%;font-size:18px}.actions{display:flex;justify-content:flex-end;margin-top:20px}.danger{color:#9d2e2e}.assign{width:min(980px,100%);max-height:90vh;overflow:auto;padding:24px;position:relative}.assign-head{margin-top:0}.target-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.target-column{border:1px solid #dfe7ed;border-radius:14px;overflow:hidden}.target-title{display:flex;justify-content:space-between;padding:11px 12px;background:#f5f8fa}.target-title small{color:#718093}.target-list{max-height:330px;overflow:auto;padding:6px}.target{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:9px;border-radius:10px}.target:hover{background:#f7f9fb}.target input{margin-top:3px}.target span{display:grid;gap:3px}.target b{font-size:11px;color:#17344c}.target small{font-size:9px;color:#748391}.assign-actions{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-top:14px}.assign-actions small{color:#728293}.explain{padding:16px 20px;margin:18px 0 0;background:#f8fbfd}.explain h3{margin:0 0 8px;color:#0a2540;font-size:14px}.explain ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:12px;color:#40566a}.code{font-size:9px!important;color:#9aa7b3!important;font-family:monospace}.rule-lines{display:grid;gap:3px;font-size:11px;color:#304a60;white-space:nowrap}.calc-card{padding:20px;margin:22px 0}.rules-head.first{margin-top:0}.field.inline{margin:0;min-width:260px}.calc{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:18px;align-items:start}.calc-inputs{display:grid;gap:2px}.steps td,.steps th{padding:8px 10px;font-size:12px}.steps tfoot td{border-top:2px solid #0a2540}.final{font-size:16px;color:#0a2540}.preview{font-size:11px;color:#17344c;font-weight:600;white-space:nowrap}.row-err{display:block;color:#b02a2a;font-size:10px;margin-top:3px}tr.bad td{background:#fff6f6}.error-box ul{margin:6px 0 0;padding-left:18px;font-size:12px}@media(max-width:760px){.calc{grid-template-columns:1fr}}@media(max-width:760px){.workflow,.target-grid{grid-template-columns:1fr}.grid-3{grid-template-columns:1fr}.editor-head{flex-direction:column}.editor-actions{width:100%}.editor-actions .btn{flex:1}.assign-actions{align-items:stretch;flex-direction:column}}
  `]
})
export class FarePricingComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api=inject(ApiService);
  private toast=inject(ToastService);
  profiles:any[]=[];flights:any[]=[];templates:any[]=[];editingId='';assignProfileId='';selectedFlightIds:string[]=[];selectedTemplateIds:string[]=[];loading=false;busy=false;private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};profilePage=1;profilePageSize=10;editorOpen=false;assignOpen=false;
  form=this.blank();
  constructor(){this.reload()}
  get activeProfiles(){return this.profiles.filter(p=>p.is_active)}
  get assignProfile(){return this.profiles.find(p=>p._id===this.assignProfileId)}
  get pagedProfiles(){const start=(this.profilePage-1)*this.profilePageSize;return this.profiles.slice(start,start+this.profilePageSize)}
  blank(){return{code:'',name:'',description:'',is_active:true,advance_rules:[
    {min_days:0,max_days:2,adjustment_percent:35,label:'Sát ngày bay',label_en:'Last minute'},
    {min_days:3,max_days:6,adjustment_percent:20,label:'Gần ngày bay',label_en:'Close to departure'},
    {min_days:7,max_days:13,adjustment_percent:10,label:'Gần ngày bay',label_en:'Close to departure'},
    {min_days:14,max_days:29,adjustment_percent:0,label:'Giá chuẩn',label_en:'Standard fare'},
    {min_days:30,max_days:60,adjustment_percent:-8,label:'Mua sớm',label_en:'Early bird'},
    {min_days:61,max_days:null,adjustment_percent:-15,label:'Mua sớm',label_en:'Early bird'}
  ] as AdvanceRule[],load_factor_rules:[
    {min_load_percent:0,max_load_percent:40,adjustment_percent:-10,label:'Tải thấp',label_en:'Low load'},
    {min_load_percent:40,max_load_percent:80,adjustment_percent:0,label:'Tải chuẩn',label_en:'Normal load'},
    {min_load_percent:80,max_load_percent:100,adjustment_percent:10,label:'Tải cao',label_en:'High load'}
  ] as LoadRule[]}}
  async reload(){this.loading=true;this.error='';try{const [p,f,t]=await Promise.all([firstValueFrom(this.api.pricingProfiles()),firstValueFrom(this.api.flights()),firstValueFrom(this.api.commercialTemplates({limit:200}))]);this.profiles=Array.isArray(p)?p:[];this.profilePage=1;this.flights=Array.isArray(f)?f:[];this.templates=Array.isArray(t)?t:(t?.items||[])}catch(e:any){this.error=this.msg(e,'Không tải được dữ liệu pricing.')}finally{this.loading=false}}
  newProfile(){this.editingId='';this.form=this.blank();this.message='';this.error='';this.editorOpen=true}
  edit(p:any){this.editingId=p._id;this.form={code:p.code,name:p.name,description:p.description||'',is_active:!!p.is_active,advance_rules:(p.advance_rules||[]).map((x:any)=>({...x,max_days:x.max_days??null})),load_factor_rules:(p.load_factor_rules||[]).map((x:any)=>({...x}))};this.assignProfileId=p._id;this.message='';this.error='';this.editorOpen=true}
  closeEditor(){if(this.busy)return;this.editorOpen=false}
  openAssign(p:any){this.assignProfileId=p._id;this.selectedFlightIds=[];this.selectedTemplateIds=[];this.error='';this.message='';this.assignOpen=true}
  closeAssign(){if(this.busy)return;this.assignOpen=false}
  addAdvance(){const prev=this.form.advance_rules[this.form.advance_rules.length-1];const min=prev?(prev.max_days===null?Number(prev.min_days)+1:Number(prev.max_days)+1):0;if(prev?.max_days===null)prev.max_days=Number(prev.min_days);this.form.advance_rules.push({min_days:min,max_days:null,adjustment_percent:0,label:'Giá chuẩn',label_en:'Standard fare'})}
  addLoad(){const last=this.form.load_factor_rules.slice().sort((a,b)=>Number(b.max_load_percent)-Number(a.max_load_percent))[0];const start=last?Math.min(99,Number(last.max_load_percent)):0;this.form.load_factor_rules.push({min_load_percent:start,max_load_percent:100,adjustment_percent:0,label:'Tải chuẩn',label_en:'Normal load'})}
  nullableNumber(v:any){return v===''||v===null||v===undefined?null:Number(v)}
  toggleTarget(list:string[],id:string,event:Event){const checked=(event.target as HTMLInputElement).checked;const i=list.indexOf(id);if(checked&&i<0)list.push(id);if(!checked&&i>=0)list.splice(i,1)}
  async save(){this.busy=true;this.error='';this.message='';try{const payload={...this.form,code:this.form.code.trim().toUpperCase(),name:this.form.name.trim(),advance_rules:this.form.advance_rules.map(r=>({...r,min_days:Number(r.min_days),max_days:r.max_days===null?null:Number(r.max_days),adjustment_percent:Number(r.adjustment_percent)})),load_factor_rules:this.form.load_factor_rules.map(r=>({...r,min_load_percent:Number(r.min_load_percent),max_load_percent:Number(r.max_load_percent),adjustment_percent:Number(r.adjustment_percent)}))};if(this.editingId){const {code,...update}=payload;await firstValueFrom(this.api.updatePricingProfile(this.editingId,update));this.message='Đã lưu profile và đồng bộ rule mới cho các chuyến/template đang sử dụng.'}else{const created=await firstValueFrom(this.api.createPricingProfile(payload));this.editingId=created._id;this.assignProfileId=created._id;this.message='Đã tạo pricing profile. Có thể gán cho chuyến hoặc template từ nút Gán.'}this.editorOpen=false;await this.reload()}catch(e:any){this.error=this.msg(e,'Không lưu được pricing profile.')}finally{this.busy=false}}
  async assign(){if(!this.assignProfileId)return;this.busy=true;this.error='';this.message='';try{const r=await firstValueFrom(this.api.assignPricingProfile(this.assignProfileId,{flight_ids:this.selectedFlightIds,template_ids:this.selectedTemplateIds}));const inherited=r.inherited_flights_updated||0;this.message=`Đã áp dụng profile: ${r.flights_updated||0} chuyến chọn trực tiếp, ${r.templates_updated||0} template${inherited?`, ${inherited} chuyến đã sinh từ template`:''}.`;this.selectedFlightIds=[];this.selectedTemplateIds=[];this.assignOpen=false;await this.reload()}catch(e:any){this.error=this.msg(e,'Không áp dụng được pricing profile.')}finally{this.busy=false}}
  async remove(){if(!this.editingId)return;const confirmed=await this.toast.confirm({titleVi:'Xóa pricing profile?',titleEn:'Delete pricing profile?',messageVi:'Pricing profile này sẽ bị xóa khỏi hệ thống.',messageEn:'This pricing profile will be deleted from the system.',confirmVi:'Xóa',confirmEn:'Delete'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deletePricingProfile(this.editingId));this.message='Đã xóa pricing profile.';this.editingId='';this.editorOpen=false;this.form=this.blank();await this.reload()}catch(e:any){this.error=this.msg(e,'Không xóa được profile đang được sử dụng.')}finally{this.busy=false}}

  calc={base:1500000,days:45,load:85,miles:0};calcProfileId='';
  get calcProfile(){return this.profiles.find(p=>p._id===this.calcProfileId)||null}
  quote(profile:any){return explainPricing(this.calc.base,this.calc.days,this.calc.load,this.calc.miles,profile)}
  pct(v:number){const n=Number(v||0);return n===0?'0%':(n>0?'+':'−')+Math.abs(n)+'%'}
  sortedAdvance(rules:any[]){return (rules||[]).slice().sort((a,b)=>Number(b.min_days)-Number(a.min_days))}
  sortedLoad(rules:any[]){return (rules||[]).slice().sort((a,b)=>Number(b.min_load_percent)-Number(a.min_load_percent))}
  advanceText(r:AdvanceRule){const min=Number(r.min_days),max=r.max_days;const range=max===null||max===undefined?`≥ ${min} ngày`:min===Number(max)?`${min} ngày`:`${min}–${max} ngày`;return `${r.label||'Mua trước'} (mua trước ${range}): ${this.pct(r.adjustment_percent)}`}
  loadText(r:LoadRule){return `${r.label||'Lấp đầy'} (lấp đầy ${r.min_load_percent}–${r.max_load_percent}%): ${this.pct(r.adjustment_percent)}`}
  private isNum(v:any){return v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))}
  advanceRowError(r:AdvanceRule):string{if(!this.isNum(r.min_days)||Number(r.min_days)<0)return 'Từ ngày phải là số ≥ 0';if(r.max_days!==null&&Number(r.max_days)<Number(r.min_days))return 'Đến ngày phải ≥ Từ ngày';if(!this.isNum(r.adjustment_percent))return 'Nhập % tăng/giảm';if(Number(r.adjustment_percent)<-100)return 'Không thể giảm quá 100%';if(!String(r.label||'').trim()||!String(r.label_en||'').trim())return 'Nhập đủ tên VI và EN';return ''}
  loadRowError(r:LoadRule):string{const a=Number(r.min_load_percent),b=Number(r.max_load_percent);if(!this.isNum(r.min_load_percent)||!this.isNum(r.max_load_percent))return 'Nhập đủ khoảng %';if(a<0||b>100)return 'Khoảng % phải nằm trong 0–100';if(b<=a)return 'Đến % phải lớn hơn Từ %';if(!this.isNum(r.adjustment_percent))return 'Nhập % tăng/giảm';if(Number(r.adjustment_percent)<-100)return 'Không thể giảm quá 100%';if(!String(r.label||'').trim()||!String(r.label_en||'').trim())return 'Nhập đủ tên VI và EN';return ''}
  get validationErrors():string[]{
    const e:string[]=[];const f=this.form;
    if(!f.code.trim())e.push('Chưa nhập mã cấu hình.');if(!f.name.trim())e.push('Chưa nhập tên cấu hình.');
    f.advance_rules.forEach((r,i)=>{const m=this.advanceRowError(r);if(m)e.push(`Mốc ngày #${i+1}: ${m}.`)});
    f.load_factor_rules.forEach((r,i)=>{const m=this.loadRowError(r);if(m)e.push(`Mốc lấp đầy #${i+1}: ${m}.`)});
    const adv=f.advance_rules.slice().sort((a,b)=>Number(a.min_days)-Number(b.min_days));
    for(let i=1;i<adv.length;i++){const p=adv[i-1];if(p.max_days===null||Number(adv[i].min_days)<=Number(p.max_days))e.push(`Mốc ngày bị chồng nhau: “${this.advanceText(p)}” và “${this.advanceText(adv[i])}”.`)}
    const ld=f.load_factor_rules.slice().sort((a,b)=>Number(a.min_load_percent)-Number(b.min_load_percent));
    for(let i=1;i<ld.length;i++){if(Number(ld[i].min_load_percent)<Number(ld[i-1].max_load_percent))e.push(`Mốc lấp đầy bị chồng nhau: ${ld[i-1].min_load_percent}–${ld[i-1].max_load_percent}% và ${ld[i].min_load_percent}–${ld[i].max_load_percent}%.`)}
    return e;
  }
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Math.round(Number(v||0)))}
  profileCode(x:any){return x?.pricing_profile_snapshot?.name||x?.pricing_profile_snapshot?.code||'Chưa gán hồ sơ (dùng mặc định)'}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||e?.message||f}
}
