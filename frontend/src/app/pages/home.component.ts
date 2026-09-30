import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { BookingStateService } from '../core/booking-state.service';
import { IconComponent } from '../shared/icon.component';

type LocationField = 'origin' | 'destination';
type LocationSuggestion = {
  value: string;
  title: string;
  detail: string;
  badge: string;
  direct: boolean;
};

@Component({
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <section class="hero">
      <div class="container hero-inner">
        <div class="copy">
          <div class="eyebrow gold">APTECH AIRLINES · BOOKING PLATFORM</div>
          <h1>Hành trình bắt đầu từ một lựa chọn đúng.</h1>
          <p>Tìm chuyến thẳng, chuyến nối, giá động và số ghế còn lại trong cùng một trải nghiệm.</p>
          <div class="hero-points">
            <span><app-icon name="shield" [size]="17"/> Giá từ máy chủ</span>
            <span><app-icon name="ticket" [size]="17"/> Giữ chỗ / mua ngay</span>
            <span><app-icon name="swap" [size]="17"/> Đổi & hủy vé</span>
          </div>
        </div>

        <div class="search card">
          <div class="trip-tabs">
            <button [class.on]="!roundTrip" (click)="roundTrip=false">Một chiều</button>
            <button [class.on]="roundTrip" (click)="roundTrip=true">Khứ hồi</button>
          </div>

          <div class="grid grid-2">
            <div class="field location-field">
              <span>Nơi đi</span>
              <input
                class="control"
                [(ngModel)]="origin"
                (input)="suggestLocation('origin')"
                (focus)="suggestLocation('origin')"
                (blur)="closeSuggestions('origin')"
                autocomplete="off"
                placeholder="SGN hoặc Ho Chi Minh"
              >
              @if(suggestions.origin.length){
                <div class="suggestions">
                  @for(s of suggestions.origin;track s.badge+'-'+s.value+'-'+$index){
                    <button type="button" (mousedown)="selectLocation('origin',s)">
                      <span class="suggest-main"><b>{{s.title}}</b><small>{{s.detail}}</small></span>
                      <span class="suggest-code" [class.reference]="!s.direct">{{s.badge}}</span>
                    </button>
                  }
                </div>
              }
            </div>

            <div class="field location-field">
              <span>Nơi đến</span>
              <input
                class="control"
                [(ngModel)]="destination"
                (input)="suggestLocation('destination')"
                (focus)="suggestLocation('destination')"
                (blur)="closeSuggestions('destination')"
                autocomplete="off"
                placeholder="HAN hoặc Ha Noi"
              >
              @if(suggestions.destination.length){
                <div class="suggestions">
                  @for(s of suggestions.destination;track s.badge+'-'+s.value+'-'+$index){
                    <button type="button" (mousedown)="selectLocation('destination',s)">
                      <span class="suggest-main"><b>{{s.title}}</b><small>{{s.detail}}</small></span>
                      <span class="suggest-code" [class.reference]="!s.direct">{{s.badge}}</span>
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <p class="location-help">Bạn có thể nhập mã IATA hoặc tên thành phố. Nếu điểm đó chưa được khai thác trực tiếp, hệ thống sẽ đề xuất sân bay gần nhất.</p>

          <label class="range-toggle"><input type="checkbox" [(ngModel)]="flexibleDates" (change)="toggleFlexibleDates()"> Tìm chuyến trong khoảng ngày</label>

          <div class="grid grid-3 row">
            <div class="field"><span>Ngày đi</span><input class="control" type="date" [(ngModel)]="departure" [min]="minDate" [max]="maxDate"></div>
            @if(flexibleDates){<div class="field"><span>Đến ngày</span><input class="control" type="date" [(ngModel)]="departureEnd" [min]="departure||minDate" [max]="maxDate"></div>}
            <div class="field"><span>Ngày về</span><input class="control" type="date" [(ngModel)]="returnDate" [min]="departureEnd||departure||minDate" [max]="maxDate" [disabled]="!roundTrip"></div>
            <div class="field"><span>Hạng vé</span><select class="control" [(ngModel)]="cabin"><option value="ECONOMY">Phổ thông</option><option value="CLUB">Club</option><option value="BUSINESS">Thương gia</option><option value="FIRST">Hạng nhất</option></select></div>
          </div>

          <div class="travellers">
            <div><span>Người lớn</span><b><button (click)="adults=Math.max(1,adults-1)">−</button>{{adults}}<button (click)="adults=adults+1">+</button></b></div>
            <div><span>Trẻ em</span><b><button (click)="children=Math.max(0,children-1)">−</button>{{children}}<button (click)="children=children+1">+</button></b></div>
            <div><span>Cao tuổi</span><b><button (click)="seniors=Math.max(0,seniors-1)">−</button>{{seniors}}<button (click)="seniors=seniors+1">+</button></b></div>
          </div>

          @if(error){<p class="error">{{error}}</p>}
          <button class="btn btn-primary full" (click)="search()"><app-icon name="search" [size]="18"/>Tìm chuyến bay</button>
        </div>
      </div>
    </section>

    <section class="container page">
      <div class="section-head"><div><div class="eyebrow">THEO ĐÚNG ĐỀ BÀI</div><h2>Một hệ thống, ba vai trò</h2></div></div>
      <div class="grid grid-3 feature">
        <article class="card"><app-icon name="search" [size]="26"/><h3>Khách vãng lai</h3><p>Xem lịch bay, giá, số ghế, chuyến nối mà không cần tài khoản.</p></article>
        <article class="card"><app-icon name="user" [size]="26"/><h3>Khách thành viên</h3><p>Giữ chỗ, mua vé, chọn ghế, SkyMiles, đổi và hủy chuyến.</p></article>
        <article class="card"><app-icon name="shield" [size]="26"/><h3>Nhân viên / Quản trị viên</h3><p>Quản lý đặt chỗ, khách hàng, lịch bay, chính sách và vận hành ghế.</p></article>
      </div>
    </section>
  `,
  styles: [`
    .hero{background:radial-gradient(circle at 80% 10%,#214f74 0,transparent 30%),linear-gradient(135deg,#061725,#0a2944);color:white;padding:72px 0 110px}.hero-inner{display:grid;grid-template-columns:1fr 1.05fr;gap:50px;align-items:center}.gold{color:#f2c85f}.copy h1{font-size:clamp(42px,5vw,68px);line-height:1.02;letter-spacing:-.045em;margin:15px 0}.copy p{color:#c7d5e0;line-height:1.7;font-size:17px;max-width:600px}.hero-points{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.hero-points span{display:flex;gap:7px;align-items:center;border:1px solid rgba(255,255,255,.14);padding:8px 11px;border-radius:999px;color:#dce6ed;font-size:12px}.search{padding:26px;box-shadow:0 30px 70px rgba(0,0,0,.25);overflow:visible}.trip-tabs{display:flex;gap:8px;margin-bottom:18px}.trip-tabs button{border:0;border-radius:999px;padding:9px 15px;font-weight:800;background:#edf2f6;color:#657487}.trip-tabs button.on{background:#071b2e;color:#fff}.row{margin-top:11px}.location-field{position:relative}.location-help{margin:9px 2px 0;color:#6d7f91;font-size:11px;line-height:1.5}.range-toggle{display:flex;align-items:center;gap:8px;margin:13px 2px 0;color:#314b60;font-size:12px;font-weight:700}.range-toggle input{accent-color:#0a2540}.suggestions{position:absolute;left:0;right:0;top:calc(100% + 7px);z-index:20;background:#fff;border:1px solid #d9e2e9;border-radius:14px;box-shadow:0 16px 38px rgba(6,23,37,.18);max-height:320px;overflow:auto;padding:6px}.suggestions button{width:100%;border:0;background:#fff;border-radius:10px;padding:10px 11px;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;cursor:pointer}.suggestions button:hover{background:#f4f7f9}.suggest-main{display:grid;gap:3px;min-width:0}.suggest-main b{font-size:13px;color:#102b42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.suggest-main small{font-size:10px;color:#758493;line-height:1.35}.suggest-code{flex:0 0 auto;border-radius:999px;padding:5px 8px;background:#e9f5ef;color:#08734f;font-size:10px;font-weight:900}.suggest-code.reference{background:#fff4d6;color:#74550e}.travellers{display:flex;justify-content:space-between;gap:12px;margin:20px 0}.travellers>div{display:grid;gap:7px}.travellers span{font-size:11px;text-transform:uppercase;font-weight:800;color:#708093}.travellers b{display:flex;align-items:center;gap:9px;color:#071b2e}.travellers button{width:28px;height:28px;border-radius:50%;border:1px solid #d6e0e8;background:#fff}.full{width:100%;margin-top:6px}.feature article{padding:24px}.feature app-icon{color:#b17a16}.feature h3{color:#071b2e}.feature p{color:#68778a;line-height:1.6}@media(max-width:900px){.hero-inner{grid-template-columns:1fr}.hero{padding-top:45px}.copy{text-align:center}.copy p{margin-inline:auto}.hero-points{justify-content:center}}@media(max-width:620px){.travellers{flex-wrap:wrap}.travellers>div{min-width:28%}}
  `]
})
export class HomeComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  private state = inject(BookingStateService);
  readonly Math = Math;

  origin = 'SGN';
  destination = 'HAN';
  departure = '';
  departureEnd = '';
  flexibleDates = false;
  returnDate = '';
  cabin = 'ECONOMY';
  roundTrip = false;
  adults = 1;
  children = 0;
  seniors = 0;
  error = '';
  minDate = this.localDate(new Date());
  maxDate = '';
  suggestions: Record<LocationField, LocationSuggestion[]> = { origin: [], destination: [] };
  private suggestionSeq: Record<LocationField, number> = { origin: 0, destination: 0 };

  constructor() {
    this.api.bookingWindow().subscribe({
      next: r => { this.minDate = r.min_date; this.maxDate = r.max_date; },
      error: () => { const d = new Date(); d.setDate(d.getDate() + 330); this.maxDate = this.localDate(d); }
    });
  }

  suggestLocation(field: LocationField) {
    const value = (field === 'origin' ? this.origin : this.destination).trim();
    const seq = ++this.suggestionSeq[field];
    if (value.length < 2) { this.suggestions[field] = []; return; }

    this.api.suggestLocations(value).subscribe({
      next: response => {
        if (seq !== this.suggestionSeq[field]) return;
        this.suggestions[field] = this.toSuggestions(response);
      },
      error: () => { if (seq === this.suggestionSeq[field]) this.suggestions[field] = []; }
    });
  }

  selectLocation(field: LocationField, suggestion: LocationSuggestion) {
    if (field === 'origin') this.origin = suggestion.value;
    else this.destination = suggestion.value;
    this.suggestions[field] = [];
    this.suggestionSeq[field]++;
  }

  closeSuggestions(field: LocationField) {
    setTimeout(() => { this.suggestions[field] = []; }, 140);
  }

  toggleFlexibleDates() {
    if (!this.flexibleDates) this.departureEnd = '';
  }

  search() {
    this.error = '';
    const origin = this.origin.trim();
    const destination = this.destination.trim();
    if (!origin || !destination || !this.departure) { this.error = 'Vui lòng nhập nơi đi, nơi đến và ngày bay.'; return; }
    if (origin.toUpperCase() === destination.toUpperCase()) { this.error = 'Nơi đi và nơi đến phải khác nhau.'; return; }
    if (this.flexibleDates && (!this.departureEnd || this.departureEnd < this.departure)) { this.error = 'Khoảng ngày đi không hợp lệ.'; return; }
    const latestOutbound = this.flexibleDates ? this.departureEnd : this.departure;
    if (this.roundTrip && (!this.returnDate || this.returnDate < latestOutbound)) { this.error = 'Ngày về phải bằng hoặc sau ngày đi cuối cùng.'; return; }

    const q = {
      origin,
      destination,
      departure_date: this.departure,
      departure_date_end: this.flexibleDates ? this.departureEnd : undefined,
      return_date: this.roundTrip ? this.returnDate : undefined,
      cabin_class: this.cabin,
      adults: this.adults,
      children: this.children,
      seniors: this.seniors,
      include_connecting: true
    };
    this.state.beginSearch(q);
    this.router.navigate(['/results'], { queryParams: q });
  }

  private toSuggestions(response: any): LocationSuggestion[] {
    const airports = (response?.airports || []).map((a: any) => ({
      value: a.iata_code,
      title: `${a.city_name || a.airport_name} (${a.iata_code})`,
      detail: a.is_serviced_directly
        ? `${a.airport_name} · ${a.country_code || ''}`
        : a.nearest_airport_code
          ? `${a.airport_name} · gần ${a.nearest_airport_code}${a.distance_to_nearest_km != null ? ` · ${a.distance_to_nearest_km} km` : ''}`
          : `${a.airport_name} · sân bay tham chiếu`,
      badge: a.is_serviced_directly ? 'KHAI THÁC' : 'GẦN NHẤT',
      direct: !!a.is_serviced_directly
    }));

    const cities = (response?.cities || []).map((c: any) => ({
      value: c.city_code || c.name,
      title: c.name_vi || c.name,
      detail: `${c.country_code || ''}${c.iata_codes?.length ? ` · ${c.iata_codes.join(', ')}` : ''}`,
      badge: 'THÀNH PHỐ',
      direct: true
    }));

    const countries = (response?.countries || []).map((c: any) => ({
      value: c.code,
      title: c.name_vi || c.name,
      detail: `Tìm các sân bay được khai thác tại ${c.name}`,
      badge: 'QUỐC GIA',
      direct: true
    }));

    return [...airports, ...cities, ...countries].slice(0, 10);
  }

  private localDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
