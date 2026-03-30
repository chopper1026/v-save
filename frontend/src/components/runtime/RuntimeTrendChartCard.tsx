import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatLatency } from '../../lib/runtime-monitor'
import RuntimeCollapsibleSection from './RuntimeCollapsibleSection'
import RuntimeMetricLegend, { RUNTIME_SERIES_META } from './RuntimeMetricLegend'
import RuntimeSectionShell from './RuntimeSectionShell'

type RuntimeTrendKey = 'parse' | 'preview' | 'download'
type RuntimeTrendMode = 'successRate' | 'p95LatencyMs'

interface RuntimeTrendChartRow {
  bucketLabel: string
  bucketStart: string
  parse: number
  preview: number
  download: number
}

interface RuntimeTrendChartCardProps {
  title: string
  description: string
  mode: RuntimeTrendMode
  rows: RuntimeTrendChartRow[]
  footer?: ReactNode
  headerActions?: ReactNode
  collapsible?: {
    collapsed: boolean
    onToggleCollapsed: () => void
  }
}

const SERIES_META = RUNTIME_SERIES_META.map((item) => ({
  key: item.key as RuntimeTrendKey,
  label: item.label,
  stroke: item.color,
  fill: item.fill,
}))

const renderTooltipValue = (mode: RuntimeTrendMode, value: number) => {
  if (mode === 'successRate') {
    return `${Number(value || 0).toFixed(1)}%`
  }
  return formatLatency(value)
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return parsed
}

export default function RuntimeTrendChartCard({
  title,
  description,
  mode,
  rows,
  footer,
  headerActions,
  collapsible,
}: RuntimeTrendChartCardProps) {
  const content = (
    <>
      <div className="h-[320px] border border-slate-200 bg-white px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'successRate' ? (
            <AreaChart data={rows} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
              <defs>
                {SERIES_META.map((series) => (
                  <linearGradient
                    key={series.key}
                    id={`runtime-${series.key}-gradient`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={series.fill} stopOpacity={0.55} />
                    <stop offset="95%" stopColor={series.fill} stopOpacity={0.08} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="bucketLabel" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: '#64748b', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                }}
                formatter={(value, name) => [
                  renderTooltipValue(mode, toFiniteNumber(value)),
                  String(name || ''),
                ]}
                labelFormatter={(label, payload) => {
                  const bucketStart = payload?.[0]?.payload?.bucketStart
                  if (!bucketStart) {
                    return label
                  }
                  return `${label} · ${new Date(bucketStart).toLocaleString('zh-CN', { hour12: false })}`
                }}
              />
              {SERIES_META.map((series) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.stroke}
                  strokeWidth={2.4}
                  fill={`url(#runtime-${series.key}-gradient)`}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={rows} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="bucketLabel" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(value) => formatLatency(Number(value))}
                tick={{ fill: '#64748b', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={58}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                }}
                formatter={(value, name) => [
                  renderTooltipValue(mode, toFiniteNumber(value)),
                  String(name || ''),
                ]}
                labelFormatter={(label, payload) => {
                  const bucketStart = payload?.[0]?.payload?.bucketStart
                  if (!bucketStart) {
                    return label
                  }
                  return `${label} · ${new Date(bucketStart).toLocaleString('zh-CN', { hour12: false })}`
                }}
              />
              {SERIES_META.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.stroke}
                  strokeWidth={2.6}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <RuntimeMetricLegend className="mt-3" />
    </>
  )

  const sectionProps = {
    title,
    description,
    badge: mode === 'successRate' ? '单位：成功率' : '单位：毫秒 / 秒',
    actions: headerActions,
    footer,
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

  return (
    <RuntimeSectionShell {...sectionProps}>
      {content}
    </RuntimeSectionShell>
  )
}
