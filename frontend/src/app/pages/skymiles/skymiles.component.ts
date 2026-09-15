import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
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
            <span>Chương trình Khách hàng Thân thiết 5 Sao</span>
          </div>
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-black text-navy tracking-tight">
            Aptech SkyMiles Rewards
          </h1>
          <p class="text-sm sm:text-base text-slate-500 mt-3 leading-relaxed">
            Biến mỗi chuyến bay thành trải nghiệm đẳng cấp với đặc quyền miễn phí chọn ghế ngồi, ưu tiên quầy thủ tục và nâng hạng dịch vụ thương gia.
          </p>
        </div>

        <!-- Current User Status Card (If logged in) -->
        @if (auth.isAuthenticated()) {
          <div class="card-luxury p-6 sm:p-8 bg-gradient-to-r from-navy to-navy-light text-white shadow-xl mb-12 border-none relative overflow-hidden">
            <div class="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <span class="text-xs text-amber-400 font-bold tracking-widest uppercase block">Thẻ Hội viên Aptech SkyMiles</span>
                <h2 class="text-2xl font-bold mt-1">
                  {{ auth.currentUser()?.first_name }} {{ auth.currentUser()?.last_name }}
                </h2>
                <p class="text-xs text-slate-300 mt-0.5">Số tài khoản: APTECH-{{ auth.currentUser()?._id?.slice(-8)?.toUpperCase() }}</p>
              </div>

              <div class="flex items-center gap-4 bg-white/10 px-6 py-4 rounded-2xl border border-white/20 backdrop-blur-sm">
                <div class="w-12 h-12 rounded-full bg-gold text-navy flex items-center justify-center font-bold">
                  <app-icon name="award" class="w-6 h-6" />
                </div>
                <div>
                  <span class="text-xs text-slate-300 block">Số dặm thưởng tích lũy</span>
                  <span class="text-2xl font-black font-mono text-gold">
                    {{ auth.currentUser()?.sky_miles | number }} dặm
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
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider block">Hạng Khởi Đầu</span>
            <h3 class="text-xl font-bold text-navy mt-1">Silver Card (Thẻ Bạc)</h3>
            <p class="text-xs text-slate-500 mt-2">Dành cho hội viên mới tham gia chương trình.</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Tích lũy 100% dặm bay cơ bản</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Nhận ưu đãi giảm giá vé sinh nhật</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Đổi dặm lấy quà lưu niệm hàng không</span>
              </div>
            </div>
          </div>

          <!-- Gold Tier -->
          <div class="card-luxury p-6 border-amber-300 shadow-md relative bg-gradient-to-b from-amber-50/40 to-white">
            <div class="absolute -top-3 right-6 bg-gold text-navy font-bold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow">
              Phổ Biến Nhất
            </div>
            <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-gold flex items-center justify-center mb-4 font-bold border border-gold/40">
              <app-icon name="crown" class="w-6 h-6" />
            </div>
            <span class="text-xs font-bold text-amber-600 uppercase tracking-wider block">Từ 15.000 dặm</span>
            <h3 class="text-xl font-bold text-navy mt-1">Gold Card (Thẻ Vàng)</h3>
            <p class="text-xs text-slate-500 mt-2">Đặc quyền ưu tiên dành cho khách hàng bay thường xuyên.</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Cộng thêm 25% dặm thưởng mỗi chuyến bay</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Ưu tiên làm thủ tục tại quầy Check-in SkyPriority</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Miễn phí chọn chỗ ngồi ưa thích</span>
              </div>
            </div>
          </div>

          <!-- Platinum Tier -->
          <div class="card-luxury p-6 border-navy-light shadow-sm relative">
            <div class="w-12 h-12 rounded-2xl bg-navy text-gold flex items-center justify-center mb-4 font-bold">
              <app-icon name="shieldcheck" class="w-6 h-6" />
            </div>
            <span class="text-xs font-bold text-navy uppercase tracking-wider block">Từ 50.000 dặm</span>
            <h3 class="text-xl font-bold text-navy mt-1">Platinum VIP (Bạch Kim)</h3>
            <p class="text-xs text-slate-500 mt-2">Đẳng cấp tối thượng chuẩn hàng không 5 sao quốc tế.</p>
            <div class="mt-6 pt-6 border-t border-slate-100 space-y-3 text-xs">
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Cộng thêm 50% dặm thưởng mỗi chuyến bay</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Sử dụng Phòng chờ Thương gia (Lotus Lounge)</span>
              </div>
              <div class="flex items-center gap-2 text-slate-700">
                <app-icon name="checkcircle2" class="w-4 h-4 text-emerald-600" />
                <span>Thêm 20kg hành lý ký gửi miễn cước</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Interactive Miles Calculator -->
        <div class="card-luxury p-6 sm:p-8 max-w-2xl mx-auto shadow-lg border-slate-200">
          <h3 class="text-base font-bold text-navy flex items-center gap-2 mb-4">
            <app-icon name="plane" class="w-5 h-5 text-gold" />
            <span>Công cụ Dự tính Dặm Thưởng Tích Lũy</span>
          </h3>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-6">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Khoảng cách chặng bay (dặm)</label>
              <input
                type="number"
                [(ngModel)]="calcDistance"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-gold"
              />
              <span class="text-[10px] text-slate-400 mt-1 block">VD: Hà Nội - TP.HCM ~ 720 dặm</span>
            </div>

            <div>
              <label class="block font-semibold text-slate-600 mb-1">Hạng ghế đặt chỗ</label>
              <select
                [(ngModel)]="calcClass"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-gold"
              >
                <option value="ECONOMY">Phổ thông (100% dặm)</option>
                <option value="BUSINESS">Thương gia (150% dặm)</option>
                <option value="FIRST">Hạng nhất (200% dặm)</option>
              </select>
            </div>
          </div>

          <div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <div>
              <span class="text-xs text-amber-900 font-medium">Số dặm bạn sẽ tích lũy được:</span>
              <div class="text-2xl font-black font-mono text-navy mt-0.5">
                {{ calculatedMiles() | number }} dặm
              </div>
            </div>
            <a routerLink="/" class="btn-gold text-xs !py-2 !px-5 font-bold">
              Đặt vé ngay
            </a>
          </div>

        </div>

      </div>
    </div>
  `,
})
export class SkyMilesComponent {
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);

  calcDistance = 720;
  calcClass = 'ECONOMY';

  calculatedMiles(): number {
    let multiplier = 1.0;
    if (this.calcClass === 'BUSINESS') multiplier = 1.5;
    if (this.calcClass === 'FIRST') multiplier = 2.0;
    return Math.round(this.calcDistance * multiplier);
  }
}
