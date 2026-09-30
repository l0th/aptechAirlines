import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
    <div class="eyebrow">QUY TẮC HOÀN TIỀN</div>
    <div class="section-head">
      <div><h1 class="title">Chính sách hủy vé</h1><p class="subtitle">Quy tắc hoàn tiền theo số ngày trước giờ bay.</p></div>
      <button class="btn btn-outline" (click)="load()">Làm mới</button>
    </div>

    <section class="card form">
      <div class="field"><span>Từ ngày</span><input class="control" type="number" min="0" [(ngModel)]="form.min_days_before"></div>
      <div class="field"><span>Đến ngày</span><input class="control" type="number" min="0" [(ngModel)]="form.max_days_before" placeholder="Bỏ trống = ∞"></div>
      <div class="field"><span>Hoàn tiền %</span><input class="control" type="number" min="0" max="100" [(ngModel)]="form.refund_percentage"></div>
      <div class="field wide"><span>Mô tả tiếng Việt</span><input class="control" [(ngModel)]="form.description"></div>
      <div class="field wide"><span>Mô tả tiếng Anh</span><input class="control" [(ngModel)]="form.description_en"></div>
      <button class="btn btn-primary" (click)="save()" [disabled]="busy">{{editing?'Lưu sửa':'Tạo chính sách'}}</button>
      @if(editing){<button class="btn btn-outline" (click)="reset()">Hủy sửa</button>}
    </section>

    @if(error){<p class="error notice">{{error}}</p>}
    @if(message){<p class="success notice">{{message}}</p>}

    <div class="grid grid-2 policies">
      @for(p of rows;track p._id){
        <article class="card policy">
          <div class="policy-top">
            <span class="pill pill-gold">Hoàn {{p.refund_percentage}}%</span>
            <div class="actions"><button class="btn btn-outline" (click)="edit(p)">Sửa</button><button class="btn btn-outline danger" (click)="remove(p)">Xóa</button></div>
          </div>
          <h3>{{p.min_days_before}} – {{p.max_days_before??'∞'}} ngày trước bay</h3>
          <p>{{lang.isVietnamese()?p.description:(p.description_en||p.description)}}</p>
        </article>
      }
    </div>
  `,
  styles:[`
    .form{padding:18px;display:grid;grid-template-columns:130px 130px 140px 1fr 1fr auto auto;gap:10px;align-items:end;margin:18px 0}.wide{min-width:180px}.notice{padding:10px 13px;border-radius:12px;background:#fff}.policies{margin-top:18px}.policy{padding:20px}.policy-top{display:flex;justify-content:space-between;gap:12px;align-items:center}.policy h3{color:#071b2e;margin:16px 0 8px}.policy p{color:#68778a;line-height:1.6;margin:0}.policy small{display:block;color:#8a98a5;margin-top:8px}.actions{display:flex;gap:7px}.danger{color:#9b3030;border-color:#e4c0c0}.btn:disabled{opacity:.5}@media(max-width:1150px){.form{grid-template-columns:repeat(3,1fr)}}@media(max-width:700px){.form{grid-template-columns:1fr}.policy-top{align-items:flex-start;flex-direction:column}}
  `]
})
export class PoliciesComponent{
  api=inject(ApiService);
  lang=inject(LanguageService);
  rows:any[]=[]; editing:any=null; busy=false; error=''; message='';
  form:any=this.blank();
  constructor(){this.load()}
  blank(){return{min_days_before:0,max_days_before:null,refund_percentage:0,description:'',description_en:''}}
  load(){this.api.policies().subscribe({next:r=>this.rows=r,error:e=>this.error=this.msg(e,'Không tải được policies.')})}
  edit(p:any){this.editing=p;this.form={min_days_before:p.min_days_before,max_days_before:p.max_days_before??null,refund_percentage:p.refund_percentage,description:p.description||'',description_en:p.description_en||''}}
  reset(){this.editing=null;this.form=this.blank()}
  save(){
    this.error='';this.message='';
    if(!this.form.description.trim()){this.error='Mô tả policy là bắt buộc.';return}
    const body:any={min_days_before:Number(this.form.min_days_before),refund_percentage:Number(this.form.refund_percentage),description:this.form.description.trim(),description_en:this.form.description_en?.trim()||undefined};
    if(this.form.max_days_before!==null&&this.form.max_days_before!==''&&this.form.max_days_before!==undefined)body.max_days_before=Number(this.form.max_days_before);
    this.busy=true;
    const req=this.editing?this.api.updatePolicy(this.editing._id,body):this.api.createPolicy(body);
    req.subscribe({next:()=>{this.busy=false;this.message=this.editing?'Đã cập nhật policy.':'Đã tạo policy.';this.reset();this.load()},error:e=>{this.busy=false;this.error=this.msg(e,'Không lưu được policy.')}})
  }
  remove(p:any){if(!confirm('Xóa cancellation policy này?'))return;this.api.deletePolicy(p._id).subscribe({next:()=>{this.message='Đã xóa policy.';this.load()},error:e=>this.error=this.msg(e,'Không xóa được policy.')})}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
