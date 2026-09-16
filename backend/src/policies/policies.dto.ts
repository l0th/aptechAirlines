import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePolicyDto {
  @IsInt()
  @Min(0)
  min_days_before: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_days_before?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  refund_percentage: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsString()
  description_en?: string;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  min_days_before?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_days_before?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  refund_percentage?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  description_en?: string;
}
