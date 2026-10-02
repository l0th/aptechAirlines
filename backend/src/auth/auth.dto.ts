import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import {
  CREDIT_CARD_MESSAGE,
  CREDIT_CARD_REGEX,
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

  @IsOptional()
  @IsString()
  @Matches(CREDIT_CARD_REGEX, { message: CREDIT_CARD_MESSAGE })
  preferred_credit_card?: string;
}
