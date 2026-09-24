# Unit Testing Check List — Aptech Airlines ARS

**Lệnh chạy toàn bộ kiểm thử tự động:**
```bash
cd backend
npm test
```

**Kết quả tổng quan:**
- **Test Suites:** 33 passed, 33 total (100% PASS)
- **Tests:** 790 passed, 790 total (100% PASS)
- **Snapshots:** 0 total
- **Thời gian thực thi:** ~15 - 25 giây
- **Biên dịch mã nguồn:** `npm run build` — 0 lỗi (TypeScript NestJS strict & Angular 21 Standalone)

---

## 1. Danh sách 33 Test Suites Toàn hệ thống

| STT | Tên Test Suite | Tập tin kiểm thử | Số Tests | Trạng thái |
| :---: | :--- | :--- | :---: | :---: |
| 1 | Airports Service & City Resolution | `src/airports/airports.service.spec.ts` | 6 | PASS |
| 2 | Analytics & Seat Capacity Intelligence | `src/analytics/analytics.service.spec.ts` | 6 | PASS |
| 3 | Authentication & Security Service | `src/auth/auth.service.spec.ts` | 20 | PASS |
| 4 | Bookings Scheduler & Hold Expiry Cron | `src/bookings/bookings.scheduler.spec.ts` | 5 | PASS |
| 5 | Booking Engine & Business Rules | `src/bookings/bookings.service.spec.ts` | 117 | PASS |
| 6 | Payment Phase 1A Baseline | `src/bookings/payment-phase-1a.spec.ts` | 21 | PASS |
| 7 | Payment Phase 1B Reconciliation & Hardening | `src/bookings/payment-phase-1b.spec.ts` | 132 | PASS |
| 8 | Great-Circle Haversine Distance Utility | `src/common/distance.util.spec.ts` | 6 | PASS |
| 9 | Timezone Utility & Airport Wall Clock | `src/common/timezone.util.spec.ts` | 4 | PASS |
| 10 | AirLabs Commercial Service | `src/flights/airlabs-commercial.service.spec.ts` | 46 | PASS |
| 11 | Commercial Network Discovery | `src/flights/commercial-network-discovery.spec.ts` | 13 | PASS |
| 12 | Flight Schedule Generator (330 Days) | `src/flights/flight-generator.service.spec.ts` | 16 | PASS |
| 13 | Flights Network Discovery & Itineraries | `src/flights/flights-network-discovery.spec.ts` | 20 | PASS |
| 14 | Flights Phase A Hardened Invariants | `src/flights/flights-phase-a-hardened.spec.ts` | 11 | PASS |
| 15 | Flights Horizon Maintenance Scheduler | `src/flights/flights.scheduler.spec.ts` | 2 | PASS |
| 16 | Flight Core Service & Multi-tier Pricing | `src/flights/flights.service.spec.ts` | 52 | PASS |
| 17 | Phase C2 Complete Cutover & Materialization | `src/flights/phase-c2-cutover.spec.ts` | 32 | PASS |
| 18 | Phase C3 Commercial Management GUI | `src/flights/phase-c3-commercial-gui.spec.ts` | 17 | PASS |
| 19 | Email Service & Lifecycle Fallback | `src/mail/mail.service.spec.ts` | 18 | PASS |
| 20 | PayPal Integration Engine & Validation | `src/paypal/paypal.service.spec.ts` | 32 | PASS |
| 21 | Policies Service & Tiered Refunds | `src/policies/policies.service.spec.ts` | 8 | PASS |
| 22 | Reference Data Service & Cache | `src/reference/reference.service.spec.ts` | 45 | PASS |
| 23 | Route Cache Pre-warm Scheduler | `src/reference/route-cache.scheduler.spec.ts` | 6 | PASS |
| 24 | AirLabs Route Graph & Topology | `src/reference/route-graph.service.spec.ts` | 33 | PASS |
| 25 | Route Index Migration & Cleanup | `src/reference/route-index-migration.service.spec.ts` | 24 | PASS |
| 26 | Route Schedule Validator | `src/reference/route-schedule-validator.service.spec.ts` | 20 | PASS |
| 27 | Phase B Seat Migration & Index Verifier | `src/scripts/migrate-phase-b-seats.spec.ts` | 3 | PASS |
| 28 | Reference Data Repair & Integrity | `src/scripts/repair-reference-data.spec.ts` | 20 | PASS |
| 29 | E2E Demonstration Seed Invariant Verifier | `src/scripts/seed-e2e-demo.spec.ts` | 13 | PASS |
| 30 | Fleet Layout Catalog Invariants (A20N/A21N/B789/A359/B738/AT76) | `src/seat-allocation/fleet-layout.catalog.spec.ts` | 19 | PASS |
| 31 | Seat Allocation Concurrency & Invariant Locks | `src/seat-allocation/seat-allocation-concurrency.spec.ts` | 2 | PASS |
| 32 | Seat Allocation Phase B Core Rules | `src/seat-allocation/seat-allocation-phase-b.spec.ts` | 14 | PASS |
| 33 | Dynamic Seat Pricing Engine (8 Dimensions) | `src/seat-allocation/seat-pricing.service.spec.ts` | 7 | PASS |
| **Tổng** | **33 Test Suites** | **Toàn bộ hệ thống** | **790 Tests** | **100% PASS** |

---

## 2. Bảng Trích yếu Test Cases Trọng tâm

| Mã TC | Phân hệ | Mục tiêu kiểm thử | Dữ liệu đầu vào | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|---|
| TC-01 | Policies | Hoàn tiền trước chuyến bay $\ge 30$ ngày | `daysBeforeDeparture = 35, 30` | Tỷ lệ hoàn 90% theo bảng chính sách | Pass |
| TC-02 | Policies | Hoàn tiền trước chuyến bay 15..29 ngày | `daysBeforeDeparture = 29, 15, 20` | Tỷ lệ hoàn 75% | Pass |
| TC-03 | Policies | Hoàn tiền trước chuyến bay 7..14 ngày | `daysBeforeDeparture = 14, 7` | Tỷ lệ hoàn 50% | Pass |
| TC-04 | Policies | Hoàn tiền trước chuyến bay 0..6 ngày | `daysBeforeDeparture = 6, 0` | Không hoàn tiền (0%) | Pass |
| TC-05 | Policies | Xử lý khi không có policy nào khớp | `daysBeforeDeparture = 100` (ngoài dải) | Trả về 0% an toàn | Pass |
| TC-06 | Policies | Hỗ trợ mốc `max_days_before = null` | Mốc không giới hạn ngày tối đa | Áp dụng đúng % hoàn của mốc không giới hạn | Pass |
| TC-07 | Policies | Thứ tự áp dụng policy (ưu tiên dải hẹp trước) | Cặp policy trùng lặp phạm vi | Lựa chọn chính xác dải cụ thể trước | Pass |
| TC-08 | Bookings | Chặn giữ chỗ khi ngày bay $\le 14$ ngày | `is_block = true`, `departure` $\le 14$ ngày | Ném `BadRequestException` từ chối giữ chỗ | Pass |
| TC-09 | Bookings | Giữ chỗ hợp lệ khi ngày bay $> 14$ ngày | `is_block = true`, `departure` $> 14$ ngày | Cấp mã `BLK-...`, chốt hạn 2 tuần trước bay | Pass |
| TC-10 | Bookings | Mua vé trực tiếp thanh toán thẻ tín dụng | `is_block = false`, 2 người lớn | Cấp mã `CNF-...`, trừ tiền, tích lũy dặm bay | Pass |
| TC-11 | Bookings | Chiết khấu giá vé Trẻ em (75%) & Cao tuổi (85%) | 1 Người lớn + 1 Trẻ em + 1 Cao tuổi | Tính đúng: $P_{adult} + 0.75 \times P_{adult} + 0.85 \times P_{adult}$ | Pass |
| TC-12 | Bookings | Rollback đa chặng khi một chặng sau thất bại | Đặt 2 chặng bay, chặng 2 hết chỗ | Thu hồi ghế chặng 1, ném ngoại lệ an toàn | Pass |
| TC-13 | Bookings | Khóa ghế nguyên tử & Chống tranh chấp | Nhiều luồng đặt cùng 1 ghế | Duy nhất 1 luồng thành công, các luồng khác nhận 400 | Pass |
| TC-14 | Bookings | Xác nhận vé giữ chỗ còn hạn | `confirmTicket` với mã `BLK-...` hợp lệ | Chuyển `CONFIRMED`, cấp mã `CNF-...`, cộng dặm | Pass |
| TC-15 | Bookings | Tự động hủy vé giữ chỗ khi quá hạn | Vé `BLOCKED` có `hold_deadline` đã qua | Đổi sang `CANCELLED`, hoàn trả ghế vào kho | Pass |
| TC-16 | Bookings | Chặn đổi vé đang ở trạng thái giữ chỗ | `rescheduleTicket` với vé `BLOCKED` | Ném `BadRequestException` yêu cầu xác nhận trước | Pass |
| TC-17 | Bookings | Đổi lịch vé: thu thêm chênh lệch dương | Giá vé chuyến mới cao hơn chuyến cũ | Sinh giao dịch `RESCHEDULE_CHARGE`, cấp `CNF-...` mới | Pass |
| TC-18 | Bookings | Đổi lịch vé: hoàn trả chênh lệch âm | Giá vé chuyến mới thấp hơn chuyến cũ | Sinh giao dịch `RESCHEDULE_REFUND`, hoàn tiền thẻ | Pass |
| TC-19 | Bookings | Đổi lịch vé khứ hồi: độc lập từng chặng | Chỉ đổi chuyến đi, giữ nguyên chuyến về | Đổi đúng coupon chặng đi, giữ nguyên coupon về | Pass |
| TC-20 | Bookings | Hủy vé đã xác nhận & Khấu trừ dặm bay | Hủy vé `CONFIRMED` được hoàn 75% | Sinh `REFUND`, trừ dặm bay đã cộng, đổi `CANCELLED` | Pass |
| TC-21 | Bookings | Hủy vé giữ chỗ `BLOCKED` | Hủy vé chưa thanh toán | Giải phóng ghế ngay lập tức, không sinh giao dịch tiền | Pass |
| TC-22 | Flights | Tìm kiếm chuyến bay: lọc ngày & hạng vé | Tra cứu chặng bay SGN -> HAN | Trả về danh sách chuyến bay khả dụng kèm giá đoàn | Pass |
| TC-23 | Flights | Tìm kiếm nối chuyến thông minh (Transit Hub) | Tuyến không có bay thẳng | Gợi ý nối chuyến với thời gian chờ 45 - 720 phút | Pass |
| TC-24 | Flights | Chặn ngày về trước ngày đi | `return_date < departure_date` | Ném `BadRequestException` | Pass |
| TC-25 | Flights | Cập nhật tình trạng khẩn cấp do thời tiết | Admin đổi trạng thái chuyến sang `CANCELLED` | Tự động quét và hoàn tiền 100% cho mọi hành khách | Pass |
| TC-26 | Airports | Phân giải nhập nhằng tên thành phố | Nhập "Hà Nội" hoặc "HAN" | Tự động phân giải chính xác mã IATA | Pass |
| TC-27 | Airports | Gợi ý sân bay gần nhất khi không có bay thẳng | Nhập thành phố không có sân bay trực tiếp | Gợi ý sân bay lân cận kèm khoảng cách km | Pass |
| TC-28 | Analytics | Tổng hợp doanh thu và số lượng đặt vé | Truy vấn tổng quan Executive Dashboard | Thống kê chính xác tỷ lệ hủy, đổi vé, phân loại cabin | Pass |
| TC-29 | Analytics | Tỷ lệ lấp đầy ghế (Load Factor) | Phân tích công suất các chuyến bay tương lai | Tính toán chính xác ghế đã bán / tổng công suất | Pass |
| TC-30 | Security | Bảo vệ tài khoản SUPER_ADMIN bất biến | Gọi API xóa hoặc hạ quyền `superadmin` | Ném `ForbiddenException (HTTP 403)` bảo vệ tuyệt đối | Pass |
| TC-31 | E2E Data | Seed dữ liệu thử nghiệm an toàn & idempotent | Chạy `npm run seed:e2e` nhiều lần | Upsert an toàn, tạo 4 user, 16 chuyến bay, 3 booking mẫu | Pass |
