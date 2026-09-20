import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { UserRole } from './users.schema';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Staff roles allowed to list/read/create/delete user accounts
const STAFF_ROLES = [UserRole.CLERK, UserRole.ADMIN, UserRole.SUPER_ADMIN];

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  async findAll(
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
  ) {
    return this.usersService.findAll(search, role);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async create(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() createUserDto: CreateUserDto,
  ) {
    // Only SUPER_ADMIN can create SUPER_ADMIN accounts (prevent privilege escalation)
    if (
      req.user.role !== UserRole.SUPER_ADMIN &&
      createUserDto.role === UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can create SUPER_ADMIN accounts',
      );
    }
    const user = await this.usersService.create(createUserDto);
    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  // Requirement 3.8 / least privilege: a user may update their own profile; only ADMIN/SUPER_ADMIN may update anyone
  @Put(':id')
  async update(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const isSelf = req.user.sub.toString() === id.toString();
    const isAdmin =
      req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN;
    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('You can only update your own profile');
    }

    // Self-service privilege-escalation guard (requirement 3.8):
    // Non-admin callers editing their own profile cannot change role or sky_miles.
    if (!isAdmin && (updateUserDto.role !== undefined || updateUserDto.sky_miles !== undefined)) {
      throw new ForbiddenException(
        'You are not allowed to change your own role or sky_miles',
      );
    }

    // ADMIN cannot demote/elevate SUPER_ADMIN
    if (req.user.role === UserRole.ADMIN && updateUserDto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can promote users to SUPER_ADMIN',
      );
    }

    const user = await this.usersService.update(id, updateUserDto);
    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async delete(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
  ) {
    // ADMIN cannot delete SUPER_ADMIN account
    if (req.user.role === UserRole.ADMIN) {
      const target = await this.usersService.findById(id);
      if (target.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenException(
          'An ADMIN is not allowed to delete SUPER_ADMIN accounts',
        );
      }
    }
    return this.usersService.delete(id);
  }
}
