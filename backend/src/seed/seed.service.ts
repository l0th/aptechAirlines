import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from '../users/users.schema';
import { Airport, AirportDocument } from '../airports/airports.schema';
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
    @InjectModel(CancellationPolicy.name) private policyModel: Model<PolicyDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedSuperAdmin();
    await this.seedAirports();
    await this.seedPolicies();
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
    const airports = [
      { iata_code: 'HAN', city_name: 'Ha Noi', airport_name: 'Noi Bai International Airport', is_serviced_directly: true, time_zone: 'Asia/Ho_Chi_Minh' },
      { iata_code: 'SGN', city_name: 'Ho Chi Minh', airport_name: 'Tan Son Nhat International Airport', is_serviced_directly: true, time_zone: 'Asia/Ho_Chi_Minh' },
      { iata_code: 'DAD', city_name: 'Da Nang', airport_name: 'Da Nang International Airport', is_serviced_directly: true, time_zone: 'Asia/Ho_Chi_Minh' },
      { iata_code: 'CXR', city_name: 'Nha Trang', airport_name: 'Cam Ranh International Airport', is_serviced_directly: true, time_zone: 'Asia/Ho_Chi_Minh' },
      { iata_code: 'PQC', city_name: 'Phu Quoc', airport_name: 'Phu Quoc International Airport', is_serviced_directly: true, time_zone: 'Asia/Ho_Chi_Minh' },
      // Unserviced City example (Requirement 3.3.1): Hoi An -> suggests nearest Da Nang (DAD) at 30km
      { iata_code: 'HOI', city_name: 'Hoi An', airport_name: 'Hoi An Town Heliport', is_serviced_directly: false, nearest_airport_code: 'DAD', distance_to_nearest_km: 30.0, time_zone: 'Asia/Ho_Chi_Minh' },
      { iata_code: 'SIN', city_name: 'Singapore', airport_name: 'Changi', is_serviced_directly: true, time_zone: 'Asia/Singapore' },
      { iata_code: 'BKK', city_name: 'Bangkok', airport_name: 'Suvarnabhumi', is_serviced_directly: true, time_zone: 'Asia/Bangkok' },
      { iata_code: 'KUL', city_name: 'Kuala Lumpur', airport_name: 'KLIA', is_serviced_directly: true, time_zone: 'Asia/Kuala_Lumpur' },
      { iata_code: 'NRT', city_name: 'Tokyo', airport_name: 'Narita', is_serviced_directly: true, time_zone: 'Asia/Tokyo' },
      { iata_code: 'ICN', city_name: 'Seoul', airport_name: 'Incheon', is_serviced_directly: true, time_zone: 'Asia/Seoul' },
      { iata_code: 'HKG', city_name: 'Hong Kong', airport_name: 'HK Intl', is_serviced_directly: true, time_zone: 'Asia/Hong_Kong' },
      { iata_code: 'PVG', city_name: 'Shanghai', airport_name: 'Pudong', is_serviced_directly: false, nearest_airport_code: 'HKG', distance_to_nearest_km: 1220, time_zone: 'Asia/Shanghai' },
      { iata_code: 'TPE', city_name: 'Taipei', airport_name: 'Taoyuan', is_serviced_directly: true, time_zone: 'Asia/Taipei' },
      { iata_code: 'MNL', city_name: 'Manila', airport_name: 'Ninoy Aquino', is_serviced_directly: false, nearest_airport_code: 'HKG', distance_to_nearest_km: 1110, time_zone: 'Asia/Manila' },
      { iata_code: 'CGK', city_name: 'Jakarta', airport_name: 'Soekarno-Hatta', is_serviced_directly: false, nearest_airport_code: 'SIN', distance_to_nearest_km: 880, time_zone: 'Asia/Jakarta' },
      { iata_code: 'DEL', city_name: 'Delhi', airport_name: 'Indira Gandhi', is_serviced_directly: false, nearest_airport_code: 'BKK', distance_to_nearest_km: 2920, time_zone: 'Asia/Kolkata' },
      { iata_code: 'DXB', city_name: 'Dubai', airport_name: 'Dubai Intl', is_serviced_directly: false, nearest_airport_code: 'SIN', distance_to_nearest_km: 5800, time_zone: 'Asia/Dubai' },
      { iata_code: 'DOH', city_name: 'Doha', airport_name: 'Hamad Intl', is_serviced_directly: false, nearest_airport_code: 'SIN', distance_to_nearest_km: 5800, time_zone: 'Asia/Qatar' },
      { iata_code: 'LHR', city_name: 'London', airport_name: 'Heathrow', is_serviced_directly: true, time_zone: 'Europe/London' },
      { iata_code: 'CDG', city_name: 'Paris', airport_name: 'Charles de Gaulle', is_serviced_directly: true, time_zone: 'Europe/Paris' },
      { iata_code: 'FRA', city_name: 'Frankfurt', airport_name: 'Frankfurt am Main', is_serviced_directly: false, nearest_airport_code: 'CDG', distance_to_nearest_km: 450, time_zone: 'Europe/Berlin' },
      { iata_code: 'SYD', city_name: 'Sydney', airport_name: 'Kingsford Smith', is_serviced_directly: true, time_zone: 'Australia/Sydney' },
      { iata_code: 'MEL', city_name: 'Melbourne', airport_name: 'Tullamarine', is_serviced_directly: true, time_zone: 'Australia/Melbourne' },
      { iata_code: 'LAX', city_name: 'Los Angeles', airport_name: 'LAX', is_serviced_directly: true, time_zone: 'America/Los_Angeles' },
      { iata_code: 'SFO', city_name: 'San Francisco', airport_name: 'San Francisco International', is_serviced_directly: true, time_zone: 'America/Los_Angeles' },
      { iata_code: 'JFK', city_name: 'New York', airport_name: 'JFK', is_serviced_directly: true, time_zone: 'America/New_York' },
    ];

    const existing = await this.airportModel.find({}, 'iata_code').exec();
    const existingCodes = new Set(existing.map((a) => a.iata_code));
    const missingAirports = airports.filter((a) => !existingCodes.has(a.iata_code));

    if (missingAirports.length > 0) {
      await this.airportModel.insertMany(missingAirports);
      this.logger.log(`✅ Seeded ${missingAirports.length} new airports and cities.`);
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
          description_en: 'Cancel > 30 days before departure: 90% refund',
        },
        {
          min_days_before: 15,
          max_days_before: 29,
          refund_percentage: 75,
          description: 'Hủy từ 15 đến 29 ngày trước ngày bay: hoàn 75% giá vé',
          description_en: 'Cancel 15-29 days before departure: 75% refund',
        },
        {
          min_days_before: 7,
          max_days_before: 14,
          refund_percentage: 50,
          description: 'Hủy từ 7 đến 14 ngày trước ngày bay: hoàn 50% giá vé',
          description_en: 'Cancel 7-14 days before departure: 50% refund',
        },
        {
          min_days_before: 0,
          max_days_before: 6,
          refund_percentage: 0,
          description: 'Hủy trong vòng 6 ngày trước ngày bay: không hoàn tiền (0%)',
          description_en: 'Cancel within 6 days of departure: no refund (0%)',
        },
      ];

      await this.policyModel.insertMany(policies);
      this.logger.log(`✅ Seeded ${policies.length} cancellation policies.`);
    }
  }
}
