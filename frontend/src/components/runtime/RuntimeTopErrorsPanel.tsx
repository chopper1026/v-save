import {
  CLIENT_LABELS,
  FEATURE_LABELS,
  PLATFORM_LABELS,
  type RuntimeTopError,
} from '../../lib/runtime-monitor'
import RuntimeSectionShell from './RuntimeSectionShell'

interface RuntimeTopErrorsPanelProps {
  errors: RuntimeTopError[]
}

export default function RuntimeTopErrorsPanel({
  errors,
}: RuntimeTopErrorsPanelProps) {
  return (
    <RuntimeSectionShell
      title="Top 错误码"
      description="聚合当前时间窗内的主要失败原因，按能力、端侧和平台快速定位。"
      badge={`${errors.length} 项`}
    >
      <div className="space-y-4">
        {errors.length === 0 && (
          <div className="border border-slate-200 bg-slate-50 px-5 py-6 text-sm leading-6 text-slate-500">
            当前时间窗内没有高频错误码。
          </div>
        )}

        {errors.length > 0 && (
          <div className="overflow-hidden border border-slate-200">
            <div className="hidden bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:grid lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4">
              <span>错误项</span>
              <span>次数</span>
              <span>端侧</span>
              <span>平台</span>
            </div>

            <div className="max-h-[520px] divide-y divide-slate-200 overflow-y-auto">
              {errors.map((item) => (
                <article
                  key={`${item.feature}:${item.errorCode}`}
                  className="bg-white px-5 py-4 transition-colors hover:bg-slate-50/70"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                          {FEATURE_LABELS[item.feature]}
                        </span>
                        <code className="min-w-0 break-all bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {item.errorCode}
                        </code>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 lg:block">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 lg:hidden">
                        次数
                      </span>
                      <div className="inline-flex w-fit items-center border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-lg font-black text-slate-900">{item.count}</span>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 lg:hidden">
                        端侧
                      </span>
                      <p className="mt-1 text-sm text-slate-600 lg:mt-0">
                        {item.clientTypes.map((clientType) => CLIENT_LABELS[clientType]).join(' / ')}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 lg:hidden">
                        平台
                      </span>
                      <p className="mt-1 text-sm text-slate-600 lg:mt-0">
                        {item.platforms.map((platform) => PLATFORM_LABELS[platform]).join(' / ')}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </RuntimeSectionShell>
  )
}
