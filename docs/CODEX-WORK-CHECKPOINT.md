# Codex Work Checkpoint

Ngày cập nhật: 2026-09-29
Branch hiện tại: `main`

## Quy tắc làm việc

- Chia công việc thành checkpoint nhỏ, verify xong mới sang checkpoint kế tiếp.
- Sau mỗi checkpoint cập nhật file này để phiên sau tiếp tục đúng chỗ.
- Trước khi kết thúc mỗi phiên làm việc hoặc trước khi dừng ở một checkpoint, bắt buộc cập nhật file `.md` này làm handoff cho phiên sau.
- Mỗi lần cập nhật phải ghi rõ: đang làm gì, vừa làm xong gì, file nào đã sửa, lệnh build/test đã chạy và kết quả, lỗi/rủi ro còn lại, trạng thái commit/push, và bước tiếp theo chính xác để bắt đầu lại.
- Nếu phiên bị lỗi, ngắt, context quá dài hoặc phải mở chat mới, phiên kế tiếp phải đọc file này trước rồi tiếp tục từ mục "Bước bắt đầu cho phiên/checkpoint kế tiếp"; không làm lại từ đầu nếu checkpoint trước đã được xác nhận hoàn thành.
- Không commit/push nếu user chưa yêu cầu.
- Không reset/revert rộng vì working tree đang có nhiều thay đổi chưa commit của đợt rebuild lớn.
- Các `*.service.ts` backend nên giữ dưới khoảng 1000 dòng và tách theo trách nhiệm nghiệp vụ.

## Checkpoint A - Backend service refactor - HOÀN THÀNH

- `FlightsService` đã tách thành facade + các service chuyên trách.
- `BookingsService` đã tách theo Create, Confirm, Reschedule, Cancellation, Query/Refund, Quote, PayPal.
- `BookingsService` hiện khoảng 936 dòng.
- Service lớn nhất hiện tại khoảng 944 dòng; không còn `*.service.ts` backend trên 1000 dòng.
- Backend build: PASS.
- Regression booking/PayPal: 270/270 tests PASS.
- `git diff --check` cho phần booking: PASS.
- Chưa commit/push.

## Checkpoint B1 - Frontend production build - HOÀN THÀNH

Mục tiêu: xác nhận frontend rebuild hiện tại compile được trước khi walkthrough Customer flow.

Kết quả:

- `npm run build` trực tiếp trước đó không chạy được vì local `frontend/node_modules/.bin/ng` chưa tồn tại.
- Docker Buildx cần ghi metadata vào `~/.docker/buildx/activity`; quyền mở rộng đã được cấp trong phiên này.
- Chạy `docker compose build frontend`: PASS.
- Image tạo thành công: `aptechairline-frontend:latest`.
- `frontend/.dockerignore` chỉ bỏ `node_modules`, `dist`, `.git`, `.gitignore`, `npm-debug.log`; source Angular không bị loại khỏi build context.
- `git diff --check -- frontend`: PASS.
- Checkpoint này không sửa source frontend.

## Checkpoint B2.1 - Home/Search -> Results - HOÀN THÀNH

Phạm vi đã rà:

- One-way và round-trip selection flow.
- Direct + connecting results.
- Flexible departure date range (`departure_date_end`).
- Return-date validation so với ngày outbound cuối cùng.
- Passenger counts/cabin được truyền sang search API.
- Giá, ghế còn lại và inventory selection cho direct/connecting.

Sửa trong checkpoint này:

- `frontend/src/app/pages/results.component.ts`
  - Khi user đã chọn chiều về rồi đổi sang một outbound option khác, UI giờ xóa `selectedInbound` cũ để tránh tiếp tục với cặp hành trình stale/không còn phù hợp.
  - Dùng `optionKey()` dựa trên `flight_id + inventory_id` để nhận biết outbound thực sự thay đổi.
- `frontend/src/app/pages/home.component.ts`
  - Fallback `minDate` và `maxDate` đổi sang local calendar date thay vì `toISOString()` UTC, tránh lệch ngày theo timezone Việt Nam nếu API booking-window không phản hồi.

Verify:

- `npx jest src/flights/flights.service.spec.ts --runInBand`: **52/52 PASS**.
- Các test này bao phủ direct/connecting, round-trip, inclusive date range, invalid date range, return date, multi-date connecting, overnight connection và duplicate route handling.
- Docker frontend image mới được tạo lúc `2026-09-29T08:43:34+07:00`.
- `docker history aptechairline-frontend:latest` xác nhận image mới copy output từ `/app/dist/frontend/browser`, tức Angular production build đã hoàn tất trước khi image final được tạo.
- `git diff --check` không báo whitespace error cho các file tracked; các file UI rebuild hiện vẫn là untracked trong working tree nên Git không đưa chúng vào diff thông thường.
- Chưa commit/push.

Rủi ro/còn lại:

- Chưa có browser automation tool trong phiên này, nên B2.1 được verify bằng source review + backend search regression + Angular production build, chưa có click-through browser acceptance.

## Checkpoint B2.2 - Results -> Passenger state/payload - HOÀN THÀNH

Phạm vi đã rà:

- `ResultsComponent.commit()` cho one-way direct, one-way connecting và round-trip.
- `booking_type`: `ONE_WAY`, `CONNECTING`, `ROUND_TRIP` khớp `BookingType` backend.
- Direct leg dùng `OUTBOUND` / `INBOUND`; connecting outbound dùng `CONNECTING_1..N`; connecting return dùng `INBOUND_1..N`, phù hợp logic `validateRoundTripLegs()` backend.
- `flight_id` + `inventory_id` được normalize trước khi vào `BookingStateService.buildPayload()`.
- Passenger composition từ search được tạo đúng thứ tự ADULT -> CHILD -> SENIOR.
- Payload frontend khớp `CreateBookingDto`: `user_id`, `booking_type`, `is_block`, `passengers`, `legs`, `seat_requests`, optional `payment_method`.
- DOB rỗng được backend chấp nhận theo `isValidDateOfBirthString()`.

Lỗi phát hiện và đã sửa:

- Trước đây Passenger -> `Quay lại` Results -> chọn lại chuyến sẽ mất toàn bộ thông tin hành khách vì `ResultsComponent.commit()` luôn `passengers.set([])`.
- Results cũng không restore outbound/inbound selection cũ khi quay lại từ Passenger.
- Quote cũ có thể còn trong state sau khi đổi itinerary.

Sửa trong checkpoint này:

- `frontend/src/app/core/booking-state.service.ts`
  - Thêm `beginSearch(search)` để một search mới xóa selection/passengers/seats/quote nhưng **không xóa `staffCustomer`**.
- `frontend/src/app/pages/home.component.ts`
  - Dùng `state.beginSearch(q)` thay vì chỉ `state.search.set(q)`.
- `frontend/src/app/pages/results.component.ts`
  - Restore selection khi quay lại Results nếu query hiện tại khớp search state.
  - Giữ passenger data khi composition ADULT/CHILD/SENIOR không đổi.
  - Vẫn xóa seat requests/seat fee khi itinerary được commit lại.
  - Xóa stale quote khi itinerary thay đổi/được commit lại.
  - `isChosen()` cho connecting route giờ so theo flight sequence thay vì object identity, nên lựa chọn cũ hiển thị đúng sau khi Results reload data.

Verify:

- `npx jest src/bookings/bookings.service.spec.ts --runInBand`: **117/117 PASS**.
- Docker frontend image mới được tạo lúc `2026-09-29T08:48:59+07:00`, image id bắt đầu `82cf63d...`.
- `docker history aptechairline-frontend:latest` xác nhận image mới copy `/app/dist/frontend/browser`, tức Angular production build đã hoàn tất thành công.
- Chưa commit/push.

Rủi ro/còn lại:

- Chưa có browser automation click-through trong phiên này; verify hiện dựa trên source review + backend booking regression + production Angular build.

## Continuous completion pass - 2026-09-29 - HOÀN THÀNH

User yêu cầu phiên này làm liền một mạch thay vì dừng sau từng checkpoint. Toàn bộ các phần còn lại của Customer flow, lifecycle, Staff/Admin, AirLabs/commercial, seat/payment và regression đã được rà liên tục.

### Customer booking + lifecycle

- Seat page đồng bộ lại phụ phí authoritative từ seat-map vào `seat_requests` khi load/cache; AUTO luôn giữ fee = 0. Việc quay từ Review về Seats không còn làm mất fee đã chọn.
- Review có nút quay lại chọn ghế; nhãn hành khách ghế sắp theo `passenger_index` ổn định.
- Success reset `BookingStateService` sau khi giữ lại kết quả booking, tránh state booking/staff-customer cũ rò sang giao dịch tiếp theo.
- My Trips yêu cầu auth; Track/Trips/Reschedule đều chặn PayPal đối với staff, phù hợp `StrictCustomerGuard` backend.
- Reschedule dùng local calendar date fallback, horizon fallback +330 ngày, chặn return date trước outbound date; staff chỉ dùng profile-card flow.
- Hold, confirm, cancel/refund, reschedule và PayPal customer flow đã đối chiếu với backend contracts/tests.

### Staff/Admin

- Reservation Desk đã đối chiếu CUSTOMER selection và `user_id` staff-on-behalf-of-customer contract.
- Khôi phục `/admin/seat-operations` theo Interface Design Document:
  - xem enriched seat map theo flight + aircraft,
  - khóa/mở ghế với `BLOCKED_MAINTENANCE`, `CREW_REST`, `VIP_HOLD`,
  - set/remove per-flight seat price override,
  - CLERK/ADMIN/SUPER_ADMIN dùng được theo backend role guard.
- Generic admin list đã khôi phục các thao tác bị mất trong UI rebuild:
  - Users: create/update/delete, bảo vệ SUPER_ADMIN theo backend.
  - Airports: create/update/delete.
  - Flights: create/update/delete và emergency status update; AirLabs-commercial edit chỉ sửa lịch vận hành để bảo toàn inventory/provenance.
  - Bookings: detail, confirm hold bằng profile card, cancel, admin manual reminder/expiry scheduler.
- Thêm route tương thích tài liệu: `/admin/dashboard`, `/admin/analytics`, `/admin/commercial-flights` bên cạnh route UI mới hiện hành.
- Policies, Commercial, Seat Pricing và Reservation Desk vẫn giữ workflow mutation riêng đã rebuild.

### AirLabs / commercial / 330-day

- Frontend commercial payload đã đối chiếu DTO backend: `source_key`, APT flight number, aircraft layout, cabin inventories/base price.
- Customer-bookable invariant vẫn là `operator=APTECH_AIRLINES`, `is_bookable=true`, `data_source=AIRLABS_COMMERCIALIZED`.
- UI commercial giữ lựa chọn horizon tối đa 330 ngày; Home/Reschedule fallback cũng giữ +330 ngày.
- Direct + connecting network discovery/materialization và daily horizon maintenance được bao phủ bởi full backend regression.

### Seat/payment rules

- Seat-map `rows[].column_groups` khớp horizontal seat UI hiện tại.
- Pricing tiếp tục dùng dynamic/additive backend rules; không hardcode lại bảng tier cũ.
- PayPal chỉ hiển thị/thực thi ở customer checkout; staff checkout/reschedule/hold-confirm dùng profile card.
- Không còn smoking option trong UI; admin flight payload chỉ gửi `is_smoking:false` để tương thích schema cũ.

### Source files sửa trong continuous pass

- `frontend/src/app/pages/seats.component.ts`
- `frontend/src/app/pages/review.component.ts`
- `frontend/src/app/pages/success.component.ts`
- `frontend/src/app/pages/reschedule.component.ts`
- `frontend/src/app/pages/trips.component.ts`
- `frontend/src/app/pages/track.component.ts`
- `frontend/src/app/admin/commercial.component.ts`
- `frontend/src/app/admin/seat-operations.component.ts` (new rebuild component)
- `frontend/src/app/admin/list-pages.component.ts`
- `frontend/src/app/admin/admin-shell.component.ts`
- `frontend/src/app/core/api.service.ts`
- `frontend/src/app/app.routes.ts`

### Verification cuối cùng

- Backend `npm run build`: **PASS**.
- Full backend Jest với isolated MongoDB local + test JWT env: **33/33 suites, 790/790 tests PASS**.
- Trước full suite đã chạy focused booking/flights/seat-pricing/commercial/PayPal/scheduler groups: **430/430 PASS**.
- Frontend `docker compose build --no-cache frontend`: **PASS**; Angular production bundle được compile thật từ source hiện tại và image `aptechairline-frontend:latest` được tạo thành công.
- `git diff --check`: **PASS**.
- Backend service-size audit: không có `*.service.ts` trên 1000 dòng; lớn nhất hiện tại `bookings-reschedule-direct.service.ts` khoảng **944 dòng**.
- Full test lần đầu trong sandbox mặc định bị local-loopback `EPERM 127.0.0.1:27018`; chạy lại bằng quyền network local với Mongo test đang hoạt động cho kết quả 790/790 PASS. Đây là giới hạn sandbox, không phải lỗi code/Mongo.
- Các ERROR/WARN xuất hiện trong Jest output là expected mocked recovery/compensation scenarios và không làm suite fail.

### Trạng thái hiện tại / handoff

- Không commit.
- Không push.
- Working tree vẫn chứa toàn bộ đợt rebuild lớn và backend refactor chưa commit; không reset/revert rộng.
- Không có Playwright/Chromium/browser automation package trong workspace, nên acceptance hiện dựa trên source/contract review + full backend regression + Angular production build, chưa claim live browser click-through.
- Nếu phiên sau tiếp tục, bắt đầu bằng kiểm tra `git status` và đọc section này; không cần quay lại B2.3 hay chạy lại các phase đã PASS trừ khi source tiếp tục thay đổi.

## Pre-push classroom handoff - 2026-10-02

- Branch thực tế hiện tại: `frontend-v2`, đồng bộ với `origin/frontend-v2` trước khi commit (`ahead 0 / behind 0`).
- Đã sửa regression test bị phụ thuộc ngày 2026-10-01 bằng cách freeze clock trong 3 flight spec suites; focused flight regression: **118/118 PASS**.
- Backend `npm run build`: **PASS**.
- Full backend Jest với Mongo local `127.0.0.1:27018` + test JWT env: **34/34 suites, 791/791 PASS**.
- Frontend host `ng build` thoát mã 134 trên Node host hiện tại, nhưng production build đúng runtime dự án bằng `docker compose build frontend`: **PASS**; image `aptechairline-frontend:latest` được tạo thành công.
- `git diff --check`: **PASS**.
- Đã thêm `docs/CLASSROOM-TEST-CHECKLIST.md` để bạn cùng lớp có thể test Guest -> Customer -> Clerk -> Admin -> quay lại Customer theo yêu cầu 1, 2, 3.1-3.10.
- Tại thời điểm ghi checkpoint này chưa commit/push; bước tiếp theo chính xác là stage toàn bộ source/project docs hợp lệ, loại các file local không thuộc source (`node_modules` symlink, RTF/RTFD ghi chú phiên), commit trên `frontend-v2`, push `origin/frontend-v2`, rồi xác nhận HEAD và ahead/behind.

## UI / flow regression continuation - 2026-10-02

- Branch vẫn là `frontend-v2`; không reset/revert và không commit/push trong phiên này.
- Live Playwright smoke test trên app local:
  - Guest homepage + public lookup: PASS, không console/page error, desktop không horizontal overflow.
  - CLERK `e2e_clerk`: login PASS, Reservation Desk render PASS, truy cập `/admin/users` bị chặn/redirect đúng.
  - ADMIN `e2e_admin`: login PASS; Users, Flights, Airports, Policies, Commercial, Fare Pricing, Seat Pricing, Seat Operations đều render PASS, không console/page error, desktop không horizontal overflow.
  - `e2e_customer` hiện trả 401 với mật khẩu checklist, trong khi `e2e_customer_gold`, `e2e_clerk`, `e2e_admin` đều authenticate được bằng `E2ePass@2026`. Source seed vẫn khai báo và upsert đúng password hash cho `e2e_customer`, nên đây là trạng thái DB test hiện tại chứ chưa có bằng chứng là auth regression.
  - Dùng `e2e_customer_gold` đã đi được Home -> Results -> Passenger -> Seat; primary passenger prefill đúng `Gold Customer`. Một số assertion visibility/map trong script đầu chạy quá sớm nên không dùng làm kết luận lỗi UI; lần browser rerun sâu hơn bị tool execution restriction nên chưa claim full click-through tới Review.
- Verification source hiện tại:
  - Backend `npm run build`: PASS.
  - Frontend host `npm run build`: PASS; Angular bundle generation hoàn tất thành công.
  - `git diff --check`: PASS.
  - Focused regression cho pricing profile, seat pricing/profile, airports, policies, AirLabs commercial, flights admin/revenue pricing: **8/8 suites, 99/99 tests PASS**.
  - Full backend Jest với `JWT_SECRET` test-only và `TEST_MONGO_URI=mongodb://127.0.0.1:27018/airline_codex_full_20261002`: **38/38 suites, 826/826 tests PASS**.
- Bước tiếp theo chính xác khi tiếp tục UI test:
  1. Không reseed giữa lúc đang giữ state test tay hiện tại.
  2. Nếu muốn reset bộ classroom test về trạng thái deterministic, chạy seed E2E trước khi bắt đầu vòng test mới; việc này sẽ phục hồi password của `e2e_customer` nhưng đồng thời reset dataset E2E.
  3. Tiếp tục manual/live browser từ Customer flow (Results -> Passenger -> Seat -> Review -> Hold/Buy), sau đó kiểm tra round-trip/connecting và viewport mobile.
