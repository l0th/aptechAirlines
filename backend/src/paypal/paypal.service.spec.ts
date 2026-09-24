import { BadRequestException } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { CaptureStatus, RefundStatus } from '@paypal/paypal-server-sdk';

describe('PaypalService Specification Tests', () => {
  let service: PaypalService;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    service = new PaypalService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('1. Configuration Resolution & Fail-Closed Invariants', () => {
    it('defaults to disabled (fail-closed) when environment variables are missing', () => {
      delete process.env.PAYPAL_ENABLED;
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      service.refreshConfiguration();

      const cfg = service.getPublicConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.client_id).toBe('');
      expect(cfg.presentment_currency).toBe('');
      expect(cfg.vnd_per_presentment_unit).toBe(0);
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_ENV is missing when enabled', () => {
      process.env.PAYPAL_ENABLED = 'true';
      delete process.env.PAYPAL_ENV;
      process.env.PAYPAL_CLIENT_ID = 'test-client';
      process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
      process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';

      expect(() => service.refreshConfiguration()).toThrow('PAYPAL_ENV is missing');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_PRESENTMENT_CURRENCY is missing when enabled', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'client_123';
      process.env.PAYPAL_CLIENT_SECRET = 'secret_123';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';
      delete process.env.PAYPAL_PRESENTMENT_CURRENCY;

      expect(() => service.refreshConfiguration()).toThrow('strictly requires USD presentment currency');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_ENV is set to production or non-sandbox', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'production';
      process.env.PAYPAL_CLIENT_ID = 'test-client';
      process.env.PAYPAL_CLIENT_SECRET = 'test-secret';

      expect(() => service.refreshConfiguration()).toThrow('strictly supports sandbox environment only');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_CLIENT_ID is missing when enabled', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = '';
      process.env.PAYPAL_CLIENT_SECRET = 'secret';

      expect(() => service.refreshConfiguration()).toThrow('PAYPAL_CLIENT_ID is missing');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_CLIENT_SECRET is missing when enabled', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'client_123';
      delete process.env.PAYPAL_CLIENT_SECRET;

      expect(() => service.refreshConfiguration()).toThrow('PAYPAL_CLIENT_SECRET is missing');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('throws and fails closed if PAYPAL_VND_PER_PRESENTMENT_UNIT is invalid (<= 0 or non-numeric)', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'client_123';
      process.env.PAYPAL_CLIENT_SECRET = 'secret_123';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '-500';

      expect(() => service.refreshConfiguration()).toThrow('positive numeric rate is required');
      expect(service.isPayPalActive()).toBe(false);
    });

    it('initializes successfully with valid sandbox credentials and configurable exchange rate', () => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'sandbox_client_id_valid';
      process.env.PAYPAL_CLIENT_SECRET = 'sandbox_secret_valid';
      process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25500';

      service.refreshConfiguration();
      const cfg = service.getPublicConfig();

      expect(cfg.enabled).toBe(true);
      expect(cfg.client_id).toBe('sandbox_client_id_valid');
      expect(cfg.presentment_currency).toBe('USD');
      expect(cfg.vnd_per_presentment_unit).toBe(25500);
      expect(service.getVndPerUnit()).toBe(25500);
    });
  });

  describe('2. Authoritative Integer VND to USD Presentment Math', () => {
    beforeEach(() => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'test_client_id';
      process.env.PAYPAL_CLIENT_SECRET = 'test_client_secret';
      process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';
      service.refreshConfiguration();
    });

    it('converts zero or negative VND to 0.00 USD', () => {
      expect(service.convertVndToPresentment(0)).toEqual({
        provider_amount: '0.00',
        provider_currency: 'USD',
        exchange_rate_vnd_per_unit: 25000,
      });
      expect(service.convertVndToPresentment(-50000).provider_amount).toBe('0.00');
    });

    it('converts integer VND accurately using half-up standard rounding', () => {
      // 25,000 VND / 25,000 = 1.00 USD
      expect(service.convertVndToPresentment(25000).provider_amount).toBe('1.00');
      // 100,000 VND / 25,000 = 4.00 USD
      expect(service.convertVndToPresentment(100000).provider_amount).toBe('4.00');
      // 33,333 VND / 25,000 = 1.33332 -> 1.33 USD
      expect(service.convertVndToPresentment(33333).provider_amount).toBe('1.33');
      // 37,500 VND / 25,000 = 1.50 USD
      expect(service.convertVndToPresentment(37500).provider_amount).toBe('1.50');
      // 3,750,000 VND / 25,000 = 150.00 USD
      expect(service.convertVndToPresentment(3750000).provider_amount).toBe('150.00');
    });

    it('supports custom exchange rate override when provided', () => {
      const res = service.convertVndToPresentment(50000, 20000);
      expect(res.provider_amount).toBe('2.50');
      expect(res.exchange_rate_vnd_per_unit).toBe(20000);
    });
  });

  describe('3. Mock Gateway Operations (createOrder, captureOrder, refundCapture)', () => {
    let mockOrdersController: any;
    let mockPaymentsController: any;

    beforeEach(() => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'test_client_id';
      process.env.PAYPAL_CLIENT_SECRET = 'test_client_secret';
      process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';
      service.refreshConfiguration();
      mockOrdersController = {
        createOrder: jest.fn(),
        getOrder: jest.fn(),
        captureOrder: jest.fn(),
      };
      mockPaymentsController = {
        refundCapturedPayment: jest.fn(),
        getRefund: jest.fn(),
      };
      service.setMockControllers(mockOrdersController, mockPaymentsController);
    });

    it('createOrder passes deterministic paypalRequestId and capture intent', async () => {
      mockOrdersController.createOrder.mockResolvedValue({
        result: {
          id: 'ORDER-PAYPAL-123',
          status: 'CREATED',
        },
      });

      const res = await service.createOrder({
        amountVnd: 500000,
        clientRequestId: 'CLIENT-REQ-456',
        description: 'Flight SGN to HAN',
      });

      expect(res.order_id).toBe('ORDER-PAYPAL-123');
      expect(res.provider_amount).toBe('20.00'); // 500,000 / 25,000
      expect(res.provider_currency).toBe('USD');

      expect(mockOrdersController.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          paypalRequestId: 'CLIENT-REQ-456-create',
          body: expect.objectContaining({
            intent: 'CAPTURE',
            purchaseUnits: [
              expect.objectContaining({
                amount: {
                  currencyCode: 'USD',
                  value: '20.00',
                },
                description: 'Flight SGN to HAN',
              }),
            ],
          }),
        }),
      );
    });

    it('captureOrder sends deterministic request header and extracts capture fields', async () => {
      mockOrdersController.captureOrder.mockResolvedValue({
        result: {
          id: 'ORDER-PAYPAL-123',
          status: 'COMPLETED',
          purchaseUnits: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAPTURE-789',
                    status: CaptureStatus.Completed,
                    amount: {
                      currencyCode: 'USD',
                      value: '20.00',
                    },
                  },
                ],
              },
            },
          ],
        },
      });

      const res = await service.captureOrder({
        orderId: 'ORDER-PAYPAL-123',
        paypalRequestId: 'SAGA-CAPTURE-IDEMPOTENT',
      });

      expect(res.capture_id).toBe('CAPTURE-789');
      expect(res.status).toBe(CaptureStatus.Completed);
      expect(res.provider_amount).toBe('20.00');
      expect(res.provider_currency).toBe('USD');

      expect(mockOrdersController.captureOrder).toHaveBeenCalledWith({
        id: 'ORDER-PAYPAL-123',
        paypalRequestId: 'SAGA-CAPTURE-IDEMPOTENT',
        prefer: 'return=representation',
      });
    });

    it('refundCapture sends deterministic request header and returns refund ID and status', async () => {
      mockPaymentsController.refundCapturedPayment.mockResolvedValue({
        result: {
          id: 'REFUND-999',
          status: RefundStatus.Completed,
          amount: {
            value: '10.00',
            currencyCode: 'USD',
          },
        },
      });

      const res = await service.refundCapture({
        captureId: 'CAPTURE-789',
        providerAmount: '10.00',
        providerCurrency: 'USD',
        paypalRequestId: 'REFUND-REQ-IDEMPOTENT',
        note: 'Customer cancellation',
      });

      expect(res.refund_id).toBe('REFUND-999');
      expect(res.status).toBe(RefundStatus.Completed);
      expect(res.amount).toBe('10.00');
      expect(res.currency).toBe('USD');

      expect(mockPaymentsController.refundCapturedPayment).toHaveBeenCalledWith({
        captureId: 'CAPTURE-789',
        paypalRequestId: 'REFUND-REQ-IDEMPOTENT',
        prefer: 'return=representation',
        body: {
          amount: {
            currencyCode: 'USD',
            value: '10.00',
          },
          noteToPayer: 'Customer cancellation',
        },
      });
    });

    it('refundCapture fails closed on response amount mismatch', async () => {
      mockPaymentsController.refundCapturedPayment.mockResolvedValue({
        result: {
          id: 'REFUND-MISMATCH',
          status: RefundStatus.Completed,
          amount: { value: '9.00', currencyCode: 'USD' },
        },
      });

      await expect(
        service.refundCapture({
          captureId: 'CAPTURE-789',
          providerAmount: '10.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REFUND-REQ-MISMATCH',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refundCapture fails closed on response currency mismatch', async () => {
      mockPaymentsController.refundCapturedPayment.mockResolvedValue({
        result: {
          id: 'REFUND-CCY-MISMATCH',
          status: RefundStatus.Completed,
          amount: { value: '10.00', currencyCode: 'EUR' },
        },
      });

      await expect(
        service.refundCapture({
          captureId: 'CAPTURE-789',
          providerAmount: '10.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REFUND-REQ-CCY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refundCapture fails closed on missing response amount or currency', async () => {
      mockPaymentsController.refundCapturedPayment.mockResolvedValue({
        result: {
          id: 'REFUND-NO-AMT',
          status: RefundStatus.Completed,
        },
      });

      await expect(
        service.refundCapture({
          captureId: 'CAPTURE-789',
          providerAmount: '10.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REFUND-REQ-NO-AMT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('getRefundDetails fails closed on ID mismatch', async () => {
      mockPaymentsController.getRefund.mockResolvedValue({
        result: {
          id: 'DIFF-ID',
          status: 'COMPLETED',
          amount: { value: '10.00', currencyCode: 'USD' },
        },
      });

      await expect(
        service.getRefundDetails('REQ-ID', { expectedAmount: '10.00', expectedCurrency: 'USD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('getRefundDetails fails closed on missing amount in expected snapshot', async () => {
      mockPaymentsController.getRefund.mockResolvedValue({
        result: {
          id: 'REQ-ID',
          status: 'COMPLETED',
          amount: { currencyCode: 'USD' },
        },
      });

      await expect(
        service.getRefundDetails('REQ-ID', { expectedAmount: '10.00', expectedCurrency: 'USD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('getRefundDetails fails closed on missing currency in expected snapshot', async () => {
      mockPaymentsController.getRefund.mockResolvedValue({
        result: {
          id: 'REQ-ID',
          status: 'COMPLETED',
          amount: { value: '10.00' },
        },
      });

      await expect(
        service.getRefundDetails('REQ-ID', { expectedAmount: '10.00', expectedCurrency: 'USD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('getRefundDetails succeeds when provider snapshot matches expected values', async () => {
      mockPaymentsController.getRefund.mockResolvedValue({
        result: {
          id: 'REQ-ID',
          status: 'COMPLETED',
          amount: { value: '10.00', currencyCode: 'USD' },
        },
      });

      const res = await service.getRefundDetails('REQ-ID', { expectedAmount: '10.00', expectedCurrency: 'USD' });
      expect(res.refund_id).toBe('REQ-ID');
      expect(res.status).toBe('COMPLETED');
      expect(res.amount).toBe('10.00');
      expect(res.currency).toBe('USD');
    });

    it('throws BadRequestException when createOrder, captureOrder, or refundCapture fail', async () => {
      mockOrdersController.createOrder.mockRejectedValue(new Error('Network gateway timeout'));
      await expect(
        service.createOrder({ amountVnd: 100000, clientRequestId: 'req-err' }),
      ).rejects.toThrow(BadRequestException);

      mockOrdersController.captureOrder.mockRejectedValue(new Error('INSTRUMENT_DECLINED'));
      await expect(
        service.captureOrder({ orderId: 'ord-fail', paypalRequestId: 'req-cap-err' }),
      ).rejects.toThrow(BadRequestException);

      mockPaymentsController.refundCapturedPayment.mockRejectedValue(new Error('CAPTURE_ALREADY_REFUNDED'));
      await expect(
        service.refundCapture({
          captureId: 'cap-fail',
          providerAmount: '10.00',
          providerCurrency: 'USD',
          paypalRequestId: 'req-ref-err',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Legacy TTL Index Fail-Closed Migration (FIX 1)', () => {
    it('no legacy TTL index exists -> returns dropped: false and preserves indexes', async () => {
      const mockCollection = {
        collectionName: 'paypalcheckoutsessions',
        indexes: jest.fn().mockResolvedValue([
          { key: { _id: 1 }, name: '_id_' },
          { key: { checkout_id: 1 }, name: 'checkout_id_1', unique: true },
        ]),
        dropIndex: jest.fn(),
      };
      const mockModel: any = { collection: mockCollection };
      const testService = new PaypalService(mockModel);

      const res = await testService.dropLegacyCheckoutTtlIndex();
      expect(res.dropped).toBe(false);
      expect(res.preservedIndexes).toEqual(['_id_', 'checkout_id_1']);
      expect(mockCollection.dropIndex).not.toHaveBeenCalled();
    });

    it('legacy TTL detected and drop succeeds -> returns dropped: true and preserves other indexes', async () => {
      const mockCollection = {
        collectionName: 'paypalcheckoutsessions',
        indexes: jest.fn().mockResolvedValue([
          { key: { _id: 1 }, name: '_id_' },
          { key: { checkout_id: 1 }, name: 'checkout_id_1', unique: true },
          { key: { createdAt: 1 }, name: 'createdAt_1', expireAfterSeconds: 604800 },
        ]),
        dropIndex: jest.fn().mockResolvedValue(true),
      };
      const mockModel: any = { collection: mockCollection };
      const testService = new PaypalService(mockModel);

      const res = await testService.dropLegacyCheckoutTtlIndex();
      expect(res.dropped).toBe(true);
      expect(res.droppedIndexName).toBe('createdAt_1');
      expect(res.preservedIndexes).toEqual(['_id_', 'checkout_id_1']);
      expect(mockCollection.dropIndex).toHaveBeenCalledWith('createdAt_1');
    });

    it('legacy TTL detected and drop fails with permission/database error -> throws and fails closed', async () => {
      const mockCollection = {
        collectionName: 'paypalcheckoutsessions',
        indexes: jest.fn().mockResolvedValue([
          { key: { createdAt: 1 }, name: 'createdAt_1', expireAfterSeconds: 604800 },
        ]),
        dropIndex: jest.fn().mockRejectedValue(new Error('Unauthorized - index drop not permitted')),
      };
      const mockModel: any = { collection: mockCollection };
      const testService = new PaypalService(mockModel);

      await expect(testService.dropLegacyCheckoutTtlIndex()).rejects.toThrow(
        /CRITICAL_FINANCIAL_RETENTION_FAILURE: Failed to drop legacy TTL index/,
      );
    });

    it('onModuleInit fails closed and throws when TTL drop fails', async () => {
      const mockCollection = {
        collectionName: 'paypalcheckoutsessions',
        indexes: jest.fn().mockResolvedValue([
          { key: { createdAt: 1 }, name: 'createdAt_1', expireAfterSeconds: 604800 },
        ]),
        dropIndex: jest.fn().mockRejectedValue(new Error('Disk I/O failure')),
      };
      const mockModel: any = { collection: mockCollection };
      const testService = new PaypalService(mockModel);

      await expect(testService.onModuleInit()).rejects.toThrow(
        /CRITICAL_FINANCIAL_RETENTION_FAILURE/,
      );
    });
  });

  describe('5. Strict Provider Status & Capture Snapshot Invariants (Phase 1B.3.3)', () => {
    let mockOrdersController: any;
    let mockPaymentsController: any;

    beforeEach(() => {
      process.env.PAYPAL_ENABLED = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      process.env.PAYPAL_CLIENT_ID = 'test_client_id';
      process.env.PAYPAL_CLIENT_SECRET = 'test_client_secret';
      process.env.PAYPAL_PRESENTMENT_CURRENCY = 'USD';
      process.env.PAYPAL_VND_PER_PRESENTMENT_UNIT = '25000';
      service.refreshConfiguration();
      mockOrdersController = {
        createOrder: jest.fn(),
        getOrder: jest.fn(),
        captureOrder: jest.fn(),
      };
      mockPaymentsController = {
        refundCapturedPayment: jest.fn(),
        getRefund: jest.fn(),
      };
      service.setMockControllers(mockOrdersController, mockPaymentsController);
    });

    it('captureOrder throws BadRequestException when capture.id is missing', async () => {
      mockOrdersController.captureOrder.mockResolvedValue({
        result: {
          purchaseUnits: [
            {
              payments: {
                captures: [
                  {
                    status: 'COMPLETED',
                    amount: { value: '25.00', currencyCode: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });

      await expect(
        service.captureOrder({ orderId: 'ord-no-cap-id', paypalRequestId: 'req-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('captureOrder throws BadRequestException when capture.status is missing', async () => {
      mockOrdersController.captureOrder.mockResolvedValue({
        result: {
          purchaseUnits: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-123',
                    amount: { value: '25.00', currencyCode: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });

      await expect(
        service.captureOrder({ orderId: 'ord-no-status', paypalRequestId: 'req-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('captureOrder throws BadRequestException when capture.amount.value is missing', async () => {
      mockOrdersController.captureOrder.mockResolvedValue({
        result: {
          purchaseUnits: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-123',
                    status: 'COMPLETED',
                    amount: { currencyCode: 'USD' },
                  },
                ],
              },
            },
          ],
        },
      });

      await expect(
        service.captureOrder({ orderId: 'ord-no-value', paypalRequestId: 'req-3' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('captureOrder throws BadRequestException when capture.amount.currencyCode is missing', async () => {
      mockOrdersController.captureOrder.mockResolvedValue({
        result: {
          purchaseUnits: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAP-123',
                    status: 'COMPLETED',
                    amount: { value: '25.00' },
                  },
                ],
              },
            },
          ],
        },
      });

      await expect(
        service.captureOrder({ orderId: 'ord-no-ccy', paypalRequestId: 'req-4' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refundCapture throws BadRequestException on invalid or unsupported refund status', async () => {
      mockPaymentsController.refundCapturedPayment.mockResolvedValue({
        result: {
          id: 'REF-UNKNOWN-STATUS',
          status: 'SOME_WEIRD_STATUS',
          amount: { value: '10.00', currencyCode: 'USD' },
        },
      });

      await expect(
        service.refundCapture({
          captureId: 'CAP-789',
          providerAmount: '10.00',
          providerCurrency: 'USD',
          paypalRequestId: 'REQ-UNKNOWN',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('getRefundDetails throws BadRequestException on invalid or unsupported refund status', async () => {
      mockPaymentsController.getRefund.mockResolvedValue({
        result: {
          id: 'REF-UNKNOWN-STATUS-2',
          status: 'INVALID_STATUS',
          amount: { value: '10.00', currencyCode: 'USD' },
        },
      });

      await expect(
        service.getRefundDetails('REF-UNKNOWN-STATUS-2', {
          expectedAmount: '10.00',
          expectedCurrency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
