interface RuntimeP95ExplainDialogProps {
  open: boolean
  onClose: () => void
}

export default function RuntimeP95ExplainDialog({
  open,
  onClose,
}: RuntimeP95ExplainDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl border border-slate-200 bg-white p-5 shadow-[0_24px_48px_rgba(15,23,42,0.22)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <h4 className="text-lg font-bold text-slate-900">什么是 P95 耗时？</h4>
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600">
          <p>
            P95 表示把同一时间桶内的耗时从小到大排序后，第 95% 位置对应的耗时值。
            它更关注慢请求的尾部抖动，比平均值更容易暴露性能劣化。
          </p>
          <p>
            当前看板按“解析 / 预览 / 下载”三条能力分别统计，每个时间桶内会把该能力上报的
            latency 数据聚合后计算 P95。
          </p>
          <p>
            解读建议：
            {' '}
            当成功率正常但 P95 持续升高，通常意味着部分请求变慢；如果成功率下降且 P95 同时升高，优先排查上游接口超时或登录态异常。
          </p>
        </div>
      </div>
    </div>
  )
}
