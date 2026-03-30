import { AdminPaymentOrdersController } from './admin-payment-orders.controller';

describe('AdminPaymentOrdersController', () => {
  const paymentsService = {
    listOrdersForAdmin: jest.fn(),
    getOrderForAdmin: jest.fn(),
    manualRepairOrder: jest.fn(),
    runDailyReconciliation: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paged admin order list payload', async () => {
    paymentsService.listOrdersForAdmin.mockResolvedValue({
      items: [
        {
          orderNo: 'PO_ADMIN_1',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const controller = new AdminPaymentOrdersController(paymentsService as any);
    const result = await controller.listOrders({
      page: 1,
      pageSize: 20,
      status: 'PAID',
    } as any);

    expect(paymentsService.listOrdersForAdmin).toHaveBeenCalledWith({
      query: {
        page: 1,
        pageSize: 20,
        status: 'PAID',
      },
    });
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          orderNo: 'PO_ADMIN_1',
        }),
      ],
      meta: {
        total: 1,
        page: 1,
        pageSize: 20,
      },
    });
  });

  it('returns admin order detail payload', async () => {
    paymentsService.getOrderForAdmin.mockResolvedValue({
      orderNo: 'PO_ADMIN_DETAIL',
      orderStatus: 'PAID',
    });

    const controller = new AdminPaymentOrdersController(paymentsService as any);
    const result = await controller.getOrder('PO_ADMIN_DETAIL');

    expect(paymentsService.getOrderForAdmin).toHaveBeenCalledWith({
      orderNo: 'PO_ADMIN_DETAIL',
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        orderNo: 'PO_ADMIN_DETAIL',
      }),
    });
  });

  it('runs manual repair from admin order route', async () => {
    paymentsService.manualRepairOrder.mockResolvedValue({
      orderNo: 'PO_ADMIN_DETAIL',
      repaired: true,
    });

    const controller = new AdminPaymentOrdersController(paymentsService as any);
    const req = {
      user: {
        id: 'admin-1',
      },
    } as any;
    const result = await controller.manualRepairOrder(req, 'PO_ADMIN_DETAIL');

    expect(paymentsService.manualRepairOrder).toHaveBeenCalledWith({
      orderNo: 'PO_ADMIN_DETAIL',
      operatorUserId: 'admin-1',
    });
    expect(result).toEqual({
      success: true,
      data: {
        orderNo: 'PO_ADMIN_DETAIL',
        repaired: true,
      },
    });
  });

  it('runs reconciliation from admin order route', async () => {
    paymentsService.runDailyReconciliation.mockResolvedValue({
      bizDate: '2026-03-30',
      status: 'DONE',
      diffCount: 0,
    });

    const controller = new AdminPaymentOrdersController(paymentsService as any);
    const req = {
      user: {
        id: 'admin-1',
      },
    } as any;
    const result = await controller.runReconciliation(req, {
      date: '2026-03-30',
      force: true,
    } as any);

    expect(paymentsService.runDailyReconciliation).toHaveBeenCalledWith({
      operatorUserId: 'admin-1',
      dto: {
        date: '2026-03-30',
        force: true,
      },
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        bizDate: '2026-03-30',
      }),
    });
  });
});
