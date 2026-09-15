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
}
