/**
 * Vietnamese 12-digit citizen IDs encode gender/century in digit 4 and the
 * two-digit birth year in digits 5-6. They do not encode month or day.
 * Example: 079095...... => code 0 + year 95 => 1995.
 */
export function vietnameseCitizenIdBirthYear(value: unknown): number | null {
  const digits = String(value ?? '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(digits)) return null;

  const centuryGenderCode = Number(digits[3]);
  const twoDigitYear = Number(digits.slice(4, 6));
  if (!Number.isInteger(centuryGenderCode) || !Number.isInteger(twoDigitYear)) return null;

  return 1900 + Math.floor(centuryGenderCode / 2) * 100 + twoDigitYear;
}

export function birthYearFromDate(value: unknown): number | null {
  const match = String(value ?? '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return match ? Number(match[1]) : null;
}

export function hasCitizenIdBirthYearMismatch(documentValue: unknown, dateOfBirth: unknown): boolean {
  const encodedYear = vietnameseCitizenIdBirthYear(documentValue);
  const enteredYear = birthYearFromDate(dateOfBirth);
  return encodedYear !== null && enteredYear !== null && encodedYear !== enteredYear;
}

export type AgePassengerType = 'INFANT' | 'CHILD' | 'ADULT' | 'SENIOR';

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

/** Completed years of age on the flight's local departure date. */
export function ageOnDate(dateOfBirth: unknown, departureDate: unknown): number | null {
  const birth = parseCalendarDate(dateOfBirth);
  const departure = parseCalendarDate(departureDate);
  if (!birth || !departure) return null;
  let age = departure.year - birth.year;
  if (departure.month < birth.month || (departure.month === birth.month && departure.day < birth.day)) age--;
  return age >= 0 ? age : null;
}

/** Aptech Airlines policy: infant <2, child 2-11, adult 12-59, senior 60+. */
export function passengerTypeForBirthDate(dateOfBirth: unknown, departureDate: unknown): AgePassengerType | null {
  const age = ageOnDate(dateOfBirth, departureDate);
  if (age === null) return null;
  if (age < 2) return 'INFANT';
  if (age < 12) return 'CHILD';
  if (age < 60) return 'ADULT';
  return 'SENIOR';
}
