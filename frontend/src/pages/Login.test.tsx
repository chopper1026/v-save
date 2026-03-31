// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

const {
  loginMock,
  apiPostMock,
  mapApiUserToStoreUserMock,
  loadRememberedLoginPreferenceMock,
  saveRememberedLoginPreferenceMock,
  clearRememberedLoginPreferenceMock,
  clearLegacyRememberedPasswordMock,
  storeBrowserCredentialMock,
  storeState,
  publicSettingsState,
} = vi.hoisted(() => ({
  loginMock: vi.fn(),
  apiPostMock: vi.fn(),
  mapApiUserToStoreUserMock: vi.fn((user) => user),
  loadRememberedLoginPreferenceMock: vi.fn(),
  saveRememberedLoginPreferenceMock: vi.fn(),
  clearRememberedLoginPreferenceMock: vi.fn(),
  clearLegacyRememberedPasswordMock: vi.fn(),
  storeBrowserCredentialMock: vi.fn(),
  storeState: {
    isLoggedIn: false,
    isHydrated: true,
  },
  publicSettingsState: {
    registrationEnabled: true,
    isLoaded: true,
  },
}))

vi.mock('../store/useUserStore', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      login: loginMock,
      isLoggedIn: storeState.isLoggedIn,
      isHydrated: storeState.isHydrated,
    }),
}))

vi.mock('../lib/api', () => ({
  api: {
    post: apiPostMock,
  },
  mapApiUserToStoreUser: mapApiUserToStoreUserMock,
}))

vi.mock('../lib/remember-password', () => ({
  loadRememberedLoginPreference: loadRememberedLoginPreferenceMock,
  saveRememberedLoginPreference: saveRememberedLoginPreferenceMock,
  clearRememberedLoginPreference: clearRememberedLoginPreferenceMock,
  clearLegacyRememberedPassword: clearLegacyRememberedPasswordMock,
  storeBrowserCredential: storeBrowserCredentialMock,
}))

vi.mock('../hooks/usePublicSystemSettings', () => ({
  usePublicSystemSettings: () => publicSettingsState,
}))

describe('Login', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    loginMock.mockReset()
    apiPostMock.mockReset()
    mapApiUserToStoreUserMock.mockClear()
    loadRememberedLoginPreferenceMock.mockReset()
    saveRememberedLoginPreferenceMock.mockReset()
    clearRememberedLoginPreferenceMock.mockReset()
    clearLegacyRememberedPasswordMock.mockReset()
    storeBrowserCredentialMock.mockReset()
    storeBrowserCredentialMock.mockResolvedValue(undefined)
    loadRememberedLoginPreferenceMock.mockReturnValue({
      rememberPassword: false,
      email: '',
    })
    storeState.isLoggedIn = false
    storeState.isHydrated = true
    publicSettingsState.registrationEnabled = true
    publicSettingsState.isLoaded = true
  })

  it('loads remembered login preference without reading back plaintext passwords', async () => {
    loadRememberedLoginPreferenceMock.mockReturnValue({
      rememberPassword: true,
      email: 'alice@example.com',
    })

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(clearLegacyRememberedPasswordMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText('记住密码')).toBeTruthy()
    expect((screen.getByLabelText('记住密码') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByPlaceholderText('请输入邮箱') as HTMLInputElement).value).toBe('alice@example.com')
    expect((screen.getByPlaceholderText('请输入密码') as HTMLInputElement).value).toBe('')
  })

  it('stores remembered-password preference via browser credential storage instead of localStorage passwords', async () => {
    apiPostMock.mockResolvedValueOnce({
      data: {
        access_token: 'access-token',
        user: {
          id: 'user-1',
          email: 'alice@example.com',
          nickname: 'Alice',
        },
      },
    })

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getAllByPlaceholderText('请输入邮箱')[0], {
      target: { value: 'alice@example.com' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('请输入密码')[0], {
      target: { value: 'Secret123!' },
    })
    fireEvent.click(screen.getByLabelText('记住密码'))
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/auth/login', {
        email: 'alice@example.com',
        password: 'Secret123!',
      })
    })

    expect(saveRememberedLoginPreferenceMock).toHaveBeenCalledWith({
      email: 'alice@example.com',
      rememberPassword: true,
    })
    expect(storeBrowserCredentialMock).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'Secret123!',
    })
    expect(clearRememberedLoginPreferenceMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('remembered-login-credentials')).toBeNull()
  })

  it('hides the register shortcut when registration is disabled', async () => {
    publicSettingsState.registrationEnabled = false

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(clearLegacyRememberedPasswordMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByText('立即注册')).toBeNull()
  })
})
