import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flight, FlightDocument, FlightStatus } from './flights.schema';
import {
  CreateFlightDto,
  SearchFlightDto,
  UpdateFlightDto,
  UpdateFlightStatusDto,
} from './flights.dto';
import { AirportsService } from '../airports/airports.service';
import { Booking, BookingDocument } from '../bookings/bookings.schema';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private readonly airportsService: AirportsService,
  ) {}

  async findAll(status?: FlightStatus, origin?: string, dest?: string): Promise<Flight[]> {
    const filter: any = {};
    if (status) filter.status = status;
    if (origin) filter.origin_iata = origin.toUpperCase();
    if (dest) filter.dest_iata = dest.toUpperCase();
    return this.flightModel.find(filter).sort({ scheduled_departure: 1 }).exec();
  }

  async findById(id: string): Promise<FlightDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid flight ID format');
    }
    const flight = await this.flightModel.findById(id).exec();
    if (!flight) {
      throw new NotFoundException(`Flight with ID ${id} not found`);
    }
    return flight;
  }

  async create(createFlightDto: CreateFlightDto): Promise<FlightDocument> {
    // Validate IATAs
    await this.airportsService.findByIata(createFlightDto.origin_iata);
    await this.airportsService.findByIata(createFlightDto.dest_iata);

    const created = new this.flightModel({
      ...createFlightDto,
      origin_iata: createFlightDto.origin_iata.toUpperCase(),
      dest_iata: createFlightDto.dest_iata.toUpperCase(),
      status: FlightStatus.SCHEDULED,
    });
    return created.save();
  }

  async update(id: string, updateFlightDto: UpdateFlightDto): Promise<FlightDocument> {
    const flight = await this.findById(id);

    if (updateFlightDto.flight_number) flight.flight_number = updateFlightDto.flight_number;
    if (updateFlightDto.departure_date) flight.departure_date = updateFlightDto.departure_date;
    if (updateFlightDto.scheduled_departure) flight.scheduled_departure = new Date(updateFlightDto.scheduled_departure);
    if (updateFlightDto.scheduled_arrival) flight.scheduled_arrival = new Date(updateFlightDto.scheduled_arrival);
    if (updateFlightDto.duration_minutes !== undefined) flight.duration_minutes = updateFlightDto.duration_minutes;
    if (updateFlightDto.distance_miles !== undefined) flight.distance_miles = updateFlightDto.distance_miles;
    if (updateFlightDto.status) flight.status = updateFlightDto.status;
    if (updateFlightDto.delay_reason !== undefined) flight.delay_reason = updateFlightDto.delay_reason;
    if (updateFlightDto.inventories) flight.inventories = updateFlightDto.inventories as any;

    return flight.save();
  }

  async updateStatus(id: string, dto: UpdateFlightStatusDto): Promise<FlightDocument> {
    const flight = await this.findById(id);
    flight.status = dto.status;
    if (dto.delay_reason !== undefined) flight.delay_reason = dto.delay_reason;
    if (dto.actual_departure) flight.actual_departure = new Date(dto.actual_departure);
    if (dto.actual_arrival) flight.actual_arrival = new Date(dto.actual_arrival);
    return flight.save();
  }

  async delete(id: string): Promise<{ message: string }> {
    await this.findById(id);
    await this.flightModel.findByIdAndDelete(id).exec();
    return { message: `Flight with ID ${id} deleted successfully` };
  }

  // Atomically decrement or increment available seats
  async updateAvailableSeats(
    flightId: string,
    inventoryId: string,
    seatCountChange: number, // Negative to reserve/block, positive to release/cancel
  ): Promise<boolean> {
    const flight = await this.findById(flightId);
    const inv = flight.inventories.find(
      (i: any) => i._id.toString() === inventoryId || i.id === inventoryId,
    );
    if (!inv) {
      throw new NotFoundException(`Inventory with ID ${inventoryId} not found on flight`);
    }

    if (seatCountChange < 0 && inv.available_seats < Math.abs(seatCountChange)) {
      throw new BadRequestException(`Not enough available seats in ${inv.cabin_class}. Only ${inv.available_seats} left.`);
    }

    inv.available_seats += seatCountChange;
    await flight.save();
    return true;
  }

  /**
   * Requirement 3.3: Advanced Flight Search & Route Selection Algorithm
   */
  async searchFlights(dto: SearchFlightDto): Promise<{
    origin_info: any;
    dest_info: any;
    is_round_trip: boolean;
    passenger_breakdown: { adults: number; children: number; seniors: number; total: number };
    onward_flights: any[];
    return_flights?: any[];
    connecting_routes?: any[]; // Intermediate stopover suggestions if direct not available
  }> {
    const adults = Number(dto.adults) || 1;
    const children = Number(dto.children) || 0;
    const seniors = Number(dto.seniors) || 0;
    const totalPassengers = adults + children + seniors;

    // 1. Validate dates (Requirement 3.3.4)
    if (dto.return_date && dto.return_date < dto.departure_date) {
      throw new BadRequestException('Return date cannot be earlier than departure date');
    }

    // 2. Resolve origin and destination
    const originResolve = await this.airportsService.resolveCity(dto.origin);
    const destResolve = await this.airportsService.resolveCity(dto.destination);

    const originIata = originResolve.exactMatches[0]?.iata_code || dto.origin.toUpperCase();
    const destIata = destResolve.exactMatches[0]?.iata_code || dto.destination.toUpperCase();

    // 3. Search Direct Flights for Onward Trip
    const onwardDirect = await this.findDirectFlights(
      originIata,
      destIata,
      dto.departure_date,
      dto.departure_date_end,
      dto.cabin_class,
      dto.is_smoking,
      totalPassengers,
      adults,
      children,
      seniors,
    );

    let connectingRoutes: any[] = [];
    // Requirement 3.3.1: If no direct operational service, use Route Selection Algorithm
    if (onwardDirect.length === 0) {
      connectingRoutes = await this.findConnectingRoutes(
        originIata,
        destIata,
        dto.departure_date,
        totalPassengers,
        adults,
        children,
        seniors,
      );
    }

    // 4. If Round Trip requested, search Return Flights
    let returnFlights: any[] | undefined = undefined;
    if (dto.return_date) {
      returnFlights = await this.findDirectFlights(
        destIata,
        originIata,
        dto.return_date,
        undefined,
        dto.cabin_class,
        dto.is_smoking,
        totalPassengers,
        adults,
        children,
        seniors,
      );
    }

    return {
      origin_info: {
        query: dto.origin,
        resolved_iata: originIata,
        nearest_suggestion: originResolve.nearestSuggestion,
      },
      dest_info: {
        query: dto.destination,
        resolved_iata: destIata,
        nearest_suggestion: destResolve.nearestSuggestion,
      },
      is_round_trip: !!dto.return_date,
      passenger_breakdown: { adults, children, seniors, total: totalPassengers },
      onward_flights: onwardDirect,
      return_flights: returnFlights,
      connecting_routes: connectingRoutes,
    };
  }

  private async findDirectFlights(
    origin: string,
    dest: string,
    departureDate: string,
    departureDateEnd: string | undefined,
    cabinClass?: string,
    isSmoking?: boolean,
    totalPassengers = 1,
    adults = 1,
    children = 0,
    seniors = 0,
  ) {
    const filter: any = {
      origin_iata: origin,
      dest_iata: dest,
      status: { $ne: FlightStatus.CANCELLED },
    };

    if (departureDateEnd) {
      filter.departure_date = { $gte: departureDate, $lte: departureDateEnd };
    } else {
      filter.departure_date = departureDate;
    }

    const flights = await this.flightModel.find(filter).sort({ scheduled_departure: 1 }).exec();

    const formattedResults: any[] = [];
    for (const fl of flights) {
      for (const inv of fl.inventories) {
        if (cabinClass && inv.cabin_class !== cabinClass) continue;
        if (isSmoking !== undefined && inv.is_smoking !== isSmoking) continue;
        if (inv.available_seats < totalPassengers) continue;

        // Pricing calculation:
        // Adults 100%, Children 75%, Seniors 85%
        const adultPrice = inv.base_price;
        const childPrice = Math.round(inv.base_price * 0.75);
        const seniorPrice = Math.round(inv.base_price * 0.85);
        const totalPartyPrice =
          adults * adultPrice + children * childPrice + seniors * seniorPrice;

        formattedResults.push({
          flight_id: fl._id,
          flight_number: fl.flight_number,
          origin_iata: fl.origin_iata,
          dest_iata: fl.dest_iata,
          departure_date: fl.departure_date,
          scheduled_departure: fl.scheduled_departure,
          scheduled_arrival: fl.scheduled_arrival,
          duration_minutes: fl.duration_minutes,
          distance_miles: fl.distance_miles,
          status: fl.status,
          delay_reason: fl.delay_reason,
          aircraft: fl.aircraft,
          inventory_id: (inv as any)._id,
          cabin_class: inv.cabin_class,
          is_smoking: inv.is_smoking,
          available_seats: inv.available_seats,
          base_price_per_adult: adultPrice,
          total_party_price: totalPartyPrice,
        });
      }
    }
    return formattedResults;
  }

  /**
   * Route Selection Algorithm:
   * Finds intermediate transit airports T where Origin -> T and T -> Destination both have flights
   */
  private async findConnectingRoutes(
    origin: string,
    dest: string,
    departureDate: string,
    totalPassengers: number,
    adults: number,
    children: number,
    seniors: number,
  ): Promise<any[]> {
    const leg1Flights = await this.flightModel
      .find({
        origin_iata: origin,
        departure_date: departureDate,
        status: { $ne: FlightStatus.CANCELLED },
      })
      .exec();

    const connectingOptions: any[] = [];

    for (const leg1 of leg1Flights) {
      const transitIata = leg1.dest_iata;
      if (transitIata === dest) continue;

      // Find leg 2 from transit to dest
      const leg2Flights = await this.flightModel
        .find({
          origin_iata: transitIata,
          dest_iata: dest,
          departure_date: departureDate,
          scheduled_departure: { $gt: leg1.scheduled_arrival }, // Must depart after leg 1 arrives
          status: { $ne: FlightStatus.CANCELLED },
        })
        .exec();

      for (const leg2 of leg2Flights) {
        // Layover duration in minutes
        const layoverMinutes = Math.round(
          (new Date(leg2.scheduled_departure).getTime() - new Date(leg1.scheduled_arrival).getTime()) / 60000,
        );

        if (layoverMinutes >= 45 && layoverMinutes <= 720) {
          // Valid transit connection (45 mins to 12 hours)
          connectingOptions.push({
            route_type: 'CONNECTING',
            transit_airport: transitIata,
            total_duration_minutes: leg1.duration_minutes + layoverMinutes + leg2.duration_minutes,
            layover_minutes: layoverMinutes,
            leg1: {
              flight_id: leg1._id,
              flight_number: leg1.flight_number,
              origin_iata: leg1.origin_iata,
              dest_iata: leg1.dest_iata,
              departure: leg1.scheduled_departure,
              arrival: leg1.scheduled_arrival,
              inventories: leg1.inventories.filter((i) => i.available_seats >= totalPassengers),
            },
            leg2: {
              flight_id: leg2._id,
              flight_number: leg2.flight_number,
              origin_iata: leg2.origin_iata,
              dest_iata: leg2.dest_iata,
              departure: leg2.scheduled_departure,
              arrival: leg2.scheduled_arrival,
              inventories: leg2.inventories.filter((i) => i.available_seats >= totalPassengers),
            },
          });
        }
      }
    }

    return connectingOptions;
  }

  /**
   * Mô phỏng sơ đồ ghế ngồi chuẩn hàng không (Vietjet / Airbus A321)
   * Phân loại:
   * - Hàng 1 - 5: Hàng ghế ĐẶC BIỆT (Skyboss/Thương gia) - Màu đỏ
   * - Hàng 6 - 11: Hàng ghế TIÊU CHUẨN - Màu xanh lá
   * - Hàng 12, 14: Hàng ghế LỐI THOÁT HIỂM (Chỗ để chân rộng) - Màu xanh dương (bỏ qua hàng 13)
   * - Hàng 15 - 31: Hàng ghế TIÊU CHUẨN - Màu xanh lá
   * - Ghế đã bị đặt: Màu xám / Đỏ dấu X (is_occupied = true)
   */
  async getSeatMap(flightId: string) {
    const flight = await this.findById(flightId);

    // Lấy danh sách ghế đã được đặt trong DB
    const bookings = await this.bookingModel
      .find({
        'ticket_coupons.flight_id': flight._id,
        status: { $ne: 'CANCELLED' },
      })
      .exec();

    const occupiedSet = new Set<string>();
    for (const b of bookings) {
      for (const coupon of b.ticket_coupons) {
        if (coupon.flight_id.toString() === flight._id.toString() && coupon.seat_code) {
          occupiedSet.add(coupon.seat_code.toUpperCase());
        }
      }
    }

    // Ghế chỉ bị chiếm khi có hành khách thực tế đã đặt chỗ trong Database
    const columns = ['A', 'B', 'C', 'D', 'E', 'F'];
    const totalRows = 31;
    const exitRows = [12, 14];
    const specialRows = [1, 2, 3, 4, 5];
    const skippedRows = [13]; // Chuẩn hàng không quốc tế bỏ qua hàng 13

    const rows: any[] = [];

    for (let r = 1; r <= totalRows; r++) {
      if (skippedRows.includes(r)) continue;

      const isExit = exitRows.includes(r);
      const isSpecial = specialRows.includes(r);

      const seats = columns.map((col) => {
        const seatCode = `${r}${col}`;
        let type: 'SPECIAL' | 'EXIT_ROW' | 'STANDARD' = 'STANDARD';
        let typeLabel = 'Còn trống';
        let fee = 0;
        let cabinClass = 'ECONOMY';

        if (isSpecial) {
          type = 'SPECIAL';
          typeLabel = 'Đặc biệt';
          fee = 15; // 15 USD / 150.000đ
          cabinClass = 'BUSINESS';
        } else if (isExit) {
          type = 'EXIT_ROW';
          typeLabel = 'Hàng ghế gần lối thoát hiểm';
          fee = 10; // 10 USD / 100.000đ
          cabinClass = 'ECONOMY';
        }

        const isOccupied = occupiedSet.has(seatCode);

        return {
          seat_code: seatCode,
          row: r,
          column: col,
          type,
          type_label: typeLabel,
          cabin_class: cabinClass,
          fee,
          is_occupied: isOccupied,
          is_exit_row: isExit,
          is_special: isSpecial,
        };
      });

      rows.push({
        row_number: r,
        is_exit_row: isExit,
        is_special: isSpecial,
        seats,
      });
    }

    return {
      flight_id: flight._id,
      flight_number: flight.flight_number,
      route: `${flight.origin_iata} - ${flight.dest_iata}`,
      aircraft_model: flight.aircraft?.model_name || 'Airbus A321',
      departure_time: flight.scheduled_departure,
      legend: [
        { type: 'AVAILABLE', label: 'Còn trống', color: '#22c55e', bg: 'bg-green-500' },
        { type: 'SELECTED', label: 'Đã chọn', color: '#eab308', bg: 'bg-yellow-400' },
        { type: 'EXIT_ROW', label: 'Hàng ghế gần lối thoát hiểm', color: '#3b82f6', bg: 'bg-blue-500' },
        { type: 'SPECIAL', label: 'Đặc biệt', color: '#ef4444', bg: 'bg-red-500' },
        { type: 'OCCUPIED', label: 'Đã bị chọn / không có', color: '#9ca3af', bg: 'bg-gray-400' },
      ],
      notice: {
        skyboss_benefit: 'Với vé Skyboss, quý khách được chọn chỗ ngồi miễn phí.',
        exit_row_warning:
          'Chúng tôi không đảm bảo cung cấp đúng chỗ ngồi lối thoát hiểm đã quý khách đặt trước và chỗ này có thể thay đổi mà không cần thông báo. Chỗ ngồi lối thoát hiểm (hàng ghế 12 và 14) chỉ có thể sắp xếp cho những hành khách người lớn và có khả năng hỗ trợ hành khách khác trong trường hợp khẩn cấp. Xin lưu ý rằng hành khách bị hạn chế về khả năng nghe nhìn, hành khách tàn tật hoặc hành khách đi kèm trẻ nhỏ không được phép ngồi chỗ này.',
      },
      layout: {
        left_columns: ['A', 'B', 'C'],
        right_columns: ['D', 'E', 'F'],
        exit_rows: exitRows,
        special_rows: specialRows,
        skipped_rows: skippedRows,
      },
      rows,
    };
  }

  /**
   * Đồng bộ chuyến bay thật từ AirLabs API (airlabs.co)
   * @param depIata Mã sân bay đi (VD: 'HAN')
   * @param arrIata Mã sân bay đến (VD: 'SGN')
   * @param customApiKey API Key do người dùng truyền vào (nếu không dùng file .env)
   */
  async syncFromAirLabs(
    depIata: string,
    arrIata: string,
    customApiKey?: string,
  ): Promise<{
    message: string;
    synchronized_count: number;
    flights: any[];
  }> {
    const apiKey = customApiKey || process.env.AIRLABS_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'Chưa có AirLabs API Key! Vui lòng điền AIRLABS_API_KEY trong file .env hoặc truyền tham số api_key vào request.',
      );
    }

    const origin = (depIata || 'HAN').toUpperCase();
    const dest = (arrIata || 'SGN').toUpperCase();

    // Đảm bảo sân bay đã có trong CSDL
    try {
      await this.airportsService.findByIata(origin);
      await this.airportsService.findByIata(dest);
    } catch (e) {
      throw new BadRequestException(`Sân bay ${origin} hoặc ${dest} chưa được định nghĩa trong hệ thống.`);
    }

    const url = `https://airlabs.co/api/v9/schedules?dep_iata=${origin}&arr_iata=${dest}&api_key=${apiKey}`;

    let responseData: any;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`AirLabs API trả về HTTP mã ${res.status}`);
      }
      responseData = await res.json();
    } catch (err: any) {
      throw new BadRequestException(`Không thể kết nối tới AirLabs API: ${err.message}`);
    }

    if (responseData.error) {
      throw new BadRequestException(`Lỗi từ AirLabs: ${responseData.error.message || JSON.stringify(responseData.error)}`);
    }

    const schedules = responseData.response || [];
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return {
        message: `Không tìm thấy chuyến bay nào giữa ${origin} và ${dest} trên AirLabs trong khung giờ hiện tại.`,
        synchronized_count: 0,
        flights: [],
      };
    }

    const savedFlights: any[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const item of schedules) {
      const flightNumber =
        item.flight_iata ||
        `${item.airline_iata || 'FL'}${item.flight_number || Math.floor(100 + Math.random() * 900)}`;

      const depTime = item.dep_time
        ? new Date(item.dep_time)
        : new Date(Date.now() + 2 * 60 * 60 * 1000);
      const arrTime = item.arr_time
        ? new Date(item.arr_time)
        : new Date(depTime.getTime() + (item.duration || 120) * 60 * 1000);
      const departureDate = item.dep_time ? item.dep_time.split(' ')[0] : today;

      const durationMinutes =
        item.duration ||
        Math.round((arrTime.getTime() - depTime.getTime()) / 60000) ||
        120;
      const aircraftModel = item.aircraft_icao || 'A321';

      // Cấu hình khoang vé chuẩn cho chuyến bay thật được đồng bộ về
      const inventories = [
        {
          cabin_class: 'ECONOMY',
          is_smoking: false,
          bucket_code: 'Y',
          base_price: 95,
          allocated_seats: 140,
          available_seats: 140,
        },
        {
          cabin_class: 'BUSINESS',
          is_smoking: false,
          bucket_code: 'J',
          base_price: 240,
          allocated_seats: 30,
          available_seats: 30,
        },
        {
          cabin_class: 'FIRST',
          is_smoking: false,
          bucket_code: 'F',
          base_price: 420,
          allocated_seats: 10,
          available_seats: 10,
        },
      ];

      // Upsert: Cập nhật nếu đã có cùng flight_number và departure_date, tạo mới nếu chưa có
      let flight = await this.flightModel
        .findOne({
          flight_number: flightNumber,
          departure_date: departureDate,
        })
        .exec();

      const flightStatus =
        item.status === 'cancelled'
          ? FlightStatus.CANCELLED
          : item.delayed
            ? FlightStatus.DELAYED
            : FlightStatus.SCHEDULED;
      const delayReason = item.delayed ? `Chuyến bay trễ ${item.delayed} phút` : '';

      if (flight) {
        flight.scheduled_departure = depTime;
        flight.scheduled_arrival = arrTime;
        flight.duration_minutes = durationMinutes;
        flight.status = flightStatus;
        flight.delay_reason = delayReason;
        flight.aircraft = {
          model_code: aircraftModel,
          model_name: `Airbus ${aircraftModel}`,
          total_capacity: 180,
        };
        await flight.save();
      } else {
        flight = new this.flightModel({
          flight_number: flightNumber,
          origin_iata: origin,
          dest_iata: dest,
          departure_date: departureDate,
          scheduled_departure: depTime,
          scheduled_arrival: arrTime,
          duration_minutes: durationMinutes,
          distance_miles: 720,
          status: flightStatus,
          delay_reason: delayReason,
          aircraft: {
            model_code: aircraftModel,
            model_name: `Airbus ${aircraftModel}`,
            total_capacity: 180,
          },
          inventories,
        });
        await flight.save();
      }

      savedFlights.push(flight);
    }

    return {
      message: `Đã đồng bộ thành công ${savedFlights.length} chuyến bay thật từ AirLabs!`,
      synchronized_count: savedFlights.length,
      flights: savedFlights,
    };
  }
}
