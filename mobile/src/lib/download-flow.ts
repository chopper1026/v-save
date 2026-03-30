import { toProxyUrl } from '@/lib/api';
import type { ParsedVideo, ParsedVideoView } from '@/types/api';
import type { RuntimeTraceStage } from '@/lib/runtime-telemetry';
import { planPreviewCandidates } from './preview-candidates';

export type FormatType = 'video' | 'audio' | 'merge';

const DEFAULT_VIDEO_QUALITY_OPTIONS = ['4k', '1080p', '720p'];
const DEFAULT_AUDIO_QUALITY_OPTIONS = ['320k', '192k', '132k', '64k'];
const SOURCE_SINGLE_QUALITY_OPTION = 'source';

export const ASYNC_YOUTUBE_QUALITIES = new Set(['720p', '1080p', '4k']);

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

const audioQualityScore = (value: string): number => {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return -1;

  const kMatch = normalized.match(/(\d+)\s*k/);
  if (kMatch) return Number(kMatch[1]);

  const kbpsMatch = normalized.match(/(\d+)\s*kbps/);
  if (kbpsMatch) return Number(kbpsMatch[1]);
  return -1;
};

const toDisplayQualityOption = (
  value: string,
  options?: {
    preferSourceLabel?: boolean;
  }
): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (options?.preferSourceLabel && normalized.toLowerCase() === SOURCE_SINGLE_QUALITY_OPTION) {
    return SOURCE_SINGLE_QUALITY_OPTION;
  }
  return normalized;
};


const sortQualityOptions = (items: string[], format: FormatType): string[] => {
  const score = format === 'audio' ? audioQualityScore : videoQualityScore;
  return unique(items).sort((left, right) => {
    const diff = score(right) - score(left);
    if (diff !== 0) return diff;
    return right.localeCompare(left, 'en');
  });
};

export const getQualityOptionLabel = (value: string): string => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === SOURCE_SINGLE_QUALITY_OPTION) {
    return '原始线路';
  }
  return String(value || '').trim().toUpperCase();
};
export const buildParsedVideoView = (
  data: ParsedVideo,
  runtime?: {
    runtimeTraceId?: string;
    runtimeStage?: RuntimeTraceStage;
    clientOs?: string;
  }
): ParsedVideoView => {
  const runtimeTraceId = String(runtime?.runtimeTraceId || '').trim() || undefined;
  const originalCover = data.cover || '';
  const originalVideoUrl = data.videoUrl || '';
  const originalAudioUrl = data.audioUrl || '';
  const previewVideoCandidates = planPreviewCandidates({
    platform: data.platform,
    originalVideoUrl,
    downloadOptions: data.downloadOptions,
    clientOs: runtime?.clientOs,
    proxyBuilder: (url) =>
      toProxyUrl(url, 'video', {
        runtimeTraceId,
        runtimeStage: runtime?.runtimeStage || 'preview',
        runtimeClientType: 'MOBILE',
      }),
  });

  return {
    ...data,
    originalCover,
    originalVideoUrl,
    originalAudioUrl,
    previewCoverUrl: originalCover
      ? toProxyUrl(originalCover, 'image', {
          runtimeTraceId,
          runtimeStage: runtime?.runtimeStage || 'preview',
          runtimeClientType: 'MOBILE',
        })
      : '',
    previewVideoCandidates,
    runtimeTraceId,
  };
};

export const getQualityList = (
  video: ParsedVideoView | null,
  format: FormatType
): string[] => {
  if (!video) {
    return sortQualityOptions(
      format === 'audio'
        ? DEFAULT_AUDIO_QUALITY_OPTIONS
        : DEFAULT_VIDEO_QUALITY_OPTIONS,
      format
    );
  }

  if (format === 'audio') {
    const options = Object.keys(video.downloadOptions?.audio || {});
    const fallback =
      options.length > 0 ? options : DEFAULT_AUDIO_QUALITY_OPTIONS;
    return sortQualityOptions(fallback, format);
  }

  const merged = {
    ...(video.downloadOptions?.merged || {}),
    ...(video.downloadOptions?.video || {}),
  };

  const options = Object.keys(merged);
  const fallback =
    options.length > 0 ? options : DEFAULT_VIDEO_QUALITY_OPTIONS;
  const preferSourceLabel =
    video.platform === 'xiaohongshu' && video.qualityStatus === 'source_single_quality';
  return sortQualityOptions(
    fallback.map((item) => toDisplayQualityOption(item, { preferSourceLabel })),
    format
  );
};


export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const mapFormatToBackend = (current: FormatType): 'audio' | 'mp4' => {
  if (current === 'audio') return 'audio';
  return 'mp4';
};
