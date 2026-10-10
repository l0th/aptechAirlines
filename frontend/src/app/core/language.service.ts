import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { formatDayFirstDatesInText } from './date-format.util';

export type UiLanguage = 'vi' | 'en';

// These values are also common personal names or free-form domain values. They
// must be translated explicitly with pick(), never by the global DOM directive.
const AMBIGUOUS_EXACT_VALUES = new Set(['Nam', 'Male', 'Nữ', 'Female', 'Khác', 'Other']);

type TranslationPair = readonly [vi: string, en: string];

const PAIRS: TranslationPair[] = [
  ['Tìm chuyến', 'Search flights'],
  ['Lịch bay', 'Flight schedule'],
  ['Chuyến đi', 'My trips'],
  ['Đăng nhập', 'Sign in'],
  ['Đăng ký', 'Register'],
  ['Đăng xuất', 'Sign out'],
  ['Thoát', 'Sign out'],
  ['Dịch vụ', 'Services'],
  ['Hỗ trợ', 'Support'],
  ['Tra cứu chuyến bay', 'Flight lookup'],
  ['Tra cứu vé', 'Ticket lookup'],
  ['Quản lý chuyến đi', 'Manage trips'],
  ['Giữ chỗ hơn 14 ngày', 'Hold bookings more than 14 days before departure'],
  ['Đổi / hủy vé trực tuyến', 'Online reschedule / cancellation'],
  ['Chuyển đổi ngôn ngữ', 'Language'],
  ['Cổng nhân viên', 'Staff portal'],
  ['Trang khách hàng', 'Customer site'],
  ['Khám phá', 'Explore'],
  ['Trải nghiệm bay', 'Travel experience'],
  ['Hủy vé & hoàn tiền', 'Cancellation & refunds'],
  ['Chọn ghế & phụ phí', 'Seat selection & fees'],
  ['Hồ sơ khách hàng', 'Customer profile'],
  ['Giữ chỗ khi chuyến còn hơn 14 ngày', 'Hold when departure is more than 14 days away'],
  ['Hoàn tiền theo nguồn thanh toán gốc', 'Refund to the original payment source'],
  ['Thanh toán online qua PayPal', 'Online payment with PayPal'],
  ['Bay thông minh hơn với hành trình rõ ràng, quản lý vé trực tuyến, ghế linh hoạt và SkyMiles cho khách hàng thân thiết.', 'Fly smarter with clear itineraries, online trip management, flexible seating and SkyMiles rewards.'],
  ['330 ngày đặt trước', 'Book up to 330 days ahead'],

  ['APTECH AIRLINES · BAY XA HƠN', 'APTECH AIRLINES · FLY BEYOND'],
  ['Tìm chuyến bay phù hợp cho hành trình của bạn.', 'Find the right flight for your journey.'],
  ['Tra cứu lịch bay, so sánh chuyến thẳng hoặc nối chuyến và đặt vé trong vài bước rõ ràng.', 'Check schedules, compare direct or connecting flights and book in a few clear steps.'],
  ['Lịch bay rõ ràng', 'Clear flight schedules'],
  ['Chọn ghế linh hoạt', 'Flexible seat selection'],
  ['Quản lý vé trực tuyến', 'Manage tickets online'],
  ['Một chiều', 'One way'],
  ['Khứ hồi', 'Round trip'],
  ['Nơi đi', 'From'],
  ['Nơi đến', 'To'],
  ['Bạn có thể nhập mã IATA hoặc tên thành phố. Nếu điểm đó chưa được khai thác trực tiếp, hệ thống sẽ đề xuất sân bay gần nhất.', 'Enter an IATA code or city name. If the location is not served directly, the nearest supported airport will be suggested.'],
  ['Tìm chuyến trong khoảng ngày', 'Search within a date range'],
  ['Ngày đi', 'Departure date'],
  ['Đến ngày', 'End date'],
  ['Ngày về', 'Return date'],
  ['Hạng vé', 'Cabin class'],
  ['Phổ thông', 'Economy'],
  ['Thương gia', 'Business'],
  ['Hạng nhất', 'First class'],
  ['Người lớn', 'Adult'],
  ['Trẻ em', 'Child'],
  ['Cao tuổi', 'Senior'],
  ['Tìm chuyến bay', 'Search flights'],
  ['TRẢI NGHIỆM BAY', 'TRAVEL EXPERIENCE'],
  ['Mọi thứ bạn cần cho một hành trình chủ động', 'Everything you need for a journey you control'],
  ['Từ lúc tìm chuyến đến sau khi đặt vé, các thao tác quan trọng đều được thiết kế để khách hàng dễ theo dõi và tự quản lý.', 'From flight search to post-booking management, every important step is designed to be easy to follow and manage.'],
  ['Tìm chuyến dễ dàng', 'Easy flight search'],
  ['Tra cứu chuyến thẳng và nối chuyến theo ngày, hạng vé và số hành khách trong cửa sổ đặt vé 330 ngày.', 'Search direct and connecting flights by date, cabin and party size within a 330-day booking window.'],
  ['Tra cứu chuyến thẳng và nối chuyến theo ngày, số hành khách và so sánh giá các hạng vé ngay trong kết quả.', 'Search direct and connecting flights by date and party size, then compare cabin fares directly in the results.'],
  ['Chọn chỗ ngồi theo ý bạn', 'Choose the seat you prefer'],
  ['Xem sơ đồ ghế, vị trí ngồi và phụ phí trước khi hoàn tất đặt vé.', 'Review the seat map, seat position and fees before completing your booking.'],
  ['Quản lý chuyến đi trực tuyến', 'Manage your trip online'],
  ['Tra cứu vé, đổi chuyến hoặc hủy vé theo chính sách ngay trong tài khoản của bạn.', 'Look up tickets, reschedule or cancel according to policy from your account.'],
  ['DỊCH VỤ NỔI BẬT', 'FEATURED SERVICES'],
  ['Linh hoạt trước và sau khi đặt vé', 'Flexible before and after booking'],
  ['Thông tin rõ ràng giúp bạn chủ động hơn khi kế hoạch thay đổi.', 'Clear information helps you stay in control when plans change.'],
  ['Tra cứu lịch bay', 'Check flight schedules'],
  ['Xem giờ khởi hành và trạng thái chuyến bay.', 'View departure times and flight status.'],
  ['Ghế & phụ phí', 'Seats & fees'],
  ['Xem cách chọn ghế và mức phí áp dụng.', 'See seat selection options and applicable fees.'],
  ['Đổi chuyến', 'Reschedule'],
  ['Đổi ngày hoặc chuyến bay trên hành trình phù hợp.', 'Change the date or flight on an eligible itinerary.'],
  ['Xem chính sách và quy trình hoàn tiền.', 'Review the cancellation policy and refund process.'],
  ['Đặt vé máy bay và quản lý hành trình trong một nơi', 'Book flights and manage your journey in one place'],
  ['Aptech Airlines giúp bạn tìm chuyến bay theo điểm đi, điểm đến và ngày khởi hành; xem lựa chọn chuyến thẳng hoặc nối chuyến; chọn hạng vé và kiểm tra chỗ ngồi trước khi đặt vé.', 'Aptech Airlines helps you find flights by origin, destination and departure date; compare direct or connecting options; choose a cabin and review seats before booking.'],
  ['Sau khi có vé, bạn có thể theo dõi hành trình, tra cứu lịch bay, chọn ghế, đổi chuyến và xem chính sách hủy vé trực tuyến.', 'After booking, you can track your itinerary, check schedules, choose seats, reschedule and review cancellation policies online.'],
  ['Xem lịch bay', 'View flight schedules'],
  ['Fly Beyond · Travel with confidence', 'Fly Beyond · Travel with confidence'],

  ['Chào mừng trở lại', 'Welcome back'],
  ['Đăng nhập để giữ chỗ, mua vé và quản lý hành trình.', 'Sign in to hold or buy tickets and manage your journeys.'],
  ['Tên đăng nhập', 'Username'],
  ['Mật khẩu', 'Password'],
  ['Quên mật khẩu?', 'Forgot password?'],
  ['Quên mật khẩu', 'Forgot password'],
  ['Nhập email đã đăng ký. Hệ thống sẽ gửi mã xác nhận 6 số có hiệu lực trong 10 phút.', 'Enter your registered email. We will send a six-digit verification code valid for 10 minutes.'],
  ['Gửi mã xác nhận', 'Send verification code'],
  ['Đang gửi…', 'Sending…'],
  ['Quay lại đăng nhập', 'Back to sign in'],
  ['Đặt lại mật khẩu', 'Reset password'],
  ['Nhập mã 6 số đã gửi về email và đặt mật khẩu mới.', 'Enter the six-digit code sent to your email and choose a new password.'],
  ['Mã xác nhận', 'Verification code'],
  ['Mật khẩu mới', 'New password'],
  ['Nhập lại mật khẩu mới', 'Confirm new password'],
  ['Đang đổi…', 'Updating…'],
  ['Đổi mật khẩu', 'Change password'],
  ['Gửi lại mã', 'Resend code'],
  ['Tạo tài khoản', 'Create account'],
  ['Giao dịch giữ chỗ, mua, đổi và hủy vé dành cho người dùng đã đăng ký.', 'Holding, purchasing, rescheduling and cancellation are available to registered users.'],
  ['Họ', 'Last name'],
  ['Tên', 'First name'],
  ['Số điện thoại', 'Phone number'],
  ['Giới tính', 'Gender'],
  ['Nam', 'Male'],
  ['Nữ', 'Female'],
  ['Khác', 'Other'],
  ['Tuổi', 'Age'],
  ['Thẻ ưu tiên', 'Preferred card'],
  ['Địa chỉ', 'Address'],
  ['Tối thiểu 6 ký tự.', 'At least 6 characters.'],
  ['12–19 chữ số. Máy chủ chỉ trả lại số thẻ đã che.', '12–19 digits. The server only returns a masked card number.'],
  ['Đang xử lý…', 'Processing…'],
  ['Vui lòng nhập đầy đủ thông tin đăng ký.', 'Please complete all registration fields.'],
  ['Nhập tên đăng nhập và mật khẩu.', 'Enter your username and password.'],
  ['Mật khẩu phải có ít nhất 6 ký tự.', 'Password must be at least 6 characters.'],
  ['Email không đúng định dạng.', 'Email format is invalid.'],
  ['Số điện thoại phải có từ 7 đến 15 chữ số.', 'Phone number must contain 7 to 15 digits.'],
  ['Số thẻ phải có từ 12 đến 19 chữ số.', 'Card number must contain 12 to 19 digits.'],
  ['Tuổi phải là số nguyên không âm.', 'Age must be a non-negative integer.'],
  ['Vui lòng nhập email hợp lệ.', 'Please enter a valid email address.'],
  ['Mã xác nhận phải gồm đúng 6 chữ số.', 'Verification code must contain exactly 6 digits.'],
  ['Mật khẩu mới phải có ít nhất 6 ký tự.', 'New password must be at least 6 characters.'],
  ['Hai mật khẩu mới chưa khớp nhau.', 'The new passwords do not match.'],
  ['Nếu email tồn tại, mã xác nhận đã được gửi.', 'If the email exists, a verification code has been sent.'],
  ['Không thể gửi mã xác nhận.', 'Unable to send the verification code.'],
  ['Đổi mật khẩu thành công. Hãy đăng nhập lại.', 'Password changed successfully. Please sign in again.'],
  ['Không thể đổi mật khẩu.', 'Unable to reset the password.'],
  ['Không thể thực hiện yêu cầu.', 'Unable to complete the request.'],
  ['Tên đăng nhập hoặc mật khẩu không đúng.', 'Invalid username or password'],
  ['Tên đăng nhập đã tồn tại.', 'Username already exists'],
  ['Email đã tồn tại.', 'Email already exists'],
  ['Nếu email tồn tại trong hệ thống, mã xác nhận 6 số đã được gửi và có hiệu lực trong 10 phút.', 'If the email exists in the system, a six-digit verification code has been sent and is valid for 10 minutes.'],
  ['Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.', 'The verification code is invalid or expired. Please request a new code.'],
  ['Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại.', 'The verification code is invalid or expired. Please check it again.'],
  ['Đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.', 'Password changed successfully. You can now sign in with the new password.'],

  ['KẾT QUẢ CHUYẾN BAY', 'FLIGHT RESULTS'],
  ['So sánh mọi hạng vé', 'Compare all cabins'],
  ['Chọn hạng vé', 'Choose cabin'],
  ['Còn tối thiểu', 'At least'],
  ['Sửa tìm kiếm', 'Edit search'],
  ['Đang tìm chuyến phù hợp…', 'Searching for suitable flights…'],
  ['Kiểm tra chuyến thẳng, nối chuyến, giá và số ghế.', 'Checking direct flights, connections, fares and seat availability.'],
  ['Không tải được kết quả', 'Unable to load results'],
  ['Không tìm thấy chuyến bay phù hợp', 'No suitable flights found'],
  ['Hiện chưa có chuyến bay phù hợp với ngày và hành trình bạn đã chọn. Vui lòng thử ngày khác hoặc sân bay khác.', 'There are no suitable flights for the selected date and itinerary. Please try another date or airport.'],
  ['Không thể tải kết quả tìm kiếm. Vui lòng thử lại.', 'Unable to load search results. Please try again.'],
  ['CHIỀU ĐI', 'OUTBOUND'],
  ['CHIỀU VỀ', 'RETURN'],
  ['Đã chọn chiều đi', 'Outbound selected'],
  ['Đã chọn chiều về', 'Return selected'],
  ['Chọn chuyến đi trước, sau đó chọn chuyến về.', 'Select the outbound flight before choosing the return flight.'],
  ['Chuyến bay thẳng', 'Direct flights'],
  ['Chuyến bay nối', 'Connecting flights'],
  ['Bay thẳng', 'Direct'],
  ['Chọn', 'Select'],
  ['Đã chọn', 'Selected'],
  ['Chọn hành trình', 'Select itinerary'],
  ['Nối chuyến', 'Connection'],
  ['CHÍNH SÁCH HỦY VÉ', 'CANCELLATION POLICY'],
  ['Hoàn tiền theo thời điểm hủy', 'Refund by cancellation time'],
  ['Áp dụng theo số ngày còn lại trước chuyến khởi hành sớm nhất.', 'Based on the days remaining before the earliest departure.'],
  ['Đã chọn đủ hành trình khứ hồi', 'Round trip selection complete'],
  ['Tiếp tục nhập hành khách', 'Continue to passenger details'],
  ['Chưa nhận diện được', 'Could not identify'],
  ['Hãy quay lại và chọn thành phố hoặc sân bay từ danh sách gợi ý để tìm chính xác hơn.', 'Go back and choose a city or airport from the suggestions for a more accurate search.'],
  ['Điểm bay đã được xác định', 'Location resolved'],
  ['nơi đi', 'origin'],
  ['nơi đến', 'destination'],
  ['Giá chuẩn', 'Standard fare'],
  ['Gần ngày bay', 'Near departure'],

  ['BƯỚC 2 / 4', 'STEP 2 / 4'],
  ['BƯỚC 3 / 4', 'STEP 3 / 4'],
  ['BƯỚC 4 / 4', 'STEP 4 / 4'],
  ['Thông tin hành khách', 'Passenger details'],
  ['Loại hành khách được giữ đúng theo tìm kiếm để giá và đặt chỗ luôn nhất quán.', 'Passenger types are kept consistent with the search so pricing and booking remain accurate.'],
  ['Hành khách', 'Passenger'],
  ['Loại hành khách', 'Passenger type'],
  ['Được xác định từ bước tìm chuyến.', 'Determined by the flight search.'],
  ['CCCD / Passport', 'ID / Passport'],
  ['Quốc tịch', 'Nationality'],
  ['Ngày sinh', 'Date of birth'],
  ['Quay lại', 'Back'],
  ['Tiếp tục chọn ghế', 'Continue to seat selection'],
  ['Vui lòng nhập họ tên cho tất cả hành khách.', 'Enter the full name for every passenger.'],
  ['Ngày sinh phải đúng định dạng dd/mm/yyyy.', 'Date of birth must use dd/mm/yyyy format.'],
  ['Ngày sinh không được nằm trong tương lai.', 'Date of birth cannot be in the future.'],
  ['Chọn chỗ ngồi', 'Seat selection'],
  ['Chọn ghế cho từng hành khách trên từng chặng. Mỗi ô hiển thị mã ghế đầy đủ: ví dụ 18A là hàng 18, ghế A.', 'Choose a seat for each passenger on every leg. Each tile shows the full seat code: for example, 18A means row 18, seat A.'],
  ['Chọn hạng vé và ghế cho từng chặng. Bạn vẫn có thể đổi hạng vé ngay tại đây trước khi thanh toán.', 'Choose the cabin and seat for each leg. You can still change cabin here before payment.'],
  ['HẠNG VÉ CỦA CHẶNG', 'CABIN FOR THIS LEG'],
  ['Bạn có thể đổi hạng vé trước khi chọn ghế', 'You can change cabin before selecting a seat'],
  ['Đổi hạng sẽ cập nhật lại giá vé và xóa các ghế đã chọn trên riêng chặng này.', 'Changing cabin updates the fare and clears seat selections for this leg only.'],
  ['Hạng khác — chọn ở phía trên', 'Different cabin — choose above'],
  ['Hạng khác — bấm ghế để đổi hạng', 'Different cabin — click a seat to switch'],
  ['Người cùng booking đã chọn', 'Selected by another passenger'],
  ['MŨI', 'NOSE'],
  ['ĐUÔI', 'TAIL'],
  ['Hàng', 'Row'],
  ['Máy bay', 'Aircraft'],
  ['ghế còn', 'seats left'],
  ['Phụ phí', 'Seat fee'],
  ['Đang tải sơ đồ ghế…', 'Loading seat map…'],
  ['Tải lại', 'Retry'],
  ['CHẶNG', 'LEG'],
  ['Còn trống', 'Available'],
  ['Đang chọn', 'Selected now'],
  ['Đã bán / giữ', 'Sold / held'],
  ['Người cùng đặt chỗ đã chọn', 'Selected by another passenger'],
  ['Hạng ghế khác', 'Different cabin'],
  ['Hàng thoát hiểm', 'Exit row'],
  ['CÁCH ĐỌC SƠ ĐỒ', 'HOW TO READ THE MAP'],
  ['Mũi máy bay → các hàng ghế → đuôi máy bay', 'Aircraft nose → seat rows → aircraft tail'],
  ['= hàng ghế', '= seat row'],
  ['= vị trí ghế', '= seat position'],
  ['Khoảng trống nét đứt = lối đi', 'Dashed gap = aisle'],
  ['Đang đổi ghế', 'Changing seat'],
  ['Chọn một ghế còn trống khác trên sơ đồ. Ghế cũ chỉ được thay thế sau khi bạn chọn ghế mới.', 'Choose another available seat on the map. Your current seat is replaced only after you select a new one.'],
  ['Cửa sổ', 'Window'],
  ['Lối đi', 'Aisle'],
  ['Ghế giữa', 'Middle seat'],
  ['Vị trí tiêu chuẩn', 'Standard position'],
  ['Chỗ để chân rộng', 'Extra legroom'],
  ['Ghế tiêu chuẩn', 'Standard seat'],
  ['Premium / Club', 'Premium / Club'],
  ['Muốn đổi ghế? Bạn có thể bấm trực tiếp một ghế còn trống khác, hoặc dùng nút “Đổi ghế” để quay về sơ đồ.', 'Want to change seats? Click any other available seat, or use “Change seat” to return to the map.'],
  ['Đổi ghế', 'Change seat'],
  ['Chọn ghế cụ thể', 'Choose a specific seat'],
  ['Chưa chọn cách xếp ghế', 'No seat assignment selected'],
  ['Hệ thống sẽ tự động xếp ghế', 'The system will assign a seat automatically'],
  ['Ghế', 'Seat'],
  ['Tự động xếp ghế', 'Auto-assign seat'],
  ['Tổng phụ phí ghế đã chọn', 'Selected seat fees'],
  ['Tổng phụ phí ghế', 'Total seat fees'],
  ['Tổng giá cho lựa chọn hiện tại', 'Total for current selection'],
  ['Tổng tạm tính', 'Estimated total'],
  ['lựa chọn đã xác nhận. Mục chưa chọn sẽ tự động xếp ghế.', 'selections confirmed. Unselected seats will be assigned automatically.'],
  ['Kiểm tra & thanh toán', 'Review & payment'],
  ['Xác nhận hành trình, hành khách, ghế và phương thức thanh toán trước khi hoàn tất đặt vé.', 'Review the itinerary, passengers, seats and payment method before completing your booking.'],
  ['ĐẶT VÉ TẠI QUẦY', 'COUNTER BOOKING'],
  ['Chưa chọn khách hàng', 'No customer selected'],
  ['Vào Quầy đặt vé và chọn KHÁCH HÀNG trước khi tạo đặt chỗ.', 'Open Reservation Desk and select a CUSTOMER before creating a booking.'],
  ['Quầy đặt vé', 'Reservation Desk'],
  ['Nhân viên phải chọn khách hàng tại Quầy đặt vé trước.', 'Staff must select a customer in Reservation Desk first.'],
  ['Hành trình', 'Itinerary'],
  ['Chỗ ngồi', 'Seats'],
  ['Tổng quan giá', 'Price summary'],
  ['Giá tại quầy đang là mức tạm tính. Tổng cuối cùng sẽ được cập nhật theo hồ sơ khách hàng trước khi xác nhận vé.', 'Counter pricing is currently an estimate. The final total is updated from the customer profile before ticket confirmation.'],
  ['Ước tính vé', 'Estimated fare'],
  ['Phụ phí ghế đã chọn', 'Selected seat fees'],
  ['Ước tính', 'Estimate'],
  ['Đăng nhập để lấy báo giá theo SkyMiles và hoàn tất giao dịch.', 'Sign in to get your SkyMiles quote and complete the transaction.'],
  ['Đang cập nhật giá vé…', 'Updating fare…'],
  ['Giá vé', 'Fare'],
  ['Phụ phí ghế', 'Seat fees'],
  ['Điều chỉnh theo ngày bay', 'Departure-date adjustment'],
  ['Tổng', 'Total'],
  ['Mua vé ngay', 'Buy now'],
  ['Giữ chỗ', 'Hold booking'],
  ['Giữ chỗ chỉ áp dụng khi chuyến khởi hành sớm nhất còn hơn 14 ngày.', 'Hold is available only when the earliest departure is more than 14 days away.'],
  ['Quay lại chọn ghế', 'Back to seat selection'],
  ['Đăng nhập để tiếp tục', 'Sign in to continue'],
  ['Chọn khách hàng', 'Select customer'],
  ['Thanh toán tại quầy', 'Counter payment'],
  ['Thẻ ưu tiên trong hồ sơ KHÁCH HÀNG', 'Preferred card in the CUSTOMER profile'],
  ['Thẻ trong hồ sơ', 'Profile card'],
  ['Thanh toán hỗ trợ tại quầy', 'Assisted counter payment'],
  ['Nhân viên xử lý giao dịch tại quầy; PayPal Checkout chỉ mở cho tài khoản khách hàng.', 'Staff handle the assisted counter transaction; PayPal Checkout is opened only for customer accounts.'],
  ['Sẵn sàng thanh toán', 'Ready for payment'],
  ['Đang chuẩn bị PayPal…', 'Preparing PayPal…'],
  ['PayPal hiện chưa sẵn sàng', 'PayPal is currently unavailable'],
  ['Thanh toán được xử lý bảo mật qua PayPal. Aptech Airlines không lưu thông tin thẻ của bạn.', 'Payment is securely processed by PayPal. Aptech Airlines does not store your card information.'],
  ['Thanh toán PayPal hiện chưa sẵn sàng. Vui lòng thử lại sau.', 'PayPal payment is currently unavailable. Please try again later.'],
  ['chưa bật', 'disabled'],
  ['Thanh toán & đặt vé', 'Pay & book'],
  ['Chuyến này không còn đủ điều kiện giữ chỗ hơn 14 ngày.', 'This flight is no longer eligible for a hold more than 14 days before departure.'],
  ['Không lấy được báo giá.', 'Unable to load quote.'],
  ['Không hoàn tất được đặt vé.', 'Unable to complete the booking.'],

  ['HOÀN TẤT', 'COMPLETE'],
  ['Đã giữ chỗ thành công', 'Booking held successfully'],
  ['Đặt vé thành công', 'Booking successful'],
  ['Lưu mã bên dưới để tra cứu và quản lý hành trình.', 'Keep the code below to look up and manage your journey.'],
  ['Chuyến đi của tôi', 'My trips'],
  ['Về trang chủ', 'Back to home'],

  ['Quản lý chuyến đi', 'Manage trips'],
  ['Xem hành trình, xác nhận vé đang giữ, đổi chuyến hoặc hủy đặt chỗ.', 'View itineraries, confirm held tickets, reschedule or cancel bookings.'],
  ['Cần đăng nhập', 'Sign in required'],
  ['Đăng nhập để xem các chuyến đi của bạn.', 'Sign in to view your trips.'],
  ['Đang tải chuyến đi…', 'Loading trips…'],
  ['Đang giữ chỗ', 'On hold'],
  ['Đã xác nhận', 'Confirmed'],
  ['Đã đổi chuyến', 'Rescheduled'],
  ['Đã hủy', 'Cancelled'],
  ['MỘT CHIỀU', 'ONE WAY'],
  ['KHỨ HỒI', 'ROUND TRIP'],
  ['NỐI CHUYẾN', 'CONNECTING'],
  ['hành khách', 'passenger'],
  ['Giữ đến', 'Held until'],
  ['Chi tiết', 'Details'],
  ['Xác nhận bằng thẻ', 'Confirm with card'],
  ['Xác nhận tại quầy', 'Confirm at counter'],
  ['Thanh toán PayPal', 'Pay with PayPal'],
  ['Đổi vé', 'Reschedule'],
  ['Hủy vé', 'Cancel ticket'],
  ['CHI TIẾT ĐẶT CHỖ', 'BOOKING DETAIL'],
  ['Mã xử lý', 'Reference'],
  ['Chưa có mã xử lý', 'No processing code yet'],
  ['Vé đang được giữ đến', 'Booking is held until'],
  ['Hành trình', 'Itinerary'],
  ['Chiều đi', 'Outbound'],
  ['Chiều về', 'Return'],
  ['chặng', 'leg'],
  ['Giá vé', 'Fare'],
  ['Bạn chưa có đặt chỗ nào.', 'You do not have any bookings yet.'],
  ['Không tải được đặt chỗ.', 'Unable to load bookings.'],
  ['Không tải được lịch bay chi tiết.', 'Unable to load flight details.'],
  ['Đã xác nhận vé bằng PayPal.', 'Ticket confirmed with PayPal.'],
  ['Không xác nhận được vé bằng PayPal.', 'Unable to confirm ticket with PayPal.'],
  ['Không xác nhận được vé.', 'Unable to confirm ticket.'],
  ['Không hủy được vé.', 'Unable to cancel ticket.'],

  ['TRẠNG THÁI VÉ', 'TICKET STATUS'],
  ['Nhập mã giữ chỗ, confirmation number hoặc PNR để xem trạng thái và quyền xử lý hiện tại.', 'Enter a hold code, confirmation number or PNR to view the current status and available actions.'],
  ['Đang tra…', 'Looking up…'],
  ['Tra cứu', 'Look up'],
  ['Tổng tiền', 'Total amount'],
  ['Chặng bay & coupon', 'Flight legs & coupons'],
  ['Có thay đổi lịch bay hoặc trạng thái chuyến. Kiểm tra các chặng được đánh dấu bên dưới.', 'The schedule or flight status has changed. Review the highlighted legs below.'],
  ['Hủy đặt chỗ', 'Cancel booking'],
  ['Không tìm thấy vé hoặc bạn không có quyền xem đặt chỗ này.', 'Ticket not found or you do not have permission to view this booking.'],
  ['Giữ chỗ đến', 'Held until'],

  ['TRA CỨU CHUYẾN BAY CÔNG KHAI', 'PUBLIC FLIGHT LOOKUP'],
  ['Tra cứu lịch bay', 'Flight schedule lookup'],
  ['Không cần đăng nhập. Nhập số hiệu chuyến bay và ngày để xem giờ khởi hành, giờ đến và trạng thái mới nhất.', 'No sign-in required. Enter a flight number and date to view departure, arrival and the latest status.'],
  ['SỐ HIỆU CHUYẾN BAY', 'FLIGHT NUMBER'],
  ['NGÀY BAY', 'FLIGHT DATE'],
  ['Số hiệu chuyến bay', 'Flight number'],
  ['Ngày bay', 'Flight date'],
  ['Không có chuyến phù hợp', 'No matching flight'],
  ['Kiểm tra lại số hiệu chuyến bay và ngày.', 'Check the flight number and date.'],
  ['Vui lòng nhập đầy đủ số hiệu chuyến bay và ngày bay.', 'Enter both flight number and flight date.'],
  ['Không tìm thấy chuyến bay phù hợp.', 'No matching flight found.'],
  ['Khởi hành', 'Departure'],
  ['Đến', 'Arrival'],
  ['Trạng thái', 'Status'],
  ['Thực tế', 'Actual'],
  ['Chuyến bay có giờ thực tế khác lịch dự kiến. Vui lòng ưu tiên thông tin thực tế hiển thị ở trên.', 'Actual flight times differ from the schedule. Use the actual times shown above.'],

  ['HỒ SƠ', 'PROFILE'],
  ['Hồ sơ & SkyMiles', 'Profile & SkyMiles'],
  ['Vui lòng đăng nhập.', 'Please sign in.'],
  ['Điện thoại', 'Phone'],
  ['SkyMiles hiện tại', 'Current SkyMiles'],
  ['Xem hạng thành viên & quyền lợi →', 'View tier & benefits →'],
  ['Thanh toán trực tuyến', 'Online payment'],
  ['Thanh toán được thực hiện tại PayPal Checkout. Aptech Airlines không yêu cầu lưu số thẻ trong hồ sơ.', 'Payment is completed through PayPal Checkout. Aptech Airlines does not require a card number to be stored in your profile.'],
  ['Chính sách hủy vé & hoàn tiền', 'Cancellation & refund policy'],
  ['THÔNG TIN CÁ NHÂN', 'PERSONAL INFORMATION'],
  ['Cập nhật hồ sơ', 'Update profile'],
  ['Thông tin này được dùng để tự điền hành khách khi bạn đặt vé.', 'This information is used to prefill passenger details when you book.'],
  ['Không cần khai báo thẻ ngân hàng.', 'No bank card details are required here.'],
  ['Khi mua vé hoặc trả chênh lệch đổi chuyến, hệ thống mở PayPal Checkout để bạn thanh toán.', 'When buying a ticket or paying a reschedule difference, PayPal Checkout opens for payment.'],
  ['Thay thẻ ưu tiên', 'Replace preferred card'],
  ['Nhập số thẻ mới nếu muốn thay', 'Enter a new card number to replace it'],
  ['Bỏ trống để giữ nguyên thẻ hiện tại. Máy chủ sẽ lưu an toàn và chỉ trả lại dạng che số.', 'Leave blank to keep the current card. The server stores it safely and returns only a masked value.'],
  ['Lưu thay đổi', 'Save changes'],
  ['Đã cập nhật hồ sơ.', 'Profile updated.'],
  ['Không cập nhật được hồ sơ.', 'Unable to update profile.'],

  ['KHÁCH HÀNG THÂN THIẾT', 'LOYALTY'],
  ['Điểm hiện tại', 'Current points'],
  ['Điểm được cộng khi vé được xác nhận và điều chỉnh khi hủy chuyến.', 'Points are credited when a ticket is confirmed and adjusted when a trip is cancelled.'],
  ['giảm', 'discount'],
  ['Đăng nhập để tích điểm', 'Sign in to earn points'],

  ['Mỗi dặm bay đưa bạn đến', 'Every mile brings you closer to'],
  ['một hạng thành viên mới.', 'your next membership tier.'],
  ['Tích lũy theo quãng đường của vé đã xác nhận, nhận ưu đãi giá tự động và theo dõi tiến độ lên hạng ngay trong tài khoản.', 'Earn miles from confirmed-flight distance, receive automatic fare benefits and track your tier progress from your account.'],
  ['Hồ sơ của tôi', 'My profile'],
  ['HẠNG HIỆN TẠI', 'CURRENT TIER'],
  ['ưu đãi SkyMiles được áp dụng khi hệ thống tính giá vé.', 'SkyMiles discount is applied when the fare is calculated.'],
  ['Bạn đã đạt hạng cao nhất trong chương trình hiện tại.', 'You have reached the highest tier in the current program.'],
  ['Bốn hạng thành viên, quyền lợi tăng dần', 'Four membership tiers with increasing benefits'],
  ['HẠNG THÀNH VIÊN', 'MEMBERSHIP TIERS'],
  ['Số SkyMiles hiện có tại thời điểm báo giá quyết định hạng thành viên và mức ưu đãi áp dụng.', 'Your SkyMiles balance at quote time determines your membership tier and applicable benefit.'],
  ['HẠNG CỦA BẠN', 'YOUR TIER'],
  ['Bắt đầu tích lũy trên mọi vé đã xác nhận.', 'Start earning on every confirmed ticket.'],
  ['Mở mức giảm SkyMiles 3% trong pricing.', 'Unlock a 3% SkyMiles pricing discount.'],
  ['Mức giảm SkyMiles tăng lên 7%.', 'Your SkyMiles discount increases to 7%.'],
  ['Hạng cao nhất hiện tại với mức giảm 12%.', 'The current top tier with a 12% discount.'],
  ['Tích lũy theo quãng đường thực tế', 'Earn based on actual flight distance'],
  ['CÁCH TÍCH LŨY', 'HOW TO EARN'],
  ['Khi vé được xác nhận, SkyMiles được cộng theo quãng đường của các chặng bay. Vé nối chuyến tính tổng các chặng; khi đổi hoặc hủy vé, số dặm được điều chỉnh theo hành trình còn hiệu lực.', 'When a ticket is confirmed, SkyMiles are credited based on flight distance. Connecting itineraries add all legs, while rescheduling or cancellation adjusts miles to match the active itinerary.'],
  ['Chọn chuyến', 'Choose flight'],
  ['Xác nhận vé', 'Confirm ticket'],
  ['Cộng SkyMiles', 'Credit SkyMiles'],
  ['Tự động lên hạng', 'Automatic tier upgrade'],
  ['Giảm giá tự động', 'Automatic discount'],
  ['Member 0%, Silver 3%, Gold 7%, Platinum 12% theo hạng thành viên hiện tại.', 'Member 0%, Silver 3%, Gold 7% and Platinum 12% based on your current membership tier.'],
  ['Điều chỉnh theo hành trình mới', 'Adjusted for the new itinerary'],
  ['Đổi chuyến có thể làm tăng hoặc giảm SkyMiles theo tổng quãng đường của các chặng được thay.', 'Rescheduling can increase or decrease SkyMiles based on the total distance of the replaced legs.'],
  ['Đồng bộ khi hủy vé', 'Adjusted on cancellation'],
  ['SkyMiles đã cộng được điều chỉnh khi vé bị hủy để phản ánh hành trình còn hiệu lực.', 'Previously credited SkyMiles are adjusted when a ticket is cancelled to reflect the remaining active itinerary.'],

  ['Hủy vé & hoàn tiền,', 'Cancellation & refunds,'],
  ['rõ ràng trước khi xác nhận.', 'clear before you confirm.'],
  ['Xem mức hoàn dự kiến, hủy vé và theo dõi tiền hoàn về đúng nguồn thanh toán ban đầu.', 'Review the estimated refund, cancel a ticket and track funds back to the original payment source.'],
  ['QUY TRÌNH HOÀN TIỀN', 'REFUND PROCESS'],
  ['Tra cứu vé đã mua hoặc đang giữ.', 'Look up a purchased or held ticket.'],
  ['Hệ thống xác định mức hoàn theo thời điểm khởi hành.', 'The system determines the refund rate from the time remaining before departure.'],
  ['Xác nhận hủy và giải phóng ghế.', 'Confirm cancellation and release the seats.'],
  ['Khoản hoàn được trả về nguồn thanh toán gốc.', 'The refund is returned to the original payment source.'],
  ['VÉ ĐANG GIỮ', 'HELD BOOKING'],
  ['Hủy giữ chỗ', 'Cancel a hold'],
  ['Vé đang giữ chưa phát sinh thanh toán. Khi hủy, ghế được giải phóng và không có khoản hoàn tiền.', 'A held ticket has not been paid. Cancelling releases the seats and creates no refund.'],
  ['VÉ ĐÃ XÁC NHẬN', 'CONFIRMED TICKET'],
  ['Hoàn theo chính sách', 'Policy-based refund'],
  ['Mức hoàn được xác định theo số ngày còn lại trước giờ bay và chính sách đang hoạt động trong hệ thống.', 'The refund rate is determined by the days remaining before departure and the active system policy.'],
  ['Hoàn về nguồn gốc', 'Refund to original source'],
  ['Với giao dịch PayPal, khoản hoàn được xử lý về nguồn thanh toán ban đầu của giao dịch.', 'For PayPal transactions, refunds are processed back to the original payment source.'],
  ['CHÍNH SÁCH HIỆN TẠI', 'CURRENT POLICY'],
  ['Mức hoàn tiền đang áp dụng', 'Current refund rates'],
  ['Các mức hoàn bên dưới được cập nhật theo chính sách hiện hành và thời gian còn lại trước giờ khởi hành.', 'The refund rates below reflect the current policy and the time remaining before departure.'],
  ['Đang tải chính sách hoàn tiền…', 'Loading refund policy…'],
  ['Hiện chưa có chính sách hoàn tiền để hiển thị.', 'There is currently no refund policy to display.'],
  ['Trước giờ bay', 'Before departure'],
  ['mức hoàn', 'refund rate'],
  ['Cần xử lý booking ngay?', 'Need to manage a booking now?'],
  ['Vào “Chuyến đi của tôi” để xem mức hoàn dự kiến trước khi bấm hủy.', 'Open “My trips” to review the estimated refund before cancelling.'],
  ['Mở chuyến đi', 'Open my trips'],

  ['Đổi chuyến mà vẫn giữ nguyên hành trình.', 'Reschedule while keeping the same route.'],
  ['Bạn có thể đổi ngày hoặc chuyến bay khác trên cùng tuyến của vé gốc. Chênh lệch giá, ghế và SkyMiles được cập nhật trước khi bạn xác nhận.', 'Choose another date or flight on the original route. Fare difference, seats and SkyMiles are updated before you confirm.'],
  ['Bắt đầu đổi chuyến', 'Start rescheduling'],
  ['VÉ GỐC', 'ORIGINAL TICKET'],
  ['Tuyến được giữ nguyên', 'Route stays unchanged'],
  ['CHUYẾN MỚI', 'NEW FLIGHT'],
  ['Đổi ngày, chuyến bay thẳng hoặc nối chuyến', 'Change date, direct flight or connecting itinerary'],
  ['Tra cứu vé', 'Look up ticket'],
  ['Vé đã xác nhận có thể bắt đầu quy trình đổi chuyến.', 'Confirmed tickets can start the reschedule process.'],
  ['Chọn ngày mới', 'Choose a new date'],
  ['Điểm đi và điểm đến giữ nguyên theo vé gốc; bạn chọn ngày hoặc chuyến bay mới.', 'Origin and destination remain unchanged from the original ticket; you choose a new date or flight.'],
  ['So sánh giá', 'Compare fares'],
  ['Hệ thống cập nhật giá vé, phụ phí ghế và SkyMiles theo hành trình mới.', 'The system updates the fare, seat fees and SkyMiles for the new itinerary.'],
  ['Thanh toán / hoàn', 'Payment / refund'],
  ['Chênh lệch dương thanh toán PayPal; chênh lệch âm hoàn về nguồn gốc.', 'A positive difference is paid with PayPal; a negative difference is refunded to the original source.'],
  ['CHÊNH LỆCH DƯƠNG', 'POSITIVE DIFFERENCE'],
  ['Hành trình mới đắt hơn', 'New itinerary costs more'],
  ['Bạn thanh toán phần chênh lệch qua PayPal Checkout trước khi đổi chuyến hoàn tất.', 'You pay the difference through PayPal Checkout before rescheduling is completed.'],
  ['CHÊNH LỆCH = 0', 'DIFFERENCE = 0'],
  ['Không cần thanh toán thêm', 'No additional payment required'],
  ['Hệ thống đổi chuyến trực tiếp sau khi bạn xác nhận.', 'The system reschedules directly after you confirm.'],
  ['CHÊNH LỆCH ÂM', 'NEGATIVE DIFFERENCE'],
  ['Hoàn phần còn lại', 'Refund the difference'],
  ['Khoản chênh lệch được ghi nhận và xử lý về nguồn thanh toán ban đầu.', 'The difference is recorded and processed back to the original payment source.'],
  ['Không đổi sang tuyến khác.', 'The route cannot be changed.'],
  ['Ví dụ SGN → HAN có thể đổi sang một SGN → HAN khác. SGN → DAD là một hành trình khác và không thuộc nghiệp vụ reschedule thông thường.', 'For example, SGN → HAN can be changed to another SGN → HAN flight. SGN → DAD is a different itinerary and is outside normal rescheduling.'],

  ['Chọn ghế theo cách bạn muốn', 'Choose the seat that suits you'],
  ['Seat map hiển thị phí thực tế theo từng ghế và từng chuyến. Giá dưới đây là các rule Economy mặc định của hệ thống; Admin có thể cấu hình hoặc override theo chuyến.', 'The seat map shows the actual fee for each seat and flight. The prices below are default Economy rules; Admin can configure or override them per flight.'],
  ['Từ ghế tiêu chuẩn đến extra legroom', 'From standard seats to extra legroom'],
  ['Mỗi ghế giữ pricing snapshot tại thời điểm đặt để booking không bị thay đổi phí ngoài ý muốn khi catalog giá ghế được Admin cập nhật sau đó.', 'Each seat stores a pricing snapshot at booking time so later Admin catalog changes do not unexpectedly change the booked fee.'],
  ['Tìm chuyến để chọn ghế', 'Find a flight and choose a seat'],
  ['Ghế tiêu chuẩn', 'Standard seat'],
  ['Ghế không kích hoạt pricing rule hoặc được hệ thống gán tự động có thể không phát sinh phụ phí.', 'A seat with no active pricing rule or an automatically assigned seat may have no surcharge.'],
  ['Ghế lối đi', 'Aisle seat'],
  ['Baseline Economy hiện tại cho vị trí aisle.', 'Current Economy baseline for an aisle position.'],
  ['Ghế cửa sổ', 'Window seat'],
  ['Baseline Economy hiện tại cho vị trí window.', 'Current Economy baseline for a window position.'],
  ['Khu vực phía trước', 'Front zone'],
  ['Ưu tiên vị trí phía trước khoang Economy.', 'Preferred seating near the front of Economy.'],
  ['Chỗ để chân rộng', 'Extra legroom'],
  ['Phụ phí mặc định cho ghế Economy extra legroom.', 'Default surcharge for an Economy extra-legroom seat.'],
  ['Hàng thoát hiểm', 'Exit row'],
  ['Baseline Economy cho exit row; điều kiện ghế vẫn phụ thuộc seat map.', 'Economy baseline for an exit row; seat eligibility still depends on the seat map.'],
  ['GIÁ CUỐI CÙNG', 'FINAL PRICE'],
  ['Luôn xem trực tiếp trên seat map', 'Always check the live seat map'],
  ['Rule có thể kết hợp theo vị trí, cabin, extra legroom, exit row hoặc cấu hình riêng của Admin. Vì vậy số hiển thị trên ghế trong bước chọn chỗ là nguồn giá cần dùng khi quyết định.', 'Rules may combine position, cabin, extra legroom, exit row or Admin-specific configuration. Use the fee shown on the seat map as the final price when choosing.'],
  ['Ghế không phụ phí', 'No-surcharge seat'],
  ['Ghế có phụ phí', 'Seat with surcharge'],
  ['Ghế không khả dụng / đã khóa', 'Unavailable / locked seat'],

  ['ĐỔI CHUYẾN', 'RESCHEDULE'],
  ['Đổi chuyến', 'Reschedule'],
  ['Tra cứu vé đã xác nhận, chọn chiều cần đổi và xem chính xác chênh lệch trước khi xác nhận.', 'Load a confirmed booking, choose what to change and review the exact fare difference before confirming.'],
  ['CONFIRMATION / PNR', 'CONFIRMATION / PNR'],
  ['Đang tra cứu…', 'Loading…'],
  ['Tải đặt chỗ', 'Load booking'],
  ['Đổi chiều đi', 'Change outbound'],
  ['Chỉ đổi chiều về', 'Change return only'],
  ['Đổi cả hai chiều', 'Change both directions'],
  ['Đặt chỗ khứ hồi direct hiện yêu cầu đổi chiều đi hoặc đổi cả hai chiều. Nếu một trong hai chiều là nối chuyến, hệ thống cho phép đổi riêng chiều về.', 'A direct round-trip booking currently requires changing the outbound leg or both directions. If either direction is connecting, the return can be changed separately.'],
  ['Vé khứ hồi bay thẳng hiện hỗ trợ đổi chiều đi hoặc đổi cả hai chiều. Nếu một trong hai chiều là hành trình nối chuyến, bạn có thể đổi riêng chiều về.', 'For a direct round-trip ticket, you can change the outbound or both directions. If either direction includes a connection, you can change only the return.'],
  ['Chuyến mới · chiều đi', 'New flight · outbound'],
  ['Chuyến mới · chiều về', 'New flight · return'],
  ['Nơi đi · giữ nguyên', 'Origin · unchanged'],
  ['Nơi đến · giữ nguyên', 'Destination · unchanged'],
  ['Đổi vé chỉ cho phép đổi ngày/chuyến bay; tuyến', 'Rescheduling only changes the date/flight; route'],
  ['được giữ nguyên theo vé gốc.', 'remains the same as the original ticket.'],
  ['Ngày mới', 'New date'],
  ['Tìm chuyến thay thế', 'Search replacement flights'],
  ['Tìm chuyến thẳng và hành trình nối chuyến trong cửa sổ đặt vé 330 ngày.', 'Search direct and connecting itineraries within the 330-day booking window.'],
  ['Chọn chuyến thay thế', 'Select replacement flight'],
  ['Không có chuyến phù hợp cho chiều đi', 'No suitable outbound flight'],
  ['Không có chuyến phù hợp cho chiều về', 'No suitable return flight'],
  ['Thử một ngày khác trong cửa sổ đặt vé.', 'Try another date within the booking window.'],
  ['Các chặng nối được đổi cùng một lần.', 'Connecting legs are rescheduled together.'],
  ['Đã chọn', 'Selected'],
  ['Chọn đủ cả hai chiều để hệ thống lấy báo giá tổng.', 'Select both directions to calculate the combined quote.'],
  ['BÁO GIÁ ĐỔI VÉ', 'RESCHEDULE QUOTE'],
  ['Đổi cả chiều đi và chiều về', 'Change outbound and return'],
  ['Đổi chiều về', 'Change return'],
  ['BOOKING HIỆN TẠI', 'CURRENT BOOKING'],
  ['Đặt chỗ hiện tại', 'Current booking'],
  ['HÀNH TRÌNH MỚI', 'NEW ITINERARY'],
  ['CHÊNH LỆCH', 'DIFFERENCE'],
  ['Chênh lệch', 'Difference'],
  ['Hành trình mới rẻ hơn. Hệ thống sẽ xử lý phần chênh lệch theo nghiệp vụ đổi chuyến hiện có.', 'The new itinerary is cheaper. The difference will be handled by the existing reschedule flow.'],
  ['Hành trình mới rẻ hơn.', 'The new itinerary is cheaper.'],
  ['Phần chênh lệch được hoàn về nguồn thanh toán gốc của đặt chỗ; không cần nhập tài khoản hay thẻ mới tại đây.', 'The difference is refunded to the booking’s original payment source; no new bank account or card is required here.'],
  ['Giao dịch tại quầy.', 'Counter transaction.'],
  ['Nhân viên xử lý phần chênh lệch theo luồng hỗ trợ hiện có.', 'Staff handle the fare difference through the assisted flow.'],
  ['Thanh toán phần chênh lệch qua PayPal', 'Pay the fare difference with PayPal'],
  ['Không có chênh lệch giá, không cần thanh toán thêm.', 'There is no fare difference, so no additional payment is required.'],
  ['Chọn lại', 'Choose again'],
  ['Xác nhận đổi chuyến', 'Confirm reschedule'],
  ['Chỉ đặt chỗ đang ở trạng thái CONFIRMED mới được đổi chuyến.', 'Only a booking with CONFIRMED status can be rescheduled.'],
  ['Chỉ đặt chỗ đã xác nhận mới được đổi chuyến.', 'Only a confirmed booking can be rescheduled.'],
  ['Vui lòng nhập mã xác nhận hoặc PNR.', 'Enter a confirmation number or PNR first.'],
  ['Không tra cứu được đặt chỗ.', 'Unable to look up the booking.'],
  ['Nhập đủ tuyến và ngày mới cho chiều đi.', 'Enter the outbound route and new date.'],
  ['Nhập đủ tuyến và ngày mới cho chiều về.', 'Enter the return route and new date.'],
  ['Ngày về mới phải bằng hoặc sau ngày đi mới.', 'The new return date must be on or after the new outbound date.'],
  ['Không tìm được chuyến thay thế.', 'Unable to find a replacement flight.'],
  ['Không lấy được báo giá đổi chuyến.', 'Unable to load the reschedule quote.'],
  ['Không đổi được chuyến.', 'Unable to reschedule.'],
  ['PayPal chưa được bật cho môi trường hiện tại.', 'PayPal is not enabled in this environment.'],

  ['Bảng điều khiển', 'Dashboard'],
  ['VẬN HÀNH', 'OPERATIONS'],
  ['Tổng quan đặt chỗ, doanh thu, hành vi khách hàng và mức sử dụng ghế.', 'Booking, revenue, customer behavior and seat-utilization overview.'],
  ['Làm mới', 'Refresh'],
  ['Gửi email nhắc Hold', 'Send hold reminder emails'],
  ['Gửi email chuyến sắp bay', 'Send upcoming-trip emails'],
  ['Quét vé hết hạn', 'Scan expired holds'],
  ['Gửi email', 'Send email'],
  ['Gửi email nhắc lịch', 'Send reminder email'],
  ['Gửi email nhắc thanh toán', 'Send payment reminder email'],
  ['Gửi email nhắc lịch bay', 'Send flight reminder email'],
  ['Email khách hàng', 'Customer email'],
  ['Loại email nhắc', 'Reminder type'],
  ['Nhắc thanh toán giữ chỗ', 'Hold payment reminder'],
  ['Nhắc lịch bay', 'Flight reminder'],
  ['Không áp dụng', 'Not applicable'],
  ['Đã gửi email nhắc thanh toán giữ chỗ.', 'Hold payment reminder email sent.'],
  ['Đã gửi email nhắc lịch bay.', 'Flight reminder email sent.'],
  ['Không gửi được email nhắc thanh toán giữ chỗ.', 'Unable to send the hold payment reminder email.'],
  ['Không gửi được email nhắc lịch bay.', 'Unable to send the flight reminder email.'],
  ['Khi lưu trạng thái DELAYED, hệ thống tự gửi email thông báo hoãn chuyến đến khách có booking liên quan, gồm giờ cũ, giờ mới và lý do.', 'When DELAYED is saved, the system automatically emails affected customers with the old time, new time and delay reason.'],
  ['Khi hủy chuyến, hệ thống xử lý booking liên quan và gửi email thông báo hủy/hoàn tiền theo trạng thái vé.', 'When a flight is cancelled, the system processes affected bookings and emails cancellation/refund details based on ticket status.'],
  ['Doanh thu ròng', 'Net revenue'],
  ['Dựa trên sổ giao dịch', 'Transaction-ledger based'],
  ['Giá trị đang hoạt động', 'Active value'],
  ['Đã xác nhận + đã đổi chuyến', 'Confirmed + rescheduled'],
  ['Hệ số lấp đầy', 'Load factor'],
  ['chuyến bay theo lịch', 'scheduled flights'],
  ['Trạng thái đặt chỗ', 'Booking status'],
  ['Tỷ lệ hủy', 'Cancellation'],
  ['Cơ cấu hành khách', 'Passenger mix'],
  ['Tỷ lệ quay lại', 'Repeat rate'],
  ['Tuyến phổ biến', 'Top routes'],
  ['Lượng hành khách', 'Passenger volume'],
  ['Tuyến', 'Route'],
  ['Khởi hành', 'Departure'],
  ['Nguồn', 'Source'],
  ['Tên, tên đăng nhập, email, điện thoại', 'Name, username, email, phone'],
  ['Tên, tên đăng nhập, email, vai trò', 'Name, username, email, role'],
  ['Số hiệu chuyến bay, tuyến bay, trạng thái', 'Flight number, route, status'],
  ['Tải đặt chỗ', 'Load booking'],
  ['Quầy đặt vé', 'Reservation Desk'],
  ['NHÂN VIÊN / QUẢN TRỊ VIÊN', 'CLERK / ADMIN'],
  ['Đặt vé thay khách hàng đã đăng ký và xử lý vé tại quầy.', 'Book tickets for registered customers and process tickets at the counter.'],
  ['Tạo đặt chỗ mới', 'Create booking'],
  ['Đổi / hủy đặt chỗ', 'Reschedule / cancel booking'],
  ['Đặt chỗ mới dùng', 'The new booking uses'],
  ['user_id của KHÁCH HÀNG được chọn', 'the selected CUSTOMER user_id'],
  ['PayPal chỉ dành cho thanh toán của khách hàng; tại quầy dùng giữ chỗ hoặc thẻ hồ sơ khách hàng.', 'PayPal is for customer checkout; counter staff use a hold or the customer profile card.'],
  ['Nghiệp vụ nhân viên', 'Staff operations'],
  ['Đặt chỗ mới dùng user_id của KHÁCH HÀNG được chọn. PayPal chỉ dành cho thanh toán của khách hàng; tại quầy dùng giữ chỗ hoặc thẻ hồ sơ khách hàng.', 'The new booking uses the selected CUSTOMER user_id. PayPal is for customer checkout; counter staff use a hold or the customer profile card.'],
  ['PNR / Mã xác nhận / Mã giữ chỗ', 'PNR / Confirmation / Blocking code'],
  ['Đặt chỗ', 'Bookings'],
  ['Vận hành ghế', 'Seat Operations'],
  ['VẬN HÀNH GHẾ', 'SEAT OPERATIONS'],
  ['Vận hành ghế theo chuyến bay', 'Seat Operations by flight'],
  ['Khóa/mở ghế vật lý và ghi đè phụ phí cho một chuyến cụ thể.', 'Block or unblock physical seats and override seat fees for a specific flight.'],
  ['Chọn chuyến bay', 'Select flight'],
  ['Nhân viên khóa', 'Staff blocked'],
  ['Máy bay', 'Aircraft'],
  ['Lý do khóa', 'Block reason'],
  ['Nghỉ tổ bay', 'Crew rest'],
  ['Giữ cho VIP', 'VIP hold'],
  ['Chỉ ghế còn trống mới có thể khóa.', 'Only available seats can be blocked.'],
  ['Trống', 'Available'],
  ['Đang giữ', 'Held'],
  ['Đã đặt', 'Occupied'],
  ['Đã khóa', 'Blocked'],
  ['Người dùng', 'Users'],
  ['Tài khoản và hồ sơ khách hàng/nhân viên.', 'Customer and staff accounts and profiles.'],
  ['Chuyến bay', 'Flights'],
  ['Chuyến bay, lịch vận hành và trạng thái khẩn cấp.', 'Flights, operating schedules and disruption status.'],
  ['Sân bay', 'Airports'],
  ['Danh mục sân bay, múi giờ và phạm vi phục vụ.', 'Airport catalog, time zones and service coverage.'],
  ['Phục vụ trực tiếp', 'Served directly'],
  ['Lưu thay đổi', 'Save changes'],
  ['Chính sách', 'Policies'],
  ['Thương mại', 'Commercial'],
  ['Giá vé động', 'Fare Pricing'],
  ['QUẢN TRỊ DOANH THU', 'REVENUE MANAGEMENT'],
  ['Hồ sơ giá vé', 'Fare Pricing Profiles'],
  ['Tạo chính sách giá một lần, lưu vào hệ thống và tái sử dụng cho nhiều chuyến bay hoặc commercial template.', 'Create a fare policy once, save it, and reuse it across multiple flights or commercial templates.'],
  ['Tạo cấu hình mới', 'Create profile'],
  ['Chưa có pricing profile. Hãy tạo cấu hình đầu tiên.', 'No pricing profile yet. Create the first profile.'],
  ['CHỈNH SỬA PROFILE', 'EDIT PROFILE'],
  ['PROFILE MỚI', 'NEW PROFILE'],
  ['Mã cấu hình', 'Profile code'],
  ['Tên cấu hình', 'Profile name'],
  ['Cho phép gán profile này cho chuyến bay', 'Allow this profile to be assigned to flights'],
  ['Giá theo thời điểm mua vé', 'Advance-purchase pricing'],
  ['Đáp ứng 1.2.4.3. Phần trăm âm là giảm giá, phần trăm dương là tăng giá.', 'Requirement 1.2.4.3. Negative percentages discount the fare; positive percentages increase it.'],
  ['Thêm mốc', 'Add band'],
  ['Điều chỉnh', 'Adjustment'],
  ['Nhãn VI', 'VI label'],
  ['Nhãn EN', 'EN label'],
  ['Giá theo hệ số lấp đầy', 'Load-factor pricing'],
  ['Đáp ứng 1.2.4.2. Ví dụ tải thấp giảm giá để lấp ghế; tải cao có thể tăng giá để tối ưu doanh thu.', 'Requirement 1.2.4.2. For example, discount low-load flights to fill seats and raise high-load fares to optimize revenue.'],
  ['Lưu cấu hình', 'Save profile'],
  ['Lưu & cập nhật chuyến đang dùng', 'Save and update assigned flights'],
  ['Áp dụng profile cho chuyến bay', 'Apply profile to flights'],
  ['Một profile có thể dùng lại cho nhiều chuyến. Template được gán profile sẽ truyền cấu hình đó cho các chuyến được sinh mới.', 'One profile can be reused across many flights. Assigned templates pass the profile to newly generated flights.'],
  ['Chuyến bay cụ thể', 'Specific flights'],
  ['Commercial template', 'Commercial template'],
  ['Giữ Cmd/Ctrl để chọn nhiều mục.', 'Hold Cmd/Ctrl to select multiple items.'],
  ['Áp dụng cấu hình đã chọn', 'Apply selected profile'],
  ['Chưa gán profile', 'No profile assigned'],
  ['Giá ghế', 'Seat Pricing'],
  ['DOANH THU GHẾ', 'SEAT REVENUE'],
  ['Quy tắc giá ghế', 'Seat Pricing Rules'],
  ['Phụ phí ghế theo hạng và thuộc tính vật lý. Ghế tự động luôn 0 ₫ theo máy chủ.', 'Seat fees are based on cabin and physical attributes. AUTO seats are always 0 ₫ according to the server.'],
  ['Thuộc tính giá', 'Dimension'],
  ['Độ ưu tiên', 'Priority'],
  ['Số tiền', 'Amount'],
  ['PHIÊN BẢN BẤT BIẾN MỚI', 'NEW IMMUTABLE VERSION'],
  ['Đã cấu hình', 'Configured'],
  ['Máy chủ sẽ tắt phiên bản hiện tại và tạo phiên bản mới có lịch sử kiểm toán.', 'The server will deactivate the current version and create a new version with an audit trail.'],
  ['Trang khách hàng', 'Customer site'],
  ['Đăng xuất', 'Logout'],
  ['Làm mới dữ liệu', 'Refresh data'],
  ['Tìm kiếm', 'Search'],
  ['Thêm mới', 'Create'],
  ['Cập nhật', 'Update'],
  ['Đóng', 'Close'],
  ['Sửa', 'Edit'],
  ['Xóa', 'Delete'],
  ['Xóa chính sách?', 'Delete policy?'],
  ['Bạn có chắc muốn xóa chính sách hủy vé này?', 'Are you sure you want to delete this cancellation policy?'],
  ['Đang xóa...', 'Deleting...'],
  ['Đã xóa chính sách.', 'Policy deleted.'],
  ['Chính sách hủy vé đã được xóa khỏi hệ thống.', 'The cancellation policy has been removed from the system.'],
  ['Không xóa được chính sách.', 'Unable to delete policy.'],
  ['Vui lòng thử lại.', 'Please try again.'],
  ['Lưu', 'Save'],
  ['Tắt', 'Deactivate'],
  ['Khả dụng', 'Available'],
  ['Tổng ghế', 'Total seats'],
  ['Đã giữ / đặt', 'Held / booked'],
  ['Chọn một ghế', 'Select a seat'],
  ['Thông tin vận hành và các thao tác sẽ xuất hiện tại đây.', 'Operational details and actions will appear here.'],
  ['Khóa ghế này', 'Block this seat'],
  ['Mở khóa ghế', 'Unblock seat'],
  ['Xóa giá riêng', 'Remove override'],
  ['Lưu giá riêng', 'Save override'],
  ['Phụ phí VND', 'Fee (VND)'],
  ['Lý do / ghi chú', 'Reason / note'],
  ['Quét vé hết hạn', 'Scan expired holds'],
  ['Gửi nhắc giữ chỗ', 'Send hold reminders'],
  ['Cập nhật trạng thái', 'Update status'],
  ['Tìm mạng đường bay', 'Search network'],
  ['Tìm hành trình nguồn thực', 'Find source itinerary'],
  ['Vận hành chuyến bay thương mại', 'Commercial Flight Operations'],
  ['Tìm lịch bay thật từ mạng AirLabs, chọn hành trình, cấu hình máy bay APTECH và phát hành chuyến có thể đặt trong tối đa 330 ngày.', 'Find real schedules from the AirLabs network, choose an itinerary, configure APTECH aircraft and publish bookable flights up to 330 days ahead.'],
  ['Bay thẳng / nối chuyến', 'Direct / connecting'],
  ['Máy bay · hạng ghế · tồn chỗ', 'Aircraft · cabin · inventory'],
  ['Máy chủ sẽ dùng sơ đồ đường bay đã đồng bộ từ AirLabs và kiểm tra lịch hoạt động đúng ngày.', 'The server uses the synchronized AirLabs route graph and verifies operating schedules for the selected date.'],
  ['Mỗi chặng nguồn thật phải được gắn máy bay, hạng ghế, tồn chỗ và giá trước khi phát hành.', 'Each source leg must have an aircraft, cabin, inventory and fare before publishing.'],
  ['Phát hành lịch bay có thể đặt', 'Publish bookable schedule'],
  ['Sinh các chuyến bay theo ngày từ mẫu đã thương mại hóa. Khách hàng chỉ thấy các chuyến AIRLABS_COMMERCIALIZED có thể đặt.', 'Generate dated flights from commercialized templates. Customers only see bookable AIRLABS_COMMERCIALIZED flights.'],
  ['Khoảng ngày', 'Horizon'],
  ['Ngày bắt đầu', 'Start date'],
  ['Tạo lịch cho toàn hành trình', 'Materialize full itinerary'],
  ['Cần cấu hình đủ tất cả chặng trước khi phát hành.', 'Configure every leg before publishing.'],
  ['DANH MỤC THƯƠNG MẠI', 'COMMERCIAL CATALOG'],
  ['Các mẫu đang quản lý', 'Managed templates'],
  ['Hạng ghế / tồn chỗ', 'Cabin / inventory'],
  ['Thao tác', 'Actions'],
  ['Chưa có mẫu thương mại phù hợp.', 'No matching commercial template.'],
  ['Tạo mẫu thương mại', 'Create commercial template'],
  ['Cấu hình máy bay', 'Aircraft layout'],
  ['SỬA MẪU THƯƠNG MẠI', 'EDIT COMMERCIAL TEMPLATE'],
  ['Mẫu đang hoạt động', 'Template active'],
  ['Chọn hành trình', 'Select itinerary'],
  ['Tạo chuyến APTECH', 'Create APTECH flight'],
  ['Phát hành lịch', 'Publish schedule'],
  ['Nguồn AirLabs', 'AirLabs source'],
  ['Chưa cấu hình', 'Not configured'],
  ['Cấu hình thành chuyến APTECH', 'Configure as APTECH flight'],
  ['Mã chuyến APTECH', 'APTECH flight number'],
  ['Số điểm nối tối đa', 'Maximum stops'],
  ['Tối đa 1 điểm nối', 'Up to 1 stop'],
  ['Tối đa 2 điểm nối', 'Up to 2 stops'],
  ['Ngày khởi hành', 'Departure date'],
  ['Ghế bán', 'Sellable seats'],
  ['Giá cơ bản', 'Base fare'],
  ['Bắt buộc', 'Required'],
  ['Để trống = fallback', 'Leave blank = fallback'],
  ['Lưu phiên bản mới', 'Save new version'],
  ['Đang phát hành…', 'Publishing…'],
  ['Phát hành toàn hành trình', 'Publish full itinerary'],
  ['Chỉ các hạng ghế thực sự có trong cấu hình máy bay mới được bật.', 'Only cabins present in the aircraft layout can be enabled.'],
  ['Sức chứa vật lý', 'Physical capacity'],
  ['Mô tả', 'Description'],
  ['Hoàn tiền %', 'Refund %'],
  ['Từ ngày', 'From day'],
  ['Đến ngày', 'To day'],
  ['Bỏ trống = ∞', 'Blank = ∞'],
  ['Tạo chính sách', 'Create policy'],
  ['Lưu sửa', 'Save changes'],
  ['Tạo quy tắc', 'Create rule'],
  ['Mã quy tắc', 'Rule ID'],
  ['QUY TẮC HOÀN TIỀN', 'REFUND RULES'],
  ['Chính sách hủy vé', 'Cancellation Policies'],
  ['Quy tắc hoàn tiền theo số ngày trước giờ bay.', 'Refund rules based on the number of days before departure.'],
  ['Mô tả tiếng Việt', 'Vietnamese description'],
  ['Mô tả tiếng Anh', 'English description'],
  ['Các đặt chỗ đang lưu trong hệ thống và các tác vụ theo lịch.', 'Stored bookings and scheduled system tasks.'],
  ['Hủy', 'Cancel'],
  ['Tải sơ đồ', 'Load map'],
  ['Chọn chuyến bay để tải sơ đồ ghế.', 'Select a flight to load the seat map.'],
  ['Chọn khách hàng ở cột bên trái trước.', 'Select a customer in the left column first.'],
  ['Bắt đầu đặt vé cho khách', 'Start booking for customer'],
  ['Tra cứu ticket', 'Ticket lookup'],

  ['Vui lòng nhập nơi đi, nơi đến và ngày bay.', 'Enter origin, destination and departure date.'],
  ['Nơi đi và nơi đến phải khác nhau.', 'Origin and destination must be different.'],
  ['Khoảng ngày đi không hợp lệ.', 'Departure date range is invalid.'],
  ['Ngày về phải bằng hoặc sau ngày đi cuối cùng.', 'Return date must be on or after the final outbound date.'],
  ['Máy chủ không phản hồi.', 'Server did not respond.'],
  ['Chuyến bay này chưa có thông tin hạng vé phù hợp.', 'This flight has no matching fare inventory.'],
  ['Hành trình nối chuyến chưa có thông tin hạng vé phù hợp.', 'The connecting itinerary has no matching fare inventory.'],
  ['Không thể thực hiện yêu cầu.', 'Unable to complete the request.'],
  ['Đã tạo', 'Created'],
  ['Đã cập nhật', 'Updated'],
  ['Đã xóa', 'Deleted'],
];

const TARGET_VI_ALIASES: Readonly<Record<string, string>> = {
  'Staff Portal': 'Cổng nhân viên',
  'Customer site': 'Trang khách hàng',
  'Logout': 'Đăng xuất',
  'Dashboard': 'Bảng điều khiển',
  'Reservation Desk': 'Quầy đặt vé',
  'Bookings': 'Đặt chỗ',
  'Seat Operations': 'Vận hành ghế',
  'Users': 'Người dùng',
  'Flights': 'Chuyến bay',
  'Airports': 'Sân bay',
  'Airport': 'Tên sân bay',
  'City': 'Thành phố',
  'Country': 'Quốc gia',
  'Country code': 'Mã quốc gia',
  'Timezone': 'Múi giờ',
  'Latitude': 'Vĩ độ',
  'Longitude': 'Kinh độ',
  'EDIT AIRPORTS': 'SỬA SÂN BAY',
  'CREATE AIRPORTS': 'THÊM SÂN BAY',
  'Policies': 'Chính sách',
  'Commercial': 'Thương mại',
  'Fare Pricing': 'Giá vé động',
  'Seat Pricing': 'Giá ghế',
  'MY TRIPS': 'CHUYẾN ĐI CỦA TÔI',
  'BOOKING DETAIL': 'CHI TIẾT ĐẶT CHỖ',
  'PROFILE': 'HỒ SƠ',
  'LOYALTY': 'KHÁCH HÀNG THÂN THIẾT',
  'RESCHEDULE': 'ĐỔI CHUYẾN',
  'TICKET STATUS': 'TRẠNG THÁI VÉ',
  'PUBLIC FLIGHT LOOKUP': 'TRA CỨU CHUYẾN BAY CÔNG KHAI',
  'BOOKING': 'ĐẶT CHỖ',
  'STAFF BOOKING': 'ĐẶT VÉ NHÂN VIÊN',
  'STAFF': 'NHÂN VIÊN',
  'Refresh dữ liệu': 'Làm mới dữ liệu',
  'Direct / connecting': 'Bay thẳng / nối chuyến',
  'AirLabs route graph': 'Sơ đồ đường bay AirLabs',
  'Aircraft · cabin · inventory': 'Máy bay · hạng ghế · tồn chỗ',
  'Materialize flights': 'Tạo lịch bay thực tế',
  'Physical capacity': 'Sức chứa vật lý',
  'Base fare': 'Giá cơ bản',
  'Flight number': 'Số hiệu chuyến bay',
  'Origin': 'Nơi đi',
  'Destination': 'Nơi đến',
  'Role': 'Vai trò',
};

const TARGET_EN_ALIASES: Readonly<Record<string, string>> = {
  'BƯỚC 2 / 4': 'STEP 2 / 4',
  'BƯỚC 3 / 4': 'STEP 3 / 4',
  'BƯỚC 4 / 4': 'STEP 4 / 4',
  'CHƯA CÓ TRẠNG THÁI': 'NO STATUS',
  'ĐÚNG LỊCH': 'SCHEDULED',
  'TRỄ CHUYẾN': 'DELAYED',
  'ĐÃ KHỞI HÀNH': 'DEPARTED',
  'ĐÃ ĐẾN': 'ARRIVED',
  'ĐÃ HỦY': 'CANCELLED',
  'HOÀN TẤT': 'COMPLETE',
  'KHAI THÁC': 'SERVED',
  'GẦN NHẤT': 'NEAREST',
  'THÀNH PHỐ': 'CITY',
  'QUỐC GIA': 'COUNTRY',
};

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly storageKey = 'aptech-airlines-language';
  readonly language = signal<UiLanguage>(this.readInitialLanguage());
  readonly isVietnamese = computed(() => this.language() === 'vi');
  readonly isEnglish = computed(() => this.language() === 'en');

  private readonly http = inject(HttpClient);

  constructor() {
    this.applyDocumentLanguage(this.language());
  }

  setLanguage(language: UiLanguage) {
    const changed = this.language() !== language;
    this.language.set(language);
    this.applyDocumentLanguage(language);
    try { localStorage.setItem(this.storageKey, language); } catch {}
    if (changed) this.syncAccountLanguage(language);
  }

  /** Logged-in users: remember the language on the account so emails are sent in it. */
  private syncAccountLanguage(language: UiLanguage) {
    let token: string | null = null;
    try { token = localStorage.getItem('auth_token'); } catch {}
    if (!token) return;
    this.http.patch('/api/users/me/language', { language }).subscribe({ error: () => {} });
  }

  toggle() {
    this.setLanguage(this.language() === 'vi' ? 'en' : 'vi');
  }

  /** Choose explicit UI copy without duplicating VI/EN checks in components. */
  pick(vi: string, en: string, language: UiLanguage = this.language()): string {
    return language === 'en' ? en : vi;
  }

  /** One source of booking labels for customer and staff screens. */
  bookingStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      BLOCKED: 'Đang giữ chỗ',
      CONFIRMED: 'Đã xác nhận',
      RESCHEDULED: 'Đã đổi chuyến',
      CANCELLED: 'Đã hủy',
    };
    return this.translateNotice(labels[status] ?? status);
  }

  /** Status labels shared by public tracking and staff flight/ticket views. */
  flightStatusLabel(status: string): string {
    const labels: Record<string, [string, string]> = {
      SCHEDULED: ['Đúng lịch', 'Scheduled'],
      DELAYED: ['Hoãn chuyến', 'Delayed'],
      CANCELLED: ['Đã hủy', 'Cancelled'],
      COMPLETED: ['Đã hoàn thành', 'Completed'],
    };
    return labels[status] ? this.pick(...labels[status]) : status;
  }

  couponStatusLabel(status: string): string {
    const labels: Record<string, [string, string]> = {
      ACTIVE: ['Còn hiệu lực', 'Active'],
      CANCELLED: ['Đã hủy', 'Cancelled'],
      RESCHEDULED: ['Đã đổi chuyến', 'Rescheduled'],
    };
    return labels[status] ? this.pick(...labels[status]) : status;
  }

  bookingTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      ONE_WAY: 'Một chiều',
      ROUND_TRIP: 'Khứ hồi',
      CONNECTING: 'Nối chuyến',
    };
    return this.translateNotice(labels[type] ?? type);
  }

  cabinLabel(cabin: string): string {
    if (cabin === 'ALL') return this.pick('Tất cả hạng', 'All cabins');
    const labels: Record<string, string> = {
      ECONOMY: 'Phổ thông',
      CLUB: 'Club',
      BUSINESS: 'Thương gia',
      FIRST: 'Hạng nhất',
    };
    return this.translateNotice(labels[cabin] ?? cabin);
  }

  /** Seat-map states are separate from booking statuses (e.g. BLOCKED seat vs held booking). */
  seatStatusLabel(status: string): string {
    const labels: Record<string, [string, string]> = {
      AVAILABLE: ['Trống', 'Available'],
      HELD: ['Đang giữ', 'Held'],
      OCCUPIED: ['Đã đặt', 'Occupied'],
      BLOCKED: ['Đã khóa', 'Blocked'],
    };
    const label = labels[status];
    return label ? this.pick(...label) : status;
  }

  seatDimensionLabel(dimension: string): string {
    const labels: Record<string, [string, string]> = {
      CABIN_BASE: ['Phí cơ bản theo hạng', 'Cabin base fee'],
      WINDOW: ['Ghế cửa sổ', 'Window seat'],
      AISLE: ['Ghế lối đi', 'Aisle seat'],
      MIDDLE: ['Ghế giữa', 'Middle seat'],
      FRONT_ZONE: ['Khu vực phía trước', 'Front zone'],
      EXIT_ROW: ['Hàng thoát hiểm', 'Exit row'],
      EXTRA_LEGROOM: ['Chỗ để chân rộng', 'Extra legroom'],
      BULKHEAD: ['Hàng vách ngăn', 'Bulkhead row'],
    };
    const label = labels[dimension];
    return label ? this.pick(...label) : dimension;
  }

  passengerTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      ADULT: 'Người lớn',
      CHILD: 'Trẻ em',
      SENIOR: 'Cao tuổi',
    };
    return this.translateNotice(labels[type] ?? type);
  }

  itineraryLegLabel(leg: string): string {
    if (leg === 'OUTBOUND' || leg === 'INBOUND') {
      return this.translateNotice(leg === 'OUTBOUND' ? 'Chiều đi' : 'Chiều về');
    }
    const match = /^(CONNECTING|INBOUND)_(\d+)$/.exec(leg || '');
    if (match) {
      const outbound = match[1] === 'CONNECTING';
      return this.pick(
        `${outbound ? 'Đi' : 'Về'} · chặng ${match[2]}`,
        `${outbound ? 'Outbound' : 'Return'} · leg ${match[2]}`,
      );
    }
    return leg || this.pick('Chặng bay', 'Flight leg');
  }

  /**
   * Translate notifications conservatively: only whole dictionary entries or
   * supported parameterized errors. Never rewrite fragments of customer data,
   * identifiers, flight codes or free-form server messages.
   */
  translateNotice(source: string, language: UiLanguage = this.language()): string {
    if (!source) return source;
    const core = source.trim();
    if (!core) return source;
    const sameLanguageIndex = language === 'vi' ? 0 : 1;
    if (PAIRS.some(pair => pair[sameLanguageIndex] === core)) return formatDayFirstDatesInText(source);
    const aliases = language === 'vi' ? TARGET_VI_ALIASES : TARGET_EN_ALIASES;
    const match = PAIRS.find(pair => pair[language === 'vi' ? 1 : 0] === core);
    const translated = aliases[core] ?? match?.[sameLanguageIndex];
    if (translated) return formatDayFirstDatesInText(source.replace(core, translated));

    const knownDynamic = language === 'vi'
      ? /^(?:No booking found with code .+|No flights found for flight number .+ on .+|\d+ (?:seats? left|passengers?|customers?|records?|confirmed|days? before departure|itinerar(?:y|ies)|options?|legs?))$/i
      : /^(?:Không tìm thấy đặt chỗ với mã .+|Không tìm thấy chuyến bay .+ vào ngày .+|Còn \d+ ghế|\d+ (?:hành khách|khách hàng|bản ghi|đã xác nhận|ngày trước bay|hành trình|lựa chọn|chặng))$/i;
    if (!knownDynamic.test(core)) return formatDayFirstDatesInText(source);
    const translatedDynamic = language === 'vi'
      ? this.dynamicToVietnamese(core)
      : this.dynamicToEnglish(core)
          .replace(/^Không tìm thấy đặt chỗ với mã (.+)$/i, 'No booking found with code $1')
          .replace(/^Không tìm thấy chuyến bay (.+) vào ngày (.+)$/i, 'No flights found for flight number $1 on $2');
    return formatDayFirstDatesInText(source.replace(core, translatedDynamic));
  }

  translate(source: string, language: UiLanguage = this.language()) {
    if (!source) return source;
    const leading = source.match(/^\s*/)?.[0] ?? '';
    const trailing = source.match(/\s*$/)?.[0] ?? '';
    const core = source.slice(leading.length, source.length - trailing.length);
    if (!core) return source;
    if (AMBIGUOUS_EXACT_VALUES.has(core)) return source;

    const aliases = language === 'vi' ? TARGET_VI_ALIASES : TARGET_EN_ALIASES;
    const sameLanguageIndex = language === 'vi' ? 0 : 1;
    const match = PAIRS.find(pair => pair[language === 'vi' ? 1 : 0] === core);
    let value = aliases[core] ?? match?.[sameLanguageIndex] ?? core;

    // The directive runs for every text node, including names, email addresses and
    // server-provided values. Only transform a dynamic value when the entire text
    // matches one of our supported UI patterns; never replace dictionary fragments
    // inside customer/domain data (for example, a customer named "Nam").
    if (value === core && this.isKnownDynamicUiText(core, language)) {
      value = language === 'en' ? this.dynamicToEnglish(core) : this.dynamicToVietnamese(core);
    }
    return `${leading}${value}${trailing}`;
  }

  private isKnownDynamicUiText(value: string, language: UiLanguage) {
    const viPatterns = [
      /^Còn [\d.]+ miles để lên [A-Z]+$/,
      /^Từ \d+ ngày$/i,
      /^\d+\s*–\s*(?:\d+|∞) ngày(?: trước bay)?$/i,
      /^Còn \d+ ghế$/i,
      /^\d+ (?:hành khách|khách hàng|bản ghi|đã xác nhận|ngày trước bay|hành trình|lựa chọn|chặng)$/i,
      /^Đặt trước \d+ ngày$/i,
      /^Hoàn \d+%$/i,
      /^(?:Đi|Về)\s*·\s*chặng \d+$/i,
      /^Giữ đến .+$/i,
      /^No flights found for flight number .+ on .+$/i,
    ];
    const enPatterns = [
      /^Airport with IATA \S+ already exists$/i,
      /^[\d.]+ miles to [A-Z]+$/,
      /^\d+\+ days? before departure$/i,
      /^\d+\s*–\s*(?:\d+|∞) days? before departure$/i,
      /^No flights found for flight number .+ on .+$/i,
      /^No booking found with code .+$/i,
      /^\d+ (?:seats? left|passengers?|customers?|records?|confirmed|days? before departure|itinerar(?:y|ies)|options?|legs?)$/i,
      /^Lead time \d+ days?$/i,
      /^Refund \d+%$/i,
      /^(?:Outbound|Return)\s*·\s*leg \d+$/i,
    ];
    return (language === 'en' ? viPatterns : enPatterns).some(pattern => pattern.test(value));
  }

  private dynamicToEnglish(value: string) {
    return value
      .replace(/Còn\s+([\d.]+)\s+miles\s+để\s+lên\s+([A-Z]+)/g, '$1 miles to $2')
      .replace(/Từ\s+(\d+)\s+ngày/gi, '$1+ days before departure')
      .replace(/(\d+)\s*–\s*(\d+)\s+ngày/gi, '$1 – $2 days before departure')
      .replace(/(\d+)\s*–\s*(\d+|∞)\s+ngày trước bay/gi, '$1 – $2 days before departure')
      .replace(/Còn\s+(\d+)\s+ghế/gi, '$1 seats left')
      .replace(/(\d+)\s+hành khách/gi, (_, n) => `${n} ${Number(n) === 1 ? 'passenger' : 'passengers'}`)
      .replace(/(\d+)\s+khách hàng/gi, (_, n) => `${n} ${Number(n) === 1 ? 'customer' : 'customers'}`)
      .replace(/(\d+)\s+bản ghi/gi, (_, n) => `${n} ${Number(n) === 1 ? 'record' : 'records'}`)
      .replace(/(\d+)\s+đã xác nhận/gi, '$1 confirmed')
      .replace(/Đặt trước\s+(\d+)\s+ngày/gi, 'Lead time $1 days')
      .replace(/(\d+)\s+ngày trước bay/gi, '$1 days before departure')
      .replace(/Hoàn\s+(\d+)%/gi, 'Refund $1%')
      .replace(/(\d+)\s+hành trình/gi, (_, n) => `${n} ${Number(n) === 1 ? 'itinerary' : 'itineraries'}`)
      .replace(/(\d+)\s+lựa chọn/gi, (_, n) => `${n} ${Number(n) === 1 ? 'option' : 'options'}`)
      .replace(/(\d+)\s+chặng/gi, (_, n) => `${n} ${Number(n) === 1 ? 'leg' : 'legs'}`)
      .replace(/Đi\s*·\s*chặng\s+(\d+)/gi, 'Outbound · leg $1')
      .replace(/Về\s*·\s*chặng\s+(\d+)/gi, 'Return · leg $1')
      .replace(/Giữ đến\s+/gi, 'Held until ')
      .replace(/No flights found for flight number\s+(.+?)\s+on\s+(.+)/i, 'No flights found for flight number $1 on $2');
  }

  private dynamicToVietnamese(value: string) {
    return value
      .replace(/Airport with IATA\s+([^\s]+)\s+already exists/gi, 'Sân bay có mã IATA $1 đã tồn tại.')
      .replace(/([\d.]+)\s+miles\s+to\s+([A-Z]+)/g, 'Còn $1 miles để lên $2')
      .replace(/(\d+)\+\s+days? before departure/gi, 'Từ $1 ngày')
      .replace(/(\d+)\s*–\s*(\d+|∞)\s+days? before departure/gi, '$1 – $2 ngày trước bay')
      .replace(/No flights found for flight number\s+(.+?)\s+on\s+(.+)/i, 'Không tìm thấy chuyến bay $1 vào ngày $2')
      .replace(/No booking found with code\s+(.+)/i, 'Không tìm thấy đặt chỗ với mã $1')
      .replace(/(\d+)\s+seats? left/gi, 'Còn $1 ghế')
      .replace(/(\d+)\s+passengers?/gi, '$1 hành khách')
      .replace(/(\d+)\s+customers?/gi, '$1 khách hàng')
      .replace(/(\d+)\s+records?/gi, '$1 bản ghi')
      .replace(/(\d+)\s+confirmed/gi, '$1 đã xác nhận')
      .replace(/Lead time\s+(\d+)\s+days?/gi, 'Đặt trước $1 ngày')
      .replace(/(\d+)\s+days? before departure/gi, '$1 ngày trước bay')
      .replace(/Refund\s+(\d+)%/gi, 'Hoàn $1%')
      .replace(/(\d+)\s+itinerar(?:y|ies)/gi, '$1 hành trình')
      .replace(/(\d+)\s+options?/gi, '$1 lựa chọn')
      .replace(/(\d+)\s+legs?/gi, '$1 chặng')
      .replace(/Outbound\s*·\s*leg\s+(\d+)/gi, 'Đi · chặng $1')
      .replace(/Return\s*·\s*leg\s+(\d+)/gi, 'Về · chặng $1');
  }

  private readInitialLanguage(): UiLanguage {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved === 'vi' || saved === 'en') return saved;
    } catch {}
    return 'vi';
  }

  private applyDocumentLanguage(language: UiLanguage) {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }
}
