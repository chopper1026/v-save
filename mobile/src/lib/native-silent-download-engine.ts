import type { PersistedSilentDownloadQueueState } from '@/store/silent-download-persistence-snapshot';
import {
  buildPersistedSilentDownloadQueueState,
} from '@/store/silent-download-persistence-snapshot';

export const shouldUseNativeSilentDownloadEngine = (input: {
  platformOs: string;
  nativeModuleAvailable: boolean;
}): boolean => {
  return (
    String(input.platformOs || '').trim().toLowerCase() === 'ios' &&
    input.nativeModuleAvailable === true
  );
};

export const buildNativeSilentDownloadLegacyMigration = (
  state: PersistedSilentDownloadQueueState | null | undefined,
): PersistedSilentDownloadQueueState => {
  return buildPersistedSilentDownloadQueueState({
    tasks: Array.isArray(state?.tasks) ? state?.tasks : [],
    pausedReason: state?.pausedReason || null,
    pauseMessage: state?.pauseMessage || null,
  });
};
