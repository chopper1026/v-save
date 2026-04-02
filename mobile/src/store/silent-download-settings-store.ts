import { create } from 'zustand';

interface SilentDownloadSettingsState {
  enabled: boolean;
  hydrated: boolean;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  hydrateFromStorage: (enabled: boolean) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useSilentDownloadSettingsStore = create<SilentDownloadSettingsState>()((set) => ({
  enabled: false,
  hydrated: false,
  setEnabled: (enabled) => set({ enabled }),
  toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
  hydrateFromStorage: (enabled) => set({ enabled }),
  setHydrated: (hydrated) => set({ hydrated }),
}));
