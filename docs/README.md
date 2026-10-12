# HỆ THỐNG ĐẶT VÉ MÁY BAY - APTECH AIRLINES (ARS)
## MỤC LỤC TỔNG HỢP BỘ HỒ SƠ ĐỒ ÁN ePROJECT (TABLE OF CONTENTS)
**Aptech Computer Education - eProject Deliverables Index**

---

## 1. GIỚI THIỆU BỘ HỒ SƠ ĐỒ ÁN

Chào mừng Hội đồng Chấm thi, Giảng viên Hướng dẫn và các bên quan tâm đến với bộ tài liệu bàn giao chính thức của đồ án **eProject - Airline Reservation System (ARS)** mang thương hiệu **Aptech Airlines**.

Bộ hồ sơ được biên soạn nghiêm ngặt theo đúng cấu trúc chuẩn quy định trong văn bản *ProjectSpecification.txt* của Aptech, phản ánh chính xác 100% hiện trạng kiến trúc và mã nguồn thực tế của hệ thống Fullstack gồm **NestJS Backend**, **Angular 21 Frontend**, **MongoDB Database** và **Docker Orchestration**.

---

## 2. BẢNG MỤC LỤC & TRẠNG THÁI TỪNG TÀI LIỆU (DELIVERABLES STATUS)

| Mã số | Tên tài liệu chuẩn eProject | Tên tập tin liên kết | Nhóm phụ trách | Trạng thái |
| :---: | :--- | :--- | :---: | :---: |
| **00** | **Giấy chứng nhận hoàn thành đồ án**<br>*(Certificate of Completion)* | [00-Certificate-of-Completion.md](./00-Certificate-of-Completion.md) | Docs Management Agent | **HOÀN THÀNH** |
| **01** | **Đặc tả bài toán & Mục tiêu hệ thống**<br>*(Problem Definition)* | [01-Problem-Definition.md](./01-Problem-Definition.md) | Docs Management Agent | **HOÀN THÀNH** |
| **02** | **Đặc tả yêu cầu khách hàng**<br>*(Customer Requirement Specification - CRS)* | [02-Customer-Requirement-Specification.md](./02-Customer-Requirement-Specification.md) | Docs Management Agent | **HOÀN THÀNH** |
| **03** | **Kế hoạch dự án**<br>*(Project Plan)* | [03-Project-Plan.md](./03-Project-Plan.md) | Docs Management Agent | **HOÀN THÀNH** |
| **04** | **Sơ đồ Thực thể - Quan hệ**<br>*(E-R Diagrams)* | [04-ER-Diagram.md](./04-ER-Diagram.md) | Technical Docs Agent | **HOÀN THÀNH** |
| **05** | **Giải thuật & Luồng xử lý**<br>*(Algorithms)* | [05-Algorithms.md](./05-Algorithms.md) | Technical Docs Agent | **HOÀN THÀNH** |
| **06** | **Tài liệu Thiết kế Giao diện**<br>*(Interface Design Document - IDD)* | [06-Interface-Design-Document.md](./06-Interface-Design-Document.md) | Technical Docs Agent | **HOÀN THÀNH** |
| **07** | **Bảng phân bổ nhiệm vụ**<br>*(Task Sheet)* | [07-Task-Sheet.md](./07-Task-Sheet.md) | Docs Management Agent | **HOÀN THÀNH** |
| **08** | **Báo cáo đánh giá & Giám sát tiến độ**<br>*(Project Review and Monitoring Report)* | [08-Project-Review-and-Monitoring-Report.md](./08-Project-Review-and-Monitoring-Report.md) | Docs Management Agent | **HOÀN THÀNH** |
| **09** | **Bảng kiểm thử & Nghiệm thu cuối cùng**<br>*(Unit Testing & Final Check List)* | [09-Final-Check-List.md](./09-Final-Check-List.md) | Technical Docs Agent | **HOÀN THÀNH** |
| **GUI** | **Quy chuẩn thiết kế giao diện người dùng**<br>*(GUI Standards Document)* | [GUI_Standards_Document.md](../GUI_Standards_Document.md) | Design System | **HOÀN THÀNH** |
| **ROOT**| **Tài liệu hướng dẫn kỹ thuật & Cài đặt**<br>*(System Technical Readme)* | [README.md](../README.md) | Core Engineering | **HOÀN THÀNH** |

---

## 3. TÓM TẮT NỘI DUNG CÁC TÀI LIỆU CHÍNH

### [00. Giấy chứng nhận hoàn thành đồ án (Certificate of Completion)](./00-Certificate-of-Completion.md)
Văn bản xác nhận chính thức việc nhóm sinh viên hoàn thành toàn bộ khối lượng nghiên cứu và sản phẩm đồ án eProject. Tài liệu để sẵn các vị trí điền thông tin định danh bằng placeholder chuẩn (`<Họ tên sinh viên>`, `<Lớp>`, `<Mã sinh viên>`, `<Ngày>`,...) tuyệt đối không bịa tên thật, kèm theo bảng tiêu chí nghiệm thu và các khung chữ ký của Giảng viên hướng dẫn, Chủ tịch hội đồng chấm thi và Phòng Đào tạo Aptech.

### [01. Đặc tả bài toán & Mục tiêu hệ thống (Problem Definition)](./01-Problem-Definition.md)
Tóm lược bối cảnh ra đời của hệ thống đặt vé máy bay hiện đại thay thế mô hình bán vé tại bàn truyền thống; phân tích phạm vi nghiệp vụ và phạm vi người dùng; định nghĩa trách nhiệm của các bên liên quan (Stakeholders); phân tích chi tiết các mục tiêu cốt lõi của hệ thống theo mục 1.1, góc nhìn tối ưu doanh thu và xử lý khẩn cấp của hãng hàng không theo mục 1.2, cùng các mục tiêu giảm thiểu phiền toái cho hành khách theo mục 1.3 của đề bài gốc.

### [02. Đặc tả yêu cầu khách hàng (Customer Requirement Specification - CRS)](./02-Customer-Requirement-Specification.md)
Bảng tổng hợp chi tiết toàn bộ các yêu cầu chức năng theo chuẩn mã đề bài từ **3.1 đến 3.10** (Tài khoản, Đăng ký, Tra cứu chuyến bay, Thuật toán nối chuyến, Sơ đồ ghế đa đội bay, Giữ chỗ > 14 ngày, Mua vé ngay, Tích lũy dặm bay SkyMiles, Xác nhận vé giữ chỗ, Đổi vé có bù trừ giá, Hủy vé tính % hoàn tiền, Cập nhật hồ sơ, Tra cứu vé và Cảnh báo hoãn/hủy khẩn cấp, Tra cứu chuyến bay công khai). Bổ sung bảng yêu cầu phi chức năng (Bảo mật JWT & RBAC, Đa ngôn ngữ VI/EN, GUI Standards, Docker) và **Ma trận truy vết yêu cầu (Requirement Traceability Matrix - RTM)** kết nối trực tiếp yêu cầu tới từng file mã nguồn.

### [03. Kế hoạch dự án (Project Plan)](./03-Project-Plan.md)
Lộ trình thực hiện đồ án trong thời gian **30 ngày**, phân kỳ rõ ràng thành 7 giai đoạn kế tiếp; bảng phân công ma trận quyền hạn cho 5 vai trò (`SUPER_ADMIN`, `ADMIN`, `CLERK`, `CUSTOMER`, `GUEST`); thiết lập các mốc thời gian (Milestones) theo đúng quy định gửi **Status Mail #1** (ngày 10) và **Status Mail #2** (ngày 27) cho eProjects Team; kế hoạch quản trị rủi ro và ngăn xếp công nghệ phát triển.

### [07. Bảng phân bổ nhiệm vụ chi tiết (Task Sheet)](./07-Task-Sheet.md)
Bảng theo dõi tiến độ chi tiết gồm **41 đầu việc (Tasks)** bao phủ toàn diện các chức năng đã xây dựng trong hệ thống, ghi nhận mã task, phân hệ, mô tả công việc, tập tin mã nguồn phụ trách, ước lượng thời gian dự kiến (312 giờ) và thời gian thực tế (306 giờ), đạt tỷ lệ hoàn thành **100%**.

### [08. Báo cáo đánh giá & Giám sát tiến độ (Project Review and Monitoring Report)](./08-Project-Review-and-Monitoring-Report.md)
Báo cáo giám sát định kỳ theo 4 tuần phát triển; ghi nhận chi tiết **6 vấn đề kỹ thuật thực tế** phát sinh trong quá trình ghép nối hệ thống và giải pháp khắc phục triệt để (lệch hợp đồng API envelope, bảo mật Angular sanitize icon SVG, chuẩn hóa dữ liệu máy bay AirLabs ICAO, thống nhất đơn vị tiền tệ VND, thắt chặt bảo vệ tài khoản SUPER_ADMIN bất biến, phòng ngừa Race Condition khi đặt vé bằng MongoDB atomic operators); cung cấp các số liệu kiểm chứng chất lượng thực tế (biên dịch TypeScript và Angular đạt **0 lỗi**, 33 Test Suites kiểm thử tự động đạt kết quả thành công).

### [Tài liệu Quy chuẩn Giao diện (GUI Standards Document)](../GUI_Standards_Document.md)
Bộ quy chuẩn thiết kế giao diện đồ họa chính thức của Aptech Airlines: Bộ nhận diện màu sắc Aviation Navy (`#0A2540`) & Royal Gold (`#D4AF37`), Typography Inter, nút bấm dạng viên thuốc (`rounded-full`), 100% biểu tượng Vector SVG Lucide (tuyệt đối không dùng Emoji trên UI), bố cục điều hướng và phân khu sơ đồ ghế đa chủng loại đội bay (A20N, A21N, B789, A359, B738, AT76).

### [Tài liệu Hướng dẫn Kỹ thuật & Cài đặt Hệ thống (System Readme)](../README.md)
Tài liệu hướng dẫn tổng quan kiến trúc Monorepo, tài khoản quản trị tối cao mặc định, hướng dẫn khởi chạy nhanh 1 lệnh duy nhất bằng Docker Compose (`docker compose up --build`), hướng dẫn chạy chế độ phát triển cục bộ và danh mục chi tiết các nhóm REST API Endpoints.

---

## 4. HƯỚNG DẪN ĐIỀU HƯỚNG DÀNH CHO HỘI ĐỒNG CHẤM THI

- Để tìm hiểu về **bài toán và mục tiêu nghiệp vụ**: Vui lòng xem [01-Problem-Definition.md](./01-Problem-Definition.md).
- Để đối soát **yêu cầu đề bài 3.1 - 3.10 và vị trí code**: Vui lòng xem [02-Customer-Requirement-Specification.md](./02-Customer-Requirement-Specification.md).
- Để kiểm tra **kế hoạch và mốc báo cáo eProject**: Vui lòng xem [03-Project-Plan.md](./03-Project-Plan.md).
- Để theo dõi **chi tiết các task đã thực hiện**: Vui lòng xem [07-Task-Sheet.md](./07-Task-Sheet.md).
- Để xem **các vấn đề thực tế đã giải quyết và số liệu kiểm chuẩn**: Vui lòng xem [08-Project-Review-and-Monitoring-Report.md](./08-Project-Review-and-Monitoring-Report.md).
- Để kiểm tra **mẫu chứng nhận hoàn thành**: Vui lòng xem [00-Certificate-of-Completion.md](./00-Certificate-of-Completion.md).
