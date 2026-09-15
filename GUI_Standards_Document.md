# APTECH AIRLINES - GUI STANDARDS DOCUMENT
**Tài liệu Quy chuẩn Thiết kế Giao diện Người dùng (Mục 8 - Hồ sơ eProject)**

---

## 1. TỔNG QUAN HỆ THỐNG THƯƠNG HIỆU
- **Tên thương hiệu:** **Aptech Airlines**
- **Slogan định vị:** *"Bay đến tương lai - Tiện nghi chuẩn 5 sao"*
- **Phong cách thiết kế:** Sang trọng Hàng không (Modern Aviation Luxury), lấy cảm hứng từ các hãng hàng không 5 sao quốc tế (Qatar Airways, Singapore Airlines, Vietnam Airlines).
- **Ngôn ngữ hỗ trợ:** Song ngữ (Mặc định: **Tiếng Việt**, có nút chuyển đổi tức thì sang **Tiếng Anh**).
- **Quy chuẩn biểu tượng (Icons):** **100% Vector SVG chuyên nghiệp qua thư viện Lucide Icons (`lucide-angular`). Tuyệt đối KHÔNG sử dụng emoji.**

---

## 2. BẢNG MÀU CHUẨN (DESIGN TOKENS & COLOR PALETTE)

### 2.1. Màu sắc Nhận diện Thương hiệu
| Vai trò màu | Tên màu | Mã HEX | Tailwind Class | Ứng dụng |
| :--- | :--- | :--- | :--- | :--- |
| **Primary** | Aviation Navy | `#0A2540` | `bg-[#0A2540]`, `text-[#0A2540]` | Header, Sidebar Admin, Tiêu đề chính, Nền trang trọng |
| **Primary Light** | Ocean Slate | `#1E3A8A` | `bg-blue-900` | Trạng thái hover menu, thanh trượt, badge |
| **Accent / CTA** | Royal Gold | `#D4AF37` / `#F59E0B` | `bg-amber-500`, `text-amber-500` | Nút tìm kiếm, nút thanh toán, điểm SkyMiles, hạng VIP |
| **Accent Hover** | Deep Gold | `#B45309` | `hover:bg-amber-600` | Trạng thái di chuột vào nút CTA |

### 2.2. Màu sắc Ngữ thái & Sơ đồ Ghế ngồi (Semantic Colors)
| Ý nghĩa | Mã HEX | Tailwind Class | Ứng dụng trong hệ thống & Sơ đồ ghế |
| :--- | :--- | :--- | :--- |
| **Thương gia / SkyBoss (Đặc biệt)** | `#D4AF37` / `#B45309` | `bg-amber-500` | Ghế Hàng 1 - 5, Huy hiệu hạng vé Thương gia |
| **Chỗ ngồi Còn trống** | `#10B981` | `bg-emerald-500` | Ghế Hàng 6 - 31 (Trạng thái sẵn sàng chọn) |
| **Chỗ ngồi Thoát hiểm** | `#0284C7` | `bg-sky-600` | Ghế Hàng 12 và 14 (Chỗ để chân rộng) |
| **Ghế đang được chọn** | `#F59E0B` | `ring-4 ring-amber-400` | Ghế hành khách vừa click vào (Hiệu ứng phát sáng Gold) |
| **Ghế đã bán / Khóa** | `#94A3B8` | `bg-slate-400` | Ghế đã có người đặt trong CSDL (Kèm icon gạch chéo SVG) |
| **Cảnh báo / Hoãn chuyến** | `#F59E0B` | `bg-amber-500` | Thông báo hoãn chuyến bay (`DELAYED`) |
| **Nguy hiểm / Hủy chuyến** | `#EF4444` | `bg-red-500` | Chuyến bay bị hủy do thời tiết xấu (`CANCELLED`) |

---

## 3. QUY CHUẨN TYPOGRAPHY (FONT CHỮ)
- **Font chữ chuẩn:** **`Inter`** (Google Fonts).
- **Lý do chọn:** Font chữ tiêu chuẩn số 1 thế giới cho giao diện Web/App hiện đại, hỗ trợ tiếng Việt có dấu hoàn hảo, các con số (giờ bay, giá vé, số ghế, mã PNR) hiển thị cực kỳ rõ ràng, không bị lệch hàng.
- **Phân cấp cỡ chữ (Type Scale):**
  - `Display / Hero Title`: 36px - 44px (Font-bold, Tracking-tight)
  - `Section Heading (H1/H2)`: 24px - 28px (Font-bold, Text-navy)
  - `Card Title (H3)`: 18px - 20px (Font-semibold)
  - `Body Text (Nội dung)`: 14px - 16px (Font-normal, Text-slate-600)
  - `Caption / Meta (Số hiệu, Giờ bay nhỏ)`: 12px - 13px (Font-medium, Text-slate-400)

---

## 4. QUY CHUẨN NÚT BẤM & THÀNH PHẦN (BUTTONS & COMPONENTS)

### 4.1. Kiểu dáng Nút bấm (Button Shape & Effects)
- **Hình dáng (Shape):** Toàn bộ các nút bấm hành động đều có dạng **viên thuốc (Pill shape - `rounded-full`)**.
- **Hiệu ứng nổi (Shadow Lift):**
  - Mặc định: `shadow-md`
  - Khi di chuột (Hover): `hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200`
- **Các biến thể nút:**
  - `Primary Button`: Nền Vàng Gold (`bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full px-6 py-3`).
  - `Secondary Button`: Nền Xanh Navy (`bg-[#0A2540] hover:bg-blue-900 text-white rounded-full px-5 py-2.5`).
  - `Outline Button`: Viền Xanh Navy, nền trong suốt (`border-2 border-[#0A2540] text-[#0A2540] hover:bg-slate-50 rounded-full px-5 py-2.5`).
  - `Ghost Button`: Trong suốt, chỉ đổi màu khi hover (`hover:bg-slate-100 rounded-full px-4 py-2`).

### 4.2. Khung & Thẻ hiển thị (Cards & Containers)
- Nền trắng tinh khôi (`bg-white`).
- Bo góc hiện đại mềm mại: `rounded-2xl` hoặc `rounded-3xl`.
- Viền mỏng cao cấp: `border border-slate-200/80`.
- Đổ bóng nhẹ: `shadow-sm hover:shadow-md transition-shadow`.

---

## 5. BỘ BIỂU TƯỢNG CHÍNH QUY (LUCIDE SVG ICONS)
*Cam kết không dùng bất kỳ Emoji nào.* Toàn bộ dùng vector SVG:
- **Chuyến bay & Hàng không:** `Plane`, `PlaneTakeoff`, `PlaneLanding`, `Armchair` (ghế ngồi).
- **Hành trình & Địa điểm:** `MapPin`, `ArrowRightLeft` (khứ hồi), `ArrowRight` (một chiều), `Compass`.
- **Thời gian & Lịch trình:** `Calendar`, `Clock`, `Hourglass`.
- **Hành khách & Người dùng:** `User`, `Users`, `UserCheck`, `Crown` (hạng VIP/Skyboss).
- **Vé & Thanh toán:** `Ticket`, `CreditCard`, `ShieldCheck`, `CheckCircle2`.
- **Cảnh báo & Hệ thống:** `AlertTriangle`, `Info`, `XCircle`, `Search`, `SlidersHorizontal`.

---

## 6. BỐ CỤC ĐIỀU HƯỚNG (LAYOUT & NAVIGATION)

### 6.1. Cổng Hành khách (Client Portal - Trang chủ)
- **Top Header:** Logo *Aptech Airlines* với biểu tượng máy bay mạ vàng, Menu tra cứu, Đổi vé/Hủy vé, Quản lý chuyến bay, Điểm thưởng SkyMiles, Nút Đổi ngôn ngữ (VI/EN) và Nút Đăng nhập/Đăng ký.
- **Hero Search Engine:** Box tìm kiếm chuyến bay nổi bật trên nền banner bầu trời, tích hợp chọn khứ hồi/1 chiều, sân bay đi/đến, ngày bay, số khách (Người lớn, Trẻ em, Người cao tuổi) và hạng vé.
- **Flight Result Cards:** Hiển thị thẻ chuyến bay trực quan, logo hãng, giờ bay, thời gian bay, số ghế trống, giá tiền theo từng hạng vé.
- **Sơ đồ Ghế ngồi (Interactive Seat Map):** Mô phỏng thân máy bay, mũi máy bay, các dãy ghế 3 - 3, lối đi, ghế thoát hiểm, bảng ghi chú và hộp cảnh báo chuẩn quốc tế.

### 6.2. Cổng Quản trị (Admin / Clerk Portal - `/admin`)
- **Dark Navy Sidebar:** Thanh điều hướng dọc bên trái màu Xanh Navy tối (`#0A2540`), quản lý:
  - Bảng điều khiển tổng quan (Dashboard)
  - Quản lý chuyến bay & Lịch bay (CRUD + Cập nhật thời tiết khẩn cấp)
  - Đồng bộ chuyến bay thật từ AirLabs API
  - Quản lý sân bay & Thành phố
  - Quản lý đơn đặt vé & Giữ chỗ
  - Quản lý người dùng (Bảo vệ tài khoản SUPER_ADMIN)
  - Quản lý chính sách hoàn tiền
