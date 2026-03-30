import { StripeProvider } from './stripe.provider';

describe('StripeProvider', () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  it('throws when creating checkout session without stripe secret key', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const provider = new StripeProvider();

    await expect(
      provider.createCheckoutSession({
        orderNo: 'PO202603260001',
        userId: 'user-1',
        amountMinor: 690,
        currency: 'CNY',
        planCode: 'MONTH',
        successUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260001&status=success',
        cancelUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260001&status=cancel',
        customerEmail: 'u@example.com',
      }),
    ).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });

  it('uses stripe checkout session url instead of placeholder url', async () => {
    const provider = new StripeProvider();

    const createSession = jest.fn().mockResolvedValue({
      id: 'cs_live_123',
      url: 'https://checkout.stripe.com/c/pay/cs_live_123',
      expires_at: 1774521000,
    });

    (provider as any).stripeClient = {
      checkout: {
        sessions: {
          create: createSession,
        },
      },
    };

    const result = await provider.createCheckoutSession({
      orderNo: 'PO202603260002',
      userId: 'user-2',
      amountMinor: 6990,
      currency: 'CNY',
      planCode: 'YEAR',
      successUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260002&status=success',
      cancelUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260002&status=cancel',
      customerEmail: 'u@example.com',
    });

    expect(createSession).toHaveBeenCalled();
    expect(result.sessionId).toBe('cs_live_123');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_live_123');
    expect(result.expiresAt.toISOString()).toBe('2026-03-26T10:30:00.000Z');
  });

  it('passes customer email to stripe checkout session when provided', async () => {
    const provider = new StripeProvider();

    const createSession = jest.fn().mockResolvedValue({
      id: 'cs_live_456',
      url: 'https://checkout.stripe.com/c/pay/cs_live_456',
      expires_at: 1774521000,
    });

    (provider as any).stripeClient = {
      checkout: {
        sessions: {
          create: createSession,
        },
      },
    };

    await provider.createCheckoutSession({
      orderNo: 'PO202603260003',
      userId: 'user-3',
      amountMinor: 690,
      currency: 'CNY',
      planCode: 'MONTH',
      successUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260003&status=success',
      cancelUrl: 'http://localhost:3000/vip/result?orderNo=PO202603260003&status=cancel',
      customerEmail: 'auto@example.com',
    });

    const firstCall = createSession.mock.calls[0]?.[0];
    expect(firstCall?.customer_email).toBe('auto@example.com');
  });

  it('fetches paid checkout sessions for the requested day', async () => {
    const provider = new StripeProvider();

    const listSessions = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: 'cs_paid_1',
            client_reference_id: 'PO202603300001',
            amount_total: 1990,
            currency: 'cny',
            payment_status: 'paid',
          },
          {
            id: 'cs_unpaid_1',
            client_reference_id: 'PO202603300002',
            amount_total: 1990,
            currency: 'cny',
            payment_status: 'unpaid',
          },
        ],
        has_more: false,
      });

    (provider as any).stripeClient = {
      checkout: {
        sessions: {
          list: listSessions,
        },
      },
    };

    const result = await provider.fetchDailyLedger({
      bizDate: '2026-03-30',
      currency: 'CNY',
    });

    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 100,
        created: expect.objectContaining({
          gte: expect.any(Number),
          lte: expect.any(Number),
        }),
      }),
    );
    expect(result).toEqual([
      {
        orderNo: 'PO202603300001',
        amountMinor: 1990,
        currency: 'CNY',
      },
    ]);
  });
});
