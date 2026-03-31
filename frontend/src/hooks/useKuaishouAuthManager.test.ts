// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKuaishouAuthManager } from './useKuaishouAuthManager'

const { apiDelete, apiGet, apiPost } = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: {
    delete: apiDelete,
    get: apiGet,
    post: apiPost,
  },
}))

describe('useKuaishouAuthManager', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiDelete.mockReset()

    apiGet.mockResolvedValue({
      data: {
        success: true,
        data: {
          hasCookie: false,
          source: 'none',
          userId: null,
          lastError: null,
          lastCheckAt: null,
          updatedAt: null,
        },
      },
    })
  })

  it('uses an extended timeout for kuaishou qrcode polling', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          qrLoginToken: 'qr-token-1',
          qrLoginSignature: 'qr-signature-1',
          qrUrl: 'http://qr.kuaishou.com/l/abc123',
          imageDataUrl: 'data:image/png;base64,abc123',
          expireAt: '2026-03-31T12:00:00.000Z',
        },
      },
    })

    apiGet
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            hasCookie: false,
            source: 'none',
            userId: null,
            lastError: null,
            lastCheckAt: null,
            updatedAt: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            status: 'expired',
            message: '二维码已过期',
          },
        },
      })

    const { result } = renderHook(() =>
      useKuaishouAuthManager({
        enabled: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.status?.source).toBe('none')
    })

    await act(async () => {
      await result.current.generateQr()
    })

    expect(apiGet).toHaveBeenCalledWith(
      '/kuaishou/auth/qrcode/poll',
      expect.objectContaining({
        params: {
          qrLoginToken: 'qr-token-1',
          qrLoginSignature: 'qr-signature-1',
        },
        timeout: 30000,
      }),
    )
  })
})
