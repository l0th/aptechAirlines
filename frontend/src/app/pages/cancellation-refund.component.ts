import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LanguageService } from '../core/language.service';

@Component({
  standalone:true,
  imports:[RouterLink],
  template:`
  <div class="service-page">
    <section class="hero">
      <div class="container hero-inner">
        <div><div class="eyebrow light">{{lang.pick('QUẢN LÝ HÀNH TRÌNH','MANAGE YOUR TRIP')}}</div><h1>{{lang.pick('Hủy vé & hoàn tiền,','Cancellation & refunds,')}}<br><span>{{lang.pick('rõ ràng trước khi xác nhận.','clear before you confirm.')}}</span></h1><p>{{lang.pick('Xem mức hoàn dự kiến, hủy vé và theo dõi tiền hoàn về đúng nguồn thanh toán ban đầu.','Preview your eligible refund, cancel your ticket and track refunds to the original payment source.')}}</p><div class="actions"><a class="btn btn-primary" routerLink="/trips">{{lang.pick('Quản lý chuyến đi','Manage trips')}}</a><a class="btn ghost" routerLink="/track">{{lang.pick('Tra cứu vé','Track booking')}}</a></div></div>
        <div class="refund-card"><span>{{lang.pick('QUY TRÌNH HOÀN TIỀN','REFUND PROCESS')}}</span><div><b>01</b><p>{{lang.pick('Tra cứu vé đã mua hoặc đang giữ.','Find your paid or held booking.')}}</p></div><div><b>02</b><p>{{lang.pick('Hệ thống xác định mức hoàn theo thời điểm khởi hành.','The system calculates refund eligibility by departure time.')}}</p></div><div><b>03</b><p>{{lang.pick('Xác nhận hủy và giải phóng ghế.','Confirm cancellation and release seats.')}}</p></div><div><b>04</b><p>{{lang.pick('Khoản hoàn được trả về nguồn thanh toán gốc.','Refunds return to the original payment source.')}}</p></div></div>
      </div>
    </section>

    <div class="container body">
      <section class="principles">
        <article class="card"><span>{{lang.pick('VÉ ĐANG GIỮ','HELD BOOKINGS')}}</span><h3>{{lang.pick('Hủy giữ chỗ','Cancel a hold')}}</h3><p>{{lang.pick('Vé đang giữ chưa phát sinh thanh toán. Khi hủy, ghế được giải phóng và không có khoản hoàn tiền.','Unpaid holds can be cancelled to release seats; no refund applies.')}}</p></article>
        <article class="card"><span>{{lang.pick('VÉ ĐÃ XÁC NHẬN','CONFIRMED TICKETS')}}</span><h3>{{lang.pick('Hoàn theo chính sách','Policy-based refunds')}}</h3><p>{{lang.pick('Mức hoàn được xác định theo số ngày còn lại trước giờ bay và chính sách đang hoạt động trong hệ thống.','Refunds depend on time before departure and the currently applicable policy.')}}</p></article>
        <article class="card"><span>PAYPAL</span><h3>{{lang.pick('Hoàn về nguồn gốc','Original payment source')}}</h3><p>{{lang.pick('Với giao dịch PayPal, khoản hoàn được xử lý về nguồn thanh toán ban đầu của giao dịch.','Eligible PayPal transactions are refunded to their original payment source.')}}</p></article>
      </section>

      <section class="policy-section">
        <div class="section-head"><div><div class="eyebrow">{{lang.pick('CHÍNH SÁCH HIỆN TẠI','CURRENT POLICY')}}</div><h2>{{lang.pick('Mức hoàn tiền đang áp dụng','Available refund rates')}}</h2></div><p>{{lang.pick('Các mức hoàn bên dưới được cập nhật theo chính sách hiện hành và thời gian còn lại trước giờ khởi hành.','The refund rates below reflect the active policy and time remaining before departure.')}}</p></div>
        @if(loading){<div class="card empty">{{lang.pick('Đang tải chính sách hoàn tiền…','Loading refund policy…')}}</div>}@else if(policies.length){
          <div class="policy-grid">
            @for(p of policies;track $index){<article class="policy"><div><span>{{lang.pick('Trước giờ bay','Before departure')}}</span><strong>{{range(p)}}</strong></div><b>{{p.refund_percentage||0}}%</b><small>{{lang.pick('mức hoàn','refunded')}}</small></article>}
          </div>
        }@else{<div class="card empty">{{lang.pick('Hiện chưa có chính sách hoàn tiền để hiển thị.','No refund policy is currently available.')}}</div>}
      </section>

      <section class="callout"><div><span>{{lang.pick('Cần xử lý booking ngay?','Need to manage your booking?')}}</span><h2>{{lang.pick('Vào “Chuyến đi của tôi” để xem mức hoàn dự kiến trước khi bấm hủy.','Open My trips to preview your refund before cancelling.')}}</h2></div><a class="btn btn-dark" routerLink="/trips">{{lang.pick('Mở chuyến đi','Open my trips')}}</a></section>
    </div>
  </div>`,
  styles:[`
    .service-page{background:#f4f7fa}.hero{background:radial-gradient(circle at 85% 10%,rgba(212,175,55,.25),transparent 28%),linear-gradient(135deg,#061827,#0d3150);color:#fff}.hero-inner{padding:72px 0;display:grid;grid-template-columns:1.2fr .8fr;gap:60px;align-items:center}.light{color:#f2c85f}.hero h1{font-size:48px;line-height:1.04;margin:10px 0 18px}.hero h1 span{color:#f2c85f}.hero p{max-width:620px;color:#bfd0dc;line-height:1.75;font-size:15px}.actions{display:flex;gap:10px;margin-top:24px}.ghost{border:1px solid rgba(255,255,255,.2);color:#fff;background:transparent}.refund-card{border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.06);backdrop-filter:blur(14px);border-radius:26px;padding:22px}.refund-card>span{font-size:10px;letter-spacing:.16em;color:#f2c85f;font-weight:900}.refund-card div{display:grid;grid-template-columns:42px 1fr;gap:12px;align-items:center;border-top:1px solid rgba(255,255,255,.09);padding:14px 0}.refund-card div:first-of-type{margin-top:10px}.refund-card b{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#d4af37;color:#071b2e}.refund-card p{margin:0;font-size:12px;line-height:1.45}.body{padding:42px 0 70px}.principles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.principles .card{padding:22px}.principles span{font-size:9px;letter-spacing:.12em;font-weight:900;color:#a47714}.principles h3{color:#0a2540;margin:8px 0}.principles p{color:#657789;line-height:1.65;font-size:12px}.policy-section{margin-top:48px}.section-head{display:flex;justify-content:space-between;gap:36px;align-items:flex-end;margin-bottom:18px}.section-head h2{font-size:30px;color:#0a2540;margin:6px 0}.section-head p{max-width:480px;color:#6b7e90;line-height:1.6;font-size:12px}.policy-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.policy{background:#fff;border:1px solid #e0e8ee;border-radius:20px;padding:20px;box-shadow:0 10px 28px rgba(10,37,64,.04)}.policy span,.policy small{display:block;color:#748596;font-size:10px;text-transform:uppercase;font-weight:800}.policy strong{display:block;color:#173750;margin-top:5px}.policy>b{display:block;font-size:34px;color:#ad7d16;margin-top:18px}.policy small{margin-top:2px}.callout{margin-top:46px;background:linear-gradient(120deg,#fff3c6,#fff9e8);border:1px solid #ecd58b;border-radius:24px;padding:25px 28px;display:flex;justify-content:space-between;align-items:center;gap:24px}.callout span{font-size:10px;font-weight:900;color:#9a7014}.callout h2{margin:5px 0 0;color:#162f45;font-size:20px;max-width:690px}@media(max-width:900px){.hero-inner{grid-template-columns:1fr}.principles,.policy-grid{grid-template-columns:1fr 1fr}.section-head{align-items:flex-start;flex-direction:column}.hero h1{font-size:40px}}@media(max-width:600px){.hero-inner{padding:48px 0}.hero h1{font-size:34px}.principles,.policy-grid{grid-template-columns:1fr}.callout{align-items:flex-start;flex-direction:column}.actions{flex-direction:column}.actions .btn{width:100%;text-align:center}}
  `]
})
export class CancellationRefundComponent{
  readonly lang=inject(LanguageService);
  api=inject(ApiService);policies:any[]=[];loading=true;
  constructor(){this.api.policies().subscribe({next:r=>{this.policies=(r||[]).slice().sort((a:any,b:any)=>Number(b.min_days_before||0)-Number(a.min_days_before||0));this.loading=false},error:()=>{this.loading=false}})}
  range(p:any){const min=Number(p.min_days_before??0);const max=p.max_days_before==null?null:Number(p.max_days_before);const day=this.lang.pick('ngày','days');if(max==null)return this.lang.pick('Từ','From')+' '+min+' '+day;if(min===max)return min+' '+day;return min+' – '+max+' '+day}
}
