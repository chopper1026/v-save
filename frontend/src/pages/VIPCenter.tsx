import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import { Crown, Check, Download, Film } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUserStore } from '../store/useUserStore'
import { api } from '../lib/api'

type PaymentPlanCode = 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME'
type SellablePaymentPlanCode = Exclude<PaymentPlanCode, 'LIFETIME'>
type PaymentOrderActionType = 'RESUME_PAYMENT' | 'VIEW_SUCCESS' | 'REQUEST_REFUND' | 'CREATE_NEW_ORDER' | 'NONE'
type PaymentOrderStatus = 'OPEN' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'CLOSED'

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
  checkoutUrl?: string | null
}

interface PaymentOrderView {
  orderNo: string
  reusedOrder?: boolean
  orderStatus: PaymentOrderStatus
  orderStatusLabel: string
  planCode: PaymentPlanCode
  planName?: string
  amountMinor: number
  currency: 'CNY' | 'USD'
  checkoutUrl?: string | null
  paidAt?: string | null
  primaryAction: PaymentOrderAction
}

interface PaymentOrderListItem {
  orderNo: string
  orderStatus: PaymentOrderStatus
  orderStatusLabel: string
  planCode: PaymentPlanCode
  amountMinor: number
  currency: 'CNY' | 'USD'
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

interface PlanItem {
  code: SellablePaymentPlanCode
  name: string
  priceCny: number
  duration: string
  popular?: boolean
  features: string[]
}

const POLL_INTERVAL_MS = 2500
const MAX_POLL_COUNT = 120
const LATEST_PENDING_ORDER_KEY = 'vip:latest-pending-order-no'
const getLatestPendingOrderStorageKey = (userId?: string | null) => {
  const normalizedUserId = String(userId || '').trim()
  return normalizedUserId
    ? `${LATEST_PENDING_ORDER_KEY}:${normalizedUserId}`
    : LATEST_PENDING_ORDER_KEY
}
const FREE_SUPPORTED_PLATFORMS = ['douyin', 'bilibili']
const FREE_DAILY_LIMIT = 5

const plans: PlanItem[] = [
  {
    code: 'MONTH',
    name: '月卡会员',
    priceCny: 6.9,
    duration: '/30天',
    features: ['无限下载', '1080P / 4K 解锁', '全平台支持'],
  },
  {
    code: 'QUARTER',
    name: '季卡会员',
    priceCny: 19.9,
    duration: '/90天',
    popular: true,
    features: ['无限下载', '1080P / 4K 解锁', '全平台支持'],
  },
  {
    code: 'YEAR',
    name: '年卡会员',
    priceCny: 69.9,
    duration: '/365天',
    features: ['无限下载', '1080P / 4K 解锁', '全平台支持'],
  },
]

const formatPrice = (price: number) => {
  if (Number.isInteger(price)) {
    return `¥${price.toFixed(0)}`
  }
  return `¥${price.toFixed(1)}`
}

const formatVipExpireDate = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) {
    return '未开通'
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return raw
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

const formatSupportedPlatforms = (supportedPlatforms: 'ALL' | string[]) => {
  if (supportedPlatforms === 'ALL') {
    return '全平台'
  }

  const labels = supportedPlatforms.map((item) => {
    if (item === 'douyin') return '抖音'
    if (item === 'bilibili') return '哔哩哔哩'
    return item
  })

  return labels.join('、') || '抖音、哔哩哔哩'
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

export default function VIPCenter() {
  const [searchParams] = useSearchParams()
  const [notice, setNotice] = useState('')
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false)
  const [orderResult, setOrderResult] = useState<PaymentOrderView | null>(null)
  const [isPollingOrder, setIsPollingOrder] = useState(false)
  const [isResumingCheckout, setIsResumingCheckout] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusSummary>(() =>
    normalizeSubscriptionStatus(null, false, null),
  )

  const pollTimerRef = useRef<number | null>(null)
  const pollCountRef = useRef(0)

  const { user, isLoggedIn, updateUser } = useUserStore()
  const navigate = useNavigate()

  const orderNoFromQuery = useMemo(() => {
    const raw = String(searchParams.get('orderNo') || '').trim()
    return raw || ''
  }, [searchParams])

  const returnStatusFromQuery = useMemo(() => {
    return String(searchParams.get('status') || '').trim().toLowerCase()
  }, [searchParams])

  const isVipMember = subscriptionStatus.membershipLevel === 'VIP'
  const membershipTitle = isVipMember ? 'VIP会员' : '免费用户'
  const vipExpireText = isVipMember
    ? (subscriptionStatus.isLifetime ? '永久有效' : formatVipExpireDate(subscriptionStatus.vipExpireDate))
    : '未开通'
  const maxQualityText = String(subscriptionStatus.benefits.maxQuality || '').toUpperCase()
  const supportedPlatformsText = formatSupportedPlatforms(subscriptionStatus.benefits.supportedPlatforms)
  const usedQuotaText = subscriptionStatus.benefits.unlimitedDownloads
    ? '不限次数'
    : `${subscriptionStatus.quota.usedToday}/${subscriptionStatus.quota.dailyLimit || FREE_DAILY_LIMIT} 次`
  const remainingQuotaText = subscriptionStatus.benefits.unlimitedDownloads
    ? '无限'
    : `${subscriptionStatus.quota.remainingToday || 0} 次`

  const membershipPerks = isVipMember
    ? [
        { icon: Download, label: '下载额度', description: '无限次发起下载', color: 'text-primary' },
        { icon: Film, label: '最高画质', description: `${maxQualityText} 清晰度已解锁`, color: 'text-blue-500' },
        { icon: Crown, label: '支持平台', description: supportedPlatformsText, color: 'text-amber-500' },
      ]
    : [
        { icon: Download, label: '今日额度', description: `今天已用 ${usedQuotaText}，剩余 ${remainingQuotaText}`, color: 'text-primary' },
        { icon: Film, label: '最高画质', description: `免费用户最高 ${maxQualityText}`, color: 'text-blue-500' },
        { icon: Crown, label: '支持平台', description: supportedPlatformsText, color: 'text-amber-500' },
      ]

  const latestPendingOrderStorageKey = useMemo(() => {
    return getLatestPendingOrderStorageKey(user?.id)
  }, [user?.id])

  const getLatestPendingOrderNo = () => {
    return String(window.localStorage.getItem(latestPendingOrderStorageKey) || '').trim()
  }

  const setLatestPendingOrderNo = (orderNo: string) => {
    const normalizedOrderNo = String(orderNo || '').trim()
    if (!normalizedOrderNo) {
      window.localStorage.removeItem(latestPendingOrderStorageKey)
      return
    }
    window.localStorage.setItem(latestPendingOrderStorageKey, normalizedOrderNo)
  }

  const clearLatestPendingOrderNo = () => {
    window.localStorage.removeItem(latestPendingOrderStorageKey)
  }

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setIsPollingOrder(false)
  }

  const refreshSubscriptionStatus = async (fallbackOverride?: { isVip?: boolean; vipExpireDate?: string | null }) => {
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
    } catch (error) {
      console.error('刷新会员摘要失败:', error)
    }
  }

  const refreshProfileAfterPaid = async () => {
    try {
      const response = await api.get('/users/profile')
      const updated = response.data || {}
      const membershipLevel =
        updated.membershipLevel === 'VIP' || updated.membershipLevel === 'FREE'
          ? updated.membershipLevel
          : (user?.isVip ? 'VIP' : 'FREE')
      const nextVipExpireDate = updated.vipExpireDate || null

      updateUser({
        membershipLevel,
        isVip: membershipLevel === 'VIP',
        vipExpireDate: nextVipExpireDate,
      })

      await refreshSubscriptionStatus({
        isVip: membershipLevel === 'VIP',
        vipExpireDate: nextVipExpireDate,
      })
    } catch (error) {
      console.error('刷新用户会员信息失败:', error)
    }
  }

  const loadOrderResult = async (orderNo: string) => {
    if (!orderNo) {
      return null
    }

    const response = await api.get(`/payments/orders/${encodeURIComponent(orderNo)}`)
    const payload = (response.data?.data || {}) as PaymentOrderView
    setOrderResult(payload)

    if (payload.orderStatus === 'PAID') {
      clearLatestPendingOrderNo()
      await refreshProfileAfterPaid()
      setNotice('支付成功，会员权益已生效')
      return payload
    }

    if (payload.orderStatus === 'CLOSED') {
      clearLatestPendingOrderNo()
      setNotice(payload.primaryAction.reason || '该订单已失效，可重新发起支付')
      return payload
    }

    setLatestPendingOrderNo(payload.orderNo || orderNo)
    return payload
  }

  const pollOrderStatus = async (orderNo: string) => {
    if (!orderNo) {
      return
    }

    try {
      setIsPollingOrder(true)
      const payload = await loadOrderResult(orderNo)
      if (!payload) {
        stopPolling()
        return
      }

      if (payload.orderStatus === 'PAID' || payload.orderStatus === 'CLOSED') {
        stopPolling()
        return
      }

      pollCountRef.current += 1
      if (pollCountRef.current >= MAX_POLL_COUNT) {
        stopPolling()
        setNotice('支付状态查询超时，请到“订单记录”页查看最终结果')
        return
      }

      pollTimerRef.current = window.setTimeout(() => {
        void pollOrderStatus(orderNo)
      }, POLL_INTERVAL_MS)
    } catch (error) {
      console.error('查询订单状态失败:', error)
      stopPolling()
      setNotice('查询订单状态失败，请稍后重试')
    }
  }

  const restoreOrderResult = async (
    orderNo: string,
    options?: {
      notice?: string
      keepNoticeForOpen?: boolean
    },
  ) => {
    if (!orderNo) {
      return
    }

    stopPolling()
    setLatestPendingOrderNo(orderNo)
    setNotice(options?.notice || '')

    try {
      const payload = await loadOrderResult(orderNo)
      if (payload?.orderStatus === 'OPEN' && !options?.keepNoticeForOpen) {
        setNotice(payload.primaryAction.reason || '')
      }
    } catch (error) {
      console.error('查询订单状态失败:', error)
      setNotice('查询订单状态失败，请稍后重试')
    }
  }

  const loadLatestPendingOrderNoFromServer = async () => {
    try {
      const response = await api.get('/payments/orders', {
        params: {
          status: 'OPEN',
          page: 1,
          pageSize: 1,
        },
      })
      const orders = (response.data?.data || []) as PaymentOrderListItem[]
      const latestPendingOrderNo = String(orders[0]?.orderNo || '').trim()
      if (!latestPendingOrderNo) {
        return ''
      }

      setLatestPendingOrderNo(latestPendingOrderNo)
      return latestPendingOrderNo
    } catch (error) {
      console.error('获取最近待支付订单失败:', error)
      return ''
    }
  }

  const handleResumeCheckout = async () => {
    const orderNo = String(orderResult?.orderNo || '').trim()
    if (!orderNo) {
      return
    }

    const endpoint = String(orderResult?.primaryAction?.endpoint || '').trim()
      || `/payments/orders/${encodeURIComponent(orderNo)}/recheckout`
    const requestConfig = orderResult?.primaryAction?.requiresIdempotencyKey
      ? {
          headers: {
            'idempotency-key': window.crypto.randomUUID(),
          },
        }
      : undefined

    try {
      setIsResumingCheckout(true)
      setNotice('正在拉起支付页面...')
      const response = await api.post(endpoint, undefined, requestConfig)
      const payload = (response.data?.data || {}) as PaymentOrderView
      setOrderResult(payload)
      if (!payload.checkoutUrl) {
        setNotice(payload.primaryAction?.reason || '暂时无法继续支付，请稍后重试')
        return
      }

      setLatestPendingOrderNo(payload.orderNo || orderNo)
      window.location.href = payload.checkoutUrl
    } catch (error) {
      console.error('继续支付失败:', error)
      setNotice('继续支付失败，请稍后重试')
    } finally {
      setIsResumingCheckout(false)
    }
  }

  useEffect(() => {
    setSubscriptionStatus(
      normalizeSubscriptionStatus(
        null,
        Boolean(user?.membershipLevel === 'VIP' || user?.isVip),
        user?.vipExpireDate,
      ),
    )
  }, [user?.isVip, user?.membershipLevel, user?.vipExpireDate])

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    void refreshSubscriptionStatus()
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    if (orderNoFromQuery) {
      if (returnStatusFromQuery === 'cancel') {
        void restoreOrderResult(orderNoFromQuery, {
          notice: '支付已取消，可重新发起支付',
          keepNoticeForOpen: true,
        })
        return
      }

      if (returnStatusFromQuery === 'success') {
        setNotice('支付成功，正在同步结果...')
        setLatestPendingOrderNo(orderNoFromQuery)
        pollCountRef.current = 0
        void pollOrderStatus(orderNoFromQuery)
        return () => {
          stopPolling()
        }
      }

      void restoreOrderResult(orderNoFromQuery)
      return
    }

    const localPendingOrderNo = getLatestPendingOrderNo()
    if (localPendingOrderNo) {
      void restoreOrderResult(localPendingOrderNo, {
        notice: '检测到未完成支付订单，正在恢复...',
      })
      return
    }

    let canceled = false
    void (async () => {
      const latestPendingOrderNo = await loadLatestPendingOrderNoFromServer()
      if (!latestPendingOrderNo || canceled) {
        return
      }

      await restoreOrderResult(latestPendingOrderNo, {
        notice: '检测到未完成支付订单，正在恢复...',
      })
    })()

    return () => {
      canceled = true
      stopPolling()
    }
  }, [isLoggedIn, orderNoFromQuery, returnStatusFromQuery])

  const handleCreateOrder = async (plan: PlanItem) => {
    if (!isLoggedIn) {
      navigate('/login')
      return
    }

    try {
      setIsSubmittingOrder(true)
      setNotice('')

      const response = await api.post('/payments/orders', {
        planCode: plan.code,
        clientType: 'WEB',
      }, {
        headers: {
          'idempotency-key': window.crypto.randomUUID(),
        },
      })

      const data = (response.data?.data || {}) as PaymentOrderView
      setOrderResult(data)
      setNotice(`订单已创建：${data.orderNo}`)
      setLatestPendingOrderNo(data.orderNo)

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }

      pollCountRef.current = 0
      void pollOrderStatus(data.orderNo)
    } catch (error) {
      console.error('创建支付订单失败:', error)
      setNotice('创建订单失败，请稍后重试')
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 mb-4">
              <Crown className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-text-primary mb-3">会员中心</h1>
            <p className="text-text-secondary max-w-2xl mx-auto">
              查看当前会员状态、可用特权，并选择适合你的会员套餐
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <section className="lg:col-span-2 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-gray-100 p-5 md:p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4">会员信息总览</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">账号等级</div>
                  <div className={`text-base font-semibold ${isVipMember ? 'text-primary' : 'text-text-primary'}`}>
                    {membershipTitle}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">会员到期</div>
                  <div className="text-base font-semibold text-text-primary">{vipExpireText}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">今日剩余次数</div>
                  <div className="text-base font-semibold text-text-primary">{remainingQuotaText}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">今日已用</div>
                  <div className="text-base font-semibold text-text-primary">{usedQuotaText}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">支持平台</div>
                  <div className="text-base font-semibold text-text-primary">{supportedPlatformsText}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="text-xs text-text-secondary mb-1">最高画质</div>
                  <div className="text-base font-semibold text-text-primary">{maxQualityText}</div>
                </div>
              </div>
              <p className="text-sm text-text-secondary">
                {isVipMember
                  ? '会员权益已生效，可直接使用全平台、1080P / 4K 与无限下载能力。'
                  : '免费用户每天可下载 5 次，仅支持抖音、哔哩哔哩，最高 720P。'}
              </p>
            </section>

            <section className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-gray-100 p-5 md:p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-3">支付状态</h2>
              {orderResult ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-text-secondary space-y-1">
                  <div>当前订单：{orderResult.orderNo}</div>
                  <div>状态：{orderResult.orderStatusLabel}</div>
                  <div>
                    金额：{orderResult.currency} {(orderResult.amountMinor / 100).toFixed(2)}
                  </div>
                  {orderResult.primaryAction.reason && (
                    <div>提示：{orderResult.primaryAction.reason}</div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 p-3 text-xs text-text-secondary">
                  暂无进行中的订单
                </div>
              )}

              {notice && (
                <div className="mt-3 p-3 text-xs rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
                  {notice}
                </div>
              )}

              <div
                className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3"
                role="group"
                aria-label="订单操作"
              >
                {orderResult?.primaryAction.type === 'RESUME_PAYMENT' && orderResult.primaryAction.enabled && (
                  <button
                    onClick={handleResumeCheckout}
                    disabled={isResumingCheckout}
                    className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isResumingCheckout ? '拉起支付中...' : orderResult.primaryAction.label}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => navigate('/user?tab=orders')}
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-primary/15 bg-primary/5 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  查看订单记录
                </button>
              </div>
            </section>
          </div>

          <section className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-gray-100 p-5 md:p-6 mb-8">
            <h2 className="text-lg font-semibold text-text-primary mb-1">当前可用特权</h2>
            <p className="text-sm text-text-secondary mb-4">
              {isVipMember ? '以下权益已生效。' : '当前为免费用户，升级后即可解锁全平台、1080P / 4K 与无限下载。'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {membershipPerks.map((perk) => (
                <div key={perk.label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <perk.icon className={`w-4 h-4 ${perk.color}`} />
                        <div className="text-sm font-semibold text-text-primary">{perk.label}</div>
                      </div>
                      <p className="text-xs text-text-secondary">{perk.description}</p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                        isVipMember
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {isVipMember ? '已生效' : '待升级'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary mb-4">选择会员套餐</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <div
                  key={plan.name}
                  className={`
                    relative bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border-2 p-6
                    ${plan.popular ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100'}
                  `}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-white text-xs font-medium rounded-full">
                      最受欢迎
                    </div>
                  )}

                  <h3 className="text-lg font-bold text-text-primary text-center mb-2">{plan.name}</h3>
                  <div className="text-center mb-4">
                    <span className="text-4xl font-bold text-primary">{formatPrice(plan.priceCny)}</span>
                    <span className="text-sm text-text-secondary">{plan.duration}</span>
                  </div>

                  <ul className="space-y-2.5 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-text-secondary">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleCreateOrder(plan)}
                    disabled={isSubmittingOrder}
                    className={`
                      w-full h-11 rounded-xl font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed
                      ${plan.popular
                        ? 'bg-primary text-white hover:bg-primary/90'
                        : 'bg-gray-100 text-text-primary hover:bg-gray-200'}
                    `}
                  >
                    {isSubmittingOrder
                      ? '创建订单中...'
                      : isPollingOrder
                        ? '支付状态同步中...'
                        : '立即支付'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-10 text-center">
            <p className="text-sm text-text-secondary">
              开通即表示您同意我们的{' '}
              <Link to="/terms" className="text-primary hover:underline">
                服务条款
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
