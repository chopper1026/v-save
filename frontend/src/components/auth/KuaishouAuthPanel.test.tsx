import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('KuaishouAuthPanel', () => {
  it('renders qrcode-first login flow and keeps manual cookie input collapsed', async () => {
    let KuaishouAuthPanel: any = null

    try {
      KuaishouAuthPanel = (await import('./KuaishouAuthPanel')).default
    } catch (_error) {
      KuaishouAuthPanel = null
    }

    expect(KuaishouAuthPanel).toBeTypeOf('function')
    if (!KuaishouAuthPanel) {
      return
    }

    const html = renderToStaticMarkup(
      <KuaishouAuthPanel
        status={{
          hasCookie: false,
          source: 'none',
          userId: null,
          lastError: null,
          lastCheckAt: null,
          updatedAt: null,
        }}
        isLoadingStatus={false}
        sourceLabel="未配置"
        qrCode={{
          qrLoginToken: 'qr-token-1',
          qrLoginSignature: 'qr-signature-1',
          qrUrl: 'http://qr.kuaishou.com/l/abc123',
          imageDataUrl: 'data:image/png;base64,abc123',
          expireAt: '2026-03-31T12:00:00.000Z',
        }}
        message=""
        error=""
        isSubmitting={false}
        cookieInput=""
        onGenerateQr={() => {}}
        onCookieInputChange={() => {}}
        onSaveCookie={() => {}}
        onClearSession={() => {}}
      />,
    )

    expect(html).toContain('扫码登录快手')
    expect(html).toContain('请使用快手 App 扫码并确认登录')
    expect(html).toContain('高级兜底：手动粘贴快手 Cookie')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('保存 Cookie')
  })
})
