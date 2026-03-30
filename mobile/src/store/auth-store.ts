import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';
import type { MobileUser } from '@/types/api';

const AUTH_STORAGE_KEY = 'vsave-mobile-auth';

const secureStorage: StateStorage = {
  getItem: async (name) => {
    const value = await SecureStore.getItemAsync(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name) => {
    await SecureStore.deleteItemAsync(name);
  },
};

interface AuthState {
  user: MobileUser | null;
  token: string | null;
  hydrated: boolean;
  login: (user: MobileUser, token: string) => void;
  updateUser: (partial: Partial<MobileUser>) => void;
  logout: () => void;
  forceLogout: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      hydrated: false,
      login: (user, token) => set({ user, token }),
      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),
      logout: () => set({ user: null, token: null }),
      forceLogout: () => set({ user: null, token: null }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
