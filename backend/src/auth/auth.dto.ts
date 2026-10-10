import { IsEmail, IsEmpty, IsInt, IsNotEmpty, IsString, Matches, Min, MinLength } from 'class-validator';
import {
  PHONE_NUMBER_MESSAGE,
  PHONE_NUMBER_REGEX,
} from '../common/validation.constants';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Verification code must contain exactly 6 digits.' })
  code: string;

  @IsString()
  @MinLength(6)
  new_password: string;
}

export class RegisterDto {
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
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_NUMBER_REGEX, { message: PHONE_NUMBER_MESSAGE })
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  sex: string;

  @IsInt()
  @Min(0)
  age: number;

  @IsEmpty({ message: 'Saving credit cards is no longer supported. Use PayPal checkout.' })
  preferred_credit_card?: string;
}
