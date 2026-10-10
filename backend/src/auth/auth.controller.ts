import { Body, Controller, Get, Headers, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { JwtAuthGuard } from './auth.guard';
import { UsersService, toSafeUserResponse } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /** Remember the website language (sent by the frontend as `X-Lang`) for future emails. */
  private async rememberLanguage(result: any, lang?: string) {
    const id = result?.user?._id || result?.user?.id;
    if (!lang || !id) return;
    try {
      await this.usersService.setPreferredLanguage(String(id), lang);
    } catch {
      // Language preference is best-effort and must never block authentication.
    }
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Headers('x-lang') lang?: string) {
    const result = await this.authService.login(loginDto);
    await this.rememberLanguage(result, lang);
    return result;
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto, @Headers('x-lang') lang?: string) {
    const result = await this.authService.register(registerDto);
    await this.rememberLanguage(result, lang);
    return result;
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Headers('x-lang') lang?: string) {
    return this.authService.requestPasswordReset(dto, lang);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
    const user = await this.usersService.findById(req.user.sub);
    return toSafeUserResponse(user);
  }
}
