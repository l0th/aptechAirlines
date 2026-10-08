import { BadRequestException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { UsersService, toSafeUserResponse } from '../users/users.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { UserRole } from '../users/users.schema';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Optional() private readonly mailService?: MailService,
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

    if (user.is_active === false) {
      throw new UnauthorizedException('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
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

    const safeUser = toSafeUserResponse(user);

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
        has_preferred_credit_card: safeUser?.has_preferred_credit_card ?? false,
        preferred_credit_card_masked: safeUser?.preferred_credit_card_masked,
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

  async requestPasswordReset(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const genericMessage = 'Nếu email tồn tại trong hệ thống, mã xác nhận 6 số đã được gửi và có hiệu lực trong 10 phút.';
    const user = await this.usersService.findByEmail(email);
    if (!user) return { message: genericMessage };

    const code = String(randomInt(100000, 1000000));
    user.password_reset_code_hash = await bcrypt.hash(code, 10);
    user.password_reset_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const sent = await this.mailService?.sendPasswordResetCode({
      toEmail: user.email,
      passengerName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
      code,
      expiresInMinutes: 10,
    });
    if (sent === false) {
      this.logger.warn(`Password reset email delivery failed for ${user.email}`);
    }

    return { message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);
    const expiresAt = user?.password_reset_expires_at ? new Date(user.password_reset_expires_at) : null;
    const invalid = !user || !user.password_reset_code_hash || !expiresAt || expiresAt.getTime() <= Date.now();
    if (invalid) {
      throw new BadRequestException('Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.');
    }

    const codeMatches = await bcrypt.compare(dto.code, user.password_reset_code_hash);
    if (!codeMatches) {
      throw new BadRequestException('Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại.');
    }

    user.password_hash = await bcrypt.hash(dto.new_password, 10);
    user.password_reset_code_hash = undefined;
    user.password_reset_expires_at = undefined;
    await user.save();

    return { message: 'Đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.' };
  }
}
