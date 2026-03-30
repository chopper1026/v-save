import type { ReactNode } from 'react'
import type { AuthInfoItem } from './auth-management-shared'

interface AuthManagementPanelProps {
  title: string
  description: string
  statusLabel: string
  statusTone: 'active' | 'idle'
  infoItems: AuthInfoItem[]
  actions: ReactNode
  message?: string
  error?: string
  lastError?: string | null
  qrCard?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export default function AuthManagementPanel({
  title,
  description,
  statusLabel,
  statusTone,
  infoItems,
  actions,
  message,
  error,
  lastError,
  qrCard,
  footer,
  children,
}: AuthManagementPanelProps) {
  const statusClassName = statusTone === 'active'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div className="mt-5 p-4 rounded-2xl border border-gray-100 bg-gray-50/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-semibold text-text-primary">{title}</h4>
          <p className="text-sm text-text-secondary mt-1">{description}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusClassName}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        {infoItems.map((item) => (
          <div
            key={item.label}
            className={`px-4 py-3 rounded-xl bg-white border border-gray-100 ${
              item.wide ? 'md:col-span-2' : ''
            }`}
          >
            <p className="text-text-secondary">{item.label}</p>
            <div className="text-text-primary font-medium mt-1 break-all">{item.value}</div>
          </div>
        ))}
      </div>

      {children}

      <div className="mt-4 flex flex-wrap gap-3">
        {actions}
      </div>

      {qrCard}

      {message && (
        <p className="mt-4 text-sm text-emerald-600">{message}</p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}
      {lastError && !error && (
        <p className="mt-2 text-sm text-red-500">最近异常：{lastError}</p>
      )}

      {footer && (
        <div className="text-xs text-text-secondary mt-4">
          {footer}
        </div>
      )}
    </div>
  )
}
