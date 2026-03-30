import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import RuntimeCollapsibleSection from './RuntimeCollapsibleSection'

describe('RuntimeCollapsibleSection', () => {
  it('renders a compact non-wrapping header for collapsed panels', () => {
    const html = renderToStaticMarkup(
      <RuntimeCollapsibleSection
        title="P95 耗时趋势"
        description="重点观察慢请求尾部抖动，识别平均值正常但实际变慢的问题。"
        badge="单位：毫秒 / 秒"
        actions={<button type="button">P95 说明</button>}
        collapsed
        onToggleCollapsed={() => {}}
      >
        <div>chart</div>
      </RuntimeCollapsibleSection>,
    )

    expect(html).toContain('px-4 py-3')
    expect(html).toContain('truncate whitespace-nowrap')
    expect(html).toContain('flex shrink-0 items-center gap-1 whitespace-nowrap')
    expect(html).toContain('inline-flex h-6 shrink-0 items-center gap-1')
    expect(html).toContain('text-xs leading-5 text-slate-500')
  })
})
