export type AirportCoordinates = { lat?: number | null; lng?: number | null };

export function greatCircleMilesFromCoordinates(
  origin: AirportCoordinates | null | undefined,
  destination: AirportCoordinates | null | undefined,
): number {
  if (
    typeof origin?.lat !== 'number' || typeof origin?.lng !== 'number' ||
    typeof destination?.lat !== 'number' || typeof destination?.lng !== 'number'
  ) return 0;

  const earthRadiusMiles = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(destination.lat - origin.lat);
  const longitudeDelta = toRadians(destination.lng - origin.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine)));
}
