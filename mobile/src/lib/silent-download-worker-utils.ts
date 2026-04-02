import { extractApiErrorMessage } from '@/lib/error';
import { resolveSilentDownloadQueuePause } from '@/lib/silent-download-failure-policy';
import type { ParsedVideo } from '@/types/api';
import type { SilentDownloadWorkerProgress } from './silent-download-worker';

export type SilentDownloadWorkerError = Error & {
  pauseQueue?: boolean;
  pauseReason?: string;
  pauseMessage?: string;
};

export const createSilentDownloadWorkerProgressReporter = (input: {
  title?: string;
  quality: string;
  platform?: ParsedVideo['platform'];
  runtimeTraceId: string;
  onProgress?: (progress: SilentDownloadWorkerProgress) => void;
}) => {
  return (patch: SilentDownloadWorkerProgress) => {
    input.onProgress?.({
      title: input.title,
      quality: input.quality,
      platform: input.platform,
      runtimeTraceId: input.runtimeTraceId,
      ...patch,
    });
  };
};

export const normalizeSilentDownloadWorkerError = (
  error: unknown,
  fallbackMessage = '静默下载失败，请稍后重试',
): SilentDownloadWorkerError => {
  const normalizedError = new Error(
    extractApiErrorMessage(error, fallbackMessage)
  ) as SilentDownloadWorkerError;
  const pauseDecision = resolveSilentDownloadQueuePause(error);
  if (pauseDecision) {
    normalizedError.pauseQueue = true;
    normalizedError.pauseReason = pauseDecision.reason;
    normalizedError.pauseMessage = pauseDecision.message;
  }
  return normalizedError;
};
