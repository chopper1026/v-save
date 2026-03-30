import { Video, Music, Film } from 'lucide-react'

export type FormatType = 'video' | 'audio' | 'merge'
export type QualityType = string

export interface QualityOption {
  value: string
  label: string
}

interface FormatSelectorProps {
  format: FormatType
  quality: QualityType
  qualityLabel?: string
  qualityOptions?: QualityOption[]
  qualityHint?: string | null
  qualityDisabled?: boolean
  availableFormats?: FormatType[]
  onFormatChange: (format: FormatType) => void
  onQualityChange: (quality: QualityType) => void
}

const formatOptions: { value: FormatType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'video', label: '视频', icon: <Video className="w-5 h-5" />, desc: 'MP4 格式' },
  { value: 'audio', label: '音频', icon: <Music className="w-5 h-5" />, desc: '音轨文件（M4A）' },
  { value: 'merge', label: '音视频合并', icon: <Film className="w-5 h-5" />, desc: '优先下载带声音视频' },
]

const defaultVideoQualityOptions: QualityOption[] = [
  { value: '4k', label: '4K' },
  { value: '1080p', label: '1080P' },
  { value: '720p', label: '720P' },
]

export default function FormatSelector({
  format,
  quality,
  qualityLabel = '视频画质',
  qualityOptions = defaultVideoQualityOptions,
  qualityHint = null,
  qualityDisabled = false,
  availableFormats,
  onFormatChange,
  onQualityChange,
}: FormatSelectorProps) {
  const enabledFormats = new Set<FormatType>(
    availableFormats && availableFormats.length > 0
      ? availableFormats
      : ['video', 'audio', 'merge'],
  )
  const visibleFormatOptions = formatOptions.filter((option) => enabledFormats.has(option.value))
  const formatColumns = Math.max(1, visibleFormatOptions.length)

  return (
    <div className="w-full max-w-3xl mx-auto mt-6 space-y-4 rounded-2xl border border-sky-100 bg-white/95 p-4 md:p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
      {/* 格式选择 */}
      <div>
        <label className="block text-sm font-semibold text-slate-600 mb-2">下载格式</label>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${formatColumns}, minmax(0, 1fr))` }}
        >
          {visibleFormatOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onFormatChange(option.value)}
              className={`
                relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all
                ${format === option.value
                  ? 'border-sky-300 bg-sky-50/80 shadow-[0_8px_18px_rgba(14,165,233,0.22)]'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
              `}
            >
              <span className={format === option.value ? 'text-sky-600' : 'text-slate-500'}>
                {option.icon}
              </span>
              <div className="text-center">
                <div
                  className={`font-medium ${
                    format === option.value ? 'text-sky-700' : 'text-slate-800'
                  }`}
                >
                  {option.label}
                </div>
                <div className="text-xs text-slate-500">{option.desc}</div>
              </div>
              {format === option.value && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-sky-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 画质选择 */}
      <div>
        <label className="block text-sm font-semibold text-slate-600 mb-2">{qualityLabel}</label>
        {qualityHint && (
          <div className="mb-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
            {qualityHint}
          </div>
        )}
        {qualityOptions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {qualityOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onQualityChange(option.value)}
                disabled={qualityDisabled}
                className={`
                  min-w-[104px] flex-1 py-2.5 px-4 rounded-xl border font-semibold text-sm transition-all
                  ${quality === option.value
                    ? 'border-sky-500 bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-[0_8px_16px_rgba(37,99,235,0.28)]'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}
                  ${qualityDisabled ? 'cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white' : ''}
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            当前画质列表仍在补全中，完成后会自动刷新。
          </div>
        )}
      </div>
    </div>
  )
}
