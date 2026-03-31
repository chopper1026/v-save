import { QrCode, Trash2 } from 'lucide-react'
import AuthQrCodeCard from '../AuthQrCodeCard'
import AuthManagementPanel from './AuthManagementPanel'
import type {
  KuaishouAuthStatus,
  KuaishouQrCodePayload,
} from './auth-management-shared'
import { formatDateTime } from './auth-management-shared'

interface KuaishouAuthPanelProps {
  status: KuaishouAuthStatus | null
  isLoadingStatus: boolean
  sourceLabel: string
  qrCode: KuaishouQrCodePayload | null
  message: string
  error: string
  isSubmitting: boolean
  cookieInput: string
  onGenerateQr: () => void
  onCookieInputChange: (value: string) => void
  onSaveCookie: () => void
  onClearSession: () => void
}

export default function KuaishouAuthPanel({
  status,
  isLoadingStatus,
  sourceLabel,
  qrCode,
  message,
  error,
  isSubmitting,
  cookieInput,
  onGenerateQr,
  onCookieInputChange,
  onSaveCookie,
  onClearSession,
}: KuaishouAuthPanelProps) {
  return (
    <AuthManagementPanel
      title="快手登录态"
      description="优先使用快手官方二维码登录，手动 Cookie 仅作为高级兜底。"
      statusLabel={isLoadingStatus ? '检查中...' : status?.hasCookie ? '快手已配置' : '快手未配置'}
      statusTone={status?.hasCookie ? 'active' : 'idle'}
      infoItems={[
        { label: '来源', value: sourceLabel },
        { label: '快手用户ID', value: status?.userId || '--' },
        { label: '最近检查时间', value: formatDateTime(status?.lastCheckAt || null) },
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
            扫码登录快手
          </button>
          <button
            type="button"
            onClick={onClearSession}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-500 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-70"
          >
            <Trash2 className="w-4 h-4" />
            清空快手登录态
          </button>
        </>
      )}
      message={message}
      error={error}
      lastError={status?.lastError || null}
      qrCard={qrCode ? (
        <AuthQrCodeCard
          title="请使用快手 App 扫码并确认登录"
          alt="快手登录二维码"
          qrImageUrl={qrCode.imageDataUrl}
          displayUrl={qrCode.qrUrl}
          expireAtLabel={formatDateTime(qrCode.expireAt)}
        />
      ) : null}
      footer="推荐优先使用官方二维码登录；只有在二维码链路异常时，再使用手动 Cookie 覆盖。"
    >
      <details className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white/70 px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-text-primary">
          高级兜底：手动粘贴快手 Cookie
        </summary>
        <p className="mt-2 text-xs text-text-secondary">
          仅在扫码链路异常时使用，保存后会覆盖当前快手登录态。
        </p>
        <label className="block text-sm font-medium text-text-secondary mt-4 mb-2">
          粘贴快手 Cookie（仅管理员维护）
        </label>
        <textarea
          value={cookieInput}
          onChange={(event) => onCookieInputChange(event.target.value)}
          rows={4}
          placeholder="例如：did=...; clientid=3; kpf=PC_WEB; kpn=KUAISHOU_VISION; kuaishou.server.web_st=..."
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
        />
        <div className="mt-3">
          <button
            type="button"
            onClick={onSaveCookie}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-text-primary rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-70"
          >
            保存 Cookie
          </button>
        </div>
      </details>
    </AuthManagementPanel>
  )
}
