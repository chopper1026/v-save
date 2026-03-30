import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const TOKEN_STORAGE_KEY = 'token'

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
        localStorage.setItem(TOKEN_STORAGE_KEY, token)
        set({ user, token, isLoggedIn: true })
      },

      setToken: (token: string | null) => {
        if (token) {
          localStorage.setItem(TOKEN_STORAGE_KEY, token)
        } else {
          localStorage.removeItem(TOKEN_STORAGE_KEY)
        }
        set({ token, isLoggedIn: !!token })
      },

      setHydrated: (hydrated: boolean) => {
        set({ isHydrated: hydrated })
      },

      logout: () => {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        set({ user: null, token: null, isLoggedIn: false })
      },

      forceLogout: () => {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        set({ user: null, token: null, isLoggedIn: false })
      },

      updateUser: (data: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        }))
      },
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isLoggedIn: state.isLoggedIn,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return
        }
        if (state.token) {
          localStorage.setItem(TOKEN_STORAGE_KEY, state.token)
        } else {
          localStorage.removeItem(TOKEN_STORAGE_KEY)
        }
        state.setHydrated(true)
      },
    }
  )
)
