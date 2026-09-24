import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaypalService } from './paypal.service';
import { PaypalController } from './paypal.controller';
import { PaypalRefundScheduler } from './paypal-refund.scheduler';
import {
  PayPalCheckoutSession,
  PayPalCheckoutSessionSchema,
} from './paypal-checkout.schema';
import { Booking, BookingSchema } from '../bookings/bookings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayPalCheckoutSession.name, schema: PayPalCheckoutSessionSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [PaypalController],
  providers: [PaypalService, PaypalRefundScheduler],
  exports: [PaypalService, PaypalRefundScheduler, MongooseModule],
})
export class PaypalModule {}
