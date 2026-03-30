import { create } from 'zustand';

export type ScrollableTabName = 'history' | 'notifications';

interface TabScrollToTopState {
  requests: Record<ScrollableTabName, number>;
  requestScrollToTop: (tab: ScrollableTabName) => void;
}

export const useTabScrollToTopStore = create<TabScrollToTopState>((set) => ({
  requests: {
    history: 0,
    notifications: 0,
  },
  requestScrollToTop: (tab) =>
    set((state) => ({
      requests: {
        ...state.requests,
        [tab]: state.requests[tab] + 1,
      },
    })),
}));

