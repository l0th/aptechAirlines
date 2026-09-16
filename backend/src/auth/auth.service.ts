import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { UserRole } from '../users/users.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isMatch = await bcrypt.compare(pass, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const userObj = user.toObject();
    delete userObj.password_hash;
    return userObj;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    const payload = {
      sub: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        // `_id` là tên field mà toàn bộ frontend dùng (khớp document User và GET /api/auth/me).
        // `id` được giữ lại để tương thích ngược.
        _id: user._id,
        id: user._id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        sky_miles: user.sky_miles,
        role: user.role,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const createdUser = await this.usersService.create({
      ...registerDto,
      role: UserRole.CUSTOMER, // Mandatory CUSTOMER role on public registration
    });

    return this.login({
      username: registerDto.username,
      password: registerDto.password,
    });
  }
}
