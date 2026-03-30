import axios from 'axios'
import { API_BASE_URL } from './api'

export type RuntimeWindow = 'today' | '24h' | '7d'
export type RuntimeFeature = 'parse' | 'preview' | 'download'
export type RuntimeClientType = 'WEB' | 'MOBILE' | 'unknown'
export type RuntimePlatform =
  | 'douyin'
  | 'bilibili'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'youtube'
  | 'unknown'
export type RuntimeOutcome = 'success' | 'failure'
export type RuntimeTraceStage = 'parse' | 'preview' | 'download'

export interface RuntimeFeatureMetrics {
  total: number
  successCount: number
  failureCount: number
  successRate: number
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

export interface RuntimeSummaryMap {
  parse: RuntimeFeatureMetrics
  preview: RuntimeFeatureMetrics
  download: RuntimeFeatureMetrics
}

export interface RuntimeTrendPoint extends RuntimeFeatureMetrics {
  bucketStart: string
  bucketLabel: string
}

export interface RuntimeDashboardTrends {
  parse: RuntimeTrendPoint[]
  preview: RuntimeTrendPoint[]
  download: RuntimeTrendPoint[]
}

export interface RuntimeDashboardWarning {
  source: RuntimeFeature | 'auth'
  severity: 'warning' | 'critical'
  title: string
  detail: string
  actionTab?: 'auth'
}

export interface RuntimeTopError {
  feature: RuntimeFeature
  errorCode: string
  count: number
  clientTypes: RuntimeClientType[]
  platforms: RuntimePlatform[]
}

export interface RuntimeAuthPlatformStatus {
  platform: 'bilibili' | 'douyin'
  status: 'unknown' | 'healthy' | 'degraded' | 'invalid'
  consecutiveFailures: number
  lastError: string | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
}

export interface RuntimeDashboardData {
  window: RuntimeWindow
  generatedAt: string
  summary: RuntimeSummaryMap
  trends: RuntimeDashboardTrends
  byClient: Array<{
    clientType: RuntimeClientType
    features: RuntimeSummaryMap
  }>
  byPlatform: Array<{
    platform: RuntimePlatform
    features: RuntimeSummaryMap
  }>
  authHealth: {
    checkedAt: string
    overallStatus: 'unknown' | 'healthy' | 'degraded' | 'invalid'
    platforms: Record<'bilibili' | 'douyin', RuntimeAuthPlatformStatus>
  }
  warnings: RuntimeDashboardWarning[]
  topErrors: RuntimeTopError[]
}

export interface RuntimeClientEventPayload {
  feature: RuntimeFeature
  clientType: Extract<RuntimeClientType, 'WEB' | 'MOBILE'>
  platform: RuntimePlatform
  outcome: RuntimeOutcome
  latencyMs: number
  errorCode?: string
  eventKey: string
  traceId?: string
}

export interface RuntimeChainListItem {
  traceId: string
  platform: RuntimePlatform
  clientType: RuntimeClientType
  startedAt: string
  endedAt: string
  totalDurationMs: number
  interfaceLatencyMs: number
  clientLatencyMs: number
  combinedLatencyMs: number
  parseToPreviewReadyMs: number | null
  hasFailure: boolean
  stageCounts: Record<RuntimeTraceStage, number>
}

export interface RuntimeChainDetailStep {
  interfaceName: string
  stage: RuntimeTraceStage
  source: 'interface' | 'client'
  outcome: RuntimeOutcome
  latencyMs: number
  errorCode: string | null
  createdAt: string
  taskId: string | null
}

export interface RuntimeChainDetail {
  traceId: string
  platform: RuntimePlatform
  clientType: RuntimeClientType
  startedAt: string
  endedAt: string
  totalDurationMs: number
  interfaceLatencyMs: number
  clientLatencyMs: number
  combinedLatencyMs: number
  parseToPreviewReadyMs: number | null
  hasFailure: boolean
  stages: Record<RuntimeTraceStage, RuntimeChainDetailStep[]>
}

const RUNTIME_EVENT_ENDPOINT = `${API_BASE_URL.replace(/\/+$/, '')}/runtime/client-events`

export const RUNTIME_WINDOW_OPTIONS: Array<{ value: RuntimeWindow; label: string }> = [
  { value: 'today', label: '今日' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
]

export const FEATURE_LABELS: Record<RuntimeFeature, string> = {
  parse: '视频解析',
  preview: '预览',
  download: '下载',
}

export const CLIENT_LABELS: Record<RuntimeClientType, string> = {
  WEB: '网页端',
  MOBILE: '移动端',
  unknown: '未知端',
}

export const PLATFORM_LABELS: Record<RuntimePlatform, string> = {
  douyin: '抖音',
  bilibili: 'B站',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  youtube: 'YouTube',
  unknown: '未知平台',
}

export const AUTH_STATUS_LABELS: Record<RuntimeDashboardData['authHealth']['overallStatus'], string> = {
  unknown: '待检测',
  healthy: '健康',
  degraded: '异常',
  invalid: '失效',
}

export const createRuntimeEventKey = (
  feature: RuntimeClientEventPayload['feature'],
): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const randomPart = maybeCrypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${feature}:${randomPart}`
}

export const createRuntimeTraceId = (
  source: RuntimeTraceStage,
): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const randomPart = maybeCrypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${source}:${randomPart}`
}

export const normalizeRuntimePlatform = (value: unknown): RuntimePlatform => {
  const normalized = String(value || '').trim().toLowerCase()
  if (
    normalized === 'douyin'
    || normalized === 'bilibili'
    || normalized === 'xiaohongshu'
    || normalized === 'kuaishou'
    || normalized === 'youtube'
  ) {
    return normalized
  }
  return 'unknown'
}

export const extractRuntimeEventErrorCode = (
  error: unknown,
  fallback = 'UNKNOWN_ERROR',
): string => {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as any
    const code = responseData?.code || responseData?.message?.code
    if (typeof code === 'string' && code.trim()) {
      return code.trim().toUpperCase()
    }
  }

  const target = error as any
  const directCode = target?.code
  if (typeof directCode === 'string' && directCode.trim()) {
    return directCode.trim().toUpperCase()
  }

  const message = target?.message
  if (typeof message === 'string' && message.trim()) {
    return message
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
  }

  return fallback
}

export const reportRuntimeClientEvent = (
  payload: RuntimeClientEventPayload,
): void => {
  const body = JSON.stringify({
    ...payload,
    latencyMs: Math.max(0, Math.round(payload.latencyMs || 0)),
    errorCode: payload.errorCode ? payload.errorCode.toUpperCase() : undefined,
  })

  void fetch(RUNTIME_EVENT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => undefined)
}

export const formatLatency = (value: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`
  }
  return `${Math.round(value)}ms`
}

export const formatPercent = (value: number) => `${Number(value || 0).toFixed(1)}%`

export const hasMetrics = (metrics: RuntimeFeatureMetrics) => metrics.total > 0
