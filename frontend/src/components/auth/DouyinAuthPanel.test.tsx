import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DouyinAuthPanel from './DouyinAuthPanel'

describe('DouyinAuthPanel', () => {
  it('keeps manual cookie fallback collapsed by default while highlighting companion bridge login', () => {
    const html = renderToStaticMarkup(
      <DouyinAuthPanel
        status={{
          hasCookie: false,
          source: 'none',
          lastError: null,
          lastCheckAt: null,
          updatedAt: null,
          cookiePreview: null,
        }}
        isLoadingStatus={false}
        sourceLabel="未配置"
        message=""
        error=""
        isSubmitting={false}
        cookieInput=""
        bridgeStatus={null}
        bridgeMessage=""
        bridgeError=""
        bridgeHelperAvailability={{
          isChecked: true,
          isChecking: false,
          isAvailable: false,
          message: '未检测到本机登录助手，请先安装并启动 V-SAVE Companion',
        }}
        isStartingBridge={false}
        onCookieInputChange={() => {}}
        onStartBridgeLogin={() => {}}
        onSaveCookie={() => {}}
        onClearSession={() => {}}
      />,
    )

    expect(html).toContain('扫码登录抖音')
    expect(html).toContain('未检测到本机登录助手')
    expect(html).not.toContain('请使用抖音 App 扫码并确认登录')
    expect(html).toContain('高级兜底：手动粘贴抖音 Cookie')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('保存 Cookie')
  })

  it('renders a bridge-success state while preserving the shared status summary', () => {
    const html = renderToStaticMarkup(
      <DouyinAuthPanel
        status={{
          hasCookie: true,
          source: 'database',
          lastError: null,
          lastCheckAt: '2026-03-23T12:00:00.000Z',
          updatedAt: '2026-03-23T12:00:00.000Z',
          cookiePreview: 'sessionid=abcd...',
        }}
        isLoadingStatus={false}
        sourceLabel="数据库（扫码或手动维护）"
        message=""
        error=""
        isSubmitting={false}
        cookieInput=""
        bridgeStatus={{
          authSessionId: 'bridge-1',
          status: 'confirmed',
          expiresAt: '2026-03-23T16:00:00.000Z',
          completedAt: '2026-03-23T16:01:00.000Z',
          lastError: null,
        }}
        bridgeMessage="登录成功，抖音 Cookie 已保存"
        bridgeError=""
        bridgeHelperAvailability={{
          isChecked: true,
          isChecking: false,
          isAvailable: true,
          message: '已检测到本机登录助手',
        }}
        isStartingBridge={false}
        onCookieInputChange={() => {}}
        onStartBridgeLogin={() => {}}
        onSaveCookie={() => {}}
        onClearSession={() => {}}
      />,
    )

    expect(html).toContain('登录成功，抖音 Cookie 已保存')
    expect(html).toContain('扫码登录抖音')
    expect(html).toContain('数据库（扫码或手动维护）')
    expect(html).toContain('sessionid=abcd...')
  })

})
