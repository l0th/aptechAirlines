import { Component, EventEmitter, forwardRef, Input, Output } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatCalendarDate, normalizeCalendarDate, parseDayFirstCalendarDate } from '../core/date-format.util';

/**
 * Locale-independent calendar input.
 * The customer sees and types dd/MM/yyyy while forms and APIs keep yyyy-MM-dd.
 */
@Component({
  selector: 'app-date-input',
  standalone: true,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DayFirstDateInputComponent),
    multi: true,
  }],
  template: `
    <span class="date-input-shell" [class.invalid]="invalid">
      <input
        class="control date-input-text"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        maxlength="10"
        placeholder="dd/mm/yyyy"
        [value]="displayValue"
        [disabled]="disabled"
        [attr.aria-label]="ariaLabel"
        [attr.aria-invalid]="invalid"
        (input)="onTextInput($event)"
        (blur)="commitText()"
        (keydown.enter)="commitAndEnter($event)">
      <input
        class="native-date-picker"
        type="date"
        tabindex="-1"
        [value]="isoValue"
        [min]="min"
        [max]="max"
        [disabled]="disabled"
        [attr.aria-label]="calendarLabel"
        (change)="onCalendarChange($event)">
      <span class="calendar-mark" aria-hidden="true"></span>
    </span>
  `,
  styles: [`
    :host{display:block;width:100%}.date-input-shell{display:block;position:relative;width:100%}.date-input-text{width:100%;padding-right:48px}.native-date-picker{position:absolute;right:0;top:0;width:48px;height:100%;opacity:0;cursor:pointer}.native-date-picker:disabled{cursor:not-allowed}.calendar-mark{pointer-events:none;position:absolute;right:16px;top:50%;width:16px;height:14px;border:2px solid currentColor;border-radius:2px;transform:translateY(-44%);color:#102b42}.calendar-mark:before{content:'';position:absolute;left:-2px;right:-2px;top:2px;border-top:2px solid currentColor}.calendar-mark:after{content:'';position:absolute;left:3px;right:3px;top:-5px;height:5px;border-left:2px solid currentColor;border-right:2px solid currentColor}.invalid .date-input-text{border-color:#c93636;box-shadow:0 0 0 3px rgba(201,54,54,.1)}
  `],
})
export class DayFirstDateInputComponent implements ControlValueAccessor {
  @Input() min = '';
  @Input() max = '';
  @Input() ariaLabel = 'Ngày theo định dạng ngày/tháng/năm';
  @Input() calendarLabel = 'Mở lịch chọn ngày';
  @Output() enterPressed = new EventEmitter<void>();

  isoValue = '';
  displayValue = '';
  disabled = false;
  invalid = false;

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    const iso = normalizeCalendarDate(value);
    this.isoValue = iso;
    this.displayValue = formatCalendarDate(iso, '');
    this.invalid = false;
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; }

  onTextInput(event: Event): void {
    this.displayValue = (event.target as HTMLInputElement).value;
    this.invalid = false;
    if (!this.displayValue.trim()) this.applyIso('');
    const parsed = parseDayFirstCalendarDate(this.displayValue, this.min, this.max);
    if (parsed) this.applyIso(parsed, false);
  }

  commitText(): void {
    this.onTouched();
    if (!this.displayValue.trim()) {
      this.applyIso('');
      return;
    }
    const parsed = parseDayFirstCalendarDate(this.displayValue, this.min, this.max);
    if (!parsed) {
      this.invalid = true;
      return;
    }
    this.applyIso(parsed);
  }

  commitAndEnter(event: Event): void {
    event.preventDefault();
    this.commitText();
    if (!this.invalid) this.enterPressed.emit();
  }

  onCalendarChange(event: Event): void {
    this.onTouched();
    this.applyIso((event.target as HTMLInputElement).value);
  }

  private applyIso(value: string, normalizeDisplay = true): void {
    this.isoValue = value;
    if (normalizeDisplay) this.displayValue = formatCalendarDate(value, '');
    this.invalid = false;
    this.onChange(value);
  }

}
