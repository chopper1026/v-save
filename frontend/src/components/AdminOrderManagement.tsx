import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'

type AdminOrderStatus = 'OPEN' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'CLOSED'
type AdminOrderPlanCode = 'MONTH' | 'QUARTER' | 'YEAR' | 'LIFETIME'

interface AdminOrderUser {
  id: string
  email: string | null
  nickname: string | null
  phone: string | null
  membershipLevel: 'FREE' | 'VIP' | null
  vipExpireDate: string | null
}

interface AdminOrderListItem {
  orderNo: string
  planCode: AdminOrderPlanCode
  planName: string
  amountMinor: number
  currency: string
  orderStatus: AdminOrderStatus
  orderStatusLabel: string
  refundStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED'
  createdAt: string
  paidAt: string | null
  latestAttempt: {
    attemptNo: string
    status: string
    statusLabel: string
    reasonCode: string | null
    expiresAt: string | null
    finishedAt: string | null
    failureReason: string | null
  } | null
  primaryAction: {
    type: string
    label: string
    enabled: boolean
    reason: string | null
    kind: string
    href?: string
  }
  user: AdminOrderUser
}

interface AdminOrderDetail extends AdminOrderListItem {
  recoveryWindowEndsAt: string | null
  closeReasonCode: string | null
  secondaryActions: Array<{
    type: string
    label: string
    enabled: boolean
    reason: string | null
    kind: string
    href?: string
  }>
  timeline: Array<{
    type: string
    at: string
    title: string
    detail: string
  }>
  refund: {
    eligible: boolean
    deadlineAt: string | null
    reason: string | null
    latestStatus: 'NONE' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED'
  }
  status: string
  checkoutUrl: string | null
  entitlement: {
    planCode: AdminOrderPlanCode
    status: 'ACTIVE' | 'REVOKED'
    grantDays: number | null
    isLifetime: boolean
    effectiveStartAt: string | null
    effectiveEndAt: string | null
    revokedAt: string | null
    revokedReason: string | null
  } | null
  providerRefs: {
    checkoutSessionId: string | null
    paymentIntentId: string | null
  }
  latestRefundRecord: {
    refundNo: string
    status: string
    reason: string
    requestedAt: string
    completedAt: string | null
    failureMessage: string | null
  } | null
  operations: {
    canManualRepair: boolean
  }
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

interface SingleResponse<T> {
  success: boolean
  data: T
}

const PAGE_SIZE_OPTIONS = [10, 20, 50]

function DetailField({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`grid grid-cols-[84px_minmax(0,1fr)] gap-3 ${className}`.trim()}>
      <dt className="text-[11px] font-medium tracking-[0.16em] text-text-secondary uppercase">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-sm text-text-primary leading-6">
        {value}
      </dd>
    </div>
  )
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const formatMoney = (currency?: string | null, amountMinor?: number | null) => {
  const amount = Number(amountMinor || 0)
  return `${currency || '--'} ${(amount / 100).toFixed(2)}`
}

const formatText = (value?: string | null) => {
  const normalized = String(value || '').trim()
  return normalized || '--'
}

const getPlanLabel = (planCode?: AdminOrderPlanCode | null) => {
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
      return '--'
  }
}

const getStatusClass = (status?: AdminOrderStatus | null) => {
  switch (status) {
    case 'PAID':
      return 'bg-emerald-100 text-emerald-700'
    case 'OPEN':
      return 'bg-amber-100 text-amber-700'
    case 'REFUND_PENDING':
      return 'bg-sky-100 text-sky-700'
    case 'REFUNDED':
      return 'bg-slate-100 text-slate-700'
    case 'REFUND_FAILED':
      return 'bg-rose-100 text-rose-700'
    case 'CLOSED':
      return 'bg-gray-100 text-gray-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function AdminOrderManagement() {
  const [orders, setOrders] = useState<AdminOrderListItem[]>([])
  const [selectedOrderNo, setSelectedOrderNo] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderDetail | null>(null)
  const [isLoadingOrders, setIsLoadingOrders] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isRunningRepair, setIsRunningRepair] = useState(false)
  const [isRunningReconciliation, setIsRunningReconciliation] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [notice, setNotice] = useState('')
  const [orderTotal, setOrderTotal] = useState(0)
  const [orderPage, setOrderPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminOrderStatus>('ALL')
  const [planFilter, setPlanFilter] = useState<'ALL' | AdminOrderPlanCode>('ALL')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [reconciliationDate, setReconciliationDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [forceReconciliation, setForceReconciliation] = useState(false)
  const [reconciliationResult, setReconciliationResult] = useState<Record<string, any> | null>(null)
  const selectedOrderNoRef = useRef('')

  const orderTotalPages = useMemo(
    () => Math.max(1, Math.ceil(orderTotal / pageSize)),
    [orderTotal, pageSize],
  )

  useEffect(() => {
    selectedOrderNoRef.current = selectedOrderNo
  }, [selectedOrderNo])

  const fetchOrderDetail = useCallback(async (orderNo: string) => {
    if (!orderNo) {
      setSelectedOrder(null)
      return
    }

    try {
      setIsLoadingDetail(true)
      setDetailError('')
      const response = await api.get<SingleResponse<AdminOrderDetail>>(`/admin/orders/${encodeURIComponent(orderNo)}`)
      if (response.data?.success) {
        setSelectedOrder((response.data?.data || null) as AdminOrderDetail)
      } else {
        setDetailError('获取订单详情失败')
      }
    } catch (error) {
      console.error('获取后台订单详情失败:', error)
      setDetailError('获取订单详情失败，请稍后重试')
    } finally {
      setIsLoadingDetail(false)
    }
  }, [])

  const fetchOrders = useCallback(async (options?: { page?: number; preferredOrderNo?: string }) => {
    const nextPage = Math.max(1, Number(options?.page || orderPage) || 1)

    try {
      setIsLoadingOrders(true)
      setOrdersError('')
      setNotice('')
      const response = await api.get<PagedResponse<AdminOrderListItem>>('/admin/orders', {
        params: {
          page: nextPage,
          pageSize,
          keyword: keyword.trim() || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          planCode: planFilter !== 'ALL' ? planFilter : undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
        },
      })

      if (!response.data?.success) {
        setOrdersError('获取订单列表失败')
        return
      }

      const nextOrders = (response.data?.data || []) as AdminOrderListItem[]
      const nextTotal = Number(response.data?.meta?.total || 0)
      const nextSelected = String(
        options?.preferredOrderNo
          || selectedOrderNoRef.current
          || nextOrders[0]?.orderNo
          || '',
      ).trim()

      setOrders(nextOrders)
      setOrderTotal(nextTotal)
      setOrderPage(Number(response.data?.meta?.page || nextPage))
      setSelectedOrderNo(nextSelected)

      if (nextSelected) {
        await fetchOrderDetail(nextSelected)
      } else {
        setSelectedOrder(null)
      }
    } catch (error) {
      console.error('获取后台订单列表失败:', error)
      setOrdersError('获取订单列表失败，请稍后重试')
    } finally {
      setIsLoadingOrders(false)
    }
  }, [
    createdFrom,
    createdTo,
    fetchOrderDetail,
    keyword,
    orderPage,
    pageSize,
    planFilter,
    statusFilter,
  ])

  useEffect(() => {
    void fetchOrders({ page: orderPage })
  }, [fetchOrders, orderPage])

  const handleSelectOrder = (orderNo: string) => {
    setSelectedOrderNo(orderNo)
    void fetchOrderDetail(orderNo)
  }

  const handleManualRepair = async () => {
    if (!selectedOrderNo) return

    try {
      setIsRunningRepair(true)
      setNotice('')
      setDetailError('')
      const response = await api.post<SingleResponse<{ orderNo: string; repaired: boolean }>>(
        `/admin/orders/${encodeURIComponent(selectedOrderNo)}/manual-repair`,
      )
      if (response.data?.success) {
        await fetchOrders({ page: orderPage, preferredOrderNo: selectedOrderNo })
        setNotice(`补单已完成：${response.data.data.orderNo}`)
      } else {
        setDetailError('补单执行失败')
      }
    } catch (error) {
      console.error('后台补单失败:', error)
      setDetailError('补单执行失败，请稍后重试')
    } finally {
      setIsRunningRepair(false)
    }
  }

  const handleRunReconciliation = async () => {
    if (!reconciliationDate) return

    try {
      setIsRunningReconciliation(true)
      setNotice('')
      const response = await api.post<SingleResponse<Record<string, any>>>('/admin/orders/reconciliation', {
        date: reconciliationDate,
        force: forceReconciliation,
      })

      if (response.data?.success) {
        setReconciliationResult(response.data.data || null)
      }
    } catch (error) {
      console.error('执行支付对账失败:', error)
      setNotice('执行支付对账失败，请稍后重试')
    } finally {
      setIsRunningReconciliation(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">订单管理</h1>
            <p className="text-sm text-text-secondary mt-1">统一查看会员订单、补单状态和按日对账结果</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3">
            <label className="block 2xl:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">搜索条件</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="订单号 / 用户昵称 / 邮箱 / 手机号"
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">订单状态</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'ALL' | AdminOrderStatus)}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              >
                <option value="ALL">全部状态</option>
                <option value="OPEN">待支付</option>
                <option value="PAID">已支付</option>
                <option value="REFUND_PENDING">退款处理中</option>
                <option value="REFUNDED">已退款</option>
                <option value="REFUND_FAILED">退款失败</option>
                <option value="CLOSED">已关闭</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">会员套餐</span>
              <select
                value={planFilter}
                onChange={(event) => setPlanFilter(event.target.value as 'ALL' | AdminOrderPlanCode)}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              >
                <option value="ALL">全部套餐</option>
                <option value="MONTH">月卡</option>
                <option value="QUARTER">季卡</option>
                <option value="YEAR">年卡</option>
                <option value="LIFETIME">终身</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">创建起始</span>
              <input
                type="date"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">创建结束</span>
              <input
                type="date"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">每页条数</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number.parseInt(event.target.value, 10))
                  setOrderPage(1)
                }}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              >
                {PAGE_SIZE_OPTIONS.map((item) => (
                  <option key={item} value={item}>每页 {item} 条</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setOrderPage(1)
                  void fetchOrders({ page: 1 })
                }}
                className="h-10 w-full px-4 rounded-lg text-sm bg-primary text-white hover:bg-primary/90"
              >
                查询订单
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">按日对账</h2>
            <p className="text-sm text-text-secondary mt-1">手动触发 Stripe 与本地已支付订单对账</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[180px_128px_auto] md:items-end gap-3">
            <div className="min-w-0">
              <label htmlFor="reconciliation-date" className="block text-xs text-text-secondary mb-1">
                对账日期
              </label>
              <input
                id="reconciliation-date"
                type="date"
                value={reconciliationDate}
                onChange={(event) => setReconciliationDate(event.target.value)}
                className="h-10 w-full px-3 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <label className="h-10 inline-flex items-center justify-center gap-2 self-end rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-text-secondary whitespace-nowrap">
              <input
                type="checkbox"
                checked={forceReconciliation}
                onChange={(event) => setForceReconciliation(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900"
              />
              强制重跑
            </label>
            <button
              type="button"
              onClick={() => void handleRunReconciliation()}
              disabled={isRunningReconciliation}
              className="h-10 px-4 rounded-lg text-sm bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
            >
              执行对账
            </button>
          </div>
        </div>

        {reconciliationResult && (
          <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-primary space-y-1">
            <div className="font-medium">对账结果</div>
            <div>日期：{String(reconciliationResult.bizDate || '--')}</div>
            <div>状态：{String(reconciliationResult.status || '--')}</div>
            <div>平台订单：{Number(reconciliationResult.platformOrderCount || 0)}</div>
            <div>本地已支付：{Number(reconciliationResult.localPaidOrderCount || 0)}</div>
            <div>差异订单：{Number(reconciliationResult.diffCount || 0)}</div>
          </div>
        )}
      </section>

      {notice && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">订单列表</h2>
              <p className="text-sm text-text-secondary mt-1">共 {orderTotal} 条，第 {orderPage} / {orderTotalPages} 页</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchOrders({ page: orderPage, preferredOrderNo: selectedOrderNo })}
              className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-text-primary hover:bg-gray-200"
            >
              刷新
            </button>
          </div>

          {ordersError && (
            <p className="mt-3 text-sm text-red-500">{ordersError}</p>
          )}

          <div className="mt-4 space-y-3">
            {isLoadingOrders && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
                订单加载中...
              </div>
            )}
            {!isLoadingOrders && orders.length === 0 && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
                暂无符合条件的订单
              </div>
            )}
            {!isLoadingOrders && orders.map((item) => (
              <button
                key={item.orderNo}
                type="button"
                onClick={() => handleSelectOrder(item.orderNo)}
                className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                  selectedOrderNo === item.orderNo
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-secondary">订单号</div>
                    <div className="mt-1 break-all font-mono text-[13px] font-semibold leading-5 text-text-primary">
                      {item.orderNo}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                      <span className="font-medium text-text-primary">{item.user.nickname || item.user.email || item.user.id}</span>
                      {item.user.email && (
                        <span className="min-w-0 break-all">{item.user.email}</span>
                      )}
                      {item.user.phone && (
                        <span>{item.user.phone}</span>
                      )}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusClass(item.orderStatus)}`}>
                    {item.orderStatusLabel}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">套餐</div>
                    <div className="mt-1 text-sm font-medium text-text-primary">{getPlanLabel(item.planCode)}</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">金额</div>
                    <div className="mt-1 text-sm font-medium text-text-primary">{formatMoney(item.currency, item.amountMinor)}</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">创建时间</div>
                    <div className="mt-1 text-sm text-text-primary leading-5">{formatDateTime(item.createdAt)}</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">支付时间</div>
                    <div className="mt-1 text-sm text-text-primary leading-5">{formatDateTime(item.paidAt)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={orderPage <= 1}
              onClick={() => setOrderPage((prev) => Math.max(1, prev - 1))}
              className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={orderPage >= orderTotalPages}
              onClick={() => setOrderPage((prev) => Math.min(orderTotalPages, prev + 1))}
              className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6 2xl:sticky 2xl:top-24 2xl:max-h-[calc(100vh-7rem)] 2xl:overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">订单详情</h2>
              <p className="text-sm text-text-secondary mt-1">查看支付尝试、权益发放和渠道引用</p>
            </div>
            {selectedOrder?.operations?.canManualRepair && (
              <button
                type="button"
                onClick={() => void handleManualRepair()}
                disabled={isRunningRepair}
                className="px-3 py-1.5 rounded-lg text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-60"
              >
                执行补单
              </button>
            )}
          </div>

          {detailError && (
            <p className="mt-3 text-sm text-red-500">{detailError}</p>
          )}

          {isLoadingDetail && (
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
              订单详情加载中...
            </div>
          )}

          {!isLoadingDetail && !selectedOrder && (
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
              请选择左侧订单查看详情
            </div>
          )}

          {!isLoadingDetail && selectedOrder && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">订单概览</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="订单号" value={formatText(selectedOrder.orderNo)} />
                  <DetailField label="状态" value={formatText(selectedOrder.orderStatusLabel)} />
                  <DetailField label="套餐" value={getPlanLabel(selectedOrder.planCode)} />
                  <DetailField label="金额" value={formatMoney(selectedOrder.currency, selectedOrder.amountMinor)} />
                  <DetailField label="创建时间" value={formatDateTime(selectedOrder.createdAt)} />
                  <DetailField label="支付时间" value={formatDateTime(selectedOrder.paidAt)} />
                </dl>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">用户信息</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="昵称" value={formatText(selectedOrder.user.nickname)} />
                  <DetailField label="邮箱" value={formatText(selectedOrder.user.email)} />
                  <DetailField label="手机号" value={formatText(selectedOrder.user.phone)} />
                  <DetailField label="会员等级" value={formatText(selectedOrder.user.membershipLevel)} />
                  <DetailField label="会员到期" value={formatDateTime(selectedOrder.user.vipExpireDate)} />
                </dl>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">支付尝试</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="Attempt" value={formatText(selectedOrder.latestAttempt?.attemptNo || null)} />
                  <DetailField label="尝试状态" value={formatText(selectedOrder.latestAttempt?.statusLabel || null)} />
                  <DetailField label="过期时间" value={formatDateTime(selectedOrder.latestAttempt?.expiresAt || null)} />
                  <DetailField label="完成时间" value={formatDateTime(selectedOrder.latestAttempt?.finishedAt || null)} />
                  <DetailField label="失败原因" value={formatText(selectedOrder.latestAttempt?.failureReason || null)} />
                </dl>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">渠道引用</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="Session" value={formatText(selectedOrder.providerRefs.checkoutSessionId)} />
                  <DetailField label="Intent" value={formatText(selectedOrder.providerRefs.paymentIntentId)} />
                </dl>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">权益信息</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="权益状态" value={formatText(selectedOrder.entitlement?.status || null)} />
                  <DetailField label="权益套餐" value={getPlanLabel(selectedOrder.entitlement?.planCode || null)} />
                  <DetailField label="生效时间" value={formatDateTime(selectedOrder.entitlement?.effectiveStartAt || null)} />
                  <DetailField label="结束时间" value={formatDateTime(selectedOrder.entitlement?.effectiveEndAt || null)} />
                  <DetailField label="撤销原因" value={formatText(selectedOrder.entitlement?.revokedReason || null)} />
                </dl>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="font-medium text-text-primary">退款信息</div>
                <dl className="mt-3 space-y-2">
                  <DetailField label="退款状态" value={formatText(selectedOrder.refund.latestStatus)} />
                  <DetailField label="退款单号" value={formatText(selectedOrder.latestRefundRecord?.refundNo || null)} />
                  <DetailField label="退款原因" value={formatText(selectedOrder.latestRefundRecord?.reason || selectedOrder.refund.reason || null)} />
                </dl>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
