import type { DownloadGetUrlRequest } from '@/types/api';

export const MOBILE_CLIENT_TYPE = 'MOBILE' as const;

type BuildDownloadGetUrlRequestInput = Omit<
  DownloadGetUrlRequest,
  'clientType'
>;

export const buildMobileDownloadGetUrlRequest = (
  input: BuildDownloadGetUrlRequestInput,
): DownloadGetUrlRequest => {
  const request: DownloadGetUrlRequest = {
    videoInfo: input.videoInfo,
    format: input.format,
    quality: input.quality,
    clientType: MOBILE_CLIENT_TYPE,
  };

  if (typeof input.iosCompatible === 'boolean') {
    request.iosCompatible = input.iosCompatible;
  }

  if (typeof input.allowWatermarkFallback === 'boolean') {
    request.allowWatermarkFallback = input.allowWatermarkFallback;
  }

  return request;
};
