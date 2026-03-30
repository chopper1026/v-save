import { QrCode, Trash2 } from 'lucide-react'
import AuthManagementPanel from './AuthManagementPanel'
import type {
  DouyinAuthStatus,
  DouyinBridgeStatusPayload,
} from './auth-management-shared'
import { formatDateTime } from './auth-management-shared'

interface BridgeHelperAvailability {
  isChecked: boolean
  isChecking: boolean
  isAvailable: boolean
  message: string
}

interface DouyinAuthPanelProps {
  status: DouyinAuthStatus | null
  isLoadingStatus: boolean
  sourceLabel: string
  message: string
  error: string
  isSubmitting: boolean
  cookieInput: string
  bridgeStatus: DouyinBridgeStatusPayload | null
  bridgeMessage: string
  bridgeError: string
  bridgeHelperAvailability: BridgeHelperAvailability
  isStartingBridge: boolean
  onCookieInputChange: (value: string) => void
  onStartBridgeLogin: () => void
  onSaveCookie: () => void
  onClearSession: () => void
}

export default function DouyinAuthPanel({
  status,
  isLoadingStatus,
  sourceLabel,
  message,
  error,
  isSubmitting,
  cookieInput,
  bridgeStatus,
  bridgeMessage,
  bridgeError,
  bridgeHelperAvailability,
  isStartingBridge,
  onCookieInputChange,
  onStartBridgeLogin,
  onSaveCookie,
  onClearSession,
}: DouyinAuthPanelProps) {
  const helperStatusLabel = bridgeHelperAvailability.isChecking
    ? '检测中'
    : bridgeHelperAvailability.isAvailable
      ? '已连接'
      : '未连接'

  const helperStatusClassName = bridgeHelperAvailability.isAvailable
    ? 'bg-emerald-100 text-emerald-700'
    : bridgeHelperAvailability.isChecking
      ? 'bg-gray-100 text-gray-600'
      : 'bg-amber-100 text-amber-700'

  const bridgePhaseLabel = (() => {
    switch (bridgeStatus?.status) {
      case 'browser_opened':
        return 'Chrome 已启动'
      case 'waiting_scan':
        return '等待扫码'
      case 'scanned':
        return '已扫码，等待确认'
      case 'uploading':
        return '正在同步登录态'
      case 'confirmed':
        return '登录态已保存'
      case 'failed':
        return '同步失败'
      case 'expired':
        return '会话已过期'
      case 'waiting_helper':
        return '等待本机助手响应'
      default:
        return '--'
    }
  })()

  const resolvedMessage = message || bridgeMessage
  const resolvedError = error || bridgeError

  return (
    <AuthManagementPanel
      title="抖音登录态"
      description="网页登录入口保持不变，系统会优先调用本机 V-SAVE Companion 拉起 Chrome 完成抖音扫码登录。"
      statusLabel={isLoadingStatus ? '检查中...' : status?.hasCookie ? '抖音已配置' : '抖音未配置'}
      statusTone={status?.hasCookie ? 'active' : 'idle'}
      infoItems={[
        { label: '来源', value: sourceLabel },
        { label: '最近检查时间', value: formatDateTime(status?.lastCheckAt || null) },
        { label: 'Cookie 摘要', value: status?.cookiePreview || '--', wide: true },
      ]}
      actions={(
        <>
          <button
            type="button"
            onClick={onStartBridgeLogin}
            disabled={isSubmitting || isStartingBridge || bridgeHelperAvailability.isChecking}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-70"
          >
            <QrCode className="w-4 h-4" />
            {isStartingBridge ? '启动本机登录助手中...' : '扫码登录抖音'}
          </button>
          <button
            type="button"
            onClick={onClearSession}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-500 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-70"
          >
            <Trash2 className="w-4 h-4" />
            清空抖音登录态
          </button>
        </>
      )}
      message={resolvedMessage}
      error={resolvedError}
      lastError={status?.lastError || null}
      footer="本机登录助手不可用或扫码链路异常时，可展开高级兜底入口手动覆盖 Cookie。"
    >
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white/80 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h5 className="text-sm font-semibold text-text-primary">本机登录助手</h5>
            <p className="mt-1 text-sm text-text-secondary">
              点击按钮后会在本机 Chrome 中打开抖音官方登录页，手机确认后自动同步共享登录态。
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${helperStatusClassName}`}>
            {helperStatusLabel}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
            <p className="text-text-secondary">助手状态</p>
            <div className="mt-1 break-all font-medium text-text-primary">
              {bridgeHelperAvailability.message || '等待检测本机登录助手'}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
            <p className="text-text-secondary">当前进度</p>
            <div className="mt-1 break-all font-medium text-text-primary">
              {bridgePhaseLabel}
            </div>
          </div>
        </div>
      </div>

      <details className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white/70 px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-text-primary">
          高级兜底：手动粘贴抖音 Cookie
        </summary>
        <p className="mt-2 text-xs text-text-secondary">
          仅在扫码链路异常时使用，保存后会覆盖当前共享登录态。
        </p>
        <label className="block text-sm font-medium text-text-secondary mt-4 mb-2">
          粘贴抖音 Cookie（仅管理员维护）
        </label>
        <textarea
          value={cookieInput}
          onChange={(event) => onCookieInputChange(event.target.value)}
          rows={4}
          placeholder="例如：sessionid=...; ttwid=...; msToken=..."
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
