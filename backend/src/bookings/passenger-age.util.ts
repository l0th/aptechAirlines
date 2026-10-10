import { PassengerType } from './bookings.schema';

export type PassengerAgeType = PassengerType | 'INFANT';

function parseCalendarDate(value: unknown): { year: number; month: number; day: number } | null {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function ageOnDepartureDate(dateOfBirth: unknown, departureDate: unknown): number | null {
  const birth = parseCalendarDate(dateOfBirth);
  const departure = parseCalendarDate(departureDate);
  if (!birth || !departure) return null;
  let age = departure.year - birth.year;
  if (departure.month < birth.month || (departure.month === birth.month && departure.day < birth.day)) age--;
  return age >= 0 ? age : null;
}

export function passengerTypeForBirthDate(dateOfBirth: unknown, departureDate: unknown): PassengerAgeType | null {
  const age = ageOnDepartureDate(dateOfBirth, departureDate);
  if (age === null) return null;
  if (age < 2) return 'INFANT';
  if (age < 12) return PassengerType.CHILD;
  if (age < 60) return PassengerType.ADULT;
  return PassengerType.SENIOR;
}

export function findPassengerAgeCategoryMismatch(
  passengers: Array<{ passenger_type: PassengerType; date_of_birth?: string }>,
  departureDate: unknown,
): { index: number; selected: PassengerType; actual: PassengerAgeType } | null {
  for (let index = 0; index < passengers.length; index++) {
    const passenger = passengers[index];
    if (!passenger.date_of_birth) continue;
    const actual = passengerTypeForBirthDate(passenger.date_of_birth, departureDate);
    if (actual && actual !== passenger.passenger_type) {
      return { index, selected: passenger.passenger_type, actual };
    }
  }
  return null;
}
