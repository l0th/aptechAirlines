import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingType, PassengerType } from './bookings.schema';

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
  date_of_birth?: string;
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
  @IsString()
  credit_card_number?: string;
}

export class ConfirmTicketDto {
  @IsString()
  @IsNotEmpty()
  blocking_number: string;

  @IsString()
  @IsNotEmpty()
  credit_card_number: string;
}

export class RescheduleTicketDto {
  @IsString()
  @IsNotEmpty()
  confirmation_number: string;

  @IsString()
  @IsNotEmpty()
  new_flight_id: string;

  @IsString()
  @IsNotEmpty()
  new_inventory_id: string;

  @IsOptional()
  @IsString()
  credit_card_number?: string;
}

export class CancelTicketDto {
  @IsString()
  @IsNotEmpty()
  identifier: string; // blocking_number or confirmation_number

  @IsOptional()
  @IsString()
  reason?: string;
}
