import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'

interface RuntimeCollapsibleSectionProps {
  title: string
  description?: string
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  collapsed: boolean
  onToggleCollapsed: () => void
  collapsedHint?: string
}

export default function RuntimeCollapsibleSection({
  title,
  description,
  badge,
  actions,
  children,
  footer,
  className,
  collapsed,
  onToggleCollapsed,
  collapsedHint = '当前默认折叠，点击右上角展开查看详情。',
}: RuntimeCollapsibleSectionProps) {
  return (
    <section className={`border border-slate-200 bg-white ${className || ''}`}>
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="space-y-2.5">
          <div>
            <h3 className="text-base font-semibold leading-6 text-slate-900">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{description}</p>
            )}
          </div>

          <div
            className={`flex items-center gap-2 pt-0.5 ${
              badge ? 'justify-between' : 'justify-end'
            }`}
          >
            {badge && (
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="inline-flex max-w-full items-center border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium leading-none text-slate-500">
                  <span className="truncate whitespace-nowrap">{badge}</span>
                </div>
              </div>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
              {actions}
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-expanded={!collapsed}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-slate-200 px-2 text-[10px] font-semibold leading-none text-slate-600 transition-colors hover:bg-slate-100"
              >
                {collapsed ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    展开
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    收起
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {collapsed ? (
        <div className="px-4 py-3">
          <div className="border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
            {collapsedHint}
          </div>
        </div>
      ) : (
        <div className="px-4 py-4">{children}</div>
      )}

      {footer && !collapsed && (
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </section>
  )
}
