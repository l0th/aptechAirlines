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
│   │   ├── flights/    # Quản lý chuyến bay, giá vé, ghế ngồi, Seat Map, AirLabs Sync
│   │   ├── policies/   # Quản lý quy tắc hủy vé & % hoàn tiền linh hoạt
│   │   ├── bookings/   # Giữ chỗ (Rule > 14 ngày), mua vé, đổi vé, hủy vé, tra cứu
│   │   ├── seed/       # Tự động nạp sân bay, chính sách & SUPER_ADMIN duy nhất
│   │   ├── app.module.ts
│   │   └── main.ts
│   └── Dockerfile
├── frontend/           # Angular 21 Standalone SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── admin/  # Portal Quản trị (Dashboard, Flights, AirLabs Sync, Airports, Users, Bookings, Policies)
│   │   │   ├── pages/  # Portal Khách hàng (Home Search, Results, Booking, Success, Track/My Trips, SkyMiles)
│   │   │   ├── shared/ # Components dùng chung (Navbar, Footer, Seat Map Airbus A321, Auth Modal, Toast)
│   │   │   └── core/   # Services (ApiService, AuthService, LanguageService), Guards, Interceptors, Models
│   │   ├── index.html
│   │   └── styles.css
│   ├── nginx.conf
│   └── Dockerfile
├── GUI_Standards_Document.md # Tài liệu Quy chuẩn Thiết kế Giao diện người dùng
└── docker-compose.yml        # Orchestration MongoDB + Backend + Frontend
```

---

## 🔐 Tài khoản Quản trị Tối cao (SUPER_ADMIN)
Hệ thống tự động khởi tạo duy nhất **1 tài khoản `SUPER_ADMIN`** khi khởi động lần đầu:
- **Username:** `superadmin`
- **Password:** `SuperAdmin@2026`
- **Email:** `superadmin@airline.com`
- **Quy tắc bảo vệ:** 
  - ❌ **Không thể xóa** tài khoản `SUPER_ADMIN`.
  - ❌ **Không thể tạo thêm** bất kỳ tài khoản nào mang role `SUPER_ADMIN`.

---

## 🚀 Hướng dẫn Chạy Hệ thống

### Cách 1: Chạy toàn bộ qua Docker Compose (Khuyên dùng)
Yêu cầu bật Docker Desktop, sau đó chạy lệnh tại thư mục gốc:
```bash
docker compose up --build
```
- **Cổng Frontend (Web Portal):** `http://localhost:4200`
- **Cổng Backend API:** `http://localhost:3000/api`
- **Cổng Database MongoDB:** `localhost:27017`

### Cách 2: Chạy cục bộ từng phân hệ (Development Mode)
1. **Khởi động Backend:**
   ```bash
   cd backend
   npm install
   npm run start:dev
   ```
   Backend lắng nghe tại `http://localhost:3000/api`.

2. **Khởi động Frontend:**
   ```bash
   cd frontend
   npm install
   npm start
   ```
   Truy cập giao diện tại `http://localhost:4200`.

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
- `POST /api/flights`: Tạo chuyến bay mới (Admin).
- `PUT /api/flights/:id`: Sửa thông tin chuyến bay (Admin).
- `PATCH /api/flights/:id/status`: Cập nhật trạng thái khẩn cấp (SCHEDULED, DELAYED, CANCELLED do thời tiết) kèm lý do.
- `DELETE /api/flights/:id`: Xóa chuyến bay.

### 4. Chính sách Hủy vé (`/api/policies`) - Full CRUD
- `GET /api/policies`: Bảng quy tắc % hoàn tiền theo ngày.
- `POST /api/policies`: Tạo quy tắc mới.
- `PUT /api/policies/:id`: Sửa quy tắc.
- `DELETE /api/policies/:id`: Xóa quy tắc.

### 5. Đặt vé & Nghiệp vụ vé (`/api/bookings`)
- `POST /api/bookings`: Đặt vé:
  - Nếu `is_block = true`: Kiểm tra ngày bay > 14 ngày, sinh mã `BLK-XXXXXX`, trừ ghế trống.
  - Nếu `is_block = false`: Mua ngay, trừ tiền thẻ, sinh mã `CNF-XXXXXX`, cộng dặm bay `sky_miles`.
- `POST /api/bookings/confirm`: Xác nhận vé đã giữ trước hạn 14 ngày (thanh toán thẻ, chuyển trạng thái, cộng dặm bay).
- `POST /api/bookings/reschedule`: Đổi vé đã Confirmed sang chuyến mới (tính chênh lệch giá, cập nhật ghế 2 chuyến, cấp mã xác nhận mới).
- `POST /api/bookings/cancel`: Hủy vé (Nếu vé Confirmed: tính % tiền hoàn theo ngày hủy, hoàn tiền thẻ, trừ lại dặm bay).
- `GET /api/bookings/track/:code`: Tra cứu thông tin vé bằng mã Giữ chỗ, mã Xác nhận hoặc PNR (nêu rõ và làm nổi bật chuyến bay bị trễ/hủy).
- `GET /api/bookings`: Xem tất cả đơn đặt vé (Admin/Clerk).

### 6. Người dùng (`/api/users`) - Full CRUD
- `GET /api/users`: Danh sách người dùng (tìm kiếm, lọc theo role).
- `GET /api/users/:id`: Chi tiết người dùng.
- `POST /api/users`: Tạo tài khoản (Admin tạo Clerk/Customer, chặn tạo thêm SUPER_ADMIN).
- `PUT /api/users/:id`: Sửa thông tin cá nhân, cập nhật quyền (chặn nâng quyền thành SUPER_ADMIN).
- `DELETE /api/users/:id`: Xóa người dùng (chặn xóa SUPER_ADMIN).
