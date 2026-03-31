// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Register from './Register'

const { navigateMock, storeState, publicSettingsState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  storeState: {
    login: vi.fn(),
    isLoggedIn: false,
    isHydrated: true,
  },
  publicSettingsState: {
    registrationEnabled: true,
    isLoaded: true,
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../store/useUserStore', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(storeState),
}))

vi.mock('../hooks/usePublicSystemSettings', () => ({
  usePublicSystemSettings: () => publicSettingsState,
}))

describe('Register', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    navigateMock.mockReset()
    storeState.login.mockReset()
    storeState.isLoggedIn = false
    storeState.isHydrated = true
    publicSettingsState.registrationEnabled = true
    publicSettingsState.isLoaded = true
  })

  it('redirects to login when registration is disabled', async () => {
    publicSettingsState.registrationEnabled = false

    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true })
    })
  })

  it('renders register form when registration is enabled', () => {
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    )

    expect(screen.getByText('注册账号')).toBeTruthy()
  })
})
