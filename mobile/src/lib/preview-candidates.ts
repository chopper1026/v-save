export interface PreviewVideoCandidateInput {
  url: string;
  codecid?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  bandwidth?: number;
  fileId?: string;
  sourceKind?: string;
  watermark?: boolean;
}

export interface PreviewCandidate {
  identity: string;
  url: string;
  isProxy: boolean;
  quality: string;
  sourceKind: string;
  watermark: boolean;
  codecId?: number;
  priorityReason: string;
}

interface PreviewDownloadOptions {
  merged?: Record<string, string>;
  videoCandidates?: Record<string, PreviewVideoCandidateInput[]>;
}

interface PreviewCandidatePlanInput {
  platform: string;
  originalVideoUrl?: string;
  downloadOptions?: PreviewDownloadOptions;
  clientOs?: string;
  proxyBuilder: (url: string, type: 'video' | 'image') => string;
}

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value || '');

const normalizeQuality = (value: string): string => String(value || '').trim().toLowerCase();

const normalizeCandidateUrl = (value: string): string => String(value || '').trim();

const isHlsManifestUrl = (value: string): boolean => /\.m3u8(\?|$)/i.test(value || '');

const normalizeOs = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

const normalizeMediaIdentity = (value: string): string => {
  const normalized = normalizeCandidateUrl(value);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch (_error) {
    return normalized.toLowerCase();
  }
};

const videoQualityScore = (value: string): number => {
  const normalized = normalizeQuality(value);
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

const getBilibiliCodecRank = (codecid?: number): number => {
  if (codecid === 7) return 100;
  if (typeof codecid === 'number') return 10;
  return 0;
};

const getDouyinSourceRank = (sourceKind?: string): number => {
  switch (String(sourceKind || '').trim()) {
    case 'bit_rate':
      return 0;
    case 'play_addr_h264':
      return 1;
    case 'play_addr_bytevc1':
      return 2;
    case 'play_addr':
      return 3;
    case 'merged':
    case 'merged_fallback':
      return 4;
    case 'default_preview':
      return 5;
    case 'download_addr':
      return 6;
    default:
      return 7;
  }
};

const buildPreviewIdentity = (
  quality: string,
  sourceKind: string,
  url: string,
  codecId?: number,
  watermark?: boolean,
  fileId?: string,
): string => {
  return [
    normalizeQuality(quality) || 'unknown',
    String(sourceKind || 'unknown').trim().toLowerCase() || 'unknown',
    String(fileId || '').trim().toLowerCase() || normalizeMediaIdentity(url),
    Number.isFinite(codecId) ? String(codecId) : 'na',
    watermark ? 'wm' : 'clean',
  ].join('|');
};

const pushCandidate = (
  target: PreviewCandidate[],
  dedup: Set<string>,
  input: {
    url: string;
    isProxy: boolean;
    quality: string;
    sourceKind: string;
    watermark?: boolean;
    codecId?: number;
    priorityReason: string;
    fileId?: string;
  },
): void => {
  const normalizedUrl = normalizeCandidateUrl(input.url);
  if (!isHttpUrl(normalizedUrl)) {
    return;
  }

  const dedupKey = `${input.isProxy ? 'proxy' : 'raw'}:${normalizedUrl.toLowerCase()}`;
  if (dedup.has(dedupKey)) {
    return;
  }
  dedup.add(dedupKey);

  target.push({
    identity: buildPreviewIdentity(
      input.quality,
      input.sourceKind,
      normalizedUrl,
      input.codecId,
      input.watermark,
      input.fileId,
    ),
    url: normalizedUrl,
    isProxy: input.isProxy,
    quality: String(input.quality || '').trim() || 'unknown',
    sourceKind: String(input.sourceKind || '').trim() || 'unknown',
    watermark: input.watermark === true,
    ...(Number.isFinite(input.codecId) ? { codecId: input.codecId } : {}),
    priorityReason: input.priorityReason,
  });
};

const sortMergedEntries = (input: Record<string, string> | undefined) =>
  Object.entries(input || {})
    .map(([quality, url]) => ({
      quality: String(quality || '').trim(),
      url: normalizeCandidateUrl(url),
    }))
    .filter((item) => item.quality && isHttpUrl(item.url))
    .sort((left, right) => {
      const diff = videoQualityScore(right.quality) - videoQualityScore(left.quality);
      if (diff !== 0) return diff;
      return right.quality.localeCompare(left.quality, 'en');
    });

const sortCandidateMapEntries = (
  input: Record<string, PreviewVideoCandidateInput[]> | undefined,
) =>
  Object.entries(input || {})
    .map(([quality, candidates]) => ({
      quality: String(quality || '').trim(),
      candidates: Array.isArray(candidates) ? candidates.slice() : [],
    }))
    .filter((item) => item.quality && item.candidates.length > 0)
    .sort((left, right) => {
      const diff = videoQualityScore(right.quality) - videoQualityScore(left.quality);
      if (diff !== 0) return diff;
      return right.quality.localeCompare(left.quality, 'en');
    });

const planIosBilibiliCandidates = (
  input: PreviewCandidatePlanInput,
): PreviewCandidate[] => {
  const planned: PreviewCandidate[] = [];
  const dedup = new Set<string>();
  const mergedEntries = sortMergedEntries(input.downloadOptions?.merged);

  mergedEntries.forEach((item) => {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(item.url, 'video'),
      isProxy: true,
      quality: item.quality,
      sourceKind: 'merged',
      priorityReason: 'bilibili_ios_progressive_merged',
    });
  });

  const candidateEntries = sortCandidateMapEntries(input.downloadOptions?.videoCandidates);
  candidateEntries.forEach(({ quality, candidates }) => {
    candidates
      .filter((item) => isHttpUrl(item?.url || ''))
      .sort((left, right) => {
        const leftPixels = Number(left.width || 0) * Number(left.height || 0);
        const rightPixels = Number(right.width || 0) * Number(right.height || 0);
        if (rightPixels !== leftPixels) {
          return rightPixels - leftPixels;
        }

        const codecDiff = getBilibiliCodecRank(right.codecid) - getBilibiliCodecRank(left.codecid);
        if (codecDiff !== 0) {
          return codecDiff;
        }

        const fpsDiff = Number(right.frameRate || 0) - Number(left.frameRate || 0);
        if (fpsDiff !== 0) {
          return fpsDiff;
        }

        return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
      })
      .forEach((item) => {
        pushCandidate(planned, dedup, {
          url: input.proxyBuilder(item.url, 'video'),
          isProxy: true,
          quality,
          sourceKind: 'video_candidate',
          codecId: item.codecid,
          priorityReason: 'bilibili_ios_codec_candidate',
          fileId: item.fileId,
        });
      });
  });

  if (planned.length === 0 && isHttpUrl(input.originalVideoUrl || '')) {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(String(input.originalVideoUrl || ''), 'video'),
      isProxy: true,
      quality: 'unknown',
      sourceKind: 'default_preview',
      priorityReason: 'bilibili_ios_default_proxy',
    });
  }

  return planned;
};

const planIosDouyinCandidates = (
  input: PreviewCandidatePlanInput,
): PreviewCandidate[] => {
  const planned: PreviewCandidate[] = [];
  const dedup = new Set<string>();
  const candidateEntries = sortCandidateMapEntries(input.downloadOptions?.videoCandidates);
  const watermarkFallbacks: Array<{
    url: string;
    quality: string;
    sourceKind: string;
    fileId?: string;
  }> = [];

  candidateEntries.forEach(({ quality, candidates }) => {
    candidates
      .filter((item) => isHttpUrl(item?.url || ''))
      .sort((left, right) => {
        const watermarkDiff = Number(left.watermark === true) - Number(right.watermark === true);
        if (watermarkDiff !== 0) {
          return watermarkDiff;
        }

        const sourceDiff =
          getDouyinSourceRank(left.sourceKind) - getDouyinSourceRank(right.sourceKind);
        if (sourceDiff !== 0) {
          return sourceDiff;
        }

        const leftPixels = Number(left.width || 0) * Number(left.height || 0);
        const rightPixels = Number(right.width || 0) * Number(right.height || 0);
        if (rightPixels !== leftPixels) {
          return rightPixels - leftPixels;
        }

        const bandwidthDiff = Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
        if (bandwidthDiff !== 0) {
          return bandwidthDiff;
        }

        return Number(right.frameRate || 0) - Number(left.frameRate || 0);
      })
      .forEach((item) => {
        const isWatermark = item.watermark === true;
        if (isWatermark) {
          watermarkFallbacks.push({
            url: item.url,
            quality,
            sourceKind: String(item.sourceKind || '').trim() || 'video_candidate',
            fileId: item.fileId,
          });
          return;
        }
        pushCandidate(planned, dedup, {
          url: input.proxyBuilder(item.url, 'video'),
          isProxy: true,
          quality,
          sourceKind: String(item.sourceKind || '').trim() || 'video_candidate',
          watermark: false,
          priorityReason: 'douyin_ios_non_watermark_candidate',
          fileId: item.fileId,
        });
      });
  });

  sortMergedEntries(input.downloadOptions?.merged).forEach((item) => {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(item.url, 'video'),
      isProxy: true,
      quality: item.quality,
      sourceKind: 'merged',
      priorityReason: 'douyin_ios_merged_fallback',
    });
  });

  watermarkFallbacks.forEach((item) => {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(item.url, 'video'),
      isProxy: true,
      quality: item.quality,
      sourceKind: item.sourceKind,
      watermark: true,
      priorityReason: 'douyin_ios_watermark_fallback',
      fileId: item.fileId,
    });
  });

  if (planned.length === 0 && isHttpUrl(input.originalVideoUrl || '')) {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(String(input.originalVideoUrl || ''), 'video'),
      isProxy: true,
      quality: 'unknown',
      sourceKind: 'default_preview',
      priorityReason: 'douyin_ios_default_proxy',
    });
  }

  return planned;
};

const planDefaultCandidates = (
  input: PreviewCandidatePlanInput,
): PreviewCandidate[] => {
  const planned: PreviewCandidate[] = [];
  const dedup = new Set<string>();
  const originalVideoUrl = normalizeCandidateUrl(input.originalVideoUrl || '');
  const prefersRawFirst = isHlsManifestUrl(originalVideoUrl);

  if (originalVideoUrl) {
    const rawCandidate = {
      url: originalVideoUrl,
      isProxy: false,
      quality: 'unknown',
      sourceKind: 'default_preview',
      priorityReason: prefersRawFirst ? 'default_raw_hls_first' : 'default_raw_fallback',
    };
    const proxyCandidate = {
      url: input.proxyBuilder(originalVideoUrl, 'video'),
      isProxy: true,
      quality: 'unknown',
      sourceKind: 'default_preview',
      priorityReason: prefersRawFirst ? 'default_proxy_hls_fallback' : 'default_proxy_first',
    };

    [prefersRawFirst ? rawCandidate : proxyCandidate, prefersRawFirst ? proxyCandidate : rawCandidate]
      .forEach((item) => pushCandidate(planned, dedup, item));
  }

  sortMergedEntries(input.downloadOptions?.merged).forEach((item) => {
    pushCandidate(planned, dedup, {
      url: input.proxyBuilder(item.url, 'video'),
      isProxy: true,
      quality: item.quality,
      sourceKind: 'merged',
      priorityReason: 'default_merged_proxy',
    });
    pushCandidate(planned, dedup, {
      url: item.url,
      isProxy: false,
      quality: item.quality,
      sourceKind: 'merged',
      priorityReason: 'default_merged_raw',
    });
  });

  return planned;
};

export const planPreviewCandidates = (
  input: PreviewCandidatePlanInput,
): PreviewCandidate[] => {
  const platform = String(input.platform || '').trim().toLowerCase();
  const clientOs = normalizeOs(input.clientOs);

  if (clientOs === 'ios' && platform === 'bilibili') {
    return planIosBilibiliCandidates(input);
  }

  if (clientOs === 'ios' && platform === 'douyin') {
    return planIosDouyinCandidates(input);
  }

  return planDefaultCandidates(input);
};
