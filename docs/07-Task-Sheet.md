# HỆ THỐNG ĐẶT VÉ MÁY BAY - APTECH AIRLINES (ARS)
## BẢNG PHÂN BỔ NHIỆM VỤ CHI TIẾT (TASK SHEET)
**Deliverable 07 - Hồ sơ Đồ án eProject Aptech**

---

## 1. TỔNG QUAN BẢNG NHIỆM VỤ (TASK SHEET OVERVIEW)

Bảng phân bổ nhiệm vụ (Task Sheet) ghi nhận chi tiết toàn bộ các hạng mục công việc đã được lập kế hoạch, phân công và thực hiện xuyên suốt 30 ngày vòng đời dự án **Aptech Airlines ARS**. Toàn bộ các yêu cầu từ nghiệp vụ cốt lõi 3.1 - 3.10, yêu cầu phi chức năng, tích hợp dịch vụ hàng không ngoài đến tối ưu hóa đóng gói Docker đều được kiểm soát và ghi nhận chính xác theo từng tập tin mã nguồn phụ trách.

- **Tổng số hạng mục nhiệm vụ (Tasks):** 36 đầu việc.
- **Tổng thời gian ước tính (Estimated Effort):** 280 giờ công.
- **Tổng thời gian thực tế (Actual Effort):** 274 giờ công.
- **Tỷ lệ hoàn thành (Completion Rate):** **100% (36/36 Hoàn thành)**.

---

## 2. BẢNG CHI TIẾT NHIỆM VỤ THỰC HIỆN

| Mã Task | Hạng mục / Phân hệ | Mô tả nội dung công việc chi tiết | Module & Tập tin mã nguồn chính | Dự kiến (h) | Thực tế (h) | Vai trò phụ trách | Trạng thái |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **TS-01** | **Khởi tạo & Kiến trúc** | Khởi tạo cấu trúc dự án Fullstack Monorepo, cấu hình TypeScript, cài đặt NestJS và Angular 21, thiết lập môi trường Docker ban đầu. | `package.json`, `app.module.ts`, `app.config.ts`, `docker-compose.yml` | 8 | 8 | Lead Developer | **Hoàn thành** |
| **TS-02** | **Cơ sở Dữ liệu & Mongoose** | Khởi tạo kết nối MongoDB, cấu hình Mongoose ODM, thiết lập chỉ mục (Indexes) tối ưu hóa truy vấn cho các bộ sưu tập dữ liệu. | `app.module.ts`, `backend/.env` | 6 | 5 | Database Engineer | **Hoàn thành** |
| **TS-03** | **Dữ liệu Mẫu (Seed Data)** | Xây dựng dịch vụ khởi tạo dữ liệu ban đầu: Tạo duy nhất 1 tài khoản `SUPER_ADMIN`, nạp danh mục sân bay (gồm cả Hội An unserviced), nạp chính sách hoàn tiền mẫu. | `backend/src/seed/seed.service.ts`, `seed.module.ts` | 6 | 6 | Backend Developer | **Hoàn thành** |
| **TS-04** | **Xác thực & Bảo mật (Auth)** | Xây dựng API Đăng nhập và Đăng ký; sinh mã JWT Token; mã hóa mật khẩu một chiều với thư viện Bcrypt (Salt rounds = 10). | `backend/src/auth/auth.controller.ts`, `auth.service.ts`, `auth.dto.ts` | 8 | 8 | Security Engineer | **Hoàn thành** |
| **TS-05** | **Phân quyền người dùng (RBAC)** | Xây dựng `AuthGuard` kiểm tra JWT và `RolesGuard` phân quyền 4 cấp độ (`SUPER_ADMIN`, `ADMIN`, `CLERK`, `CUSTOMER`); thiết lập Decorator `@Roles()`. | `backend/src/auth/auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts` | 8 | 7 | Security Engineer | **Hoàn thành** |
| **TS-06** | **Quản lý Tài khoản (Users CRUD)** | Xây dựng các endpoint CRUD tài khoản người dùng; kiểm soát duplicate username/email; bảo vệ nghiêm ngặt tài khoản `SUPER_ADMIN` không thể xóa hoặc tạo thêm. | `backend/src/users/users.controller.ts`, `users.service.ts`, `users.schema.ts` | 10 | 10 | Backend Developer | **Hoàn thành** |
| **TS-07** | **Quản lý Sân bay (Airports CRUD)** | Xây dựng CRUD thông tin sân bay và thành phố; hỗ trợ cờ `is_serviced_directly`, lưu tọa độ và múi giờ quốc tế. | `backend/src/airports/airports.controller.ts`, `airports.service.ts`, `airports.schema.ts` | 8 | 7 | Backend Developer | **Hoàn thành** |
| **TS-08** | **Giải quyết Thành phố (Resolve City)** | Phát triển thuật toán giải quyết tên thành phố (`resolveCity`): Tìm kiếm sân bay chính xác hoặc gợi ý sân bay thương mại gần nhất kèm khoảng cách km (Mục 3.3.1 - 3.3.2). | `backend/src/airports/airports.service.ts` (`resolveCity`) | 8 | 9 | Backend Developer | **Hoàn thành** |
| **TS-09** | **Quản lý Chuyến bay (Flights CRUD)** | Xây dựng CRUD chuyến bay, quản lý nhiều khoang vé (Economy, Business, First), định giá cơ bản và cấu hình số ghế khả dụng. | `backend/src/flights/flights.controller.ts`, `flights.service.ts`, `flights.schema.ts` | 10 | 10 | Backend Developer | **Hoàn thành** |
| **TS-10** | **Tìm kiếm Chuyến bay (Search Flights)** | Phát triển API tìm kiếm chuyến bay một chiều và khứ hồi, tìm theo khoảng ngày, lọc theo hạng dịch vụ và số lượng hành khách (Mục 3.3.4 - 3.3.6). | `backend/src/flights/flights.service.ts` (`searchFlights`, `findDirectFlights`) | 12 | 11 | Fullstack Developer | **Hoàn thành** |
| **TS-11** | **Thuật toán Nối chuyến (Route Selection)** | Phát triển giải thuật tìm kiếm tuyến bay nối chuyến có điểm dừng trung chuyển (Transit) khi không có chuyến bay thẳng, tính toán thời gian quá cảnh hợp lệ 45p - 12h (Mục 3.3.3). | `backend/src/flights/flights.service.ts` (`findConnectingRoutes`) | 10 | 11 | Algorithm Specialist | **Hoàn thành** |
| **TS-12** | **Tính giá vé & Độ tuổi (Pricing)** | Xây dựng thuật toán tính tổng giá vé đoàn khách: Người lớn tính 100%, Trẻ em 75%, Người cao tuổi 85% giá vé cơ bản (Mục 3.3.7). | `backend/src/flights/flights.service.ts` (`computeFareForPassenger`) | 6 | 5 | Backend Developer | **Hoàn thành** |
| **TS-13** | **Sơ đồ Ghế ngồi A321 (Seat Map Backend)** | Xây dựng API trả về sơ đồ ghế mô phỏng Airbus A321 (31 hàng, 3-3, bỏ hàng 13, định vị hàng thoát hiểm 12 và 14); truy vấn các ghế đã được đặt trong CSDL. | `backend/src/flights/flights.service.ts` (`getSeatMap`) | 8 | 8 | Backend Developer | **Hoàn thành** |
| **TS-14** | **Đặt vé An toàn (Atomic Reservation)** | Phát triển phương thức trừ số ghế khả dụng nguyên tử qua toán tử `$elemMatch` và `$inc` của MongoDB, loại bỏ nguy cơ bán vượt số ghế (No Overbooking). | `backend/src/flights/flights.service.ts` (`reserveSeats`) | 8 | 8 | Database Engineer | **Hoàn thành** |
| **TS-15** | **Nghiệp vụ Giữ chỗ > 14 ngày (Hold Ticket)** | Kiểm tra điều kiện ngày bay > 14 ngày: Cho phép giữ chỗ không thu phí, tính hạn chót thanh toán, sinh mã giữ chỗ `BLK-XXXXXX` (Mục 3.4.2 & 3.4.3.1). | `backend/src/bookings/bookings.service.ts` (`createBooking`) | 10 | 10 | Backend Developer | **Hoàn thành** |
| **TS-16** | **Nghiệp vụ Mua vé Trực tiếp (Direct Buy)** | Xử lý mua vé ngay: Trừ thẻ tín dụng mô phỏng, lưu giao dịch, sinh mã xác nhận `CNF-XXXXXX` và mã PNR, xuất vé trạng thái CONFIRMED (Mục 3.4.3.2). | `backend/src/bookings/bookings.service.ts` (`createBooking`) | 8 | 8 | Backend Developer | **Hoàn thành** |
| **TS-17** | **Tích lũy Dặm bay (SkyMiles)** | Tự động tính khoảng cách chuyến bay nhân số lượng hành khách, cộng dồn vào hồ sơ thành viên khi mua vé hoặc xác nhận vé giữ chỗ (Mục 3.4.3.3 & 3.5.4). | `backend/src/users/users.service.ts` (`addSkyMiles`, `deductSkyMiles`) | 6 | 5 | Backend Developer | **Hoàn thành** |
| **TS-18** | **Tác vụ Nền Nhắc nhở & Tự hủy vé** | Cấu hình Node-cron `@Cron(EVERY_HOUR)`: Gửi email nhắc nhở trước 21 ngày cho vé giữ chỗ, tự động hủy vé và giải phóng ghế nếu quá hạn 14 ngày (Mục 3.4.2.1). | `backend/src/bookings/bookings.scheduler.ts`, `backend/src/mail/mail.service.ts` | 10 | 10 | Backend Developer | **Hoàn thành** |
| **TS-19** | **Xác nhận Vé Giữ chỗ (Confirm Ticket)** | Cho phép hành khách xác nhận vé đang giữ chỗ trước hạn 14 ngày, thanh toán thẻ, chuyển sang trạng thái CONFIRMED, cấp mã CNF mới và cộng dặm bay (Mục 3.5). | `backend/src/bookings/bookings.service.ts` (`confirmTicket`) | 8 | 7 | Backend Developer | **Hoàn thành** |
| **TS-20** | **Đổi Lịch trình Vé (Reschedule Ticket)** | Xây dựng API đổi vé đã xác nhận sang chuyến bay mới; kiểm tra ghế trống; tính toán bù/trừ chênh lệch giá vé; đổi ghế 2 chuyến; cấp mã xác nhận mới (Mục 3.6). | `backend/src/bookings/bookings.service.ts` (`rescheduleTicket`) | 12 | 13 | Backend Developer | **Hoàn thành** |
| **TS-21** | **Hủy vé & Hoàn tiền (Cancel Ticket)** | Xây dựng API hủy vé; tính % hoàn tiền dựa trên số ngày trước ngày khởi hành; hoàn tiền thẻ; giải phóng ghế; trừ dặm bay SkyMiles đã cộng (Mục 3.7). | `backend/src/bookings/bookings.service.ts` (`cancelTicket`) | 10 | 10 | Backend Developer | **Hoàn thành** |
| **TS-22** | **Quản lý Chính sách Hoàn tiền (Policies)** | Xây dựng CRUD chính sách hoàn tiền linh hoạt theo khoảng thời gian trước ngày bay (Mục 3.3.7.1 & 3.7.2). | `backend/src/policies/policies.controller.ts`, `policies.service.ts`, `policies.schema.ts` | 6 | 5 | Backend Developer | **Hoàn thành** |
| **TS-23** | **Tra cứu Vé & Cảnh báo Sự cố (Track)** | Xây dựng API tra cứu vé theo mã BLK, CNF, PNR; trích xuất chi tiết hành khách, chặng bay; gắn cờ làm nổi bật (`is_highlighted_change`) khi chuyến bay hoãn/hủy (Mục 3.9). | `backend/src/bookings/bookings.service.ts` (`trackTicket`) | 8 | 8 | Backend Developer | **Hoàn thành** |
| **TS-24** | **Tra cứu Chuyến bay Công khai (Lookup)** | Xây dựng API công khai cho phép bất kỳ ai nhập số hiệu chuyến bay và ngày bay để xem giờ cất cánh/hạ cánh thực tế (Mục 3.10). | `backend/src/flights/flights.service.ts` (`findByFlightNumberAndDate`) | 6 | 5 | Backend Developer | **Hoàn thành** |
| **TS-25** | **Đồng bộ Dữ liệu AirLabs API** | Tích hợp dịch vụ AirLabs REST API: Đồng bộ chuyến bay thật theo cặp sân bay, chuẩn hóa thông tin máy bay (A321, B787) và chuẩn hóa giá tiền VND. | `backend/src/flights/flights.service.ts` (`syncFromAirLabs`) | 10 | 11 | Integration Engineer | **Hoàn thành** |
| **TS-26** | **Thiết lập Giao diện & Design System** | Cấu hình Tailwind CSS v3, Typography Inter, bảng màu Aviation Navy & Royal Gold, nút bo tròn viên thuốc (`rounded-full`), thiết lập thẻ sang trọng. | `frontend/src/styles.css`, `frontend/tailwind.config.js` | 8 | 8 | Frontend Designer | **Hoàn thành** |
| **TS-27** | **Bộ Biểu tượng Vector SVG (Lucide Icons)** | Xây dựng `IconComponent` bao bọc toàn bộ các icon hàng không từ `lucide-angular`, cam kết 100% không sử dụng Emoji trên toàn giao diện người dùng. | `frontend/src/app/shared/components/icon/icon.component.ts` | 6 | 6 | Frontend Developer | **Hoàn thành** |
| **TS-28** | **Điều hướng & Đa ngôn ngữ (Navbar & i18n)** | Xây dựng Header/Navbar sang trọng; phát triển `LanguageService` sử dụng Signals hỗ trợ chuyển đổi tức thì Tiếng Việt / Tiếng Anh không cần tải lại trang. | `frontend/src/app/shared/components/navbar/navbar.component.ts`, `language.service.ts` | 8 | 8 | Frontend Developer | **Hoàn thành** |
| **TS-29** | **Modal Đăng nhập / Đăng ký (Auth Modal)** | Xây dựng Modal Đăng nhập/Đăng ký nổi bật với Reactive Forms, xác thực dữ liệu đầu vào, xử lý lưu JWT vào LocalStorage và phản hồi Toast. | `frontend/src/app/shared/components/auth-modal/auth-modal.component.ts`, `auth.service.ts` | 8 | 8 | Frontend Developer | **Hoàn thành** |
| **TS-30** | **Trang chủ & Bộ tìm kiếm (Home Page)** | Phát triển Hero Banner, Hộp tìm kiếm chuyến bay một chiều / khứ hồi, chọn ngày bay bằng lịch, chọn số lượng khách theo độ tuổi và chọn hạng ghế. | `frontend/src/app/pages/home/home.component.ts`, `home.component.html` | 10 | 9 | Frontend Developer | **Hoàn thành** |
| **TS-31** | **Trang Kết quả Chuyến bay (Flight Results)** | Hiển thị bảng kết quả chiều đi và chiều về, bộ lọc giờ bay/giá vé, hiển thị tuyến nối chuyến khi không có bay thẳng, modal xem chính sách hoàn tiền. | `frontend/src/app/pages/flight-results/flight-results.component.ts` | 12 | 12 | Frontend Developer | **Hoàn thành** |
| **TS-32** | **Trang Đặt vé & Sơ đồ Ghế (Booking Page)** | Phát triển quy trình đặt vé 3 bước: Điền thông tin hành khách; Chọn Giữ chỗ (Hold) hoặc Xuất vé ngay (Buy); Nhập thẻ thanh toán; Tích hợp Modal sơ đồ ghế A321. | `frontend/src/app/pages/booking/booking.component.ts`, `seat-map-modal.component.ts` | 14 | 15 | Frontend Developer | **Hoàn thành** |
| **TS-33** | **Trang Tra cứu & Quản lý vé (Track Booking)** | Xây dựng giao diện tra cứu vé toàn diện: Xem chi tiết vé, cảnh báo chuyến bay hoãn/hủy, Modal Xác nhận vé giữ chỗ, Modal Đổi vé có tìm chuyến mới, Modal Hủy vé nhận tiền hoàn. | `frontend/src/app/pages/track-booking/track-booking.component.ts` | 14 | 15 | Frontend Developer | **Hoàn thành** |
| **TS-34** | **Trang Tra cứu Công khai & SkyMiles** | Phát triển trang Tra cứu chuyến bay công khai theo số hiệu và ngày bay (`/flight-lookup`); Trang hiển thị thông tin dặm thưởng thành viên (`/skymiles`). | `flight-lookup.component.ts`, `skymiles.component.ts` | 8 | 7 | Frontend Developer | **Hoàn thành** |
| **TS-35** | **Cổng Quản trị Viên (Admin Portal)** | Phát triển Admin Layout với Dark Navy Sidebar và trọn bộ 7 phân hệ quản trị: Dashboard, Quản lý chuyến bay & cập nhật hoãn/hủy do thời tiết, Đồng bộ AirLabs, Quản lý sân bay, Quản lý vé, Quản lý người dùng và Quản lý chính sách. | `frontend/src/app/admin/*` (7 components quản trị) | 16 | 16 | Fullstack Developer | **Hoàn thành** |
| **TS-37** | **Executive Analytics Dashboard** | Xây dựng phân hệ phân tích quản trị doanh thu, tỷ lệ hủy/đổi vé, thống kê tuyến bay phổ biến, hành vi khách hàng và tải trọng chuyến bay (Load Factor). | `backend/src/analytics/*`, `frontend/src/app/admin/analytics/*` | 8 | 8 | Fullstack Developer | **Hoàn thành** |
| **TS-38** | **Deterministic E2E Seed Engine** | Phát triển script nạp dữ liệu E2E an toàn, tự động tạo 4 tài khoản thử nghiệm, 12 sân bay, 16 chuyến bay thương mại động và 3 booking mẫu. | `backend/src/scripts/seed-e2e-demo.ts`, `backend/package.json` | 6 | 6 | QA & Backend | **Hoàn thành** |
| **TS-39** | **Bàn Đặt vé Trợ giúp (Clerk Desk)** | Tích hợp giao diện hỗ trợ đặt vé qua điện thoại và khách vãng lai trực tiếp tại quầy cho Clerk, hỗ trợ giữ chỗ và xuất vé cho hành khách. | `frontend/src/app/admin/reservation-desk/*` | 6 | 6 | Frontend Developer | **Hoàn thành** |
| **TS-40** | **Chuẩn hóa Minh bạch SkyMiles** | Rà soát và cập nhật quyền lợi thẻ hội viên SkyMiles trung thực với mã nguồn (giảm 3%/7%/12%, tích lũy theo dặm bay thực tế). | `frontend/src/app/pages/skymiles/*` | 4 | 4 | Frontend Developer | **Hoàn thành** |
| **TS-41** | **Rà soát GUI Standards & i18n Toàn diện** | Rà soát toàn bộ các nút bấm dạng viên thuốc (`rounded-full`), căn chỉnh lưới 12 cột, làm sạch ký tự Dingbat và hoàn tất 31 test suites (768 unit tests). | Toàn bộ Frontend & Backend unit tests | 8 | 8 | QA & Lead Developer | **Hoàn thành** |

---

## 3. TỔNG KẾT KHỐI LƯỢNG CÔNG VIỆC THEO PHÂN HỆ

```
                               PHÂN BỔ GIỜ CÔNG THỰC TẾ
   ┌──────────────────────────────────────────────┬──────────────┬────────────┐
   │ Phân hệ công việc                            │ Số giờ (h)   │ Tỷ lệ (%)  │
   ├──────────────────────────────────────────────┼──────────────┼────────────┤
   │ 1. Kiến trúc, CSDL & Dữ liệu Seed ban đầu     │    32 h      │   10.5 %   │
   │ 2. Xác thực, Phân quyền & Quản trị tài khoản  │    32 h      │   10.5 %   │
   │ 3. Nghiệp vụ Lịch bay, Sân bay & Nối chuyến  │    43 h      │   14.0 %   │
   │ 4. Nghiệp vụ Đặt vé, Giữ chỗ, Đổi & Hủy vé   │    63 h      │   20.6 %   │
   │ 5. Tích hợp AirLabs API & Scheduler định kỳ  │    21 h      │    6.9 %   │
   │ 6. Giao diện Người dùng Angular & Icons SVG   │    69 h      │   22.5 %   │
   │ 7. Phân hệ Quản trị Admin, Clerk & Analytics │    30 h      │    9.8 %   │
   │ 8. Kiểm thử, Sửa lỗi & Đóng gói Docker       │    16 h      │    5.2 %   │
   ├──────────────────────────────────────────────┼──────────────┼────────────┤
   │ TỔNG CỘNG TOÀN DỰ ÁN (41 TASKS)              │   306 h      │  100.0 %   │
   └──────────────────────────────────────────────┴──────────────┴────────────┘
```
