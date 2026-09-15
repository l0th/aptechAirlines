import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'currencyFormat',
  standalone: true,
})
export class CurrencyFormatPipe implements PipeTransform {
  transform(value: number | undefined | null, currency = 'VND'): string {
    if (value === undefined || value === null || isNaN(value)) {
      return '0 ' + currency;
    }
    const formatted = new Intl.NumberFormat('vi-VN').format(Math.round(value));
    return `${formatted} ${currency}`;
  }
}
