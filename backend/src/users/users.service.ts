import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from './users.schema';
import { CreateUserDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findAll(search?: string, role?: UserRole): Promise<User[]> {
    const filter: any = {};
    if (role) {
      filter.role = role;
    }
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { first_name: { $regex: search, $options: 'i' } },
        { last_name: { $regex: search, $options: 'i' } },
      ];
    }
    return this.userModel.find(filter).select('-password_hash').sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID format');
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    // Check SUPER_ADMIN protection
    if (createUserDto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot manually create a SUPER_ADMIN account. Only 1 unique system SUPER_ADMIN is permitted.');
    }

    const existingUsername = await this.findByUsername(createUserDto.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    const existingEmail = await this.findByEmail(createUserDto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(createUserDto.password, salt);

    const createdUser = new this.userModel({
      ...createUserDto,
      email: createUserDto.email.toLowerCase(),
      password_hash,
      sky_miles: 0, // Requirement 3.2: initialize to zero
      role: createUserDto.role || UserRole.CUSTOMER,
    });

    return createdUser.save();
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.findById(id);

    // Prevent granting SUPER_ADMIN role
    if (updateUserDto.role === UserRole.SUPER_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot assign SUPER_ADMIN role to any account.');
    }

    // Prevent removing SUPER_ADMIN role from the superadmin
    if (user.role === UserRole.SUPER_ADMIN && updateUserDto.role && updateUserDto.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('The role of SUPER_ADMIN cannot be changed.');
    }

    // Check duplicate email
    if (updateUserDto.email && updateUserDto.email.toLowerCase() !== user.email) {
      const emailExists = await this.findByEmail(updateUserDto.email);
      if (emailExists) {
        throw new ConflictException('Email is already taken by another account');
      }
      user.email = updateUserDto.email.toLowerCase();
    }

    if (updateUserDto.password) {
      const salt = await bcrypt.genSalt(10);
      user.password_hash = await bcrypt.hash(updateUserDto.password, salt);
    }

    if (updateUserDto.first_name) user.first_name = updateUserDto.first_name;
    if (updateUserDto.last_name) user.last_name = updateUserDto.last_name;
    if (updateUserDto.address !== undefined) user.address = updateUserDto.address;
    if (updateUserDto.phone_number !== undefined) user.phone_number = updateUserDto.phone_number;
    if (updateUserDto.sex !== undefined) user.sex = updateUserDto.sex;
    if (updateUserDto.age !== undefined) user.age = updateUserDto.age;
    if (updateUserDto.preferred_credit_card !== undefined) user.preferred_credit_card = updateUserDto.preferred_credit_card;
    if (updateUserDto.sky_miles !== undefined) user.sky_miles = updateUserDto.sky_miles;
    if (updateUserDto.role && user.role !== UserRole.SUPER_ADMIN) user.role = updateUserDto.role;

    return user.save();
  }

  async delete(id: string): Promise<{ message: string }> {
    const user = await this.findById(id);

    // Strict constraint: SUPER_ADMIN CANNOT be deleted
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('The SUPER_ADMIN account is permanent and cannot be deleted.');
    }

    await this.userModel.findByIdAndDelete(id).exec();
    return { message: `User ${user.username} successfully deleted` };
  }

  async addSkyMiles(userId: string, miles: number): Promise<UserDocument> {
    const user = await this.findById(userId);
    user.sky_miles += miles;
    return user.save();
  }

  async deductSkyMiles(userId: string, miles: number): Promise<UserDocument> {
    const user = await this.findById(userId);
    user.sky_miles = Math.max(0, user.sky_miles - miles);
    return user.save();
  }
}
