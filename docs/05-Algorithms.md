# TÀI LIỆU ĐẶC TẢ THUẬT TOÁN HỆ THỐNG (ALGORITHMS SPECIFICATION)
**Hệ thống Quản lý và Đặt vé Máy bay (Airline Reservation System - ARS)**
**Mã tài liệu:** `docs/05-Algorithms.md`
**Dự án:** Aptech Airlines eProject
**Thành phần thực thi:** Backend NestJS Services & Schedulers

---

## 1. TỔNG QUAN CÁC THUẬT TOÁN CỐT LÕI

Hệ thống Aptech Airlines triển khai 20 thuật toán nghiệp vụ then chốt nhằm đáp ứng trọn vẹn yêu cầu chức năng trong bản đặc tả dự án (`ProjectSpecification.txt` & `AirlinesReservationSystem.txt`), đảm bảo tính toàn vẹn giao dịch, hiệu năng tra cứu và trải nghiệm người dùng tối ưu:

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
| **9** | Kiểm tra Chiếm dụng Sơ đồ Ghế & Catalog Đội bay Đa chủng loại | `FlightsService.getSeatMap` & `SeatAllocationService` | Sơ đồ ghế Hàng không & Catalog 6 dòng tàu bay |
| **10** | Tích hợp AirLabs: Đồng bộ Lịch bay & Radar ADS-B | `AirLabsCommercialService` & `FlightsService` | Dữ liệu Hàng không thực tế & Fallback trung thực |
| **11** | Tính Khoảng cách Cung lớn Great-Circle (Haversine Formula) | `calculateGreatCircleMiles` (`distance.util.ts`) | Khoảng cách đường bay & dặm bay chuẩn xác (statute miles) |
| **12** | Định giá Ghế ngồi Động 8 Chiều theo Mô hình Cộng dồn (Fee Stacking) | `SeatPricingService.calculateSeatFee` | Phụ thu vị trí ghế minh bạch (`SeatPricingRule.amount`) |
| **13** | Phân tích Nghiệp vụ Doanh thu & Quản trị Tải Chuyến bay | `AnalyticsService.getAnalyticsSummary` / `getCapacitySummary` | Doanh thu thuần, giá trị đặt vé & đối soát tải ghế |
| **14** | SAGA Đặt Chỗ Ghế & Tồn Kho Hai Pha (Seat & Inventory SAGA) | `BookingSeatSagaOperation` & `SeatAllocationService` | Giao dịch hai pha phân tán chống rò rỉ ghế |
| **15** | Bồi Hoàn & Phục Hồi Tiến Khi Đổi Vé (Reschedule Forward Recovery) | `BookingsService.rescheduleTicket` / `mixed / connecting` | Hoán đổi chặng bay nguyên tử, chống mất chỗ cũ nếu lỗi |
| **16** | Máy Trạng Thái PayPal, Idempotency & Giới Hạn Cổng Thanh Toán | `PaypalService` & `PaypalController` | Trạng thái CAPTURED/REFUNDED (*CODE IMPLEMENTED / PRE-SANDBOX; REAL PROVIDER ACCEPTANCE: DEFERRED / NOT EXECUTED*) |
| **17** | Phục Hồi Giao Dịch Chụp Nhập Nhằng & Đối Chiếu Bằng Chứng Tỷ Giá | `assertPayPalPaymentProof` & `PaypalController` | Ràng buộc tỷ giá 1:1, kiểm tra số tiền VND - USD khớp |
| **18** | Hoàn Tiền Bồi Thường & Phân Bổ Nguồn Hoàn LIFO | `allocateRefundSources` (`refund-allocation.util.ts`) | Phân bổ nguồn hoàn tiền chống lạm chi, bảo toàn provenance |
| **19** | Tự Động Thử Lại & Đối Soát Hoàn Tiền Treo/Thất Bại | `PaypalRefundScheduler` & `PaypalController` | Tự động quét và đối soát giao dịch hoàn tiền chưa hoàn tất |
| **20** | Khám Phá Mạng Lưới & Vật Hóa Lịch Bay Thương Mại 330 Ngày | `AirLabsCommercialService` & `FlightGeneratorService` | Sinh và quản lý lịch trình thương mại 330 ngày liên tục |

---

## 2. CHI TIẾT 20 THUẬT TOÁN HỆ THỐNG

---

### THUẬT TOÁN 1: Phân giải Thành phố, Xử lý Nhập nhằng & Gợi ý Sân bay Lân cận (City Resolution & Ambiguity Handling)

- **Mục tiêu:** Khi người dùng nhập tên thành phố hoặc mã sân bay dưới dạng chuỗi tự do, hệ thống kiểm tra sự tồn tại trong CSDL, liệt kê tất cả các sân bay trùng khớp nếu có sự nhập nhằng (ambiguity). Trường hợp thành phố không có đường bay trực tiếp (`is_serviced_directly = false`), hệ thống tự động tìm và gợi ý sân bay gần nhất kèm khoảng cách km (Yêu cầu 3.3.1 - 3.3.2).
- **Tập tin cài đặt:** [airports.service.ts](../backend/src/airports/airports.service.ts) (`resolveCity`)

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
- **Tập tin cài đặt:** [flights.service.ts](../backend/src/flights/flights.service.ts) (`searchFlights`, `findDirectFlights`)

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
- **Tập tin cài đặt:** [flights.service.ts](../backend/src/flights/flights.service.ts) (`findConnectingRoutes`)

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
- **Tập tin cài đặt:** [flights.service.ts](../backend/src/flights/flights.service.ts) (`reserveSeats`) & [bookings.service.ts](../backend/src/bookings/bookings.service.ts) (`createBooking`)

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
- **Tập tin cài đặt:** [bookings.service.ts](../backend/src/bookings/bookings.service.ts) & [bookings.scheduler.ts](../backend/src/bookings/bookings.scheduler.ts)

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
- **Tập tin cài đặt:** [policies.service.ts](../backend/src/policies/policies.service.ts) (`calculateRefundPercentage`)

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
- **Tập tin cài đặt:** [bookings.service.ts](../backend/src/bookings/bookings.service.ts) & [users.service.ts](../backend/src/users/users.service.ts)

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
- **Tập tin cài đặt:** [bookings.service.ts](../backend/src/bookings/bookings.service.ts) (`rescheduleTicket`)

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

### THUẬT TOÁN 9: Kiểm tra Chiếm dụng Sơ đồ Ghế & Catalog Đội bay Đa chủng loại (Seat Map Occupancy & Multi-Aircraft Fleet Catalog)

- **Mục tiêu:** Mô phỏng sơ đồ ghế ngồi chuẩn hàng không cho 6 dòng tàu bay thương mại trong catalog (`fleet-layout.catalog.ts`):
  1. `A20N` (Airbus A320neo): 180 ghế (12 Business, 168 Economy).
  2. `A21N` (Airbus A321neo): 204 ghế (16 Business, 188 Economy).
  3. `B789` (Boeing 787-9 Dreamliner): 294 ghế (28 Business, 35 Club, 231 Economy).
  4. `A359` (Airbus A350-900): 305 ghế (29 Business, 36 Club, 240 Economy).
  5. `B738` (Boeing 737-800): 166 ghế (16 Business, 150 Economy).
  6. `AT76` (ATR 72-600): 68 ghế (68 Economy).
  Thuật toán kết hợp sơ đồ vật lý theo layout của từng model máy bay với dữ liệu chiếm chỗ thời gian thực từ hai nguồn: bảng phân bổ ghế vật lý `SeatAllocation` (`HELD`, `CONFIRMED`, `BLOCKED_MAINTENANCE`, `CREW_REST`, `VIP_HOLD`) và cuống vé `ticket_coupons` của các đơn đặt vé chưa hủy. Đồng thời áp dụng phụ phí ghi đè từ `FlightSeatOverride` nếu có.
- **Tập tin cài đặt:** [seat-allocation.service.ts](../backend/src/seat-allocation/seat-allocation.service.ts) & [fleet-layout.catalog.ts](../backend/src/seat-allocation/fleet-layout.catalog.ts)

#### Mã giả (Pseudocode):
```text
Algorithm GenerateFleetSeatMap(flightId):
    Input: flightId
    Output: SeatMapStructure { flight_id, aircraft_model, total_capacity, cabins, rows }

    1. flight = DB.flights.findById(flightId)
    2. modelCode = flight.aircraft?.model_code || 'A21N'
    3. layout = FleetCatalog.getLayout(modelCode) // Tra cứu catalog 6 dòng tàu bay

    // Bước 1: Quét bản ghi phân bổ vật lý SeatAllocation
    4. physicalAllocs = DB.seatallocations.find({ flight_id: flight._id })
    5. physicalStatusMap = Map()
    6. FOR EACH alloc IN physicalAllocs DO:
           physicalStatusMap.set(alloc.seat_code, alloc.status)
       END FOR

    // Bước 2: Quét đơn đặt vé đang hoạt động
    7. activeBookings = DB.bookings.find({
           'ticket_coupons.flight_id': flight._id,
           status: { $in: ['CONFIRMED', 'BLOCKED', 'RESCHEDULED'] }
       })
    8. bookingOccupiedSet = Set()
    9. FOR EACH b IN activeBookings DO:
           FOR EACH coupon IN b.ticket_coupons DO:
               IF coupon.flight_id == flight._id AND coupon.seat_code != "" THEN:
                   bookingOccupiedSet.add(toUpperCase(coupon.seat_code))
               END IF
           END FOR
       END FOR

    // Bước 3: Tra cứu phụ phí ghi đè theo chuyến bay
    10. overrides = DB.flightseatoverrides.find({ flight_id: flight._id, is_active: true })
    11. overrideMap = Map()
    12. FOR EACH ovr IN overrides DO:
            overrideMap.set(ovr.seat_code, ovr.override_fee)
        END FOR

    // Bước 4: Ghép nối sơ đồ vật lý theo layout catalog
    13. mappedRows = []
    14. FOR EACH rowDef IN layout.rows DO:
            rowSeats = []
            FOR EACH seatDef IN rowDef.seats DO:
                code = seatDef.seat_code
                status = physicalStatusMap.get(code) || (bookingOccupiedSet.has(code) ? 'CONFIRMED' : 'AVAILABLE')
                fee = overrideMap.has(code) ? overrideMap.get(code) : seatDef.base_seat_fee

                rowSeats.append({
                    seat_code: code,
                    cabin_class: seatDef.cabin_class,
                    position_subtype: seatDef.position_subtype, // WINDOW, AISLE, MIDDLE
                    is_exit_row: seatDef.is_exit_row,
                    extra_legroom: seatDef.extra_legroom,
                    status: status,
                    is_occupied: (status == 'CONFIRMED' || status == 'HELD'),
                    is_blocked: (status IN ['BLOCKED_MAINTENANCE', 'CREW_REST', 'VIP_HOLD']),
                    seat_fee: fee
                })
            END FOR
            mappedRows.append({ row_number: rowDef.row_number, seats: rowSeats })
        END FOR

    15. RETURN { flight_id: flight._id, aircraft: layout.aircraft_name, total_seats: layout.total_seats, rows: mappedRows }
End Algorithm
```

- **Giải thích hoạt động:**
  - Đảm bảo tính nhất quán tuyệt đối giữa sơ đồ đồ họa ghế và dữ liệu lưu trữ CSDL. Ghế được đánh dấu chiếm dụng nếu có phân bổ vật lý hoặc cuống vé xác nhận.
  - Phân định rõ ràng giữa ghế đã bán cho khách (`CONFIRMED`, `HELD`) và ghế bị nhân viên kỹ thuật khóa (`BLOCKED_MAINTENANCE`, `CREW_REST`, `VIP_HOLD`).
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(S + B_f)$ với $S$ là tổng số ghế của tàu bay ($68 \le S \le 305$), $B_f$ là số lượng vé. Tổng thời gian xử lý $<10\text{ms}$.
  - **Không gian:** $O(S)$ cho cấu trúc dữ liệu sơ đồ hoàn chỉnh.

---

### THUẬT TOÁN 10: Tích hợp AirLabs: Đồng bộ Lịch bay, Làm giàu Tàu bay & Đội bay Thực tế (AirLabs Integration & Honest Fallback Engine)

- **Mục tiêu:** Tích hợp với dịch vụ Hàng không toàn cầu AirLabs API (`airlabs.co`):
  1. Đồng bộ lịch trình chuyến bay thực tế theo chặng (`syncFromAirLabs`).
  2. Truy vấn radar trực tiếp để làm giàu thông tin máy bay đang bay (số đăng bạ, model máy bay).
  3. Tra cứu toàn bộ đội bay của hãng (`getAirlineFleet`).
  4. **Quy tắc ứng xử trung thực (Honest Fallback Rule):** Tuyệt đối không tự bịa đặt số đăng bạ cho các chuyến bay tương lai chưa cất cánh (Yêu cầu tích hợp Live Flight Data).
- **Tập tin cài đặt:** [flights.service.ts](../backend/src/flights/flights.service.ts) (`syncFromAirLabs`, `enrichAircraftFromAirLabs`, `getAirlineFleet`)

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

---

### THUẬT TOÁN 11: Tính Khoảng cách Cung lớn Great-Circle (Haversine Formula)

- **Mục tiêu:** Tính toán cự ly bay thực tế giữa 2 sân bay theo tọa độ trắc địa vĩ độ/kinh độ (Latitude/Longitude), đơn vị dặm chuẩn (statute miles), làm căn cứ chính xác cho việc tính dặm tích lũy SkyMiles và thời gian bay thực tế thay vì sử dụng khoảng cách giả định cố định.
- **Tập tin cài đặt:** [distance.util.ts](../backend/src/common/distance.util.ts) (`calculateGreatCircleMiles`)

#### Mã giả (Pseudocode):
```text
Algorithm CalculateGreatCircleMiles(lat1, lon1, lat2, lon2):
    Input: Tọa độ sân bay đi (lat1, lon1) và sân bay đến (lat2, lon2)
    Output: Cự ly khoảng cách dặm bay (statute miles, làm tròn nguyên)

    // Kiểm tra tính hợp lệ của tọa độ
    IF lat1 == NULL OR lon1 == NULL OR lat2 == NULL OR lon2 == NULL THEN:
        RETURN 0
    END IF
    IF lat1 == lat2 AND lon1 == lon2 THEN:
        RETURN 0
    END IF

    R = 3958.8  // Bán kính trung bình Trái Đất (statute miles)
    toRad = PI / 180.0

    phi1 = lat1 * toRad
    phi2 = lat2 * toRad
    deltaPhi = (lat2 - lat1) * toRad
    deltaLambda = (lon2 - lon1) * toRad

    a = sin(deltaPhi / 2)^2 + cos(phi1) * cos(phi2) * sin(deltaLambda / 2)^2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    distance = R * c
    RETURN Math.round(distance)
End Algorithm
```

- **Kết quả tính toán chuẩn trên các đường bay điển hình:**
  - `SGN` (Tân Sơn Nhất) ➔ `HAN` (Nội Bài): **721 statute miles**.
  - `SGN` (Tân Sơn Nhất) ➔ `DAD` (Đà Nẵng): **376 statute miles**.
  - `SGN` (Tân Sơn Nhất) ➔ `NRT` (Tokyo Narita): **2,724 statute miles**.
- **Độ phức tạp tính toán:**
  - **Thời gian:** $O(1)$ — Thực hiện các phép tính lượng giác với thời gian thực thi hằng số.
  - **Không gian:** $O(1)$.

---

### THUẬT TOÁN 12: Định giá Ghế ngồi Động 8 Chiều theo Mô hình Cộng dồn (Dynamic Seat Fee Stacking)

- **Mục tiêu:** Cung cấp cơ chế tính phụ phí chọn chỗ ngồi linh hoạt dựa trên 8 thuộc tính không gian vật lý của ghế, bảo đảm cộng dồn phụ phí minh bạch (Additive Fee Stacking) và chụp snapshot bất biến (`SeatPricingSnapshot`).
- **Tập tin cài đặt:** [seat-pricing.service.ts](../backend/src/seat-allocation/seat-pricing.service.ts)

#### 8 Chiều định giá ghế độc lập:
1. `CABIN_BASE`: Phụ thu cơ sở theo hạng vé (Economy, Club, Business).
2. `WINDOW`: Ghế sát cửa sổ (vị trí A, F hoặc theo sơ đồ thân rộng).
3. `AISLE`: Ghế cạnh lối đi bộ hành lang.
4. `MIDDLE`: Ghế kẹp giữa (thường miễn phí hoặc giảm trừ).
5. `FRONT_ZONE`: Ghế ở các hàng đầu tiên của khoang (lên/xuống máy bay nhanh).
6. `EXIT_ROW`: Ghế cạnh cửa thoát hiểm khẩn cấp (không gian chân thoáng).
7. `EXTRA_LEGROOM`: Ghế có khoảng cách hàng ghế (seat pitch) mở rộng.
8. `BULKHEAD`: Ghế sát vách ngăn khoang máy bay.

#### Mã giả (Pseudocode):
```text
Algorithm CalculateSeatPrice(seatCode, cabinClass, flightId):
    activeRules = DB.seatpricingrules.find({ is_active: true }).sort({ priority: 1 })
    applicableDimensions = DetectSeatDimensions(seatCode, cabinClass)

    totalSeatFee = 0
    appliedRuleIds = []
    appliedDims = []

    FOR dim IN applicableDimensions:
        matchingRule = FindBestRule(activeRules, dim, cabinClass)
        IF matchingRule != NULL THEN:
            totalSeatFee += matchingRule.amount
            appliedRuleIds.append(matchingRule.rule_id)
            appliedDims.append(dim)
        END IF
    END FOR

    // Kiểm tra cấu hình ghi đè theo từng chuyến bay cụ thể nếu có (tra cứu bằng flight_id)
    override = DB.flightseatoverrides.findOne({ flight_id: flightId, seat_code: seatCode, is_active: true })
    flightOverride = false
    IF override != NULL THEN:
        totalSeatFee = override.override_fee
        flightOverride = true
    END IF

    RETURN {
        rule_ids: appliedRuleIds,
        dimensions: appliedDims,
        flight_override: flightOverride,
        final_fee: totalSeatFee
    }
End Algorithm
```

---

### THUẬT TOÁN 13: Phân tích Nghiệp vụ Doanh thu & Quản trị Tải Chuyến bay (Analytics & Capacity Intelligence)

- **Mục tiêu:** Cung cấp thông số phân tích doanh thu và kiểm soát tải ghế chuẩn xác, khắc phục toàn bộ các lỗi đếm trùng và thiên lệch thống kê trong quản trị hàng không.
- **Tập tin cài đặt:** [analytics.service.ts](../backend/src/analytics/analytics.service.ts)

#### Các quy tắc tính toán then chốt:
1. **Đếm đơn đặt vé phân biệt (Distinct Booking Count):**
   - Mỗi đơn đặt vé `Booking` được tính là $1$ đơn hàng duy nhất (`bookings_count += 1`), độc lập với số lượng hành khách (`passenger_volume += coupons.length`).
2. **Thời gian đặt trước không bị nhân trọng số (Unweighted Lead Time):**
   - Khoảng cách từ lúc đặt vé đến ngày khởi hành (`lead_time_days = (earliestDeparture - createdAt) / 86400000`) được tính một lần duy nhất cho mỗi đơn đặt vé thay vì nhân lặp theo từng cuống vé.
3. **Doanh thu thuần thực tế từ giao dịch thành công (Truthful Net Revenue):**
   - Được tổng hợp trực tiếp từ mảng `payment_transactions` với trạng thái `SUCCESS` (không giới hạn dưới bằng 0):
   $$\text{net\_revenue\_vnd} = \sum \text{PAYMENT} + \sum \text{RESCHEDULE\_CHARGE} - \sum \text{REFUND} - \sum \text{RESCHEDULE\_REFUND}$$
   - Tách biệt rõ ràng với chỉ số giá trị đặt vé đang hoạt động (`active_booking_value_vnd = \sum (\text{fare\_paid} + \text{seat\_fee})` cho các đơn `CONFIRMED` / `RESCHEDULED`).
4. **Đối soát năng lực ghế vật lý và tồn kho thương mại (Capacity Reconciliation Invariant):**
   ```text
   inventoryReserved = Math.max(0, total_capacity - flight_available_seats)
   confirmedFallback = Math.max(0, inventoryReserved - allocInfo.held)
   occupied = Math.max(allocInfo.confirmed, confirmedFallback)
   held = allocInfo.held
   staffBlocked = allocInfo.staffBlocked // BLOCKED_MAINTENANCE, CREW_REST, VIP_HOLD
   available = Math.max(0, total_capacity - occupied - held - staffBlocked)
   ```
   *Lưu ý:* Ghế khóa nghiệp vụ (`staffBlocked`) chỉ tồn tại ở lớp vật lý `SeatAllocation`, không làm giảm tồn kho thương mại `flight_available_seats`, do đó không bị trừ hai lần.
5. **Hệ số tải chuyến bay chuẩn xác (Physical Load Factor):**
   $$\text{active\_committed} = \text{occupied} + \text{held}$$
   $$\text{load\_factor\_percent} = \text{round}\left(\frac{\text{active\_committed}}{\text{total\_capacity}} \times 1000\right) / 10$$
6. **Ngưỡng tải loại trừ lẫn nhau (Mutually Exclusive Thresholding):**
   - $\text{Load Factor} \ge 80\% \implies \mathbf{HIGH\_LOAD}$
   - $\text{Load Factor} \le 40\% \implies \mathbf{LOW\_LOAD}$
   - $40\% < \text{Load Factor} < 80\% \implies \mathbf{NORMAL}$
   (Chặn hoàn toàn trường hợp một chuyến bay bị phân loại đồng thời vào cả hai nhóm High và Low).

---

### THUẬT TOÁN 14: SAGA Đặt Chỗ Ghế & Tồn Kho Hai Pha (Seat & Inventory Two-Phase SAGA)

- **Mục tiêu:** Quản trị giao dịch hai pha giữa phân bổ ghế vật lý (`SeatAllocation`) và tồn kho chuyến bay (`Flight.inventories`), đảm bảo tính nguyên tử tuyệt đối (ACID) khi tạo đơn đặt vé mới. Nếu bất kỳ bước nào trong chuỗi thao tác thất bại, hệ thống thực thi chuỗi bù trừ (Compensation Rollback) để giải phóng toàn bộ tài nguyên đã giữ.
- **Tập tin cài đặt:** [seat-allocation.service.ts](../backend/src/seat-allocation/seat-allocation.service.ts) & [booking-seat-saga-operation.schema.ts](../backend/src/seat-allocation/booking-seat-saga-operation.schema.ts)

#### Các trạng thái SAGA (`SagaState`):
- `PRECOMMIT`: Khởi tạo thao tác SAGA, ghi nhận danh sách ghế và tồn kho chuẩn bị đột biến.
- `COMMITTED`: Đã trừ tồn kho và tạo bản ghi phân bổ vật lý thành công.
- `COMPLETED`: Đơn đặt vé được lưu hoàn tất trong CSDL.
- `ABORTED`: Thao tác gặp lỗi, toàn bộ tài nguyên được hoàn trả nguyên trạng.

#### Mã giả (Pseudocode):
```text
Algorithm ExecuteBookingSeatSaga(bookingDraft):
    sagaId = GenerateUuid()
    saga = DB.bookingseatsagaoperations.create({
        operation_id: sagaId,
        operation_type: 'CREATE',
        booking_id: bookingDraft._id,
        state: 'PRECOMMIT'
    })

    TRY:
        // Pha 1: Giữ tồn kho thương mại (Inventories)
        FOR EACH leg IN bookingDraft.legs DO:
            res = DB.flights.findOneAndUpdate(
                { _id: leg.flight_id, "inventories._id": leg.inventory_id, "inventories.available_seats": { $gte: leg.count } },
                { $inc: { "inventories.$.available_seats": -leg.count } }
            )
            IF res == NULL THEN THROW ConflictException("Không đủ tồn kho thương mại")
            saga.new_inventory_reservations.append({
                flight_id: leg.flight_id,
                inventory_id: leg.inventory_id,
                seat_count: leg.count,
                mutation_key: leg.mutation_key
            })
        END FOR

        // Pha 2: Giữ ghế vật lý cụ thể (SeatAllocations)
        FOR EACH seat IN bookingDraft.selected_seats DO:
            alloc = DB.seatallocations.create({
                flight_id: seat.flight_id,
                seat_code: seat.seat_code,
                status: 'HELD',
                held_until: bookingDraft.payment_deadline,
                booking_id: bookingDraft._id
            })
            saga.new_seat_allocations.append({ flight_id: seat.flight_id, seat_code: seat.seat_code })
        END FOR

        saga.state = 'COMMITTED'
        DB.bookingseatsagaoperations.save(saga)

        // Hoàn tất lưu Booking
        DB.bookings.save(bookingDraft)
        saga.state = 'COMPLETED'
        saga.completed_at = Now()
        DB.bookingseatsagaoperations.save(saga)

    CATCH error:
        // Chuỗi bù trừ (Compensation Rollback):
        saga.state = 'ABORTED'
        saga.aborted_at = Now()
        saga.error = error.message

        // Khôi phục tồn kho
        FOR EACH inv IN saga.new_inventory_reservations DO:
            DB.flights.updateOne(
                { _id: inv.flight_id, "inventories._id": inv.inventory_id },
                { $inc: { "inventories.$.available_seats": inv.seat_count } }
            )
        END FOR

        // Xóa/giải phóng ghế vật lý
        FOR EACH st IN saga.new_seat_allocations DO:
            DB.seatallocations.deleteOne({ flight_id: st.flight_id, seat_code: st.seat_code, booking_id: bookingDraft._id })
        END FOR

        DB.bookingseatsagaoperations.save(saga)
        THROW error
End Algorithm
```

---

### THUẬT TOÁN 15: Bồi Hoàn & Phục Hồi Tiến Khi Đổi Vé (Reschedule Forward Recovery & Compensation)

- **Mục tiêu:** Xử lý nghiệp vụ đổi chuyến bay (`rescheduleTicket`, bao gồm vé một chiều, khứ hồi và nối chuyến). Đảm bảo hành khách chỉ bị hủy ghế cũ sau khi chuyến bay mới đã được đặt chỗ và thanh toán phụ thu (hoặc ghi nhận hoàn chênh lệch) thành công. Nếu thao tác trên chuyến bay mới thất bại, hệ thống phục hồi tiến (Forward Recovery) bảo lưu 100% cuống vé ban đầu mà không làm mất chỗ của khách.
- **Tập tin cài đặt:** [bookings.service.ts](../backend/src/bookings/bookings.service.ts)

#### Quy trình xử lý nguyên tử:
1. **Kiểm tra hợp lệ:** Chuyến bay cũ chưa khởi hành, vé ở trạng thái `CONFIRMED` hoặc `RESCHEDULED`.
2. **Khóa chặng bay mới:** Thực thi SAGA đặt tồn kho và phân bổ ghế trên chuyến bay mới.
3. **Tính toán chênh lệch giá:**
   $$\Delta_{\text{price}} = \text{Fare}_{\text{new}} - \text{Fare}_{\text{old}}$$
   - $\Delta_{\text{price}} > 0$: Tạo giao dịch `RESCHEDULE_CHARGE` thành công trước khi hoàn tất.
   - $\Delta_{\text{price}} < 0$: Tạo giao dịch `RESCHEDULE_REFUND` (phân bổ theo LIFO).
   - $\Delta_{\text{price}} = 0$: Miễn phụ thu chênh lệch.
4. **Cập nhật cuống vé:** Hủy cuống vé cũ (`CANCELLED`), phát hành cuống vé mới với trạng thái `ACTIVE` và mã số liên kết.
5. **Giải phóng tài nguyên cũ:** Trả lại tồn kho chuyến bay cũ và giải phóng bản ghi `SeatAllocation` cũ.

---

### THUẬT TOÁN 16: Máy Trạng Thái PayPal, Idempotency & Giới Hạn Cổng Thanh Toán (PayPal Order/Capture State Machine)

> [!NOTE]
> **Trạng thái thực thi hiện tại:** `CODE IMPLEMENTED / PRE-SANDBOX; REAL PROVIDER ACCEPTANCE: DEFERRED / NOT EXECUTED`. Tích hợp mã nguồn nội bộ covered by automated PayPal integration/hardening tests, sẵn sàng chạy với Sandbox credentials khi được kích hoạt (`PAYPAL_ENABLED=true`). Hiện tại ở môi trường mặc định, `PAYPAL_ENABLED=false`.

- **Mục tiêu:** Cung cấp máy trạng thái hữu hạn (FSM) quản lý vòng đời phiên thanh toán PayPal (`PayPalCheckoutSession`), bảo đảm tính Idempotency khi gọi API và ngăn chặn thanh toán kép (Double Spending).
- **Tập tin cài đặt:** [paypal.service.ts](../backend/src/paypal/paypal.service.ts) & [paypal-checkout.schema.ts](../backend/src/paypal/paypal-checkout.schema.ts)

#### 11 Trạng thái của Máy trạng thái phiên Checkout (`PayPalCheckoutStatus`):
Hệ thống cài đặt chính xác 11 giá trị enum trong `PayPalCheckoutStatus`:
1. `CREATED`: Đơn hàng đã được khởi tạo trên PayPal API, chờ người dùng phê duyệt trên giao diện PayPal.
2. `CAPTURING`: Người dùng đã phê duyệt, hệ thống đang gửi yêu cầu chụp thanh toán (`captureOrder`).
3. `CAPTURED`: Đã chụp tiền thành công từ tài khoản PayPal của khách hàng.
4. `FINALIZING`: Đang hoàn tất nghiệp vụ nội bộ (tạo booking, xác nhận giữ chỗ, hoặc đổi chuyến bay).
5. `COMPLETED`: Toàn bộ quy trình thanh toán và phát hành/cập nhật vé hoàn tất thành công.
6. `CANCELLED`: Người dùng hủy bỏ quy trình thanh toán trên PayPal UI trước khi capture.
7. `STALE`: Phiên thanh toán hết hạn hoặc bị bỏ dở quá thời hạn cho phép.
8. `PENDING`: Giao dịch thanh toán hoặc hoàn tiền đang chờ provider xử lý bất đồng bộ.
9. `REFUNDED`: Giao dịch đã được hoàn trả lại tiền cho người dùng.
10. `FAILED`: Giao dịch thất bại do thẻ/tài khoản bị từ chối hoặc lỗi từ PayPal.
11. `RECONCILE_REQUIRED`: Sự cố bất thường / timeout nhập nhằng khi capture, yêu cầu quản trị viên đối soát bồi hoàn.

#### Sơ đồ Chuyển dịch Trạng thái (FSM Diagram):
```text
               ┌───────────────── [CREATED] ────────────────┐
               │                     │                      │
       (Hủy thanh toán)       (Khách duyệt &                │ (Hết hạn)
               │                 bắt đầu)                   │
               ▼                     │                      ▼
          [CANCELLED]                ▼                   [STALE]
                                [CAPTURING]
                                     │
                  ┌──────────────────┼──────────────────┐
           (Capture thành công) (Lỗi mạng/Timeout) (Lỗi từ chối)
                  │                  │                  │
                  ▼                  ▼                  ▼
              [CAPTURED]    [RECONCILE_REQUIRED]     [FAILED]
                  │                  │
           (Tạo booking)             │ (Admin đối soát bồi hoàn)
                  │                  ▼
                  ▼              [REFUNDED]
             [FINALIZING]
                  │
        (Lưu DB thành công)
                  │
                  ▼
             [COMPLETED]
```

- **Ràng buộc Idempotency:** Chỉ mục duy nhất hỗn hợp `{ user_id: 1, client_request_id: 1, operation_type: 1 }` chặn mọi yêu cầu thanh toán trùng lặp từ trình duyệt hoặc thiết bị di động.
- **Định dạng Chuỗi Khóa `PayPal-Request-Id` Chuẩn Xác (Deterministic Idempotency Headers):**
  - **Tạo đơn hàng (`createOrder`):** `${clientRequestId}-create`
  - **Chụp thanh toán (`captureOrder`):** `${session.checkout_id}-capture`
  - **Hoàn tiền bồi thường đối soát (`refundCapture`):** `${session.checkout_id}-compensation-refund`
  - **Hoàn tiền phân bổ nguồn LIFO (`refundCapture`):** `${alloc.payment_reference}`

---

### THUẬT TOÁN 17: Phục Hồi Giao Dịch Chụp Nhập Nhằng & Đối Chiếu Bằng Chứng Tỷ Giá (Ambiguous Capture Recovery & Payment Proof FX Parity)

- **Mục tiêu:** Đảm bảo tính toán vẹn tài chính khi tích hợp với cổng thanh toán ngoại tệ (USD):
  1. Xử lý sự cố mạng khi lệnh `capture` trả về lỗi timeout nhưng thực tế đã trừ tiền trên tài khoản PayPal của khách (Ambiguous Capture).
  2. Ràng buộc đối soát tỷ giá 1:1 (`assertPayPalPaymentProof`): Số tiền quy đổi USD từ số tiền chuẩn VND phải khớp chính xác với kết quả ghi nhận tại cổng thanh toán.
- **Tập tin cài đặt:** [bookings.service.ts](../backend/src/bookings/bookings.service.ts) (`assertPayPalPaymentProof`) & [paypal.controller.ts](../backend/src/paypal/paypal.controller.ts)

#### Công thức đối chiếu bằng chứng thanh toán (`assertPayPalPaymentProof`):
$$\text{Expected USD} = \left(\text{Math.round}\left(\frac{\text{Authoritative Amount VND}}{\text{Exchange Rate}}\right) \times 100 / 100\right)\text{.toFixed(2)}$$
1. `proof.payment_method === 'PAYPAL'`.
2. `proof.status === 'SUCCESS'`.
3. `proof.expected_amount_vnd === authoritativeAmountVnd`.
4. `proof.provider_currency === 'USD'`.
5. `proof.provider_amount === expectedUsd`.
6. Tồn tại đầy đủ `provider_order_id` và `provider_capture_id`.

#### Cơ chế phục hồi giao dịch nhập nhằng (Ambiguous Capture Recovery):
Khi một phiên thanh toán rơi vào trạng thái `RECONCILE_REQUIRED`:
1. Quản trị viên kích hoạt đối soát tại endpoint `/paypal/admin/checkouts/:checkoutId/reconcile-compensation`.
2. Hệ thống kiểm tra trước trên PayPal API: Nếu `provider_refund_id` đã tồn tại, kiểm tra chi tiết trạng thái qua `getRefundDetails` thay vì gửi lại yêu cầu hoàn tiền mới.
3. Nếu chưa hoàn tiền, thực hiện `refundCapture` với khóa Idempotency duy nhất `{checkout_id}-compensation-refund`.

---

### THUẬT TOÁN 18: Hoàn Tiền Bồi Thường & Phân Bổ Nguồn Hoàn LIFO (Compensation Refund & LIFO Source Allocation)

- **Mục tiêu:** Khi khách hàng hủy vé hoặc đổi sang chuyến bay có giá thấp hơn, hệ thống phân bổ số tiền hoàn theo thứ tự LIFO (Last-In, First-Out) ngược lại các giao dịch thu tiền trước đó (`PAYMENT`, `RESCHEDULE_CHARGE`). Đảm bảo bảo toàn thông tin nguồn gốc cổng thanh toán (Payment Provenance), không hoàn vượt số dư thực thu và giữ nguyên thẻ/mã giao dịch gốc.
- **Tập tin cài đặt:** [refund-allocation.util.ts](../backend/src/bookings/refund-allocation.util.ts) (`allocateRefundSources`)

#### Thuật toán phân bổ LIFO:
```text
Algorithm AllocateRefundSources(transactions, targetRefundVnd, transactionType):
    charges = FilterAndSortChronological(transactions, ['PAYMENT', 'RESCHEDULE_CHARGE'])
    allocatedRefunds = []
    remainingRefundNeeded = targetRefundVnd

    // Duyệt ngược thời gian (LIFO) từ khoản thu gần nhất
    FOR EACH charge IN charges.reverse() DO:
        IF remainingRefundNeeded <= 0 THEN BREAK

        // Tính số dư còn có thể hoàn của khoản thu này (trừ các khoản REFUND đã thực hiện hoặc đang PENDING)
        alreadyRefunded = SumRefundsLinkedTo(charge.payment_reference)
        refundableOnThisCharge = charge.amount - alreadyRefunded

        IF refundableOnThisCharge <= 0 THEN CONTINUE

        refundVnd = Min(remainingRefundNeeded, refundableOnThisCharge)

        // Tạo bản ghi hoàn tiền kế thừa đầy đủ provenance của charge gốc
        refundItem = {
            payment_reference: GenerateReference('REF'),
            source_payment_reference: charge.payment_reference,
            transaction_type: transactionType,
            payment_method: charge.payment_method,
            amount: refundVnd,
            currency: 'VND',
            card_masked: charge.card_masked,
            provider_capture_id: charge.provider_capture_id,
            provider_order_id: charge.provider_order_id,
            status: 'SUCCESS'
        }

        // Nếu là giao dịch PayPal, tính toán chính xác phần ngoại tệ USD tương ứng
        IF charge.payment_method == 'PAYPAL' THEN:
            refundItem.provider_currency = charge.provider_currency
            refundItem.exchange_rate_vnd_per_unit = charge.exchange_rate_vnd_per_unit
            refundItem.provider_amount = (round((refundVnd / charge.exchange_rate_vnd_per_unit) * 100) / 100).toFixed(2)
        END IF

        allocatedRefunds.append(refundItem)
        remainingRefundNeeded -= refundVnd
    END FOR

    RETURN allocatedRefunds
End Algorithm
```

---

### THUẬT TOÁN 19: Tự Động Thử Lại & Đối Soát Hoàn Tiền Treo/Thất Bại (Pending & Failed Refund Reconciliation Engine)

- **Mục tiêu:** Xử lý các giao dịch hoàn tiền gặp sự cố mạng hoặc phía cổng thanh toán phản hồi trạng thái `PENDING`. Scheduler định kỳ kiểm tra trạng thái trên nhà cung cấp và tự động chuyển đổi thành `SUCCESS` khi nhà cung cấp hoàn tất, hoặc kích hoạt thử lại có kiểm soát (với giới hạn số lần thử lại tối đa).
- **Tập tin cài đặt:** [paypal-refund.scheduler.ts](../backend/src/paypal/paypal-refund.scheduler.ts) & [paypal-refund.validator.ts](../backend/src/paypal/paypal-refund.validator.ts)

#### Quy tắc vận hành:
1. **Kiểm tra trước khi gửi lại (Pre-check Rule):** Nếu giao dịch đã có `provider_refund_id`, hệ thống TUYỆT ĐỐI KHÔNG gọi API hoàn tiền lần hai mà chỉ truy vấn đối soát trạng thái (`getRefundDetails`).
2. **Phân loại trạng thái chuẩn (`classifyPayPalRefundStatus`):**
   - `COMPLETED` $\implies$ Chuyển thành `SUCCESS`.
   - `PENDING` $\implies$ Giữ nguyên trạng thái `PENDING`, lên lịch kiểm tra tiếp theo (`next_retry_at`).
   - `FAILED`, `CANCELLED` $\implies$ Ghi nhận lỗi và báo cáo màn hình quản trị viên.
3. **Báo cáo sự cố minh bạch:** Cung cấp API `/paypal/admin/reconciliation` tổng hợp toàn bộ các phiên checkout và giao dịch hoàn tiền có vấn đề để quản trị viên can thiệp xử lý.

---

### THUẬT TOÁN 20: Khám Phá Mạng Lưới & Vật Hóa Lịch Bay Thương Mại 330 Ngày (Commercial Route Discovery & 330-Day Schedule Materialization)

- **Mục tiêu:** Cung cấp kiến trúc tạo và duy trì mạng lưới đường bay thương mại hoàn chỉnh của hãng:
  1. Khám phá và đồng bộ tuyến bay từ AirLabs API (`AirLabsCommercialService`).
  2. Tạo mẫu lịch bay định kỳ (`ScheduleTemplate`) cho từng đường bay với tần suất và khung giờ linh hoạt.
  3. Vật hóa (Materialization Engine) lịch bay liên tục 330 ngày trong tương lai (`FlightGeneratorService`), tự động phân bổ máy bay từ Catalog 6 dòng tàu bay, khởi tạo cấu hình khoang ghế và biểu giá cơ sở VND.
- **Tập tin cài đặt:** [airlabs-commercial.service.ts](../backend/src/flights/airlabs-commercial.service.ts) & [flight-generator.service.ts](../backend/src/flights/flight-generator.service.ts)

#### Quy trình vật hóa lịch bay:
1. Duyệt qua toàn bộ danh sách `ScheduleTemplate` đang kích hoạt (`is_active = true`).
2. Với mỗi ngày trong khoảng từ $T_{\text{today}}$ đến $T_{\text{today}} + 330\text{ ngày}$, kiểm tra xem ngày đó có khớp với các ngày trong tuần được thiết lập trong mẫu lịch (`days_of_week`) hay không.
3. Nếu chưa tồn tại chuyến bay cho mẫu lịch và ngày đó, tiến hành sinh bản ghi `Flight` mới với:
   - Số hiệu chuyến bay chuẩn: Ghép mã IATA hãng và số hiệu mẫu (VD: `AP-101`).
   - Cấu hình tàu bay tự động gán từ Catalog đội bay.
   - Các khoang vé (`Economy`, `Business`) với số ghế khả dụng và biểu giá cơ sở tương ứng.
   - Khoảng cách bay tính bằng thuật toán Great-Circle Haversine (`calculateGreatCircleMiles`).
