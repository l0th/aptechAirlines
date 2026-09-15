import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from '../users/users.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
import {
  CabinClass,
  Flight,
  FlightDocument,
  FlightStatus,
} from '../flights/flights.schema';
import {
  CancellationPolicy,
  PolicyDocument,
} from '../policies/policies.schema';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
    @InjectModel(Flight.name) private flightModel: Model<FlightDocument>,
    @InjectModel(CancellationPolicy.name) private policyModel: Model<PolicyDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedSuperAdmin();
    await this.seedAirports();
    await this.seedPolicies();
    await this.seedSampleFlights();
  }

  // 1. Seed the ONLY immutable SUPER_ADMIN
  private async seedSuperAdmin() {
    const existingSuperAdmin = await this.userModel.findOne({ role: UserRole.SUPER_ADMIN }).exec();
    if (!existingSuperAdmin) {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(
        process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026',
        salt,
      );

      const superAdmin = new this.userModel({
        username: process.env.SUPER_ADMIN_USERNAME || 'superadmin',
        password_hash,
        first_name: process.env.SUPER_ADMIN_FIRST_NAME || 'System',
        last_name: process.env.SUPER_ADMIN_LAST_NAME || 'SuperAdmin',
        email: (process.env.SUPER_ADMIN_EMAIL || 'superadmin@airline.com').toLowerCase(),
        address: 'Headquarters, 100 Airline Blvd',
        phone_number: '+84999888777',
        sex: 'MALE',
        age: 35,
        preferred_credit_card: '4111222233334444',
        sky_miles: 99999,
        role: UserRole.SUPER_ADMIN,
      });

      await superAdmin.save();
      this.logger.log('✅ Unique SUPER_ADMIN created successfully: username=superadmin');
    } else {
      this.logger.log('ℹ️ SUPER_ADMIN already exists in database.');
    }
  }

  // 2. Seed Airports & Cities (including nearest unserviced city for Requirement 3.3.1)
  private async seedAirports() {
    const count = await this.airportModel.countDocuments().exec();
    if (count === 0) {
      const airports = [
        {
          iata_code: 'HAN',
          city_name: 'Ha Noi',
          airport_name: 'Noi Bai International Airport',
          is_serviced_directly: true,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
        {
          iata_code: 'SGN',
          city_name: 'Ho Chi Minh',
          airport_name: 'Tan Son Nhat International Airport',
          is_serviced_directly: true,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
        {
          iata_code: 'DAD',
          city_name: 'Da Nang',
          airport_name: 'Da Nang International Airport',
          is_serviced_directly: true,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
        {
          iata_code: 'CXR',
          city_name: 'Nha Trang',
          airport_name: 'Cam Ranh International Airport',
          is_serviced_directly: true,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
        {
          iata_code: 'PQC',
          city_name: 'Phu Quoc',
          airport_name: 'Phu Quoc International Airport',
          is_serviced_directly: true,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
        // Unserviced City example (Requirement 3.3.1): Hoi An -> suggests nearest Da Nang (DAD) at 30km
        {
          iata_code: 'HOI',
          city_name: 'Hoi An',
          airport_name: 'Hoi An Town Heliport',
          is_serviced_directly: false,
          nearest_airport_code: 'DAD',
          distance_to_nearest_km: 30.0,
          time_zone: 'Asia/Ho_Chi_Minh',
        },
      ];

      await this.airportModel.insertMany(airports);
      this.logger.log(`✅ Seeded ${airports.length} airports and cities.`);
    }
  }

  // 3. Seed Cancellation Policies (Requirement 3.3.4 & 3.7)
  private async seedPolicies() {
    const count = await this.policyModel.countDocuments().exec();
    if (count === 0) {
      const policies = [
        {
          min_days_before: 30,
          max_days_before: null,
          refund_percentage: 90,
          description: 'Hủy trước ngày khởi hành trên 30 ngày: hoàn 90% giá vé',
        },
        {
          min_days_before: 15,
          max_days_before: 29,
          refund_percentage: 75,
          description: 'Hủy từ 15 đến 29 ngày trước ngày bay: hoàn 75% giá vé',
        },
        {
          min_days_before: 7,
          max_days_before: 14,
          refund_percentage: 50,
          description: 'Hủy từ 7 đến 14 ngày trước ngày bay: hoàn 50% giá vé',
        },
        {
          min_days_before: 0,
          max_days_before: 6,
          refund_percentage: 0,
          description: 'Hủy trong vòng 6 ngày trước ngày bay: không hoàn tiền (0%)',
        },
      ];

      await this.policyModel.insertMany(policies);
      this.logger.log(`✅ Seeded ${policies.length} cancellation policies.`);
    }
  }

  // 4. Seed Sample Flights for both immediate buy (< 14 days) and blocking (> 14 days)
  private async seedSampleFlights() {
    const count = await this.flightModel.countDocuments().exec();
    if (count === 0) {
      const today = new Date();

      const getDateStr = (offsetDays: number) => {
        const d = new Date(today.getTime() + offsetDays * 24 * 60 * 60 * 1000);
        return d.toISOString().split('T')[0];
      };

      const getDateTime = (offsetDays: number, hours: number, minutes: number) => {
        const d = new Date(today.getTime() + offsetDays * 24 * 60 * 60 * 1000);
        d.setHours(hours, minutes, 0, 0);
        return d;
      };

      const datePlus3Days = getDateStr(3);
      const datePlus20Days = getDateStr(20);
      const datePlus25Days = getDateStr(25);

      const sampleFlights = [
        // Flight 1: 20 days ahead (eligible for BLOCKING or BUYING!)
        {
          flight_number: 'VN101',
          origin_iata: 'HAN',
          dest_iata: 'SGN',
          departure_date: datePlus20Days,
          scheduled_departure: getDateTime(20, 8, 30),
          scheduled_arrival: getDateTime(20, 10, 45),
          duration_minutes: 135,
          distance_miles: 720,
          status: FlightStatus.SCHEDULED,
          aircraft: { model_code: 'A321', model_name: 'Airbus A321 Neo', total_capacity: 180 },
          inventories: [
            {
              cabin_class: CabinClass.ECONOMY,
              is_smoking: false,
              bucket_code: 'Y',
              base_price: 100,
              allocated_seats: 120,
              available_seats: 120,
            },
            {
              cabin_class: CabinClass.BUSINESS,
              is_smoking: false,
              bucket_code: 'J',
              base_price: 250,
              allocated_seats: 30,
              available_seats: 30,
            },
            {
              cabin_class: CabinClass.FIRST,
              is_smoking: false,
              bucket_code: 'F',
              base_price: 450,
              allocated_seats: 10,
              available_seats: 10,
            },
          ],
        },
        // Flight 2: Return flight 25 days ahead (for round-trip!)
        {
          flight_number: 'VN102',
          origin_iata: 'SGN',
          dest_iata: 'HAN',
          departure_date: datePlus25Days,
          scheduled_departure: getDateTime(25, 14, 0),
          scheduled_arrival: getDateTime(25, 16, 15),
          duration_minutes: 135,
          distance_miles: 720,
          status: FlightStatus.SCHEDULED,
          aircraft: { model_code: 'A321', model_name: 'Airbus A321 Neo', total_capacity: 180 },
          inventories: [
            {
              cabin_class: CabinClass.ECONOMY,
              is_smoking: false,
              bucket_code: 'Y',
              base_price: 110,
              allocated_seats: 120,
              available_seats: 120,
            },
            {
              cabin_class: CabinClass.BUSINESS,
              is_smoking: false,
              bucket_code: 'J',
              base_price: 260,
              allocated_seats: 30,
              available_seats: 30,
            },
          ],
        },
        // Flight 3: 3 days ahead (eligible ONLY FOR BUYING because <= 14 days!)
        {
          flight_number: 'VN201',
          origin_iata: 'HAN',
          dest_iata: 'SGN',
          departure_date: datePlus3Days,
          scheduled_departure: getDateTime(3, 9, 15),
          scheduled_arrival: getDateTime(3, 11, 30),
          duration_minutes: 135,
          distance_miles: 720,
          status: FlightStatus.SCHEDULED,
          aircraft: { model_code: 'B787', model_name: 'Boeing 787 Dreamliner', total_capacity: 300 },
          inventories: [
            {
              cabin_class: CabinClass.ECONOMY,
              is_smoking: false,
              bucket_code: 'Y',
              base_price: 150,
              allocated_seats: 200,
              available_seats: 200,
            },
            {
              cabin_class: CabinClass.BUSINESS,
              is_smoking: false,
              bucket_code: 'J',
              base_price: 350,
              allocated_seats: 50,
              available_seats: 50,
            },
          ],
        },
        // Connecting flights (HAN -> DAD and DAD -> CXR on day 20)
        {
          flight_number: 'VN501',
          origin_iata: 'HAN',
          dest_iata: 'DAD',
          departure_date: datePlus20Days,
          scheduled_departure: getDateTime(20, 6, 0),
          scheduled_arrival: getDateTime(20, 7, 20),
          duration_minutes: 80,
          distance_miles: 380,
          status: FlightStatus.SCHEDULED,
          aircraft: { model_code: 'A320', model_name: 'Airbus A320', total_capacity: 150 },
          inventories: [
            {
              cabin_class: CabinClass.ECONOMY,
              is_smoking: false,
              bucket_code: 'Y',
              base_price: 70,
              allocated_seats: 100,
              available_seats: 100,
            },
          ],
        },
        {
          flight_number: 'VN502',
          origin_iata: 'DAD',
          dest_iata: 'CXR',
          departure_date: datePlus20Days,
          scheduled_departure: getDateTime(20, 9, 30), // 2h 10m transit time
          scheduled_arrival: getDateTime(20, 10, 40),
          duration_minutes: 70,
          distance_miles: 310,
          status: FlightStatus.SCHEDULED,
          aircraft: { model_code: 'A320', model_name: 'Airbus A320', total_capacity: 150 },
          inventories: [
            {
              cabin_class: CabinClass.ECONOMY,
              is_smoking: false,
              bucket_code: 'Y',
              base_price: 65,
              allocated_seats: 100,
              available_seats: 100,
            },
          ],
        },
      ];

      await this.flightModel.insertMany(sampleFlights);
      this.logger.log(`✅ Seeded ${sampleFlights.length} sample flights with inventories.`);
    }
  }
}
