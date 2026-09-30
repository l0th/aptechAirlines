import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
    <div class="eyebrow">DOANH THU GHẾ</div>
    <div class="section-head">
      <div>
        <h1 class="title">Quy tắc giá ghế</h1>
        <p class="subtitle">Phụ phí ghế theo hạng và thuộc tính vật lý. Ghế tự động luôn 0 ₫ theo máy chủ.</p>
      </div>
      <button class="btn btn-outline" (click)="load()">Làm mới</button>
    </div>

    <section class="card form">
      <div class="field"><span>Mã quy tắc</span><input class="control" [(ngModel)]="rule.rule_id" placeholder="ECON-WINDOW-CUSTOM"></div>
      <div class="field"><span>Hạng ghế</span><select class="control" [(ngModel)]="rule.cabin_class"><option>ALL</option><option>ECONOMY</option><option>CLUB</option><option>BUSINESS</option><option>FIRST</option></select></div>
      <div class="field"><span>Thuộc tính giá</span><select class="control" [(ngModel)]="rule.pricing_dimension">@for(d of dimensions;track d){<option [value]="d">{{d}}</option>}</select></div>
      <div class="field"><span>Phụ phí VND</span><input class="control" type="number" min="0" step="10000" [(ngModel)]="rule.amount"></div>
      <div class="field"><span>Độ ưu tiên</span><input class="control" type="number" [(ngModel)]="rule.priority"></div>
      <button class="btn btn-primary" (click)="create()" [disabled]="busy">Tạo quy tắc</button>
    </section>

    @if(error){<p class="error notice">{{error}}</p>}
    @if(message){<p class="success notice">{{message}}</p>}

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>Mã quy tắc</th><th>Hạng ghế</th><th>Thuộc tính giá</th><th>Số tiền</th><th>Độ ưu tiên</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          @for(r of rows;track r._id||r.rule_id){
            <tr>
              <td><strong>{{r.rule_id}}</strong><small>v{{r.version||1}}</small></td>
              <td>{{r.cabin_class}}</td>
              <td>{{r.pricing_dimension}}</td>
              <td>{{money(r.amount)}}</td>
              <td>{{r.priority}}</td>
              <td><span class="pill" [class.pill-success]="r.is_active" [class.pill-danger]="!r.is_active">{{r.is_active?'ACTIVE':'INACTIVE'}}</span></td>
              <td>
                @if(r.is_active){
                  <div class="row-actions">
                    <button class="btn btn-outline" (click)="edit(r)">Sửa</button>
                    <button class="btn btn-outline" (click)="remove(r.rule_id)">Tắt</button>
                  </div>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if(editing){
      <div class="modal">
        <section class="card edit-card">
          <button class="close" (click)="editing=null">×</button>
          <div class="eyebrow">PHIÊN BẢN BẤT BIẾN MỚI</div>
          <h2>{{editing.rule_id}}</h2>
          <p class="muted">Máy chủ sẽ tắt phiên bản hiện tại và tạo phiên bản mới có lịch sử kiểm toán.</p>
          <div class="grid grid-2">
            <div class="field"><span>Số tiền</span><input class="control" type="number" min="0" [(ngModel)]="editForm.amount"></div>
            <div class="field"><span>Độ ưu tiên</span><input class="control" type="number" [(ngModel)]="editForm.priority"></div>
          </div>
          <button class="btn btn-primary save" (click)="saveEdit()" [disabled]="busy">Lưu phiên bản mới</button>
        </section>
      </div>
    }
  `,
  styles:[`
    .form{padding:18px;display:grid;grid-template-columns:1.35fr 1fr 1.25fr .8fr .65fr auto;gap:12px;align-items:end;margin:18px 0}.notice{padding:11px 14px;border-radius:12px;background:#fff}.table td small{display:block;color:#7d8b99;margin-top:3px}.row-actions{display:flex;gap:7px}.modal{position:fixed;inset:0;background:rgba(3,17,30,.55);display:grid;place-items:center;padding:20px;z-index:90}.edit-card{width:min(560px,100%);padding:24px;position:relative}.edit-card h2{color:#071b2e}.close{position:absolute;right:14px;top:10px;border:0;background:transparent;font-size:28px}.save{width:100%;margin-top:18px}.btn:disabled{opacity:.5}@media(max-width:1100px){.form{grid-template-columns:repeat(3,1fr)}}@media(max-width:700px){.form{grid-template-columns:1fr}.row-actions{flex-direction:column}}
  `]
})
export class SeatPricingComponent{
  api=inject(ApiService);
  rows:any[]=[]; error=''; message=''; busy=false; editing:any=null;
  dimensions=['CABIN_BASE','WINDOW','AISLE','MIDDLE','FRONT_ZONE','EXIT_ROW','EXTRA_LEGROOM','BULKHEAD'];
  rule:any=this.blank();
  editForm:any={amount:0,priority:0};

  constructor(){this.load()}
  blank(){return{rule_id:'',cabin_class:'ALL',pricing_dimension:'CABIN_BASE',amount:0,priority:0}}
  load(){this.error='';this.api.getSeatPricingRules().subscribe({next:r=>this.rows=r,error:e=>this.error=this.msg(e,'Không tải được seat pricing.')})}
  create(){
    this.error='';this.message='';
    if(!this.rule.rule_id.trim()){this.error='Mã quy tắc là bắt buộc.';return}
    this.busy=true;
    this.api.createSeatPricingRule({...this.rule,rule_id:this.rule.rule_id.trim().toUpperCase(),amount:Number(this.rule.amount),priority:Number(this.rule.priority)}).subscribe({
      next:()=>{this.busy=false;this.message='Đã tạo seat pricing rule.';this.rule=this.blank();this.load()},
      error:e=>{this.busy=false;this.error=this.msg(e,'Không tạo được rule.')}
    })
  }
  edit(r:any){this.editing=r;this.editForm={amount:Number(r.amount||0),priority:Number(r.priority||0)}}
  saveEdit(){
    if(!this.editing)return;
    this.busy=true;this.error='';this.message='';
    this.api.updateSeatPricingRule(this.editing.rule_id,{amount:Number(this.editForm.amount),priority:Number(this.editForm.priority)}).subscribe({
      next:r=>{this.busy=false;this.message=`Đã tạo version mới ${r.rule_id||''}.`;this.editing=null;this.load()},
      error:e=>{this.busy=false;this.error=this.msg(e,'Không cập nhật được rule.')}
    })
  }
  remove(id:string){
    if(!confirm(`Deactivate rule ${id}?`))return;
    this.api.deleteSeatPricingRule(id).subscribe({next:()=>{this.message='Đã deactivate rule.';this.load()},error:e=>this.error=this.msg(e,'Không deactivate được rule.')})
  }
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0)}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
