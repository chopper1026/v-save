import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentCurrency, PaymentPlanCode } from '../dto/create-payment-order.dto';

export interface StripeCheckoutSessionInput {
  orderNo: string;
  userId: string;
  amountMinor: number;
  currency: PaymentCurrency;
  planCode: PaymentPlanCode;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface StripeCheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

export interface StripeVerifiedEvent {
  id: string;
  type: string;
  data: Record<string, any>;
}

export interface StripeRefundResult {
  refundId: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface StripeCheckoutSessionStatus {
  sessionId: string;
  paymentStatus: string;
  paymentIntentId: string | null;
  paidAt: Date | null;
}

const CHECKOUT_EXPIRE_FALLBACK_SECONDS = 30 * 60;

@Injectable()
export class StripeProvider {
  private stripeClient: Stripe | null = null;

  async createCheckoutSession(
    input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionResult> {
    const stripe = this.getStripeClient();
    const unitAmount = Number(input.amountMinor);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const customerEmail = String(input.customerEmail || '').trim();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orderNo,
      customer_email: customerEmail || undefined,
      metadata: {
        orderNo: input.orderNo,
        userId: input.userId,
        planCode: input.planCode,
      },
      payment_intent_data: {
        metadata: {
          orderNo: input.orderNo,
          userId: input.userId,
          planCode: input.planCode,
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: unitAmount,
            product_data: {
              name: this.resolvePlanTitle(input.planCode),
            },
          },
        },
      ],
    });

    const checkoutUrl = String(session.url || '').trim();
    if (!checkoutUrl) {
      throw new Error('STRIPE_CHECKOUT_URL_MISSING');
    }

    const expiresAtSeconds = Number(session.expires_at || nowSeconds + CHECKOUT_EXPIRE_FALLBACK_SECONDS);

    return {
      sessionId: String(session.id || '').trim(),
      checkoutUrl,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('CHECKOUT_SESSION_REQUIRED');
    }

    const stripe = this.getStripeClient();
    await stripe.checkout.sessions.expire(normalizedSessionId);
  }

  async retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionStatus> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('CHECKOUT_SESSION_REQUIRED');
    }

    const stripe = this.getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(normalizedSessionId);
    const paymentIntentRaw = session.payment_intent;

    return {
      sessionId: String(session.id || '').trim(),
      paymentStatus: String(session.payment_status || '').trim(),
      paymentIntentId: typeof paymentIntentRaw === 'string' ? paymentIntentRaw : null,
      paidAt: session.payment_status === 'paid' ? new Date() : null,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): StripeVerifiedEvent {
    if (!rawBody?.length || !String(signature || '').trim()) {
      throw new Error('INVALID_SIGNATURE');
    }

    const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (webhookSecret) {
      const stripe = this.getStripeClient();
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return {
        id: String(event.id || '').trim(),
        type: String(event.type || '').trim(),
        data: {
          object: event.data.object as Record<string, any>,
        },
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch (_error) {
      throw new Error('INVALID_PAYLOAD');
    }

    const id = String(parsed?.id || '').trim();
    const type = String(parsed?.type || '').trim();
    if (!id || !type) {
      throw new Error('INVALID_EVENT');
    }

    return {
      id,
      type,
      data: parsed?.data || {},
    };
  }

  async createRefund(input: {
    paymentIntentId: string;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<StripeRefundResult> {
    if (!input.paymentIntentId) {
      throw new Error('PAYMENT_INTENT_REQUIRED');
    }

    const stripe = this.getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor,
        reason: 'requested_by_customer',
        metadata: {
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        },
      },
      {
        idempotencyKey: input.idempotencyKey,
      },
    );

    const status = String(refund.status || '').trim();
    return {
      refundId: String(refund.id || '').trim(),
      status: status === 'succeeded'
        ? 'succeeded'
        : status === 'failed'
          ? 'failed'
          : 'pending',
    };
  }

  async fetchDailyLedger(input: {
    bizDate: string;
    currency?: PaymentCurrency;
  }): Promise<Array<{ orderNo: string; amountMinor: number; currency: PaymentCurrency }>> {
    const stripe = this.getStripeClient();
    const range = this.resolveBizDateRange(input.bizDate);
    const normalizedCurrency = String(input.currency || '').trim().toLowerCase();
    const items: Array<{ orderNo: string; amountMinor: number; currency: PaymentCurrency }> = [];
    let startingAfter: string | undefined;

    while (true) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        created: {
          gte: range.gte,
          lte: range.lte,
        },
        starting_after: startingAfter,
      });

      for (const session of page.data || []) {
        const orderNo = String(session.client_reference_id || session.metadata?.orderNo || '').trim();
        const paymentStatus = String(session.payment_status || '').trim();
        const currency = String(session.currency || '').trim().toUpperCase();
        const amountMinor = Number(session.amount_total || 0);

        if (!orderNo || paymentStatus !== 'paid') {
          continue;
        }

        if (normalizedCurrency && currency.toLowerCase() !== normalizedCurrency) {
          continue;
        }

        items.push({
          orderNo,
          amountMinor,
          currency: (currency || 'CNY') as PaymentCurrency,
        });
      }

      if (!page.has_more || !page.data?.length) {
        break;
      }

      startingAfter = String(page.data[page.data.length - 1]?.id || '').trim() || undefined;
      if (!startingAfter) {
        break;
      }
    }

    return items;
  }

  private getStripeClient(): Stripe {
    if (this.stripeClient) {
      return this.stripeClient;
    }

    const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secretKey) {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    this.stripeClient = new Stripe(secretKey);
    return this.stripeClient;
  }

  private resolvePlanTitle(planCode: PaymentPlanCode): string {
    if (planCode === 'MONTH') {
      return 'VSave 月卡会员';
    }
    if (planCode === 'QUARTER') {
      return 'VSave 季卡会员';
    }
    if (planCode === 'YEAR') {
      return 'VSave 年卡会员';
    }
    return 'VSave 终身会员';
  }

  private resolveBizDateRange(bizDate: string) {
    const normalized = String(bizDate || '').trim();
    const start = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(start.getTime())) {
      throw new Error('INVALID_BIZ_DATE');
    }

    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return {
      gte: Math.floor(start.getTime() / 1000),
      lte: Math.floor(end.getTime() / 1000),
    };
  }
}
