import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type DouyinBridgeStartPayload,
  type DouyinBridgeStatusPayload,
  type DouyinAuthStatus,
} from '../components/auth/auth-management-shared'
import { api } from '../lib/api'
import { useDouyinBridgeAuth } from './useDouyinBridgeAuth'

interface UseDouyinAuthManagerOptions {
  enabled?: boolean
  onAuthHealthRefresh?: (sync?: boolean) => Promise<void>
}

export const useDouyinAuthManager = ({
  enabled = true,
  onAuthHealthRefresh,
}: UseDouyinAuthManagerOptions) => {
  const [status, setStatus] = useState<DouyinAuthStatus | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!enabled) {
      setStatus(null)
      return
    }

    try {
      setIsLoadingStatus(true)
      const response = await api.get('/douyin/auth/status', {
        params: {
          _ts: Date.now(),
        },
      })
      if (response.data?.success) {
        setStatus(response.data.data as DouyinAuthStatus)
      }
    } catch (err) {
      console.error('获取抖音登录状态失败:', err)
      setError('获取抖音登录状态失败，请稍后重试')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [enabled])

  const bridgeAuth = useDouyinBridgeAuth({
    enabled,
    onBridgeConfirmed: async () => {
      await fetchStatus()
      await onAuthHealthRefresh?.(true)
    },
  })

  const saveCookie = useCallback(async () => {
    const cookie = cookieInput.trim()
    if (!cookie) {
      setError('请输入抖音 Cookie 后再保存')
      setMessage('')
      return
    }

    try {
      bridgeAuth.resetBridgeState()
      setIsSubmitting(true)
      setMessage('')
      setError('')

      await api.post('/douyin/auth/session', { cookie })
      setCookieInput('')
      setMessage('抖音 Cookie 已保存，后续解析将优先使用该登录态')
      await fetchStatus()
      await onAuthHealthRefresh?.(true)
    } catch (err) {
      console.error('保存抖音 Cookie 失败:', err)
      setError('保存失败，请确认 Cookie 格式后重试')
    } finally {
      setIsSubmitting(false)
    }
  }, [bridgeAuth, cookieInput, fetchStatus, onAuthHealthRefresh])

  const clearSession = useCallback(async () => {
    try {
      bridgeAuth.resetBridgeState()
      setIsSubmitting(true)
      setMessage('')
      setError('')

      await api.delete('/douyin/auth/session')
      setMessage('抖音登录态已清空')
      await fetchStatus()
      await onAuthHealthRefresh?.(true)
    } catch (err) {
      console.error('清空抖音登录态失败:', err)
      setError('清空失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }, [bridgeAuth, fetchStatus, onAuthHealthRefresh])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  const sourceLabel = useMemo(() => {
    switch (status?.source) {
      case 'database':
        return '数据库（扫码或手动维护）'
      case 'environment':
        return '环境变量'
      default:
        return '未配置'
    }
  }, [status?.source])

  return {
    status,
    cookieInput,
    setCookieInput,
    message,
    error,
    isLoadingStatus,
    isSubmitting,
    sourceLabel,
    fetchStatus,
    bridgeHelperAvailability: bridgeAuth.helperAvailability,
    bridgeSession: bridgeAuth.bridgeSession as DouyinBridgeStartPayload | null,
    bridgeStatus: bridgeAuth.bridgeStatus as DouyinBridgeStatusPayload | null,
    bridgeMessage: bridgeAuth.message,
    bridgeError: bridgeAuth.error,
    isStartingBridge: bridgeAuth.isStarting,
    startBridgeLogin: bridgeAuth.startBridgeLogin,
    resetBridgeState: bridgeAuth.resetBridgeState,
    saveCookie,
    clearSession,
  }
}
