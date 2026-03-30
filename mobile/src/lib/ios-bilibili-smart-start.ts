import type { ParsedVideo } from '../types/api';

export type DownloadFormatType = 'video' | 'audio' | 'merge';

interface ShouldUseIosCompatibleFirstAttemptInput {
  parsedVideo: ParsedVideo | null | undefined;
  targetQuality: string;
  format: DownloadFormatType;
  os: string;
}

type VideoCandidate = NonNullable<
  NonNullable<ParsedVideo['downloadOptions']>['videoCandidates']
>[string][number];

const isIosOs = (os: string): boolean =>
  String(os || '').trim().toLowerCase() === 'ios';

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

const toNormalizedCandidateMap = (
  input: NonNullable<ParsedVideo['downloadOptions']>['videoCandidates'],
): Record<string, VideoCandidate[]> => {
  const map: Record<string, VideoCandidate[]> = {};
  Object.entries(input || {}).forEach(([quality, candidates]) => {
    const key = normalizeQualityKey(quality);
    if (!key || !Array.isArray(candidates) || candidates.length === 0) {
      return;
    }
    map[key] = candidates;
  });
  return map;
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

const toMediaIdentity = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch (_error) {
    const raw = normalized.split('?')[0]?.split('#')[0] || '';
    return raw.toLowerCase();
  }
};

const findCandidateByDefaultUrl = (
  candidates: VideoCandidate[],
  defaultUrl: string,
): VideoCandidate | null => {
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

export const shouldUseIosCompatibleFirstAttempt = (
  input: ShouldUseIosCompatibleFirstAttemptInput,
): boolean => {
  const { parsedVideo, targetQuality, format, os } = input;

  if (!isIosOs(os)) {
    return false;
  }

  if (!parsedVideo || parsedVideo.platform !== 'bilibili') {
    return false;
  }

  if (format === 'audio') {
    return false;
  }

  const downloadOptions = parsedVideo.downloadOptions;
  if (!downloadOptions) {
    return false;
  }

  const videoMap = toNormalizedVideoMap(downloadOptions.video);
  const candidateMap = toNormalizedCandidateMap(downloadOptions.videoCandidates);
  const fallbackOrder = getVideoQualityFallbackOrder(targetQuality);

  const resolvedQuality = fallbackOrder.find((quality) => {
    return !!videoMap[quality];
  });

  if (!resolvedQuality) {
    return false;
  }

  const defaultVideoUrl = videoMap[resolvedQuality];
  const candidates = candidateMap[resolvedQuality] || [];
  if (!defaultVideoUrl || candidates.length === 0) {
    return false;
  }

  const defaultCandidate = findCandidateByDefaultUrl(candidates, defaultVideoUrl);
  if (!defaultCandidate) {
    return false;
  }

  return defaultCandidate.codecid !== 7;
};
