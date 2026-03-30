import {
  FEATURE_LABELS,
  type RuntimeDashboardWarning,
} from '../../lib/runtime-monitor'
import RuntimeSectionShell from './RuntimeSectionShell'

interface RuntimeWarningsPanelProps {
  warnings: RuntimeDashboardWarning[]
  onJumpAuth: () => void
}

export default function RuntimeWarningsPanel({
  warnings,
  onJumpAuth,
}: RuntimeWarningsPanelProps) {
  const sortedWarnings = [...warnings].sort((left, right) => {
    const leftWeight = left.severity === 'critical' ? 0 : 1
    const rightWeight = right.severity === 'critical' ? 0 : 1
    return leftWeight - rightWeight
  })

  return (
    <RuntimeSectionShell
      title="异常警告"
      description="按最近 1 小时阈值实时计算，优先展示正在影响可用性的异常。"
      badge={`${warnings.length} 条`}
    >
      <div className="space-y-4">
        {warnings.length === 0 && (
          <div className="border border-emerald-200 bg-emerald-50 px-5 py-6 text-sm leading-6 text-emerald-700">
            当前没有触发中的运行告警，核心链路状态平稳。
          </div>
        )}

        {warnings.length > 0 && (
          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {sortedWarnings.map((warning, index) => {
              const toneClass = warning.severity === 'critical'
                ? 'border-red-200 bg-red-50/70'
                : 'border-amber-200 bg-amber-50/70'
              const sourceLabel = warning.source === 'auth'
                ? '登录态'
                : FEATURE_LABELS[warning.source]

              return (
                <article
                  key={`${warning.source}-${warning.title}-${index}`}
                  className={`border px-5 py-4 ${toneClass}`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          warning.severity === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                        >
                          {warning.severity === 'critical' ? '严重' : '警告'}
                        </span>
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {sourceLabel}
                        </span>
                        <h4 className="text-sm font-semibold text-slate-900">{warning.title}</h4>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{warning.detail}</p>
                    </div>
                    {warning.actionTab === 'auth' && (
                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={onJumpAuth}
                          className="inline-flex items-center border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-900 hover:text-white"
                        >
                          前往登录态管理
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </RuntimeSectionShell>
  )
}
