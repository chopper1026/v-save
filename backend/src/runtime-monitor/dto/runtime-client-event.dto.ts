import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  normalizeLatencyMs,
  normalizeRuntimeClientType,
  normalizeRuntimeOutcome,
  normalizeRuntimePlatform,
  normalizeRuntimeTraceId,
} from '../runtime-monitor.utils';
import type { RuntimeClientType, RuntimeOutcome, RuntimePlatform } from '../runtime-monitor.types';

const normalizeOptionalCount = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.trunc(parsed);
};

const normalizeOptionalLabel = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
};

export class RuntimeClientEventDto {
  @IsIn(['parse', 'preview', 'download'])
  feature: 'parse' | 'preview' | 'download';

  @Transform(({ value }) => normalizeRuntimeClientType(value))
  @IsIn(['WEB', 'MOBILE'])
  clientType: Extract<RuntimeClientType, 'WEB' | 'MOBILE'>;

  @Transform(({ value }) => normalizeRuntimePlatform(value))
  @IsIn([
    'douyin',
    'bilibili',
    'xiaohongshu',
    'kuaishou',
    'youtube',
    'unknown',
  ])
  platform: RuntimePlatform;

  @Transform(({ value }) => normalizeRuntimeOutcome(value))
  @IsIn(['success', 'failure'])
  outcome: RuntimeOutcome;

  @Transform(({ value }) => normalizeLatencyMs(value))
  @IsInt()
  @Min(0)
  latencyMs: number;

  @IsOptional()
  @IsString()
  @MaxLength(96)
  errorCode?: string;

  @IsString()
  @MaxLength(128)
  eventKey: string;

  @IsOptional()
  @Transform(({ value }) => normalizeRuntimeTraceId(value))
  @IsString()
  @MaxLength(96)
  traceId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalCount(value))
  @IsInt()
  @Min(0)
  candidateCount?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalCount(value))
  @IsInt()
  @Min(0)
  selectedCandidateIndex?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalCount(value))
  @IsInt()
  @Min(0)
  failoverCount?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalLabel(value, 64))
  @IsString()
  @MaxLength(64)
  selectedCandidateKind?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalLabel(value, 32))
  @IsString()
  @MaxLength(32)
  selectedQuality?: string;
}
