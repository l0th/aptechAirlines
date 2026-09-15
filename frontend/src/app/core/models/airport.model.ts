export interface Airport {
  _id?: string;
  iata_code: string;
  city_name: string;
  airport_name: string;
  is_serviced_directly: boolean;
  nearest_airport_code?: string;
  distance_to_nearest_km?: number;
  time_zone?: string;
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
