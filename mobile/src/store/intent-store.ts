import { create } from 'zustand';

interface IntentState {
  incomingUrl: string | null;
  shareAutoParsePending: boolean;
  autoParseGuardKey: string | null;
  autoParseGuardAt: number;
  setIncomingUrl: (url: string | null) => void;
  setShareAutoParsePending: (pending: boolean) => void;
  consumeIncomingUrl: () => string | null;
  tryAcquireAutoParse: (key: string, ttlMs?: number) => boolean;
}

export const useIntentStore = create<IntentState>()((set, get) => ({
  incomingUrl: null,
  shareAutoParsePending: false,
  autoParseGuardKey: null,
  autoParseGuardAt: 0,
  setIncomingUrl: (url) =>
    set({
      incomingUrl: url,
      shareAutoParsePending: !!url,
    }),
  setShareAutoParsePending: (pending) => set({ shareAutoParsePending: pending }),
  consumeIncomingUrl: () => {
    const current = get().incomingUrl;
    set({ incomingUrl: null });
    return current;
  },
  tryAcquireAutoParse: (key, ttlMs = 20000) => {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    const now = Date.now();
    const { autoParseGuardKey, autoParseGuardAt } = get();
    if (
      autoParseGuardKey === normalized &&
      now - autoParseGuardAt < Math.max(1000, ttlMs)
    ) {
      return false;
    }

    set({
      autoParseGuardKey: normalized,
      autoParseGuardAt: now,
    });
    return true;
  },
}));
