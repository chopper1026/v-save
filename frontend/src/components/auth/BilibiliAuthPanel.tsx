import { QrCode, RefreshCw, Trash2 } from 'lucide-react'
import AuthQrCodeCard from '../AuthQrCodeCard'
import AuthManagementPanel from './AuthManagementPanel'
import type { BilibiliAuthStatus, BilibiliQrCodePayload } from './auth-management-shared'
import { formatDateTime } from './auth-management-shared'

interface BilibiliAuthPanelProps {
  status: BilibiliAuthStatus | null
  isLoadingStatus: boolean
  sourceLabel: string
  qrCode: BilibiliQrCodePayload | null
  message: string
  error: string
  isSubmitting: boolean
  onGenerateQr: () => void
  onRefreshCookie: () => void
  onClearSession: () => void
}

export default function BilibiliAuthPanel({
  status,
  isLoadingStatus,
  sourceLabel,
  qrCode,
  message,
  error,
  isSubmitting,
  onGenerateQr,
  onRefreshCookie,
  onClearSession,
}: BilibiliAuthPanelProps) {
  return (
    <AuthManagementPanel
      title="B 站登录态"
      description="扫码一次即可自动维护 Cookie，减少手工复制粘贴"
      statusLabel={isLoadingStatus ? '检查中...' : status?.hasCookie ? 'B站已登录' : 'B站未登录'}
      statusTone={status?.hasCookie ? 'active' : 'idle'}
      infoItems={[
        { label: '来源', value: sourceLabel },
        { label: 'B站用户ID', value: status?.userId || '--' },
        { label: '最近检查时间', value: formatDateTime(status?.lastCheckAt || null) },
        { label: '最近刷新时间', value: formatDateTime(status?.lastRefreshAt || null) },
      ]}
      actions={(
        <>
          <button
            type="button"
            onClick={onGenerateQr}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-70"
          >
            <QrCode className="w-4 h-4" />
            扫码登录 B 站
          </button>
          <button
            type="button"
            onClick={onRefreshCookie}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-text-primary rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-70"
          >
            <RefreshCw className="w-4 h-4" />
            立即检查并刷新
          </button>
          <button
            type="button"
            onClick={onClearSession}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-500 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-70"
          >
            <Trash2 className="w-4 h-4" />
            清空登录态
          </button>
        </>
      )}
      message={message}
      error={error}
      lastError={status?.lastError || null}
      qrCard={qrCode ? (
        <AuthQrCodeCard
          title="请使用 B 站 App 扫码并确认登录"
          alt="B站登录二维码"
          qrValue={qrCode.qrUrl}
          displayUrl={qrCode.qrUrl}
          expireAtLabel={formatDateTime(qrCode.expireAt)}
        />
      ) : null}
      footer="自动刷新依赖 refresh token 与 bili_jct，若账号风控或登录态异常，系统会提示重新扫码。"
    />
  )
}
