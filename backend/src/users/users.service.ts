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
import { CREDIT_CARD_REGEX } from '../common/validation.constants';

export function toSafeUserResponse(user: any): any {
  if (!user) return null;
  const raw = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const card = typeof raw.preferred_credit_card === 'string' ? raw.preferred_credit_card.trim() : '';
  const digits = card.replace(/\D/g, '');
  const hasCard =
    CREDIT_CARD_REGEX.test(card) &&
    !/^(CARD-DEFAULT|SAVED-CARD|UNKNOWN|ORIGINAL-PAYMENT-CARD|\*)/i.test(card);
  const masked = hasCard && digits.length >= 4 ? `**** **** **** ${digits.slice(-4)}` : undefined;

  delete raw.password_hash;
  delete raw.password_reset_code_hash;
  delete raw.password_reset_expires_at;
  delete raw.preferred_credit_card;
  return {
    ...raw,
    has_preferred_credit_card: hasCard,
    preferred_credit_card_masked: masked,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findAll(search?: string, role?: UserRole): Promise<any[]> {
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
    const users = await this.userModel.find(filter).select('-password_hash').sort({ createdAt: -1 }).exec();
    return users.map((u) => toSafeUserResponse(u));
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

  /**
   * Staff-management rules shared by controller endpoints.
   * - Nobody may manage (edit/lock/reset/delete) a SUPER_ADMIN account via staff endpoints.
   * - Nobody may promote/assign SUPER_ADMIN.
   * - A user cannot change their own role or lock themselves.
   * Note: the existing rule lets ADMIN create/promote ADMIN accounts; kept as-is.
   */
  assertCanManage(
    actor: { sub: string; role: UserRole },
    target: { _id: any; role: UserRole },
    action: 'edit' | 'lock' | 'reset' | 'delete',
  ): void {
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only ADMIN/SUPER_ADMIN can manage staff accounts');
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('SUPER_ADMIN accounts cannot be modified');
    }
    if (action === 'lock' && String(actor.sub) === String(target._id)) {
      throw new ForbiddenException('You cannot lock your own account');
    }
  }

  async setActiveStatus(
    actor: { sub: string; role: UserRole },
    id: string,
    isActive: boolean,
  ): Promise<UserDocument> {
    const user = await this.findById(id);
    this.assertCanManage(actor, user, 'lock');
    user.is_active = !!isActive;
    return user.save();
  }

  async adminResetPassword(
    actor: { sub: string; role: UserRole },
    id: string,
    newPassword: string,
  ): Promise<UserDocument> {
    if (!newPassword || String(newPassword).length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const user = await this.findById(id);
    this.assertCanManage(actor, user, 'reset');
    user.password_hash = await bcrypt.hash(String(newPassword), await bcrypt.genSalt(10));
    return user.save();
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

  async setSkyMiles(userId: string, exactValue: number): Promise<UserDocument> {
    const user = await this.findById(userId);
    user.sky_miles = Math.max(0, exactValue);
    return user.save();
  }
}
