import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
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
      <select class="control role-filter" [(ngModel)]="statusFilter">
        <option value="ALL">Mọi trạng thái</option>
        <option value="ACTIVE">Đang hoạt động</option>
        <option value="LOCKED">Đã khóa</option>
      </select>
      <select class="control role-filter" [(ngModel)]="roleFilter">
        <option value="ALL">Tất cả vai trò</option>
        <option value="CLERK">CLERK</option>
        <option value="ADMIN">ADMIN</option>
        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
      </select>
      <button class="btn btn-outline" (click)="load()" [disabled]="loading">Làm mới</button>
    </section>

    <!-- Modal tạo/sửa nhân viên -->
    @if(editor){
      <div class="modal" (click)="editor=null">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="close" (click)="editor=null">×</button>
          <div class="eyebrow">{{editorMode==='create'?'TẠO TÀI KHOẢN NHÂN VIÊN':'CẬP NHẬT NHÂN VIÊN'}}</div>
          <h2>{{editorMode==='create'?'Tạo tài khoản nhân viên':editor.first_name+' '+editor.last_name}}</h2>
          <div class="grid grid-2">
            @if(editorMode==='create'){
              <div class="field"><span>Username</span><input class="control" [(ngModel)]="editor.username" placeholder="Nhập username"></div>
              <div class="field"><span>Mật khẩu ban đầu</span><input class="control" type="password" [(ngModel)]="editor.password" placeholder="Mật khẩu tối thiểu 6 ký tự"></div>
            }
            <div class="field"><span>Họ</span><input class="control" [(ngModel)]="editor.first_name" placeholder="Họ"></div>
            <div class="field"><span>Tên</span><input class="control" [(ngModel)]="editor.last_name" placeholder="Tên"></div>
            <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="editor.email" placeholder="email@aptechairlines.com"></div>
            <div class="field"><span>Điện thoại</span><input class="control" [(ngModel)]="editor.phone_number" placeholder="Số điện thoại"></div>
            <div class="field">
              <span>Vai trò</span>
              <select class="control" [(ngModel)]="editor.role" [disabled]="editor.originalRole==='SUPER_ADMIN'||isSelf(editor)">
                <option value="CLERK">CLERK (Nhên viên quầy)</option>
                <option value="ADMIN">ADMIN (Quản trị viên)</option>
                @if(editor.originalRole==='SUPER_ADMIN'){<option value="SUPER_ADMIN">SUPER_ADMIN</option>}
              </select>
            </div>
            <div class="field"><span>Địa chỉ</span><input class="control" [(ngModel)]="editor.address" placeholder="Địa chỉ liên hệ"></div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" (click)="editor=null">Đóng</button>
            <button class="btn btn-primary" (click)="save()" [disabled]="busy">{{busy?'Đang lưu…':'Lưu nhân viên'}}</button>
          </div>
        </section>
      </div>
    }

    <!-- Modal popup đặt lại mật khẩu -->
    @if(passwordResetTarget){
      <div class="modal" (click)="passwordResetTarget=null">
        <section class="card modal-card small-card" (click)="$event.stopPropagation()">
          <button class="close" (click)="passwordResetTarget=null">×</button>
          <div class="eyebrow">ĐẶT LẠI MẬT KHẨU</div>
          <h2>Đặt lại mật khẩu nhân viên</h2>
          <p class="muted-note">Tạo mật khẩu mới cho tài khoản <strong>{{passwordResetTarget.first_name}} {{passwordResetTarget.last_name}}</strong> (&#64;{{passwordResetTarget.username}}). Nhân viên có thể sử dụng mật khẩu này ngay sau khi cập nhật.</p>
          <div class="field">
            <span>Mật khẩu mới (tối thiểu 6 ký tự)</span>
            <input class="control" type="text" [(ngModel)]="tempPassword" placeholder="Nhập mật khẩu mới">
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" (click)="passwordResetTarget=null">Hủy</button>
            <button class="btn btn-primary" (click)="confirmResetPw()" [disabled]="busy || !tempPassword || tempPassword.length < 6">
              {{busy ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}}
            </button>
          </div>
        </section>
      </div>
    }

    <section class="card table-card">
      @if(loading){<div class="empty muted">Đang tải danh sách nhân viên…</div>}
      @else if(!filtered.length){<div class="empty muted">Không có nhân viên phù hợp.</div>}
      @else{
        <div class="staff-list">
          @for(x of filtered;track x._id){
            <article class="staff-row">
              <span class="avatar">{{initials(x)}}</span>
              <div class="identity">
                <strong>{{x.first_name}} {{x.last_name}}</strong>
                <small>&#64;{{x.username}} · {{x.email}}</small>
                <small>{{x.phone_number||'Chưa có số điện thoại'}}</small>
              </div>
              <span class="role" [class.admin]="x.role==='ADMIN'||x.role==='SUPER_ADMIN'">{{x.role}}</span>
              <span class="pill" [class.locked]="x.is_active===false">{{x.is_active===false?'Đã khóa':'Hoạt động'}}</span>
              @if(x.role==='SUPER_ADMIN'){
                <div class="actions"><span class="muted">Chỉ xem</span></div>
              } @else {
                <div class="actions">
                  <button class="btn btn-outline" (click)="openEdit(x)">Sửa</button>
                  <button class="btn btn-outline" (click)="toggleLock(x)" [disabled]="busy||isSelf(x)">{{x.is_active===false?'Mở khóa':'Khóa'}}</button>
                  <button class="btn btn-outline" (click)="openResetPw(x)" [disabled]="busy">Đặt lại MK</button>
                  <button class="btn btn-outline danger" (click)="remove(x)" [disabled]="busy||isSelf(x)">Xóa</button>
                </div>
              }
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.page-head .title{margin-bottom:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.stats .card{padding:16px 18px;display:grid;gap:5px}.stats span{font-size:10px;text-transform:uppercase;font-weight:800;color:#718093}.stats strong{font-size:24px;color:#071b2e}.toolbar{display:flex;gap:9px;padding:14px;margin-top:14px}.toolbar input{flex:1}.role-filter{max-width:190px}.table-card{padding:8px;margin-top:14px}.staff-list{display:grid}.staff-row{display:grid;grid-template-columns:46px minmax(0,1fr) 110px 100px auto;align-items:center;gap:14px;padding:13px 12px;border-bottom:1px solid #edf1f4}.staff-row:last-child{border-bottom:0}.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#0d304e;color:#f2c85f;font-weight:900}.identity{display:grid;gap:3px;min-width:0}.identity strong{color:#102c43}.identity small{color:#718093;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.role{justify-self:start;border-radius:999px;padding:6px 9px;background:#edf2f6;color:#4c6173;font-size:10px;font-weight:900}.role.admin{background:#fff2c9;color:#72540c}.actions{display:flex;gap:7px}.pill{justify-self:start;border-radius:999px;padding:5px 9px;background:#e5f6ec;color:#1f7a45;font-size:10px;font-weight:900}.pill.locked{background:#fdeaea;color:#a83030}.actions{flex-wrap:wrap}.danger{color:#a83030;border-color:#e4bebe}.empty{padding:34px;text-align:center}
    .modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}
    .modal-card{width:min(680px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}
    .modal-card.small-card{width:min(480px,100%)}
    .modal-card h2{color:#071b2e;margin:6px 0 16px}
    .close{position:absolute;right:16px;top:14px;border:0;background:transparent;font-size:26px;color:#718093;cursor:pointer}
    .modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
    .muted-note{color:#718093;font-size:13px;line-height:1.5;margin:4px 0 16px}
    @media(max-width:900px){.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:46px 1fr auto}.role{grid-column:2}.actions{grid-column:3;grid-row:1/3}}
    @media(max-width:620px){.page-head,.toolbar{align-items:stretch;flex-direction:column}.role-filter{max-width:none}.stats{grid-template-columns:1fr 1fr}.staff-row{grid-template-columns:42px 1fr}.role,.actions{grid-column:2;grid-row:auto}.actions{justify-content:flex-start}.modal-actions{flex-direction:column}.modal-actions .btn{width:100%}}
  `]
})
export class StaffManagementComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast = inject(ToastService);
  api = inject(ApiService);
  toast = inject(ToastService);
  auth = inject(AuthService);

  staff: any[] = [];
  query = '';
  roleFilter = 'ALL';
  statusFilter = 'ALL';
  loading = true;
  busy = false;

  editor: any = null;
  editorMode: 'create' | 'edit' = 'create';

  passwordResetTarget: any = null;
  tempPassword = 'Temp@2026';

  private __error = '';
  get error() { return this.__error; }
  set error(v: string) {
    this.__error = v;
    this.__toast.notifyError(v);
  }

  constructor() {
    this.load();
  }

  get filtered() {
    const q = this.query.trim().toLowerCase();
    return this.staff.filter(x =>
      (this.roleFilter === 'ALL' || x.role === this.roleFilter) &&
      (this.statusFilter === 'ALL' || (this.statusFilter === 'LOCKED') === (x.is_active === false)) &&
      (!q || [x.first_name, x.last_name, x.username, x.email, x.phone_number].some(v => String(v || '').toLowerCase().includes(q)))
    );
  }

  load() {
    this.loading = true;
    this.error = '';
    this.api.users().subscribe({
      next: r => {
        this.staff = (r || []).filter((u: any) => u.role !== 'CUSTOMER');
        this.loading = false;
      },
      error: e => {
        this.error = this.msg(e, 'Không tải được danh sách nhân viên.');
        this.loading = false;
      }
    });
  }

  count(role: string) {
    return this.staff.filter(x => x.role === role).length;
  }

  initials(x: any) {
    return `${x?.first_name?.[0] || ''}${x?.last_name?.[0] || x?.username?.[0] || ''}`.toUpperCase();
  }

  openCreate() {
    this.editorMode = 'create';
    this.editor = {
      username: '',
      password: 'Staff@2026',
      first_name: '',
      last_name: '',
      email: '',
      phone_number: '',
      address: '',
      role: 'CLERK'
    };
  }

  openEdit(x: any) {
    this.editorMode = 'edit';
    this.editor = { ...x, originalRole: x.role };
  }

  save() {
    const e = this.editor;
    if (!e) return;
    if (!e.first_name?.trim() || !e.last_name?.trim() || !e.email?.trim() || (this.editorMode === 'create' && (!e.username?.trim() || !e.password))) {
      this.toast.notifyError('Vui lòng nhập đủ username, mật khẩu, họ tên và email.');
      return;
    }

    const body: any = {
      first_name: e.first_name.trim(),
      last_name: e.last_name.trim(),
      email: e.email.trim(),
      phone_number: e.phone_number?.trim() || '',
      address: e.address?.trim() || '',
      role: e.role
    };

    if (this.editorMode === 'create') {
      body.username = e.username.trim();
      body.password = e.password;
    }
    if (this.editorMode === 'edit' && e.originalRole === 'SUPER_ADMIN') {
      delete body.role;
    }

    this.busy = true;
    const isCreate = this.editorMode === 'create';
    const req = isCreate ? this.api.createUser(body) : this.api.updateUser(e._id, body);
    req.subscribe({
      next: () => {
        this.busy = false;
        this.editor = null;
        this.load();
        this.toast.notifySuccess(isCreate ? 'Đã tạo tài khoản nhân viên thành công.' : 'Đã cập nhật thông tin nhân viên.');
      },
      error: x => {
        this.busy = false;
        this.error = this.msg(x, 'Không lưu được nhân viên.');
      }
    });
  }

  async remove(x: any) {
    if (x.role === 'SUPER_ADMIN') return;
    const ok = await this.toast.confirm({
      titleVi: 'Xóa tài khoản nhân viên',
      titleEn: 'Delete staff account',
      messageVi: `Bạn có chắc muốn xóa tài khoản @${x.username}?`,
      messageEn: `Delete staff account @${x.username}?`,
      confirmVi: 'Xóa',
      confirmEn: 'Delete'
    });
    if (!ok) return;

    this.busy = true;
    this.api.deleteUser(x._id).subscribe({
      next: () => {
        this.busy = false;
        this.load();
        this.toast.notifySuccess(`Đã xóa nhân viên @${x.username} thành công.`);
      },
      error: e => {
        this.busy = false;
        this.error = this.msg(e, 'Không xóa được nhân viên.');
      }
    });
  }

  myId() {
    const u: any = (this.auth as any).user?.();
    return String(u?._id || u?.id || '');
  }

  isSelf(x: any) {
    return !!x && !!this.myId() && String(x._id) === this.myId();
  }

  async toggleLock(x: any) {
    if (x.role === 'SUPER_ADMIN' || this.isSelf(x)) return;
    const lock = x.is_active !== false;
    const ok = await this.toast.confirm({
      titleVi: lock ? 'Khóa tài khoản' : 'Mở khóa tài khoản',
      titleEn: lock ? 'Lock account' : 'Unlock account',
      messageVi: `${lock ? 'Khóa' : 'Mở khóa'} tài khoản @${x.username}?`,
      messageEn: `${lock ? 'Lock' : 'Unlock'} @${x.username}?`,
      confirmVi: lock ? 'Khóa' : 'Mở khóa',
      confirmEn: lock ? 'Lock' : 'Unlock'
    });
    if (!ok) return;

    this.busy = true;
    this.api.setUserStatus(x._id, !lock).subscribe({
      next: () => {
        this.busy = false;
        this.load();
        this.toast.notifySuccess(`${lock ? 'Đã khóa' : 'Đã mở khóa'} tài khoản @${x.username} thành công.`);
      },
      error: e => {
        this.busy = false;
        this.error = this.msg(e, 'Không cập nhật được trạng thái.');
      }
    });
  }

  openResetPw(x: any) {
    if (x.role === 'SUPER_ADMIN') return;
    this.passwordResetTarget = x;
    this.tempPassword = 'Temp@2026';
  }

  confirmResetPw() {
    const target = this.passwordResetTarget;
    if (!target) return;
    if (!this.tempPassword || this.tempPassword.length < 6) {
      this.toast.notifyError('Mật khẩu tạm thời phải có ít nhất 6 ký tự.');
      return;
    }
    this.busy = true;
    this.api.resetUserPassword(target._id, this.tempPassword).subscribe({
      next: () => {
        this.busy = false;
        const username = target.username;
        this.passwordResetTarget = null;
        this.toast.notifySuccess(`Đã đặt lại mật khẩu cho @${username} thành công.`);
      },
      error: e => {
        this.busy = false;
        this.toast.notifyError(this.msg(e, 'Không đặt lại được mật khẩu.'));
      }
    });
  }

  msg(e: any, f: string) {
    const m = e?.error?.message;
    return Array.isArray(m) ? m.join(' · ') : m || f;
  }
}
