import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type DouyinBridgeStartPayload,
  type DouyinBridgeStatusPayload,
  getDouyinBridgeStatusMessage,
} from '../components/auth/auth-management-shared'
import { api, getApiOrigin } from '../lib/api'
import {
  LOCAL_COMPANION_BASE_URL,
  useLocalCompanionAvailability,
} from './useLocalCompanionAvailability'

interface UseDouyinBridgeAuthOptions {
  enabled?: boolean
  onBridgeConfirmed?: () => Promise<void>
  pollIntervalMs?: number
}

export const useDouyinBridgeAuth = ({
  enabled = true,
  onBridgeConfirmed,
  pollIntervalMs = 2000,
}: UseDouyinBridgeAuthOptions = {}) => {
  const helperAvailability = useLocalCompanionAvailability({ enabled })
  const [bridgeSession, setBridgeSession] = useState<DouyinBridgeStartPayload | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<DouyinBridgeStatusPayload | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const pollTimerRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetBridgeState = useCallback(() => {
    stopPolling()
    setBridgeSession(null)
    setBridgeStatus(null)
    setMessage('')
    setError('')
  }, [stopPolling])

  const pollBridgeStatus = useCallback(async (authSessionId: string) => {
    try {
      const response = await api.get('/douyin/auth/bridge/status', {
        params: { authSessionId },
      })
      const payload = response.data?.data as DouyinBridgeStatusPayload | undefined
      if (!payload) {
        throw new Error('empty bridge status payload')
      }

      setBridgeStatus(payload)

      if (payload.status === 'confirmed') {
        stopPolling()
        setError('')
        setMessage(getDouyinBridgeStatusMessage(payload))
        await onBridgeConfirmed?.()
        return
      }

      if (payload.status === 'expired' || payload.status === 'failed') {
        stopPolling()
        setMessage('')
        setError(payload.lastError || getDouyinBridgeStatusMessage(payload))
        return
      }

      setMessage(getDouyinBridgeStatusMessage(payload))
      setError('')
      pollTimerRef.current = window.setTimeout(() => {
        void pollBridgeStatus(authSessionId)
      }, pollIntervalMs)
    } catch (err) {
      stopPolling()
      console.error('轮询抖音桥接登录状态失败:', err)
      setMessage('')
      setError('抖音桥接登录状态轮询失败，请稍后重试')
    }
  }, [onBridgeConfirmed, pollIntervalMs, stopPolling])

  const startBridgeLogin = useCallback(async () => {
    try {
      const backendOrigin = getApiOrigin()
      setIsStarting(true)
      setMessage('')
      setError('')
      stopPolling()

      const isAvailable = helperAvailability.isAvailable
        ? true
        : await helperAvailability.refreshAvailability()

      if (!isAvailable) {
        setError(helperAvailability.message)
        return
      }

      const response = await api.post('/douyin/auth/bridge/start')
      const payload = response.data?.data as DouyinBridgeStartPayload | undefined
      if (!response.data?.success || !payload?.authSessionId) {
        throw new Error('invalid bridge start payload')
      }

      const helperResponse = await fetch(`${LOCAL_COMPANION_BASE_URL}/login/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vsave-backend-origin': backendOrigin,
        },
        body: JSON.stringify({
          authSessionId: payload.authSessionId,
          uploadToken: payload.uploadToken,
          expiresAt: payload.expiresAt,
          loginUrl: payload.loginUrl,
          backendOrigin,
        }),
      })

      if (!helperResponse.ok) {
        throw new Error(`helper start failed: ${helperResponse.status}`)
      }

      setBridgeSession(payload)
      const initialStatus: DouyinBridgeStatusPayload = {
        authSessionId: payload.authSessionId,
        status: payload.status,
        expiresAt: payload.expiresAt,
        completedAt: null,
        lastError: null,
      }
      setBridgeStatus(initialStatus)
      setMessage(getDouyinBridgeStatusMessage(initialStatus))
      void pollBridgeStatus(payload.authSessionId)
    } catch (err) {
      console.error('启动抖音桥接登录失败:', err)
      setBridgeSession(null)
      setBridgeStatus(null)
      setMessage('')
      setError('启动本机抖音登录助手失败，请确认助手已启动后重试')
    } finally {
      setIsStarting(false)
    }
  }, [
    helperAvailability.isAvailable,
    helperAvailability.message,
    helperAvailability.refreshAvailability,
    pollBridgeStatus,
    stopPolling,
  ])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  return {
    helperAvailability,
    bridgeSession,
    bridgeStatus,
    message,
    error,
    isStarting,
    startBridgeLogin,
    resetBridgeState,
  }
}
