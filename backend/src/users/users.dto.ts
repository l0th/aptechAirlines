import { IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, MinLength, ValidateIf } from 'class-validator';
import { UserRole } from './users.schema';
import {
  CREDIT_CARD_MESSAGE,
  CREDIT_CARD_REGEX,
  PHONE_NUMBER_MESSAGE,
  PHONE_NUMBER_REGEX,
} from '../common/validation.constants';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Matches(PHONE_NUMBER_REGEX, { message: PHONE_NUMBER_MESSAGE })
  phone_number?: string;

  @IsOptional()
  @IsString()
  sex?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  @IsOptional()
  @IsString()
  @Matches(CREDIT_CARD_REGEX, { message: CREDIT_CARD_MESSAGE })
  preferred_credit_card?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Matches(PHONE_NUMBER_REGEX, { message: PHONE_NUMBER_MESSAGE })
  phone_number?: string;

  @IsOptional()
  @IsString()
  sex?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  @IsOptional()
  @IsString()
  @Matches(CREDIT_CARD_REGEX, { message: CREDIT_CARD_MESSAGE })
  preferred_credit_card?: string;

  // Staff-only field. UsersController rejects any non-staff (CUSTOMER) payload
  // that contains `sky_miles` with 403 to prevent self-crediting miles.
  @IsOptional()
  @IsInt()
  @Min(0)
  sky_miles?: number;

  // Staff-only field. UsersController rejects any non-staff (CUSTOMER) payload
  // that contains `role` with 403 to prevent self-promotion to ADMIN.
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
