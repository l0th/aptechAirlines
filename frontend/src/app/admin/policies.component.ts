import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
    <div class="eyebrow">QUY TẮC HOÀN TIỀN</div>
    <div class="section-head">
      <div>
        <h1 class="title">Chính sách hủy vé</h1>
        <p class="subtitle">Thiết lập mức hoàn tiền theo số ngày còn lại trước giờ khởi hành.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-outline" (click)="load()">Làm mới</button>
        <button class="btn btn-primary" (click)="createNew()">Tạo chính sách</button>
      </div>
    </div>

    
    

    <section class="card table-card">
      <div class="table-wrap">
        <table class="table policy-table">
          <thead>
            <tr>
              <th>Khoảng ngày trước bay</th>
              <th>Từ ngày</th>
              <th>Đến ngày</th>
              <th>Hoàn tiền</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for(p of paged;track p._id){
              <tr>
                <td><strong>{{rangeLabel(p)}}</strong></td>
                <td>{{p.min_days_before}}</td>
                <td>{{p.max_days_before ?? '∞'}}</td>
                <td><span class="pill pill-gold">{{p.refund_percentage}}%</span></td>
                <td class="row-action"><button class="btn btn-outline compact" (click)="openDetail(p)">Chi tiết</button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty-row">Chưa có chính sách hủy vé.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
    <app-pagination [total]="rows.length" [(page)]="page" [(pageSize)]="pageSize" />

    @if(detailOpen){
      <div class="modal" (click)="closeDetail()">
        <section class="card detail-card" (click)="$event.stopPropagation()">
          <button class="close" type="button" aria-label="Đóng" (click)="closeDetail()">×</button>
          <div class="eyebrow">{{editing ? 'CHI TIẾT CHÍNH SÁCH' : 'CHÍNH SÁCH MỚI'}}</div>
          <h2>{{editing ? rangeLabel(editing) : 'Tạo chính sách hủy vé'}}</h2>
          <p class="modal-subtitle">Chỉ cần nhập khoảng ngày và tỷ lệ hoàn tiền.</p>

          <div class="form-grid">
            <label class="field">
              <span>Từ ngày</span>
              <input class="control" type="number" min="0" step="1" [(ngModel)]="form.min_days_before">
            </label>
            <label class="field">
              <span>Đến ngày</span>
              <input class="control" type="number" min="0" step="1" [(ngModel)]="form.max_days_before" placeholder="Bỏ trống = ∞">
            </label>
            <label class="field full">
              <span>Hoàn tiền %</span>
              <input class="control" type="number" min="0" max="100" step="1" [(ngModel)]="form.refund_percentage">
            </label>
          </div>

          <div class="modal-actions">
            @if(editing){<button class="btn btn-outline danger" type="button" (click)="requestRemove(editing)" [disabled]="busy">Xóa chính sách</button>}
            <span class="action-spacer"></span>
            <button class="btn btn-outline" type="button" (click)="closeDetail()" [disabled]="busy">Đóng</button>
            <button class="btn btn-primary" type="button" (click)="save()" [disabled]="busy">{{busy ? 'Đang lưu...' : (editing ? 'Lưu thay đổi' : 'Tạo chính sách')}}</button>
          </div>
        </section>
      </div>
    }
  `,
  styles:[`
    .head-actions{display:flex;gap:9px;flex-wrap:wrap}.notice{padding:10px 13px;border-radius:12px;background:#fff}.table-card{overflow:hidden;margin-top:18px}.policy-table{min-width:680px}.policy-table td{vertical-align:middle}.policy-table td strong{color:#0a2540;font-size:14px}.row-action{text-align:right!important}.compact{padding:8px 14px;font-size:12px}.empty-row{text-align:center!important;color:#758596;padding:34px!important}.modal{position:fixed;inset:0;background:rgba(4,18,31,.58);display:grid;place-items:center;padding:20px;z-index:100}.detail-card{width:min(620px,100%);padding:26px;position:relative}.detail-card h2{margin:7px 44px 5px 0;color:#071b2e;font-size:25px}.modal-subtitle{margin:0 0 22px;color:#718093;font-size:13px}.close{position:absolute;right:16px;top:12px;border:0;background:transparent;color:#506176;font-size:28px;line-height:1}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field.full{grid-column:1/-1}.modal-actions{display:flex;gap:9px;align-items:center;margin-top:24px}.action-spacer{flex:1}.danger{color:#9b3030;border-color:#e4c0c0}.btn:disabled{opacity:.5;cursor:not-allowed}.toast-wrap{position:fixed;top:22px;right:22px;z-index:220;width:min(390px,calc(100vw - 32px))}.toast-card{display:flex;align-items:flex-start;gap:14px;padding:16px;border:1px solid #ecd9a8;border-radius:16px;background:#fff;box-shadow:0 18px 55px rgba(4,18,31,.22)}.toast-copy{display:flex;flex:1;flex-direction:column;gap:4px}.toast-copy strong{color:#071b2e;font-size:14px}.toast-copy span{color:#627184;font-size:12px;line-height:1.45}.toast-actions{display:flex;gap:7px;align-self:center}.toast-btn,.toast-close{border:0;background:#eef2f5;color:#24384d;font-weight:800;cursor:pointer}.toast-btn{padding:8px 11px;border-radius:10px;font-size:12px}.danger-fill{background:#b43a3a;color:#fff}.toast-close{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;font-size:18px}.toast-success{border-color:#bcdcc7}.toast-error{border-color:#e4bcbc}.toast-error .toast-copy strong{color:#9b3030}@media(max-width:700px){.section-head{align-items:flex-start}.head-actions{width:100%}.head-actions .btn{flex:1}.form-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.modal-actions{align-items:stretch;flex-direction:column}.action-spacer{display:none}.modal-actions .btn{width:100%}.toast-wrap{top:12px;right:12px;width:calc(100vw - 24px)}.toast-card{flex-wrap:wrap}.toast-actions{width:100%;justify-content:flex-end}}
  `]
})
export class PoliciesComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  api=inject(ApiService);
  toast=inject(ToastService);
  rows:any[]=[]; editing:any=null; detailOpen=false; busy=false; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)}; private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};page=1;pageSize=20;
  form:any=this.blank();
  constructor(){this.load()}
  get paged(){const start=(this.page-1)*this.pageSize;return this.rows.slice(start,start+this.pageSize)}
  blank(){return{min_days_before:0,max_days_before:null,refund_percentage:0}}
  load(){this.api.policies().subscribe({next:r=>{this.rows=r;this.page=1},error:e=>this.error=this.msg(e,'Không tải được policies.')})}
  createNew(){this.error='';this.message='';this.editing=null;this.form=this.blank();this.detailOpen=true}
  openDetail(p:any){this.error='';this.message='';this.editing=p;this.form={min_days_before:p.min_days_before,max_days_before:p.max_days_before??null,refund_percentage:p.refund_percentage};this.detailOpen=true}
  closeDetail(){if(this.busy)return;this.detailOpen=false;this.editing=null;this.form=this.blank()}
  async requestRemove(p:any){
    if(this.busy)return;
    const confirmed=await this.toast.confirm({
      titleVi:'Xóa chính sách?',
      titleEn:'Delete policy?',
      messageVi:'Bạn có chắc muốn xóa chính sách hủy vé này?',
      messageEn:'Are you sure you want to delete this cancellation policy?',
      confirmVi:'Xóa',
      confirmEn:'Delete',
    });
    if(!confirmed)return;
    this.busy=true;
    this.api.deletePolicy(p._id).subscribe({
      next:()=>{
        this.busy=false;
        this.detailOpen=false;
        this.editing=null;
        this.form=this.blank();
        this.toast.success({
          titleVi:'Đã xóa chính sách.',
          titleEn:'Policy deleted.',
          messageVi:'Chính sách hủy vé đã được xóa khỏi hệ thống.',
          messageEn:'The cancellation policy has been removed from the system.',
        });
        this.load();
      },
      error:e=>{
        this.busy=false;
        const detail=this.msg(e,'Vui lòng thử lại.');
        this.toast.error({
          titleVi:'Không xóa được chính sách.',
          titleEn:'Unable to delete policy.',
          messageVi:detail,
          messageEn:detail,
        });
      }
    });
  }
  save(){
    this.error='';this.message='';
    const minDays=Number(this.form.min_days_before);
    const refundPercentage=Number(this.form.refund_percentage);
    const rawMax=this.form.max_days_before;
    const maxDays=rawMax===null||rawMax===''||rawMax===undefined?null:Number(rawMax);
    if(!Number.isInteger(minDays)||minDays<0){this.error='Từ ngày phải là số nguyên từ 0 trở lên.';return}
    if(maxDays!==null&&(!Number.isInteger(maxDays)||maxDays<minDays)){this.error='Đến ngày phải để trống hoặc là số nguyên lớn hơn hay bằng Từ ngày.';return}
    if(!Number.isFinite(refundPercentage)||refundPercentage<0||refundPercentage>100){this.error='Hoàn tiền phải nằm trong khoảng 0% đến 100%.';return}
    const body:any={min_days_before:minDays,max_days_before:maxDays,refund_percentage:refundPercentage};
    const wasEditing=!!this.editing;
    this.busy=true;
    const req=this.editing?this.api.updatePolicy(this.editing._id,body):this.api.createPolicy(body);
    req.subscribe({next:()=>{this.busy=false;this.detailOpen=false;this.editing=null;this.form=this.blank();this.message=wasEditing?'Đã cập nhật chính sách.':'Đã tạo chính sách.';this.load()},error:e=>{this.busy=false;this.error=this.msg(e,'Không lưu được chính sách.')}})
  }
  rangeLabel(p:any){return `${p.min_days_before} – ${p.max_days_before??'∞'} ngày trước bay`}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
