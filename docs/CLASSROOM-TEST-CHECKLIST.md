# Aptech Airlines — Classroom Manual Test Checklist

Ngày chuẩn bị: 2026-10-02
Nhánh dùng để demo: `frontend-v2`

## 1. Tài khoản test hiện có

| Vai trò | Username | Password |
| --- | --- | --- |
| Customer | `e2e_customer` | `E2ePass@2026` |
| Customer có SkyMiles cao | `e2e_customer_gold` | `E2ePass@2026` |
| Clerk | `e2e_clerk` | `E2ePass@2026` |
| Admin | `e2e_admin` | `E2ePass@2026` |

Booking mẫu:

- Confirmed: `PNR-E2E-CONF01` / `CNF-E2E-001`
- Hold: `PNR-E2E-HOLD01` / `BLK-E2E-001`
- Cancelled: `PNR-E2E-CANC01` / `CNF-E2E-CNC` / `CAN-E2E-001`

Các chuyến test được seed theo ngày tương đối. Hãy ưu tiên tìm bằng `flight_number`, vì nếu seed lại thì ngày sẽ tự dịch theo ngày hiện tại:

- `APT-E2E-BUY`: +5 ngày, dùng chứng minh không được Hold khi <= 14 ngày.
- `APT-E2E-HLD`: +20 ngày, dùng chứng minh được Hold khi > 14 ngày.
- `APT-E2E-RET`: +25 ngày, chiều về cho round-trip.
- `APT-E2E-C01` + `APT-E2E-C02`: HAN -> DAD -> PQC, nối chuyến.
- `APT-E2E-PRC-LO` / `APT-E2E-PRC-HI`: so sánh giá/chuyến thay thế.
- `APT-E2E-REF90`: +35 ngày, refund 90%.
- `APT-E2E-REF50`: +10 ngày, refund 50%.
- `APT-E2E-LIM`: chỉ còn 2 ghế.
- `APT-E2E-OUT`: hết ghế.
- `APT-E2E-DLY`: mục tiêu test DELAYED.
- `APT-E2E-CNC`: mục tiêu test CANCELLED khẩn cấp.
- `APT-E2E-INTL`: SGN -> NRT, kiểm tra timezone/quốc tế.
- `APT-E2E-SEAT`: seat map demo.

## 2. Thứ tự test nên dùng trên lớp

Test theo thứ tự: **Guest -> Customer -> Clerk -> Admin -> quay lại Customer**. Cách này tận dụng booking tạo ở bước trước cho Hold, Confirm, Reschedule, Cancel và emergency update.

## 3. Mục 1 — System Objectives

### 1.1 Reservation transactions

- [ ] Guest mở trang chủ và tìm chuyến được mà không cần login.
- [ ] Tạo booking mới bằng Customer.
- [ ] Với `APT-E2E-HLD`, chọn Hold -> sinh `BLK-...`, trạng thái `BLOCKED`, ghế giảm đúng.
- [ ] Với `APT-E2E-BUY`, Hold phải bị khóa vì chuyến <= 14 ngày; chỉ cho mua.
- [ ] Mua vé -> sinh `CNF-...`, trạng thái `CONFIRMED`.
- [ ] Cancel booking -> sinh `CAN-...`, ghế được trả lại.
- [ ] Reschedule booking CONFIRMED -> chuyến cũ + ghế, chuyến mới - ghế, cấp CNF mới và tính chênh lệch giá.
- [ ] Reload / logout-login lại -> booking vẫn còn và tra cứu được.

### 1.2 Airline / Staff objectives

- [ ] CLERK login và vào Reservation Desk.
- [ ] CLERK đặt vé thay một CUSTOMER; booking phải thuộc `user_id` của Customer, không phải Clerk.
- [ ] ADMIN login và mở Dashboard/Analytics, Users, Flights, Airports, Policies, Commercial, Seat Pricing, Seat Operations.
- [ ] ADMIN/CLERK kiểm tra Seat Operations: block/unblock ghế và override phí ghế.
- [ ] ADMIN đổi trạng thái một chuyến sang `DELAYED` kèm lý do; Customer phải thấy cảnh báo.
- [ ] ADMIN đổi một chuyến test sang `CANCELLED`; booking liên quan phải phản ánh hủy/hoàn tiền theo logic hệ thống.
- [ ] Kiểm tra inventory không overbooking và số ghế thay đổi đúng sau Hold/Buy/Cancel/Reschedule.
- [ ] Kiểm tra dynamic pricing: chuyến gần ngày và xa ngày cho giá khác theo rule hiện hành.

### 1.3 Customer objectives

- [ ] Tìm chuyến thẳng nhanh và rõ ràng.
- [ ] Tìm HAN -> PQC và thấy itinerary HAN -> DAD -> PQC.
- [ ] Guest không phải nhập lặp lại thông tin không cần thiết.
- [ ] Các input sai phải có validation/error rõ ràng.
- [ ] Customer dễ xem My Trips, Track, Reschedule, Cancel.

## 4. Mục 2 — System Context

- [ ] Web GUI hoạt động cho Guest/Customer.
- [ ] Staff GUI hoạt động cho Clerk/Admin.
- [ ] Cả Customer và Staff đều có thể kiểm tra lịch bay, ghế trống và giá.
- [ ] Registered Customer có thể Hold, Buy, Cancel, Reschedule.
- [ ] Clerk có thể làm nghiệp vụ đặt vé thay khách nhưng không có quyền Admin-only.
- [ ] Admin có đầy đủ quản trị vận hành theo RBAC.

## 5. Mục 3 — Functional Requirements 3.1 -> 3.10

### 3.1 User Accounts

- [ ] Guest chỉ xem availability.
- [ ] Registered Customer login và giao dịch được.
- [ ] Logout hoạt động ở mọi luồng chính.

### 3.2 Registration and Profile

- [ ] Đăng ký user mới với username/password/name/address/phone/email/sex/age/card.
- [ ] SkyMiles khởi tạo bằng 0.
- [ ] Profile không trả password hash; card chỉ hiển thị masked.
- [ ] Customer sửa profile rồi reload/login lại vẫn giữ dữ liệu.

### 3.3 Checking Availability

- [ ] Nhập origin/destination bằng text.
- [ ] Test `Hoi An` -> gợi ý DAD và khoảng cách sân bay gần nhất.
- [ ] Direct flight hiển thị flight number, giờ đi, giờ đến, duration, ghế còn, giá.
- [ ] Connecting route HAN -> DAD -> PQC hiển thị đúng thứ tự leg và layover 45 phút - 12 giờ.
- [ ] One-way và Round-trip đều hoạt động; round-trip có outbound/inbound riêng.
- [ ] Return date trước departure date phải báo lỗi.
- [ ] Ngày quá khứ và quá horizon 330 ngày phải bị chặn.
- [ ] Test date range nhiều ngày nếu UI đang bật range.
- [ ] Test 1 Adult + 1 Child + 1 Senior: Adult 100%, Child 75%, Senior 85%.
- [ ] Test ECONOMY/BUSINESS/CLUB ở chuyến có cabin tương ứng.
- [ ] `APT-E2E-LIM` chỉ còn 2 ghế; party >2 không được đặt.
- [ ] `APT-E2E-OUT` không được coi là còn inventory đặt được.
- [ ] Kiểm tra bảng/chính sách hoàn tiền hiển thị đúng.

### 3.4 Reservation / Blocking / Confirmation

- [ ] Guest bấm giao dịch -> bắt buộc login/register.
- [ ] `APT-E2E-BUY` (+5d) -> không có Hold.
- [ ] `APT-E2E-HLD` (+20d) -> có Hold hoặc Buy.
- [ ] Hold miễn phí, sinh `BLK-...`, deadline = ngày bay - 14 ngày.
- [ ] Buy sinh `CNF-...` và payment transaction thành công.
- [ ] Ghế bị trừ đúng số hành khách.
- [ ] SkyMiles chỉ cộng khi booking thành `CONFIRMED`; Hold chưa cộng.

### 3.5 Confirm Ticket

- [ ] Login `e2e_customer` và mở `BLK-E2E-001`.
- [ ] Confirm Hold -> `BLOCKED` thành `CONFIRMED`, sinh CNF mới.
- [ ] Ghế HELD thành CONFIRMED.
- [ ] SkyMiles cộng theo tổng mileage các leg của travel party.

### 3.6 Reschedule Ticket

- [ ] `CNF-E2E-001` được phép Reschedule.
- [ ] `BLK-E2E-001` phải bị chặn vì BLOCKED không được reschedule.
- [ ] Chọn chuyến mới còn ghế.
- [ ] Chuyến cũ được trả ghế; chuyến mới bị trừ ghế.
- [ ] Hệ thống tính charge/refund chênh lệch và sinh CNF mới.
- [ ] SkyMiles điều chỉnh theo chênh lệch mileage hành trình mới/cũ.

### 3.7 Cancellation

- [ ] Cancel BLOCKED -> giải phóng ghế, không refund tiền.
- [ ] Cancel CONFIRMED -> hiển thị % refund trước khi xác nhận.
- [ ] `APT-E2E-REF90` -> case >30 ngày = 90%.
- [ ] `APT-E2E-REF50` -> case 7-14 ngày = 50%.
- [ ] Case <=6 ngày -> 0%.
- [ ] Sau cancel sinh `CAN-...`, trả ghế, ghi refund transaction nếu có.
- [ ] SkyMiles đã cộng phải bị trừ lại khi booking CONFIRMED bị hủy.

### 3.8 Update Profile

- [ ] Sửa name/address/phone/card.
- [ ] Customer không thể tự đổi `role` hoặc tự cộng `sky_miles`.

### 3.9 View Ticket Status

- [ ] Track bằng PNR, BLK hoặc CNF của chính Customer.
- [ ] Customer khác không được xem booking không thuộc sở hữu.
- [ ] DELAYED phải highlight status/lý do/thời gian mới.
- [ ] CANCELLED phải highlight cảnh báo và trạng thái booking liên quan.

### 3.10 Public Flight Details

- [ ] Logout hoàn toàn.
- [ ] Vào Flight Lookup/Lịch bay, nhập flight number + date.
- [ ] Guest vẫn xem được departure/arrival mà không cần login.

## 6. UI/UX và NFR nên test thêm

- [ ] VI -> EN -> VI đổi tức thời, không cần reload.
- [ ] Không có emoji trong giao diện; icon dùng vector/SVG.
- [ ] Navbar, card, button, typography nhất quán brand navy/gold.
- [ ] Desktop và viewport nhỏ không bị horizontal overflow toàn trang.
- [ ] Seat map nằm ngang, có scroll nội bộ, không làm trang tràn ngang.
- [ ] Review -> quay lại Seats -> quay lại Review không mất lựa chọn/phụ phí.
- [ ] Refresh trang ở các route chính không 404.
- [ ] CUSTOMER không vào được admin route.
- [ ] CLERK không làm được API/chức năng Admin-only.
- [ ] SUPER_ADMIN không thể bị xóa hoặc hạ role.
- [ ] PayPal chỉ xuất hiện ở customer checkout khi được bật; staff dùng profile-card flow.
- [ ] Không có lựa chọn smoking trên UI hiện hành.

## 7. Kết quả kỹ thuật trước khi push

- Backend build: PASS.
- Backend Jest với Mongo local + test JWT: **34/34 suites, 791/791 tests PASS**.
- Frontend production build bằng Docker: PASS.
- `git diff --check`: PASS.

Các log ERROR/WARN trong Jest có nhiều case recovery/compensation được mock chủ động; suite cuối vẫn phải là PASS.
