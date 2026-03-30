import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const TOKEN_STORAGE_KEY = 'token'
const STORE_STORAGE_KEY = 'user-storage'

const clearLegacyAuthStorage = () => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    window.localStorage.removeItem(STORE_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures in restricted browser contexts.
  }
}

const syncSessionToken = (token: string | null) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // Ignore storage sync failures in restricted browser contexts.
  }
}

clearLegacyAuthStorage()

export interface User {
  id: string
  name: string
  email: string
  role?: 'SUPER_ADMIN' | 'USER'
  accountStatus?: 'ACTIVE' | 'DISABLED'
  phone?: string | null
  avatar?: string
  downloadCount?: number
}

interface UserState {
  user: User | null
  token: string | null
  isLoggedIn: boolean
  isHydrated: boolean
  login: (user: User, token: string) => void
  setToken: (token: string | null) => void
  setHydrated: (hydrated: boolean) => void
  logout: () => void
  forceLogout: () => void
  updateUser: (data: Partial<User>) => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoggedIn: false,
      isHydrated: false,

      login: (user: User, token: string) => {
        clearLegacyAuthStorage()
        syncSessionToken(token)
        set({ user, token, isLoggedIn: true })
      },

      setToken: (token: string | null) => {
        clearLegacyAuthStorage()
        syncSessionToken(token)
        set({ token, isLoggedIn: !!token })
      },

      setHydrated: (hydrated: boolean) => {
        set({ isHydrated: hydrated })
      },

      logout: () => {
        clearLegacyAuthStorage()
        syncSessionToken(null)
        set({ user: null, token: null, isLoggedIn: false })
      },

      forceLogout: () => {
        clearLegacyAuthStorage()
        syncSessionToken(null)
        set({ user: null, token: null, isLoggedIn: false })
      },

      updateUser: (data: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        }))
      },
    }),
    {
      name: STORE_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isLoggedIn: state.isLoggedIn,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return
        }
        clearLegacyAuthStorage()
        syncSessionToken(state.token)
        state.setHydrated(true)
      },
    }
  )
)
