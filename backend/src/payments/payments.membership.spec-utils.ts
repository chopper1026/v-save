import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentOrderEntitlement } from './entities/payment-order-entitlement.entity';

export interface MembershipSnapshot {
  membershipLevel: 'FREE' | 'VIP';
  vipExpireDate: Date | null;
}

export const resolveMembershipSnapshotFromEntitlements = (
  entitlements: PaymentOrderEntitlement[],
  now: Date,
): MembershipSnapshot => {
  const activeEntitlements = entitlements.filter((item) => item.status === 'ACTIVE');
  if (!activeEntitlements.length) {
    return {
      membershipLevel: 'FREE',
      vipExpireDate: null,
    };
  }

  const hasLifetime = activeEntitlements.some((item) => item.isLifetime);
  if (hasLifetime) {
    return {
      membershipLevel: 'VIP',
      vipExpireDate: null,
    };
  }

  let maxExpireTime = 0;
  for (const item of activeEntitlements) {
    if (!item.effectiveEndAt) {
      continue;
    }
    const currentExpireTime = item.effectiveEndAt.getTime();
    if (currentExpireTime > maxExpireTime) {
      maxExpireTime = currentExpireTime;
    }
  }

  if (!maxExpireTime || maxExpireTime <= now.getTime()) {
    return {
      membershipLevel: 'FREE',
      vipExpireDate: null,
    };
  }

  return {
    membershipLevel: 'VIP',
    vipExpireDate: new Date(maxExpireTime),
  };
};

const computeOrderDurationDays = (planCode: string): number | null => {
  if (planCode === 'MONTH') {
    return 30;
  }
  if (planCode === 'QUARTER') {
    return 90;
  }
  if (planCode === 'YEAR') {
    return 365;
  }
  if (planCode === 'LIFETIME') {
    return null;
  }
  return null;
};

export const buildEntitlementWindow = (input: {
  userEntitlements: PaymentOrderEntitlement[];
  order: PaymentOrder;
  paidAt: Date;
}): {
  isLifetime: boolean;
  effectiveStartAt: Date | null;
  effectiveEndAt: Date | null;
  grantDays: number | null;
} => {
  const { userEntitlements, order, paidAt } = input;
  const durationDays = computeOrderDurationDays(order.planCode);
  const isLifetime = durationDays === null;

  if (isLifetime) {
    return {
      isLifetime: true,
      effectiveStartAt: paidAt,
      effectiveEndAt: null,
      grantDays: null,
    };
  }

  const activeTimedEntitlements = userEntitlements.filter(
    (item) => item.status === 'ACTIVE' && !item.isLifetime && !!item.effectiveEndAt,
  );

  let latestEndTime = 0;
  for (const item of activeTimedEntitlements) {
    const endTime = item.effectiveEndAt!.getTime();
    if (endTime > latestEndTime) {
      latestEndTime = endTime;
    }
  }

  const paidAtTime = paidAt.getTime();
  const startTime = latestEndTime > paidAtTime ? latestEndTime : paidAtTime;
  const endTime = startTime + durationDays * 24 * 60 * 60 * 1000;

  return {
    isLifetime: false,
    effectiveStartAt: new Date(startTime),
    effectiveEndAt: new Date(endTime),
    grantDays: durationDays,
  };
};
