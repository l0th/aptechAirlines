import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService, toSafeUserResponse } from './users.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from './users.schema';

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
    return toSafeUserResponse(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async create(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() createUserDto: CreateUserDto,
  ) {
    // SUPER_ADMIN is a single permanent account: nobody may create another via the API
    if (createUserDto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('SUPER_ADMIN accounts cannot be created');
    }
    const user = await this.usersService.create(createUserDto);
    return toSafeUserResponse(user);
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

    // Nobody can promote to SUPER_ADMIN
    if (updateUserDto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Promotion to SUPER_ADMIN is not allowed');
    }
    // Users (incl. admins) cannot change their own role
    if (isSelf && updateUserDto.role !== undefined) {
      const me = await this.usersService.findById(id);
      if (updateUserDto.role !== me.role) {
        throw new ForbiddenException('You cannot change your own role');
      }
    }
    // Admins cannot edit SUPER_ADMIN accounts (SUPER_ADMIN may still edit own profile)
    if (!isSelf) {
      const target = await this.usersService.findById(id);
      this.usersService.assertCanManage(req.user, target, 'edit');
    }

    const user = await this.usersService.update(id, updateUserDto);
    return toSafeUserResponse(user);
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

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async setStatus(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
    @Body() body: { is_active: boolean },
  ) {
    const user = await this.usersService.setActiveStatus(req.user, id, body?.is_active !== false);
    return toSafeUserResponse(user);
  }

  @Post(':id/reset-password')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async resetPassword(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    const user = await this.usersService.adminResetPassword(req.user, id, body?.password);
    return { message: `Password reset for ${user.username}` };
  }
}
