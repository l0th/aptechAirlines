import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { LanguageService } from '../core/language.service';
import { safeReturnPath } from '../core/guards';

@Component({
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="auth-bg">
      <div class="card auth-card">
        <div class="tabs">
          <button [class.on]="mode==='login'" (click)="switchMode('login')">Đăng nhập</button>
          <button [class.on]="mode==='register'" (click)="switchMode('register')">Đăng ký</button>
        </div>

        @if(mode==='login'){
          <h1>Chào mừng trở lại</h1>
          <p class="muted">Đăng nhập để giữ chỗ, mua vé và quản lý hành trình.</p>
          <div class="field">
            <span>Tên đăng nhập</span>
            <input class="control" [(ngModel)]="login.username" autocomplete="username" (keyup.enter)="submit()">
          </div>
          <div class="field">
            <span>Mật khẩu</span>
            <div class="password-control">
              <input class="control" [type]="showLoginPassword?'text':'password'" [(ngModel)]="login.password" autocomplete="current-password" (keyup.enter)="submit()">
              <button type="button" class="password-toggle" (click)="showLoginPassword=!showLoginPassword" [attr.aria-label]="showLoginPassword?'Ẩn mật khẩu':'Hiện mật khẩu'">
                <app-icon [name]="showLoginPassword?'eye-off':'eye'" [size]="18"/>
              </button>
            </div>
          </div>
          <button type="button" class="forgot-link" (click)="openForgot()">Quên mật khẩu?</button>
        }@else if(mode==='register'){
          <h1>Tạo tài khoản</h1>
          <p class="muted">Giao dịch giữ chỗ, mua, đổi và hủy vé dành cho người dùng đã đăng ký.</p>
          <div class="grid grid-2">
            <div class="field"><span>Tên đăng nhập</span><input class="control" [(ngModel)]="reg.username" autocomplete="username"></div>
            <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="reg.email" autocomplete="email"></div>
            <div class="field"><span>Họ</span><input class="control" [(ngModel)]="reg.first_name" autocomplete="family-name"></div>
            <div class="field"><span>Tên</span><input class="control" [(ngModel)]="reg.last_name" autocomplete="given-name"></div>
            <div class="field"><span>Số điện thoại</span><input class="control" [(ngModel)]="reg.phone_number" autocomplete="tel" placeholder="+84 912 345 678"></div>
            <div class="field">
              <span>Giới tính</span>
              <select class="control" [(ngModel)]="reg.sex">
                <option value="MALE">{{lang.pick('Nam','Male')}}</option>
                <option value="FEMALE">{{lang.pick('Nữ','Female')}}</option>
                <option value="OTHER">{{lang.pick('Khác','Other')}}</option>
              </select>
            </div>
            <div class="field"><span>Tuổi</span><input class="control" type="number" min="0" step="1" [(ngModel)]="reg.age"></div>
          </div>
          <div class="field"><span>Địa chỉ</span><input class="control" [(ngModel)]="reg.address" autocomplete="street-address"></div>
          <div class="field"><span>Mật khẩu</span><div class="password-control"><input class="control" [type]="showRegisterPassword?'text':'password'" minlength="6" [(ngModel)]="reg.password" autocomplete="new-password"><button type="button" class="password-toggle" (click)="showRegisterPassword=!showRegisterPassword" [attr.aria-label]="showRegisterPassword?'Ẩn mật khẩu':'Hiện mật khẩu'"><app-icon [name]="showRegisterPassword?'eye-off':'eye'" [size]="18"/></button></div><small>Tối thiểu 6 ký tự.</small></div>
        }@else if(mode==='forgot'){
          <h1>Quên mật khẩu</h1>
          <p class="muted">Nhập email đã đăng ký. Hệ thống sẽ gửi mã xác nhận 6 số có hiệu lực trong 10 phút.</p>
          <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="forgotEmail" autocomplete="email" (keyup.enter)="requestResetCode()"></div>
          <button class="btn btn-primary submit" (click)="requestResetCode()" [disabled]="busy">{{busy?'Đang gửi…':'Gửi mã xác nhận'}}</button>
          <button type="button" class="back-link" (click)="switchMode('login')">Quay lại đăng nhập</button>
        }@else{
          <h1>Đặt lại mật khẩu</h1>
          <p class="muted">Nhập mã 6 số đã gửi về email và đặt mật khẩu mới.</p>
          <div class="field"><span>Email</span><input class="control" type="email" [(ngModel)]="reset.email" autocomplete="email"></div>
          <div class="field"><span>Mã xác nhận</span><input class="control code-input" inputmode="numeric" maxlength="6" [(ngModel)]="reset.code" autocomplete="one-time-code" placeholder="000000"></div>
          <div class="field"><span>Mật khẩu mới</span><div class="password-control"><input class="control" [type]="showResetPassword?'text':'password'" minlength="6" [(ngModel)]="reset.password" autocomplete="new-password"><button type="button" class="password-toggle" (click)="showResetPassword=!showResetPassword" [attr.aria-label]="showResetPassword?'Ẩn mật khẩu':'Hiện mật khẩu'"><app-icon [name]="showResetPassword?'eye-off':'eye'" [size]="18"/></button></div></div>
          <div class="field"><span>Nhập lại mật khẩu mới</span><div class="password-control"><input class="control" [type]="showResetConfirm?'text':'password'" minlength="6" [(ngModel)]="reset.confirm" autocomplete="new-password"><button type="button" class="password-toggle" (click)="showResetConfirm=!showResetConfirm" [attr.aria-label]="showResetConfirm?'Ẩn mật khẩu':'Hiện mật khẩu'"><app-icon [name]="showResetConfirm?'eye-off':'eye'" [size]="18"/></button></div></div>
          <button class="btn btn-primary submit" (click)="submitResetPassword()" [disabled]="busy">{{busy?'Đang đổi…':'Đổi mật khẩu'}}</button>
          <div class="reset-links"><button type="button" class="back-link" (click)="requestResetCode()">Gửi lại mã</button><button type="button" class="back-link" (click)="switchMode('login')">Quay lại đăng nhập</button></div>
        }

        
        
        @if(mode==='login'||mode==='register'){
          <button class="btn btn-primary submit" (click)="submit()" [disabled]="busy">
            {{busy?'Đang xử lý…':mode==='login'?'Đăng nhập':'Tạo tài khoản'}}
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .auth-bg{min-height:75vh;display:grid;place-items:center;padding:45px 16px;background:linear-gradient(135deg,#071b2e,#123957)}
    .auth-card{width:min(620px,100%);padding:28px}
    .tabs{display:flex;gap:8px;margin-bottom:20px}
    .tabs button{border:0;border-radius:999px;padding:9px 15px;font-weight:800;background:#eef2f5;color:#68778a;cursor:pointer}
    .tabs button.on{background:#071b2e;color:white}
    .auth-card h1{color:#071b2e}
    .field{margin-top:14px}
    .field small{display:block;color:#7b8997;font-size:10px;margin-top:6px;line-height:1.45}
    .password-control{position:relative}.password-control .control{padding-right:46px}.password-toggle{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:#53687a;display:grid;place-items:center;cursor:pointer}.password-toggle:hover{background:#eef3f6;color:#071b2e}
    .forgot-link,.back-link{border:0;background:transparent;color:#345b77;font-size:12px;font-weight:800;cursor:pointer;padding:0;margin-top:10px}.forgot-link{display:block;margin-left:auto}.back-link:hover,.forgot-link:hover{text-decoration:underline}.reset-links{display:flex;justify-content:space-between;gap:12px}.code-input{font-size:22px;letter-spacing:.28em;font-weight:900;text-align:center}
    .form-message{margin:14px 0 0;padding:10px 12px;border-radius:12px;background:#fff0f0;border:1px solid #efcaca}
    .success-message{background:#ecf8f2;border-color:#bfe5d3;color:#176b4a}
    .submit{width:100%;margin-top:20px}
    .submit:disabled{opacity:.55;cursor:not-allowed}
  `]
})
export class AuthComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  auth = inject(AuthService);
  api = inject(ApiService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  lang = inject(LanguageService);

  mode: 'login' | 'register' | 'forgot' | 'reset' = 'login';
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};
  busy = false;
  showLoginPassword = false;
  showRegisterPassword = false;
  showResetPassword = false;
  showResetConfirm = false;
  forgotEmail = '';
  reset = { email: '', code: '', password: '', confirm: '' };
  login = { username: '', password: '' };
  reg: any = {
    username: '',
    password: '',
    first_name: '',
    last_name: '',
    email: '',
    address: '',
    phone_number: '',
    sex: 'OTHER',
    age: 18
  };

  switchMode(mode: 'login' | 'register') {
    this.mode = mode;
    this.error = '';
    this.message = '';
  }

  openForgot() {
    this.mode = 'forgot';
    this.error = '';
    this.message = '';
  }

  requestResetCode() {
    if (this.busy) return;
    const email = (this.mode === 'reset' ? this.reset.email : this.forgotEmail).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = this.t('Vui lòng nhập email hợp lệ.');
      return;
    }
    this.busy = true;
    this.error = '';
    this.message = '';
    this.api.forgotPassword(email).subscribe({
      next: r => {
        this.busy = false;
        this.reset.email = email;
        this.reset.code = '';
        this.mode = 'reset';
        this.message = this.t(r?.message || 'Nếu email tồn tại, mã xác nhận đã được gửi.');
      },
      error: e => {
        this.busy = false;
        this.error = this.apiError(e, 'Không thể gửi mã xác nhận.');
      }
    });
  }

  submitResetPassword() {
    if (this.busy) return;
    const email = this.reset.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.error = this.t('Email không đúng định dạng.'); return; }
    if (!/^\d{6}$/.test(this.reset.code.trim())) { this.error = this.t('Mã xác nhận phải gồm đúng 6 chữ số.'); return; }
    if (this.reset.password.length < 6) { this.error = this.t('Mật khẩu mới phải có ít nhất 6 ký tự.'); return; }
    if (this.reset.password !== this.reset.confirm) { this.error = this.t('Hai mật khẩu mới chưa khớp nhau.'); return; }
    this.busy = true;
    this.error = '';
    this.message = '';
    this.api.resetPassword({email, code:this.reset.code.trim(), new_password:this.reset.password}).subscribe({
      next: r => {
        this.busy = false;
        this.mode = 'login';
        this.message = this.t(r?.message || 'Đổi mật khẩu thành công. Hãy đăng nhập lại.');
        this.reset = {email:'',code:'',password:'',confirm:''};
      },
      error: e => {
        this.busy = false;
        this.error = this.apiError(e, 'Không thể đổi mật khẩu.');
      }
    });
  }

  submit() {
    if (this.busy) return;
    this.error = this.mode === 'login' ? this.validateLogin() : this.validateRegistration();
    if (this.error) return;

    const payload = this.mode === 'login'
      ? { username: this.login.username.trim(), password: this.login.password }
      : {
          ...this.reg,
          username: this.reg.username.trim(),
          first_name: this.reg.first_name.trim(),
          last_name: this.reg.last_name.trim(),
          email: this.reg.email.trim(),
          address: this.reg.address.trim(),
          phone_number: this.reg.phone_number.trim(),
          age: Number(this.reg.age)
        };

    this.busy = true;
    const req = this.mode === 'login' ? this.auth.login(payload) : this.auth.register(payload);
    req.subscribe({
      next: () => {
        this.busy = false;
        const next = this.route.snapshot.queryParamMap.get('next');
        this.router.navigateByUrl(safeReturnPath(next));
      },
      error: e => {
        this.busy = false;
        this.error = this.apiError(e, 'Không thể thực hiện yêu cầu.');
      }
    });
  }

  private validateLogin() {
    if (!this.login.username.trim() || !this.login.password) return this.t('Nhập tên đăng nhập và mật khẩu.');
    return '';
  }

  private validateRegistration() {
    const required = [
      this.reg.username,
      this.reg.password,
      this.reg.first_name,
      this.reg.last_name,
      this.reg.email,
      this.reg.address,
      this.reg.phone_number,
      this.reg.sex
    ];
    if (required.some(v => !String(v ?? '').trim())) return this.t('Vui lòng nhập đầy đủ thông tin đăng ký.');
    if (String(this.reg.password).length < 6) return this.t('Mật khẩu phải có ít nhất 6 ký tự.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(this.reg.email).trim())) return this.t('Email không đúng định dạng.');
    if (!/^(?=(?:\D*\d){7,15}\D*$)\+?[0-9\s().-]+$/.test(String(this.reg.phone_number).trim())) return this.t('Số điện thoại phải có từ 7 đến 15 chữ số.');
    const age = Number(this.reg.age);
    if (!Number.isInteger(age) || age < 0) return this.t('Tuổi phải là số nguyên không âm.');
    return '';
  }

  private apiError(e: any, fallback: string) {
    const raw = Array.isArray(e?.error?.message) ? e.error.message.join(' · ') : (e?.error?.message || fallback);
    return this.t(raw);
  }

  private t(message: string) {
    return this.lang.translate(message);
  }
}
