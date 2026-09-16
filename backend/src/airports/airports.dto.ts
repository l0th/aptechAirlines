import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAirportDto {
  @IsString()
  @IsNotEmpty()
  iata_code: string;

  @IsString()
  @IsNotEmpty()
  city_name: string;

  @IsString()
  @IsNotEmpty()
  airport_name: string;

  @IsOptional()
  @IsBoolean()
  is_serviced_directly?: boolean;

  @IsOptional()
  @IsString()
  nearest_airport_code?: string;

  @IsOptional()
  @IsNumber()
  distance_to_nearest_km?: number;

  @IsOptional()
  @IsString()
  time_zone?: string;

  @IsOptional()
  @IsString()
  icao_code?: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  @IsOptional()
  @IsString()
  city_code?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  data_source?: string;
}

export class UpdateAirportDto {
  @IsOptional()
  @IsString()
  city_name?: string;

  @IsOptional()
  @IsString()
  airport_name?: string;

  @IsOptional()
  @IsBoolean()
  is_serviced_directly?: boolean;

  @IsOptional()
  @IsString()
  nearest_airport_code?: string;

  @IsOptional()
  @IsNumber()
  distance_to_nearest_km?: number;

  @IsOptional()
  @IsString()
  time_zone?: string;

  @IsOptional()
  @IsString()
  icao_code?: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  @IsOptional()
  @IsString()
  city_code?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  data_source?: string;
}
