import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
} from './bookings.schema';
import {
  CreatePayPalBookingOrderDto,
  CreatePayPalConfirmHoldOrderDto,
  CreatePayPalRescheduleOrderDto,
} from './bookings.dto';
import {
  PayPalCheckoutOperationType,
  PayPalCheckoutStatus,
} from '../paypal/paypal-checkout.schema';
import {
  BookingsPayPalBridge,
  BookingsPayPalDependencies,
  BookingsPayPalPart,
} from './bookings-paypal.part';

export class BookingsPayPalOrderService extends BookingsPayPalPart {
  constructor(deps: BookingsPayPalDependencies, bridge: BookingsPayPalBridge) {
    super(deps, bridge);
  }
  async createPayPalBookingOrder(
    dto: CreatePayPalBookingOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    if (dto.is_block) {
      throw new BadRequestException('Ticket hold / block reservations do not require payment.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required for PayPal order creation.');
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    const quote = await this.bridge.quoteBooking(dto, userId);
    if (quote.total_amount <= 0) {
      throw new BadRequestException('Authoritative booking amount must be greater than zero.');
    }

    const checkoutId = this.bridge.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: quote.total_amount,
      clientRequestId: dto.client_request_id,
      description: 'Aptech Airlines Ticket Purchase',
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: quote.total_amount,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: dto,
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.CREATE_BOOKING,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: quote.total_amount,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Compensation refund helper tracking truthful status.
   * COMPLETED -> REFUNDED
   * PENDING -> RECONCILE_REQUIRED
   * Failed / error -> RECONCILE_REQUIRED
   * Stores provider_refund_id and provider_refund_status.
   */
  async createPayPalConfirmHoldOrder(
    dto: CreatePayPalConfirmHoldOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    if (!dto.blocking_number) {
      throw new BadRequestException('blocking_number is required.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required.');
    }

    const booking = await this.bookingModel.findOne({ blocking_number: dto.blocking_number }).exec();
    if (!booking) {
      throw new NotFoundException(`Booking with blocking number ${dto.blocking_number} not found`);
    }
    if (booking.status !== BookingStatus.BLOCKED) {
      throw new BadRequestException(`Cannot confirm booking in ${booking.status} status.`);
    }

    // Check hold deadline: fail closed and cancel if expired
    if (booking.time_limit_deadline && new Date() > booking.time_limit_deadline) {
      await this.bridge.cancelExpiredBlockStrict(booking);
      throw new BadRequestException(
        'The 2-week deadline for this blocked ticket has passed. The reservation has been automatically cancelled.',
      );
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    if (booking.total_amount <= 0) {
      throw new BadRequestException(
        'Hold reservation does not require external PayPal payment (zero amount). Use standard confirm endpoint.',
      );
    }

    const checkoutId = this.bridge.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: booking.total_amount,
      clientRequestId: dto.client_request_id,
      description: `Aptech Airlines Hold Confirmation ${booking.pnr_code}`,
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: booking.total_amount,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: { blocking_number: dto.blocking_number },
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.CONFIRM_HOLD,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: booking.total_amount,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Capture PayPal Order and confirm Hold Booking.
   */
  async createPayPalRescheduleOrder(
    dto: CreatePayPalRescheduleOrderDto,
    userId: string,
  ): Promise<{
    checkout_id: string;
    order_id: string;
    amount: string;
    currency: string;
    amount_vnd: number;
    exchange_rate: number;
  }> {
    if (!this.paypalService || !this.paypalService.isPayPalActive()) {
      throw new BadRequestException('PayPal payment gateway is currently unavailable or disabled.');
    }
    const ident = dto.confirmation_number || dto.pnr_code;
    if (!ident) {
      throw new BadRequestException('Confirmation number or PNR code is required for reschedule.');
    }
    if (!dto.client_request_id) {
      throw new BadRequestException('client_request_id is required.');
    }

    const existing = await this.paypalCheckoutModel.findOne({
      user_id: userId,
      client_request_id: dto.client_request_id,
      operation_type: PayPalCheckoutOperationType.RESCHEDULE,
    }).exec();
    if (existing && existing.paypal_order_id) {
      return {
        checkout_id: existing.checkout_id,
        order_id: existing.paypal_order_id,
        amount: existing.provider_amount,
        currency: existing.provider_currency,
        amount_vnd: existing.amount_vnd,
        exchange_rate: existing.exchange_rate_vnd_per_unit,
      };
    }

    const quote = await this.bridge.quoteRescheduleTicket(dto, userId);
    if (quote.price_difference <= 0) {
      throw new BadRequestException(
        'Reschedule does not require external PayPal payment (zero or negative price difference). Use standard reschedule endpoint.',
      );
    }

    const checkoutId = this.bridge.generateCode('CHK');
    const order = await this.paypalService.createOrder({
      amountVnd: quote.price_difference,
      clientRequestId: dto.client_request_id,
      description: `Aptech Airlines Reschedule Surcharge ${ident}`,
    });

    const session = new this.paypalCheckoutModel({
      checkout_id: checkoutId,
      client_request_id: dto.client_request_id,
      user_id: userId,
      operation_type: PayPalCheckoutOperationType.RESCHEDULE,
      status: PayPalCheckoutStatus.CREATED,
      paypal_order_id: order.order_id,
      amount_vnd: quote.price_difference,
      provider_amount: order.provider_amount,
      provider_currency: order.provider_currency,
      exchange_rate_vnd_per_unit: order.exchange_rate_vnd_per_unit,
      operation_payload: dto,
      order_expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    try {
      await session.save();
    } catch (saveErr: any) {
      if (saveErr?.code === 11000 || saveErr?.message?.includes('E11000')) {
        const raceExisting = await this.paypalCheckoutModel.findOne({
          user_id: userId,
          client_request_id: dto.client_request_id,
          operation_type: PayPalCheckoutOperationType.RESCHEDULE,
        }).exec();
        if (raceExisting && raceExisting.paypal_order_id) {
          return {
            checkout_id: raceExisting.checkout_id,
            order_id: raceExisting.paypal_order_id,
            amount: raceExisting.provider_amount,
            currency: raceExisting.provider_currency,
            amount_vnd: raceExisting.amount_vnd,
            exchange_rate: raceExisting.exchange_rate_vnd_per_unit,
          };
        }
      }
      throw saveErr;
    }

    return {
      checkout_id: checkoutId,
      order_id: order.order_id,
      amount: order.provider_amount,
      currency: order.provider_currency,
      amount_vnd: quote.price_difference,
      exchange_rate: order.exchange_rate_vnd_per_unit,
    };
  }

  /**
   * Capture PayPal Order and execute Ticket Reschedule.
   */
}
