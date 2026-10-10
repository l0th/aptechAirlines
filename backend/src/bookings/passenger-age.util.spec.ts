import { PassengerType } from './bookings.schema';
import {
  ageOnDepartureDate,
  findPassengerAgeCategoryMismatch,
  passengerTypeForBirthDate,
} from './passenger-age.util';

describe('passenger age policy', () => {
  const departureDate = '2026-10-10';

  it('uses completed age on the departure date', () => {
    expect(ageOnDepartureDate('2024-10-11', departureDate)).toBe(1);
    expect(ageOnDepartureDate('2024-10-10', departureDate)).toBe(2);
    expect(passengerTypeForBirthDate('2024-10-11', departureDate)).toBe('INFANT');
    expect(passengerTypeForBirthDate('2024-10-10', departureDate)).toBe(PassengerType.CHILD);
    expect(passengerTypeForBirthDate('2014-10-10', departureDate)).toBe(PassengerType.ADULT);
    expect(passengerTypeForBirthDate('1966-10-10', departureDate)).toBe(PassengerType.SENIOR);
  });

  it('finds the exact passenger whose selected fare category is invalid', () => {
    expect(findPassengerAgeCategoryMismatch([
      { passenger_type: PassengerType.ADULT, date_of_birth: '1995-06-01' },
      { passenger_type: PassengerType.CHILD, date_of_birth: '1960-01-01' },
    ], departureDate)).toEqual({ index: 1, selected: PassengerType.CHILD, actual: PassengerType.SENIOR });
  });

  it('keeps legacy passengers without a date of birth compatible', () => {
    expect(findPassengerAgeCategoryMismatch([
      { passenger_type: PassengerType.ADULT },
    ], departureDate)).toBeNull();
  });
});
