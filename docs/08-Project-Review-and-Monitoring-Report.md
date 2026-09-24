# HỆ THỐNG ĐẶT VÉ MÁY BAY - APTECH AIRLINES (ARS)
## BÁO CÁO ĐÁNH GIÁ & GIÁM SÁT TIẾN ĐỘ DỰ ÁN (PROJECT REVIEW AND MONITORING REPORT)
**Deliverable 08 - Hồ sơ Đồ án eProject Aptech**

---

## 1. TỔNG QUAN BÁO CÁO (EXECUTIVE SUMMARY)

Báo cáo Đánh giá và Giám sát Dự án (Project Review and Monitoring Report) là văn bản tổng hợp định kỳ phục vụ công tác quản lý chất lượng phần mềm theo tiêu chuẩn eProject của Aptech. Báo cáo phản ánh chân thực tiến độ thực hiện theo từng tuần, ghi nhận các khó khăn, lỗi kỹ thuật nghiêm trọng phát sinh trong quá trình tích hợp thực tế giữa Frontend và Backend, phân tích nguyên nhân gốc rễ (Root Cause) và các giải pháp kỹ thuật đã áp dụng triệt để để đưa hệ thống về trạng thái hoàn hảo 0 lỗi biên dịch, vận hành ổn định trên Docker.

---

## 2. THEO DÕI TIẾN ĐỘ THEO TUẦN (WEEKLY PROGRESS TRACKING)

```
Tuần 1 (Ngày 01 - 07) : Khảo sát, Đặc tả Yêu cầu & Thiết kế CSDL MongoDB + Chuẩn GUI
Tuần 2 (Ngày 08 - 14) : Phát triển Core Backend API, JWT Auth, RBAC & Lịch bay [STATUS MAIL 1]
Tuần 3 (Ngày 15 - 21) : Phát triển Frontend Angular 21, Đặt vé, Giữ chỗ 14 ngày & Sơ đồ ghế A321
Tuần 4 (Ngày 22 - 28) : Tích hợp AirLabs, Scheduler Cron, Fix Bugs Tích hợp [STATUS MAIL 2]
Giai đoạn cuối (29-30): Kiểm chuẩn Build 0 lỗi, Hoàn thiện Bộ Tài liệu eProject & Nghiệm thu
```

### 2.1. Tuần 1: Khảo sát, Phân tích Yêu cầu & Thiết kế Nền tảng (Ngày 01 – Ngày 07)
- **Công việc đã hoàn thành:**
  - Nghiên cứu toàn diện tài liệu đề bài `ProjectSpecification.txt` và `AirlinesReservationSystem.txt`.
  - Phân tích chi tiết 10 yêu cầu chức năng (3.1 - 3.10) và mục tiêu hệ thống (1.1 - 1.3).
  - Hoàn thiện tài liệu *Problem Definition* và *Customer Requirement Specification (CRS)*.
  - Thiết kế lược đồ thực thể quan hệ MongoDB (Users, Airports, Flights, Bookings, Policies).
  - Soạn thảo tài liệu *GUI Standards Document*: Chốt bảng màu thương hiệu Aviation Navy (`#0A2540`) & Royal Gold (`#D4AF37`), Typography Inter, quy chuẩn 100% Vector SVG không dùng Emoji.
- **Đánh giá tiến độ:** Hoàn thành 100% kế hoạch tuần 1.

### 2.2. Tuần 2: Xây dựng Backend Core API & Phân quyền (Ngày 08 – Ngày 14)
- **Công việc đã hoàn thành:**
  - Khởi tạo khung dự án NestJS Modular, kết nối MongoDB thông qua Mongoose ODM.
  - Xây dựng hệ thống xác thực JWT, mã hóa Bcrypt, phát triển `AuthGuard` và `RolesGuard`.
  - Thiết lập dịch vụ khởi tạo dữ liệu mẫu (`SeedService`): Khởi tạo tài khoản `SUPER_ADMIN` duy nhất và danh mục sân bay nội địa.
  - Phát triển CRUD Sân bay, thuật toán giải quyết tên thành phố (`resolveCity`) gợi ý sân bay lân cận (Hội An -> Đà Nẵng DAD 30km).
  - Phát triển CRUD Chuyến bay, thuật toán tìm kiếm tuyến bay nối chuyến (`findConnectingRoutes`).
  - Xây dựng API đặt vé cơ bản và công thức tính giá theo độ tuổi.
  - **Mốc kiểm soát Ngày 10:** Gửi **Status Mail #1** cho eProjects Team đúng hạn quy định.
- **Đánh giá tiến độ:** Đúng tiến độ, các API cốt lõi hoạt động ổn định trên Postman.

### 2.3. Tuần 3: Phát triển Frontend Web Portal & Nghiệp vụ Vé Nâng cao (Ngày 15 – Ngày 21)
- **Công việc đã hoàn thành:**
  - Khởi tạo Single Page Application với Angular 21 Standalone, cài đặt Tailwind CSS v3 và Lucide Icons.
  - Xây dựng Header/Navbar, dịch vụ đa ngôn ngữ `LanguageService` (chuyển đổi tức thì VI/EN) và Modal Đăng nhập/Đăng ký.
  - Phát triển Trang chủ tìm kiếm vé máy bay (`HomeComponent`) với datepicker và bộ chọn khách.
  - Phát triển Trang kết quả tìm kiếm (`FlightResultsComponent`) hiển thị thẻ chuyến bay 2 chiều và tuyến nối chuyến.
  - Phát triển Trang Đặt vé (`BookingComponent`) tích hợp quy tắc giữ chỗ > 14 ngày (Block) và xuất vé ngay (Buy).
  - Phát triển Modal Sơ đồ Ghế ngồi tương tác mô phỏng Airbus A321 với 31 hàng ghế và các hàng ghế đặc biệt.
  - Phát triển logic Backend cho việc xác nhận vé giữ chỗ (`confirmTicket`), đổi vé (`rescheduleTicket`) và hủy vé (`cancelTicket`).
- **Đánh giá tiến độ:** Hoàn thành khối lượng lớn giao diện người dùng; bắt đầu phát hiện các vấn đề xung đột khi tích hợp thực tế giữa 2 phân hệ.

### 2.4. Tuần 4: Tích hợp Dữ liệu Thực tế, Scheduler, Rà soát Lỗi & Đóng gói (Ngày 22 – Ngày 28)
- **Công việc đã hoàn thành:**
  - Tích hợp dịch vụ dữ liệu hàng không toàn cầu AirLabs API (`airlabs.co`) đồng bộ chuyến bay thật.
  - Xây dựng tác vụ định kỳ nền `@Cron` (`BookingsScheduler`): Tự động gửi email nhắc nhở trước 21 ngày cho vé giữ chỗ và tự hủy giải phóng ghế khi quá hạn 14 ngày.
  - Phát triển Trang Tra cứu và Quản lý vé toàn diện (`TrackBookingComponent`): Hỗ trợ hủy vé tính % tiền hoàn, đổi vé tính bù trừ giá và xác nhận vé giữ chỗ.
  - Phát triển Trang Tra cứu chuyến bay công khai (`FlightLookupComponent`) và trang SkyMiles.
  - Phát triển toàn diện 7 trang của Cổng Quản trị Admin/Clerk (`/admin/*`).
  - Viết Dockerfile đa tầng và cấu hình Nginx Reverse Proxy trong `docker-compose.yml`.
  - Rà soát, chẩn đoán và khắc phục toàn bộ các lỗi tích hợp kỹ thuật (chi tiết ở Mục 3).
  - **Mốc kiểm soát Ngày 27:** Gửi **Status Mail #2** cho eProjects Team báo cáo kết quả kiểm thử.
- **Đánh giá tiến độ:** Hoàn tất 100% các tính năng nghiệp vụ.

### 2.5. Giai đoạn Hoàn thiện: Kiểm chuẩn Kỹ thuật & Bàn giao Đồ án (Ngày 29 – Ngày 30)
- **Công việc đã hoàn thành:**
  - Biên dịch kiểm tra toàn bộ mã nguồn Backend (`tsc --noEmit` / `nest build`) và Frontend (`ng build`): Đạt kết quả **0 lỗi, 0 cảnh báo**.
  - Hoàn thiện trọn bộ hồ sơ tài liệu eProject (00 đến 09) trong thư mục `docs/`.
  - Kiểm tra cú pháp cấu hình triển khai Docker Compose (`docker compose config`: PASS, đóng gói container trực tiếp chưa thực thi trên máy chấm: NOT EXECUTED).
  - Chuẩn bị slide báo cáo và kịch bản demo bảo vệ trước Hội đồng chấm đồ án Aptech.

---

## 3. CÁC VẤN ĐỀ KỸ THUẬT PHÁT HIỆN & BIỆN PHÁP XỬ LÝ TRIỆT ĐỂ (ISSUES & RESOLUTIONS)

Trong quá trình ghép nối giữa Frontend Angular 21 và Backend NestJS, đội ngũ phát triển đã phát hiện 6 vấn đề kỹ thuật trọng yếu và đã áp dụng các biện pháp xử lý chuẩn mực:

### Vấn đề 1: Lệch pha Hợp đồng Dữ liệu API (API Contract Mismatch) tại Endpoint Tra cứu Vé
- **Hiện tượng lỗi:** Khi gọi API `GET /api/bookings/track/:code`, giao diện Angular bị trắng trang hoặc không hiển thị được hành trình bay, mặc dù Backend phản hồi HTTP 200 OK.
- **Nguyên nhân gốc rễ:** Backend trả về cấu trúc bao bọc (Envelope) gồm `{ booking_info, has_emergency_changes, flight_coupons }`. Trong đó `flight_coupons` được tạo bằng cách toán tử spread `{ ...coupon, origin_iata, dest_iata, ... }` trên đối tượng Mongoose Subdocument, khiến các thuộc tính gốc (`flight_number`, `leg_type`) bị ẩn trong thuộc tính nội bộ `_doc` của Mongoose.
- **Biện pháp xử lý triệt để:**
  - Tại Frontend (`TrackBookingComponent`): Định nghĩa lại giao diện cục bộ `TrackBookingEnvelope` và `LocalBooking`.
  - Lấy danh sách chặng bay và số hiệu chuyến bay trực tiếp từ `booking_info.ticket_coupons` (dữ liệu sạch đã serialize).
  - Chỉ sử dụng mảng `flight_coupons` để tra cứu bổ sung thông tin làm giàu thời gian thực (giờ bay thực tế, trạng thái hoãn/hủy). Nhờ đó giao diện hiển thị mượt mà 100% chi tiết vé.

---

### Vấn đề 2: Cơ chế Bảo mật Angular chặn hiển thị Biểu tượng Vector SVG (SVG Sanitization)
- **Hiện tượng lỗi:** Một số icon SVG khi render động qua chỉ thị `[innerHTML]="svgContent"` bị Angular Security Framework tự động lọc bỏ (sanitize) do nghi ngờ chứa mã độc XSS, dẫn đến icon bị mất hình hoặc hiển thị ô trống.
- **Nguyên nhân gốc rễ:** Angular kích hoạt mặc định trình quét `DomSanitizer` để bảo vệ ứng dụng trước các cuộc tấn công nhúng mã HTML/SVG nguy hại.
- **Biện pháp xử lý triệt để:**
  - Loại bỏ hoàn toàn việc lưu trữ hoặc nhúng chuỗi SVG thô qua `[innerHTML]`.
  - Chuẩn hóa toàn bộ hệ thống biểu tượng bằng cách tích hợp thư viện chính quy `lucide-angular`.
  - Xây dựng component độc lập `IconComponent` (`shared/components/icon`), khai báo rõ danh mục icon hàng không được phép (`plane`, `ticket`, `calendar`, `clock`, `armchair`, `creditcard`,...). Đảm bảo an toàn bảo mật tuyệt đối và hiển thị sắc nét chuẩn Vector.

---

### Vấn đề 3: Dữ liệu Máy bay và Sức chứa Ghế bị Fictitious (Dữ liệu Ảo)
- **Hiện tượng lỗi:** Ban đầu hệ thống gán cứng dữ liệu chuyến bay với các số hiệu máy bay ngẫu nhiên, không khớp với thực tế vận hành hàng không và không thể hiện được chủng loại máy bay thực.
- **Nguyên nhân gốc rễ:** Chưa kết nối nguồn dữ liệu hàng không thời gian thực.
- **Biện pháp xử lý triệt để:**
  - Tích hợp dịch vụ AirLabs REST API (`airlabs.co`) tại module `FlightsService.syncFromAirLabs()`.
  - Trích xuất thông tin mã tàu bay ICAO (`aircraft_icao`), tự động nhận diện và chuẩn hóa tên dòng máy bay (ví dụ: `A321` -> `Airbus A321`, `B787` -> `Boeing 787`).
  - Tính toán tổng sức chứa thực tế dựa trên cấu hình các khoang vé (`inventories`), giúp thông tin hiển thị trên sơ đồ ghế và thẻ chuyến bay hoàn toàn chính xác.

---

### Vấn đề 4: Xung đột Đơn vị Tiền tệ (USD vs VND) gây Nhầm lẫn Giá vé
- **Hiện tượng lỗi:** Một số bảng dữ liệu hiển thị giá vé theo đơn vị USD (ví dụ: 150 USD), trong khi dữ liệu đồng bộ hoặc người dùng Việt Nam lại quen thuộc với tiền tệ VND (hàng triệu đồng), dẫn đến việc tính toán bù trừ tiền vé hoặc hiển thị bị lệch hàng chục nghìn lần.
- **Nguyên nhân gốc rễ:** Sự không nhất quán trong việc định nghĩa kiểu dữ liệu giá vé giữa các module sơ khai.
- **Biện pháp xử lý triệt để:**
  - Thống nhất chuẩn hóa toàn bộ hệ thống theo thang tiền tệ **VND (Việt Nam Đồng)**.
  - Cấu hình các chuyến bay đồng bộ từ AirLabs có mức giá vé chuẩn: 1.250.000đ cho hạng Phổ thông (Economy), 2.950.000đ cho hạng Thương gia (Business), 4.200.000đ cho hạng Nhất (First Class).
  - Xây dựng pipe dùng chung `CurrencyFormatPipe` trên Angular hỗ trợ tự động format dấu phân cách hàng nghìn (ví dụ: `1.250.000 ₫`) và tương thích hiển thị theo ngôn ngữ được chọn.

---

### Vấn đề 5: Lỗ hổng Phân quyền & Nguy cơ Xóa nhầm Tài khoản SUPER_ADMIN
- **Hiện tượng lỗi:** Trong thử nghiệm ban đầu, một Admin thông thường có thể vô tình gửi lệnh `DELETE /api/users/:id` nhắm vào tài khoản quản trị tối cao, hoặc tạo thêm một tài khoản mang quyền `SUPER_ADMIN`.
- **Nguyên nhân gốc rễ:** Chưa thiết lập các chốt chặn bất biến (Immutability Guards) ở tầng xử lý nghiệp vụ sâu.
- **Biện pháp xử lý triệt để:**
  - Cài đặt 3 lớp bảo vệ nghiêm ngặt trong `UsersService`:
    1. Chặn tạo mới: Nếu DTO truyền vào `role === 'SUPER_ADMIN'`, ném lỗi `ForbiddenException` ngay lập tức.
    2. Chặn cập nhật: Không cho phép đổi quyền của tài khoản `superadmin` sang role khác, và không cho phép bất kỳ ai nâng cấp lên `SUPER_ADMIN`.
    3. Chặn xóa: Kiểm tra nếu tài khoản mang role `SUPER_ADMIN` thì từ chối thao tác xóa với thông báo lỗi rõ ràng.
  - Bổ sung cơ chế `assertOwnership` trong `BookingsService`: Hành khách có role `CUSTOMER` chỉ được phép đổi/hủy vé của chính mình, ngăn chặn hành vi can thiệp trái phép vào đơn vé của người khác.

---

### Vấn đề 6: Nguy cơ Đặt trùng Ghế (Race Condition / Overbooking) khi Nhiều Phiên Truy cập
- **Hiện tượng lỗi:** Khi hai hành khách cùng tiến hành đặt những chiếc ghế cuối cùng của chuyến bay cùng một lúc, có khả năng cả hai đều đặt thành công, khiến số ghế khả dụng bị âm.
- **Nguyên nhân gốc rễ:** Sử dụng thao tác kiểm tra số ghế (Read) rồi cập nhật (Write) tách rời nhau trong ứng dụng không có khóa giao dịch.
- **Biện pháp xử lý triệt để:**
  - Chuyển toàn bộ thao tác trừ ghế sang phương thức nguyên tử `reserveSeats()` trong `FlightsService`.
  - Sử dụng toán tử nguyên tử cấp cơ sở dữ liệu của MongoDB:
    ```typescript
    await this.flightModel.findOneAndUpdate(
      {
        _id: flightId,
        inventories: { $elemMatch: { _id: inventoryId, available_seats: { $gte: count } } }
      },
      { $inc: { 'inventories.$.available_seats': -count } },
      { new: true }
    );
    ```
  - Nếu kết quả trả về `null` (không đủ ghế hoặc đã bị phiên khác lấy mất), hệ thống lập tức từ chối và thông báo hết chỗ, đảm bảo không bao giờ xảy ra tình trạng bán vượt quá công suất máy bay.

---

## 4. SỐ LIỆU KIỂM CHỨNG CHẤT LƯỢNG (QUALITY VERIFICATION METRICS)

| Tiêu chí kiểm chuẩn | Công cụ kiểm tra | Tiêu chuẩn chất lượng eProject | Kết quả thực tế đạt được | Đánh giá |
| :--- | :--- | :--- | :--- | :--- |
| **Biên dịch Backend** | `tsc --noEmit` / `nest build` | Không có bất kỳ lỗi cú pháp hoặc lỗi kiểu dữ liệu nào. | **0 Errors, 0 Warnings** | **ĐẠT** |
| **Biên dịch Frontend** | `ng build --configuration production` | Bản build AOT (Ahead-of-Time) hoàn tất, không lỗi template, không lỗi type. | **Build Succeeded (0 Errors)** | **ĐẠT** |
| **Kiểm thử Đơn vị & Tích hợp** | Jest Automated Test Runner (`npm test`) | Kịch bản kiểm thử các module (AirLabs, Bookings, Concurrency, Flights, Seat Allocation, Analytics, Auth, Policies, Distance, Seed Verifier) thành công. | **33 / 33 Suites Passed (790 Tests Passed)** | **ĐẠT** |
| **Hệ thống Dữ liệu Thử nghiệm** | `npm run seed:e2e` (Idempotent Upsert) | Khởi tạo đầy đủ 4 User E2E, 12 Sân bay tham chiếu, 16 Chuyến bay động (+5d đến +35d), sơ đồ ghế vật lý và 3 Booking mẫu. | **Hoàn thành (Idempotent)** | **ĐẠT** |
| **Cấu hình Container** | `docker compose config` | Kiểm tra cú pháp và liên kết cấu hình 3 services (MongoDB, Backend, Frontend). | **PASS (Cú pháp hợp lệ)** | **ĐẠT** |
| **Đóng gói Container Thực tế** | `docker compose up --build` | Khởi chạy container trực tiếp trên môi trường máy chủ. | **NOT EXECUTED (Chưa thực thi trực tiếp trên máy chấm)** | **CHƯA THỰC THI** |
| **Quy chuẩn Giao diện** | Visual & Code Audit | Bảng màu Navy/Gold, nút bo tròn viên thuốc, 100% Vector SVG không emoji, hỗ trợ song ngữ VI/EN. | **Tuân thủ theo tài liệu GUI Standards** | **ĐẠT** |
| **Tính toàn vẹn Dữ liệu** | Unit & Integration Invariant Tests | Kho ghế được trừ chính xác, khóa chống trùng lặp, dặm bay SkyMiles được cộng/trừ đúng nghiệp vụ. | **Khớp dữ liệu theo kiểm thử tự động** | **ĐẠT** |

---

## 5. ĐÁNH GIÁ RỦI RO CÒN LẠI & KHUYẾN NGHỊ (RESIDUAL RISKS & RECOMMENDATIONS)

### 5.1. Các rủi ro còn lại (Residual Risks)
1. **Phụ thuộc Hạn ngạch API AirLabs:** Tài khoản miễn phí (Free Tier) của dịch vụ AirLabs có giới hạn số lượng request mỗi tháng. Nếu ứng dụng có lượng truy cập đột biến trong buổi bảo vệ đồ án, có thể chạm ngưỡng giới hạn.  
   *Khuyến nghị giải pháp dự phòng:* Hệ thống đã trang bị sẵn cơ chế nạp dữ liệu cục bộ và tính năng quản lý mạng lưới bay thương mại độc lập trên `/admin/commercial-flights`.
2. **Cổng thanh toán Trực tuyến Quốc tế (PayPal Sandbox):** Hệ thống đã hoàn tất toàn bộ kiến trúc tài chính Phase 1B (Reconciliation, Idempotency, Compensation Refund, Snapshotting). Chế độ mặc định nộp bài đặt `PAYPAL_ENABLED=false`.
   *Xác nhận nghiệm thu:* **Real PayPal Sandbox provider acceptance: DEFERRED / NOT EXECUTED. Pending Sandbox credentials and manual provider flow.** Mã nguồn đã được covered by automated PayPal integration/hardening tests và bộ 132 bài test tự động (`payment-phase-1b.spec.ts`). Trong môi trường sản xuất thương mại, cấu hình `PAYPAL_CLIENT_ID` và `PAYPAL_CLIENT_SECRET` của tài khoản doanh nghiệp (Business Account) để bật `PAYPAL_ENABLED=true`.

### 5.2. Khuyến nghị Nâng cấp cho các Phiên bản Tiếp theo
- **Mở rộng thuật toán nối chuyến:** Nâng cấp thuật toán `findConnectingRoutes` để hỗ trợ tìm kiếm hành trình có 2 điểm dừng (Double Layovers) cho các tuyến bay quốc tế dài.
- **Bộ nhớ đệm Redis (In-Memory Cache):** Triển khai thêm Redis Cache phía trước MongoDB để lưu trữ kết quả các truy vấn tìm kiếm chuyến bay phổ biến (như Hà Nội - Sài Gòn, Hà Nội - Đà Nẵng) nhằm giảm tải cho CSDL và hạ thời gian phản hồi xuống dưới 50ms.
- **Tích hợp thông báo qua WebSockets:** Xây dựng kênh thông báo thời gian thực (Real-time Socket) để đẩy thông báo thay đổi trạng thái hoãn/hủy chuyến bay trực tiếp lên màn hình của hành khách đang online.
