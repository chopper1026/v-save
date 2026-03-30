// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserCenter from './UserCenter'

const mockNavigate = vi.fn()
const mockSetSearchParams = vi.fn()
const mockApiGet = vi.fn()
const mockWindowOpen = vi.fn()

const createOrderItem = (overrides: Record<string, any> = {}) => ({
  orderNo: 'PO202603260001',
  orderStatus: 'OPEN',
  orderStatusLabel: '待支付',
  planCode: 'QUARTER',
  amountMinor: 1990,
  currency: 'CNY',
  paidAt: null,
  createdAt: '2026-03-26T09:00:00.000Z',
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
    useSearchParams: () => [new URLSearchParams('tab=orders'), mockSetSearchParams],
  }
})

vi.mock('../components/Header', () => ({
  default: () => <div>Header</div>,
}))

vi.mock('../components/Sidebar', () => ({
  default: ({ activeTab }: { activeTab?: string }) => <div>Sidebar-{activeTab}</div>,
}))

vi.mock('../components/DownloadHistory', () => ({
  default: () => <div>DownloadHistory</div>,
}))

vi.mock('../components/ConfirmDialog', () => ({
  default: () => null,
}))

vi.mock('../components/auth/BilibiliAuthPanel', () => ({
  default: () => null,
}))

vi.mock('../components/auth/DouyinAuthPanel', () => ({
  default: () => null,
}))

vi.mock('../hooks/useDouyinAuthManager', () => ({
  useDouyinAuthManager: () => ({
    status: null,
    cookieInput: '',
    setCookieInput: vi.fn(),
    message: '',
    error: '',
    isLoadingStatus: false,
    isSubmitting: false,
    sourceLabel: '',
    bridgeHelperAvailability: null,
    bridgeStatus: null,
    bridgeMessage: '',
    bridgeError: '',
    isStartingBridge: false,
    startBridgeLogin: vi.fn(),
    saveCookie: vi.fn(),
    clearSession: vi.fn(),
  }),
}))

const notificationStoreState = {
  setUnreadCount: vi.fn(),
  decrementUnreadCount: vi.fn(),
  unreadCount: 0,
}

vi.mock('../store/useNotificationStore', () => ({
  useNotificationStore: (selector: any) => selector(notificationStoreState),
}))

vi.mock('../store/useUserStore', () => ({
  useUserStore: () => ({
    user: {
      id: 'user-1',
      name: '测试用户',
      email: 'u@example.com',
      role: 'USER',
      isVip: false,
      membershipLevel: 'FREE',
      vipExpireDate: null,
    },
    isLoggedIn: true,
    isHydrated: true,
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('UserCenter orders tab', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockWindowOpen.mockReset()

    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: mockWindowOpen,
    })

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/notifications') {
        return Promise.resolve({
          data: {
            success: true,
            data: [],
            meta: {
              total: 0,
              page: 1,
              pageSize: 20,
            },
          },
        })
      }

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
                usedToday: 1,
                remainingToday: 4,
                dailyLimit: 5,
              },
            },
          },
        })
      }

      if (url === '/payments/orders') {
        return Promise.resolve({
          data: {
            success: true,
            data: [createOrderItem()],
            meta: {
              total: 1,
              page: 1,
              pageSize: 10,
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

  it('loads and renders payment orders when orders tab is active', async () => {
    render(<UserCenter />)

    await waitFor(() => {
      expect(
        mockApiGet.mock.calls.some((call) => {
          const [url, config] = call
          return url === '/payments/orders'
            && config?.params?.page === 1
            && config?.params?.pageSize === 10
        }),
      ).toBe(true)
    })

    expect(await screen.findByText('订单记录')).toBeTruthy()
    expect(await screen.findByText('PO202603260001')).toBeTruthy()
    expect(screen.getByText('待支付')).toBeTruthy()
    expect(screen.getByText((_, node) => node?.textContent === '套餐：季卡会员')).toBeTruthy()
    expect(screen.getByText('共 1 条订单，第 1 / 1 页')).toBeTruthy()
  })

  it('shows primary action for open order and redirects to vip recovery page', async () => {
    render(<UserCenter />)

    const continueButton = await screen.findByRole('button', { name: '继续支付' })
    fireEvent.click(continueButton)

    expect(mockWindowOpen).toHaveBeenCalledWith('/vip?orderNo=PO202603260001', '_self')
  })
})
