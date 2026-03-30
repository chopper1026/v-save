import axios from 'axios'
import { useUserStore, type User } from '../store/useUserStore'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'
const TOKEN_STORAGE_KEY = 'token'
const PROXY_FETCH_BASE_URL = `${API_BASE_URL}/proxy/fetch`

export const getApiOrigin = () => {
  try {
    return new URL(API_BASE_URL, window.location.origin).origin
  } catch {
    return window.location.origin
  }
}

interface RuntimeProxyTraceOptions {
  runtimeTraceId?: string
  runtimeStage?: 'parse' | 'preview' | 'download'
  runtimeClientType?: 'WEB' | 'MOBILE' | 'unknown'
}

interface ApiUser {
  id: string
  email: string
  nickname: string
  role?: 'SUPER_ADMIN' | 'USER'
  accountStatus?: 'ACTIVE' | 'DISABLED'
  phone?: string | null
  avatar?: string | null
  downloadCount?: number
}

export interface AuthResponse {
  access_token: string
  user: ApiUser
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token =
    useUserStore.getState().token || localStorage.getItem(TOKEN_STORAGE_KEY)

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useUserStore.getState().forceLogout()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export const mapApiUserToStoreUser = (user: ApiUser): User => {
  return {
    id: user.id,
    email: user.email,
    name: user.nickname || user.email.split('@')[0],
    role: user.role || 'USER',
    accountStatus: user.accountStatus || 'ACTIVE',
    phone: user.phone || null,
    avatar: user.avatar || undefined,
    downloadCount: user.downloadCount ?? 0,
  }
}

export const toProxyUrl = (
  targetUrl: string,
  type: 'video' | 'image' = 'video',
  runtimeOptions?: RuntimeProxyTraceOptions,
): string => {
  if (!targetUrl) {
    return ''
  }

  if (targetUrl.startsWith('/api/') && !targetUrl.includes('/api/proxy/fetch?')) {
    return targetUrl
  }

  const normalizedBase = API_BASE_URL.replace(/\/+$/, '')
  const localHosts = new Set(['localhost', '127.0.0.1'])
  const isInternalApiUrl = (() => {
    try {
      const baseUrl = new URL(normalizedBase)
      const target = new URL(targetUrl)
      const sameHost = target.host === baseUrl.host
      const localHostAlias =
        localHosts.has(target.hostname) && localHosts.has(baseUrl.hostname) && target.port === baseUrl.port
      return target.pathname.startsWith('/api/') && (sameHost || localHostAlias)
    } catch (_error) {
      return targetUrl.startsWith(normalizedBase)
    }
  })()

  if (isInternalApiUrl && !targetUrl.includes('/api/proxy/fetch?')) {
    return targetUrl
  }
  const runtimeTraceId = String(runtimeOptions?.runtimeTraceId || '').trim()
  const runtimeStage = runtimeOptions?.runtimeStage || 'preview'
  const runtimeClientType = runtimeOptions?.runtimeClientType || 'unknown'

  const applyRuntimeParams = (url: string): string => {
    if (!runtimeTraceId) {
      return url
    }

    try {
      const parsed = new URL(url, window.location.origin)
      parsed.searchParams.set('runtimeTraceId', runtimeTraceId)
      parsed.searchParams.set('runtimeStage', runtimeStage)
      parsed.searchParams.set('runtimeClientType', runtimeClientType)
      if (url.startsWith('http')) {
        return parsed.toString()
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      return `${url}${url.includes('?') ? '&' : '?'}runtimeTraceId=${encodeURIComponent(runtimeTraceId)}&runtimeStage=${encodeURIComponent(runtimeStage)}&runtimeClientType=${encodeURIComponent(runtimeClientType)}`
    }
  }

  if (targetUrl.includes('/api/proxy/fetch?')) {
    return applyRuntimeParams(targetUrl)
  }

  return applyRuntimeParams(
    `${PROXY_FETCH_BASE_URL}?url=${encodeURIComponent(targetUrl)}&type=${type}`,
  )
}
