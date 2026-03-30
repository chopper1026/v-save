import { Download, Check, AlertCircle, Loader2 } from 'lucide-react'

interface DownloadButtonProps {
  onDownload: () => void
  isLoading?: boolean
  progress?: number
  status?: 'idle' | 'downloading' | 'success' | 'error'
  disabled?: boolean
  idleLabel?: string
}

export default function DownloadButton({
  onDownload,
  isLoading = false,
  progress = 0,
  status = 'idle',
  disabled = false,
  idleLabel = '开始下载',
}: DownloadButtonProps) {
  const isDisabled = disabled || isLoading || status === 'downloading'

  const getButtonContent = () => {
    switch (status) {
      case 'downloading':
        return (
          <div className="flex flex-col items-center gap-1">
            <span>下载中 {Math.round(progress)}%</span>
            <div className="w-36 h-1.5 bg-white/35 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )
      case 'success':
        return (
          <span className="flex items-center gap-2">
            <Check className="w-5 h-5" />
            下载完成
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            下载失败，点击重试
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            {idleLabel}
          </span>
        )
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto mt-6">
      <button
        onClick={onDownload}
        disabled={isDisabled && status !== 'error'}
        className={`
          w-full h-14 rounded-2xl font-semibold text-white transition-all
          flex items-center justify-center
          ${status === 'success'
            ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_10px_24px_rgba(16,185,129,0.35)]'
            : status === 'error'
              ? 'bg-rose-500 hover:bg-rose-600 shadow-[0_10px_24px_rgba(244,63,94,0.3)]'
              : isDisabled
                ? 'bg-sky-500/70 cursor-wait'
                : 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-[0_14px_30px_rgba(37,99,235,0.33)]'}
        `}
      >
        {isLoading && status !== 'downloading' ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            处理中...
          </span>
        ) : (
          getButtonContent()
        )}
      </button>
    </div>
  )
}
