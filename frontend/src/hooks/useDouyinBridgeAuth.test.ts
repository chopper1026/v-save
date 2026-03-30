// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDouyinBridgeAuth } from './useDouyinBridgeAuth'

const { apiGet, apiPost, getApiOrigin } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getApiOrigin: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: apiGet,
    post: apiPost,
  },
  getApiOrigin,
}))

describe('useDouyinBridgeAuth', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    getApiOrigin.mockReset()
    getApiOrigin.mockReturnValue('http://localhost:3001')
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns local helper guidance when the companion app is offline', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('offline'))

    const { result } = renderHook(() =>
      useDouyinBridgeAuth({
        enabled: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.helperAvailability.isChecked).toBe(true)
    })

    expect(result.current.helperAvailability.isAvailable).toBe(false)
    expect(result.current.helperAvailability.message).toContain('未检测到本机登录助手')
  })

  it('starts bridge auth, notifies the local helper, and polls backend status until confirmed', async () => {
    const onBridgeConfirmed = vi.fn().mockResolvedValue(undefined)

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    apiPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          authSessionId: 'bridge-1',
          uploadToken: 'upload-token',
          expiresAt: '2026-03-24T00:00:00.000Z',
          loginUrl: 'https://www.douyin.com/',
          status: 'waiting_helper',
        },
      },
    })

    apiGet
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            authSessionId: 'bridge-1',
            status: 'waiting_helper',
            expiresAt: '2026-03-24T00:00:00.000Z',
            completedAt: null,
            lastError: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            authSessionId: 'bridge-1',
            status: 'confirmed',
            expiresAt: '2026-03-24T00:00:00.000Z',
            completedAt: '2026-03-23T20:00:00.000Z',
            lastError: null,
          },
        },
      })

    const { result } = renderHook(() =>
      useDouyinBridgeAuth({
        enabled: true,
        onBridgeConfirmed,
        pollIntervalMs: 1,
      }),
    )

    await waitFor(() => {
      expect(result.current.helperAvailability.isAvailable).toBe(true)
    })

    await act(async () => {
      await result.current.startBridgeLogin()
    })

    expect(apiPost).toHaveBeenCalledWith('/douyin/auth/bridge/start')
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:37219/login/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-vsave-backend-origin': 'http://localhost:3001',
        }),
        body: JSON.stringify({
          authSessionId: 'bridge-1',
          uploadToken: 'upload-token',
          expiresAt: '2026-03-24T00:00:00.000Z',
          loginUrl: 'https://www.douyin.com/',
          backendOrigin: 'http://localhost:3001',
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.bridgeStatus?.status).toBe('confirmed')
    })

    expect(onBridgeConfirmed).toHaveBeenCalledTimes(1)
    expect(result.current.message).toContain('登录成功')
  })

  it('surfaces backend error state when bridge auth expires or fails', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    apiPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          authSessionId: 'bridge-2',
          uploadToken: 'upload-token',
          expiresAt: '2026-03-24T00:00:00.000Z',
          loginUrl: 'https://www.douyin.com/',
          status: 'waiting_helper',
        },
      },
    })

    apiGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          authSessionId: 'bridge-2',
          status: 'expired',
          expiresAt: '2026-03-24T00:00:00.000Z',
          completedAt: null,
          lastError: '本机登录助手未在有效时间内完成同步',
        },
      },
    })

    const { result } = renderHook(() =>
      useDouyinBridgeAuth({
        enabled: true,
        pollIntervalMs: 1,
      }),
    )

    await waitFor(() => {
      expect(result.current.helperAvailability.isAvailable).toBe(true)
    })

    await act(async () => {
      await result.current.startBridgeLogin()
    })

    await waitFor(() => {
      expect(result.current.error).toContain('本机登录助手未在有效时间内完成同步')
    })
  })
})
