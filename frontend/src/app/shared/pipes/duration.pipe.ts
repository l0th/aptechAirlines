import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'flightDuration',
  standalone: true,
})
export class FlightDurationPipe implements PipeTransform {
  transform(minutes: number | undefined | null): string {
    if (!minutes || minutes <= 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
}
