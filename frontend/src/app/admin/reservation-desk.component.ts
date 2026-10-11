import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { LanguageService } from '../core/language.service';
import { passengerTypeForBirthDate } from '../core/passenger-profile.util';
import { formatDateTimeDayFirst, localCalendarDate } from '../core/date-format.util';
import { DayFirstDateInputComponent } from '../shared/day-first-date-input.component';

type Step = 1 | 2 | 3 | 4;
interface DeskOption { kind: 'DIRECT' | 'CONNECTING'; key: string; cabin: string; price: number; seats: number; legs: any[]; }

/**
 * Staff (CLERK/ADMIN) "đặt vé hộ khách" wizard:
 * 1. tìm / tạo nhanh khách  2. tìm chuyến (thẳng + nối chuyến)
 * 3. hành khách + ghế       4. giữ chỗ (>14 ngày), khách tự thanh toán PayPal.
 * Booking luôn được tạo với user_id = khách đã chọn (backend kiểm tra role CUSTOMER).
 */
@Component({
  standalone: true,
  imports: [FormsModule, DayFirstDateInputComponent],
  template: `
    <div class="eyebrow">CLERK / ADMIN</div>
    <h1 class="title">{{t('Quầy đặt vé hộ khách','Ticket desk')}}</h1>
    <p class="subtitle" translate="no">{{language.pick('4 bước: chọn khách → tìm chuyến → hành khách & ghế → giữ chỗ để khách thanh toán PayPal.', '4 steps: select customer → search flights → passengers & seats → hold for customer PayPal checkout.')}}</p>

    <ol class="stepper">
      @for(s of stepLabels;track s.n){
        <li [class.on]="step===s.n" [class.done]="step>s.n"><button type="button" (click)="goto(s.n)" [disabled]="!canGoto(s.n)"><span class="step">{{s.n}}</span><span translate="no">{{s.label}}</span></button></li>
      }
    </ol>
    
    

    <div class="desk-grid">
      <section class="card main-card">
        <!-- STEP 1 -->
        @if(step===1){
          <h3>{{t('1. Tìm khách hàng','1. Find customer')}}</h3>
          <div class="search-row">
            <input class="control" [(ngModel)]="query" (keyup.enter)="searchCustomer()" [placeholder]="t('Email, số điện thoại hoặc username','Email, phone number or username')">
            <button class="btn btn-primary" (click)="searchCustomer()" [disabled]="loadingCustomers">{{t('Tìm','Search')}}</button>
          </div>
          @if(loadingCustomers){<div class="empty muted">{{t('Đang tải khách hàng…','Loading customers…')}}</div>}
          @if(searched&&!loadingCustomers){
            <div class="customers">
              @for(c of matches;track c._id){
                <button class="customer" [class.selected]="customer?._id===c._id" (click)="selectCustomer(c)">
                  <span class="avatar" translate="no">{{initials(c)}}</span>
                  <span class="identity" translate="no"><strong>{{c.first_name}} {{c.last_name}}</strong><small>&#64;{{c.username}} · {{c.email}} · {{c.phone_number||'—'}}</small></span>
                </button>
              }
              @if(!matches.length){<div class="empty muted">{{t('Không tìm thấy khách hàng. Tạo tài khoản mới bên dưới.','No customer found. Create a new account below.')}}</div>}
            </div>
            <button class="btn btn-outline" (click)="showCreate=!showCreate" translate="no">{{showCreate?language.pick('Đóng form tạo khách', 'Close customer form'):language.pick('+ Tạo nhanh tài khoản khách', '+ Create customer')}}</button>
          }
          @if(showCreate){
            <form class="create-grid" (ngSubmit)="createCustomer()">
              <label class="field"><span>{{t('Tên đăng nhập *','Username *')}}</span><input class="control" name="u" [(ngModel)]="nc.username" required></label>
              <label class="field"><span>{{t('Mật khẩu * (≥6)','Password * (≥6)')}}</span><input class="control" name="p" [(ngModel)]="nc.password" required minlength="6"></label>
              <label class="field"><span>{{t('Họ *','Last name *')}}</span><input class="control" name="ln" [(ngModel)]="nc.last_name" required></label>
              <label class="field"><span>{{t('Tên *','First name *')}}</span><input class="control" name="fn" [(ngModel)]="nc.first_name" required></label>
              <label class="field"><span>Email *</span><input class="control" name="e" type="email" [(ngModel)]="nc.email" required></label>
              <label class="field"><span>{{t('Điện thoại *','Phone *')}}</span><input class="control" name="ph" [(ngModel)]="nc.phone_number" required></label>
              <label class="field wide"><span>{{t('Địa chỉ *','Address *')}}</span><input class="control" name="a" [(ngModel)]="nc.address" required></label>
              <label class="field"><span>{{t('Giới tính *','Gender *')}}</span><select class="control" name="s" [(ngModel)]="nc.sex"><option value="Male">{{t('Nam','Male')}}</option><option value="Female">{{t('Nữ','Female')}}</option><option value="Other">{{t('Khác','Other')}}</option></select></label>
              <label class="field"><span>{{t('Tuổi *','Age *')}}</span><input class="control" name="ag" type="number" min="0" [(ngModel)]="nc.age"></label>
              <button class="btn btn-primary wide" [disabled]="busy">{{t('Tạo tài khoản & chọn','Create and select account')}}</button>
            </form>
          }
        }

        <!-- STEP 2 -->
        @if(step===2){
          <h3>{{t('2. Tìm chuyến bay','2. Find flights')}}</h3>
          <div class="trip-tabs">
            <button type="button" [class.on]="!roundTrip" (click)="roundTrip=false;returnDate=''">{{t('Một chiều','One way')}}</button>
            <button type="button" [class.on]="roundTrip" (click)="roundTrip=true">{{t('Khứ hồi','Round trip')}}</button>
          </div>
          <div class="form-grid">
            <label class="field"><span>{{t('Nơi đi','Origin')}}</span><input class="control" [(ngModel)]="origin" placeholder="SGN"></label>
            <label class="field"><span>{{t('Nơi đến','Destination')}}</span><input class="control" [(ngModel)]="destination" placeholder="HAN"></label>
            <label class="field"><span>{{t('Ngày đi','Departure date')}}</span><app-date-input [(ngModel)]="departure" [min]="minDate" [max]="maxDate"/></label>
            @if(roundTrip){<label class="field"><span>{{t('Ngày về','Return date')}}</span><app-date-input [(ngModel)]="returnDate" [min]="departure||minDate" [max]="maxDate"/></label>}
            <label class="field"><span>{{t('Hạng ghế','Cabin')}}</span><select class="control" [(ngModel)]="cabin"><option value="">{{t('Tất cả','All')}}</option><option value="ECONOMY">{{label('ECONOMY')}}</option><option value="CLUB">{{label('CLUB')}}</option><option value="BUSINESS">{{label('BUSINESS')}}</option><option value="FIRST">{{label('FIRST')}}</option></select></label>
            <label class="field"><span>{{t('Người lớn','Adults')}}</span><input class="control" type="number" min="1" [(ngModel)]="adults"></label>
            <label class="field"><span>{{t('Trẻ em','Children')}}</span><input class="control" type="number" min="0" [(ngModel)]="children"></label>
            <label class="field"><span>{{t('Cao tuổi','Seniors')}}</span><input class="control" type="number" min="0" [(ngModel)]="seniors"></label>
          </div>
          <button class="btn btn-primary" (click)="search()" [disabled]="searching" translate="no">{{searching?language.pick('Đang tìm…', 'Searching…'):language.pick('Tìm chuyến (thẳng + nối chuyến)', 'Search flights (direct + connecting)')}}</button>
          @if(results){
          <h4>{{t('Chiều đi','Outbound')}} @if(outbound){<span class="pill pill-gold" translate="no">{{t('Đã chọn:', 'Selected:')}} {{optText(outbound)}}</span>}</h4>
            <table class="table">
              <thead><tr><th>{{t('Loại','Type')}}</th><th>{{t('Chuyến','Flight')}}</th><th>{{t('Khởi hành','Departure')}}</th><th>{{t('Hạng','Cabin')}}</th><th>{{t('Còn','Available')}}</th><th>{{t('Giá đoàn','Group fare')}}</th><th></th></tr></thead>
              <tbody>
                @for(o of outOptions;track o.key){
                  <tr [class.sel]="outbound?.key===o.key">
                    <td><span class="pill" translate="no">{{o.kind==='DIRECT'?language.pick('Bay thẳng', 'Direct'):language.pick('Nối chuyến', 'Connecting')}}</span></td>
                    <td translate="no">{{optText(o)}}</td><td>{{dt(o.legs[0]?.scheduled_departure)}}</td><td translate="no">{{label(o.cabin)}}</td><td>{{o.seats}}</td><td>{{money(o.price)}}</td>
                    <td><button class="btn btn-outline" (click)="outbound=o">{{t('Chọn','Select')}}</button></td>
                  </tr>
                }
                @if(!outOptions.length){<tr><td colspan="7" class="muted">{{t('Không có chuyến phù hợp.','No eligible flights.')}}</td></tr>}
              </tbody>
            </table>
            @if(roundTrip){
              <h4>{{t('Chiều về','Return')}} @if(inbound){<span class="pill pill-gold" translate="no">{{t('Đã chọn:', 'Selected:')}} {{optText(inbound)}}</span>}</h4>
              <table class="table">
                <thead><tr><th>{{t('Loại','Type')}}</th><th>{{t('Chuyến','Flight')}}</th><th>{{t('Khởi hành','Departure')}}</th><th>{{t('Hạng','Cabin')}}</th><th>{{t('Còn','Available')}}</th><th>{{t('Giá đoàn','Group fare')}}</th><th></th></tr></thead>
                <tbody>
                  @for(o of inOptions;track o.key){
                    <tr [class.sel]="inbound?.key===o.key">
                      <td><span class="pill" translate="no">{{o.kind==='DIRECT'?language.pick('Bay thẳng', 'Direct'):language.pick('Nối chuyến', 'Connecting')}}</span></td>
                      <td translate="no">{{optText(o)}}</td><td>{{dt(o.legs[0]?.scheduled_departure)}}</td><td translate="no">{{label(o.cabin)}}</td><td>{{o.seats}}</td><td>{{money(o.price)}}</td>
                      <td><button class="btn btn-outline" (click)="inbound=o">{{t('Chọn','Select')}}</button></td>
                    </tr>
                  }
                  @if(!inOptions.length){<tr><td colspan="7" class="muted">{{t('Không có chuyến về phù hợp.','No eligible return flights.')}}</td></tr>}
                </tbody>
              </table>
            }
            <button class="btn btn-primary" [disabled]="!outbound||(roundTrip&&!inbound)" (click)="toPassengers()">{{t('Tiếp tục: Hành khách','Continue: Passengers')}}</button>
          }
        }

        <!-- STEP 3 -->
        @if(step===3){
          <h3>{{t('3. Hành khách & ghế','3. Passengers & seats')}}</h3>
          @for(p of passengers;track $index){
            <div class="pax">
              <strong translate="no">{{language.pick('HK', 'Passenger')}} {{$index+1}} · {{paxLabel(p.passenger_type)}}</strong>
              <div class="form-grid">
                <label class="field"><span>{{t('Họ *','Last name *')}}</span><input class="control" [(ngModel)]="p.last_name"></label>
                <label class="field"><span>{{t('Tên *','First name *')}}</span><input class="control" [(ngModel)]="p.first_name"></label>
                <label class="field"><span>{{t('CCCD / Hộ chiếu','National ID / Passport')}}</span><input class="control" [(ngModel)]="p.id_card_or_passport"></label>
                <label class="field"><span>{{t('Ngày sinh *','Date of birth *')}}</span><app-date-input [(ngModel)]="p.date_of_birth" [max]="today"/></label>
              </div>
            </div>
          }
          <h4>{{t('Chọn ghế (tùy chọn – bỏ trống sẽ tự động xếp)','Seat selection (optional — leave blank for automatic assignment)')}}</h4>
          <div class="trip-tabs">
            @for(l of legs;track l.flight_id){<button type="button" [class.on]="seatLeg?.flight_id===l.flight_id" (click)="openSeatMap(l)">{{l.flight_number}} {{l.origin_iata}}→{{l.dest_iata}}</button>}
          </div>
          @if(seatLeg){
            <div class="trip-tabs">
              @for(p of passengers;track $index){<button type="button" [class.on]="seatPax===$index" (click)="seatPax=$index">{{language.pick('HK','Passenger')}} {{$index+1}}: {{seatFor($index,seatLeg.flight_id)||language.pick('Tự động','Automatic')}}</button>}
            </div>
            @if(seatLoading){<div class="empty muted">{{t('Đang tải sơ đồ ghế…','Loading seat map…')}}</div>}
            @else if(seatMapData){
              <div class="seatmap">
                @for(row of seatMapData.rows||[];track $index){
                  <div class="seat-row">
                    @for(s of row.seats||[];track s.seat_code){
                      <button type="button" class="seat" [title]="s.seat_code+' · '+money(fee(s))"
                        [class.taken]="s.is_occupied||takenByOther(s.seat_code)" [class.mine]="seatFor(seatPax,seatLeg.flight_id)===s.seat_code"
                        [class.other-cabin]="s.cabin_class&&s.cabin_class!==seatLeg.cabin_class"
                        [disabled]="s.is_occupied||s.is_blocked||takenByOther(s.seat_code)||(s.cabin_class&&s.cabin_class!==seatLeg.cabin_class)"
                        (click)="pickSeat(s)">{{s.seat_code}}</button>
                    }
                  </div>
                }
              </div>
              <button class="btn btn-outline" (click)="clearSeat()">{{language.pick('Bỏ chọn ghế hành khách','Clear seat for passenger')}} {{seatPax+1}}</button>
            }
          }
          <div class="nav-row">
            <button class="btn btn-outline" (click)="step=2">{{t('Quay lại','Back')}}</button>
             <button class="btn btn-primary" (click)="toCheckout()" translate="no">{{language.pick('Tiếp tục: Giữ chỗ', 'Continue: Hold booking')}}</button>
          </div>
        }

        <!-- STEP 4 -->
        @if(step===4){
           <h3 translate="no">{{language.pick('4. Giữ chỗ cho khách', '4. Hold for customer')}}</h3>
          @if(!result){
            @if(quoting){<div class="empty muted">{{t('Đang lấy báo giá…','Getting quote…')}}</div>}
            @if(quote){
              <div class="fare-line"><span>{{t('Giá vé','Fare')}}</span><b>{{money(quote.total_fare??quote.fare_total??0)}}</b></div>
              <div class="fare-line"><span>{{t('Phí chọn ghế','Seat fees')}}</span><b>{{money(quote.total_seat_fees??quote.seat_fee_total??0)}}</b></div>
              <div class="fare-line total"><span>{{t('Tổng','Total')}}</span><b>{{money(quote.total_amount??quote.total??0)}}</b></div>
            }
            <p class="muted">{{language.pick('Khởi hành sớm nhất','Earliest departure')}}: <b>{{dt(earliestDeparture)}}</b> ({{language.pick('còn','in')}} {{daysToDeparture}} {{language.pick('ngày','days')}}).</p>
             <div class="mode" [class.disabled]="!canBlock">
               <strong translate="no">{{language.pick('Giữ chỗ (miễn phí)', 'Free booking hold')}}</strong>
               <small translate="no">{{canBlock?language.pick('Khách nhận mã BLK- và hướng dẫn thanh toán PayPal qua email.', 'The customer receives a BLK- code and PayPal checkout instructions by email.'):language.pick('Không thể giữ chỗ khi khởi hành trong vòng 14 ngày. Khách cần tự đặt và thanh toán PayPal.', 'Holds are unavailable within 14 days of departure. The customer must book and pay using PayPal.')}}</small>
             </div>
            <div class="nav-row">
              <button class="btn btn-outline" (click)="step=3">{{t('Quay lại','Back')}}</button>
               <button class="btn btn-primary" (click)="submit()" [disabled]="busy||quoting||!canBlock" translate="no">{{busy?language.pick('Đang xử lý…', 'Processing…'):language.pick('Giữ chỗ cho khách', 'Hold for customer')}}</button>
            </div>
          }@else{
            <div class="result print-area">
              <span class="pill pill-gold" translate="no">{{statusLabel(result.status)}}</span>
              <div class="code" translate="no">{{result.confirmation_number||result.blocking_number}}</div>
              @if(result.pnr_code){<p>PNR: <b translate="no">{{result.pnr_code}}</b></p>}
              <p>{{language.pick('Khách','Customer')}}: <b translate="no">{{customer?.first_name}} {{customer?.last_name}}</b> (<span translate="no">{{customer?.email}}</span>)</p>
              <p>{{language.pick('Hành trình','Itinerary')}}: <span translate="no">{{legsText(result)}}</span></p>
              <p>{{language.pick('Tổng tiền','Total')}}: <b>{{money(result.total_amount)}}</b></p>
               @if(result.status==='BLOCKED'){<p class="muted" translate="no">{{language.pick('Khách dùng mã giữ chỗ để tra cứu và thanh toán bằng PayPal. Vui lòng kiểm tra email hướng dẫn.', 'The customer can track this hold and pay via PayPal. Please check the instruction email.')}}</p>}
            </div>
            <div class="nav-row no-print">
              <button class="btn btn-outline" (click)="print()">{{t('In mã đặt chỗ','Print booking code')}}</button>
              <button class="btn btn-primary" (click)="newBooking()">{{t('Đặt vé mới cho khách này','New booking for this customer')}}</button>
            </div>
          }
        }
      </section>

      <!-- SIDE: customer + bookings -->
      <aside class="side">
        <div class="card side-card">
          <strong>{{t('Khách đang phục vụ','Current customer')}}</strong>
          @if(customer){
            <div class="selected-customer">
              <span class="avatar" translate="no">{{initials(customer)}}</span>
              <div translate="no"><strong>{{customer.first_name}} {{customer.last_name}}</strong><small>&#64;{{customer.username}} · {{customer.email}}</small><small>{{customer.phone_number||'—'}}</small></div>
            </div>
            <button class="btn btn-outline" (click)="resetCustomer()">{{t('Đổi khách','Change customer')}}</button>
          }@else{<p class="muted">{{t('Chưa chọn khách.','No customer selected.')}}</p>}
        </div>
        @if(customer){
          <div class="card side-card">
            <div class="panel-head"><strong>{{t('Đặt chỗ của khách','Customer bookings')}}</strong><button class="btn btn-outline" (click)="loadBookings()">{{t('Làm mới','Refresh')}}</button></div>
            @if(loadingBookings){<p class="muted">{{t('Đang tải…','Loading…')}}</p>}
            @for(b of customerBookings;track b._id){
              <div class="bk">
                <div><b translate="no">{{b.confirmation_number||b.blocking_number}}</b> <span class="pill" translate="no">{{statusLabel(b.status)}}</span></div>
                <small translate="no">{{typeLabel(b.booking_type)}} · {{money(b.total_amount)}} · {{dt(b.created_at||b.createdAt)}}</small>
                @if(b.status!=='CANCELLED'){
                  <div class="bk-actions">
                     @if(b.status==='BLOCKED'){<small translate="no">{{language.pick('Chờ khách thanh toán PayPal', 'Awaiting customer PayPal payment')}}</small>}
                    @if(b.status!=='BLOCKED'){<button class="btn btn-outline" (click)="rescheduleBooking(b)">{{t('Đổi','Reschedule')}}</button>}
                    <button class="btn btn-outline danger" (click)="cancelBooking(b)" [disabled]="busy">{{t('Hủy','Cancel')}}</button>
                  </div>
                }
              </div>
            }
            @if(!loadingBookings&&!customerBookings.length){<p class="muted">{{t('Khách chưa có đặt chỗ.','This customer has no bookings.')}}</p>}
          </div>
        }
      </aside>
    </div>
  `,
  styles: [`
    .stepper{display:flex;gap:8px;list-style:none;padding:0;margin:18px 0;flex-wrap:wrap}.stepper button{display:flex;gap:8px;align-items:center;border:1px solid #dce4ea;background:#fff;border-radius:999px;padding:6px 14px 6px 6px;font-weight:800;color:#647587}.stepper li.on button{border-color:#071b2e;color:#071b2e}.stepper li.done button{color:#a67717}
    .step{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#f2c85f;font-size:11px;font-weight:900}
    .desk-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px}.main-card,.side-card{padding:20px}.side{display:grid;gap:14px;align-content:start}
    .search-row,.nav-row,.bk-actions{display:flex;gap:8px;margin:10px 0}.search-row input{flex:1}.nav-row{justify-content:space-between;margin-top:18px}
    .customers{display:grid;gap:8px;margin:12px 0;max-height:420px;overflow:auto}.customer{border:1px solid #e0e7ed;background:#fff;border-radius:16px;padding:10px;display:grid;grid-template-columns:42px 1fr auto;gap:11px;align-items:center;text-align:left}.customer.selected,.customer:hover{border-color:#d6b35a;background:#fffaf0}
    .avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#0e3150;color:#f2c85f;font-weight:900}.identity,.selected-customer>div{display:grid;gap:3px;min-width:0}.identity small,.selected-customer small{color:#718093;font-size:11px}
    .selected-customer{display:flex;gap:12px;align-items:center;background:#f7f9fb;border-radius:16px;padding:12px;margin:10px 0}
    .create-grid,.form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px;margin:12px 0}.wide{grid-column:1/-1}
    .trip-tabs{display:flex;gap:7px;margin:10px 0;flex-wrap:wrap}.trip-tabs button{border:1px solid #dce4ea;background:#fff;color:#647587;border-radius:999px;padding:7px 12px;font-size:11px;font-weight:800}.trip-tabs button.on{background:#071b2e;border-color:#071b2e;color:#fff}
    tr.sel td{background:#fffaf0}.pax{border:1px solid #e0e7ed;border-radius:14px;padding:12px;margin-bottom:10px}
    .seatmap{display:grid;gap:4px;max-height:380px;overflow:auto;padding:8px;background:#f7f9fb;border-radius:12px;margin-bottom:10px}.seat-row{display:flex;gap:4px}.seat{width:38px;height:30px;font-size:10px;border:1px solid #c9d5df;border-radius:6px;background:#fff}.seat.taken{background:#e3e7eb;color:#9aa6b2}.seat.mine{background:#071b2e;color:#f2c85f}.seat.other-cabin{opacity:.35}
    .fare-line{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #e0e7ed}.fare-line.total{font-size:16px}
    .mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.mode{border:1px solid #dce4ea;border-radius:14px;padding:12px;display:grid;gap:4px;cursor:pointer}.mode.on{border-color:#d6b35a;background:#fffaf0}.mode.disabled{opacity:.5;cursor:not-allowed}
    .result{border:2px dashed #d6b35a;border-radius:18px;padding:20px;text-align:center}.code{font-size:30px;font-weight:900;letter-spacing:2px;color:#071b2e;margin:10px 0}
    .bk{border-top:1px solid #eef2f5;padding:10px 0;display:grid;gap:4px}.bk small{color:#718093}.danger{color:#b42318}.panel-head{display:flex;justify-content:space-between;align-items:center}
    .notice{color:#05603a;background:#ecfdf3;padding:8px 12px;border-radius:10px}.empty{padding:20px;text-align:center}.btn:disabled{opacity:.45;cursor:not-allowed}
    @media(max-width:960px){.desk-grid{grid-template-columns:1fr}}
    @media print{.no-print,.stepper,.side,.eyebrow,.title,.subtitle{display:none!important}}
  `],
})
export class ReservationDeskComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  readonly language = inject(LanguageService);
  api = inject(ApiService);
  router = inject(Router);
  get stepLabels() { return [
    { n: 1 as Step, label: this.language.pick('Khách hàng', 'Customer') },
    { n: 2 as Step, label: this.language.pick('Chuyến bay', 'Flights') },
    { n: 3 as Step, label: this.language.pick('Hành khách & ghế', 'Passengers & seats') },
     { n: 4 as Step, label: this.language.pick('Giữ chỗ', 'Hold') },
  ]; }
  t(vi: string, en: string) { return this.language.pick(vi, en); }
  step: Step = 1; private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)}; private __notice='';get notice(){return this.__notice}set notice(v:string){this.__notice=v;this.__toast.notifySuccess(v)}; busy = false;
  // step 1
  allCustomers: any[] = []; matches: any[] = []; query = ''; searched = false; loadingCustomers = false; customer: any = null; showCreate = false;
  nc: any = this.blankCustomer();
  // step 2
  origin = 'SGN'; destination = 'HAN'; departure = ''; returnDate = ''; roundTrip = false; cabin = ''; adults = 1; children = 0; seniors = 0;
  minDate = ''; maxDate = ''; searching = false; results: any = null; outbound: DeskOption | null = null; inbound: DeskOption | null = null;
  // step 3
  passengers: any[] = []; seatRequests: any[] = []; seatLeg: any = null; seatPax = 0; seatMapData: any = null; seatLoading = false; private seatCache = new Map<string, any>();
  today = localCalendarDate();
  // step 4
   quote: any = null; quoting = false; result: any = null;
  // bookings panel
  customerBookings: any[] = []; loadingBookings = false; policies: any[] = [];

  constructor() {
    this.api.bookingWindow().subscribe({ next: r => { this.minDate = r.current_date || r.min_date || ''; this.maxDate = r.max_date || ''; if (!this.departure) this.departure = this.minDate; }, error: () => {} });
    this.api.policies().subscribe({ next: p => this.policies = p || [], error: () => {} });
  }

  // ---------- navigation ----------
  canGoto(n: Step) { if (n === 1) return true; if (!this.customer) return false; if (n === 2) return true; if (n === 3) return !!this.outbound && (!this.roundTrip || !!this.inbound); return this.passengers.length > 0; }
  goto(n: Step) { if (this.canGoto(n) && !this.result) { this.step = n; this.error = ''; if (n === 4) this.loadQuote(); } }

  // ---------- step 1 ----------
  private async ensureCustomers(force = false) {
    if (this.allCustomers.length && !force) return;
    this.loadingCustomers = true;
    try { this.allCustomers = ((await firstValueFrom(this.api.users())) || []).filter((u: any) => u.role === 'CUSTOMER'); }
    finally { this.loadingCustomers = false; }
  }
  async searchCustomer() {
    this.error = ''; const q = this.query.trim().toLowerCase();
    if (!q) { this.error = this.language.pick('Nhập email, số điện thoại hoặc username.','Enter an email, phone number, or username.'); return; }
    try {
      await this.ensureCustomers(true);
      const digits = q.replace(/\D/g, '');
      this.matches = this.allCustomers.filter(c => [c.email, c.username].some(v => String(v || '').toLowerCase().includes(q))
        || (digits.length >= 4 && String(c.phone_number || '').replace(/\D/g, '').includes(digits))
        || `${c.first_name} ${c.last_name}`.toLowerCase().includes(q));
      this.searched = true;
      if (!this.matches.length) { this.showCreate = true; this.prefillCreate(q); }
    } catch (e) { this.error = this.msg(e, this.language.pick('Không tải được danh sách khách hàng.','Unable to load customers.')); }
  }
  private prefillCreate(q: string) {
    if (q.includes('@')) { this.nc.email = q; this.nc.username = q.split('@')[0]; }
    else if (/^\+?\d[\d\s]{6,}$/.test(q)) this.nc.phone_number = q.replace(/\s/g, '');
    else this.nc.username = q;
  }
  selectCustomer(c: any) {
    this.customer = c; this.step = 2; this.result = null; this.notice = '';
    this.loadBookings();
  }
  resetCustomer() { this.customer = null; this.customerBookings = []; this.step = 1; this.result = null; this.outbound = this.inbound = null; this.results = null; this.passengers = []; this.seatRequests = []; }
  async createCustomer() {
    this.error = '';
    const n = this.nc; const required = ['username', 'password', 'first_name', 'last_name', 'email', 'phone_number', 'address', 'sex'];
    if (required.some(k => !String(n[k] ?? '').trim()) || n.age === '' || n.age == null) { this.error = this.language.pick('Vui lòng nhập đủ các trường bắt buộc (*).','Complete all required fields (*).'); return; }
    if (String(n.password).length < 6) { this.error = this.language.pick('Mật khẩu tối thiểu 6 ký tự.','Password must contain at least 6 characters.'); return; }
    const body: any = { ...n, username: n.username.trim(), email: n.email.trim(), age: Math.max(0, Math.floor(Number(n.age) || 0)) };
    this.busy = true;
    try {
      // POST /auth/register: public CUSTOMER sign-up (CLERK can't call POST /users). Token returned is ignored – staff session is untouched.
      await firstValueFrom(this.api.register(body));
      await this.ensureCustomers(true);
      const created = this.allCustomers.find(c => String(c.email).toLowerCase() === body.email.toLowerCase() || c.username === body.username);
      if (!created) throw new Error(this.language.pick('Đã tạo tài khoản nhưng không tìm thấy trong danh sách.','The account was created but could not be found in the customer list.'));
      this.notice = this.language.pick(`Đã tạo tài khoản khách ${created.username}.`,`Customer account ${created.username} created.`);
      this.showCreate = false; this.nc = this.blankCustomer();
      this.selectCustomer(created);
    } catch (e) { this.error = this.msg(e, this.language.pick('Không tạo được tài khoản khách.','Unable to create customer account.')); }
    finally { this.busy = false; }
  }
  private blankCustomer() { return { username: '', password: '', first_name: '', last_name: '', email: '', phone_number: '', address: '', sex: 'Male', age: 30 }; }

  // ---------- step 2 ----------
  search() {
    this.error = '';
    const origin = this.origin.trim().toUpperCase(), destination = this.destination.trim().toUpperCase();
    this.adults = Math.max(1, Math.floor(Number(this.adults) || 1)); this.children = Math.max(0, Math.floor(Number(this.children) || 0)); this.seniors = Math.max(0, Math.floor(Number(this.seniors) || 0));
    if (!origin || !destination || !this.departure) { this.error = this.language.pick('Vui lòng nhập nơi đi, nơi đến và ngày đi.','Enter origin, destination, and departure date.'); return; }
    if (origin === destination) { this.error = this.language.pick('Nơi đi và nơi đến phải khác nhau.','Origin and destination must be different.'); return; }
    if (this.roundTrip && (!this.returnDate || this.returnDate < this.departure)) { this.error = this.language.pick('Ngày về phải bằng hoặc sau ngày đi.','Return date must be on or after the departure date.'); return; }
    const q: any = { origin, destination, departure_date: this.departure, adults: this.adults, children: this.children, seniors: this.seniors, include_connecting: true };
    if (this.roundTrip) q.return_date = this.returnDate;
    this.searching = true; this.outbound = this.inbound = null; this.results = null;
    this.api.searchFlights(q).subscribe({
      next: r => { this.results = r; this.searching = false; },
      error: e => { this.error = this.msg(e, this.language.pick('Không tìm được chuyến bay.','Unable to find flights.')); this.searching = false; },
    });
  }
  get partySize() { return this.adults + this.children + this.seniors; }
  get outOptions() { return this.buildOptions(this.results?.onward_flights, this.results?.connecting_routes, 'OUTBOUND'); }
  get inOptions() { return this.buildOptions(this.results?.return_flights, this.results?.return_connecting_routes, 'INBOUND'); }
  private buildOptions(direct: any[] = [], connecting: any[] = [], dir: 'OUTBOUND' | 'INBOUND'): DeskOption[] {
    const out: DeskOption[] = [];
    for (const f of direct || []) {
      if (this.cabin && f.cabin_class !== this.cabin) continue;
      if (Number(f.available_seats || 0) < this.partySize) continue;
      const flightId = String(f.flight_id || f._id); const inv = String(f.inventory_id || f._id || '');
      out.push({ kind: 'DIRECT', key: `${dir}:${flightId}:${inv}`, cabin: f.cabin_class, price: Number(f.total_party_price || 0), seats: Number(f.available_seats || 0),
        legs: [{ ...f, flight_id: flightId, inventory_id: inv, leg_type: dir }] });
    }
    for (const r of connecting || []) {
      const legs = r.legs || []; if (!legs.length) continue;
      const cabins = new Set<string>((legs[0].inventories || []).map((i: any) => String(i.cabin_class)));
      for (const l of legs.slice(1)) for (const c of [...cabins]) if (!(l.inventories || []).some((i: any) => i.cabin_class === c)) cabins.delete(c);
      for (const c of cabins) {
        if (this.cabin && c !== this.cabin) continue;
        const invs = legs.map((l: any) => (l.inventories || []).find((i: any) => i.cabin_class === c));
        const seats = Math.min(...invs.map((i: any) => Number(i?.available_seats || 0)));
        if (seats < this.partySize) continue;
        const prefix = dir === 'INBOUND' ? 'INBOUND' : 'CONNECTING';
        const mapped = legs.map((l: any, i: number) => ({ ...l, flight_id: String(l.flight_id || l._id), inventory_id: String(invs[i]?._id || invs[i]?.id || ''), cabin_class: c, leg_type: `${prefix}_${i + 1}` }));
        out.push({ kind: 'CONNECTING', key: `${dir}:${mapped.map((m: any) => m.flight_id + ':' + m.inventory_id).join('>')}`, cabin: c,
          price: invs.reduce((s: number, i: any) => s + Number(i?.total_party_price || 0), 0), seats, legs: mapped });
      }
    }
    return out.sort((a, b) => String(a.legs[0]?.scheduled_departure || '').localeCompare(String(b.legs[0]?.scheduled_departure || '')) || a.price - b.price);
  }
  optText(o: DeskOption) { return o.legs.map(l => `${l.flight_number || ''} ${l.origin_iata || ''}→${l.dest_iata || ''}`).join(' + '); }
  get legs(): any[] { return [...(this.outbound?.legs || []), ...(this.roundTrip ? this.inbound?.legs || [] : [])]; }
  get bookingType() { return this.roundTrip ? 'ROUND_TRIP' : (this.outbound?.legs.length || 0) > 1 ? 'CONNECTING' : 'ONE_WAY'; }

  // ---------- step 3 ----------
  toPassengers() {
    const types = [...Array(this.adults).fill('ADULT'), ...Array(this.children).fill('CHILD'), ...Array(this.seniors).fill('SENIOR')];
    const same = this.passengers.length === types.length && this.passengers.every((p, i) => p.passenger_type === types[i]);
    if (!same) {
      this.passengers = types.map(t => ({ first_name: '', last_name: '', passenger_type: t, id_card_or_passport: '', nationality: 'Vietnam', date_of_birth: '' }));
      const first = this.passengers.findIndex(p => p.passenger_type !== 'CHILD');
      if (first >= 0) Object.assign(this.passengers[first], {
        first_name: this.customer?.first_name || '',
        last_name: this.customer?.last_name || '',
        id_card_or_passport: this.customer?.id_card_or_passport || '',
        nationality: this.customer?.nationality || 'Vietnam',
        date_of_birth: String(this.customer?.date_of_birth || '').slice(0, 10),
      });
    }
    const flightIds = new Set(this.legs.map(l => l.flight_id));
    this.seatRequests = this.seatRequests.filter(r => flightIds.has(r.flight_id) && r.passenger_index < this.passengers.length);
    this.seatLeg = null; this.seatMapData = null; this.step = 3;
  }
  openSeatMap(l: any) {
    this.seatLeg = l; this.seatPax = 0; const cached = this.seatCache.get(l.flight_id);
    if (cached) { this.seatMapData = cached; return; }
    this.seatLoading = true; this.seatMapData = null;
    this.api.seatMap(l.flight_id).subscribe({
      next: r => { this.seatCache.set(l.flight_id, r); if (this.seatLeg === l) this.seatMapData = r; this.seatLoading = false; },
      error: e => { this.error = this.msg(e, this.language.pick('Không tải được sơ đồ ghế.','Unable to load seat map.')); this.seatLoading = false; },
    });
  }
  seatFor(pax: number, flightId: string) { return this.seatRequests.find(r => r.passenger_index === pax && r.flight_id === flightId)?.seat_code || ''; }
  takenByOther(code: string) { return this.seatRequests.some(r => r.flight_id === this.seatLeg?.flight_id && r.seat_code === code && r.passenger_index !== this.seatPax); }
  pickSeat(s: any) {
    this.clearSeat();
    this.seatRequests.push({ passenger_index: this.seatPax, flight_id: this.seatLeg.flight_id, selection_type: 'CHOOSE', seat_code: s.seat_code });
    if (this.seatPax < this.passengers.length - 1) this.seatPax++;
  }
  clearSeat() { this.seatRequests = this.seatRequests.filter(r => !(r.passenger_index === this.seatPax && r.flight_id === this.seatLeg?.flight_id)); }
  fee(s: any) { return Number(s?.fee ?? s?.seat_fee ?? s?.price ?? 0); }
  toCheckout() {
    this.error = '';
    if (this.passengers.some(p => !String(p.first_name).trim() || !String(p.last_name).trim())) { this.error = this.language.pick('Nhập họ và tên cho tất cả hành khách.','Enter first and last names for every passenger.'); return; }
    if (this.passengers.some(p => !p.date_of_birth)) { this.error = this.language.pick('Nhập ngày sinh cho tất cả hành khách để xác nhận đúng loại vé.','Enter the date of birth of every passenger to verify the correct fare category.'); return; }
    const invalidAgeIndex = this.passengers.findIndex(p => passengerTypeForBirthDate(p.date_of_birth, this.departureDate) !== p.passenger_type);
    if (invalidAgeIndex >= 0) {
      const passenger = this.passengers[invalidAgeIndex];
      const actualType = passengerTypeForBirthDate(passenger.date_of_birth, this.departureDate);
      if (actualType === 'INFANT') this.error = this.language.pick(`Hành khách ${invalidAgeIndex + 1} chưa đủ 2 tuổi vào ngày khởi hành; luồng hiện tại chưa hỗ trợ vé em bé.`,`Passenger ${invalidAgeIndex + 1} will be under 2 on departure; infant fares are not supported yet.`);
      else this.error = this.language.pick(`Hành khách ${invalidAgeIndex + 1} không đúng nhóm tuổi ${this.paxLabel(passenger.passenger_type)} đã chọn.`,`Passenger ${invalidAgeIndex + 1} does not match the selected ${this.paxLabel(passenger.passenger_type)} age category.`);
      return;
    }
    this.step = 4; this.loadQuote();
  }

  // ---------- step 4 ----------
  get departureDate() { const first = this.outbound?.legs?.[0] || this.legs[0]; return String(first?.departure_date || first?.scheduled_departure_local || first?.scheduled_departure || this.departure || '').slice(0, 10); }
  get earliestDeparture() { const t = this.legs.map(l => new Date(l.scheduled_departure || '').getTime()).filter(Number.isFinite); return t.length ? new Date(Math.min(...t)).toISOString() : ''; }
  get daysToDeparture() { const e = this.earliestDeparture; return e ? Math.floor((new Date(e).getTime() - Date.now()) / 86_400_000) : 0; }
  get canBlock() { const e = this.earliestDeparture; return !!e && (new Date(e).getTime() - Date.now()) / 86_400_000 > 14; }
  private payload() {
    const passengers = this.passengers.map(p => { const x: any = { ...p }; for (const k of ['id_card_or_passport', 'date_of_birth']) if (!x[k]) delete x[k]; return x; });
    return { user_id: this.customer._id, booking_type: this.bookingType, is_block: true, passengers,
      legs: this.legs.map(l => ({ flight_id: l.flight_id, inventory_id: l.inventory_id, leg_type: l.leg_type })),
      seat_requests: this.seatRequests };
  }
  loadQuote() {
    this.quoting = true; this.quote = null;
    this.api.quoteBooking(this.payload()).subscribe({
      next: q => { this.quote = q; this.quoting = false; },
      error: e => { this.error = this.msg(e, this.language.pick('Không lấy được báo giá.','Unable to retrieve quote.')); this.quoting = false; },
    });
  }
  async submit() {
    this.error = '';
    if (!this.canBlock) { this.error = this.language.pick('Chỉ được giữ chỗ khi ngày khởi hành còn hơn 14 ngày. Khách cần tự đặt và thanh toán PayPal.', 'Holds require departure more than 14 days away. The customer must book and pay via PayPal.'); return; }
    this.busy = true;
    try {
      this.result = await firstValueFrom(this.api.createBooking(this.payload()));
      this.loadBookings();
    } catch (e) { this.error = this.msg(e, this.language.pick('Không tạo được booking.','Unable to create booking.')); }
    finally { this.busy = false; }
  }
  legsText(b: any) { const c = b?.flight_coupons || b?.legs || []; return c.length ? c.map((x: any) => x.flight_number || x.flight_id?.flight_number || '').filter(Boolean).join(' + ') || this.legs.map(l => l.flight_number).join(' + ') : this.legs.map(l => l.flight_number).join(' + '); }
  print() { window.print(); }
  newBooking() { this.result = null; this.quote = null; this.outbound = this.inbound = null; this.results = null; this.passengers = []; this.seatRequests = []; this.step = 2; }

  // ---------- bookings panel ----------
  loadBookings() {
    if (!this.customer) return;
    this.loadingBookings = true;
    this.api.customerBookings(this.customer._id).subscribe({
      next: r => { this.customerBookings = (r || []).sort((a: any, b: any) => String(b.created_at || b.createdAt || '').localeCompare(String(a.created_at || a.createdAt || ''))); this.loadingBookings = false; },
      error: e => { this.error = this.msg(e, this.language.pick('Không tải được booking của khách.','Unable to load customer bookings.')); this.loadingBookings = false; },
    });
  }
  rescheduleBooking(b: any) { this.router.navigate(['/reschedule'], { queryParams: { code: b.confirmation_number || b.pnr_code } }); }
  async cancelBooking(b: any) {
    const code = b.confirmation_number || b.blocking_number || b.pnr_code;
    this.busy = true; this.error = '';
    try {
      const tracked = await firstValueFrom(this.api.track(code));
      const live = tracked?.booking_info || b;
      const pct = this.refundPercent(live, tracked?.flight_coupons || []);
      const amount = Math.round(Number(live.total_amount || 0) * pct / 100);
      const isBlocked = live.status === 'BLOCKED';
      const confirmed = await this.__toast.confirm({
        titleVi: isBlocked ? 'Hủy giữ chỗ?' : 'Hủy đặt chỗ?',
        titleEn: isBlocked ? 'Cancel hold?' : 'Cancel booking?',
        messageVi: isBlocked
          ? `Hủy giữ chỗ ${code}? Ghế sẽ được giải phóng, không phát sinh hoàn tiền.`
          : `Hủy đặt chỗ ${code}? Theo chính sách: hoàn dự kiến ${pct}% ≈ ${this.money(amount)} về phương thức thanh toán gốc.`,
        messageEn: isBlocked
          ? `Cancel hold ${code}? Seats will be released and no refund is due.`
          : `Cancel booking ${code}? Estimated refund: ${pct}% ≈ ${this.money(amount)} to the original payment method.`,
        confirmVi: 'Hủy đặt chỗ',
        confirmEn: 'Cancel booking',
      });
      if (!confirmed) return;
      const r = await firstValueFrom(this.api.cancel(code, 'Hủy tại quầy bởi nhân viên'));
      this.notice = this.language.pick(
        `Đã hủy. Mã hủy: ${r.cancellation_number}. Hoàn ${this.money(r.refund_amount)} (${r.refund_percentage ?? 0}%).`,
        `Cancelled. Cancellation number: ${r.cancellation_number}. Refund ${this.money(r.refund_amount)} (${r.refund_percentage ?? 0}%).`,
      );
      this.loadBookings();
    } catch (e) { this.error = this.msg(e, this.language.pick('Không hủy được booking.','Unable to cancel booking.')); }
    finally { this.busy = false; }
  }
  private refundPercent(booking: any, coupons: any[]) {
    if (booking?.status === 'BLOCKED') return 0;
    const deps = coupons.map(c => new Date(c.scheduled_departure).getTime()).filter(Number.isFinite);
    if (!deps.length) return 0;
    const days = Math.max(0, (Math.min(...deps) - Date.now()) / 86_400_000);
    const m = this.policies.filter(p => days >= Number(p.min_days_before ?? 0) && days <= (p.max_days_before == null ? Infinity : Number(p.max_days_before)));
    return Number(m.sort((a, b) => Number(b.min_days_before) - Number(a.min_days_before))[0]?.refund_percentage || 0);
  }

  // ---------- helpers ----------
  initials(c: any) { return `${c?.first_name?.[0] || ''}${c?.last_name?.[0] || c?.username?.[0] || ''}`.toUpperCase(); }
  label(v: string) { return this.language.cabinLabel(v); }
  paxLabel(v: string) { return this.language.passengerTypeLabel(v); }
  statusLabel(v: string) { return this.language.bookingStatusLabel(v); }
  typeLabel(v: string) { return this.language.bookingTypeLabel(v); }
  money(v: number) { return new Intl.NumberFormat(this.language.language()==='vi'?'vi-VN':'en-US', { style:'currency', currency:'VND', maximumFractionDigits:0 }).format(Number(v) || 0); }
  dt(v?: string) { return formatDateTimeDayFirst(v); }
  msg(e: any, f: string) { const m = e?.error?.message; const detail=Array.isArray(m)?m.join(' · '):m||e?.message||f; return this.language.translateNotice(detail); }
}
