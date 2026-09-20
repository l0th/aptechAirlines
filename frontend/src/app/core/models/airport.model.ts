export interface Airport {
  _id?: string;
  iata_code: string;
  city_name: string;
  airport_name: string;
  is_serviced_directly: boolean;
  nearest_airport_code?: string;
  distance_to_nearest_km?: number;
  time_zone?: string;
  icao_code?: string;
  country_code?: string;
  city_code?: string;
  lat?: number;
  lng?: number;
  data_source?: 'seed' | 'airlabs';
  created_at?: string;
  updated_at?: string;
}

export interface CityResolveResult {
  query: string;
  hasExactMatch: boolean;
  exactMatches: Airport[];
  nearestSuggestion?: {
    searched_city: string;
    suggested_airport: Airport;
    distance_km: number;
    notice: string;
  };
}

export interface CountrySuggestion {
  code: string;
  name: string;
  name_vi: string;
  airport_count?: number;
}

export interface CitySuggestion {
  city_code: string;
  name: string;
  name_vi: string;
  country_code?: string;
  airport_count: number;
  iata_codes: string[];
}

export interface AirportSuggestion {
  iata_code: string;
  airport_name: string;
  city_name: string;
  country_code?: string;
  time_zone?: string;
  is_serviced_directly?: boolean;
  nearest_airport_code?: string;
  distance_to_nearest_km?: number;
  label_vi?: string;
  label_en?: string;
}

export interface LocationSuggestResponse {
  countries: CountrySuggestion[];
  cities: CitySuggestion[];
  airports: AirportSuggestion[];
}

export interface LocationScope {
  kind: 'country' | 'city' | 'airport' | string;
  label: string;
  iata_codes?: string[];
  token: string;
}

export interface Country {
  code: string;
  name: string;
  name_vi: string;
}

