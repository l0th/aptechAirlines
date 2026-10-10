import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { of } from 'rxjs';

// Bundle the real services for Node, while keeping Angular on its native runtime.
const outputDir = await mkdtemp(join(process.cwd(), 'node_modules', '.toast-i18n-test-'));
after(() => rm(outputDir, { recursive: true, force: true }));
const outfile = join(outputDir, 'services.mjs');
await build({
  stdin: {
    contents: "export { ToastService } from './src/app/core/toast.service.ts'; export { LanguageService } from './src/app/core/language.service.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'toast-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});

const { ToastService, LanguageService } = await import(pathToFileURL(outfile).href);

const componentOutfile = join(outputDir, 'components.mjs');
await build({
  stdin: {
    contents: "export { ReservationDeskComponent } from './src/app/admin/reservation-desk.component.ts'; export { ReviewComponent } from './src/app/pages/review.component.ts'; export { ResultsComponent } from './src/app/pages/results.component.ts'; export { SuccessComponent } from './src/app/pages/success.component.ts'; export { SeatsComponent } from './src/app/pages/seats.component.ts'; export { SeatOperationsComponent } from './src/app/admin/seat-operations.component.ts'; export { SeatPricingComponent } from './src/app/admin/seat-pricing.component.ts'; export { FarePricingComponent } from './src/app/admin/fare-pricing.component.ts'; export { CommercialComponent } from './src/app/admin/commercial.component.ts'; export { TripsComponent } from './src/app/pages/trips.component.ts'; export { explainPricing } from './src/app/admin/pricing/fare-calc.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'booking-label-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile: componentOutfile,
  logLevel: 'silent',
});
const { ReservationDeskComponent, ReviewComponent, ResultsComponent, SuccessComponent, SeatsComponent, SeatOperationsComponent, SeatPricingComponent, FarePricingComponent, CommercialComponent, TripsComponent, explainPricing } = await import(pathToFileURL(componentOutfile).href);

function createService() {
  const language = Object.create(LanguageService.prototype);
  language.language = signal('vi');
  const injector = Injector.create({ providers: [{ provide: LanguageService, useValue: language }] });
  const toast = runInInjectionContext(injector, () => new ToastService());
  return { toast, language };
}

test('explicit bilingual toast preserves each curated string and booking references', () => {
  const { toast } = createService();
  const copy = {
    titleVi: 'Cập nhật Search flights thành công',
    titleEn: 'Successfully updated Tìm chuyến',
    messageVi: 'Mô tả khách hàng: Search flights / BLK-123456',
    messageEn: 'Customer note: Tìm chuyến / BLK-123456',
  };
  toast.success(copy);
  const current = toast.current();
  for (const key of Object.keys(copy)) assert.equal(current[key], copy[key], key);
  toast.dismiss();
});

test('a legacy single-language API error gains a known translation without changing its booking code', () => {
  const { toast } = createService();
  toast.notifyError('No booking found with code BLK-123456');
  assert.equal(toast.current().messageVi, 'Không tìm thấy đặt chỗ với mã BLK-123456');
  assert.equal(toast.current().messageEn, 'No booking found with code BLK-123456');
  toast.dismiss();
});

test('single-language known UI copy is translated using the central dictionary', () => {
  const { toast } = createService();
  toast.notifyError('Không thể gửi mã xác nhận.');
  assert.equal(toast.current().messageVi, 'Không thể gửi mã xác nhận.');
  assert.equal(toast.current().messageEn, 'Unable to send the verification code.');
  toast.dismiss();
});

test('all toast variants render canonical dates as dd/mm/yyyy', () => {
  const { toast } = createService();
  toast.notifyError('Ngày khởi hành không được trước ngày hiện tại (2026-10-10).');
  assert.match(toast.current().messageVi, /10\/10\/2026/);
  assert.match(toast.current().messageEn, /10\/10\/2026/);
  assert.doesNotMatch(toast.current().messageVi, /2026-10-10/);
  toast.dismiss();

  toast.error({
    titleVi: 'Không thể đặt ngày 2026-10-09',
    titleEn: 'Cannot book 2026-10-09',
    messageVi: 'Định dạng nhập là YYYY-MM-DD.',
    messageEn: 'Input format is YYYY-MM-DD.',
  });
  assert.match(toast.current().titleVi, /09\/10\/2026/);
  assert.match(toast.current().titleEn, /09\/10\/2026/);
  assert.match(toast.current().messageVi, /dd\/mm\/yyyy/);
  assert.match(toast.current().messageEn, /dd\/mm\/yyyy/);
  toast.dismiss();
});

test('unrecognized free-form notices never partially rewrite customer notes or identifiers', () => {
  const { toast } = createService();
  const note = 'Booking CNF-007: customer wrote Search flights, Tìm chuyến';
  toast.notifySuccess(note);
  assert.equal(toast.current().messageVi, note);
  assert.equal(toast.current().messageEn, note);
  toast.dismiss();
});

test('toast language selection remains reactive after the toast is created', () => {
  const { toast, language } = createService();
  toast.success({ titleVi: 'Thành công', titleEn: 'Success' });
  assert.equal(language.pick(toast.current().titleVi, toast.current().titleEn), 'Thành công');
  language.language.set('en');
  assert.equal(language.pick(toast.current().titleVi, toast.current().titleEn), 'Success');
  toast.dismiss();
});

test('a missing message language uses known translation without rewriting its source text', () => {
  const { toast } = createService();
  toast.info({ titleVi: 'Trạng thái', titleEn: 'Status', messageEn: 'No booking found with code BLK-789' });
  assert.equal(toast.current().messageEn, 'No booking found with code BLK-789');
  assert.equal(toast.current().messageVi, 'Không tìm thấy đặt chỗ với mã BLK-789');
  toast.dismiss();
});

test('reschedule UI and error copy is available in both languages', () => {
  const { language } = createService();
  const rescheduleMessages = [
    ['Đặt chỗ hiện tại', 'Current booking'],
    ['Tìm chuyến thẳng và hành trình nối chuyến trong cửa sổ đặt vé 330 ngày.', 'Search direct and connecting itineraries within the 330-day booking window.'],
    ['Không tra cứu được đặt chỗ.', 'Unable to look up the booking.'],
    ['Chỉ đặt chỗ đã xác nhận mới được đổi chuyến.', 'Only a confirmed booking can be rescheduled.'],
    ['Vui lòng nhập mã xác nhận hoặc PNR.', 'Enter a confirmation number or PNR first.'],
    ['Chuyến bay này chưa có thông tin hạng vé phù hợp.', 'This flight has no matching fare inventory.'],
    ['Hành trình nối chuyến chưa có thông tin hạng vé phù hợp.', 'The connecting itinerary has no matching fare inventory.'],
    ['Phần chênh lệch được hoàn về nguồn thanh toán gốc của đặt chỗ; không cần nhập tài khoản hay thẻ mới tại đây.', 'The difference is refunded to the booking’s original payment source; no new bank account or card is required here.'],
    ['PayPal chưa được bật cho môi trường hiện tại.', 'PayPal is not enabled in this environment.'],
  ];
  for (const [vi, en] of rescheduleMessages) {
    assert.equal(language.translateNotice(vi, 'en'), en);
    assert.equal(language.translateNotice(en, 'vi'), vi);
  }
});

test('shared booking label helpers localize status, booking type and cabin without changing unknown codes', () => {
  const { language } = createService();
  assert.equal(language.bookingStatusLabel('CONFIRMED'), 'Đã xác nhận');
  assert.equal(language.bookingTypeLabel('ROUND_TRIP'), 'Khứ hồi');
  assert.equal(language.cabinLabel('BUSINESS'), 'Thương gia');
  assert.equal(language.passengerTypeLabel('SENIOR'), 'Cao tuổi');
  assert.equal(language.itineraryLegLabel('CONNECTING_2'), 'Đi · chặng 2');
  assert.equal(language.itineraryLegLabel('INBOUND_3'), 'Về · chặng 3');
  language.language.set('en');
  assert.equal(language.bookingStatusLabel('CONFIRMED'), 'Confirmed');
  assert.equal(language.bookingTypeLabel('ROUND_TRIP'), 'Round trip');
  assert.equal(language.cabinLabel('BUSINESS'), 'Business');
  assert.equal(language.passengerTypeLabel('SENIOR'), 'Senior');
  assert.equal(language.itineraryLegLabel('CONNECTING_2'), 'Outbound · leg 2');
  assert.equal(language.itineraryLegLabel('INBOUND_3'), 'Return · leg 3');
  assert.equal(language.bookingStatusLabel('UNRECOGNIZED'), 'UNRECOGNIZED');
});

test('staff reservation desk and review delegate booking labels to the same live language helper', () => {
  const { language } = createService();
  const desk = Object.create(ReservationDeskComponent.prototype);
  const review = Object.create(ReviewComponent.prototype);
  desk.language = language;
  review.language = language;

  assert.equal(desk.label('ECONOMY'), 'Phổ thông');
  assert.equal(desk.paxLabel('ADULT'), 'Người lớn');
  assert.equal(desk.statusLabel('BLOCKED'), 'Đang giữ chỗ');
  assert.equal(desk.typeLabel('ROUND_TRIP'), 'Khứ hồi');
  assert.equal(review.bookingTypeLabel('ROUND_TRIP'), 'Khứ hồi');
  assert.equal(review.passengerTypeLabel('SENIOR'), 'Cao tuổi');
  assert.equal(review.legLabel('CONNECTING_2'), 'Đi · chặng 2');

  language.language.set('en');
  assert.equal(desk.label('ECONOMY'), 'Economy');
  assert.equal(desk.paxLabel('ADULT'), 'Adult');
  assert.equal(desk.statusLabel('BLOCKED'), 'On hold');
  assert.equal(desk.typeLabel('ROUND_TRIP'), 'Round trip');
  assert.equal(review.bookingTypeLabel('ROUND_TRIP'), 'Round trip');
  assert.equal(review.passengerTypeLabel('SENIOR'), 'Senior');
  assert.equal(review.legLabel('CONNECTING_2'), 'Outbound · leg 2');
  assert.equal(review.bookingTypeLabel(), 'Itinerary');
  assert.equal(review.passengerTypeLabel(), 'Passenger');
  assert.equal(review.legLabel(''), 'Flight leg');
});

test('staff wizard steps and passenger seat summaries react to the selected language', () => {
  const { language } = createService();
  const desk = Object.create(ReservationDeskComponent.prototype);
  const review = Object.create(ReviewComponent.prototype);
  desk.language = language;
  review.language = language;
  review.state = {
    seatRequests: () => [
      { flight_id: 'FL-1', passenger_index: 0, selection_type: 'CHOOSE', seat_code: '12A' },
      { flight_id: 'FL-1', passenger_index: 1, selection_type: 'AUTO' },
    ],
  };

  assert.deepEqual(desk.stepLabels.map(s => s.label), ['Khách hàng', 'Chuyến bay', 'Hành khách & ghế', 'Giữ chỗ']);
  assert.equal(review.seatTextFor('FL-1'), 'HK1: 12A · HK2: Tự động');
  language.language.set('en');
  assert.deepEqual(desk.stepLabels.map(s => s.label), ['Customer', 'Flights', 'Passengers & seats', 'Hold']);
  assert.equal(review.seatTextFor('FL-1'), 'Passenger 1: 12A · Passenger 2: Automatic');
  assert.equal(review.seatTextFor('FL-2'), 'Automatic');
});

test('flight results and booking success use shared bilingual cabin and status copy', () => {
  const { language } = createService();
  const results = Object.create(ResultsComponent.prototype);
  const success = Object.create(SuccessComponent.prototype);
  results.language = language;
  success.language = language;
  success.booking = { status: 'BLOCKED', blocking_number: 'BLK-123456' };

  assert.equal(results.label('BUSINESS'), 'Thương gia');
  assert.equal(success.completionTitle, 'Đã giữ chỗ thành công');
  language.language.set('en');
  assert.equal(results.label('BUSINESS'), 'Business');
  assert.equal(results.label('CLUB'), 'Club');
  assert.equal(success.completionTitle, 'Booking held successfully');
  success.booking.status = 'CONFIRMED';
  assert.equal(success.completionTitle, 'Booking successful');
  assert.equal(success.booking.blocking_number, 'BLK-123456');
});

test('seat selection and staff seat operations share bilingual cabin and seat-status labels', () => {
  const { language } = createService();
  const seats = Object.create(SeatsComponent.prototype);
  const operations = Object.create(SeatOperationsComponent.prototype);
  seats.lang = language;
  operations.language = language;

  assert.equal(seats.cabinLabel('CLUB'), language.cabinLabel('CLUB'));
  assert.equal(seats.t('Ghế', 'Seat'), 'Ghế');
  assert.equal(operations.seatStatus('BLOCKED'), 'Đã khóa');
  assert.equal(operations.seatStatus('AVAILABLE'), 'Trống');
  assert.equal(operations.seatStatus('UNKNOWN'), 'UNKNOWN');

  language.language.set('en');
  assert.equal(seats.cabinLabel('CLUB'), language.cabinLabel('CLUB'));
  assert.equal(seats.cabinLabel('FIRST'), 'First class');
  assert.equal(seats.t('Ghế', 'Seat'), 'Seat');
  assert.equal(operations.seatStatus('BLOCKED'), 'Blocked');
  assert.equal(operations.seatStatus('HELD'), 'Held');
  assert.equal(operations.seatStatus('AVAILABLE'), 'Available');
  assert.equal(operations.seatStatus('UNKNOWN'), 'UNKNOWN');
});

test('staff seat pricing delegates cabin and fee dimension copy to shared language helpers', () => {
  const { language } = createService();
  const pricing = Object.create(SeatPricingComponent.prototype);
  pricing.language = language;
  pricing.profileEditor = { rules: [] };

  assert.equal(pricing.cabinLabel('ALL'), 'Tất cả hạng');
  assert.equal(pricing.cabinLabel('BUSINESS'), language.cabinLabel('BUSINESS'));
  assert.equal(pricing.dimensionLabel('EXIT_ROW'), 'Hàng thoát hiểm');
  assert.equal(pricing.dimensionLabel('UNKNOWN'), 'UNKNOWN');
  assert.match(pricing.sourceText('ECONOMY', 'WINDOW'), /Phổ thông/);
  language.language.set('en');
  assert.equal(pricing.cabinLabel('ALL'), 'All cabins');
  assert.equal(pricing.cabinLabel('BUSINESS'), 'Business');
  assert.equal(pricing.dimensionLabel('EXIT_ROW'), 'Exit row');
  assert.equal(pricing.dimensionLabel('EXTRA_LEGROOM'), 'Extra legroom');
  assert.match(pricing.sourceText('ECONOMY', 'WINDOW'), /Economy/);
  assert.doesNotMatch(pricing.sourceText('ECONOMY', 'WINDOW'), /Chưa có/);
});

test('seat pricing assignment success keeps flight and template counts bilingual without mixed-language copy', async () => {
  const { toast, language } = createService();
  const pricing = Object.create(SeatPricingComponent.prototype);
  pricing.toast = toast;
  pricing.__toast = toast;
  pricing.language = language;
  pricing.assignEditor = { _id: 'profile-1' };
  pricing.selectedFlightIds = ['flight-1'];
  pricing.selectedTemplateIds = ['template-1'];
  pricing.api = {
    assignSeatPricingProfile: () => of({ flights_updated: 1, templates_updated: 2, inherited_flights_updated: 3 }),
  };
  pricing.reload = async () => {};

  await pricing.assignProfile();
  assert.equal(toast.current()?.kind, 'success');
  assert.equal(toast.current()?.messageVi, 'Đã gán 1 chuyến bay, 2 lịch bay mẫu và đồng bộ 3 chuyến bay kế thừa.');
  assert.equal(toast.current()?.messageEn, 'Assigned 1 flight, 2 flight templates and synchronized 3 inherited flights.');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), toast.current().messageVi);
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), toast.current().messageEn);
  toast.dismiss();
});

test('seat pricing global rule creation and missing code errors have explicit VI/EN toasts', async () => {
  const { toast, language } = createService();
  const pricing = Object.create(SeatPricingComponent.prototype);
  pricing.toast = toast;
  pricing.__toast = toast;
  pricing.language = language;
  pricing.reload = async () => {};
  pricing.api = { createSeatPricingRule: () => of({}) };
  pricing.editingGlobalRule = null;
  pricing.globalRuleEditor = { rule_id: '  ', cabin_class: 'ECONOMY', pricing_dimension: 'WINDOW', amount: 50000, priority: 3 };

  await pricing.saveGlobalRule();
  assert.equal(toast.current()?.kind, 'error');
  assert.equal(toast.current()?.messageVi, 'Vui lòng nhập mã quy tắc.');
  assert.equal(toast.current()?.messageEn, 'Please enter a rule code.');
  pricing.globalRuleEditor.rule_id = 'ECO-WINDOW';
  await pricing.saveGlobalRule();
  assert.equal(toast.current()?.kind, 'success');
  assert.equal(toast.current()?.messageVi, 'Đã tạo quy tắc giá ghế mặc định.');
  assert.equal(toast.current()?.messageEn, 'Created the default seat pricing rule.');
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), 'Created the default seat pricing rule.');
  toast.dismiss();
});

test('seat pricing profile validation, creation and rule reactivation emit paired notices', async () => {
  const { toast, language } = createService();
  const pricing = Object.create(SeatPricingComponent.prototype);
  pricing.toast = toast;
  pricing.__toast = toast;
  pricing.language = language;
  pricing.reload = async () => {};
  pricing.api = {
    createSeatPricingProfile: () => of({}),
    activateSeatPricingRule: () => of({}),
  };
  pricing.editingProfileId = '';
  pricing.profileEditor = { code: '', name: '', rules: [] };

  await pricing.saveProfile();
  assert.equal(toast.current()?.kind, 'error');
  assert.equal(toast.current()?.messageVi, 'Nhập mã, tên và ít nhất một quy tắc phụ phí.');
  assert.equal(toast.current()?.messageEn, 'Enter a code, name and at least one seat fee rule.');

  pricing.profileEditor = {
    code: 'TEST-PROFILE', name: 'Test profile', rules: [
      { cabin_class: 'ECONOMY', pricing_dimension: 'WINDOW', amount: 50000, priority: 3 },
    ],
  };
  await pricing.saveProfile();
  assert.equal(toast.current()?.kind, 'success');
  assert.equal(toast.current()?.messageVi, 'Đã tạo hồ sơ giá ghế.');
  assert.equal(toast.current()?.messageEn, 'Created the seat pricing profile.');

  await pricing.activateGlobalRule({ rule_id: 'R-WINDOW' });
  assert.equal(toast.current()?.messageVi, 'Đã bật lại quy tắc R-WINDOW.');
  assert.equal(toast.current()?.messageEn, 'Reactivated rule R-WINDOW.');
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), 'Reactivated rule R-WINDOW.');
  toast.dismiss();
});

test('fare calculator uses localized step titles and rule labels but keeps pricing math unchanged', () => {
  const profile = {
    advance_rules: [{ min_days: 0, max_days: null, adjustment_percent: -5, label: 'Ưu đãi sớm', label_en: 'Early offer' }],
    load_factor_rules: [{ min_load_percent: 0, max_load_percent: 100, adjustment_percent: 10, label: 'Đông khách', label_en: 'High demand' }],
  };
  const vi = explainPricing(1500000, 45, 85, 22000, profile, 'vi');
  const en = explainPricing(1500000, 45, 85, 22000, profile, 'en');
  assert.equal(en.final, vi.final);
  assert.deepEqual(en.steps.map(step => step.percent), vi.steps.map(step => step.percent));
  assert.deepEqual(vi.steps.map(step => step.detail), ['Ưu đãi sớm', 'Đông khách', 'Hạng SILVER']);
  assert.deepEqual(en.steps.map(step => step.detail), ['Early offer', 'High demand', 'SILVER tier']);
  assert.deepEqual(en.steps.map(step => step.title), ['Booking timing', 'Load factor', 'SkyMiles membership tier']);
  const fallback = explainPricing(1000000, 90, 10, 0, null, 'en');
  assert.match(fallback.steps[0].detail, /system default/);
  assert.equal(fallback.steps[1].detail, 'Normal load (no matching threshold)');
  assert.equal(fallback.steps[2].detail, 'Regular member (no discount)');
});

test('fare pricing preview follows the shared current UI language', () => {
  const { language } = createService();
  const pricing = Object.create(FarePricingComponent.prototype);
  pricing.language = language;
  pricing.calc = { base: 1000000, days: 45, load: 70, miles: 0 };
  assert.equal(pricing.quote(null).steps[0].title, 'Theo thời điểm mua');
  language.language.set('en');
  assert.equal(pricing.quote(null).steps[0].title, 'Booking timing');
  assert.match(pricing.money(1500000), /1,500,000/);
});

test('fare pricing field and overlap validation switch languages without mutating rule data', () => {
  const { language } = createService();
  const pricing = Object.create(FarePricingComponent.prototype);
  pricing.language = language;
  const badAdvance = { min_days: -1, max_days: null, adjustment_percent: 0, label: 'Mua sớm', label_en: 'Early booking' };
  const badLoad = { min_load_percent: 40, max_load_percent: 40, adjustment_percent: 0, label: 'Tải chuẩn', label_en: 'Normal load' };
  pricing.form = {
    code: '', name: '',
    advance_rules: [badAdvance, { ...badAdvance, min_days: 0, max_days: 10 }],
    load_factor_rules: [badLoad, { ...badLoad, min_load_percent: 30, max_load_percent: 60 }],
  };
  const before = structuredClone(pricing.form);
  assert.equal(pricing.advanceRowError(badAdvance), 'Từ ngày phải là số ≥ 0');
  assert.equal(pricing.loadRowError(badLoad), 'Đến % phải lớn hơn Từ %');
  assert.match(pricing.validationErrors.join(' '), /Mốc ngày bị chồng nhau/);
  language.language.set('en');
  assert.equal(pricing.advanceRowError(badAdvance), 'From day must be a number ≥ 0');
  assert.equal(pricing.loadRowError(badLoad), 'To % must be greater than From %');
  const errors = pricing.validationErrors.join(' ');
  assert.match(errors, /Profile code is required/);
  assert.match(errors, /Profile name is required/);
  assert.match(errors, /Day tiers overlap/);
  assert.match(errors, /Load-factor tiers overlap/);
  assert.doesNotMatch(errors, /Mốc|Chưa nhập|bị chồng nhau/);
  assert.deepEqual(pricing.form, before);
});

test('fare pricing assignment sends separate Vietnamese and English success details', async () => {
  const { toast, language } = createService();
  const pricing = Object.create(FarePricingComponent.prototype);
  pricing.toast = toast;
  pricing.__toast = toast;
  pricing.language = language;
  pricing.assignProfileId = 'PROFILE-1';
  pricing.selectedFlightIds = ['F1'];
  pricing.selectedTemplateIds = ['T1'];
  pricing.api = { assignPricingProfile: () => of({ flights_updated: 1, templates_updated: 2, inherited_flights_updated: 3 }) };
  pricing.reload = async () => {};
  await pricing.assign();
  assert.equal(toast.current()?.kind, 'success');
  assert.equal(toast.current()?.messageVi, 'Đã áp dụng hồ sơ giá cho 1 chuyến bay, 2 lịch bay mẫu, 3 chuyến bay kế thừa từ lịch mẫu.');
  assert.equal(toast.current()?.messageEn, 'Applied the pricing profile to 1 flight, 2 flight templates, 3 inherited flights.');
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), toast.current().messageEn);
  toast.dismiss();
});

test('commercial network route labels switch VI/EN without changing API route identifiers', () => {
  const { language } = createService();
  const commercial = Object.create(CommercialComponent.prototype);
  commercial.language = language;
  const itinerary = { route_type: 'ONE_STOP', airports: ['SGN', 'SIN', 'NRT'] };
  assert.equal(commercial.routeType(itinerary.route_type), '1 điểm nối');
  assert.equal(commercial.networkStatus('NETWORK_DATA_INCOMPLETE'), 'Mạng đường bay thiếu dữ liệu');
  assert.equal(commercial.t('Chọn hành trình', 'Select an itinerary'), 'Chọn hành trình');
  language.language.set('en');
  assert.equal(commercial.routeType(itinerary.route_type), '1 stop');
  assert.equal(commercial.routeType('DIRECT'), 'Direct');
  assert.equal(commercial.routeType('TWO_STOP'), '2 stops');
  assert.equal(commercial.networkStatus('FOUND'), 'Itineraries found');
  assert.equal(commercial.networkStatus('NETWORK_DATA_INCOMPLETE'), 'Incomplete route network');
  assert.equal(commercial.networkStatus('UNRECOGNIZED_STATUS'), 'UNRECOGNIZED_STATUS');
  assert.equal(commercial.t('Chọn hành trình', 'Select an itinerary'), 'Select an itinerary');
  assert.equal(itinerary.route_type, 'ONE_STOP');
  assert.deepEqual(itinerary.airports, ['SGN', 'SIN', 'NRT']);
});

test('commercial search validation and no-results notifications use curated bilingual toasts', () => {
  const { toast, language } = createService();
  const commercial = Object.create(CommercialComponent.prototype);
  commercial.language = language;
  commercial.__toast = toast;
  commercial.origin = 'SGN';
  commercial.destination = 'SGN';
  commercial.departureDate = '2026-10-10';
  commercial.maxStops = 1;
  commercial.discover();
  assert.equal(toast.current()?.messageVi, 'Nơi đi và nơi đến phải khác nhau.');
  assert.equal(toast.current()?.messageEn, 'Origin and destination must be different.');

  let payload;
  commercial.destination = 'NRT';
  commercial.api = { discoverCommercialNetwork: (params) => { payload = params; return of({ itineraries: [] }); } };
  commercial.discover();
  assert.deepEqual(payload, { origin: 'SGN', destination: 'NRT', departure_date: '2026-10-10', max_stops: 1 });
  assert.equal(toast.current()?.kind, 'info');
  assert.match(toast.current()?.messageVi ?? '', /Không tìm thấy hành trình hợp lệ/);
  assert.match(toast.current()?.messageEn ?? '', /No eligible itinerary found/);
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), toast.current().messageVi);
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), toast.current().messageEn);
  toast.dismiss();
});

test('commercial journey publishing uses bilingual progress and totals without changing backend flight IDs', async () => {
  const { toast, language } = createService();
  const commercial = Object.create(CommercialComponent.prototype);
  commercial.language = language;
  commercial.__toast = toast;
  commercial.selectedItinerary = { legs: [{ source_key: 'S-1' }] };
  commercial.templates = [{ source_route_key: 'S-1', flight_number: 'APT231', _id: 'T-1' }];
  commercial.publishDays = 30;
  commercial.publishStart = '2026-10-20';
  commercial.publishProgress = [];
  let args;
  commercial.api = { materializeCommercialTemplate: (...values) => { args = values; return of({ inserted_count: 4, matched_count: 2 }); } };
  await commercial.publishJourney();
  assert.deepEqual(args, ['T-1', 30, '2026-10-20']);
  assert.equal(commercial.publishDone, true);
  assert.equal(commercial.publishProgress[0].flight, 'APT231');
  assert.equal(commercial.publishProgress[0].status, 'SUCCESS');
  assert.equal(commercial.progressStatus('SUCCESS'), 'Hoàn tất');
  assert.equal(commercial.publishProgress[0].detailVi, 'Đã thêm 4, đã có 2');
  assert.equal(commercial.publishProgress[0].detailEn, 'Inserted 4, existing 2');
  assert.equal(toast.current()?.messageVi, 'Đã phát hành toàn bộ hành trình trong khoảng 30 ngày.');
  assert.equal(toast.current()?.messageEn, 'Published the complete itinerary for the 30-day window.');
  language.language.set('en');
  assert.equal(commercial.progressStatus('SUCCESS'), 'Completed');
  assert.equal(language.pick(commercial.publishProgress[0].detailVi, commercial.publishProgress[0].detailEn), 'Inserted 4, existing 2');
  assert.equal(commercial.templates[0].flight_number, 'APT231');
  toast.dismiss();
});

test('commercial creation validation is bilingual and does not rewrite flight identifiers or seat inventory', () => {
  const { toast, language } = createService();
  const commercial = Object.create(CommercialComponent.prototype);
  commercial.language = language;
  commercial.__toast = toast;
  commercial.commercializingLeg = { source_key: 'SGN-HAN' };
  commercial.formFlightNumber = 'NOTAPT';
  commercial.formAircraft = 'A320';
  commercial.layouts = [{ aircraft_type: 'A320', supported_cabins: ['ECONOMY'], cabin_capacities: { ECONOMY: 150 } }];
  commercial.formCabins = { ECONOMY: true, BUSINESS: false, CLUB: false, FIRST: false };
  commercial.formSeats = { ECONOMY: 130, BUSINESS: null, CLUB: null, FIRST: null };
  commercial.formPrices = { ECONOMY: 750000, BUSINESS: null, CLUB: null, FIRST: null };
  commercial.allCabins = ['ECONOMY', 'BUSINESS', 'CLUB', 'FIRST'];

  assert.equal(commercial.buildCommercializePayload(), null);
  assert.equal(toast.current()?.messageVi, 'Mã chuyến phải bắt đầu bằng APT và chỉ gồm chữ/số, ví dụ APT231.');
  assert.equal(toast.current()?.messageEn, 'Flight number must start with APT and contain only letters/numbers, e.g. APT231.');
  commercial.formFlightNumber = 'APT231';
  const before = structuredClone(commercial.formSeats);
  language.language.set('en');
  const payload = commercial.buildCommercializePayload();
  assert.equal(payload.aptech_flight_number, 'APT231');
  assert.equal(payload.source_key, 'SGN-HAN');
  assert.deepEqual(payload.inventories, [{ cabin_class: 'ECONOMY', allocated_seats: 130 }]);
  assert.deepEqual(commercial.formSeats, before);
  toast.dismiss();
});

test('commercial template activation and single-flight generation retain bilingual notices and untouched codes', async () => {
  const { toast, language } = createService();
  const commercial = Object.create(CommercialComponent.prototype);
  commercial.language = language;
  commercial.__toast = toast;
  commercial.publishDays = 90;
  commercial.publishStart = '2026-10-20';
  commercial.refreshTemplates = async () => {};
  const template = { _id: 'T-1', flight_number: 'APT777', is_active: true };
  const calls = [];
  commercial.api = {
    setCommercialTemplateStatus: (...args) => { calls.push(['toggle', ...args]); return of({}); },
    materializeCommercialTemplate: (...args) => { calls.push(['generate', ...args]); return of({ inserted_count: 3, matched_count: 2 }); },
  };
  await commercial.toggle(template);
  assert.equal(toast.current()?.messageVi, 'Đã tắt APT777.');
  assert.equal(toast.current()?.messageEn, 'Deactivated APT777.');
  await commercial.materializeOne(template);
  assert.equal(toast.current()?.messageVi, 'APT777: đã thêm 3, đã có 2.');
  assert.equal(toast.current()?.messageEn, 'APT777: inserted 3, existing 2.');
  assert.deepEqual(calls, [['toggle', 'T-1', false], ['generate', 'T-1', 90, '2026-10-20']]);
  language.language.set('en');
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), 'APT777: inserted 3, existing 2.');
  assert.equal(template.flight_number, 'APT777');
  toast.dismiss();
});

test('my trips notices and date labels follow shared language helper without changing booking codes', () => {
  const { toast, language } = createService();
  const trips = Object.create(TripsComponent.prototype);
  trips.language = language;
  trips.__toast = toast;
  assert.equal(trips.t('Đổi vé', 'Reschedule'), 'Đổi vé');
  trips.successPair('Đã xác nhận vé. Mã xác nhận: CNF-123456.', 'Ticket confirmed. Confirmation: CNF-123456.');
  assert.equal(toast.current()?.messageVi, 'Đã xác nhận vé. Mã xác nhận: CNF-123456.');
  assert.equal(toast.current()?.messageEn, 'Ticket confirmed. Confirmation: CNF-123456.');
  const viDate = trips.dateTime('2026-10-29T08:00:00Z');
  assert.match(viDate, /^29\/10\/2026/);
  language.language.set('en');
  assert.equal(trips.t('Đổi vé', 'Reschedule'), 'Reschedule');
  assert.match(trips.dateTime('2026-10-29T08:00:00Z'), /^29\/10\/2026/);
  assert.equal(trips.dateTime('2026-10-29T08:00:00Z'), viDate);
  assert.equal(language.pick(toast.current().messageVi, toast.current().messageEn), 'Ticket confirmed. Confirmation: CNF-123456.');
  toast.dismiss();
});

test('confirmation button copy remains explicit and is not run through string replacements', async () => {
  const { toast } = createService();
  const pending = toast.confirm({
    titleVi: 'Xác nhận Search flights',
    titleEn: 'Confirm Tìm chuyến',
    confirmVi: 'Xóa',
    confirmEn: 'Delete',
    cancelVi: 'Hủy',
    cancelEn: 'Cancel',
  });
  assert.equal(toast.current().titleVi, 'Xác nhận Search flights');
  assert.equal(toast.current().titleEn, 'Confirm Tìm chuyến');
  assert.equal(toast.current().confirmVi, 'Xóa');
  assert.equal(toast.current().confirmEn, 'Delete');
  toast.reject();
  assert.equal(await pending, false);
});
