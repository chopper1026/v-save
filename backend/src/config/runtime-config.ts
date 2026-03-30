const DEFAULT_PORT = 3001;
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const resolvePort = (value: string | undefined): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }
  return parsed;
};

export const resolveCorsOrigins = (value: string | undefined): string[] => {
  const raw = String(value || '').trim();
  if (!raw) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  const deduped = new Set<string>();
  for (const item of raw.split(',')) {
    const origin = item.trim();
    if (!origin) {
      continue;
    }
    deduped.add(origin);
  }

  if (deduped.size === 0) {
    return [...DEFAULT_CORS_ORIGINS];
  }
  return [...deduped];
};

export const resolveBooleanFlag = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return fallback;
};

export const resolvePublicApiOrigin = (
  value: string | undefined,
): string | null => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin;
  } catch (_error) {
    return null;
  }
};

const pickFirstHeaderValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.split(',')[0].trim();
};

export const resolveRequestOrigin = (
  requestLike:
    | {
        headers?: Record<string, unknown>;
        protocol?: string;
        get?: (name: string) => string | undefined;
      }
    | undefined,
  fallbackOrigin?: string | null,
): string | null => {
  const headers = requestLike?.headers || {};
  const forwardedProto = pickFirstHeaderValue(headers['x-forwarded-proto']);
  const forwardedHost = pickFirstHeaderValue(headers['x-forwarded-host']);
  const host =
    forwardedHost ||
    (typeof requestLike?.get === 'function'
      ? String(requestLike.get('host') || '').trim()
      : '') ||
    pickFirstHeaderValue(headers.host);
  const protocol = forwardedProto || String(requestLike?.protocol || '').trim() || 'http';

  if (!host) {
    return fallbackOrigin || null;
  }

  return `${protocol}://${host}`;
};
