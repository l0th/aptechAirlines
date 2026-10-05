import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';

@Component({
  standalone:true,
  imports:[FormsModule],
  template:`
    <div class="eyebrow">ADMINISTRATION</div>
    <div class="page-head">
      <div><h1 class="title">Quản lý nhân viên</h1><p class="subtitle">Quản lý tài khoản CLERK và ADMIN dùng cho cổng nhân viên.</p></div>
      <button class="btn btn-primary" (click)="openCreate()">+ Thêm nhân viên</button>
    </div>

    <div class="stats">
      <div class="card"><span>Tổng nhân viên</span><strong>{{staff.length}}</strong></div>
      <div class="card"><span>CLERK</span><strong>{{count('CLERK')}}</strong></div>
      <div class="card"><span>ADMIN</span><strong>{{count('ADMIN')}}</strong></div>
      <div class="card"><span>SUPER ADMIN</span><strong>{{count('SUPER_ADMIN')}}</strong></div>
    </div>

    <section class="card toolbar">
      <input class="control" [(ngModel)]="query" placeholder="Tên, username, email, điện thoại">
      <select class="control role-filter" [(ngModel)]="roleFilter">
        <option value="ALL">Tất cả vai trò</option><option value="CLERK">CLERK</option><option value="ADMIN">ADMIN</option><option value="SUPER_ADMIN">SUPER_ADMIN</option>
      </select>
      <button class="btn btn-outline" (click)="load()" [disabled]="loading">Làm mới</button>
    </section>

    @if(error){<p class="error notice">{{error}}</p>}
    @if(editor){
      <section class="card editor">
        <div class="editor-head"><div><span class="eyebrow">{{editorMode==='create'?'NEW STAFF':'EDIT STAFF'}}</span><h2>{{editorMode==='create'?'Tạo tài khoản nhân viên':editor.first_name+' '+editor.last_name}}</h2></div><button class="close" (click)="editor=null">×</button></div>
        <div class="grid grid-2">
          @if(editorMode==='create'){
            <div class="field"><span>Username</span><input class="control" [(ngModel)]="editor.username"></div>
            <div class="field"><span>Mật khẩu ban đầu</span><input class="control" type="password" [(ngModel)]="editor.password"></div>
          }
          <div class="field"><span>Họ</span><input class="control" [(ngModel)]="editor.first_name"></div>
          <div class="field"><span>Tên</span><input class="control" [(ngModel)]="editor.last_name"></div>
          <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="editor.email"></div>
          <div class="field"><span>Điện thoại</span><input class="control" [(ngModel)]="editor.phone_number"></div>
          <div class="field"><span>Vai trò</span><select class="control" [(ngModel)]="editor.role" [disabled]="editor.originalRole==='SUPER_ADMIN'"><option value="CLERK">CLERK</option><option value="ADMIN">ADMIN</option>@if(editor.originalRole==='SUPER_ADMIN'){<option value="SUPER_ADMIN">SUPER_ADMIN</option>}</select></div>
          <div class="field"><span>Địa chỉ</span><input class="control" [(ngModel)]="editor.address"></div>
        </div>
        <div class="editor-actions"><button class="btn btn-outline" (click)="editor=null">Đóng</button><button class="btn btn-primary" (click)="save()" [disabled]="busy">{{busy?'Đang lưu…':'Lưu nhân viên'}}</button></div>
      </section>
    }

    <section class="card table-card">
      @if(loading){<div class="empty muted">Đang tải danh sách nhân viên…</div>}
      @else if(!filtered.length){<div class="empty muted">Không có nhân viên phù hợp.</div>}
      @else{
        <div class="staff-list">
          @for(x of filtered;track x._id){
            <article class="staff-row">
              <span class="avatar">{{initials(x)}}</span>
              <div class="identity"><strong>{{x.first_name}} {{x.last_name}}</strong><small>@{{x.username}} · {{x.email}}</small><small>{{x.phone_number||'Chưa có số điện thoại'}}</small></div>
              <span class="role" [class.admin]="x.role==='ADMIN'||x.role==='SUPER_ADMIN'">{{x.role}}</span>
              <div class="actions"><button class="btn btn-outline" (click)="openEdit(x)">Sửa</button><button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy||x.role==='SUPER_ADMIN'">Xóa</button></div>
            </article>
          }
        </div>
      }
    </section>
  `,
  styles:[`
    .page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.page-head .title{margin-bottom:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.stats .card{padding:16px 18px;display:grid;gap:5px}.stats span{font-size:10px;text-transform:uppercase;font-weight:800;color:#718093}.stats strong{font-size:24px;color:#071b2e}.toolbar{display:flex;gap:9px;padding:14px;margin-top:14px}.toolbar input{flex:1}.role-filter{max-width:190px}.notice{margin-top:14px;padding:10px 13px;border-radius:12px;background:#fff0f0;border:1px solid #efcaca}.editor{padding:20px;margin-top:14px}.editor-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}.editor-head h2{margin:4px 0 0;color:#071b2e}.close{border:0;background:#eef3f6;width:32px;height:32px;border-radius:50%;font-size:20px;color:#566979}.editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.table-card{padding:8px;margin-top:14px}.staff-list{display:grid}.staff-row{display:grid;grid-template-columns:46px minmax(0,1fr) 130px auto;align-items:center;gap:14px;padding:13px 12px;border-bottom:1px solid #edf1f4}.staff-row:last-child{border-bottom:0}.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#0d304e;color:#f2c85f;font-weight:900}.identity{display:grid;gap:3px;min-width:0}.identity strong{color:#102c43}.identity small{color:#718093;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.role{justify-self:start;border-radius:999px;padding:6px 9px;background:#edf2f6;color:#4c6173;font-size:10px;font-weight:900}.role.admin{background:#fff2c9;color:#72540c}.actions{display:flex;gap:7px}.danger{color:#a83030;border-color:#e4bebe}.empty{padding:34px;text-align:center}@media(max-width:900px){.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:46px 1fr auto}.role{grid-column:2}.actions{grid-column:3;grid-row:1/3}}@media(max-width:620px){.page-head,.toolbar{align-items:stretch;flex-direction:column}.role-filter{max-width:none}.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:42px 1fr}.role,.actions{grid-column:2;grid-row:auto}.actions{justify-content:flex-start}.editor-actions{flex-direction:column}.editor-actions .btn{width:100%}}
  `]
})
export class StaffManagementComponent{
  api=inject(ApiService);toast=inject(ToastService);
  staff:any[]=[];query='';roleFilter='ALL';loading=true;busy=false;error='';editor:any=null;editorMode:'create'|'edit'='create';
  constructor(){this.load()}
  get filtered(){const q=this.query.trim().toLowerCase();return this.staff.filter(x=>(this.roleFilter==='ALL'||x.role===this.roleFilter)&&(!q||[x.first_name,x.last_name,x.username,x.email,x.phone_number].some(v=>String(v||'').toLowerCase().includes(q))))}
  load(){this.loading=true;this.error='';this.api.users().subscribe({next:r=>{this.staff=(r||[]).filter((u:any)=>u.role!=='CUSTOMER');this.loading=false},error:e=>{this.error=this.msg(e,'Không tải được danh sách nhân viên.');this.loading=false}})}
  count(role:string){return this.staff.filter(x=>x.role===role).length}
  initials(x:any){return`${x?.first_name?.[0]||''}${x?.last_name?.[0]||x?.username?.[0]||''}`.toUpperCase()}
  openCreate(){this.editorMode='create';this.error='';this.editor={username:'',password:'Staff@2026',first_name:'',last_name:'',email:'',phone_number:'',address:'',role:'CLERK'}}
  openEdit(x:any){this.editorMode='edit';this.error='';this.editor={...x,originalRole:x.role}}
  save(){
    const e=this.editor;if(!e)return;this.error='';
    if(!e.first_name?.trim()||!e.last_name?.trim()||!e.email?.trim()||(this.editorMode==='create'&&(!e.username?.trim()||!e.password))){this.error='Vui lòng nhập đủ username, mật khẩu, họ tên và email.';return}
    const body:any={first_name:e.first_name.trim(),last_name:e.last_name.trim(),email:e.email.trim(),phone_number:e.phone_number?.trim()||'',address:e.address?.trim()||'',role:e.role};
    if(this.editorMode==='create'){body.username=e.username.trim();body.password=e.password}
    if(this.editorMode==='edit'&&e.originalRole==='SUPER_ADMIN')delete body.role;
    this.busy=true;
    const req=this.editorMode==='create'?this.api.createUser(body):this.api.updateUser(e._id,body);
    req.subscribe({next:()=>{this.busy=false;this.editor=null;this.load()},error:x=>{this.busy=false;this.error=this.msg(x,'Không lưu được nhân viên.')}})
  }
  async remove(x:any){
    if(x.role==='SUPER_ADMIN')return;
    const ok=await this.toast.confirm({titleVi:'Xóa tài khoản nhân viên',titleEn:'Delete staff account',messageVi:`Xóa tài khoản @${x.username}?`,messageEn:`Delete staff account @${x.username}?`,confirmVi:'Xóa',confirmEn:'Delete'});if(!ok)return;
    this.busy=true;this.api.deleteUser(x._id).subscribe({next:()=>{this.busy=false;this.load()},error:e=>{this.busy=false;this.error=this.msg(e,'Không xóa được nhân viên.')}})
  }
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||f}
}
