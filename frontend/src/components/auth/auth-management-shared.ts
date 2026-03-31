import type { ReactNode } from 'react'

export interface BilibiliAuthStatus {
  hasCookie: boolean
  source: 'database' | 'environment' | 'none'
  refreshTokenPresent: boolean
  csrfPresent: boolean
  userId: string | null
  lastError: string | null
  lastCheckAt: string | null
  lastRefreshAt: string | null
}

export interface BilibiliQrCodePayload {
  qrcodeKey: string
  qrUrl: string
  expireAt: string
}

export interface DouyinAuthStatus {
  hasCookie: boolean
  source: 'database' | 'environment' | 'none'
  lastError: string | null
  lastCheckAt: string | null
  updatedAt: string | null
  cookiePreview: string | null
}

export interface KuaishouAuthStatus {
  hasCookie: boolean
  source: 'database' | 'environment' | 'none'
  userId: string | null
  lastError: string | null
  lastCheckAt: string | null
  updatedAt: string | null
}

export interface KuaishouQrCodePayload {
  qrLoginToken: string
  qrLoginSignature: string
  qrUrl: string
  imageDataUrl: string
  expireAt: string
}

export type DouyinBridgeFlowStatus =
  | 'waiting_helper'
  | 'browser_opened'
  | 'waiting_scan'
  | 'scanned'
  | 'uploading'
  | 'confirmed'
  | 'failed'
  | 'expired'

export interface DouyinBridgeStartPayload {
  authSessionId: string
  expiresAt: string
  uploadToken: string
  loginUrl: string
  status: 'waiting_helper'
}

export interface DouyinBridgeStatusPayload {
  authSessionId: string
  status: DouyinBridgeFlowStatus
  expiresAt: string
  completedAt: string | null
  lastError: string | null
}

export interface AuthHealthPlatformStatus {
  platform: 'bilibili' | 'douyin' | 'kuaishou'
  status: 'unknown' | 'healthy' | 'degraded' | 'invalid'
  consecutiveFailures: number
  lastError: string | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
}

export interface AuthInfoItem {
  label: string
  value: ReactNode
  wide?: boolean
}

export const formatDateTime = (dateValue: string | null) => {
  if (!dateValue) {
    return '--'
  }

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

export const getHealthStatusLabel = (status?: AuthHealthPlatformStatus['status']) => {
  switch (status) {
    case 'healthy':
      return '健康'
    case 'degraded':
      return '异常'
    case 'invalid':
      return '失效'
    case 'unknown':
    default:
      return '未知'
  }
}

export const getHealthStatusClass = (status?: AuthHealthPlatformStatus['status']) => {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-100 text-emerald-700'
    case 'degraded':
      return 'bg-amber-100 text-amber-700'
    case 'invalid':
      return 'bg-red-100 text-red-700'
    case 'unknown':
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

export const getBilibiliSourceLabel = (source?: BilibiliAuthStatus['source']) => {
  switch (source) {
    case 'database':
      return '数据库（扫码登录）'
    case 'environment':
      return '环境变量（手动配置）'
    default:
      return '未配置'
  }
}

export const getDouyinSourceLabel = (source?: DouyinAuthStatus['source']) => {
  switch (source) {
    case 'database':
      return '数据库（扫码或手动维护）'
    case 'environment':
      return '环境变量'
    default:
      return '未配置'
  }
}

export const getKuaishouSourceLabel = (source?: KuaishouAuthStatus['source']) => {
  switch (source) {
    case 'database':
      return '数据库（扫码或手动维护）'
    case 'environment':
      return '环境变量'
    default:
      return '未配置'
  }
}

export const getDouyinBridgeStatusMessage = (
  payload?: Pick<DouyinBridgeStatusPayload, 'status' | 'lastError'> | null,
) => {
  if (!payload) {
    return ''
  }

  switch (payload.status) {
    case 'browser_opened':
      return '本机登录助手已拉起 Chrome，请在浏览器中继续登录抖音'
    case 'waiting_scan':
      return '请使用手机抖音 App 扫码'
    case 'scanned':
      return '已扫码，等待抖音 App 确认登录'
    case 'uploading':
      return '登录完成，正在同步共享登录态'
    case 'confirmed':
      return '登录成功，抖音 Cookie 已保存'
    case 'failed':
      return payload.lastError || '本机登录助手同步失败，请重试'
    case 'expired':
      return payload.lastError || '桥接登录会话已过期，请重新发起'
    case 'waiting_helper':
    default:
      return '已通知本机登录助手，正在拉起 Chrome'
  }
}
