import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserRole } from './users.schema';
import { AuthService } from '../auth/auth.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './users.dto';

function makeUser(over: any = {}) {
  const u: any = {
    _id: over._id || 'u1',
    username: 'clerk1',
    role: UserRole.CLERK,
    is_active: true,
    password_hash: 'x',
    ...over,
  };
  u.save = jest.fn().mockResolvedValue(u);
  u.toObject = () => ({ ...u });
  return u;
}

describe('Staff management rules', () => {
  const admin = { sub: 'admin1', role: UserRole.ADMIN };
  const superAdmin = { sub: 'sa1', role: UserRole.SUPER_ADMIN };
  let service: UsersService;
  let store: Record<string, any>;

  beforeEach(() => {
    store = {
      u1: makeUser(),
      admin1: makeUser({ _id: 'admin1', username: 'admin', role: UserRole.ADMIN }),
      sa1: makeUser({ _id: 'sa1', username: 'root', role: UserRole.SUPER_ADMIN }),
    };
    service = new UsersService({} as any);
    jest.spyOn(service, 'findById').mockImplementation(async (id: string) => store[id]);
  });

  it('locks and unlocks a clerk', async () => {
    await service.setActiveStatus(admin, 'u1', false);
    expect(store.u1.is_active).toBe(false);
    await service.setActiveStatus(admin, 'u1', true);
    expect(store.u1.is_active).toBe(true);
  });

  it('cannot lock SUPER_ADMIN', async () => {
    await expect(service.setActiveStatus(superAdmin, 'sa1', false)).rejects.toThrow(ForbiddenException);
  });

  it('cannot lock yourself', async () => {
    await expect(service.setActiveStatus(admin, 'admin1', false)).rejects.toThrow(ForbiddenException);
  });

  it('clerk cannot manage staff', () => {
    expect(() => service.assertCanManage({ sub: 'c', role: UserRole.CLERK }, store.u1, 'lock')).toThrow(ForbiddenException);
  });

  it('resets password with hash and rejects short / SUPER_ADMIN', async () => {
    await service.adminResetPassword(admin, 'u1', 'Temp@123');
    expect(await bcrypt.compare('Temp@123', store.u1.password_hash)).toBe(true);
    await expect(service.adminResetPassword(admin, 'u1', '123')).rejects.toThrow(BadRequestException);
    await expect(service.adminResetPassword(admin, 'sa1', 'Temp@123')).rejects.toThrow(ForbiddenException);
  });

  describe('controller', () => {
    let controller: UsersController;
    beforeEach(() => {
      controller = new UsersController(service);
      jest.spyOn(service, 'create').mockResolvedValue(makeUser() as any);
      jest.spyOn(service, 'update').mockResolvedValue(makeUser() as any);
    });

    it('nobody can create SUPER_ADMIN', async () => {
      await expect(controller.create({ user: superAdmin }, { role: UserRole.SUPER_ADMIN } as any)).rejects.toThrow(ForbiddenException);
    });

    it('nobody can promote to SUPER_ADMIN', async () => {
      await expect(controller.update({ user: superAdmin }, 'u1', { role: UserRole.SUPER_ADMIN } as any)).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot change own role', async () => {
      await expect(controller.update({ user: admin }, 'admin1', { role: UserRole.CLERK } as any)).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot edit SUPER_ADMIN', async () => {
      await expect(controller.update({ user: admin }, 'sa1', { first_name: 'X' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('admin can edit clerk role to ADMIN', async () => {
      await expect(controller.update({ user: admin }, 'u1', { role: UserRole.ADMIN } as any)).resolves.toBeDefined();
    });
  });

  it('locked user cannot log in', async () => {
    const hash = await bcrypt.hash('pw123456', 4);
    const users: any = { findByUsername: jest.fn().mockResolvedValue(makeUser({ password_hash: hash, is_active: false })) };
    const auth = new AuthService(users, {} as any);
    await expect(auth.validateUser('clerk1', 'pw123456')).rejects.toThrow(UnauthorizedException);
  });

  it('persists the optional primary-traveler profile for faster future bookings', async () => {
    const user = makeUser({
      id_card_or_passport: '',
      nationality: '',
      date_of_birth: '',
    });
    jest.spyOn(service, 'findById').mockResolvedValue(user);

    const updated: any = await service.update('u1', {
      id_card_or_passport: '079095000123',
      nationality: 'Vietnam',
      date_of_birth: '1995-05-20',
    } as any);

    expect(updated.id_card_or_passport).toBe('079095000123');
    expect(updated.nationality).toBe('Vietnam');
    expect(updated.date_of_birth).toBe('1995-05-20');
    expect(user.save).toHaveBeenCalled();
  });

  it('rejects a saved date of birth whose year conflicts with a Vietnamese CCCD', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      id_card_or_passport: '079095000123',
      date_of_birth: '1996-05-20',
    });
    const errors = await validate(dto);
    expect(errors.some(error => error.property === 'date_of_birth')).toBe(true);
  });
});
