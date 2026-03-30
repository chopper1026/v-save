import { Injectable } from '@nestjs/common';
import type {
  DownloadTaskMetricStatus,
  ObservedClientType,
  ObservedOutcome,
  ObservedPlatform,
  ObservedRoute,
} from './observability.utils';

@Injectable()
export class ObservabilityService {
  isMetricsEnabled(): boolean {
    return false;
  }

  getMetricsContentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8';
  }

  getMetricsSnapshot(): Promise<string> {
    return Promise.resolve('');
  }

  recordHttpRequest(input: {
    route: ObservedRoute | 'unknown';
    platform: ObservedPlatform;
    clientType: ObservedClientType;
    outcome: ObservedOutcome;
    errorCode: string;
    durationMs: number;
  }): void {
    void input;
  }

  recordValidationFailure(input: {
    route: ObservedRoute | 'unknown';
    dto: string;
    field: string;
    errorType: string;
  }): void {
    void input;
  }

  initializeDownloadTaskStatusCounts(
    counts: Partial<Record<DownloadTaskMetricStatus, number>>,
  ): void {
    void counts;
  }

  recordDownloadTaskTransition(input: {
    fromStatus: DownloadTaskMetricStatus | null;
    toStatus: DownloadTaskMetricStatus;
    platform: ObservedPlatform;
  }): void {
    void input;
  }

  recordUpstreamRequest(input: {
    upstream: 'proxy_fetch' | 'yt_dlp' | 'ffmpeg_merge' | 'ffmpeg_ios_merge';
    platform: ObservedPlatform;
    outcome: ObservedOutcome;
    errorCode: string;
    durationMs: number;
  }): void {
    void input;
  }
}
