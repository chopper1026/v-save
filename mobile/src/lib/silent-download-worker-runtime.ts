import { extractApiErrorCode } from '@/lib/error';
import {
  normalizeRuntimeErrorCode,
  normalizeRuntimePlatform,
} from '@/lib/runtime-telemetry';

type SilentDownloadRuntimeFeature = 'parse' | 'download';
type SilentDownloadRuntimeFallbackCode = 'PARSE_FAILED' | 'DOWNLOAD_FAILED';

interface SilentDownloadRuntimeBaseInput {
  feature: SilentDownloadRuntimeFeature;
  platform?: unknown;
  startedAt: number;
  now?: number;
  eventKey: string;
  traceId: string;
}

export const buildSilentDownloadRuntimeHeaders = (
  traceId: string
): Record<string, string> => {
  return {
    'x-runtime-trace-id': traceId,
  };
};

export const buildSilentDownloadRuntimeSuccessEvent = (
  input: SilentDownloadRuntimeBaseInput
) => {
  const now = input.now ?? Date.now();
  return {
    feature: input.feature,
    clientType: 'MOBILE' as const,
    platform: normalizeRuntimePlatform(input.platform),
    outcome: 'success' as const,
    latencyMs: Math.max(0, now - input.startedAt),
    eventKey: input.eventKey,
    traceId: input.traceId,
  };
};

export const buildSilentDownloadRuntimeFailureEvent = (
  input: SilentDownloadRuntimeBaseInput & {
    error: unknown;
    fallbackCode: SilentDownloadRuntimeFallbackCode;
  }
) => {
  const now = input.now ?? Date.now();
  return {
    feature: input.feature,
    clientType: 'MOBILE' as const,
    platform: normalizeRuntimePlatform(input.platform),
    outcome: 'failure' as const,
    latencyMs: Math.max(0, now - input.startedAt),
    errorCode: normalizeRuntimeErrorCode(
      extractApiErrorCode(input.error) || (input.error as any)?.message,
      input.fallbackCode
    ),
    eventKey: input.eventKey,
    traceId: input.traceId,
  };
};
