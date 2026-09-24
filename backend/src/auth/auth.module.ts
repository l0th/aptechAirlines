import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import * as dotenv from 'dotenv';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { StrictCustomerGuard } from './strict-customer.guard';
import { UsersModule } from '../users/users.module';

dotenv.config();

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT_SECRET environment variable is strictly required.');
  }
  return secret;
}

@Module({
  imports: [
    // forwardRef: UsersModule also imports AuthModule (circular module graph)
    forwardRef(() => UsersModule),
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, StrictCustomerGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, StrictCustomerGuard, JwtModule],
})
export class AuthModule {}
