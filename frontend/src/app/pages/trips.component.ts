import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PaypalService } from '../core/paypal.service';
import { ToastService } from '../core/toast.service';
import { LanguageService } from '../core/language.service';
import { cancellationOutcomeMessages } from '../core/refund-copy';
import { PaginationComponent } from '../shared/pagination.component';
import { formatDateTimeDayFirst } from '../core/date-format.util';

@Component({
  standalone: true,
  imports: [PaginationComponent],
  template: `
  <div class="container page">
    <div class="eyebrow">{{t('CHUYẾN ĐI CỦA TÔI','MY TRIPS')}}</div>
    <h1 class="title">{{t('Quản lý chuyến đi','Manage trips')}}</h1>
    <p class="subtitle">{{t('Xem hành trình, xác nhận vé đang giữ, đổi chuyến hoặc hủy đặt chỗ.','Review itineraries, pay for held tickets, reschedule or cancel bookings.')}}</p>

    @if(!auth.authenticated()){
      <div class="card empty"><h2>{{t('Cần đăng nhập','Sign in required')}}</h2><p class="muted">{{t('Đăng nhập để xem các chuyến đi của bạn.','Sign in to see your trips.')}}</p></div>
    } @else if(loading()) {
      <div class="card empty">{{t('Đang tải chuyến đi…','Loading trips…')}}</div>
    } @else {
      <div class="trip-list">
        @for(b of pagedTrips;track b._id){
          <article class="card trip">
            <div class="trip-main">
              <div class="trip-top">
                <span class="pill" translate="no" [class.pill-success]="b.status==='CONFIRMED'" [class.pill-gold]="b.status==='BLOCKED'">{{statusLabel(b.status)}}</span>
                <span class="type" translate="no">{{typeLabel(b.booking_type)}}</span>
              </div>
              <h3 translate="no">{{b.pnr_code}}</h3>
              <p class="reference" translate="no">{{b.confirmation_number||b.blocking_number||b.cancellation_number||language.pick('Chưa có mã xử lý', 'No reference yet')}}</p>
              @if(scheduleRows(b).length){
                <div class="flight-schedule">
                  @for(f of scheduleRows(b);track f.key){
                    <div class="schedule-row">
                      <div>
                        <span translate="no">{{language.translateNotice(f.label)}}</span>
                        <strong>{{f.flight_number}} · {{f.origin_iata||'—'}} → {{f.dest_iata||'—'}}</strong>
                      </div>
                      <div class="departure">
                        <span>{{t('Khởi hành','Departure')}}</span>
                        <strong>{{flightDateTime(f)}}</strong>
                      </div>
                    </div>
                  }
                </div>
              } @else if(scheduleLoading.has(bookingKey(b))){
                <div class="schedule-loading">{{t('Đang tải ngày giờ bay…','Loading flight schedules…')}}</div>
              }
              <div class="summary">
                <span>{{b.passengers?.length||0}} {{t('hành khách','passengers')}}</span>
                <span>{{money(b.total_amount)}}</span>
                @if(b.status==='BLOCKED'&&b.time_limit_deadline){<span>{{t('Giữ đến','Held until')}} {{dateTime(b.time_limit_deadline)}}</span>}
              </div>
            </div>
            <div class="trip-actions">
              <button class="btn btn-outline" (click)="openDetails(b)" [disabled]="busy">{{t('Chi tiết','Details')}}</button>
              @if(b.status==='BLOCKED'){
                @if(auth.staff()){
                  <span class="muted">{{t('Khách thanh toán PayPal từ email giữ chỗ','Customer pays with PayPal from the hold email')}}</span>
                }@else{
                  <button class="btn btn-dark" [disabled]="busy||!paypalEnabled" (click)="confirmHoldPaypal(b)">{{t('Thanh toán PayPal','Pay with PayPal')}}</button>
                }
              }
              @if(b.status==='CONFIRMED'){
                <button class="btn btn-outline" (click)="reschedule(b)">{{t('Đổi vé','Reschedule')}}</button>
              }
              @if(b.status!=='CANCELLED'){
                <button class="btn btn-outline danger" (click)="cancel(b)" [disabled]="busy">{{t('Hủy vé','Cancel booking')}}</button>
              }
            </div>
          </article>
        }
      </div>
      <app-pagination [total]="trips().length" [(page)]="page" [(pageSize)]="pageSize" [pageSizeOptions]="[5,10,20,50]" />
      @if(!trips().length){<div class="card empty">{{t('Bạn chưa có đặt chỗ nào.','You have no bookings yet.')}}</div>}
    }

    
    

    @if(selected){
      <div class="modal" (click)="closeDetails()">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="x" (click)="closeDetails()">×</button>
          <div class="modal-head">
            <div>
               <div class="eyebrow">{{t('CHI TIẾT ĐẶT CHỖ','BOOKING DETAILS')}}</div>
              <h2 translate="no">{{selected.pnr_code}}</h2>
               <p><span translate="no">{{typeLabel(selected.booking_type)}}</span> · {{selected.passengers?.length||0}} {{t('hành khách','passengers')}}</p>
            </div>
            <span class="pill" translate="no" [class.pill-success]="selected.status==='CONFIRMED'" [class.pill-gold]="selected.status==='BLOCKED'">{{statusLabel(selected.status)}}</span>
          </div>

          <div class="codes">
            <div><span>PNR</span><strong>{{selected.pnr_code||'—'}}</strong></div>
             <div><span>{{t('Mã xác nhận','Confirmation')}}</span><strong>{{selected.confirmation_number||'—'}}</strong></div>
             <div><span>{{t('Mã giữ chỗ','Hold code')}}</span><strong>{{selected.blocking_number||'—'}}</strong></div>
             <div><span>{{t('Mã hủy','Cancellation')}}</span><strong>{{selected.cancellation_number||'—'}}</strong></div>
          </div>

          @if(selected.status==='BLOCKED'&&selected.time_limit_deadline){
             <div class="deadline">{{t('Vé đang được giữ đến','Ticket is held until')}} <strong>{{dateTime(selected.time_limit_deadline)}}</strong>.</div>
          }

          <div class="detail-grid">
            <div>
               <h3>{{t('Hành khách','Passengers')}}</h3>
              @for(p of selected.passengers||[];track $index){
                <div class="row-item">
                  <strong>{{$index+1}}. {{p.first_name}} {{p.last_name}}</strong>
                  <small><span translate="no">{{passengerLabel(p.passenger_type)}}</span> · <span translate="no">{{p.nationality||'—'}}</span></small>
                </div>
              }
            </div>
            <div>
               <h3>{{t('Hành trình','Itinerary')}}</h3>
              @for(c of selectedCoupons;track c.coupon_number||$index){
                <div class="coupon">
                  <div><strong translate="no">{{c.flight_number}}</strong><small><span translate="no">{{legLabel(c.leg_type)}}</span> · <span translate="no">{{language.cabinLabel(c.cabin_class)}}</span></small></div>
                  <div>
                    @if(c.origin_iata||c.dest_iata){<b>{{c.origin_iata||'—'}} → {{c.dest_iata||'—'}}</b>}
                     <small>{{dateTime(c.scheduled_departure_local||c.scheduled_departure)||t('Lịch bay sẽ hiển thị khi tra cứu','Flight schedule will appear when tracked')}}</small>
                     @if(c.seat_code){<small>{{t('Ghế','Seat')}} {{c.seat_code}} · {{t('phụ phí','fee')}} {{money(c.seat_fee||0)}}</small>}
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="totals">
             <div><span>{{t('Giá vé','Base fare')}}</span><strong>{{money(selected.total_fare)}}</strong></div>
             <div><span>{{t('Phụ phí ghế','Seat fees')}}</span><strong>{{money(selected.total_seat_fees)}}</strong></div>
             <div class="grand"><span>{{t('Tổng','Total')}}</span><strong>{{money(selected.total_amount)}}</strong></div>
          </div>
        </section>
      </div>
    }
  </div>
  `,
  styles: [`
    .trip-list{display:grid;gap:14px;margin-top:18px}.trip{padding:20px;display:flex;justify-content:space-between;gap:22px;align-items:center}.trip-main{min-width:0;flex:1}.trip-top{display:flex;gap:9px;align-items:center}.type{font-size:11px;font-weight:800;color:#718093;text-transform:uppercase}.trip h3{margin:10px 0 3px;color:#071b2e;font-size:22px}.reference{margin:0;color:#647588;font-weight:700}.flight-schedule{display:grid;gap:8px;margin-top:14px;max-width:690px}.schedule-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:10px 12px;border:1px solid #e6ecf1;background:#f7f9fb;border-radius:12px}.schedule-row>div{display:grid;gap:3px}.schedule-row span{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#7c8a98;font-weight:900}.schedule-row strong{font-size:13px;color:#17324a}.schedule-row .departure{text-align:right;white-space:nowrap}.schedule-loading{margin-top:12px;color:#81909d;font-size:11px}.summary{display:flex;gap:15px;flex-wrap:wrap;margin-top:11px;color:#647588;font-size:12px}.summary span{padding-right:15px;border-right:1px solid #dde5eb}.summary span:last-child{border:0}.trip-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.trip-actions .btn:disabled{opacity:.45}.danger{color:#9d3030;border-color:#e4bebe}.notice{margin-top:14px;padding:11px 14px;border-radius:12px}.modal{position:fixed;inset:0;background:rgba(4,18,31,.58);display:grid;place-items:center;z-index:99;padding:20px}.modal-card{width:min(920px,100%);max-height:88vh;overflow:auto;padding:0;position:relative}.x{position:absolute;right:15px;top:12px;border:0;background:rgba(255,255,255,.12);color:#fff;width:34px;height:34px;border-radius:50%;font-size:25px;cursor:pointer;z-index:2}.modal-head{padding:24px 58px 22px 24px;background:linear-gradient(120deg,#071b2e,#123957);color:#fff;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.modal-head>.pill{align-self:flex-start;flex:0 0 auto;padding:6px 11px;line-height:1;white-space:nowrap}.modal-head h2{margin:5px 0;font-size:27px}.modal-head p{margin:0;color:#bfd0db}.codes{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e6edf2}.codes>div{background:#fff;padding:14px 16px}.codes span,.totals span{display:block;color:#768696;font-size:10px;font-weight:800;text-transform:uppercase}.codes strong,.totals strong{display:block;color:#102b42;margin-top:5px}.deadline{margin:16px 20px 0;padding:11px 13px;background:#fff7df;color:#72540d;border-radius:12px}.detail-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:28px;padding:22px 24px}.detail-grid h3{margin:0 0 10px;color:#0a2540}.row-item,.coupon{padding:10px 0;border-bottom:1px solid #edf1f4}.row-item strong,.row-item small{display:block}.row-item small,.coupon small{display:block;color:#758493;font-size:11px;margin-top:3px}.coupon{display:flex;justify-content:space-between;gap:15px}.coupon>div:last-child{text-align:right}.coupon b{display:block;color:#1f384d}.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e6edf2;border-top:1px solid #e6edf2}.totals>div{background:#fff;padding:15px 18px}.totals .grand{background:#fff8e5}.totals .grand strong{font-size:19px;color:#77580b}@media(max-width:760px){.trip{align-items:flex-start;flex-direction:column}.trip-actions{justify-content:flex-start}.schedule-row{align-items:flex-start;flex-direction:column;gap:8px}.schedule-row .departure{text-align:left}.codes,.totals{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}.coupon{flex-direction:column}.coupon>div:last-child{text-align:left}.modal-head{flex-direction:column}.summary span{border:0;padding:0}}
  `]
})
export class TripsComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  readonly language = inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  api = inject(ApiService);
  auth = inject(AuthService);
  paypal = inject(PaypalService);
  router = inject(Router);
  toast = inject(ToastService);

  trips = signal<any[]>([]);
  policies: any[] = [];
  selected: any = null;
  selectedTracked: any = null;
  loading = signal(true);
  busy = false;
  paypalEnabled = false;
  private __message='';get message(){return this.__message}set message(v:string){this.__message=v;if(v) this.__toast.notifySuccess(v)};
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;if(v) this.__toast.notifyError(v)};
  private successPair(vi:string,en:string){this.__message=this.t(vi,en);this.__toast.success({titleVi:'Thành công',titleEn:'Success',messageVi:vi,messageEn:en})}
  page = 1;
  pageSize = 10;
  scheduleLoading = new Set<string>();
  private scheduleCache = new Map<string, any[]>();

  constructor() {
    if (this.auth.authenticated()) this.load();
    else this.loading.set(false);
    this.api.paypalConfig().subscribe({ next: r => this.paypalEnabled = !!r?.enabled, error: () => {} });
    this.api.policies().subscribe({ next: r => this.policies = r || [], error: () => {} });
  }

  get selectedCoupons() {
    return this.selectedTracked?.flight_coupons || this.selected?.ticket_coupons || [];
  }

  get pagedTrips() {
    const start = (this.page - 1) * this.pageSize;
    return this.trips().slice(start, start + this.pageSize);
  }

  load() {
    this.loading.set(true);
    this.api.myTrips().subscribe({
      next: r => {
        this.trips.set(r || []);
        this.page = 1;
        this.loading.set(false);
        void this.loadSchedules(this.trips());
      },
      error: e => { this.error = this.msg(e, this.t('Không tải được đặt chỗ.', 'Could not load bookings.')); this.loading.set(false); },
    });
  }

  private async loadSchedules(bookings: any[]) {
    await Promise.allSettled((bookings || []).map(async booking => {
      const key = this.bookingKey(booking);
      const code = booking.confirmation_number || booking.blocking_number || booking.pnr_code;
      if (!key || !code || this.scheduleCache.has(key)) return;
      this.scheduleLoading.add(key);
      try {
        const tracked = await firstValueFrom(this.api.track(code));
        this.scheduleCache.set(key, tracked?.flight_coupons || []);
      } catch {
        this.scheduleCache.set(key, []);
      } finally {
        this.scheduleLoading.delete(key);
      }
    }));
  }

  bookingKey(booking: any) {
    return String(booking?._id || booking?.pnr_code || booking?.confirmation_number || '');
  }

  scheduleRows(booking: any) {
    const coupons = this.scheduleCache.get(this.bookingKey(booking)) || [];
    if (!coupons.length) return [];

    const outbound = coupons.filter((c: any) => this.isOutboundLeg(c?.leg_type));
    const inbound = coupons.filter((c: any) => this.isInboundLeg(c?.leg_type));
    const rows: any[] = [];

    if (outbound.length) {
      const first = outbound[0];
      const last = outbound[outbound.length - 1];
      rows.push({
        ...first,
        key: 'OUTBOUND',
        label: booking?.booking_type === 'ROUND_TRIP' ? this.t('Chiều đi', 'Outbound') : this.t('Chuyến bay', 'Flight'),
        origin_iata: first.origin_iata,
        dest_iata: last.dest_iata,
      });
    }
    if (inbound.length) {
      const first = inbound[0];
      const last = inbound[inbound.length - 1];
      rows.push({
        ...first,
        key: 'INBOUND',
        label: this.t('Chiều về', 'Return'),
        origin_iata: first.origin_iata,
        dest_iata: last.dest_iata,
      });
    }
    return rows;
  }

  flightDateTime(flight: any) {
    const local = String(flight?.scheduled_departure_local || '').trim();
    if (local) return formatDateTimeDayFirst(local);
    return this.dateTime(flight?.scheduled_departure);
  }

  private isOutboundLeg(value: string) {
    const leg = String(value || '').toUpperCase();
    return leg === 'OUTBOUND' || leg.startsWith('CONNECTING_');
  }

  private isInboundLeg(value: string) {
    const leg = String(value || '').toUpperCase();
    return leg === 'INBOUND' || leg.startsWith('INBOUND_');
  }

  async openDetails(booking: any) {
    this.busy = true;
    this.error = '';
    this.selected = booking;
    this.selectedTracked = null;
    try {
      const code = booking.confirmation_number || booking.blocking_number || booking.pnr_code;
      this.selectedTracked = await firstValueFrom(this.api.track(code));
      this.selected = this.selectedTracked?.booking_info || booking;
    } catch (e: any) {
      this.error = this.msg(e, this.t('Không tải được lịch bay chi tiết.', 'Could not load flight details.'));
    } finally {
      this.busy = false;
    }
  }

  closeDetails() {
    this.selected = null;
    this.selectedTracked = null;
  }

  reschedule(booking: any) {
    this.router.navigate(['/reschedule'], { queryParams: { code: booking.confirmation_number || booking.pnr_code } });
  }

  async confirmHoldPaypal(booking: any) {
    if (this.auth.staff()) return;
    this.busy = true;
    this.error = '';
    this.message = '';
    try {
      let checkout = '';
      await this.paypal.pay(
        async () => {
          const created = await firstValueFrom(this.api.paypalConfirmHoldCreate({
            blocking_number: booking.blocking_number,
            client_request_id: crypto.randomUUID(),
          }));
          checkout = created.checkout_id;
          return { orderId: created.order_id };
        },
        async orderId => {
          await firstValueFrom(this.api.paypalConfirmHoldCapture(checkout, orderId));
        },
      );
      this.successPair('Đã xác nhận vé bằng PayPal.','Ticket confirmed via PayPal.');
      this.closeDetails();
      this.load();
    } catch (e: any) {
      this.error = this.msg(e, this.t('Không xác nhận được vé bằng PayPal.', 'Could not confirm ticket with PayPal.'));
    } finally {
      this.busy = false;
    }
  }

  async cancel(booking: any) {
    this.busy = true;
    this.error = '';
    this.message = '';
    try {
      const code = booking.confirmation_number || booking.blocking_number || booking.pnr_code;
      const tracked = await firstValueFrom(this.api.track(code));
      const liveBooking = tracked?.booking_info || booking;
      const percent = this.refundPercent(liveBooking, tracked?.flight_coupons || []);
      const question = liveBooking.status === 'BLOCKED'
        ? 'Hủy vé đang giữ sẽ giải phóng toàn bộ ghế và không phát sinh khoản hoàn tiền. Bạn muốn tiếp tục?'
        : `Theo chính sách hiện tại, mức hoàn dự kiến là ${percent}%. Tiền hoàn sẽ được trả về phương thức thanh toán gốc. Bạn muốn hủy booking này?`;
      const questionEn = liveBooking.status === 'BLOCKED'
        ? 'Cancelling this hold will release all seats and no refund will be issued. Do you want to continue?'
        : `The current policy estimates a ${percent}% refund to the original payment method. Do you want to cancel this booking?`;
      const confirmed = await this.toast.confirm({
        titleVi:'Xác nhận hủy vé',
        titleEn:'Confirm cancellation',
        messageVi:question,
        messageEn:questionEn,
        confirmVi:'Hủy vé',
        confirmEn:'Cancel booking',
      });
      if (!confirmed) return;
      const result = await firstValueFrom(this.api.cancel(code));
      const outcome = cancellationOutcomeMessages(result);
      this.successPair(outcome.vi, outcome.en);
      this.closeDetails();
      this.load();
    } catch (e: any) {
      this.error = this.msg(e, this.t('Không hủy được vé.', 'Could not cancel booking.'));
    } finally {
      this.busy = false;
    }
  }

  refundPercent(booking: any, coupons: any[]) {
    if (booking?.status !== 'CONFIRMED') return 0;
    const departures = coupons
      .map(c => new Date(c.scheduled_departure).getTime())
      .filter(v => Number.isFinite(v));
    if (!departures.length) return 0;
    const days = Math.max(0, (Math.min(...departures) - Date.now()) / 86_400_000);
    const matches = this.policies.filter(policy => {
      const min = Number(policy.min_days_before ?? 0);
      const max = policy.max_days_before == null ? Infinity : Number(policy.max_days_before);
      return days >= min && days <= max;
    });
    return Number(matches.sort((a, b) => Number(b.min_days_before) - Number(a.min_days_before))[0]?.refund_percentage || 0);
  }

  statusLabel(value: string) {
    return this.language.bookingStatusLabel(value);
  }
  typeLabel(value: string) { return this.language.bookingTypeLabel(value); }
  passengerLabel(value: string) { return this.language.passengerTypeLabel(value); }
  legLabel(value: string) {
    return this.language.itineraryLegLabel(value);
  }
  dateTime(value: any) {
    return formatDateTimeDayFirst(value);
  }
  money(value: number) {
    return new Intl.NumberFormat(this.language.isEnglish() ? 'en-US' : 'vi-VN', {
      style: 'currency', currency: 'VND', maximumFractionDigits: 0,
    }).format(value || 0);
  }
  private msg(e: any, fallback: string) {
    const message = e?.error?.message;
    return Array.isArray(message) ? message.join(' · ') : message || e?.message || fallback;
  }
}
