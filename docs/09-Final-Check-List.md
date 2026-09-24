# BẢNG KIỂM TRA & NGHIỆM THU DỰ ÁN CUỐI CÙNG (FINAL CHECK LIST)
**Hệ thống Quản lý và Đặt vé Máy bay (Airline Reservation System - ARS)**
**Mã tài liệu:** `docs/09-Final-Check-List.md`
**Dự án:** Aptech Airlines eProject
**Bộ tiêu chuẩn đánh giá:** [ProjectSpecification.txt](../ProjectSpecification.txt) & [AirlinesReservationSystem.txt](../AirlinesReservationSystem.txt)

---

## 1. BẢNG CHECKLIST NGHIỆM THU THEO MÃ YÊU CẦU CHỨC NĂNG (3.1 - 3.10)

| Mã YC | Mô tả yêu cầu nghiệp vụ theo Đặc tả dự án | Trạng thái | Bằng chứng kiểm chứng mã nguồn & Endpoint thực tế |
| :---: | :--- | :---: | :--- |
| **3.1** | **Quản lý Tài khoản & Phân quyền Người dùng**<br>• Phân định 3 lựa chọn tương tác ban đầu: Khách vãng lai (Guest) chỉ xem lịch trình, Khách đăng ký tài khoản mới, hoặc Người dùng đã đăng ký (Registered User) đăng nhập để thực hiện đặt chỗ / mua vé.<br>• Cho phép người dùng thoát khỏi hệ thống bất kỳ lúc nào. | **ĐẠT** | • Controller: `POST /api/auth/login`, `POST /api/auth/register`<br>• Frontend Component: [auth-modal.component.ts](../frontend/src/app/shared/components/auth-modal/auth-modal.component.ts), [navbar.component.ts](../frontend/src/app/shared/components/navbar/navbar.component.ts)<br>• Khách vãng lai tra cứu bình thường; khi bấm đặt chỗ hệ thống kích hoạt Auth Modal yêu cầu đăng nhập/đăng ký. |
| **3.2** | **Đăng ký Tài khoản & Khởi tạo Điểm SkyMiles**<br>• Thu thập đầy đủ các trường: `username`, `password`, `first_name`, `last_name`, `address`, `phone_number`, `email`, `sex`, `age`, `preferred_credit_card`.<br>• Hệ thống tự động khởi tạo trường `sky_miles = 0`. | **ĐẠT** | • Schema: [users.schema.ts](../backend/src/users/users.schema.ts#L45-L48) (`@Prop({ default: 0 }) sky_miles`)<br>• Service: [users.service.ts](../backend/src/users/users.service.ts#L78) (`sky_miles: 0`)<br>• Mật khẩu được băm bằng Bcrypt với Salt 10 vòng bảo mật. |
| **3.3.1** | **Nhập Thành phố Đi & Đến dưới dạng Ký tự Tự do**<br>• Cho phép hành khách nhập tên thành phố/thị trấn hoặc mã IATA. | **ĐẠT** | • Frontend: [home.component.ts](../frontend/src/app/pages/home/home.component.ts)<br>• Backend Endpoint: `GET /api/airports/resolve?city=...` |
| **3.3.2** | **Kiểm tra Tính Nhập nhằng & Gợi ý Sân bay Lân cận**<br>• Nếu tên thành phố trùng khớp nhiều sân bay, hiển thị danh sách cho khách chọn.<br>• Nếu thành phố không có đường bay trực tiếp (`is_serviced_directly = false`), gợi ý sân bay gần nhất kèm khoảng cách km. | **ĐẠT** | • Service: [airports.service.ts](../backend/src/airports/airports.service.ts#L38-L80) (`resolveCity`)<br>• Dữ liệu Seed: Các địa phương lân cận được seed sẵn `nearest_airport_code` và `distance_to_nearest_km`. |
| **3.3.3** | **Kiểm tra Dịch vụ Trực tiếp & Thuật toán Chọn Tuyến Nối chuyến**<br>• Nếu không có đường bay thẳng, kích hoạt thuật toán gợi ý hành trình quá cảnh (Transit Hub) với thời gian nối chuyến từ 45 - 720 phút. | **ĐẠT** | • Service: [flights.service.ts](../backend/src/flights/flights.service.ts#L430-L504) (`findConnectingRoutes`)<br>• Frontend tự động hiển thị khối "Hành trình nối chuyến" nếu danh sách bay thẳng rỗng. |
| **3.3.4** | **Nhập Tiêu chí Hạng vé, Loại vé, Ngày bay & Phân loại Hành khách**<br><br>**ĐẶC TẢ NGUYÊN BẢN (ORIGINAL REQUIREMENT §3.3.4 & §3.3.4.1):**<br>• §3.3.4: class, one-way/round trip, departure date, adults, children, senior citizens; return date (khứ hồi không được sớm hơn ngày đi).<br>• §3.3.4.1: business class, first class, club class, smoking, non smoking.<br><br>**HIỆN TRẠNG TRIỂN KHAI / TRẠNG THÁI MỘT PHẦN (CURRENT IMPLEMENTATION / PARTIAL STATUS):**<br>• Giao diện và hợp đồng API hỗ trợ đầy đủ các tùy chọn tìm kiếm: ECONOMY, BUSINESS, FIRST, CLUB, smoking / non smoking preference.<br>• Phân loại độ tuổi & biểu giá: Người lớn 100%, Trẻ em 75%, Cao tuổi 85%.<br>• Kiểm tra ngày về $\ge$ ngày đi.<br>• Toàn bộ 6 dòng tàu bay trong catalog đội bay thương mại thực tế (A20N, A21N, B789, A359, B738, AT76) hiện chỉ khai thác khoang Economy, Club và Business; chưa có khoang FIRST vật lý khả dụng để đặt chỗ.<br>• Đánh giá: **MỘT PHẦN (PARTIAL)**. | **MỘT PHẦN (PARTIAL)** | • DTO: [flights.dto.ts](../backend/src/flights/flights.dto.ts) (`SearchFlightDto`)<br>• Service: [flights.service.ts](../backend/src/flights/flights.service.ts)<br>• Chặn lỗi `BadRequestException('Return date cannot be earlier than departure date')`.<br>• Giải trình trung thực: Khoang FIRST có trong enum và giao diện tìm kiếm nhưng đội bay thực tế chưa có cấu hình khoang ghế First Class thương mại để hoàn tất đặt chỗ vật lý. |
| **3.3.5** | **Truy vấn Cơ sở Dữ liệu Lịch trình Chuyến bay**<br>• Khai thác dữ liệu lịch bay theo điều kiện tìm kiếm. | **ĐẠT** | • Query: `DB.flights.find({ origin_iata, dest_iata, departure_date, status: { $ne: 'CANCELLED' } })` |
| **3.3.6** | **Truy vấn Ghế trống & Hiển thị Bảng Kết quả**<br>• Hiển thị số hiệu, giờ đi, giờ đến, thời gian bay, số ghế còn trống.<br>• Nếu là vé khứ hồi, hiển thị 2 bảng riêng biệt cho Chiều đi và Chiều về kèm nút chọn tương ứng. | **ĐẠT** | • Frontend: [flight-results.component.ts](../frontend/src/app/pages/flight-results/flight-results.component.ts)<br>• Hiển thị 2 tab/bảng `onward_flights` và `return_flights`. |
| **3.3.7** | **Hiển thị Biểu giá Đoàn bay & Bảng Quy tắc Hủy vé**<br>• Tính tổng tiền vé cả đoàn: Người lớn 100%, Trẻ em 75%, Người cao tuổi 85%.<br>• Hiển thị bảng quy tắc % hoàn tiền khi hủy vé theo ngày. | **ĐẠT** | • Backend tính giá: [flights.service.ts](../backend/src/flights/flights.service.ts#L398-L403)<br>• Controller: `GET /api/policies`<br>• Hiển thị bảng % hoàn tiền minh bạch trên trang Booking và Track. |
| **3.4.1** | **Xác thực Đăng nhập trước khi Giữ chỗ / Mua vé**<br>• Khách vãng lai bắt buộc phải đăng ký/đăng nhập trước khi hoàn tất giao dịch. | **ĐẠT** | • Controller: `POST /api/bookings` yêu cầu Bearer JWT Token.<br>• Frontend tự động bật `AuthModalComponent` khi khách bấm Đặt vé nếu chưa đăng nhập. |
| **3.4.2** | **Quy tắc Giữ chỗ > 14 ngày & Cấm Giữ chỗ $\le$ 14 ngày**<br>• Nếu ngày bay trong vòng 14 ngày: Bắt buộc mua trực tiếp, không cho giữ chỗ.<br>• Nếu ngày bay $> 14$ ngày: Cho phép giữ chỗ miễn phí, hạn chót xác nhận là 2 tuần trước ngày bay.<br>• Tự động gửi email nhắc nhở trước 3 tuần. | **ĐẠT** | • Logic chặn 14 ngày: [bookings.service.ts](../backend/src/bookings/bookings.service.ts#L135-L141)<br>• Tính hạn chót: `earliestDeparture - 14 ngày`<br>• Cron gửi mail 3 tuần: [bookings.scheduler.ts](../backend/src/bookings/bookings.scheduler.ts#L51-L97). |
| **3.4.3** | **Cập nhật Ghế trống, Cấp Mã Giữ chỗ / Mã Xác nhận & Tích Dặm**<br>• Trừ ghế trống khả dụng nguyên tử (`$elemMatch`, `$inc`).<br>• Giữ chỗ: Sinh mã `BLK-XXXXXX`.<br>• Mua ngay: Trừ tiền thẻ tín dụng, sinh mã `CNF-XXXXXX`, cộng dặm bay vào `sky_miles`. | **ĐẠT** | • Service: [bookings.service.ts](../backend/src/bookings/bookings.service.ts#L143-L214)<br>• Phân bổ ghế vật lý & kiểm soát chỗ: `SeatAllocationService`.<br>• Cộng dặm bay: `UsersService.addSkyMiles(user_id, distance_miles * passengerCount)`. |
| **3.5** | **Xác nhận Vé Đã Giữ chỗ (Confirm Blocked Ticket)**<br>• Nhập mã giữ chỗ `BLK-...`, thanh toán thẻ tín dụng trước hạn 14 ngày.<br>• Đổi trạng thái sang `CONFIRMED`, cấp mã `CNF-...`, cộng dặm bay.<br>• Nếu quá hạn 14 ngày: Tự động hủy và hoàn trả ghế trống. | **ĐẠT** | • Endpoint: `POST /api/bookings/confirm`<br>• Tự động hủy quá hạn: [bookings.scheduler.ts](../backend/src/bookings/bookings.scheduler.ts#L104-L137) (`autoCancelExpiredBlocks`). |
| **3.6** | **Đổi vé Đã xác nhận (Reschedule Ticket)**<br>• Chỉ cho phép đổi vé `CONFIRMED` (tuyệt đối không cho đổi vé đang giữ chỗ `BLOCKED`).<br>• Chọn chuyến bay mới, hoàn trả ghế cũ, trừ ghế chuyến mới.<br>• Tính toán chênh lệch giá tiền (phụ thu hoặc hoàn trả thẻ tín dụng), cấp mã `CNF-...` mới và tái cấu trúc cuống vé. | **ĐẠT** | • Endpoint: `POST /api/bookings/reschedule`<br>• Service: [bookings.service.ts](../backend/src/bookings/bookings.service.ts#L279-L420)<br>• Hỗ trợ đổi cả chặng đi lẫn chặng về cho vé khứ hồi. |
| **3.7** | **Hủy vé & Hoàn tiền theo Chính sách (Cancellation Engine)**<br>• Hủy vé giữ chỗ: Hoàn trả ghế ngay lập tức.<br>• Hủy vé đã xác nhận: Nhập mã `CNF-...`, tra cứu bảng chính sách tính % hoàn tiền, hoàn trả tiền thẻ tín dụng, sinh mã `CAN-XXXXXX`, trừ lại số dặm bay đã cộng trong hồ sơ người dùng. | **ĐẠT** | • Endpoint: `POST /api/bookings/cancel`<br>• Service: [bookings.service.ts](../backend/src/bookings/bookings.service.ts#L461-L529)<br>• Khấu trừ dặm: `usersService.deductSkyMiles(booking.user_id, miles)`. |
| **3.8** | **Cập nhật Thông tin Hồ sơ Hành khách (Update Profile)**<br>• Cho phép người dùng chỉnh sửa địa chỉ, số điện thoại, thẻ tín dụng ưu tiên bất kỳ lúc nào. | **ĐẠT** | • Endpoint: `PUT /api/users/:id`<br>• Service: [users.service.ts](../backend/src/users/users.service.ts#L85-L123). |
| **3.9** | **Tra cứu Trạng thái Vé & Làm nổi bật Thay đổi Giờ bay**<br>• Tra cứu hồ sơ đặt vé bằng mã Giữ chỗ, mã Xác nhận hoặc mã PNR.<br>• Làm nổi bật (highlight cảnh báo) các chuyến bay bị trễ giờ hoặc hủy chuyến khẩn cấp do thời tiết xấu. | **ĐẠT** | • Endpoint: `GET /api/bookings/track/:code`<br>• Frontend: [track-booking.component.ts](../frontend/src/app/pages/track-booking/track-booking.component.ts)<br>• Hiển thị banner cam/đỏ nổi bật cảnh báo thời tiết xấu. |
| **3.10** | **Tra cứu Lịch trình Chuyến bay Công khai (Public Flight Lookup)**<br>• Bất kỳ ai (kể cả khách chưa đăng nhập) đều có thể tra cứu giờ đi/đến bằng cách nhập Số hiệu chuyến bay (VD: `VN101`) và Ngày bay. | **ĐẠT** | • Endpoint: `GET /api/flights/lookup?flight_number=...&date=...`<br>• Frontend: [flight-lookup.component.ts](../frontend/src/app/pages/flight-lookup/flight-lookup.component.ts). |

---

## 2. BẢNG CHECKLIST CÁC MỤC PHI CHỨC NĂNG & NÂNG CAO

| Hạng mục | Tiêu chuẩn kỹ thuật | Trạng thái | Bằng chứng kiểm chứng |
| :--- | :--- | :---: | :--- |
| **Bảo vệ SUPER_ADMIN** | Chỉ tồn tại duy nhất 1 tài khoản `SUPER_ADMIN`. Chặn tuyệt đối: không được xóa, không được hạ quyền, không được tạo thêm. | **ĐẠT** | [users.service.ts](../backend/src/users/users.service.ts#L57-L59), [seed.service.ts](../backend/src/seed/seed.service.ts). Cố tình vi phạm sẽ ném `ForbiddenException (HTTP 403)`. |
| **Lan truyền Hủy chuyến Khẩn cấp** | Yêu cầu 1.2.3: Khi Admin đổi trạng thái chuyến bay sang `CANCELLED` (do thời tiết xấu), hệ thống tự động quét và hủy toàn bộ vé liên quan, hoàn tiền 100% và giải phóng ghế. | **ĐẠT** | [flights.service.ts](../backend/src/flights/flights.service.ts#L168-L222) (`cancelBookingsForFlight`). |
| **Mạng lưới Thương mại & Lịch bay Mẫu** | Tích hợp dữ liệu mạng bay thực tế, lịch bay mẫu định kỳ, phân bổ ghế vật lý và chân trời 330 ngày. | **ĐẠT** | [airlabs-commercial.service.ts](../backend/src/flights/airlabs-commercial.service.ts), Giao diện Admin: [commercial-flights.component.ts](../frontend/src/app/admin/commercial-flights/commercial-flights.component.ts) (`/admin/commercial-flights`). |
| **Quy chuẩn Giao diện Hàng không** | Bảng màu Navy `#0A2540` & Gold `#D4AF37`, Font chữ Inter, Nút dạng viên thuốc (`rounded-full`), 100% Vector SVG Lucide, **tuyệt đối không Emoji**. | **ĐẠT** | [GUI_Standards_Document.md](../GUI_Standards_Document.md), [styles.css](../frontend/src/styles.css), toàn bộ Frontend components. |
| **Đa ngôn ngữ Song ngữ** | Chuyển đổi Tiếng Việt / Tiếng Anh thời gian thực bằng Angular Signals. | **ĐẠT** | [language.service.ts](../frontend/src/app/core/services/language.service.ts). |
| **Catalog Đội bay & Sơ đồ Ghế Chuẩn** | Hỗ trợ 6 dòng tàu bay (A20N, A21N, B789, A359, B738, AT76) với sơ đồ ghế và cấu hình cabin thực tế (B789: 28 Business, 35 Club, 231 Economy), kiểm tra chiếm chỗ thời gian thực từ CSDL. | **ĐẠT** | [fleet-layout.catalog.ts](../backend/src/seat-allocation/fleet-layout.catalog.ts), [seat-map-modal.component.ts](../frontend/src/app/shared/components/seat-map-modal/seat-map-modal.component.ts), [flights.service.ts](../backend/src/flights/flights.service.ts). |
| **Đóng gói Docker Compose** | Orchestration toàn bộ 3 dịch vụ: MongoDB + NestJS Backend + Angular Nginx Frontend chỉ với 1 câu lệnh. | **ĐẠT** | [docker-compose.yml](../docker-compose.yml), Dockerfile Backend & Frontend. |

---

## 3. CÁC HẠN CHẾ ĐÃ BIẾT CỦA HỆ THỐNG (KNOWN LIMITATIONS)

Nhằm đảm bảo tính minh bạch và trung thực kỹ thuật cao nhất trong hồ sơ nghiệm thu eProject, nhóm kỹ sư ghi nhận các hạn chế kỹ thuật hiện tại:

1. **Dịch vụ Gửi Mail (SMTP) ở Chế độ Giả lập (Dev Fallback):**
   - Hệ thống đã tích hợp sẵn thư viện `nodemailer` và cấu hình đọc thông số từ biến môi trường (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`).
   - Tuy nhiên, trong môi trường kiểm thử và chấm đồ án cục bộ không cấu hình sẵn máy chủ SMTP thực tế, `MailService` sẽ tự động chuyển sang chế độ **`[MAIL:DEV-FALLBACK]`**: Toàn bộ nội dung thư nhắc nhở giữ chỗ 3 tuần sẽ được ghi nhận rõ ràng vào Console Log của NestJS thay vì gửi qua giao thức mạng, đảm bảo hệ thống không bị treo hay phát sinh lỗi kết nối.
2. **Cấu hình Đội bay Vật lý Thương mại (Physical Fleet Configurations):**
   - Đội bay vật lý thương mại hiện tại gồm 6 dòng tàu bay chuẩn: A20N (180 ghế: 12 Business, 168 Economy), A21N (204 ghế: 16 Business, 188 Economy), B789 (294 ghế: 28 Business, 35 Club, 231 Economy), A359 (305 ghế: 29 Business, 36 Club, 240 Economy), B738 (166 ghế: 16 Business, 150 Economy), và AT76 (68 ghế: 68 Economy). Toàn bộ các dòng tàu bay vận hành theo cấu hình 1, 2 hoặc 3 hạng ghế (Economy, Premium Economy/Club, Business). Hệ thống chưa đưa vào khai thác dòng tàu bay 4 hạng ghế có khoang First Suite riêng biệt, do đó yêu cầu First Class được ghi nhận đạt một phần (PARTIAL) ở cấp độ quy hoạch đội bay thực tế.
3. **Chuyến bay Tương lai Không có Số Đăng bạ Thực tế (Honest Fallback Rule):**
   - Theo nguyên lý vận hành của radar hàng không thế giới (AirLabs ADS-B Feed), một chiếc máy bay chỉ được gán số đăng bạ cụ thể (Registration, ví dụ: `VN-A612`) khi chuyến bay đang thực sự cất cánh trên bầu trời (Airborne).
   - Do đó, đối với các chuyến bay trong tương lai theo lịch trình, hệ thống tuân thủ **Quy tắc Ứng xử Trung thực (Never Invent an Aircraft)**: Để trống trường số đăng bạ thay vì tự động tạo ra một chuỗi đăng bạ giả mạo.
4. **Lan truyền Hủy chuyến Chưa áp dụng Multi-document Transaction:**
   - Khi chuyến bay bị hủy do thời tiết khẩn cấp, hàm `cancelBookingsForFlight` trong `FlightsService` quét và cập nhật hoàn tiền/giải phóng ghế cho từng đơn đặt vé theo vòng lặp tuần tự.
   - Do CSDL MongoDB trong Docker Compose vận hành ở chế độ Standalone (không phải Replica Set có cấu hình Oplog), cơ chế Session Transactions phân tán chưa được kích hoạt ở cấp độ cơ sở dữ liệu.
5. **Cổng thanh toán Trực tuyến Quốc tế (PayPal Sandbox Acceptance):**
   - Cổng PayPal Phase 1B được thiết kế an toàn, xác thực chặt chẽ và phòng vệ tài chính đầy đủ (`PAYPAL_ENABLED=false` mặc định trong cấu hình nộp bài). Việc kết nối tài khoản PayPal Sandbox trực tiếp được bảo lưu (DEFERRED) do chính sách hạn chế của nhà cung cấp dịch vụ đối với tài khoản cá nhân sinh viên.

---

## 4. HƯỚNG DẪN KHỞI CHẠY & KIỂM THỬ NHANH (QUICK START & TEST GUIDE)

### 4.1. Khởi chạy Hệ thống qua Docker Compose (Khuyên dùng)
Yêu cầu bật Docker Desktop, mở Terminal tại thư mục gốc dự án và chạy:
```bash
docker compose up --build
```
- **Cổng Web Portal (Khách hàng & Admin):** `http://localhost:4200`
- **Cổng Backend API:** `http://localhost:3000/api`
- **Cổng Database MongoDB (Docker Host Port):** `mongodb://localhost:27018/airline_db` (Container port 27017 được ánh xạ ra máy chủ host tại port 27018 để tránh xung đột với MongoDB nội bộ)

### 4.2. Khởi chạy Cục bộ từng Phân hệ (Development Mode)
1. **Khởi động MongoDB:** Cần có MongoDB lắng nghe tại cổng `27017` (hoặc `27018` nếu chạy container).
2. **Khởi động Backend:**
   ```bash
   cd backend
   npm install
   npm run start:dev
   ```
3. **Khởi động Frontend:**
   ```bash
   cd frontend
   npm install
   npm start
   ```
   Truy cập giao diện tại `http://localhost:4200`.

### 4.3. Thông tin Tài khoản Mặc định
Hệ thống tự động Seed tài khoản Quản trị Tối cao khi khởi động:
- **Tài khoản:** `superadmin`
- **Mật khẩu:** Cấu hình qua biến môi trường `SUPER_ADMIN_PASSWORD` trong file `.env` (mặc định môi trường dev: xem `.env.example`).
- **Email:** `superadmin@airline.com`
- **Quyền hạn:** `SUPER_ADMIN` (Toàn quyền quản trị chuyến bay, sân bay, đơn vé, phân quyền).

### 4.4. Kịch bản Kiểm thử Nghiệp vụ Chính (End-to-End Test Flows)
1. **Kiểm thử Mạng bay Thương mại & Lịch mẫu (Commercial Flights):**
   - Đăng nhập bằng `superadmin` ➔ Truy cập `/admin/commercial-flights`.
   - Tra cứu đường bay mạng lưới, kiểm tra lịch mẫu và quản lý mở rộng lịch bay 330 ngày.
   - Kiểm tra thông báo đồng bộ thành công các chuyến bay thật với giá vé chuẩn VND.
2. **Kiểm thử Tìm kiếm Chuyến bay & Giảm trừ theo Độ tuổi:**
   - Quay về Trang chủ `/` ➔ Chọn điểm đi `Hà Nội`, điểm đến `Hồ Chí Minh`.
   - Chọn số lượng: 1 Người lớn, 1 Trẻ em, 1 Người cao tuổi.
   - Kiểm tra bảng kết quả: Giá vé trẻ em giảm 25% (tính 75%), người cao tuổi giảm 15% (tính 85%).
3. **Kiểm thử Quy tắc Giữ chỗ 14 ngày (Blocking Gate):**
   - Đặt vé cho chuyến bay cách hiện tại $< 14$ ngày: Tùy chọn "Giữ chỗ" bị khóa cứng, chỉ được mua vé trực tiếp.
   - Đặt vé cho chuyến bay cách hiện tại $> 14$ ngày: Cho phép chọn Giữ chỗ miễn phí, sinh mã `BLK-XXXXXX`, hạn thanh toán hiển thị đúng bằng Ngày bay sớm nhất trừ 14 ngày.
4. **Kiểm thử Đổi vé (Reschedule) & Hủy vé (Cancel):**
   - Vào mục **Quản lý chuyến bay** (`/track`) ➔ Nhập mã `CNF-XXXXXX`.
   - Thử chức năng **"Đổi vé"**: Chọn chuyến bay mới, quan sát hệ thống tự tính số tiền chênh lệch và cấp mã `CNF` mới.
   - Thử chức năng **"Hủy vé"**: Hệ thống tra cứu bảng chính sách, hoàn tiền % tương ứng, sinh mã `CAN-XXXXXX` và trừ lại dặm bay SkyMiles.
5. **Kiểm thử Cập nhật Chuyến bay Khẩn cấp do Thời tiết xấu (Yêu cầu 1.2.3):**
   - Vào `/admin/flights` ➔ Chọn một chuyến bay đã có người đặt vé ➔ Bấm nút cập nhật khẩn cấp.
   - Chuyển trạng thái sang `CANCELLED` với lý do: *"Hủy chuyến do bão lớn tại Tân Sơn Nhất"*.
   - Kiểm tra vé của hành khách trên trang `/track`: Thẻ vé lập tức đổi màu cảnh báo đỏ, ghi nhận tự động hoàn tiền 100% và trạng thái vé chuyển thành `CANCELLED`.
