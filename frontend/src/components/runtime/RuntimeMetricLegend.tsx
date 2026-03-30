export interface RuntimeSeriesMeta {
  key: 'parse' | 'preview' | 'download'
  label: string
  color: string
  fill: string
}

export const RUNTIME_SERIES_META: RuntimeSeriesMeta[] = [
  { key: 'parse', label: '解析', color: '#2563eb', fill: '#bfdbfe' },
  { key: 'preview', label: '预览', color: '#0f766e', fill: '#99f6e4' },
  { key: 'download', label: '下载', color: '#c2410c', fill: '#fdba74' },
]

interface RuntimeMetricLegendProps {
  className?: string
}

export default function RuntimeMetricLegend({ className }: RuntimeMetricLegendProps) {
  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs text-slate-600 ${className || ''}`}>
      {RUNTIME_SERIES_META.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          <span className="font-semibold" style={{ color: item.color }}>
            {item.label}
          </span>
        </span>
      ))}
    </div>
  )
}
