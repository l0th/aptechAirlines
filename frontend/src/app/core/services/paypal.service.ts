import { Injectable, inject, signal } from '@angular/core';
import { loadCoreSdkScript, SdkInstance, OnApproveDataOneTimePayments } from '@paypal/paypal-js/sdk-v6';
import { ApiService } from './api.service';
import { firstValueFrom } from 'rxjs';

export interface PayPalPublicConfig {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  client_id: string;
  presentment_currency: string;
  vnd_per_presentment_unit: number;
}

export interface StartPayPalPaymentOptions {
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (data: { orderId: string; payerId?: string }) => Promise<void>;
  onError?: (err: any) => void;
  onCancel?: () => void;
  presentationMode?: 'auto' | 'popup' | 'modal';
}

@Injectable({
  providedIn: 'root',
})
export class PaypalService {
  private readonly apiService = inject(ApiService);

  public readonly config = signal<PayPalPublicConfig | null>(null);
  public readonly isEnabled = signal<boolean>(false);
  public readonly isLoadingConfig = signal<boolean>(false);
  public readonly isEligible = signal<boolean>(false);

  private sdkInstancePromise: Promise<SdkInstance<['paypal-payments']> | null> | null = null;
  private configLoaded = false;

  constructor() {
    this.fetchConfig();
  }

  /**
   * Fetches public PayPal configuration from backend.
   */
  public async fetchConfig(): Promise<PayPalPublicConfig | null> {
    if (this.configLoaded && this.config()) {
      return this.config();
    }

    this.isLoadingConfig.set(true);
    try {
      const cfg = await firstValueFrom(this.apiService.getPayPalConfig());
      if (
        cfg &&
        cfg.enabled &&
        cfg.client_id &&
        typeof cfg.vnd_per_presentment_unit === 'number' &&
        cfg.vnd_per_presentment_unit > 0
      ) {
        this.config.set(cfg);
        this.isEnabled.set(true);
      } else {
        this.config.set(null);
        this.isEnabled.set(false);
      }
      this.configLoaded = true;
      return this.config();
    } catch (err) {
      console.warn('Failed to load PayPal sandbox configuration:', err);
      this.config.set(null);
      this.isEnabled.set(false);
      return null;
    } finally {
      this.isLoadingConfig.set(false);
    }
  }

  /**
   * Loads PayPal JS SDK v6 instance idempotently.
   */
  public async getSdkInstance(): Promise<SdkInstance<['paypal-payments']> | null> {
    if (this.sdkInstancePromise) {
      return this.sdkInstancePromise;
    }

    const cfg = await this.fetchConfig();
    if (!cfg || !cfg.enabled || !cfg.client_id) {
      return null;
    }

    this.sdkInstancePromise = (async () => {
      try {
        const paypal = await loadCoreSdkScript({
          environment: cfg.environment || 'sandbox',
        });
        if (!paypal) {
          console.error('Failed to load PayPal v6 core SDK script.');
          return null;
        }
        const instance = await paypal.createInstance({
          clientId: cfg.client_id,
          components: ['paypal-payments'],
          pageType: 'checkout',
          locale: 'en_US',
        });
        return instance;
      } catch (err) {
        console.error('Failed to initialize PayPal v6 SDK instance:', err);
        return null;
      }
    })();

    return this.sdkInstancePromise;
  }

  /**
   * Verifies if PayPal payment is eligible for current buyer / currency.
   */
  public async checkEligibility(): Promise<boolean> {
    try {
      const instance = await this.getSdkInstance();
      if (!instance) {
        this.isEligible.set(false);
        return false;
      }
      const eligibility = await instance.findEligibleMethods({ currencyCode: 'USD' });
      const eligible = Boolean(eligibility && eligibility.isEligible('paypal'));
      this.isEligible.set(eligible);
      return eligible;
    } catch (err) {
      console.warn('PayPal eligibility check failed:', err);
      this.isEligible.set(false);
      return false;
    }
  }


  /**
   * Starts a PayPal v6 one-time payment session.
   */
  public async startOneTimePayment(options: StartPayPalPaymentOptions): Promise<void> {
    const instance = await this.getSdkInstance();
    if (!instance) {
      throw new Error('PayPal SDK is not initialized.');
    }

    const isEligible = await this.checkEligibility();
    if (!isEligible) {
      throw new Error('PayPal payment method is not eligible.');
    }

    const session = instance.createPayPalOneTimePaymentSession({
      onApprove: async (data: OnApproveDataOneTimePayments) => {
        try {
          await options.onApprove({
            orderId: data.orderId,
            payerId: data.payerId,
          });
        } catch (err) {
          options.onError?.(err);
        }
      },
      onCancel: () => {
        options.onCancel?.();
      },
      onError: (err: any) => {
        options.onError?.(err);
      },
    });

    const createOrderPromise = options.createOrder();
    await session.start(
      { presentationMode: options.presentationMode || 'auto' },
      createOrderPromise,
    );
  }
}
