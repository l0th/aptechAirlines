import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { PaginationComponent } from '../shared/pagination.component';
import { LanguageService } from '../core/language.service';
import { formatCalendarDate } from '../core/date-format.util';
import { DayFirstDateInputComponent } from '../shared/day-first-date-input.component';

@Component({
  standalone: true,
  imports: [FormsModule, PaginationComponent, DayFirstDateInputComponent],
  template: `
    <div class="container page">
      <div class="eyebrow">PUBLIC FLIGHT LOOKUP</div>
      <h1 class="title">Tra cứu lịch bay</h1>
      <p class="subtitle">Không cần đăng nhập. Nhập số hiệu chuyến bay và ngày để xem giờ khởi hành, giờ đến và trạng thái mới nhất.</p>

      <section class="card finder">
        <div class="field">
          <span>Số hiệu chuyến bay</span>
          <input class="control" [(ngModel)]="number" (keyup.enter)="search()" placeholder="APT-DMO-HLD" autocomplete="off">
        </div>
        <div class="field">
          <span>Ngày bay</span>
          <app-date-input [(ngModel)]="date" (enterPressed)="search()"/>
        </div>
        <button class="btn btn-primary" (click)="search()" [disabled]="loading">
          {{loading ? 'Đang tra cứu…' : 'Tra cứu'}}
        </button>
      </section>

      
      @if(searched && !loading && !error && !results.length){
        <div class="card empty"><h2>Không có chuyến phù hợp</h2><p class="muted">Kiểm tra lại số hiệu chuyến bay và ngày.</p></div>
      }

      @for(f of pagedResults;track f._id||f.flight_id||$index){
        <article class="card flight">
          <header class="flight-head">
            <div>
              <small>APTECH AIRLINES</small>
              <h2>{{f.flight_number}}</h2>
              <span>{{f.aircraft?.model_name||f.aircraft?.model_code||f.aircraft_type||language.pick('Máy bay theo lịch khai thác', 'Aircraft as scheduled')}}</span>
            </div>
            <span class="status" [class.ok]="f.status==='SCHEDULED'||f.status==='DEPARTED'||f.status==='ARRIVED'" [class.warn]="f.status==='DELAYED'" [class.cancel]="f.status==='CANCELLED'">{{statusLabel(f.status)}}</span>
          </header>

          <div class="route">
            <div class="airport">
              <span>Khởi hành</span>
              <strong>{{f.origin_iata}}</strong>
              <b>{{clock(f.scheduled_departure_local||f.scheduled_departure)}}</b>
              <small>{{datePart(f.scheduled_departure_local||f.scheduled_departure)}} · {{f.origin_time_zone||language.pick('Giờ địa phương', 'Local time')}}</small>
              @if(f.actual_departure_local||f.actual_departure){
                <div class="actual">{{language.pick('Thực tế:', 'Actual:')}} {{clock(f.actual_departure_local||f.actual_departure)}}</div>
              }
            </div>

            <div class="route-line"><i></i><span>→</span></div>

            <div class="airport right">
              <span>Đến nơi</span>
              <strong>{{f.dest_iata}}</strong>
              <b>{{clock(f.scheduled_arrival_local||f.scheduled_arrival)}}</b>
              <small>{{datePart(f.scheduled_arrival_local||f.scheduled_arrival)}} · {{f.dest_time_zone||language.pick('Giờ địa phương', 'Local time')}}</small>
              @if(f.actual_arrival_local||f.actual_arrival){
                <div class="actual">{{language.pick('Thực tế:', 'Actual:')}} {{clock(f.actual_arrival_local||f.actual_arrival)}}</div>
              }
            </div>
          </div>

          @if(hasTimingChange(f)){
            <div class="change-note">Chuyến bay có giờ thực tế khác lịch dự kiến. Vui lòng ưu tiên thông tin thực tế hiển thị ở trên.</div>
          }
        </article>
      }
      <app-pagination [total]="results.length" [(page)]="page" [(pageSize)]="pageSize" [pageSizeOptions]="[5,10,20,50]" />
    </div>
  `,
  styles: [`
    .finder{display:grid;grid-template-columns:1.2fr 1fr auto;gap:12px;padding:18px;margin-top:18px;align-items:end}.finder .btn{min-height:46px}.notice{padding:11px 14px;border-radius:12px;background:#fff}.flight{margin-top:14px;padding:0;overflow:hidden}.flight-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:20px 22px;background:#f7f9fb;border-bottom:1px solid #e6edf2}.flight-head small{font-size:9px;letter-spacing:.08em;color:#8492a0;font-weight:900}.flight-head h2{margin:4px 0;color:#071b2e;font-size:25px}.flight-head div>span{font-size:11px;color:#6c7b89}.status{border-radius:999px;padding:7px 11px;background:#e9eef3;color:#4f6173;font-size:10px;font-weight:900}.status.ok{background:#dff5e9;color:#126b49}.status.warn{background:#fff0bd;color:#7b5a05}.status.cancel{background:#ffe2e2;color:#a12a2a}.route{display:grid;grid-template-columns:1fr 160px 1fr;gap:20px;align-items:center;padding:26px 28px}.airport{display:grid;gap:4px}.airport>span{font-size:10px;text-transform:uppercase;color:#7a8997;font-weight:900}.airport strong{font-size:31px;color:#071b2e}.airport b{font-size:22px;color:#21384c}.airport small{color:#758493}.right{text-align:right}.route-line{display:flex;align-items:center;color:#a87815;gap:8px}.route-line i{height:1px;background:#cfd9e1;flex:1}.route-line span{font-size:20px}.actual{margin-top:6px;display:inline-block;width:max-content;background:#fff4d4;color:#76560f;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800}.right .actual{justify-self:end}.change-note{border-top:1px solid #f0d59c;background:#fff9e9;color:#725315;padding:11px 20px;font-size:11px;font-weight:700}@media(max-width:700px){.finder{grid-template-columns:1fr}.route{grid-template-columns:1fr;gap:14px}.route-line{transform:none}.right{text-align:left}.right .actual{justify-self:start}.flight-head{align-items:flex-start;flex-direction:column}}
  `]
})
export class LookupComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api = inject(ApiService);
  readonly language = inject(LanguageService);
  number = '';
  date = '';
  results: any[] = [];
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  loading = false;
  searched = false;
  page = 1;
  pageSize = 10;

  get pagedResults() {
    const start = (this.page - 1) * this.pageSize;
    return this.results.slice(start, start + this.pageSize);
  }

  search() {
    const number = this.number.trim().toUpperCase();
    this.error = '';
    this.results = [];
    this.page = 1;
    this.searched = true;
    if (!number || !this.date) {
      this.error = this.language.pick('Vui lòng nhập đầy đủ số hiệu chuyến bay và ngày bay.','Enter both the flight number and travel date.');
      return;
    }

    this.number = number;
    this.loading = true;
    this.api.flightLookup(number, this.date).subscribe({
      next: response => {
        this.results = Array.isArray(response) ? response : response ? [response] : [];
        this.loading = false;
      },
      error: e => {
        this.error = this.message(e, this.language.pick('Không tìm thấy chuyến bay phù hợp.','No matching flight was found.'));
        this.loading = false;
      }
    });
  }

  statusLabel(v: string) {
    const labels: Record<string, [string, string]> = {
      SCHEDULED: ['ĐÚNG LỊCH', 'ON SCHEDULE'],
      DELAYED: ['TRỄ CHUYẾN', 'DELAYED'],
      DEPARTED: ['ĐÃ KHỞI HÀNH', 'DEPARTED'],
      ARRIVED: ['ĐÃ ĐẾN', 'ARRIVED'],
      CANCELLED: ['ĐÃ HỦY', 'CANCELLED'],
    };
    return this.language.pick(...(labels[v] || (v ? [v, v] : ['CHƯA CÓ TRẠNG THÁI', 'STATUS UNAVAILABLE'])));
  }

  clock(v: string) {
    if (!v) return '—';
    const match = String(v).match(/(?:T|\s)(\d{2}:\d{2})/);
    return match?.[1] || '—';
  }

  datePart(v: string) {
    return formatCalendarDate(v);
  }

  hasTimingChange(f: any) {
    return !!(f?.actual_departure_local || f?.actual_departure || f?.actual_arrival_local || f?.actual_arrival);
  }

  private message(e: any, fallback: string) {
    const m = e?.error?.message;
    return this.language.translateNotice(Array.isArray(m) ? m.join(' · ') : m || fallback);
  }
}
