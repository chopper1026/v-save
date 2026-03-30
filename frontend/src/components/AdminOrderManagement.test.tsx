// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminOrderManagement from './AdminOrderManagement'

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
  },
}))

const listResponse = {
  success: true,
  data: [
    {
      orderNo: 'PO_ADMIN_1',
      planCode: 'YEAR',
      planName: '年卡会员',
      amountMinor: 19900,
      currency: 'CNY',
      orderStatus: 'PAID',
      orderStatusLabel: '已支付',
      refundStatus: 'NONE',
      createdAt: '2026-03-30T09:00:00.000Z',
      paidAt: '2026-03-30T09:02:00.000Z',
      latestAttempt: {
        attemptNo: 'PA_ADMIN_1',
        status: 'PAID',
        statusLabel: '已支付',
        reasonCode: null,
        expiresAt: null,
        finishedAt: '2026-03-30T09:02:00.000Z',
        failureReason: null,
      },
      primaryAction: {
        type: 'VIEW_SUCCESS',
        label: '查看会员权益',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'LINK',
        href: '/vip',
      },
      user: {
        id: 'user-1',
        email: 'buyer@example.com',
        nickname: '购买用户',
        phone: '13800000000',
        membershipLevel: 'VIP',
        vipExpireDate: '2026-04-30T00:00:00.000Z',
      },
    },
    {
      orderNo: 'PO_ADMIN_2',
      planCode: 'MONTH',
      planName: '月卡会员',
      amountMinor: 690,
      currency: 'CNY',
      orderStatus: 'OPEN',
      orderStatusLabel: '待支付',
      refundStatus: 'NONE',
      createdAt: '2026-03-29T09:00:00.000Z',
      paidAt: null,
      latestAttempt: {
        attemptNo: 'PA_ADMIN_2',
        status: 'OPEN',
        statusLabel: '待支付',
        reasonCode: null,
        expiresAt: '2026-03-29T09:30:00.000Z',
        finishedAt: null,
        failureReason: null,
      },
      primaryAction: {
        type: 'RESUME_PAYMENT',
        label: '继续支付',
        enabled: true,
        reason: null,
        reasonCode: null,
        kind: 'API',
      },
      user: {
        id: 'user-2',
        email: 'buyer2@example.com',
        nickname: '第二个用户',
        phone: null,
        membershipLevel: 'FREE',
        vipExpireDate: null,
      },
    },
  ],
  meta: {
    total: 2,
    page: 1,
    pageSize: 20,
  },
}

const detailResponse = {
  success: true,
  data: {
    orderNo: 'PO_ADMIN_1',
    planCode: 'YEAR',
    planName: '年卡会员',
    amountMinor: 19900,
    currency: 'CNY',
    createdAt: '2026-03-30T09:00:00.000Z',
    paidAt: '2026-03-30T09:02:00.000Z',
    recoveryWindowEndsAt: null,
    orderStatus: 'PAID',
    orderStatusLabel: '已支付',
    closeReasonCode: null,
    latestAttempt: {
      attemptNo: 'PA_ADMIN_1',
      status: 'PAID',
      statusLabel: '已支付',
      reasonCode: null,
      expiresAt: null,
      finishedAt: '2026-03-30T09:02:00.000Z',
      failureReason: null,
    },
    primaryAction: {
      type: 'VIEW_SUCCESS',
      label: '查看会员权益',
      enabled: true,
      reason: null,
      reasonCode: null,
      kind: 'LINK',
      href: '/vip',
    },
    secondaryActions: [],
    timeline: [],
    refund: {
      eligible: false,
      deadlineAt: null,
      reason: null,
      latestStatus: 'NONE',
    },
    status: 'PAID',
    checkoutUrl: null,
    user: {
      id: 'user-1',
      email: 'buyer@example.com',
      nickname: '购买用户',
      phone: '13800000000',
      membershipLevel: 'VIP',
      vipExpireDate: '2026-04-30T00:00:00.000Z',
    },
    entitlement: {
      planCode: 'YEAR',
      status: 'ACTIVE',
      grantDays: 365,
      isLifetime: false,
      effectiveStartAt: '2026-03-30T09:02:00.000Z',
      effectiveEndAt: '2027-03-30T09:02:00.000Z',
      revokedAt: null,
      revokedReason: null,
    },
    providerRefs: {
      checkoutSessionId: 'cs_admin_1',
      paymentIntentId: 'pi_admin_1',
    },
    latestRefundRecord: null,
    operations: {
      canManualRepair: true,
    },
  },
}

const detailResponse2 = {
  success: true,
  data: {
    ...detailResponse.data,
    orderNo: 'PO_ADMIN_2',
    planCode: 'MONTH',
    planName: '月卡会员',
    amountMinor: 690,
    orderStatus: 'OPEN',
    orderStatusLabel: '待支付',
    paidAt: null,
    latestAttempt: {
      attemptNo: 'PA_ADMIN_2',
      status: 'OPEN',
      statusLabel: '待支付',
      reasonCode: null,
      expiresAt: '2026-03-29T09:30:00.000Z',
      finishedAt: null,
      failureReason: null,
    },
    user: {
      id: 'user-2',
      email: 'buyer2@example.com',
      nickname: '第二个用户',
      phone: null,
      membershipLevel: 'FREE',
      vipExpireDate: null,
    },
    providerRefs: {
      checkoutSessionId: 'cs_admin_2',
      paymentIntentId: null,
    },
    operations: {
      canManualRepair: false,
    },
  },
}

describe('AdminOrderManagement', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiPost.mockReset()

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/admin/orders') {
        return Promise.resolve({ data: listResponse })
      }

      if (url === '/admin/orders/PO_ADMIN_1') {
        return Promise.resolve({ data: detailResponse })
      }

      if (url === '/admin/orders/PO_ADMIN_2') {
        return Promise.resolve({ data: detailResponse2 })
      }

      return Promise.resolve({
        data: {
          success: true,
          data: {},
        },
      })
    })

    mockApiPost.mockImplementation((url: string) => {
      if (url === '/admin/orders/PO_ADMIN_1/manual-repair') {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              orderNo: 'PO_ADMIN_1',
              repaired: true,
            },
          },
        })
      }

      if (url === '/admin/orders/reconciliation') {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              bizDate: '2026-03-30',
              status: 'DONE',
              diffCount: 0,
              platformOrderCount: 1,
              localPaidOrderCount: 1,
            },
          },
        })
      }

      return Promise.resolve({
        data: {
          success: true,
          data: {},
        },
      })
    })
  })

  it('loads orders and selected order detail on mount', async () => {
    render(<AdminOrderManagement />)

    expect((await screen.findAllByText('PO_ADMIN_1')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('buyer@example.com')).length).toBeGreaterThan(0)
    expect(await screen.findByText('创建起始')).toBeTruthy()
    expect(await screen.findByText('创建结束')).toBeTruthy()
    expect(await screen.findByText('支付尝试')).toBeTruthy()
    expect(await screen.findByText('渠道引用')).toBeTruthy()
    expect(screen.getByText('cs_admin_1')).toBeTruthy()
    const detailPanel = screen.getByText('订单详情').closest('.bg-white')
    expect(detailPanel?.className).toContain('overflow-y-auto')
  })

  it('switches selected order without refetching the whole list', async () => {
    render(<AdminOrderManagement />)

    expect((await screen.findAllByText('PO_ADMIN_2')).length).toBeGreaterThan(0)
    const listCallsBefore = mockApiGet.mock.calls.filter((call) => call[0] === '/admin/orders').length

    fireEvent.click(screen.getAllByRole('button', { name: /PO_ADMIN_2/ })[0])

    expect((await screen.findAllByText('buyer2@example.com')).length).toBeGreaterThan(0)
    const listCallsAfter = mockApiGet.mock.calls.filter((call) => call[0] === '/admin/orders').length
    expect(listCallsAfter).toBe(listCallsBefore)
  })

  it('runs manual repair and reconciliation actions', async () => {
    render(<AdminOrderManagement />)

    const repairButton = (await screen.findAllByRole('button', { name: '执行补单' }))[0]
    fireEvent.click(repairButton)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/admin/orders/PO_ADMIN_1/manual-repair')
    })
    expect(await screen.findByText('补单已完成：PO_ADMIN_1')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('对账日期'), {
      target: {
        value: '2026-03-30',
      },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '执行对账' })[0])

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/admin/orders/reconciliation', {
        date: '2026-03-30',
        force: false,
      })
    })
    expect(await screen.findByText('对账结果')).toBeTruthy()
    expect(screen.getByText('差异订单：0')).toBeTruthy()
  })

  it('renders compact force rerun toggle aligned with reconciliation action', async () => {
    render(<AdminOrderManagement />)

    const rerunToggle = (await screen.findAllByText('强制重跑'))[0]
    const rerunLabel = rerunToggle.closest('label')
    const executeButton = screen.getAllByRole('button', { name: '执行对账' })[0]

    expect(rerunLabel?.className).toContain('h-10')
    expect(rerunLabel?.className).toContain('text-xs')
    expect(executeButton.className).toContain('h-10')
  })
})
