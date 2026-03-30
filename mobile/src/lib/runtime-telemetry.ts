import { API_BASE_URL } from '@/lib/env';
import type { Platform } from '@/types/api';

type RuntimeFeature = 'parse' | 'preview' | 'download';
type RuntimeOutcome = 'success' | 'failure';
export type RuntimeTraceStage = 'parse' | 'preview' | 'download';

interface RuntimeClientEventPayload {
  feature: RuntimeFeature;
  clientType: 'MOBILE';
  platform: Platform;
  outcome: RuntimeOutcome;
  latencyMs: number;
  eventKey: string;
  errorCode?: string;
  traceId?: string;
  candidateCount?: number;
  selectedCandidateIndex?: number;
  failoverCount?: number;
  selectedCandidateKind?: string;
  selectedQuality?: string;
}

const RUNTIME_EVENT_ENDPOINT = `${API_BASE_URL.replace(/\/+$/, '')}/runtime/client-events`;

export const createRuntimeEventKey = (feature: RuntimeFeature): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const randomPart =
    maybeCrypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${feature}:${randomPart}`;
};

export const createRuntimeTraceId = (source: RuntimeTraceStage): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const randomPart =
    maybeCrypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${source}:${randomPart}`;
};

export const normalizeRuntimeTraceId = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 128);
};

export const normalizeRuntimePlatform = (value: unknown): Platform => {
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

export const detectRuntimePlatformFromUrl = (value: string): Platform => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('douyin') || normalized.includes('iesdouyin')) {
    return 'douyin';
  }
  if (normalized.includes('bilibili') || normalized.includes('b23.tv')) {
    return 'bilibili';
  }
  if (
    normalized.includes('xiaohongshu') ||
    normalized.includes('xhslink.com') ||
    normalized.includes('xhsc.cn')
  ) {
    return 'xiaohongshu';
  }
  if (normalized.includes('kuaishou')) {
    return 'kuaishou';
  }
  if (normalized.includes('youtube') || normalized.includes('youtu.be')) {
    return 'youtube';
  }
  return 'unknown';
};

export const normalizeRuntimeErrorCode = (
  value: unknown,
  fallback = 'UNKNOWN_ERROR'
): string => {
  const direct = String(value || '').trim();
  if (!direct) {
    return fallback;
  }
  return direct
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
};

export const reportRuntimeClientEvent = (
  payload: RuntimeClientEventPayload
): void => {
  void fetch(RUNTIME_EVENT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...payload,
      latencyMs: Math.max(0, Math.round(payload.latencyMs || 0)),
      errorCode: payload.errorCode
        ? normalizeRuntimeErrorCode(payload.errorCode)
        : undefined,
      traceId: normalizeRuntimeTraceId(payload.traceId),
    }),
  }).catch(() => undefined);
};
