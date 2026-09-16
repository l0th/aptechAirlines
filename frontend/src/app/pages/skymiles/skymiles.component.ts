import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../shared/services/toast.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-skymiles',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <div class="min-h-screen bg-slate-50 py-12">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <!-- Header -->
        <div class="text-center max-w-3xl mx-auto mb-16">
          <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy text-gold text-xs font-semibold mb-4 border border-gold/30 shadow-sm">
            <app-icon name="crown" class="w-4 h-4 text-gold" />
            <span>{{ lang.isVietnamese() ? 'Chương trình Khách hàng Thân thiết 5 Sao' : '5-Star Frequent Flyer Program' }}</span>
          </div>
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-black text-navy tracking-tight">
            Aptech SkyMiles Rewards
          </h1>
          <p class="text-sm sm:text-base text-slate-500 mt-3 leading-relaxed">
            {{ lang.isVietnamese() ? 'Biến mỗi chuyến bay thành trải nghiệm đẳng cấp với đặc quyền miễn phí chọn ghế ngồi, ưu tiên quầy thủ tục và nâng hạng dịch vụ thương gia.' : 'Turn every flight into a world-class experience with complimentary seat selection, priority check-in, and business class upgrades.' }}
          </p>
        </div>

        <!-- Member Area Tabs: SkyMiles / Profile -->
        <div class="flex justify-center mb-10">
          <div class="inline-flex bg-white p-1.5 rounded-full border border-slate-200 shadow-sm gap-1">
            <button
              type="button"
              (click)="activeTab.set('skymiles')"
              [class.bg-navy]="activeTab() === 'skymiles'"
              [class.text-gold]="activeTab() === 'skymiles'"
              [class.text-slate-500]="activeTab() !== 'skymiles'"
              class="px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 flex items-center gap-1.5 hover:text-gold"
            >
              <app-icon name="award" class="w-4 h-4" />
              <span>SkyMiles</span>
            </button>
            <button
              type="button"
              (click)="activeTab.set('profile')"
              [class.bg-navy]="activeTab() === 'profile'"
              [class.text-gold]="activeTab() === 'profile'"
              [class.text-slate-500]="activeTab() !== 'profile'"
              class="px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 flex items-center gap-1.5 hover:text-gold"
            >
              <app-icon name="user" class="w-4 h-4" />
              <span>{{ lang.t('profile.tabTitle') }}</span>
            </button>
          </div>
        </div>

        @if (activeTab() === 'profile') {
          <!-- ================= PROFILE PANEL (Spec 3.8) ================= -->
          @if (auth.isAuthenticated()) {
            <div class="max-w-4xl mx-auto space-y-6">

              <!-- Read-only Account Info -->
              <div class="card-luxury p-6 sm:p-8 shadow-sm border-slate-200">
                <h3 class="text-base font-bold text-navy flex items-center gap-2 border-b border-slate-100 pb-4 mb-5">
                  <app-icon name="shieldcheck" class="w-5 h-5 text-gold" />
                  <span>{{ lang.t('profile.accountInfo') }}</span>
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span class="block text-slate-500 font-semibold mb-1">{{ lang.t('profile.username') }}</span>
                    <span class="font-mono font-bold text-navy">{{ auth.currentUser()?.username }}</span>
                  </div>
                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span class="block text-slate-500 font-semibold mb-1">{{ lang.t('profile.email') }}</span>
                    <span class="font-medium text-navy break-all">{{ auth.currentUser()?.email }}</span>
                  </div>
                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span class="block text-slate-500 font-semibold mb-1">{{ lang.t('profile.role') }}</span>
                    <span class="inline-block bg-amber-100 text-amber-700 font-mono font-bold px-2 py-0.5 rounded">{{ auth.currentUser()?.role }}</span>
                  </div>
                  <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span class="block text-slate-500 font-semibold mb-1">{{ lang.t('profile.skyMiles') }}</span>
                    <span class="font-mono font-black text-amber-600">{{ auth.currentUser()?.sky_miles | number }}</span>
                  </div>
                </div>
                <p class="mt-4 text-[11px] text-slate-400 flex items-center gap-1.5">
                  <app-icon name="lock" class="w-3 h-3" />
                  {{ lang.t('profile.readOnlyNote') }}
                </p>
              </div>

              <!-- Editable Profile Form -->
              <div class="card-luxury p-6 sm:p-8 shadow-lg border-slate-200">
                <h3 class="text-base font-bold text-navy flex items-center gap-2 border-b border-slate-100 pb-4 mb-6">
                  <app-icon name="user" class="w-5 h-5 text-gold" />
                  <span>{{ lang.t('profile.editTitle') }}</span>
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('booking.lastName') }} <span class="text-rose-500">*</span></label>
                    <input
                      type="text"
                      [(ngModel)]="profileLastName"
                      class="w-full uppercase px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('booking.firstName') }} <span class="text-rose-500">*</span></label>
                    <input
                      type="text"
                      [(ngModel)]="profileFirstName"
                      class="w-full uppercase px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('profile.phone') }}</label>
                    <input
                      type="tel"
                      [(ngModel)]="profilePhone"
                      placeholder="09xx xxx xxx"
                      class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('profile.sex') }}</label>
                    <select
                      [(ngModel)]="profileSex"
                      class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                    >
                      <option value="MALE">{{ lang.t('profile.male') }}</option>
                      <option value="FEMALE">{{ lang.t('profile.female') }}</option>
                      <option value="OTHER">{{ lang.t('profile.other') }}</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('profile.age') }}</label>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      [(ngModel)]="profileAge"
                      class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div>
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('profile.creditCard') }}</label>
                    <input
                      type="text"
                      maxlength="19"
                      [(ngModel)]="profileCreditCard"
                      placeholder="4111 2222 3333 4444"
                      class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>

                  <div class="sm:col-span-2">
                    <label class="block font-semibold text-slate-600 mb-1">{{ lang.t('profile.address') }}</label>
                    <input
                      type="text"
                      [(ngModel)]="profileAddress"
                      [placeholder]="lang.t('profile.addressPlaceholder')"
                      class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold"
                    />
                  </div>
                </div>

                <div class="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    (click)="resetProfile()"
                    class="px-5 py-2.5 rounded-full border border-slate-300 text-xs font-bold text-slate-600 hover:border-navy hover:text-navy transition-colors flex items-center gap-1.5"
                  >
                    <app-icon name="refreshcw" class="w-4 h-4" />
                    <span>{{ lang.t('profile.reset') }}</span>
                  </button>
                  <button
                    type="button"
                    (click)="saveProfile()"
                    [disabled]="saving()"
                    class="btn-gold text-xs"
                  >
                    @if (saving()) {
                      <app-icon name="refreshcw" class="w-4 h-4 animate-spin" />
                      <span>{{ lang.t('common.loading') }}</span>
                    } @else {
                      <app-icon name="checkcircle2" class="w-4 h-4" />
                      <span>{{ lang.t('profile.save') }}</span>
                    }
                  </button>
                </div>
              </div>

            </div>
          } @else {
            <!-- Not logged in -->
            <div class="max-w-md mx-auto card-luxury p-10 text-center shadow-lg border-slate-200">
              <div class="w-14 h-14 rounded-full bg-navy text-gold flex items-center justify-center mx-auto mb-4">
                <app-icon name="lock" class="w-7 h-7" />
              </div>
              <h3 class="text-lg font-bold text-navy">{{ lang.t('profile.loginRequired') }}</h3>
              <p class="text-xs text-slate-500 mt-2">{{ lang.t('profile.loginRequiredDesc') }}</p>
            </div>
          }
        } @else {
        <!-- Current User Status Card (If logged in) -->
        @if (auth.isAuthenticated()) {
          <div class="card-luxury p-6 sm:p-8 bg-gradient-to-r from-navy to-navy-light text-white shadow-xl mb-12 border-none relative overflow-hidden">
            <div class="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <span class="text-xs text-amber-400 font-bold tracking-widest uppercase block">{{ lang.isVietnamese() ? 'Thẻ Hội viên Aptech SkyMiles' : 'Aptech SkyMiles Membership Card' }}</span>
                <h2 class="text-2xl font-bold mt-1">
                  {{ auth.currentUser()?.first_name }} {{ auth.currentUser()?.last_name }}
                </h2>
                <p class="text-xs text-slate-300 mt-0.5">{{ lang.isVietnamese() ? 'Số tài khoản: ' : 'Account No: ' }}APTECH-{{ auth.currentUser()?._id?.slice(-8)?.toUpperCase() }}</p>
              </div>

              <div class="flex items-center gap-4 bg-white/10 px-6 py-4 rounded-2xl border border-white/20 backdrop-blur-sm">
                <div class="w-12 h-12 rounded-full bg-gold text-navy flex items-center justify-center font-bold">
                  <app-icon name="award" class="w-6 h-6" />
                </div>
                <div>
                  <span class="text-xs text-slate-300 block">{{ lang.isVietnamese() ? 'Số dặm thưởng tích lũy' : 'Accumulated Bonus Miles' }}</span>
                  <span class="text-2xl font-black font-mono text-gold">
                    {{ auth.currentUser()?.sky_miles | number }} {{ lang.t('nav.miles') }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- Membership Tiers Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <!-- Silver Tier -->
          <div class="card-luxury p-6 border-slate-200 shadow-sm relative">
            <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4 font-bold border border-slate-300">
              <app-icon name="award" class="w-6 h-6" />
            </div>
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider block">{{ lang.isVietnamese() ? 'Hạng Khởi Đầu' : 'Entry Tier' }}</span>
            <h3 class="text-xl font-bold text-navy mt-1">{{ lang.isVietnamese() ? 'Silver Card (Thẻ Bạc)' : 'Silver Card' }}</h3>
            <p class="text-xs text-slate-500 mt-2">{{ lang.isVietnamese() ? 'Dành cho hội viên mới tham gia chương trình.' : 'For members newly joined the program.' }}</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Tích lũy 100% dặm bay cơ bản' : 'Earn 100% base flight miles' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Nhận ưu đãi giảm giá vé sinh nhật' : 'Receive birthday flight discounts' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Đổi dặm lấy quà lưu niệm hàng không' : 'Redeem miles for aviation souvenirs' }}</span>
              </div>
            </div>
          </div>

          <!-- Gold Tier -->
          <div class="card-luxury p-6 border-amber-300 shadow-md relative bg-gradient-to-b from-amber-50/40 to-white">
            <div class="absolute -top-3 right-6 bg-gold text-navy font-bold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow">
              {{ lang.isVietnamese() ? 'Phổ Biến Nhất' : 'Most Popular' }}
            </div>
            <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-gold flex items-center justify-center mb-4 font-bold border border-gold/40">
              <app-icon name="crown" class="w-6 h-6" />
            </div>
            <span class="text-xs font-bold text-amber-600 uppercase tracking-wider block">{{ lang.isVietnamese() ? 'Từ 15.000 dặm' : 'From 15,000 miles' }}</span>
            <h3 class="text-xl font-bold text-navy mt-1">{{ lang.isVietnamese() ? 'Gold Card (Thẻ Vàng)' : 'Gold Card' }}</h3>
            <p class="text-xs text-slate-500 mt-2">{{ lang.isVietnamese() ? 'Đặc quyền ưu tiên dành cho khách hàng bay thường xuyên.' : 'Priority privileges for frequent flyers.' }}</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Cộng thêm 25% dặm thưởng mỗi chuyến bay' : 'Earn 25% bonus miles on every flight' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Ưu tiên làm thủ tục tại quầy Check-in SkyPriority' : 'Priority SkyPriority check-in counters' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Miễn phí chọn chỗ ngồi ưa thích' : 'Complimentary preferred seat selection' }}</span>
              </div>
            </div>
          </div>

          <!-- Platinum Tier -->
          <div class="card-luxury p-6 border-navy-light shadow-sm relative">
            <div class="w-12 h-12 rounded-2xl bg-navy text-gold flex items-center justify-center mb-4 font-bold">
              <app-icon name="shieldcheck" class="w-6 h-6" />
            </div>
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">{{ lang.isVietnamese() ? 'Từ 50.000 dặm' : 'From 50,000 miles' }}</span>
            <h3 class="text-xl font-bold text-navy mt-1">{{ lang.isVietnamese() ? 'Platinum VIP (Bạch Kim)' : 'Platinum VIP' }}</h3>
            <p class="text-xs text-slate-500 mt-2">{{ lang.isVietnamese() ? 'Đẳng cấp tối thượng chuẩn hàng không 5 sao quốc tế.' : 'Ultimate 5-star international aviation luxury.' }}</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Cộng thêm 50% dặm thưởng mỗi chuyến bay' : 'Earn 50% bonus miles on every flight' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Sử dụng Phòng chờ Thương gia (Lotus Lounge)' : 'Access to Business Lounge (Lotus Lounge)' }}</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>{{ lang.isVietnamese() ? 'Thêm 20kg hành lý ký gửi miễn cước' : 'Additional 20kg complimentary checked baggage' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Interactive Miles Calculator -->
        <div class="card-luxury p-6 sm:p-8 max-w-2xl mx-auto shadow-lg border-slate-200">
          <h3 class="text-base font-bold text-navy flex items-center gap-2 mb-4">
            <app-icon name="plane" class="w-5 h-5 text-gold" />
            <span>{{ lang.isVietnamese() ? 'Công cụ Dự tính Dặm Thưởng Tích Lũy' : 'Bonus Miles Calculator' }}</span>
          </h3>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-6">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Khoảng cách chặng bay (dặm)' : 'Flight distance (miles)' }}</label>
              <input
                type="number"
                [(ngModel)]="calcDistance"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-gold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">{{ lang.isVietnamese() ? 'VD: Hà Nội - TP.HCM ~ 720 dặm' : 'E.g.: Hanoi - HCMC ~ 720 miles' }}</span>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ lang.isVietnamese() ? 'Hạng ghế đặt chỗ' : 'Booking Cabin Class' }}</label>
              <select
                [(ngModel)]="calcClass"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-gold"
              >
                <option value="ECONOMY">{{ lang.isVietnamese() ? 'Phổ thông (100% dặm)' : 'Economy (100% miles)' }}</option>
                <option value="BUSINESS">{{ lang.isVietnamese() ? 'Thương gia (150% dặm)' : 'Business (150% miles)' }}</option>
                <option value="FIRST">{{ lang.isVietnamese() ? 'Hạng nhất (200% dặm)' : 'First Class (200% miles)' }}</option>
              </select>
            </div>
          </div>

          <div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <div>
              <span class="text-xs text-amber-900 font-medium">{{ lang.isVietnamese() ? 'Số dặm bạn sẽ tích lũy được:' : 'Miles you will earn:' }}</span>
              <div class="text-2xl font-black font-mono text-navy mt-0.5">
                {{ calculatedMiles() | number }} {{ lang.t('nav.miles') }}
              </div>
            </div>
            <a routerLink="/" class="btn-gold text-xs !py-2 !px-5 font-bold">
              {{ lang.isVietnamese() ? 'Đặt vé ngay' : 'Book Now' }}
            </a>
          </div>

        </div>
        }
      </div>
    </div>
  `,
})
export class SkyMilesComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly activeTab = signal<'skymiles' | 'profile'>('skymiles');
  readonly saving = signal(false);

  calcDistance = 720;
  calcClass = 'ECONOMY';

  // Editable profile fields (spec 3.8: user can update them at any time)
  profileFirstName = '';
  profileLastName = '';
  profileAddress = '';
  profilePhone = '';
  profileSex = 'OTHER';
  profileAge: number | null = null;
  profileCreditCard = '';

  ngOnInit(): void {
    this.loadProfileFromUser();

    // Nếu người dùng đăng nhập SAU khi trang đã mở (hoặc hồ sơ được làm mới từ
    // server sau khi đặt vé), form hồ sơ phải tự nạp lại dữ liệu — trước đây form
    // chỉ nạp một lần trong ngOnInit nên bị trống.
    effect(() => {
      const user = this.auth.currentUser();
      if (user && !this.saving()) {
        untracked(() => this.loadProfileFromUser());
      }
    });
  }

  private loadProfileFromUser(): void {
    const u = this.auth.currentUser();
    if (!u) return;
    this.profileFirstName = u.first_name || '';
    this.profileLastName = u.last_name || '';
    this.profileAddress = u.address || '';
    this.profilePhone = u.phone_number || '';
    this.profileSex = u.sex || 'OTHER';
    this.profileAge = u.age ?? null;
    this.profileCreditCard = u.preferred_credit_card || '';
  }

  resetProfile(): void {
    this.loadProfileFromUser();
    this.toast.info(this.lang.t('profile.resetDone'));
  }

  saveProfile(): void {
    const u = this.auth.currentUser();
    if (!u?._id) {
      this.toast.warning(this.lang.t('profile.loginRequired'));
      return;
    }
    if (!this.profileFirstName.trim() || !this.profileLastName.trim()) {
      this.toast.warning(this.lang.t('profile.nameRequired'));
      return;
    }

    this.saving.set(true);
    const dto = {
      first_name: this.profileFirstName.trim(),
      last_name: this.profileLastName.trim(),
      address: this.profileAddress.trim(),
      phone_number: this.profilePhone.trim(),
      sex: this.profileSex,
      age: this.profileAge != null ? Number(this.profileAge) : undefined,
      preferred_credit_card: this.profileCreditCard.trim(),
    };

    this.api.updateUser(u._id, dto).subscribe({
      next: () => {
        this.saving.set(false);
        // Refresh the stored current user signal + localStorage
        this.auth.refreshProfile();
        this.toast.success(this.lang.t('profile.updateSuccess'));
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(
          err?.error?.message || this.lang.t('profile.updateError'),
        );
      },
    });
  }

  calculatedMiles(): number {
    let multiplier = 1.0;
    if (this.calcClass === 'BUSINESS') multiplier = 1.5;
    if (this.calcClass === 'FIRST') multiplier = 2.0;
    return Math.round(this.calcDistance * multiplier);
  }
}
