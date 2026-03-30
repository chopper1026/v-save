import { buildEntitlementWindow, resolveMembershipSnapshotFromEntitlements } from './payments.membership.spec-utils';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentOrderEntitlement } from './entities/payment-order-entitlement.entity';

const createOrder = (input?: Partial<PaymentOrder>): PaymentOrder => {
  return {
    id: input?.id || 'order-1',
    orderNo: input?.orderNo || 'PO1',
    userId: input?.userId || 'user-1',
    provider: input?.provider || 'STRIPE',
    planCode: input?.planCode || 'MONTH',
    durationDays: input?.durationDays ?? 30,
    isLifetime: input?.isLifetime || false,
    preferredCurrency: input?.preferredCurrency || 'CNY',
    resolvedCurrency: input?.resolvedCurrency || 'CNY',
    amountMinor: input?.amountMinor || 1990,
    status: input?.status || 'PAID',
    stripeCheckoutSessionId: input?.stripeCheckoutSessionId || 'cs_1',
    stripePaymentIntentId: input?.stripePaymentIntentId || null,
    receiptEmail: input?.receiptEmail || 'u@example.com',
    invoiceEnabled: input?.invoiceEnabled || false,
    invoiceName: input?.invoiceName || null,
    invoiceTaxId: input?.invoiceTaxId || null,
    refundWindowEndAt: input?.refundWindowEndAt || null,
    paidAt: input?.paidAt || new Date('2026-03-26T10:00:00.000Z'),
    createdAt: input?.createdAt || new Date('2026-03-26T10:00:00.000Z'),
    updatedAt: input?.updatedAt || new Date('2026-03-26T10:00:00.000Z'),
  } as PaymentOrder;
};

const createEntitlement = (
  input?: Partial<PaymentOrderEntitlement>,
): PaymentOrderEntitlement => {
  return {
    id: input?.id || 'ent-1',
    orderId: input?.orderId || 'order-1',
    userId: input?.userId || 'user-1',
    planCode: input?.planCode || 'MONTH',
    isLifetime: input?.isLifetime || false,
    grantDays: input?.grantDays ?? 30,
    status: input?.status || 'ACTIVE',
    effectiveStartAt: input?.effectiveStartAt || new Date('2026-03-26T10:00:00.000Z'),
    effectiveEndAt: input?.effectiveEndAt || new Date('2026-04-25T10:00:00.000Z'),
    revokedAt: input?.revokedAt || null,
    revokedReason: input?.revokedReason || null,
    createdAt: input?.createdAt || new Date('2026-03-26T10:00:00.000Z'),
    updatedAt: input?.updatedAt || new Date('2026-03-26T10:00:00.000Z'),
  } as PaymentOrderEntitlement;
};

describe('payments membership helpers', () => {
  it('returns FREE when no active entitlement exists', () => {
    const snapshot = resolveMembershipSnapshotFromEntitlements([], new Date('2026-03-26T00:00:00.000Z'));

    expect(snapshot.membershipLevel).toBe('FREE');
    expect(snapshot.vipExpireDate).toBeNull();
  });

  it('returns VIP永久 when any active lifetime entitlement exists', () => {
    const snapshot = resolveMembershipSnapshotFromEntitlements(
      [
        createEntitlement({
          isLifetime: true,
          grantDays: null,
          effectiveEndAt: null,
        }),
      ],
      new Date('2026-03-26T00:00:00.000Z'),
    );

    expect(snapshot.membershipLevel).toBe('VIP');
    expect(snapshot.vipExpireDate).toBeNull();
  });

  it('returns latest end date for stacked timed entitlements', () => {
    const snapshot = resolveMembershipSnapshotFromEntitlements(
      [
        createEntitlement({
          orderId: 'order-1',
          effectiveEndAt: new Date('2026-04-10T00:00:00.000Z'),
        }),
        createEntitlement({
          orderId: 'order-2',
          effectiveEndAt: new Date('2026-05-10T00:00:00.000Z'),
        }),
      ],
      new Date('2026-03-26T00:00:00.000Z'),
    );

    expect(snapshot.membershipLevel).toBe('VIP');
    expect(snapshot.vipExpireDate?.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });

  it('builds stacked entitlement start from latest active end', () => {
    const paidAt = new Date('2026-03-26T10:00:00.000Z');
    const result = buildEntitlementWindow({
      userEntitlements: [
        createEntitlement({
          orderId: 'order-prev',
          effectiveEndAt: new Date('2026-04-25T10:00:00.000Z'),
        }),
      ],
      order: createOrder({
        id: 'order-new',
        orderNo: 'PO2',
        planCode: 'QUARTER',
      }),
      paidAt,
    });

    expect(result.isLifetime).toBe(false);
    expect(result.effectiveStartAt?.toISOString()).toBe('2026-04-25T10:00:00.000Z');
    expect(result.effectiveEndAt?.toISOString()).toBe('2026-07-24T10:00:00.000Z');
    expect(result.grantDays).toBe(90);
  });

  it('builds lifetime entitlement with null end date', () => {
    const paidAt = new Date('2026-03-26T10:00:00.000Z');
    const result = buildEntitlementWindow({
      userEntitlements: [
        createEntitlement({
          orderId: 'order-prev',
          effectiveEndAt: new Date('2026-04-25T10:00:00.000Z'),
        }),
      ],
      order: createOrder({
        id: 'order-lf',
        orderNo: 'PO3',
        planCode: 'LIFETIME',
      }),
      paidAt,
    });

    expect(result.isLifetime).toBe(true);
    expect(result.effectiveStartAt?.toISOString()).toBe('2026-03-26T10:00:00.000Z');
    expect(result.effectiveEndAt).toBeNull();
    expect(result.grantDays).toBeNull();
  });
});
