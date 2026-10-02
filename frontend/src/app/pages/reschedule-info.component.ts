import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  standalone:true,
  imports:[RouterLink],
  template:`
  <div class="container page info-page">
    <section class="hero card">
      <div><div class="eyebrow">FLEXIBLE TRAVEL</div><h1>Đổi chuyến mà vẫn giữ nguyên hành trình.</h1><p>Bạn có thể đổi ngày hoặc chuyến bay khác trên cùng tuyến của vé gốc. Chênh lệch giá, ghế và SkyMiles được cập nhật trước khi bạn xác nhận.</p><div class="hero-actions"><a class="btn btn-primary" routerLink="/reschedule">Bắt đầu đổi chuyến</a><a class="btn btn-outline" routerLink="/trips">Chuyến đi của tôi</a></div></div>
      <div class="route-preview"><span>VÉ GỐC</span><div><b>SGN</b><i>→</i><b>HAN</b></div><small>Tuyến được giữ nguyên</small><span>CHUYẾN MỚI</span><div><b>SGN</b><i>→</i><b>HAN</b></div><small>Đổi ngày, chuyến bay thẳng hoặc nối chuyến</small></div>
    </section>
    <section class="steps">
      <article><b>01</b><h3>Tra cứu vé</h3><p>Vé đã xác nhận có thể bắt đầu quy trình đổi chuyến.</p></article>
      <article><b>02</b><h3>Chọn ngày mới</h3><p>Điểm đi và điểm đến giữ nguyên theo vé gốc; bạn chọn ngày hoặc chuyến bay mới.</p></article>
      <article><b>03</b><h3>So sánh giá</h3><p>Hệ thống cập nhật giá vé, phụ phí ghế và SkyMiles theo hành trình mới.</p></article>
      <article><b>04</b><h3>Thanh toán / hoàn</h3><p>Chênh lệch dương thanh toán PayPal; chênh lệch âm hoàn về nguồn gốc.</p></article>
    </section>
    <section class="card price-logic"><div><span>CHÊNH LỆCH DƯƠNG</span><strong>Hành trình mới đắt hơn</strong><p>Bạn thanh toán phần chênh lệch qua PayPal Checkout trước khi đổi chuyến hoàn tất.</p></div><div><span>CHÊNH LỆCH = 0</span><strong>Không cần thanh toán thêm</strong><p>Hệ thống đổi chuyến trực tiếp sau khi bạn xác nhận.</p></div><div><span>CHÊNH LỆCH ÂM</span><strong>Hoàn phần còn lại</strong><p>Khoản chênh lệch được xử lý về nguồn thanh toán ban đầu.</p></div></section>
    <section class="note"><strong>Không đổi sang tuyến khác.</strong><span>Ví dụ SGN → HAN có thể đổi sang một chuyến SGN → HAN khác. SGN → DAD là một hành trình khác và không thuộc phạm vi đổi chuyến thông thường.</span></section>
  </div>`,
  styles:[`
    .info-page{padding-top:42px;padding-bottom:70px}.hero{padding:38px;background:radial-gradient(circle at 80% 20%,rgba(212,175,55,.18),transparent 25%),linear-gradient(135deg,#071b2e,#123b59);color:#fff;display:grid;grid-template-columns:1.3fr .7fr;gap:50px;align-items:center}.hero h1{font-size:42px;line-height:1.08;margin:9px 0 15px}.hero p{color:#c5d3dd;line-height:1.7;max-width:690px}.hero-actions{display:flex;gap:10px;margin-top:22px}.hero .btn-outline{color:#fff;border-color:rgba(255,255,255,.25)}.route-preview{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:22px}.route-preview>span{display:block;font-size:9px;letter-spacing:.14em;color:#f2c85f;font-weight:900;margin-top:13px}.route-preview>span:first-child{margin-top:0}.route-preview div{display:flex;align-items:center;gap:16px;font-size:29px;margin:5px 0}.route-preview i{color:#d4af37;font-style:normal}.route-preview small{color:#9fb2c0}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:22px}.steps article{background:#fff;border:1px solid #e2e9ee;border-radius:20px;padding:22px}.steps article>b{color:#d0a735;font-size:12px}.steps h3{color:#0b2942;margin:12px 0 8px}.steps p{color:#687b8c;line-height:1.55;font-size:12px}.price-logic{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;overflow:hidden;margin-top:22px;padding:0;background:#e2e9ee}.price-logic>div{background:#fff;padding:24px}.price-logic span{font-size:9px;letter-spacing:.12em;font-weight:900;color:#a87812}.price-logic strong{display:block;color:#0d2d46;margin-top:8px}.price-logic p{font-size:12px;color:#687b8c;line-height:1.6}.note{margin-top:22px;border-radius:18px;padding:16px 18px;background:#fff6d8;color:#6e5212;display:flex;gap:12px;align-items:flex-start}.note strong{white-space:nowrap}.note span{font-size:12px;line-height:1.55}@media(max-width:900px){.hero{grid-template-columns:1fr}.steps{grid-template-columns:1fr 1fr}.price-logic{grid-template-columns:1fr}}@media(max-width:600px){.hero{padding:25px}.hero h1{font-size:34px}.steps{grid-template-columns:1fr}.hero-actions{flex-direction:column}.note{flex-direction:column}.note strong{white-space:normal}}
  `]
})
export class RescheduleInfoComponent{}
