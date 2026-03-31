// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Header from './Header'

const { storeState, publicSettingsState } = vi.hoisted(() => ({
  storeState: {
    user: null,
    isLoggedIn: false,
    isHydrated: true,
  },
  publicSettingsState: {
    registrationEnabled: true,
    isLoaded: true,
  },
}))

vi.mock('../store/useUserStore', () => ({
  useUserStore: () => storeState,
}))

vi.mock('../hooks/usePublicSystemSettings', () => ({
  usePublicSystemSettings: () => publicSettingsState,
}))

vi.mock('../hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () => 0,
}))

describe('Header', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    storeState.user = null
    storeState.isLoggedIn = false
    storeState.isHydrated = true
    publicSettingsState.registrationEnabled = true
    publicSettingsState.isLoaded = true
  })

  it('shows register entry when registration is enabled', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '注册' })).toBeTruthy()
  })

  it('hides register entry when registration is disabled', () => {
    publicSettingsState.registrationEnabled = false

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: '注册' })).toBeNull()
  })
})
