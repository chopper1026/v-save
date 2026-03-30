import { APP_SCHEME } from '@/lib/env';

const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const SUPPORTED_VIDEO_HOSTS = [
  'douyin.com',
  'iesdouyin.com',
  'bilibili.com',
  'b23.tv',
  'xiaohongshu.com',
  'xiaohongshu.cn',
  'xhsc.cn',
  'xhslink.com',
  'kuaishou.com',
  'youtube.com',
  'youtu.be',
];

const trimWrappedUrl = (value: string): string => {
  let result = value.trim();
  result = result.replace(/^[<>\(\)\[\]\{\}"'“”‘’]+/, '');
  result = result.replace(/[<>\(\)\[\]\{\}"'“”‘’，。！？、；：]+$/, '');
  return result;
};

const normalizePath = (pathname: string): string => {
  const value = String(pathname || '').trim() || '/';
  if (value.length <= 1) return '/';
  return value.replace(/\/+$/g, '') || '/';
};

const TRACKING_QUERY_KEYS = new Set([
  'spm',
  'spm_id_from',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'timestamp',
  'unique_k',
  'user_id',
  'social_source',
]);

const tryDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const decodePossiblyTwice = (value: string): string => {
  const once = tryDecodeURIComponent(value);
  if (!once.includes('%')) {
    return once;
  }
  return tryDecodeURIComponent(once);
};

const isSupportedVideoUrl = (value: string): boolean => {
  const lower = value.toLowerCase();
  return SUPPORTED_VIDEO_HOSTS.some((host) => lower.includes(host));
};

export const extractSupportedVideoUrl = (raw: string): string | null => {
  const direct = trimWrappedUrl(raw);
  const directToken = direct.match(/^https?:\/\/\S+/i)?.[0];
  if (directToken) {
    const normalizedDirect = trimWrappedUrl(directToken);
    if (isSupportedVideoUrl(normalizedDirect)) {
      return normalizedDirect;
    }
  }

  const matches = raw.match(URL_PATTERN) || [];
  for (const match of matches) {
    const normalized = trimWrappedUrl(match);
    if (isSupportedVideoUrl(normalized)) {
      return normalized;
    }
  }

  return null;
};

export const buildShareAutoParseKey = (raw: string): string => {
  const target = extractSupportedVideoUrl(raw || '');
  if (!target) {
    return '';
  }

  try {
    const parsed = new URL(target);
    const host = parsed.hostname.toLowerCase();
    const path = normalizePath(parsed.pathname);

    if (host.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v') || '';
      return videoId ? `${host}/watch?v=${videoId}` : `${host}${path}`;
    }

    if (
      host.includes('b23.tv') ||
      host.includes('v.kuaishou.com') ||
      host.includes('v.douyin.com') ||
      host.includes('xhslink.com') ||
      host.includes('xhsc.cn') ||
      host.includes('youtu.be')
    ) {
      return `${host}${path}`;
    }

    if (
      host.includes('douyin.com') ||
      host.includes('iesdouyin.com') ||
      host.includes('bilibili.com') ||
      host.includes('xiaohongshu.com') ||
      host.includes('xiaohongshu.cn') ||
      host.includes('kuaishou.com')
    ) {
      return `${host}${path}`;
    }

    const params = Array.from(parsed.searchParams.entries())
      .filter(([key, value]) => {
        const normalizedKey = String(key || '').toLowerCase();
        if (!normalizedKey) return false;
        if (normalizedKey.startsWith('utm_')) return false;
        if (TRACKING_QUERY_KEYS.has(normalizedKey)) return false;
        return String(value || '').trim().length > 0;
      })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);

    return `${host}${path}${params.length ? `?${params.join('&')}` : ''}`;
  } catch {
    return String(target || '').trim().toLowerCase();
  }
};

export const extractSharedUrlFromDeepLink = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (!url.protocol.toLowerCase().startsWith(`${APP_SCHEME}:`)) {
      return null;
    }
    const viaQuery = url.searchParams.get('url');
    if (viaQuery) {
      return extractSupportedVideoUrl(decodePossiblyTwice(viaQuery));
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === 'share' || path.includes('/share')) {
      const text = url.searchParams.get('text');
      if (text) {
        return extractSupportedVideoUrl(decodePossiblyTwice(text));
      }
    }
    return null;
  } catch {
    return null;
  }
};
