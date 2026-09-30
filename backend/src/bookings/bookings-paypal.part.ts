import { Model } from 'mongoose';
import { BookingDocument } from './bookings.schema';
import { PaypalService } from '../paypal/paypal.service';
import { PayPalCheckoutSessionDocument } from '../paypal/paypal-checkout.schema';

export interface BookingsPayPalDependencies {
  bookingModel: Model<BookingDocument>;
  paypalService?: PaypalService;
  paypalCheckoutModel?: Model<PayPalCheckoutSessionDocument>;
}

export interface BookingsPayPalBridge {
  generateCode(prefix: string): string;
  cancelExpiredBlockStrict(booking: BookingDocument): Promise<void>;
  quoteBooking(...args: any[]): any;
  quoteRescheduleTicket(...args: any[]): any;
  findById(...args: any[]): any;
  createBooking(...args: any[]): any;
  confirmTicket(...args: any[]): any;
  rescheduleTicket(...args: any[]): any;
}

export abstract class BookingsPayPalPart {
  protected constructor(
    protected readonly deps: BookingsPayPalDependencies,
    protected readonly bridge: BookingsPayPalBridge,
  ) {}

  protected get bookingModel() { return this.deps.bookingModel; }
  protected get paypalService() { return this.deps.paypalService; }
  protected get paypalCheckoutModel() { return this.deps.paypalCheckoutModel; }
}
