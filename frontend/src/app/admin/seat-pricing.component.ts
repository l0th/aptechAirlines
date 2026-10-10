import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { LanguageService } from '../core/language.service';
import { PaginationComponent } from '../shared/pagination.component';
import { FLEET_LAYOUTS, PreviewSeat, layoutColumns, previewSeats, seatDimensions } from './pricing/fleet-layouts';
import { formatCalendarDate } from '../core/date-format.util';

type SeatRule={cabin_class:string;pricing_dimension:string;amount:number;priority:number};

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
    <div class="eyebrow">{{t('DOANH THU GHẾ','SEAT REVENUE')}}</div>
    <div class="section-head">
      <div><h1 class="title">{{t('Hồ sơ giá ghế','Seat pricing profiles')}}</h1><p class="subtitle">{{t('Cấu hình phụ phí theo loại máy bay. Template và chuyến bay cụ thể có thể dùng profile riêng; chuyến chưa gán profile vẫn dùng rule global cũ.','Configure seat fees by aircraft type. Flight templates and individual flights may use dedicated profiles; unassigned flights retain the global fallback rules.')}}</p></div>
      <div class="head-actions"><button class="btn btn-primary" (click)="openNewProfile()">{{t('+ Tạo profile','+ Create profile')}}</button><button class="btn btn-outline" (click)="reload()">{{t('Làm mới','Refresh')}}</button></div>
    </div>
    <div class="workflow card"><div><b>1</b><span><strong>{{t('Chọn loại máy bay','Select aircraft type')}}</strong><small>{{t('Mỗi profile nên gắn với một layout ghế rõ ràng.','Each profile should reference a specific seat layout.')}}</small></span></div><div><b>2</b><span><strong>{{t('Đặt phụ phí dễ hiểu','Configure seat fees')}}</strong><small>{{t('Cửa sổ, lối đi, hàng thoát hiểm, chỗ rộng chân…','Window, aisle, exit row, extra legroom…')}}</small></span></div><div><b>3</b><span><strong>{{t('Tick nơi áp dụng','Choose where to apply')}}</strong><small>{{t('Chọn chuyến hoặc lịch bay mẫu bằng checkbox.','Select flights or flight templates using checkboxes.')}}</small></span></div></div>

    
    

    <section class="card toolbar">
      <input class="control" [(ngModel)]="query" (ngModelChange)="profilePage=1" [placeholder]="t('Tìm mã profile, tên, aircraft...','Search profile code, name, aircraft...')">
      <span class="pill pill-gold">{{filteredProfiles.length}} profile</span>
    </section>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>{{t('Hồ sơ giá ghế','Seat pricing profile')}}</th><th>{{t('Máy bay','Aircraft')}}</th><th>{{t('Số quy tắc','Rules')}}</th><th>{{t('Đang dùng','Assigned')}}</th><th>{{t('Trạng thái','Status')}}</th><th>{{t('Thao tác','Actions')}}</th></tr></thead>
        <tbody>
          @for(p of pagedProfiles;track p._id){
            <tr>
              <td><strong>{{p.name}}</strong><small>{{p.description||''}}</small><small class="code">{{t('mã:','code:')}} {{p.code}}</small></td>
              <td>{{aircraftName(p.aircraft_type)}}<small class="code">{{p.aircraft_type||'ALL'}}</small></td>
              <td>{{p.rules?.length||0}} {{t('quy tắc','rules')}}<small>{{t('phiên bản','version')}} {{p.version||1}}</small></td>
              <td>{{p.assigned_flights||0}} {{t('chuyến','flights')}}<small>{{p.assigned_templates||0}} {{t('lịch bay mẫu','flight templates')}}</small></td>
              <td><span class="pill" [class.pill-success]="p.is_active" [class.pill-danger]="!p.is_active">{{p.is_active?t('Đang bật','Active'):t('Đang tắt','Inactive')}}</span></td>
              <td><div class="row-actions"><button class="btn btn-outline compact" (click)="openProfile(p)">{{t('Chi tiết / Sửa','Details / Edit')}}</button><button class="btn btn-dark compact" (click)="openAssign(p)" [disabled]="!p.is_active">{{t('Gán','Assign')}}</button></div></td>
            </tr>
          }
          @if(!filteredProfiles.length){<tr><td colspan="6"><div class="empty">{{t('Chưa có Seat Pricing Profile. Rule global bên dưới vẫn đang là fallback.','No seat pricing profiles yet. The global rules below remain the fallback.')}}</div></td></tr>}
        </tbody>
      </table>
    </div>
    <app-pagination [total]="filteredProfiles.length" [(page)]="profilePage" [(pageSize)]="profilePageSize" [pageSizeOptions]="[10,20,50]" />

    <section class="fallback-head">
      <div><div class="eyebrow">{{t('MẶC ĐỊNH TOÀN HỆ THỐNG','SYSTEM-WIDE DEFAULTS')}}</div><h2>{{t('Quy tắc giá ghế mặc định','Default seat pricing rules')}}</h2><p>{{t('Chỉ dùng khi chuyến bay chưa được gán Seat Pricing Profile. Mỗi lần sửa sẽ lưu thành phiên bản mới (v2, v3…) và tắt bản cũ để giữ lịch sử giá.','Used only when a flight has no seat pricing profile. Editing creates a new version (v2, v3…) and deactivates the old one to preserve pricing history.')}}</p><label class="history-toggle"><input type="checkbox" [(ngModel)]="showRuleHistory" (ngModelChange)="rulePage=1"> {{t('Hiện các phiên bản cũ','Show older versions')}} ({{supersededCount}})</label></div>
      <button class="btn btn-outline" (click)="openNewGlobalRule()">{{t('+ Thêm rule global','+ Add global rule')}}</button>
    </section>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>{{t('Loại ghế','Seat type')}}</th><th>{{t('Hạng','Cabin')}}</th><th>{{t('Mã quy tắc','Rule code')}}</th><th>{{t('Phụ phí','Fee')}}</th><th>{{t('Ưu tiên','Priority')}}</th><th>{{t('Trạng thái','Status')}}</th><th></th></tr></thead>
        <tbody>@for(r of pagedGlobalRules;track r._id||r.rule_id){<tr>
          <td><span class="swatch" [style.background]="dimColor(r.pricing_dimension)"></span><strong>{{dimensionLabel(r.pricing_dimension)}}</strong></td><td>{{cabinLabel(r.cabin_class)}}</td><td><small class="code">{{r.rule_id}} · v{{r.version||1}}</small>@if(r.supersedes_rule_id){<small class="muted-note"> {{t('thay cho','supersedes')}} {{r.supersedes_rule_id}}</small>}</td><td>{{money(r.amount)}}</td><td>{{r.priority}}</td>
          <td><span class="pill" [class.pill-success]="r.is_active">{{r.is_active?t('Đang bật','Active'):t('Đã tắt','Inactive')}}</span></td>
          <td>@if(r.is_active){<div class="row-actions"><button class="btn btn-outline compact" (click)="openGlobalRule(r)">{{t('Sửa','Edit')}}</button><button class="btn btn-outline compact danger" (click)="deactivateGlobalRule(r)">{{t('Tắt','Deactivate')}}</button></div>}@else if(isSuperseded(r)){<small class="muted-note">{{t('Đã có phiên bản mới','Replaced by a newer version')}}</small>}@else{<div class="row-actions"><button class="btn btn-outline compact" (click)="activateGlobalRule(r)" [disabled]="busy">{{t('Bật lại','Reactivate')}}</button></div>}</td>
        </tr>}</tbody>
      </table>
    </div>
    <app-pagination [total]="visibleGlobalRules.length" [(page)]="rulePage" [(pageSize)]="rulePageSize" [pageSizeOptions]="[10,20,50]" />

    @if(profileEditor){
      <div class="modal" (click)="closeProfile()"><section class="card modal-card wide" (click)="$event.stopPropagation()">
        <button class="close" (click)="closeProfile()">×</button>
        <div class="modal-title"><div><div class="eyebrow">{{editingProfileId?t('CHI TIẾT HỒ SƠ GIÁ GHẾ','SEAT PRICING DETAILS'):t('HỒ SƠ GIÁ GHẾ MỚI','NEW SEAT PRICING PROFILE')}}</div><h2>{{profileEditor.name||t('Hồ sơ giá ghế mới','New seat pricing profile')}}</h2></div>@if(editingProfileId){<span class="pill">{{t('phiên bản','version')}} {{profileEditor.version||1}}</span>}</div>
        <div class="grid grid-2">
          <label class="field"><span>{{t('Mã profile','Profile code')}}</span><input class="control" [(ngModel)]="profileEditor.code" [disabled]="!!editingProfileId" placeholder="A20N_STANDARD"></label>
          <label class="field"><span>{{t('Máy bay áp dụng','Applicable aircraft')}}</span><select class="control" [(ngModel)]="profileEditor.aircraft_type"><option value="ALL">{{aircraftName('ALL')}}</option>@for(a of layouts;track a.aircraft_type){<option [value]="a.aircraft_type">{{a.model_name}} ({{a.aircraft_type}})</option>}</select></label>
        </div>
        <label class="field"><span>{{t('Tên profile','Profile name')}}</span><input class="control" [(ngModel)]="profileEditor.name" [placeholder]="t('A320neo tiêu chuẩn','Standard A320neo')"></label>
        <label class="field"><span>{{t('Mô tả','Description')}}</span><input class="control" [(ngModel)]="profileEditor.description" [placeholder]="t('Phụ phí ghế cho đội bay A320neo','Seat fees for the A320neo fleet')"></label>
        <label class="check"><input type="checkbox" [(ngModel)]="profileEditor.is_active"> {{t('Cho phép gán profile','Allow profile assignment')}}</label>


        <div class="rules-head"><div><h3>{{t('Sơ đồ ghế & phụ phí','Seat map & fees')}}</h3><p>{{t('Màu thể hiện loại ghế nổi bật nhất. Phụ phí thực tế của một ghế là tổng các loại áp dụng (hạng, vị trí, thoát hiểm, rộng chân, vách ngăn và khu trước). Bấm vào ghế hoặc chú thích để sửa giá.','Colors show the most prominent seat type. The actual seat fee sums all applicable dimensions (cabin, position, exit row, legroom, bulkhead and front zone). Select a seat or legend item to edit fees.')}}</p></div>
          @if(profileEditor.aircraft_type==='ALL'){<label class="field inline"><span>{{t('Xem trước trên máy bay','Preview on aircraft')}}</span><select class="control" [(ngModel)]="previewAircraft" (ngModelChange)="selectedSeat=null">@for(a of layoutTypes;track a){<option [value]="a">{{aircraftName(a)}}</option>}</select></label>}
        </div>
        <div class="seat-area">
          <div class="seatmap">
            <div class="sm-row sm-head"><span class="rn"></span>@for(c of mapColumns;track $index){<span [class.aisle]="c==='|'">{{c==='|'?'':c}}</span>}</div>
            @for(row of mapRows;track row.row){
              @if(row.cabinStart){<div class="cabin-label">{{cabinLabel(row.cabin)}}</div>}
              <div class="sm-row"><span class="rn">{{row.row}}</span>
                @for(cell of row.cells;track $index){
                  @if(cell==='|'){<span class="aisle"></span>}
                  @else if(cell){<button class="seat" [style.background]="dimColor(primaryType(cell))" [class.sel]="selectedSeat?.seat_code===cell.seat_code" [class.dim]="!!highlight && !seatHas(cell,highlight)" [title]="cell.seat_code+' · '+money(seatFee(cell))" (click)="selectSeat(cell)">{{cell.column_letter}}</button>}
                  @else{<span class="gap"></span>}
                }
              </div>
            }
          </div>
          <div class="side">
            <div class="legend">
              <div class="legend-head"><strong>{{t('Chú thích & phụ phí','Legend & fees')}}</strong>
                <select class="mini-select" [(ngModel)]="legendCabin">@for(c of mapCabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></div>
              @for(d of dimensions;track d){
                <button class="legend-item" [class.active]="typeEditor?.dim===d" (mouseenter)="highlight=d" (mouseleave)="highlight=''" (click)="openType(legendCabin,d)">
                  <span class="swatch" [style.background]="dimColor(d)"></span>
                  <span class="lg-text">{{dimensionLabel(d)}}<small>{{countSeats(legendCabin,d)}} {{t('ghế','seats')}}</small></span>
                  <b>{{feeText(legendCabin,d)}}</b>
                </button>
              }
            </div>
            @if(typeEditor){
              <div class="panel">
                <div class="panel-head"><strong>{{dimensionLabel(typeEditor.dim)}} · {{cabinLabel(typeEditor.cabin)}}</strong><button class="close-sm" (click)="typeEditor=null">×</button></div>
                <label class="field"><span>{{t('Phụ phí (VND)','Fee (VND)')}}</span><input class="control" type="number" min="0" step="10000" [ngModel]="winner(typeEditor.cabin,typeEditor.dim)?.amount ?? 0" (ngModelChange)="setAmount(typeEditor.cabin,typeEditor.dim,$event)"></label>
                <small class="muted">{{sourceText(typeEditor.cabin,typeEditor.dim)}}</small>
                @if(winner(typeEditor.cabin,typeEditor.dim)){<button class="btn btn-outline compact danger" (click)="removeRule(typeEditor.cabin,typeEditor.dim)">{{t('Bỏ phụ phí loại này','Remove fee for this type')}}</button>}
              </div>
            }
            @if(selectedSeat){
              <div class="panel">
                <div class="panel-head"><strong>{{t('Ghế','Seat')}} {{selectedSeat.seat_code}} · {{cabinLabel(selectedSeat.cabin_class)}}</strong><button class="close-sm" (click)="selectedSeat=null">×</button></div>
                <table class="breakdown"><tbody>
                  @for(d of seatDims(selectedSeat);track d){<tr>
                    <td><span class="swatch" [style.background]="dimColor(d)"></span>{{dimensionLabel(d)}}</td>
                    <td><input class="mini-input" type="number" min="0" step="10000" [ngModel]="winner(selectedSeat.cabin_class,d)?.amount ?? 0" (ngModelChange)="setAmount(selectedSeat.cabin_class,d,$event)"></td>
                  </tr>}
                </tbody><tfoot><tr><td>{{t('Tổng phụ phí ghế','Total seat fee')}}</td><td><b>{{money(seatFee(selectedSeat))}}</b></td></tr></tfoot></table>
                <small class="muted">{{t('Sửa ở đây sẽ đổi giá cho mọi ghế cùng loại trong hạng','Editing here changes fees for all seats of this type in cabin')}} {{cabinLabel(selectedSeat.cabin_class)}}. {{t('Muốn đặt giá riêng cho một ghế của một chuyến, dùng “Ghi đè phụ phí” trong trang vận hành ghế.','To set a custom fee for an individual seat on one flight, use “Override seat fee” in seat operations.')}}</small>
              </div>
            }
          </div>
        </div>
        <div class="rules-head"><div><h3>{{t('Bảng quy tắc chi tiết','Detailed pricing rules')}}</h3><p>{{t('Dữ liệu khớp sơ đồ ở trên. Mỗi cặp hạng và loại ghế chỉ nên có một quy tắc. Quy tắc riêng theo hạng ưu tiên hơn “Tất cả hạng”, sau đó tới mức ưu tiên lớn hơn.','Uses the same data as the seat map above. Each cabin and seat type should have one rule. Cabin-specific rules take precedence over “All cabins”, then higher priority wins.')}}</p></div><button class="btn btn-outline compact" (click)="addProfileRule()">{{t('+ Thêm quy tắc','+ Add rule')}}</button></div>
        <div class="table-wrap inner"><table class="table rules-table"><thead><tr><th>{{t('Hạng','Cabin')}}</th><th>{{t('Loại ghế','Seat type')}}</th><th>{{t('Phụ phí (VND)','Fee (VND)')}}</th><th>{{t('Ưu tiên','Priority')}}</th><th></th></tr></thead><tbody>
          @for(r of profileEditor.rules;track $index;let i=$index){<tr>
            <td><select class="mini-select" [(ngModel)]="r.cabin_class">@for(c of cabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></td>
            <td><select class="mini-select dimension" [(ngModel)]="r.pricing_dimension">@for(d of dimensions;track d){<option [value]="d">{{dimensionLabel(d)}}</option>}</select></td>
            <td><input class="mini-input" type="number" min="0" step="10000" [(ngModel)]="r.amount"></td>
            <td><input class="priority" type="number" [(ngModel)]="r.priority"></td>
            <td><button class="icon-btn" (click)="profileEditor.rules.splice(i,1)">×</button></td>
          </tr>}
        </tbody></table></div>
        <div class="modal-actions">@if(editingProfileId){<button class="btn btn-outline danger" (click)="removeProfile()" [disabled]="busy">{{t('Xóa profile','Delete profile')}}</button>}<span class="spacer"></span><button class="btn btn-outline" (click)="closeProfile()">{{t('Đóng','Close')}}</button><button class="btn btn-primary" (click)="saveProfile()" [disabled]="busy">{{busy?t('Đang lưu…','Saving…'):t('Lưu profile','Save profile')}}</button></div>
      </section></div>
    }

    @if(assignEditor){
      <div class="modal" (click)="assignEditor=null"><section class="card modal-card" (click)="$event.stopPropagation()">
        <button class="close" (click)="assignEditor=null">×</button><div class="eyebrow">{{t('GÁN HỒ SƠ GIÁ GHẾ','ASSIGN SEAT PRICING PROFILE')}}</div><h2>{{assignEditor.name}} · {{aircraftName(assignEditor.aircraft_type)}}</h2>
        <p class="muted">{{t('Chỉ hiển thị chuyến tương thích với loại máy bay của profile. Tick trực tiếp các mục cần áp dụng.','Only flights compatible with the profile aircraft type are shown. Select the items where the profile should apply.')}}</p>
        <div class="target-grid">
          <div class="target-column"><div class="target-title"><strong>{{t('Chuyến bay cụ thể','Individual flights')}}</strong><small>{{selectedFlightIds.length}} {{t('đã chọn','selected')}}</small></div><div class="target-list">@for(f of compatibleFlights;track f._id){<label class="target"><input type="checkbox" [checked]="selectedFlightIds.includes(f._id)" (change)="toggleTarget(selectedFlightIds,f._id,$event)"><span><b>{{f.flight_number}} · {{f.origin_iata}} → {{f.dest_iata}}</b><small>{{calendarDate(f.departure_date)}} · {{t('Hiện tại:','Current:')}} {{seatProfileCode(f)}}</small></span></label>}</div></div>
          <div class="target-column"><div class="target-title"><strong>{{t('Lịch bay mẫu','Flight templates')}}</strong><small>{{selectedTemplateIds.length}} {{t('đã chọn','selected')}}</small></div><div class="target-list">@for(template of compatibleTemplates;track template._id){<label class="target"><input type="checkbox" [checked]="selectedTemplateIds.includes(template._id)" (change)="toggleTarget(selectedTemplateIds,template._id,$event)"><span><b>{{template.flight_number}} · {{template.origin_iata}} → {{template.dest_iata}}</b><small>{{template.aircraft_type||'—'}} · {{t('Hiện tại:','Current:')}} {{seatProfileCode(template)}}</small></span></label>}</div></div>
        </div>
        <div class="modal-actions"><small>{{selectedFlightIds.length+selectedTemplateIds.length}} {{t('mục được chọn','items selected')}}</small><span class="spacer"></span><button class="btn btn-outline" (click)="assignEditor=null">{{t('Đóng','Close')}}</button><button class="btn btn-primary" (click)="assignProfile()" [disabled]="busy||(!selectedFlightIds.length&&!selectedTemplateIds.length)">{{t('Áp dụng giá ghế','Apply seat pricing')}}</button></div>
      </section></div>
    }

    @if(globalRuleEditor){
      <div class="modal" (click)="globalRuleEditor=null"><section class="card modal-card small-card" (click)="$event.stopPropagation()">
        <button class="close" (click)="globalRuleEditor=null">×</button><div class="eyebrow">{{t('QUY TẮC MẶC ĐỊNH','DEFAULT RULE')}}</div><h2>{{editingGlobalRule?t('Sửa giá (tạo phiên bản mới)','Edit fee (create new version)'):t('Tạo quy tắc mới','Create a new rule')}}</h2>@if(editingGlobalRule){<p class="muted-note version-hint">{{t('Khi lưu, hệ thống tạo','Saving creates')}} <b>{{nextVersionLabel}}</b> {{t('với giá mới và tắt','with the new fee and deactivates')}} <b>{{editingGlobalRule.rule_id}}</b>. {{t('Đặt chỗ cũ vẫn giữ mức giá trước đó.','Existing bookings retain their previous prices.')}}</p>}
        @if(!editingGlobalRule){<label class="field"><span>{{t('Mã quy tắc (viết liền, không dấu)','Rule code (no spaces or accents)')}}</span><input class="control" [(ngModel)]="globalRuleEditor.rule_id" placeholder="R-ECO-WINDOW-CUSTOM"></label>}
        <div class="grid grid-2"><label class="field"><span>{{t('Hạng','Cabin')}}</span><select class="control" [(ngModel)]="globalRuleEditor.cabin_class" [disabled]="!!editingGlobalRule">@for(c of cabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></label><label class="field"><span>{{t('Loại ghế','Seat type')}}</span><select class="control" [(ngModel)]="globalRuleEditor.pricing_dimension" [disabled]="!!editingGlobalRule">@for(d of dimensions;track d){<option [value]="d">{{dimensionLabel(d)}}</option>}</select></label></div>
        <div class="grid grid-2"><label class="field"><span>{{t('Phụ phí (VND)','Fee (VND)')}}</span><input class="control" type="number" min="0" [(ngModel)]="globalRuleEditor.amount"></label><label class="field"><span>{{t('Ưu tiên (số lớn thắng)','Priority (higher wins)')}}</span><input class="control" type="number" [(ngModel)]="globalRuleEditor.priority"></label></div>
        <button class="btn btn-primary full" (click)="saveGlobalRule()" [disabled]="busy">{{t('Lưu','Save')}}</button>
      </section></div>
    }
  `,
  styles:[`.history-toggle{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:#506176;margin-top:6px;cursor:pointer}.muted-note{color:#7a8997;font-size:11px}.version-hint{margin:-6px 0 14px;line-height:1.5}
    .workflow{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dfe7ed;margin-top:18px;overflow:hidden}.workflow>div{display:flex;gap:11px;align-items:center;background:#fff;padding:15px}.workflow b{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#f2c85f}.workflow span{display:grid;gap:3px}.workflow strong{font-size:12px;color:#17344c}.workflow small{font-size:10px;color:#718093}.head-actions,.row-actions,.modal-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar{display:flex;gap:12px;align-items:center;padding:14px 16px;margin:18px 0}.toolbar .control{flex:1}.table td small{display:block;color:#788897;margin-top:4px}.compact{padding:8px 10px;font-size:10px}.notice{padding:11px 14px;border-radius:12px;margin:12px 0}.error-box{background:#fff0f0;color:#a32d2d}.success-box{background:#ecf8f2;color:#176b4a}.empty{padding:20px;text-align:center;color:#718093}.fallback-head{display:flex;justify-content:space-between;align-items:end;gap:15px;margin:34px 0 12px}.fallback-head h2{margin:4px 0;color:#0a2540}.fallback-head p{margin:0;color:#718093;font-size:12px}.danger{color:#9b3030;border-color:#e1bcbc}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}.modal-card{width:min(900px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.modal-card.wide{width:min(1050px,100%)}.small-card{width:min(570px,100%)}.close{position:absolute;right:14px;top:9px;border:0;background:transparent;font-size:28px}.modal-title{display:flex;justify-content:space-between;gap:15px;align-items:center}.modal-card h2{color:#0a2540;margin:6px 0 18px}.check{display:flex;gap:8px;align-items:center;padding:8px 0 16px;color:#40566a}.rules-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:18px 0 10px}.rules-head h3{margin:0;color:#0a2540}.rules-head p,.muted{font-size:11px;color:#718093;margin:5px 0 0}.inner{border:1px solid #e3e9ee;border-radius:12px}.rules-table{min-width:700px}.mini-select,.mini-input,.priority{border:1px solid #d8e1e8;border-radius:8px;padding:8px;background:#fff}.mini-select.dimension{min-width:190px}.mini-input{width:150px}.priority{width:75px}.icon-btn{width:29px;height:29px;border:0;border-radius:50%;background:#f7eaea;color:#9b3030;font-size:18px}.modal-actions{margin-top:18px}.modal-actions>small{color:#718093}.spacer{flex:1}.target-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.target-column{border:1px solid #dfe7ed;border-radius:14px;overflow:hidden}.target-title{display:flex;justify-content:space-between;padding:10px 11px;background:#f5f8fa}.target-title small{color:#718093}.target-list{max-height:290px;overflow:auto;padding:6px}.target{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:9px;border-radius:10px}.target:hover{background:#f7f9fb}.target input{margin-top:3px}.target span{display:grid;gap:3px}.target b{font-size:11px;color:#17344c}.target small{font-size:9px;color:#748391}.full{width:100%}.code{font-size:9px!important;color:#9aa7b3!important;font-family:monospace}.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:7px;vertical-align:-1px;border:1px solid rgba(0,0,0,.08);flex:none}.field.inline{margin:0;min-width:220px}.seat-area{display:grid;grid-template-columns:auto minmax(280px,1fr);gap:18px;align-items:start}.seatmap{border:1px solid #e3e9ee;border-radius:14px;padding:12px;max-height:520px;overflow:auto;background:#fbfcfd}.sm-row{display:flex;gap:4px;align-items:center;margin-bottom:4px}.sm-row>span,.seat{width:26px;height:26px;flex:none}.sm-head span{font-size:10px;color:#718093;text-align:center;font-weight:700}.rn{font-size:10px;color:#718093;text-align:right;line-height:26px;padding-right:2px}.aisle{width:14px!important}.seat{border:0;border-radius:6px 6px 4px 4px;font-size:9px;font-weight:700;color:#0a2540;cursor:pointer;transition:transform .1s,opacity .15s}.seat:hover{transform:scale(1.12)}.seat.sel{outline:2px solid #0a2540;outline-offset:1px}.seat.dim{opacity:.18}.cabin-label{font-size:9px;letter-spacing:.1em;color:#a57916;font-weight:900;margin:8px 0 4px 30px;text-transform:uppercase}.side{display:grid;gap:12px}.legend{border:1px solid #e3e9ee;border-radius:14px;padding:10px}.legend-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}.legend-head strong{font-size:12px;color:#17344c}.legend-item{display:flex;width:100%;align-items:center;gap:6px;border:0;background:transparent;padding:7px 6px;border-radius:9px;text-align:left;cursor:pointer}.legend-item:hover,.legend-item.active{background:#f2f6f9}.lg-text{flex:1;font-size:12px;color:#17344c}.lg-text small{display:block;font-size:9px;color:#8796a4}.legend-item b{font-size:12px;color:#0a2540}.panel{border:1px solid #e3e9ee;border-radius:14px;padding:12px;background:#fff;display:grid;gap:8px}.panel-head{display:flex;justify-content:space-between;align-items:center}.panel-head strong{font-size:13px;color:#0a2540}.close-sm{border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer}.breakdown{width:100%;border-collapse:collapse;font-size:12px}.breakdown td{padding:5px 0;border-bottom:1px solid #eef2f5}.breakdown td:last-child{text-align:right}.breakdown tfoot td{border:0;padding-top:8px}.breakdown .mini-input{width:120px}@media(max-width:900px){.seat-area{grid-template-columns:1fr}}@media(max-width:720px){.workflow,.target-grid{grid-template-columns:1fr}.section-head,.fallback-head{align-items:flex-start;flex-direction:column}.toolbar{align-items:stretch;flex-direction:column}.grid-2{grid-template-columns:1fr}.rules-head{align-items:flex-start;flex-direction:column}.modal-actions .spacer{display:none}.modal-actions .btn{flex:1}}
  `]
})
export class SeatPricingComponent{
  calendarDate=formatCalendarDate;
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api=inject(ApiService);
  private toast=inject(ToastService);
  language=inject(LanguageService);
  t(vi:string,en:string){return this.language.pick(vi,en)}
  private successPair(vi:string,en:string){this.__message=this.t(vi,en);this.toast.success({titleVi:'Thành công',titleEn:'Success',messageVi:vi,messageEn:en})}
  private errorPair(vi:string,en:string){this.__error=this.t(vi,en);this.toast.error({titleVi:'Không thể thực hiện',titleEn:'Action failed',messageVi:vi,messageEn:en})}
  private errorFrom(e:any,vi:string,en:string){const m=e?.error?.message;const detail=Array.isArray(m)?m.join(' · '):m||e?.message;if(detail)this.error=detail;else this.errorPair(vi,en)}
  profiles:any[]=[];globalRules:any[]=[];flights:any[]=[];templates:any[]=[];layouts:any[]=[];
  query='';profilePage=1;profilePageSize=20;rulePage=1;rulePageSize=20;busy=false;private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};private __message='';get message(){return this.__message}set message(v:string){this.__message=v;this.__toast.notifySuccess(v)};
  profileEditor:any=null;editingProfileId='';assignEditor:any=null;selectedFlightIds:string[]=[];selectedTemplateIds:string[]=[];
  globalRuleEditor:any=null;editingGlobalRule:any=null;
  readonly cabins=['ALL','ECONOMY','CLUB','BUSINESS','FIRST'];
  readonly dimensions=['CABIN_BASE','WINDOW','AISLE','MIDDLE','FRONT_ZONE','EXIT_ROW','EXTRA_LEGROOM','BULKHEAD'];

  constructor(){this.reload()}
  get filteredProfiles(){const q=this.query.trim().toLowerCase();if(!q)return this.profiles;return this.profiles.filter(p=>[p.code,p.name,p.description,p.aircraft_type].some(v=>String(v||'').toLowerCase().includes(q)))}
  get pagedProfiles(){const s=(this.profilePage-1)*this.profilePageSize;return this.filteredProfiles.slice(s,s+this.profilePageSize)}
  showRuleHistory=false;
  /** Old versions replaced by an edit are hidden by default so each seat type shows one current row. */
  get visibleGlobalRules(){return this.showRuleHistory?this.globalRules:this.globalRules.filter(r=>!this.isSuperseded(r))}
  get supersededCount(){return this.globalRules.filter(r=>this.isSuperseded(r)).length}
  get pagedGlobalRules(){const s=(this.rulePage-1)*this.rulePageSize;return this.visibleGlobalRules.slice(s,s+this.rulePageSize)}
  get compatibleFlights(){if(!this.assignEditor)return[];const a=this.assignEditor.aircraft_type;return this.flights.filter(f=>a==='ALL'||String(f.aircraft?.model_code||'').toUpperCase()===a)}
  get compatibleTemplates(){if(!this.assignEditor)return[];const a=this.assignEditor.aircraft_type;return this.templates.filter(t=>a==='ALL'||String(t.aircraft_type||'').toUpperCase()===a)}

  async reload(){this.error='';try{const [p,r,f,t,l]=await Promise.all([firstValueFrom(this.api.seatPricingProfiles()),firstValueFrom(this.api.getSeatPricingRules()),firstValueFrom(this.api.flights()),firstValueFrom(this.api.commercialTemplates({limit:200})),firstValueFrom(this.api.commercialAircraftLayouts())]);this.profiles=Array.isArray(p)?p:[];this.globalRules=Array.isArray(r)?r:[];this.flights=Array.isArray(f)?f:[];this.templates=Array.isArray(t)?t:(t?.items||[]);this.layouts=Array.isArray(l)?l:[];this.profilePage=1;this.rulePage=1}catch(e:any){this.errorFrom(e,'Không tải được dữ liệu giá ghế.','Unable to load seat pricing data.')}}
  defaultRules():SeatRule[]{return[
    {cabin_class:'ECONOMY',pricing_dimension:'CABIN_BASE',amount:0,priority:1},
    {cabin_class:'ECONOMY',pricing_dimension:'WINDOW',amount:50000,priority:5},
    {cabin_class:'ECONOMY',pricing_dimension:'AISLE',amount:30000,priority:5},
    {cabin_class:'ECONOMY',pricing_dimension:'FRONT_ZONE',amount:80000,priority:8},
    {cabin_class:'ECONOMY',pricing_dimension:'EXIT_ROW',amount:150000,priority:10},
    {cabin_class:'ECONOMY',pricing_dimension:'EXTRA_LEGROOM',amount:100000,priority:10},
  ]}
  openNewProfile(){this.selectedSeat=null;this.typeEditor=null;this.legendCabin='ECONOMY';this.editingProfileId='';this.profileEditor={code:'',name:'',description:'',aircraft_type:'A20N',is_active:true,version:1,rules:this.defaultRules()};this.error='';this.message=''}
  openProfile(p:any){this.selectedSeat=null;this.typeEditor=null;this.legendCabin='ECONOMY';this.editingProfileId=p._id;this.profileEditor={code:p.code,name:p.name,description:p.description||'',aircraft_type:p.aircraft_type||'ALL',is_active:!!p.is_active,version:p.version||1,rules:(p.rules||[]).map((r:any)=>({...r}))};this.error='';this.message=''}
  closeProfile(){this.profileEditor=null;this.editingProfileId=''}
  addProfileRule(){this.profileEditor?.rules.push({cabin_class:'ECONOMY',pricing_dimension:'WINDOW',amount:0,priority:0})}
  async saveProfile(){if(!this.profileEditor)return;const e=this.profileEditor;if(!e.code?.trim()||!e.name?.trim()||!e.rules?.length){this.errorPair('Nhập mã, tên và ít nhất một quy tắc phụ phí.','Enter a code, name and at least one seat fee rule.');return}this.busy=true;this.error='';try{const payload={code:e.code.trim().toUpperCase(),name:e.name.trim(),description:e.description?.trim()||'',aircraft_type:String(e.aircraft_type||'ALL').toUpperCase(),is_active:!!e.is_active,rules:e.rules.map((r:any)=>({cabin_class:r.cabin_class,pricing_dimension:r.pricing_dimension,amount:Number(r.amount),priority:Number(r.priority||0)}))};if(this.editingProfileId){const {code,...body}=payload;await firstValueFrom(this.api.updateSeatPricingProfile(this.editingProfileId,body));this.successPair('Đã cập nhật hồ sơ giá ghế và đồng bộ dữ liệu giá cho các chuyến bay và lịch bay mẫu đang sử dụng.','Updated the seat pricing profile and synchronized pricing data for assigned flights and flight templates.')}else{await firstValueFrom(this.api.createSeatPricingProfile(payload));this.successPair('Đã tạo hồ sơ giá ghế.','Created the seat pricing profile.')}this.closeProfile();await this.reload()}catch(err:any){this.errorFrom(err,'Không lưu được hồ sơ giá ghế.','Unable to save the seat pricing profile.')}finally{this.busy=false}}
  async removeProfile(){if(!this.editingProfileId)return;const confirmed=await this.toast.confirm({titleVi:'Xóa hồ sơ giá ghế?',titleEn:'Delete seat pricing profile?',messageVi:'Hồ sơ giá ghế này sẽ bị xóa khỏi hệ thống.',messageEn:'This seat pricing profile will be deleted from the system.',confirmVi:'Xóa',confirmEn:'Delete'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deleteSeatPricingProfile(this.editingProfileId));this.successPair('Đã xóa hồ sơ giá ghế.','Deleted the seat pricing profile.');this.closeProfile();await this.reload()}catch(e:any){this.errorFrom(e,'Không thể xóa hồ sơ giá ghế đang được sử dụng.','Unable to delete a seat pricing profile that is in use.')}finally{this.busy=false}}
  openAssign(p:any){this.assignEditor=p;this.selectedFlightIds=[];this.selectedTemplateIds=[];this.error='';this.message=''}
  toggleTarget(list:string[],id:string,event:Event){const checked=(event.target as HTMLInputElement).checked;const i=list.indexOf(id);if(checked&&i<0)list.push(id);if(!checked&&i>=0)list.splice(i,1)}
  async assignProfile(){if(!this.assignEditor)return;this.busy=true;this.error='';try{const r=await firstValueFrom(this.api.assignSeatPricingProfile(this.assignEditor._id,{flight_ids:this.selectedFlightIds,template_ids:this.selectedTemplateIds}));const flights=Number(r.flights_updated||0);const templates=Number(r.templates_updated||0);const inherited=Number(r.inherited_flights_updated||0);const extraVi=inherited?` và đồng bộ ${inherited} chuyến bay kế thừa`:'';const extraEn=inherited?` and synchronized ${inherited} inherited flights`:'';this.successPair(`Đã gán ${flights} chuyến bay, ${templates} lịch bay mẫu${extraVi}.`,`Assigned ${flights} flight${flights===1?'':'s'}, ${templates} flight template${templates===1?'':'s'}${extraEn}.`);this.assignEditor=null;await this.reload()}catch(e:any){this.errorFrom(e,'Không gán được hồ sơ giá ghế.','Unable to assign the seat pricing profile.')}finally{this.busy=false}}

  // ---- Seat map preview (port of backend fleet layout + SeatPricingService rule matching) ----
  readonly layoutTypes=Object.keys(FLEET_LAYOUTS);
  previewAircraft='A20N';legendCabin='ECONOMY';selectedSeat:PreviewSeat|null=null;typeEditor:{cabin:string;dim:string}|null=null;highlight='';
  private seatCache=new Map<string,PreviewSeat[]>();
  private rowsCache:{key:string;rows:any[]}|null=null;
  get mapAircraft(){const a=String(this.profileEditor?.aircraft_type||'ALL').toUpperCase();return a!=='ALL'&&FLEET_LAYOUTS[a]?a:this.previewAircraft}
  get mapSeats(){const a=this.mapAircraft;if(!this.seatCache.has(a))this.seatCache.set(a,previewSeats(a));return this.seatCache.get(a)!}
  get mapColumns(){return layoutColumns(this.mapAircraft)}
  get mapCabins(){return [...new Set(this.mapSeats.map(s=>s.cabin_class))]}
  get mapRows(){const key=this.mapAircraft;if(this.rowsCache?.key===key)return this.rowsCache.rows;const cols=this.mapColumns;const byRow=new Map<number,PreviewSeat[]>();for(const s of this.mapSeats){if(!byRow.has(s.row_number))byRow.set(s.row_number,[]);byRow.get(s.row_number)!.push(s)}let prev='';const rows=[...byRow.entries()].map(([row,seats])=>{const cabin=seats[0].cabin_class;const r={row,cabin,cabinStart:cabin!==prev,cells:cols.map(c=>c==='|'?'|':seats.find(s=>s.column_letter===c)||null)};prev=cabin;return r});this.rowsCache={key,rows};return rows}
  seatDims(s:PreviewSeat){return seatDimensions(s)}
  seatHas(s:PreviewSeat,d:string){return seatDimensions(s).includes(d)}
  primaryType(s:PreviewSeat){if(s.is_exit_row)return 'EXIT_ROW';if(s.is_extra_legroom)return 'EXTRA_LEGROOM';if(s.is_bulkhead)return 'BULKHEAD';if(s.is_front_zone)return 'FRONT_ZONE';return s.position}
  countSeats(cabin:string,d:string){return this.mapSeats.filter(s=>s.cabin_class===cabin&&this.seatHas(s,d)).length}
  /** Same winner selection as backend: cabin-specific rule beats ALL, then higher priority. */
  winner(cabin:string,dim:string):any{const rules=(this.profileEditor?.rules||[]).filter((r:any)=>r.pricing_dimension===dim&&(r.cabin_class===cabin||r.cabin_class==='ALL'));return rules.sort((a:any,b:any)=>(Number(b.cabin_class===cabin)-Number(a.cabin_class===cabin))||(Number(b.priority||0)-Number(a.priority||0)))[0]||null}
  seatFee(s:PreviewSeat){return seatDimensions(s).reduce((t,d)=>t+Number(this.winner(s.cabin_class,d)?.amount||0),0)}
  feeText(cabin:string,d:string){const w=this.winner(cabin,d);return w?(Number(w.amount)?'+'+this.money(w.amount):this.t('Miễn phí','Free')):'—'}
  sourceText(cabin:string,d:string){const w=this.winner(cabin,d);if(!w)return this.t('Chưa có quy tắc – nhập số để tạo quy tắc mới cho hạng ','No rule yet – enter an amount to create a new rule for ') + this.cabinLabel(cabin)+'.';return w.cabin_class==='ALL'?this.t('Đang dùng quy tắc chung cho “Tất cả hạng” – sửa ở đây sẽ ảnh hưởng mọi hạng.','Using the shared “All cabins” rule – changes here affect every cabin.'):this.t('Quy tắc riêng cho hạng ','Cabin-specific rule for ')+this.cabinLabel(cabin)+'.'}
  setAmount(cabin:string,dim:string,v:any){const amount=Math.max(0,Number(v||0));const w=this.winner(cabin,dim);if(w){w.amount=amount;return}this.profileEditor.rules.push({cabin_class:cabin,pricing_dimension:dim,amount,priority:5})}
  removeRule(cabin:string,dim:string){const w=this.winner(cabin,dim);if(!w)return;const i=this.profileEditor.rules.indexOf(w);if(i>=0)this.profileEditor.rules.splice(i,1)}
  selectSeat(s:PreviewSeat){this.selectedSeat=s;this.typeEditor=null}
  openType(cabin:string,dim:string){this.typeEditor={cabin,dim};this.selectedSeat=null}
  dimColor(d:string){return({CABIN_BASE:'#e7edf2',WINDOW:'#bfe3f7',AISLE:'#cdeccf',MIDDLE:'#eef1f4',FRONT_ZONE:'#f9e0b0',EXIT_ROW:'#f6b9b0',EXTRA_LEGROOM:'#d7c8f3',BULKHEAD:'#f4d6e6'} as Record<string,string>)[d]||'#eef1f4'}
  aircraftName(a:string){const k=String(a||'ALL').toUpperCase();return k==='ALL'?this.t('Mọi loại máy bay','All aircraft types'):(FLEET_LAYOUTS[k]?.model_name||this.layouts.find(l=>l.aircraft_type===k)?.model_name||k)}
  seatProfileCode(x:any){return x?.seat_pricing_profile_snapshot?.name||x?.seat_pricing_profile_snapshot?.code||this.t('quy tắc mặc định','default rule')}
  cabinLabel(v:string){return this.language.cabinLabel(v)}
  dimensionLabel(v:string){return this.language.seatDimensionLabel(v)}

  openNewGlobalRule(){this.editingGlobalRule=null;this.globalRuleEditor={rule_id:'',cabin_class:'ECONOMY',pricing_dimension:'WINDOW',amount:0,priority:0};this.error=''}
  openGlobalRule(r:any){this.editingGlobalRule=r;this.globalRuleEditor={rule_id:r.rule_id,cabin_class:r.cabin_class,pricing_dimension:r.pricing_dimension,amount:Number(r.amount||0),priority:Number(r.priority||0)};this.error=''}
  async saveGlobalRule(){const e=this.globalRuleEditor;if(!e)return;if(!this.editingGlobalRule&&!e.rule_id?.trim()){this.errorPair('Vui lòng nhập mã quy tắc.','Please enter a rule code.');return}this.busy=true;this.error='';try{if(this.editingGlobalRule)await firstValueFrom(this.api.updateSeatPricingRule(this.editingGlobalRule.rule_id,{amount:Number(e.amount),priority:Number(e.priority)}));else await firstValueFrom(this.api.createSeatPricingRule({rule_id:e.rule_id.trim().toUpperCase(),cabin_class:e.cabin_class,pricing_dimension:e.pricing_dimension,amount:Number(e.amount),priority:Number(e.priority)}));if(this.editingGlobalRule)this.successPair('Đã tạo phiên bản mới cho quy tắc giá ghế mặc định.','Created a new version of the default seat pricing rule.');else this.successPair('Đã tạo quy tắc giá ghế mặc định.','Created the default seat pricing rule.');this.globalRuleEditor=null;this.editingGlobalRule=null;await this.reload()}catch(err:any){this.errorFrom(err,'Không lưu được quy tắc giá ghế mặc định.','Unable to save the default seat pricing rule.')}finally{this.busy=false}}
  async deactivateGlobalRule(r:any){const confirmed=await this.toast.confirm({titleVi:'Tắt quy tắc?',titleEn:'Deactivate rule?',messageVi:'Tắt '+r.rule_id+'?',messageEn:'Deactivate '+r.rule_id+'?',confirmVi:'Tắt',confirmEn:'Deactivate'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deleteSeatPricingRule(r.rule_id));this.successPair(`Đã tắt quy tắc ${r.rule_id}.`,`Deactivated rule ${r.rule_id}.`);await this.reload()}catch(e:any){this.errorFrom(e,'Không tắt được quy tắc.','Unable to deactivate the rule.')}finally{this.busy=false}}
  /** A disabled rule that was replaced by an edited version (-Vn) cannot be turned back on. */
  get nextVersionLabel(){const r=this.editingGlobalRule;if(!r)return'';const v=Number(r.version||1)+1;return String(r.rule_id).replace(/-V\d+$/,'')+'-V'+v}
  isSuperseded(r:any){return this.globalRules.some(x=>x.supersedes_rule_id===r.rule_id)}
  async activateGlobalRule(r:any){this.busy=true;this.error='';try{await firstValueFrom(this.api.activateSeatPricingRule(r.rule_id));this.successPair(`Đã bật lại quy tắc ${r.rule_id}.`,`Reactivated rule ${r.rule_id}.`);await this.reload()}catch(e:any){this.errorFrom(e,'Không bật lại được quy tắc.','Unable to reactivate the rule.')}finally{this.busy=false}}
  money(v:number){return new Intl.NumberFormat(this.language.language()==='vi'?'vi-VN':'en-US',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v||0))}
}
