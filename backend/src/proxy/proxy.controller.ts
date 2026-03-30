import { Controller, Get, Query, Res, Req, Logger, Optional, OnModuleDestroy } from '@nestjs/common';
import { Response, Request } from 'express';
import axios from 'axios';
import * as https from 'https';
import { BilibiliAuthService } from '../bilibili-auth/bilibili-auth.service';
import { DouyinAuthService } from '../douyin-auth/douyin-auth.service';
import { ObservabilityService } from '../observability/observability.service';
import { RequestContextService } from '../observability/request-context.service';
import { RuntimeMonitorService } from '../runtime-monitor/runtime-monitor.service';
import type {
  RuntimeClientType,
  RuntimeTraceStage,
} from '../runtime-monitor/runtime-monitor.types';
import {
  normalizeRuntimeClientType,
  normalizeRuntimePlatform,
  normalizeRuntimeTraceId,
} from '../runtime-monitor/runtime-monitor.utils';
import {
  detectObservedPlatformFromUrl,
  extractSourceHost,
  normalizeObservedErrorCode,
} from '../observability/observability.utils';

/**
 * 视频/图片代理控制器
 * 使用axios实现，解决跨域和403问题
 */
@Controller('proxy')
export class ProxyController implements OnModuleDestroy {
  private readonly logger = new Logger(ProxyController.name);
  private readonly upstreamConnectTimeoutMs = this.readPositiveIntEnv(
    'PROXY_UPSTREAM_CONNECT_TIMEOUT_MS',
    20000,
  );
  private readonly upstreamStreamIdleTimeoutMs = this.readPositiveIntEnv(
    'PROXY_UPSTREAM_STREAM_IDLE_TIMEOUT_MS',
    5 * 60 * 1000,
  );
  private readonly sharedHttpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 32,
    maxFreeSockets: 16,
    rejectUnauthorized: false,
  });

  constructor(
    private readonly bilibiliAuthService: BilibiliAuthService,
    @Optional() private readonly douyinAuthService?: DouyinAuthService,
    @Optional() private readonly observabilityService?: ObservabilityService,
    @Optional() private readonly requestContextService?: RequestContextService,
    @Optional() private readonly runtimeMonitorService?: RuntimeMonitorService,
  ) {}

  onModuleDestroy(): void {
    this.sharedHttpsAgent.destroy();
  }

  private logStructured(
    level: 'log' | 'warn' | 'error',
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.logger[level](
      JSON.stringify({
        event,
        requestId: this.requestContextService?.getRequestId() || null,
        ...payload,
      }),
    );
  }

  private isBilibiliMediaUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      return false;
    }

    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();

      return (
        hostname.includes('bilibili.com') ||
        hostname.includes('bilivideo.com') ||
        hostname.includes('mcdn.') ||
        hostname.includes('upos-') ||
        hostname.includes('hdslb.com') ||
        pathname.includes('/upgcxcode/') ||
        search.includes('upsig=') ||
        search.includes('uparams=') ||
        search.includes('qn_dyeid=')
      );
    } catch (_error) {
      const lower = targetUrl.toLowerCase();
      return (
        lower.includes('bilibili.com') ||
        lower.includes('bilivideo') ||
        lower.includes('upgcxcode') ||
        lower.includes('upsig=')
      );
    }
  }

  private isDouyinMediaUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      return false;
    }

    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();

      return (
        hostname.includes('douyin.com') ||
        hostname.includes('douyinvod.com') ||
        hostname.includes('douyinpic.com') ||
        hostname.includes('snssdk.com') ||
        hostname.includes('bytedance.com') ||
        hostname.includes('byteimg.com') ||
        hostname.includes('ibytedtos.com') ||
        hostname.includes('toutiaoimg.com') ||
        hostname.includes('tos-cn-') ||
        pathname.includes('/aweme/') ||
        pathname.includes('/tos-cn-p-') ||
        pathname.includes('/tos-cn-i-') ||
        search.includes('x-expires=') ||
        search.includes('x-signature=')
      );
    } catch (_error) {
      const lower = targetUrl.toLowerCase();
      return (
        lower.includes('douyin.com') ||
        lower.includes('douyinvod.com') ||
        lower.includes('douyinpic') ||
        lower.includes('snssdk.com') ||
        lower.includes('/aweme/') ||
        lower.includes('tos-cn-p-') ||
        lower.includes('x-signature=')
      );
    }
  }

  private isKuaishouMediaUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      return false;
    }

    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();

      return (
        hostname.includes('kuaishou.com') ||
        hostname.includes('kuaishou.cn') ||
        hostname.includes('kwaicdn.com') ||
        hostname.includes('oskwai.com') ||
        hostname.includes('ndcimgs.com') ||
        hostname.includes('yximgs.com') ||
        hostname.includes('wsukwai.com') ||
        hostname.includes('gifshow.com') ||
        pathname.includes('/short-video/') ||
        search.includes('kwai-not-alloc=') ||
        search.includes('clientcachekey=')
      );
    } catch (_error) {
      const lower = targetUrl.toLowerCase();
      return (
        lower.includes('kuaishou.com') ||
        lower.includes('kuaishou.cn') ||
        lower.includes('kwaicdn.com') ||
        lower.includes('oskwai.com') ||
        lower.includes('ndcimgs.com') ||
        lower.includes('yximgs.com') ||
        lower.includes('wsukwai.com') ||
        lower.includes('gifshow.com') ||
        lower.includes('kwai-not-alloc=')
      );
    }
  }

  private isXiaohongshuMediaUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      return false;
    }

    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();

      return (
        hostname.includes('xiaohongshu.com') ||
        hostname.includes('xiaohongshu.cn') ||
        hostname.includes('xhscdn.com') ||
        hostname.includes('xhslink.com') ||
        pathname.includes('/discovery/item/') ||
        search.includes('xsec_token=')
      );
    } catch (_error) {
      const lower = targetUrl.toLowerCase();
      return (
        lower.includes('xiaohongshu.com') ||
        lower.includes('xiaohongshu.cn') ||
        lower.includes('xhscdn.com') ||
        lower.includes('xhslink.com') ||
        lower.includes('xsec_token=')
      );
    }
  }

  private resolveDouyinAlternatePlayUrl(targetUrl: string): string | null {
    if (!targetUrl || !targetUrl.includes('aweme')) {
      return null;
    }

    if (targetUrl.includes('/aweme/v1/play/')) {
      return targetUrl.replace('/aweme/v1/play/', '/aweme/v1/playwm/');
    }

    if (targetUrl.includes('/aweme/v1/playwm/')) {
      return targetUrl.replace('/aweme/v1/playwm/', '/aweme/v1/play/');
    }

    return null;
  }

  private shouldRetryDouyinAlternate(error: any): boolean {
    const status = error?.response?.status;
    return status === 401 || status === 403 || status === 404;
  }

  private parseBooleanQueryValue(value: unknown, defaultValue: boolean): boolean {
    if (typeof value !== 'string') {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    return defaultValue;
  }

  private looksLikeMp4Resource(targetUrl: string): boolean {
    const normalized = String(targetUrl || '').trim();
    if (!normalized) {
      return false;
    }

    try {
      const parsed = new URL(normalized);
      const pathname = parsed.pathname.toLowerCase();
      const mimeType = String(parsed.searchParams.get('mime_type') || '').toLowerCase();
      return (
        pathname.endsWith('.mp4') ||
        pathname.endsWith('.m4s') ||
        mimeType === 'video_mp4'
      );
    } catch (_error) {
      const lower = normalized.toLowerCase();
      return (
        lower.includes('.mp4') ||
        lower.includes('.m4s') ||
        lower.includes('mime_type=video_mp4')
      );
    }
  }

  private normalizeVideoContentType(
    targetUrl: string,
    upstreamContentType: string | undefined,
  ): string {
    const normalizedUpstream = String(upstreamContentType || '').trim().toLowerCase();
    if (!normalizedUpstream) {
      return 'video/mp4';
    }

    if (normalizedUpstream.startsWith('application/octet-stream') && this.looksLikeMp4Resource(targetUrl)) {
      return 'video/mp4';
    }

    return normalizedUpstream;
  }

  private resolveRuntimeTraceMeta(req: Request): {
    traceId: string | null;
    clientType: RuntimeClientType;
    stage: RuntimeTraceStage;
  } {
    const queryAny = (req?.query || {}) as Record<string, unknown>;
    const headersAny = (req?.headers || {}) as Record<string, unknown>;
    const traceId = normalizeRuntimeTraceId(
      queryAny.runtimeTraceId ||
        queryAny.rtid ||
        headersAny['x-runtime-trace-id'] ||
        headersAny['X-RUNTIME-TRACE-ID'],
    );
    const clientType = normalizeRuntimeClientType(queryAny.runtimeClientType);
    const stageRaw = String(queryAny.runtimeStage || '').trim().toLowerCase();
    const stage: RuntimeTraceStage =
      stageRaw === 'parse' || stageRaw === 'download' ? stageRaw : 'preview';
    return {
      traceId,
      clientType,
      stage,
    };
  }

  private recordRuntimeInterfaceEvent(input: {
    traceId: string | null;
    platform: string;
    clientType: RuntimeClientType;
    stage: RuntimeTraceStage;
    interfaceName: string;
    outcome: 'success' | 'failure';
    latencyMs: number;
    errorCode?: string | null;
  }): void {
    if (!input.traceId) {
      return;
    }
    void this.runtimeMonitorService?.recordInterfaceEvent({
      traceId: input.traceId,
      platform: normalizeRuntimePlatform(input.platform),
      clientType: input.clientType,
      stage: input.stage,
      interfaceName: input.interfaceName,
      outcome: input.outcome,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode || undefined,
    });
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (typeof raw !== 'string' || !raw.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private resolveXiaohongshuAlternateUrls(targetUrl: string): string[] {
    if (!targetUrl) {
      return [];
    }

    try {
      const parsed = new URL(targetUrl);
      const hostname = parsed.hostname.toLowerCase();
      if (!hostname.includes('xhscdn.com')) {
        return [];
      }

      const appendAlternate = (set: Set<string>, value: string) => {
        if (!value || value === targetUrl) {
          return;
        }
        set.add(value);
      };

      const alternates = new Set<string>();
      const isImageRequest =
        !this.isXiaohongshuStreamUrl(targetUrl);

      if (isImageRequest) {
        if (targetUrl.includes('!nd_dft_')) {
          appendAlternate(
            alternates,
            targetUrl.replace(/!nd_dft_/gi, '!nd_prv_'),
          );
        }
        if (targetUrl.includes('!nd_prv_')) {
          appendAlternate(
            alternates,
            targetUrl.replace(/!nd_prv_/gi, '!nd_dft_'),
          );
        }
        if (targetUrl.includes('wb_dft')) {
          appendAlternate(
            alternates,
            targetUrl.replace(/wb_dft/gi, 'wb_prv'),
          );
        }
        if (targetUrl.includes('wb_prv')) {
          appendAlternate(
            alternates,
            targetUrl.replace(/wb_prv/gi, 'wb_dft'),
          );
        }

        appendAlternate(
          alternates,
          targetUrl.replace(/![^/?#]+(?=($|\?|#))/g, ''),
        );

        if (parsed.protocol === 'http:') {
          const httpsVariant = new URL(targetUrl);
          httpsVariant.protocol = 'https:';
          appendAlternate(alternates, httpsVariant.toString());
        }

        return Array.from(alternates);
      }

      const fallbackHosts = [
        'sns-bak-v1.xhscdn.com',
        'sns-video-hw.xhscdn.com',
        'sns-video-bd.xhscdn.com',
      ].filter((host) => host !== hostname);

      for (const host of fallbackHosts) {
        const fallback = new URL(targetUrl);
        fallback.hostname = host;
        appendAlternate(alternates, fallback.toString());
      }

      return Array.from(alternates);
    } catch (_error) {
      return [];
    }
  }

  private isXiaohongshuStreamUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      return false;
    }

    try {
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      return (
        host.startsWith('sns-video-') ||
        pathname.includes('/stream/') ||
        pathname.endsWith('.mp4') ||
        pathname.endsWith('.m3u8')
      );
    } catch (_error) {
      const lower = targetUrl.toLowerCase();
      return (
        lower.includes('/stream/') ||
        lower.includes('.mp4') ||
        lower.includes('.m3u8')
      );
    }
  }

  private shouldRetryXiaohongshuAlternate(error: any): boolean {
    const status = error?.response?.status;
    if (status === 403 || status === 404 || status === 429) {
      return true;
    }
    if (typeof status === 'number' && status >= 500) {
      return true;
    }

    const errorCode = String(error?.code || '').toUpperCase();
    return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(errorCode);
  }

  private async fetchUpstreamStream(
    targetUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
  ) {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, this.upstreamConnectTimeoutMs);
    timeoutTimer.unref?.();

    try {
      return await axios({
        method: 'GET',
        url: targetUrl,
        headers,
        responseType: 'stream',
        // 超长视频下载不设置硬超时，避免中途被 axios 全局超时中断。
        timeout: 0,
        signal: controller.signal,
        httpsAgent,
        // 禁用代理
        proxy: false,
        // 允许 CDN 跳转
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private async fetchObservedUpstreamStream(
    targetUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    runtimeMeta?: {
      traceId: string | null;
      clientType: RuntimeClientType;
      stage: RuntimeTraceStage;
    },
  ) {
    const startedAt = Date.now();
    const platform = detectObservedPlatformFromUrl(targetUrl);

    try {
      const response = await this.fetchUpstreamStream(targetUrl, headers, httpsAgent);
      this.observabilityService?.recordUpstreamRequest({
        upstream: 'proxy_fetch',
        platform,
        outcome: 'success',
        errorCode: 'NONE',
        durationMs: Date.now() - startedAt,
      });
      this.recordRuntimeInterfaceEvent({
        traceId: runtimeMeta?.traceId || null,
        platform,
        clientType: runtimeMeta?.clientType || 'unknown',
        stage: runtimeMeta?.stage || 'preview',
        interfaceName: 'proxy.fetch.upstream',
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      const errorCode = normalizeObservedErrorCode(error, 'PROXY_UPSTREAM_FAILED');
      this.observabilityService?.recordUpstreamRequest({
        upstream: 'proxy_fetch',
        platform,
        outcome: 'system_error',
        errorCode,
        durationMs: Date.now() - startedAt,
      });
      this.recordRuntimeInterfaceEvent({
        traceId: runtimeMeta?.traceId || null,
        platform,
        clientType: runtimeMeta?.clientType || 'unknown',
        stage: runtimeMeta?.stage || 'preview',
        interfaceName: 'proxy.fetch.upstream',
        outcome: 'failure',
        latencyMs: Date.now() - startedAt,
        errorCode,
      });
      throw error;
    }
  }

  private pipeUpstreamStream(upstreamStream: any, res: Response): void {
    if (!upstreamStream || typeof upstreamStream.pipe !== 'function') {
      throw new Error('upstream stream is unavailable');
    }

    if (
      this.upstreamStreamIdleTimeoutMs > 0 &&
      typeof upstreamStream.setTimeout === 'function'
    ) {
      upstreamStream.setTimeout(this.upstreamStreamIdleTimeoutMs);
    }

    const cleanup = () => {
      if (typeof upstreamStream.off === 'function') {
        upstreamStream.off('timeout', handleTimeout);
        upstreamStream.off('error', handleError);
      } else if (typeof upstreamStream.removeListener === 'function') {
        upstreamStream.removeListener('timeout', handleTimeout);
        upstreamStream.removeListener('error', handleError);
      }
      if (typeof res.off === 'function') {
        res.off('close', handleClientClose);
      } else if (typeof (res as any).removeListener === 'function') {
        (res as any).removeListener('close', handleClientClose);
      }
    };

    const handleTimeout = () => {
      const timeoutError = new Error(
        `upstream stream idle timeout (${this.upstreamStreamIdleTimeoutMs}ms)`,
      ) as Error & { code?: string };
      timeoutError.code = 'UPSTREAM_STREAM_IDLE_TIMEOUT';
      if (typeof upstreamStream.destroy === 'function') {
        upstreamStream.destroy(timeoutError);
      }
    };

    const handleError = (error: any) => {
      cleanup();
      const errorDetail = this.resolveUpstreamErrorDetail(error);
      this.logStructured('warn', 'proxy_stream_pipe_failed', {
        errorCode: normalizeObservedErrorCode(error, 'PROXY_STREAM_FAILED'),
        message: errorDetail,
      });
      if (!res.headersSent) {
        (res.locals ||= {}).observabilityErrorCode = normalizeObservedErrorCode(
          error,
          'PROXY_STREAM_FAILED',
        );
        res.status(502).json({ error: `Failed to fetch: ${errorDetail}` });
        return;
      }
      if (!res.writableEnded && typeof res.end === 'function') {
        res.end();
      }
    };

    const handleClientClose = () => {
      cleanup();
      if (!res.writableEnded && typeof upstreamStream.destroy === 'function') {
        upstreamStream.destroy();
      }
    };

    if (typeof upstreamStream.once === 'function') {
      upstreamStream.once('timeout', handleTimeout);
      upstreamStream.once('error', handleError);
    }
    if (typeof res.once === 'function') {
      res.once('close', handleClientClose);
    }

    upstreamStream.pipe(res);
  }

  private normalizeTargetUrl(rawUrl: string): string {
    if (!rawUrl) {
      return rawUrl;
    }

    const value = rawUrl.trim();
    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    try {
      const decoded = decodeURIComponent(value);
      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }
    } catch (_error) {
      // keep original raw value when decode fails
    }

    return value;
  }

  private resolveUpstreamErrorDetail(error: any): string {
    const primaryMessage =
      typeof error?.message === 'string' ? error.message.trim() : '';
    if (primaryMessage) {
      return primaryMessage;
    }

    const status = error?.response?.status;
    const statusText =
      typeof error?.response?.statusText === 'string'
        ? error.response.statusText.trim()
        : '';
    if (typeof status === 'number') {
      return statusText
        ? `upstream responded with status ${status} ${statusText}`
        : `upstream responded with status ${status}`;
    }

    const code = typeof error?.code === 'string' ? error.code.trim() : '';
    if (code) {
      return `upstream request failed (${code})`;
    }

    const causeMessage =
      typeof error?.cause?.message === 'string'
        ? error.cause.message.trim()
        : '';
    if (causeMessage) {
      return causeMessage;
    }

    return 'upstream request failed';
  }

  /**
   * 代理视频/图片请求
   */
  @Get('fetch')
  async proxyFetch(
    @Query('url') url: string,
    @Query('type') type: string = 'video',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestStartedAt = Date.now();
    const runtimeMeta = this.resolveRuntimeTraceMeta(req);
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const targetUrl = this.normalizeTargetUrl(url);
    const platform = detectObservedPlatformFromUrl(targetUrl);
    const allowWatermarkFallback = this.parseBooleanQueryValue(
      (req.query as any)?.allowWatermarkFallback,
      true,
    );

    try {
      // 设置请求头
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      };

      const isBilibili = this.isBilibiliMediaUrl(targetUrl);

      // 根据视频平台设置Referer
      if (isBilibili) {
        headers['Referer'] = 'https://www.bilibili.com';
        headers['Origin'] = 'https://www.bilibili.com';
        const bilibiliCookie = await this.bilibiliAuthService.getCookieHeader();
        if (bilibiliCookie) {
          headers['Cookie'] = bilibiliCookie;
        }
      } else if (this.isDouyinMediaUrl(targetUrl)) {
        headers['User-Agent'] =
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
        headers['Referer'] = 'https://www.douyin.com';
        headers['Origin'] = 'https://www.douyin.com';
        if (type === 'image') {
          headers['Accept'] = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
        }
        const douyinCookie = this.douyinAuthService
          ? await this.douyinAuthService.getCookieHeader().catch(() => '')
          : '';
        if (douyinCookie) {
          headers['Cookie'] = douyinCookie;
        }
      } else if (this.isKuaishouMediaUrl(targetUrl)) {
        headers['Referer'] = 'https://www.kuaishou.com';
        headers['Origin'] = 'https://www.kuaishou.com';
      } else if (this.isXiaohongshuMediaUrl(targetUrl)) {
        headers['Referer'] = 'https://www.xiaohongshu.com';
        headers['Origin'] = 'https://www.xiaohongshu.com';
      } else if (targetUrl.includes('youtube.com') || targetUrl.includes('googlevideo')) {
        headers['Referer'] = 'https://www.youtube.com';
      }

      if (type === 'image') {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
      }

      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
        headers.Range = rangeHeader;
      }

      // 设置响应头
      if (type === 'image') {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');

      let response;
      try {
        response = await this.fetchObservedUpstreamStream(
          targetUrl,
          headers,
          this.sharedHttpsAgent,
          runtimeMeta,
        );
      } catch (error: any) {
        const douyinFallbackUrl = this.resolveDouyinAlternatePlayUrl(targetUrl);
        const isDouyinPlayToPlaywmFallback =
          targetUrl.includes('/aweme/v1/play/') &&
          (douyinFallbackUrl || '').includes('/aweme/v1/playwm/');

        if (
          douyinFallbackUrl &&
          this.shouldRetryDouyinAlternate(error) &&
          (allowWatermarkFallback || !isDouyinPlayToPlaywmFallback)
        ) {
          this.logger.warn(
            JSON.stringify({
              event: 'proxy_fetch_douyin_fallback',
              requestId: this.requestContextService?.getRequestId() || null,
              platform,
              sourceHost: extractSourceHost(targetUrl),
              fallbackHost: extractSourceHost(douyinFallbackUrl),
              upstreamStatus: error?.response?.status || 'unknown',
            }),
          );
          response = await this.fetchObservedUpstreamStream(
            douyinFallbackUrl,
            headers,
            this.sharedHttpsAgent,
            runtimeMeta,
          );
        } else if (
          douyinFallbackUrl &&
          this.shouldRetryDouyinAlternate(error) &&
          isDouyinPlayToPlaywmFallback &&
          !allowWatermarkFallback
        ) {
          const watermarkFallbackError = new Error(
            'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
          ) as Error & { code?: string };
          watermarkFallbackError.code = 'DOUYIN_WATERMARK_FALLBACK_REQUIRED';
          throw watermarkFallbackError;
        } else {
          const xhsFallbackUrls = this.resolveXiaohongshuAlternateUrls(targetUrl);
          if (
            xhsFallbackUrls.length === 0 ||
            !this.shouldRetryXiaohongshuAlternate(error)
          ) {
            throw error;
          }

          let lastError: any = error;
          for (const fallbackUrl of xhsFallbackUrls) {
            try {
              this.logger.warn(
                JSON.stringify({
                  event: 'proxy_fetch_xiaohongshu_fallback',
                  requestId: this.requestContextService?.getRequestId() || null,
                  platform,
                  sourceHost: extractSourceHost(targetUrl),
                  fallbackHost: extractSourceHost(fallbackUrl),
                  upstreamStatus: lastError?.response?.status || 'unknown',
                }),
              );
              response = await this.fetchObservedUpstreamStream(
                fallbackUrl,
                headers,
                this.sharedHttpsAgent,
                runtimeMeta,
              );
              lastError = null;
              break;
            } catch (fallbackError: any) {
              lastError = fallbackError;
              if (!this.shouldRetryXiaohongshuAlternate(fallbackError)) {
                break;
              }
            }
          }

          if (!response) {
            throw lastError || error;
          }
        }
      }

      // 转发响应头
      if (type === 'video') {
        res.setHeader(
          'Content-Type',
          this.normalizeVideoContentType(targetUrl, response.headers['content-type']),
        );
      } else if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      }
      if (response.headers['content-disposition']) {
        res.setHeader('Content-Disposition', response.headers['content-disposition']);
      }

      res.statusCode = response.status;
      this.recordRuntimeInterfaceEvent({
        traceId: runtimeMeta.traceId,
        platform,
        clientType: runtimeMeta.clientType,
        stage: runtimeMeta.stage,
        interfaceName: 'proxy.fetch',
        outcome: 'success',
        latencyMs: Date.now() - requestStartedAt,
      });

      // 流式传输
      this.pipeUpstreamStream(response.data, res);
    } catch (error: any) {
      const errorDetail = this.resolveUpstreamErrorDetail(error);
      const errorCode = normalizeObservedErrorCode(error, 'PROXY_FETCH_FAILED');

      (res.locals ||= {}).observabilityErrorCode = errorCode;
      this.logStructured('error', 'proxy_fetch_failed', {
        platform,
        sourceHost: extractSourceHost(targetUrl),
        errorCode,
        message: errorDetail,
        upstreamStatus: error?.response?.status || null,
      });
      this.recordRuntimeInterfaceEvent({
        traceId: runtimeMeta.traceId,
        platform,
        clientType: runtimeMeta.clientType,
        stage: runtimeMeta.stage,
        interfaceName: 'proxy.fetch',
        outcome: 'failure',
        latencyMs: Date.now() - requestStartedAt,
        errorCode,
      });
      if (!res.headersSent) {
        if (errorCode === 'DOUYIN_WATERMARK_FALLBACK_REQUIRED') {
          res.status(409).json({
            code: 'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
            message: '当前抖音视频仅支持带水印线路，请确认是否允许带水印下载',
            retryable: true,
          });
        } else {
          res.status(502).json({ error: 'Failed to fetch: ' + errorDetail });
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
