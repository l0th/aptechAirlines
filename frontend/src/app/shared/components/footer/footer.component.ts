import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <footer class="bg-navy text-slate-300 pt-16 pb-12 border-t border-slate-800 mt-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-10">
          <!-- Brand Column -->
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-navy shadow-md">
                <app-icon name="plane" class="w-5 h-5 text-navy" />
              </div>
              <span class="text-xl font-bold tracking-wider text-white">
                APTECH <span class="text-gold">AIRLINES</span>
              </span>
            </div>
            <p class="text-xs text-slate-400 leading-relaxed">
              {{ lang.t('nav.slogan') }}. Cam kết mang đến trải nghiệm hành trình bay chuẩn quốc tế 5 sao, an toàn tuyệt đối và tiện nghi đẳng cấp.
            </p>
            <div class="flex items-center gap-2 pt-2 text-xs text-amber-400 font-semibold">
              <app-icon name="shieldcheck" class="w-4 h-4 text-gold" />
              <span>Chứng chỉ An toàn Bay Quốc tế IATA</span>
            </div>
          </div>

          <!-- Quick Links -->
          <div>
            <h4 class="text-white font-bold text-sm uppercase tracking-wider mb-4 border-b border-slate-700 pb-2">
              Dịch vụ Bay
            </h4>
            <ul class="space-y-2 text-xs">
              <li><a href="/" class="hover:text-gold transition-colors">Tìm & Đặt vé máy bay</a></li>
              <li><a href="/track" class="hover:text-gold transition-colors">Tra cứu mã PNR / Vé</a></li>
              <li><a href="/track" class="hover:text-gold transition-colors">Đổi chuyến & Hủy vé</a></li>
              <li><a href="/skymiles" class="hover:text-gold transition-colors">Chương trình SkyMiles</a></li>
            </ul>
          </div>

          <!-- Travel Policies -->
          <div>
            <h4 class="text-white font-bold text-sm uppercase tracking-wider mb-4 border-b border-slate-700 pb-2">
              Chính sách & Quy định
            </h4>
            <ul class="space-y-2 text-xs">
              <li><a href="/track" class="hover:text-gold transition-colors">Quy định hoàn vé & Giữ chỗ</a></li>
              <li><a href="/" class="hover:text-gold transition-colors">Tiêu chuẩn hành lý xách tay</a></li>
              <li><a href="/" class="hover:text-gold transition-colors">Điều kiện ghế thoát hiểm</a></li>
              <li><a href="/" class="hover:text-gold transition-colors">Chính sách bảo mật thông tin</a></li>
            </ul>
          </div>

          <!-- Contact & Support -->
          <div>
            <h4 class="text-white font-bold text-sm uppercase tracking-wider mb-4 border-b border-slate-700 pb-2">
              Hỗ trợ 24/7
            </h4>
            <div class="space-y-3 text-xs">
              <div class="flex items-center gap-2">
                <app-icon name="clock" class="w-4 h-4 text-gold" />
                <span>Tổng đài Chăm sóc Khách hàng: 1900-APTECH</span>
              </div>
              <div class="flex items-center gap-2">
                <app-icon name="mappin" class="w-4 h-4 text-gold" />
                <span>Trụ sở: Tòa nhà Aptech Aviation, Hà Nội</span>
              </div>
              <div class="pt-2 text-[11px] text-slate-400">
                Email: support&#64;aptechairlines.vn
              </div>
            </div>
          </div>
        </div>

        <div class="mt-12 pt-8 border-t border-slate-800 text-center text-xs text-slate-400">
          <p>© 2026 Aptech Airlines Reservation System. Toàn bộ bản quyền được bảo lưu.</p>
        </div>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  readonly lang = inject(LanguageService);
}
