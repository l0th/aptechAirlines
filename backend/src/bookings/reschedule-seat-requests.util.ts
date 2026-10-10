import { BadRequestException } from '@nestjs/common';
import { SeatSelectionRequestDto } from './bookings.dto';

/** Shared quote/commit validation: every explicit seat maps to exactly one new coupon. */
export function validateRescheduleSeatRequests(
  requests: SeatSelectionRequestDto[] | undefined,
  replacementFlightIds: string[],
  passengerCount: number,
): void {
  if (!requests?.length) return;

  const flights = new Set(replacementFlightIds.map(String));
  if (flights.size !== replacementFlightIds.length) {
    throw new BadRequestException('A replacement itinerary cannot contain the same flight twice.');
  }
  const assignedPassengers = new Set<string>();
  const assignedSeats = new Set<string>();

  for (const req of requests) {
    const flightId = String(req.flight_id || '');
    if (!flights.has(flightId)) {
      throw new BadRequestException('Seat selection refers to a flight outside the replacement itinerary.');
    }
    if (!Number.isInteger(req.passenger_index) || req.passenger_index < 0 || req.passenger_index >= passengerCount) {
      throw new BadRequestException('Seat selection has an invalid passenger index.');
    }
    const passengerKey = `${flightId}:${req.passenger_index}`;
    if (assignedPassengers.has(passengerKey)) {
      throw new BadRequestException('Only one seat selection is allowed per passenger and flight.');
    }
    assignedPassengers.add(passengerKey);

    if (req.selection_type === 'CHOOSE') {
      const seatCode = req.seat_code?.trim().toUpperCase();
      if (!seatCode) throw new BadRequestException('A seat code is required for a chosen seat.');
      const seatKey = `${flightId}:${seatCode}`;
      if (assignedSeats.has(seatKey)) {
        throw new BadRequestException('The same seat cannot be chosen by two passengers.');
      }
      assignedSeats.add(seatKey);
    } else if (req.selection_type !== 'AUTO') {
      throw new BadRequestException('Invalid seat selection type.');
    }
  }
}
