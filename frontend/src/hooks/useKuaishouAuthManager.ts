import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type KuaishouAuthStatus,
  type KuaishouQrCodePayload,
  getKuaishouSourceLabel,
} from '../components/auth/auth-management-shared'
import { api } from '../lib/api'

interface UseKuaishouAuthManagerOptions {
  enabled?: boolean
  onAuthHealthRefresh?: (sync?: boolean) => Promise<void>
}

interface KuaishouQrPollPayload {
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'failed'
  message?: string
}

export const useKuaishouAuthManager = ({
  enabled = true,
  onAuthHealthRefresh,
}: UseKuaishouAuthManagerOptions) => {
  const [status, setStatus] = useState<KuaishouAuthStatus | null>(null)
  const [qrCode, setQrCode] = useState<KuaishouQrCodePayload | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const pollTimerRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    if (!enabled) {
      setStatus(null)
      return
    }

    try {
      setIsLoadingStatus(true)
      const response = await api.get('/kuaishou/auth/status', {
        params: {
          _ts: Date.now(),
        },
      })
      if (response.data?.success) {
        setStatus(response.data.data as KuaishouAuthStatus)
      }
    } catch (err) {
      console.error('获取快手登录状态失败:', err)
      setError('获取快手登录状态失败，请稍后重试')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [enabled])

  const pollQrLogin = useCallback(async (payload: KuaishouQrCodePayload) => {
    try {
      const response = await api.get('/kuaishou/auth/qrcode/poll', {
        params: {
          qrLoginToken: payload.qrLoginToken,
          qrLoginSignature: payload.qrLoginSignature,
        },
        timeout: 30000,
      })
      const result = response.data?.data as KuaishouQrPollPayload | undefined
      if (!result) {
        throw new Error('快手二维码轮询返回为空')
      }

      if (result.status === 'pending' || result.status === 'scanned') {
        setMessage(
          result.message ||
            (result.status === 'scanned'
              ? '已扫码，请在快手 App 上确认登录'
              : '请使用快手 App 扫码并确认登录'),
        )
        pollTimerRef.current = window.setTimeout(() => {
          void pollQrLogin(payload)
        }, 2000)
        return
      }

      stopPolling()

      if (result.status === 'confirmed') {
        setQrCode(null)
        setError('')
        setMessage(result.message || '登录成功，快手 Cookie 已保存')
        await fetchStatus()
        await onAuthHealthRefresh?.(true)
        return
      }

      setQrCode(null)
      setMessage('')
      setError(result.message || '快手二维码已失效，请重新生成')
    } catch (err) {
      stopPolling()
      console.error('轮询快手二维码失败:', err)
      setQrCode(null)
      setError('快手二维码轮询失败，请重试')
    }
  }, [fetchStatus, onAuthHealthRefresh, stopPolling])

  const generateQr = useCallback(async () => {
    try {
      stopPolling()
      setIsSubmitting(true)
      setMessage('')
      setError('')

      const response = await api.post('/kuaishou/auth/qrcode')
      if (!response.data?.success) {
        throw new Error('快手二维码生成失败')
      }

      const payload = response.data.data as KuaishouQrCodePayload
      setQrCode(payload)
      setMessage('请使用快手 App 扫码并确认登录')
      void pollQrLogin(payload)
    } catch (err) {
      console.error('生成快手二维码失败:', err)
      setQrCode(null)
      setError('生成快手二维码失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }, [pollQrLogin, stopPolling])

  const saveCookie = useCallback(async () => {
    const cookie = cookieInput.trim()
    if (!cookie) {
      setMessage('')
      setError('请输入快手 Cookie 后再保存')
      return
    }

    try {
      stopPolling()
      setIsSubmitting(true)
      setMessage('')
      setError('')

      await api.post('/kuaishou/auth/session', { cookie })
      setCookieInput('')
      setMessage('快手 Cookie 已保存，后续解析将优先使用该登录态')
      await fetchStatus()
      await onAuthHealthRefresh?.(true)
    } catch (err) {
      console.error('保存快手 Cookie 失败:', err)
      setError('保存失败，请确认 Cookie 格式后重试')
    } finally {
      setIsSubmitting(false)
    }
  }, [cookieInput, fetchStatus, onAuthHealthRefresh, stopPolling])

  const clearSession = useCallback(async () => {
    try {
      stopPolling()
      setIsSubmitting(true)
      setMessage('')
      setError('')

      await api.delete('/kuaishou/auth/session')
      setQrCode(null)
      setMessage('快手登录态已清空')
      await fetchStatus()
      await onAuthHealthRefresh?.(true)
    } catch (err) {
      console.error('清空快手登录态失败:', err)
      setError('清空失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }, [fetchStatus, onAuthHealthRefresh, stopPolling])

  useEffect(() => {
    void fetchStatus()
    return () => {
      stopPolling()
    }
  }, [fetchStatus, stopPolling])

  const sourceLabel = useMemo(() => {
    return getKuaishouSourceLabel(status?.source)
  }, [status?.source])

  return {
    status,
    qrCode,
    cookieInput,
    setCookieInput,
    message,
    error,
    isLoadingStatus,
    isSubmitting,
    sourceLabel,
    fetchStatus,
    generateQr,
    saveCookie,
    clearSession,
  }
}
