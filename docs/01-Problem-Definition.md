# HỆ THỐNG ĐẶT VÉ MÁY BAY - APTECH AIRLINES (ARS)
## ĐẶC TẢ BÀI TOÁN & MỤC TIÊU HỆ THỐNG (PROBLEM DEFINITION)
**Deliverable 01 - Hồ sơ Đồ án eProject Aptech**

---

## 1. TỔNG QUAN & BỐI CẢNH DỰ ÁN (BACKGROUND & MOTIVATION)

Ngành hàng không dân dụng đóng vai trò huyết mạch trong mạng lưới giao thông vận tải và phát triển kinh tế toàn cầu. Trong kỷ nguyên số hóa, sự tiện lợi, tốc độ xử lý và tính chính xác tuyệt đối trong giao dịch đặt chỗ là yếu tố sống còn quyết định năng lực cạnh tranh của một hãng hàng không.

Trước khi hệ thống đặt vé điện tử trực tuyến ra đời, quy trình bán vé truyền thống tại các phòng vé và đại lý (Desk-Reservation System) bộc lộ nhiều hạn chế nghiêm trọng:
1. **Phụ thuộc vào nhân lực và thời gian làm việc hành chính:** Khách hàng phải đến trực tiếp quầy vé hoặc gọi điện thoại trong khung giờ làm việc, gây ùn tắc và quá tải vào các dịp cao điểm.
2. **Thao tác thủ công, trùng lặp và dễ sai sót:** Nhân viên bán vé (Clerk) phải liên tục tra cứu danh mục chuyến bay, nhập liệu thủ công thông tin khách hàng vào các hệ thống rời rạc, dẫn đến sai lệch thông tin và lãng phí thời gian.
3. **Thiếu khả năng tối ưu hóa doanh thu (Revenue Optimization):** Hãng bay gặp khó khăn trong việc áp dụng chính sách giá động (Dynamic Pricing) theo thời gian thực, khó quảng bá kịp thời các chương trình ưu đãi, dẫn đến tình trạng tỷ lệ lấp đầy ghế (Load Factor) không đồng đều và lãng phí ghế trống trên các chuyến bay.
4. **Hạn chế trong quản lý dữ liệu và xử lý khủng hoảng:** Khi phát sinh các tình huống bất khả kháng như thời tiết xấu, bão lũ, sự cố kỹ thuật dẫn đến hoãn (Delayed) hoặc hủy chuyến (Cancelled), việc trích xuất danh sách hành khách bị ảnh hưởng để liên hệ thông báo, đổi chuyến hoặc hoàn tiền mất nhiều giờ, gây bức xúc cho hành khách.

Nhằm giải quyết triệt để các bài toán trên, dự án **Hệ thống Quản lý và Đặt vé Máy bay (Airline Reservation System - ARS)** mang thương hiệu **Aptech Airlines** được xây dựng nhằm cung cấp một giải pháp phần mềm tự động hóa toàn diện quy trình giao dịch vé máy bay cho cả hành khách và đội ngũ vận hành của hãng hàng không.

---

## 2. PHẠM VI DỰ ÁN (PROJECT SCOPE)

Dự án tập trung vào việc thiết kế và phát triển nền tảng Fullstack Web đáp ứng các tiêu chuẩn nghiệp vụ hàng không quốc tế:

### 2.1. Phạm vi Nghiệp vụ (Business Scope)
- **Quản lý lịch bay & Mạng lưới đường bay:** Quản lý sân bay, giải quyết tên thành phố, gợi ý sân bay lân cận nếu không có đường bay trực tiếp, thiết lập lịch trình bay nội địa và quốc tế.
- **Tra cứu chuyến bay thông minh:** Hỗ trợ tìm kiếm chuyến bay một chiều và khứ hồi, tìm kiếm theo khoảng ngày khởi hành, lọc theo hạng dịch vụ và phân loại hành khách (Người lớn, Trẻ em, Người cao tuổi).
- **Thuật toán tìm kiếm tuyến bay nối chuyến (Route Selection Algorithm):** Tự động phát hiện và gợi ý các hành trình bay chuyển tiếp qua điểm trung chuyển (Transit) khi không có chuyến bay thẳng trực tiếp.
- **Sơ đồ chọn ghế ngồi trực quan (Interactive Seat Map):** Mô phỏng cấu hình máy bay Airbus A321 với các phân khu đặc biệt, lối thoát hiểm và hiển thị trạng thái ghế thực tế từ cơ sở dữ liệu.
- **Quy trình giữ chỗ linh hoạt (Hold / Block Tickets):** Thực thi quy tắc nghiệp vụ cho phép giữ chỗ miễn phí đối với chuyến bay khởi hành sau hơn 14 ngày; tự động gửi email nhắc nhở trước 21 ngày (3 tuần) và tự động hủy, giải phóng ghế nếu không xác nhận trước hạn 14 ngày (2 tuần).
- **Thanh toán & Xuất vé tức thì (Instant Confirmation & E-Ticketing):** Hỗ trợ thanh toán bảo mật, sinh mã đặt chỗ PNR (`PNR-XXXXXX`), mã xác nhận (`CNF-XXXXXX`), mã giữ chỗ (`BLK-XXXXXX`).
- **Chính sách Đổi vé & Hủy vé:** Cho phép đổi vé đã xác nhận với cơ chế tính bù/trừ chênh lệch giá vé tự động; cho phép hủy vé với cơ chế tính tỷ lệ hoàn tiền (% refund) theo số ngày trước ngày bay và tự động hoàn trả ghế trống.
- **Chương trình Khách hàng thân thiết (SkyMiles Loyalty Program):** Tự động khởi tạo dặm bay bằng 0 khi đăng ký, tích lũy dặm thưởng theo hành trình bay và tự động khấu trừ khi hủy vé.
- **Đồng bộ dữ liệu bay thực tế (AirLabs Live API Integration):** Kết nối dịch vụ dữ liệu hàng không toàn cầu AirLabs để cập nhật lịch trình bay và dòng máy bay thực tế.

### 2.2. Phạm vi Đối tượng Người dùng (User Scope)
- **Hành khách vãng lai (Guest):** Tra cứu chuyến bay, xem lịch trình bay, kiểm tra thông tin chuyến bay công khai, tra cứu tình trạng vé theo mã.
- **Hành khách thành viên (Customer):** Thực hiện đầy đủ các giao dịch đặt mua vé, giữ chỗ, xác nhận vé, đổi vé, hủy vé, xem lịch sử đặt chỗ (My Trips), tích lũy và quản lý dặm bay SkyMiles.
- **Nhân viên nghiệp vụ vé (Reservation Clerk):** Hỗ trợ hành khách tra cứu, giữ chỗ, thanh toán, đổi vé, hủy vé tại quầy giao dịch, quản lý danh sách đơn đặt vé.
- **Quản trị viên (Admin):** Quản lý sân bay, quản lý chuyến bay, quản lý chính sách hoàn tiền, phân quyền nhân viên, đồng bộ lịch bay từ AirLabs.
- **Quản trị viên tối cao (SUPER_ADMIN):** Tài khoản duy nhất, cố định của hệ thống với quyền hạn tuyệt đối, được bảo vệ không thể xóa hoặc phân quyền trùng lặp.

---

## 3. CÁC BÊN LIÊN QUAN (STAKEHOLDERS)

| STT | Bên liên quan | Vai trò & Trách nhiệm trong hệ thống | Kỳ vọng chính đối với hệ thống |
| :---: | :--- | :--- | :--- |
| 1 | **Hành khách (Customers & Guests)** | Người sử dụng dịch vụ trực tiếp qua cổng Web Portal để tìm kiếm và mua vé máy bay. | Giao diện thân thiện, tìm kiếm nhanh chóng, minh bạch về giá và chính sách hủy, thao tác đổi/hủy vé tiện lợi. |
| 2 | **Nhân viên phòng vé (Clerks)** | Nhân viên xử lý giao dịch đặt vé tại quầy vé hoặc hỗ trợ qua tổng đài/chat. | Thao tác nhập liệu nhanh, thông tin tập trung, kiểm soát trạng thái vé và lịch bay chính xác. |
| 3 | **Bộ phận Quản lý & Điều hành bay (Admin & Ops)** | Ban điều hành theo dõi lịch bay, điều chỉnh trạng thái khẩn cấp (hoãn, hủy), tối ưu hóa giá vé. | Cập nhật tức thời tình trạng chuyến bay, kiểm soát sơ đồ ghế, giảm thiểu tỷ lệ ghế trống. |
| 4 | **Ban Lãnh đạo Hãng bay (Management)** | Ban điều hành doanh nghiệp quyết định chiến lược vận tải hàng không. | Tăng trưởng doanh thu, nâng cao tỷ lệ lấp đầy ghế, xây dựng tệp khách hàng trung thành qua SkyMiles. |
| 5 | **Hội đồng Chuyên môn Aptech** | Giảng viên hướng dẫn và Hội đồng thẩm định đồ án eProject. | Sản phẩm hoàn thiện, mã nguồn chuẩn mực, tài liệu đặc tả rõ ràng, đáp ứng toàn diện đề bài eProject. |

---

## 4. MỤC TIÊU HỆ THỐNG (SYSTEM OBJECTIVES)
*(Theo đúng mục 1.1, 1.2 và 1.3 của tài liệu chuẩn AirlinesReservationSystem.txt)*

```
                           HỆ THỐNG APTECH AIRLINES (ARS)
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
    [Mục tiêu 1.1]               [Mục tiêu 1.2]                [Mục tiêu 1.3]
   Nghiệp vụ cốt lõi          Góc nhìn Hãng hàng không       Góc nhìn Khách hàng
  - Giữ chỗ (Blocking)        - Tối giản việc lặp lại        - Giảm phiền toái tìm kiếm
  - Đặt mua (Reserving)       - Chuẩn hóa quy trình quầy     - Đầy đủ hành trình/nối chuyến
  - Hủy vé (Canceling)        - Xử lý thông tin khẩn cấp     - Không nhập trùng thông tin
  - Đổi vé (Rescheduling)     - Tối đa hóa doanh thu         - Xác thực & cảnh báo lỗi
                              (SkyMiles, Giá động, Lấp ghế)  - Dễ dàng tra cứu & đổi vé
```

### 4.1. Mục tiêu Cốt lõi của Hệ thống (Mục 1.1)
Hệ thống Đặt vé Máy bay (Airline Reservation System - ARS) là một ứng dụng phần mềm toàn diện hỗ trợ hãng hàng không thực hiện mọi giao dịch liên quan đến nghiệp vụ bán vé máy bay, bao gồm:
- **Giữ chỗ tạm thời (Blocking tickets)** không thu phí trước thời hạn quy định.
- **Đặt mua và xuất vé chính thức (Reserving / Buying tickets)** có thanh toán và cấp số hiệu vé.
- **Hủy vé (Canceling tickets)** và hoàn tiền theo tỷ lệ chính sách ngày khởi hành.
- **Đổi lịch trình vé (Rescheduling tickets)** linh hoạt kèm tính toán bù trừ chênh lệch giá vé.

---

### 4.2. Góc nhìn của Hãng Hàng Không (Airlines Viewpoint - Mục 1.2)

#### 1.2.1. Giảm thiểu công việc lặp lại của Quản trị viên và Nhân viên (Minimize Repetitive Work)
- Tự động hóa quá trình xác thực dữ liệu chuyến bay, tính toán giá vé theo độ tuổi hành khách và cập nhật số lượng ghế trống theo thời gian thực.
- Loại bỏ các thao tác tính toán thủ công về tỷ lệ hoàn tiền khi hủy vé hoặc bù trừ tiền khi đổi chuyến bay.
- Tự động hóa việc quét và hủy các vé giữ chỗ hết hạn (Auto-cancel Expired Blocks) thông qua tác vụ định kỳ nền (Cron Scheduler).

#### 1.2.2. Chuẩn hóa quy trình tương đương giao dịch tại quầy (Standard Desk-Reservation Steps)
- Hệ thống dẫn dắt người dùng qua các bước tuần tự chuẩn mực: Tìm kiếm -> Chọn chuyến & Hạng vé -> Chọn sơ đồ ghế -> Nhập thông tin cá nhân -> Chọn hình thức giữ chỗ/mua ngay -> Xác nhận thanh toán & Nhận mã đặt chỗ.
- Đảm bảo tính nhất quán giữa trải nghiệm của khách hàng tự đặt vé trực tuyến và nhân viên phòng vé thao tác tại quầy.

#### 1.2.3. Quản lý hồ sơ hành khách phục vụ tình huống khẩn cấp (Emergency & Customer Profile)
- Lưu trữ đầy đủ thông tin định danh, số điện thoại, email của từng hành khách trong hồ sơ đặt vé.
- **Cơ chế phản ứng khẩn cấp:** Khi có sự cố thời tiết xấu, bão lũ hoặc trục trặc kỹ thuật dẫn đến chuyến bay bị hoãn (`DELAYED`) hoặc hủy (`CANCELLED`):
  - Hệ thống tự động ghi nhận lý do hoãn/hủy (`delay_reason`).
  - Tự động làm nổi bật cảnh báo (`is_highlighted_change = true`) trên trang tra cứu vé của hành khách.
  - Tự động hủy các vé liên quan, hoàn lại 100% tiền và giải phóng toàn bộ số ghế đã đặt khi chuyến bay bị hủy chính thức.
- Dữ liệu hồ sơ giúp hãng hàng không nghiên cứu thị hiếu, thói quen di chuyển để tối ưu hóa mạng đường bay và kế hoạch tiếp thị.

#### 1.2.4. Tối đa hóa Doanh thu cho Hãng Hàng Không (Maximize Revenue)
- **1.2.4.1. Nâng cao nhận thức về ưu đãi qua chương trình SkyMiles:** Tích lũy dặm thưởng cho khách hàng thường xuyên nhằm gia tăng sự gắn kết thương hiệu và thúc đẩy các chuyến bay tiếp theo.
- **1.2.4.2. Giảm thiểu ghế trống, tối ưu công suất tải:** Khuyến khích đặt vé sớm qua chính sách giữ chỗ trước 14 ngày; tự động giải phóng ghế của các đơn giữ chỗ không thanh toán đúng hạn để bán lại cho hành khách khác.
- **1.2.4.3. Chính sách giá linh hoạt và phân cấp hạng dịch vụ:** Phân tách rõ các hạng vé Thương gia (Business), Phổ thông (Economy), Phổ thông đặc biệt (First Class) với mức giá và quyền lợi khác nhau nhằm khai thác tối đa khả năng chi trả của từng phân khúc khách hàng.

---

### 4.3. Góc nhìn của Hành Khách / Người sử dụng (Customers Viewpoint - Mục 1.3)

Khảo sát thực tế hành khách sử dụng hệ thống đặt vé máy bay cho thấy người dùng đánh giá cao hệ thống đáp ứng trọn vẹn các kỳ vọng sau:

#### 1.3.1. Giảm thiểu công sức và sự thất vọng khi tìm kiếm chuyến bay
- Giao diện tìm kiếm trực quan ngay tại trang chủ, thao tác mượt mà, phản hồi kết quả tức thì dưới 1 giây.
- Hỗ trợ cơ chế tự động điền (Autocomplete) và giải quyết linh hoạt giữa mã IATA sân bay và tên thành phố.

#### 1.3.2. Hiển thị toàn diện các phương án hành trình khả thi (Direct & Connecting Routes)
- Liệt kê đầy đủ các chuyến bay thẳng trực tiếp giữa cặp thành phố xuất phát và điểm đến trong ngày đã chọn.
- Trong trường hợp không có chuyến bay thẳng, hệ thống tự động kích hoạt **Thuật toán chọn tuyến (Route Selection Algorithm)** để gợi ý các hành trình bay nối chuyến với điểm dừng trung chuyển phù hợp (thời gian quá cảnh từ 45 phút đến 12 tiếng).
- Trường hợp thành phố chưa có sân bay thương mại trực tiếp (ví dụ: Hội An), hệ thống gợi ý sân bay lân cận gần nhất (Đà Nẵng - DAD cách 30 km).

#### 1.3.3. Giảm thiểu việc nhập trùng lặp thông tin
- Hành khách đã đăng ký tài khoản thành viên chỉ cần đăng nhập, hệ thống tự động trích xuất thông tin cá nhân, số điện thoại, email và thẻ tín dụng ưu tiên vào biểu mẫu đặt vé, giúp hoàn tất giao dịch trong chưa đầy 2 phút.

#### 1.3.4. Kiểm tra tính hợp lệ của dữ liệu đầu vào và cảnh báo lỗi trực quan
- Xác thực chặt chẽ mọi dữ liệu đầu vào tại cả Frontend (Reactive Forms) và Backend (NestJS Class-Validator DTOs).
- Ngăn chặn triệt để các lỗi logic nghiệp vụ: ngày về sớm hơn ngày đi, ngày khởi hành trong quá khứ, số lượng khách vượt quá số ghế còn lại của chuyến bay, định dạng email hoặc số điện thoại không hợp lệ.
- Hiển thị thông báo lỗi bằng ngôn ngữ tự nhiên rõ ràng qua hệ thống thông báo nổi (Toast Notification) và cờ trạng thái trên từng trường nhập liệu.

#### 1.3.5. Dễ dàng tra cứu tình trạng vé và thực hiện thay đổi hành trình
- Cho phép tra cứu vé nhanh chóng bằng bất kỳ mã nào trong 3 loại: Mã giữ chỗ (`BLK`), Mã xác nhận (`CNF`), hoặc Mã hồ sơ PNR (`PNR`).
- Hiển thị chi tiết toàn bộ vé điện tử, phân chia rõ ràng từng chặng bay, tình trạng thanh toán và cảnh báo giờ bay.
- Tích hợp sẵn nút hành động trực tiếp ngay trên trang tra cứu: **Xác nhận thanh toán vé giữ chỗ**, **Đổi lịch trình chuyến bay**, và **Hủy vé nhận tiền hoàn**.

---

## 5. CÁC GIỚI HẠN VÀ GIẢ ĐỊNH HỆ THỐNG (SYSTEM CONSTRAINTS & ASSUMPTIONS)

1. **Mô phỏng Giao dịch Thẻ tín dụng (Mock Payment Processing):** Trong khuôn khổ đồ án eProject học tập, hệ thống mô phỏng cổng thanh toán thẻ tín dụng bằng thuật toán mã hóa mặt nạ thẻ (`**** **** **** 1234`), ghi nhận giao dịch thành công và sinh mã hóa đơn, không kết nối trực tiếp với cổng thanh toán tài chính thực tế (Payment Gateway).
2. **Cấu hình Sơ đồ Ghế Chuẩn (Standardized Cabin Layout):** Hệ thống áp dụng sơ đồ thân hẹp chuẩn Airbus A321 (31 hàng ghế, cấu hình 3 - 3 với lối đi ở giữa, bỏ qua hàng 13 theo phong tục hàng không quốc tế, định vị hàng 12 và 14 làm hàng ghế thoát hiểm) làm hình mẫu hiển thị cho các chuyến bay.
3. **Phụ thuộc API Dữ liệu Ngoài (External Dependency):** Tính năng đồng bộ chuyến bay thực tế từ AirLabs API (`airlabs.co`) phụ thuộc vào tính sẵn sàng của mạng Internet và giới hạn hạn ngạch (quota) của tài khoản API Key.
4. **Quy định Tiền tệ Nhất quán:** Toàn bộ hệ thống áp dụng thang đơn vị tiền tệ VND (Việt Nam Đồng) thống nhất giữa dữ liệu bay nội địa và dữ liệu đồng bộ từ AirLabs nhằm tránh xung đột tỷ giá và đảm bảo trải nghiệm người dùng Việt Nam.
