import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';

@Component({
  standalone:true,
  imports:[FormsModule,RouterLink],
  template:`
  <div class="container page">
    <div class="eyebrow">PROFILE</div>
    <h1 class="title">Hồ sơ & SkyMiles</h1>
    @if(!auth.authenticated()){
      <div class="card empty">Vui lòng đăng nhập.</div>
    }@else{
      <div class="profile-grid">
        <section class="card profile">
          <div class="avatar">{{initials}}</div>
          <h2>{{auth.user()?.first_name}} {{auth.user()?.last_name}}</h2>
          <p class="muted">{{auth.user()?.email}}</p>
          <div class="miles">
            <span>SkyMiles hiện tại</span>
            <strong>{{auth.user()?.sky_miles||0}}</strong>
            <a routerLink="/skymiles">Xem hạng thành viên & quyền lợi →</a>
          </div>
          <div class="payment-card">
            <div class="paypal-mark">PayPal</div>
            <div><strong>Thanh toán trực tuyến</strong><span>Thanh toán được thực hiện tại PayPal Checkout. Aptech Airlines không yêu cầu lưu số thẻ trong hồ sơ.</span></div>
          </div>
          <a class="support-link" routerLink="/cancellation-refund">Chính sách hủy vé & hoàn tiền</a>
        </section>

        <section class="card form">
          <div class="section-title"><div><span>THÔNG TIN CÁ NHÂN</span><h2>Cập nhật hồ sơ</h2></div><small>Thông tin này được dùng để tự điền hành khách khi bạn đặt vé.</small></div>
          <div class="grid grid-2">
            <div class="field"><span>Họ</span><input class="control" [(ngModel)]="model.first_name"></div>
            <div class="field"><span>Tên</span><input class="control" [(ngModel)]="model.last_name"></div>
            <div class="field"><span>Email</span><input class="control" [(ngModel)]="model.email"></div>
            <div class="field"><span>Điện thoại</span><input class="control" [(ngModel)]="model.phone_number"></div>
            <div class="field"><span>Giới tính</span><select class="control" [(ngModel)]="model.sex"><option value="MALE">Nam</option><option value="FEMALE">Nữ</option><option value="OTHER">Khác</option></select></div>
            <div class="field"><span>Tuổi</span><input class="control" type="number" min="0" [(ngModel)]="model.age"></div>
          </div>
          <div class="field"><span>Địa chỉ</span><input class="control" [(ngModel)]="model.address"></div>
          <div class="checkout-note"><strong>Không cần khai báo thẻ ngân hàng.</strong><span>Khi mua vé hoặc trả chênh lệch đổi chuyến, hệ thống mở PayPal Checkout để bạn thanh toán.</span></div>
          <button class="btn btn-primary" (click)="save()">Lưu thay đổi</button>
          
          
        </section>
      </div>
    }
  </div>`,
  styles:[`
    .profile-grid{display:grid;grid-template-columns:320px 1fr;gap:20px;margin-top:20px}.profile,.form{padding:24px}.avatar{width:72px;height:72px;border-radius:22px;background:linear-gradient(145deg,#071b2e,#123d5e);color:#f2c85f;display:grid;place-items:center;font-size:24px;font-weight:900;box-shadow:0 12px 30px rgba(7,27,46,.18)}.profile h2{color:#071b2e;margin:16px 0 5px}.miles{margin-top:18px;padding:18px;border-radius:18px;background:linear-gradient(135deg,#fff8e3,#fff2c6);border:1px solid #f0d88d}.miles span{display:block;font-size:10px;text-transform:uppercase;font-weight:900;letter-spacing:.08em;color:#8b6a1a}.miles strong{display:block;font-size:38px;color:#071b2e;margin:3px 0}.miles a{font-size:11px;color:#76580d;font-weight:800}.payment-card{display:flex;gap:12px;align-items:flex-start;margin-top:14px;padding:16px;border-radius:18px;background:#f4f7f9}.paypal-mark{flex:0 0 auto;background:#073b8c;color:#fff;border-radius:10px;padding:8px 10px;font-weight:900;font-style:italic;font-size:13px}.payment-card strong,.payment-card span{display:block}.payment-card strong{color:#112c43}.payment-card span{color:#68798a;font-size:11px;line-height:1.55;margin-top:4px}.support-link{display:inline-block;margin-top:16px;font-size:12px;font-weight:800;color:#244b68}.section-title{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:8px}.section-title span{font-size:10px;letter-spacing:.12em;font-weight:900;color:#ae7d12}.section-title h2{margin:4px 0 0;color:#071b2e}.section-title small{max-width:260px;color:#768696;line-height:1.5;text-align:right}.form .field{margin-bottom:14px}.checkout-note{display:grid;gap:4px;background:#eef6fb;border:1px solid #d9e9f3;border-radius:14px;padding:13px 14px;margin:4px 0 16px}.checkout-note strong{color:#173c58}.checkout-note span{font-size:11px;color:#617587;line-height:1.55}.form .btn{margin-top:6px}@media(max-width:760px){.profile-grid{grid-template-columns:1fr}.section-title{flex-direction:column}.section-title small{text-align:left;max-width:none}}
  `]
})
export class ProfileComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  auth=inject(AuthService);api=inject(ApiService);model:any={};private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  constructor(){this.model={...(this.auth.user()||{})}}
  get initials(){return`${this.auth.user()?.first_name?.[0]||''}${this.auth.user()?.last_name?.[0]||''}`.toUpperCase()}
  save(){
    const id=this.auth.user()?._id||this.auth.user()?.id;if(!id)return;
    this.message='';this.error='';
    const body:any={first_name:this.model.first_name,last_name:this.model.last_name,email:this.model.email,phone_number:this.model.phone_number,address:this.model.address,sex:this.model.sex,age:Number(this.model.age||0)};
    this.api.updateUser(id,body).subscribe({next:()=>{this.message='Đã cập nhật hồ sơ.';this.auth.refresh()},error:e=>this.error=Array.isArray(e?.error?.message)?e.error.message.join(' · '):(e?.error?.message||'Không cập nhật được hồ sơ.')})
  }
}
