import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { API_BASE_URL } from '@/lib/env';
import {
  buildNativeSilentDownloadLegacyMigration,
  shouldUseNativeSilentDownloadEngine,
} from '@/lib/native-silent-download-engine';
import { buildNativeSilentDownloadBridgePayload } from '@/lib/native-silent-download-bridge-config';
import {
  createSilentDownloadTask,
  useSilentDownloadQueueStore,
  type SilentDownloadTask,
} from '@/store/silent-download-queue-store';
import {
  normalizePersistedSilentDownloadQueueState,
  type PersistedSilentDownloadQueueState,
} from '@/store/silent-download-persistence-snapshot';

const NATIVE_SNAPSHOT_EVENT = 'NativeSilentDownloadSnapshotChanged';

interface NativeSilentDownloadBootstrapInput {
  apiBaseUrl?: string;
  authToken?: string | null;
  enabled: boolean;
  legacyState?: PersistedSilentDownloadQueueState | null;
}

interface NativeSilentDownloadConfigInput {
  apiBaseUrl?: string;
  authToken?: string | null;
  enabled: boolean;
}

interface NativeSilentDownloadEnqueueResult {
  accepted: boolean;
  task: SilentDownloadTask | null;
}

interface NativeSilentDownloadModule {
  bootstrap(input: NativeSilentDownloadBootstrapInput): Promise<PersistedSilentDownloadQueueState>;
  configure(input: NativeSilentDownloadConfigInput): Promise<PersistedSilentDownloadQueueState>;
  enqueueTask(task: SilentDownloadTask): Promise<NativeSilentDownloadEnqueueResult>;
  removeTask(taskId: string): Promise<PersistedSilentDownloadQueueState>;
  clearFinished(): Promise<PersistedSilentDownloadQueueState>;
  resumeQueue(): Promise<PersistedSilentDownloadQueueState>;
  getSnapshot(): Promise<PersistedSilentDownloadQueueState>;
}

const nativeSilentDownloadModule = (
  NativeModules?.NativeSilentDownloadManager || null
) as NativeSilentDownloadModule | null;

const nativeSilentDownloadEventEmitter = nativeSilentDownloadModule
  ? new NativeEventEmitter(nativeSilentDownloadModule as any)
  : null;

const normalizeSnapshot = (
  snapshot: PersistedSilentDownloadQueueState | null | undefined,
): PersistedSilentDownloadQueueState => {
  return normalizePersistedSilentDownloadQueueState(snapshot);
};

export const isNativeSilentDownloadEngineAvailable = (): boolean => {
  return shouldUseNativeSilentDownloadEngine({
    platformOs: Platform.OS,
    nativeModuleAvailable: Boolean(nativeSilentDownloadModule),
  });
};

export const bootstrapNativeSilentDownloadBridge = async (
  input: NativeSilentDownloadBootstrapInput,
): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    return null;
  }

  const snapshot = await nativeSilentDownloadModule.bootstrap(buildNativeSilentDownloadBridgePayload({
    apiBaseUrl: String(input.apiBaseUrl || API_BASE_URL),
    enabled: input.enabled === true,
    authToken: input.authToken,
    legacyState: buildNativeSilentDownloadLegacyMigration(input.legacyState),
  }) as unknown as NativeSilentDownloadBootstrapInput);
  return normalizeSnapshot(snapshot);
};

export const configureNativeSilentDownloadBridge = async (
  input: NativeSilentDownloadConfigInput,
): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    return null;
  }

  const snapshot = await nativeSilentDownloadModule.configure(buildNativeSilentDownloadBridgePayload({
    apiBaseUrl: String(input.apiBaseUrl || API_BASE_URL),
    enabled: input.enabled === true,
    authToken: input.authToken,
  }) as unknown as NativeSilentDownloadConfigInput);
  return normalizeSnapshot(snapshot);
};

export const getNativeSilentDownloadSnapshot = async (): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    return null;
  }

  const snapshot = await nativeSilentDownloadModule.getSnapshot();
  return normalizeSnapshot(snapshot);
};

export const subscribeNativeSilentDownloadSnapshots = (
  listener: (snapshot: PersistedSilentDownloadQueueState) => void,
): (() => void) => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadEventEmitter) {
    return () => undefined;
  }

  const subscription = nativeSilentDownloadEventEmitter.addListener(
    NATIVE_SNAPSHOT_EVENT,
    (payload: PersistedSilentDownloadQueueState | null | undefined) => {
      listener(normalizeSnapshot(payload));
    },
  );

  return () => {
    subscription.remove();
  };
};

export const enqueueSilentDownloadSourceUrl = async (
  sourceUrl: string,
): Promise<NativeSilentDownloadEnqueueResult> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    return useSilentDownloadQueueStore.getState().enqueueSourceUrl(sourceUrl);
  }

  const task = createSilentDownloadTask(sourceUrl);
  const result = await nativeSilentDownloadModule.enqueueTask(task);
  return {
    accepted: result?.accepted === true,
    task: result?.accepted === true ? result.task || task : null,
  };
};

export const removeSilentDownloadTask = async (
  taskId: string,
): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    useSilentDownloadQueueStore.getState().removeTask(taskId);
    return null;
  }

  return normalizeSnapshot(await nativeSilentDownloadModule.removeTask(taskId));
};

export const clearFinishedSilentDownloadTasks = async (): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    useSilentDownloadQueueStore.getState().clearFinished();
    return null;
  }

  return normalizeSnapshot(await nativeSilentDownloadModule.clearFinished());
};

export const resumeSilentDownloadQueue = async (): Promise<PersistedSilentDownloadQueueState | null> => {
  if (!isNativeSilentDownloadEngineAvailable() || !nativeSilentDownloadModule) {
    useSilentDownloadQueueStore.getState().resumeQueue();
    return null;
  }

  return normalizeSnapshot(await nativeSilentDownloadModule.resumeQueue());
};
