import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import RuntimeCollapsibleSection from './RuntimeCollapsibleSection'
import RuntimeMetricLegend, { RUNTIME_SERIES_META } from './RuntimeMetricLegend'
import RuntimeSectionShell from './RuntimeSectionShell'

interface RuntimeGroupedBarChartRow {
  label: string
  parse: number
  preview: number
  download: number
  parseTotal: number
  previewTotal: number
  downloadTotal: number
}

interface RuntimeGroupedBarChartCardProps {
  title: string
  description: string
  rows: RuntimeGroupedBarChartRow[]
  horizontal?: boolean
  collapsible?: {
    collapsed: boolean
    onToggleCollapsed: () => void
  }
}

const BAR_COLORS = RUNTIME_SERIES_META.reduce((acc, item) => {
  acc[item.key] = item.color
  return acc
}, {} as Record<'parse' | 'preview' | 'download', string>)

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return parsed
}

export default function RuntimeGroupedBarChartCard({
  title,
  description,
  rows,
  horizontal = false,
  collapsible,
}: RuntimeGroupedBarChartCardProps) {
  const chartRows = rows.length > 0
    ? rows
    : [
        {
          label: '暂无数据',
          parse: 0,
          preview: 0,
          download: 0,
          parseTotal: 0,
          previewTotal: 0,
          downloadTotal: 0,
        },
      ]

  const content = (
    <>
      <div className="h-[320px] border border-slate-200 bg-white px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartRows}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 12, right: 20, left: horizontal ? 24 : 0, bottom: 0 }}
            barGap={8}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={!horizontal} horizontal={horizontal} />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fill: '#475569', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={78}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#475569', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
              </>
            )}
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
              }}
              formatter={(value, name, entry) => {
                const totalKey =
                  entry?.dataKey === 'parse'
                    ? 'parseTotal'
                    : entry?.dataKey === 'preview'
                      ? 'previewTotal'
                      : 'downloadTotal'
                const total = entry?.payload?.[totalKey] ?? 0
                return [`${toFiniteNumber(value).toFixed(1)}% · 样本 ${total}`, String(name || '')]
              }}
            />
            <Bar dataKey="parse" name="解析" radius={horizontal ? [0, 12, 12, 0] : [12, 12, 0, 0]}>
              {chartRows.map((row) => (
                <Cell key={`parse-${row.label}`} fill={BAR_COLORS.parse} />
              ))}
            </Bar>
            <Bar dataKey="preview" name="预览" radius={horizontal ? [0, 12, 12, 0] : [12, 12, 0, 0]}>
              {chartRows.map((row) => (
                <Cell key={`preview-${row.label}`} fill={BAR_COLORS.preview} />
              ))}
            </Bar>
            <Bar dataKey="download" name="下载" radius={horizontal ? [0, 12, 12, 0] : [12, 12, 0, 0]}>
              {chartRows.map((row) => (
                <Cell key={`download-${row.label}`} fill={BAR_COLORS.download} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <RuntimeMetricLegend className="mt-3" />
    </>
  )

  const sectionProps = {
    title,
    description,
    badge: '成功率对比',
  }

  if (collapsible) {
    return (
      <RuntimeCollapsibleSection
        {...sectionProps}
        collapsed={collapsible.collapsed}
        onToggleCollapsed={collapsible.onToggleCollapsed}
      >
        {content}
      </RuntimeCollapsibleSection>
    )
  }

  return <RuntimeSectionShell {...sectionProps}>{content}</RuntimeSectionShell>
}
