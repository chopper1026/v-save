import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

const BASE_CREATED_AT = new Date('2030-03-26T10:00:00.000Z');
const CHECKOUT_EXPIRES_AT = new Date('2030-03-26T12:00:00.000Z');
const PAID_AT = new Date('2030-03-26T10:01:00.000Z');
const REFUND_WINDOW_END_AT = new Date('2030-04-02T10:01:00.000Z');

const createRepositoryMock = () => ({
  create: jest.fn((payload) => payload),
  save: jest.fn(async (payload) => payload),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(() => {
    const qb: any = {};
    qb.where = jest.fn().mockReturnValue(qb);
    qb.andWhere = jest.fn().mockReturnValue(qb);
    qb.leftJoin = jest.fn().mockReturnValue(qb);
    qb.select = jest.fn().mockReturnValue(qb);
    qb.addSelect = jest.fn().mockReturnValue(qb);
    qb.orderBy = jest.fn().mockReturnValue(qb);
    qb.addOrderBy = jest.fn().mockReturnValue(qb);
    qb.skip = jest.fn().mockReturnValue(qb);
    qb.take = jest.fn().mockReturnValue(qb);
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    return qb;
  }),
});

const createManagerRepositoryMock = () => ({
  create: jest.fn((payload) => payload),
  save: jest.fn(async (payload) => payload),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
});

const attachSaveDefaults = (repository: any, fallbackId: string) => {
  repository.save.mockImplementation(async (payload: any) => ({
    ...payload,
    id: payload.id ?? fallbackId,
    createdAt: payload.createdAt ?? BASE_CREATED_AT,
    updatedAt: payload.updatedAt ?? BASE_CREATED_AT,
  }));
};

const createManagerMock = () => {
  const orderRepository = createManagerRepositoryMock();
  const attemptRepository = createManagerRepositoryMock();
  const idempotencyRepository = createManagerRepositoryMock();
  const entitlementRepository = createManagerRepositoryMock();
  const refundRepository = createManagerRepositoryMock();

  attachSaveDefaults(orderRepository, 'order-1');
  attachSaveDefaults(attemptRepository, 'attempt-1');
  attachSaveDefaults(idempotencyRepository, 'idem-record-1');
  attachSaveDefaults(entitlementRepository, 'ent-1');
  attachSaveDefaults(refundRepository, 'refund-1');

  return {
    orderRepository,
    attemptRepository,
    idempotencyRepository,
    entitlementRepository,
    refundRepository,
    getRepository: jest.fn((entity: any) => {
      const name = String(entity?.name || '');
      if (name === 'PaymentOrder') {
        return orderRepository;
      }
      if (name === 'PaymentAttempt') {
        return attemptRepository;
      }
      if (name === 'PaymentIdempotencyRecord') {
        return idempotencyRepository;
      }
      if (name === 'PaymentOrderEntitlement') {
        return entitlementRepository;
      }
      if (name === 'PaymentRefund') {
        return refundRepository;
      }
      return createManagerRepositoryMock();
    }),
  };
};

const createOrderEntity = (overrides: Record<string, any> = {}) => ({
  id: 'order-1',
  orderNo: 'PO202603260001',
  userId: 'user-1',
  provider: 'STRIPE',
  planCode: 'MONTH',
  planNameSnapshot: 'VSave 月卡会员',
  durationDays: 30,
  isLifetime: false,
  preferredCurrency: 'CNY',
  resolvedCurrency: 'CNY',
  amountMinor: 690,
  status: 'OPEN',
  stripeCheckoutSessionId: 'cs_test_123',
  stripePaymentIntentId: null,
  receiptEmail: 'u@example.com',
  invoiceEnabled: false,
  invoiceName: null,
  invoiceTaxId: null,
  refundWindowEndAt: null,
  recoveryWindowEndsAt: new Date(BASE_CREATED_AT.getTime() + 24 * 60 * 60 * 1000),
  paidAt: null,
  closedAt: null,
  closeReasonCode: null,
  recoverableOwnerUserId: 'user-1',
  createdAt: BASE_CREATED_AT,
  updatedAt: BASE_CREATED_AT,
  ...overrides,
});

const createAttemptEntity = (overrides: Record<string, any> = {}) => ({
  id: 'attempt-1',
  attemptNo: 'PA202603260001',
  orderId: 'order-1',
  provider: 'STRIPE',
  status: 'OPEN',
  providerSessionId: 'cs_test_123',
  paymentIntentId: null,
  checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
  createdByAction: 'CREATE_ORDER',
  reasonCode: null,
  failureReason: null,
  expiresAt: CHECKOUT_EXPIRES_AT,
  finishedAt: null,
  openAttemptOrderId: 'order-1',
  createdAt: BASE_CREATED_AT,
  updatedAt: BASE_CREATED_AT,
  ...overrides,
});

const createRefundEntity = (overrides: Record<string, any> = {}) => ({
  id: 'refund-1',
  refundNo: 'RF202603260001',
  orderId: 'order-1',
  userId: 'user-1',
  status: 'PENDING_PROVIDER',
  amountMinor: 690,
  currency: 'CNY',
  reason: '误购',
  requestedByType: 'USER',
  requestedByUserId: 'user-1',
  stripeRefundId: null,
  idempotencyKey: 'rf-1',
  requestedAt: BASE_CREATED_AT,
  decidedAt: null,
  completedAt: null,
  failureCode: null,
  failureMessage: null,
  createdAt: BASE_CREATED_AT,
  updatedAt: BASE_CREATED_AT,
  ...overrides,
});

const createUserEntity = (overrides: Record<string, any> = {}) => ({
  id: 'user-1',
  email: 'u@example.com',
  password: 'hashed-password',
  nickname: '测试用户',
  role: 'USER',
  membershipLevel: 'VIP',
  accountStatus: 'ACTIVE',
  avatar: null,
  phone: '13800000000',
  vipExpireDate: new Date('2030-04-26T10:01:00.000Z'),
  downloadCount: 12,
  createdAt: new Date('2030-03-01T00:00:00.000Z'),
  updatedAt: new Date('2030-03-20T00:00:00.000Z'),
  ...overrides,
});

describe('PaymentsService', () => {
  const createService = () => {
    const paymentOrderRepository = createRepositoryMock();
    const paymentAttemptRepository = createRepositoryMock();
    const paymentIdempotencyRepository = createRepositoryMock();
    const entitlementRepository = createRepositoryMock();
    const webhookEventRepository = createRepositoryMock();
    const refundRepository = createRepositoryMock();
    const reconciliationRepository = createRepositoryMock();
    const userRepository = createRepositoryMock();

    attachSaveDefaults(paymentOrderRepository, 'order-1');
    attachSaveDefaults(paymentAttemptRepository, 'attempt-1');
    attachSaveDefaults(paymentIdempotencyRepository, 'idem-record-1');
    attachSaveDefaults(entitlementRepository, 'ent-1');
    attachSaveDefaults(webhookEventRepository, 'webhook-1');
    attachSaveDefaults(refundRepository, 'refund-1');
    attachSaveDefaults(reconciliationRepository, 'recon-1');

    const usersService = {
      findById: jest.fn(),
      updateVIPStatus: jest.fn().mockResolvedValue(undefined),
    };
    const adminUsersService = {
      recordAuditLog: jest.fn().mockResolvedValue(undefined),
    };
    const notificationsService = {
      createForUser: jest.fn().mockResolvedValue(undefined),
    };
    const stripeProvider = {
      createCheckoutSession: jest.fn(),
      expireCheckoutSession: jest.fn().mockResolvedValue(undefined),
      verifyWebhook: jest.fn(),
      createRefund: jest.fn(),
      fetchDailyLedger: jest.fn().mockResolvedValue([]),
      retrieveCheckoutSession: jest.fn(),
    };
    const downloadService = {
      getFreeDownloadUsageToday: jest.fn().mockResolvedValue(0),
    };

    const manager = createManagerMock();
    const dataSource = {
      transaction: jest.fn(async (callback: any) => callback(manager)),
    };

    const service = new PaymentsService(
      paymentOrderRepository as any,
      paymentAttemptRepository as any,
      paymentIdempotencyRepository as any,
      entitlementRepository as any,
      webhookEventRepository as any,
      refundRepository as any,
      reconciliationRepository as any,
      userRepository as any,
      usersService as any,
      adminUsersService as any,
      notificationsService as any,
      stripeProvider as any,
      downloadService as any,
      dataSource as any,
    );

    return {
      service,
      paymentOrderRepository,
      paymentAttemptRepository,
      paymentIdempotencyRepository,
      entitlementRepository,
      webhookEventRepository,
      refundRepository,
      reconciliationRepository,
      userRepository,
      usersService,
      adminUsersService,
      notificationsService,
      stripeProvider,
      downloadService,
      dataSource,
      manager,
    };
  };

  it('creates a new order with attempt action contract', async () => {
    const {
      service,
      usersService,
      stripeProvider,
      manager,
    } = createService();

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
    });
    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(null);
    stripeProvider.createCheckoutSession.mockResolvedValue({
      sessionId: 'cs_test_123',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      expiresAt: CHECKOUT_EXPIRES_AT,
    });

    const result = await service.createOrder({
      userId: 'user-1',
      idempotencyKey: 'idem-1',
      dto: {
        planCode: 'MONTH',
        preferredCurrency: 'CNY',
        clientType: 'WEB',
      } as any,
    });

    expect(result.reusedOrder).toBe(false);
    expect(result.orderStatus).toBe('OPEN');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.currency).toBe('CNY');
    expect(result.amountMinor).toBe(690);
    expect(result.primaryAction.type).toBe('RESUME_PAYMENT');
    expect(result.primaryAction.requiresIdempotencyKey).toBe(true);
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(result.latestAttempt?.status).toBe('OPEN');
    expect(manager.orderRepository.save).toHaveBeenCalled();
    expect(manager.attemptRepository.save).toHaveBeenCalled();
    expect(manager.idempotencyRepository.save).toHaveBeenCalled();

    const firstCheckoutInput = stripeProvider.createCheckoutSession.mock.calls[0]?.[0];
    expect(firstCheckoutInput?.customerEmail).toBe('u@example.com');
  });

  it('lists admin orders with user snapshots and canonical filters', async () => {
    const {
      service,
      paymentOrderRepository,
      paymentAttemptRepository,
      refundRepository,
      userRepository,
    } = createService();

    const qb = paymentOrderRepository.createQueryBuilder();
    paymentOrderRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getManyAndCount.mockResolvedValue([
      [
        createOrderEntity({
          id: 'order-admin-1',
          orderNo: 'PO_ADMIN_1',
          userId: 'user-1',
          status: 'PAID',
          paidAt: PAID_AT,
          stripePaymentIntentId: 'pi_admin_1',
          stripeCheckoutSessionId: 'cs_admin_1',
        }),
      ],
      1,
    ]);
    paymentAttemptRepository.findOne.mockResolvedValue(
      createAttemptEntity({
        orderId: 'order-admin-1',
        providerSessionId: 'cs_admin_1',
        status: 'PAID',
        paymentIntentId: 'pi_admin_1',
        openAttemptOrderId: null,
        finishedAt: PAID_AT,
      }),
    );
    refundRepository.findOne.mockResolvedValue(null);
    userRepository.find.mockResolvedValue([
      createUserEntity({
        id: 'user-1',
        email: 'buyer@example.com',
        nickname: '购买用户',
      }),
    ]);

    const result = await service.listOrdersForAdmin({
      query: {
        page: 1,
        pageSize: 20,
        status: 'PAID',
        keyword: 'buyer',
      } as any,
    });

    expect(qb.leftJoin).toHaveBeenCalledWith('users', 'user', 'user.id = paymentOrder.userId');
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('paymentOrder.status IN'),
      expect.objectContaining({
        statuses: ['PAID'],
      }),
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('paymentOrder.orderNo LIKE :keyword'),
      expect.objectContaining({
        keyword: '%buyer%',
      }),
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          orderNo: 'PO_ADMIN_1',
          orderStatus: 'PAID',
          user: expect.objectContaining({
            id: 'user-1',
            email: 'buyer@example.com',
            nickname: '购买用户',
          }),
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('returns admin order detail with user, entitlement, and operation flags', async () => {
    const {
      service,
      paymentOrderRepository,
      paymentAttemptRepository,
      entitlementRepository,
      refundRepository,
      userRepository,
    } = createService();

    paymentOrderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-admin-detail',
        orderNo: 'PO_ADMIN_DETAIL',
        status: 'PAID',
        paidAt: PAID_AT,
        stripeCheckoutSessionId: 'cs_detail_1',
        stripePaymentIntentId: 'pi_detail_1',
      }),
    );
    paymentAttemptRepository.findOne.mockResolvedValue(
      createAttemptEntity({
        orderId: 'order-admin-detail',
        providerSessionId: 'cs_detail_1',
        paymentIntentId: 'pi_detail_1',
        status: 'PAID',
        openAttemptOrderId: null,
        finishedAt: PAID_AT,
      }),
    );
    refundRepository.findOne.mockResolvedValue(null);
    entitlementRepository.findOne.mockResolvedValue({
      id: 'ent-1',
      orderId: 'order-admin-detail',
      userId: 'user-1',
      planCode: 'MONTH',
      isLifetime: false,
      grantDays: 30,
      status: 'ACTIVE',
      effectiveStartAt: PAID_AT,
      effectiveEndAt: new Date('2030-04-25T10:01:00.000Z'),
      revokedAt: null,
      revokedReason: null,
      createdAt: PAID_AT,
      updatedAt: PAID_AT,
    });
    userRepository.findOne.mockResolvedValue(
      createUserEntity({
        id: 'user-1',
        email: 'buyer@example.com',
        nickname: '购买用户',
      }),
    );

    const result = await service.getOrderForAdmin({
      orderNo: 'PO_ADMIN_DETAIL',
    });

    expect(result).toEqual(
      expect.objectContaining({
        orderNo: 'PO_ADMIN_DETAIL',
        orderStatus: 'PAID',
        user: expect.objectContaining({
          id: 'user-1',
          email: 'buyer@example.com',
        }),
        entitlement: expect.objectContaining({
          status: 'ACTIVE',
          planCode: 'MONTH',
        }),
        providerRefs: expect.objectContaining({
          checkoutSessionId: 'cs_detail_1',
          paymentIntentId: 'pi_detail_1',
        }),
        operations: expect.objectContaining({
          canManualRepair: true,
        }),
      }),
    );
  });

  it('reuses existing recoverable order instead of creating duplicate order', async () => {
    const {
      service,
      usersService,
      stripeProvider,
      manager,
    } = createService();

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
    });
    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        orderNo: 'PO_OPEN_1',
        status: 'OPEN',
      }),
    );
    manager.attemptRepository.findOne.mockResolvedValue(
      createAttemptEntity({
        orderId: 'order-1',
        providerSessionId: 'cs_open_1',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_open_1',
      }),
    );
    manager.refundRepository.findOne.mockResolvedValue(null);

    const result = await service.createOrder({
      userId: 'user-1',
      idempotencyKey: 'idem-reuse-1',
      dto: {
        planCode: 'MONTH',
        preferredCurrency: 'CNY',
        clientType: 'WEB',
      } as any,
    });

    expect(result.reusedOrder).toBe(true);
    expect(result.orderNo).toBe('PO_OPEN_1');
    expect(result.orderStatus).toBe('OPEN');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.primaryAction.type).toBe('RESUME_PAYMENT');
    expect(result.primaryAction.reasonCode).toBeNull();
    expect(result.checkoutUrl).toBeNull();
    expect(stripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(manager.orderRepository.save).not.toHaveBeenCalled();
  });

  it('returns stored response when create order idempotency key is replayed', async () => {
    const {
      service,
      usersService,
      stripeProvider,
      manager,
    } = createService();

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
    });

    const storedResponse = {
      orderNo: 'PO_STORED_1',
      orderStatus: 'OPEN',
      status: 'PENDING_PAYMENT',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_stored_1',
    };
    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        userId: 'user-1',
        planCode: 'MONTH',
        preferredCurrency: 'CNY',
        clientType: 'WEB',
      }))
      .digest('hex');

    manager.idempotencyRepository.findOne.mockResolvedValue({
      id: 'idem-record-1',
      ownerUserId: 'user-1',
      scope: 'CREATE_ORDER',
      idempotencyKey: 'idem-replay-1',
      requestHash,
      responseJson: storedResponse,
    });

    const result = await service.createOrder({
      userId: 'user-1',
      idempotencyKey: 'idem-replay-1',
      dto: {
        planCode: 'MONTH',
        preferredCurrency: 'CNY',
        clientType: 'WEB',
      } as any,
    });

    expect(result).toEqual(storedResponse);
    expect(stripeProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(manager.idempotencyRepository.save).not.toHaveBeenCalled();
  });

  it('rejects reading order when owner mismatched', async () => {
    const { service, paymentOrderRepository } = createService();

    paymentOrderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        orderNo: 'PO_FORBIDDEN',
        userId: 'user-2',
      }),
    );

    await expect(
      service.getOrderForUser({
        userId: 'user-1',
        orderNo: 'PO_FORBIDDEN',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('syncs paid attempt via stripe on order detail read', async () => {
    const {
      service,
      paymentOrderRepository,
      paymentAttemptRepository,
      stripeProvider,
      manager,
      notificationsService,
      usersService,
    } = createService();

    paymentOrderRepository.findOne
      .mockResolvedValueOnce(
        createOrderEntity({
          id: 'order-1',
          orderNo: 'PO_SYNC',
          status: 'OPEN',
          stripeCheckoutSessionId: 'cs_sync_1',
        }),
      )
      .mockResolvedValueOnce(
        createOrderEntity({
          id: 'order-1',
          orderNo: 'PO_SYNC',
          status: 'PAID',
          stripeCheckoutSessionId: 'cs_sync_1',
          stripePaymentIntentId: 'pi_sync_1',
          paidAt: PAID_AT,
          refundWindowEndAt: REFUND_WINDOW_END_AT,
          recoverableOwnerUserId: null,
        }),
      );

    paymentAttemptRepository.findOne
      .mockResolvedValueOnce(
        createAttemptEntity({
          id: 'attempt-1',
          orderId: 'order-1',
          providerSessionId: 'cs_sync_1',
          status: 'OPEN',
          expiresAt: new Date('2030-03-26T12:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createAttemptEntity({
          id: 'attempt-1',
          orderId: 'order-1',
          providerSessionId: 'cs_sync_1',
          status: 'PAID',
          paymentIntentId: 'pi_sync_1',
          finishedAt: PAID_AT,
          openAttemptOrderId: null,
        }),
      );

    stripeProvider.retrieveCheckoutSession.mockResolvedValue({
      sessionId: 'cs_sync_1',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_sync_1',
      paidAt: PAID_AT,
    });

    manager.attemptRepository.findOne.mockResolvedValue(
      createAttemptEntity({
        id: 'attempt-1',
        orderId: 'order-1',
        providerSessionId: 'cs_sync_1',
        status: 'OPEN',
      }),
    );
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_SYNC',
        status: 'OPEN',
        stripeCheckoutSessionId: 'cs_sync_1',
      }),
    );
    manager.entitlementRepository.findOne.mockResolvedValue(null);
    manager.entitlementRepository.find.mockResolvedValue([]);
    manager.attemptRepository.find.mockResolvedValue([]);

    const result = await service.getOrderForUser({
      userId: 'user-1',
      orderNo: 'PO_SYNC',
    });

    expect(stripeProvider.retrieveCheckoutSession).toHaveBeenCalledWith('cs_sync_1');
    expect(manager.attemptRepository.save).toHaveBeenCalled();
    expect(manager.orderRepository.save).toHaveBeenCalled();
    expect(manager.entitlementRepository.save).toHaveBeenCalled();
    expect(notificationsService.createForUser).toHaveBeenCalled();
    expect(usersService.updateVIPStatus).toHaveBeenCalled();
    expect(result.orderStatus).toBe('PAID');
    expect(result.status).toBe('PAID');
    expect(result.primaryAction.type).toBe('VIEW_SUCCESS');
  });

  it('recheckout expires previous open attempt and returns new checkout', async () => {
    const {
      service,
      usersService,
      stripeProvider,
      manager,
    } = createService();

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
    });
    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_RETRY',
        status: 'OPEN',
        recoveryWindowEndsAt: new Date('2030-03-27T10:00:00.000Z'),
      }),
    );
    manager.attemptRepository.find.mockResolvedValue([
      createAttemptEntity({
        id: 'attempt-old',
        orderId: 'order-1',
        providerSessionId: 'cs_old_1',
        checkoutUrl: 'https://checkout.stripe.com/pay/cs_old_1',
        expiresAt: new Date('2030-03-26T12:00:00.000Z'),
      }),
    ]);
    stripeProvider.createCheckoutSession.mockResolvedValue({
      sessionId: 'cs_retry_1',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_retry_1',
      expiresAt: CHECKOUT_EXPIRES_AT,
    });

    const result = await service.recheckoutPendingOrder({
      userId: 'user-1',
      orderNo: 'PO_RETRY',
      idempotencyKey: 'retry-1',
    });

    expect(stripeProvider.expireCheckoutSession).toHaveBeenCalledWith('cs_old_1');
    expect(manager.attemptRepository.save).toHaveBeenCalledTimes(2);
    expect(manager.attemptRepository.save.mock.calls[0]?.[0]).toMatchObject({
      id: 'attempt-old',
      status: 'EXPIRED',
      reasonCode: 'EXPIRED_REPLACED',
    });
    expect(result.orderNo).toBe('PO_RETRY');
    expect(result.orderStatus).toBe('OPEN');
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.latestAttempt?.status).toBe('OPEN');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_retry_1');
  });

  it('rejects recheckout when order owner mismatched', async () => {
    const {
      service,
      usersService,
      manager,
    } = createService();

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
    });
    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        orderNo: 'PO_RETRY_FORBIDDEN',
        userId: 'user-2',
      }),
    );

    await expect(
      service.recheckoutPendingOrder({
        userId: 'user-1',
        orderNo: 'PO_RETRY_FORBIDDEN',
        idempotencyKey: 'retry-forbidden-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('processes checkout.session.completed webhook through attempt-first flow', async () => {
    const {
      service,
      stripeProvider,
      webhookEventRepository,
      manager,
      notificationsService,
      usersService,
    } = createService();

    stripeProvider.verifyWebhook.mockReturnValue({
      id: 'evt_paid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_paid_1',
          payment_status: 'paid',
          payment_intent: 'pi_paid_1',
          created: Math.floor(PAID_AT.getTime() / 1000),
        },
      },
    });
    webhookEventRepository.findOne.mockResolvedValue(null);
    manager.attemptRepository.findOne.mockResolvedValue(
      createAttemptEntity({
        id: 'attempt-1',
        orderId: 'order-1',
        providerSessionId: 'cs_paid_1',
        status: 'OPEN',
      }),
    );
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_WEBHOOK',
        status: 'OPEN',
        stripeCheckoutSessionId: 'cs_paid_1',
      }),
    );
    manager.entitlementRepository.findOne.mockResolvedValue(null);
    manager.entitlementRepository.find.mockResolvedValue([]);
    manager.attemptRepository.find.mockResolvedValue([]);

    const result = await service.handleStripeWebhook({
      rawBody: Buffer.from(JSON.stringify({ id: 'evt_paid_1' }), 'utf8'),
      signature: 'sig_paid_1',
    });

    expect(result.duplicated).toBe(false);
    expect(webhookEventRepository.save).toHaveBeenCalledTimes(2);
    expect(manager.attemptRepository.save).toHaveBeenCalled();
    expect(manager.orderRepository.save).toHaveBeenCalled();
    expect(manager.entitlementRepository.save).toHaveBeenCalled();
    expect(notificationsService.createForUser).toHaveBeenCalled();
    expect(usersService.updateVIPStatus).toHaveBeenCalled();
  });

  it('processes checkout.session.expired webhook and marks latest attempt expired', async () => {
    const {
      service,
      stripeProvider,
      webhookEventRepository,
      manager,
    } = createService();

    stripeProvider.verifyWebhook.mockReturnValue({
      id: 'evt_expired_1',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_1',
          created: Math.floor(CHECKOUT_EXPIRES_AT.getTime() / 1000),
        },
      },
    });
    webhookEventRepository.findOne.mockResolvedValue(null);
    manager.attemptRepository.findOne
      .mockResolvedValueOnce(
        createAttemptEntity({
          id: 'attempt-1',
          orderId: 'order-1',
          providerSessionId: 'cs_expired_1',
          status: 'OPEN',
        }),
      )
      .mockResolvedValueOnce(
        createAttemptEntity({
          id: 'attempt-1',
          orderId: 'order-1',
          providerSessionId: 'cs_expired_1',
          status: 'EXPIRED',
          reasonCode: 'SESSION_EXPIRED',
          finishedAt: CHECKOUT_EXPIRES_AT,
          openAttemptOrderId: null,
        }),
      );
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_EXPIRED',
        status: 'OPEN',
        stripeCheckoutSessionId: 'cs_expired_1',
      }),
    );

    const result = await service.handleStripeWebhook({
      rawBody: Buffer.from(JSON.stringify({ id: 'evt_expired_1' }), 'utf8'),
      signature: 'sig_expired_1',
    });

    expect(result.duplicated).toBe(false);
    expect(manager.attemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'attempt-1',
        status: 'EXPIRED',
        reasonCode: 'SESSION_EXPIRED',
      }),
    );
  });

  it('rejects refund outside refund window', async () => {
    const {
      service,
      manager,
    } = createService();

    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_REFUND_TIMEOUT',
        status: 'PAID',
        paidAt: PAID_AT,
        refundWindowEndAt: new Date('2026-03-20T00:00:00.000Z'),
        stripePaymentIntentId: 'pi_timeout_1',
        recoverableOwnerUserId: null,
      }),
    );

    await expect(
      service.requestRefund({
        userId: 'user-1',
        orderNo: 'PO_REFUND_TIMEOUT',
        idempotencyKey: 'rf-timeout-1',
        dto: {
          reason: '误购',
        } as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates refund from route order number and revokes entitlement when provider succeeds', async () => {
    const {
      service,
      manager,
      stripeProvider,
      usersService,
    } = createService();

    manager.idempotencyRepository.findOne.mockResolvedValue(null);
    manager.orderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_ROUTE_ONLY',
        status: 'PAID',
        paidAt: PAID_AT,
        refundWindowEndAt: new Date('2030-03-26T10:01:00.000Z'),
        stripePaymentIntentId: 'pi_refund_1',
        recoverableOwnerUserId: null,
      }),
    );
    stripeProvider.createRefund.mockResolvedValue({
      refundId: 're_1',
      status: 'succeeded',
    });
    manager.refundRepository.save.mockImplementation(async (payload: any) => ({
      ...createRefundEntity(),
      ...payload,
      id: payload.id ?? 'refund-1',
      createdAt: payload.createdAt ?? BASE_CREATED_AT,
      updatedAt: payload.updatedAt ?? BASE_CREATED_AT,
    }));
    manager.entitlementRepository.findOne.mockResolvedValue({
      id: 'ent-1',
      orderId: 'order-1',
      userId: 'user-1',
      status: 'ACTIVE',
      isLifetime: false,
      effectiveEndAt: REFUND_WINDOW_END_AT,
    });
    manager.entitlementRepository.find.mockResolvedValue([]);

    const result = await service.requestRefund({
      userId: 'user-1',
      orderNo: 'PO_ROUTE_ONLY',
      idempotencyKey: 'rf-success-1',
      dto: {
        orderNo: 'WRONG_BODY_ORDER_NO',
        reason: '误购',
      } as any,
    });

    expect(manager.orderRepository.findOne).toHaveBeenCalledWith({
      where: {
        orderNo: 'PO_ROUTE_ONLY',
      },
    });
    expect(stripeProvider.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_refund_1',
        amountMinor: 690,
        reason: '误购',
        idempotencyKey: 'rf-success-1',
      }),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(manager.orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNo: 'PO_ROUTE_ONLY',
        status: 'REFUNDED',
      }),
    );
    expect(manager.entitlementRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ent-1',
        status: 'REVOKED',
      }),
    );
    expect(usersService.updateVIPStatus).toHaveBeenCalled();
  });

  it('runs daily reconciliation and writes admin audit log', async () => {
    const {
      service,
      stripeProvider,
      paymentOrderRepository,
      reconciliationRepository,
      adminUsersService,
    } = createService();

    reconciliationRepository.findOne.mockResolvedValue(null);
    stripeProvider.fetchDailyLedger.mockResolvedValue([
      { orderNo: 'PO1', amountMinor: 690, currency: 'CNY' },
    ]);
    paymentOrderRepository.count.mockResolvedValue(1);

    const result = await service.runDailyReconciliation({
      operatorUserId: 'admin-1',
      dto: {
        date: '2026-03-26',
        force: false,
      } as any,
    });

    expect(result.status).toBe('DONE');
    expect(result.diffCount).toBe(0);
    expect(paymentOrderRepository.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PAID',
        paidAt: expect.anything(),
      }),
    });
    expect(adminUsersService.recordAuditLog).toHaveBeenCalled();
  });

  it('repairs paid order entitlement manually', async () => {
    const {
      service,
      paymentOrderRepository,
      usersService,
      adminUsersService,
      manager,
    } = createService();

    paymentOrderRepository.findOne.mockResolvedValue(
      createOrderEntity({
        id: 'order-1',
        orderNo: 'PO_REPAIR_1',
        status: 'PAID',
        paidAt: PAID_AT,
        refundWindowEndAt: REFUND_WINDOW_END_AT,
        recoverableOwnerUserId: null,
      }),
    );
    manager.entitlementRepository.findOne.mockResolvedValue(null);
    manager.entitlementRepository.find.mockResolvedValue([]);

    const result = await service.manualRepairOrder({
      orderNo: 'PO_REPAIR_1',
      operatorUserId: 'admin-1',
    });

    expect(result.repaired).toBe(true);
    expect(manager.entitlementRepository.save).toHaveBeenCalled();
    expect(usersService.updateVIPStatus).toHaveBeenCalled();
    expect(adminUsersService.recordAuditLog).toHaveBeenCalled();
  });
});
