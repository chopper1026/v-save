import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import BilibiliAuthPanel from './auth/BilibiliAuthPanel'
import DouyinAuthPanel from './auth/DouyinAuthPanel'
import {
  type AuthHealthPlatformStatus,
  type BilibiliAuthStatus,
  type BilibiliQrCodePayload,
  formatDateTime,
  getBilibiliSourceLabel,
  getHealthStatusClass,
  getHealthStatusLabel,
} from './auth/auth-management-shared'
import { useDouyinAuthManager } from '../hooks/useDouyinAuthManager'

export default function AdminAuthManagement() {
  const [bilibiliStatus, setBilibiliStatus] = useState<BilibiliAuthStatus | null>(null)
  const [bilibiliQrCode, setBilibiliQrCode] = useState<BilibiliQrCodePayload | null>(null)
  const [bilibiliMessage, setBilibiliMessage] = useState('')
  const [bilibiliError, setBilibiliError] = useState('')
  const [isLoadingBilibiliStatus, setIsLoadingBilibiliStatus] = useState(false)
  const [isSubmittingBilibiliAction, setIsSubmittingBilibiliAction] = useState(false)

  const [authHealth, setAuthHealth] = useState<Record<'bilibili' | 'douyin', AuthHealthPlatformStatus> | null>(null)
  const [isLoadingAuthHealth, setIsLoadingAuthHealth] = useState(false)

  const bilibiliPollTimerRef = useRef<number | null>(null)

  const stopBilibiliQrPolling = useCallback(() => {
    if (bilibiliPollTimerRef.current) {
      window.clearTimeout(bilibiliPollTimerRef.current)
      bilibiliPollTimerRef.current = null
    }
  }, [])

  const fetchBilibiliStatus = useCallback(async (sync = false) => {
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
  }, [])

  const fetchAuthHealth = useCallback(async (sync = false) => {
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
  }, [])

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
  }, [fetchAuthHealth, fetchBilibiliStatus, stopBilibiliQrPolling])

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
    onAuthHealthRefresh: fetchAuthHealth,
  })

  useEffect(() => {
    void fetchBilibiliStatus(false)
    void fetchAuthHealth(true)

    const timer = window.setInterval(() => {
      void fetchAuthHealth(false)
    }, 60000)

    return () => {
      window.clearInterval(timer)
      stopBilibiliQrPolling()
    }
  }, [fetchAuthHealth, fetchBilibiliStatus, stopBilibiliQrPolling])

  const bilibiliSourceLabel = getBilibiliSourceLabel(bilibiliStatus?.source)

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

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">登录态管理</h3>
          <p className="text-sm text-text-secondary mt-1">
            当前已接入 B 站与抖音，可在此统一维护下载所需登录态
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
}
