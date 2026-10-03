import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';

type AdvanceRule={min_days:number;max_days:number|null;adjustment_percent:number;label:string;label_en:string};
type LoadRule={min_load_percent:number;max_load_percent:number;adjustment_percent:number;label:string;label_en:string};

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
  <div class="eyebrow">QUẢN TRỊ DOANH THU</div>
  <div class="section-head"><div><h1 class="title">Hồ sơ giá vé</h1><p class="subtitle">Tạo chính sách giá một lần, lưu vào hệ thống và tái sử dụng cho nhiều chuyến bay hoặc commercial template.</p></div><button class="btn btn-primary" (click)="newProfile()">Tạo cấu hình mới</button></div>
  @if(error){<div class="notice error-box">{{error}}</div>}@if(message){<div class="notice success-box">{{message}}</div>}

  <div class="card table-wrap profile-table">
    <table class="table">
      <thead><tr><th>Profile</th><th>Mua sớm</th><th>Lấp đầy</th><th>Đang dùng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody>
        @for(p of pagedProfiles;track p._id){<tr>
          <td><strong>{{p.code}}</strong><small>{{p.name}}</small><small>{{p.description||'Không có mô tả'}}</small></td>
          <td>{{p.advance_rules?.length||0}} mốc</td><td>{{p.load_factor_rules?.length||0}} mốc</td>
          <td>{{p.assigned_flights||0}} chuyến<small>{{p.assigned_templates||0}} template</small></td>
          <td><span class="pill" [class.pill-success]="p.is_active" [class.pill-danger]="!p.is_active">{{p.is_active?'ACTIVE':'INACTIVE'}}</span></td>
          <td><div class="row-actions"><button class="btn btn-outline small" (click)="edit(p)">Chi tiết / Sửa</button><button class="btn btn-dark small" (click)="openAssign(p)" [disabled]="!p.is_active">Gán</button></div></td>
        </tr>}
        @if(!profiles.length&&!loading){<tr><td colspan="6"><div class="empty">Chưa có pricing profile. Hãy tạo cấu hình đầu tiên.</div></td></tr>}
      </tbody>
    </table>
  </div>
  <app-pagination [total]="profiles.length" [(page)]="profilePage" [(pageSize)]="profilePageSize" [pageSizeOptions]="[5,10,20,50]" />

  @if(editorOpen){
    <div class="modal" (click)="closeEditor()">
    <div class="card editor" (click)="$event.stopPropagation()">
      <button class="close" (click)="closeEditor()">×</button>
      <div class="editor-head">
        <div><span>{{editingId?'CHỈNH SỬA PROFILE':'PROFILE MỚI'}}</span><h2>{{form.name||'Chính sách giá mới'}}</h2></div>
        <div class="editor-actions">
          @if(editingId){<button class="btn btn-outline danger" (click)="remove()" [disabled]="busy">Xóa</button>}
          <button class="btn btn-primary" [disabled]="busy" (click)="save()">{{busy?'Đang lưu…':editingId?'Lưu thay đổi':'Lưu cấu hình'}}</button>
        </div>
      </div>
      <div class="grid grid-2">
        <label class="field"><span>Mã cấu hình</span><input class="control" [(ngModel)]="form.code" [disabled]="!!editingId" placeholder="STANDARD_2026"></label>
        <label class="field"><span>Tên cấu hình</span><input class="control" [(ngModel)]="form.name" placeholder="Giá tiêu chuẩn 2026"></label>
      </div>
      <label class="field"><span>Mô tả</span><input class="control" [(ngModel)]="form.description" placeholder="Áp dụng cho các chuyến nội địa tiêu chuẩn"></label>
      <label class="toggle"><input type="checkbox" [(ngModel)]="form.is_active"> Cho phép gán profile này cho chuyến bay</label>

      <div class="rules-head"><div><h3>1. Giá theo thời điểm mua vé</h3><p>Đáp ứng 1.2.4.3. Phần trăm âm là giảm giá, phần trăm dương là tăng giá.</p></div><button class="btn btn-outline small" (click)="addAdvance()">Thêm mốc</button></div>
      <div class="table-wrap"><table class="table rules"><thead><tr><th>Từ ngày</th><th>Đến ngày</th><th>Điều chỉnh</th><th>Nhãn VI</th><th>Nhãn EN</th><th></th></tr></thead><tbody>
        @for(r of form.advance_rules;track $index;let i=$index){<tr>
          <td><input class="mini" type="number" min="0" [(ngModel)]="r.min_days"></td>
          <td><input class="mini" type="number" min="0" [ngModel]="r.max_days" (ngModelChange)="r.max_days=nullableNumber($event)" placeholder="∞"></td>
          <td><input class="mini" type="number" [(ngModel)]="r.adjustment_percent">%</td>
          <td><input class="text-mini" [(ngModel)]="r.label"></td><td><input class="text-mini" [(ngModel)]="r.label_en"></td>
          <td><button class="icon-btn" (click)="form.advance_rules.splice(i,1)">×</button></td>
        </tr>}</tbody></table></div>

      <div class="rules-head"><div><h3>2. Giá theo hệ số lấp đầy</h3><p>Đáp ứng 1.2.4.2. Ví dụ tải thấp giảm giá để lấp ghế; tải cao có thể tăng giá để tối ưu doanh thu.</p></div><button class="btn btn-outline small" (click)="addLoad()">Thêm mốc</button></div>
      <div class="table-wrap"><table class="table rules"><thead><tr><th>Từ %</th><th>Đến %</th><th>Điều chỉnh</th><th>Nhãn VI</th><th>Nhãn EN</th><th></th></tr></thead><tbody>
        @for(r of form.load_factor_rules;track $index;let i=$index){<tr>
          <td><input class="mini" type="number" min="0" max="100" step="0.01" [(ngModel)]="r.min_load_percent"></td>
          <td><input class="mini" type="number" min="0" max="100" step="0.01" [(ngModel)]="r.max_load_percent"></td>
          <td><input class="mini" type="number" [(ngModel)]="r.adjustment_percent">%</td>
          <td><input class="text-mini" [(ngModel)]="r.label"></td><td><input class="text-mini" [(ngModel)]="r.label_en"></td>
          <td><button class="icon-btn" (click)="form.load_factor_rules.splice(i,1)">×</button></td>
        </tr>}</tbody></table></div>
      <div class="actions"><button class="btn btn-primary" [disabled]="busy" (click)="save()">{{busy?'Đang lưu…':editingId?'Lưu & cập nhật chuyến đang dùng':'Lưu cấu hình'}}</button></div>
    </div>
    </div>
  }

  @if(assignOpen){
  <div class="modal" (click)="closeAssign()">
  <section class="card assign" (click)="$event.stopPropagation()">
    <button class="close" (click)="closeAssign()">×</button>
    <div class="section-head assign-head"><div><h2>Áp dụng profile cho chuyến bay</h2><p class="subtitle">Một profile có thể dùng lại cho nhiều chuyến. Template được gán profile sẽ truyền cấu hình đó cho các chuyến được sinh mới.</p></div></div>
    <div class="grid grid-3">
      <label class="field"><span>Pricing profile</span><select class="control" [(ngModel)]="assignProfileId"><option value="">Chọn profile</option>@for(p of activeProfiles;track p._id){<option [value]="p._id">{{p.code}} · {{p.name}}</option>}</select></label>
      <label class="field"><span>Chuyến bay cụ thể</span><select class="control multi" multiple [(ngModel)]="selectedFlightIds">@for(f of flights;track f._id){<option [value]="f._id">{{f.flight_number}} · {{f.departure_date}} · {{f.origin_iata}}→{{f.dest_iata}} · {{profileCode(f)}}</option>}</select></label>
      <label class="field"><span>Commercial template</span><select class="control multi" multiple [(ngModel)]="selectedTemplateIds">@for(t of templates;track t._id){<option [value]="t._id">{{t.flight_number}} · {{t.origin_iata}}→{{t.dest_iata}} · {{profileCode(t)}}</option>}</select></label>
    </div>
    <div class="assign-actions"><small>Giữ Cmd/Ctrl để chọn nhiều mục.</small><button class="btn btn-dark" [disabled]="busy||!assignProfileId||(!selectedFlightIds.length&&!selectedTemplateIds.length)" (click)="assign()">Áp dụng cấu hình đã chọn</button></div>
  </section>
  </div>
  }
  `,
  styles:[`
    .notice{padding:12px 14px;border-radius:12px;margin:12px 0}.error-box{background:#fff0f0;color:#a62f2f}.success-box{background:#edf8f2;color:#237050}.profile-table{margin:18px 0}.profile-table td small{display:block;color:#7b8a98;margin-top:4px}.row-actions{display:flex;gap:7px;flex-wrap:wrap}.empty{padding:18px;text-align:center;color:#728293}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}.editor{width:min(1050px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.editor-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.editor-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.editor-head span{font-size:9px;letter-spacing:.12em;color:#a57916;font-weight:900}.editor-head h2{margin:4px 0 18px;color:#0a2540}.close{position:absolute;right:14px;top:9px;border:0;background:transparent;font-size:28px}.field{margin-bottom:12px}.toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#465b6d;margin:8px 0 24px}.rules-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin:24px 0 10px}.rules-head h3{margin:0;color:#0a2540}.rules-head p{margin:5px 0 0;font-size:11px;color:#6f7f8f}.small{padding:8px 12px;font-size:10px}.rules{min-width:790px}.rules th,.rules td{padding:8px}.mini,.text-mini{border:1px solid #d8e1e8;border-radius:8px;padding:8px;width:86px}.text-mini{width:135px}.icon-btn{border:0;background:#f7eaea;color:#a12c2c;width:29px;height:29px;border-radius:50%;font-size:18px}.actions{display:flex;justify-content:flex-end;margin-top:20px}.danger{color:#9d2e2e}.assign{width:min(900px,100%);max-height:90vh;overflow:auto;padding:24px;position:relative}.assign-head{margin-top:0}.multi{min-height:145px;padding:6px}.assign-actions{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-top:8px}.assign-actions small{color:#728293}@media(max-width:760px){.grid-3{grid-template-columns:1fr}.editor-head{flex-direction:column}.editor-actions{width:100%}.editor-actions .btn{flex:1}.assign-actions{align-items:stretch;flex-direction:column}}
  `]
})
export class FarePricingComponent{
  private api=inject(ApiService);
  private toast=inject(ToastService);
  profiles:any[]=[];flights:any[]=[];templates:any[]=[];editingId='';assignProfileId='';selectedFlightIds:string[]=[];selectedTemplateIds:string[]=[];loading=false;busy=false;message='';error='';profilePage=1;profilePageSize=10;editorOpen=false;assignOpen=false;
  form=this.blank();
  constructor(){this.reload()}
  get activeProfiles(){return this.profiles.filter(p=>p.is_active)}
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
  addLoad(){this.form.load_factor_rules.push({min_load_percent:0,max_load_percent:100,adjustment_percent:0,label:'Tải chuẩn',label_en:'Normal load'})}
  nullableNumber(v:any){return v===''||v===null||v===undefined?null:Number(v)}
  async save(){this.busy=true;this.error='';this.message='';try{const payload={...this.form,code:this.form.code.trim().toUpperCase(),name:this.form.name.trim(),advance_rules:this.form.advance_rules.map(r=>({...r,min_days:Number(r.min_days),max_days:r.max_days===null?null:Number(r.max_days),adjustment_percent:Number(r.adjustment_percent)})),load_factor_rules:this.form.load_factor_rules.map(r=>({...r,min_load_percent:Number(r.min_load_percent),max_load_percent:Number(r.max_load_percent),adjustment_percent:Number(r.adjustment_percent)}))};if(this.editingId){const {code,...update}=payload;await firstValueFrom(this.api.updatePricingProfile(this.editingId,update));this.message='Đã lưu profile và đồng bộ rule mới cho các chuyến/template đang sử dụng.'}else{const created=await firstValueFrom(this.api.createPricingProfile(payload));this.editingId=created._id;this.assignProfileId=created._id;this.message='Đã tạo pricing profile. Có thể gán cho chuyến hoặc template từ nút Gán.'}this.editorOpen=false;await this.reload()}catch(e:any){this.error=this.msg(e,'Không lưu được pricing profile.')}finally{this.busy=false}}
  async assign(){if(!this.assignProfileId)return;this.busy=true;this.error='';this.message='';try{const r=await firstValueFrom(this.api.assignPricingProfile(this.assignProfileId,{flight_ids:this.selectedFlightIds,template_ids:this.selectedTemplateIds}));const inherited=r.inherited_flights_updated||0;this.message=`Đã áp dụng profile: ${r.flights_updated||0} chuyến chọn trực tiếp, ${r.templates_updated||0} template${inherited?`, ${inherited} chuyến đã sinh từ template`:''}.`;this.selectedFlightIds=[];this.selectedTemplateIds=[];this.assignOpen=false;await this.reload()}catch(e:any){this.error=this.msg(e,'Không áp dụng được pricing profile.')}finally{this.busy=false}}
  async remove(){if(!this.editingId)return;const confirmed=await this.toast.confirm({titleVi:'Xóa pricing profile?',titleEn:'Delete pricing profile?',messageVi:'Pricing profile này sẽ bị xóa khỏi hệ thống.',messageEn:'This pricing profile will be deleted from the system.',confirmVi:'Xóa',confirmEn:'Delete'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deletePricingProfile(this.editingId));this.message='Đã xóa pricing profile.';this.editingId='';this.editorOpen=false;this.form=this.blank();await this.reload()}catch(e:any){this.error=this.msg(e,'Không xóa được profile đang được sử dụng.')}finally{this.busy=false}}
  profileCode(x:any){return x?.pricing_profile_snapshot?.code||'Chưa gán profile'}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||e?.message||f}
}
