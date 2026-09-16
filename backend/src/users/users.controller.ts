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
  @Roles(...STAFF_ROLES)
  async create(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Body() createUserDto: CreateUserDto,
  ) {
    // Requirement 3.8 / least privilege: a CLERK may not mint privileged accounts.
    // ADMIN/SUPER_ADMIN accounts can only be created by an ADMIN or SUPER_ADMIN.
    if (
      req.user.role === UserRole.CLERK &&
      (createUserDto.role === UserRole.ADMIN || createUserDto.role === UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        'A CLERK is not allowed to create ADMIN or SUPER_ADMIN accounts',
      );
    }
    const user = await this.usersService.create(createUserDto);
    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  // Requirement 3.8: a user may update their own profile; staff may update anyone
  @Put(':id')
  async update(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const isSelf = req.user.sub.toString() === id.toString();
    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isSelf && !isStaff) {
      throw new ForbiddenException('You can only update your own profile');
    }

    // Self-service privilege-escalation guard (requirement 3.8):
    // `UpdateUserDto` still accepts `role` and `sky_miles` because staff need
    // them, so a non-staff caller (i.e. a CUSTOMER editing their own profile)
    // must be rejected outright when trying to send either field. Otherwise a
    // CUSTOMER could promote themselves to ADMIN or credit their own Sky Miles.
    // Reject with 403 (instead of silently stripping) so the attempt is explicit.
    if (!isStaff && (updateUserDto.role !== undefined || updateUserDto.sky_miles !== undefined)) {
      throw new ForbiddenException(
        'You are not allowed to change your own role or sky_miles',
      );
    }

    const user = await this.usersService.update(id, updateUserDto);
    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  @Delete(':id')
  @Roles(...STAFF_ROLES)
  async delete(
    @Req() req: { user: { sub: string; role: UserRole } },
    @Param('id') id: string,
  ) {
    // Requirement 3.8 / least privilege: a CLERK must not be able to remove
    // ADMIN or SUPER_ADMIN accounts (privilege de-escalation attack).
    if (req.user.role === UserRole.CLERK) {
      const target = await this.usersService.findById(id);
      if (target.role === UserRole.ADMIN || target.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenException(
          'A CLERK is not allowed to delete ADMIN or SUPER_ADMIN accounts',
        );
      }
    }
    return this.usersService.delete(id);
  }
}
