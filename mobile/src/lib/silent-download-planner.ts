import type { ParsedVideo } from '@/types/api';

export const SILENT_DOWNLOAD_FORMAT = 'merge' as const;
export const SILENT_DOWNLOAD_DEFAULT_QUALITY = '720p';

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

export const resolveSilentDownloadQuality = (parsedVideo: ParsedVideo | null | undefined): string => {
  if (!parsedVideo) {
    return SILENT_DOWNLOAD_DEFAULT_QUALITY;
  }

  const mergedOptions = Object.keys(parsedVideo.downloadOptions?.merged || {});
  const videoOptions = Object.keys(parsedVideo.downloadOptions?.video || {});
  const qualityOptions = sortQualityOptions([...mergedOptions, ...videoOptions]);

  return qualityOptions[0] || SILENT_DOWNLOAD_DEFAULT_QUALITY;
};

export const buildSilentDownloadPlan = (parsedVideo: ParsedVideo) => {
  return {
    format: SILENT_DOWNLOAD_FORMAT,
    quality: resolveSilentDownloadQuality(parsedVideo),
  };
};
