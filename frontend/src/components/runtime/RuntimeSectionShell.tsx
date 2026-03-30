import type { ReactNode } from 'react'

export interface RuntimeSectionShellProps {
  title: string
  description?: string
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export default function RuntimeSectionShell({
  title,
  description,
  badge,
  actions,
  children,
  footer,
  className,
}: RuntimeSectionShellProps) {
  return (
    <section className={`border border-slate-200 bg-white ${className || ''}`}>
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          {badge && <div className="text-xs font-medium text-slate-500">{badge}</div>}
        </div>
      </div>

      <div className="px-5 py-4">{children}</div>

      {footer && (
        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </section>
  )
}
