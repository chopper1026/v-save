// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { useUserStore, type User } from './useUserStore'

const testUser: User = {
  id: 'user-1',
  name: 'Tester',
  email: 'tester@example.com',
  role: 'USER',
  accountStatus: 'ACTIVE',
}

describe('useUserStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useUserStore.persist.clearStorage()
    useUserStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      isHydrated: true,
    })
  })

  it('persists auth state in sessionStorage instead of localStorage', () => {
    localStorage.setItem('token', 'legacy-token')
    localStorage.setItem('user-storage', '{"state":{"token":"legacy-token"}}')

    useUserStore.getState().login(testUser, 'token-1')

    expect(sessionStorage.getItem('token')).toBe('token-1')
    expect(sessionStorage.getItem('user-storage')).toContain('token-1')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('user-storage')).toBeNull()
  })
})
