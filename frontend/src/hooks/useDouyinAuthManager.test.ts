// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDouyinAuthManager } from './useDouyinAuthManager'

const { apiDelete, apiGet, apiPost, useDouyinBridgeAuthMock } = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  useDouyinBridgeAuthMock: vi.fn(),
}))

let latestOnBridgeConfirmed: (() => Promise<void>) | undefined

const bridgeAuthMock = {
  helperAvailability: {
    isChecked: true,
    isChecking: false,
    isAvailable: true,
    message: '已检测到本机登录助手',
  },
  bridgeSession: null,
  bridgeStatus: null,
  message: '',
  error: '',
  isStarting: false,
  startBridgeLogin: vi.fn(),
  resetBridgeState: vi.fn(),
}

vi.mock('../lib/api', () => ({
  api: {
    delete: apiDelete,
    get: apiGet,
    post: apiPost,
  },
}))

vi.mock('./useDouyinBridgeAuth', () => ({
  useDouyinBridgeAuth: useDouyinBridgeAuthMock,
}))

describe('useDouyinAuthManager', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiDelete.mockReset()
    bridgeAuthMock.startBridgeLogin.mockReset()
    bridgeAuthMock.resetBridgeState.mockReset()
    latestOnBridgeConfirmed = undefined
    useDouyinBridgeAuthMock.mockReset()
    useDouyinBridgeAuthMock.mockImplementation(({ onBridgeConfirmed }) => {
      latestOnBridgeConfirmed = onBridgeConfirmed
      return bridgeAuthMock
    })
    apiGet.mockResolvedValue({
      data: {
        success: true,
        data: {
          hasCookie: false,
          source: 'none',
          lastError: null,
          lastCheckAt: null,
          updatedAt: null,
          cookiePreview: null,
        },
      },
    })
  })

  it('exposes bridge login and manual cookie actions only, without legacy qrcode helpers', async () => {
    const { result } = renderHook(() =>
      useDouyinAuthManager({
        enabled: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.status?.source).toBe('none')
    })

    expect(result.current.startBridgeLogin).toBe(bridgeAuthMock.startBridgeLogin)
    expect(result.current.saveCookie).toBeTypeOf('function')
    expect(result.current.clearSession).toBeTypeOf('function')
    expect('qrCode' in result.current).toBe(false)
    expect('verification' in result.current).toBe(false)
    expect('generateQrCode' in result.current).toBe(false)
    expect('sendSmsCode' in result.current).toBe(false)
    expect('verifySmsCode' in result.current).toBe(false)
  })

  it('refreshes Douyin status when bridge auth reports success', async () => {
    apiGet
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            hasCookie: false,
            source: 'none',
            lastError: null,
            lastCheckAt: null,
            updatedAt: null,
            cookiePreview: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            hasCookie: true,
            source: 'database',
            lastError: null,
            lastCheckAt: '2026-03-24T01:00:00.000Z',
            updatedAt: '2026-03-24T01:00:00.000Z',
            cookiePreview: 'sessionid=abcd...',
          },
        },
      })

    const onAuthHealthRefresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDouyinAuthManager({
        enabled: true,
        onAuthHealthRefresh,
      }),
    )

    await waitFor(() => {
      expect(result.current.status?.source).toBe('none')
    })

    await act(async () => {
      await latestOnBridgeConfirmed?.()
    })

    await waitFor(() => {
      expect(result.current.status?.source).toBe('database')
    })

    expect(apiGet).toHaveBeenLastCalledWith(
      '/douyin/auth/status',
      expect.objectContaining({
        params: expect.objectContaining({
          _ts: expect.any(Number),
        }),
      }),
    )
    expect(onAuthHealthRefresh).toHaveBeenCalledWith(true)
  })

  it('clears stale bridge feedback before manual cookie save', async () => {
    apiPost.mockResolvedValueOnce({ data: { success: true } })

    const { result } = renderHook(() =>
      useDouyinAuthManager({
        enabled: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.status?.source).toBe('none')
    })

    act(() => {
      result.current.setCookieInput('sessionid=abc')
    })

    await act(async () => {
      await result.current.saveCookie()
    })

    expect(bridgeAuthMock.resetBridgeState).toHaveBeenCalledTimes(1)
  })
})
