import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';
import { FLEET_LAYOUTS, PreviewSeat, layoutColumns, previewSeats, seatDimensions } from './pricing/fleet-layouts';

type SeatRule={cabin_class:string;pricing_dimension:string;amount:number;priority:number};

@Component({
  standalone:true,
  imports:[FormsModule,PaginationComponent],
  template:`
    <div class="eyebrow">DOANH THU GHẾ</div>
    <div class="section-head">
      <div><h1 class="title">Hồ sơ giá ghế</h1><p class="subtitle">Cấu hình phụ phí theo loại máy bay. Template và chuyến bay cụ thể có thể dùng profile riêng; chuyến chưa gán profile vẫn dùng rule global cũ.</p></div>
      <div class="head-actions"><button class="btn btn-primary" (click)="openNewProfile()">+ Tạo profile</button><button class="btn btn-outline" (click)="reload()">Làm mới</button></div>
    </div>
    <div class="workflow card"><div><b>1</b><span><strong>Chọn loại máy bay</strong><small>Mỗi profile nên gắn với một layout ghế rõ ràng.</small></span></div><div><b>2</b><span><strong>Đặt phụ phí dễ hiểu</strong><small>Cửa sổ, lối đi, hàng thoát hiểm, chỗ rộng chân…</small></span></div><div><b>3</b><span><strong>Tick nơi áp dụng</strong><small>Chọn chuyến hoặc lịch bay mẫu bằng checkbox.</small></span></div></div>

    
    

    <section class="card toolbar">
      <input class="control" [(ngModel)]="query" (ngModelChange)="profilePage=1" placeholder="Tìm mã profile, tên, aircraft...">
      <span class="pill pill-gold">{{filteredProfiles.length}} profile</span>
    </section>

    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>Hồ sơ giá ghế</th><th>Máy bay</th><th>Số quy tắc</th><th>Đang dùng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          @for(p of pagedProfiles;track p._id){
            <tr>
              <td><strong>{{p.name}}</strong><small>{{p.description||''}}</small><small class="code">mã: {{p.code}}</small></td>
              <td>{{aircraftName(p.aircraft_type)}}<small class="code">{{p.aircraft_type||'ALL'}}</small></td>
              <td>{{p.rules?.length||0}} quy tắc<small>phiên bản {{p.version||1}}</small></td>
              <td>{{p.assigned_flights||0}} chuyến<small>{{p.assigned_templates||0}} lịch bay mẫu</small></td>
              <td><span class="pill" [class.pill-success]="p.is_active" [class.pill-danger]="!p.is_active">{{p.is_active?'Đang bật':'Đang tắt'}}</span></td>
              <td><div class="row-actions"><button class="btn btn-outline compact" (click)="openProfile(p)">Chi tiết / Sửa</button><button class="btn btn-dark compact" (click)="openAssign(p)" [disabled]="!p.is_active">Gán</button></div></td>
            </tr>
          }
          @if(!filteredProfiles.length){<tr><td colspan="6"><div class="empty">Chưa có Seat Pricing Profile. Rule global bên dưới vẫn đang là fallback.</div></td></tr>}
        </tbody>
      </table>
    </div>
    <app-pagination [total]="filteredProfiles.length" [(page)]="profilePage" [(pageSize)]="profilePageSize" [pageSizeOptions]="[10,20,50]" />

    <section class="fallback-head">
      <div><div class="eyebrow">MẶC ĐỊNH TOÀN HỆ THỐNG</div><h2>Quy tắc giá ghế mặc định</h2><p>Chỉ dùng khi chuyến bay chưa được gán Seat Pricing Profile. Mỗi lần <b>Sửa</b> sẽ lưu thành phiên bản mới (v2, v3…) và tắt bản cũ để giữ lịch sử giá.</p><label class="history-toggle"><input type="checkbox" [(ngModel)]="showRuleHistory" (ngModelChange)="rulePage=1"> Hiện các phiên bản cũ ({{supersededCount}})</label></div>
      <button class="btn btn-outline" (click)="openNewGlobalRule()">+ Thêm rule global</button>
    </section>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>Loại ghế</th><th>Hạng</th><th>Mã quy tắc</th><th>Phụ phí</th><th>Ưu tiên</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>@for(r of pagedGlobalRules;track r._id||r.rule_id){<tr>
          <td><span class="swatch" [style.background]="dimColor(r.pricing_dimension)"></span><strong>{{dimensionLabel(r.pricing_dimension)}}</strong></td><td>{{cabinLabel(r.cabin_class)}}</td><td><small class="code">{{r.rule_id}} · v{{r.version||1}}</small>@if(r.supersedes_rule_id){<small class="muted-note"> thay cho {{r.supersedes_rule_id}}</small>}</td><td>{{money(r.amount)}}</td><td>{{r.priority}}</td>
          <td><span class="pill" [class.pill-success]="r.is_active">{{r.is_active?'Đang bật':'Đã tắt'}}</span></td>
          <td>@if(r.is_active){<div class="row-actions"><button class="btn btn-outline compact" (click)="openGlobalRule(r)">Sửa</button><button class="btn btn-outline compact danger" (click)="deactivateGlobalRule(r)">Tắt</button></div>}@else if(isSuperseded(r)){<small class="muted-note">Đã có phiên bản mới</small>}@else{<div class="row-actions"><button class="btn btn-outline compact" (click)="activateGlobalRule(r)" [disabled]="busy">Bật lại</button></div>}</td>
        </tr>}</tbody>
      </table>
    </div>
    <app-pagination [total]="visibleGlobalRules.length" [(page)]="rulePage" [(pageSize)]="rulePageSize" [pageSizeOptions]="[10,20,50]" />

    @if(profileEditor){
      <div class="modal" (click)="closeProfile()"><section class="card modal-card wide" (click)="$event.stopPropagation()">
        <button class="close" (click)="closeProfile()">×</button>
        <div class="modal-title"><div><div class="eyebrow">{{editingProfileId?'CHI TIẾT HỒ SƠ GIÁ GHẾ':'HỒ SƠ GIÁ GHẾ MỚI'}}</div><h2>{{profileEditor.name||'Hồ sơ giá ghế mới'}}</h2></div>@if(editingProfileId){<span class="pill">phiên bản {{profileEditor.version||1}}</span>}</div>
        <div class="grid grid-2">
          <label class="field"><span>Mã profile</span><input class="control" [(ngModel)]="profileEditor.code" [disabled]="!!editingProfileId" placeholder="A20N_STANDARD"></label>
          <label class="field"><span>Máy bay áp dụng</span><select class="control" [(ngModel)]="profileEditor.aircraft_type"><option value="ALL">Mọi loại máy bay</option>@for(a of layouts;track a.aircraft_type){<option [value]="a.aircraft_type">{{a.model_name}} ({{a.aircraft_type}})</option>}</select></label>
        </div>
        <label class="field"><span>Tên profile</span><input class="control" [(ngModel)]="profileEditor.name" placeholder="A320neo tiêu chuẩn"></label>
        <label class="field"><span>Mô tả</span><input class="control" [(ngModel)]="profileEditor.description" placeholder="Phụ phí ghế cho đội bay A320neo"></label>
        <label class="check"><input type="checkbox" [(ngModel)]="profileEditor.is_active"> Cho phép gán profile</label>


        <div class="rules-head"><div><h3>Sơ đồ ghế &amp; phụ phí</h3><p>Màu = loại ghế nổi bật nhất. Phụ phí thực tế của một ghế = <b>cộng dồn</b> tất cả loại mà ghế thuộc về (phí cơ bản hạng + vị trí + thoát hiểm + rộng chân + vách ngăn + khu phía trước). Bấm vào ghế hoặc vào một dòng chú thích để sửa giá.</p></div>
          @if(profileEditor.aircraft_type==='ALL'){<label class="field inline"><span>Xem trước trên máy bay</span><select class="control" [(ngModel)]="previewAircraft" (ngModelChange)="selectedSeat=null">@for(a of layoutTypes;track a){<option [value]="a">{{aircraftName(a)}}</option>}</select></label>}
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
              <div class="legend-head"><strong>Chú thích &amp; phụ phí</strong>
                <select class="mini-select" [(ngModel)]="legendCabin">@for(c of mapCabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></div>
              @for(d of dimensions;track d){
                <button class="legend-item" [class.active]="typeEditor?.dim===d" (mouseenter)="highlight=d" (mouseleave)="highlight=''" (click)="openType(legendCabin,d)">
                  <span class="swatch" [style.background]="dimColor(d)"></span>
                  <span class="lg-text">{{dimensionLabel(d)}}<small>{{countSeats(legendCabin,d)}} ghế</small></span>
                  <b>{{feeText(legendCabin,d)}}</b>
                </button>
              }
            </div>
            @if(typeEditor){
              <div class="panel">
                <div class="panel-head"><strong>{{dimensionLabel(typeEditor.dim)}} · {{cabinLabel(typeEditor.cabin)}}</strong><button class="close-sm" (click)="typeEditor=null">×</button></div>
                <label class="field"><span>Phụ phí (VND)</span><input class="control" type="number" min="0" step="10000" [ngModel]="winner(typeEditor.cabin,typeEditor.dim)?.amount ?? 0" (ngModelChange)="setAmount(typeEditor.cabin,typeEditor.dim,$event)"></label>
                <small class="muted">{{sourceText(typeEditor.cabin,typeEditor.dim)}}</small>
                @if(winner(typeEditor.cabin,typeEditor.dim)){<button class="btn btn-outline compact danger" (click)="removeRule(typeEditor.cabin,typeEditor.dim)">Bỏ phụ phí loại này</button>}
              </div>
            }
            @if(selectedSeat){
              <div class="panel">
                <div class="panel-head"><strong>Ghế {{selectedSeat.seat_code}} · {{cabinLabel(selectedSeat.cabin_class)}}</strong><button class="close-sm" (click)="selectedSeat=null">×</button></div>
                <table class="breakdown"><tbody>
                  @for(d of seatDims(selectedSeat);track d){<tr>
                    <td><span class="swatch" [style.background]="dimColor(d)"></span>{{dimensionLabel(d)}}</td>
                    <td><input class="mini-input" type="number" min="0" step="10000" [ngModel]="winner(selectedSeat.cabin_class,d)?.amount ?? 0" (ngModelChange)="setAmount(selectedSeat.cabin_class,d,$event)"></td>
                  </tr>}
                </tbody><tfoot><tr><td>Tổng phụ phí ghế</td><td><b>{{money(seatFee(selectedSeat))}}</b></td></tr></tfoot></table>
                <small class="muted">Sửa ở đây sẽ đổi giá cho <b>mọi ghế cùng loại</b> trong hạng {{cabinLabel(selectedSeat.cabin_class)}}. Muốn đặt giá riêng cho đúng một ghế của một chuyến, dùng “Ghi đè giá ghế” ở trang vận hành ghế của chuyến bay.</small>
              </div>
            }
          </div>
        </div>
        <div class="rules-head"><div><h3>Bảng quy tắc chi tiết</h3><p>Cùng dữ liệu với sơ đồ ở trên. Mỗi cặp hạng + loại ghế chỉ nên có một quy tắc; quy tắc riêng cho hạng thắng quy tắc “Tất cả hạng”, sau đó tới số ưu tiên lớn hơn.</p></div><button class="btn btn-outline compact" (click)="addProfileRule()">+ Thêm quy tắc</button></div>
        <div class="table-wrap inner"><table class="table rules-table"><thead><tr><th>Hạng</th><th>Loại ghế</th><th>Phụ phí (VND)</th><th>Ưu tiên</th><th></th></tr></thead><tbody>
          @for(r of profileEditor.rules;track $index;let i=$index){<tr>
            <td><select class="mini-select" [(ngModel)]="r.cabin_class">@for(c of cabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></td>
            <td><select class="mini-select dimension" [(ngModel)]="r.pricing_dimension">@for(d of dimensions;track d){<option [value]="d">{{dimensionLabel(d)}}</option>}</select></td>
            <td><input class="mini-input" type="number" min="0" step="10000" [(ngModel)]="r.amount"></td>
            <td><input class="priority" type="number" [(ngModel)]="r.priority"></td>
            <td><button class="icon-btn" (click)="profileEditor.rules.splice(i,1)">×</button></td>
          </tr>}
        </tbody></table></div>
        <div class="modal-actions">@if(editingProfileId){<button class="btn btn-outline danger" (click)="removeProfile()" [disabled]="busy">Xóa profile</button>}<span class="spacer"></span><button class="btn btn-outline" (click)="closeProfile()">Đóng</button><button class="btn btn-primary" (click)="saveProfile()" [disabled]="busy">{{busy?'Đang lưu…':'Lưu profile'}}</button></div>
      </section></div>
    }

    @if(assignEditor){
      <div class="modal" (click)="assignEditor=null"><section class="card modal-card" (click)="$event.stopPropagation()">
        <button class="close" (click)="assignEditor=null">×</button><div class="eyebrow">GÁN HỒ SƠ GIÁ GHẾ</div><h2>{{assignEditor.name}} · {{aircraftName(assignEditor.aircraft_type)}}</h2>
        <p class="muted">Chỉ hiển thị chuyến tương thích với loại máy bay của profile. Tick trực tiếp các mục cần áp dụng.</p>
        <div class="target-grid">
          <div class="target-column"><div class="target-title"><strong>Chuyến bay cụ thể</strong><small>{{selectedFlightIds.length}} đã chọn</small></div><div class="target-list">@for(f of compatibleFlights;track f._id){<label class="target"><input type="checkbox" [checked]="selectedFlightIds.includes(f._id)" (change)="toggleTarget(selectedFlightIds,f._id,$event)"><span><b>{{f.flight_number}} · {{f.origin_iata}} → {{f.dest_iata}}</b><small>{{f.departure_date}} · Hiện tại: {{seatProfileCode(f)}}</small></span></label>}</div></div>
          <div class="target-column"><div class="target-title"><strong>Lịch bay mẫu</strong><small>{{selectedTemplateIds.length}} đã chọn</small></div><div class="target-list">@for(t of compatibleTemplates;track t._id){<label class="target"><input type="checkbox" [checked]="selectedTemplateIds.includes(t._id)" (change)="toggleTarget(selectedTemplateIds,t._id,$event)"><span><b>{{t.flight_number}} · {{t.origin_iata}} → {{t.dest_iata}}</b><small>{{t.aircraft_type||'—'}} · Hiện tại: {{seatProfileCode(t)}}</small></span></label>}</div></div>
        </div>
        <div class="modal-actions"><small>{{selectedFlightIds.length+selectedTemplateIds.length}} mục được chọn</small><span class="spacer"></span><button class="btn btn-outline" (click)="assignEditor=null">Đóng</button><button class="btn btn-primary" (click)="assignProfile()" [disabled]="busy||(!selectedFlightIds.length&&!selectedTemplateIds.length)">Áp dụng giá ghế</button></div>
      </section></div>
    }

    @if(globalRuleEditor){
      <div class="modal" (click)="globalRuleEditor=null"><section class="card modal-card small-card" (click)="$event.stopPropagation()">
        <button class="close" (click)="globalRuleEditor=null">×</button><div class="eyebrow">QUY TẮC MẶC ĐỊNH</div><h2>{{editingGlobalRule?'Sửa giá (tạo phiên bản mới)':'Tạo quy tắc mới'}}</h2>@if(editingGlobalRule){<p class="muted-note version-hint">Khi lưu, hệ thống tạo <b>{{nextVersionLabel}}</b> với giá mới và tắt <b>{{editingGlobalRule.rule_id}}</b>. Booking cũ vẫn giữ giá đã tính trước đó.</p>}
        @if(!editingGlobalRule){<label class="field"><span>Mã quy tắc (viết liền, không dấu)</span><input class="control" [(ngModel)]="globalRuleEditor.rule_id" placeholder="R-ECO-WINDOW-CUSTOM"></label>}
        <div class="grid grid-2"><label class="field"><span>Hạng</span><select class="control" [(ngModel)]="globalRuleEditor.cabin_class" [disabled]="!!editingGlobalRule">@for(c of cabins;track c){<option [value]="c">{{cabinLabel(c)}}</option>}</select></label><label class="field"><span>Loại ghế</span><select class="control" [(ngModel)]="globalRuleEditor.pricing_dimension" [disabled]="!!editingGlobalRule">@for(d of dimensions;track d){<option [value]="d">{{dimensionLabel(d)}}</option>}</select></label></div>
        <div class="grid grid-2"><label class="field"><span>Phụ phí (VND)</span><input class="control" type="number" min="0" [(ngModel)]="globalRuleEditor.amount"></label><label class="field"><span>Ưu tiên (số lớn thắng)</span><input class="control" type="number" [(ngModel)]="globalRuleEditor.priority"></label></div>
        <button class="btn btn-primary full" (click)="saveGlobalRule()" [disabled]="busy">Lưu</button>
      </section></div>
    }
  `,
  styles:[`.history-toggle{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:#506176;margin-top:6px;cursor:pointer}.muted-note{color:#7a8997;font-size:11px}.version-hint{margin:-6px 0 14px;line-height:1.5}
    .workflow{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dfe7ed;margin-top:18px;overflow:hidden}.workflow>div{display:flex;gap:11px;align-items:center;background:#fff;padding:15px}.workflow b{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#071b2e;color:#f2c85f}.workflow span{display:grid;gap:3px}.workflow strong{font-size:12px;color:#17344c}.workflow small{font-size:10px;color:#718093}.head-actions,.row-actions,.modal-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar{display:flex;gap:12px;align-items:center;padding:14px 16px;margin:18px 0}.toolbar .control{flex:1}.table td small{display:block;color:#788897;margin-top:4px}.compact{padding:8px 10px;font-size:10px}.notice{padding:11px 14px;border-radius:12px;margin:12px 0}.error-box{background:#fff0f0;color:#a32d2d}.success-box{background:#ecf8f2;color:#176b4a}.empty{padding:20px;text-align:center;color:#718093}.fallback-head{display:flex;justify-content:space-between;align-items:end;gap:15px;margin:34px 0 12px}.fallback-head h2{margin:4px 0;color:#0a2540}.fallback-head p{margin:0;color:#718093;font-size:12px}.danger{color:#9b3030;border-color:#e1bcbc}.modal{position:fixed;inset:0;background:rgba(4,18,31,.62);display:grid;place-items:center;padding:20px;z-index:120}.modal-card{width:min(900px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.modal-card.wide{width:min(1050px,100%)}.small-card{width:min(570px,100%)}.close{position:absolute;right:14px;top:9px;border:0;background:transparent;font-size:28px}.modal-title{display:flex;justify-content:space-between;gap:15px;align-items:center}.modal-card h2{color:#0a2540;margin:6px 0 18px}.check{display:flex;gap:8px;align-items:center;padding:8px 0 16px;color:#40566a}.rules-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:18px 0 10px}.rules-head h3{margin:0;color:#0a2540}.rules-head p,.muted{font-size:11px;color:#718093;margin:5px 0 0}.inner{border:1px solid #e3e9ee;border-radius:12px}.rules-table{min-width:700px}.mini-select,.mini-input,.priority{border:1px solid #d8e1e8;border-radius:8px;padding:8px;background:#fff}.mini-select.dimension{min-width:190px}.mini-input{width:150px}.priority{width:75px}.icon-btn{width:29px;height:29px;border:0;border-radius:50%;background:#f7eaea;color:#9b3030;font-size:18px}.modal-actions{margin-top:18px}.modal-actions>small{color:#718093}.spacer{flex:1}.target-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.target-column{border:1px solid #dfe7ed;border-radius:14px;overflow:hidden}.target-title{display:flex;justify-content:space-between;padding:10px 11px;background:#f5f8fa}.target-title small{color:#718093}.target-list{max-height:290px;overflow:auto;padding:6px}.target{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:9px;border-radius:10px}.target:hover{background:#f7f9fb}.target input{margin-top:3px}.target span{display:grid;gap:3px}.target b{font-size:11px;color:#17344c}.target small{font-size:9px;color:#748391}.full{width:100%}.code{font-size:9px!important;color:#9aa7b3!important;font-family:monospace}.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:7px;vertical-align:-1px;border:1px solid rgba(0,0,0,.08);flex:none}.field.inline{margin:0;min-width:220px}.seat-area{display:grid;grid-template-columns:auto minmax(280px,1fr);gap:18px;align-items:start}.seatmap{border:1px solid #e3e9ee;border-radius:14px;padding:12px;max-height:520px;overflow:auto;background:#fbfcfd}.sm-row{display:flex;gap:4px;align-items:center;margin-bottom:4px}.sm-row>span,.seat{width:26px;height:26px;flex:none}.sm-head span{font-size:10px;color:#718093;text-align:center;font-weight:700}.rn{font-size:10px;color:#718093;text-align:right;line-height:26px;padding-right:2px}.aisle{width:14px!important}.seat{border:0;border-radius:6px 6px 4px 4px;font-size:9px;font-weight:700;color:#0a2540;cursor:pointer;transition:transform .1s,opacity .15s}.seat:hover{transform:scale(1.12)}.seat.sel{outline:2px solid #0a2540;outline-offset:1px}.seat.dim{opacity:.18}.cabin-label{font-size:9px;letter-spacing:.1em;color:#a57916;font-weight:900;margin:8px 0 4px 30px;text-transform:uppercase}.side{display:grid;gap:12px}.legend{border:1px solid #e3e9ee;border-radius:14px;padding:10px}.legend-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}.legend-head strong{font-size:12px;color:#17344c}.legend-item{display:flex;width:100%;align-items:center;gap:6px;border:0;background:transparent;padding:7px 6px;border-radius:9px;text-align:left;cursor:pointer}.legend-item:hover,.legend-item.active{background:#f2f6f9}.lg-text{flex:1;font-size:12px;color:#17344c}.lg-text small{display:block;font-size:9px;color:#8796a4}.legend-item b{font-size:12px;color:#0a2540}.panel{border:1px solid #e3e9ee;border-radius:14px;padding:12px;background:#fff;display:grid;gap:8px}.panel-head{display:flex;justify-content:space-between;align-items:center}.panel-head strong{font-size:13px;color:#0a2540}.close-sm{border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer}.breakdown{width:100%;border-collapse:collapse;font-size:12px}.breakdown td{padding:5px 0;border-bottom:1px solid #eef2f5}.breakdown td:last-child{text-align:right}.breakdown tfoot td{border:0;padding-top:8px}.breakdown .mini-input{width:120px}@media(max-width:900px){.seat-area{grid-template-columns:1fr}}@media(max-width:720px){.workflow,.target-grid{grid-template-columns:1fr}.section-head,.fallback-head{align-items:flex-start;flex-direction:column}.toolbar{align-items:stretch;flex-direction:column}.grid-2{grid-template-columns:1fr}.rules-head{align-items:flex-start;flex-direction:column}.modal-actions .spacer{display:none}.modal-actions .btn{flex:1}}
  `]
})
export class SeatPricingComponent{
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  private api=inject(ApiService);
  private toast=inject(ToastService);
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

  async reload(){this.error='';try{const [p,r,f,t,l]=await Promise.all([firstValueFrom(this.api.seatPricingProfiles()),firstValueFrom(this.api.getSeatPricingRules()),firstValueFrom(this.api.flights()),firstValueFrom(this.api.commercialTemplates({limit:200})),firstValueFrom(this.api.commercialAircraftLayouts())]);this.profiles=Array.isArray(p)?p:[];this.globalRules=Array.isArray(r)?r:[];this.flights=Array.isArray(f)?f:[];this.templates=Array.isArray(t)?t:(t?.items||[]);this.layouts=Array.isArray(l)?l:[];this.profilePage=1;this.rulePage=1}catch(e:any){this.error=this.msg(e,'Không tải được dữ liệu seat pricing.')}}
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
  async saveProfile(){if(!this.profileEditor)return;const e=this.profileEditor;if(!e.code?.trim()||!e.name?.trim()||!e.rules?.length){this.error='Cần nhập mã, tên và ít nhất một quy tắc phụ phí.';return}this.busy=true;this.error='';try{const payload={code:e.code.trim().toUpperCase(),name:e.name.trim(),description:e.description?.trim()||'',aircraft_type:String(e.aircraft_type||'ALL').toUpperCase(),is_active:!!e.is_active,rules:e.rules.map((r:any)=>({cabin_class:r.cabin_class,pricing_dimension:r.pricing_dimension,amount:Number(r.amount),priority:Number(r.priority||0)}))};if(this.editingProfileId){const {code,...body}=payload;await firstValueFrom(this.api.updateSeatPricingProfile(this.editingProfileId,body));this.message='Đã cập nhật Seat Pricing Profile và đồng bộ snapshot cho các target đang dùng.'}else{await firstValueFrom(this.api.createSeatPricingProfile(payload));this.message='Đã tạo Seat Pricing Profile.'}this.closeProfile();await this.reload()}catch(err:any){this.error=this.msg(err,'Không lưu được Seat Pricing Profile.')}finally{this.busy=false}}
  async removeProfile(){if(!this.editingProfileId)return;const confirmed=await this.toast.confirm({titleVi:'Xóa Seat Pricing Profile?',titleEn:'Delete Seat Pricing Profile?',messageVi:'Hồ sơ giá ghế này sẽ bị xóa khỏi hệ thống.',messageEn:'This seat pricing profile will be deleted from the system.',confirmVi:'Xóa',confirmEn:'Delete'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deleteSeatPricingProfile(this.editingProfileId));this.message='Đã xóa Seat Pricing Profile.';this.closeProfile();await this.reload()}catch(e:any){this.error=this.msg(e,'Không thể xóa profile đang được sử dụng.')}finally{this.busy=false}}
  openAssign(p:any){this.assignEditor=p;this.selectedFlightIds=[];this.selectedTemplateIds=[];this.error='';this.message=''}
  toggleTarget(list:string[],id:string,event:Event){const checked=(event.target as HTMLInputElement).checked;const i=list.indexOf(id);if(checked&&i<0)list.push(id);if(!checked&&i>=0)list.splice(i,1)}
  async assignProfile(){if(!this.assignEditor)return;this.busy=true;this.error='';try{const r=await firstValueFrom(this.api.assignSeatPricingProfile(this.assignEditor._id,{flight_ids:this.selectedFlightIds,template_ids:this.selectedTemplateIds}));const extra=r.inherited_flights_updated?(' và đồng bộ '+r.inherited_flights_updated+' dated flight'):'';this.message='Đã gán '+(r.flights_updated||0)+' chuyến, '+(r.templates_updated||0)+' template'+extra+'.';this.assignEditor=null;await this.reload()}catch(e:any){this.error=this.msg(e,'Không gán được Seat Pricing Profile.')}finally{this.busy=false}}

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
  feeText(cabin:string,d:string){const w=this.winner(cabin,d);return w?(Number(w.amount)?'+'+this.money(w.amount):'Miễn phí'):'—'}
  sourceText(cabin:string,d:string){const w=this.winner(cabin,d);if(!w)return 'Chưa có quy tắc – nhập số để tạo quy tắc mới cho hạng '+this.cabinLabel(cabin)+'.';return w.cabin_class==='ALL'?'Đang dùng quy tắc chung cho “Tất cả hạng” – sửa ở đây sẽ ảnh hưởng mọi hạng.':'Quy tắc riêng cho hạng '+this.cabinLabel(cabin)+'.'}
  setAmount(cabin:string,dim:string,v:any){const amount=Math.max(0,Number(v||0));const w=this.winner(cabin,dim);if(w){w.amount=amount;return}this.profileEditor.rules.push({cabin_class:cabin,pricing_dimension:dim,amount,priority:5})}
  removeRule(cabin:string,dim:string){const w=this.winner(cabin,dim);if(!w)return;const i=this.profileEditor.rules.indexOf(w);if(i>=0)this.profileEditor.rules.splice(i,1)}
  selectSeat(s:PreviewSeat){this.selectedSeat=s;this.typeEditor=null}
  openType(cabin:string,dim:string){this.typeEditor={cabin,dim};this.selectedSeat=null}
  dimColor(d:string){return({CABIN_BASE:'#e7edf2',WINDOW:'#bfe3f7',AISLE:'#cdeccf',MIDDLE:'#eef1f4',FRONT_ZONE:'#f9e0b0',EXIT_ROW:'#f6b9b0',EXTRA_LEGROOM:'#d7c8f3',BULKHEAD:'#f4d6e6'} as Record<string,string>)[d]||'#eef1f4'}
  aircraftName(a:string){const k=String(a||'ALL').toUpperCase();return k==='ALL'?'Mọi loại máy bay':(FLEET_LAYOUTS[k]?.model_name||this.layouts.find(l=>l.aircraft_type===k)?.model_name||k)}
  seatProfileCode(x:any){return x?.seat_pricing_profile_snapshot?.name||x?.seat_pricing_profile_snapshot?.code||'quy tắc mặc định'}
  cabinLabel(v:string){return({ALL:'Tất cả hạng',ECONOMY:'Phổ thông',CLUB:'Club',BUSINESS:'Thương gia',FIRST:'Hạng nhất'} as Record<string,string>)[v]||v}
  dimensionLabel(v:string){return({CABIN_BASE:'Phí cơ bản theo hạng',WINDOW:'Ghế cửa sổ',AISLE:'Ghế lối đi',MIDDLE:'Ghế giữa',FRONT_ZONE:'Khu vực phía trước',EXIT_ROW:'Hàng thoát hiểm',EXTRA_LEGROOM:'Chỗ để chân rộng',BULKHEAD:'Hàng vách ngăn'} as Record<string,string>)[v]||v}

  openNewGlobalRule(){this.editingGlobalRule=null;this.globalRuleEditor={rule_id:'',cabin_class:'ECONOMY',pricing_dimension:'WINDOW',amount:0,priority:0};this.error=''}
  openGlobalRule(r:any){this.editingGlobalRule=r;this.globalRuleEditor={rule_id:r.rule_id,cabin_class:r.cabin_class,pricing_dimension:r.pricing_dimension,amount:Number(r.amount||0),priority:Number(r.priority||0)};this.error=''}
  async saveGlobalRule(){const e=this.globalRuleEditor;if(!e)return;if(!this.editingGlobalRule&&!e.rule_id?.trim()){this.error='Mã rule là bắt buộc.';return}this.busy=true;this.error='';try{if(this.editingGlobalRule)await firstValueFrom(this.api.updateSeatPricingRule(this.editingGlobalRule.rule_id,{amount:Number(e.amount),priority:Number(e.priority)}));else await firstValueFrom(this.api.createSeatPricingRule({rule_id:e.rule_id.trim().toUpperCase(),cabin_class:e.cabin_class,pricing_dimension:e.pricing_dimension,amount:Number(e.amount),priority:Number(e.priority)}));this.message=this.editingGlobalRule?'Đã tạo version mới cho global rule.':'Đã tạo global rule.';this.globalRuleEditor=null;this.editingGlobalRule=null;await this.reload()}catch(err:any){this.error=this.msg(err,'Không lưu được global rule.')}finally{this.busy=false}}
  async deactivateGlobalRule(r:any){const confirmed=await this.toast.confirm({titleVi:'Tắt quy tắc?',titleEn:'Deactivate rule?',messageVi:'Tắt '+r.rule_id+'?',messageEn:'Deactivate '+r.rule_id+'?',confirmVi:'Tắt',confirmEn:'Deactivate'});if(!confirmed)return;this.busy=true;this.error='';try{await firstValueFrom(this.api.deleteSeatPricingRule(r.rule_id));this.message='Đã tắt '+r.rule_id+'.';await this.reload()}catch(e:any){this.error=this.msg(e,'Không tắt được rule.')}finally{this.busy=false}}
  /** A disabled rule that was replaced by an edited version (-Vn) cannot be turned back on. */
  get nextVersionLabel(){const r=this.editingGlobalRule;if(!r)return'';const v=Number(r.version||1)+1;return String(r.rule_id).replace(/-V\d+$/,'')+'-V'+v}
  isSuperseded(r:any){return this.globalRules.some(x=>x.supersedes_rule_id===r.rule_id)}
  async activateGlobalRule(r:any){this.busy=true;this.error='';try{await firstValueFrom(this.api.activateSeatPricingRule(r.rule_id));this.message='Đã bật lại '+r.rule_id+'.';await this.reload()}catch(e:any){this.error=this.msg(e,'Không bật lại được rule.')}finally{this.busy=false}}
  money(v:number){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v||0))}
  msg(e:any,f:string){const m=e?.error?.message;return Array.isArray(m)?m.join(' · '):m||e?.message||f}
}
