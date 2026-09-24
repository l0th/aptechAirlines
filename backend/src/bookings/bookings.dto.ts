import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingType, PassengerType, PaymentMethod } from './bookings.schema';
import {
  CREDIT_CARD_MESSAGE,
  CREDIT_CARD_REGEX,
} from '../common/validation.constants';

/**
 * Validates optional date of birth:
 * - Empty or omitted is allowed (optional)
 * - When supplied, requires strict YYYY-MM-DD
 * - Rejects impossible calendar dates (e.g., 2026-02-30)
 * - Rejects future dates
 */
export function isValidDateOfBirthString(val: any): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [yStr, mStr, dStr] = val.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const now = new Date();
  const todayLocal = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const maxAllowedDate = todayLocal > todayUtc ? todayLocal : todayUtc;
  if (date > maxAllowedDate) {
    return false;
  }
  return true;
}

export function IsValidDateOfBirth(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isValidDateOfBirth',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          return isValidDateOfBirthString(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid calendar date in YYYY-MM-DD format and cannot be in the future`;
        },
      },
    });
  };
}

export class PassengerInputDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsEnum(PassengerType)
  passenger_type: PassengerType;

  @IsOptional()
  @IsString()
  id_card_or_passport?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsValidDateOfBirth()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  seat_code?: string;

  @IsOptional()
  seat_codes?: Record<string, string>;
}

export class SeatSelectionRequestDto {
  @IsNotEmpty()
  @IsNumber()
  passenger_index: number;

  @IsString()
  @IsNotEmpty()
  flight_id: string;

  @IsEnum(['AUTO', 'CHOOSE'])
  selection_type: 'AUTO' | 'CHOOSE';

  @IsOptional()
  @IsString()
  seat_code?: string;
}

export class FlightLegSelectionDto {
  @IsString()
  @IsNotEmpty()
  flight_id: string;

  @IsString()
  @IsNotEmpty()
  inventory_id: string;

  @IsOptional()
  @IsString()
  leg_type?: string; // OUTBOUND, INBOUND, CONNECTING_1, CONNECTING_2
}

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsEnum(BookingType)
  booking_type: BookingType;

  // If true: User wants to BLOCK the ticket (free); If false: User BUY ticket immediately
  @IsBoolean()
  is_block: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PassengerInputDto)
  passengers: PassengerInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlightLegSelectionDto)
  legs: FlightLegSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatSelectionRequestDto)
  seat_requests?: SeatSelectionRequestDto[];

  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;
}

export class ConfirmTicketDto {
  @IsString()
  @IsNotEmpty()
  blocking_number: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsString()
  paypal_order_id?: string;
}

export class RescheduleTicketDto {
  @IsString()
  @IsNotEmpty()
  confirmation_number: string;

  @IsOptional()
  @IsString()
  pnr_code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  new_flight_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  new_inventory_id?: string;

  @IsOptional()
  @IsString()
  new_return_flight_id?: string;

  @IsOptional()
  @IsString()
  new_return_inventory_id?: string;

  // Full itinerary for CONNECTING reschedule, or outbound-direction legs for mixed ROUND_TRIP.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlightLegSelectionDto)
  new_legs?: FlightLegSelectionDto[];

  // Return-direction legs for ROUND_TRIP with connecting return.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlightLegSelectionDto)
  new_return_legs?: FlightLegSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatSelectionRequestDto)
  seat_requests?: SeatSelectionRequestDto[];

  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsString()
  paypal_order_id?: string;
}

export class CancelTicketDto {
  @IsString()
  @IsNotEmpty()
  identifier: string; // blocking_number or confirmation_number

  @IsOptional()
  @IsString()
  reason?: string;
}

export class QuoteBookingDto extends CreateBookingDto {}

export class CreatePayPalBookingOrderDto extends CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  client_request_id: string;
}

export class CapturePayPalOrderDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;
}

export class CreatePayPalConfirmHoldOrderDto {
  @IsString()
  @IsNotEmpty()
  blocking_number: string;

  @IsString()
  @IsNotEmpty()
  client_request_id: string;
}

export class CreatePayPalRescheduleOrderDto extends RescheduleTicketDto {
  @IsString()
  @IsNotEmpty()
  client_request_id: string;
}
