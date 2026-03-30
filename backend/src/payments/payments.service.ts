import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { AdminUsersService } from '../admin/admin-users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';
import {
  CreatePaymentOrderDto,
  PaymentCurrency,
  PaymentPlanCode,
} from './dto/create-payment-order.dto';
import { QueryPaymentOrdersDto } from './dto/query-payment-orders.dto';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ReconcileDailyDto } from './dto/reconcile-daily.dto';
import { QueryAdminPaymentOrdersDto } from './dto/query-admin-payment-orders.dto';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { PaymentIdempotencyRecord } from './entities/payment-idempotency.entity';
import {
  PaymentOrder,
  PaymentOrderStatus,
} from './entities/payment-order.entity';
import { PaymentOrderEntitlement } from './entities/payment-order-entitlement.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentReconciliationRun } from './entities/payment-reconciliation-run.entity';
import { StripeProvider } from './providers/stripe.provider';
import { DownloadService } from '../download/download.service';

interface PriceConfig {
  amountMinor: number;
  currency: PaymentCurrency;
  durationDays: number | null;
  isLifetime: boolean;
}

export type CanonicalOrderStatus =
  | 'OPEN'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'CLOSED';

export type LegacyOrderViewStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'EXPIRED'
  | 'CANCELED';

export type OrderActionReasonCode =
  | 'ORDER_NOT_RECOVERABLE'
  | 'ORDER_ALREADY_PAID'
  | 'REFUND_WINDOW_EXPIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PENDING_ORDER_PLAN_MISMATCH'
  | null;

export interface OrderActionPayload {
  type: 'RESUME_PAYMENT' | 'VIEW_SUCCESS' | 'REQUEST_REFUND' | 'CREATE_NEW_ORDER' | 'NONE';
  label: string;
  enabled: boolean;
  reason: string | null;
  reasonCode: OrderActionReasonCode;
  kind: 'LINK' | 'API' | 'NONE';
  href?: string;
  method?: 'GET' | 'POST';
  endpoint?: string;
  requiresIdempotencyKey?: boolean;
  checkoutUrl?: string | null;
}

export interface OrderActionView {
  orderNo: string;
  reusedOrder?: boolean;
  planCode: PaymentPlanCode;
  planName: string;
  amountMinor: number;
  currency: PaymentCurrency;
  createdAt: Date;
  paidAt: Date | null;
  recoveryWindowEndsAt: Date | null;
  orderStatus: CanonicalOrderStatus;
  orderStatusLabel: string;
  closeReasonCode:
    | 'RECOVERY_WINDOW_EXPIRED'
    | 'MIGRATION_DUPLICATE_PENDING_ORDER'
    | 'ADMIN_CLOSED'
    | null;
  latestAttempt: {
    attemptNo: string;
    status: 'OPEN' | 'EXPIRED' | 'PAID' | 'FAILED';
    statusLabel: string;
    reasonCode: 'SESSION_EXPIRED' | 'ABANDONED_BY_USER' | 'EXPIRED_REPLACED' | 'PROVIDER_FAILED' | null;
    expiresAt: Date | null;
    finishedAt: Date | null;
    failureReason: string | null;
  } | null;
  primaryAction: OrderActionPayload;
  secondaryActions: Array<{
    type: 'VIEW_ORDER_DETAIL' | 'VIEW_SUCCESS' | 'REQUEST_REFUND' | 'CREATE_NEW_ORDER' | 'CONTACT_SUPPORT';
    label: string;
    enabled: boolean;
    reason: string | null;
    reasonCode: string | null;
    kind: 'LINK' | 'API' | 'NONE';
    href?: string;
    method?: 'GET' | 'POST';
    endpoint?: string;
    requiresIdempotencyKey?: boolean;
  }>;
  timeline: Array<{
    type:
      | 'ORDER_CREATED'
      | 'ATTEMPT_OPENED'
      | 'ATTEMPT_EXPIRED'
      | 'ATTEMPT_PAID'
      | 'REFUND_REQUESTED'
      | 'REFUND_COMPLETED'
      | 'ORDER_CLOSED'
      | 'ENTITLEMENT_REPAIRED';
    at: Date;
    title: string;
    detail: string;
  }>;
  refund: {
    eligible: boolean;
    deadlineAt: Date | null;
    reason: string | null;
    latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
  };
  status: LegacyOrderViewStatus;
  checkoutUrl: string | null;
}

export interface AdminOrderUserView {
  id: string;
  email: string | null;
  nickname: string | null;
  phone: string | null;
  membershipLevel: 'FREE' | 'VIP' | null;
  vipExpireDate: Date | null;
}

export interface AdminOrderListItemView {
  orderNo: string;
  planCode: PaymentPlanCode;
  planName: string;
  amountMinor: number;
  currency: PaymentCurrency;
  orderStatus: CanonicalOrderStatus;
  orderStatusLabel: string;
  refundStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
  createdAt: Date;
  paidAt: Date | null;
  latestAttempt: OrderActionView['latestAttempt'];
  primaryAction: OrderActionPayload;
  user: AdminOrderUserView;
}

export interface AdminOrderDetailView extends OrderActionView {
  user: AdminOrderUserView;
  entitlement: {
    planCode: PaymentPlanCode;
    status: 'ACTIVE' | 'REVOKED';
    grantDays: number | null;
    isLifetime: boolean;
    effectiveStartAt: Date | null;
    effectiveEndAt: Date | null;
    revokedAt: Date | null;
    revokedReason: string | null;
  } | null;
  providerRefs: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
  };
  latestRefundRecord: {
    refundNo: string;
    status: string;
    reason: string;
    requestedAt: Date;
    completedAt: Date | null;
    failureMessage: string | null;
  } | null;
  operations: {
    canManualRepair: boolean;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FREE_DAILY_DOWNLOAD_LIMIT = 5;
const FREE_SUPPORTED_PLATFORMS = ['douyin', 'bilibili'] as const;
const FREE_MAX_QUALITY = '720p';
const VIP_MAX_QUALITY = '4k';

const PLAN_PRICE_MAP: Record<PaymentPlanCode, Record<PaymentCurrency, number>> = {
  MONTH: {
    CNY: 690,
    USD: 399,
  },
  QUARTER: {
    CNY: 1990,
    USD: 1099,
  },
  YEAR: {
    CNY: 6990,
    USD: 3999,
  },
  LIFETIME: {
    CNY: 49900,
    USD: 8999,
  },
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentOrder)
    private readonly paymentOrderRepository: Repository<PaymentOrder>,
    @InjectRepository(PaymentAttempt)
    private readonly paymentAttemptRepository: Repository<PaymentAttempt>,
    @InjectRepository(PaymentIdempotencyRecord)
    private readonly paymentIdempotencyRepository: Repository<PaymentIdempotencyRecord>,
    @InjectRepository(PaymentOrderEntitlement)
    private readonly entitlementRepository: Repository<PaymentOrderEntitlement>,
    @InjectRepository(PaymentWebhookEvent)
    private readonly webhookEventRepository: Repository<PaymentWebhookEvent>,
    @InjectRepository(PaymentRefund)
    private readonly refundRepository: Repository<PaymentRefund>,
    @InjectRepository(PaymentReconciliationRun)
    private readonly reconciliationRepository: Repository<PaymentReconciliationRun>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly usersService: UsersService,
    private readonly adminUsersService: AdminUsersService,
    private readonly notificationsService: NotificationsService,
    private readonly stripeProvider: StripeProvider,
    private readonly downloadService: DownloadService,
    private readonly dataSource: DataSource,
  ) {}

  async createOrder(input: {
    userId: string;
    dto: CreatePaymentOrderDto;
    idempotencyKey: string;
  }) {
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const user = await this.usersService.findById(input.userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const preferredCurrency = input.dto.preferredCurrency || 'CNY';
    const price = this.resolvePrice(input.dto.planCode, preferredCurrency);

    return this.runIdempotentAction({
      ownerUserId: input.userId,
      scope: 'CREATE_ORDER',
      idempotencyKey,
      requestPayload: {
        userId: input.userId,
        planCode: input.dto.planCode,
        preferredCurrency,
        clientType: input.dto.clientType,
      },
      handler: async (manager) => {
        const recoverableOrder = await this.findRecoverableOrderForUser(input.userId, manager);
        if (recoverableOrder) {
          const view = await this.buildOrderActionViewForRead(recoverableOrder, {
            requestedPlanCode: input.dto.planCode,
            manager,
          });
          return {
            ...view,
            reusedOrder: true,
            checkoutUrl: null,
            primaryAction: {
              ...view.primaryAction,
              checkoutUrl: null,
              reasonCode:
                recoverableOrder.planCode === input.dto.planCode
                  ? view.primaryAction.reasonCode
                  : 'PENDING_ORDER_PLAN_MISMATCH',
              reason:
                recoverableOrder.planCode === input.dto.planCode
                  ? view.primaryAction.reason
                  : '你已有一个未完成的其他套餐订单，请先继续该订单或联系客服处理。',
            },
            secondaryActions: this.mergeSecondaryActions(view.secondaryActions, [
              {
                type: 'CONTACT_SUPPORT',
                label: '联系客服',
                enabled: true,
                reason: null,
                reasonCode:
                  recoverableOrder.planCode === input.dto.planCode ? null : 'PENDING_ORDER_PLAN_MISMATCH',
                kind: 'LINK',
                href: '/support',
              },
            ]),
          };
        }

        const now = new Date();
        const orderNo = this.generateOrderNo(now);
        const successUrl = this.resolveWebSuccessUrl(orderNo);
        const cancelUrl = this.resolveWebCancelUrl(orderNo);
        const checkoutSession = await this.createCheckoutSessionOrThrow({
          orderNo,
          userId: input.userId,
          amountMinor: price.amountMinor,
          currency: price.currency,
          planCode: input.dto.planCode,
          successUrl,
          cancelUrl,
          customerEmail: String(user.email || '').trim() || undefined,
        });

        const orderRepository = this.orderRepositoryOf(manager);
        const attemptRepository = this.attemptRepositoryOf(manager);

        const order = orderRepository.create({
          orderNo,
          userId: input.userId,
          provider: 'STRIPE',
          planCode: input.dto.planCode,
          planNameSnapshot: this.resolvePlanTitle(input.dto.planCode),
          durationDays: price.durationDays,
          isLifetime: price.isLifetime,
          preferredCurrency,
          resolvedCurrency: price.currency,
          amountMinor: price.amountMinor,
          status: 'OPEN',
          stripeCheckoutSessionId: checkoutSession.sessionId,
          stripePaymentIntentId: null,
          receiptEmail: String(user.email || '').trim(),
          invoiceEnabled: false,
          invoiceName: null,
          invoiceTaxId: null,
          refundWindowEndAt: null,
          recoveryWindowEndsAt: new Date(now.getTime() + RECOVERY_WINDOW_MS),
          paidAt: null,
          closedAt: null,
          closeReasonCode: null,
          recoverableOwnerUserId: input.userId,
        });
        const savedOrder = await orderRepository.save(order);

        const attempt = attemptRepository.create({
          attemptNo: this.generateAttemptNo(now),
          orderId: savedOrder.id,
          provider: 'STRIPE',
          status: 'OPEN',
          providerSessionId: checkoutSession.sessionId,
          paymentIntentId: null,
          checkoutUrl: checkoutSession.checkoutUrl,
          createdByAction: 'CREATE_ORDER',
          reasonCode: null,
          failureReason: null,
          expiresAt: checkoutSession.expiresAt,
          finishedAt: null,
          openAttemptOrderId: savedOrder.id,
        });
        const savedAttempt = await attemptRepository.save(attempt);

        return this.toOrderActionView(savedOrder, savedAttempt, null, {
          reusedOrder: false,
          immediateCheckoutUrl: checkoutSession.checkoutUrl,
        });
      },
    });
  }

  async getOrderForUser(input: { userId: string; orderNo: string }) {
    const normalizedOrderNo = String(input.orderNo || '').trim();
    const order = await this.paymentOrderRepository.findOne({
      where: {
        orderNo: normalizedOrderNo,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.userId !== input.userId) {
      throw new ForbiddenException('无权访问该订单');
    }

    return this.buildOrderActionViewForRead(order, {
      syncStripeWhenOpen: true,
    });
  }

  async recheckoutPendingOrder(input: { userId: string; orderNo: string; idempotencyKey: string }) {
    const normalizedOrderNo = String(input.orderNo || '').trim();
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const user = await this.usersService.findById(input.userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.runIdempotentAction({
      ownerUserId: input.userId,
      scope: `RECHECKOUT:${normalizedOrderNo}`,
      idempotencyKey,
      requestPayload: {
        userId: input.userId,
        orderNo: normalizedOrderNo,
      },
      handler: async (manager) => {
        const orderRepository = this.orderRepositoryOf(manager);
        const attemptRepository = this.attemptRepositoryOf(manager);

        let order = await orderRepository.findOne({
          where: {
            orderNo: normalizedOrderNo,
          },
        });

        if (!order) {
          throw new NotFoundException('订单不存在');
        }

        if (order.userId !== input.userId) {
          throw new ForbiddenException('无权访问该订单');
        }

        order = await this.normalizeOrderState(order, manager);
        if (this.resolveCanonicalOrderStatus(order) !== 'OPEN') {
          throw new BadRequestException('当前订单状态不支持继续支付');
        }

        const now = new Date();
        const successUrl = this.resolveWebSuccessUrl(order.orderNo);
        const cancelUrl = this.resolveWebCancelUrl(order.orderNo);
        const checkoutSession = await this.createCheckoutSessionOrThrow({
          orderNo: order.orderNo,
          userId: input.userId,
          amountMinor: order.amountMinor,
          currency: order.resolvedCurrency,
          planCode: order.planCode,
          successUrl,
          cancelUrl,
          customerEmail: String(user.email || '').trim() || undefined,
        });

        const openAttempts = await attemptRepository.find({
          where: {
            orderId: order.id,
            status: 'OPEN',
          },
          order: {
            createdAt: 'DESC',
          },
        });

        for (const item of openAttempts) {
          if (
            item.providerSessionId
            && item.providerSessionId !== checkoutSession.sessionId
            && item.expiresAt
            && item.expiresAt.getTime() > now.getTime()
          ) {
            await this.stripeProvider.expireCheckoutSession(item.providerSessionId);
          }
          item.status = 'EXPIRED';
          item.reasonCode = 'EXPIRED_REPLACED';
          item.finishedAt = now;
          item.openAttemptOrderId = null;
          await attemptRepository.save(item);
        }

        order.status = 'OPEN';
        order.stripeCheckoutSessionId = checkoutSession.sessionId;
        order.recoverableOwnerUserId = order.userId;
        order.recoveryWindowEndsAt = order.recoveryWindowEndsAt || new Date(order.createdAt.getTime() + RECOVERY_WINDOW_MS);
        order.closedAt = null;
        order.closeReasonCode = null;
        order = await orderRepository.save(order);

        const attempt = attemptRepository.create({
          attemptNo: this.generateAttemptNo(now),
          orderId: order.id,
          provider: 'STRIPE',
          status: 'OPEN',
          providerSessionId: checkoutSession.sessionId,
          paymentIntentId: null,
          checkoutUrl: checkoutSession.checkoutUrl,
          createdByAction: 'RECHECKOUT',
          reasonCode: null,
          failureReason: null,
          expiresAt: checkoutSession.expiresAt,
          finishedAt: null,
          openAttemptOrderId: order.id,
        });
        const savedAttempt = await attemptRepository.save(attempt);

        return this.toOrderActionView(order, savedAttempt, null, {
          immediateCheckoutUrl: checkoutSession.checkoutUrl,
        });
      },
    });
  }

  async listOrdersForUser(input: {
    userId: string;
    query: QueryPaymentOrdersDto;
  }) {
    const page = Math.max(1, Number(input.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(input.query.pageSize || 20)));
    const orders = await this.paymentOrderRepository.find({
      where: {
        userId: input.userId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    const summaries: OrderActionView[] = [];
    for (const order of orders) {
      const view = await this.buildOrderActionViewForRead(order);
      if (!this.matchesStatusFilter(view, input.query.status)) {
        continue;
      }
      summaries.push(view);
    }

    const start = (page - 1) * pageSize;
    const items = summaries.slice(start, start + pageSize);

    return {
      items,
      total: summaries.length,
      page,
      pageSize,
    };
  }

  async listOrdersForAdmin(input: {
    query: QueryAdminPaymentOrdersDto;
  }): Promise<{
    items: AdminOrderListItemView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(input.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.query.pageSize || 20)));
    const qb = this.paymentOrderRepository.createQueryBuilder('paymentOrder');

    qb.leftJoin('users', 'user', 'user.id = paymentOrder.userId');

    const keyword = String(input.query.keyword || '').trim();
    if (keyword) {
      qb.andWhere(
        '(paymentOrder.orderNo LIKE :keyword OR user.email LIKE :keyword OR user.nickname LIKE :keyword OR user.phone LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (input.query.status) {
      qb.andWhere('paymentOrder.status IN (:...statuses)', {
        statuses: this.mapAdminStatusesToStoredStatuses(input.query.status),
      });
    }

    if (input.query.planCode) {
      qb.andWhere('paymentOrder.planCode = :planCode', {
        planCode: input.query.planCode,
      });
    }

    const createdFrom = this.parseAdminQueryDate(input.query.createdFrom);
    if (createdFrom) {
      qb.andWhere('paymentOrder.createdAt >= :createdFrom', {
        createdFrom,
      });
    }

    const createdTo = this.parseAdminQueryDate(input.query.createdTo, true);
    if (createdTo) {
      qb.andWhere('paymentOrder.createdAt <= :createdTo', {
        createdTo,
      });
    }

    qb
      .orderBy('paymentOrder.createdAt', 'DESC')
      .addOrderBy('paymentOrder.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [orders, total] = await qb.getManyAndCount();
    const users = await this.userRepository.find({
      where: {
        id: In(Array.from(new Set(orders.map((item) => item.userId).filter(Boolean)))),
      },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));

    const items = await Promise.all(
      orders.map(async (order) => {
        const view = await this.buildOrderActionViewForRead(order);
        return {
          orderNo: view.orderNo,
          planCode: view.planCode,
          planName: view.planName,
          amountMinor: view.amountMinor,
          currency: view.currency,
          orderStatus: view.orderStatus,
          orderStatusLabel: view.orderStatusLabel,
          refundStatus: view.refund.latestStatus,
          createdAt: view.createdAt,
          paidAt: view.paidAt,
          latestAttempt: view.latestAttempt,
          primaryAction: view.primaryAction,
          user: this.toAdminOrderUserView(userMap.get(order.userId), order.userId),
        };
      }),
    );

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getOrderForAdmin(input: {
    orderNo: string;
  }): Promise<AdminOrderDetailView> {
    const normalizedOrderNo = String(input.orderNo || '').trim();
    const order = await this.paymentOrderRepository.findOne({
      where: {
        orderNo: normalizedOrderNo,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const view = await this.buildOrderActionViewForRead(order, {
      syncStripeWhenOpen: true,
    });
    const [user, entitlement, latestRefund] = await Promise.all([
      this.userRepository.findOne({
        where: {
          id: order.userId,
        },
      }),
      this.entitlementRepository.findOne({
        where: {
          orderId: order.id,
        },
      }),
      this.findLatestRefund(order.id),
    ]);

    return {
      ...view,
      user: this.toAdminOrderUserView(user, order.userId),
      entitlement: entitlement
        ? {
            planCode: entitlement.planCode,
            status: entitlement.status,
            grantDays: entitlement.grantDays,
            isLifetime: entitlement.isLifetime,
            effectiveStartAt: entitlement.effectiveStartAt || null,
            effectiveEndAt: entitlement.effectiveEndAt || null,
            revokedAt: entitlement.revokedAt || null,
            revokedReason: entitlement.revokedReason || null,
          }
        : null,
      providerRefs: {
        checkoutSessionId: order.stripeCheckoutSessionId || null,
        paymentIntentId: order.stripePaymentIntentId || null,
      },
      latestRefundRecord: latestRefund
        ? {
            refundNo: latestRefund.refundNo,
            status: latestRefund.status,
            reason: latestRefund.reason,
            requestedAt: latestRefund.requestedAt,
            completedAt: latestRefund.completedAt || null,
            failureMessage: latestRefund.failureMessage || null,
          }
        : null,
      operations: {
        canManualRepair: view.orderStatus === 'PAID',
      },
    };
  }

  async getSubscriptionStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const membershipLevel = user.membershipLevel === 'VIP' ? 'VIP' : 'FREE';
    const usedToday = membershipLevel === 'VIP'
      ? 0
      : await this.downloadService.getFreeDownloadUsageToday(userId);
    const dailyLimit = membershipLevel === 'VIP' ? null : FREE_DAILY_DOWNLOAD_LIMIT;
    const remainingToday = membershipLevel === 'VIP'
      ? null
      : Math.max(0, FREE_DAILY_DOWNLOAD_LIMIT - usedToday);

    return {
      membershipLevel,
      vipExpireDate: user.vipExpireDate || null,
      isLifetime: membershipLevel === 'VIP' && !user.vipExpireDate,
      benefits: {
        supportedPlatforms: membershipLevel === 'VIP'
          ? 'ALL'
          : [...FREE_SUPPORTED_PLATFORMS],
        maxQuality: membershipLevel === 'VIP' ? VIP_MAX_QUALITY : FREE_MAX_QUALITY,
        unlimitedDownloads: membershipLevel === 'VIP',
      },
      quota: {
        usedToday,
        remainingToday,
        dailyLimit,
      },
    };
  }

  async requestRefund(input: {
    userId: string;
    orderNo: string;
    dto: RequestRefundDto;
    idempotencyKey: string;
  }) {
    const normalizedOrderNo = String(input.orderNo || '').trim();
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);

    return this.runIdempotentAction({
      ownerUserId: input.userId,
      scope: `REQUEST_REFUND:${normalizedOrderNo}`,
      idempotencyKey,
      requestPayload: {
        userId: input.userId,
        orderNo: normalizedOrderNo,
        reason: String(input.dto.reason || '').trim(),
      },
      handler: async (manager) => {
        const orderRepository = this.orderRepositoryOf(manager);
        const refundRepository = this.refundRepositoryOf(manager);

        let order = await orderRepository.findOne({
          where: {
            orderNo: normalizedOrderNo,
          },
        });

        if (!order) {
          throw new NotFoundException('订单不存在');
        }

        if (order.userId !== input.userId) {
          throw new ForbiddenException('无权退款该订单');
        }

        order = await this.normalizeOrderState(order, manager);
        const canonicalStatus = this.resolveCanonicalOrderStatus(order);
        if (canonicalStatus !== 'PAID' && canonicalStatus !== 'REFUND_FAILED') {
          throw new BadRequestException('当前订单状态不支持退款');
        }

        const now = new Date();
        if (order.refundWindowEndAt && order.refundWindowEndAt.getTime() < now.getTime()) {
          throw new BadRequestException('订单已超过退款窗口');
        }

        const refundNo = this.generateRefundNo(now);
        const refund = refundRepository.create({
          refundNo,
          orderId: order.id,
          userId: input.userId,
          status: 'PENDING_PROVIDER',
          amountMinor: order.amountMinor,
          currency: order.resolvedCurrency,
          reason: String(input.dto.reason || '').trim(),
          requestedByType: 'USER',
          requestedByUserId: input.userId,
          stripeRefundId: null,
          idempotencyKey,
          requestedAt: now,
          decidedAt: null,
          completedAt: null,
          failureCode: null,
          failureMessage: null,
        });

        const refundResult = await this.createRefundOrThrow({
          paymentIntentId: String(order.stripePaymentIntentId || '').trim(),
          amountMinor: order.amountMinor,
          reason: refund.reason,
          idempotencyKey,
        });

        refund.stripeRefundId = refundResult.refundId;
        if (refundResult.status === 'succeeded') {
          refund.status = 'SUCCEEDED';
          refund.decidedAt = now;
          refund.completedAt = now;
          order.status = 'REFUNDED';
        } else if (refundResult.status === 'failed') {
          refund.status = 'FAILED';
          refund.decidedAt = now;
          refund.failureCode = 'PROVIDER_REFUND_FAILED';
          order.status = 'REFUND_FAILED';
        } else {
          refund.status = 'PENDING_PROVIDER';
          order.status = 'REFUND_PENDING';
        }

        const savedRefund = await refundRepository.save(refund);
        order.recoverableOwnerUserId = null;
        order = await orderRepository.save(order);

        if (savedRefund.status === 'SUCCEEDED') {
          await this.revokeOrderEntitlement(order.id, 'REFUND_SUCCEEDED', manager);
          await this.rebuildUserMembershipWithManager(manager, order.userId);
        }

        return this.toRefundView(savedRefund);
      },
    });
  }

  async handleStripeWebhook(input: { rawBody: Buffer; signature: string }) {
    let verified;
    try {
      verified = this.stripeProvider.verifyWebhook(input.rawBody, input.signature);
    } catch (_error) {
      throw new BadRequestException('支付回调验签失败');
    }

    const existed = await this.webhookEventRepository.findOne({
      where: {
        provider: 'STRIPE',
        eventId: verified.id,
      },
    });

    if (existed) {
      return { duplicated: true };
    }

    const event = this.webhookEventRepository.create({
      provider: 'STRIPE',
      eventId: verified.id,
      eventType: verified.type,
      signatureVerified: true,
      payloadJson: verified.data,
      processStatus: 'PENDING',
      errorCode: null,
      errorMessage: null,
      receivedAt: new Date(),
      processedAt: null,
    });

    await this.webhookEventRepository.save(event);

    try {
      if (verified.type === 'checkout.session.completed') {
        await this.handleCheckoutCompletedEvent(verified.data);
      } else if (verified.type === 'checkout.session.expired') {
        await this.handleCheckoutExpiredEvent(verified.data);
      } else if (verified.type === 'refund.updated') {
        await this.handleRefundUpdatedEvent(verified.data);
      }

      event.processStatus = 'PROCESSED';
      event.processedAt = new Date();
      await this.webhookEventRepository.save(event);
      return { duplicated: false };
    } catch (error: any) {
      event.processStatus = 'FAILED';
      event.errorCode = 'WEBHOOK_HANDLE_FAILED';
      event.errorMessage = String(error?.message || 'unknown').slice(0, 255);
      event.processedAt = new Date();
      await this.webhookEventRepository.save(event);
      throw error;
    }
  }

  async runDailyReconciliation(input: {
    operatorUserId: string;
    dto: ReconcileDailyDto;
  }) {
    const bizDate = String(input.dto.date || '').trim();
    if (!bizDate) {
      throw new BadRequestException('缺少对账日期');
    }

    const existed = await this.reconciliationRepository.findOne({
      where: {
        bizDate,
      },
    });

    if (existed && !input.dto.force) {
      return existed;
    }

    const run = existed ||
      this.reconciliationRepository.create({
        bizDate,
        status: 'RUNNING',
        platformOrderCount: 0,
        localPaidOrderCount: 0,
        diffCount: 0,
        reportJson: null,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
      });

    run.status = 'RUNNING';
    run.startedAt = new Date();
    run.finishedAt = null;
    run.errorMessage = null;

    try {
      const { start, end } = this.resolveBizDateRange(input.dto.date);
      const [platformOrders, localPaidCount] = await Promise.all([
        this.stripeProvider.fetchDailyLedger({ bizDate }),
        this.paymentOrderRepository.count({
          where: {
            status: 'PAID',
            paidAt: Between(start, end),
          },
        }),
      ]);

      run.platformOrderCount = platformOrders.length;
      run.localPaidOrderCount = localPaidCount;
      run.diffCount = Math.max(0, Math.abs(platformOrders.length - localPaidCount));
      run.reportJson = {
        bizDate,
        platformOrderCount: platformOrders.length,
        localPaidOrderCount: localPaidCount,
      };
      run.status = 'DONE';
      run.finishedAt = new Date();

      const saved = await this.reconciliationRepository.save(run);

      await this.adminUsersService.recordAuditLog({
        adminUserId: input.operatorUserId,
        action: 'PAYMENT_RECONCILIATION_RUN',
        module: 'PAYMENT',
        platform: 'NONE',
        targetType: 'SYSTEM',
        reason: `支付对账完成 ${bizDate}`,
        afterState: {
          bizDate,
          diffCount: saved.diffCount,
          platformOrderCount: saved.platformOrderCount,
          localPaidOrderCount: saved.localPaidOrderCount,
        },
      });

      return saved;
    } catch (error: any) {
      run.status = 'FAILED';
      run.errorMessage = String(error?.message || 'unknown').slice(0, 255);
      run.finishedAt = new Date();
      return this.reconciliationRepository.save(run);
    }
  }

  async manualRepairOrder(input: { orderNo: string; operatorUserId: string }) {
    const order = await this.paymentOrderRepository.findOne({
      where: {
        orderNo: String(input.orderNo || '').trim(),
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const canonicalStatus = this.resolveCanonicalOrderStatus(order);
    if (canonicalStatus !== 'PAID') {
      throw new BadRequestException('仅已支付订单支持补单');
    }

    await this.ensureEntitlementForOrder(order.id, order.userId, order.paidAt || new Date(), order.planCode);
    await this.rebuildUserMembership(order.userId);

    await this.adminUsersService.recordAuditLog({
      adminUserId: input.operatorUserId,
      action: 'PAYMENT_MANUAL_REPAIR',
      module: 'PAYMENT',
      platform: 'NONE',
      targetType: 'SYSTEM',
      reason: `支付订单补单 ${order.orderNo}`,
      afterState: {
        orderNo: order.orderNo,
      },
    });

    return {
      orderNo: order.orderNo,
      repaired: true,
    };
  }

  private async handleCheckoutCompletedEvent(data: Record<string, any>, manager?: EntityManager) {
    if (manager) {
      await this.handleCheckoutCompletedEventWithManager(data, manager);
      return;
    }

    await this.dataSource.transaction(async (transactionManager) => {
      await this.handleCheckoutCompletedEventWithManager(data, transactionManager);
    });
  }

  private async handleCheckoutCompletedEventWithManager(
    data: Record<string, any>,
    manager: EntityManager,
  ) {
    const sessionId = String(data?.object?.id || data?.id || '').trim();
    if (!sessionId) {
      return;
    }

    const paymentStatus = String(
      data?.object?.payment_status || data?.payment_status || '',
    ).trim();
    if (paymentStatus !== 'paid') {
      return;
    }

    const paymentIntentId = String(
      data?.object?.payment_intent || data?.payment_intent || '',
    ).trim();
    const paidAtTs = Number(data?.object?.created || data?.created || 0);
    const paidAt = Number.isFinite(paidAtTs) && paidAtTs > 0
      ? new Date(paidAtTs * 1000)
      : new Date();

    const attemptRepository = this.attemptRepositoryOf(manager);
    const orderRepository = this.orderRepositoryOf(manager);
    const attempt = await attemptRepository.findOne({
      where: {
        providerSessionId: sessionId,
      },
    });

    if (attempt) {
      if (attempt.status !== 'PAID') {
        attempt.status = 'PAID';
        attempt.paymentIntentId = paymentIntentId || attempt.paymentIntentId;
        attempt.finishedAt = paidAt;
        attempt.openAttemptOrderId = null;
        attempt.reasonCode = null;
        await attemptRepository.save(attempt);
      }

      const order = await orderRepository.findOne({
        where: {
          id: attempt.orderId,
        },
      });
      if (!order) {
        return;
      }

      await this.applyPaidOrderState(order, {
        paidAt,
        paymentIntentId,
        sessionId,
        manager,
      });
      await this.closeOtherOpenAttemptsForPaidOrder(order.id, attempt.id, paidAt, manager);
      return;
    }

    const legacyOrder = await orderRepository.findOne({
      where: {
        stripeCheckoutSessionId: sessionId,
      },
    });
    if (!legacyOrder) {
      return;
    }

    await this.applyPaidOrderState(legacyOrder, {
      paidAt,
      paymentIntentId,
      sessionId,
      manager,
    });
  }

  private async handleCheckoutExpiredEvent(data: Record<string, any>, manager?: EntityManager) {
    if (manager) {
      await this.handleCheckoutExpiredEventWithManager(data, manager);
      return;
    }

    await this.dataSource.transaction(async (transactionManager) => {
      await this.handleCheckoutExpiredEventWithManager(data, transactionManager);
    });
  }

  private async handleCheckoutExpiredEventWithManager(
    data: Record<string, any>,
    manager: EntityManager,
  ) {
    const sessionId = String(data?.object?.id || data?.id || '').trim();
    if (!sessionId) {
      return;
    }

    const finishedAtTs = Number(data?.object?.created || data?.created || 0);
    const finishedAt = Number.isFinite(finishedAtTs) && finishedAtTs > 0
      ? new Date(finishedAtTs * 1000)
      : new Date();

    const attemptRepository = this.attemptRepositoryOf(manager);
    const orderRepository = this.orderRepositoryOf(manager);
    const attempt = await attemptRepository.findOne({
      where: {
        providerSessionId: sessionId,
      },
    });

    if (attempt) {
      if (attempt.status === 'OPEN') {
        attempt.status = 'EXPIRED';
        attempt.reasonCode = 'SESSION_EXPIRED';
        attempt.finishedAt = finishedAt;
        attempt.openAttemptOrderId = null;
        await attemptRepository.save(attempt);
      }

      const order = await orderRepository.findOne({
        where: {
          id: attempt.orderId,
        },
      });
      if (!order) {
        return;
      }

      await this.normalizeOrderState(order, manager);
      await this.syncOrderAggregateState(order, await this.findLatestAttempt(order.id, manager), manager);
      return;
    }

    const legacyOrder = await orderRepository.findOne({
      where: {
        stripeCheckoutSessionId: sessionId,
      },
    });
    if (!legacyOrder) {
      return;
    }

    await this.normalizeOrderState(legacyOrder, manager);
    await this.syncOrderAggregateState(legacyOrder, null, manager);
  }

  private async handleRefundUpdatedEvent(data: Record<string, any>, manager?: EntityManager) {
    if (manager) {
      await this.handleRefundUpdatedEventWithManager(data, manager);
      return;
    }

    await this.dataSource.transaction(async (transactionManager) => {
      await this.handleRefundUpdatedEventWithManager(data, transactionManager);
    });
  }

  private async handleRefundUpdatedEventWithManager(
    data: Record<string, any>,
    manager: EntityManager,
  ) {
    const stripeRefundId = String(data?.object?.id || data?.id || '').trim();
    if (!stripeRefundId) {
      return;
    }

    const status = String(data?.object?.status || data?.status || '').trim();
    if (status !== 'succeeded') {
      return;
    }

    const refundRepository = this.refundRepositoryOf(manager);
    const orderRepository = this.orderRepositoryOf(manager);
    const refund = await refundRepository.findOne({
      where: {
        stripeRefundId,
      },
    });
    if (!refund) {
      return;
    }

    const order = await orderRepository.findOne({
      where: {
        id: refund.orderId,
      },
    });
    if (!order) {
      return;
    }

    const now = new Date();
    if (refund.status !== 'SUCCEEDED') {
      refund.status = 'SUCCEEDED';
      refund.decidedAt = now;
      refund.completedAt = now;
      await refundRepository.save(refund);
    }

    order.status = 'REFUNDED';
    order.recoverableOwnerUserId = null;
    await orderRepository.save(order);

    await this.revokeOrderEntitlement(order.id, 'REFUND_SUCCEEDED', manager);
    await this.rebuildUserMembershipWithManager(manager, order.userId);
  }

  private async revokeOrderEntitlement(orderId: string, reason: string, manager?: EntityManager) {
    const entitlementRepository = this.entitlementRepositoryOf(manager);
    const entitlement = await entitlementRepository.findOne({
      where: {
        orderId,
      },
    });

    if (!entitlement || entitlement.status !== 'ACTIVE') {
      return;
    }

    entitlement.status = 'REVOKED';
    entitlement.revokedAt = new Date();
    entitlement.revokedReason = String(reason || '').trim().slice(0, 120) || null;
    await entitlementRepository.save(entitlement);
  }

  private async ensureEntitlementForOrder(
    orderId: string,
    userId: string,
    paidAt: Date,
    planCode: PaymentPlanCode,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await this.ensureEntitlementForOrderWithManager(
        manager,
        orderId,
        userId,
        paidAt,
        planCode,
      );
    });
  }

  private async ensureEntitlementForOrderWithManager(
    manager: EntityManager,
    orderId: string,
    userId: string,
    paidAt: Date,
    planCode: PaymentPlanCode,
  ) {
    const entitlementRepository = this.entitlementRepositoryOf(manager);
    const existed = await entitlementRepository.findOne({
      where: {
        orderId,
      },
    });
    if (existed) {
      return existed;
    }

    const userEntitlements = await entitlementRepository.find({
      where: {
        userId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    const isLifetime = planCode === 'LIFETIME';
    const grantDays = this.resolveDurationDaysByPlan(planCode);

    let effectiveStartAt: Date | null = paidAt;
    let effectiveEndAt: Date | null = null;

    if (!isLifetime && grantDays) {
      let latestEndTime = paidAt.getTime();
      for (const item of userEntitlements) {
        if (item.status !== 'ACTIVE' || item.isLifetime || !item.effectiveEndAt) {
          continue;
        }
        const endTime = item.effectiveEndAt.getTime();
        if (endTime > latestEndTime) {
          latestEndTime = endTime;
        }
      }
      effectiveStartAt = new Date(latestEndTime);
      effectiveEndAt = new Date(latestEndTime + grantDays * DAY_MS);
    }

    const entity = entitlementRepository.create({
      orderId,
      userId,
      planCode,
      isLifetime,
      grantDays,
      status: 'ACTIVE',
      effectiveStartAt,
      effectiveEndAt,
      revokedAt: null,
      revokedReason: null,
    });
    return entitlementRepository.save(entity);
  }

  private async rebuildUserMembership(userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.rebuildUserMembershipWithManager(manager, userId);
    });
  }

  private async rebuildUserMembershipWithManager(manager: EntityManager, userId: string) {
    const entitlementRepository = this.entitlementRepositoryOf(manager);
    const activeEntitlements = await entitlementRepository.find({
      where: {
        userId,
        status: 'ACTIVE',
      },
      order: {
        createdAt: 'ASC',
      },
    });

    if (!activeEntitlements.length) {
      await this.usersService.updateVIPStatus(userId, false, undefined);
      return;
    }

    const hasLifetime = activeEntitlements.some((item) => item.isLifetime);
    if (hasLifetime) {
      await this.usersService.updateVIPStatus(userId, true, undefined);
      return;
    }

    const now = Date.now();
    let maxExpireTime = 0;
    for (const item of activeEntitlements) {
      const endTime = item.effectiveEndAt?.getTime() || 0;
      if (endTime > maxExpireTime) {
        maxExpireTime = endTime;
      }
    }

    if (!maxExpireTime || maxExpireTime <= now) {
      await this.usersService.updateVIPStatus(userId, false, undefined);
      return;
    }

    await this.usersService.updateVIPStatus(userId, true, new Date(maxExpireTime));
  }

  private async runIdempotentAction<T extends Record<string, any>>(input: {
    ownerUserId: string;
    scope: string;
    idempotencyKey: string;
    requestPayload: Record<string, any>;
    handler: (manager: EntityManager) => Promise<T>;
  }): Promise<T> {
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);

    return this.dataSource.transaction(async (manager) => {
      const repository = this.idempotencyRepositoryOf(manager);
      const requestHash = this.buildIdempotencyHash(input.requestPayload);
      const existed = await repository.findOne({
        where: {
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          idempotencyKey,
        },
      });

      if (existed) {
        if (existed.requestHash !== requestHash) {
          throw new BadRequestException('Idempotency-Key 与请求内容不匹配');
        }
        return existed.responseJson as T;
      }

      const response = await input.handler(manager);
      await repository.save(repository.create({
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        idempotencyKey,
        requestHash,
        responseJson: response,
      }));
      return response;
    });
  }

  private async buildOrderActionViewForRead(
    rawOrder: PaymentOrder,
    input?: {
      requestedPlanCode?: PaymentPlanCode;
      syncStripeWhenOpen?: boolean;
      manager?: EntityManager;
    },
  ): Promise<OrderActionView> {
    let order = await this.normalizeOrderState(rawOrder, input?.manager);
    let latestAttempt = await this.findLatestAttempt(order.id, input?.manager);
    latestAttempt = await this.normalizeAttemptState(latestAttempt, input?.manager);
    order = await this.syncOrderAggregateState(order, latestAttempt, input?.manager);

    if (input?.syncStripeWhenOpen && order.status === 'OPEN' && latestAttempt?.status === 'OPEN') {
      try {
        const checkoutSession = await this.stripeProvider.retrieveCheckoutSession(latestAttempt.providerSessionId);
        if (checkoutSession.paymentStatus === 'paid') {
          await this.handleCheckoutCompletedEvent({
            object: {
              id: checkoutSession.sessionId,
              payment_status: 'paid',
              payment_intent: checkoutSession.paymentIntentId,
              created: checkoutSession.paidAt
                ? Math.floor(checkoutSession.paidAt.getTime() / 1000)
                : Math.floor(Date.now() / 1000),
            },
          });
          order = await this.paymentOrderRepository.findOne({
            where: {
              id: order.id,
            },
          }) || order;
          latestAttempt = await this.findLatestAttempt(order.id);
          latestAttempt = await this.normalizeAttemptState(latestAttempt);
          order = await this.syncOrderAggregateState(order, latestAttempt);
        }
      } catch (_error) {
        // ignore provider read failures on view path
      }
    }

    const latestRefund = await this.findLatestRefund(order.id, input?.manager);
    return this.toOrderActionView(order, latestAttempt, latestRefund, {
      requestedPlanCode: input?.requestedPlanCode,
    });
  }

  private toOrderActionView(
    order: PaymentOrder,
    latestAttempt: PaymentAttempt | null,
    latestRefund: PaymentRefund | null,
    options?: {
      reusedOrder?: boolean;
      requestedPlanCode?: PaymentPlanCode;
      immediateCheckoutUrl?: string | null;
    },
  ): OrderActionView {
    const orderStatus = this.resolveCanonicalOrderStatus(order);
    const latestAttemptView = latestAttempt
      ? {
          attemptNo: latestAttempt.attemptNo,
          status: latestAttempt.status,
          statusLabel: this.getAttemptStatusLabel(latestAttempt.status),
          reasonCode: latestAttempt.reasonCode,
          expiresAt: latestAttempt.expiresAt || null,
          finishedAt: latestAttempt.finishedAt || null,
          failureReason: latestAttempt.failureReason || null,
        }
      : null;

    const refund = this.buildRefundSummary(order, latestRefund);
    const primaryAction = this.buildPrimaryAction(order, refund, {
      requestedPlanCode: options?.requestedPlanCode,
      immediateCheckoutUrl: options?.immediateCheckoutUrl,
    });
    const secondaryActions = this.buildSecondaryActions(order, refund, {
      requestedPlanCode: options?.requestedPlanCode,
    });

    return {
      orderNo: order.orderNo,
      reusedOrder: options?.reusedOrder,
      planCode: order.planCode,
      planName: order.planNameSnapshot || this.resolvePlanTitle(order.planCode),
      amountMinor: order.amountMinor,
      currency: order.resolvedCurrency,
      createdAt: order.createdAt,
      paidAt: order.paidAt || null,
      recoveryWindowEndsAt: order.recoveryWindowEndsAt || null,
      orderStatus,
      orderStatusLabel: this.getOrderStatusLabel(orderStatus, order.closeReasonCode),
      closeReasonCode: order.closeReasonCode,
      latestAttempt: latestAttemptView,
      primaryAction,
      secondaryActions,
      timeline: this.buildTimeline(order, latestAttempt, latestRefund),
      refund,
      status: this.toLegacyOrderViewStatus(orderStatus, order.closeReasonCode),
      checkoutUrl: primaryAction.checkoutUrl || null,
    };
  }

  private buildRefundSummary(order: PaymentOrder, latestRefund: PaymentRefund | null): {
    eligible: boolean;
    deadlineAt: Date | null;
    reason: string | null;
    latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
  } {
    const canonicalStatus = this.resolveCanonicalOrderStatus(order);
    let latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' = 'NONE';
    if (canonicalStatus === 'REFUND_PENDING') {
      latestStatus = 'REFUND_PENDING';
    } else if (canonicalStatus === 'REFUNDED') {
      latestStatus = 'REFUNDED';
    } else if (canonicalStatus === 'REFUND_FAILED') {
      latestStatus = 'REFUND_FAILED';
    }

    const now = Date.now();
    const deadlineAt = order.refundWindowEndAt || null;
    if ((canonicalStatus === 'PAID' || canonicalStatus === 'REFUND_FAILED') && deadlineAt && deadlineAt.getTime() > now) {
      return {
        eligible: true,
        deadlineAt,
        reason: latestStatus === 'REFUND_FAILED' ? '上次退款失败，可重新发起退款。' : null,
        latestStatus,
      };
    }

    if ((canonicalStatus === 'PAID' || canonicalStatus === 'REFUND_FAILED') && !deadlineAt) {
      return {
        eligible: true,
        deadlineAt: null,
        reason: null,
        latestStatus,
      };
    }

    if (latestStatus === 'REFUND_PENDING') {
      return {
        eligible: false,
        deadlineAt,
        reason: '退款处理中，请等待结果。',
        latestStatus,
      };
    }

    if (latestStatus === 'REFUNDED') {
      return {
        eligible: false,
        deadlineAt,
        reason: '该订单已完成退款。',
        latestStatus,
      };
    }

    if ((canonicalStatus === 'PAID' || canonicalStatus === 'REFUND_FAILED') && deadlineAt && deadlineAt.getTime() <= now) {
      return {
        eligible: false,
        deadlineAt,
        reason: '订单已超过退款窗口。',
        latestStatus,
      };
    }

    if (latestRefund?.status === 'SUCCEEDED') {
      return {
        eligible: false,
        deadlineAt,
        reason: '该订单已完成退款。',
        latestStatus: 'REFUNDED',
      };
    }

    return {
      eligible: false,
      deadlineAt,
      reason: canonicalStatus === 'OPEN' || canonicalStatus === 'CLOSED'
        ? '订单尚未支付，暂不可退款。'
        : null,
      latestStatus,
    };
  }

  private buildPrimaryAction(
    order: PaymentOrder,
    refund: {
      eligible: boolean;
      deadlineAt: Date | null;
      reason: string | null;
      latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
    },
    options?: {
      requestedPlanCode?: PaymentPlanCode;
      immediateCheckoutUrl?: string | null;
    },
  ): OrderActionPayload {
    const canonicalStatus = this.resolveCanonicalOrderStatus(order);
    const planMismatch = Boolean(
      options?.requestedPlanCode
      && options.requestedPlanCode !== order.planCode
      && canonicalStatus === 'OPEN',
    );

    if (canonicalStatus === 'OPEN') {
      return {
        type: 'RESUME_PAYMENT',
        label: '继续支付',
        enabled: true,
        reason: planMismatch ? '当前有其他套餐的未完成订单，请先处理该订单。' : null,
        reasonCode: planMismatch ? 'PENDING_ORDER_PLAN_MISMATCH' : null,
        kind: 'API',
        method: 'POST',
        endpoint: `/payments/orders/${encodeURIComponent(order.orderNo)}/recheckout`,
        requiresIdempotencyKey: true,
        checkoutUrl: options?.immediateCheckoutUrl || null,
      };
    }

    if (canonicalStatus === 'PAID') {
      return {
        type: 'VIEW_SUCCESS',
        label: '查看会员权益',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'LINK',
        href: '/vip',
      };
    }

    if (canonicalStatus === 'REFUND_FAILED' && refund.eligible) {
      return {
        type: 'REQUEST_REFUND',
        label: '重新申请退款',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'API',
        method: 'POST',
        endpoint: `/payments/orders/${encodeURIComponent(order.orderNo)}/refund-request`,
        requiresIdempotencyKey: true,
      };
    }

    if (canonicalStatus === 'REFUNDED' || canonicalStatus === 'CLOSED') {
      return {
        type: 'CREATE_NEW_ORDER',
        label: '重新购买',
        enabled: true,
        reason: canonicalStatus === 'CLOSED' ? this.getClosedReasonText(order.closeReasonCode) : null,
        reasonCode: canonicalStatus === 'CLOSED' ? 'ORDER_NOT_RECOVERABLE' : null,
        kind: 'LINK',
        href: '/vip',
      };
    }

    if (canonicalStatus === 'REFUND_PENDING') {
      return {
        type: 'NONE',
        label: '退款处理中',
        enabled: false,
        reason: '退款处理中，请等待最终结果。',
        reasonCode: null,
        kind: 'NONE',
      };
    }

    return {
      type: 'NONE',
      label: '暂无可执行操作',
      enabled: false,
      reason: null,
      reasonCode: null,
      kind: 'NONE',
    };
  }

  private buildSecondaryActions(
    order: PaymentOrder,
    refund: {
      eligible: boolean;
      deadlineAt: Date | null;
      reason: string | null;
      latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
    },
    options?: {
      requestedPlanCode?: PaymentPlanCode;
    },
  ) {
    const actions: Array<{
      type: 'VIEW_ORDER_DETAIL' | 'VIEW_SUCCESS' | 'REQUEST_REFUND' | 'CREATE_NEW_ORDER' | 'CONTACT_SUPPORT';
      label: string;
      enabled: boolean;
      reason: string | null;
      reasonCode: string | null;
      kind: 'LINK' | 'API' | 'NONE';
      href?: string;
      method?: 'GET' | 'POST';
      endpoint?: string;
      requiresIdempotencyKey?: boolean;
    }> = [
      {
        type: 'VIEW_ORDER_DETAIL',
        label: '查看订单记录',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'LINK',
        href: '/user?tab=orders',
      },
    ];

    const canonicalStatus = this.resolveCanonicalOrderStatus(order);
    const planMismatch = Boolean(
      options?.requestedPlanCode
      && options.requestedPlanCode !== order.planCode
      && canonicalStatus === 'OPEN',
    );

    if (canonicalStatus === 'PAID') {
      actions.push({
        type: 'VIEW_SUCCESS',
        label: '查看会员中心',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'LINK',
        href: '/vip',
      });
    }

    if (refund.eligible) {
      actions.push({
        type: 'REQUEST_REFUND',
        label: canonicalStatus === 'REFUND_FAILED' ? '重新申请退款' : '申请退款',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'API',
        method: 'POST',
        endpoint: `/payments/orders/${encodeURIComponent(order.orderNo)}/refund-request`,
        requiresIdempotencyKey: true,
      });
    } else if (refund.reason) {
      actions.push({
        type: 'REQUEST_REFUND',
        label: '申请退款',
        enabled: false,
        reason: refund.reason,
        reasonCode: refund.latestStatus === 'NONE' ? 'REFUND_WINDOW_EXPIRED' : refund.latestStatus,
        kind: 'NONE',
      });
    }

    if (canonicalStatus === 'REFUNDED' || canonicalStatus === 'CLOSED') {
      actions.push({
        type: 'CREATE_NEW_ORDER',
        label: '重新购买',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'LINK',
        href: '/vip',
      });
    }

    if (planMismatch) {
      actions.push({
        type: 'CONTACT_SUPPORT',
        label: '联系客服',
        enabled: true,
        reason: null,
        reasonCode: 'PENDING_ORDER_PLAN_MISMATCH',
        kind: 'LINK',
        href: '/support',
      });
    }

    return this.mergeSecondaryActions(actions, []);
  }

  private buildTimeline(
    order: PaymentOrder,
    latestAttempt: PaymentAttempt | null,
    latestRefund: PaymentRefund | null,
  ) {
    const timeline: Array<{
      type:
        | 'ORDER_CREATED'
        | 'ATTEMPT_OPENED'
        | 'ATTEMPT_EXPIRED'
        | 'ATTEMPT_PAID'
        | 'REFUND_REQUESTED'
        | 'REFUND_COMPLETED'
        | 'ORDER_CLOSED'
        | 'ENTITLEMENT_REPAIRED';
      at: Date;
      title: string;
      detail: string;
    }> = [
      {
        type: 'ORDER_CREATED',
        at: order.createdAt,
        title: '订单已创建',
        detail: `${order.planNameSnapshot || this.resolvePlanTitle(order.planCode)} 订单已创建。`,
      },
    ];

    if (latestAttempt) {
      timeline.push({
        type: 'ATTEMPT_OPENED',
        at: latestAttempt.createdAt,
        title: '支付尝试已创建',
        detail: `支付尝试 ${latestAttempt.attemptNo} 已创建。`,
      });

      if (latestAttempt.status === 'EXPIRED' && latestAttempt.finishedAt) {
        timeline.push({
          type: 'ATTEMPT_EXPIRED',
          at: latestAttempt.finishedAt,
          title: '支付尝试已结束',
          detail: latestAttempt.reasonCode === 'EXPIRED_REPLACED'
            ? '旧支付尝试已被新的支付尝试替换。'
            : '支付尝试已过期。',
        });
      }

      if (latestAttempt.status === 'PAID' && latestAttempt.finishedAt) {
        timeline.push({
          type: 'ATTEMPT_PAID',
          at: latestAttempt.finishedAt,
          title: '支付成功',
          detail: '支付渠道已确认付款成功。',
        });
      }
    }

    if (latestRefund) {
      timeline.push({
        type: 'REFUND_REQUESTED',
        at: latestRefund.requestedAt,
        title: '已提交退款申请',
        detail: latestRefund.reason || '用户已提交退款申请。',
      });

      if (latestRefund.completedAt && latestRefund.status === 'SUCCEEDED') {
        timeline.push({
          type: 'REFUND_COMPLETED',
          at: latestRefund.completedAt,
          title: '退款完成',
          detail: '退款已完成。',
        });
      }
    }

    if (this.resolveCanonicalOrderStatus(order) === 'CLOSED' && order.closedAt) {
      timeline.push({
        type: 'ORDER_CLOSED',
        at: order.closedAt,
        title: '订单已关闭',
        detail: this.getClosedReasonText(order.closeReasonCode),
      });
    }

    return timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private mergeSecondaryActions<T extends { type: string; kind: string }>(
    base: T[],
    extra: T[],
  ): T[] {
    const map = new Map<string, T>();
    for (const item of [...base, ...extra]) {
      map.set(`${item.type}:${item.kind}`, item);
    }
    return Array.from(map.values());
  }

  private matchesStatusFilter(view: OrderActionView, status?: QueryPaymentOrdersDto['status']) {
    if (!status) {
      return true;
    }

    if (status === 'OPEN' || status === 'PENDING_PAYMENT' || status === 'CREATED') {
      return view.orderStatus === 'OPEN';
    }
    if (status === 'CLOSED' || status === 'EXPIRED' || status === 'CANCELED') {
      return view.orderStatus === 'CLOSED';
    }
    return view.orderStatus === status;
  }

  private mapAdminStatusesToStoredStatuses(status: QueryAdminPaymentOrdersDto['status']) {
    if (status === 'OPEN') {
      return ['OPEN', 'CREATED', 'PENDING_PAYMENT'] satisfies PaymentOrderStatus[];
    }
    if (status === 'CLOSED') {
      return ['CLOSED', 'EXPIRED', 'CANCELED'] satisfies PaymentOrderStatus[];
    }
    return [status] satisfies PaymentOrderStatus[];
  }

  private parseAdminQueryDate(value?: string, endOfDay?: boolean) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      date.setHours(23, 59, 59, 999);
    }

    return date;
  }

  private resolveBizDateRange(bizDate: string) {
    const normalized = String(bizDate || '').trim();
    const start = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('对账日期格式不正确');
    }

    return {
      start,
      end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1),
    };
  }

  private toAdminOrderUserView(user: User | null | undefined, fallbackUserId: string): AdminOrderUserView {
    return {
      id: String(user?.id || fallbackUserId || '').trim(),
      email: user?.email || null,
      nickname: user?.nickname || null,
      phone: user?.phone || null,
      membershipLevel: user?.membershipLevel === 'VIP' ? 'VIP' : (user?.membershipLevel === 'FREE' ? 'FREE' : null),
      vipExpireDate: user?.vipExpireDate || null,
    };
  }

  private async findRecoverableOrderForUser(userId: string, manager?: EntityManager) {
    const repository = this.orderRepositoryOf(manager);
    const order = await repository.findOne({
      where: {
        recoverableOwnerUserId: userId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!order) {
      return null;
    }

    const normalized = await this.normalizeOrderState(order, manager);
    return this.resolveCanonicalOrderStatus(normalized) === 'OPEN' ? normalized : null;
  }

  private async findLatestAttempt(orderId: string, manager?: EntityManager) {
    return this.attemptRepositoryOf(manager).findOne({
      where: {
        orderId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  private async findLatestRefund(orderId: string, manager?: EntityManager) {
    return this.refundRepositoryOf(manager).findOne({
      where: {
        orderId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  private async normalizeAttemptState(attempt: PaymentAttempt | null, manager?: EntityManager) {
    if (!attempt) {
      return null;
    }

    if (attempt.status !== 'OPEN') {
      return attempt;
    }

    if (!attempt.expiresAt || attempt.expiresAt.getTime() > Date.now()) {
      return attempt;
    }

    attempt.status = 'EXPIRED';
    attempt.reasonCode = attempt.reasonCode || 'SESSION_EXPIRED';
    attempt.finishedAt = attempt.finishedAt || new Date();
    attempt.openAttemptOrderId = null;
    return this.attemptRepositoryOf(manager).save(attempt);
  }

  private async normalizeOrderState(order: PaymentOrder, manager?: EntityManager) {
    const repository = this.orderRepositoryOf(manager);
    const now = new Date();
    let changed = false;

    if (!order.planNameSnapshot) {
      order.planNameSnapshot = this.resolvePlanTitle(order.planCode);
      changed = true;
    }

    if (!order.recoveryWindowEndsAt && this.isOpenLikeOrderStatus(order.status)) {
      order.recoveryWindowEndsAt = new Date(order.createdAt.getTime() + RECOVERY_WINDOW_MS);
      changed = true;
    }

    const canonicalStatus = this.resolveCanonicalOrderStatus(order, now);
    if (canonicalStatus === 'OPEN') {
      if (order.status !== 'OPEN') {
        order.status = 'OPEN';
        changed = true;
      }
      if (order.recoverableOwnerUserId !== order.userId) {
        order.recoverableOwnerUserId = order.userId;
        changed = true;
      }
      if (order.closedAt !== null) {
        order.closedAt = null;
        changed = true;
      }
      if (order.closeReasonCode !== null) {
        order.closeReasonCode = null;
        changed = true;
      }
    } else if (canonicalStatus === 'CLOSED') {
      if (order.status !== 'CLOSED') {
        order.status = 'CLOSED';
        changed = true;
      }
      if (order.closeReasonCode !== 'RECOVERY_WINDOW_EXPIRED' && this.isOpenLikeOrderStatus(order.status)) {
        order.closeReasonCode = 'RECOVERY_WINDOW_EXPIRED';
        changed = true;
      }
      if (!order.closedAt) {
        order.closedAt = now;
        changed = true;
      }
      if (order.recoverableOwnerUserId !== null) {
        order.recoverableOwnerUserId = null;
        changed = true;
      }
    } else if (order.recoverableOwnerUserId !== null) {
      order.recoverableOwnerUserId = null;
      changed = true;
    }

    if (!changed) {
      return order;
    }

    return repository.save(order);
  }

  private async syncOrderAggregateState(
    rawOrder: PaymentOrder,
    latestAttempt: PaymentAttempt | null,
    manager?: EntityManager,
  ) {
    const repository = this.orderRepositoryOf(manager);
    let order = rawOrder;
    let changed = false;

    if (latestAttempt?.status === 'PAID' && order.status !== 'PAID') {
      order.status = 'PAID';
      order.paidAt = latestAttempt.finishedAt || order.paidAt || new Date();
      order.refundWindowEndAt = new Date(order.paidAt.getTime() + 7 * DAY_MS);
      order.stripePaymentIntentId = latestAttempt.paymentIntentId || order.stripePaymentIntentId;
      order.stripeCheckoutSessionId = latestAttempt.providerSessionId || order.stripeCheckoutSessionId;
      order.recoverableOwnerUserId = null;
      order.closedAt = null;
      order.closeReasonCode = null;
      changed = true;
    }

    const canonicalStatus = this.resolveCanonicalOrderStatus(order);
    if (canonicalStatus === 'OPEN' && order.recoverableOwnerUserId !== order.userId) {
      order.recoverableOwnerUserId = order.userId;
      changed = true;
    }
    if (canonicalStatus !== 'OPEN' && order.recoverableOwnerUserId !== null) {
      order.recoverableOwnerUserId = null;
      changed = true;
    }

    if (!changed) {
      return order;
    }

    order = await repository.save(order);
    return order;
  }

  private async applyPaidOrderState(
    order: PaymentOrder,
    input: {
      paidAt: Date;
      paymentIntentId: string;
      sessionId: string;
      manager?: EntityManager;
    },
  ) {
    const repository = this.orderRepositoryOf(input.manager);
    const alreadyPaid = this.resolveCanonicalOrderStatus(order) === 'PAID';

    order.status = 'PAID';
    order.paidAt = order.paidAt || input.paidAt;
    order.refundWindowEndAt = order.refundWindowEndAt || new Date(order.paidAt.getTime() + 7 * DAY_MS);
    order.stripeCheckoutSessionId = input.sessionId || order.stripeCheckoutSessionId;
    order.stripePaymentIntentId = input.paymentIntentId || order.stripePaymentIntentId;
    order.recoverableOwnerUserId = null;
    order.closedAt = null;
    order.closeReasonCode = null;
    const savedOrder = await repository.save(order);

    if (!alreadyPaid) {
      await this.ensureEntitlementForOrderWithManager(
        input.manager as EntityManager,
        savedOrder.id,
        savedOrder.userId,
        savedOrder.paidAt || input.paidAt,
        savedOrder.planCode,
      );
      await this.rebuildUserMembershipWithManager(input.manager as EntityManager, savedOrder.userId);
      await this.notificationsService.createForUser(savedOrder.userId, {
        type: 'VIP_ACTIVATED',
        level: 'success',
        source: 'vip',
        title: '会员开通成功',
        content: '支付成功，会员权益已生效。',
        actionUrl: '/vip',
        dedupKey: `payment-paid:${savedOrder.orderNo}`,
      });
    }

    return savedOrder;
  }

  private async closeOtherOpenAttemptsForPaidOrder(
    orderId: string,
    paidAttemptId: string,
    finishedAt: Date,
    manager?: EntityManager,
  ) {
    const attemptRepository = this.attemptRepositoryOf(manager);
    const openAttempts = await attemptRepository.find({
      where: {
        orderId,
        status: 'OPEN',
      },
    });

    for (const attempt of openAttempts) {
      if (attempt.id === paidAttemptId) {
        continue;
      }
      attempt.status = 'EXPIRED';
      attempt.reasonCode = 'EXPIRED_REPLACED';
      attempt.finishedAt = finishedAt;
      attempt.openAttemptOrderId = null;
      await attemptRepository.save(attempt);
    }
  }

  private resolveCanonicalOrderStatus(order: PaymentOrder, now = new Date()): CanonicalOrderStatus {
    if (
      order.status === 'PAID'
      || order.status === 'REFUND_PENDING'
      || order.status === 'REFUNDED'
      || order.status === 'REFUND_FAILED'
      || order.status === 'OPEN'
      || order.status === 'CLOSED'
    ) {
      if (order.status === 'OPEN' && order.recoveryWindowEndsAt && order.recoveryWindowEndsAt.getTime() <= now.getTime()) {
        return 'CLOSED';
      }
      return order.status as CanonicalOrderStatus;
    }

    if (this.isOpenLikeOrderStatus(order.status)) {
      const recoveryWindowEndsAt = order.recoveryWindowEndsAt || new Date(order.createdAt.getTime() + RECOVERY_WINDOW_MS);
      return recoveryWindowEndsAt.getTime() > now.getTime() ? 'OPEN' : 'CLOSED';
    }

    return 'CLOSED';
  }

  private isOpenLikeOrderStatus(status: PaymentOrderStatus) {
    return status === 'OPEN'
      || status === 'CREATED'
      || status === 'PENDING_PAYMENT'
      || status === 'EXPIRED'
      || status === 'CANCELED';
  }

  private toLegacyOrderViewStatus(
    status: CanonicalOrderStatus,
    closeReasonCode: PaymentOrder['closeReasonCode'],
  ): LegacyOrderViewStatus {
    if (status === 'OPEN') {
      return 'PENDING_PAYMENT';
    }
    if (status === 'CLOSED') {
      return closeReasonCode === 'ADMIN_CLOSED' ? 'CANCELED' : 'EXPIRED';
    }
    return status;
  }

  private getOrderStatusLabel(
    status: CanonicalOrderStatus,
    closeReasonCode: PaymentOrder['closeReasonCode'],
  ) {
    if (status === 'OPEN') {
      return '待支付';
    }
    if (status === 'PAID') {
      return '已支付';
    }
    if (status === 'REFUND_PENDING') {
      return '退款处理中';
    }
    if (status === 'REFUNDED') {
      return '已退款';
    }
    if (status === 'REFUND_FAILED') {
      return '退款失败';
    }
    return closeReasonCode === 'ADMIN_CLOSED' ? '已关闭' : '已过期';
  }

  private getAttemptStatusLabel(status: PaymentAttempt['status']) {
    if (status === 'OPEN') {
      return '待支付';
    }
    if (status === 'PAID') {
      return '已支付';
    }
    if (status === 'FAILED') {
      return '支付失败';
    }
    return '已过期';
  }

  private getClosedReasonText(closeReasonCode: PaymentOrder['closeReasonCode']) {
    if (closeReasonCode === 'ADMIN_CLOSED') {
      return '订单已被管理员关闭。';
    }
    if (closeReasonCode === 'MIGRATION_DUPLICATE_PENDING_ORDER') {
      return '历史重复未完成订单已被关闭。';
    }
    return '订单已超过恢复窗口，不能继续支付。';
  }

  private requireIdempotencyKey(value: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new BadRequestException('缺少 Idempotency-Key');
    }
    return normalized;
  }

  private buildIdempotencyHash(payload: Record<string, any>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async createCheckoutSessionOrThrow(input: {
    orderNo: string;
    userId: string;
    amountMinor: number;
    currency: PaymentCurrency;
    planCode: PaymentPlanCode;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  }) {
    try {
      return await this.stripeProvider.createCheckoutSession(input);
    } catch (error: any) {
      const message = String(error?.message || '').trim();
      if (message === 'STRIPE_NOT_CONFIGURED') {
        throw new BadRequestException('支付服务未配置，请联系管理员');
      }
      throw error;
    }
  }

  private async createRefundOrThrow(input: {
    paymentIntentId: string;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
  }) {
    try {
      return await this.stripeProvider.createRefund(input);
    } catch (error: any) {
      const message = String(error?.message || '').trim();
      if (message === 'PAYMENT_INTENT_REQUIRED') {
        throw new BadRequestException('订单缺少支付凭证，暂时无法退款');
      }
      if (message === 'STRIPE_NOT_CONFIGURED') {
        throw new BadRequestException('支付服务未配置，请联系管理员');
      }
      throw error;
    }
  }

  private orderRepositoryOf(manager?: EntityManager) {
    return manager?.getRepository(PaymentOrder) ?? this.paymentOrderRepository;
  }

  private attemptRepositoryOf(manager?: EntityManager) {
    return manager?.getRepository(PaymentAttempt) ?? this.paymentAttemptRepository;
  }

  private idempotencyRepositoryOf(manager?: EntityManager) {
    return manager?.getRepository(PaymentIdempotencyRecord) ?? this.paymentIdempotencyRepository;
  }

  private entitlementRepositoryOf(manager?: EntityManager) {
    return manager?.getRepository(PaymentOrderEntitlement) ?? this.entitlementRepository;
  }

  private refundRepositoryOf(manager?: EntityManager) {
    return manager?.getRepository(PaymentRefund) ?? this.refundRepository;
  }

  private toRefundView(refund: PaymentRefund) {
    return {
      refundNo: refund.refundNo,
      orderId: refund.orderId,
      status: refund.status,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      reason: refund.reason,
      requestedAt: refund.requestedAt,
      completedAt: refund.completedAt,
    };
  }

  private resolvePrice(planCode: PaymentPlanCode, preferredCurrency: PaymentCurrency): PriceConfig {
    const planPrice = PLAN_PRICE_MAP[planCode];
    if (!planPrice) {
      throw new BadRequestException('不支持的套餐类型');
    }

    const amountMinor = planPrice[preferredCurrency];
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('支付币种不可用');
    }

    const durationDays = this.resolveDurationDaysByPlan(planCode);
    return {
      amountMinor,
      currency: preferredCurrency,
      durationDays,
      isLifetime: durationDays === null,
    };
  }

  private resolveDurationDaysByPlan(planCode: PaymentPlanCode): number | null {
    if (planCode === 'MONTH') {
      return 30;
    }
    if (planCode === 'QUARTER') {
      return 90;
    }
    if (planCode === 'YEAR') {
      return 365;
    }
    return null;
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

  private resolveWebSuccessUrl(orderNo: string): string {
    const webOrigin = String(process.env.WEB_PUBLIC_ORIGIN || '').trim() || 'http://localhost:3000';
    return `${webOrigin}/vip?orderNo=${encodeURIComponent(orderNo)}&status=success`;
  }

  private resolveWebCancelUrl(orderNo: string): string {
    const webOrigin = String(process.env.WEB_PUBLIC_ORIGIN || '').trim() || 'http://localhost:3000';
    return `${webOrigin}/vip?orderNo=${encodeURIComponent(orderNo)}&status=cancel`;
  }

  private generateOrderNo(now: Date): string {
    const stamp = this.formatDateTimeCompact(now);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `PO${stamp}${random}`;
  }

  private generateAttemptNo(now: Date): string {
    const stamp = this.formatDateTimeCompact(now);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `AT${stamp}${random}`;
  }

  private generateRefundNo(now: Date): string {
    const stamp = this.formatDateTimeCompact(now);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `RF${stamp}${random}`;
  }

  private formatDateTimeCompact(input: Date): string {
    const yyyy = input.getFullYear().toString();
    const mm = `${input.getMonth() + 1}`.padStart(2, '0');
    const dd = `${input.getDate()}`.padStart(2, '0');
    const hh = `${input.getHours()}`.padStart(2, '0');
    const ii = `${input.getMinutes()}`.padStart(2, '0');
    const ss = `${input.getSeconds()}`.padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${ii}${ss}`;
  }
}
