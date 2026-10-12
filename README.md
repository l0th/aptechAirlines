# Airline Reservation System (ARS) - Aptech Airlines Fullstack

Hệ thống Quản lý và Đặt vé Máy bay (ARS) mang thương hiệu **Aptech Airlines** - Giải pháp Fullstack đầy đủ gồm **Backend NestJS**, **Frontend Angular 21**, **Database MongoDB**, và **Containerization Docker** theo chuẩn đồ án eProject.

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
│   │   ├── scripts/    # Công cụ seed, migration và sửa dữ liệu quản trị
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

## 🖥️ Chạy trên máy mới (sau khi clone)

Database **không** nằm trong git (dữ liệu nằm trong Docker volume). Repo kèm sẵn bản chụp dữ liệu demo tại `database/snapshot/airline_db.archive.gz`.

```bash
git clone <repo> && cd <repo>
cp .env.example .env            # hoặc copy .env cũ, nhưng MONGO_URI phải là mongodb://mongodb:27017/airline_db
docker compose up -d --build
sh database/import-db.sh        # nạp dữ liệu demo (users, sân bay, chuyến bay, chính sách, giá ghế...)
docker compose restart backend
```

- Windows (PowerShell) thay bước import bằng: `Get-Content database/snapshot/airline_db.archive.gz -AsByteStream -Raw | docker exec -i ars-mongodb mongorestore --archive --gzip --drop --nsInclude "airline_db.*"` (hoặc chạy lệnh `sh` trong Git Bash).
- Cập nhật lại bản chụp sau khi sửa dữ liệu: `sh database/export-db.sh` rồi commit file `.archive.gz`.
- Lưu ý: `MONGO_URI=mongodb://host.docker.internal:27018/...` chỉ chạy trên Docker Desktop và dễ lỗi kết nối — luôn dùng `mongodb://mongodb:27017/airline_db` khi chạy bằng Docker Compose.
- `PAYPAL_ENABLED=true` cần internet + key sandbox hợp lệ; để demo offline đặt `false`.

## Chạy dự án bằng Docker

Docker Compose chỉ khởi chạy đúng 3 service: **MongoDB + Backend + Frontend**. MongoDB được tạo trống và lưu dữ liệu trong Docker volume; hệ thống **không tự bootstrap/seed dữ liệu nghiệp vụ** khi khởi động.

> **Frontend hiện hành:** repository này sử dụng giao diện mới trong `frontend/src/app/` (các component mới như `app.component.ts`, `shared/site-shell.component.ts`, các trang `pages/*.component.ts` và admin mới). Các component frontend cũ đã được loại khỏi source chính. Khi chạy hoặc build, luôn dùng `frontend/Dockerfile` / `frontend/package.json` hiện tại ở nhánh này; không khôi phục hoặc chạy lại bộ frontend cũ.

Copy `.env.example` thành `.env`, cấu hình `JWT_SECRET`, AirLabs/SMTP/PayPal nếu sử dụng, sau đó chạy:

```bash
docker compose up -d --build
```

- Frontend: `http://localhost:4200`
- Backend API: `http://localhost:3000/api`
- MongoDB cho MongoDB Compass/Admin: `mongodb://localhost:27018/airline_db`

Dữ liệu tài khoản, sân bay, chính sách, chuyến bay... được quản trị thủ công qua MongoDB Compass/Admin hoặc qua giao diện/API quản trị của hệ thống. Docker không tự chèn dữ liệu mẫu vào database.

Nếu muốn dùng MongoDB bên ngoài thay cho container đi kèm, chỉ cần đổi `MONGO_URI` trong `.env` sang connection string của MongoDB đó.

## 🚀 Hướng dẫn Chạy Hệ thống

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

---

## 📌 Tuyên bố Sẵn sàng Chấm Đồ án & Demo (Submission-Ready Disclaimer)
- **Tính trọn vẹn nghiệp vụ:** Toàn bộ các quy trình nghiệp vụ chính từ 3.1 đến 3.10 đã được cài đặt hoàn chỉnh (All major 3.1–3.10 workflows are implemented); riêng mục §3.3.4.1 được ghi nhận là một phần (**PARTIAL**) do hạng vé FIRST có thể chọn trên hợp đồng dữ liệu/giao diện tra cứu nhưng hiện tại không có cấu hình tàu bay nào trong catalog đội bay thương mại cung cấp khoang ghế FIRST vật lý có thể đặt chỗ (hệ thống khai thác các cấu hình 1, 2 và 3 hạng ghế trên 6 dòng tàu bay A20N, A21N, B789, A359, B738, AT76).
- **Thanh toán Trực tuyến Quốc tế:** Phân hệ PayPal Phase 1B được thiết kế phòng vệ tài chính đầy đủ, có cơ chế đối soát và hoàn tiền bồi hoàn. Cấu hình nộp đồ án để mặc định `PAYPAL_ENABLED=false` nhằm đảm bảo hệ thống tự vận hành độc lập không phụ thuộc tài khoản sandbox cá nhân sinh viên.
- **Dịch vụ Email nhắc nhở:** Được tích hợp chế độ `[MAIL:DEV-FALLBACK]`, tự động ghi nhận đầy đủ nội dung email nhắc giữ chỗ 3 tuần và thư báo hủy vé vào console log khi môi trường thử nghiệm không có máy chủ SMTP bên ngoài.
- **Bảo toàn dữ liệu hạt nhân:** Bản chụp MongoDB đi kèm giữ nguyên dữ liệu demo và tài khoản quản trị cần cho quá trình đánh giá.

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
