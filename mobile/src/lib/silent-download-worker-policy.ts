import type { ParsedVideo } from '@/types/api';
import { ASYNC_YOUTUBE_QUALITIES } from './download-flow-constants';
import { isIosPhotosIncompatibleError } from './media-error-codes';

export const shouldUseSilentDownloadAsyncTask = (input: {
  platform?: ParsedVideo['platform'];
  quality: string;
  iosCompatible: boolean;
}): boolean => {
  return (
    input.platform === 'youtube' &&
    !input.iosCompatible &&
    ASYNC_YOUTUBE_QUALITIES.has(input.quality)
  );
};

export const shouldRetrySilentDownloadWithIosCompatibleFallback = (input: {
  os: string;
  firstAttemptIosCompatible: boolean;
  error: unknown;
}): boolean => {
  return (
    input.os === 'ios' &&
    !input.firstAttemptIosCompatible &&
    isIosPhotosIncompatibleError(input.error)
  );
};

export const shouldAttachAuthTokenToSilentDownloadUrl = (
  downloadUrl: string
): boolean => {
  return (
    downloadUrl.includes('/api/download/merge') ||
    downloadUrl.includes('/api/download/tasks/')
  );
};
