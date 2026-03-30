import { formatLatency, formatPercent, type RuntimeFeatureMetrics } from '../../lib/runtime-monitor'

interface RuntimeSummaryCardProps {
  title: string
  description: string
  metrics: RuntimeFeatureMetrics
  tone: 'sky' | 'emerald' | 'amber' | 'slate'
  footer?: string
}

const TONE_CLASS_MAP: Record<RuntimeSummaryCardProps['tone'], string> = {
  sky: 'from-sky-100 via-white to-sky-50 border-sky-200/80',
  emerald: 'from-emerald-100 via-white to-emerald-50 border-emerald-200/80',
  amber: 'from-amber-100 via-white to-amber-50 border-amber-200/80',
  slate: 'from-slate-100 via-white to-slate-50 border-slate-200/80',
}

export default function RuntimeSummaryCard({
  title,
  description,
  metrics,
  tone,
  footer,
}: RuntimeSummaryCardProps) {
  const successPercent = Math.max(0, Math.min(100, metrics.successRate || 0))

  return (
    <article className={`rounded-[28px] border bg-gradient-to-br ${TONE_CLASS_MAP[tone]} p-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)]`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <h3 className="mt-2 text-3xl font-black text-slate-900">{formatPercent(metrics.successRate)}</h3>
        </div>
        <div className="min-w-[96px] rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 text-right shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">总样本</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{metrics.total}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-7 text-slate-600">{description}</p>

      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/80">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate-900 via-sky-500 to-emerald-400 transition-[width] duration-500"
          style={{ width: `${successPercent}%` }}
        />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-[18px] border border-white/80 bg-white/85 px-4 py-3">
          <p className="text-[11px] text-slate-500">失败数</p>
          <p className="mt-1 font-semibold text-slate-900">{metrics.failureCount}</p>
        </div>
        <div className="rounded-[18px] border border-white/80 bg-white/85 px-4 py-3">
          <p className="text-[11px] text-slate-500">平均耗时</p>
          <p className="mt-1 font-semibold text-slate-900">{formatLatency(metrics.avgLatencyMs)}</p>
        </div>
        <div className="rounded-[18px] border border-white/80 bg-white/85 px-4 py-3">
          <p className="text-[11px] text-slate-500">P95</p>
          <p className="mt-1 font-semibold text-slate-900">{formatLatency(metrics.p95LatencyMs)}</p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-6 text-slate-500">{footer || '系统按当前时间窗口实时聚合最新事件。'}</p>
    </article>
  )
}
