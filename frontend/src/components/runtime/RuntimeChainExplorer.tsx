import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  CLIENT_LABELS,
  PLATFORM_LABELS,
  formatLatency,
  type RuntimeChainDetail,
  type RuntimeChainDetailStep,
  type RuntimeChainListItem,
  type RuntimePlatform,
} from '../../lib/runtime-monitor'
import RuntimeSectionShell from './RuntimeSectionShell'

interface RuntimeChainExplorerProps {
  chains: RuntimeChainListItem[]
  loading: boolean
  error: string
  platform: RuntimePlatform
  collapsed: boolean
  onToggleCollapsed: () => void
  onPlatformChange: (platform: RuntimePlatform) => void
  detail: RuntimeChainDetail | null
  detailLoading: boolean
  detailOpen: boolean
  onOpenDetail: (traceId: string) => void
  onCloseDetail: () => void
}

const CHAIN_PLATFORMS: RuntimePlatform[] = ['douyin', 'bilibili', 'xiaohongshu', 'kuaishou', 'youtube']

const formatDateTime = (value: string) => {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const sortStageSteps = (steps: RuntimeChainDetailStep[]) => {
  return [...steps].sort((left, right) => {
    const sourceGap = (left.source === 'client' ? 0 : 1) - (right.source === 'client' ? 0 : 1)
    if (sourceGap !== 0) {
      return sourceGap
    }
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })
}

export default function RuntimeChainExplorer({
  chains,
  loading,
  error,
  platform,
  collapsed,
  onToggleCollapsed,
  onPlatformChange,
  detail,
  detailLoading,
  detailOpen,
  onOpenDetail,
  onCloseDetail,
}: RuntimeChainExplorerProps) {
  return (
    <>
      <RuntimeSectionShell
        title="平台全链路接口耗时"
        description="按平台查看单条链路接口时序，支持钻取解析 / 预览 / 下载各阶段。"
        badge="按 trace 聚合"
        actions={(
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex items-center gap-1.5 border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            {collapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                展开
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                收起
              </>
            )}
          </button>
        )}
      >
        {!collapsed && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CHAIN_PLATFORMS.map((item) => {
              const active = platform === item
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPlatformChange(item)}
                  className={`border px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {PLATFORM_LABELS[item]}
                </button>
              )
            })}
          </div>

          {error && (
            <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="divide-y divide-slate-200 border border-slate-200">
            {loading && (
              <div className="px-4 py-5 text-sm text-slate-500">链路数据加载中...</div>
            )}

            {!loading && chains.length === 0 && (
              <div className="px-4 py-5 text-sm text-slate-500">当前窗口暂无可钻取链路。</div>
            )}

            {!loading && chains.map((chain) => (
              <button
                key={chain.traceId}
                type="button"
                onClick={() => onOpenDetail(chain.traceId)}
                className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_220px_150px_100px]"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{chain.traceId}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(chain.startedAt)} - {formatDateTime(chain.endedAt)}
                  </p>
                </div>
                <div className="text-xs text-slate-600">
                  <p>端侧：{CLIENT_LABELS[chain.clientType]}</p>
                  <p className="mt-1">端侧总耗时：{formatLatency(chain.clientLatencyMs)}</p>
                  <p className="mt-1">接口总耗时：{formatLatency(chain.interfaceLatencyMs)}</p>
                  <p className="mt-1">
                    解析到预览 ready：{chain.parseToPreviewReadyMs === null ? '--' : formatLatency(chain.parseToPreviewReadyMs)}
                  </p>
                  <p className="mt-1 text-slate-400">链路跨度：{formatLatency(chain.totalDurationMs)}</p>
                </div>
                <div className="text-xs text-slate-600">
                  <p>解析 {chain.stageCounts.parse}</p>
                  <p>预览 {chain.stageCounts.preview}</p>
                  <p>下载 {chain.stageCounts.download}</p>
                </div>
                <div>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold ${chain.hasFailure ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {chain.hasFailure ? '异常' : '稳定'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}
      </RuntimeSectionShell>

      {detailOpen && (
        <div className="fixed inset-x-0 bottom-0 top-[65px] z-[60] !mt-0 flex justify-end bg-slate-900/35" onClick={onCloseDetail}>
          <aside
            className="h-full w-full max-w-[620px] overflow-y-auto border-l border-slate-200 bg-white px-5 pb-5 pt-0 shadow-[-18px_0_48px_rgba(15,23,42,0.14)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 -mx-5 border-b border-slate-200 bg-white px-5 pb-3 pt-0">
              <div>
                <h4 className="text-lg font-bold text-slate-900">链路详情</h4>
                <p className="mt-1 text-xs text-slate-500">按接口查看阶段耗时明细</p>
              </div>
            </div>

            {detailLoading && (
              <div className="py-6 text-sm text-slate-500">正在加载链路详情...</div>
            )}

            {!detailLoading && detail && (
              <div className="space-y-4 pt-4">
                <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p>Trace：{detail.traceId}</p>
                  <p className="mt-1">
                    {PLATFORM_LABELS[detail.platform]} / {CLIENT_LABELS[detail.clientType]}
                  </p>
                  <p className="mt-1">
                    端侧耗时 {formatLatency(detail.clientLatencyMs)} + 接口耗时 {formatLatency(detail.interfaceLatencyMs)} = 合计 {formatLatency(detail.combinedLatencyMs)}
                  </p>
                  <p className="mt-1">
                    解析到预览 ready：{detail.parseToPreviewReadyMs === null ? '--' : formatLatency(detail.parseToPreviewReadyMs)}
                  </p>
                  <p className="mt-1">链路跨度：{formatLatency(detail.totalDurationMs)}</p>
                </div>

                {(['parse', 'preview', 'download'] as const).map((stage) => {
                  const orderedSteps = sortStageSteps(detail.stages[stage])

                  return (
                    <section key={stage} className="border border-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                      <h5 className="text-sm font-semibold text-slate-900">
                        {stage === 'parse' ? '解析阶段' : stage === 'preview' ? '预览阶段' : '下载阶段'}
                      </h5>
                      <span className="text-xs text-slate-500">{orderedSteps.length} 条</span>
                    </div>
                    <div className="divide-y divide-slate-200">
                      {orderedSteps.length === 0 && (
                        <p className="px-3 py-3 text-xs text-slate-500">暂无接口记录</p>
                      )}
                      {orderedSteps.map((step, index) => (
                        <div key={`${stage}-${step.interfaceName}-${index}`} className="px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-slate-900">{step.interfaceName}</span>
                            <span className={step.outcome === 'failure' ? 'text-red-600' : 'text-emerald-600'}>
                              {step.outcome === 'failure' ? '失败' : '成功'}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-600">
                            来源 {step.source === 'client' ? '端侧' : '接口'}
                          </p>
                          <p className="mt-1 text-slate-600">
                            耗时 {formatLatency(step.latencyMs)} / {formatDateTime(step.createdAt)}
                          </p>
                          {step.errorCode && (
                            <p className="mt-1 text-red-600">错误码：{step.errorCode}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    </section>
                  )
                })}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  )
}
