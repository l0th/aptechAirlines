import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  imports: [FormsModule],
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
            <input class="control" type="password" [(ngModel)]="login.password" autocomplete="current-password" (keyup.enter)="submit()">
          </div>
        }@else{
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
                <option value="MALE">Nam</option>
                <option value="FEMALE">Nữ</option>
                <option value="OTHER">Khác</option>
              </select>
            </div>
            <div class="field"><span>Tuổi</span><input class="control" type="number" min="0" step="1" [(ngModel)]="reg.age"></div>
          </div>
          <div class="field"><span>Địa chỉ</span><input class="control" [(ngModel)]="reg.address" autocomplete="street-address"></div>
          <div class="field"><span>Mật khẩu</span><input class="control" type="password" minlength="6" [(ngModel)]="reg.password" autocomplete="new-password"><small>Tối thiểu 6 ký tự.</small></div>
        }

        @if(error){<p class="error form-message">{{error}}</p>}
        <button class="btn btn-primary submit" (click)="submit()" [disabled]="busy">
          {{busy?'Đang xử lý…':mode==='login'?'Đăng nhập':'Tạo tài khoản'}}
        </button>
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
    .form-message{margin:14px 0 0;padding:10px 12px;border-radius:12px;background:#fff0f0;border:1px solid #efcaca}
    .submit{width:100%;margin-top:20px}
    .submit:disabled{opacity:.55;cursor:not-allowed}
  `]
})
export class AuthComponent {
  auth = inject(AuthService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  mode: 'login' | 'register' = 'login';
  error = '';
  busy = false;
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
        this.router.navigateByUrl(next && next.startsWith('/') ? next : '/');
      },
      error: e => {
        this.busy = false;
        this.error = Array.isArray(e?.error?.message)
          ? e.error.message.join(' · ')
          : (e?.error?.message || 'Không thể thực hiện yêu cầu.');
      }
    });
  }

  private validateLogin() {
    if (!this.login.username.trim() || !this.login.password) return 'Nhập tên đăng nhập và mật khẩu.';
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
    if (required.some(v => !String(v ?? '').trim())) return 'Vui lòng nhập đầy đủ thông tin đăng ký.';
    if (String(this.reg.password).length < 6) return 'Mật khẩu phải có ít nhất 6 ký tự.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(this.reg.email).trim())) return 'Email không đúng định dạng.';
    if (!/^(?=(?:\D*\d){7,15}\D*$)\+?[0-9\s().-]+$/.test(String(this.reg.phone_number).trim())) return 'Số điện thoại phải có từ 7 đến 15 chữ số.';
    const age = Number(this.reg.age);
    if (!Number.isInteger(age) || age < 0) return 'Tuổi phải là số nguyên không âm.';
    return '';
  }
}
