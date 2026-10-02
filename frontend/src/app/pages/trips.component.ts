import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PaypalService } from '../core/paypal.service';

@Component({
  standalone: true,
  template: `
  <div class="container page">
    <div class="eyebrow">MY TRIPS</div>
    <h1 class="title">Quản lý chuyến đi</h1>
    <p class="subtitle">Xem hành trình, xác nhận vé đang giữ, đổi chuyến hoặc hủy đặt chỗ.</p>

    @if(!auth.authenticated()){
      <div class="card empty"><h2>Cần đăng nhập</h2><p class="muted">Đăng nhập để xem các chuyến đi của bạn.</p></div>
    } @else if(loading){
      <div class="card empty">Đang tải chuyến đi…</div>
    } @else {
      <div class="trip-list">
        @for(b of trips;track b._id){
          <article class="card trip">
            <div class="trip-main">
              <div class="trip-top">
                <span class="pill" [class.pill-success]="b.status==='CONFIRMED'" [class.pill-gold]="b.status==='BLOCKED'">{{statusLabel(b.status)}}</span>
                <span class="type">{{typeLabel(b.booking_type)}}</span>
              </div>
              <h3>{{b.pnr_code}}</h3>
              <p class="reference">{{b.confirmation_number||b.blocking_number||b.cancellation_number||'Chưa có mã xử lý'}}</p>
              @if(scheduleRows(b).length){
                <div class="flight-schedule">
                  @for(f of scheduleRows(b);track f.key){
                    <div class="schedule-row">
                      <div>
                        <span>{{f.label}}</span>
                        <strong>{{f.flight_number}} · {{f.origin_iata||'—'}} → {{f.dest_iata||'—'}}</strong>
                      </div>
                      <div class="departure">
                        <span>Khởi hành</span>
                        <strong>{{flightDateTime(f)}}</strong>
                      </div>
                    </div>
                  }
                </div>
              } @else if(scheduleLoading.has(bookingKey(b))){
                <div class="schedule-loading">Đang tải ngày giờ bay…</div>
              }
              <div class="summary">
                <span>{{b.passengers?.length||0}} hành khách</span>
                <span>{{money(b.total_amount)}}</span>
                @if(b.status==='BLOCKED'&&b.time_limit_deadline){<span>Giữ đến {{dateTime(b.time_limit_deadline)}}</span>}
              </div>
            </div>
            <div class="trip-actions">
              <button class="btn btn-outline" (click)="openDetails(b)" [disabled]="busy">Chi tiết</button>
              @if(b.status==='BLOCKED'){
                @if(auth.staff()){
                  <button class="btn btn-dark" [disabled]="busy" (click)="confirmHoldCard(b)">Xác nhận tại quầy</button>
                }@else{
                  <button class="btn btn-dark" [disabled]="busy||!paypalEnabled" (click)="confirmHoldPaypal(b)">Thanh toán PayPal</button>
                }
              }
              @if(b.status==='CONFIRMED'){
                <button class="btn btn-outline" (click)="reschedule(b)">Đổi vé</button>
              }
              @if(b.status!=='CANCELLED'){
                <button class="btn btn-outline danger" (click)="cancel(b)" [disabled]="busy">Hủy vé</button>
              }
            </div>
          </article>
        }
      </div>
      @if(!trips.length){<div class="card empty">Bạn chưa có booking nào.</div>}
    }

    @if(message){<p class="success notice">{{message}}</p>}
    @if(error){<p class="error notice">{{error}}</p>}

    @if(selected){
      <div class="modal" (click)="closeDetails()">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="x" (click)="closeDetails()">×</button>
          <div class="modal-head">
            <div>
              <div class="eyebrow">BOOKING DETAIL</div>
              <h2>{{selected.pnr_code}}</h2>
              <p>{{typeLabel(selected.booking_type)}} · {{selected.passengers?.length||0}} hành khách</p>
            </div>
            <span class="pill" [class.pill-success]="selected.status==='CONFIRMED'" [class.pill-gold]="selected.status==='BLOCKED'">{{statusLabel(selected.status)}}</span>
          </div>

          <div class="codes">
            <div><span>PNR</span><strong>{{selected.pnr_code||'—'}}</strong></div>
            <div><span>Confirmation</span><strong>{{selected.confirmation_number||'—'}}</strong></div>
            <div><span>Blocking</span><strong>{{selected.blocking_number||'—'}}</strong></div>
            <div><span>Cancellation</span><strong>{{selected.cancellation_number||'—'}}</strong></div>
          </div>

          @if(selected.status==='BLOCKED'&&selected.time_limit_deadline){
            <div class="deadline">Vé đang được giữ đến <strong>{{dateTime(selected.time_limit_deadline)}}</strong>.</div>
          }

          <div class="detail-grid">
            <div>
              <h3>Hành khách</h3>
              @for(p of selected.passengers||[];track $index){
                <div class="row-item">
                  <strong>{{$index+1}}. {{p.first_name}} {{p.last_name}}</strong>
                  <small>{{passengerLabel(p.passenger_type)}} · {{p.nationality||'—'}}</small>
                </div>
              }
            </div>
            <div>
              <h3>Hành trình</h3>
              @for(c of selectedCoupons;track c.coupon_number||$index){
                <div class="coupon">
                  <div><strong>{{c.flight_number}}</strong><small>{{legLabel(c.leg_type)}} · {{c.cabin_class}}</small></div>
                  <div>
                    @if(c.origin_iata||c.dest_iata){<b>{{c.origin_iata||'—'}} → {{c.dest_iata||'—'}}</b>}
                    <small>{{c.scheduled_departure_local||dateTime(c.scheduled_departure)||'Lịch bay sẽ hiển thị khi tra cứu'}}</small>
                    @if(c.seat_code){<small>Ghế {{c.seat_code}} · phụ phí {{money(c.seat_fee||0)}}</small>}
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="totals">
            <div><span>Giá vé</span><strong>{{money(selected.total_fare)}}</strong></div>
            <div><span>Phụ phí ghế</span><strong>{{money(selected.total_seat_fees)}}</strong></div>
            <div class="grand"><span>Tổng</span><strong>{{money(selected.total_amount)}}</strong></div>
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
  api = inject(ApiService);
  auth = inject(AuthService);
  paypal = inject(PaypalService);
  router = inject(Router);

  trips: any[] = [];
  policies: any[] = [];
  selected: any = null;
  selectedTracked: any = null;
  loading = true;
  busy = false;
  paypalEnabled = false;
  message = '';
  error = '';
  scheduleLoading = new Set<string>();
  private scheduleCache = new Map<string, any[]>();

  constructor() {
    if (this.auth.authenticated()) this.load();
    else this.loading = false;
    this.api.paypalConfig().subscribe({ next: r => this.paypalEnabled = !!r?.enabled, error: () => {} });
    this.api.policies().subscribe({ next: r => this.policies = r || [], error: () => {} });
  }

  get selectedCoupons() {
    return this.selectedTracked?.flight_coupons || this.selected?.ticket_coupons || [];
  }

  load() {
    this.api.myTrips().subscribe({
      next: r => {
        this.trips = r || [];
        this.loading = false;
        void this.loadSchedules(this.trips);
      },
      error: e => { this.error = this.msg(e, 'Không tải được booking.'); this.loading = false; },
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
        label: booking?.booking_type === 'ROUND_TRIP' ? 'Chiều đi' : 'Chuyến bay',
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
        label: 'Chiều về',
        origin_iata: first.origin_iata,
        dest_iata: last.dest_iata,
      });
    }
    return rows;
  }

  flightDateTime(flight: any) {
    const local = String(flight?.scheduled_departure_local || '').trim();
    const match = local.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]} · ${match[4]}`;
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
      this.error = this.msg(e, 'Không tải được lịch bay chi tiết.');
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

  async confirmHoldCard(booking: any) {
    this.busy = true;
    this.error = '';
    this.message = '';
    try {
      const result = await firstValueFrom(this.api.confirm({
        blocking_number: booking.blocking_number,
        payment_method: 'PROFILE_CARD',
      }));
      this.message = `Đã xác nhận vé. Confirmation: ${result?.confirmation_number || result?.booking?.confirmation_number || 'đã tạo'}.`;
      this.closeDetails();
      this.load();
    } catch (e: any) {
      this.error = this.msg(e, 'Không xác nhận được vé.');
    } finally {
      this.busy = false;
    }
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
      this.message = 'Đã xác nhận vé bằng PayPal.';
      this.closeDetails();
      this.load();
    } catch (e: any) {
      this.error = this.msg(e, 'Không xác nhận được vé bằng PayPal.');
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
      if (!confirm(question)) return;
      const result = await firstValueFrom(this.api.cancel(code));
      this.message = `Đã hủy vé. Mã hủy: ${result.cancellation_number}. Hoàn ${moneyStatic(result.refund_amount)} (${result.refund_percentage}%).`;
      this.closeDetails();
      this.load();
    } catch (e: any) {
      this.error = this.msg(e, 'Không hủy được vé.');
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
    return ({ BLOCKED: 'Đang giữ chỗ', CONFIRMED: 'Đã xác nhận', RESCHEDULED: 'Đã đổi chuyến', CANCELLED: 'Đã hủy' } as any)[value] || value;
  }
  typeLabel(value: string) { return ({ ONE_WAY: 'Một chiều', ROUND_TRIP: 'Khứ hồi', CONNECTING: 'Nối chuyến' } as any)[value] || value; }
  passengerLabel(value: string) { return ({ ADULT: 'Người lớn', CHILD: 'Trẻ em', SENIOR: 'Cao tuổi' } as any)[value] || value; }
  legLabel(value: string) {
    if (value === 'OUTBOUND') return 'Chiều đi';
    if (value === 'INBOUND') return 'Chiều về';
    if (value?.startsWith('CONNECTING_')) return `Đi · chặng ${value.split('_')[1]}`;
    if (value?.startsWith('INBOUND_')) return `Về · chặng ${value.split('_')[1]}`;
    return value || 'Chặng bay';
  }
  dateTime(value: any) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  money(value: number) { return moneyStatic(value); }
  private msg(e: any, fallback: string) {
    const message = e?.error?.message;
    return Array.isArray(message) ? message.join(' · ') : message || e?.message || fallback;
  }
}

function moneyStatic(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value || 0);
}
