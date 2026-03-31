// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemSettingsManagement from './SystemSettingsManagement'

const { apiGetMock, apiPutMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPutMock: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: apiGetMock,
    put: apiPutMock,
  },
}))

describe('SystemSettingsManagement', () => {
  beforeEach(() => {
    apiGetMock.mockReset()
    apiPutMock.mockReset()
  })

  it('loads current registration setting and saves changes', async () => {
    apiGetMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          registrationEnabled: false,
        },
      },
    })
    apiPutMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          registrationEnabled: true,
        },
      },
    })

    render(<SystemSettingsManagement />)

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith('/admin/system-settings')
    })

    const checkbox = screen.getByLabelText('开放注册入口') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => {
      expect(apiPutMock).toHaveBeenCalledWith('/admin/system-settings', {
        registrationEnabled: true,
      })
    })
    expect(screen.getByText('设置已保存')).toBeTruthy()
  })
})
