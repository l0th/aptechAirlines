import { ToastService } from '../core/toast.service';
import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PaypalService } from '../core/paypal.service';

type RescheduleDirection = 'OUTBOUND' | 'RETURN' | 'BOTH';
type DirectionKey = 'OUTBOUND' | 'RETURN';

@Component({
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
  <div class="container page">
    <div class="eyebrow">RESCHEDULE</div>
    <h1 class="title">Đổi chuyến</h1>
    <p class="subtitle">Tra cứu vé đã xác nhận, chọn chiều cần đổi và xem chính xác chênh lệch trước khi xác nhận.</p>

    <section class="card finder">
      <div class="field code-field">
        <span>Confirmation / PNR</span>
        <input class="control" [(ngModel)]="confirmation" (keyup.enter)="loadBooking(true)" placeholder="CNF-XXXXXX / PNR">
      </div>
      <button class="btn btn-dark" (click)="loadBooking(true)" [disabled]="busy||!confirmation.trim()">{{busy?'Đang tra cứu…':'Tải đặt chỗ'}}</button>
    </section>

    

    @if(booking){
      <section class="card booking-card">
        <div class="booking-head">
          <div>
            <span class="pill pill-success">{{statusLabel(booking.status)}}</span>
            <h2>{{booking.pnr_code||booking.confirmation_number}}</h2>
            <p>{{bookingTypeLabel(booking.booking_type)}} · {{passengerTotal}} hành khách · {{cabinLabel}}</p>
          </div>
          <div class="route-summary">
            <span>Chiều đi</span><strong>{{outboundOrigin||'—'}} → {{outboundDestination||'—'}}</strong>
            @if(isRoundTrip){<span>Chiều về</span><strong>{{returnOrigin||'—'}} → {{returnDestination||'—'}}</strong>}
          </div>
        </div>

        @if(isRoundTrip){
          <div class="direction-picker">
            <button type="button" [class.active]="direction==='OUTBOUND'" (click)="setDirection('OUTBOUND')">Đổi chiều đi</button>
            <button type="button" [class.active]="direction==='RETURN'" [disabled]="!supportsReturnOnly" (click)="setDirection('RETURN')">Chỉ đổi chiều về</button>
            <button type="button" [class.active]="direction==='BOTH'" (click)="setDirection('BOTH')">Đổi cả hai chiều</button>
          </div>
          @if(!supportsReturnOnly){
            <p class="contract-note">Vé khứ hồi bay thẳng hiện hỗ trợ đổi chiều đi hoặc đổi cả hai chiều. Nếu một trong hai chiều là hành trình nối chuyến, bạn có thể đổi riêng chiều về.</p>
          }
        }
      </section>

      <section class="card search-card">
        @if(needsOutbound){
          <div class="search-block">
            <div class="block-title"><span class="step">1</span><div><b>Chuyến mới · chiều đi</b><small>{{outboundOrigin}} → {{outboundDestination}}</small></div></div>
            <div class="grid grid-3">
              <div class="field"><span>Nơi đi · giữ nguyên</span><input class="control route-locked" [value]="outboundOrigin" readonly aria-readonly="true"></div>
              <div class="field"><span>Nơi đến · giữ nguyên</span><input class="control route-locked" [value]="outboundDestination" readonly aria-readonly="true"></div>
              <div class="field"><span>Ngày mới</span><input class="control" type="date" [(ngModel)]="outboundDate" [min]="minDate" [max]="maxDate"></div>
            </div>
            <p class="route-note">Đổi vé chỉ cho phép đổi ngày/chuyến bay; tuyến {{outboundOrigin}} → {{outboundDestination}} được giữ nguyên theo vé gốc.</p>
          </div>
        }

        @if(needsReturn){
          <div class="search-block" [class.with-divider]="needsOutbound">
            <div class="block-title"><span class="step">{{needsOutbound?2:1}}</span><div><b>Chuyến mới · chiều về</b><small>{{returnOrigin}} → {{returnDestination}}</small></div></div>
            <div class="grid grid-3">
              <div class="field"><span>Nơi đi · giữ nguyên</span><input class="control route-locked" [value]="returnOrigin" readonly aria-readonly="true"></div>
              <div class="field"><span>Nơi đến · giữ nguyên</span><input class="control route-locked" [value]="returnDestination" readonly aria-readonly="true"></div>
              <div class="field"><span>Ngày mới</span><input class="control" type="date" [(ngModel)]="returnDate" [min]="minDate" [max]="maxDate"></div>
            </div>
            <p class="route-note">Đổi vé chỉ cho phép đổi ngày/chuyến bay; tuyến {{returnOrigin}} → {{returnDestination}} được giữ nguyên theo vé gốc.</p>
          </div>
        }

        <div class="search-actions">
          <span class="muted">Tìm direct và hành trình nối chuyến trong cửa sổ đặt vé 330 ngày.</span>
          <button class="btn btn-primary" (click)="search()" [disabled]="busy">{{busy?'Đang tìm…':'Tìm chuyến thay thế'}}</button>
        </div>
      </section>

      @if(needsOutbound){
        <ng-container *ngTemplateOutlet="resultsSection; context: {$implicit:'OUTBOUND'}"></ng-container>
      }
      @if(needsReturn){
        <ng-container *ngTemplateOutlet="resultsSection; context: {$implicit:'RETURN'}"></ng-container>
      }

      <ng-template #resultsSection let-kind>
        @if(hasResults(kind)){
          <div class="section-head result-head">
            <div><div class="eyebrow">{{kind==='OUTBOUND'?'CHIỀU ĐI':'CHIỀU VỀ'}}</div><h2>Chọn chuyến thay thế</h2></div>
            <span class="pill pill-gold">{{resultCount(kind)}} lựa chọn</span>
          </div>
        }

        @for(f of directFor(kind);track f.flight_id+f.inventory_id){
          <article class="card flight" [class.chosen]="isSelected(kind,'DIRECT',f)">
            <div>
              <small>APTECH AIRLINES</small>
              <b>{{f.flight_number}}</b>
              <span>{{f.origin_iata}} {{clock(f.scheduled_departure_local||f.scheduled_departure)}} → {{f.dest_iata}} {{clock(f.scheduled_arrival_local||f.scheduled_arrival)}}</span>
            </div>
            <div><strong>{{money(f.total_party_price)}}</strong><small>Còn {{f.available_seats}} ghế</small></div>
            <button class="btn btn-primary" (click)="selectDirect(kind,f)" [disabled]="busy">{{isSelected(kind,'DIRECT',f)?'Đã chọn':'Chọn'}}</button>
          </article>
        }

        @for(r of connectionsFor(kind);track routeKey(r,$index)){
          <article class="card connection" [class.chosen]="isSelected(kind,'CONNECTING',r)">
            <div class="connection-title">
              <div><span class="pill pill-gold">{{r.legs?.length||2}} chặng</span><h3>{{r.legs?.[0]?.origin_iata}} → {{r.legs?.[r.legs.length-1]?.dest_iata}}</h3></div>
              <strong>{{duration(r.total_duration_minutes)}}</strong>
            </div>
            @for(l of r.legs;track l.flight_id){
              <div class="leg"><b>{{l.flight_number}}</b><span>{{l.origin_iata}} {{clock(l.scheduled_departure_local||l.scheduled_departure||l.departure)}}</span><span>→</span><span>{{l.dest_iata}} {{clock(l.scheduled_arrival_local||l.scheduled_arrival||l.arrival)}}</span></div>
            }
            <div class="connection-foot">
              <span class="muted">Các chặng nối được đổi cùng một lần.</span>
              <button class="btn btn-primary" (click)="selectConnection(kind,r)" [disabled]="busy">{{isSelected(kind,'CONNECTING',r)?'Đã chọn':'Chọn'}}</button>
            </div>
          </article>
        }

        @if(wasSearched(kind)&&!hasResults(kind)){
          <div class="card empty"><h2>Không có chuyến phù hợp cho {{kind==='OUTBOUND'?'chiều đi':'chiều về'}}</h2><p class="muted">Thử một ngày khác trong cửa sổ đặt vé.</p></div>
        }
      </ng-template>

      @if(needsBothSelections&&!quote&&(selectedOutbound||selectedReturn)){
        <div class="card selection-progress">
          <b>Đã chọn {{selectedOutbound?'chiều đi':''}}{{selectedOutbound&&selectedReturn?' và ':''}}{{selectedReturn?'chiều về':''}}.</b>
          <span>Chọn đủ cả hai chiều để hệ thống lấy báo giá tổng.</span>
        </div>
      }

      @if(quote){
        <section class="card quote">
          <div>
            <div class="eyebrow">BÁO GIÁ ĐỔI VÉ</div>
            <h2>{{selectedTitle}}</h2>
          </div>
          <div class="price-grid">
            <div><span>Booking hiện tại</span><strong>{{money(quote.old_total)}}</strong></div>
            <div><span>Hành trình mới</span><strong>{{money(quote.new_total)}}</strong></div>
            <div class="difference" [class.refund]="priceDifference<0"><span>Chênh lệch</span><strong>{{signedMoney(priceDifference)}}</strong></div>
          </div>
          @if(priceDifference>0){
            @if(auth.staff()){
              <p class="refund-note"><strong>Giao dịch tại quầy.</strong> Nhân viên xử lý phần chênh lệch theo luồng hỗ trợ hiện có.</p>
            }@else{
              <div class="payment">
                <label [class.disabled]="!paypalEnabled"><input type="radio" name="reschedulePayment" value="PAYPAL" [(ngModel)]="payment" [disabled]="!paypalEnabled"> <span><b>PayPal Checkout</b><small>{{paypalEnabled?'Thanh toán phần chênh lệch qua PayPal':'PayPal chưa được bật'}}</small></span></label>
              </div>
            }
          }@else if(priceDifference<0){
            <p class="refund-note"><strong>Hành trình mới rẻ hơn.</strong> Phần chênh lệch được hoàn về nguồn thanh toán gốc của booking; không cần nhập tài khoản hay thẻ mới tại đây.</p>
          }@else{
            <p class="refund-note">Không có chênh lệch giá, không cần thanh toán thêm.</p>
          }
          <div class="quote-actions">
            <button class="btn btn-outline" (click)="clearSelections()">Chọn lại</button>
            <button class="btn btn-primary" (click)="confirmReschedule()" [disabled]="busy">{{busy?'Đang xử lý…':'Xác nhận đổi chuyến'}}</button>
          </div>
        </section>
      }
    }
  </div>
  `,
  styles: [`
    .finder{padding:18px;margin:18px 0;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end}.code-field{max-width:560px}.notice-error{background:#fff0f0;border:1px solid #f0caca;padding:12px 14px;border-radius:14px}.booking-card{padding:20px;margin-bottom:14px}.booking-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.booking-head h2{margin:10px 0 5px;color:#071b2e}.booking-head p{margin:0;color:#68778a}.route-summary{display:grid;grid-template-columns:auto auto;gap:5px 14px;text-align:right}.route-summary span{font-size:10px;text-transform:uppercase;color:#82909e;font-weight:800}.route-summary strong{color:#102b42}.direction-picker{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;padding-top:16px;border-top:1px solid #e8edf1}.direction-picker button{border:1px solid #d9e1e7;background:#fff;color:#44576a;border-radius:999px;padding:9px 14px;font-weight:800;cursor:pointer}.direction-picker button.active{background:#0a2540;color:#fff;border-color:#0a2540}.direction-picker button:disabled{opacity:.38;cursor:not-allowed}.contract-note{margin:11px 0 0;padding:10px 12px;border-radius:12px;background:#f6f8fa;color:#647588;font-size:12px}.search-card{padding:20px;margin:14px 0}.search-block+.with-divider{border-top:1px solid #e7edf1;margin-top:20px;padding-top:20px}.block-title{display:flex;gap:10px;align-items:center;margin-bottom:12px}.block-title b,.block-title small{display:block}.block-title b{color:#102b42}.block-title small{color:#7a8997;margin-top:2px}.route-locked{background:#f3f6f8;color:#586b7d;font-weight:800;cursor:not-allowed}.route-note{margin:10px 0 0;color:#738394;font-size:11px}.step{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#fff1bf;color:#735608;font-weight:900;font-size:12px}.search-actions{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px}.result-head{margin-top:28px}.flight{padding:18px;margin-top:12px;display:grid;grid-template-columns:1.4fr .7fr auto;gap:16px;align-items:center}.flight.chosen,.connection.chosen{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.flight small,.flight span{display:block;color:#68778a;margin-top:4px}.flight b,.flight strong{display:block;color:#071b2e}.connection{padding:20px;margin-top:12px}.connection-title,.connection-foot{display:flex;align-items:center;justify-content:space-between;gap:15px}.connection-title h3{margin:8px 0 0;color:#071b2e}.leg{display:grid;grid-template-columns:80px 1fr auto 1fr;gap:10px;padding:10px 0;border-top:1px dashed #dfe7ed;font-size:13px}.leg:first-of-type{margin-top:14px}.connection-foot{border-top:1px solid #edf1f4;padding-top:14px}.selection-progress{padding:16px 18px;margin-top:18px;background:#f4f8fb}.selection-progress b,.selection-progress span{display:block}.selection-progress b{color:#17324a}.selection-progress span{color:#718093;font-size:12px;margin-top:3px}.quote{padding:24px;margin-top:24px}.quote h2{margin:7px 0 18px;color:#071b2e}.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.price-grid>div{background:#f7f9fb;border-radius:16px;padding:15px}.price-grid span{display:block;color:#68778a;font-size:11px;text-transform:uppercase;font-weight:800}.price-grid strong{display:block;color:#071b2e;font-size:20px;margin-top:6px}.price-grid .difference{background:#fff7df}.price-grid .difference.refund{background:#eaf8f1}.payment{display:flex;gap:18px;flex-wrap:wrap;margin:18px 0;font-weight:700;color:#435468}.payment label{display:flex;align-items:center;gap:10px;border:1px solid #d8e2e9;border-radius:14px;padding:12px 14px;background:#fff}.payment label:has(input:checked){border-color:#d6b35a;background:#fff8e5}.payment label span{display:grid;gap:2px}.payment label small{color:#718093;font-weight:500}.payment label.disabled{opacity:.45}.refund-note{background:#f3f7fa;color:#526579;padding:12px 14px;border-radius:14px;line-height:1.55}.quote-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.btn:disabled{opacity:.5;cursor:not-allowed}@media(max-width:850px){.finder{grid-template-columns:1fr}.booking-head,.search-actions,.connection-title,.connection-foot{align-items:flex-start;flex-direction:column}.route-summary{text-align:left}.price-grid{grid-template-columns:1fr}.flight{grid-template-columns:1fr}.leg{grid-template-columns:70px 1fr}.quote-actions{flex-direction:column}.quote-actions .btn{width:100%}}
  `]
})
export class RescheduleComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  api = inject(ApiService);
  auth = inject(AuthService);
  paypal = inject(PaypalService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  confirmation = '';
  booking: any = null;
  tracked: any = null;
  direction: RescheduleDirection = 'OUTBOUND';
  outboundOrigin = '';
  outboundDestination = '';
  outboundDate = '';
  returnOrigin = '';
  returnDestination = '';
  returnDate = '';
  minDate = this.localDate(new Date());
  maxDate = '';
  outboundData: any = null;
  returnData: any = null;
  outboundSearched = false;
  returnSearched = false;
  selectedOutbound: any = null;
  selectedReturn: any = null;
  quote: any = null;
  payment = 'PAYPAL';
  paypalEnabled = false;
  busy = false;
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};

  constructor() {
    this.confirmation = this.route.snapshot.queryParamMap.get('code') || '';
    this.api.bookingWindow().subscribe({
      next: r => { this.minDate = r.min_date; this.maxDate = r.max_date; },
      error: () => { const d = new Date(); d.setDate(d.getDate() + 330); this.maxDate = this.localDate(d); }
    });
    this.api.paypalConfig().subscribe({ next: r => this.paypalEnabled = !!r?.enabled, error: () => {} });
    if (this.confirmation) this.loadBooking(false);
  }

  get isRoundTrip() { return this.booking?.booking_type === 'ROUND_TRIP'; }
  get passengerTotal() { return this.booking?.passengers?.length || 1; }
  get cabin() { return this.booking?.ticket_coupons?.[0]?.cabin_class || 'ECONOMY'; }
  get cabinLabel() { return ({ ECONOMY: 'Phổ thông', CLUB: 'Club', BUSINESS: 'Thương gia', FIRST: 'Hạng nhất' } as any)[this.cabin] || this.cabin; }
  get needsOutbound() { return !this.isRoundTrip || this.direction === 'OUTBOUND' || this.direction === 'BOTH'; }
  get needsReturn() { return this.isRoundTrip && (this.direction === 'RETURN' || this.direction === 'BOTH'); }
  get needsBothSelections() { return this.direction === 'BOTH'; }
  get priceDifference() { return Number(this.quote?.price_difference || 0); }
  get supportsReturnOnly() { return this.isRoundTrip && (this.outboundIsConnecting || this.returnIsConnecting); }
  get selectedTitle() {
    if (this.direction === 'BOTH') return 'Đổi cả chiều đi và chiều về';
    return this.direction === 'RETURN' ? 'Đổi chiều về' : 'Đổi chiều đi';
  }
  bookingTypeLabel(value: string) { return ({ ONE_WAY: 'Một chiều', ROUND_TRIP: 'Khứ hồi', CONNECTING: 'Nối chuyến' } as any)[value] || value; }
  statusLabel(value: string) { return ({ BLOCKED: 'Đang giữ chỗ', CONFIRMED: 'Đã xác nhận', RESCHEDULED: 'Đã đổi chuyến', CANCELLED: 'Đã hủy' } as any)[value] || value; }

  get coupons() { return this.tracked?.flight_coupons || this.booking?.ticket_coupons || []; }
  get outboundCoupons() { return this.coupons.filter((c: any) => this.isOutboundLeg(c.leg_type)); }
  get returnCoupons() { return this.coupons.filter((c: any) => this.isInboundLeg(c.leg_type)); }
  get outboundIsConnecting() { return this.directionIsConnecting(this.outboundCoupons, 'OUTBOUND'); }
  get returnIsConnecting() { return this.directionIsConnecting(this.returnCoupons, 'RETURN'); }

  async loadBooking(showError = true) {
    if (!this.confirmation.trim()) { if (showError) this.error = 'Nhập confirmation number hoặc PNR trước.'; return false; }
    this.busy = true;
    this.error = '';
    try {
      const tracked = await firstValueFrom(this.api.track(this.confirmation.trim()));
      const booking = tracked?.booking_info || tracked;
      if (booking?.status !== 'CONFIRMED') throw new Error('Chỉ booking đang ở trạng thái CONFIRMED mới được đổi chuyến.');
      this.tracked = tracked;
      this.booking = booking;
      this.populateRoutesFromBooking();
      this.direction = 'OUTBOUND';
      this.resetSearchState();
      return true;
    } catch (e: any) {
      this.booking = null;
      this.tracked = null;
      if (showError) this.error = this.msg(e, 'Không tra cứu được booking.');
      return false;
    } finally {
      this.busy = false;
    }
  }

  setDirection(direction: RescheduleDirection) {
    if (direction === 'RETURN' && !this.supportsReturnOnly) return;
    this.direction = direction;
    this.resetSearchState();
  }

  async search() {
    this.error = '';
    this.quote = null;
    this.selectedOutbound = null;
    this.selectedReturn = null;
    this.outboundData = null;
    this.returnData = null;
    this.outboundSearched = false;
    this.returnSearched = false;
    if (!this.booking) { const ok = await this.loadBooking(true); if (!ok) return; }
    if (this.needsOutbound && (!this.outboundOrigin.trim() || !this.outboundDestination.trim() || !this.outboundDate)) { this.error = 'Nhập đủ tuyến và ngày mới cho chiều đi.'; return; }
    if (this.needsReturn && (!this.returnOrigin.trim() || !this.returnDestination.trim() || !this.returnDate)) { this.error = 'Nhập đủ tuyến và ngày mới cho chiều về.'; return; }
    if (this.needsOutbound && this.needsReturn && this.returnDate < this.outboundDate) { this.error = 'Ngày về mới phải bằng hoặc sau ngày đi mới.'; return; }

    this.busy = true;
    try {
      const jobs: Promise<any>[] = [];
      if (this.needsOutbound) jobs.push(this.searchDirection('OUTBOUND'));
      if (this.needsReturn) jobs.push(this.searchDirection('RETURN'));
      await Promise.all(jobs);
    } catch (e: any) {
      this.error = this.msg(e, 'Không tìm được chuyến thay thế.');
    } finally {
      this.busy = false;
    }
  }

  async searchDirection(kind: DirectionKey) {
    const origin = kind === 'OUTBOUND' ? this.outboundOrigin : this.returnOrigin;
    const destination = kind === 'OUTBOUND' ? this.outboundDestination : this.returnDestination;
    const departure_date = kind === 'OUTBOUND' ? this.outboundDate : this.returnDate;
    const data = await firstValueFrom(this.api.searchFlights({
      origin: origin.trim(),
      destination: destination.trim(),
      departure_date,
      cabin_class: this.cabin,
      ...this.passengerBreakdown(),
      include_connecting: true,
    }));
    if (kind === 'OUTBOUND') { this.outboundData = data; this.outboundSearched = true; }
    else { this.returnData = data; this.returnSearched = true; }
  }

  selectDirect(kind: DirectionKey, f: any) {
    const inv = this.inventory(f);
    const flightId = f.flight_id || f._id;
    const inventoryId = f.inventory_id || inv?._id || inv?.id;
    if (!flightId || !inventoryId) { this.error = 'Chuyến này thiếu inventory phù hợp.'; return; }
    const selected = { kind: 'DIRECT', source: f, flightId, inventoryId };
    if (kind === 'OUTBOUND') this.selectedOutbound = selected; else this.selectedReturn = selected;
    this.quoteWhenReady();
  }

  selectConnection(kind: DirectionKey, r: any) {
    const legs = (r.legs || []).map((l: any, i: number) => {
      const inv = this.inventory(l);
      return {
        flight_id: l.flight_id || l._id,
        inventory_id: l.inventory_id || inv?._id || inv?.id,
        leg_type: kind === 'RETURN' ? `INBOUND_${i + 1}` : `CONNECTING_${i + 1}`,
      };
    });
    if (!legs.length || legs.some((l: any) => !l.flight_id || !l.inventory_id)) { this.error = 'Hành trình nối chuyến thiếu inventory phù hợp.'; return; }
    const selected = { kind: 'CONNECTING', source: r, legs };
    if (kind === 'OUTBOUND') this.selectedOutbound = selected; else this.selectedReturn = selected;
    this.quoteWhenReady();
  }

  quoteWhenReady() {
    this.quote = null;
    if (this.needsOutbound && !this.selectedOutbound) return;
    if (this.needsReturn && !this.selectedReturn) return;
    this.quoteSelected();
  }

  async quoteSelected() {
    const payload = this.buildPayload();
    if (!payload) return;
    this.busy = true;
    this.error = '';
    this.quote = null;
    try { this.quote = await firstValueFrom(this.api.quoteReschedule(payload)); }
    catch (e: any) { this.error = this.msg(e, 'Không lấy được báo giá đổi chuyến.'); }
    finally { this.busy = false; }
  }

  async confirmReschedule() {
    const payload = this.buildPayload();
    if (!payload || !this.quote) return;
    this.busy = true;
    this.error = '';
    try {
      if (this.priceDifference > 0 && !this.auth.staff()) {
        if (!this.paypalEnabled) throw new Error('PayPal chưa được bật cho môi trường hiện tại.');
        let checkout = '';
        await this.paypal.pay(
          async () => {
            const created = await firstValueFrom(this.api.paypalRescheduleCreate({ ...payload, payment_method: 'PAYPAL', client_request_id: crypto.randomUUID() }));
            checkout = created.checkout_id;
            return { orderId: created.order_id };
          },
          async orderId => { await firstValueFrom(this.api.paypalRescheduleCapture(checkout, orderId)); }
        );
      } else if (this.priceDifference > 0 && this.auth.staff()) {
        await firstValueFrom(this.api.reschedule({ ...payload, payment_method: 'PROFILE_CARD' }));
      } else {
        await firstValueFrom(this.api.reschedule(payload));
      }
      this.router.navigate(['/trips']);
    } catch (e: any) {
      this.error = this.msg(e, 'Không đổi được chuyến.');
    } finally {
      this.busy = false;
    }
  }

  buildPayload() {
    const payload: any = { confirmation_number: this.confirmation.trim() };
    if (this.needsOutbound) {
      if (!this.selectedOutbound) return null;
      if (this.selectedOutbound.kind === 'CONNECTING') payload.new_legs = this.selectedOutbound.legs;
      else { payload.new_flight_id = this.selectedOutbound.flightId; payload.new_inventory_id = this.selectedOutbound.inventoryId; }
    }
    if (this.needsReturn) {
      if (!this.selectedReturn) return null;
      if (this.selectedReturn.kind === 'CONNECTING') payload.new_return_legs = this.selectedReturn.legs;
      else { payload.new_return_flight_id = this.selectedReturn.flightId; payload.new_return_inventory_id = this.selectedReturn.inventoryId; }
    }
    return payload;
  }

  populateRoutesFromBooking() {
    const out = this.outboundCoupons;
    const ret = this.returnCoupons;
    if (out.length) {
      this.outboundOrigin = out[0]?.origin_iata || this.outboundOrigin;
      this.outboundDestination = out[out.length - 1]?.dest_iata || this.outboundDestination;
    }
    if (ret.length) {
      this.returnOrigin = ret[0]?.origin_iata || this.outboundDestination || this.returnOrigin;
      this.returnDestination = ret[ret.length - 1]?.dest_iata || this.outboundOrigin || this.returnDestination;
    } else if (this.isRoundTrip) {
      this.returnOrigin = this.outboundDestination;
      this.returnDestination = this.outboundOrigin;
    }
  }

  resetSearchState() {
    this.outboundData = null;
    this.returnData = null;
    this.outboundSearched = false;
    this.returnSearched = false;
    this.selectedOutbound = null;
    this.selectedReturn = null;
    this.quote = null;
    this.error = '';
  }

  clearSelections() {
    this.selectedOutbound = null;
    this.selectedReturn = null;
    this.quote = null;
  }

  directFor(kind: DirectionKey) { return (kind === 'OUTBOUND' ? this.outboundData : this.returnData)?.onward_flights || []; }
  connectionsFor(kind: DirectionKey) { return (kind === 'OUTBOUND' ? this.outboundData : this.returnData)?.connecting_routes || []; }
  hasResults(kind: DirectionKey) { return this.resultCount(kind) > 0; }
  resultCount(kind: DirectionKey) { return this.directFor(kind).length + this.connectionsFor(kind).length; }
  wasSearched(kind: DirectionKey) { return kind === 'OUTBOUND' ? this.outboundSearched : this.returnSearched; }
  isSelected(kind: DirectionKey, selectedKind: string, source: any) { const s = kind === 'OUTBOUND' ? this.selectedOutbound : this.selectedReturn; return s?.kind === selectedKind && s?.source === source; }

  passengerBreakdown() {
    const result = { adults: 0, children: 0, seniors: 0 };
    for (const p of this.booking?.passengers || []) { if (p.passenger_type === 'CHILD') result.children++; else if (p.passenger_type === 'SENIOR') result.seniors++; else result.adults++; }
    if (result.adults + result.children + result.seniors === 0) result.adults = 1;
    return result;
  }
  inventory(f: any) { return (f.inventories || []).find((x: any) => x.cabin_class === this.cabin) || (f.inventories || [])[0]; }
  routeKey(r: any, i: number) { return (r.legs || []).map((l: any) => l.flight_id).join('-') || i; }
  isOutboundLeg(v: string) { const n = String(v || '').toUpperCase(); return n === 'OUTBOUND' || n.startsWith('CONNECTING_'); }
  isInboundLeg(v: string) { const n = String(v || '').toUpperCase(); return n === 'INBOUND' || n.startsWith('INBOUND_'); }
  directionIsConnecting(coupons: any[], kind: DirectionKey) {
    const ids = new Set(coupons.map(c => String(c.flight_id || c.flight_number || '')));
    return ids.size > 1 || coupons.some(c => kind === 'OUTBOUND' ? /^CONNECTING_\d+$/i.test(c.leg_type || '') : /^INBOUND_\d+$/i.test(c.leg_type || ''));
  }
  clock(v: string) { const m = (v || '').match(/(?:T|\s)(\d{2}:\d{2})/); return m?.[1] || '--:--'; }
  duration(v: number) { v = Number(v || 0); return `${Math.floor(v / 60)}h ${v % 60}m`; }
  money(v: number) { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v || 0); }
  signedMoney(v: number) { return `${v > 0 ? '+' : ''}${this.money(v)}`; }
  localDate(date: Date) { const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`; }
  msg(e: any, f: string) { const m = e?.error?.message; return Array.isArray(m) ? m.join(' · ') : m || e?.message || f; }
}
