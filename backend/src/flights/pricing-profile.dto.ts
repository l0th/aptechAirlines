import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdvancePricingRuleDto {
  @IsInt()
  @Min(0)
  min_days: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_days?: number | null;

  @IsNumber()
  @Min(-100)
  @Max(500)
  adjustment_percent: number;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  label_en: string;
}

export class LoadFactorPricingRuleDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  min_load_percent: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  max_load_percent: number;

  @IsNumber()
  @Min(-100)
  @Max(500)
  adjustment_percent: number;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  label_en: string;
}

export class CreatePricingProfileDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/i)
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdvancePricingRuleDto)
  advance_rules: AdvancePricingRuleDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LoadFactorPricingRuleDto)
  load_factor_rules: LoadFactorPricingRuleDto[];
}

export class UpdatePricingProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdvancePricingRuleDto)
  advance_rules?: AdvancePricingRuleDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LoadFactorPricingRuleDto)
  load_factor_rules?: LoadFactorPricingRuleDto[];
}

export class AssignPricingProfileDto {
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  flight_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  template_ids?: string[];
}
