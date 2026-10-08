import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  standalone: true,
  imports: [FormsModule, PaginationComponent],
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
          <input class="control" type="date" [(ngModel)]="date" (keyup.enter)="search()">
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
              <span>{{f.aircraft?.model_name||f.aircraft?.model_code||f.aircraft_type||'Máy bay theo lịch khai thác'}}</span>
            </div>
            <span class="status" [class.ok]="f.status==='SCHEDULED'||f.status==='DEPARTED'||f.status==='ARRIVED'" [class.warn]="f.status==='DELAYED'" [class.cancel]="f.status==='CANCELLED'">{{statusLabel(f.status)}}</span>
          </header>

          <div class="route">
            <div class="airport">
              <span>Khởi hành</span>
              <strong>{{f.origin_iata}}</strong>
              <b>{{clock(f.scheduled_departure_local||f.scheduled_departure)}}</b>
              <small>{{datePart(f.scheduled_departure_local||f.scheduled_departure)}} · {{f.origin_time_zone||'Giờ địa phương'}}</small>
              @if(f.actual_departure_local||f.actual_departure){
                <div class="actual">Thực tế: {{clock(f.actual_departure_local||f.actual_departure)}}</div>
              }
            </div>

            <div class="route-line"><i></i><span>→</span></div>

            <div class="airport right">
              <span>Đến nơi</span>
              <strong>{{f.dest_iata}}</strong>
              <b>{{clock(f.scheduled_arrival_local||f.scheduled_arrival)}}</b>
              <small>{{datePart(f.scheduled_arrival_local||f.scheduled_arrival)}} · {{f.dest_time_zone||'Giờ địa phương'}}</small>
              @if(f.actual_arrival_local||f.actual_arrival){
                <div class="actual">Thực tế: {{clock(f.actual_arrival_local||f.actual_arrival)}}</div>
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
      this.error = 'Vui lòng nhập đầy đủ số hiệu chuyến bay và ngày bay.';
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
        this.error = this.message(e, 'Không tìm thấy chuyến bay phù hợp.');
        this.loading = false;
      }
    });
  }

  statusLabel(v: string) {
    return ({
      SCHEDULED: 'ĐÚNG LỊCH',
      DELAYED: 'TRỄ CHUYẾN',
      DEPARTED: 'ĐÃ KHỞI HÀNH',
      ARRIVED: 'ĐÃ ĐẾN',
      CANCELLED: 'ĐÃ HỦY'
    } as Record<string, string>)[v] || v || 'CHƯA CÓ TRẠNG THÁI';
  }

  clock(v: string) {
    if (!v) return '—';
    const match = String(v).match(/(?:T|\s)(\d{2}:\d{2})/);
    return match?.[1] || '—';
  }

  datePart(v: string) {
    if (!v) return '—';
    const match = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || '—';
  }

  hasTimingChange(f: any) {
    return !!(f?.actual_departure_local || f?.actual_departure || f?.actual_arrival_local || f?.actual_arrival);
  }

  private message(e: any, fallback: string) {
    const m = e?.error?.message;
    return Array.isArray(m) ? m.join(' · ') : m || fallback;
  }
}
