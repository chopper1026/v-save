import { useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { API_BASE_URL } from '@/lib/env';
import {
  bootstrapNativeSilentDownloadBridge,
  configureNativeSilentDownloadBridge,
  isNativeSilentDownloadEngineAvailable,
  subscribeNativeSilentDownloadSnapshots,
} from '@/lib/native-silent-download-bridge';
import { shouldRequestNativeSilentDownloadRuntimePermissions } from '@/lib/native-silent-download-permission-policy';
import { shouldPersistSilentDownloadQueueSnapshot } from '@/lib/silent-download-runtime-policy';
import { useAuthStore } from '@/store/auth-store';
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

const ensureNativeSilentDownloadPhotoPermission = async () => {
  const current = await MediaLibrary.getPermissionsAsync();
  const granted =
    current.granted || (current as any).accessPrivileges === 'limited';
  if (granted) {
    return current;
  }

  return MediaLibrary.requestPermissionsAsync();
};

const ensureNativeSilentDownloadNotificationPermission = async () => {
  const current = await Notifications.getPermissionsAsync();
  const granted =
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (granted) {
    return current;
  }

  return Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    },
  });
};

export function SilentDownloadPersistenceBridge() {
  const token = useAuthStore((state) => state.token);
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
  const previousEnabledRef = useRef<boolean | null>(null);
  const useNativeEngine = isNativeSilentDownloadEngineAvailable();

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
      const persistedEnabled = settings?.enabled === true;

      hydrateSettings(persistedEnabled);
      if (useNativeEngine) {
        const snapshot = await bootstrapNativeSilentDownloadBridge({
          apiBaseUrl: API_BASE_URL,
          authToken: token,
          enabled: persistedEnabled,
          legacyState: persistedQueueState,
        });

        if (!active) {
          return;
        }

        hydrateQueueState(snapshot || persistedQueueState);
        lastQueueSnapshotRef.current = null;
      } else {
        hydrateQueueState(persistedQueueState);
        lastQueueSnapshotRef.current = JSON.stringify(persistedQueueState);
      }
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
  }, [
    hydrateQueueState,
    hydrateSettings,
    setQueueHydrated,
    setSettingsHydrated,
    token,
    useNativeEngine,
  ]);

  useEffect(() => {
    if (!settingsHydrated) {
      return;
    }
    void writeJson(SETTINGS_STORAGE_KEY, { enabled });
    if (!useNativeEngine) {
      previousEnabledRef.current = enabled;
      return;
    }

    void (async () => {
      const shouldRequestPermissions =
        shouldRequestNativeSilentDownloadRuntimePermissions({
          useNativeEngine,
          previousEnabled: previousEnabledRef.current,
          nextEnabled: enabled,
        });
      previousEnabledRef.current = enabled;

      if (shouldRequestPermissions) {
        await Promise.allSettled([
          ensureNativeSilentDownloadPhotoPermission(),
          ensureNativeSilentDownloadNotificationPermission(),
        ]);
      }
      const snapshot = await configureNativeSilentDownloadBridge({
        apiBaseUrl: API_BASE_URL,
        authToken: token,
        enabled,
      });
      if (snapshot) {
        hydrateQueueState(snapshot);
      }
    })();
  }, [enabled, hydrateQueueState, settingsHydrated, token, useNativeEngine]);

  useEffect(() => {
    if (!useNativeEngine || !queueHydrated) {
      return;
    }

    const unsubscribe = subscribeNativeSilentDownloadSnapshots((snapshot) => {
      hydrateQueueState(snapshot);
    });

    return unsubscribe;
  }, [hydrateQueueState, queueHydrated, useNativeEngine]);

  useEffect(() => {
    if (useNativeEngine) {
      return;
    }

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
  }, [pauseMessage, pausedReason, queueHydrated, tasks, useNativeEngine]);

  return null;
}
