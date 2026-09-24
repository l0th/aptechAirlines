# Airline Reservation System (ARS) - Aptech Airlines Fullstack

Hệ thống Quản lý và Đặt vé Máy bay (ARS) mang thương hiệu **Aptech Airlines** - Giải pháp Fullstack toàn diện gồm **Backend NestJS**, **Frontend Angular 21**, **Database MongoDB**, và **Containerization Docker** theo chuẩn đồ án eProject.

---

## 🛠️ Công nghệ & Kiến trúc
- **Backend Framework:** NestJS (TypeScript)
- **Frontend Framework:** Angular 21 (Standalone Components, Signals, Reactive Forms)
- **Styling & Design System:** Tailwind CSS v3, Typography Inter, Bảng màu Aviation Navy (`#0A2540`) & Royal Gold (`#D4AF37`), Nút dạng viên thuốc (`rounded-full`).
- **Iconography:** 100% Vector SVG sắc nét qua thư viện `lucide-angular` (Tuyệt đối không dùng Emoji).
- **Database:** MongoDB (Mongoose ODM)
- **Live Flight Data:** Tích hợp AirLabs API (`airlabs.co`) đồng bộ lịch trình chuyến bay thực tế.
- **Containerization:** Docker & Docker Compose orchestrate toàn bộ MongoDB + Backend + Frontend (Nginx).
- **Kiến trúc Module khép kín (Self-contained):** Mỗi module chứa trọn bộ `controller`, `service`, `schema (model)`, `dto`, `guard`.

---

## 📂 Cấu trúc Thư mục Hệ thống
```
đồ án/
├── backend/            # NestJS Backend API
│   ├── src/
│   │   ├── auth/       # Đăng nhập, đăng ký, JWT, Guard, Roles
│   │   ├── users/      # Quản lý tài khoản, hồ sơ, SkyMiles, bảo vệ SUPER_ADMIN
│   │   ├── airports/   # Quản lý sân bay, thành phố, tìm kiếm sân bay lân cận
│   │   ├── flights/    # Quản lý chuyến bay, giá vé, ghế ngồi, Seat Map, AirLabs Sync & Commercial Schedules
│   │   ├── analytics/  # Phân hệ Báo cáo Doanh thu & Tải trọng chuyến bay (Executive Dashboard & Capacity)
│   │   ├── policies/   # Quản lý quy tắc hủy vé & % hoàn tiền linh hoạt
│   │   ├── bookings/   # Giữ chỗ (Rule > 14 ngày), mua vé, đổi vé, hủy vé, tra cứu
│   │   ├── seat-allocation/ # Quản lý ghế vật lý, đặt trước chỗ ngồi & phụ phí
│   │   ├── scripts/    # Safe Deterministic E2E Demo Seed Script (seed-e2e-demo.ts)
│   │   ├── seed/       # Tự động nạp sân bay, chính sách & SUPER_ADMIN duy nhất
│   │   ├── app.module.ts
│   │   └── main.ts
│   └── Dockerfile
├── frontend/           # Angular 21 Standalone SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── admin/  # Portal Quản trị (Dashboard, Commercial Flights, Flights, Analytics, Reservation Desk, Airports, Users, Bookings, Policies, Seat Pricing/Ops)
│   │   │   ├── pages/  # Portal Khách hàng (Home Search, Results, Booking, Success, Track/My Trips, SkyMiles, Public Lookup)
│   │   │   ├── shared/ # Components dùng chung (Navbar, Footer, Sơ đồ Ghế Đa Đội bay Multi-Aircraft Seat Map, Auth Modal, Toast, Icon SVG)
│   │   │   └── core/   # Services (ApiService, AuthService, LanguageService), Guards, Interceptors, Models
│   │   ├── index.html
│   │   └── styles.css
│   ├── nginx.conf
│   └── Dockerfile
├── GUI_Standards_Document.md # Tài liệu Quy chuẩn Thiết kế Giao diện người dùng
├── docs/                     # Trọn bộ 12 tài liệu thiết kế và kiểm thử eProject (00 - 09)
└── docker-compose.yml        # Orchestration MongoDB + Backend + Frontend
```

---

## 🔐 Tài khoản Đăng nhập Hệ thống & Dữ liệu E2E Demo

### 1. Tài khoản Quản trị Tối cao (SUPER_ADMIN)
Hệ thống tự động khởi tạo duy nhất **1 tài khoản `SUPER_ADMIN`** khi khởi động lần đầu:
- **Username:** `superadmin`
- **Password:** Được cấu hình qua biến môi trường `SUPER_ADMIN_PASSWORD` trong file `.env` (mặc định môi trường phát triển cục bộ: xem file `.env` bị bỏ qua bởi Git).
- **Email:** `superadmin@airline.com`
- **Quy tắc bảo vệ:** 
  - ❌ **Không thể xóa** tài khoản `SUPER_ADMIN`.
  - ❌ **Không thể tạo thêm** bất kỳ tài khoản nào mang role `SUPER_ADMIN`.

### 2. Bộ Dữ liệu Thử nghiệm An toàn (Safe Deterministic E2E Dataset)
Hệ thống tích hợp sẵn script nạp dữ liệu kiểm thử tự động, an toàn và lũy thừa (Idempotent):
```bash
# Nạp dữ liệu kiểm thử E2E (Tạo 4 user, 12 sân bay, 16 chuyến bay thương mại, sơ đồ ghế, booking mẫu)
npm run seed:e2e --prefix backend

# Dọn dẹp dữ liệu E2E sau khi kiểm thử (Bảo vệ dữ liệu thật và tài khoản SUPER_ADMIN)
npm run seed:e2e:cleanup --prefix backend
```

**Danh sách tài khoản E2E (Mật khẩu chung: `E2ePass@2026`):**
- **Khách hàng thường (CUSTOMER):** `e2e_customer`
- **Khách hàng VIP Hạng Vàng (CUSTOMER Gold):** `e2e_customer_gold`
- **Nhân viên Quầy vé (CLERK):** `e2e_clerk`
- **Quản trị viên (ADMIN):** `e2e_admin`

---

## 🚀 Hướng dẫn Chạy Hệ thống & Kiểm thử

### Cách 1: Chạy toàn bộ qua Docker Compose (Khuyên dùng)
Yêu cầu bật Docker Desktop, sau đó chạy lệnh tại thư mục gốc:
```bash
docker compose up --build
```
- **Cổng Frontend (Web Portal):** `http://localhost:4200`
- **Cổng Backend API:** `http://localhost:3000/api`
- **Cổng Database MongoDB (Docker Host Port):** `mongodb://localhost:27018/airline_db` (Container port 27017 được map sang host port 27018 để tránh xung đột cổng với MongoDB nội bộ máy phát triển)

### Cách 2: Chạy cục bộ từng phân hệ (Development Mode)
1. **Khởi động Backend:**
   ```bash
   cd backend
   npm install
   npm run seed:e2e     # Nạp dữ liệu chuyến bay và người dùng thử nghiệm
   npm run start:dev
   ```
   Backend lắng nghe tại `http://localhost:3000/api`. Kết nối MongoDB mặc định tại `mongodb://localhost:27017/airline_db`.

2. **Khởi động Frontend:**
   ```bash
   cd frontend
   npm install
   npm start
   ```
   Truy cập giao diện tại `http://localhost:4200`.

### Chạy Toàn bộ Bộ Kiểm thử Tự động (Automated Unit Tests)
```bash
cd backend
npm test
```
- **Kết quả:** **33 Test Suites passed, 790 Tests passed (100% PASS)** trong ~15 - 25 giây.

---

## 📌 Tuyên bố Sẵn sàng Chấm Đồ án & Demo (Submission-Ready Disclaimer)
- **Tính trọn vẹn nghiệp vụ:** Toàn bộ các quy trình nghiệp vụ chính từ 3.1 đến 3.10 đã được cài đặt hoàn chỉnh (All major 3.1–3.10 workflows are implemented); riêng mục §3.3.4.1 được ghi nhận là một phần (**PARTIAL**) do hạng vé FIRST có thể chọn trên hợp đồng dữ liệu/giao diện tra cứu nhưng hiện tại không có cấu hình tàu bay nào trong catalog đội bay thương mại cung cấp khoang ghế FIRST vật lý có thể đặt chỗ (hệ thống khai thác các cấu hình 1, 2 và 3 hạng ghế trên 6 dòng tàu bay A20N, A21N, B789, A359, B738, AT76).
- **Thanh toán Trực tuyến Quốc tế:** Phân hệ PayPal Phase 1B được thiết kế phòng vệ tài chính đầy đủ, có cơ chế đối soát và hoàn tiền bồi hoàn. Cấu hình nộp đồ án để mặc định `PAYPAL_ENABLED=false` nhằm đảm bảo hệ thống tự vận hành độc lập không phụ thuộc tài khoản sandbox cá nhân sinh viên.
- **Dịch vụ Email nhắc nhở:** Được tích hợp chế độ `[MAIL:DEV-FALLBACK]`, tự động ghi nhận đầy đủ nội dung email nhắc giữ chỗ 3 tuần và thư báo hủy vé vào console log khi môi trường thử nghiệm không có máy chủ SMTP bên ngoài.
- **Bảo toàn dữ liệu hạt nhân:** Script `npm run seed:e2e` hoạt động lũy thừa (Idempotent), tuyệt đối không xóa hoặc ghi đè tài khoản `SUPER_ADMIN` nguyên thủy.

---

## 📡 Danh sách API Endpoint chính

### 1. Authentication (`/api/auth`)
- `POST /api/auth/login`: Đăng nhập (trả về JWT access_token và thông tin user).
- `POST /api/auth/register`: Đăng ký hành khách mới (tự gán role CUSTOMER, sky_miles = 0).
- `GET /api/auth/me`: Lấy thông tin user hiện tại (yêu cầu Bearer Token).

### 2. Sân bay & Thành phố (`/api/airports`) - Full CRUD
- `GET /api/airports`: Danh sách tất cả sân bay.
- `GET /api/airports/resolve?city=...`: Tìm kiếm thành phố và gợi ý sân bay gần nhất nếu không có tuyến trực tiếp.
- `GET /api/airports/:iata`: Chi tiết sân bay.
- `POST /api/airports`: Thêm mới sân bay (Admin).
- `PUT /api/airports/:iata`: Sửa thông tin sân bay (Admin).
- `DELETE /api/airports/:iata`: Xóa sân bay (Admin).

### 3. Chuyến bay & Lịch trình (`/api/flights`) - Full CRUD
- `GET /api/flights/search`: Tra cứu chuyến bay (1 chiều / khứ hồi, lọc ngày, hạng ghế, số khách, tự động tìm tuyến nối chuyến nếu không có bay thẳng).
- `GET /api/flights`: Danh sách chuyến bay quản trị.
- `GET /api/flights/:id`: Chi tiết chuyến bay, danh sách ghế theo hạng.
- `GET /api/flights/commercial-templates`: Danh sách khung lịch bay thương mại định kỳ.
- `POST /api/flights`: Tạo chuyến bay mới (Admin).
- `PUT /api/flights/:id`: Sửa thông tin chuyến bay (Admin).
- `PATCH /api/flights/:id/status`: Cập nhật trạng thái khẩn cấp (SCHEDULED, DELAYED, CANCELLED do thời tiết) kèm lý do.
- `DELETE /api/flights/:id`: Xóa chuyến bay.

### 4. Báo cáo Quản trị & Phân tích Tải trọng (`/api/analytics`)
- `GET /api/analytics/overview`: Thống kê tổng quan doanh thu, tỷ lệ hủy vé, tỷ lệ đổi vé, phân loại cabin, độ tuổi khách và top tuyến bay đông nhất (Admin).
- `GET /api/analytics/capacity`: Báo cáo tỷ lệ lấp đầy ghế (Load Factor), phân tích công suất khoang ghế các chuyến bay tương lai (Admin).

### 5. Chính sách Hủy vé (`/api/policies`) - Full CRUD
- `GET /api/policies`: Bảng quy tắc % hoàn tiền theo ngày.
- `POST /api/policies`: Tạo quy tắc mới.
- `PUT /api/policies/:id`: Sửa quy tắc.
- `DELETE /api/policies/:id`: Xóa quy tắc.

### 6. Đặt vé & Nghiệp vụ vé (`/api/bookings`)
- `POST /api/bookings`: Đặt vé (Customer tự đặt hoặc Clerk đặt trợ giúp tại quầy / qua điện thoại):
  - Nếu `is_block = true`: Kiểm tra ngày bay > 14 ngày, sinh mã `BLK-XXXXXX`, trừ ghế trống.
  - Nếu `is_block = false`: Mua ngay, trừ tiền thẻ, sinh mã `CNF-XXXXXX`, cộng dặm bay `sky_miles`.
- `POST /api/bookings/confirm`: Xác nhận vé đã giữ trước hạn 14 ngày (thanh toán thẻ, chuyển trạng thái, cộng dặm bay).
- `POST /api/bookings/reschedule`: Đổi vé đã Confirmed sang chuyến mới (tính chênh lệch giá, cập nhật ghế 2 chuyến, cấp mã xác nhận mới).
- `POST /api/bookings/cancel`: Hủy vé (Nếu vé Confirmed: tính % tiền hoàn theo ngày hủy, hoàn tiền thẻ, trừ lại dặm bay).
- `GET /api/bookings/track/:code`: Tra cứu thông tin vé bằng mã Giữ chỗ, mã Xác nhận hoặc PNR (nêu rõ và làm nổi bật chuyến bay bị trễ/hủy).
- `GET /api/bookings`: Xem tất cả đơn đặt vé (Admin/Clerk).

### 7. Người dùng (`/api/users`) - Full CRUD
- `GET /api/users`: Danh sách người dùng (tìm kiếm, lọc theo role).
- `GET /api/users/:id`: Chi tiết người dùng.
- `POST /api/users`: Tạo tài khoản (Admin tạo Clerk/Customer, chặn tạo thêm SUPER_ADMIN).
- `PUT /api/users/:id`: Sửa thông tin cá nhân, cập nhật quyền (chặn nâng quyền thành SUPER_ADMIN).
- `DELETE /api/users/:id`: Xóa người dùng (chặn xóa SUPER_ADMIN).
