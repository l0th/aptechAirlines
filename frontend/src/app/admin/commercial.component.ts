import { ToastService } from '../core/toast.service';
import { LanguageService } from '../core/language.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { PaginationComponent } from '../shared/pagination.component';
import { DayFirstDateInputComponent } from '../shared/day-first-date-input.component';
import { localCalendarDate } from '../core/date-format.util';

type Cabin = 'ECONOMY' | 'BUSINESS' | 'CLUB' | 'FIRST';

@Component({
  standalone: true,
  imports: [FormsModule, PaginationComponent, DayFirstDateInputComponent],
  template: `
    <div class="eyebrow">AIRLABS → APTECH AIRLINES</div>
    <div class="section-head hero-head">
      <div>
        <h1 class="title">{{t('Vận hành chuyến bay thương mại','Commercial flight operations')}}</h1>
        <p class="subtitle">{{t('Tìm lịch bay thật từ mạng AirLabs, chọn hành trình, cấu hình máy bay APTECH và phát hành chuyến có thể đặt trong tối đa 330 ngày.','Discover real flight schedules through AirLabs, choose an itinerary, configure APTECH aircraft and publish bookable flights up to 330 days ahead.')}}</p>
      </div>
      <button class="btn btn-outline" (click)="reloadAll()" [disabled]="loadingTemplates">{{t('Làm mới dữ liệu','Refresh data')}}</button>
    </div>

    <section class="steps card">
      <div [class.done]="networkSearched" [class.active]="!networkSearched"><b>1</b><span>{{t('Tìm mạng đường bay','Discover flight routes')}}<small>{{t('Mạng đường bay AirLabs','AirLabs route graph')}}</small></span></div>
      <div [class.done]="!!selectedItinerary" [class.active]="networkSearched&&!selectedItinerary"><b>2</b><span>{{t('Chọn hành trình','Select an itinerary')}}<small>{{t('Bay thẳng / nối chuyến','Direct / connecting')}}</small></span></div>
      <div [class.done]="allLegsCommercialized" [class.active]="!!selectedItinerary&&!allLegsCommercialized"><b>3</b><span>{{t('Tạo chuyến APTECH','Configure APTECH flights')}}<small>{{t('Máy bay · hạng ghế · tồn chỗ','Aircraft · cabins · inventory')}}</small></span></div>
      <div [class.done]="publishDone" [class.active]="allLegsCommercialized&&!publishDone"><b>4</b><span>{{t('Phát hành lịch','Publish schedule')}}<small>{{t('Sinh chuyến bay theo ngày','Materialize flights')}}</small></span></div>
    </section>

    
    

    <section class="card workspace">
      <div class="panel-head">
        <div><span class="step-no">1</span><div><h2>{{t('Tìm hành trình nguồn thực','Discover real source itineraries')}}</h2><p>{{t('Máy chủ sẽ dùng sơ đồ đường bay đã đồng bộ từ AirLabs và kiểm tra lịch hoạt động đúng ngày.','The server uses the synchronized AirLabs route graph and checks actual operating schedules for the selected date.')}}</p></div></div>
        <span class="pill pill-gold">{{t('Nguồn: AirLabs','Source: AirLabs')}}</span>
      </div>

      <div class="search-grid">
        <div class="field"><span>{{t('Nơi đi','Origin')}}</span><input class="control" [(ngModel)]="origin" placeholder="SGN"></div>
        <div class="field"><span>{{t('Nơi đến','Destination')}}</span><input class="control" [(ngModel)]="destination" placeholder="HAN"></div>
        <div class="field"><span>{{t('Ngày khởi hành','Departure date')}}</span><app-date-input [(ngModel)]="departureDate"/></div>
        <div class="field"><span>{{t('Số điểm nối tối đa','Maximum stops')}}</span><select class="control" [(ngModel)]="maxStops"><option [ngValue]="0">{{t('Bay thẳng','Direct')}}</option><option [ngValue]="1">{{t('Tối đa 1 điểm nối','Up to 1 stop')}}</option><option [ngValue]="2">{{t('Tối đa 2 điểm nối','Up to 2 stops')}}</option></select></div>
        <button class="btn btn-primary search-btn" (click)="discover()" [disabled]="discovering">{{discovering?t('Đang tìm…','Searching…'):t('Tìm mạng đường bay','Discover flight routes')}}</button>
      </div>

      @if(networkSearched){
        <div class="coverage" [class.warn]="discovery?.status==='NETWORK_DATA_INCOMPLETE'">
          <div><strong>{{networkStatus(discovery?.status)}}</strong><span>{{discovery?.origin_scope?.label||origin}} → {{discovery?.destination_scope?.label||destination}}</span></div>
          <div><b>{{itineraries.length}}</b><small>{{t('hành trình','itineraries')}}</small></div>
          <div><b>{{discovery?.coverage?.expanded_airports?.length||0}}</b><small>{{t('sân bay đã mở rộng','airports explored')}}</small></div>
          <div><b>{{discovery?.coverage?.incomplete_airports?.length||0}}</b><small>{{t('thiếu dữ liệu','missing data')}}</small></div>
        </div>
      }
    </section>

    @if(itineraries.length){
      <section class="workspace-block">
        <div class="block-title"><span class="step-no">2</span><div><h2>{{t('Chọn hành trình','Select an itinerary')}}</h2><p>{{t('Chọn hành trình mà APTECH AIRLINES sẽ thương mại hóa.','Choose the itinerary APTECH AIRLINES will commercialize.')}}</p></div></div>
        <div class="itineraries">
          @for(it of itineraries; track itineraryKey(it); let idx=$index){
            <button class="card itinerary" [class.selected]="selectedItinerary===it" (click)="selectItinerary(it)">
              <div class="it-head"><span class="pill" [class.pill-success]="it.route_type==='DIRECT'">{{routeType(it.route_type)}}</span><strong>{{it.airports?.join(' → ')}}</strong></div>
              <div class="it-meta"><span>{{it.legs?.length||0}} {{t('chặng','legs')}}</span><span>{{duration(it.total_duration_minutes)}}</span><span>@if(it.layover_minutes?.length){ {{t('Nối','Layover')}} {{it.layover_minutes.join(' / ')}} {{t('phút','min')}} }@else{ {{t('Không nối chuyến','No layover')}} }</span></div>
              <div class="legs-mini">
                @for(leg of it.legs;track leg.source_key){<span><b>{{sourceFlight(leg)}}</b>{{leg.dep_iata}} → {{leg.arr_iata}} · {{time(leg.dep_datetime||leg.dep_time_local)}} → {{time(leg.arr_datetime||leg.arr_time_local)}}</span>}
              </div>
              <span class="choose">{{selectedItinerary===it?t('Đã chọn','Selected'):t('Chọn hành trình ','Select itinerary ')+(idx+1)}}</span>
            </button>
          }
        </div>
      </section>
    }

    @if(selectedItinerary){
      <section class="card workspace selected-workspace">
        <div class="panel-head">
          <div><span class="step-no">3</span><div><h2>{{t('Tạo chuyến APTECH cho từng chặng','Configure an APTECH flight for every leg')}}</h2><p>{{t('Mỗi chặng nguồn thật phải được gắn máy bay, hạng ghế, tồn chỗ và giá trước khi phát hành.','Each source leg needs an aircraft, cabins, sellable inventory and pricing before publication.')}}</p></div></div>
          <span class="pill" [class.pill-success]="allLegsCommercialized">{{commercializedCount}} / {{selectedItinerary.legs.length}} {{t('hoàn tất','completed')}}</span>
        </div>

        <div class="journey-line">
          @for(leg of selectedItinerary.legs;track leg.source_key;let i=$index){
            <article class="leg-card" [class.ready]="templateFor(leg)">
              <div class="leg-top"><span>{{i+1}}</span><div><small>{{t('Nguồn AirLabs','AirLabs source')}}</small><b>{{sourceFlight(leg)}}</b></div><span class="pill" [class.pill-success]="templateFor(leg)">{{templateFor(leg)?t('APTECH SẴN SÀNG','APTECH READY'):t('CHƯA CẤU HÌNH','NOT CONFIGURED')}}</span></div>
              <h3>{{leg.dep_iata}} <i>→</i> {{leg.arr_iata}}</h3>
              <p>{{time(leg.dep_datetime||leg.dep_time_local)}} → {{time(leg.arr_datetime||leg.arr_time_local)}} · {{duration(leg.duration_minutes)}}</p>
              @if(templateFor(leg);as tpl){
                <div class="commercial-summary"><strong>{{tpl.flight_number}}</strong><span>{{tpl.aircraft_type}}</span><span>{{tpl.cabin_classes?.join(', ')}}</span><span>{{inventoryTotal(tpl)}} {{t('ghế bán','seats for sale')}}</span></div>
                <button class="btn btn-outline full" (click)="openEdit(tpl)">{{t('Sửa cấu hình','Edit configuration')}}</button>
              }@else{
                <button class="btn btn-primary full" (click)="openCommercialize(leg)">{{t('Cấu hình thành chuyến APTECH','Configure as APTECH flight')}}</button>
              }
            </article>
          }
        </div>
      </section>

      <section class="card publish">
        <div class="panel-head">
          <div><span class="step-no">4</span><div><h2>{{t('Phát hành lịch bay có thể đặt','Publish bookable flight schedules')}}</h2><p>{{t('Sinh các chuyến bay theo ngày từ mẫu đã thương mại hóa. Khách hàng chỉ thấy các chuyến AIRLABS_COMMERCIALIZED có thể đặt.','Generate dated flights from commercialized templates. Customers see only bookable AIRLABS_COMMERCIALIZED flights.')}}</p></div></div>
        </div>
        <div class="publish-controls">
          <div class="field"><span>{{t('Khoảng ngày','Schedule window')}}</span><select class="control" [(ngModel)]="publishDays"><option [ngValue]="30">30 {{t('ngày','days')}}</option><option [ngValue]="90">90 {{t('ngày','days')}}</option><option [ngValue]="180">180 {{t('ngày','days')}}</option><option [ngValue]="330">330 {{t('ngày','days')}}</option></select></div>
          <div class="field"><span>{{t('Ngày bắt đầu','Start date')}}</span><app-date-input [(ngModel)]="publishStart"/></div>
          <button class="btn btn-dark" (click)="publishJourney()" [disabled]="!allLegsCommercialized||publishing">{{publishing?t('Đang phát hành…','Publishing…'):t('Tạo lịch cho toàn hành trình','Generate full itinerary schedule')}}</button>
        </div>
        @if(!allLegsCommercialized){<p class="helper">{{t('Cần cấu hình đủ tất cả chặng trước khi phát hành.','All legs must be configured before publishing.')}}</p>}
        @if(publishProgress.length){
          <div class="progress-list">
            @for(p of publishProgress;track p.flight){<div><span [class.ok]="p.status==='SUCCESS'" [class.bad]="p.status==='ERROR'">{{progressStatus(p.status)}}</span><strong>{{p.flight}}</strong><small>{{t(p.detailVi,p.detailEn)}}</small></div>}
          </div>
        }
      </section>
    }

    <div class="section-head catalog-head">
      <div><div class="eyebrow">{{t('DANH MỤC THƯƠNG MẠI','COMMERCIAL CATALOG')}}</div><h2>{{t('Các mẫu đang quản lý','Managed templates')}}</h2></div>
      <div class="catalog-search"><input class="control" [(ngModel)]="query" (ngModelChange)="page=1" placeholder="APT, SGN, HAN, aircraft..."><span class="pill pill-gold">{{filtered.length}} / {{templates.length}}</span></div>
    </div>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>{{t('Chuyến bay','Flight')}}</th><th>{{t('Tuyến','Route')}}</th><th>{{t('Máy bay','Aircraft')}}</th><th>{{t('Hạng ghế / tồn chỗ','Cabins / inventory')}}</th><th>{{t('Giá cơ bản','Base fare')}}</th><th>{{t('Trạng thái','Status')}}</th><th>{{t('Thao tác','Actions')}}</th></tr></thead>
        <tbody>
          @for(tpl of pagedTemplates;track tpl._id||tpl.template_id){
            <tr>
              <td><strong>{{tpl.flight_number}}</strong><small class="subline">{{tpl.template_id}}</small></td>
              <td><b>{{tpl.origin_iata}}</b> → <b>{{tpl.dest_iata}}</b><small class="subline">{{tpl.source_flight_iata||tpl.source_flight_number||'AirLabs'}}</small></td>
              <td>{{tpl.aircraft_type}}</td>
              <td>{{inventoryLabel(tpl)}}</td>
              <td>{{money(tpl.base_price_economy)}}</td>
              <td><span class="pill" [class.pill-success]="tpl.is_active" [class.pill-danger]="!tpl.is_active">{{tpl.is_active?t('ĐANG BẬT','ACTIVE'):t('ĐÃ TẮT','INACTIVE')}}</span></td>
              <td><div class="actions"><button class="btn btn-outline compact" (click)="openEdit(tpl)">{{t('Sửa','Edit')}}</button><button class="btn btn-outline compact" (click)="toggle(tpl)" [disabled]="busyId===id(tpl)">{{tpl.is_active?t('Tắt','Deactivate'):t('Bật','Activate')}}</button><button class="btn btn-dark compact" (click)="materializeOne(tpl)" [disabled]="!tpl.is_active||busyId===id(tpl)">{{t('Sinh','Generate')}} {{publishDays}} {{t('ngày','days')}}</button></div></td>
            </tr>
          }
          @if(!filtered.length&&!loadingTemplates){<tr><td colspan="7"><div class="empty muted">{{t('Chưa có mẫu thương mại phù hợp.','No matching commercial templates.')}}</div></td></tr>}
        </tbody>
      </table>
    </div>
    <app-pagination [total]="filtered.length" [(page)]="page" [(pageSize)]="pageSize" />

    @if(commercializingLeg){
      <div class="modal" (click)="closeModal($event)">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="x" (click)="commercializingLeg=null">×</button>
          <div class="modal-head"><div><div class="eyebrow">AIRLABS SOURCE → APTECH</div><h2>{{commercializingLeg.dep_iata}} → {{commercializingLeg.arr_iata}}</h2><p>{{sourceFlight(commercializingLeg)}} · {{time(commercializingLeg.dep_datetime||commercializingLeg.dep_time_local)}} → {{time(commercializingLeg.arr_datetime||commercializingLeg.arr_time_local)}}</p></div></div>
          <div class="modal-body">
            <div class="grid grid-2">
              <div class="field"><span>{{t('Mã chuyến APTECH','APTECH flight number')}}</span><input class="control" [(ngModel)]="formFlightNumber" (ngModelChange)="formFlightNumber=formFlightNumber.toUpperCase()" placeholder="APT231"></div>
              <div class="field"><span>{{t('Bố trí máy bay','Aircraft layout')}}</span><select class="control" [(ngModel)]="formAircraft" (ngModelChange)="aircraftChanged()"><option value="">{{t('Chọn máy bay','Select aircraft')}}</option>@for(a of layouts;track a.aircraft_type){<option [value]="a.aircraft_type">{{a.aircraft_type}} · {{a.model_name}} · {{a.total_capacity}} {{t('ghế','seats')}}</option>}</select></div>
            </div>

            @if(selectedLayout;as layout){
              <div class="aircraft-info"><strong>{{layout.model_name}}</strong><span>{{t('Sức chứa vật lý:','Physical capacity:')}} {{layout.total_capacity}}</span><small>{{t('Chỉ hạng ghế có trong sơ đồ máy bay mới được bật.','Only cabins included in the aircraft layout can be enabled.')}}</small></div>
              <div class="cabins">
                @for(c of allCabins;track c){
                  <div class="cabin" [class.disabled]="!supports(c)" [class.on]="formCabins[c]">
                    <label><input type="checkbox" [checked]="formCabins[c]" [disabled]="!supports(c)" (change)="toggleCabin(c)"> <b>{{c}}</b></label>
                    <span>{{t('Tối đa','Up to')}} {{capacity(c)}} {{t('ghế','seats')}}</span>
                    @if(formCabins[c]){
                      <div class="grid grid-2 cabin-fields"><div class="field"><span>{{t('Ghế bán','Sellable seats')}}</span><input class="control" type="number" min="1" [max]="capacity(c)" [(ngModel)]="formSeats[c]"></div><div class="field"><span>{{t('Giá cơ bản (₫)','Base fare (₫)')}}</span><input class="control" type="number" min="0" [(ngModel)]="formPrices[c]" [placeholder]="c==='ECONOMY'?t('Bắt buộc','Required'):t('Để trống = dùng giá mặc định','Leave blank = fallback')"></div></div>
                    }
                  </div>
                }
              </div>
            }
            
            <div class="modal-actions"><button class="btn btn-outline" (click)="commercializingLeg=null">{{t('Hủy','Cancel')}}</button><button class="btn btn-primary" (click)="submitCommercialize()" [disabled]="submittingForm">{{submittingForm?t('Đang tạo…','Creating…'):t('Tạo mẫu thương mại','Create commercial template')}}</button></div>
          </div>
        </section>
      </div>
    }

    @if(editingTemplate){
      <div class="modal" (click)="closeModal($event)">
        <section class="card modal-card" (click)="$event.stopPropagation()">
          <button class="x" (click)="editingTemplate=null">×</button>
          <div class="modal-head"><div><div class="eyebrow">{{t('SỬA MẪU THƯƠNG MẠI','EDIT COMMERCIAL TEMPLATE')}}</div><h2>{{editingTemplate.flight_number}}</h2><p>{{editingTemplate.origin_iata}} → {{editingTemplate.dest_iata}} · {{t('nguồn','source')}} {{editingTemplate.source_flight_iata||editingTemplate.source_flight_number||'AirLabs'}}</p></div></div>
          <div class="modal-body">
            <div class="grid grid-2"><div class="field"><span>{{t('Mã chuyến APTECH','APTECH flight number')}}</span><input class="control" [(ngModel)]="editFlightNumber" (ngModelChange)="editFlightNumber=editFlightNumber.toUpperCase()"></div><div class="field"><span>{{t('Bố trí máy bay','Aircraft layout')}}</span><select class="control" [(ngModel)]="editAircraft" (ngModelChange)="editAircraftChanged()">@for(a of layouts;track a.aircraft_type){<option [value]="a.aircraft_type">{{a.aircraft_type}} · {{a.model_name}}</option>}</select></div></div>
            @if(editLayout;as layout){
              <div class="cabins">
                @for(c of allCabins;track c){
                  <div class="cabin" [class.disabled]="!editSupports(c)" [class.on]="editCabins[c]"><label><input type="checkbox" [checked]="editCabins[c]" [disabled]="!editSupports(c)" (change)="toggleEditCabin(c)"> <b>{{c}}</b></label><span>{{t('Tối đa','Up to')}} {{editCapacity(c)}} {{t('ghế','seats')}}</span>@if(editCabins[c]){<div class="grid grid-2 cabin-fields"><div class="field"><span>{{t('Ghế bán','Sellable seats')}}</span><input class="control" type="number" min="1" [max]="editCapacity(c)" [(ngModel)]="editSeats[c]"></div><div class="field"><span>{{t('Giá cơ bản (₫)','Base fare (₫)')}}</span><input class="control" type="number" min="0" [(ngModel)]="editPrices[c]" [placeholder]="c==='ECONOMY'?t('Bắt buộc','Required'):t('Để trống = dùng giá mặc định','Leave blank = fallback')"></div></div>}</div>
                }
              </div>
            }
            <label class="active-toggle"><input type="checkbox" [(ngModel)]="editActive"> {{t('Mẫu đang hoạt động','Template active')}}</label>
            
            <div class="modal-actions"><button class="btn btn-outline" (click)="editingTemplate=null">{{t('Hủy','Cancel')}}</button><button class="btn btn-primary" (click)="saveEdit()" [disabled]="submittingForm">{{submittingForm?t('Đang lưu…','Saving…'):t('Lưu cấu hình','Save configuration')}}</button></div>
          </div>
        </section>
      </div>
    }
  `,
  styles: [`
    .hero-head{margin-top:8px}.hero-head .subtitle{max-width:850px}.steps{display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;margin:22px 0}.steps>div{display:flex;align-items:center;gap:10px;padding:15px 16px;border-right:1px solid #edf1f4;color:#7b8998}.steps>div:last-child{border:0}.steps b,.step-no{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#e9eef2;color:#607284;font-size:12px;flex:0 0 auto}.steps span{display:grid;font-size:12px;font-weight:900}.steps small{font-size:9px;font-weight:600;color:#8c99a7;margin-top:2px}.steps .active b{background:#0a2540;color:#f2c85f}.steps .active span{color:#0a2540}.steps .done b{background:#e5f5ed;color:#08734f}.steps .done span{color:#17664b}.notice{padding:12px 15px;border-radius:14px;margin:10px 0}.error-box{background:#fff0f0;border:1px solid #efcaca}.success-box{background:#eaf8f1;border:1px solid #c8ead9;color:#15704f}.workspace{padding:22px;margin:18px 0}.panel-head,.panel-head>div:first-child,.block-title{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.panel-head>div:first-child,.block-title{justify-content:flex-start}.panel-head h2,.block-title h2{margin:1px 0 4px;color:#0a2540;font-size:18px}.panel-head p,.block-title p{margin:0;color:#718093;font-size:12px;line-height:1.5}.step-no{background:#0a2540;color:#f2c85f;font-weight:900}.search-grid{display:grid;grid-template-columns:1fr 1fr 190px 190px auto;gap:12px;align-items:end;margin-top:18px}.search-btn{height:46px}.coverage{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:10px;margin-top:17px;background:#f4f8fb;border-radius:16px;padding:13px 15px}.coverage.warn{background:#fff8e6}.coverage>div{display:grid;gap:3px}.coverage span,.coverage small{font-size:10px;color:#708093}.coverage strong{color:#0a2540}.coverage b{font-size:19px;color:#0a2540}.workspace-block{margin:28px 0}.block-title{margin-bottom:14px}.itineraries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.itinerary{text-align:left;padding:18px;color:#435569;transition:.18s}.itinerary:hover,.itinerary.selected{border-color:#d6b35a;box-shadow:0 0 0 3px rgba(214,179,90,.12)}.it-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.it-head strong{color:#0a2540}.it-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#718093;margin:10px 0}.legs-mini{display:grid;gap:6px;border-top:1px dashed #dfe6ec;padding-top:10px}.legs-mini span{font-size:11px}.legs-mini b{margin-right:7px;color:#0a2540}.choose{display:block;text-align:right;color:#a07113;font-size:11px;font-weight:900;margin-top:12px}.selected-workspace{margin-top:24px}.journey-line{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:13px;margin-top:18px}.leg-card{border:1px solid #dfe7ed;border-radius:18px;padding:16px;background:#fbfcfd}.leg-card.ready{border-color:#a8d7c3;background:#f7fcf9}.leg-top{display:flex;align-items:center;gap:9px}.leg-top>span:first-child{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#0a2540;color:#fff;font-weight:900;font-size:11px}.leg-top>div{display:grid;gap:2px;flex:1}.leg-top small{font-size:9px;color:#81909e}.leg-top b{font-size:12px;color:#0a2540}.leg-card h3{font-size:22px;margin:16px 0 5px;color:#0a2540}.leg-card h3 i{font-style:normal;color:#d2a538}.leg-card p{font-size:11px;color:#748494;margin:0 0 13px}.commercial-summary{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.commercial-summary span,.commercial-summary strong{background:#fff;border:1px solid #dfe7ed;border-radius:999px;padding:5px 8px;font-size:10px}.commercial-summary strong{color:#0a2540}.full{width:100%}.publish{padding:22px;margin:18px 0 34px}.publish-controls{display:grid;grid-template-columns:170px 200px 1fr;gap:12px;align-items:end;margin-top:16px}.helper{font-size:11px;color:#8a6517;background:#fff8e5;padding:10px 12px;border-radius:12px}.progress-list{display:grid;gap:7px;margin-top:13px}.progress-list>div{display:grid;grid-template-columns:80px 110px 1fr;gap:10px;padding:9px 11px;background:#f7f9fb;border-radius:11px;font-size:11px}.progress-list span{font-weight:900}.progress-list span.ok{color:#08734f}.progress-list span.bad{color:#a32e2e}.catalog-head{align-items:center}.catalog-search{display:flex;align-items:center;gap:9px}.catalog-search .control{min-width:280px}.subline{display:block;color:#8593a0;font-size:9px;margin-top:4px;max-width:190px;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:6px;white-space:nowrap}.compact{padding:8px 10px;font-size:10px}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;z-index:100;padding:20px}.modal-card{width:min(850px,100%);max-height:90vh;overflow:auto;position:relative}.modal-head{padding:24px 58px 20px 24px;background:linear-gradient(120deg,#071b2e,#123957);color:#fff}.modal-head h2{margin:7px 0 4px;font-size:27px}.modal-head p{margin:0;color:#bfd0db}.modal-head .eyebrow{color:#f2c85f}.modal-body{padding:22px}.x{position:absolute;right:15px;top:14px;z-index:2;border:0;background:rgba(255,255,255,.15);color:#fff;width:34px;height:34px;border-radius:50%;font-size:24px}.aircraft-info{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#f3f7fa;border-radius:14px;padding:12px 14px;margin:16px 0}.aircraft-info strong{color:#0a2540}.aircraft-info span,.aircraft-info small{font-size:11px;color:#66788a}.cabins{display:grid;gap:10px;margin-top:16px}.cabin{border:1px solid #dfe7ed;border-radius:15px;padding:13px;opacity:.55}.cabin.on{border-color:#d5b35d;background:#fffaf0;opacity:1}.cabin.disabled{background:#f3f5f7}.cabin>label{font-size:12px;color:#0a2540}.cabin>span{float:right;font-size:10px;color:#748495}.cabin-fields{margin-top:11px;padding-top:10px;border-top:1px solid #e8edf1}.modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.active-toggle{display:flex;align-items:center;gap:9px;margin-top:16px;padding:12px;border-radius:12px;background:#f4f7f9;font-weight:800;color:#30485c}.btn:disabled{opacity:.45;cursor:not-allowed}@media(max-width:1050px){.search-grid{grid-template-columns:1fr 1fr}.search-btn{grid-column:1/-1}.coverage{grid-template-columns:repeat(2,1fr)}.coverage>div:first-child{grid-column:1/-1}}@media(max-width:760px){.steps{grid-template-columns:1fr 1fr}.steps>div:nth-child(2){border-right:0}.steps>div:nth-child(-n+2){border-bottom:1px solid #edf1f4}.itineraries{grid-template-columns:1fr}.publish-controls{grid-template-columns:1fr}.catalog-head{align-items:flex-start}.catalog-search{width:100%}.catalog-search .control{min-width:0;flex:1}.panel-head{flex-direction:column}.progress-list>div{grid-template-columns:1fr}.modal-body .grid-2{grid-template-columns:1fr}}@media(max-width:520px){.search-grid,.coverage{grid-template-columns:1fr}.coverage>div:first-child{grid-column:auto}.steps{grid-template-columns:1fr}.steps>div{border-right:0;border-bottom:1px solid #edf1f4}.catalog-search{flex-direction:column;align-items:stretch}.actions{flex-direction:column}}
  `]
})
export class CommercialComponent {
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api = inject(ApiService);
  language = inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  private errorPair(vi:string,en:string){this.__error=this.t(vi,en);this.__toast.error({titleVi:'Không thể thực hiện',titleEn:'Action failed',messageVi:vi,messageEn:en})}
  private infoPair(vi:string,en:string){this.__message=this.t(vi,en);this.__toast.info({titleVi:'Thông báo',titleEn:'Notice',messageVi:vi,messageEn:en})}
  private errorFrom(e:any,vi:string,en:string){const m=e?.error?.message;const detail=Array.isArray(m)?m.join(' · '):m||e?.message;if(detail)this.error=detail;else this.errorPair(vi,en)}
  private formErrorPair(vi:string,en:string){this.__formError=this.t(vi,en);this.__toast.error({titleVi:'Thông tin không hợp lệ',titleEn:'Invalid information',messageVi:vi,messageEn:en})}
  private formErrorFrom(e:any,vi:string,en:string){const detail=this.msg(e,'');this.formErrorPair(detail?`${vi} (${detail})`:vi,detail?`${en} (${detail})`:en)}
  readonly allCabins: Cabin[] = ['ECONOMY','BUSINESS','CLUB','FIRST'];

  templates: any[] = [];
  layouts: any[] = [];
  discovery: any = null;
  selectedItinerary: any = null;
  networkSearched = false;
  discovering = false;
  loadingTemplates = false;
  publishing = false;
  publishDone = false;
  publishProgress: Array<{flight:string;status:string;detailVi:string;detailEn:string}> = [];
  query = '';
  page = 1;
  pageSize = 20;
  origin = 'SGN';
  destination = 'HAN';
  departureDate = localCalendarDate();
  maxStops = 2;
  publishDays = 330;
  publishStart = '';
  busyId = '';
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
  private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};

  commercializingLeg: any = null;
  editingTemplate: any = null;
  submittingForm = false;
  private __formError='';get formError(){return this.__formError}set formError(v:string){this.__formError=v;this.__toast.notifyError(v)};
  formFlightNumber = '';
  formAircraft = '';
  formCabins: Record<Cabin,boolean> = this.boolRecord();
  formSeats: Record<Cabin,number|null> = this.numberRecord();
  formPrices: Record<Cabin,number|null> = this.numberRecord();

  editFlightNumber = '';
  editAircraft = '';
  editActive = true;
  editCabins: Record<Cabin,boolean> = this.boolRecord();
  editSeats: Record<Cabin,number|null> = this.numberRecord();
  editPrices: Record<Cabin,number|null> = this.numberRecord();

  constructor(){ this.reloadAll(); }

  get itineraries(){ return Array.isArray(this.discovery?.itineraries) ? this.discovery.itineraries : []; }
  get filtered(){
    const q=this.query.trim().toLowerCase();
    if(!q)return this.templates;
    return this.templates.filter(t=>[t.template_id,t.flight_number,t.origin_iata,t.dest_iata,t.aircraft_type,t.source_flight_iata,t.source_flight_number].some(v=>String(v||'').toLowerCase().includes(q)));
  }
  get pagedTemplates(){ const start=(this.page-1)*this.pageSize;return this.filtered.slice(start,start+this.pageSize); }
  get allLegsCommercialized(){ return !!this.selectedItinerary?.legs?.length && this.selectedItinerary.legs.every((l:any)=>!!this.templateFor(l)); }
  get commercializedCount(){ return (this.selectedItinerary?.legs||[]).filter((l:any)=>!!this.templateFor(l)).length; }
  get selectedLayout(){ return this.layouts.find(a=>a.aircraft_type===this.formAircraft)||null; }
  get editLayout(){ return this.layouts.find(a=>a.aircraft_type===this.editAircraft)||null; }

  reloadAll(){ this.loadTemplates(); this.api.commercialAircraftLayouts().subscribe({next:r=>this.layouts=Array.isArray(r)?r:[],error:e=>this.errorFrom(e,'Không tải được sơ đồ ghế máy bay.','Unable to load aircraft layouts.')}); }
  loadTemplates(){
    this.loadingTemplates=true;
    this.api.commercialTemplates({limit:200}).subscribe({next:(r:any)=>{this.templates=Array.isArray(r)?r:(r.items||[]);this.page=1;this.loadingTemplates=false},error:e=>{this.loadingTemplates=false;this.errorFrom(e,'Không tải được các mẫu chuyến bay thương mại.','Unable to load commercial flight templates.')}});
  }

  discover(){
    this.error='';this.message='';this.publishDone=false;
    const origin=this.origin.trim().toUpperCase(), destination=this.destination.trim().toUpperCase();
    if(!origin||!destination||!this.departureDate){this.errorPair('Nhập nơi đi, nơi đến và ngày khởi hành.','Enter an origin, destination and departure date.');return}
    if(origin===destination){this.errorPair('Nơi đi và nơi đến phải khác nhau.','Origin and destination must be different.');return}
    this.discovering=true;this.networkSearched=false;this.discovery=null;this.selectedItinerary=null;
    this.api.discoverCommercialNetwork({origin,destination,departure_date:this.departureDate,max_stops:Number(this.maxStops)}).subscribe({
      next:r=>{this.discovery=r;this.networkSearched=true;this.discovering=false;if(!this.itineraries.length)this.infoPair('Không tìm thấy hành trình hợp lệ cho ngày đã chọn. Nếu mạng đường bay thiếu dữ liệu, hãy đồng bộ tuyến AirLabs trước.','No eligible itinerary found for the selected date. If route coverage is incomplete, synchronize AirLabs routes first.')},
      error:e=>{this.discovering=false;this.networkSearched=true;this.errorFrom(e,'Không tìm được mạng đường bay thương mại.','Unable to discover the commercial flight network.')}
    });
  }
  selectItinerary(it:any){ this.selectedItinerary=it;this.publishDone=false;this.publishProgress=[]; }
  itineraryKey(it:any){ return (it?.legs||[]).map((l:any)=>l.source_key).join('>')||String(it?.airports||''); }
  templateFor(leg:any){ return this.templates.find(t=>t.source_route_key===leg.source_key)||null; }

  openCommercialize(leg:any){
    this.commercializingLeg=leg;this.editingTemplate=null;this.formError='';
    const raw=String(leg.flight_number||leg.flight_iata||leg.flight_icao||'100').toUpperCase().replace(/[^A-Z0-9]/g,'');
    this.formFlightNumber=('APT'+raw.replace(/^APT/,'')).slice(0,18);
    const preferred=this.layouts.find(a=>a.aircraft_type===leg.aircraft_icao)||this.layouts[0];
    this.formAircraft=preferred?.aircraft_type||'';
    this.formCabins=this.boolRecord();this.formSeats=this.numberRecord();this.formPrices=this.numberRecord();
    this.aircraftChanged();
  }
  aircraftChanged(){
    const layout=this.selectedLayout;this.formCabins=this.boolRecord();this.formSeats=this.numberRecord();this.formPrices=this.numberRecord();
    if(!layout)return;
    const econ=layout.supported_cabins?.includes('ECONOMY')?'ECONOMY':layout.supported_cabins?.[0];
    if(econ){this.formCabins[econ as Cabin]=true;this.formSeats[econ as Cabin]=Number(layout.cabin_capacities?.[econ]||1)}
  }
  supports(c:Cabin){return !!this.selectedLayout?.supported_cabins?.includes(c)}
  capacity(c:Cabin){return Number(this.selectedLayout?.cabin_capacities?.[c]||0)}
  toggleCabin(c:Cabin){if(!this.supports(c))return;this.formCabins[c]=!this.formCabins[c];if(this.formCabins[c]&&!this.formSeats[c])this.formSeats[c]=this.capacity(c)}

  async submitCommercialize(){
    if(!this.commercializingLeg)return;
    const payload=this.buildCommercializePayload();
    if(!payload)return;
    this.submittingForm=true;this.formError='';
    try{
      const created=await firstValueFrom(this.api.commercializeAirlabsRoute(payload));
      const flight=created?.flight_number||payload.aptech_flight_number;
      const source=this.sourceFlight(this.commercializingLeg);
      this.successPair(`Đã tạo ${flight} từ nguồn AirLabs ${source}.`,`Created ${flight} from AirLabs source ${source}.`);
      this.commercializingLeg=null;await this.refreshTemplates();
    }catch(e:any){this.formErrorFrom(e,'Không tạo được mẫu chuyến bay thương mại.','Unable to create commercial flight template.')}finally{this.submittingForm=false}
  }
  buildCommercializePayload(){
    const flight=this.formFlightNumber.trim().toUpperCase();
    if(!/^APT[A-Z0-9]+$/.test(flight)){this.formErrorPair('Mã chuyến phải bắt đầu bằng APT và chỉ gồm chữ/số, ví dụ APT231.','Flight number must start with APT and contain only letters/numbers, e.g. APT231.');return null}
    if(!this.selectedLayout){this.formErrorPair('Chọn sơ đồ ghế máy bay.','Select an aircraft layout.');return null}
    const cabins=this.allCabins.filter(c=>this.formCabins[c]);
    if(!cabins.length){this.formErrorPair('Chọn ít nhất một hạng khoang.','Select at least one cabin class.');return null}
    const inventories:any[]=[];
    for(const c of cabins){const seats=Number(this.formSeats[c]);if(!Number.isInteger(seats)||seats<1||seats>this.capacity(c)){this.formErrorPair(`${c}: số ghế phải từ 1 đến ${this.capacity(c)}.`,`${c}: seat count must be between 1 and ${this.capacity(c)}.`);return null}inventories.push({cabin_class:c,allocated_seats:seats})}
    const econ=Number(this.formPrices.ECONOMY);
    if(!this.formCabins.ECONOMY||!Number.isFinite(econ)||econ<0){this.formErrorPair('Phải bật hạng ECONOMY và nhập giá cơ bản hợp lệ.','ECONOMY must be enabled with a valid base fare.');return null}
    const payload:any={source_key:this.commercializingLeg.source_key,aptech_flight_number:flight,aircraft_type:this.formAircraft,base_price_economy:econ,cabin_classes:cabins,inventories};
    for(const c of ['BUSINESS','CLUB','FIRST'] as Cabin[]){if(this.formCabins[c]&&this.formPrices[c]!==null&&this.formPrices[c]!==undefined&&this.formPrices[c]!==('' as any))payload[`base_price_${c.toLowerCase()}`]=Number(this.formPrices[c])}
    return payload;
  }

  openEdit(t:any){
    this.editingTemplate=t;this.commercializingLeg=null;this.formError='';this.editFlightNumber=t.flight_number||'';this.editAircraft=t.aircraft_type||'';this.editActive=!!t.is_active;
    this.editCabins=this.boolRecord();this.editSeats=this.numberRecord();this.editPrices=this.numberRecord();
    for(const c of (t.cabin_classes||[])){if(this.allCabins.includes(c)){this.editCabins[c as Cabin]=true}}
    for(const inv of (t.commercial_inventories||[])){if(this.allCabins.includes(inv.cabin_class))this.editSeats[inv.cabin_class as Cabin]=Number(inv.allocated_seats)}
    this.editPrices.ECONOMY=this.numOrNull(t.base_price_economy);this.editPrices.BUSINESS=this.numOrNull(t.base_price_business);this.editPrices.CLUB=this.numOrNull(t.base_price_club);this.editPrices.FIRST=this.numOrNull(t.base_price_first);
  }
  editAircraftChanged(){
    const layout=this.editLayout;if(!layout)return;
    for(const c of this.allCabins){if(!this.editSupports(c)){this.editCabins[c]=false;this.editSeats[c]=null}else if(this.editCabins[c]&&(!this.editSeats[c]||Number(this.editSeats[c])>this.editCapacity(c)))this.editSeats[c]=this.editCapacity(c)}
    if(layout.supported_cabins?.includes('ECONOMY')&&!this.editCabins.ECONOMY){this.editCabins.ECONOMY=true;this.editSeats.ECONOMY=this.editCapacity('ECONOMY')}
  }
  editSupports(c:Cabin){return !!this.editLayout?.supported_cabins?.includes(c)}
  editCapacity(c:Cabin){return Number(this.editLayout?.cabin_capacities?.[c]||0)}
  toggleEditCabin(c:Cabin){if(!this.editSupports(c))return;this.editCabins[c]=!this.editCabins[c];if(this.editCabins[c]&&!this.editSeats[c])this.editSeats[c]=this.editCapacity(c)}

  async saveEdit(){
    if(!this.editingTemplate)return;
    const flight=this.editFlightNumber.trim().toUpperCase();if(!/^APT[A-Z0-9]+$/.test(flight)){this.formErrorPair('Mã chuyến phải đúng định dạng APT...','Flight number must follow the APT... format.');return}
    if(!this.editLayout){this.formErrorPair('Chọn sơ đồ ghế máy bay.','Select an aircraft layout.');return}
    const cabins=this.allCabins.filter(c=>this.editCabins[c]);if(!cabins.includes('ECONOMY')){this.formErrorPair('Mẫu chuyến bay thương mại phải có hạng ECONOMY.','Commercial flight template must include ECONOMY.');return}
    const inventories:any[]=[];for(const c of cabins){const seats=Number(this.editSeats[c]);if(!Number.isInteger(seats)||seats<1||seats>this.editCapacity(c)){this.formErrorPair(`${c}: số ghế phải từ 1 đến ${this.editCapacity(c)}.`,`${c}: seat count must be between 1 and ${this.editCapacity(c)}.`);return}inventories.push({cabin_class:c,allocated_seats:seats})}
    const econ=Number(this.editPrices.ECONOMY);if(!Number.isFinite(econ)||econ<0){this.formErrorPair('Giá cơ bản ECONOMY không hợp lệ.','Invalid ECONOMY base fare.');return}
    const body:any={flight_number:flight,aircraft_type:this.editAircraft,cabin_classes:cabins,inventories,base_price_economy:econ,is_active:this.editActive};
    for(const c of ['BUSINESS','CLUB','FIRST'] as Cabin[]){body[`base_price_${c.toLowerCase()}`]=this.editCabins[c]?(this.editPrices[c]===null||this.editPrices[c]===undefined||this.editPrices[c]===('' as any)?null:Number(this.editPrices[c])):null}
    this.submittingForm=true;this.formError='';
    try{await firstValueFrom(this.api.updateCommercialTemplate(this.id(this.editingTemplate),body));this.successPair(`Đã cập nhật ${flight}.`,`Updated ${flight}.`);this.editingTemplate=null;await this.refreshTemplates()}catch(e:any){this.formErrorFrom(e,'Không cập nhật được mẫu chuyến bay.','Unable to update flight template.')}finally{this.submittingForm=false}
  }

  async publishJourney(){
    if(!this.allLegsCommercialized||!this.selectedItinerary)return;
    this.publishing=true;this.publishDone=false;this.error='';this.message='';this.publishProgress=[];
    let errors=0;
    for(const leg of this.selectedItinerary.legs){
      const tpl=this.templateFor(leg);if(!tpl)continue;
      const item={flight:tpl.flight_number,status:'RUNNING',detailVi:'Đang sinh lịch bay…',detailEn:'Generating dated flights…'};this.publishProgress=[...this.publishProgress,item];
      try{const res:any=await firstValueFrom(this.api.materializeCommercialTemplate(this.id(tpl),Number(this.publishDays),this.publishStart||undefined));item.status='SUCCESS';item.detailVi=`Đã thêm ${res?.inserted_count??0}, đã có ${res?.matched_count??res?.skipped_existing??0}`;item.detailEn=`Inserted ${res?.inserted_count??0}, existing ${res?.matched_count??res?.skipped_existing??0}`}
      catch(e:any){errors++;item.status='ERROR';const detail=this.msg(e,'Không thể sinh lịch bay.');item.detailVi=detail;item.detailEn=detail}
      this.publishProgress=[...this.publishProgress];
    }
    this.publishing=false;this.publishDone=errors===0;
    if(errors)this.errorPair(`Đã xử lý nhưng có ${errors} chặng bị lỗi.`,`Processed the itinerary, but ${errors} legs failed.`);
    else this.successPair(`Đã phát hành toàn bộ hành trình trong khoảng ${this.publishDays} ngày.`,`Published the complete itinerary for the ${this.publishDays}-day window.`);
  }
  async materializeOne(t:any){
    const id=this.id(t);this.busyId=id;this.error='';this.message='';
    try{const r:any=await firstValueFrom(this.api.materializeCommercialTemplate(id,Number(this.publishDays),this.publishStart||undefined));this.successPair(`${t.flight_number}: đã thêm ${r?.inserted_count??0}, đã có ${r?.matched_count??r?.skipped_existing??0}.`,`${t.flight_number}: inserted ${r?.inserted_count??0}, existing ${r?.matched_count??r?.skipped_existing??0}.`)}catch(e:any){this.errorFrom(e,'Không sinh được lịch bay từ mẫu.','Unable to generate flights from template.')}finally{this.busyId=''}
  }
  async toggle(t:any){
    const id=this.id(t);this.busyId=id;this.error='';this.message='';
    try{await firstValueFrom(this.api.setCommercialTemplateStatus(id,!t.is_active));this.successPair(`Đã ${t.is_active?'tắt':'bật'} ${t.flight_number}.`,`${t.is_active?'Deactivated':'Activated'} ${t.flight_number}.`);await this.refreshTemplates()}catch(e:any){this.errorFrom(e,'Không đổi được trạng thái mẫu chuyến bay.','Unable to change flight template status.')}finally{this.busyId=''}
  }
  async refreshTemplates(){const r:any=await firstValueFrom(this.api.commercialTemplates({limit:200}));this.templates=Array.isArray(r)?r:(r.items||[])}

  sourceFlight(leg:any){return leg?.flight_iata||leg?.flight_icao||(leg?.airline_iata&&leg?.flight_number?`${leg.airline_iata}${leg.flight_number}`:leg?.flight_number)||'Nguồn AirLabs'}
  private successPair(vi:string,en:string){this.__message=this.t(vi,en);this.__toast.success({titleVi:'Thành công',titleEn:'Success',messageVi:vi,messageEn:en})}
  progressStatus(v:string){return v==='RUNNING'?this.t('Đang chạy','Running'):v==='SUCCESS'?this.t('Hoàn tất','Completed'):v==='ERROR'?this.t('Lỗi','Failed'):v}
  routeType(v:string){return v==='DIRECT'?this.t('Bay thẳng','Direct'):v==='ONE_STOP'?this.t('1 điểm nối','1 stop'):v==='TWO_STOP'?this.t('2 điểm nối','2 stops'):v||this.t('Hành trình','Itinerary')}
  networkStatus(v:string){return v==='FOUND'?this.t('Đã tìm thấy hành trình','Itineraries found'):v==='NETWORK_DATA_INCOMPLETE'?this.t('Mạng đường bay thiếu dữ liệu','Incomplete route network'):v==='NO_ROUTE_FOUND'||!v?this.t('Không tìm thấy tuyến bay','No route found'):v}
  duration(v:any){const n=Number(v||0);if(!n)return'—';return`${Math.floor(n/60)}h ${n%60}m`}
  time(v:any){if(!v)return'—';const s=String(v);if(/^\d{2}:\d{2}/.test(s))return s.slice(0,5);const d=new Date(s);return Number.isNaN(d.getTime())?s.slice(0,5):d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}
  id(t:any){return String(t?._id||t?.template_id||t?.id||'')}
  inventoryTotal(t:any){return (t?.commercial_inventories||[]).reduce((sum:number,x:any)=>sum+Number(x.allocated_seats||0),0)}
  inventoryLabel(t:any){return (t?.commercial_inventories||[]).map((x:any)=>`${x.cabin_class} ${x.allocated_seats}`).join(' · ')||t?.cabin_classes?.join(', ')||'—'}
  money(v:any){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v||0))}
  closeModal(e:any){if(e?.target===e?.currentTarget){this.commercializingLeg=null;this.editingTemplate=null}}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||e?.message||f}
  boolRecord():Record<Cabin,boolean>{return{ECONOMY:false,BUSINESS:false,CLUB:false,FIRST:false}}
  numberRecord():Record<Cabin,number|null>{return{ECONOMY:null,BUSINESS:null,CLUB:null,FIRST:null}}
  numOrNull(v:any){return v===null||v===undefined||v===''?null:Number(v)}
}
