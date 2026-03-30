import {
  FEATURE_LABELS,
  formatLatency,
  type RuntimeFeature,
  type RuntimeSummaryMap,
} from '../../lib/runtime-monitor'

interface RuntimeBreakdownCardProps {
  title: string
  description: string
  rows: Array<{
    id: string
    label: string
    hint?: string
    features: RuntimeSummaryMap
  }>
}

const FEATURE_ORDER: RuntimeFeature[] = ['parse', 'preview', 'download']

export default function RuntimeBreakdownCard({
  title,
  description,
  rows,
}: RuntimeBreakdownCardProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="hidden min-[880px]:grid grid-cols-3 gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {FEATURE_ORDER.map((feature) => (
            <span key={feature}>{FEATURE_LABELS[feature]}</span>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3"
          >
            <div className="flex flex-col gap-3 min-[880px]:flex-row min-[880px]:items-center min-[880px]:justify-between">
              <div className="min-[880px]:w-40">
                <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                <p className="mt-1 text-xs text-slate-500">{row.hint || '按当前时间窗口实时聚合'}</p>
              </div>
              <div className="grid flex-1 gap-2 min-[880px]:grid-cols-3">
                {FEATURE_ORDER.map((feature) => {
                  const metrics = row.features[feature]
                  const percent = Math.max(0, Math.min(100, metrics.successRate || 0))

                  return (
                    <div key={feature} className="rounded-xl border border-white bg-white px-3 py-2 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">{FEATURE_LABELS[feature]}</span>
                        <span className="text-sm font-bold text-slate-900">{metrics.total}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-slate-900 via-sky-500 to-emerald-400"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{metrics.successRate.toFixed(1)}%</span>
                        <span>P95 {formatLatency(metrics.p95LatencyMs)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
