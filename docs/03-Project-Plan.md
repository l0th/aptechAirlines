# HỆ THỐNG ĐẶT VÉ MÁY BAY - APTECH AIRLINES (ARS)
## KẾ HOẠCH DỰ ÁN (PROJECT PLAN)
**Deliverable 03 - Hồ sơ Đồ án eProject Aptech**

---

## 1. TỔNG QUAN KẾ HOẠCH DỰ ÁN (PROJECT OVERVIEW)

- **Tên dự án:** Airline Reservation System (ARS) - Aptech Airlines Fullstack Web Application
- **Mô hình triển khai:** Quy trình phát triển phần mềm theo chuẩn eProject Aptech kết hợp phương pháp luận Agile/Scrum rút gọn.
- **Tổng thời gian thực hiện:** **30 ngày làm việc** (Chia làm 7 giai đoạn kế tiếp).
- **Mục tiêu dự án:** Xây dựng hoàn chỉnh hệ thống đặt vé máy bay trực tuyến chuẩn công nghiệp, tích hợp dữ liệu chuyến bay thực tế từ AirLabs API, đóng gói vận hành qua Docker và hoàn thiện trọn bộ 10 hồ sơ tài liệu nghiệm thu.

---

## 2. PHÂN KỲ CÁC GIAI ĐOẠN PHÁT TRIỂN (PROJECT PHASES)

```
[Giai đoạn 1]  Ngày 01 - 04 : Khảo sát & Phân tích Đặc tả Yêu cầu (SRS/CRS)
      │
[Giai đoạn 2]  Ngày 05 - 08 : Thiết kế Kiến trúc, Cơ sở Dữ liệu & Quy chuẩn GUI
      │
[Giai đoạn 3]  Ngày 09 - 16 : Phát triển Backend API Core & Nghiệp vụ Vé (NestJS)
      │         ▲ (Mốc Ngày 10: Gửi Status Mail #1 kèm Review Document)
[Giai đoạn 4]  Ngày 17 - 23 : Phát triển Frontend Web Portal (Angular 21 Standalone)
      │
[Giai đoạn 5]  Ngày 24 - 25 : Tích hợp AirLabs API, Lịch bay thật & Quản trị nâng cao
      │
[Giai đoạn 6]  Ngày 26 - 28 : Kiểm thử Tích hợp, E2E, Dockerization & Fix Bugs
      │         ▲ (Mốc Ngày 27: Gửi Status Mail #2 trước khi nộp 3 ngày)
[Giai đoạn 7]  Ngày 29 - 30 : Hoàn thiện Bộ Tài liệu eProject (00-09) & Nghiệm thu
```

---

### Giai đoạn 1: Khảo sát & Phân tích Đặc tả Yêu cầu (Ngày 01 – Ngày 04)
- **Mục tiêu:** Thấu hiểu toàn diện đề bài eProject trong *ProjectSpecification.txt* và *AirlinesReservationSystem.txt*.
- **Công việc cụ thể:**
  - Nghiên cứu bài toán kinh doanh của hãng hàng không, xác định các bên liên quan (Stakeholders) và mục tiêu hệ thống (1.1 - 1.3).
  - Phân tích chi tiết 10 nhóm yêu cầu chức năng (3.1 - 3.10) và các yêu cầu phi chức năng (bảo mật, đa ngôn ngữ, chuẩn GUI).
  - Xây dựng tài liệu *Problem Definition* và *Customer Requirement Specification (CRS)*.
  - Phân tích rủi ro ban đầu và lựa chọn ngăn xếp công nghệ (Tech Stack).

### Giai đoạn 2: Thiết kế Kiến trúc, CSDL & Quy chuẩn Giao diện (Ngày 05 – Ngày 08)
- **Mục tiêu:** Thiết kế nền móng kiến trúc hệ thống và quy chuẩn trải nghiệm người dùng.
- **Công việc cụ thể:**
  - Thiết kế Lược đồ Thực thể - Mối quan hệ (E-R Diagram) cho MongoDB: Users, Airports, Flights, Bookings, Policies.
  - Xây dựng tài liệu *GUI Standards Document*: Định hình bảng màu Aviation Navy (`#0A2540`) và Royal Gold (`#D4AF37`), Typography Inter, quy chuẩn 100% Vector SVG Lucide Icons, nút bấm viên thuốc (`rounded-full`).
  - Thiết kế sơ đồ máy bay Airbus A321 (31 hàng ghế, cấu hình 3 - 3, hàng thoát hiểm 12 và 14).
  - Thiết kế luồng thuật toán: Thuật toán nối chuyến (Route Selection) và thuật toán phân loại hoàn tiền.

### Giai đoạn 3: Phát triển Backend API & Nghiệp vụ Cốt lõi (Ngày 09 – Ngày 16)
- **Mục tiêu:** Xây dựng hệ thống REST API hoàn chỉnh trên nền tảng NestJS và MongoDB.
- **Công việc cụ thể:**
  - Khởi tạo khung dự án NestJS Modular khép kín (`auth`, `users`, `airports`, `flights`, `bookings`, `policies`, `mail`, `seed`).
  - Cấu hình xác thực JWT, mã hóa Bcrypt, bảo vệ tài khoản `SUPER_ADMIN` bất biến.
  - Phát triển nghiệp vụ tìm kiếm chuyến bay, giải quyết tên thành phố, thuật toán nối chuyến qua trạm trung chuyển.
  - Xây dựng nghiệp vụ đặt vé cốt lõi: Quy tắc giữ chỗ > 14 ngày (sinh mã `BLK`), xuất vé ngay (sinh mã `CNF`), trừ ghế nguyên tử.
  - Phát triển tác vụ nền Cron Scheduler (`BookingsScheduler`): Tự động gửi email nhắc nhở trước 21 ngày và tự hủy vé giữ chỗ quá hạn 14 ngày.
  - **Mốc Ngày 10:** Gửi **Status Mail #1** báo cáo tiến độ và nghiệm thu giai đoạn khảo sát/thiết kế.

### Giai đoạn 4: Phát triển Frontend Web Portal (Ngày 17 – Ngày 23)
- **Mục tiêu:** Xây dựng giao diện Single Page Application hiện đại với Angular 21 Standalone.
- **Công việc cụ thể:**
  - Thiết lập Tailwind CSS v3, cấu hình Design Tokens và bộ biểu tượng `lucide-angular`.
  - Phát triển Portal Khách hàng: Trang chủ tìm kiếm (`HomeComponent`), Trang kết quả chuyến bay 2 chiều (`FlightResultsComponent`), Trang đặt vé & chọn ghế A321 (`BookingComponent`), Trang thành công (`BookingSuccessComponent`).
  - Phát triển trang Tra cứu và Quản lý vé (`TrackBookingComponent`): Hỗ trợ hủy vé tính % hoàn tiền, đổi vé tính bù trừ tiền và xác nhận vé giữ chỗ.
  - Phát triển trang tra cứu chuyến bay công khai (`FlightLookupComponent`) và trang dặm thưởng (`SkyMilesComponent`).
  - Xây dựng dịch vụ đa ngôn ngữ (`LanguageService`) sử dụng Angular Signals hỗ trợ song ngữ VI/EN mượt mà.

### Giai đoạn 5: Tích hợp AirLabs API & Phân hệ Quản trị Nâng cao (Ngày 24 – Ngày 25)
- **Mục tiêu:** Kết nối dữ liệu chuyến bay thực tế và hoàn thiện cổng quản trị Admin/Clerk.
- **Công việc cụ thể:**
  - Phát triển tính năng đồng bộ lịch bay thực tế từ AirLabs API (`/admin/airlabs-sync`).
  - Chuẩn hóa dữ liệu dòng máy bay thật (Airbus A321, Boeing 787) và định dạng giá tiền chuẩn VND.
  - Xây dựng Admin Layout với Sidebar Navy chuyên nghiệp và phân quyền nghiêm ngặt theo vai trò.
  - Hoàn thiện các trang quản trị: Dashboard tổng quan, Quản lý chuyến bay & cập nhật thời tiết hoãn/hủy, Quản lý sân bay, Quản lý người dùng, Quản lý đơn đặt chỗ và Quản lý chính sách hoàn tiền.

### Giai đoạn 6: Kiểm thử Toàn diện, Đóng gói Docker & Tối ưu (Ngày 26 – Ngày 28)
- **Mục tiêu:** Đảm bảo hệ thống đạt 100% độ ổn định, không lỗi biên dịch và sẵn sàng bàn giao.
- **Công việc cụ thể:**
  - Thực hiện kiểm thử tích hợp toàn bộ kịch bản nghiệp vụ: Đặt vé -> Giữ chỗ -> Nhắc nhở -> Xác nhận -> Đổi vé -> Hủy vé.
  - Kiểm tra tính toán vẹn dữ liệu kho ghế khi nhiều phiên cùng đặt vé đồng thời.
  - Viết `Dockerfile` đa tầng cho Backend và Frontend (Nginx Alpine), tối ưu `docker-compose.yml`.
  - Kiểm tra và khắc phục triệt để các lỗi biên dịch TypeScript (`tsc`) và Angular (`ngc`).
  - **Mốc Ngày 27:** Gửi **Status Mail #2** (trước hạn nộp 3 ngày) kèm biên bản rà soát kỹ thuật.

### Giai đoạn 7: Hoàn thiện Hồ sơ Tài liệu eProject & Nghiệm thu (Ngày 29 – Ngày 30)
- **Mục tiêu:** Đóng gói toàn bộ sản phẩm và bàn giao bộ tài liệu eProject chuẩn Aptech.
- **Công việc cụ thể:**
  - Hoàn thiện trọn bộ 10 tài liệu eProject (00 đến 09) trong thư mục `docs/`.
  - Tạo tài liệu mục lục tổng hợp `docs/README.md` kết nối toàn bộ hồ sơ.
  - Chuẩn bị môi trường demo sản phẩm, sẵn sàng thuyết trình và bảo vệ trước Hội đồng chấm thi.

---

## 3. PHÂN CÔNG VAI TRÒ TRONG HỆ THỐNG (ROLES & PERMISSIONS BREAKDOWN)

Hệ thống phân định rõ ràng 5 nhóm quyền hạn tương ứng với từng tác nhân sử dụng:

| Vai trò người dùng | Cấp độ quyền hạn | Phạm vi chức năng & Quyền hạn truy cập trong hệ thống | Cơ chế bảo mật áp dụng |
| :--- | :---: | :--- | :--- |
| **SUPER_ADMIN** | Cấp 1 (Tối cao) | - Toàn quyền trên toàn bộ hệ thống.<br>- Quản lý tài khoản Admin, Clerk, Customer.<br>- Thiết lập tham số hệ thống, đồng bộ AirLabs, xóa chuyến bay, quản trị chính sách.<br>- **Quy tắc bảo vệ:** Chỉ tồn tại duy nhất 1 tài khoản, không thể bị xóa và không thể cấp quyền thêm cho bất kỳ ai. | Khóa cứng ở tầng Model & Service, từ chối mọi yêu cầu xóa hoặc tạo thêm. |
| **ADMIN** | Cấp 2 (Quản trị viên) | - Quản lý danh mục sân bay và thành phố.<br>- Quản lý lịch bay: Thêm mới, chỉnh sửa, cập nhật trạng thái khẩn cấp (Hoãn/Hủy chuyến bay do thời tiết xấu).<br>- Đồng bộ chuyến bay từ AirLabs API.<br>- Quản lý danh mục chính sách hoàn tiền.<br>- Quản lý tài khoản Clerk và Customer (không được can thiệp tài khoản SUPER_ADMIN).<br>- Xem toàn bộ danh sách đơn đặt vé của khách hàng. | Xác thực JWT Bearer Token, kiểm tra qua `RolesGuard(['SUPER_ADMIN', 'ADMIN'])`. |
| **CLERK** | Cấp 3 (Nhân viên vé) | - Tra cứu thông tin vé của khách hàng tại quầy.<br>- Hỗ trợ hành khách giữ chỗ, thanh toán xuất vé, đổi vé và hủy vé.<br>- Xem lịch trình bay và kiểm tra tình trạng ghế trống theo thời gian thực.<br>- Không có quyền chỉnh sửa cấu hình hệ thống, sân bay, chính sách hoặc tài khoản người dùng. | Xác thực JWT Bearer Token, kiểm tra qua `RolesGuard(['SUPER_ADMIN', 'ADMIN', 'CLERK'])`. |
| **CUSTOMER** | Cấp 4 (Hành khách đăng ký) | - Tra cứu chuyến bay thẳng và nối chuyến.<br>- Đặt giữ chỗ (Hold > 14 ngày) hoặc mua vé trực tiếp (Buy).<br>- Quản lý danh sách vé cá nhân (My Trips), xác nhận vé, đổi vé và hủy vé theo chính sách.<br>- Tích lũy và theo dõi điểm thưởng dặm bay SkyMiles.<br>- Cập nhật thông tin cá nhân và thẻ tín dụng ưa thích. | Bắt buộc xác thực quyền sở hữu (`assertOwnership`): Chỉ được can thiệp vào đơn vé do chính mình tạo. |
| **GUEST** | Cấp 5 (Khách vãng lai) | - Xem thông tin giới thiệu và trang chủ.<br>- Tra cứu lịch bay, giá vé, số ghế trống.<br>- Tra cứu chi tiết chuyến bay công khai bằng số hiệu và ngày bay.<br>- Tra cứu tình trạng vé bằng mã (chỉ xem, không được sửa/hủy).<br>- Bắt buộc phải đăng ký/đăng nhập nếu muốn giữ chỗ hoặc mua vé. | Truy cập tự do không yêu cầu Token (Public Endpoints). |

---

## 4. BẢNG MỐC THỜI GIAN & DELIVERABLES (MILESTONES & DELIVERABLES)

Theo đúng quy chế eProject của Aptech, nhóm dự án tuân thủ nghiêm ngặt lịch báo cáo định kỳ:

| Mốc thời gian | Tên mốc kiểm soát | Nội dung công việc & Báo cáo bắt buộc | Sản phẩm bàn giao (Deliverables) |
| :---: | :--- | :--- | :--- |
| **Ngày 04** | **Milestone 1:** Hoàn thành Đặc tả | Hoàn thành việc khảo sát, phân tích bài toán và thống nhất toàn bộ yêu cầu nghiệp vụ 3.1 - 3.10. | - `01-Problem-Definition.md`<br>- `02-Customer-Requirement-Specification.md` |
| **Ngày 08** | **Milestone 2:** Hoàn thành Thiết kế | Hoàn thành thiết kế CSDL MongoDB, quy chuẩn giao diện người dùng và giải thuật nối chuyến. | - `GUI_Standards_Document.md`<br>- Thiết kế E-R Diagram & Sơ đồ ghế A321 |
| **Ngày 10** | **Milestone 3: STATUS MAIL #1** | **Gửi email báo cáo tiến độ đợt 1 cho Nhóm Hướng dẫn eProjects Aptech** (đúng hạn 10 ngày từ ngày bắt đầu). Tiêu đề: `STATUS: Aptech Airlines eProject - Report 1`. | - Báo cáo tiến độ Tuần 1 & Tuần 2<br>- Bản demo khung API NestJS + CSDL đã nạp dữ liệu Seed |
| **Ngày 16** | **Milestone 4:** Hoàn thành Backend Core | Hoàn thành 100% các endpoint nghiệp vụ: tìm chuyến, giữ chỗ 14 ngày, xuất vé, đổi vé, hủy vé, scheduler. | - Mã nguồn Backend NestJS biên dịch sạch<br>- Postman Collection kiểm thử đầy đủ API |
| **Ngày 23** | **Milestone 5:** Hoàn thành Frontend Web | Hoàn thành giao diện người dùng Angular 21, kết nối thông suốt với Backend, hỗ trợ song ngữ và sơ đồ ghế A321. | - Mã nguồn Frontend Angular 21 Standalone<br>- Giao diện Responsive hoàn chỉnh |
| **Ngày 25** | **Milestone 6:** Tích hợp AirLabs & Admin | Hoàn thiện chức năng đồng bộ dữ liệu bay thực tế và các trang quản trị phân quyền. | - Phân hệ `/admin` hoàn chỉnh<br>- Tính năng đồng bộ chuyến bay thật |
| **Ngày 27** | **Milestone 7: STATUS MAIL #2** | **Gửi email báo cáo tiến độ đợt 2 cho eProjects Team** (trước ngày nộp đồ án 3 ngày). Tiêu đề: `STATUS: Aptech Airlines eProject - Final Review`. | - Báo cáo tiến độ hoàn thiện hệ thống<br>- Biên bản kiểm thử tích hợp và kiểm thử giao diện |
| **Ngày 30** | **Milestone 8: SUBMISSION & DEFENSE** | **Bàn giao chính thức toàn bộ đồ án eProject cho Hội đồng Chấm thi Aptech.** Tiêu đề mail: `SUBMISSION: Aptech Airlines eProject - Final Deliverables`. | - Mã nguồn trọn vẹn (Backend + Frontend + Docker)<br>- Trọn bộ 10 tài liệu eProject (00 đến 09)<br>- Phiếu đánh giá phản hồi (Feedback Form) |

---

## 5. QUẢN TRỊ RỦI RO & PHƯƠNG ÁN GIẢM THIỂU (RISK MANAGEMENT & MITIGATION)

| STT | Rủi ro tiềm ẩn | Mức độ ảnh hưởng | Khả năng xảy ra | Phương án phòng ngừa & Biện pháp khắc phục đã thực hiện |
| :---: | :--- | :---: | :---: | :--- |
| 1 | **Lệch pha kiểu dữ liệu (Contract Mismatch) giữa Backend và Frontend** | Cao | Cao | - Đồng bộ tuyệt đối các Interface dữ liệu giữa TypeScript Backend (`dto`, `schema`) và Frontend (`model`).<br>- Không phụ thuộc vào kiểu ngầm định; viết Envelope bọc dữ liệu rõ ràng cho các API phức tạp (như `trackTicket`). |
| 2 | **Xung đột đặt trùng ghế (Overbooking / Race Condition)** | Nghiêm trọng | Trung bình | - Không dùng cơ chế đọc rồi ghi tuần tự thông thường.<br>- Sử dụng toán tử nguyên tử cấp cơ sở dữ liệu của MongoDB: `$elemMatch` kết hợp `$inc: { 'inventories.$.available_seats': -count }` để đảm bảo không bao giờ bán vượt quá số ghế khả dụng. |
| 3 | **Cơ chế bảo mật Angular chặn Vector SVG (Sanitization Issue)** | Trung bình | Cao | - Tránh việc nhúng chuỗi SVG thô qua thuộc tính `[innerHTML]`.<br>- Tích hợp gói thư viện chính quy `lucide-angular` và đóng gói thành `IconComponent` độc lập, an toàn tuyệt đối trước các chính sách kiểm soát XSS của Angular. |
| 4 | **Sự cố mạng hoặc cạn kiệt Quota API AirLabs** | Trung bình | Trung bình | - Xây dựng cơ chế xử lý ngoại lệ (Try/Catch) chặt chẽ: Khi API bên thứ ba lỗi, hệ thống hiển thị thông báo thân thiện và tự động kích hoạt cơ chế dùng dữ liệu bay nội bộ đã lưu trong CSDL.<br>- Cho phép người dùng nhập trực tiếp Custom API Key trên giao diện quản trị. |
| 5 | **Xung đột đơn vị tiền tệ (USD vs VND) gây nhầm lẫn** | Trung bình | Trung bình | - Thống nhất chuẩn hóa toàn bộ giá vé trên hệ thống về đơn vị tiền tệ chuẩn VND (Việt Nam Đồng). Dữ liệu đồng bộ từ AirLabs được gán giá vé tương ứng với các phân khúc tiêu chuẩn (1.250.000đ cho Economy, 2.950.000đ cho Business).<br>- Xây dựng Pipe định dạng tiền tệ chuyên dụng `CurrencyFormatPipe`. |
| 6 | **Tài khoản Quản trị tối cao SUPER_ADMIN bị chiếm quyền hoặc xóa nhầm** | Nghiêm trọng | Thấp | - Thiết lập ràng buộc tầng sâu ở cả tầng Service và Database Guard: Chặn triệt để hành vi xóa hoặc hạ cấp tài khoản `superadmin`; chặn hành vi đăng ký hoặc nâng cấp bất kỳ tài khoản nào khác lên `SUPER_ADMIN`. |

---

## 6. MÔI TRƯỜNG & CÔNG CỤ PHÁT TRIỂN (DEVELOPMENT ENVIRONMENT & TOOLS)

Hệ thống được phát triển và kiểm chuẩn đồng bộ trên môi trường chuẩn công nghiệp:

### 6.1. Môi trường Phần mềm & Nền tảng (Software Stack)
- **Hệ điều hành phát triển:** Microsoft Windows 11 Pro 64-bit.
- **Môi trường Thực thi (Runtime):** Node.js LTS v20.x, NPM v10.x.
- **Backend Framework:** NestJS v10.x (TypeScript v5.x), Express platform.
- **Frontend Framework:** Angular v21.x Standalone Architecture, RxJS v7.x, Angular Signals.
- **Hệ quản trị Cơ sở dữ liệu:** MongoDB Community Edition v7.0 (Mongoose ODM v8.x).
- **CSS Framework:** Tailwind CSS v3.4 kết hợp Tailwind typography & forms plugins.
- **Vector Iconography:** Lucide Angular (`lucide-angular`).
- **Tác vụ định kỳ (Scheduler):** `@nestjs/schedule` kết hợp thư viện `cron`.
- **Dịch vụ Email:** `nodemailer` tích hợp SMTP Server / Ethereal Email testbed.

### 6.2. Môi trường Đóng gói & Triển khai (DevOps & Containers)
- **Container Platform:** Docker Engine v26.x.
- **Multi-Container Orchestration:** Docker Compose v2.x.
- **Web Server & Reverse Proxy:** Nginx Alpine (Phục vụ Frontend SPA và định tuyến ngược các yêu cầu `/api` sang Backend).

### 6.3. Công cụ Hỗ trợ Phát triển & Kiểm thử (Tools)
- **Trình soạn thảo mã nguồn:** Visual Studio Code (Extensions: Angular Language Service, Tailwind CSS IntelliSense, ESLint, Prettier).
- **Kiểm thử & Tài liệu hóa API:** Postman Desktop App, Thunder Client, cURL CLI.
- **Quản lý phiên bản:** Git v2.4x kết hợp kho lưu trữ mã nguồn cục bộ.
