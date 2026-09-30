import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BookingStateService } from '../core/booking-state.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="container page">
      <div class="eyebrow">BƯỚC 2 / 4</div>
      <h1 class="title">Thông tin hành khách</h1>
      <p class="subtitle">Loại hành khách được giữ đúng theo tìm kiếm để giá và booking luôn nhất quán.</p>

      @for(p of passengers;track $index;let i=$index){
        <section class="card passenger">
          <div class="pass-head">
            <div>
              <h2>Hành khách {{i+1}}</h2>
              <small>{{typeHelp(p.passenger_type)}}</small>
            </div>
            <span class="pill pill-gold">{{typeLabel(p.passenger_type)}}</span>
          </div>
          <div class="grid grid-3">
            <div class="field"><span>Họ</span><input class="control" [(ngModel)]="p.first_name" autocomplete="family-name"></div>
            <div class="field"><span>Tên</span><input class="control" [(ngModel)]="p.last_name" autocomplete="given-name"></div>
            <div class="field locked-field"><span>Loại hành khách</span><strong>{{typeLabel(p.passenger_type)}}</strong><small>Được xác định từ bước tìm chuyến.</small></div>
            <div class="field"><span>CCCD / Passport</span><input class="control" [(ngModel)]="p.id_card_or_passport"></div>
            <div class="field"><span>Quốc tịch</span><input class="control" [(ngModel)]="p.nationality" autocomplete="country-name"></div>
            <div class="field"><span>Ngày sinh</span><input class="control" type="date" [(ngModel)]="p.date_of_birth" [max]="today"></div>
          </div>
        </section>
      }

      @if(error){<p class="error notice">{{error}}</p>}
      <div class="actions">
        <button class="btn btn-outline" (click)="back()">Quay lại</button>
        <button class="btn btn-primary" (click)="next()">Tiếp tục chọn ghế</button>
      </div>
    </div>
  `,
  styles: [`
    .passenger{padding:22px;margin-top:18px}
    .pass-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
    .pass-head h2{margin:0;color:#071b2e}
    .pass-head small{display:block;color:#718093;margin-top:5px;font-size:10px}
    .locked-field{background:#f5f8fa;border-radius:12px;padding:10px 12px}
    .locked-field strong{display:block;color:#17344c;margin-top:7px}
    .locked-field small{display:block;color:#7b8997;font-size:9px;margin-top:4px}
    .notice{margin-top:16px;padding:10px 13px;border-radius:12px;background:#fff0f0;border:1px solid #efcaca}
    .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
    @media(max-width:640px){.actions{flex-direction:column}.actions .btn{width:100%}}
  `]
})
export class PassengersComponent {
  state = inject(BookingStateService);
  router = inject(Router);
  passengers: any[] = [];
  error = '';
  today = this.localDate(new Date());

  constructor() {
    if (!this.state.selection()) {
      this.router.navigate(['/']);
      return;
    }

    const expected = this.expectedPassengerTypes();
    const existing = this.state.passengers();
    const existingTypes = existing.map(p => p.passenger_type);
    const canRestore = existing.length === expected.length && existingTypes.every((t, i) => t === expected[i]);

    this.passengers = canRestore
      ? existing.map(p => ({ ...p }))
      : expected.map(passenger_type => ({
          first_name: '',
          last_name: '',
          passenger_type,
          id_card_or_passport: '',
          nationality: 'Vietnam',
          date_of_birth: ''
        }));
  }

  typeLabel(type: string) {
    return type === 'ADULT' ? 'Người lớn' : type === 'CHILD' ? 'Trẻ em' : 'Cao tuổi';
  }

  typeHelp(type: string) {
    return type === 'ADULT' ? 'Adult' : type === 'CHILD' ? 'Child' : 'Senior citizen';
  }

  back() {
    this.state.passengers.set(this.passengers.map(p => ({ ...p })));
    this.router.navigate(['/results'], { queryParams: this.state.search() });
  }

  next() {
    this.error = '';
    if (this.passengers.some(p => !String(p.first_name || '').trim() || !String(p.last_name || '').trim())) {
      this.error = 'Vui lòng nhập họ tên cho tất cả hành khách.';
      return;
    }
    if (this.passengers.some(p => p.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth))) {
      this.error = 'Ngày sinh phải đúng định dạng YYYY-MM-DD.';
      return;
    }
    if (this.passengers.some(p => p.date_of_birth && p.date_of_birth > this.today)) {
      this.error = 'Ngày sinh không được nằm trong tương lai.';
      return;
    }

    this.state.passengers.set(this.passengers.map(p => ({
      ...p,
      first_name: String(p.first_name).trim(),
      last_name: String(p.last_name).trim(),
      id_card_or_passport: String(p.id_card_or_passport || '').trim(),
      nationality: String(p.nationality || '').trim()
    })));
    this.router.navigate(['/booking/seats']);
  }

  private expectedPassengerTypes() {
    const q = this.state.search();
    const result: string[] = [];
    for (let i = 0; i < Number(q?.adults ?? 1); i++) result.push('ADULT');
    for (let i = 0; i < Number(q?.children ?? 0); i++) result.push('CHILD');
    for (let i = 0; i < Number(q?.seniors ?? 0); i++) result.push('SENIOR');
    return result;
  }

  private localDate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
