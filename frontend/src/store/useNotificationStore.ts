import { create } from 'zustand'

interface NotificationStoreState {
  unreadCount: number
  setUnreadCount: (count: number) => void
  decrementUnreadCount: (amount?: number) => void
  resetUnreadCount: () => void
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (count) => set({ unreadCount: Math.max(0, Number(count) || 0) }),
  decrementUnreadCount: (amount = 1) =>
    set((state) => ({
      unreadCount: Math.max(0, state.unreadCount - Math.max(1, Number(amount) || 1)),
    })),
  resetUnreadCount: () => set({ unreadCount: 0 }),
}))
