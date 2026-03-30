import { Gauge, Info, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  AUTH_STATUS_LABELS,
  CLIENT_LABELS,
  FEATURE_LABELS,
  PLATFORM_LABELS,
  RUNTIME_WINDOW_OPTIONS,
  formatLatency,
  formatPercent,
  hasMetrics,
  type RuntimeChainDetail,
  type RuntimeChainListItem,
  type RuntimeDashboardData,
  type RuntimeFeature,
  type RuntimeFeatureMetrics,
  type RuntimePlatform,
  type RuntimeTrendPoint,
  type RuntimeWindow,
} from '../lib/runtime-monitor'
import RuntimeChainExplorer from './runtime/RuntimeChainExplorer'
import RuntimeGroupedBarChartCard from './runtime/RuntimeGroupedBarChartCard'
import RuntimeP95ExplainDialog from './runtime/RuntimeP95ExplainDialog'
import RuntimeTopErrorsPanel from './runtime/RuntimeTopErrorsPanel'
import RuntimeTrendChartCard from './runtime/RuntimeTrendChartCard'
import RuntimeWarningsPanel from './runtime/RuntimeWarningsPanel'
import {
  readRuntimeDashboardPanelPreferences,
  writeRuntimeDashboardPanelPreferences,
  type RuntimeDashboardPanelPreferenceKey,
} from './runtime/runtime-panel-preferences'

const REFRESH_INTERVAL_MS = 60_000

interface AdminRuntimeDashboardProps {
  onJumpTab: (tab: 'auth') => void
}

interface RuntimeTrendChartRow {
  bucketStart: string
  bucketLabel: string
  parse: number
  preview: number
  download: number
}

interface RuntimeGroupedBarChartRow {
  label: string
  parse: number
  preview: number
  download: number
  parseTotal: number
  previewTotal: number
  downloadTotal: number
}

const FEATURE_KEYS: RuntimeFeature[] = ['parse', 'preview', 'download']

const AUTH_STATUS_BADGE_CLASS_MAP: Record<RuntimeDashboardData['authHealth']['overallStatus'], string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  degraded: 'bg-amber-100 text-amber-700',
  invalid: 'bg-red-100 text-red-700',
  unknown: 'bg-slate-100 text-slate-600',
}

const buildTrendRows = (
  dashboard: RuntimeDashboardData | null,
  valueSelector: (point: RuntimeTrendPoint) => number,
): RuntimeTrendChartRow[] => {
  if (!dashboard) {
    return []
  }

  const rows = new Map<string, RuntimeTrendChartRow>()

  FEATURE_KEYS.forEach((feature) => {
    dashboard.trends[feature].forEach((point) => {
      const existing = rows.get(point.bucketStart) || {
        bucketStart: point.bucketStart,
        bucketLabel: point.bucketLabel,
        parse: 0,
        preview: 0,
        download: 0,
      }

      existing[feature] = valueSelector(point)
      rows.set(point.bucketStart, existing)
    })
  })

  return Array.from(rows.values()).sort(
    (left, right) => new Date(left.bucketStart).getTime() - new Date(right.bucketStart).getTime(),
  )
}

const toGroupedBarRow = (
  label: string,
  features: Record<RuntimeFeature, RuntimeFeatureMetrics>,
): RuntimeGroupedBarChartRow => ({
  label,
  parse: features.parse.successRate,
  preview: features.preview.successRate,
  download: features.download.successRate,
  parseTotal: features.parse.total,
  previewTotal: features.preview.total,
  downloadTotal: features.download.total,
})

interface RuntimeFeatureStripCellProps {
  title: string
  metrics: RuntimeFeatureMetrics
}

function RuntimeFeatureStripCell({
  title,
  metrics,
}: RuntimeFeatureStripCellProps) {
  return (
    <article className="bg-white px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="text-4xl font-black leading-none text-slate-900">{formatPercent(metrics.successRate)}</p>
        <p className="text-xs font-medium text-slate-500">样本 {metrics.total}</p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-200 pt-3 text-sm">
        <div>
          <p className="text-[11px] text-slate-500">失败</p>
          <p className="mt-1 font-semibold text-slate-900">{metrics.failureCount}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">平均</p>
          <p className="mt-1 font-semibold text-slate-900">{formatLatency(metrics.avgLatencyMs)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">P95</p>
          <p className="mt-1 font-semibold text-slate-900">{formatLatency(metrics.p95LatencyMs)}</p>
        </div>
      </div>
    </article>
  )
}

interface RuntimeAuthSummaryCellProps {
  dashboard: RuntimeDashboardData
  unhealthyPlatforms: number
}

function RuntimeAuthSummaryCell({
  dashboard,
  unhealthyPlatforms,
}: RuntimeAuthSummaryCellProps) {
  const status = dashboard.authHealth.overallStatus

  return (
    <article className="bg-white px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">平台登录态</p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-4xl font-black leading-none text-slate-900">{AUTH_STATUS_LABELS[status]}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${AUTH_STATUS_BADGE_CLASS_MAP[status]}`}>
          {AUTH_STATUS_LABELS[status]}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 text-sm">
        <div>
          <p className="text-[11px] text-slate-500">异常平台</p>
          <p className="mt-1 text-2xl font-bold leading-none text-slate-900">{unhealthyPlatforms}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">最近检查</p>
          <p className="mt-1 font-semibold text-slate-900">
            {dashboard.authHealth.checkedAt
              ? new Date(dashboard.authHealth.checkedAt).toLocaleString('zh-CN', { hour12: false })
              : '--'}
          </p>
        </div>
      </div>
    </article>
  )
}

export default function AdminRuntimeDashboard({
  onJumpTab,
}: AdminRuntimeDashboardProps) {
  const [windowRange, setWindowRange] = useState<RuntimeWindow>('today')
  const [dashboard, setDashboard] = useState<RuntimeDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [isP95ExplainOpen, setIsP95ExplainOpen] = useState(false)

  const [chainPlatform, setChainPlatform] = useState<RuntimePlatform>('douyin')
  const [chains, setChains] = useState<RuntimeChainListItem[]>([])
  const [chainsLoading, setChainsLoading] = useState(false)
  const [chainsError, setChainsError] = useState('')
  const [chainDetail, setChainDetail] = useState<RuntimeChainDetail | null>(null)
  const [chainDetailOpen, setChainDetailOpen] = useState(false)
  const [chainDetailLoading, setChainDetailLoading] = useState(false)
  const [activeTraceId, setActiveTraceId] = useState('')
  const [chainExplorerCollapsed, setChainExplorerCollapsed] = useState(false)
  const [panelPreferences, setPanelPreferences] = useState(() =>
    readRuntimeDashboardPanelPreferences(
      typeof window === 'undefined' ? null : window.localStorage,
    ),
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    writeRuntimeDashboardPanelPreferences(window.localStorage, panelPreferences)
  }, [panelPreferences])

  const fetchDashboard = useCallback(async (showLoading: boolean) => {
    try {
      if (showLoading) {
        setIsLoading(true)
      }
      setError('')
      const response = await api.get('/admin/runtime-dashboard', {
        params: {
          window: windowRange,
        },
      })
      if (response.data?.success) {
        setDashboard(response.data.data as RuntimeDashboardData)
      } else {
        setError('获取运行看板失败，请稍后重试')
      }
    } catch (err) {
      console.error('获取运行看板失败:', err)
      setError('获取运行看板失败，请稍后重试')
    } finally {
      if (showLoading) {
        setIsLoading(false)
      }
    }
  }, [windowRange])

  const fetchChains = useCallback(async (showLoading: boolean) => {
    try {
      if (showLoading) {
        setChainsLoading(true)
      }
      setChainsError('')
      const response = await api.get('/admin/runtime-dashboard/chains', {
        params: {
          window: windowRange,
          platform: chainPlatform,
          limit: 5,
        },
      })
      if (response.data?.success) {
        setChains((response.data.data || []) as RuntimeChainListItem[])
      } else {
        setChainsError('获取链路列表失败，请稍后重试')
      }
    } catch (err) {
      console.error('获取链路列表失败:', err)
      setChainsError('获取链路列表失败，请稍后重试')
    } finally {
      if (showLoading) {
        setChainsLoading(false)
      }
    }
  }, [chainPlatform, windowRange])

  const fetchChainDetail = useCallback(async (traceId: string, showLoading: boolean) => {
    const normalizedTraceId = String(traceId || '').trim()
    if (!normalizedTraceId) {
      return
    }

    try {
      if (showLoading) {
        setChainDetailLoading(true)
      }
      const response = await api.get(`/admin/runtime-dashboard/chains/${encodeURIComponent(normalizedTraceId)}`)
      if (response.data?.success) {
        setChainDetail(response.data.data as RuntimeChainDetail)
      }
    } catch (err) {
      console.error('获取链路详情失败:', err)
      setChainDetail(null)
    } finally {
      if (showLoading) {
        setChainDetailLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void Promise.all([fetchDashboard(true), fetchChains(true)])

    const timer = window.setInterval(() => {
      void fetchDashboard(false)
      void fetchChains(false)
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [fetchChains, fetchDashboard])

  useEffect(() => {
    if (!chainDetailOpen || !activeTraceId) {
      return undefined
    }

    const timer = window.setInterval(() => {
      void fetchChainDetail(activeTraceId, false)
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeTraceId, chainDetailOpen, fetchChainDetail])

  const handleManualRefresh = useCallback(async () => {
    try {
      setIsManualRefreshing(true)
      await Promise.all([
        fetchDashboard(false),
        fetchChains(false),
        chainDetailOpen && activeTraceId
          ? fetchChainDetail(activeTraceId, false)
          : Promise.resolve(),
      ])
    } finally {
      setIsManualRefreshing(false)
    }
  }, [activeTraceId, chainDetailOpen, fetchChainDetail, fetchChains, fetchDashboard])

  const handleOpenChainDetail = useCallback(async (traceId: string) => {
    setChainDetailOpen(true)
    setActiveTraceId(traceId)
    await fetchChainDetail(traceId, true)
  }, [fetchChainDetail])

  const handlePanelCollapsedChange = useCallback(
    (key: RuntimeDashboardPanelPreferenceKey) => {
      setPanelPreferences((current) => {
        const next = {
          ...current,
          [key]: !current[key],
        }

        if (typeof window !== 'undefined') {
          return writeRuntimeDashboardPanelPreferences(window.localStorage, next)
        }

        return next
      })
    },
    [],
  )

  const successRateTrendRows = useMemo(
    () => buildTrendRows(dashboard, (point) => point.successRate),
    [dashboard],
  )
  const p95TrendRows = useMemo(
    () => buildTrendRows(dashboard, (point) => point.p95LatencyMs || 0),
    [dashboard],
  )

  const clientRows = useMemo(() => {
    return (dashboard?.byClient || [])
      .filter((item) => item.clientType !== 'unknown')
      .filter((item) => Object.values(item.features).some((metrics) => hasMetrics(metrics)))
      .map((item) => toGroupedBarRow(CLIENT_LABELS[item.clientType], item.features))
  }, [dashboard])

  const platformRows = useMemo(() => {
    return (dashboard?.byPlatform || [])
      .filter((item) => item.platform !== 'unknown')
      .filter((item) => Object.values(item.features).some((metrics) => hasMetrics(metrics)))
      .map((item) => ({
        total: item.features.parse.total + item.features.preview.total + item.features.download.total,
        row: toGroupedBarRow(PLATFORM_LABELS[item.platform], item.features),
      }))
      .sort((left, right) => right.total - left.total)
      .map((item) => item.row)
  }, [dashboard])

  const unhealthyPlatforms = dashboard
    ? Object.values(dashboard.authHealth.platforms).filter((item) => item.status !== 'healthy').length
    : 0

  const isRefreshing = isLoading || isManualRefreshing

  return (
    <>
      <div className="space-y-6">
        <section className="border border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#f1f7ff_55%,#edf4ff_100%)] px-6 py-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 border border-sky-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                <Gauge className="h-3.5 w-3.5" />
                Runtime Board
              </div>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900 md:text-[2rem]">
                运行看板
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">
                聚焦解析、预览、下载与登录态稳定性，统一在后台内直接观察核心链路。
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <div className="inline-flex border border-slate-200 bg-white/85 p-1">
                {RUNTIME_WINDOW_OPTIONS.map((item) => {
                  const active = windowRange === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setWindowRange(item.value)}
                      className={`px-3.5 py-2 text-sm font-semibold transition-all ${
                        active
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
              <div className="border border-slate-200 bg-white/85 px-4 py-3 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <p>60 秒自动刷新</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  最近刷新：
                  {' '}
                  {dashboard?.generatedAt
                    ? new Date(dashboard.generatedAt).toLocaleString('zh-CN', { hour12: false })
                    : '--'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handleManualRefresh()
                  }}
                  disabled={isRefreshing}
                  className="mt-2 inline-flex items-center border border-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  立即刷新
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </section>

        {dashboard && (
          <>
            <section className="border border-slate-200 bg-slate-200">
              <div className="grid grid-cols-1 gap-px min-[1366px]:grid-cols-2 min-[1920px]:grid-cols-4">
                <RuntimeFeatureStripCell
                  title={FEATURE_LABELS.parse}
                  metrics={dashboard.summary.parse}
                />
                <RuntimeFeatureStripCell
                  title={FEATURE_LABELS.preview}
                  metrics={dashboard.summary.preview}
                />
                <RuntimeFeatureStripCell
                  title={FEATURE_LABELS.download}
                  metrics={dashboard.summary.download}
                />
                <RuntimeAuthSummaryCell
                  dashboard={dashboard}
                  unhealthyPlatforms={unhealthyPlatforms}
                />
              </div>
            </section>

            <RuntimeChainExplorer
              chains={chains}
              loading={chainsLoading}
              error={chainsError}
              platform={chainPlatform}
              collapsed={chainExplorerCollapsed}
              onToggleCollapsed={() => {
                setChainExplorerCollapsed((prev) => {
                  const next = !prev
                  if (next) {
                    setChainDetailOpen(false)
                    setChainDetail(null)
                    setActiveTraceId('')
                  }
                  return next
                })
              }}
              onPlatformChange={(platform) => {
                setChainPlatform(platform)
                setChainDetailOpen(false)
                setChainDetail(null)
                setActiveTraceId('')
              }}
              detail={chainDetail}
              detailLoading={chainDetailLoading}
              detailOpen={chainDetailOpen}
              onOpenDetail={(traceId) => {
                void handleOpenChainDetail(traceId)
              }}
              onCloseDetail={() => {
                setChainDetailOpen(false)
              }}
            />

            <section className="border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">登录态明细条带</h3>
                  <p className="mt-1 text-sm text-slate-500">平台状态明细独立展示，不再影响顶部指标带高度。</p>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpTab('auth')}
                  className="border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-900 hover:text-white"
                >
                  前往登录态管理
                </button>
              </div>

              <div className="divide-y divide-slate-200">
                {Object.values(dashboard.authHealth.platforms).map((platform) => (
                  <div key={platform.platform} className="grid gap-2 px-5 py-4 md:grid-cols-[140px_120px_minmax(0,1fr)] md:items-center">
                    <span className="text-sm font-semibold text-slate-900">{PLATFORM_LABELS[platform.platform]}</span>
                    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${AUTH_STATUS_BADGE_CLASS_MAP[platform.status]}`}>
                      {AUTH_STATUS_LABELS[platform.status]}
                    </span>
                    <div>
                      <p className="text-sm text-slate-600">
                        连续失败 {platform.consecutiveFailures} 次，最近检查{' '}
                        {platform.lastCheckedAt
                          ? new Date(platform.lastCheckedAt).toLocaleString('zh-CN', { hour12: false })
                          : '--'}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500">
                        {platform.lastError || '最近没有记录到登录态异常。'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <RuntimeTrendChartCard
                title="成功率趋势"
                description="按时间窗自动切换小时/天粒度，连续观察解析、预览、下载三条链路稳定性。"
                mode="successRate"
                rows={successRateTrendRows}
                footer="三条链路共用同一时间桶，便于横向定位波动来源。"
                collapsible={{
                  collapsed: panelPreferences.successRateTrend,
                  onToggleCollapsed: () => handlePanelCollapsedChange('successRateTrend'),
                }}
              />
              <RuntimeTrendChartCard
                title="P95 耗时趋势"
                description="重点观察慢请求尾部抖动，识别“平均值正常但实际变慢”的问题。"
                mode="p95LatencyMs"
                rows={p95TrendRows}
                headerActions={(
                  <button
                    type="button"
                    onClick={() => setIsP95ExplainOpen(true)}
                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-slate-200 px-2 text-[10px] font-semibold leading-none text-slate-600 transition-colors hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Info className="h-3 w-3" />
                    P95 说明
                  </button>
                )}
                footer="统计口径：每个时间桶内按该能力事件 latency 分布计算 95 分位。"
                collapsible={{
                  collapsed: panelPreferences.p95Trend,
                  onToggleCollapsed: () => handlePanelCollapsedChange('p95Trend'),
                }}
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <RuntimeGroupedBarChartCard
                title="双端对比"
                description="网页端与移动端三条能力成功率及样本对照。"
                rows={clientRows}
                collapsible={{
                  collapsed: panelPreferences.clientComparison,
                  onToggleCollapsed: () => handlePanelCollapsedChange('clientComparison'),
                }}
              />
              <RuntimeGroupedBarChartCard
                title="平台维度拆分"
                description="主要平台解析、预览、下载成功率对照。"
                rows={platformRows}
                horizontal
                collapsible={{
                  collapsed: panelPreferences.platformBreakdown,
                  onToggleCollapsed: () => handlePanelCollapsedChange('platformBreakdown'),
                }}
              />
            </section>

            <section className="grid gap-5">
              <RuntimeWarningsPanel
                warnings={dashboard.warnings}
                onJumpAuth={() => onJumpTab('auth')}
              />
              <RuntimeTopErrorsPanel errors={dashboard.topErrors} />
            </section>
          </>
        )}

        {isLoading && !dashboard && (
          <div className="border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            正在加载运行看板...
          </div>
        )}
      </div>

      <RuntimeP95ExplainDialog
        open={isP95ExplainOpen}
        onClose={() => setIsP95ExplainOpen(false)}
      />
    </>
  )
}
