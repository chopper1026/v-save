import { describe, expect, it } from 'vitest'
import { getDouyinBridgeStatusMessage } from './auth-management-shared'

describe('getDouyinBridgeStatusMessage', () => {
  it('returns localized helper guidance for bridge states', () => {
    expect(
      getDouyinBridgeStatusMessage({
        status: 'waiting_scan',
        lastError: null,
      }),
    ).toContain('扫码')

    expect(
      getDouyinBridgeStatusMessage({
        status: 'failed',
        lastError: '本机登录助手同步失败',
      }),
    ).toContain('失败')
  })
})
