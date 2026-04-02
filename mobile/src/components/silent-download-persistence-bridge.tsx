import { useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { shouldPersistSilentDownloadQueueSnapshot } from '@/lib/silent-download-runtime-policy';
import { useSilentDownloadQueueStore } from '@/store/silent-download-queue-store';
import { useSilentDownloadSettingsStore } from '@/store/silent-download-settings-store';
import {
  buildPersistedSilentDownloadQueueState,
  normalizePersistedSilentDownloadQueueState,
} from '@/store/silent-download-persistence-snapshot';

const SETTINGS_STORAGE_KEY = 'vsave-mobile-silent-download-settings';
const QUEUE_STORAGE_KEY = 'vsave-mobile-silent-download-queue';

const readJson = async <T,>(key: string): Promise<T | null> => {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJson = async (key: string, value: unknown) => {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // best effort persistence
  }
};

export function SilentDownloadPersistenceBridge() {
  const settingsHydrated = useSilentDownloadSettingsStore((state) => state.hydrated);
  const queueHydrated = useSilentDownloadQueueStore((state) => state.hydrated);
  const enabled = useSilentDownloadSettingsStore((state) => state.enabled);
  const tasks = useSilentDownloadQueueStore((state) => state.tasks);
  const pausedReason = useSilentDownloadQueueStore((state) => state.pausedReason);
  const pauseMessage = useSilentDownloadQueueStore((state) => state.pauseMessage);
  const hydrateSettings = useSilentDownloadSettingsStore((state) => state.hydrateFromStorage);
  const setSettingsHydrated = useSilentDownloadSettingsStore((state) => state.setHydrated);
  const hydrateQueueState = useSilentDownloadQueueStore((state) => state.hydratePersistenceState);
  const setQueueHydrated = useSilentDownloadQueueStore((state) => state.setHydrated);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueueSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const [settings, queue] = await Promise.all([
        readJson<{ enabled?: boolean }>(SETTINGS_STORAGE_KEY),
        readJson<{
          tasks?: typeof tasks;
          pausedReason?: string | null;
          pauseMessage?: string | null;
        }>(QUEUE_STORAGE_KEY),
      ]);

      if (!active) {
        return;
      }

      const persistedQueueState = normalizePersistedSilentDownloadQueueState(queue);

      hydrateSettings(settings?.enabled === true);
      hydrateQueueState(persistedQueueState);
      lastQueueSnapshotRef.current = JSON.stringify(persistedQueueState);
      setSettingsHydrated(true);
      setQueueHydrated(true);
    };

    void hydrate();

    return () => {
      active = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [hydrateQueueState, hydrateSettings, setQueueHydrated, setSettingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }
    void writeJson(SETTINGS_STORAGE_KEY, { enabled });
  }, [enabled, settingsHydrated]);

  useEffect(() => {
    const persistedQueueState = buildPersistedSilentDownloadQueueState({
      tasks,
      pausedReason,
      pauseMessage,
    });
    const nextSnapshot = JSON.stringify(persistedQueueState);
    if (!shouldPersistSilentDownloadQueueSnapshot({
      queueHydrated,
      previousSnapshot: lastQueueSnapshotRef.current,
      nextSnapshot,
    })) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      lastQueueSnapshotRef.current = nextSnapshot;
      void writeJson(QUEUE_STORAGE_KEY, persistedQueueState);
      saveTimerRef.current = null;
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [pauseMessage, pausedReason, queueHydrated, tasks]);

  return null;
}
