import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CabinClass, FlightStatus } from './flights.schema';

/**
 * Validates whether a value is a strictly valid calendar date string in YYYY-MM-DD format.
 * Rejects invalid dates like 'abc', '2026-13-01', '2026-02-31'.
 */
export function isValidCalendarDateString(val: any): boolean {
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [yStr, mStr, dStr] = val.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function IsCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          return isValidCalendarDateString(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid calendar date in YYYY-MM-DD format`;
        },
      },
    });
  };
}

// Query params always arrive as strings; convert before validation.
const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class InventoryDto {
  @IsEnum(CabinClass)
  cabin_class: CabinClass;

  @IsOptional()
  @IsBoolean()
  is_smoking?: boolean;

  @IsOptional()
  @IsString()
  bucket_code?: string;

  @IsNumber()
  @Min(0)
  base_price: number;

  @IsInt()
  @Min(0)
  allocated_seats: number;

  @IsInt()
  @Min(0)
  available_seats: number;
}

export class AircraftDto {
  @IsString()
  @IsNotEmpty()
  model_code: string;

  @IsString()
  @IsNotEmpty()
  model_name: string;

  @IsInt()
  @Min(1)
  total_capacity: number;
}

export class CreateFlightDto {
  @IsString()
  @IsNotEmpty()
  flight_number: string;

  @IsString()
  @IsNotEmpty()
  origin_iata: string;

  @IsString()
  @IsNotEmpty()
  dest_iata: string;

  @IsString()
  @IsNotEmpty()
  departure_date: string; // YYYY-MM-DD

  @IsDateString()
  scheduled_departure: string;

  @IsDateString()
  scheduled_arrival: string;

  @IsInt()
  @Min(1)
  duration_minutes: number;

  @IsInt()
  @Min(0)
  distance_miles: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AircraftDto)
  aircraft?: AircraftDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryDto)
  inventories: InventoryDto[];
}

export class UpdateFlightDto {
  @IsOptional()
  @IsString()
  flight_number?: string;

  @IsOptional()
  @IsString()
  departure_date?: string;

  @IsOptional()
  @IsDateString()
  scheduled_departure?: string;

  @IsOptional()
  @IsDateString()
  scheduled_arrival?: string;

  @IsOptional()
  @IsInt()
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  distance_miles?: number;

  @IsOptional()
  @IsEnum(FlightStatus)
  status?: FlightStatus;

  @IsOptional()
  @IsString()
  delay_reason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryDto)
  inventories?: InventoryDto[];
}

export class UpdateFlightStatusDto {
  @IsEnum(FlightStatus)
  status: FlightStatus;

  @IsOptional()
  @IsString()
  delay_reason?: string;

  @IsOptional()
  @IsDateString()
  actual_departure?: string;

  @IsOptional()
  @IsDateString()
  actual_arrival?: string;
}

export class SearchFlightDto {
  @IsString()
  @IsNotEmpty()
  origin: string; // City or IATA code

  @IsString()
  @IsNotEmpty()
  destination: string; // City or IATA code

  @IsCalendarDate()
  @IsNotEmpty()
  departure_date: string; // YYYY-MM-DD

  @IsOptional()
  @IsCalendarDate()
  departure_date_end?: string; // For date range search (Requirement 3.3.4)

  @IsOptional()
  @IsCalendarDate()
  return_date?: string; // For round-trip

  @IsOptional()
  @IsEnum(CabinClass)
  cabin_class?: CabinClass;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_smoking?: boolean;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  adults?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  children?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  seniors?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  include_connecting?: boolean;
}
