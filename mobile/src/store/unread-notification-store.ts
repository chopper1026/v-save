import { create } from 'zustand';

interface UnreadNotificationState {
  count: number;
  setCount: (count: number) => void;
  decrement: (amount?: number) => void;
  reset: () => void;
}

export const useUnreadNotificationStore = create<UnreadNotificationState>((set) => ({
  count: 0,
  setCount: (count) => set({ count: Math.max(0, Number(count) || 0) }),
  decrement: (amount = 1) =>
    set((state) => ({
      count: Math.max(0, state.count - Math.max(1, Number(amount) || 1)),
    })),
  reset: () => set({ count: 0 }),
}));
