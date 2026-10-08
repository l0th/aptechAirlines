import { BadRequestException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { UserRole } from '../users/users.schema';

describe('BookingsController – staff booking on behalf of customer', () => {
  const customerId = '64b000000000000000000001';
  const clerkId = '64b000000000000000000099';
  let bookingsService: any;
  let usersService: any;
  let controller: BookingsController;
  const clerkReq = { user: { sub: clerkId, role: UserRole.CLERK } };

  beforeEach(() => {
    bookingsService = {
      createBooking: jest.fn(async (dto: any) => ({ ...dto, _id: 'b1' })),
      quoteBooking: jest.fn(async (dto: any) => dto),
    };
    usersService = {
      findById: jest.fn(async (id: string) => ({
        _id: id,
        role: id === customerId ? UserRole.CUSTOMER : UserRole.CLERK,
      })),
    };
    controller = new BookingsController(bookingsService, {} as any, usersService);
  });

  it('creates booking with the selected customer as user_id (not the clerk)', async () => {
    await controller.create(clerkReq, { user_id: customerId } as any);
    expect(bookingsService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: customerId }),
    );
  });

  it('rejects staff booking without a customer or targeting themselves', async () => {
    await expect(controller.create(clerkReq, { user_id: 'self' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(clerkReq, { user_id: clerkId } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingsService.createBooking).not.toHaveBeenCalled();
  });

  it('rejects staff booking for a non-CUSTOMER account', async () => {
    await expect(
      controller.create(clerkReq, { user_id: '64b000000000000000000002' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forces customer bookings to their own id', async () => {
    await controller.create({ user: { sub: customerId, role: UserRole.CUSTOMER } }, { user_id: 'other' } as any);
    expect(bookingsService.createBooking).toHaveBeenCalledWith(expect.objectContaining({ user_id: customerId }));
  });

  it('quote for staff uses the selected customer', async () => {
    await controller.quote(clerkReq, { user_id: customerId } as any);
    expect(bookingsService.quoteBooking).toHaveBeenCalledWith(expect.objectContaining({ user_id: customerId }), customerId);
  });
});
