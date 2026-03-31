// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPublicSystemSettingsCache, usePublicSystemSettings } from './usePublicSystemSettings'

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  api: {
    get: apiGetMock,
  },
}))

function PublicSettingsHarness() {
  const { isLoaded, registrationEnabled } = usePublicSystemSettings()

  return (
    <div>
      <span>{isLoaded ? 'loaded' : 'loading'}</span>
      <span>{registrationEnabled ? 'open' : 'closed'}</span>
    </div>
  )
}

describe('usePublicSystemSettings', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    apiGetMock.mockReset()
    resetPublicSystemSettingsCache()
  })

  it('loads registration flag from public system settings endpoint', async () => {
    apiGetMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          registrationEnabled: true,
        },
      },
    })

    render(<PublicSettingsHarness />)

    await waitFor(() => {
      expect(screen.getByText('loaded')).toBeTruthy()
    })
    expect(screen.getByText('open')).toBeTruthy()
  })

  it('falls back to registration closed when public settings request fails', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('network failed'))

    render(<PublicSettingsHarness />)

    await waitFor(() => {
      expect(screen.getByText('loaded')).toBeTruthy()
    })
    expect(screen.getByText('closed')).toBeTruthy()
  })
})
