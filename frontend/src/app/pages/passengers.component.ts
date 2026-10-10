import { ToastService } from '../core/toast.service';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';
import { BookingStateService } from '../core/booking-state.service';
import { LanguageService } from '../core/language.service';
import { hasCitizenIdBirthYearMismatch, passengerTypeForBirthDate, vietnameseCitizenIdBirthYear } from '../core/passenger-profile.util';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="container page">
      <div class="eyebrow">{{lang.pick('BƯỚC 2 / 4','STEP 2 / 4')}}</div>
      <h1 class="title">{{lang.pick('Thông tin hành khách','Passenger details')}}</h1>
      <p class="subtitle">{{lang.pick('Loại hành khách được giữ đúng theo tìm kiếm để giá và booking luôn nhất quán.','Passenger types match your search so that fares and bookings stay consistent.')}}</p>

      @for(p of passengers;track $index;let i=$index){
        <section class="card passenger">
          <div class="pass-head">
            <div>
              <h2>{{lang.pick('Hành khách','Passenger')}} {{i+1}}</h2>
              <small>{{typeHelp(p.passenger_type)}}</small>
            </div>
            <span class="pill pill-gold">{{typeLabel(p.passenger_type)}}</span>
          </div>
          <div class="grid grid-3">
            <div class="field"><span>{{lang.pick('Họ','Family name')}}</span><input class="control" [(ngModel)]="p.first_name" (ngModelChange)="draftChanged()" autocomplete="family-name"></div>
            <div class="field"><span>{{lang.pick('Tên','Given name')}}</span><input class="control" [(ngModel)]="p.last_name" (ngModelChange)="draftChanged()" autocomplete="given-name"></div>
            <div class="field locked-field"><span>{{lang.pick('Loại hành khách','Passenger type')}}</span><strong>{{typeLabel(p.passenger_type)}}</strong><small>{{lang.pick('Được xác định từ bước tìm chuyến.','Determined by your flight search.')}}</small></div>
            <div class="field"><span>CCCD / Passport</span><input class="control" [(ngModel)]="p.id_card_or_passport" (ngModelChange)="draftChanged()" autocomplete="off"></div>
            <div class="field"><span>{{lang.pick('Quốc tịch','Nationality')}}</span><input class="control" [(ngModel)]="p.nationality" (ngModelChange)="draftChanged()" autocomplete="country-name"></div>
            <div class="field"><span>{{lang.pick('Ngày sinh','Date of birth')}}</span><input class="control" type="date" [(ngModel)]="p.date_of_birth" (ngModelChange)="draftChanged()" [max]="today"></div>
          </div>
          @if(i===primaryPassengerIndex&&auth.authenticated()&&!auth.staff()){
            <label class="save-profile"><input type="checkbox" [(ngModel)]="savePrimaryProfile"> <span><b>{{lang.pick('Lưu thông tin hành khách chính cho lần đặt sau','Save primary passenger details for future bookings')}}</b><small>{{lang.pick('Chỉ lưu CCCD/hộ chiếu, quốc tịch và ngày sinh vào hồ sơ khi bạn chọn mục này.','ID/passport, nationality and date of birth are saved to your profile only when selected.')}}</small></span></label>
          }
        </section>
      }

      
      <div class="actions">
        <button class="btn btn-outline" (click)="back()">{{lang.pick('Quay lại','Back')}}</button>
        <button class="btn btn-primary" (click)="next()" [disabled]="busy">{{busy?lang.pick('Đang lưu…','Saving…'):lang.pick('Tiếp tục chọn ghế','Continue to seat selection')}}</button>
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
    .save-profile{display:flex;gap:10px;align-items:flex-start;margin-top:16px;padding:13px 14px;border-radius:13px;background:#f6f9fb;border:1px solid #dfe8ee;cursor:pointer}.save-profile input{margin-top:3px}.save-profile span,.save-profile small{display:block}.save-profile b{color:#17344c;font-size:12px}.save-profile small{color:#718093;font-size:10px;line-height:1.5;margin-top:3px}
    .notice{margin-top:16px;padding:10px 13px;border-radius:12px;background:#fff0f0;border:1px solid #efcaca}
    .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
    @media(max-width:640px){.actions{flex-direction:column}.actions .btn{width:100%}}
  `]
})
export class PassengersComponent {
  readonly lang = inject(LanguageService);
  /** Validation/API messages are shown as global toasts instead of inline banners. */
  private __toast=inject(ToastService);
  state = inject(BookingStateService);
  auth = inject(AuthService);
  api = inject(ApiService);
  router = inject(Router);
  passengers: any[] = [];
  savePrimaryProfile = false;
  busy = false;
  private __error='';get error(){return this.__error}set error(v:string){this.__error=v;this.__toast.notifyError(v)};
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

    if (!canRestore) this.prefillPrimaryPassenger();
    this.draftChanged();
  }

  typeLabel(type: string) {
    return type === 'ADULT' ? this.lang.pick('Người lớn','Adult') : type === 'CHILD' ? this.lang.pick('Trẻ em','Child') : this.lang.pick('Cao tuổi','Senior');
  }

  typeHelp(type: string) {
    return type === 'ADULT' ? this.lang.pick('Người lớn (12–59 tuổi)','Adult (ages 12–59)') : type === 'CHILD' ? this.lang.pick('Trẻ em (2–11 tuổi)','Child (ages 2–11)') : this.lang.pick('Cao tuổi (từ 60 tuổi)','Senior (age 60+)');
  }

  back() {
    this.draftChanged();
    this.router.navigate(['/results'], { queryParams: this.state.search() });
  }

  next() {
    this.error = '';
    if (this.passengers.some(p => !String(p.first_name || '').trim() || !String(p.last_name || '').trim())) {
      this.error = this.lang.pick('Vui lòng nhập họ tên cho tất cả hành khách.','Enter the full name of every passenger.');
      return;
    }
    if (this.passengers.some(p => !p.date_of_birth)) {
      this.error = this.lang.pick('Vui lòng nhập ngày sinh cho tất cả hành khách để xác nhận đúng loại vé.','Enter the date of birth of every passenger to verify the correct fare category.');
      return;
    }
    if (this.passengers.some(p => p.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth))) {
      this.error = this.lang.pick('Ngày sinh phải đúng định dạng YYYY-MM-DD.','Date of birth must use YYYY-MM-DD format.');
      return;
    }
    if (this.passengers.some(p => p.date_of_birth && p.date_of_birth > this.today)) {
      this.error = this.lang.pick('Ngày sinh không được nằm trong tương lai.','Date of birth cannot be in the future.');
      return;
    }

    const invalidAgeIndex = this.passengers.findIndex(p => passengerTypeForBirthDate(p.date_of_birth, this.departureDate) !== p.passenger_type);
    if (invalidAgeIndex >= 0) {
      const passenger = this.passengers[invalidAgeIndex];
      const actualType = passengerTypeForBirthDate(passenger.date_of_birth, this.departureDate);
      if (actualType === 'INFANT') {
        this.error = this.lang.pick(`Hành khách ${invalidAgeIndex + 1} chưa đủ 2 tuổi vào ngày khởi hành. Luồng đặt vé hiện chưa hỗ trợ vé em bé.`,`Passenger ${invalidAgeIndex + 1} will be under 2 on the departure date. Infant fares are not supported by this booking flow yet.`);
      } else if (actualType) {
        this.error = this.lang.pick(`Hành khách ${invalidAgeIndex + 1} thuộc loại ${this.typeLabel(actualType)}, không khớp với loại ${this.typeLabel(passenger.passenger_type)} đã chọn. Vui lòng quay lại tìm chuyến và chọn đúng số lượng từng loại hành khách.`,`Passenger ${invalidAgeIndex + 1} is ${this.typeLabel(actualType)}, not the selected ${this.typeLabel(passenger.passenger_type)} category. Return to flight search and correct the passenger counts.`);
      } else {
        this.error = this.lang.pick(`Không thể xác định tuổi của hành khách ${invalidAgeIndex + 1} tại ngày khởi hành.`,`Unable to determine passenger ${invalidAgeIndex + 1}'s age on the departure date.`);
      }
      return;
    }

    const mismatch = this.passengers.find(p => hasCitizenIdBirthYearMismatch(p.id_card_or_passport, p.date_of_birth));
    if (mismatch) {
      const encodedYear = vietnameseCitizenIdBirthYear(mismatch.id_card_or_passport);
      this.error = this.lang.pick(`Năm sinh trong CCCD là ${encodedYear}, không khớp với ngày sinh đã chọn.`,`The Citizen ID encodes birth year ${encodedYear}, which does not match the selected date of birth.`);
      return;
    }

    const normalized = this.passengers.map(p => ({
      ...p,
      first_name: String(p.first_name).trim(),
      last_name: String(p.last_name).trim(),
      id_card_or_passport: String(p.id_card_or_passport || '').trim(),
      nationality: String(p.nationality || '').trim()
    }));
    this.state.passengers.set(normalized);

    if (this.savePrimaryProfile && this.auth.authenticated() && !this.auth.staff()) {
      const id = this.auth.user()?._id || this.auth.user()?.id;
      const primary = normalized[this.primaryPassengerIndex];
      if (id && primary) {
        this.busy = true;
        this.api.updateUser(id, {
          id_card_or_passport: primary.id_card_or_passport,
          nationality: primary.nationality,
          date_of_birth: primary.date_of_birth || '',
        }).subscribe({
          next: () => { this.busy = false; this.auth.refresh(); this.router.navigate(['/booking/seats']); },
          error: e => {
            this.busy = false;
            this.error = this.lang.translateNotice(Array.isArray(e?.error?.message) ? e.error.message.join(' · ') : (e?.error?.message || this.lang.pick('Không lưu được hồ sơ hành khách.','Unable to save the passenger profile.')));
          },
        });
        return;
      }
    }
    this.router.navigate(['/booking/seats']);
  }

  draftChanged() { this.state.passengers.set(this.passengers.map(p => ({ ...p }))); }

  get primaryPassengerIndex() { return this.passengers.findIndex(p => p.passenger_type === 'ADULT'); }

  get departureDate() {
    const selection = this.state.selection();
    const firstOutbound = selection?.outbound?.legs?.[0] || selection?.legs?.find((leg: any) => !String(leg?.leg_type || '').startsWith('INBOUND')) || selection?.legs?.[0];
    return String(firstOutbound?.departure_date || firstOutbound?.scheduled_departure_local || firstOutbound?.scheduled_departure || this.state.search()?.departure_date || '').slice(0, 10);
  }

  private expectedPassengerTypes() {
    const q = this.state.search();
    const result: string[] = [];
    for (let i = 0; i < Number(q?.adults ?? 1); i++) result.push('ADULT');
    for (let i = 0; i < Number(q?.children ?? 0); i++) result.push('CHILD');
    for (let i = 0; i < Number(q?.seniors ?? 0); i++) result.push('SENIOR');
    return result;
  }

  private prefillPrimaryPassenger() {
    const customer = this.auth.staff() ? this.state.staffCustomer() : this.auth.user();
    if (!customer) return;
    const index = this.passengers.findIndex(p => p.passenger_type === 'ADULT');
    if (index < 0) return;
    this.passengers[index] = {
      ...this.passengers[index],
      first_name: String(customer.first_name || '').trim(),
      last_name: String(customer.last_name || '').trim(),
      id_card_or_passport: String(customer.id_card_or_passport || '').trim(),
      nationality: String(customer.nationality || this.passengers[index].nationality || 'Vietnam').trim(),
      date_of_birth: String(customer.date_of_birth || '').slice(0,10),
    };
  }

  private localDate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
