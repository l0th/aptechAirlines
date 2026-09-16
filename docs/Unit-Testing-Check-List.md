# Unit Testing Check List

**Lệnh chạy test:**
`cd C:\Users\Ha\Desktop\aptechairline\backend ; npx jest --silent`

**Kết quả tổng quan:**
- Test Suites: 3 passed, 3 total
- Tests: 32 passed, 32 total

## Bảng chi tiết Test Case

| ID | Module | Mục tiêu | Đầu vào | Kết quả mong đợi | Trạng thái |
|---|---|---|---|---|---|
| TC-01 | Policies | Kiểm tra hoàn tiền >=30 ngày | daysBeforeDeparture = 35, 30 | 90 | Pass |
| TC-02 | Policies | Kiểm tra hoàn tiền 15..29 ngày | daysBeforeDeparture = 29, 15, 20 | 75 | Pass |
| TC-03 | Policies | Kiểm tra hoàn tiền 7..14 ngày | daysBeforeDeparture = 14, 7 | 50 | Pass |
| TC-04 | Policies | Kiểm tra hoàn tiền 0..6 ngày | daysBeforeDeparture = 6, 0 | 0 | Pass |
| TC-05 | Policies | Xử lý khi không có policy nào khớp | daysBeforeDeparture = 100 (không có policy) | 0 | Pass |
| TC-06 | Policies | Xử lý max_days_before = null (không giới hạn trên) | daysBeforeDeparture = 10, 100 | Lấy % hoàn tiền của dòng đó (80) | Pass |
| TC-07 | Policies | Thứ tự áp dụng policy (min_days_before giảm dần) | Có dòng hẹp (15..29) và dòng rộng (7..null) | Áp dụng đúng dòng hẹp trước | Pass |
| TC-08 | Bookings | Từ chối đặt giữ chỗ (block) khi < 14 ngày bay | is_block = true, departure < 14 days | Quăng lỗi BadRequestException | Pass |
| TC-09 | Bookings | Đặt giữ chỗ hợp lệ (is_block=true) | is_block = true, departure > 14 days | Trạng thái BLOCKED, số blocking, time_limit, 0 dặm bay | Pass |
| TC-10 | Bookings | Đặt vé trực tiếp (mua vé) | is_block = false, 2 người lớn | Trạng thái CONFIRMED, số confirmation, lưu giao dịch, cộng dặm bay | Pass |
| TC-11 | Bookings | Tính giá vé trẻ em (75%) và người cao tuổi (85%) | 1 child, 1 senior | Tổng giá vé = base * 0.75 + base * 0.85 | Pass |
| TC-12 | Bookings | Trả lại ghế và quăng lỗi nếu một chặng sau bị lỗi | Đặt 2 chặng bay, chặng 2 hết ghế | Lỗi BadRequestException, nhả ghế chặng 1 | Pass |
| TC-13 | Bookings | Lưu đúng ghế từng chặng (seat_codes) | Hành khách chọn ghế 1A cho lượt đi, 2B cho lượt về | Lưu đúng seat_code trên từng coupon | Pass |
| TC-14 | Bookings | Xác nhận vé đang giữ chỗ (confirm) | Chuyến bay đang BLOCKED, còn hạn | Trạng thái CONFIRMED, số confirmation mới, cộng dặm | Pass |
| TC-15 | Bookings | Hủy vé nếu xác nhận giữ chỗ khi đã quá hạn | Chuyến bay BLOCKED, time_limit_deadline đã qua | Lỗi BadRequest, trạng thái CANCELLED, nhả ghế | Pass |
| TC-16 | Bookings | Đổi lịch vé: từ chối vé chưa CONFIRM | Gọi reschedule với vé BLOCKED | Quăng lỗi BadRequestException | Pass |
| TC-17 | Bookings | Đổi lịch vé: thu thêm phí chênh lệch dương | Giá vé mới đắt hơn giá cũ 50 | Giao dịch RESCHEDULE_CHARGE 50, confirmation mới | Pass |
| TC-18 | Bookings | Đổi lịch vé: hoàn trả chênh lệch âm | Giá vé mới rẻ hơn giá cũ 50 | Giao dịch RESCHEDULE_REFUND 50 | Pass |
| TC-19 | Bookings | Đổi lịch vé: giữ nguyên chặng về nếu chỉ đổi chặng đi | Vé ROUND_TRIP, chỉ đổi flight lượt đi | Chặng lượt đi đổi sang chuyến mới, lượt về giữ nguyên | Pass |
| TC-20 | Bookings | Hủy vé: hoàn tiền vé đã CONFIRM và trừ dặm bay | Vé CONFIRMED, hoàn 90% | Giao dịch REFUND 90%, trừ dặm, trạng thái CANCELLED | Pass |
| TC-21 | Bookings | Hủy vé: vé BLOCKED không hoàn tiền, chỉ nhả ghế | Vé BLOCKED, tổng tiền = 0 | Trạng thái CANCELLED, gọi hàm nhả ghế, không hoàn tiền | Pass |
| TC-22 | Bookings | Hủy vé: cho phép truyền blocking_number/confirmation_number | identifier = XYZ | Truy vấn DB với toán tử $or | Pass |
| TC-23 | Bookings | Hủy vé: từ chối nếu vé đã CANCELLED | Vé đã ở trạng thái CANCELLED | Quăng lỗi BadRequestException | Pass |
| TC-24 | Flights | Search: tính tổng tiền theo hạng khách (người lớn, trẻ em, người cao tuổi) | 2 adults, 1 child, 1 senior | Tổng tiền = 2*100% + 75% + 85% | Pass |
| TC-25 | Flights | Search: loại bỏ chuyến không đủ ghế hoặc bị CANCELLED | 1 chuyến đủ ghế, 1 thiếu ghế | Chỉ trả về chuyến có đủ ghế và loại bỏ trạng thái CANCELLED | Pass |
| TC-26 | Flights | Search: báo lỗi nếu ngày về < ngày đi | return_date < departure_date | Quăng lỗi BadRequestException | Pass |
| TC-27 | Flights | Search (Nối chuyến): chỉ trả về các nối chuyến từ 45-720 phút | 1 chuyến bay nối chuyến có layover hợp lệ và 1 layover quá ngắn | Chỉ trả về chuyến có layover 60 phút | Pass |
| TC-28 | Flights | reserveSeats: trả về true nếu findOneAndUpdate thành công | flightId, inventoryId hợp lệ và đủ ghế | Cập nhật $inc -count thành công, trả về true | Pass |
| TC-29 | Flights | reserveSeats: trả về false nếu findOneAndUpdate thất bại | flightId, inventoryId không đủ ghế | findOneAndUpdate trả về null, hàm trả về false | Pass |
| TC-30 | Flights | getSeatMap: đánh dấu ghế đã bị chọn bởi khách | Chuyến bay có khách mua ghế 1A và 12F | Ghế 1A và 12F có is_occupied = true, 1B = false | Pass |
| TC-31 | Flights | getSeatMap: không bịa đặt máy bay khi không có dữ liệu thực tế | Chuyến bay không có thuộc tính aircraft | aircraft_model = null, aircraft_known = false | Pass |
| TC-32 | Flights | getSeatMap: hiển thị đúng máy bay khi có dữ liệu | Chuyến bay có aircraft model = Boeing 737 | aircraft_model = Boeing 737, aircraft_known = true | Pass |
