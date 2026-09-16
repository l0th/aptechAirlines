# TÀI LIỆU ĐẶC TẢ THUẬT TOÁN HỆ THỐNG (ALGORITHMS SPECIFICATION)
**Hệ thống Quản lý và Đặt vé Máy bay (Airline Reservation System - ARS)**
**Mã tài liệu:** `docs/05-Algorithms.md`
**Dự án:** Aptech Airlines eProject
**Thành phần thực thi:** Backend NestJS Services & Schedulers

---

## 1. TỔNG QUAN CÁC THUẬT TOÁN CỐT LÕI

Hệ thống Aptech Airlines triển khai 10 thuật toán nghiệp vụ then chốt nhằm đáp ứng trọn vẹn yêu cầu chức năng trong bản đặc tả dự án (`ProjectSpecification.txt` & `AirlinesReservationSystem.txt`), đảm bảo tính toàn vẹn giao dịch, hiệu năng tra cứu và trải nghiệm người dùng tối ưu:

| STT | Tên thuật toán | Vị trí cài đặt mã nguồn | Mục tiêu nghiệp vụ |
| :---: | :--- | :--- | :--- |
| **1** | Phân giải Thành phố, Xử lý Nhập nhằng & Gợi ý Sân bay Lân cận | `AirportsService.resolveCity` | Yêu cầu 3.3.1 - 3.3.2 |
| **2** | Tìm kiếm Chuyến bay & Tính giá vé theo Độ tuổi | `FlightsService.searchFlights` & `findDirectFlights` | Yêu cầu 3.3.4 - 3.3.7 |
| **3** | Lựa chọn Tuyến bay Nối chuyến (Connecting Route Selection) | `FlightsService.findConnectingRoutes` | Yêu cầu 3.3.3 |
| **4** | Giữ chỗ Ghế ngồi Nguyên tử & Cơ chế Rollback Chặng | `FlightsService.reserveSeats` & `BookingsService` | Yêu cầu 3.4.3 & Tính toàn vẹn ACID |
| **5** | Quy tắc Giữ chỗ >14 ngày, Cron nhắc nhở 3 tuần & Tự động Hủy vé | `BookingsService` & `BookingsScheduler` | Yêu cầu 3.4.2, 3.4.2.1, 3.5.1 |
| **6** | Tra cứu Tỷ lệ Hoàn tiền theo Bảng Chính sách Hủy vé | `PoliciesService.calculateRefundPercentage` | Yêu cầu 3.7.2 |
| **7** | Tích lũy và Khấu trừ Dặm bay SkyMiles | `UsersService.addSkyMiles` / `deductSkyMiles` | Yêu cầu 3.2, 3.4.3.3, 3.7.3 |
| **8** | Đổi vé Đã xác nhận, Tính chênh lệch giá & Tái cấu trúc Cuống vé | `BookingsService.rescheduleTicket` | Yêu cầu 3.6 |
| **9** | Kiểm tra Chiếm dụng Sơ đồ Ghế & Phân loại Hàng ghế Airbus A321 | `FlightsService.getSeatMap` | Sơ đồ ghế Hàng không chuẩn |
| **10** | Tích hợp AirLabs: Đồng bộ Lịch bay, Làm giàu Tàu bay & Đội bay | `FlightsService.syncFromAirLabs` / `enrichAircraft` | Dữ liệu Hàng không thực tế |

---

## 2. CHI TIẾT 10 THUẬT TOÁN HỆ THỐNG

---

### THUẬT TOÁN 1: Phân giải Thành phố, Xử lý Nhập nhằng & Gợi ý Sân bay Lân cận (City Resolution & Ambiguity Handling)

- **Mục tiêu:** Khi người dùng nhập tên thành phố hoặc mã sân bay dưới dạng chuỗi tự do, hệ thống kiểm tra sự tồn tại trong CSDL, liệt kê tất cả các sân bay trùng khớp nếu có sự nhập nhằng (ambiguity). Trường hợp thành phố không có đường bay trực tiếp (`is_serviced_directly = false`), hệ thống tự động tìm và gợi ý sân bay gần nhất kèm khoảng cách km (Yêu cầu 3.3.1 - 3.3.2).
- **Tập tin cài đặt:** [airports.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/airports/airports.service.ts) (`resolveCity`)

#### Mã giả (Pseudocode):
```text
Algorithm ResolveCity(queryText):
    Input: queryText (Chuỗi tìm kiếm từ người dùng, VD: "Hà Nội", "HAN", "Hải Dương")
    Output: Object { exactMatches: List<Airport>, nearestSuggestion?: { airport: Airport, distance_km: number } }

    1. directMatches = DB.airports.find({
           $or: [
               { city_name: { $regex: queryText, $options: 'i' } },
               { iata_code: { $regex: queryText, $options: 'i' } }
           ]
       })

    2. IF length(directMatches) > 0 THEN:
           // Có ít nhất một sân bay được phục vụ trực tiếp
           RETURN { exactMatches: directMatches }
       END IF

    3. // Không tìm thấy sân bay trực tiếp, tìm kiếm các địa phương không có đường bay trực tiếp
       unserviced = DB.airports.findOne({
           city_name: { $regex: queryText, $options: 'i' },
           is_serviced_directly: false
       })

    4. IF unserviced != NULL AND unserviced.nearest_airport_code != "" THEN:
           nearest = DB.airports.findOne({ iata_code: unserviced.nearest_airport_code })
           IF nearest != NULL THEN:
               RETURN {
                   exactMatches: [],
                   nearestSuggestion: {
                       airport: nearest,
                       distance_km: unserviced.distance_to_nearest_km
                   }
               }
           END IF
       END IF

    5. RETURN { exactMatches: [] }
End Algorithm
```

- **Giải thích hoạt động:** 
  - Bước 1 tìm kiếm linh hoạt không phân biệt hoa thường theo cả tên thành phố và mã IATA. Nếu kết quả trả về $\ge 2$ sân bay (ví dụ tra cứu thành phố có nhiều sân bay), hệ thống trả về danh sách để giao diện hiển thị cho người dùng tự lựa chọn.
  - Bước 3 xử lý tình huống thành phố ngoại vệ không có sân bay thương mại (ví dụ: tỉnh lân cận). CSDL lưu bản ghi với cờ `is_serviced_directly = false` kèm mã `nearest_airport_code` và khoảng cách `distance_to_nearest_km`. Hệ thống truy vết sân bay gần nhất để gợi ý hành khách di chuyển.
- **Độ phức tạp tính toán:**
  - **Thời gian (Time Complexity):** $O(N)$ trong trường hợp quét Regex không chỉ mục toàn văn, hoặc $O(\log N)$ nếu có chỉ mục B-tree trên trường `iata_code`. Với quy mô danh mục cảng hàng không Việt Nam và khu vực ($N \le 1000$), độ trễ dưới $5\text{ms}$.
  - **Không gian (Space Complexity):** $O(K)$ với $K$ là số lượng sân bay trùng khớp thỏa mãn điều kiện.

---

### THUẬT TOÁN 2: Tìm kiếm Chuyến bay & Tính giá vé theo Độ tuổi (Flight Search & Multi-tier Pricing)

- **Mục tiêu:** Tra cứu danh sách chuyến bay trực tiếp giữa hai thành phố, lọc theo ngày bay (hoặc khoảng ngày), hạng khoang, quy định hút thuốc, và số lượng khách. Đồng thời, tự động áp dụng chính sách giảm giá vé theo độ tuổi hành khách: Người lớn 100%, Trẻ em 75%, Người cao tuổi 85% (Yêu cầu 3.3.4 - 3.3.7).
- **Tập tin cài đặt:** [flights.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/flights/flights.service.ts) (`searchFlights`, `findDirectFlights`)

#### Mã giả (Pseudocode):
```text
Algorithm SearchAndPriceFlights(originIata, destIata, depDate, depDateEnd, cabinClass, isSmoking, adults, children, seniors):
    Input: Mã sân bay đi/đến, ngày bay (hoặc khoảng ngày), hạng vé, hút thuốc, số lượng từng nhóm khách
    Output: List<FormattedFlightOption>

    1. totalPassengers = adults + children + seniors
    2. queryFilter = {
           origin_iata: originIata,
           dest_iata: destIata,
           status: { $ne: "CANCELLED" }
       }
    3. IF depDateEnd != NULL THEN:
           queryFilter.departure_date = { $gte: depDate, $lte: depDateEnd }
       ELSE:
           queryFilter.departure_date = depDate
       END IF

    4. candidateFlights = DB.flights.find(queryFilter).sort({ scheduled_departure: 1 })
    5. formattedResults = []

    6. FOR EACH flight IN candidateFlights DO:
           FOR EACH inv IN flight.inventories DO:
               // Kiểm tra điều kiện lọc hạng khoang và cấm hút thuốc
               IF cabinClass != NULL AND inv.cabin_class != cabinClass THEN CONTINUE
               IF isSmoking != NULL AND inv.is_smoking != isSmoking THEN CONTINUE
               
               // Kiểm tra còn đủ ghế cho toàn bộ đoàn khách không
               IF inv.available_seats < totalPassengers THEN CONTINUE

               // Áp dụng công thức biểu giá theo quy chuẩn Hàng không:
               // Người lớn: 100%, Trẻ em: 75%, Người cao tuổi: 85%
               adultPrice = inv.base_price
               childPrice = round(inv.base_price * 0.75)
               seniorPrice = round(inv.base_price * 0.85)

               totalPartyPrice = (adults * adultPrice) + (children * childPrice) + (seniors * seniorPrice)

               formattedResults.append({
                   flight_id: flight._id,
                   flight_number: flight.flight_number,
                   departure_time: flight.scheduled_departure,
                   arrival_time: flight.scheduled_arrival,
                   duration_minutes: flight.duration_minutes,
                   available_seats: inv.available_seats,
                   cabin_class: inv.cabin_class,
                   base_price_per_adult: adultPrice,
                   total_party_price: totalPartyPrice
               })
           END FOR
       END FOR

    7. RETURN formattedResults
End Algorithm
```

- **Giải thích hoạt động:** 
  - Truy vấn tận dụng chỉ mục kết hợp compound index `{ origin_iata: 1, dest_iata: 1, departure_date: 1 }` giúp loại trừ ngay lập tức các chuyến bay không phù hợp.
  - Phép tính giá vé được làm tròn nguyên số tiền (`round`), tính toán tức thời trên bộ nhớ RAM thay vì ghi vào DB, đảm bảo báo giá minh bạch cho từng nhóm khách.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(F \times I)$ với $F$ là số lượng chuyến bay tìm được trên tuyến, $I$ là số lượng khoang vé trong chuyến ($I \le 4$). Quá trình tính toán là tuyến tính và diễn ra trong $<10\text{ms}$.
  - **Không gian:** $O(F \times I)$ cho danh sách kết quả trả về.

---

### THUẬT TOÁN 3: Lựa chọn Tuyến bay Nối chuyến (Connecting Route Selection Algorithm)

- **Mục tiêu:** Trong trường hợp không có chuyến bay thẳng nào thỏa mãn yêu cầu của khách hàng, hệ thống tự động kích hoạt thuật toán tìm kiếm đường bay gián tiếp qua một trạm trung chuyển (Transit Hub $T$), thỏa mãn điều kiện thời gian chờ nối chuyến (Layover) từ 45 phút đến 720 phút (12 tiếng) (Yêu cầu 3.3.3).
- **Tập tin cài đặt:** [flights.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/flights/flights.service.ts) (`findConnectingRoutes`)

#### Mã giả (Pseudocode):
```text
Algorithm FindConnectingRoutes(originIata, destIata, departureDate, totalPassengers):
    Input: originIata, destIata, departureDate, totalPassengers
    Output: List<ConnectingItinerary>

    1. connectingOptions = []
    
    // Bước 1: Tìm tất cả chuyến bay chặng 1 xuất phát từ Origin trong ngày
    2. leg1Flights = DB.flights.find({
           origin_iata: originIata,
           departure_date: departureDate,
           status: { $ne: "CANCELLED" }
       })

    3. FOR EACH leg1 IN leg1Flights DO:
           transitAirport = leg1.dest_iata
           IF transitAirport == destIata THEN CONTINUE // Bỏ qua nếu là bay thẳng

           // Bước 2: Tìm chặng 2 từ trạm trung chuyển đến Dest trong cùng ngày
           // Điều kiện tiên quyết: Chặng 2 phải cất cánh sau khi Chặng 1 hạ cánh
           leg2Flights = DB.flights.find({
               origin_iata: transitAirport,
               dest_iata: destIata,
               departure_date: departureDate,
               scheduled_departure: { $gt: leg1.scheduled_arrival },
               status: { $ne: "CANCELLED" }
           })

           FOR EACH leg2 IN leg2Flights DO:
               // Tính thời gian quá cảnh (Layover) bằng phút
               layoverMinutes = round((leg2.scheduled_departure - leg1.scheduled_arrival) / (1000 * 60))

               // Kiểm tra điều kiện tiêu chuẩn hàng không quốc tế: 45 phút <= Layover <= 12 giờ
               IF layoverMinutes >= 45 AND layoverMinutes <= 720 THEN:
                   validLeg1Invs = filter(leg1.inventories, inv.available_seats >= totalPassengers)
                   validLeg2Invs = filter(leg2.inventories, inv.available_seats >= totalPassengers)

                   IF length(validLeg1Invs) > 0 AND length(validLeg2Invs) > 0 THEN:
                       totalDuration = leg1.duration_minutes + layoverMinutes + leg2.duration_minutes
                       connectingOptions.append({
                           route_type: "CONNECTING",
                           transit_airport: transitAirport,
                           layover_minutes: layoverMinutes,
                           total_duration_minutes: totalDuration,
                           leg1: { flight: leg1, inventories: validLeg1Invs },
                           leg2: { flight: leg2, inventories: validLeg2Invs }
                       })
                   END IF
               END IF
           END FOR
       END FOR

    4. Sort connectingOptions by total_duration_minutes ASC
    5. RETURN connectingOptions
End Algorithm
```

- **Giải thích hoạt động:** 
  - Thuật toán giải bài toán tìm đường đi 2 chặng trên đồ thị đường bay có trọng số thời gian thực tế.
  - Bộ lọc $45 \le \text{layover} \le 720$ phút đảm bảo hành khách có đủ thời gian làm thủ tục chuyển tiếp hành lý tại sân bay trung chuyển mà không phải chịu thời gian chờ đợi qua đêm quá dài.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(L_1 \times L_2)$ với $L_1$ là số chuyến xuất phát từ sân bay đi và $L_2$ là số chuyến nối tiếp từ trạm trung chuyển. Do mạng lưới bay nội địa và khu vực có số chuyến giới hạn trong ngày ($L_1, L_2 \le 50$), thuật toán đạt hiệu năng thực tế $<50\text{ms}$.
  - **Không gian:** $O(K)$ cho danh sách các hành trình nối chuyến hợp lệ.

---

### THUẬT TOÁN 4: Giữ chỗ Ghế ngồi Nguyên tử & Cơ chế Rollback Chặng (Atomic Seat Reservation with Multi-leg Rollback)

- **Mục tiêu:** Đảm bảo tính toán vẹn dữ liệu khi đặt chỗ: trừ số lượng ghế khả dụng (`available_seats`) một cách nguyên tử để ngăn chặn hiện tượng tranh chấp bán vượt số ghế (race condition / overbooking). Nếu đặt vé cho hành trình nhiều chặng (nối chuyến hoặc khứ hồi) mà một chặng bất kỳ thất bại do hết ghế, hệ thống phải tự động khôi phục (Rollback) lại số ghế đã trừ ở các chặng trước đó (Yêu cầu 3.4.3).
- **Tập tin cài đặt:** [flights.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/flights/flights.service.ts) (`reserveSeats`) & [bookings.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/bookings/bookings.service.ts) (`createBooking`)

#### Mã giả (Pseudocode):
```text
Algorithm ReserveSeatsAtomic(legs, passengerCount):
    Input: legs (Danh sách các chặng: flight_id, inventory_id), passengerCount (Số lượng khách)
    Output: Boolean (True nếu giữ chỗ toàn bộ thành công, Ném ngoại lệ nếu thất bại)

    1. reservedLegs = []

    2. FOR EACH leg IN legs DO:
           // Thực hiện thao tác nguyên tử cấp độ Document bằng MongoDB findOneAndUpdate
           result = DB.flights.findOneAndUpdate(
               {
                   _id: leg.flight_id,
                   inventories: {
                       $elemMatch: {
                           _id: leg.inventory_id,
                           available_seats: { $gte: passengerCount } // Điều kiện tiên quyết: còn đủ ghế
                       }
                   }
               },
               {
                   $inc: { 'inventories.$.available_seats': -passengerCount } // Giảm ghế nguyên tử
               },
               { new: true }
           )

           IF result == NULL THEN:
               // Thao tác giữ chỗ chặng này thất bại (do hết ghế hoặc có người vừa tranh mua trước)
               // BẮT ĐẦU CƠ CHẾ ROLLBACK CHO CÁC CHẶNG ĐÃ GIỮ THÀNH CÔNG TRƯỚC ĐÓ:
               FOR EACH prevLeg IN reservedLegs DO:
                   DB.flights.updateOne(
                       { _id: prevLeg.flight_id, "inventories._id": prevLeg.inventory_id },
                       { $inc: { 'inventories.$.available_seats': +passengerCount } } // Hoàn trả ghế
                   )
               END FOR

               THROW BadRequestException("Không đủ ghế trống trên chuyến bay, giao dịch đã được hoàn tác.")
           END IF

           reservedLegs.append(leg)
       END FOR

    3. RETURN True
End Algorithm
```

- **Giải thích hoạt động:** 
  - Thuật toán tận dụng triệt để tính chất nguyên tử của toán tử `$inc` và `$elemMatch` trên MongoDB WiredTiger Storage Engine. Việc kiểm tra điều kiện ghế trống $\ge \text{count}$ và trừ ghế được thực thi trong một lệnh nguyên tử duy nhất (không có khoảng trống giữa đọc và ghi).
  - Khối phục hồi (Rollback loop) đảm bảo tính nhất quán toàn vẹn: không bao giờ xảy ra tình trạng khách đặt được chiều đi nhưng bị kẹt chiều về.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(L)$ với $L$ là số lượng chặng bay trong đơn hàng ($L \in \{1, 2, 3\}$). Mỗi lệnh cập nhật đĩa mất $O(1)$.
  - **Không gian:** $O(L)$ lưu danh sách chặng cần quản lý hoàn tác.

---

### THUẬT TOÁN 5: Quy tắc Giữ chỗ >14 ngày, Cron nhắc nhở 3 tuần & Tự động Hủy vé (Blocking Rules & Cron Lifecycle)

- **Mục tiêu:** 
  - Khách chỉ được phép chọn giữ chỗ miễn phí (`BLOCKED`) nếu ngày khởi hành cách thời điểm hiện tại **trên 14 ngày (2 tuần)**. Hạn chót xác nhận (`time_limit_deadline`) được chốt cứng bằng Ngày bay sớm nhất trừ đi 14 ngày.
  - Tự động chạy tiến trình ngầm (Cron Job hàng giờ) quét và gửi email nhắc nhở trước 3 tuần (21 ngày) cho các vé giữ chỗ chưa thanh toán.
  - Tự động quét và hủy vé quá hạn 14 ngày, hoàn trả ghế trống vào kho vé (Yêu cầu 3.4.2, 3.4.2.1, 3.5.1).
- **Tập tin cài đặt:** [bookings.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/bookings/bookings.service.ts) & [bookings.scheduler.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/bookings/bookings.scheduler.ts)

#### Mã giả (Pseudocode):

```text
// Phần A: Kiểm tra điều kiện khi tạo đơn giữ chỗ
Algorithm ValidateBlockingRule(earliestDeparture, isBlock):
    now = CurrentTimestamp()
    daysUntilDeparture = (earliestDeparture - now) / (1000 * 60 * 60 * 24)

    IF isBlock == True THEN:
        IF daysUntilDeparture <= 14 THEN:
            THROW BadRequestException("Chuyến bay khởi hành trong vòng 14 ngày. Quý khách bắt buộc phải mua vé trực tiếp, không được phép giữ chỗ.")
        END IF
        
        blockingDeadline = earliestDeparture - (14 * 24 * 60 * 60 * 1000)
        RETURN { status: "BLOCKED", deadline: blockingDeadline }
    ELSE:
        RETURN { status: "CONFIRMED", deadline: NULL }
    END IF
End Algorithm

// Phần B: Cron Job chạy định kỳ hàng giờ (BookingsScheduler)
Algorithm CronHourlyJobs():
    now = CurrentTimestamp()
    twentyOneDaysFromNow = now + (21 * 24 * 60 * 60 * 1000)

    // 1. Quét gửi email nhắc nhở 3 tuần trước ngày bay (Yêu cầu 3.4.2.1)
    candidates = DB.bookings.find({
        status: "BLOCKED",
        is_reminder_sent: false
    }).populate("user_id")

    FOR EACH booking IN candidates DO:
        IF booking.time_limit_deadline <= now THEN CONTINUE // Quá hạn, để tiến trình hủy xử lý
        
        earliestDep = GetEarliestDeparture(booking)
        IF earliestDep > now AND earliestDep <= twentyOneDaysFromNow THEN:
            TRY:
                SendReminderEmail(booking.user.email, booking)
                booking.is_reminder_sent = true
                DB.bookings.save(booking)
            CATCH err:
                Log("Gửi email nhắc nhở thất bại cho đơn: " + booking.pnr_code)
            END TRY
        END IF
    END FOR

    // 2. Quét tự động hủy các vé giữ chỗ đã quá hạn 14 ngày (Yêu cầu 3.5.1)
    expiredBookings = DB.bookings.find({
        status: "BLOCKED",
        time_limit_deadline: { $lt: now, $ne: NULL }
    })

    FOR EACH booking IN expiredBookings DO:
        booking.status = "CANCELLED"
        booking.cancellation_number = GenerateCode("CAN")
        DB.bookings.save(booking)

        // Hoàn trả lại toàn bộ số ghế đã giữ cho kho vé chuyến bay
        ReleaseSeatsForBooking(booking)
        Log("Tự động hủy vé quá hạn thành công: " + booking.pnr_code)
    END FOR
End Algorithm
```

- **Giải thích hoạt động:** 
  - Điều kiện bảo vệ 14 ngày ngăn chặn việc giữ ảo ghế sát giờ bay, bảo vệ doanh thu cho hãng hàng không.
  - Bộ lập lịch Cron Job sử dụng `@Cron(CronExpression.EVERY_HOUR)` vận hành độc lập, xử lý theo lô (batch processing), có gắn cờ `is_reminder_sent` để đảm bảo mỗi khách chỉ nhận đúng một email nhắc nhở duy nhất.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(B)$ với $B$ là số lượng đơn giữ chỗ đang hoạt động cần kiểm tra. Quá trình xử lý hàng giờ chạy nền không ảnh hưởng tới luồng API chính.
  - **Không gian:** $O(B)$ để tải danh sách đơn cần xử lý vào bộ nhớ.

---

### THUẬT TOÁN 6: Tra cứu Tỷ lệ Hoàn tiền theo Bảng Chính sách Hủy vé (Refund Policy Percentage Lookup)

- **Mục tiêu:** Khi hành khách hủy vé đã xác nhận (`CONFIRMED`), hệ thống tính toán số ngày còn lại trước giờ khởi hành (`daysBeforeDeparture`) và đối chiếu với danh mục chính sách trong CSDL (`cancellationpolicies`) để xác định chính xác tỷ lệ hoàn tiền (%) (Yêu cầu 3.7.2).
- **Tập tin cài đặt:** [policies.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/policies/policies.service.ts) (`calculateRefundPercentage`)

#### Mã giả (Pseudocode):
```text
Algorithm CalculateRefundPercentage(daysBeforeDeparture):
    Input: daysBeforeDeparture (Số ngày thực tế tính từ hiện tại tới lúc cất cánh)
    Output: refundPercentage (Số nguyên từ 0 đến 100)

    1. policies = DB.cancellationpolicies.find().sort({ min_days_before: -1 })

    2. FOR EACH policy IN policies DO:
           IF policy.max_days_before != NULL THEN:
               // Khung ngày có giới hạn cận trên và cận dưới: [min_days, max_days]
               IF daysBeforeDeparture >= policy.min_days_before AND daysBeforeDeparture <= policy.max_days_before THEN:
                   RETURN policy.refund_percentage
               END IF
           ELSE:
               // Khung ngày không giới hạn cận trên: >= min_days (hủy rất sớm)
               IF daysBeforeDeparture >= policy.min_days_before THEN:
                   RETURN policy.refund_percentage
               END IF
           END IF
       END FOR

    3. RETURN 0 // Mặc định không hoàn tiền nếu hủy quá sát giờ bay
End Algorithm
```

- **Giải thích hoạt động:** 
  - Danh sách chính sách được sắp xếp giảm dần theo `min_days_before`. Điều này đảm bảo mốc thời gian ưu đãi nhất (hủy sớm nhất) sẽ được khớp trước.
  - Số tiền hoàn lại được tính bằng công thức:
    $$\text{refund\_amount} = \text{round}\left(\frac{\text{total\_amount} \times \text{refund\_percentage}}{100}\right)$$
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(P)$ với $P$ là số lượng quy tắc chính sách ($P \le 10$). Độ trễ xấp xỉ $O(1)$.
  - **Không gian:** $O(P)$.

---

### THUẬT TOÁN 7: Tích lũy và Khấu trừ Dặm bay SkyMiles (SkyMiles Accrual & Deduction Engine)

- **Mục tiêu:** Tự động cộng điểm dặm bay khi hành khách mua vé trực tiếp hoặc xác nhận vé giữ chỗ, dựa trên khoảng cách chuyến bay tính bằng dặm (`distance_miles`) nhân với số lượng hành khách trong đoàn bay. Khi vé bị hủy, hệ thống khấu trừ chính xác số điểm đã cộng khỏi hồ sơ người dùng (Yêu cầu 3.2, 3.4.3.3, 3.7.3).
- **Tập tin cài đặt:** [bookings.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/bookings/bookings.service.ts) & [users.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/users/users.service.ts)

#### Công thức & Mã giả (Pseudocode):

$$\text{Total Miles Accrued} = \sum_{\text{chặng } i} \left( \text{distance\_miles}_i \times \text{passengerCount} \right)$$

```text
// Phần A: Tích lũy khi thanh toán vé thành công
Algorithm AccrueSkyMiles(userId, booking):
    totalMiles = 0
    passengerCount = length(booking.passengers)

    FOR EACH coupon IN booking.ticket_coupons DO:
        flight = DB.flights.findById(coupon.flight_id)
        totalMiles = totalMiles + flight.distance_miles
    END FOR

    // Cập nhật vào hồ sơ người dùng
    user = DB.users.findById(userId)
    user.sky_miles = user.sky_miles + totalMiles
    DB.users.save(user)

    booking.total_miles_accrued = totalMiles
    DB.bookings.save(booking)
End Algorithm

// Phần B: Khấu trừ khi hủy vé
Algorithm DeductSkyMilesOnCancel(userId, booking):
    IF booking.total_miles_accrued > 0 THEN:
        user = DB.users.findById(userId)
        // Đảm bảo dặm bay không bị âm nếu khách đã tiêu bớt điểm
        user.sky_miles = max(0, user.sky_miles - booking.total_miles_accrued)
        DB.users.save(user)

        booking.total_miles_accrued = 0
        DB.bookings.save(booking)
    END IF
End Algorithm
```

- **Giải thích hoạt động:** Dặm bay được gắn liền với tài khoản đặt vé (`user_id`). Cơ chế `max(0, ...)` ngăn chặn lỗi toán học âm điểm.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(C)$ với $C$ là số lượng cuống vé trong đơn đặt. Thao tác cập nhật người dùng là $O(1)$.
  - **Không gian:** $O(1)$.

---

### THUẬT TOÁN 8: Đổi vé Đã xác nhận, Tính chênh lệch giá & Tái cấu trúc Cuống vé (Ticket Rescheduling Engine)

- **Mục tiêu:** Cho phép hành khách đổi vé đã xác nhận (`CONFIRMED`) sang chuyến bay mới. Thuật toán kiểm tra chỗ trống chuyến mới, hoàn trả ghế chuyến cũ, trừ ghế chuyến mới, tính chênh lệch giá vé (`price_difference`), thực hiện phụ thu/hoàn tiền qua thẻ tín dụng, tái cấu trúc mảng cuống vé (`ticket_coupons`) theo chiều bay (`leg_type`) và cấp mã xác nhận mới (Yêu cầu 3.6).
- **Tập tin cài đặt:** [bookings.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/bookings/bookings.service.ts) (`rescheduleTicket`)

#### Mã giả (Pseudocode):
```text
Algorithm RescheduleTicket(confirmationNumber, newFlightId, newInventoryId, newReturnFlightId, newReturnInventoryId):
    1. booking = DB.bookings.findOne({ confirmation_number: confirmationNumber })
    IF booking == NULL OR booking.status != "CONFIRMED" THEN:
        THROW BadRequestException("Chỉ cho phép đổi vé đối với vé đã xác nhận thanh toán (CONFIRMED).")
    END IF

    passengerCount = length(booking.passengers)
    oldTotalFare = booking.total_amount

    // Tách cuống vé thành chiều đi (OUTBOUND) và chiều về (INBOUND)
    outboundCoupons = filter(booking.ticket_coupons, c.leg_type == "OUTBOUND")
    inboundCoupons = filter(booking.ticket_coupons, c.leg_type != "OUTBOUND")

    // 2. Xử lý đổi Chặng đi:
    newFlight = DB.flights.findById(newFlightId)
    newInv = findInventory(newFlight, newInventoryId)
    IF newInv.available_seats < passengerCount THEN:
        THROW BadRequestException("Chuyến bay mới không đủ ghế trống.")
    END IF

    // Cập nhật ghế: Hoàn trả ghế chặng cũ, trừ ghế chặng mới
    ReleaseSeatsForCoupons(passengerCount, outboundCoupons)
    UpdateAvailableSeats(newFlightId, newInventoryId, -passengerCount)

    // 3. Xử lý đổi Chặng về (nếu là vé khứ hồi và có chọn chuyến về mới):
    shouldRescheduleReturn = (booking.booking_type == "ROUND_TRIP" AND newReturnFlightId != NULL)
    IF shouldRescheduleReturn THEN:
        newReturnFlight = DB.flights.findById(newReturnFlightId)
        newReturnInv = findInventory(newReturnFlight, newReturnInventoryId)
        ReleaseSeatsForCoupons(passengerCount, inboundCoupons)
        UpdateAvailableSeats(newReturnFlightId, newReturnInventoryId, -passengerCount)
    END IF

    // 4. Tính toán chênh lệch giá tiền:
    newTotalFare = ComputeLegFare(newInv.base_price, booking.passengers)
    IF shouldRescheduleReturn THEN:
        newTotalFare += ComputeLegFare(newReturnInv.base_price, booking.passengers)
    ELSE:
        newTotalFare += SumFare(inboundCoupons) // Giữ nguyên giá chặng về cũ
    END IF

    priceDiff = newTotalFare - oldTotalFare

    // 5. Ghi vết giao dịch tài chính
    IF priceDiff > 0 THEN:
        AppendTransaction(booking, "RESCHEDULE_CHARGE", priceDiff) // Phụ thu
    ELSE IF priceDiff < 0 THEN:
        AppendTransaction(booking, "RESCHEDULE_REFUND", abs(priceDiff)) // Hoàn trả chênh lệch
    END IF

    // 6. Cấp mã xác nhận mới và tái cấu trúc cuống vé
    booking.confirmation_number = GenerateCode("CNF")
    booking.total_amount = newTotalFare
    booking.ticket_coupons = RebuildCoupons(booking.passengers, newFlight, newInv, "OUTBOUND") + ...
    DB.bookings.save(booking)

    RETURN { booking, price_difference: priceDiff }
End Algorithm
```

- **Giải thích hoạt động:** 
  - Quy tắc phân biệt rõ ràng: Tuyệt đối không cho phép đổi vé đang ở trạng thái giữ chỗ (`BLOCKED`).
  - Mảng cuống vé được tái sinh hoàn toàn với mã cuống vé mới (`CPN-XXXXXX`), bảo toàn thông tin loại hành khách và ghế ngồi.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(P)$ với $P$ là số lượng hành khách trong đoàn.
  - **Không gian:** $O(P)$ tạo cuống vé mới.

---

### THUẬT TOÁN 9: Kiểm tra Chiếm dụng Sơ đồ Ghế & Phân loại Hàng ghế Airbus A321 (Seat Map Occupancy & Layout Generator)

- **Mục tiêu:** Mô phỏng sơ đồ ghế ngồi chuẩn hàng không cho dòng máy bay thân hẹp Airbus A321 (31 hàng ghế, cấu hình 3 - 3: A, B, C | D, E, F). Thuật toán kiểm tra trạng thái chiếm chỗ thực tế từ các đơn đặt vé chưa hủy trong CSDL (`ticket_coupons.seat_code`), đồng thời phân loại quy tắc hàng ghế quốc tế: Hàng 1 - 5 là hàng ghế Đặc biệt/Skyboss, Hàng 12 và 14 là hàng ghế gần Lối thoát hiểm (chỗ để chân rộng), và **bỏ qua hoàn toàn hàng 13** theo phong tục hàng không quốc tế.
- **Tập tin cài đặt:** [flights.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/flights/flights.service.ts) (`getSeatMap`)

#### Mã giả (Pseudocode):
```text
Algorithm GenerateSeatMap(flightId):
    Input: flightId
    Output: SeatMapStructure

    1. flight = DB.flights.findById(flightId)
    
    // Bước 1: Quét CSDL lấy tập hợp các ghế đã được đặt cho chuyến bay này
    2. activeBookings = DB.bookings.find({
           'ticket_coupons.flight_id': flight._id,
           status: { $ne: "CANCELLED" }
       })

    3. occupiedSet = Set()
    4. FOR EACH b IN activeBookings DO:
           FOR EACH coupon IN b.ticket_coupons DO:
               IF coupon.flight_id == flight._id AND coupon.seat_code != "" THEN:
                   occupiedSet.add(toUpperCase(coupon.seat_code))
               END IF
           END FOR
       END FOR

    // Bước 2: Thiết lập cấu hình vật lý tàu bay Airbus A321
    5. columns = ['A', 'B', 'C', 'D', 'E', 'F']
    6. totalRows = 31
    7. exitRows = [12, 14]
    8. specialRows = [1, 2, 3, 4, 5]
    9. skippedRows = [13] // Chuẩn quốc tế kiêng số 13

    10. rows = []
    11. FOR r = 1 TO totalRows DO:
            IF r IN skippedRows THEN CONTINUE // Bỏ qua hàng 13

            isExit = (r IN exitRows)
            isSpecial = (r IN specialRows)
            rowSeats = []

            FOR EACH col IN columns DO:
                seatCode = string(r) + col
                type = "STANDARD"
                typeLabel = "Còn trống"
                cabinClass = "ECONOMY"
                referenceFee = 0

                IF isSpecial THEN:
                    type = "SPECIAL"
                    typeLabel = "Đặc biệt"
                    cabinClass = "BUSINESS"
                    referenceFee = 150000 // 150.000đ (chỉ hiển thị tham khảo, hệ thống không thu thêm)
                ELSE IF isExit THEN:
                    type = "EXIT_ROW"
                    typeLabel = "Gần lối thoát hiểm"
                    cabinClass = "ECONOMY"
                    referenceFee = 100000 // 100.000đ tham khảo
                END IF

                isOccupied = occupiedSet.has(seatCode)

                rowSeats.append({
                    seat_code: seatCode,
                    type: type,
                    type_label: typeLabel,
                    cabin_class: cabinClass,
                    fee: referenceFee,
                    is_occupied: isOccupied,
                    is_exit_row: isExit,
                    is_special: isSpecial
                })
            END FOR

            rows.append({ row_number: r, is_exit_row: isExit, is_special: isSpecial, seats: rowSeats })
        END FOR

    12. RETURN { flight_id: flight._id, layout_notice: "Airbus A321 Layout", rows: rows }
End Algorithm
```

- **Giải thích hoạt động:** Ghế chỉ được đánh dấu là `is_occupied = true` nếu có bản ghi thực tế trong CSDL với trạng thái khác `CANCELLED`. Bỏ qua hàng 13 giúp sơ đồ máy bay tuân thủ 100% tiêu chuẩn quốc tế của IATA/ICAO.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(B_f + R \times C)$ với $B_f$ là số lượng vé của chuyến bay, $R = 30$ hàng ghế thực tế, $C = 6$ ghế/hàng. Tổng cộng kiểm tra $30 \times 6 = 180$ ghế trong $<15\text{ms}$.
  - **Không gian:** $O(180)$ phần tử biểu diễn sơ đồ ghế.

---

### THUẬT TOÁN 10: Tích hợp AirLabs: Đồng bộ Lịch bay, Làm giàu Tàu bay & Đội bay Thực tế (AirLabs Integration & Honest Fallback Engine)

- **Mục tiêu:** Tích hợp với dịch vụ Hàng không toàn cầu AirLabs API (`airlabs.co`):
  1. Đồng bộ lịch trình chuyến bay thực tế theo chặng (`syncFromAirLabs`).
  2. Truy vấn radar trực tiếp để làm giàu thông tin máy bay đang bay (số đăng bạ, model máy bay).
  3. Tra cứu toàn bộ đội bay của hãng (`getAirlineFleet`).
  4. **Quy tắc ứng xử trung thực (Honest Fallback Rule):** Tuyệt đối không tự bịa đặt số đăng bạ cho các chuyến bay tương lai chưa cất cánh (Yêu cầu tích hợp Live Flight Data).
- **Tập tin cài đặt:** [flights.service.ts](file:///C:/Users/Ha/Desktop/aptechairline/backend/src/flights/flights.service.ts) (`syncFromAirLabs`, `enrichAircraftFromAirLabs`, `getAirlineFleet`)

#### Mã giả (Pseudocode):

```text
// Phần A: Đồng bộ lịch bay từ AirLabs
Algorithm SyncFromAirLabs(originIata, destIata, apiKey):
    url = "https://airlabs.co/api/v9/schedules?dep_iata=" + originIata + "&arr_iata=" + destIata + "&api_key=" + apiKey
    response = HTTP_GET(url)
    
    schedules = response.data.response
    savedFlights = []

    FOR EACH item IN schedules DO:
        flightNumber = item.flight_iata OR (item.airline_iata + item.flight_number)
        depTime = ParseDate(item.dep_time)
        arrTime = ParseDate(item.arr_time)
        departureDate = item.dep_time.split(" ")[0]

        // Thiết lập cấu hình giá chuẩn VND nhất quán toàn hệ thống:
        // Economy: 1.250.000đ, Business: 2.950.000đ, First: 4.200.000đ
        inventories = BuildStandardInventories()

        // Upsert: Cập nhật nếu đã có chuyến cùng số hiệu & ngày bay, tạo mới nếu chưa
        flight = DB.flights.findOne({ flight_number: flightNumber, departure_date: departureDate })
        IF flight != NULL THEN:
            flight.scheduled_departure = depTime
            flight.scheduled_arrival = arrTime
            flight.status = ConvertStatus(item.status, item.delayed)
            DB.flights.save(flight)
        ELSE:
            flight = DB.flights.create({ flight_number: flightNumber, inventories, ... })
        END IF
        savedFlights.append(flight)
    END FOR
    RETURN savedFlights
End Algorithm

// Phần B: Làm giàu thông tin tàu bay trực tiếp & Quy tắc Fallback trung thực
Algorithm EnrichAircraftFromAirLabs(flightId, apiKey):
    flight = DB.flights.findById(flightId)
    flightNumber = flight.flight_number

    // Truy vấn radar thời gian thực của AirLabs
    url = "https://airlabs.co/api/v9/flights?flight_iata=" + flightNumber + "&api_key=" + apiKey
    response = HTTP_GET(url)
    liveRows = response.data.response

    liveRow = find(liveRows, row.flight_iata == flightNumber)

    // QUY TẮC TRUNG THỰC (HONEST FALLBACK RULE):
    IF liveRow == NULL THEN:
        // Chuyến bay chưa cất cánh hoặc đã hạ cánh, radar không có tín hiệu phát đáp (transponder)
        // TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT SỐ ĐĂNG BẠ HOẶC MODEL MÁY BAY!
        RETURN {
            found: false,
            flight: flight,
            message: "Chuyến bay hiện không ở trạng thái đang bay nên AirLabs chưa có dữ liệu máy bay thật cho số hiệu này."
        }
    END IF

    // Chuyến bay đang ở trên không, ghi nhận thông tin đăng bạ thật từ radar
    flight.aircraft = {
        model_code: liveRow.aircraft_icao,
        model_name: GetIcaoHumanReadableName(liveRow.aircraft_icao), // VD: "Airbus A321neo"
        registration: liveRow.reg_number,                           // VD: "VN-A612"
        total_capacity: SumCapacity(flight.inventories)
    }
    DB.flights.save(flight)

    RETURN { found: true, registration: liveRow.reg_number, model: flight.aircraft.model_name }
End Algorithm
```

- **Giải thích hoạt động:** 
  - Hàm `getIcaoHumanReadableName` chuyển đổi các mã ICAO viết tắt như `A321`, `A21N`, `B789`, `A359` thành tên máy bay thương mại chuẩn mực (`Airbus A321neo`, `Boeing 787-9`).
  - Quy tắc ứng xử trung thực đảm bảo tính liêm chính kỹ thuật: Hệ thống chỉ gán số đăng bạ quốc tế khi máy bay đang kích hoạt bộ phát đáp tín hiệu ADS-B trên không phận. Với các chuyến bay tương lai trong lịch trình, hệ thống giữ nguyên trạng thái `registration = undefined` thay vì sinh mã ngẫu nhiên.
- **Độ phức tạp tính toán:**
  - **Thời gian:** Phụ thuộc vào độ trễ mạng ngoại vi HTTP Request tới AirLabs API (thường từ $200\text{ms} - 500\text{ms}$).
  - **Không gian:** $O(M)$ biểu diễn dữ liệu phản hồi từ nhà cung cấp API.
