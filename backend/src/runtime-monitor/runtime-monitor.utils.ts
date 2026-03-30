import type { RuntimeClientType, RuntimeOutcome, RuntimePlatform } from './runtime-monitor.types';

const SUPPORTED_VIDEO_HOSTS: Array<{ host: string; platform: RuntimePlatform }> = [
  { host: 'douyin.com', platform: 'douyin' },
  { host: 'iesdouyin.com', platform: 'douyin' },
  { host: 'douyinvod.com', platform: 'douyin' },
  { host: 'douyinpic.com', platform: 'douyin' },
  { host: 'snssdk.com', platform: 'douyin' },
  { host: 'bytedance.com', platform: 'douyin' },
  { host: 'bilibili.com', platform: 'bilibili' },
  { host: 'b23.tv', platform: 'bilibili' },
  { host: 'bilivideo.com', platform: 'bilibili' },
  { host: 'hdslb.com', platform: 'bilibili' },
  { host: 'xiaohongshu.com', platform: 'xiaohongshu' },
  { host: 'xiaohongshu.cn', platform: 'xiaohongshu' },
  { host: 'xhscdn.com', platform: 'xiaohongshu' },
  { host: 'xhslink.com', platform: 'xiaohongshu' },
  { host: 'xhsc.cn', platform: 'xiaohongshu' },
  { host: 'kuaishou.com', platform: 'kuaishou' },
  { host: 'kuaishou.cn', platform: 'kuaishou' },
  { host: 'kwaicdn.com', platform: 'kuaishou' },
  { host: 'ndcimgs.com', platform: 'kuaishou' },
  { host: 'youtube.com', platform: 'youtube' },
  { host: 'youtu.be', platform: 'youtube' },
  { host: 'googlevideo.com', platform: 'youtube' },
];

export const RUNTIME_FEATURES = ['parse', 'preview', 'download'] as const;
export const RUNTIME_CLIENT_TYPES = ['WEB', 'MOBILE', 'unknown'] as const;
export const RUNTIME_PLATFORMS = [
  'douyin',
  'bilibili',
  'xiaohongshu',
  'kuaishou',
  'youtube',
  'unknown',
] as const;

export const normalizeRuntimeClientType = (
  value: unknown,
): RuntimeClientType => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'WEB' || normalized === 'MOBILE') {
    return normalized;
  }
  return 'unknown';
};

export const normalizeRuntimePlatform = (value: unknown): RuntimePlatform => {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'douyin' ||
    normalized === 'bilibili' ||
    normalized === 'xiaohongshu' ||
    normalized === 'kuaishou' ||
    normalized === 'youtube'
  ) {
    return normalized;
  }
  return 'unknown';
};

export const normalizeRuntimeOutcome = (value: unknown): RuntimeOutcome =>
  String(value || '').trim().toLowerCase() === 'success' ? 'success' : 'failure';

export const normalizeLatencyMs = (value: unknown): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.trunc(parsed);
};

export const extractSourceHost = (
  value: string | undefined | null,
): string | null => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const detectRuntimePlatformFromUrl = (
  value: string | undefined | null,
): RuntimePlatform => {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'unknown';
  }

  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    const matched = SUPPORTED_VIDEO_HOSTS.find((item) => hostname.includes(item.host));
    return matched?.platform || 'unknown';
  } catch {
    const lower = raw.toLowerCase();
    const matched = SUPPORTED_VIDEO_HOSTS.find((item) => lower.includes(item.host));
    return matched?.platform || 'unknown';
  }
};

export const normalizeRuntimeErrorCode = (
  error: unknown,
  fallback = 'UNKNOWN_ERROR',
): string => {
  const target = error as any;
  const response = target?.response;
  const payload =
    response && typeof response === 'object'
      ? ('data' in response ? response.data : response)
      : undefined;
  const directCode =
    payload?.code ||
    payload?.message?.code ||
    response?.code ||
    target?.code;
  if (typeof directCode === 'string' && directCode.trim()) {
    return directCode.trim().toUpperCase();
  }

  const directMessage =
    payload?.message?.message ||
    payload?.message ||
    payload?.error ||
    target?.message;
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  return fallback;
};

export const normalizeRuntimeTraceId = (
  value: unknown,
): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const sanitized = normalized
    .replace(/[^A-Za-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!sanitized) {
    return null;
  }

  return sanitized.slice(0, 96);
};
