import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { RegisterDto } from './auth.dto';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/users.schema';

describe('AuthService & Requirement §3.2 Test Suite', () => {
  const validRegisterPayload = {
    username: 'testpilot',
    password: 'securepassword123',
    first_name: 'Amelia',
    last_name: 'Earhart',
    email: 'amelia.earhart@aptechairlines.com',
    address: '100 Aviation Way, Atchison, KS',
    phone_number: '+1-800-555-0199',
    sex: 'FEMALE',
    age: 28,
    preferred_credit_card: '4111222233334444',
  };

  // =========================================================================
  // Requirement §3.2 DTO Validation Tests (Cases A through G)
  // =========================================================================
  describe('Requirement §3.2 - RegisterDto Validation', () => {
    it('Case A: Complete valid RegisterDto passes validation', async () => {
      const dto = plainToInstance(RegisterDto, validRegisterPayload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Case B: Missing address rejects validation', async () => {
      const payload: any = { ...validRegisterPayload };
      delete payload.address;

      const dto = plainToInstance(RegisterDto, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const addressError = errors.find((e) => e.property === 'address');
      expect(addressError).toBeDefined();
    });

    it('Case C: Missing phone_number rejects validation', async () => {
      const payload: any = { ...validRegisterPayload };
      delete payload.phone_number;

      const dto = plainToInstance(RegisterDto, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const phoneError = errors.find((e) => e.property === 'phone_number');
      expect(phoneError).toBeDefined();
    });

    it('Case D: Missing sex rejects validation', async () => {
      const payload: any = { ...validRegisterPayload };
      delete payload.sex;

      const dto = plainToInstance(RegisterDto, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const sexError = errors.find((e) => e.property === 'sex');
      expect(sexError).toBeDefined();
    });

    it('Case E: Missing age rejects validation', async () => {
      const payload: any = { ...validRegisterPayload };
      delete payload.age;

      const dto = plainToInstance(RegisterDto, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const ageError = errors.find((e) => e.property === 'age');
      expect(ageError).toBeDefined();
    });

    it('Case F: Missing preferred_credit_card rejects validation', async () => {
      const payload: any = { ...validRegisterPayload };
      delete payload.preferred_credit_card;

      const dto = plainToInstance(RegisterDto, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      const cardError = errors.find((e) => e.property === 'preferred_credit_card');
      expect(cardError).toBeDefined();
    });

    describe('Case G: Invalid/non-integer/negative age rejects as appropriate to DTO contract', () => {
      it('rejects string age (e.g. "abc")', async () => {
        const dto = plainToInstance(RegisterDto, {
          ...validRegisterPayload,
          age: 'abc',
        });
        const errors = await validate(dto);
        const ageError = errors.find((e) => e.property === 'age');
        expect(ageError).toBeDefined();
        expect(ageError?.constraints).toHaveProperty('isInt');
      });

      it('rejects float age (e.g. 25.5)', async () => {
        const dto = plainToInstance(RegisterDto, {
          ...validRegisterPayload,
          age: 25.5,
        });
        const errors = await validate(dto);
        const ageError = errors.find((e) => e.property === 'age');
        expect(ageError).toBeDefined();
        expect(ageError?.constraints).toHaveProperty('isInt');
      });

      it('rejects negative age (e.g. -1)', async () => {
        const dto = plainToInstance(RegisterDto, {
          ...validRegisterPayload,
          age: -1,
        });
        const errors = await validate(dto);
        const ageError = errors.find((e) => e.property === 'age');
        expect(ageError).toBeDefined();
        expect(ageError?.constraints).toHaveProperty('min');
      });

      it('passes valid positive integer age (e.g. 25)', async () => {
        const dto = plainToInstance(RegisterDto, {
          ...validRegisterPayload,
          age: 25,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('passes valid zero integer age (e.g. 0)', async () => {
        const dto = plainToInstance(RegisterDto, {
          ...validRegisterPayload,
          age: 0,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });
    });
  });

  // =========================================================================
  // Requirement §3.2 AuthService Registration Tests (Cases H and I)
  // =========================================================================
  describe('Requirement §3.2 - AuthService.register', () => {
    let authService: AuthService;
    let mockUsersService: any;
    let mockJwtService: any;

    beforeEach(async () => {
      mockUsersService = {
        create: jest.fn(),
        findByUsername: jest.fn(),
      };

      mockJwtService = {
        sign: jest.fn().mockReturnValue('mocked-jwt-token'),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: UsersService, useValue: mockUsersService },
          { provide: JwtService, useValue: mockJwtService },
        ],
      }).compile();

      authService = module.get<AuthService>(AuthService);

      // Spy on login so register completes without hitting actual bcrypt / validateUser
      jest.spyOn(authService, 'login').mockResolvedValue({
        access_token: 'mocked-jwt-token',
        user: {
          _id: 'mock-user-id',
          id: 'mock-user-id',
          username: validRegisterPayload.username,
          email: validRegisterPayload.email,
          first_name: validRegisterPayload.first_name,
          last_name: validRegisterPayload.last_name,
          sky_miles: 0,
          role: UserRole.CUSTOMER,
        },
      } as any);
    });

    it('Case H: Public registration passes all profile fields to UsersService.create()', async () => {
      const dto = plainToInstance(RegisterDto, validRegisterPayload);
      mockUsersService.create.mockResolvedValue({
        _id: 'created-user-id',
        ...dto,
        role: UserRole.CUSTOMER,
        sky_miles: 0,
      });

      await authService.register(dto);

      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
      expect(mockUsersService.create).toHaveBeenCalledWith({
        username: validRegisterPayload.username,
        password: validRegisterPayload.password,
        first_name: validRegisterPayload.first_name,
        last_name: validRegisterPayload.last_name,
        email: validRegisterPayload.email,
        address: validRegisterPayload.address,
        phone_number: validRegisterPayload.phone_number,
        sex: validRegisterPayload.sex,
        age: validRegisterPayload.age,
        preferred_credit_card: validRegisterPayload.preferred_credit_card,
        role: UserRole.CUSTOMER,
      });
    });

    it('Case I: Public registration forces role: CUSTOMER even if malicious/raw service call attempts another role', async () => {
      const maliciousPayload = {
        ...validRegisterPayload,
        role: 'ADMIN',
      };

      mockUsersService.create.mockResolvedValue({
        _id: 'created-user-id',
        ...maliciousPayload,
        role: UserRole.CUSTOMER,
        sky_miles: 0,
      });

      await authService.register(maliciousPayload as any);

      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
      expect(mockUsersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.CUSTOMER,
        }),
      );
      expect(mockUsersService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'ADMIN',
        }),
      );
    });
  });

  // =========================================================================
  // Requirement §3.2 UsersService.create Tests (Cases J, K, and L)
  // =========================================================================
  describe('Requirement §3.2 - UsersService.create', () => {
    let usersService: UsersService;
    let mockUserModel: any;

    beforeEach(async () => {
      mockUserModel = jest.fn().mockImplementation(function (dto: any) {
        return {
          ...dto,
          save: jest.fn().mockResolvedValue({
            ...dto,
            _id: 'new-user-db-id',
          }),
        };
      });
      mockUserModel.findOne = jest.fn();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          {
            provide: getModelToken(User.name),
            useValue: mockUserModel,
          },
        ],
      }).compile();

      usersService = module.get<UsersService>(UsersService);
    });

    it('Case J: SkyMiles initialization remains exactly zero', async () => {
      mockUserModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const userDtoWithAttemptedMiles = {
        ...validRegisterPayload,
        role: UserRole.CUSTOMER,
        sky_miles: 5000, // Even if raw DTO attempts to inject miles
      };

      const result = await usersService.create(userDtoWithAttemptedMiles as any);

      // Check constructor call arguments to mockUserModel
      expect(mockUserModel).toHaveBeenCalledWith(
        expect.objectContaining({
          sky_miles: 0,
          username: validRegisterPayload.username,
        }),
      );

      // Check saved document property
      expect(result.sky_miles).toBe(0);
    });

    it('Case K: Existing username conflict behavior remains intact', async () => {
      mockUserModel.findOne.mockImplementation((query: any) => {
        if (query.username) {
          return {
            exec: jest.fn().mockResolvedValue({
              _id: 'existing-id',
              username: query.username,
            }),
          };
        }
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const createUserDto = {
        ...validRegisterPayload,
        role: UserRole.CUSTOMER,
      };

      await expect(usersService.create(createUserDto as any)).rejects.toThrow(ConflictException);
      await expect(usersService.create(createUserDto as any)).rejects.toThrow('Username already exists');
    });

    it('Case L: Existing email conflict behavior remains intact', async () => {
      mockUserModel.findOne.mockImplementation((query: any) => {
        if (query.username) {
          return { exec: jest.fn().mockResolvedValue(null) };
        }
        if (query.email) {
          return {
            exec: jest.fn().mockResolvedValue({
              _id: 'existing-id',
              email: query.email,
            }),
          };
        }
        return { exec: jest.fn().mockResolvedValue(null) };
      });

      const createUserDto = {
        ...validRegisterPayload,
        role: UserRole.CUSTOMER,
      };

      await expect(usersService.create(createUserDto as any)).rejects.toThrow(ConflictException);
      await expect(usersService.create(createUserDto as any)).rejects.toThrow('Email already exists');
    });
  });
});
