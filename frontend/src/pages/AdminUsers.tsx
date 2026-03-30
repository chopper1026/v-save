import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, ClipboardList, KeyRound, Receipt, SlidersHorizontal, Users } from 'lucide-react'
import Header from '../components/Header'
import AdminAuthManagement from '../components/AdminAuthManagement'
import AdminOrderManagement from '../components/AdminOrderManagement'
import DownloadModeManagement from '../components/DownloadModeManagement'
import { api } from '../lib/api'
import { useUserStore } from '../store/useUserStore'

type AdminTab = 'users' | 'audit' | 'auth' | 'download-policy' | 'runtime' | 'orders'

interface AdminUserItem {
  id: string
  email: string
  nickname: string
  role: 'SUPER_ADMIN' | 'USER'
  membershipLevel: 'FREE' | 'VIP'
  accountStatus: 'ACTIVE' | 'DISABLED'
  phone: string | null
  vipExpireDate: string | null
  downloadCount: number
  createdAt: string
  updatedAt: string
}

interface AdminAuditItem {
  id: string
  adminUserId: string
  adminEmail: string | null
  targetUserId: string
  targetEmail: string | null
  action: string
  module: 'USER' | 'ROLE' | 'AUTH' | 'DOWNLOAD_POLICY' | 'PAYMENT'
  platform: 'BILIBILI' | 'DOUYIN' | 'NONE'
  targetType: 'USER' | 'AUTH_SESSION' | 'SYSTEM'
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  reason: string | null
  createdAt: string
}

interface PagedResponse<T> {
  success: boolean
  data: T[]
  meta?: {
    total: number
    page: number
    pageSize: number
  }
}

type AuditModuleFilter = 'ALL' | 'USER' | 'ROLE' | 'AUTH' | 'DOWNLOAD_POLICY' | 'PAYMENT'
type AuditPlatformFilter = 'ALL' | 'BILIBILI' | 'DOUYIN' | 'NONE'

const USER_PAGE_SIZE_OPTIONS = [10, 20, 50]
const AUDIT_PAGE_SIZE_OPTIONS = [10, 20, 50]

const TABS: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'runtime', label: '运行看板', icon: Activity },
  { id: 'download-policy', label: '下载模式管理', icon: SlidersHorizontal },
  { id: 'auth', label: '登录态管理', icon: KeyRound },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'orders', label: '订单管理', icon: Receipt },
  { id: 'audit', label: '操作审计', icon: ClipboardList },
]

const DEFAULT_ADMIN_TAB: AdminTab = TABS[0]?.id ?? 'runtime'

const ROLE_LABEL_MAP: Record<'SUPER_ADMIN' | 'USER', string> = {
  SUPER_ADMIN: '超级管理员',
  USER: '普通用户',
}

const STATUS_LABEL_MAP: Record<'ACTIVE' | 'DISABLED', string> = {
  ACTIVE: '启用',
  DISABLED: '禁用',
}

const MEMBERSHIP_LABEL_MAP: Record<'FREE' | 'VIP', string> = {
  FREE: 'FREE',
  VIP: 'VIP',
}

const AdminRuntimeDashboard = lazy(() => import('../components/AdminRuntimeDashboard'))

const asRecord = (value: Record<string, unknown> | null | undefined) => {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value
}

const getString = (record: Record<string, unknown> | null, key: string) => {
  if (!record) return ''
  const value = record[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

const getBoolean = (record: Record<string, unknown> | null, key: string) => {
  if (!record) return false
  return record[key] === true
}

export default function AdminUsers() {
  const { user, isLoggedIn, isHydrated } = useUserStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const rawTab = searchParams.get('tab')
  const requestedTab = rawTab === 'roles' ? 'users' : rawTab
  const activeTab: AdminTab = requestedTab && TABS.some((item) => item.id === requestedTab as AdminTab)
    ? (requestedTab as AdminTab)
    : DEFAULT_ADMIN_TAB

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'SUPER_ADMIN' | 'USER'>('ALL')
  const [membershipFilter, setMembershipFilter] = useState<'ALL' | 'FREE' | 'VIP'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL')
  const [userPage, setUserPage] = useState(1)
  const [userPageSize, setUserPageSize] = useState(10)
  const [userTotal, setUserTotal] = useState(0)
  const [operatingUserId, setOperatingUserId] = useState<string | null>(null)

  const [audits, setAudits] = useState<AdminAuditItem[]>([])
  const [isLoadingAudit, setIsLoadingAudit] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(10)
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditModuleFilter, setAuditModuleFilter] = useState<AuditModuleFilter>('ALL')
  const [auditPlatformFilter, setAuditPlatformFilter] = useState<AuditPlatformFilter>('ALL')
  const [auditKeyword, setAuditKeyword] = useState('')

  const userTotalPages = Math.max(1, Math.ceil(userTotal / userPageSize))
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize))

  const formatDateTime = (value?: string | null) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  const formatDateOnly = (value?: string | null) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleDateString('zh-CN')
  }

  const fetchUsers = useCallback(async () => {
    if (!isLoggedIn || !isSuperAdmin) {
      return
    }

    try {
      setIsLoadingUsers(true)
      setUsersError('')
      const response = await api.get<PagedResponse<AdminUserItem>>('/admin/users', {
        params: {
          page: userPage,
          pageSize: userPageSize,
          keyword: userKeyword.trim() || undefined,
          role: roleFilter !== 'ALL' ? roleFilter : undefined,
          membershipLevel: membershipFilter !== 'ALL' ? membershipFilter : undefined,
          accountStatus: statusFilter !== 'ALL' ? statusFilter : undefined,
        },
      })

      if (response.data?.success) {
        setUsers(response.data?.data || [])
        setUserTotal(Number(response.data?.meta?.total || 0))
      } else {
        setUsersError('获取用户列表失败')
      }
    } catch (err) {
      console.error('获取用户列表失败:', err)
      setUsersError('获取用户列表失败，请稍后重试')
    } finally {
      setIsLoadingUsers(false)
    }
  }, [
    isLoggedIn,
    isSuperAdmin,
    membershipFilter,
    roleFilter,
    statusFilter,
    userKeyword,
    userPage,
    userPageSize,
  ])

  const fetchAuditLogs = useCallback(async () => {
    if (!isLoggedIn || !isSuperAdmin) {
      return
    }

    try {
      setIsLoadingAudit(true)
      setAuditError('')
      const response = await api.get<PagedResponse<AdminAuditItem>>('/admin/audit', {
        params: {
          page: auditPage,
          pageSize: auditPageSize,
          module: auditModuleFilter !== 'ALL' ? auditModuleFilter : undefined,
          platform: auditPlatformFilter !== 'ALL' ? auditPlatformFilter : undefined,
          keyword: auditKeyword.trim() || undefined,
        },
      })
      if (response.data?.success) {
        setAudits(response.data?.data || [])
        setAuditTotal(Number(response.data?.meta?.total || 0))
      } else {
        setAuditError('获取审计日志失败')
      }
    } catch (err) {
      console.error('获取审计日志失败:', err)
      setAuditError('获取审计日志失败，请稍后重试')
    } finally {
      setIsLoadingAudit(false)
    }
  }, [
    auditKeyword,
    auditModuleFilter,
    auditPage,
    auditPageSize,
    auditPlatformFilter,
    isLoggedIn,
    isSuperAdmin,
  ])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    if (!isLoggedIn) {
      navigate('/login')
      return
    }

    if (!isSuperAdmin) {
      navigate('/user')
      return
    }
  }, [isHydrated, isLoggedIn, isSuperAdmin, navigate])

  useEffect(() => {
    if (rawTab !== activeTab) {
      setSearchParams({ tab: activeTab }, { replace: true })
    }
  }, [activeTab, rawTab, setSearchParams])

  useEffect(() => {
    if (activeTab === 'users') {
      void fetchUsers()
    }
  }, [activeTab, fetchUsers])

  useEffect(() => {
    if (activeTab === 'audit') {
      void fetchAuditLogs()
    }
  }, [activeTab, fetchAuditLogs])

  const withOperate = async (userId: string, action: () => Promise<void>) => {
    try {
      setOperatingUserId(userId)
      await action()
      await Promise.all([fetchUsers(), fetchAuditLogs()])
    } catch (err: any) {
      const message = err?.response?.data?.message
      if (Array.isArray(message)) {
        setUsersError(message[0] || '操作失败')
      } else if (typeof message === 'string') {
        setUsersError(message)
      } else {
        setUsersError('操作失败，请稍后重试')
      }
    } finally {
      setOperatingUserId(null)
    }
  }

  const handleToggleRole = async (item: AdminUserItem) => {
    const nextRole = item.role === 'SUPER_ADMIN' ? 'USER' : 'SUPER_ADMIN'
    await withOperate(item.id, async () => {
      await api.patch(`/admin/users/${item.id}/role`, {
        role: nextRole,
      })
    })
  }

  const handleToggleMembership = async (item: AdminUserItem) => {
    const nextLevel: 'FREE' | 'VIP' = item.membershipLevel === 'VIP' ? 'FREE' : 'VIP'
    const defaultVipExpireDate =
      item.vipExpireDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    await withOperate(item.id, async () => {
      await api.patch(`/admin/users/${item.id}/membership`, {
        membershipLevel: nextLevel,
        vipExpireDate: nextLevel === 'VIP' ? defaultVipExpireDate : undefined,
      })
    })
  }

  const handleToggleStatus = async (item: AdminUserItem) => {
    const nextStatus: 'ACTIVE' | 'DISABLED' =
      item.accountStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'

    await withOperate(item.id, async () => {
      await api.patch(`/admin/users/${item.id}/status`, {
        accountStatus: nextStatus,
      })
    })
  }

  const auditActionLabelMap = useMemo(() => ({
    UPDATE_ROLE: '角色调整',
    UPDATE_MEMBERSHIP: '会员调整',
    UPDATE_STATUS: '状态调整',
    UPDATE_DOWNLOAD_MODE: '下载模式更新',
    UPDATE_DOWNLOAD_MODE_CONFIG: '下载模式更新',
    BILIBILI_QRCODE_GENERATED: 'B站二维码生成',
    BILIBILI_QRCODE_CONFIRMED: 'B站扫码确认',
    BILIBILI_COOKIE_REFRESHED: 'B站Cookie刷新',
    BILIBILI_SESSION_CLEARED: 'B站登录态清空',
    DOUYIN_QRCODE_GENERATED: '抖音二维码生成',
    DOUYIN_QRCODE_CONFIRMED: '抖音扫码确认',
    DOUYIN_COOKIE_SAVED: '抖音Cookie保存',
    DOUYIN_SESSION_CLEARED: '抖音登录态清空',
    PAYMENT_MANUAL_REPAIR: '支付补单',
    PAYMENT_RECONCILIATION_RUN: '支付对账',
  } as Record<string, string>), [])

  const renderAuditDetail = (item: AdminAuditItem) => {
    const before = asRecord(item.beforeState)
    const after = asRecord(item.afterState)

    switch (item.action) {
      case 'UPDATE_ROLE': {
        const from = getString(before, 'role') as 'SUPER_ADMIN' | 'USER'
        const to = getString(after, 'role') as 'SUPER_ADMIN' | 'USER'
        if (from && to) {
          return `角色由 ${ROLE_LABEL_MAP[from] || from} 调整为 ${ROLE_LABEL_MAP[to] || to}`
        }
        break
      }
      case 'UPDATE_STATUS': {
        const from = getString(before, 'accountStatus') as 'ACTIVE' | 'DISABLED'
        const to = getString(after, 'accountStatus') as 'ACTIVE' | 'DISABLED'
        if (from && to) {
          return `账号状态由 ${STATUS_LABEL_MAP[from] || from} 调整为 ${STATUS_LABEL_MAP[to] || to}`
        }
        break
      }
      case 'UPDATE_MEMBERSHIP': {
        const from = getString(before, 'membershipLevel') as 'FREE' | 'VIP'
        const to = getString(after, 'membershipLevel') as 'FREE' | 'VIP'
        const expireAt = getString(after, 'vipExpireDate')
        if (from && to) {
          const expireText = to === 'VIP' && expireAt ? `，到期 ${formatDateTime(expireAt)}` : ''
          return `会员等级由 ${MEMBERSHIP_LABEL_MAP[from] || from} 调整为 ${MEMBERSHIP_LABEL_MAP[to] || to}${expireText}`
        }
        break
      }
      case 'BILIBILI_COOKIE_REFRESHED': {
        const message = getString(after, 'message')
        const refreshed = getBoolean(after, 'refreshed')
        if (message) return message
        return refreshed ? '已完成 B站 Cookie 刷新' : '已执行 B站 Cookie 状态检查'
      }
      case 'BILIBILI_QRCODE_GENERATED':
        return '已生成 B站扫码登录二维码'
      case 'BILIBILI_QRCODE_CONFIRMED':
        return getString(after, 'message') || 'B站扫码登录确认成功'
      case 'BILIBILI_SESSION_CLEARED':
        return '已清空 B站登录态'
      case 'DOUYIN_QRCODE_GENERATED':
        return '已生成抖音扫码登录二维码'
      case 'DOUYIN_QRCODE_CONFIRMED':
        return getString(after, 'message') || '抖音扫码登录确认成功'
      case 'DOUYIN_COOKIE_SAVED':
        return '已保存抖音 Cookie 登录态'
      case 'DOUYIN_SESSION_CLEARED':
        return '已清空抖音登录态'
      case 'UPDATE_DOWNLOAD_MODE':
      case 'UPDATE_DOWNLOAD_MODE_CONFIG': {
        const from = getString(before, 'mode')
        const to = getString(after, 'mode')
        const clientType = getString(after, 'clientType') || getString(before, 'clientType')
        const platform = getString(after, 'platform') || getString(before, 'platform')
        const targetLabel = [
          platform ? `${platform.toUpperCase()}` : '',
          clientType ? (clientType.toUpperCase() === 'WEB' ? '网页端' : '移动端') : '',
        ].filter(Boolean).join(' / ')

        if (from && to) {
          return `${targetLabel || '下载模式'} 由 ${from} 调整为 ${to}`
        }
        if (to) {
          return `${targetLabel || '下载模式'} 已更新为 ${to}`
        }
        break
      }
      case 'PAYMENT_MANUAL_REPAIR': {
        const orderNo = getString(after, 'orderNo')
        if (orderNo) {
          return `已对订单 ${orderNo} 执行补单`
        }
        break
      }
      case 'PAYMENT_RECONCILIATION_RUN': {
        const bizDate = getString(after, 'bizDate')
        const diffCount = getString(after, 'diffCount')
        if (bizDate) {
          return `${bizDate} 支付对账完成${diffCount ? `，差异 ${diffCount} 单` : ''}`
        }
        break
      }
      default:
        break
    }

    if (item.reason) {
      return item.reason
    }

    return '已执行后台管理操作'
  }

  if (!isHydrated || !isLoggedIn || !isSuperAdmin) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-12 px-4">
        <div className="max-w-[1240px] mx-auto">
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="w-full lg:w-72 xl:w-80 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 h-fit">
              <div className="mb-3 px-3">
                <h2 className="text-base font-semibold text-text-primary">后台管理</h2>
                <p className="text-xs text-text-secondary mt-1">系统治理与审计能力</p>
              </div>
              <nav className="space-y-1">
                {TABS.map((item) => {
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSearchParams({ tab: item.id })}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-text-secondary hover:bg-gray-50 hover:text-text-primary'
                      }`}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      <span className="whitespace-nowrap">{item.label}</span>
                    </button>
                  )
                })}
              </nav>
              <div className="mt-6 pt-6 border-t border-gray-100">
                <Link
                  to="/user"
                  className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors"
                >
                  返回个人中心
                </Link>
              </div>
            </aside>

            <div className="flex-1 min-w-0">
              {activeTab === 'users' && (
                <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h1 className="text-xl font-semibold text-text-primary">用户管理</h1>
                      <p className="text-sm text-text-secondary mt-1">统一管理用户状态、会员和角色分配</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-2">
                    <input
                      value={userKeyword}
                      onChange={(event) => setUserKeyword(event.target.value)}
                      placeholder="搜索邮箱 / 昵称 / 手机号"
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-4 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                    <select
                      value={roleFilter}
                      onChange={(event) => {
                        setRoleFilter(event.target.value as 'ALL' | 'SUPER_ADMIN' | 'USER')
                        setUserPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="ALL">全部角色</option>
                      <option value="SUPER_ADMIN">超级管理员</option>
                      <option value="USER">普通用户</option>
                    </select>
                    <select
                      value={membershipFilter}
                      onChange={(event) => {
                        setMembershipFilter(event.target.value as 'ALL' | 'FREE' | 'VIP')
                        setUserPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="ALL">全部会员</option>
                      <option value="FREE">FREE</option>
                      <option value="VIP">VIP</option>
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(event) => {
                        setStatusFilter(event.target.value as 'ALL' | 'ACTIVE' | 'DISABLED')
                        setUserPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="ALL">全部状态</option>
                      <option value="ACTIVE">启用</option>
                      <option value="DISABLED">禁用</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setUserPage(1)
                        void fetchUsers()
                      }}
                      className="h-9 px-3 rounded-lg text-sm bg-primary text-white hover:bg-primary/90 transition-colors xl:col-span-2"
                    >
                      查询
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <select
                      value={userPageSize}
                      onChange={(event) => {
                        setUserPageSize(Number.parseInt(event.target.value, 10))
                        setUserPage(1)
                      }}
                      className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs"
                    >
                      {USER_PAGE_SIZE_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          每页 {item} 条
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-secondary">
                      共 {userTotal} 条，第 {userPage} / {userTotalPages} 页
                    </p>
                  </div>

                  {usersError && (
                    <p className="mt-3 text-sm text-red-500">{usersError}</p>
                  )}

                  <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                    <table className="w-full table-fixed text-sm">
                      <thead>
                        <tr className="text-left text-text-secondary border-b border-gray-100">
                          <th className="py-3 px-3 w-[24%]">用户</th>
                          <th className="py-3 px-3 w-[12%]">角色</th>
                          <th className="py-3 px-3 w-[16%]">会员</th>
                          <th className="py-3 px-3 w-[12%]">状态</th>
                          <th className="py-3 px-3 w-[14%]">注册时间</th>
                          <th className="py-3 px-3 w-[22%]">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isLoadingUsers && (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-text-secondary">
                              用户列表加载中...
                            </td>
                          </tr>
                        )}
                        {!isLoadingUsers && users.length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-text-secondary">
                              暂无符合条件的用户
                            </td>
                          </tr>
                        )}
                        {!isLoadingUsers && users.map((item) => (
                          <tr key={item.id} className="border-b border-gray-50 align-top">
                            <td className="py-3 px-3">
                              <p
                                title={item.nickname || '--'}
                                className="font-medium text-text-primary truncate"
                              >
                                {item.nickname || '--'}
                              </p>
                              <p
                                title={item.email}
                                className="text-xs text-text-secondary truncate mt-0.5"
                              >
                                {item.email}
                              </p>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                item.role === 'SUPER_ADMIN'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                {ROLE_LABEL_MAP[item.role]}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                item.membershipLevel === 'VIP'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                {item.membershipLevel}
                              </span>
                              <p className="text-xs text-text-secondary mt-1 whitespace-nowrap truncate">
                                到期：{formatDateOnly(item.vipExpireDate)}
                              </p>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                item.accountStatus === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {STATUS_LABEL_MAP[item.accountStatus]}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-xs text-text-secondary">
                              {formatDateTime(item.createdAt)}
                            </td>
                            <td className="py-3 px-3">
                              <div className="grid grid-cols-1 gap-1">
                                <button
                                  type="button"
                                  disabled={operatingUserId === item.id}
                                  onClick={() => void handleToggleRole(item)}
                                  className="px-2 py-1.5 rounded-md text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-60"
                                >
                                  {item.role === 'SUPER_ADMIN' ? '设为普通用户' : '设为超级管理员'}
                                </button>
                                <button
                                  type="button"
                                  disabled={operatingUserId === item.id}
                                  onClick={() => void handleToggleMembership(item)}
                                  className="px-2 py-1.5 rounded-md text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-60"
                                >
                                  {item.membershipLevel === 'VIP' ? '设为 FREE' : '设为 VIP'}
                                </button>
                                <button
                                  type="button"
                                  disabled={operatingUserId === item.id}
                                  onClick={() => void handleToggleStatus(item)}
                                  className="px-2 py-1.5 rounded-md text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60"
                                >
                                  {item.accountStatus === 'ACTIVE' ? '禁用账号' : '启用账号'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={userPage <= 1}
                      onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={userPage >= userTotalPages}
                      onClick={() => setUserPage((prev) => Math.min(userTotalPages, prev + 1))}
                      className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'audit' && (
                <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
                  <h1 className="text-xl font-semibold text-text-primary">操作审计</h1>
                  <p className="text-sm text-text-secondary mt-1">记录后台每一步关键变更与登录态操作</p>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-2">
                    <select
                      value={auditModuleFilter}
                      onChange={(event) => {
                        setAuditModuleFilter(event.target.value as AuditModuleFilter)
                        setAuditPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2"
                    >
                      <option value="ALL">全部模块</option>
                      <option value="USER">用户管理</option>
                      <option value="ROLE">角色分配</option>
                      <option value="AUTH">登录态管理</option>
                      <option value="DOWNLOAD_POLICY">下载模式管理</option>
                      <option value="PAYMENT">支付订单</option>
                    </select>
                    <select
                      value={auditPlatformFilter}
                      onChange={(event) => {
                        setAuditPlatformFilter(event.target.value as AuditPlatformFilter)
                        setAuditPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2"
                    >
                      <option value="ALL">全部平台</option>
                      <option value="BILIBILI">B站</option>
                      <option value="DOUYIN">抖音</option>
                      <option value="NONE">系统动作</option>
                    </select>
                    <input
                      value={auditKeyword}
                      onChange={(event) => setAuditKeyword(event.target.value)}
                      placeholder="搜索动作/人员/备注"
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-4"
                    />
                    <select
                      value={auditPageSize}
                      onChange={(event) => {
                        setAuditPageSize(Number.parseInt(event.target.value, 10))
                        setAuditPage(1)
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm xl:col-span-2"
                    >
                      {AUDIT_PAGE_SIZE_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          每页 {item} 条
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setAuditPage(1)
                        void fetchAuditLogs()
                      }}
                      className="h-9 px-3 rounded-lg text-sm bg-primary text-white hover:bg-primary/90 xl:col-span-2"
                    >
                      查询
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-text-secondary">
                      共 {auditTotal} 条，第 {auditPage} / {auditTotalPages} 页
                    </p>
                  </div>
                  {auditError && (
                    <p className="text-sm text-red-500 mt-2">{auditError}</p>
                  )}

                  <div className="mt-4 space-y-3">
                    {isLoadingAudit && (
                      <div className="p-3 rounded-xl bg-gray-50 text-sm text-text-secondary">
                        审计日志加载中...
                      </div>
                    )}
                    {!isLoadingAudit && audits.length === 0 && (
                      <div className="p-3 rounded-xl bg-gray-50 text-sm text-text-secondary">
                        暂无审计日志
                      </div>
                    )}
                    {!isLoadingAudit && audits.map((item) => (
                      <div key={item.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-text-primary">
                            {auditActionLabelMap[item.action] || item.action}
                          </p>
                          <span className="text-xs text-text-secondary">{formatDateTime(item.createdAt)}</span>
                        </div>
                        <p className="text-xs text-text-secondary mt-1">
                          模块：{item.module} ｜ 平台：{item.platform} ｜ 目标类型：{item.targetType}
                        </p>
                        <p className="text-xs text-text-secondary mt-1">
                          操作人：{item.adminEmail || item.adminUserId} ｜ 目标对象：{item.targetEmail || item.targetUserId}
                        </p>
                        <p className="text-xs text-text-primary mt-1">操作详情：{renderAuditDetail(item)}</p>
                        {item.reason && (
                          <p className="text-xs text-text-secondary mt-1">备注：{item.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={auditPage <= 1}
                      onClick={() => setAuditPage((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={auditPage >= auditTotalPages}
                      onClick={() => setAuditPage((prev) => Math.min(auditTotalPages, prev + 1))}
                      className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'auth' && <AdminAuthManagement />}
              {activeTab === 'download-policy' && <DownloadModeManagement />}
              {activeTab === 'orders' && <AdminOrderManagement />}
              {activeTab === 'runtime' && (
                <Suspense
                  fallback={(
                    <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                      正在加载运行看板...
                    </div>
                  )}
                >
                  <AdminRuntimeDashboard onJumpTab={(tab) => setSearchParams({ tab })} />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
