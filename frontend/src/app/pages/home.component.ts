import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { BookingStateService } from '../core/booking-state.service';
import { LanguageService } from '../core/language.service';
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
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <section class="hero">
      <div class="container hero-inner">
        <div class="copy">
          <div class="eyebrow gold">APTECH AIRLINES · {{lang.pick('BAY XA HƠN','FLY BEYOND')}}</div>
          <h1>{{lang.pick('Tìm chuyến bay phù hợp cho hành trình của bạn.','Find the right flight for your journey.')}}</h1>
          <p>{{lang.pick('Tra cứu lịch bay, so sánh chuyến thẳng hoặc nối chuyến và đặt vé trong vài bước rõ ràng.','Explore schedules, compare direct and connecting flights, and book in a few simple steps.')}}</p>
          <div class="hero-points">
            <span><app-icon name="calendar" [size]="17"/> {{lang.pick('Lịch bay rõ ràng','Clear flight schedules')}}</span>
            <span><app-icon name="seat" [size]="17"/> {{lang.pick('Chọn ghế linh hoạt','Flexible seat selection')}}</span>
            <span><app-icon name="swap" [size]="17"/> {{lang.pick('Quản lý vé trực tuyến','Online ticket management')}}</span>
          </div>
        </div>

        <div class="search card">
          <div class="trip-tabs">
            <button [class.on]="!roundTrip" (click)="setRoundTrip(false)">{{lang.pick('Một chiều','One way')}}</button>
            <button [class.on]="roundTrip" (click)="setRoundTrip(true)">{{lang.pick('Khứ hồi','Round trip')}}</button>
          </div>

          <div class="grid grid-2">
            <div class="field location-field">
              <span>{{lang.pick('Nơi đi','From')}}</span>
              <input
                class="control"
                [(ngModel)]="origin"
                (input)="suggestLocation('origin')"
                (focus)="suggestLocation('origin')"
                (blur)="closeSuggestions('origin')"
                autocomplete="off"
                [placeholder]="lang.pick('SGN hoặc Hồ Chí Minh','SGN or Ho Chi Minh City')"
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
              <span>{{lang.pick('Nơi đến','To')}}</span>
              <input
                class="control"
                [(ngModel)]="destination"
                (input)="suggestLocation('destination')"
                (focus)="suggestLocation('destination')"
                (blur)="closeSuggestions('destination')"
                autocomplete="off"
                [placeholder]="lang.pick('HAN hoặc Hà Nội','HAN or Hanoi')"
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

          <p class="location-help">{{lang.pick('Bạn có thể nhập mã IATA hoặc tên thành phố. Nếu điểm đó chưa được khai thác trực tiếp, hệ thống sẽ đề xuất sân bay gần nhất.','Enter an IATA code or city name. If direct service is unavailable, we will suggest the closest served airport.')}}</p>

          <label class="range-toggle"><input type="checkbox" [(ngModel)]="flexibleDates" (change)="toggleFlexibleDates()"> {{lang.pick('Tìm chuyến trong khoảng ngày','Search a date range')}}</label>

          <div class="grid search-options row">
            <div class="field"><span>{{lang.pick('Ngày đi','Departure date')}}</span><input class="control" type="date" [(ngModel)]="departure" [min]="minDate" [max]="maxDate"></div>
            @if(flexibleDates){<div class="field"><span>{{lang.pick('Đến ngày','Through date')}}</span><input class="control" type="date" [(ngModel)]="departureEnd" [min]="departure||minDate" [max]="maxDate"></div>}
            @if(roundTrip){<div class="field"><span>{{lang.pick('Ngày về','Return date')}}</span><input class="control" type="date" [(ngModel)]="returnDate" [min]="departureEnd||departure||minDate" [max]="maxDate"></div>}
          </div>

          <div class="travellers">
            <div><span>{{lang.pick('Người lớn','Adults')}}</span><b><button (click)="adults=Math.max(1,adults-1)">−</button>{{adults}}<button (click)="adults=adults+1">+</button></b></div>
            <div><span>{{lang.pick('Trẻ em','Children')}}</span><b><button (click)="children=Math.max(0,children-1)">−</button>{{children}}<button (click)="children=children+1">+</button></b></div>
            <div><span>{{lang.pick('Cao tuổi','Seniors')}}</span><b><button (click)="seniors=Math.max(0,seniors-1)">−</button>{{seniors}}<button (click)="seniors=seniors+1">+</button></b></div>
          </div>

          
          <button class="btn btn-primary full" (click)="search()"><app-icon name="search" [size]="18"/>{{lang.pick('Tìm chuyến bay','Search flights')}}</button>
        </div>
      </div>
    </section>

    <section class="container experience-section" aria-labelledby="experience-heading">
      <div class="section-copy">
        <div class="eyebrow">{{lang.pick('TRẢI NGHIỆM BAY','FLIGHT EXPERIENCE')}}</div>
        <h2 id="experience-heading">{{lang.pick('Mọi thứ bạn cần cho một hành trình chủ động','Everything you need to travel with confidence')}}</h2>
        <p>{{lang.pick('Từ lúc tìm chuyến đến sau khi đặt vé, các thao tác quan trọng đều được thiết kế để khách hàng dễ theo dõi và tự quản lý.','From flight search to post-booking changes, essential actions are easy to track and manage.')}}</p>
      </div>
      <div class="grid grid-3 feature">
        <article class="card"><span class="feature-icon"><app-icon name="search" [size]="26"/></span><h3>{{lang.pick('Tìm chuyến dễ dàng','Easy flight search')}}</h3><p>{{lang.pick('Tra cứu chuyến thẳng và nối chuyến theo ngày, số hành khách và so sánh giá các hạng vé ngay trong kết quả.','Compare direct and connecting flights by date, passengers and fare class.')}}</p></article>
        <article class="card"><span class="feature-icon"><app-icon name="seat" [size]="26"/></span><h3>{{lang.pick('Chọn chỗ ngồi theo ý bạn','Choose your preferred seat')}}</h3><p>{{lang.pick('Xem sơ đồ ghế, vị trí ngồi và phụ phí trước khi hoàn tất đặt vé.','Review the seat map, seat location and fees before booking.')}}</p></article>
        <article class="card"><span class="feature-icon"><app-icon name="swap" [size]="26"/></span><h3>{{lang.pick('Quản lý chuyến đi trực tuyến','Manage trips online')}}</h3><p>{{lang.pick('Tra cứu vé, đổi chuyến hoặc hủy vé theo chính sách ngay trong tài khoản của bạn.','Track, reschedule or cancel eligible tickets in your account.')}}</p></article>
      </div>
    </section>

    <section class="service-band" aria-labelledby="services-heading">
      <div class="container">
        <div class="section-copy compact-copy">
          <div class="eyebrow">{{lang.pick('DỊCH VỤ NỔI BẬT','OUR SERVICES')}}</div>
          <h2 id="services-heading">{{lang.pick('Linh hoạt trước và sau khi đặt vé','Flexibility before and after booking')}}</h2>
          <p>{{lang.pick('Thông tin rõ ràng giúp bạn chủ động hơn khi kế hoạch thay đổi.','Clear information helps you adapt when plans change.')}}</p>
        </div>
        <div class="service-grid">
          <a class="service-card" routerLink="/lookup"><app-icon name="calendar" [size]="22"/><span><b>{{lang.pick('Tra cứu lịch bay','Flight schedules')}}</b><small>{{lang.pick('Xem giờ khởi hành và trạng thái chuyến bay.','View departure times and flight status.')}}</small></span><app-icon name="arrow" [size]="18"/></a>
          <a class="service-card" routerLink="/seat-fees"><app-icon name="seat" [size]="22"/><span><b>{{lang.pick('Ghế & phụ phí','Seats & fees')}}</b><small>{{lang.pick('Xem cách chọn ghế và mức phí áp dụng.','Learn about seat selection and applicable fees.')}}</small></span><app-icon name="arrow" [size]="18"/></a>
          <a class="service-card" routerLink="/reschedule-info"><app-icon name="swap" [size]="22"/><span><b>{{lang.pick('Đổi chuyến','Reschedule')}}</b><small>{{lang.pick('Đổi ngày hoặc chuyến bay trên hành trình phù hợp.','Change dates or flights for eligible itineraries.')}}</small></span><app-icon name="arrow" [size]="18"/></a>
          <a class="service-card" routerLink="/cancellation-refund"><app-icon name="ticket" [size]="22"/><span><b>{{lang.pick('Hủy vé & hoàn tiền','Cancellation & refunds')}}</b><small>{{lang.pick('Xem chính sách và quy trình hoàn tiền.','Review cancellation policies and refund procedures.')}}</small></span><app-icon name="arrow" [size]="18"/></a>
        </div>
      </div>
    </section>

    <section class="container seo-section" aria-labelledby="booking-heading">
      <div class="seo-copy">
        <div class="eyebrow">APTECH AIRLINES</div>
        <h2 id="booking-heading">{{lang.pick('Đặt vé máy bay và quản lý hành trình trong một nơi','Book flights and manage your trip in one place')}}</h2>
        <p>{{lang.pick('Aptech Airlines giúp bạn tìm chuyến bay theo điểm đi, điểm đến và ngày khởi hành; xem lựa chọn chuyến thẳng hoặc nối chuyến; so sánh hạng vé và kiểm tra chỗ ngồi trước khi đặt vé.','Search by origin, destination and departure date, compare direct or connecting flights and fares, and check seats before booking.')}}</p>
        <p>{{lang.pick('Sau khi có vé, bạn có thể theo dõi hành trình, tra cứu lịch bay, chọn ghế, đổi chuyến và xem chính sách hủy vé trực tuyến.','After booking, track your journey, check schedules, select seats, reschedule and review cancellation policies online.')}}</p>
      </div>
      <a class="btn btn-dark seo-cta" routerLink="/lookup">{{lang.pick('Xem lịch bay','View flight schedules')}} <app-icon name="arrow" [size]="17"/></a>
    </section>
  `,
  styles: [`
    .hero{background:radial-gradient(circle at 80% 10%,#214f74 0,transparent 30%),linear-gradient(135deg,#061725,#0a2944);color:white;padding:72px 0 96px}.hero-inner{display:grid;grid-template-columns:1fr 1.05fr;gap:50px;align-items:center}.gold{color:#f2c85f}.copy h1{font-size:clamp(42px,5vw,68px);line-height:1.02;letter-spacing:-.045em;margin:15px 0}.copy p{color:#c7d5e0;line-height:1.7;font-size:17px;max-width:600px}.hero-points{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.hero-points span{display:flex;gap:7px;align-items:center;border:1px solid rgba(255,255,255,.14);padding:8px 11px;border-radius:999px;color:#dce6ed;font-size:12px}.search{padding:26px;box-shadow:0 30px 70px rgba(0,0,0,.25);overflow:visible}.trip-tabs{display:flex;gap:8px;margin-bottom:18px}.trip-tabs button{border:0;border-radius:999px;padding:9px 15px;font-weight:800;background:#edf2f6;color:#657487}.trip-tabs button.on{background:#071b2e;color:#fff}.row{margin-top:11px}.search-options{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.location-field{position:relative}.location-help{margin:9px 2px 0;color:#6d7f91;font-size:11px;line-height:1.5}.range-toggle{display:flex;align-items:center;gap:8px;margin:13px 2px 0;color:#314b60;font-size:12px;font-weight:700}.range-toggle input{accent-color:#0a2540}.suggestions{position:absolute;left:0;right:0;top:calc(100% + 7px);z-index:20;background:#fff;border:1px solid #d9e2e9;border-radius:14px;box-shadow:0 16px 38px rgba(6,23,37,.18);max-height:320px;overflow:auto;padding:6px}.suggestions button{width:100%;border:0;background:#fff;border-radius:10px;padding:10px 11px;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;cursor:pointer}.suggestions button:hover{background:#f4f7f9}.suggest-main{display:grid;gap:3px;min-width:0}.suggest-main b{font-size:13px;color:#102b42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.suggest-main small{font-size:10px;color:#758493;line-height:1.35}.suggest-code{flex:0 0 auto;border-radius:999px;padding:5px 8px;background:#e9f5ef;color:#08734f;font-size:10px;font-weight:900}.suggest-code.reference{background:#fff4d6;color:#74550e}.travellers{display:flex;justify-content:space-between;gap:12px;margin:20px 0}.travellers>div{display:grid;gap:7px}.travellers span{font-size:11px;text-transform:uppercase;font-weight:800;color:#708093}.travellers b{display:flex;align-items:center;gap:9px;color:#071b2e}.travellers button{width:28px;height:28px;border-radius:50%;border:1px solid #d6e0e8;background:#fff}.full{width:100%;margin-top:6px}.experience-section{padding:72px 0}.section-copy{max-width:760px}.section-copy h2,.seo-copy h2{font-size:clamp(28px,3vw,40px);line-height:1.15;letter-spacing:-.03em;color:#071b2e;margin:8px 0 12px}.section-copy>p,.seo-copy p{color:#687b8c;line-height:1.7;margin:0}.feature{margin-top:26px}.feature article{padding:28px;min-height:220px}.feature-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;background:#fff6dc;color:#a56f0d}.feature h3{color:#071b2e;margin:20px 0 9px}.feature p{color:#68778a;line-height:1.65;margin:0}.service-band{background:#eef3f7;border-top:1px solid #e0e8ee;border-bottom:1px solid #e0e8ee;padding:64px 0}.compact-copy{max-width:680px}.service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:26px}.service-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;background:#fff;border:1px solid #dfe7ed;border-radius:18px;padding:18px 20px;box-shadow:0 8px 24px rgba(15,35,52,.04);transition:transform .18s,border-color .18s,box-shadow .18s}.service-card:hover{transform:translateY(-2px);border-color:#d6b35a;box-shadow:0 12px 30px rgba(15,35,52,.08)}.service-card>app-icon:first-child{color:#b47d13}.service-card span{display:grid;gap:4px}.service-card b{color:#0b2942}.service-card small{color:#718293;line-height:1.45}.service-card>app-icon:last-child{color:#91a0ad}.seo-section{padding:70px 0 78px;display:flex;justify-content:space-between;align-items:end;gap:40px}.seo-copy{max-width:830px}.seo-copy p+p{margin-top:10px}.seo-cta{white-space:nowrap}.seo-cta app-icon{margin-left:2px}@media(max-width:900px){.hero-inner{grid-template-columns:1fr}.hero{padding-top:45px}.copy{text-align:center}.copy p{margin-inline:auto}.hero-points{justify-content:center}.service-grid{grid-template-columns:1fr}.seo-section{align-items:flex-start;flex-direction:column}}@media(max-width:620px){.travellers{flex-wrap:wrap}.travellers>div{min-width:28%}.experience-section{padding:52px 0}.service-band{padding:48px 0}.feature{grid-template-columns:1fr}.seo-section{padding:52px 0 60px}}
  `]
})
export class HomeComponent {
  readonly lang = inject(LanguageService);
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api = inject(ApiService);
  private router = inject(Router);
  private state = inject(BookingStateService);
  private title = inject(Title);
  private meta = inject(Meta);
  readonly Math = Math;

  origin = 'SGN';
  destination = 'HAN';
  departure = '';
  departureEnd = '';
  flexibleDates = false;
  returnDate = '';
  roundTrip = false;
  adults = 1;
  children = 0;
  seniors = 0;
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  minDate = this.localDate(new Date());
  maxDate = '';
  suggestions: Record<LocationField, LocationSuggestion[]> = { origin: [], destination: [] };
  private suggestionSeq: Record<LocationField, number> = { origin: 0, destination: 0 };

  constructor() {
    this.title.setTitle('Aptech Airlines | Tìm chuyến bay & đặt vé trực tuyến');
    const description = 'Tìm chuyến bay, tra cứu lịch bay, chọn ghế và quản lý vé trực tuyến cùng Aptech Airlines. Hỗ trợ chuyến thẳng, nối chuyến và đặt vé trước đến 330 ngày.';
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'robots', content: 'index,follow' });
    this.meta.updateTag({ property: 'og:title', content: 'Aptech Airlines | Tìm chuyến bay & đặt vé trực tuyến' });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'Aptech Airlines' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });

    this.api.bookingWindow().subscribe({
      next: r => {
        const currentDate = r.current_date || r.min_date;
        this.minDate = currentDate;
        this.maxDate = r.max_date;
        if (!this.departure) this.departure = currentDate;
      },
      error: () => {
        const today = new Date();
        this.minDate = this.localDate(today);
        if (!this.departure) this.departure = this.minDate;
        const d = new Date(today);
        d.setDate(d.getDate() + 330);
        this.maxDate = this.localDate(d);
      }
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

  setRoundTrip(value: boolean) {
    this.roundTrip = value;
    if (!value) this.returnDate = '';
  }

  search() {
    this.error = '';
    const origin = this.origin.trim();
    const destination = this.destination.trim();
    if (!origin || !destination || !this.departure) { this.error = this.lang.pick('Vui lòng nhập nơi đi, nơi đến và ngày bay.','Please enter your departure, destination and travel date.'); return; }
    if (origin.toUpperCase() === destination.toUpperCase()) { this.error = this.lang.pick('Nơi đi và nơi đến phải khác nhau.','Origin and destination must be different.'); return; }
    if (this.flexibleDates && (!this.departureEnd || this.departureEnd < this.departure)) { this.error = this.lang.pick('Khoảng ngày đi không hợp lệ.','Invalid departure date range.'); return; }
    const latestOutbound = this.flexibleDates ? this.departureEnd : this.departure;
    if (this.roundTrip && (!this.returnDate || this.returnDate < latestOutbound)) { this.error = this.lang.pick('Ngày về phải bằng hoặc sau ngày đi cuối cùng.','Return date must be on or after the latest departure date.'); return; }

    const q = {
      origin,
      destination,
      departure_date: this.departure,
      departure_date_end: this.flexibleDates ? this.departureEnd : undefined,
      return_date: this.roundTrip ? this.returnDate : undefined,
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
