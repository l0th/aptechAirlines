import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../flights/flights.schema';
import { PricingDimension } from './seat-pricing-rule.schema';

export class SeatPricingProfileRuleDto {
  @IsString()
  @IsNotEmpty()
  cabin_class: CabinClass | 'ALL';

  @IsEnum(PricingDimension)
  pricing_dimension: PricingDimension;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class CreateSeatPricingProfileDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/i)
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  aircraft_type: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeatPricingProfileRuleDto)
  rules: SeatPricingProfileRuleDto[];
}

export class UpdateSeatPricingProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  aircraft_type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeatPricingProfileRuleDto)
  rules?: SeatPricingProfileRuleDto[];
}

export class AssignSeatPricingProfileDto {
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  flight_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  template_ids?: string[];
}
