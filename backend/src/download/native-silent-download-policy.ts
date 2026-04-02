import type { VideoInfo } from '../parsers/base.interface';

const ASYNC_YOUTUBE_QUALITIES = new Set(['720p', '1080p', '4k']);

const unique = (items: string[]): string[] => {
  const map = new Map<string, string>();
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!map.has(key)) {
      map.set(key, value);
    }
  }
  return Array.from(map.values());
};

const videoQualityScore = (value: string): number => {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return -1;

  const kMatch = normalized.match(/(\d+(?:\.\d+)?)\s*k/);
  if (kMatch) return Math.round(Number(kMatch[1]) * 1000);

  const pMatch = normalized.match(/(\d+)\s*p/);
  if (pMatch) return Number(pMatch[1]);

  if (normalized === 'uhd') return 2160;
  if (normalized === 'fhd') return 1080;
  if (normalized === 'hd') return 720;
  if (normalized === 'sd') return 480;
  return -1;
};

const sortQualityOptions = (items: string[]): string[] => {
  return unique(items).sort((left, right) => {
    const diff = videoQualityScore(right) - videoQualityScore(left);
    if (diff !== 0) return diff;
    return right.localeCompare(left, 'en');
  });
};

const normalizeQualityKey = (quality: string): string =>
  String(quality || '').trim().toLowerCase();

const toNormalizedVideoMap = (
  input: Record<string, string> | undefined,
): Record<string, string> => {
  const map: Record<string, string> = {};
  Object.entries(input || {}).forEach(([quality, url]) => {
    const key = normalizeQualityKey(quality);
    const normalizedUrl = String(url || '').trim();
    if (!key || !normalizedUrl) {
      return;
    }
    map[key] = normalizedUrl;
  });
  return map;
};

const toMediaIdentity = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    const raw = normalized.split('?')[0]?.split('#')[0] || '';
    return raw.toLowerCase();
  }
};

const findCandidateByDefaultUrl = (
  candidates: Array<{ url?: string; codecid?: number }>,
  defaultUrl: string,
): { url?: string; codecid?: number } | null => {
  const normalizedDefaultUrl = String(defaultUrl || '').trim();
  if (!normalizedDefaultUrl) {
    return null;
  }

  const exactMatched = candidates.find(
    (item) => String(item?.url || '').trim() === normalizedDefaultUrl,
  );
  if (exactMatched) {
    return exactMatched;
  }

  const defaultIdentity = toMediaIdentity(normalizedDefaultUrl);
  if (!defaultIdentity) {
    return null;
  }

  return (
    candidates.find((item) => {
      const candidateIdentity = toMediaIdentity(String(item?.url || '').trim());
      return candidateIdentity === defaultIdentity;
    }) || null
  );
};

const getVideoQualityFallbackOrder = (quality: string): string[] => {
  switch (normalizeQualityKey(quality)) {
    case '4k':
      return ['4k', '1080p', '720p', '540p', '480p', '360p'];
    case '1080p':
    case '1440p':
      return ['1080p', '720p', '540p', '480p', '360p', '4k'];
    case '540p':
      return ['540p', '480p', '360p', '720p', '1080p', '4k'];
    case '480p':
      return ['480p', '360p', '540p', '720p', '1080p', '4k'];
    case '360p':
      return ['360p', '480p', '540p', '720p', '1080p', '4k'];
    case '720p':
    default:
      return ['720p', '540p', '480p', '360p', '1080p', '4k'];
  }
};

export const resolveNativeSilentDownloadQuality = (
  parsedVideo: VideoInfo | null | undefined,
): string => {
  if (!parsedVideo) {
    return '720p';
  }

  const mergedOptions = Object.keys(parsedVideo.downloadOptions?.merged || {});
  const videoOptions = Object.keys(parsedVideo.downloadOptions?.video || {});
  const qualityOptions = sortQualityOptions([...mergedOptions, ...videoOptions]);

  return qualityOptions[0] || '720p';
};

export const shouldUseNativeSilentDownloadAsyncTask = (input: {
  platform?: string;
  quality: string;
  iosCompatible: boolean;
}): boolean => {
  return (
    input.platform === 'youtube' &&
    !input.iosCompatible &&
    ASYNC_YOUTUBE_QUALITIES.has(String(input.quality || '').trim().toLowerCase())
  );
};

export const shouldUseNativeSilentDownloadIosCompatibleFirstAttempt = (input: {
  parsedVideo: VideoInfo | null | undefined;
  targetQuality: string;
}): boolean => {
  const { parsedVideo, targetQuality } = input;
  if (!parsedVideo || parsedVideo.platform !== 'bilibili') {
    return false;
  }

  const downloadOptions = parsedVideo.downloadOptions;
  if (!downloadOptions) {
    return false;
  }

  const videoMap = toNormalizedVideoMap(downloadOptions.video);
  const candidateMap = downloadOptions.videoCandidates || {};
  const fallbackOrder = getVideoQualityFallbackOrder(targetQuality);

  const resolvedQuality = fallbackOrder.find((quality) => {
    return !!videoMap[quality];
  });

  if (!resolvedQuality) {
    return false;
  }

  const defaultVideoUrl = videoMap[resolvedQuality];
  const candidates = Array.isArray(candidateMap[resolvedQuality])
    ? candidateMap[resolvedQuality]
    : [];
  if (!defaultVideoUrl || candidates.length === 0) {
    return false;
  }

  const defaultCandidate = findCandidateByDefaultUrl(candidates, defaultVideoUrl);
  if (!defaultCandidate) {
    return false;
  }

  return defaultCandidate.codecid !== 7;
};

export const resolveNativeSilentDownloadAuthPolicy = (
  downloadUrl: string,
): 'none' | 'bearer' => {
  const value = String(downloadUrl || '').trim();
  if (!value) {
    return 'none';
  }

  if (
    value.includes('/api/download/merge') ||
    value.includes('/api/download/tasks/')
  ) {
    return 'bearer';
  }

  return 'none';
};
