import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { AuthService } from '../core/auth.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
    <div class="eyebrow">{{t('QUẢN TRỊ','ADMINISTRATION')}}</div>
    <div class="page-head">
      <div><h1 class="title">{{t('Quản lý nhân viên','Staff management')}}</h1><p class="subtitle">{{t('Quản lý tài khoản CLERK và ADMIN dùng cho cổng nhân viên.','Manage CLERK and ADMIN accounts for the staff portal.')}}</p></div>
      <button class="btn btn-primary" (click)="openCreate()">{{t('+ Thêm nhân viên','+ Add staff')}}</button>
    </div>

    <div class="stats">
      <div class="card"><span>{{t('Tổng nhân viên','Total staff')}}</span><strong>{{staff.length}}</strong></div>
      <div class="card"><span>CLERK</span><strong>{{count('CLERK')}}</strong></div>
      <div class="card"><span>ADMIN</span><strong>{{count('ADMIN')}}</strong></div>
      <div class="card"><span>SUPER ADMIN</span><strong>{{count('SUPER_ADMIN')}}</strong></div>
    </div>

    <section class="card toolbar">
      <input class="control" [(ngModel)]="query" [placeholder]="t('Tên, username, email, điện thoại','Name, username, email, phone')">
      <select class="control role-filter" [(ngModel)]="statusFilter"><option value="ALL">{{t('Mọi trạng thái','All statuses')}}</option><option value="ACTIVE">{{t('Đang hoạt động','Active')}}</option><option value="LOCKED">{{t('Đã khóa','Locked')}}</option></select>
      <select class="control role-filter" [(ngModel)]="roleFilter">
        <option value="ALL">{{t('Tất cả vai trò','All roles')}}</option><option value="CLERK">CLERK</option><option value="ADMIN">ADMIN</option><option value="SUPER_ADMIN">SUPER_ADMIN</option>
      </select>
      <button class="btn btn-outline" (click)="load()" [disabled]="loading">{{t('Làm mới','Refresh')}}</button>
    </section>

    @if(editor){
      <div class="modal" (click)="editor=null">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="close" (click)="editor=null">×</button>
          <div class="eyebrow">{{editorMode==='create'?t('TẠO TÀI KHOẢN NHÂN VIÊN','CREATE STAFF ACCOUNT'):t('CẬP NHẬT NHÂN VIÊN','UPDATE STAFF')}}</div>
          <h2>{{editorMode==='create'?t('Tạo tài khoản nhân viên','Create staff account'):editor.first_name+' '+editor.last_name}}</h2>
          <div class="grid grid-2">
            @if(editorMode==='create'){
              <div class="field"><span>{{t('Tên đăng nhập','Username')}}</span><input class="control" [(ngModel)]="editor.username" [placeholder]="t('Nhập tên đăng nhập','Enter username')"></div>
              <div class="field"><span>{{t('Mật khẩu ban đầu','Initial password')}}</span><input class="control" type="password" [(ngModel)]="editor.password" [placeholder]="t('Mật khẩu tối thiểu 6 ký tự','At least 6 characters')"></div>
            }
            <div class="field"><span>{{t('Họ','First name')}}</span><input class="control" [(ngModel)]="editor.first_name" [placeholder]="t('Họ','First name')"></div>
            <div class="field"><span>{{t('Tên','Last name')}}</span><input class="control" [(ngModel)]="editor.last_name" [placeholder]="t('Tên','Last name')"></div>
            <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="editor.email" placeholder="email@aptechairlines.com"></div>
            <div class="field"><span>{{t('Điện thoại','Phone')}}</span><input class="control" [(ngModel)]="editor.phone_number" [placeholder]="t('Số điện thoại','Phone number')"></div>
            <div class="field"><span>{{t('Vai trò','Role')}}</span><select class="control" [(ngModel)]="editor.role" [disabled]="editor.originalRole==='SUPER_ADMIN'||isSelf(editor)"><option value="CLERK">CLERK</option><option value="ADMIN">ADMIN</option>@if(editor.originalRole==='SUPER_ADMIN'){<option value="SUPER_ADMIN">SUPER_ADMIN</option>}</select></div>
            <div class="field"><span>{{t('Địa chỉ','Address')}}</span><input class="control" [(ngModel)]="editor.address" [placeholder]="t('Địa chỉ liên hệ','Contact address')"></div>
          </div>
          <div class="modal-actions"><button class="btn btn-outline" (click)="editor=null">{{t('Đóng','Close')}}</button><button class="btn btn-primary" (click)="save()" [disabled]="busy">{{busy?t('Đang lưu…','Saving…'):t('Lưu nhân viên','Save staff')}}</button></div>
        </section>
      </div>
    }

    @if(passwordResetTarget){
      <div class="modal" (click)="passwordResetTarget=null">
        <section class="card modal-card small-card" (click)="$event.stopPropagation()">
          <button class="close" (click)="passwordResetTarget=null">×</button>
          <div class="eyebrow">{{t('ĐẶT LẠI MẬT KHẨU','RESET PASSWORD')}}</div>
          <h2>{{t('Đặt lại mật khẩu nhân viên','Reset staff password')}}</h2>
          <p class="muted-note">{{language.pick('Tạo mật khẩu mới cho tài khoản','Create a new password for')}} <strong translate="no">{{passwordResetTarget.first_name}} {{passwordResetTarget.last_name}}</strong> (<span translate="no">&#64;{{passwordResetTarget.username}}</span>).</p>
          <div class="field"><span>{{t('Mật khẩu mới (tối thiểu 6 ký tự)','New password (at least 6 characters)')}}</span><input class="control" type="text" [(ngModel)]="tempPassword" [placeholder]="t('Nhập mật khẩu mới','Enter a new password')"></div>
          <div class="modal-actions"><button class="btn btn-outline" (click)="passwordResetTarget=null">{{t('Hủy','Cancel')}}</button><button class="btn btn-primary" (click)="confirmResetPw()" [disabled]="busy||!tempPassword||tempPassword.length<6">{{busy?t('Đang cập nhật…','Updating…'):t('Cập nhật mật khẩu','Reset password')}}</button></div>
        </section>
      </div>
    }

    <section class="card table-card">
      @if(loading){<div class="empty muted">{{t('Đang tải danh sách nhân viên…','Loading staff…')}}</div>}
      @else if(!filtered.length){<div class="empty muted">{{t('Không có nhân viên phù hợp.','No matching staff.')}}</div>}
      @else{
        <div class="staff-list">
          @for(x of filtered;track x._id){
            <article class="staff-row">
              <span class="avatar">{{initials(x)}}</span>
              <div class="identity"><strong translate="no">{{x.first_name}} {{x.last_name}}</strong><small translate="no">&#64;{{x.username}} · {{x.email}}</small><small>{{x.phone_number||t('Chưa có số điện thoại','No phone number')}}</small></div>
              <span class="role" [class.admin]="x.role==='ADMIN'||x.role==='SUPER_ADMIN'">{{x.role}}</span>
              <span class="pill" [class.locked]="x.is_active===false">{{x.is_active===false?t('Đã khóa','Locked'):t('Hoạt động','Active')}}</span>
              @if(x.role==='SUPER_ADMIN'){<div class="actions"><span class="muted">{{t('Chỉ xem','Read only')}}</span></div>}
              @else{<div class="actions"><button class="btn btn-outline" (click)="openEdit(x)">{{t('Sửa','Edit')}}</button><button class="btn btn-outline" (click)="toggleLock(x)" [disabled]="busy||isSelf(x)">{{x.is_active===false?t('Mở khóa','Unlock'):t('Khóa','Lock')}}</button><button class="btn btn-outline" (click)="openResetPw(x)" [disabled]="busy">{{t('Đặt lại MK','Reset password')}}</button><button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy||isSelf(x)">{{t('Xóa','Delete')}}</button></div>}
            </article>
          }
        </div>
      }
    </section>
  `,
  styles:[`
    .page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.page-head .title{margin-bottom:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.stats .card{padding:16px 18px;display:grid;gap:5px}.stats span{font-size:10px;text-transform:uppercase;font-weight:800;color:#718093}.stats strong{font-size:24px;color:#071b2e}.toolbar{display:flex;gap:9px;padding:14px;margin-top:14px}.toolbar input{flex:1}.role-filter{max-width:190px}.table-card{padding:8px;margin-top:14px}.staff-list{display:grid}.staff-row{display:grid;grid-template-columns:46px minmax(0,1fr) 110px 100px auto;align-items:center;gap:14px;padding:13px 12px;border-bottom:1px solid #edf1f4}.staff-row:last-child{border-bottom:0}.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#0d304e;color:#f2c85f;font-weight:900}.identity{display:grid;gap:3px;min-width:0}.identity strong{color:#102c43}.identity small{color:#718093;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.role{justify-self:start;border-radius:999px;padding:6px 9px;background:#edf2f6;color:#4c6173;font-size:10px;font-weight:900}.role.admin{background:#fff2c9;color:#72540c}.actions{display:flex;gap:7px;flex-wrap:wrap}.pill{justify-self:start;border-radius:999px;padding:5px 9px;background:#e5f6ec;color:#1f7a45;font-size:10px;font-weight:900}.pill.locked{background:#fdeaea;color:#a83030}.danger{color:#a83030;border-color:#e4bebe}.empty{padding:34px;text-align:center}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}.modal-card{width:min(680px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.modal-card.small-card{width:min(480px,100%)}.modal-card h2{color:#071b2e;margin:6px 0 16px}.close{position:absolute;right:16px;top:14px;border:0;background:transparent;font-size:26px;color:#718093;cursor:pointer}.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.muted-note{color:#718093;font-size:13px;line-height:1.5;margin:4px 0 16px}@media(max-width:900px){.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:46px 1fr auto}.role{grid-column:2}.actions{grid-column:3;grid-row:1/3}}@media(max-width:620px){.page-head,.toolbar{align-items:stretch;flex-direction:column}.role-filter{max-width:none}.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:42px 1fr}.role,.actions{grid-column:2;grid-row:auto}.actions{justify-content:flex-start}.modal-actions{flex-direction:column}.modal-actions .btn{width:100%}}
  `]
})
export class StaffManagementComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  readonly language=inject(LanguageService);
  api=inject(ApiService);toast=inject(ToastService);auth=inject(AuthService);statusFilter='ALL';
  staff:any[]=[];query='';roleFilter='ALL';loading=true;busy=false;private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};editor:any=null;editorMode:'create'|'edit'='create';passwordResetTarget:any=null;tempPassword='Temp@2026';
  constructor(){this.load()}
  get filtered(){const q=this.query.trim().toLowerCase();return this.staff.filter(x=>(this.roleFilter==='ALL'||x.role===this.roleFilter)&&(this.statusFilter==='ALL'||(this.statusFilter==='LOCKED')===(x.is_active===false))&&(!q||[x.first_name,x.last_name,x.username,x.email,x.phone_number].some(v=>String(v||'').toLowerCase().includes(q))))}
  load(){this.loading=true;this.error='';this.api.users().subscribe({next:r=>{this.staff=(r||[]).filter((u:any)=>u.role!=='CUSTOMER');this.loading=false},error:e=>{this.error=this.msg(e,this.language.pick('Không tải được danh sách nhân viên.','Unable to load staff.'));this.loading=false}})}
  count(role:string){return this.staff.filter(x=>x.role===role).length}
  t(vi:string,en:string){return this.language.pick(vi,en)}
  initials(x:any){return`${x?.first_name?.[0]||''}${x?.last_name?.[0]||x?.username?.[0]||''}`.toUpperCase()}
  openCreate(){this.editorMode='create';this.error='';this.editor={username:'',password:'Staff@2026',first_name:'',last_name:'',email:'',phone_number:'',address:'',role:'CLERK'}}
  openEdit(x:any){this.editorMode='edit';this.error='';this.editor={...x,originalRole:x.role}}
  save(){
    const e=this.editor;if(!e)return;this.error='';
    if(!e.first_name?.trim()||!e.last_name?.trim()||!e.email?.trim()||(this.editorMode==='create'&&(!e.username?.trim()||!e.password))){this.error=this.language.pick('Vui lòng nhập đủ username, mật khẩu, họ tên và email.','Enter username, password, full name, and email.');return}
    const body:any={first_name:e.first_name.trim(),last_name:e.last_name.trim(),email:e.email.trim(),phone_number:e.phone_number?.trim()||'',address:e.address?.trim()||'',role:e.role};
    if(this.editorMode==='create'){body.username=e.username.trim();body.password=e.password}
    if(this.editorMode==='edit'&&e.originalRole==='SUPER_ADMIN')delete body.role;
    this.busy=true;
    const req=this.editorMode==='create'?this.api.createUser(body):this.api.updateUser(e._id,body);
    const isCreate=this.editorMode==='create';
    req.subscribe({next:()=>{this.busy=false;this.editor=null;this.load();this.toast.success({titleVi:isCreate?'Đã tạo tài khoản nhân viên.':'Đã cập nhật nhân viên.',titleEn:isCreate?'Staff account created.':'Staff account updated.'})},error:x=>{this.busy=false;this.error=this.msg(x,this.language.pick('Không lưu được nhân viên.','Unable to save staff account.'))}})
  }
  async remove(x:any){
    if(x.role==='SUPER_ADMIN')return;
    const ok=await this.toast.confirm({titleVi:'Xóa tài khoản nhân viên',titleEn:'Delete staff account',messageVi:`Xóa tài khoản @${x.username}?`,messageEn:`Delete staff account @${x.username}?`,confirmVi:'Xóa',confirmEn:'Delete'});if(!ok)return;
    this.busy=true;this.api.deleteUser(x._id).subscribe({next:()=>{this.busy=false;this.load();this.toast.success({titleVi:`Đã xóa nhân viên @${x.username}.`,titleEn:`Staff account @${x.username} deleted.`})},error:e=>{this.busy=false;this.error=this.msg(e,this.language.pick('Không xóa được nhân viên.','Unable to delete staff account.'))}})
  }
  myId(){const u:any=(this.auth as any).user?.();return String(u?._id||u?.id||'')}
  isSelf(x:any){return !!x&&!!this.myId()&&String(x._id)===this.myId()}
  async toggleLock(x:any){
    if(x.role==='SUPER_ADMIN'||this.isSelf(x))return;const lock=x.is_active!==false;
    const ok=await this.toast.confirm({titleVi:lock?'Khóa tài khoản':'Mở khóa tài khoản',titleEn:lock?'Lock account':'Unlock account',messageVi:`${lock?'Khóa':'Mở khóa'} tài khoản @${x.username}?`,messageEn:`${lock?'Lock':'Unlock'} @${x.username}?`,confirmVi:lock?'Khóa':'Mở khóa',confirmEn:lock?'Lock':'Unlock'});if(!ok)return;
    this.busy=true;this.api.setUserStatus(x._id,!lock).subscribe({next:()=>{this.busy=false;this.load();this.toast.success({titleVi:`Đã ${lock?'khóa':'mở khóa'} tài khoản @${x.username}.`,titleEn:`Account @${x.username} ${lock?'locked':'unlocked'}.`})},error:e=>{this.busy=false;this.error=this.msg(e,this.language.pick('Không cập nhật được trạng thái.','Unable to update account status.'))}})
  }
  openResetPw(x:any){if(x.role==='SUPER_ADMIN')return;this.passwordResetTarget=x;this.tempPassword='Temp@2026'}
  confirmResetPw(){
    const x=this.passwordResetTarget;if(!x)return;
    if(!this.tempPassword||this.tempPassword.length<6){this.error=this.language.pick('Mật khẩu tạm thời phải có ít nhất 6 ký tự.','Temporary password must contain at least 6 characters.');return}
    this.busy=true;this.api.resetUserPassword(x._id,this.tempPassword).subscribe({next:()=>{this.busy=false;this.error='';this.passwordResetTarget=null;this.toast.success({titleVi:'Đặt lại mật khẩu thành công',titleEn:'Password reset successfully',messageVi:`Đã đặt lại mật khẩu cho @${x.username}.`,messageEn:`Password reset for @${x.username}.`})},error:e=>{this.busy=false;this.error=this.msg(e,this.language.pick('Không đặt lại được mật khẩu.','Unable to reset password.'))}})
  }
  msg(e:any,f:string){const m=e?.error?.message;return this.language.translateNotice(Array.isArray(m)?m.join(' · '):m||f)}
}
