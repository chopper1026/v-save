import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'
import DownloadHistory from '../components/DownloadHistory'
import ConfirmDialog from '../components/ConfirmDialog'
import BilibiliAuthPanel from '../components/auth/BilibiliAuthPanel'
import DouyinAuthPanel from '../components/auth/DouyinAuthPanel'
import {
  type AuthHealthPlatformStatus,
  type BilibiliAuthStatus,
  type BilibiliQrCodePayload,
  formatDateTime,
  getBilibiliSourceLabel,
  getHealthStatusClass,
  getHealthStatusLabel,
} from '../components/auth/auth-management-shared'
import { useDouyinAuthManager } from '../hooks/useDouyinAuthManager'
import {
  applyMarkAllNotificationsReadLocally,
  applyNotificationReadLocally,
} from '../lib/notification-state'
import { api } from '../lib/api'
import { useNotificationStore } from '../store/useNotificationStore'
import { useUserStore } from '../store/useUserStore'
import { User, Crown, Camera, Mail, RefreshCw, Trash2 } from 'lucide-react'

const MAX_AVATAR_UPLOAD_SIZE = 5 * 1024 * 1024
const MAX_AVATAR_RENDER_SIZE = 512
const AVATAR_OUTPUT_QUALITY = 0.85
const ORDER_PAGE_SIZE = 10

interface NotificationItem {
  id: string
  userId: string | null
  type: string
  level: 'info' | 'success' | 'warn' | 'error'
  source: string
  title: string
  content: string
  actionUrl?: string | null
  isRead: boolean
  readAt?: string | null
  createdAt: string
}

type PaymentOrderStatus = 'OPEN' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'CLOSED'
type PaymentOrderActionType = 'RESUME_PAYMENT' | 'VIEW_SUCCESS' | 'REQUEST_REFUND' | 'CREATE_NEW_ORDER' | 'NONE'

interface PaymentOrderAction {
  type: PaymentOrderActionType
  label: string
  enabled: boolean
  reason: string | null
  reasonCode?: string | null
  kind: 'LINK' | 'API' | 'NONE'
  href?: string
  endpoint?: string
  method?: 'GET' | 'POST'
  requiresIdempotencyKey?: boolean
}

interface PaymentOrderItem {
  orderNo: string
  orderStatus: PaymentOrderStatus
  orderStatusLabel: string
  planCode: 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME'
  amountMinor: number
  currency: 'CNY' | 'USD'
  paidAt?: string | null
  createdAt?: string | null
  primaryAction: PaymentOrderAction
}

interface SubscriptionStatusSummary {
  membershipLevel: 'FREE' | 'VIP'
  vipExpireDate: string | null
  isLifetime: boolean
  benefits: {
    supportedPlatforms: 'ALL' | string[]
    maxQuality: string
    unlimitedDownloads: boolean
  }
  quota: {
    usedToday: number
    remainingToday: number | null
    dailyLimit: number | null
  }
}

const FREE_SUPPORTED_PLATFORMS = ['douyin', 'bilibili']
const FREE_DAILY_LIMIT = 5

const ADMIN_AUTH_NOTIFICATION_TYPES = new Set([
  'AUTH_RECOVERED',
  'COOKIE_RISK',
  'COOKIE_EXPIRED',
])

const resolveNotificationActionUrl = (
  actionUrl: string | null | undefined,
  type: string,
  isSuperAdmin: boolean,
) => {
  const target = String(actionUrl || '').trim()
  if (!target) {
    return '/user'
  }

  if (
    target === '/user?tab=auth'
    || (isSuperAdmin && ADMIN_AUTH_NOTIFICATION_TYPES.has(String(type || '').toUpperCase()))
  ) {
    return '/admin?tab=auth'
  }

  return target
}

const normalizeSubscriptionStatus = (
  payload: any,
  fallbackIsVip: boolean,
  fallbackVipExpireDate?: string | null,
): SubscriptionStatusSummary => {
  const membershipLevel =
    payload?.membershipLevel === 'VIP' || payload?.membershipLevel === 'FREE'
      ? payload.membershipLevel
      : (fallbackIsVip ? 'VIP' : 'FREE')

  const supportedPlatforms = payload?.benefits?.supportedPlatforms === 'ALL'
    ? 'ALL'
    : Array.isArray(payload?.benefits?.supportedPlatforms)
      ? payload.benefits.supportedPlatforms.map((item: unknown) => String(item)).filter(Boolean)
      : (membershipLevel === 'VIP' ? 'ALL' : FREE_SUPPORTED_PLATFORMS)

  const maxQuality = String(payload?.benefits?.maxQuality || '').trim() || (membershipLevel === 'VIP' ? '4k' : '720p')
  const unlimitedDownloads =
    typeof payload?.benefits?.unlimitedDownloads === 'boolean'
      ? payload.benefits.unlimitedDownloads
      : membershipLevel === 'VIP'

  const usedTodayValue = Number(payload?.quota?.usedToday)
  const dailyLimitValue = Number(payload?.quota?.dailyLimit)
  const remainingTodayValue = Number(payload?.quota?.remainingToday)
  const dailyLimit = unlimitedDownloads
    ? null
    : (Number.isFinite(dailyLimitValue) ? dailyLimitValue : FREE_DAILY_LIMIT)
  const usedToday = unlimitedDownloads
    ? 0
    : (Number.isFinite(usedTodayValue) ? usedTodayValue : 0)
  const remainingToday = unlimitedDownloads
    ? null
    : (Number.isFinite(remainingTodayValue) ? remainingTodayValue : Math.max(0, (dailyLimit || 0) - usedToday))

  const vipExpireDate = membershipLevel === 'VIP'
    ? String(payload?.vipExpireDate || fallbackVipExpireDate || '').trim() || null
    : null
  const isLifetime = membershipLevel === 'VIP'
    ? (typeof payload?.isLifetime === 'boolean' ? payload.isLifetime : !vipExpireDate)
    : false

  return {
    membershipLevel,
    vipExpireDate,
    isLifetime,
    benefits: {
      supportedPlatforms,
      maxQuality,
      unlimitedDownloads,
    },
    quota: {
      usedToday,
      remainingToday,
      dailyLimit,
    },
  }
}

const resizeImageToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()

      img.onerror = () => reject(new Error('解析图片失败'))
      img.onload = () => {
        const maxEdge = Math.max(img.width, img.height)
        const scale = maxEdge > MAX_AVATAR_RENDER_SIZE
          ? MAX_AVATAR_RENDER_SIZE / maxEdge
          : 1

        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持头像处理'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', AVATAR_OUTPUT_QUALITY))
      }

      img.src = String(reader.result)
    }

    reader.readAsDataURL(file)
  })
}

export default function UserCenter() {
  const { user, isLoggedIn, isHydrated, logout, updateUser } = useUserStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') || 'profile'
  const activeTab = rawTab === 'auth' ? 'profile' : rawTab
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const [nickname, setNickname] = useState(user?.name || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [phone, setPhone] = useState(user?.phone || '')
  const [phoneMessage, setPhoneMessage] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [isBindingPhone, setIsBindingPhone] = useState(false)
  const [bilibiliStatus, setBilibiliStatus] = useState<BilibiliAuthStatus | null>(null)
  const [bilibiliQrCode, setBilibiliQrCode] = useState<BilibiliQrCodePayload | null>(null)
  const [bilibiliMessage, setBilibiliMessage] = useState('')
  const [bilibiliError, setBilibiliError] = useState('')
  const [isLoadingBilibiliStatus, setIsLoadingBilibiliStatus] = useState(false)
  const [isSubmittingBilibiliAction, setIsSubmittingBilibiliAction] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationTotal, setNotificationTotal] = useState(0)
  const [notificationPage, setNotificationPage] = useState(1)
  const [notificationPageSize] = useState(20)
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false)
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationPendingAction, setNotificationPendingAction] = useState<
    'markOne' | 'markAll' | 'clearAll' | null
  >(null)
  const [showClearNotificationsConfirm, setShowClearNotificationsConfirm] = useState(false)
  const [authHealth, setAuthHealth] = useState<Record<'bilibili' | 'douyin', AuthHealthPlatformStatus> | null>(null)
  const [isLoadingAuthHealth, setIsLoadingAuthHealth] = useState(false)
  const [orders, setOrders] = useState<PaymentOrderItem[]>([])
  const [orderTotal, setOrderTotal] = useState(0)
  const [orderPage, setOrderPage] = useState(1)
  const [isLoadingOrders, setIsLoadingOrders] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [orderNotice, setOrderNotice] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusSummary>(() =>
    normalizeSubscriptionStatus(null, false, null),
  )
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bilibiliPollTimerRef = useRef<number | null>(null)
  const setUnreadNotificationCount = useNotificationStore((state) => state.setUnreadCount)
  const decrementUnreadNotificationCount = useNotificationStore(
    (state) => state.decrementUnreadCount,
  )
  const globalUnreadNotificationCount = useNotificationStore((state) => state.unreadCount)

  const stopBilibiliQrPolling = useCallback(() => {
    if (bilibiliPollTimerRef.current) {
      window.clearTimeout(bilibiliPollTimerRef.current)
      bilibiliPollTimerRef.current = null
    }
  }, [])

  const fetchBilibiliStatus = useCallback(async (sync = false) => {
    if (!isLoggedIn || !isSuperAdmin) {
      return
    }

    try {
      setIsLoadingBilibiliStatus(true)
      const response = await api.get('/bilibili/auth/status', {
        params: sync ? { sync: '1' } : undefined,
      })

      if (response.data?.success) {
        setBilibiliStatus(response.data.data as BilibiliAuthStatus)
      }
    } catch (err) {
      console.error('获取 B 站登录状态失败:', err)
      setBilibiliError('获取 B 站登录状态失败，请稍后重试')
    } finally {
      setIsLoadingBilibiliStatus(false)
    }
  }, [isLoggedIn, isSuperAdmin])

  const pollBilibiliQrLogin = useCallback(async (qrcodeKey: string) => {
    try {
      const response = await api.get('/bilibili/auth/qrcode/poll', {
        params: { qrcodeKey },
      })
      const result = response.data?.data

      if (!result) {
        throw new Error('二维码轮询返回为空')
      }

      if (result.status === 'pending') {
        bilibiliPollTimerRef.current = window.setTimeout(() => {
          void pollBilibiliQrLogin(qrcodeKey)
        }, 2000)
        return
      }

      if (result.status === 'expired') {
        stopBilibiliQrPolling()
        setBilibiliQrCode(null)
        setBilibiliMessage('')
        setBilibiliError('二维码已过期，请点击“扫码登录 B 站”重新生成')
        return
      }

      stopBilibiliQrPolling()
      setBilibiliQrCode(null)
      setBilibiliError('')
      setBilibiliMessage('扫码成功，B 站 Cookie 已保存并生效')
      await fetchBilibiliStatus(true)
      await fetchAuthHealth(true)
    } catch (err) {
      stopBilibiliQrPolling()
      console.error('轮询 B 站二维码失败:', err)
      setBilibiliError('二维码轮询失败，请重试')
      setBilibiliQrCode(null)
    }
  }, [fetchBilibiliStatus, stopBilibiliQrPolling])

  const fetchNotifications = useCallback(async (options?: { page?: number; unreadOnly?: boolean }) => {
    if (!isLoggedIn) {
      return
    }

    const nextPage = Math.max(1, Number(options?.page || notificationPage) || 1)
    const nextUnreadOnly =
      typeof options?.unreadOnly === 'boolean' ? options.unreadOnly : notificationUnreadOnly

    try {
      setIsLoadingNotifications(true)
      setNotificationError('')

      const response = await api.get('/notifications', {
        params: {
          page: nextPage,
          pageSize: notificationPageSize,
          unreadOnly: nextUnreadOnly ? '1' : undefined,
        },
      })

      if (response.data?.success) {
        setNotifications((response.data?.data || []) as NotificationItem[])
        setNotificationTotal(Number(response.data?.meta?.total || 0))
        setNotificationPage(Number(response.data?.meta?.page || nextPage))
      }
    } catch (err) {
      console.error('获取通知列表失败:', err)
      setNotificationError('获取通知失败，请稍后重试')
    } finally {
      setIsLoadingNotifications(false)
    }
  }, [isLoggedIn, notificationPage, notificationPageSize, notificationUnreadOnly])

  const handleMarkNotificationRead = useCallback(async (id: string) => {
    const target = notifications.find((item) => item.id === id)
    if (!target || target.isRead) {
      return
    }

    try {
      setNotificationPendingAction('markOne')
      setNotificationError('')
      await api.patch(`/notifications/${id}/read`)
      const readAt = new Date().toISOString()
      setNotifications((prev) => applyNotificationReadLocally(prev, {
        id,
        unreadOnly: notificationUnreadOnly,
        readAt,
      }))
      decrementUnreadNotificationCount()

      if (notificationUnreadOnly) {
        setNotificationTotal((prev) => Math.max(prev - 1, 0))
        if (notifications.length === 1 && notificationPage > 1) {
          setNotificationPage((prev) => Math.max(1, prev - 1))
        }
      }
    } catch (err) {
      console.error('标记通知已读失败:', err)
      setNotificationError('标记已读失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [
    decrementUnreadNotificationCount,
    notificationPage,
    notificationUnreadOnly,
    notifications,
  ])

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try {
      setNotificationPendingAction('markAll')
      setNotificationError('')
      await api.patch('/notifications/read-all')
      const readAt = new Date().toISOString()
      setNotifications((prev) => applyMarkAllNotificationsReadLocally(prev, {
        unreadOnly: notificationUnreadOnly,
        readAt,
      }))
      setUnreadNotificationCount(0)

      if (notificationUnreadOnly) {
        setNotificationTotal(0)
        setNotificationPage(1)
      }
    } catch (err) {
      console.error('全部标记已读失败:', err)
      setNotificationError('全部标记已读失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [notificationUnreadOnly, setUnreadNotificationCount])

  const handleClearAllNotifications = useCallback(async () => {
    try {
      setNotificationPendingAction('clearAll')
      setShowClearNotificationsConfirm(false)
      setNotificationError('')
      await api.delete('/notifications/clear')
      setNotifications([])
      setNotificationTotal(0)
      setNotificationPage(1)
      setUnreadNotificationCount(0)
    } catch (err) {
      console.error('清空通知失败:', err)
      setNotificationError('清空通知失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [setUnreadNotificationCount])

  const fetchAuthHealth = useCallback(async (sync = false) => {
    if (!isLoggedIn || !isSuperAdmin) {
      return
    }

    try {
      setIsLoadingAuthHealth(true)
      const response = await api.get('/auth/health', {
        params: sync ? { sync: '1' } : undefined,
      })
      if (response.data?.success) {
        const platforms = response.data?.data?.platforms || {}
        setAuthHealth({
          bilibili: platforms.bilibili as AuthHealthPlatformStatus,
          douyin: platforms.douyin as AuthHealthPlatformStatus,
        })
      }
    } catch (err) {
      console.error('获取登录态健康状态失败:', err)
    } finally {
      setIsLoadingAuthHealth(false)
    }
  }, [isLoggedIn, isSuperAdmin])

  const fetchSubscriptionStatus = useCallback(async (fallbackOverride?: { isVip?: boolean; vipExpireDate?: string | null }) => {
    if (!isLoggedIn) {
      return
    }

    try {
      const response = await api.get('/payments/subscription-status')
      const payload = response.data?.data || {}
      setSubscriptionStatus(
        normalizeSubscriptionStatus(
          payload,
          Boolean((fallbackOverride?.isVip ?? (user?.membershipLevel === 'VIP' || user?.isVip))),
          fallbackOverride?.vipExpireDate ?? user?.vipExpireDate,
        ),
      )
    } catch (err) {
      console.error('获取会员摘要失败:', err)
    }
  }, [isLoggedIn, user?.isVip, user?.membershipLevel, user?.vipExpireDate])

  const fetchOrders = useCallback(async (options?: { page?: number }) => {
    if (!isLoggedIn) {
      return
    }

    const nextPage = Math.max(1, Number(options?.page || orderPage) || 1)

    try {
      setIsLoadingOrders(true)
      setOrderError('')

      const response = await api.get('/payments/orders', {
        params: {
          page: nextPage,
          pageSize: ORDER_PAGE_SIZE,
        },
      })

      if (response.data?.success) {
        setOrders((response.data?.data || []) as PaymentOrderItem[])
        setOrderTotal(Number(response.data?.meta?.total || 0))
        setOrderPage(Number(response.data?.meta?.page || nextPage))
      }
    } catch (err) {
      console.error('获取订单记录失败:', err)
      setOrderError('获取订单记录失败，请稍后重试')
    } finally {
      setIsLoadingOrders(false)
    }
  }, [isLoggedIn, orderPage])

  const {
    status: douyinStatus,
    cookieInput: douyinCookieInput,
    setCookieInput: setDouyinCookieInput,
    message: douyinMessage,
    error: douyinError,
    isLoadingStatus: isLoadingDouyinStatus,
    isSubmitting: isSubmittingDouyinAction,
    sourceLabel: douyinSourceLabel,
    bridgeHelperAvailability: douyinBridgeHelperAvailability,
    bridgeStatus: douyinBridgeStatus,
    bridgeMessage: douyinBridgeMessage,
    bridgeError: douyinBridgeError,
    isStartingBridge: isStartingDouyinBridge,
    startBridgeLogin: handleStartDouyinBridgeLogin,
    saveCookie: handleSaveDouyinCookie,
    clearSession: handleClearDouyinSession,
  } = useDouyinAuthManager({
    enabled: isLoggedIn && isSuperAdmin,
    onAuthHealthRefresh: fetchAuthHealth,
  })

  useEffect(() => {
    if (user) {
      setNickname(user.name || '')
      setAvatar(user.avatar || '')
      setPhone(user.phone || '')
    }
  }, [user])

  useEffect(() => {
    if (isLoggedIn) {
      void fetchNotifications({ page: 1 })
    }
  }, [fetchNotifications, isLoggedIn])

  useEffect(() => {
    return () => {
      stopBilibiliQrPolling()
    }
  }, [stopBilibiliQrPolling])

  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'notifications') {
      return
    }
    void fetchNotifications({
      page: notificationPage,
      unreadOnly: notificationUnreadOnly,
    })
  }, [
    activeTab,
    fetchNotifications,
    isLoggedIn,
    notificationPage,
    notificationUnreadOnly,
  ])

  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'orders') {
      return
    }

    void fetchOrders({ page: orderPage })
  }, [activeTab, fetchOrders, isLoggedIn, orderPage])

  useEffect(() => {
    if (!isLoggedIn || !isSuperAdmin || activeTab !== 'auth') {
      return
    }

    void fetchAuthHealth(true)
    const timer = window.setInterval(() => {
      void fetchAuthHealth(false)
    }, 60000)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeTab, fetchAuthHealth, isLoggedIn, isSuperAdmin])

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    if (rawTab === 'auth') {
      setSearchParams({ tab: 'profile' })
    }
  }, [isLoggedIn, rawTab, setSearchParams])

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    setSubscriptionStatus(
      normalizeSubscriptionStatus(
        null,
        Boolean(user?.membershipLevel === 'VIP' || user?.isVip),
        user?.vipExpireDate,
      ),
    )
  }, [isLoggedIn, user?.isVip, user?.membershipLevel, user?.vipExpireDate])

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    void fetchSubscriptionStatus()
  }, [fetchSubscriptionStatus, isLoggedIn])

  const bilibiliSourceLabel = getBilibiliSourceLabel(bilibiliStatus?.source)
  const vipExpireText = useMemo(() => {
    if (subscriptionStatus.membershipLevel !== 'VIP') return '未开通'
    if (subscriptionStatus.isLifetime) return '永久有效'
    if (!subscriptionStatus.vipExpireDate) return '未开通'
    return formatDateTime(subscriptionStatus.vipExpireDate)
  }, [subscriptionStatus])

  const membershipTitle = isSuperAdmin
    ? '超级管理员'
    : subscriptionStatus.membershipLevel === 'VIP'
      ? 'VIP会员'
      : '免费用户'
  const maxQualityText = String(subscriptionStatus.benefits.maxQuality || '').toUpperCase()
  const supportedPlatformsText = subscriptionStatus.benefits.supportedPlatforms === 'ALL'
    ? '全平台'
    : subscriptionStatus.benefits.supportedPlatforms
      .map((item) => {
        if (item === 'douyin') return '抖音'
        if (item === 'bilibili') return '哔哩哔哩'
        return item
      })
      .join('、')
  const quotaSummaryText = subscriptionStatus.benefits.unlimitedDownloads
    ? '无限下载'
    : `今日已用 ${subscriptionStatus.quota.usedToday}/${subscriptionStatus.quota.dailyLimit || FREE_DAILY_LIMIT}，剩余 ${subscriptionStatus.quota.remainingToday || 0} 次`
  const membershipDescription = isSuperAdmin
    ? '您可管理平台登录态与系统配置能力'
    : subscriptionStatus.membershipLevel === 'VIP'
      ? `当前享有 ${quotaSummaryText}、${maxQualityText} 与 ${supportedPlatformsText}`
      : `免费用户当前支持 ${supportedPlatformsText}，最高 ${maxQualityText}`

  const getNotificationLevelClass = (level: NotificationItem['level']) => {
    switch (level) {
      case 'success':
        return 'bg-emerald-100 text-emerald-700'
      case 'warn':
        return 'bg-amber-100 text-amber-700'
      case 'error':
        return 'bg-red-100 text-red-700'
      case 'info':
      default:
        return 'bg-blue-100 text-blue-700'
    }
  }

  const unreadNotificationCount = notifications.filter((item) => !item.isRead).length
  const effectiveUnreadNotificationCount = Math.max(
    globalUnreadNotificationCount,
    unreadNotificationCount,
  )
  const notificationTotalPages = Math.max(1, Math.ceil(notificationTotal / notificationPageSize))
  const orderTotalPages = Math.max(1, Math.ceil(orderTotal / ORDER_PAGE_SIZE))

  const getOrderStatusClass = (status: PaymentOrderItem['orderStatus']) => {
    switch (status) {
      case 'PAID':
        return 'bg-emerald-100 text-emerald-700'
      case 'OPEN':
        return 'bg-amber-100 text-amber-700'
      case 'REFUNDED':
        return 'bg-blue-100 text-blue-700'
      case 'REFUND_PENDING':
        return 'bg-purple-100 text-purple-700'
      case 'REFUND_FAILED':
      case 'CLOSED':
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const getOrderPlanLabel = (planCode: PaymentOrderItem['planCode']) => {
    switch (planCode) {
      case 'MONTH':
        return '月卡会员'
      case 'QUARTER':
        return '季卡会员'
      case 'YEAR':
        return '年卡会员'
      case 'LIFETIME':
        return '终身会员'
      default:
        return planCode
    }
  }

  useEffect(() => {
    if (!isLoggedIn || !notifications.length) {
      return
    }

    if (unreadNotificationCount > globalUnreadNotificationCount) {
      setUnreadNotificationCount(unreadNotificationCount)
    }
  }, [
    globalUnreadNotificationCount,
    isLoggedIn,
    notifications.length,
    setUnreadNotificationCount,
    unreadNotificationCount,
  ])

  if (!isHydrated || !isLoggedIn || !user) {
    return null
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const handleTabChange = (tab: string) => {
    setSearchParams({ tab })
  }

  const handleOrderPrimaryAction = (item: PaymentOrderItem) => {
    const action = item.primaryAction
    if (!action?.enabled) {
      if (action?.reason) {
        setOrderNotice(action.reason)
      }
      return
    }

    setOrderNotice('')

    if (action.type === 'RESUME_PAYMENT') {
      window.open(`/vip?orderNo=${encodeURIComponent(item.orderNo)}`, '_self')
      return
    }

    if (action.kind === 'LINK' && action.href) {
      window.open(action.href, '_self')
      return
    }

    if (action.reason) {
      setOrderNotice(action.reason)
    }
  }

  const handleSaveProfile = async () => {
    const trimmedNickname = nickname.trim()
    if (!trimmedNickname) {
      setSaveError('昵称不能为空')
      setSaveMessage('')
      return
    }

    try {
      setIsSaving(true)
      setSaveError('')
      setSaveMessage('')

      const response = await api.patch('/users/profile', {
        nickname: trimmedNickname,
        avatar: avatar.trim(),
      })

      const updated = response.data
      const nextMembershipLevel =
        updated.membershipLevel === 'VIP' || updated.membershipLevel === 'FREE'
          ? updated.membershipLevel
          : (user.isVip ? 'VIP' : 'FREE')
      updateUser({
        name: updated.nickname || trimmedNickname,
        avatar: updated.avatar || avatar || undefined,
        membershipLevel: nextMembershipLevel,
        isVip: nextMembershipLevel === 'VIP',
        vipExpireDate: updated.vipExpireDate || user.vipExpireDate || null,
      })

      void fetchSubscriptionStatus({
        isVip: nextMembershipLevel === 'VIP',
        vipExpireDate: updated.vipExpireDate || user.vipExpireDate || null,
      })

      setSaveMessage('资料已更新')
    } catch (err) {
      console.error('更新资料失败:', err)
      setSaveError('保存失败，请稍后重试')
      setSaveMessage('')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordMessage('')
    setPasswordError('')

    if (!currentPassword || !newPassword) {
      setPasswordError('请填写当前密码和新密码')
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('新密码长度至少为 6 位')
      return
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }

    try {
      setIsChangingPassword(true)
      await api.patch('/users/account/password', {
        currentPassword,
        newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setPasswordMessage('密码修改成功')
    } catch (err: any) {
      console.error('修改密码失败:', err)
      const message = err?.response?.data?.message
      if (Array.isArray(message)) {
        setPasswordError(message[0] || '修改密码失败，请稍后重试')
      } else if (typeof message === 'string') {
        setPasswordError(message)
      } else {
        setPasswordError('修改密码失败，请稍后重试')
      }
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleBindPhone = async () => {
    setPhoneMessage('')
    setPhoneError('')

    const normalizedPhone = phone.replace(/\s+/g, '')
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setPhoneError('请输入 11 位大陆手机号')
      return
    }

    try {
      setIsBindingPhone(true)
      const response = await api.patch('/users/account/phone', {
        phone: normalizedPhone,
      })
      const updatedUser = response.data || {}
      updateUser({
        phone: updatedUser.phone || normalizedPhone,
      })
      setPhone(updatedUser.phone || normalizedPhone)
      setPhoneMessage('手机号绑定成功')
    } catch (err: any) {
      console.error('绑定手机号失败:', err)
      const message = err?.response?.data?.message
      if (Array.isArray(message)) {
        setPhoneError(message[0] || '绑定手机号失败，请稍后重试')
      } else if (typeof message === 'string') {
        setPhoneError(message)
      } else {
        setPhoneError('绑定手机号失败，请稍后重试')
      }
    } finally {
      setIsBindingPhone(false)
    }
  }

  const handleAvatarUploadClick = () => {
    avatarInputRef.current?.click()
  }

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setSaveMessage('')
    setSaveError('')

    if (!file.type.startsWith('image/')) {
      setSaveError('请选择图片文件作为头像')
      return
    }

    if (file.size > MAX_AVATAR_UPLOAD_SIZE) {
      setSaveError('头像文件不能超过 5MB')
      return
    }

    try {
      setIsUploadingAvatar(true)
      const avatarDataUrl = await resizeImageToDataUrl(file)
      setAvatar(avatarDataUrl)
      setSaveMessage('头像已选择，点击“保存修改”后生效')
    } catch (err) {
      console.error('头像处理失败:', err)
      setSaveError('头像上传失败，请更换图片重试')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const handleGenerateBilibiliQr = async () => {
    try {
      setIsSubmittingBilibiliAction(true)
      setBilibiliMessage('')
      setBilibiliError('')
      stopBilibiliQrPolling()

      const response = await api.post('/bilibili/auth/qrcode')
      if (!response.data?.success || !response.data?.data?.qrcodeKey) {
        throw new Error('二维码生成失败')
      }

      const payload = response.data.data as BilibiliQrCodePayload
      setBilibiliQrCode(payload)
      setBilibiliMessage('请使用 B 站 App 扫码并确认登录，系统会自动完成 Cookie 保存')

      void pollBilibiliQrLogin(payload.qrcodeKey)
    } catch (err) {
      console.error('生成 B 站二维码失败:', err)
      setBilibiliError('生成二维码失败，请稍后重试')
      setBilibiliQrCode(null)
    } finally {
      setIsSubmittingBilibiliAction(false)
    }
  }

  const handleRefreshBilibiliCookie = async () => {
    try {
      setIsSubmittingBilibiliAction(true)
      setBilibiliMessage('')
      setBilibiliError('')

      const response = await api.post('/bilibili/auth/refresh')
      const message = response.data?.data?.message || 'Cookie 检查完成'
      setBilibiliMessage(message)
      await fetchBilibiliStatus(true)
      await fetchAuthHealth(true)
    } catch (err) {
      console.error('刷新 B 站 Cookie 失败:', err)
      setBilibiliError('刷新失败，请重新扫码登录 B 站')
    } finally {
      setIsSubmittingBilibiliAction(false)
    }
  }

  const handleClearBilibiliSession = async () => {
    try {
      setIsSubmittingBilibiliAction(true)
      setBilibiliMessage('')
      setBilibiliError('')
      stopBilibiliQrPolling()

      await api.delete('/bilibili/auth/session')
      setBilibiliQrCode(null)
      setBilibiliMessage('已清空 B 站登录态，可重新扫码绑定')
      await fetchBilibiliStatus(false)
      await fetchAuthHealth(true)
    } catch (err) {
      console.error('清空 B 站登录态失败:', err)
      setBilibiliError('清空失败，请稍后重试')
    } finally {
      setIsSubmittingBilibiliAction(false)
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'notifications':
        return (
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">通知中心</h3>
                <p className="text-sm text-text-secondary mt-1">
                  统一查看登录态、会员和账号安全相关通知
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  当前页未读 {unreadNotificationCount}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNotificationPage(1)
                    setNotificationUnreadOnly((prev) => !prev)
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors"
                >
                  {notificationUnreadOnly ? '查看全部' : '仅看未读'}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchNotifications({ page: 1, unreadOnly: notificationUnreadOnly })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors"
                >
                  刷新
                </button>
                <button
                  type="button"
                  onClick={() => void handleMarkAllNotificationsRead()}
                  disabled={notificationPendingAction !== null || effectiveUnreadNotificationCount <= 0}
                  className="inline-flex min-w-[124px] items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-70"
                >
                  <span className="inline-flex w-3.5 justify-center">
                    <RefreshCw className={`w-3.5 h-3.5 ${notificationPendingAction === 'markAll' ? 'animate-spin' : ''}`} />
                  </span>
                  全部标记已读
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearNotificationsConfirm(true)}
                  disabled={notificationPendingAction !== null}
                  className="inline-flex min-w-[108px] items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-70"
                >
                  <span className="inline-flex w-3.5 justify-center">
                    <Trash2 className={`w-3.5 h-3.5 ${notificationPendingAction === 'clearAll' ? 'animate-pulse' : ''}`} />
                  </span>
                  一键清空
                </button>
              </div>
            </div>

            <ConfirmDialog
              open={showClearNotificationsConfirm}
              title="确认清空全部通知？"
              description="清空后无法恢复，当前账号的通知记录将被永久删除。"
              confirmText="确认清空"
              cancelText="取消"
              onConfirm={() => void handleClearAllNotifications()}
              onCancel={() => setShowClearNotificationsConfirm(false)}
              loading={notificationPendingAction === 'clearAll'}
              variant="danger"
            />

            {notificationError && (
              <p className="mt-4 text-sm text-red-500">{notificationError}</p>
            )}

            <div className="mt-5 space-y-3">
              {isLoadingNotifications && (
                <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm text-text-secondary">
                  通知加载中...
                </div>
              )}

              {!isLoadingNotifications && notifications.length === 0 && (
                <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm text-text-secondary">
                  暂无通知
                </div>
              )}

              {!isLoadingNotifications && notifications.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-colors ${
                    item.isRead
                      ? 'border-gray-100 bg-white'
                      : 'border-primary/30 bg-primary/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getNotificationLevelClass(item.level)}`}>
                          {item.level.toUpperCase()}
                        </span>
                        <span className="text-xs text-text-secondary">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="text-sm font-semibold text-text-primary mt-2">{item.title}</p>
                      <p className="text-sm text-text-secondary mt-1">{item.content}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!item.isRead && (
                        <button
                          type="button"
                          onClick={() => void handleMarkNotificationRead(item.id)}
                          disabled={notificationPendingAction !== null}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-70"
                        >
                          标记已读
                        </button>
                      )}
                      {item.actionUrl && (
                        <button
                          type="button"
                          onClick={() => navigate(
                            resolveNotificationActionUrl(
                              item.actionUrl,
                              item.type,
                              isSuperAdmin,
                            ),
                          )}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
                        >
                          去处理
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs text-text-secondary">
                共 {notificationTotal} 条通知，第 {notificationPage} / {notificationTotalPages} 页
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={notificationPage <= 1}
                  onClick={() => setNotificationPage((prev) => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={notificationPage >= notificationTotalPages}
                  onClick={() => setNotificationPage((prev) => Math.min(notificationTotalPages, prev + 1))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )
      case 'history':
        return <DownloadHistory />
      case 'orders':
        return (
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">订单记录</h3>
                <p className="text-sm text-text-secondary mt-1">查看会员套餐支付与退款状态</p>
              </div>
              <button
                type="button"
                onClick={() => void fetchOrders({ page: orderPage })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors"
              >
                刷新
              </button>
            </div>

            {orderError && (
              <p className="mt-4 text-sm text-red-500">{orderError}</p>
            )}

            {orderNotice && !orderError && (
              <p className="mt-4 text-sm text-amber-600">{orderNotice}</p>
            )}

            <div className="mt-5 space-y-3">
              {isLoadingOrders && (
                <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm text-text-secondary">
                  订单加载中...
                </div>
              )}

              {!isLoadingOrders && orders.length === 0 && (
                <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm text-text-secondary">
                  暂无订单记录
                </div>
              )}

              {!isLoadingOrders && orders.map((item) => (
                <div key={item.orderNo} className="p-4 rounded-xl border border-gray-100 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{item.orderNo}</div>
                      <div className="text-xs text-text-secondary mt-1">
                        创建时间：{formatDateTime(item.createdAt || null)}
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getOrderStatusClass(item.orderStatus)}`}>
                      {item.orderStatusLabel}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-text-secondary">
                    <div>套餐：{getOrderPlanLabel(item.planCode)}</div>
                    <div>金额：{item.currency} {(Number(item.amountMinor || 0) / 100).toFixed(2)}</div>
                    <div>支付时间：{formatDateTime(item.paidAt || null)}</div>
                  </div>

                  {item.primaryAction.reason && (
                    <div className="mt-3 text-xs text-text-secondary">
                      {item.primaryAction.reason}
                    </div>
                  )}

                  {item.primaryAction.enabled && item.primaryAction.type !== 'NONE' && (
                    <button
                      type="button"
                      onClick={() => handleOrderPrimaryAction(item)}
                      className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90"
                    >
                      {item.primaryAction.label}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs text-text-secondary">
                共 {orderTotal} 条订单，第 {orderPage} / {orderTotalPages} 页
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage((prev) => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={orderPage >= orderTotalPages}
                  onClick={() => setOrderPage((prev) => Math.min(orderTotalPages, prev + 1))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )
      case 'settings':
        return (
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-6">账户设置</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">修改密码</label>
                <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="当前密码"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="新密码（至少 6 位）"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    placeholder="确认新密码"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleChangePassword}
                    disabled={isChangingPassword}
                    className="px-4 py-2 bg-primary text-white rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-70"
                  >
                    {isChangingPassword ? '提交中...' : '确认修改密码'}
                  </button>
                </div>
                {passwordMessage && (
                  <p className="mt-2 text-sm text-emerald-600">{passwordMessage}</p>
                )}
                {passwordError && (
                  <p className="mt-2 text-sm text-red-500">{passwordError}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">绑定手机号</label>
                <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <input
                    type="text"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="请输入 11 位手机号"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleBindPhone}
                    disabled={isBindingPhone}
                    className="px-4 py-2 bg-primary text-white rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-70"
                  >
                    {isBindingPhone ? '提交中...' : '确认绑定手机号'}
                  </button>
                </div>
                {phoneMessage && (
                  <p className="mt-2 text-sm text-emerald-600">{phoneMessage}</p>
                )}
                {phoneError && (
                  <p className="mt-2 text-sm text-red-500">{phoneError}</p>
                )}
              </div>
              <div className="pt-4 border-t border-gray-100">
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-50 hover:bg-red-100 rounded-xl text-sm text-red-500 transition-colors"
                >
                  退出登录
                </button>
              </div>
            </div>
          </div>
        )
      case 'auth':
        if (!isSuperAdmin) {
          return (
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
              <h3 className="text-lg font-semibold text-text-primary">平台登录态管理</h3>
              <p className="mt-2 text-sm text-text-secondary">
                平台登录态由管理员统一维护，当前账号无权限访问该模块。
              </p>
            </div>
          )
        }
        return (
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">平台登录态管理</h3>
                <p className="text-sm text-text-secondary mt-1">
                  当前已接入 B 站与抖音，可在此统一维护下载所需的登录态
                </p>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  bilibiliStatus?.hasCookie
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {isLoadingBilibiliStatus ? '检查中...' : bilibiliStatus?.hasCookie ? 'B站已登录' : 'B站未登录'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="px-4 py-3 rounded-xl bg-gray-50/70 border border-gray-100">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">B站健康状态</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getHealthStatusClass(authHealth?.bilibili?.status)}`}>
                    {isLoadingAuthHealth ? '检查中' : getHealthStatusLabel(authHealth?.bilibili?.status)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary mt-2">
                  最近检查：{formatDateTime(authHealth?.bilibili?.lastCheckedAt || null)}
                </p>
              </div>
              <div className="px-4 py-3 rounded-xl bg-gray-50/70 border border-gray-100">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">抖音健康状态</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getHealthStatusClass(authHealth?.douyin?.status)}`}>
                    {isLoadingAuthHealth ? '检查中' : getHealthStatusLabel(authHealth?.douyin?.status)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary mt-2">
                  最近检查：{formatDateTime(authHealth?.douyin?.lastCheckedAt || null)}
                </p>
              </div>
            </div>

            <BilibiliAuthPanel
              status={bilibiliStatus}
              isLoadingStatus={isLoadingBilibiliStatus}
              sourceLabel={bilibiliSourceLabel}
              qrCode={bilibiliQrCode}
              message={bilibiliMessage}
              error={bilibiliError}
              isSubmitting={isSubmittingBilibiliAction}
              onGenerateQr={handleGenerateBilibiliQr}
              onRefreshCookie={handleRefreshBilibiliCookie}
              onClearSession={handleClearBilibiliSession}
            />

            <DouyinAuthPanel
              status={douyinStatus}
              isLoadingStatus={isLoadingDouyinStatus}
              sourceLabel={douyinSourceLabel}
              message={douyinMessage}
              error={douyinError}
              isSubmitting={isSubmittingDouyinAction}
              cookieInput={douyinCookieInput}
              bridgeStatus={douyinBridgeStatus}
              bridgeMessage={douyinBridgeMessage}
              bridgeError={douyinBridgeError}
              bridgeHelperAvailability={douyinBridgeHelperAvailability}
              isStartingBridge={isStartingDouyinBridge}
              onCookieInputChange={setDouyinCookieInput}
              onStartBridgeLogin={handleStartDouyinBridgeLogin}
              onSaveCookie={handleSaveDouyinCookie}
              onClearSession={handleClearDouyinSession}
            />
          </div>
        )
      default:
        return (
          <div className="space-y-6">
            {/* 个人资料卡片 */}
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-6">个人资料</h3>

              <div className="flex items-start gap-6">
                {/* 头像 */}
                <div className="relative">
                  <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden">
                    {avatar ? (
                      <img src={avatar} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-primary" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleAvatarUploadClick}
                    disabled={isUploadingAvatar}
                    className="absolute -bottom-2 -right-2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-70"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                  />
                </div>

                {/* 信息 */}
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">昵称</label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">头像链接</label>
                    <input
                      type="text"
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      placeholder="https://example.com/avatar.png"
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    <p className="text-xs text-text-secondary mt-1">
                      可点击头像右下角按钮上传本地图片，或直接填写图片 URL
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">邮箱</label>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 rounded-xl text-text-secondary">
                      <Mail className="w-4 h-4" />
                      <span>{user.email}</span>
                    </div>
                  </div>
                </div>
              </div>

              {saveMessage && (
                <p className="mt-4 text-sm text-green-600">{saveMessage}</p>
              )}
              {saveError && (
                <p className="mt-4 text-sm text-red-500">{saveError}</p>
              )}

              <div className="mt-6 pt-6 border-t border-gray-100 flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={isSaving || isUploadingAvatar}
                  className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 disabled:opacity-70 transition-colors"
                >
                  {isSaving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>

            {/* VIP 状态卡片 */}
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${subscriptionStatus.membershipLevel === 'VIP' ? 'bg-amber-100' : 'bg-gray-100'}`}>
                    <Crown className={`w-6 h-6 ${subscriptionStatus.membershipLevel === 'VIP' ? 'text-amber-500' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-text-primary">
                        {membershipTitle}
                      </h4>
                      {!isSuperAdmin && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-xs font-medium rounded-full">
                          {subscriptionStatus.membershipLevel === 'VIP' ? `有效期至 ${vipExpireText}` : quotaSummaryText}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-0.5">
                      {membershipDescription}
                    </p>
                  </div>
                </div>
                {subscriptionStatus.membershipLevel !== 'VIP' && !isSuperAdmin && (
                  <Link
                    to="/vip"
                    className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors"
                  >
                    立即升级
                  </Link>
                )}
              </div>

              {!isSuperAdmin && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <div className="text-xs text-text-secondary mb-1">今日下载</div>
                    <div className="font-semibold text-text-primary">{quotaSummaryText}</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <div className="text-xs text-text-secondary mb-1">支持平台</div>
                    <div className="font-semibold text-text-primary">{supportedPlatformsText}</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <div className="text-xs text-text-secondary mb-1">最高画质</div>
                    <div className="font-semibold text-text-primary">{maxQualityText}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row gap-6">
            {/* 左侧 Sidebar */}
            <div className="w-full md:w-64 flex-shrink-0">
              <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
            </div>

            {/* 右侧内容区 */}
            <div className="flex-1">
              {renderContent()}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
