import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LanguageService } from '../core/language.service';

@Component({standalone:true,imports:[RouterLink],template:`
<div class="sky-page">
  <section class="sky-hero">
    <div class="container hero-grid">
      <div><div class="eyebrow hero-eye">APTECH SKYMILES</div><h1>Mỗi dặm bay đưa bạn đến<br><span>một hạng thành viên mới.</span></h1><p>Tích lũy theo quãng đường của vé đã xác nhận, nhận ưu đãi giá tự động và theo dõi tiến độ lên hạng ngay trong tài khoản.</p><div class="hero-actions"><a class="btn btn-primary" routerLink="/">Tìm chuyến bay</a>@if(!auth.authenticated()){<a class="btn hero-outline" routerLink="/auth">Đăng nhập SkyMiles</a>}@else{<a class="btn hero-outline" routerLink="/profile">Hồ sơ của tôi</a>}</div></div>
      <div class="member-card"><div class="member-top"><span>APTECH AIRLINES</span><b>{{tier}}</b></div><div class="miles-label">AVAILABLE SKYMILES</div><strong class="miles">{{format(miles)}}</strong><div class="member-name">{{auth.authenticated()?(auth.user()?.first_name+' '+auth.user()?.last_name):'SKYMILES MEMBER'}}</div><div class="card-route"><span>SGN</span><i></i><span>WORLD</span></div></div>
    </div>
  </section>

  <div class="container content">
    <section class="progress-card card">
      <div><span>HẠNG HIỆN TẠI</span><h2>{{tier}}</h2><p>{{tierDiscount}}% ưu đãi SkyMiles được áp dụng khi hệ thống tính giá vé.</p></div>
      <div class="progress-area">@if(nextTier){<div class="progress-head"><strong>Còn {{format(nextThreshold-miles)}} miles để lên {{nextTier}}</strong><span>{{progress}}%</span></div><div class="bar"><i [style.width.%]="progress"></i></div><small>{{format(tierFloor)}} / {{format(nextThreshold)}} miles</small>}@else{<div class="max-tier">Bạn đã đạt hạng cao nhất trong chương trình hiện tại.</div>}</div>
    </section>

    <div class="section-head"><div><div class="eyebrow">HẠNG THÀNH VIÊN</div><h2>Bốn hạng thành viên, quyền lợi tăng dần</h2></div><p>Số SkyMiles hiện có tại thời điểm báo giá quyết định hạng thành viên và mức ưu đãi áp dụng.</p></div>
    <section class="tiers">
      @for(t of tiers;track t.name){<article class="tier card" [class.current]="tier===t.name"><div class="tier-head"><span>{{t.name}}</span>@if(tier===t.name){<b>HẠNG CỦA BẠN</b>}</div><strong>{{t.range}}</strong><div class="discount">{{t.discount}}%</div><p>{{language.translate(t.copy)}}</p></article>}
    </section>

    <section class="earn card"><div><div class="eyebrow">CÁCH TÍCH LŨY</div><h2>Tích lũy theo quãng đường thực tế</h2><p>Khi vé được xác nhận, SkyMiles được cộng theo quãng đường của các chặng bay. Vé nối chuyến tính tổng các chặng; khi đổi hoặc hủy vé, số dặm được điều chỉnh theo hành trình còn hiệu lực.</p></div><div class="flow"><div><b>01</b><span>Chọn chuyến</span></div><i>→</i><div><b>02</b><span>Xác nhận vé</span></div><i>→</i><div><b>03</b><span>Cộng SkyMiles</span></div><i>→</i><div><b>04</b><span>Tự động lên hạng</span></div></div></section>

    <section class="benefits"><article><span>ƯU ĐÃI</span><h3>Giảm giá tự động</h3><p>Member 0%, Silver 3%, Gold 7%, Platinum 12% theo hạng thành viên hiện tại.</p></article><article><span>ĐỔI CHUYẾN</span><h3>Điều chỉnh theo hành trình mới</h3><p>Đổi chuyến có thể làm tăng hoặc giảm SkyMiles theo tổng quãng đường của các chặng được thay.</p></article><article><span>HỦY VÉ</span><h3>Đồng bộ khi hủy vé</h3><p>SkyMiles đã cộng được điều chỉnh khi vé bị hủy để phản ánh hành trình còn hiệu lực.</p></article></section>
  </div>
</div>`,styles:[`
.sky-page{background:#f4f7fa}.sky-hero{background:radial-gradient(circle at 75% 25%,rgba(212,175,55,.23),transparent 24%),linear-gradient(135deg,#041522,#0b2e49);color:#fff}.hero-grid{padding:76px 0;display:grid;grid-template-columns:1.15fr .85fr;gap:70px;align-items:center}.hero-eye{color:#f2c85f}.sky-hero h1{font-size:50px;line-height:1.04;margin:10px 0 18px}.sky-hero h1 span{color:#f2c85f}.sky-hero p{max-width:650px;color:#bed0dc;line-height:1.75}.hero-actions{display:flex;gap:10px;margin-top:24px}.hero-outline{border:1px solid rgba(255,255,255,.22);color:#fff}.member-card{min-height:285px;border-radius:28px;padding:28px;background:linear-gradient(145deg,#d5ae3f,#f4d878 45%,#bb8922);color:#071b2e;box-shadow:0 30px 80px rgba(0,0,0,.28);position:relative;overflow:hidden}.member-card:after{content:'';position:absolute;width:250px;height:250px;border:55px solid rgba(255,255,255,.16);border-radius:50%;right:-100px;bottom:-130px}.member-top{display:flex;justify-content:space-between;font-size:10px;font-weight:900;letter-spacing:.1em}.member-top b{background:#071b2e;color:#f4cf63;border-radius:999px;padding:7px 11px}.miles-label{margin-top:48px;font-size:9px;letter-spacing:.14em;font-weight:900}.miles{display:block;font-size:48px;margin-top:4px}.member-name{font-weight:900;margin-top:30px;text-transform:uppercase}.card-route{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:10px;font-weight:900}.card-route i{width:70px;height:1px;background:#071b2e;position:relative}.card-route i:after{content:'›';position:absolute;right:-2px;top:-9px;font-size:17px}.content{padding:34px 0 72px}.progress-card{padding:25px;display:grid;grid-template-columns:300px 1fr;gap:40px;align-items:center}.progress-card>div>span{font-size:9px;letter-spacing:.13em;color:#a47614;font-weight:900}.progress-card h2{font-size:30px;color:#0a2540;margin:5px 0}.progress-card p{font-size:12px;color:#687a8b}.progress-head{display:flex;justify-content:space-between;color:#17344d;font-size:12px}.bar{height:12px;background:#e7edf1;border-radius:999px;overflow:hidden;margin:10px 0}.bar i{height:100%;display:block;background:linear-gradient(90deg,#b8891f,#f0c95a);border-radius:999px}.progress-area small{color:#7b8997}.max-tier{padding:18px;border-radius:14px;background:#fff7df;color:#72550d;font-weight:800}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:35px;margin:48px 0 18px}.section-head h2{font-size:30px;color:#0a2540;margin:6px 0}.section-head p{max-width:460px;color:#6d7d8c;font-size:12px;line-height:1.6}.tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.tier{padding:21px;position:relative;overflow:hidden}.tier.current{border-color:#d9b548;box-shadow:0 0 0 3px rgba(217,181,72,.13)}.tier-head{display:flex;justify-content:space-between;gap:8px}.tier-head span{font-weight:900;color:#0b2b44}.tier-head b{font-size:7px;color:#8b6610;background:#fff3c5;border-radius:999px;padding:5px 7px}.tier>strong{display:block;font-size:11px;color:#718190;margin-top:8px}.discount{font-size:38px;color:#bd8b18;font-weight:900;margin:22px 0 5px}.tier p{font-size:11px;color:#6a7b8c;line-height:1.55}.earn{margin-top:22px;padding:28px;display:grid;grid-template-columns:.9fr 1.1fr;gap:36px;align-items:center}.earn h2{color:#0a2540;margin:6px 0}.earn p{color:#697b8c;line-height:1.65;font-size:12px}.flow{display:flex;align-items:center;justify-content:space-between;gap:8px}.flow div{display:grid;gap:7px;text-align:center}.flow b{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#0a2540;color:#f2c85f;margin:auto}.flow span{font-size:10px;font-weight:800;color:#40586b}.flow i{font-style:normal;color:#c49a34}.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}.benefits article{background:#0a2540;color:#fff;border-radius:20px;padding:22px}.benefits span{font-size:9px;letter-spacing:.13em;color:#f2c85f;font-weight:900}.benefits h3{margin:9px 0}.benefits p{color:#b8c8d3;font-size:12px;line-height:1.6}@media(max-width:950px){.hero-grid{grid-template-columns:1fr}.progress-card,.earn{grid-template-columns:1fr}.tiers{grid-template-columns:1fr 1fr}.benefits{grid-template-columns:1fr}.sky-hero h1{font-size:42px}}@media(max-width:600px){.hero-grid{padding:50px 0}.sky-hero h1{font-size:34px}.hero-actions{flex-direction:column}.tiers{grid-template-columns:1fr}.flow{overflow:auto;justify-content:flex-start}.section-head{align-items:flex-start;flex-direction:column}.progress-card{grid-template-columns:1fr}}
`]})
export class SkyMilesComponent{
  auth=inject(AuthService);
  readonly language=inject(LanguageService);
  tiers=[
    {name:'MEMBER',range:'0 – 19.999 miles',discount:0,copy:'Bắt đầu tích lũy trên mọi vé đã xác nhận.'},
    {name:'SILVER',range:'20.000 – 49.999 miles',discount:3,copy:'Mở mức giảm SkyMiles 3% trong pricing.'},
    {name:'GOLD',range:'50.000 – 99.999 miles',discount:7,copy:'Mức giảm SkyMiles tăng lên 7%.'},
    {name:'PLATINUM',range:'100.000+ miles',discount:12,copy:'Hạng cao nhất hiện tại với mức giảm 12%.'},
  ];
  get miles(){return Number(this.auth.user()?.sky_miles||0)}
  get tier(){if(this.miles<20000)return'MEMBER';if(this.miles<50000)return'SILVER';if(this.miles<100000)return'GOLD';return'PLATINUM'}
  get tierDiscount(){return this.tier==='SILVER'?3:this.tier==='GOLD'?7:this.tier==='PLATINUM'?12:0}
  get nextTier(){return this.miles<20000?'SILVER':this.miles<50000?'GOLD':this.miles<100000?'PLATINUM':''}
  get nextThreshold(){return this.miles<20000?20000:this.miles<50000?50000:100000}
  get tierFloor(){return this.miles<20000?0:this.miles<50000?20000:this.miles<100000?50000:100000}
  get progress(){if(!this.nextTier)return 100;const span=this.nextThreshold-this.tierFloor;return Math.max(0,Math.min(100,Math.round(((this.miles-this.tierFloor)/span)*100)))}
  format(v:number){return new Intl.NumberFormat(this.language.isEnglish()?'en-US':'vi-VN').format(Math.max(0,Math.round(v||0)))}
}
