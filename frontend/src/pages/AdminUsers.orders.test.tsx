// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsers from './AdminUsers'

const mockNavigate = vi.fn()
const mockSetSearchParams = vi.fn()
const mockApiGet = vi.fn()
let currentSearch = 'tab=orders'

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

vi.mock('../components/AdminAuthManagement', () => ({
  default: () => <div>AdminAuthManagement</div>,
}))

vi.mock('../components/DownloadModeManagement', () => ({
  default: () => <div>DownloadModeManagement</div>,
}))

vi.mock('../components/AdminRuntimeDashboard', () => ({
  default: () => <div>AdminRuntimeDashboard</div>,
}))

vi.mock('../components/AdminOrderManagement', () => ({
  default: () => <div>AdminOrderManagement</div>,
}))

vi.mock('../store/useUserStore', () => ({
  useUserStore: () => ({
    user: {
      id: 'admin-1',
      role: 'SUPER_ADMIN',
      email: 'admin@example.com',
    },
    isLoggedIn: true,
    isHydrated: true,
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    patch: vi.fn(),
    post: vi.fn(),
  },
}))

describe('AdminUsers orders tab', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockSetSearchParams.mockReset()
    currentSearch = 'tab=orders'
    mockApiGet.mockResolvedValue({
      data: {
        success: true,
        data: [],
        meta: {
          total: 0,
          page: 1,
          pageSize: 10,
        },
      },
    })
  })

  it('renders admin order tab and mounts order management view', async () => {
    render(<AdminUsers />)

    expect(await screen.findByText('订单管理')).toBeTruthy()
    expect(await screen.findByText('AdminOrderManagement')).toBeTruthy()
  })

  it('shows payment module option in audit filters', async () => {
    currentSearch = 'tab=audit'

    render(<AdminUsers />)

    expect(await screen.findByRole('option', { name: '支付订单' })).toBeTruthy()
  })
})
