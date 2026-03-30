import type { Request } from 'express';

export type ObservedRoute =
  | 'download_parse'
  | 'download_get_url'
  | 'download_create_task'
  | 'download_task_poll'
  | 'download_task_file'
  | 'download_merge'
  | 'proxy_fetch'
  | 'auth_login'
  | 'auth_register'
  | 'admin_users'
  | 'admin_audit'
  | 'admin_download_modes';

export type ObservedPlatform =
  | 'douyin'
  | 'bilibili'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'youtube'
  | 'unknown';

export type ObservedClientType = 'WEB' | 'MOBILE' | 'unknown';
export type ObservedOutcome = 'success' | 'business_error' | 'system_error';
export type DownloadTaskMetricStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'expired';

const SUPPORTED_VIDEO_HOSTS: Array<{ host: string; platform: ObservedPlatform }> = [
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

const normalizePath = (path: string | undefined): string => {
  const value = String(path || '').trim();
  if (!value) {
    return '/';
  }
  return value.startsWith('/api/') ? value.slice(4) || '/' : value;
};

export const resolveObservedRoute = (
  method: string | undefined,
  path: string | undefined,
): ObservedRoute | null => {
  const normalizedMethod = String(method || '').trim().toUpperCase();
  const normalizedPath = normalizePath(path);

  if (normalizedMethod === 'POST' && normalizedPath === '/download/parse') {
    return 'download_parse';
  }
  if (normalizedMethod === 'POST' && normalizedPath === '/download/get-url') {
    return 'download_get_url';
  }
  if (normalizedMethod === 'POST' && normalizedPath === '/download/create-task') {
    return 'download_create_task';
  }
  if (normalizedMethod === 'GET' && /^\/download\/tasks\/[^/]+$/.test(normalizedPath)) {
    return 'download_task_poll';
  }
  if (
    normalizedMethod === 'GET' &&
    /^\/download\/tasks\/[^/]+\/file$/.test(normalizedPath)
  ) {
    return 'download_task_file';
  }
  if (normalizedMethod === 'GET' && normalizedPath === '/download/merge') {
    return 'download_merge';
  }
  if (normalizedMethod === 'GET' && normalizedPath === '/proxy/fetch') {
    return 'proxy_fetch';
  }
  if (normalizedMethod === 'POST' && normalizedPath === '/auth/login') {
    return 'auth_login';
  }
  if (normalizedMethod === 'POST' && normalizedPath === '/auth/register') {
    return 'auth_register';
  }
  if (normalizedMethod === 'GET' && normalizedPath === '/admin/users') {
    return 'admin_users';
  }
  if (normalizedMethod === 'GET' && normalizedPath === '/admin/audit') {
    return 'admin_audit';
  }
  if (
    normalizedMethod === 'PUT' &&
    /^\/admin\/download-modes\/configs\/[^/]+\/[^/]+$/.test(normalizedPath)
  ) {
    return 'admin_download_modes';
  }
  return null;
};

export const isTargetedHttpMetricsRoute = (
  route: ObservedRoute | null,
): route is ObservedRoute =>
  route === 'download_parse' ||
  route === 'download_get_url' ||
  route === 'download_create_task' ||
  route === 'download_task_poll' ||
  route === 'download_task_file' ||
  route === 'download_merge' ||
  route === 'proxy_fetch';

export const normalizeObservedPlatform = (value: unknown): ObservedPlatform => {
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

export const extractSourceHost = (value: string | undefined | null): string | null => {
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

export const detectObservedPlatformFromUrl = (
  value: string | undefined | null,
): ObservedPlatform => {
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

const safeJsonParse = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const extractClientTypeFromRequest = (req: Request): ObservedClientType => {
  const clientType = String((req.body as any)?.clientType || '').trim().toUpperCase();
  if (clientType === 'WEB' || clientType === 'MOBILE') {
    return clientType;
  }
  return 'unknown';
};

export const extractPlatformFromRequest = (req: Request): ObservedPlatform => {
  const body = (req.body || {}) as Record<string, unknown>;
  const directPlatform = normalizeObservedPlatform(body.platform);
  if (directPlatform !== 'unknown') {
    return directPlatform;
  }

  const parsedVideo = safeJsonParse(body.videoInfo);
  const parsedPlatform = normalizeObservedPlatform(parsedVideo?.platform);
  if (parsedPlatform !== 'unknown') {
    return parsedPlatform;
  }

  const sourceUrl =
    String(body.url || body.sourceUrl || parsedVideo?.sourceUrl || parsedVideo?.videoUrl || '') ||
    String((req.query as any)?.url || '');

  return detectObservedPlatformFromUrl(sourceUrl);
};

export const extractPlatformFromResponse = (
  route: ObservedRoute,
  payload: unknown,
): ObservedPlatform => {
  if (route !== 'download_parse') {
    return 'unknown';
  }

  const data =
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).data as Record<string, unknown> | undefined)
      : undefined;

  return normalizeObservedPlatform(data?.platform);
};

export const normalizeObservedErrorCode = (
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

  const status = response?.status;
  if (typeof status === 'number') {
    return `HTTP_${status}`;
  }

  return fallback;
};
