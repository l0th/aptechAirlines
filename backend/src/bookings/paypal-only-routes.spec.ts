import { BadRequestException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingType, PaymentMethod } from './bookings.schema';
import { UserRole } from '../users/users.schema';

describe('PayPal-only booking write routes', () => {
  const bookingService = {
    createBooking: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    confirmTicket: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    rescheduleTicket: jest.fn().mockResolvedValue({}),
    assertOwnership: jest.fn().mockResolvedValue(undefined),
  };
  const usersService = { findById: jest.fn() };
  const controller = new BookingsController(bookingService as any, {} as any, usersService as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects fake saved-card purchase before creating a booking', async () => {
    await expect(controller.create(
      { user: { sub: 'customer-id', role: UserRole.CUSTOMER } },
      { user_id: 'self', booking_type: BookingType.ONE_WAY, is_block: false, payment_method: PaymentMethod.PROFILE_CARD } as any,
    )).rejects.toThrow(BadRequestException);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });

  it('rejects fake saved-card hold confirmation before mutating booking', async () => {
    await expect(controller.confirm(
      { user: { sub: 'staff-id', role: UserRole.CLERK } },
      { blocking_number: 'BLK-SAVED', payment_method: PaymentMethod.PROFILE_CARD },
    )).rejects.toThrow(BadRequestException);
    expect(bookingService.confirmTicket).not.toHaveBeenCalled();
  });

  it('rejects fake saved-card reschedule surcharge before mutating booking', async () => {
    await expect(controller.reschedule(
      { user: { sub: 'staff-id', role: UserRole.CLERK } },
      { confirmation_number: 'CNF-SAVED', payment_method: PaymentMethod.PROFILE_CARD },
    )).rejects.toThrow(BadRequestException);
    expect(bookingService.rescheduleTicket).not.toHaveBeenCalled();
  });
});
