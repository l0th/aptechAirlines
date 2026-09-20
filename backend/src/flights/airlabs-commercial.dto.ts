import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CabinClass } from './flights.schema';
import { IsCalendarDate } from './flights.dto';

export class CommercialInventoryItemDto {
  @IsEnum(CabinClass)
  cabin_class: CabinClass;

  @IsInt()
  @Min(1)
  allocated_seats: number;
}

export class CommercializeRouteDto {
  @IsString()
  @IsNotEmpty()
  source_key: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^APT[A-Z0-9]+$/i, {
    message: 'Commercial flight number must match format ^APT[A-Z0-9]+$ (e.g., APT231)',
  })
  aptech_flight_number: string;

  @IsString()
  @IsNotEmpty()
  aircraft_type: string;

  @IsNumber()
  @Min(0)
  base_price_economy: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  base_price_business?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  base_price_club?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  base_price_first?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(CabinClass, { each: true })
  cabin_classes?: CabinClass[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommercialInventoryItemDto)
  inventories?: CommercialInventoryItemDto[];
}

export class UpdateCommercialTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^APT[A-Z0-9]+$/i, {
    message: 'Commercial flight number must match format ^APT[A-Z0-9]+$ (e.g., APT231)',
  })
  flight_number?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  aircraft_type?: string;

  @ValidateIf((_, val) => val !== undefined)
  @IsNumber()
  @Min(0)
  base_price_economy?: number;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsNumber()
  @Min(0)
  base_price_business?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsNumber()
  @Min(0)
  base_price_club?: number | null;

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsNumber()
  @Min(0)
  base_price_first?: number | null;

  @IsOptional()
  @IsArray()
  @IsEnum(CabinClass, { each: true })
  cabin_classes?: CabinClass[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommercialInventoryItemDto)
  inventories?: CommercialInventoryItemDto[];
}

export class MaterializeTemplateDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(330)
  days_ahead?: number;

  @IsOptional()
  @IsCalendarDate()
  start_date?: string;
}

