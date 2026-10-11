import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '../core/language.service';

@Component({
  standalone:true,
  imports:[RouterLink],
  template:`
  <div class="container page seat-info">
    <div class="eyebrow">{{t('TRẢI NGHIỆM CHỖ NGỒI','SEAT EXPERIENCE')}}</div><h1 class="title">{{t('Chọn ghế theo cách bạn muốn','Choose your preferred seat')}}</h1><p class="subtitle intro">{{t('Sơ đồ ghế hiển thị phí thực tế theo từng ghế và từng chuyến. Giá dưới đây là các quy tắc Economy mặc định; Admin có thể cấu hình hoặc ghi đè theo chuyến.','The seat map shows the actual fee for every seat and flight. The prices below are the default Economy rules; admins can configure or override them per flight.')}}</p>
    <section class="seat-hero card"><div><span>{{t('GHẾ CỦA BẠN · LỰA CHỌN CỦA BẠN','YOUR SEAT · YOUR CHOICE')}}</span><h2>{{t('Từ ghế tiêu chuẩn đến chỗ để chân rộng','From standard seats to extra legroom')}}</h2><p>{{t('Mỗi ghế giữ bản chụp giá tại thời điểm đặt để phí của đặt chỗ không thay đổi ngoài ý muốn khi Admin cập nhật bảng giá sau đó.','Each seat keeps a pricing snapshot at booking time, preventing later catalog updates from unexpectedly changing the booking fee.')}}</p><a class="btn btn-primary" routerLink="/">{{t('Tìm chuyến để chọn ghế','Find a flight and choose a seat')}}</a></div><div class="mini-cabin"><div class="nose">{{t('ĐẦU MÁY BAY','NOSE')}}</div>@for(row of [1,2,3,4];track row){<div class="seat-row"><b>{{row}}A</b><b>{{row}}B</b><i></i><b>{{row}}C</b><b>{{row}}D</b></div>}<div class="tail">{{t('ĐUÔI MÁY BAY','TAIL')}}</div></div></section>
    <section class="fees">
      @for(f of feeRules;track f.name){<article class="card"><span>{{f.tag}}</span><h3>{{language.translate(f.name)}}</h3><strong>{{money(f.amount)}}</strong><p>{{language.translate(f.desc)}}</p></article>}
    </section>
    <section class="explain"><div><span>{{t('GIÁ CUỐI CÙNG','FINAL PRICE')}}</span><h2>{{t('Luôn xem trực tiếp trên sơ đồ ghế','Always check the live seat map')}}</h2><p>{{t('Quy tắc có thể kết hợp theo vị trí, hạng ghế, chỗ để chân, hàng thoát hiểm hoặc cấu hình riêng của Admin. Vì vậy giá hiển thị trên ghế ở bước chọn chỗ là giá cần dùng khi quyết định.','Rules can combine position, cabin, extra legroom, exit row and admin overrides. The price shown on the seat-selection map is therefore the price to use when deciding.')}}</p></div><div class="legend"><p><i class="free"></i><span>{{t('Ghế không phụ phí','No seat fee')}}</span></p><p><i class="paid"></i><span>{{t('Ghế có phụ phí','Seat fee applies')}}</span></p><p><i class="locked"></i><span>{{t('Ghế không khả dụng / đã khóa','Unavailable / blocked seat')}}</span></p></div></section>
  </div>`,
  styles:[`
    .seat-info{padding-top:42px;padding-bottom:70px}.intro{max-width:820px}.seat-hero{margin-top:22px;padding:32px;display:grid;grid-template-columns:1fr 460px;gap:40px;background:linear-gradient(135deg,#071b2e,#123e5e);color:#fff}.seat-hero>div>span{font-size:9px;letter-spacing:.16em;color:#f2c85f;font-weight:900}.seat-hero h2{font-size:34px;margin:8px 0 12px}.seat-hero p{color:#b9cad6;line-height:1.7;max-width:650px}.seat-hero .btn{margin-top:12px}.mini-cabin{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:999px;padding:14px 32px;display:flex;align-items:center;gap:9px;overflow:auto}.nose,.tail{font-size:8px;color:#8da4b5;font-weight:900;letter-spacing:.12em}.seat-row{display:flex;gap:4px;align-items:center}.seat-row b{width:32px;height:36px;border-radius:9px 9px 6px 6px;background:#f8f5e8;color:#0b2a43;display:grid;place-items:center;font-size:9px}.seat-row:nth-child(3) b,.seat-row:nth-child(4) b{background:#f2c85f}.seat-row i{width:10px}.fees{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}.fees article{padding:22px}.fees span{font-size:9px;letter-spacing:.12em;color:#a37615;font-weight:900}.fees h3{color:#102e46;margin:8px 0}.fees strong{font-size:24px;color:#c18d18}.fees p{font-size:12px;line-height:1.6;color:#687b8b}.explain{margin-top:22px;background:#fff;border:1px solid #dfe7ed;border-radius:22px;padding:26px;display:grid;grid-template-columns:1.3fr .7fr;gap:34px}.explain>div>span{font-size:9px;letter-spacing:.12em;color:#a37615;font-weight:900}.explain h2{color:#0b2942;margin:7px 0}.explain p{color:#687b8b;line-height:1.65;font-size:12px}.legend{display:grid;align-content:center;gap:7px}.legend p{display:flex;align-items:center;gap:10px;margin:0}.legend i{width:18px;height:18px;border-radius:6px}.legend .free{background:#eef3f6;border:1px solid #d7e1e7}.legend .paid{background:#f2c85f}.legend .locked{background:#9aa9b4}.legend span{font-size:12px;color:#40576a}@media(max-width:1000px){.seat-hero{grid-template-columns:1fr}.mini-cabin{min-height:110px}.fees{grid-template-columns:1fr 1fr}}@media(max-width:650px){.seat-hero{padding:24px}.seat-hero h2{font-size:29px}.fees,.explain{grid-template-columns:1fr}.mini-cabin{border-radius:26px}}
  `]
})
export class SeatFeesInfoComponent{
  readonly language=inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  feeRules=[
    {tag:'STANDARD',name:'Ghế tiêu chuẩn',amount:0,desc:'Ghế không kích hoạt pricing rule hoặc được hệ thống gán tự động có thể không phát sinh phụ phí.'},
    {tag:'AISLE',name:'Ghế lối đi',amount:30000,desc:'Baseline Economy hiện tại cho vị trí aisle.'},
    {tag:'WINDOW',name:'Ghế cửa sổ',amount:50000,desc:'Baseline Economy hiện tại cho vị trí window.'},
    {tag:'FRONT ZONE',name:'Khu vực phía trước',amount:80000,desc:'Ưu tiên vị trí phía trước khoang Economy.'},
    {tag:'EXTRA LEGROOM',name:'Chỗ để chân rộng',amount:100000,desc:'Phụ phí mặc định cho ghế Economy extra legroom.'},
    {tag:'EXIT ROW',name:'Hàng thoát hiểm',amount:150000,desc:'Baseline Economy cho exit row; điều kiện ghế vẫn phụ thuộc seat map.'},
  ];
  money(v:number){return new Intl.NumberFormat(this.language.isEnglish()?'en-US':'vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v)}
}
