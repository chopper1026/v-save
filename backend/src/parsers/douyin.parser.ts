import { Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { VideoDownloadOptions, VideoInfo, VideoParser } from './base.interface';
import { ParserFailureError } from './parser-failure.error';
import { DouyinAuthService } from '../douyin-auth/douyin-auth.service';
import { DouyinOfficialDetailService } from '../douyin-official/douyin-official-detail.service';
import { DouyinOptimizationService } from '../douyin-optimization/douyin-optimization.service';
import { DouyinQualityService } from '../douyin-quality/douyin-quality.service';

const execFileAsync = promisify(execFile);

interface DouyinParseContext {
  originalUrl: string;
  resolvedUrl: string;
  videoId: string;
}

interface DouyinParseMetrics {
  startedAt: number;
  shareResolveMs: number;
  queueWaitMs: number;
  pacingWaitMs: number;
  officialMs: number;
  attempts: number;
  cacheHit: boolean;
  qualityCount: number;
  warmScheduled: boolean;
}

interface DouyinParseCacheMetadata {
  sessionFingerprint: string;
  qualityCount: number;
  updatedAt: number;
}

interface CachedDouyinParseResult {
  expiresAt: number;
  info: VideoInfo;
  metadata: DouyinParseCacheMetadata;
}

@Injectable()
export class DouyinParser implements VideoParser {
  private readonly logger = new Logger(DouyinParser.name);
  private readonly ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  private readonly maxAttempts = this.readPositiveIntEnv('DOUYIN_PARSE_MAX_ATTEMPTS', 3);
  private readonly parseConcurrency = this.readPositiveIntEnv(
    'DOUYIN_PARSE_CONCURRENCY',
    2,
  );
  private readonly minParseIntervalMs = this.readNonNegativeIntEnv(
    'DOUYIN_PARSE_MIN_INTERVAL_MS',
    0,
  );
  private readonly cacheTtlMs = this.readPositiveIntEnv(
    'DOUYIN_PARSE_CACHE_TTL_MS',
    20 * 60 * 1000,
  );
  private readonly retryBaseDelayMs = this.readPositiveIntEnv(
    'DOUYIN_PARSE_RETRY_BASE_MS',
    500,
  );
  private readonly retryJitterMs = this.readNonNegativeIntEnv(
    'DOUYIN_PARSE_RETRY_JITTER_MS',
    300,
  );
  private readonly optimizationProbeTimeoutMs = this.readPositiveIntEnv(
    'DOUYIN_DOWNLOAD_PROBE_TIMEOUT_MS',
    6000,
  );
  private readonly parseInflight = new Map<string, Promise<VideoInfo>>();
  private readonly parseWaiters: Array<() => void> = [];
  private readonly parseCache = new Map<string, CachedDouyinParseResult>();
  private activeParseCount = 0;
  private lastParseStartedAt = 0;
  platform: VideoInfo['platform'] = 'douyin';

  constructor(
    @Optional() private readonly douyinAuthService?: DouyinAuthService,
    @Optional()
    private readonly douyinOfficialDetailService?: DouyinOfficialDetailService,
    @Optional()
    private readonly douyinOptimizationService?: DouyinOptimizationService,
    @Optional()
    private readonly douyinQualityService?: DouyinQualityService,
  ) {}

  supports(url: string): boolean {
    return (
      url.includes('douyin.com') ||
      url.includes('iesdouyin.com') ||
      url.includes('aweme') ||
      url.includes('amemv.com')
    );
  }

  async parse(url: string): Promise<VideoInfo> {
    const metrics = this.createParseMetrics();
    const context = await this.prepareParseContext(url, metrics);
    const sessionCookie = await this.getRequiredSessionCookie(context.videoId);
    const sessionFingerprint = this.buildSessionFingerprint(sessionCookie);
    const cacheKey = this.buildCacheKey(context.videoId, sessionFingerprint);
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      metrics.cacheHit = true;
      metrics.qualityCount = cached.metadata.qualityCount;
      this.logParseSuccess(context, metrics, cached.info, sessionFingerprint);
      return cached.info;
    }

    return this.getOrCreateInflight(cacheKey, () =>
      this.runWithParseSlot(metrics, () =>
        this.parseInternal(
          context,
          metrics,
          sessionCookie,
          sessionFingerprint,
          cacheKey,
        ),
      ),
    );
  }

  private async parseInternal(
    context: DouyinParseContext,
    metrics: DouyinParseMetrics,
    sessionCookie: string,
    sessionFingerprint: string,
    cacheKey: string,
  ): Promise<VideoInfo> {
    let lastParserError: ParserFailureError | null = null;

    try {
      metrics.pacingWaitMs += await this.enforceRequestPacing();

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        metrics.attempts = attempt;

        try {
          const officialStartedAt = Date.now();
          let info: VideoInfo;
          try {
            info = await this.getVideoInfoFromOfficial(
              context.videoId,
              sessionCookie,
            );
          } finally {
            metrics.officialMs += Date.now() - officialStartedAt;
          }

          const optimized = this.applyCachedOptimizationFacts(info);
          const decorated = await this.decorateParseResult(
            context.videoId,
            optimized,
          );
          const committed = this.commitParseSuccess(cacheKey, decorated, sessionFingerprint);
          metrics.qualityCount = committed.metadata.qualityCount;
          metrics.warmScheduled = this.scheduleDouyinOptimizationWarm(
            cacheKey,
            context.videoId,
            committed.info,
            sessionCookie,
          );
          this.logParseSuccess(
            context,
            metrics,
            committed.info,
            sessionFingerprint,
          );
          return committed.info;
        } catch (error: any) {
          if (!(error instanceof ParserFailureError)) {
            throw error;
          }

          lastParserError = error;
          const shouldRetry = error.retryable && attempt < this.maxAttempts;
          if (!shouldRetry) {
            throw error;
          }

          const waitMs = this.computeRetryWaitMs(attempt);
          this.logger.warn(
            `抖音官方解析重试: attempt=${attempt}/${this.maxAttempts}, code=${error.code}, wait=${waitMs}ms`,
          );
          await this.sleep(waitMs);
        }
      }

      if (lastParserError) {
        throw lastParserError;
      }

      throw new ParserFailureError({
        code: 'DOUYIN_PARSE_FAILED',
        message: '抖音视频解析失败，请稍后重试',
        category: 'parse_failed',
        retryable: true,
        platform: 'douyin',
      });
    } catch (error: any) {
      if (error instanceof ParserFailureError) {
        this.logParseFailure(context, metrics, error, sessionFingerprint);
        throw error;
      }

      const wrapped = new ParserFailureError({
        code: 'DOUYIN_PARSE_FAILED',
        message: '抖音视频解析失败，请稍后重试',
        category: 'parse_failed',
        retryable: true,
        platform: 'douyin',
        details: {
          cause: error?.message || 'unknown',
        },
      });
      this.logParseFailure(context, metrics, wrapped, sessionFingerprint);
      throw wrapped;
    }
  }

  private async getVideoInfoFromOfficial(
    videoId: string,
    sessionCookie: string,
  ): Promise<VideoInfo> {
    if (!this.douyinOfficialDetailService) {
      throw new ParserFailureError({
        code: 'DOUYIN_PARSE_FAILED',
        message: '缺少抖音官方详情服务',
        category: 'parse_failed',
        retryable: false,
        platform: 'douyin',
      });
    }

    try {
      return await this.douyinOfficialDetailService.fetchVideoInfo(
        videoId,
        sessionCookie,
      );
    } catch (error: any) {
      throw this.classifyOfficialDetailFailure(videoId, error);
    }
  }

  private classifyOfficialDetailFailure(
    videoId: string,
    error: any,
  ): ParserFailureError {
    const status = Number(
      error?.status ||
      error?.response?.status ||
      error?.response?.data?.status_code ||
      0,
    ) || undefined;
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const snippet = this.snipText(error?.responseData || error?.response?.data);
    const textPool = `${message} ${snippet}`.toLowerCase();
    const details = {
      videoId,
      status: status || null,
      cause: message || 'unknown',
      source: 'official_detail',
    };

    if (
      [401, 403, 418, 429].includes(status || 0) ||
      this.containsAny(textPool, [
        '请完成验证',
        '请通过验证',
        '验证后继续访问',
        'captcha',
        'human verification',
        'security check',
        'risk',
      ])
    ) {
      return new ParserFailureError({
        code: 'DOUYIN_RISK_CONTROL',
        message:
          '抖音触发风控校验，暂时无法解析。请稍后重试，或更新服务端抖音登录态后再试。',
        category: 'risk_control',
        retryable: true,
        platform: 'douyin',
        details,
      });
    }

    if (
      [404, 410].includes(status || 0) ||
      this.containsAny(textPool, [
        '内容不存在',
        '视频不存在',
        '该内容已被删除',
        '私密',
        '不可见',
        'unavailable',
      ])
    ) {
      return new ParserFailureError({
        code: 'DOUYIN_VIDEO_UNAVAILABLE',
        message: '该抖音视频当前不可访问（可能已删除、私密或地区限制）',
        category: 'video_unavailable',
        retryable: false,
        platform: 'douyin',
        details,
      });
    }

    if (
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND'].includes(code) ||
      (status || 0) >= 500
    ) {
      return new ParserFailureError({
        code: 'DOUYIN_UPSTREAM_UNSTABLE',
        message: '抖音服务暂时不可用，请稍后重试',
        category: 'upstream',
        retryable: true,
        platform: 'douyin',
        details,
      });
    }

    return new ParserFailureError({
      code: 'DOUYIN_PARSE_FAILED',
      message: '未能提取到可下载的视频地址，请稍后重试',
      category: 'parse_failed',
      retryable: true,
      platform: 'douyin',
      details,
    });
  }

  private async decorateParseResult(
    videoId: string,
    info: VideoInfo,
  ): Promise<VideoInfo> {
    if (!this.douyinQualityService) {
      return info;
    }

    return this.douyinQualityService.prepareParseResult(videoId, info);
  }

  private async prepareParseContext(
    url: string,
    metrics: DouyinParseMetrics,
  ): Promise<DouyinParseContext> {
    const originalUrl = String(url || '').trim();
    let resolvedUrl = originalUrl;

    if (originalUrl.includes('v.douyin.com')) {
      const startedAt = Date.now();
      resolvedUrl = await this.resolveShareUrl(originalUrl);
      metrics.shareResolveMs += Date.now() - startedAt;
    }

    const unsupportedLinkType =
      this.detectUnsupportedDouyinLinkType(resolvedUrl) ||
      this.detectUnsupportedDouyinLinkType(originalUrl);
    if (unsupportedLinkType) {
      throw this.createUnsupportedLinkError(
        unsupportedLinkType,
        resolvedUrl || originalUrl,
      );
    }

    const videoId = this.extractVideoId(resolvedUrl) || this.extractVideoId(originalUrl);
    if (!videoId) {
      throw new ParserFailureError({
        code: 'DOUYIN_INVALID_URL',
        message: '无法识别抖音视频链接，请粘贴完整分享链接后重试',
        category: 'invalid_input',
        retryable: false,
        platform: 'douyin',
        details: {
          input: originalUrl.slice(0, 256),
        },
      });
    }

    return {
      originalUrl,
      resolvedUrl,
      videoId,
    };
  }

  private async getRequiredSessionCookie(videoId: string): Promise<string> {
    const managedCookie = this.douyinAuthService
      ? await this.douyinAuthService.getCookieHeader().catch(() => '')
      : '';
    const configuredCookie = String(process.env.DOUYIN_COOKIE || '').trim();
    const sessionCookie = String(managedCookie || configuredCookie || '').trim();
    if (sessionCookie) {
      return sessionCookie;
    }

    throw new ParserFailureError({
      code: 'DOUYIN_SESSION_REQUIRED',
      message: '服务端抖音登录态已失效，请后台重新登录后再试',
      category: 'parse_failed',
      retryable: false,
      platform: 'douyin',
      details: {
        videoId,
      },
    });
  }

  private buildSessionFingerprint(cookieHeader: string): string {
    return createHash('sha256')
      .update(String(cookieHeader || '').trim())
      .digest('hex')
      .slice(0, 16);
  }

  private buildCacheKey(videoId: string, sessionFingerprint: string): string {
    return `${videoId}|${sessionFingerprint}`;
  }

  private getOrCreateInflight(
    key: string,
    factory: () => Promise<VideoInfo>,
  ): Promise<VideoInfo> {
    const existing = this.parseInflight.get(key);
    if (existing) {
      return existing;
    }

    const created = factory().finally(() => {
      if (this.parseInflight.get(key) === created) {
        this.parseInflight.delete(key);
      }
    });
    this.parseInflight.set(key, created);
    return created;
  }

  private async runWithParseSlot<T>(
    metrics: DouyinParseMetrics,
    task: () => Promise<T>,
  ): Promise<T> {
    const queuedAt = Date.now();
    await this.acquireParseSlot();
    metrics.queueWaitMs += Date.now() - queuedAt;
    try {
      return await task();
    } finally {
      this.releaseParseSlot();
    }
  }

  private async acquireParseSlot(): Promise<void> {
    if (this.activeParseCount < this.parseConcurrency) {
      this.activeParseCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.parseWaiters.push(resolve);
    });
    this.activeParseCount += 1;
  }

  private releaseParseSlot(): void {
    this.activeParseCount = Math.max(0, this.activeParseCount - 1);
    const next = this.parseWaiters.shift();
    next?.();
  }

  private createParseMetrics(): DouyinParseMetrics {
    return {
      startedAt: Date.now(),
      shareResolveMs: 0,
      queueWaitMs: 0,
      pacingWaitMs: 0,
      officialMs: 0,
      attempts: 0,
      cacheHit: false,
      qualityCount: 0,
      warmScheduled: false,
    };
  }

  private logParseSuccess(
    context: DouyinParseContext,
    metrics: DouyinParseMetrics,
    info: VideoInfo,
    sessionFingerprint: string,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'douyin_parse_timing',
        success: true,
        source: 'official_detail',
        videoId: context.videoId,
        platform: info.platform,
        cacheHit: metrics.cacheHit,
        attempts: metrics.attempts,
        qualityCount: metrics.qualityCount,
        sessionFingerprint,
        warmScheduled: metrics.warmScheduled,
        queueWaitMs: metrics.queueWaitMs,
        pacingWaitMs: metrics.pacingWaitMs,
        shareResolveMs: metrics.shareResolveMs,
        officialMs: metrics.officialMs,
        totalMs: Date.now() - metrics.startedAt,
      }),
    );
  }

  private logParseFailure(
    context: DouyinParseContext,
    metrics: DouyinParseMetrics,
    error: ParserFailureError,
    sessionFingerprint: string,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'douyin_parse_timing',
        success: false,
        source: 'official_detail',
        videoId: context.videoId,
        errorCode: error.code,
        retryable: error.retryable,
        attempts: metrics.attempts,
        qualityCount: metrics.qualityCount,
        sessionFingerprint,
        warmScheduled: metrics.warmScheduled,
        queueWaitMs: metrics.queueWaitMs,
        pacingWaitMs: metrics.pacingWaitMs,
        shareResolveMs: metrics.shareResolveMs,
        officialMs: metrics.officialMs,
        totalMs: Date.now() - metrics.startedAt,
        message: error.message,
      }),
    );
  }

  private async enforceRequestPacing(): Promise<number> {
    if (this.minParseIntervalMs <= 0) {
      this.lastParseStartedAt = Date.now();
      return 0;
    }

    const now = Date.now();
    const waitMs = this.minParseIntervalMs - (now - this.lastParseStartedAt);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    this.lastParseStartedAt = Date.now();
    return Math.max(0, waitMs);
  }

  private scheduleDouyinOptimizationWarm(
    cacheKey: string,
    videoId: string,
    info: VideoInfo,
    sessionCookie: string,
  ): boolean {
    if (!this.douyinOptimizationService) {
      return false;
    }

    const qualityMap = info.downloadOptions?.merged || {};
    if (Object.keys(qualityMap).length === 0) {
      return false;
    }

    const videoStreamId =
      this.extractDouyinVideoStreamId(info.videoUrl) ||
      this.extractDouyinStreamIdFromQualityMap(qualityMap);
    if (!videoStreamId) {
      return false;
    }

    void this.douyinOptimizationService
      .runWarmTaskOnce(videoStreamId, async () => {
        await this.warmOfficialCandidates(cacheKey, videoId, info, sessionCookie);
      })
      .catch((error: any) => {
        this.logger.debug(
          `抖音官方线路 warm 校验失败: ${error?.message || 'unknown'}`,
        );
      });

    return true;
  }

  private async warmOfficialCandidates(
    cacheKey: string,
    videoId: string,
    info: VideoInfo,
    sessionCookie: string,
  ): Promise<void> {
    if (!this.douyinOptimizationService) {
      return;
    }

    const qualityMap = info.downloadOptions?.merged || {};
    const entries = Object.entries(qualityMap);
    if (entries.length === 0) {
      return;
    }

    for (const [quality, candidateUrl] of entries) {
      const result = await this.probeDouyinOptimizationCandidate(
        candidateUrl,
        quality,
        sessionCookie,
      );
      if (result.status === 'ok') {
        this.douyinOptimizationService.upsertFact(result.fact);
      }
    }

    const optimized = this.applyCachedOptimizationFacts(info);
    this.commitParseSuccess(
      cacheKey,
      {
        ...optimized,
        qualityStatus: info.qualityStatus,
        qualityRefreshKey: info.qualityRefreshKey,
        qualityMessage: info.qualityMessage,
      },
      this.extractSessionFingerprintFromCacheKey(cacheKey),
    );
  }

  private async probeDouyinOptimizationCandidate(
    candidateUrl: string,
    requestedQuality: string,
    activeCookie?: string,
  ): Promise<
    | {
        status: 'ok';
        fact: Parameters<DouyinOptimizationService['upsertFact']>[0];
      }
    | { status: 'miss' | 'risk' }
  > {
    const primary = await this.probeDouyinOptimizationStream(
      candidateUrl,
      activeCookie,
    );
    if (primary.status === 'risk') {
      return primary;
    }
    if (primary.status === 'ok') {
      return {
        status: 'ok',
        fact: this.buildDouyinOptimizationFact(
          candidateUrl,
          requestedQuality,
          primary,
          false,
        ),
      };
    }

    const alternateUrl = this.resolveDouyinAlternatePlayUrl(candidateUrl);
    if (!alternateUrl) {
      return { status: 'miss' };
    }

    const alternate = await this.probeDouyinOptimizationStream(
      alternateUrl,
      activeCookie,
    );
    if (alternate.status !== 'ok') {
      return alternate;
    }

    return {
      status: 'ok',
      fact: this.buildDouyinOptimizationFact(
        candidateUrl,
        requestedQuality,
        alternate,
        this.isDouyinPlayToPlaywmFallback(candidateUrl, alternateUrl),
      ),
    };
  }

  private buildDouyinOptimizationFact(
    candidateUrl: string,
    requestedQuality: string,
    probe: {
      finalUrl: string;
      actualUrl: string;
      width: number;
      height: number;
      quality: string;
    },
    usedWatermarkFallback: boolean,
  ): Parameters<DouyinOptimizationService['upsertFact']>[0] {
    return {
      videoStreamId: this.extractDouyinVideoStreamId(candidateUrl),
      requestedQuality: this.normalizeVideoQualityLabel(requestedQuality),
      actualQuality: this.normalizeVideoQualityLabel(probe.quality || requestedQuality),
      line: this.extractLineFromDouyinPlayUrl(candidateUrl) || '0',
      candidateUrl: this.normalizeDouyinVideoUrl(candidateUrl),
      finalUrl: this.normalizeDouyinVideoUrl(probe.finalUrl || candidateUrl),
      actualUrl: this.normalizeDouyinVideoUrl(
        probe.actualUrl || probe.finalUrl || candidateUrl,
      ),
      actualWidth: probe.width,
      actualHeight: probe.height,
      usedWatermarkFallback,
    };
  }

  private async probeDouyinOptimizationStream(
    targetUrl: string,
    activeCookie?: string,
  ): Promise<
    | {
        status: 'ok';
        finalUrl: string;
        actualUrl: string;
        width: number;
        height: number;
        quality: string;
      }
    | { status: 'miss' | 'risk' }
  > {
    const headers = this.buildDouyinOptimizationHeaders(activeCookie);
    const ffprobeResult = await this.probeDouyinResolutionWithFfprobe(
      targetUrl,
      headers,
    );
    if (ffprobeResult) {
      return {
        status: 'ok',
        finalUrl: ffprobeResult.finalUrl || targetUrl,
        actualUrl: ffprobeResult.finalUrl || targetUrl,
        width: ffprobeResult.width,
        height: ffprobeResult.height,
        quality: this.mapResolutionToQuality(ffprobeResult.width, ffprobeResult.height),
      };
    }

    try {
      const response = await axios.get(targetUrl, {
        headers,
        timeout: this.optimizationProbeTimeoutMs,
        maxRedirects: 3,
        responseType: 'stream',
        validateStatus: () => true,
      });
      if (response?.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }

      if ([401, 403, 418, 429].includes(response.status)) {
        return { status: 'risk' };
      }

      const finalUrl = response?.request?.res?.responseUrl || targetUrl;
      const width = Number(response.headers?.['x-video-width']) || 0;
      const height = Number(response.headers?.['x-video-height']) || 0;
      if (width > 0 && height > 0) {
        return {
          status: 'ok',
          finalUrl,
          actualUrl: finalUrl,
          width,
          height,
          quality: this.mapResolutionToQuality(width, height),
        };
      }
    } catch (_error) {
      return { status: 'miss' };
    }

    return { status: 'miss' };
  }

  private buildDouyinOptimizationHeaders(
    activeCookie?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      Referer: 'https://www.douyin.com/',
      Origin: 'https://www.douyin.com',
      Accept: '*/*',
      Range: 'bytes=0-131071',
    };
    if (activeCookie) {
      headers.Cookie = activeCookie;
    }
    return headers;
  }

  private async probeDouyinResolutionWithFfprobe(
    targetUrl: string,
    headers: Record<string, string>,
  ): Promise<{ width: number; height: number; finalUrl?: string } | null> {
    const headerLines = Object.entries(headers)
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');
    const ffprobeArgs = [
      '-v',
      'error',
      '-rw_timeout',
      String(this.optimizationProbeTimeoutMs * 1000),
      '-analyzeduration',
      '2000000',
      '-probesize',
      '2000000',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      '-headers',
      `${headerLines}\r\n`,
      targetUrl,
    ];

    try {
      const { stdout } = await execFileAsync(this.ffprobePath, ffprobeArgs, {
        timeout: this.optimizationProbeTimeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || '{}');
      const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
      const width = Number(stream?.width) || 0;
      const height = Number(stream?.height) || 0;
      if (width > 0 && height > 0) {
        return {
          width,
          height,
          finalUrl: targetUrl,
        };
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  private applyCachedOptimizationFacts(info: VideoInfo): VideoInfo {
    return info;
  }

  private extractDouyinStreamIdFromQualityMap(
    qualityMap: Record<string, string>,
  ): string {
    for (const value of Object.values(qualityMap || {})) {
      const streamId = this.extractDouyinVideoStreamId(value);
      if (streamId) {
        return streamId;
      }
    }
    return '';
  }

  private extractDouyinVideoStreamId(videoUrl: string): string {
    if (!videoUrl) {
      return '';
    }

    try {
      const parsed = new URL(videoUrl);
      const streamId = parsed.searchParams.get('video_id');
      return streamId || '';
    } catch (_error) {
      const matched = videoUrl.match(/[?&]video_id=([^&#]+)/i);
      return matched?.[1] ? decodeURIComponent(matched[1]) : '';
    }
  }

  private extractLineFromDouyinPlayUrl(url: string): string {
    if (!url) {
      return '';
    }

    try {
      const parsed = new URL(url);
      return parsed.searchParams.get('line') || '';
    } catch (_error) {
      const matched = url.match(/[?&]line=([^&#]+)/i);
      return matched?.[1] || '';
    }
  }

  private resolveDouyinAlternatePlayUrl(url: string): string | null {
    if (!this.isDouyinPlayLikeUrl(url)) {
      return null;
    }
    if (url.includes('/aweme/v1/play/')) {
      return url.replace('/aweme/v1/play/', '/aweme/v1/playwm/');
    }
    if (url.includes('/aweme/v1/playwm/')) {
      return url.replace('/aweme/v1/playwm/', '/aweme/v1/play/');
    }
    return null;
  }

  private isDouyinPlayLikeUrl(url: string): boolean {
    return /\/aweme\/v1\/play(?:wm)?\//i.test(String(url || ''));
  }

  private isDouyinPlayToPlaywmFallback(
    currentUrl: string,
    alternateUrl: string | null,
  ): boolean {
    return (
      currentUrl.includes('/aweme/v1/play/') &&
      String(alternateUrl || '').includes('/aweme/v1/playwm/')
    );
  }

  private mapResolutionToQuality(width?: number, height?: number): string {
    const shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
    if (shortEdge >= 2160) {
      return '4k';
    }
    if (shortEdge >= 1440) {
      return '1440p';
    }
    if (shortEdge >= 1080) {
      return '1080p';
    }
    if (shortEdge >= 720) {
      return '720p';
    }
    if (shortEdge >= 540) {
      return '540p';
    }
    if (shortEdge >= 480) {
      return '480p';
    }
    return '360p';
  }

  private getCachedResult(cacheKey: string): CachedDouyinParseResult | null {
    const existing = this.parseCache.get(cacheKey);
    if (!existing) {
      return null;
    }
    if (existing.expiresAt <= Date.now()) {
      this.parseCache.delete(cacheKey);
      return null;
    }
    return existing;
  }

  private commitParseSuccess(
    cacheKey: string,
    info: VideoInfo,
    sessionFingerprint: string,
  ): CachedDouyinParseResult {
    const next = this.buildParseCacheEntry(info, sessionFingerprint);
    const existing = this.getCachedResult(cacheKey);
    const selected =
      !existing || this.compareCachedResults(next, existing) >= 0
        ? next
        : existing;

    if (!existing || selected === next) {
      this.parseCache.set(cacheKey, selected);
    }

    return selected;
  }

  private buildParseCacheEntry(
    info: VideoInfo,
    sessionFingerprint: string,
  ): CachedDouyinParseResult {
    const qualityCount = this.collectAvailableVideoQualities(info.downloadOptions).length;
    return {
      expiresAt: Date.now() + this.cacheTtlMs,
      info,
      metadata: {
        sessionFingerprint,
        qualityCount,
        updatedAt: Date.now(),
      },
    };
  }

  private compareCachedResults(
    left: CachedDouyinParseResult,
    right: CachedDouyinParseResult,
  ): number {
    const qualityGap = left.metadata.qualityCount - right.metadata.qualityCount;
    if (qualityGap !== 0) {
      return qualityGap;
    }

    const bestQualityGap =
      this.getBestVideoQualityRank(left.info.downloadOptions) -
      this.getBestVideoQualityRank(right.info.downloadOptions);
    if (bestQualityGap !== 0) {
      return bestQualityGap;
    }

    return left.metadata.updatedAt - right.metadata.updatedAt;
  }

  private collectAvailableVideoQualities(options?: VideoDownloadOptions): string[] {
    if (!options) {
      return [];
    }

    return Array.from(
      new Set(
        [...Object.keys(options.merged || {}), ...Object.keys(options.video || {})]
          .map((quality) => this.normalizeVideoQualityLabel(quality))
          .filter(Boolean),
      ),
    );
  }

  private getBestVideoQualityRank(options?: VideoDownloadOptions): number {
    return this.collectAvailableVideoQualities(options).reduce((best, quality) => {
      return Math.max(best, this.getVideoQualityRank(quality));
    }, -1);
  }

  private getVideoQualityRank(quality: string): number {
    const order = ['360p', '480p', '540p', '720p', '1080p', '1440p', '4k'];
    return order.indexOf(this.normalizeVideoQualityLabel(quality));
  }

  private normalizeVideoQualityLabel(raw: string): string {
    const lower = String(raw || '').trim().toLowerCase();
    if (!lower) {
      return '';
    }
    if (lower.includes('4k') || lower.includes('2160')) {
      return '4k';
    }
    if (lower.includes('1440')) {
      return '1440p';
    }
    if (lower.includes('1080')) {
      return '1080p';
    }
    if (lower.includes('720')) {
      return '720p';
    }
    if (lower.includes('540')) {
      return '540p';
    }
    if (lower.includes('480')) {
      return '480p';
    }
    if (lower.includes('360')) {
      return '360p';
    }
    return '';
  }

  private mergeDownloadOptions(
    current?: VideoDownloadOptions,
    incoming?: VideoDownloadOptions,
  ): VideoDownloadOptions | undefined {
    const merged: VideoDownloadOptions = {
      merged: {
        ...(current?.merged || {}),
        ...(incoming?.merged || {}),
      },
      video: {
        ...(current?.video || {}),
        ...(incoming?.video || {}),
      },
      videoCandidates: {
        ...(current?.videoCandidates || {}),
        ...(incoming?.videoCandidates || {}),
      },
      audio: {
        ...(current?.audio || {}),
        ...(incoming?.audio || {}),
      },
    };

    if (!this.hasAnyDownloadOptions(merged)) {
      return undefined;
    }

    if (merged.merged && Object.keys(merged.merged).length === 0) {
      delete merged.merged;
    }
    if (merged.video && Object.keys(merged.video).length === 0) {
      delete merged.video;
    }
    if (merged.videoCandidates && Object.keys(merged.videoCandidates).length === 0) {
      delete merged.videoCandidates;
    }
    if (merged.audio && Object.keys(merged.audio).length === 0) {
      delete merged.audio;
    }

    return merged;
  }

  private hasAnyDownloadOptions(options?: VideoDownloadOptions): boolean {
    if (!options) {
      return false;
    }

    return !!(
      (options.merged && Object.keys(options.merged).length > 0) ||
      (options.video && Object.keys(options.video).length > 0) ||
      (options.videoCandidates && Object.keys(options.videoCandidates).length > 0) ||
      (options.audio && Object.keys(options.audio).length > 0)
    );
  }

  private pickTopVideoUrlFromMap(
    qualityMap?: Record<string, string>,
  ): string {
    if (!qualityMap) {
      return '';
    }

    const order = ['4k', '1440p', '1080p', '720p', '540p', '480p', '360p'];
    for (const quality of order) {
      const candidate = qualityMap[quality];
      if (candidate) {
        return candidate;
      }
    }

    return Object.values(qualityMap)[0] || '';
  }

  private normalizeDouyinVideoUrl(url: string): string {
    if (!url) {
      return '';
    }
    return String(url).replace('/aweme/v1/playwm/', '/aweme/v1/play/');
  }

  private computeRetryWaitMs(attempt: number): number {
    const exp = Math.max(0, attempt - 1);
    const backoff = this.retryBaseDelayMs * 2 ** exp;
    const jitter = Math.floor(Math.random() * Math.max(1, this.retryJitterMs));
    return backoff + jitter;
  }

  private async resolveShareUrl(shareUrl: string): Promise<string> {
    try {
      const response = await axios.get(shareUrl, {
        maxRedirects: 5,
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        },
      });
      return response.request?.res?.responseUrl || shareUrl;
    } catch (error: any) {
      this.logger.warn(`抖音分享链接解析失败: ${error?.message || 'unknown'}`);
      return shareUrl;
    }
  }

  private extractVideoId(url: string): string | null {
    const douyinMatch = url.match(/v\.douyin\.com\/([a-zA-Z0-9]+)/);
    if (douyinMatch) {
      return douyinMatch[1];
    }

    const match = url.match(/\/video\/(\d+)/);
    if (match) {
      return match[1];
    }

    const awemeMatch = url.match(/aweme\/(\w+)/);
    if (awemeMatch) {
      return awemeMatch[1];
    }

    return null;
  }

  private detectUnsupportedDouyinLinkType(targetUrl: string): 'note' | null {
    if (!targetUrl) {
      return null;
    }

    try {
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.toLowerCase();
      if (
        !host.includes('douyin.com') &&
        !host.includes('iesdouyin.com')
      ) {
        return null;
      }

      const path = parsed.pathname.toLowerCase();
      if (path.includes('/note/')) {
        return 'note';
      }
    } catch (_error) {
      if (/\/note\/\d+/i.test(targetUrl)) {
        return 'note';
      }
    }

    return null;
  }

  private createUnsupportedLinkError(
    type: 'note',
    inputUrl: string,
  ): ParserFailureError {
    return new ParserFailureError({
      code: 'DOUYIN_NOTE_UNSUPPORTED',
      message: '检测到抖音图文链接，当前仅支持视频解析，请改用视频作品链接',
      category: 'invalid_input',
      retryable: false,
      platform: 'douyin',
      details: {
        type,
        input: String(inputUrl || '').slice(0, 256),
      },
    });
  }

  private extractSessionFingerprintFromCacheKey(cacheKey: string): string {
    const parts = String(cacheKey || '').split('|');
    return parts[1] || '';
  }

  private containsAny(source: string, parts: string[]): boolean {
    return parts.some((part) => source.includes(part.toLowerCase()));
  }

  private snipText(input: any): string {
    if (typeof input === 'string') {
      return input.slice(0, 400);
    }
    if (input && typeof input === 'object') {
      try {
        return JSON.stringify(input).slice(0, 400);
      } catch {
        return '';
      }
    }
    return '';
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readNonNegativeIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
