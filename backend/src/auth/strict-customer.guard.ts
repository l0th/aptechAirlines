import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../users/users.schema';

@Injectable()
export class StrictCustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }
    // Hard boundary: strictly require CUSTOMER role; no bypass for SUPER_ADMIN, ADMIN, or CLERK
    if (user.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException(
        'Interactive PayPal payments are exclusively reserved for customer accounts.',
      );
    }
    return true;
  }
}
