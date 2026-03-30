// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VIPCenter from './VIPCenter'

const mockNavigate = vi.fn()
const mockSetSearchParams = vi.fn()
const mockApiPost = vi.fn()
const mockApiGet = vi.fn()
const mockUpdateUser = vi.fn()
const LATEST_PENDING_ORDER_KEY = 'vip:latest-pending-order-no'
const TEST_USER_ID = 'user-1'
let currentSearch = ''

const createOrderView = (overrides: Record<string, any> = {}) => ({
  orderNo: 'PO202603260001',
  orderStatus: 'OPEN',
  orderStatusLabel: '待支付',
  planCode: 'MONTH',
  planName: '月卡会员',
  amountMinor: 690,
  currency: 'CNY',
  checkoutUrl: null,
  paidAt: null,
  primaryAction: {
    type: 'RESUME_PAYMENT',
    label: '继续支付',
    enabled: true,
    reason: null,
    reasonCode: null,
    kind: 'API',
    endpoint: '/payments/orders/PO202603260001/recheckout',
    method: 'POST',
    requiresIdempotencyKey: true,
    checkoutUrl: null,
  },
  ...overrides,
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    Link: ({ to, children, ...props }: any) => (
      <a href={String(to)} {...props}>{children}</a>
    ),
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(currentSearch), mockSetSearchParams],
  }
})

vi.mock('../components/Header', () => ({
  default: () => <div>Header</div>,
}))

vi.mock('../store/useUserStore', () => ({
  useUserStore: () => ({
    user: {
      id: TEST_USER_ID,
      name: '测试用户',
      email: 'u@example.com',
      role: 'USER',
      isVip: false,
      membershipLevel: 'FREE',
      vipExpireDate: null,
    },
    isLoggedIn: true,
    updateUser: mockUpdateUser,
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('VIPCenter order creation', () => {
  beforeEach(() => {
    currentSearch = ''
    localStorage.clear()
    mockApiPost.mockReset()
    mockApiGet.mockReset()
    mockUpdateUser.mockReset()

    mockApiPost.mockImplementation((url: string) => {
      if (url === '/payments/orders/PO_PENDING_RESUME/recheckout') {
        return Promise.resolve({
          data: {
            success: true,
            data: createOrderView({
              orderNo: 'PO_PENDING_RESUME',
              checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_resume_123',
              primaryAction: {
                type: 'RESUME_PAYMENT',
                label: '继续支付',
                enabled: true,
                reason: null,
                reasonCode: null,
                kind: 'API',
                endpoint: '/payments/orders/PO_PENDING_RESUME/recheckout',
                method: 'POST',
                requiresIdempotencyKey: true,
                checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_resume_123',
              },
            }),
          },
        })
      }

      return Promise.resolve({
        data: {
          success: true,
          data: createOrderView({
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_live_123',
          }),
        },
      })
    })

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/payments/subscription-status') {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              membershipLevel: 'FREE',
              vipExpireDate: null,
              isLifetime: false,
              benefits: {
                supportedPlatforms: ['douyin', 'bilibili'],
                maxQuality: '720p',
                unlimitedDownloads: false,
              },
              quota: {
                usedToday: 0,
                remainingToday: 5,
                dailyLimit: 5,
              },
            },
          },
        })
      }

      if (url === '/payments/orders/PO_LOCAL_RECOVER') {
        return Promise.resolve({
          data: {
            success: true,
            data: createOrderView({
              orderNo: 'PO_LOCAL_RECOVER',
              orderStatus: 'PAID',
              orderStatusLabel: '已支付',
              primaryAction: {
                type: 'VIEW_SUCCESS',
                label: '查看会员权益',
                enabled: true,
                reason: null,
                reasonCode: null,
                kind: 'LINK',
                href: '/vip',
              },
            }),
          },
        })
      }

      if (url === '/payments/orders/PO_PENDING_RESUME') {
        return Promise.resolve({
          data: {
            success: true,
            data: createOrderView({
              orderNo: 'PO_PENDING_RESUME',
              primaryAction: {
                type: 'RESUME_PAYMENT',
                label: '继续支付',
                enabled: true,
                reason: null,
                reasonCode: null,
                kind: 'API',
                endpoint: '/payments/orders/PO_PENDING_RESUME/recheckout',
                method: 'POST',
                requiresIdempotencyKey: true,
                checkoutUrl: null,
              },
            }),
          },
        })
      }

      if (url === '/payments/orders/PO_SERVER_PENDING') {
        return Promise.resolve({
          data: {
            success: true,
            data: createOrderView({
              orderNo: 'PO_SERVER_PENDING',
              orderStatus: 'CLOSED',
              orderStatusLabel: '已关闭',
              primaryAction: {
                type: 'CREATE_NEW_ORDER',
                label: '重新购买',
                enabled: true,
                reason: '该订单已失效，可重新发起支付',
                reasonCode: 'ORDER_NOT_RECOVERABLE',
                kind: 'LINK',
                href: '/vip',
              },
            }),
          },
        })
      }

      if (url === '/users/profile') {
        return Promise.resolve({
          data: {
            membershipLevel: 'VIP',
            vipExpireDate: '2030-01-01T00:00:00.000Z',
          },
        })
      }

      return Promise.resolve({
        data: {
          success: true,
          data: createOrderView({
            orderStatus: 'CLOSED',
            orderStatusLabel: '已关闭',
            primaryAction: {
              type: 'CREATE_NEW_ORDER',
              label: '重新购买',
              enabled: true,
              reason: '该订单已失效，可重新发起支付',
              reasonCode: 'ORDER_NOT_RECOVERABLE',
              kind: 'LINK',
              href: '/vip',
            },
          }),
        },
      })
    })

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        href: 'http://localhost:3000/vip',
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('creates order with RMB-only payload and sends idempotency key header', async () => {
    render(<VIPCenter />)

    expect(screen.queryByText('支付币种')).toBeNull()
    expect(screen.queryByText('美元 USD')).toBeNull()

    const payButtons = screen.getAllByRole('button', { name: '立即支付' })
    fireEvent.click(payButtons[0])

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(1)
    })

    const [url, body, config] = mockApiPost.mock.calls[0]
    expect(url).toBe('/payments/orders')
    expect(body).toEqual({
      planCode: 'MONTH',
      clientType: 'WEB',
    })
    expect(body).not.toHaveProperty('preferredCurrency')

    expect(typeof config?.headers?.['idempotency-key']).toBe('string')
    expect(config.headers['idempotency-key'].length).toBeGreaterThan(0)
  })

  it('shows membership summary and perks section', async () => {
    render(<VIPCenter />)

    expect(screen.getByText('会员信息总览')).toBeTruthy()
    expect(screen.getByText('免费用户')).toBeTruthy()
    expect(screen.getByText('未开通')).toBeTruthy()
    expect(screen.getByText('今日剩余次数')).toBeTruthy()
    expect(screen.getByText('5 次')).toBeTruthy()
    expect(screen.getAllByText('支持平台').length).toBeGreaterThan(0)
    expect(screen.getAllByText('抖音、哔哩哔哩').length).toBeGreaterThan(0)
    expect(screen.getAllByText('最高画质').length).toBeGreaterThan(0)
    expect(screen.getByText('720P')).toBeTruthy()
    expect(screen.getByText('当前可用特权')).toBeTruthy()
  })

  it('restores pending order from explicit order query without keeping sync state forever', async () => {
    currentSearch = 'orderNo=PO_PENDING_RESUME'

    render(<VIPCenter />)

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/payments/orders/PO_PENDING_RESUME')
    })

    expect(
      await screen.findByText((_, node) => node?.textContent === '当前订单：PO_PENDING_RESUME'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '继续支付' })).toBeTruthy()
    expect(screen.queryByText('正在同步支付结果...')).toBeNull()
    expect(screen.getAllByRole('button', { name: '立即支付' }).length).toBeGreaterThan(0)
  })

  it('loads pending order details when returning with cancel status', async () => {
    currentSearch = 'orderNo=PO_PENDING_RESUME&status=cancel'

    render(<VIPCenter />)

    await waitFor(() => {
      expect(screen.getByText('支付已取消，可重新发起支付')).toBeTruthy()
    })

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/payments/orders/PO_PENDING_RESUME')
    })

    expect(
      await screen.findByText((_, node) => node?.textContent === '当前订单：PO_PENDING_RESUME'),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: '继续支付' })).toBeTruthy()
  })

  it('ignores pending orders saved for a different user', async () => {
    localStorage.setItem(`${LATEST_PENDING_ORDER_KEY}:other-user`, 'PO_OTHER_USER')

    render(<VIPCenter />)

    await waitFor(() => {
      expect(
        mockApiGet.mock.calls.some((call) => {
          const [url] = call as [string]
          return url === '/payments/orders'
        }),
      ).toBe(true)
    })

    expect(mockApiGet).not.toHaveBeenCalledWith('/payments/orders/PO_OTHER_USER')
    expect(screen.queryByText('查询订单状态失败，请稍后重试')).toBeNull()
  })

  it('restores pending order from local storage when no query is provided', async () => {
    localStorage.setItem(`${LATEST_PENDING_ORDER_KEY}:${TEST_USER_ID}`, 'PO_LOCAL_RECOVER')

    render(<VIPCenter />)

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/payments/orders/PO_LOCAL_RECOVER')
    })

    await waitFor(() => {
      expect(localStorage.getItem(LATEST_PENDING_ORDER_KEY)).toBeNull()
    })
  })

  it('recovers latest pending order from server when local order is absent', async () => {
    mockApiGet.mockImplementation((url: string, config?: any) => {
      if (url === '/payments/orders') {
        return Promise.resolve({
          data: {
            success: true,
            data: [
              createOrderView({
                orderNo: 'PO_SERVER_PENDING',
              }),
            ],
            meta: {
              total: 1,
              page: 1,
              pageSize: 1,
            },
          },
        })
      }

      if (url === '/payments/orders/PO_SERVER_PENDING') {
        return Promise.resolve({
          data: {
            success: true,
            data: createOrderView({
              orderNo: 'PO_SERVER_PENDING',
              orderStatus: 'CLOSED',
              orderStatusLabel: '已关闭',
              primaryAction: {
                type: 'CREATE_NEW_ORDER',
                label: '重新购买',
                enabled: true,
                reason: '该订单已失效，可重新发起支付',
                reasonCode: 'ORDER_NOT_RECOVERABLE',
                kind: 'LINK',
                href: '/vip',
              },
            }),
          },
        })
      }

      if (url === '/users/profile') {
        return Promise.resolve({ data: {} })
      }

      void config
      return Promise.resolve({ data: { success: true, data: {} } })
    })

    render(<VIPCenter />)

    await waitFor(() => {
      expect(
        mockApiGet.mock.calls.some((call) => {
          const [url, cfg] = call as [string, any]
          return (
            url === '/payments/orders'
            && cfg?.params?.status === 'OPEN'
            && cfg?.params?.page === 1
            && cfg?.params?.pageSize === 1
          )
        }),
      ).toBe(true)
    })

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/payments/orders/PO_SERVER_PENDING')
    })

    await waitFor(() => {
      expect(localStorage.getItem(LATEST_PENDING_ORDER_KEY)).toBeNull()
    })
  })

  it('renders cancel-return actions as a clear primary-secondary action group', async () => {
    currentSearch = 'orderNo=PO_PENDING_RESUME&status=cancel'

    render(<VIPCenter />)

    await screen.findByRole('button', { name: '继续支付' })

    const actionGroup = screen.getByRole('group', { name: '订单操作' })
    const resumeButton = screen.getByRole('button', { name: '继续支付' })
    const orderRecordButton = screen.getByRole('button', { name: '查看订单记录' })

    expect(actionGroup.className).toContain('flex-col')
    expect(actionGroup.className).toContain('gap-3')
    expect(actionGroup.className).toContain('border-t')
    expect(actionGroup.className).toContain('pt-3')
    expect(resumeButton.className).toContain('h-10')
    expect(resumeButton.className).toContain('w-full')
    expect(resumeButton.className).toContain('px-4')
    expect(orderRecordButton.className).toContain('h-10')
    expect(orderRecordButton.className).toContain('border')
    expect(orderRecordButton.className).toContain('w-full')
    expect(orderRecordButton.className).toContain('px-4')
  })

  it('navigates to order records from cancel-return action button', async () => {
    currentSearch = 'orderNo=PO_PENDING_RESUME&status=cancel'

    render(<VIPCenter />)

    const orderRecordButton = await screen.findByRole('button', { name: '查看订单记录' })
    fireEvent.click(orderRecordButton)

    expect(mockNavigate).toHaveBeenCalledWith('/user?tab=orders')
  })

  it('requests recheckout url when clicking continue payment button', async () => {
    currentSearch = 'orderNo=PO_PENDING_RESUME&status=success'

    render(<VIPCenter />)

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/payments/orders/PO_PENDING_RESUME')
    })

    const resumeButton = await screen.findByRole('button', { name: '继续支付' })
    fireEvent.click(resumeButton)

    await waitFor(() => {
      const recheckoutCall = mockApiPost.mock.calls.find((call) => {
        const [url] = call as [string]
        return url === '/payments/orders/PO_PENDING_RESUME/recheckout'
      })
      expect(recheckoutCall).toBeTruthy()
    })

    const recheckoutCall = mockApiPost.mock.calls.find((call) => {
      const [url] = call as [string]
      return url === '/payments/orders/PO_PENDING_RESUME/recheckout'
    })
    expect(typeof recheckoutCall?.[2]?.headers?.['idempotency-key']).toBe('string')
    expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_resume_123')
  })
})
