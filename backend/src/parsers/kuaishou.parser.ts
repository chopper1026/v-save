import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { VideoDownloadOptions, VideoParser, VideoInfo } from './base.interface';
import { ParserFailureError } from './parser-failure.error';
import { resolveChromeExecutablePath } from '../config/executable-paths';

interface KuaishouRepresentation {
  id?: number;
  url?: string;
  backupUrl?: string[] | string;
  width?: number;
  height?: number;
  avgBitrate?: number;
  maxBitrate?: number;
  qualityType?: string;
  qualityLabel?: string;
  defaultSelect?: boolean;
}

interface KuaishouVisionVideoDetail {
  status?: number;
  author?: {
    name?: string;
  };
  photo?: {
    id?: string;
    caption?: string;
    coverUrl?: string;
    duration?: number;
    photoUrl?: string;
    photoH265Url?: string;
    manifest?: {
      adaptationSet?: Array<{
        representation?: KuaishouRepresentation[];
      }>;
    };
    videoResource?: {
      h264?: {
        adaptationSet?: Array<{
          representation?: KuaishouRepresentation[];
        }>;
      };
      hevc?: {
        adaptationSet?: Array<{
          representation?: KuaishouRepresentation[];
        }>;
      };
    };
  };
}

interface KuaishouQualityCandidate {
  quality: string;
  urls: string[];
  width: number;
  height: number;
  bitrate: number;
  source: 'manifest' | 'h264' | 'hevc' | 'photo_url' | 'photo_h265';
  defaultSelect: boolean;
}

type KuaishouProbeResult =
  | {
      status: 'ok';
      latencyMs: number;
      throughput: number;
    }
  | {
      status: 'miss' | 'risk';
    };

/**
 * 快手视频解析器
 * 新版实现说明：
 * - 通过浏览器上下文请求 GraphQL `visionVideoDetail` 获取稳定详情
 * - 引入串行队列 + 节流 + 缓存 + 冷却，降低频繁访问触发风控概率
 * - 构建多档画质映射并对候选线路做测速，提升下载稳定性
 */
@Injectable()
export class KuaishouParser implements VideoParser, OnModuleDestroy {
  private readonly logger = new Logger(KuaishouParser.name);
  platform: VideoInfo['platform'] = 'kuaishou';

  private readonly maxAttempts = this.readIntegerEnv('KUAISHOU_PARSE_MAX_ATTEMPTS', 2);
  private readonly minParseIntervalMs = this.readIntegerEnv(
    'KUAISHOU_PARSE_MIN_INTERVAL_MS',
    4000,
  );
  private readonly cacheTtlMs = this.readIntegerEnv(
    'KUAISHOU_PARSE_CACHE_TTL_MS',
    15 * 60 * 1000,
  );
  private readonly retryBaseDelayMs = this.readIntegerEnv(
    'KUAISHOU_PARSE_RETRY_BASE_MS',
    800,
  );
  private readonly retryJitterMs = this.readIntegerEnv(
    'KUAISHOU_PARSE_RETRY_JITTER_MS',
    500,
  );
  private readonly riskCooldownThreshold = this.readIntegerEnv(
    'KUAISHOU_RISK_COOLDOWN_THRESHOLD',
    3,
  );
  private readonly riskCooldownMs = this.readIntegerEnv(
    'KUAISHOU_RISK_COOLDOWN_MS',
    10 * 60 * 1000,
  );
  private readonly browserIdleTtlMs = this.readIntegerEnv(
    'KUAISHOU_BROWSER_IDLE_TTL_MS',
    30 * 1000,
  );
  private readonly browserSettleMs = this.readIntegerEnv(
    'KUAISHOU_BROWSER_SETTLE_MS',
    1200,
  );
  private readonly qualityProbeEnabled = (process.env.KUAISHOU_QUALITY_PROBE_ENABLED || 'true') !== 'false';
  private readonly qualityProbeTimeoutMs = this.readIntegerEnv(
    'KUAISHOU_QUALITY_PROBE_TIMEOUT_MS',
    6000,
  );
  private readonly qualityProbeIntervalMs = this.readIntegerEnv(
    'KUAISHOU_QUALITY_PROBE_INTERVAL_MS',
    120,
  );
  private readonly qualityProbeSampleBytes = this.readIntegerEnv(
    'KUAISHOU_QUALITY_PROBE_SAMPLE_BYTES',
    64 * 1024,
  );
  private readonly userAgent =
    process.env.KUAISHOU_BROWSER_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  private readonly browserHeadless = (process.env.KUAISHOU_BROWSER_HEADLESS || 'true') !== 'false';

  private parseQueue: Promise<void> = Promise.resolve();
  private lastParseStartedAt = 0;
  private cooldownUntil = 0;
  private consecutiveRiskFailures = 0;
  private readonly parseCache = new Map<
    string,
    { expiresAt: number; info: VideoInfo }
  >();

  private browser: any | null = null;
  private browserLaunchPromise: Promise<any> | null = null;
  private browserIdleTimer: NodeJS.Timeout | null = null;

  /**
   * 判断是否支持该URL
   */
  supports(url: string): boolean {
    return (
      url.includes('kuaishou.com') ||
      url.includes('ksurl.cn') ||
      url.includes('kuaishou.cn')
    );
  }

  /**
   * 解析视频信息
   */
  async parse(url: string): Promise<VideoInfo> {
    return this.runSerialized(async () => this.parseInternal(url));
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowser();
  }

  private async parseInternal(url: string): Promise<VideoInfo> {
    const originalInput = String(url || '').trim();
    const normalizedInput = this.extractFirstHttpUrl(originalInput) || originalInput;
    if (!normalizedInput) {
      throw new ParserFailureError({
        code: 'KUAISHOU_INVALID_URL',
        message: '快手链接为空，请粘贴完整分享链接后重试',
        category: 'invalid_input',
        retryable: false,
        platform: 'kuaishou',
      });
    }

    const resolvedUrl = await this.resolveShareUrl(normalizedInput);
    const photoId =
      this.extractPhotoId(resolvedUrl) || this.extractPhotoId(normalizedInput);
    if (!photoId) {
      throw new ParserFailureError({
        code: 'KUAISHOU_INVALID_URL',
        message: '无法识别快手视频 ID，请粘贴完整分享链接后重试',
        category: 'invalid_input',
        retryable: false,
        platform: 'kuaishou',
        details: {
          input: originalInput.slice(0, 256),
          normalizedInput: normalizedInput.slice(0, 256),
        },
      });
    }

    const cached = this.getCachedResult(photoId);
    if (cached) {
      return cached;
    }

    this.ensureNotInCooldown();
    await this.enforceRequestPacing();

    let lastParserError: ParserFailureError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.ensureNotInCooldown();
      try {
        const detail = await this.fetchVisionVideoDetailFromBrowser(
          resolvedUrl || normalizedInput,
          photoId,
        );
        const info = await this.buildVideoInfoFromVisionDetail(detail);
        this.onParseSuccess(photoId, info);
        return info;
      } catch (error: any) {
        if (!(error instanceof ParserFailureError)) {
          throw error;
        }

        lastParserError = error;
        this.onParseFailure(error);

        const shouldRetry =
          error.retryable &&
          attempt < this.maxAttempts &&
          Date.now() >= this.cooldownUntil;
        if (!shouldRetry) {
          throw error;
        }

        const waitMs = this.computeRetryWaitMs(attempt);
        this.logger.warn(
          `快手解析重试: attempt=${attempt}/${this.maxAttempts}, code=${error.code}, wait=${waitMs}ms`,
        );
        await this.sleep(waitMs);
      }
    }

    if (lastParserError) {
      throw lastParserError;
    }

    throw new ParserFailureError({
      code: 'KUAISHOU_PARSE_FAILED',
      message: '快手视频解析失败，请稍后重试',
      category: 'parse_failed',
      retryable: true,
      platform: 'kuaishou',
    });
  }

  private async runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.parseQueue;
    let release: () => void = () => undefined;

    this.parseQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  private getCachedResult(photoId: string): VideoInfo | null {
    const now = Date.now();
    const cache = this.parseCache.get(photoId);
    if (!cache) {
      return null;
    }

    if (cache.expiresAt <= now) {
      this.parseCache.delete(photoId);
      return null;
    }

    return cache.info;
  }

  private setCachedResult(photoId: string, info: VideoInfo): void {
    this.parseCache.set(photoId, {
      expiresAt: Date.now() + this.cacheTtlMs,
      info,
    });

    if (this.parseCache.size > 200) {
      const now = Date.now();
      for (const [key, value] of this.parseCache.entries()) {
        if (value.expiresAt <= now) {
          this.parseCache.delete(key);
        }
      }
    }
  }

  private ensureNotInCooldown(): void {
    const now = Date.now();
    if (this.cooldownUntil <= now) {
      return;
    }

    throw this.createCooldownError();
  }

  private createCooldownError(): ParserFailureError {
    const retryAfterMs = Math.max(0, this.cooldownUntil - Date.now());
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return new ParserFailureError({
      code: 'KUAISHOU_RISK_CONTROL',
      message: `快手风控冷却中，请在 ${retryAfterSeconds} 秒后重试`,
      category: 'risk_control',
      retryable: true,
      platform: 'kuaishou',
      details: {
        retryAfterSeconds,
        cooldownUntil: new Date(this.cooldownUntil).toISOString(),
      },
    });
  }

  private async enforceRequestPacing(): Promise<void> {
    if (this.minParseIntervalMs <= 0) {
      this.lastParseStartedAt = Date.now();
      return;
    }

    const now = Date.now();
    const waitMs = this.minParseIntervalMs - (now - this.lastParseStartedAt);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }

    this.lastParseStartedAt = Date.now();
  }

  private onParseSuccess(photoId: string, info: VideoInfo): void {
    this.consecutiveRiskFailures = 0;
    this.cooldownUntil = 0;
    this.setCachedResult(photoId, info);
  }

  private onParseFailure(error: ParserFailureError): void {
    if (error.code !== 'KUAISHOU_RISK_CONTROL') {
      this.consecutiveRiskFailures = 0;
      return;
    }

    this.consecutiveRiskFailures += 1;
    if (this.consecutiveRiskFailures >= this.riskCooldownThreshold) {
      this.cooldownUntil = Date.now() + this.riskCooldownMs;
    }
  }

  private computeRetryWaitMs(attempt: number): number {
    const exp = Math.max(0, attempt - 1);
    const backoff = this.retryBaseDelayMs * 2 ** exp;
    const jitter = Math.floor(Math.random() * this.retryJitterMs);
    return backoff + jitter;
  }

  private extractFirstHttpUrl(input: string): string {
    const raw = String(input || '');
    if (!raw.trim()) {
      return '';
    }

    const direct = this.trimWrappedUrl(raw.trim());
    const directToken = direct.match(/^https?:\/\/\S+/i)?.[0];
    if (directToken) {
      const normalized = this.trimWrappedUrl(directToken);
      if (/^https?:\/\//i.test(normalized)) {
        return normalized;
      }
    }

    const matches = raw.match(/https?:\/\/[^\s]+/gi) || [];
    for (const match of matches) {
      const candidate = this.trimWrappedUrl(match);
      if (/^https?:\/\//i.test(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  private trimWrappedUrl(value: string): string {
    let result = String(value || '').trim();
    result = result.replace(/^[<>\(\)\[\]\{\}"'“”‘’]+/, '');
    result = result.replace(/[<>\(\)\[\]\{\}"'“”‘’，。！？、；：]+$/, '');
    return result;
  }

  /**
   * 解析分享链接，获取最终 URL
   */
  private async resolveShareUrl(url: string): Promise<string> {
    if (!url) {
      return '';
    }

    try {
      const response = await axios.get(url, {
        maxRedirects: 5,
        timeout: 15000,
        headers: {
          'User-Agent': this.userAgent,
          Referer: 'https://www.kuaishou.com',
        },
      });
      return response.request?.res?.responseUrl || url;
    } catch (error: any) {
      this.logger.warn(`快手分享链接解析失败: ${error?.message || 'unknown'}`);
      return url;
    }
  }

  /**
   * 从 URL 提取 photoId
   */
  private extractPhotoId(url: string): string {
    if (!url) {
      return '';
    }

    const shortVideoMatched = url.match(/\/short-video\/([^/?&#]+)/i);
    if (shortVideoMatched?.[1]) {
      return shortVideoMatched[1];
    }

    const directMatched = url.match(/\/(?:photo|video)\/([^/?&#]+)/i);
    if (directMatched?.[1]) {
      return directMatched[1];
    }

    return '';
  }

  /**
   * 浏览器上下文请求 visionVideoDetail
   */
  private async fetchVisionVideoDetailFromBrowser(
    shareUrl: string,
    photoId: string,
  ): Promise<KuaishouVisionVideoDetail> {
    const browser = await this.acquireBrowser();
    const page = await browser.newPage();
    let responsePayload: any;

    try {
      await page.setUserAgent(this.userAgent);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      });

      await page.goto(shareUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      if (this.browserSettleMs > 0) {
        await this.sleep(this.browserSettleMs);
      }

      responsePayload = await page.evaluate(async (targetPhotoId) => {
        const query = `
          query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {
            visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {
              status
              author {
                name
              }
              photo {
                id
                duration
                caption
                coverUrl
                photoUrl
                photoH265Url
                manifest {
                  adaptationSet {
                    representation {
                      id
                      defaultSelect
                      backupUrl
                      url
                      height
                      width
                      avgBitrate
                      maxBitrate
                      qualityType
                      qualityLabel
                    }
                  }
                }
                videoResource
              }
            }
          }
        `;
        const variables = {
          photoId: targetPhotoId,
          page: 'detail',
        };

        const response = await fetch('/graphql', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operationName: 'visionVideoDetail',
            variables,
            query,
          }),
        });

        const text = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch (_error) {
          data = null;
        }

        return {
          status: response.status,
          data,
          textSnippet: String(text || '').slice(0, 1200),
        };
      }, photoId);
    } catch (error: any) {
      throw new ParserFailureError({
        code: 'KUAISHOU_BROWSER_FETCH_FAILED',
        message: '快手详情页加载失败，请稍后重试',
        category: 'upstream',
        retryable: true,
        platform: 'kuaishou',
        details: {
          cause: error?.message || 'unknown',
        },
      });
    } finally {
      await page.close().catch(() => undefined);
      this.scheduleBrowserIdleClose();
    }

    const responseStatus = Number(responsePayload?.status) || 0;
    const payload = responsePayload?.data;
    const payloadSnippet = responsePayload?.textSnippet || '';
    const errorMessages = Array.isArray(payload?.errors)
      ? payload.errors.map((item: any) => String(item?.message || '')).filter(Boolean)
      : [];
    const joinedErrorMessages = errorMessages.join(' | ').toLowerCase();

    if (this.isKuaishouRiskControlPayload(payload, joinedErrorMessages, payloadSnippet)) {
      throw new ParserFailureError({
        code: 'KUAISHOU_RISK_CONTROL',
        message: '快手触发风控校验，请稍后重试',
        category: 'risk_control',
        retryable: true,
        platform: 'kuaishou',
        details: {
          status: responseStatus,
          errors: errorMessages,
          bodySnippet: payloadSnippet,
        },
      });
    }

    const detail = payload?.data?.visionVideoDetail;
    if (!detail || !detail?.photo?.id) {
      throw new ParserFailureError({
        code: 'KUAISHOU_PARSE_EMPTY_DETAIL',
        message: '快手视频详情为空，请稍后重试',
        category: 'parse_failed',
        retryable: true,
        platform: 'kuaishou',
        details: {
          status: responseStatus,
          errors: errorMessages,
          bodySnippet: payloadSnippet,
        },
      });
    }

    const status = Number(detail?.status);
    if (Number.isFinite(status) && status !== 1) {
      throw new ParserFailureError({
        code: 'KUAISHOU_VIDEO_UNAVAILABLE',
        message: '该快手视频当前不可访问（可能已删除、私密或地区限制）',
        category: 'video_unavailable',
        retryable: false,
        platform: 'kuaishou',
        details: {
          detailStatus: status,
        },
      });
    }

    return detail;
  }

  private isKuaishouRiskControlPayload(
    payload: any,
    joinedErrorMessages: string,
    payloadSnippet: string,
  ): boolean {
    if (payload?.result === 2) {
      return true;
    }

    if (payload?.data?.result === 400002) {
      return true;
    }

    if (
      joinedErrorMessages.includes('need captcha') ||
      joinedErrorMessages.includes('captcha') ||
      joinedErrorMessages.includes('验证')
    ) {
      return true;
    }

    const lowerSnippet = String(payloadSnippet || '').toLowerCase();
    if (
      lowerSnippet.includes('need captcha') ||
      lowerSnippet.includes('"captcha"') ||
      lowerSnippet.includes('请完成安全验证')
    ) {
      return true;
    }

    return false;
  }

  /**
   * 将 visionVideoDetail 转换为统一 VideoInfo
   */
  private async buildVideoInfoFromVisionDetail(
    detail: KuaishouVisionVideoDetail,
  ): Promise<VideoInfo> {
    const photo = detail?.photo || {};
    const author = detail?.author || {};
    const title = this.normalizeKuaishouTitle(photo?.caption || '');
    const cover = this.normalizeAbsoluteUrl(photo?.coverUrl || '');
    const duration = this.formatDuration(photo?.duration || 0);

    const mergedMap = await this.buildKuaishouMergedQualityMap(photo);
    const videoUrl =
      this.pickKuaishouPreviewUrl(photo, mergedMap) ||
      this.pickTopVideoUrlFromMap(mergedMap) ||
      this.normalizeAbsoluteUrl(photo?.photoUrl || '') ||
      this.normalizeAbsoluteUrl(photo?.photoH265Url || '');

    if (!videoUrl) {
      throw new ParserFailureError({
        code: 'KUAISHOU_NO_PLAYABLE_STREAM',
        message: '未找到可用的快手视频流',
        category: 'parse_failed',
        retryable: true,
        platform: 'kuaishou',
      });
    }

    const downloadOptions: VideoDownloadOptions | undefined =
      Object.keys(mergedMap).length > 0
        ? {
            merged: mergedMap,
          }
        : undefined;

    return {
      title,
      cover,
      duration,
      platform: 'kuaishou',
      author: String(author?.name || '').trim(),
      description: title,
      videoUrl,
      downloadOptions,
    };
  }

  private normalizeKuaishouTitle(value: string): string {
    const cleaned = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) {
      return '快手视频';
    }

    // Remove user id suffix in mentions, e.g. "@昵称(O3xsr46sx4wwaps4)" => "@昵称".
    const normalized = cleaned
      .replace(/(@[^\s@()（）]{1,40})\s*[（(][A-Za-z0-9_-]{6,}[)）]/gu, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized || '快手视频';
  }

  private pickKuaishouPreviewUrl(
    photo: KuaishouVisionVideoDetail['photo'],
    qualityMap: Record<string, string>,
  ): string {
    const rows = this.collectKuaishouQualityCandidates(photo);
    if (rows.length === 0) {
      return this.pickTopVideoUrlFromMap(qualityMap);
    }

    const preferredUrls = [
      ...this.collectPreviewUrlsBySource(rows, ['h264'], 'm3u8'),
      ...this.collectPreviewUrlsBySource(rows, ['manifest'], 'm3u8'),
      ...this.collectPreviewUrlsBySource(rows, ['h264', 'manifest'], 'progressive'),
      ...this.collectPreviewUrlsBySource(rows, ['photo_url'], 'progressive'),
      ...this.collectPreviewUrlsBySource(rows, ['photo_url'], 'any'),
      ...this.collectPreviewUrlsBySource(rows, ['hevc', 'photo_h265'], 'progressive'),
      ...Object.values(qualityMap),
    ];

    const deduped = Array.from(
      new Set(preferredUrls.map((item) => this.normalizeAbsoluteUrl(item)).filter(Boolean)),
    );
    return deduped[0] || '';
  }

  private collectPreviewUrlsBySource(
    rows: KuaishouQualityCandidate[],
    sources: KuaishouQualityCandidate['source'][],
    streamType: 'm3u8' | 'progressive' | 'any',
  ): string[] {
    const qualityOrder = ['4k', '1080p', '720p', '540p', '480p', '360p'];
    const sourceSet = new Set(sources);
    const sortedRows = [...rows].sort((a, b) => {
      const ai = qualityOrder.indexOf(a.quality);
      const bi = qualityOrder.indexOf(b.quality);
      const safeAi = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const safeBi = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      return safeAi - safeBi;
    });

    const urls: string[] = [];
    for (const row of sortedRows) {
      if (!sourceSet.has(row.source)) {
        continue;
      }
      for (const url of row.urls) {
        const normalized = this.normalizeAbsoluteUrl(url);
        if (!normalized) {
          continue;
        }
        if (streamType === 'm3u8' && !this.isHlsManifestUrl(normalized)) {
          continue;
        }
        if (streamType === 'progressive' && !this.isProgressiveVideoUrl(normalized)) {
          continue;
        }
        urls.push(normalized);
      }
    }

    return this.sortKuaishouUrlsByPreference(urls);
  }

  private async buildKuaishouMergedQualityMap(
    photo: KuaishouVisionVideoDetail['photo'],
  ): Promise<Record<string, string>> {
    const qualityCandidates = this.collectKuaishouQualityCandidates(photo);
    if (qualityCandidates.length === 0) {
      return {};
    }

    const bestByQuality = new Map<string, KuaishouQualityCandidate>();
    const allUrlsByQuality = new Map<string, string[]>();
    for (const item of qualityCandidates) {
      const mergedUrls = this.sortKuaishouUrlsByPreference([
        ...(allUrlsByQuality.get(item.quality) || []),
        ...item.urls,
      ]);
      allUrlsByQuality.set(item.quality, mergedUrls);

      const current = bestByQuality.get(item.quality);
      if (!current) {
        bestByQuality.set(item.quality, item);
        continue;
      }

      if (this.shouldReplaceQualityCandidate(current, item)) {
        bestByQuality.set(item.quality, item);
      }
    }

    const result: Record<string, string> = {};
    const orderedQualities = ['4k', '1080p', '720p', '540p', '480p', '360p'];

    for (const quality of orderedQualities) {
      const candidate = bestByQuality.get(quality);
      if (!candidate) {
        continue;
      }

      const qualityUrls = this.buildQualityUrlCandidates(
        quality,
        candidate,
        allUrlsByQuality,
      );
      const url = this.qualityProbeEnabled
        ? await this.pickFastestKuaishouStreamUrl(qualityUrls)
        : qualityUrls[0] || '';
      if (!url) {
        continue;
      }

      result[quality] = url;
    }

    for (const [quality, candidate] of bestByQuality.entries()) {
      if (result[quality]) {
        continue;
      }

      const qualityUrls = this.buildQualityUrlCandidates(
        quality,
        candidate,
        allUrlsByQuality,
      );
      const url = this.qualityProbeEnabled
        ? await this.pickFastestKuaishouStreamUrl(qualityUrls)
        : qualityUrls[0] || '';
      if (!url) {
        continue;
      }
      result[quality] = url;
    }

    return result;
  }

  private collectKuaishouQualityCandidates(
    photo: KuaishouVisionVideoDetail['photo'],
  ): KuaishouQualityCandidate[] {
    const rows: KuaishouQualityCandidate[] = [];

    const pushRepresentation = (
      representation: KuaishouRepresentation,
      source: KuaishouQualityCandidate['source'],
    ) => {
      const urls = this.collectRepresentationUrls(representation);
      if (urls.length === 0) {
        return;
      }

      const width = Math.max(0, Number(representation?.width) || 0);
      const height = Math.max(0, Number(representation?.height) || 0);
      const bitrate = Math.max(
        Number(representation?.avgBitrate) || 0,
        Number(representation?.maxBitrate) || 0,
      );
      const quality = this.resolveKuaishouQualityLabel(
        representation?.qualityType,
        representation?.qualityLabel,
        width,
        height,
      );
      if (!quality) {
        return;
      }

      rows.push({
        quality,
        urls,
        width,
        height,
        bitrate,
        source,
        defaultSelect: Boolean(representation?.defaultSelect),
      });
    };

    const manifestReps = photo?.manifest?.adaptationSet?.[0]?.representation || [];
    for (const rep of manifestReps) {
      pushRepresentation(rep, 'manifest');
    }

    const h264Reps = photo?.videoResource?.h264?.adaptationSet?.[0]?.representation || [];
    for (const rep of h264Reps) {
      pushRepresentation(rep, 'h264');
    }

    const hevcReps = photo?.videoResource?.hevc?.adaptationSet?.[0]?.representation || [];
    for (const rep of hevcReps) {
      pushRepresentation(rep, 'hevc');
    }

    const mergedKnownSizes = [...manifestReps, ...h264Reps, ...hevcReps];
    const fallbackWidth = Number(mergedKnownSizes?.[0]?.width) || 720;
    const fallbackHeight = Number(mergedKnownSizes?.[0]?.height) || 1280;
    const fallbackQuality = this.resolveKuaishouQualityLabel(
      '',
      '',
      fallbackWidth,
      fallbackHeight,
    ) || '720p';

    const photoUrl = this.normalizeAbsoluteUrl(photo?.photoUrl || '');
    if (photoUrl) {
      rows.push({
        quality: fallbackQuality,
        urls: [photoUrl],
        width: fallbackWidth,
        height: fallbackHeight,
        bitrate: 0,
        source: 'photo_url',
        defaultSelect: false,
      });
    }

    const photoH265Url = this.normalizeAbsoluteUrl(photo?.photoH265Url || '');
    if (photoH265Url) {
      rows.push({
        quality: fallbackQuality,
        urls: [photoH265Url],
        width: fallbackWidth,
        height: fallbackHeight,
        bitrate: 0,
        source: 'photo_h265',
        defaultSelect: false,
      });
    }

    return rows;
  }

  private buildQualityUrlCandidates(
    quality: string,
    primaryCandidate: KuaishouQualityCandidate | undefined,
    allUrlsByQuality: Map<string, string[]>,
  ): string[] {
    const primaryUrls = primaryCandidate?.urls || [];
    const poolUrls = allUrlsByQuality.get(quality) || [];
    return this.sortKuaishouUrlsByPreference([
      ...primaryUrls,
      ...poolUrls,
    ]);
  }

  private collectRepresentationUrls(representation: KuaishouRepresentation): string[] {
    const urls: string[] = [];

    const mainUrl = this.normalizeAbsoluteUrl(representation?.url || '');
    if (mainUrl) {
      urls.push(mainUrl);
    }

    const backupRaw = representation?.backupUrl;
    if (Array.isArray(backupRaw)) {
      for (const item of backupRaw) {
        const normalized = this.normalizeAbsoluteUrl(item || '');
        if (normalized) {
          urls.push(normalized);
        }
      }
    } else if (typeof backupRaw === 'string') {
      const normalized = this.normalizeAbsoluteUrl(backupRaw);
      if (normalized) {
        urls.push(normalized);
      }
    }

    return this.sortKuaishouUrlsByPreference(urls);
  }

  private shouldReplaceQualityCandidate(
    current: KuaishouQualityCandidate,
    incoming: KuaishouQualityCandidate,
  ): boolean {
    const currentHasProgressiveUrl = this.hasProgressiveUrl(current.urls);
    const incomingHasProgressiveUrl = this.hasProgressiveUrl(incoming.urls);
    if (incomingHasProgressiveUrl !== currentHasProgressiveUrl) {
      return incomingHasProgressiveUrl;
    }

    const currentHasM3u8Url = this.hasHlsManifestUrl(current.urls);
    const incomingHasM3u8Url = this.hasHlsManifestUrl(incoming.urls);
    if (incomingHasM3u8Url !== currentHasM3u8Url) {
      return !incomingHasM3u8Url;
    }

    const currentSourceScore = this.getSourcePreferenceScore(current.source);
    const incomingSourceScore = this.getSourcePreferenceScore(incoming.source);
    if (incomingSourceScore !== currentSourceScore) {
      return incomingSourceScore > currentSourceScore;
    }

    if (incoming.defaultSelect !== current.defaultSelect) {
      return incoming.defaultSelect;
    }

    if (incoming.bitrate !== current.bitrate) {
      return incoming.bitrate > current.bitrate;
    }

    const currentPixels = (current.width || 0) * (current.height || 0);
    const incomingPixels = (incoming.width || 0) * (incoming.height || 0);
    return incomingPixels > currentPixels;
  }

  private getSourcePreferenceScore(source: KuaishouQualityCandidate['source']): number {
    switch (source) {
      case 'h264':
        return 5;
      case 'manifest':
        return 4;
      case 'photo_url':
        return 3;
      case 'hevc':
        return 2;
      case 'photo_h265':
      default:
        return 1;
    }
  }

  private resolveKuaishouQualityLabel(
    qualityType: string,
    qualityLabel: string,
    width: number,
    height: number,
  ): string {
    const inferredBySize = this.mapShortEdgeToVideoQuality(width, height);
    if (inferredBySize) {
      return inferredBySize;
    }

    const normalizedType = this.normalizeVideoQualityLabel(qualityType);
    if (normalizedType) {
      return normalizedType;
    }

    const normalizedLabel = this.normalizeVideoQualityLabel(qualityLabel);
    if (normalizedLabel) {
      return normalizedLabel;
    }

    return '720p';
  }

  private mapShortEdgeToVideoQuality(width: number, height: number): string {
    const edge = Math.max(0, Math.min(Number(width) || 0, Number(height) || 0));
    if (!edge) {
      return '';
    }
    if (edge >= 2160) {
      return '4k';
    }
    if (edge >= 1080) {
      return '1080p';
    }
    if (edge >= 720) {
      return '720p';
    }
    if (edge >= 540) {
      return '540p';
    }
    if (edge >= 480) {
      return '480p';
    }
    return '360p';
  }

  private normalizeVideoQualityLabel(input: string): string {
    const normalized = String(input || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    if (normalized.includes('4k') || normalized.includes('2160')) {
      return '4k';
    }
    if (normalized.includes('1080')) {
      return '1080p';
    }
    if (normalized.includes('720')) {
      return '720p';
    }
    if (normalized.includes('540')) {
      return '540p';
    }
    if (normalized.includes('480')) {
      return '480p';
    }
    if (normalized.includes('360')) {
      return '360p';
    }
    if (normalized.includes('超清') || normalized.includes('蓝光')) {
      return '1080p';
    }
    if (normalized.includes('高清')) {
      return '720p';
    }
    if (normalized.includes('标清')) {
      return '540p';
    }
    return '';
  }

  private sortKuaishouUrlsByPreference(urls: string[]): string[] {
    const deduped = Array.from(new Set(urls.filter(Boolean)));
    deduped.sort((a, b) => this.getKuaishouUrlPreferenceScore(b) - this.getKuaishouUrlPreferenceScore(a));
    return deduped;
  }

  private getKuaishouUrlPreferenceScore(url: string): number {
    let score = 0;
    const normalized = this.normalizeAbsoluteUrl(url);
    if (!normalized) {
      return score;
    }

    if (this.isProgressiveVideoUrl(normalized)) {
      score += 100;
    } else if (this.isHlsManifestUrl(normalized)) {
      score += 10;
    }

    try {
      const hostname = new URL(normalized).hostname.toLowerCase();
      if (
        hostname.includes('kwaicdn.com') ||
        hostname.includes('oskwai.com') ||
        hostname.includes('wsukwai.com') ||
        hostname.includes('yximgs.com')
      ) {
        score += 30;
      } else if (hostname.includes('ndcimgs.com')) {
        score += 5;
      } else if (hostname.includes('kuaishou.com') || hostname.includes('kuaishou.cn')) {
        score += 20;
      }
    } catch (_error) {
      // ignore url parse error
    }

    return score;
  }

  private isHlsManifestUrl(url: string): boolean {
    return /\.m3u8(\?|$)/i.test(url || '');
  }

  private isProgressiveVideoUrl(url: string): boolean {
    return /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(url || '');
  }

  private hasProgressiveUrl(urls: string[]): boolean {
    return (urls || []).some((item) => this.isProgressiveVideoUrl(item));
  }

  private hasHlsManifestUrl(urls: string[]): boolean {
    return (urls || []).some((item) => this.isHlsManifestUrl(item));
  }

  private async pickFastestKuaishouStreamUrl(urls: string[]): Promise<string> {
    const candidates = this.sortKuaishouUrlsByPreference(urls);
    if (candidates.length === 0) {
      return '';
    }

    let bestUrl = candidates[0];
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const probe = await this.probeKuaishouPlayableStream(candidate);
      if (probe.status === 'risk') {
        break;
      }
      if (probe.status === 'ok') {
        const score = probe.throughput * 1000 - probe.latencyMs;
        if (score > bestScore) {
          bestScore = score;
          bestUrl = candidate;
        }
      }

      if (i < candidates.length - 1 && this.qualityProbeIntervalMs > 0) {
        await this.sleep(this.qualityProbeIntervalMs);
      }
    }

    return bestUrl;
  }

  private async probeKuaishouPlayableStream(
    targetUrl: string,
  ): Promise<KuaishouProbeResult> {
    const startedAt = Date.now();
    const sampleEnd = Math.max(1, this.qualityProbeSampleBytes) - 1;

    try {
      const response = await axios.get(targetUrl, {
        timeout: this.qualityProbeTimeoutMs,
        headers: {
          'User-Agent': this.userAgent,
          Referer: 'https://www.kuaishou.com/',
          Origin: 'https://www.kuaishou.com',
          Accept: '*/*',
          Range: `bytes=0-${sampleEnd}`,
        },
        maxRedirects: 3,
        responseType: 'stream',
        validateStatus: () => true,
      });

      if ([401, 403, 418, 429].includes(response.status)) {
        if (response?.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
        return { status: 'risk' };
      }

      if (response.status < 200 || response.status >= 400) {
        if (response?.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
        return { status: 'miss' };
      }

      const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
      const isVideoLike =
        !contentType ||
        contentType.includes('video') ||
        contentType.includes('octet-stream');
      if (!isVideoLike) {
        if (response?.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
        return { status: 'miss' };
      }

      const bytesRead = await this.readSampleBytesFromStream(
        response.data,
        this.qualityProbeSampleBytes,
      );
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const throughput = bytesRead > 0 ? bytesRead / latencyMs : 0;
      return {
        status: 'ok',
        latencyMs,
        throughput,
      };
    } catch (_error) {
      return { status: 'miss' };
    }
  }

  private async readSampleBytesFromStream(stream: any, limit: number): Promise<number> {
    if (!stream || typeof stream.on !== 'function') {
      return 0;
    }

    return new Promise<number>((resolve) => {
      let bytes = 0;
      let settled = false;
      const safeResolve = (value: number) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const closeStream = () => {
        if (stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
      };

      stream.on('data', (chunk: Buffer) => {
        bytes += chunk?.length || 0;
        if (bytes >= limit) {
          closeStream();
          safeResolve(bytes);
        }
      });
      stream.on('end', () => safeResolve(bytes));
      stream.on('close', () => safeResolve(bytes));
      stream.on('error', () => safeResolve(bytes));
    });
  }

  private pickTopVideoUrlFromMap(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order = ['4k', '1080p', '720p', '540p', '480p', '360p'];
    for (const quality of order) {
      const candidate = qualityMap[quality];
      if (candidate) {
        return candidate;
      }
    }

    const first = Object.values(qualityMap)[0];
    return first || '';
  }

  private formatDuration(rawDuration: number): string {
    const parsed = Number(rawDuration) || 0;
    if (!parsed) {
      return '00:00';
    }

    // 快手 duration 通常是毫秒，兼容秒单位
    const seconds = parsed > 1000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private normalizeAbsoluteUrl(url: string): string {
    if (!url) {
      return '';
    }

    const value = String(url).trim();
    if (!value) {
      return '';
    }

    if (value.startsWith('//')) {
      return `https:${value}`;
    }

    if (!/^https?:\/\//i.test(value)) {
      return '';
    }

    return value;
  }

  private readIntegerEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async sleep(ms: number): Promise<void> {
    if (!ms || ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async loadPuppeteer(): Promise<any> {
    try {
      return await import('puppeteer-core');
    } catch (_error) {
      throw new ParserFailureError({
        code: 'KUAISHOU_PUPPETEER_MISSING',
        message: '缺少 puppeteer-core 依赖，无法解析快手视频',
        category: 'parse_failed',
        retryable: false,
        platform: 'kuaishou',
      });
    }
  }

  private resolveChromeExecutablePath(): string {
    return resolveChromeExecutablePath({
      envCandidates: [
        process.env.KUAISHOU_CHROME_PATH?.trim(),
        process.env.PUPPETEER_EXECUTABLE_PATH?.trim(),
      ],
    });
  }

  private async acquireBrowser(): Promise<any> {
    const current = this.browser;
    if (current && typeof current.isConnected === 'function' && current.isConnected()) {
      if (this.browserIdleTimer) {
        clearTimeout(this.browserIdleTimer);
        this.browserIdleTimer = null;
      }
      return current;
    }

    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }

    this.browserLaunchPromise = (async () => {
      const puppeteer = await this.loadPuppeteer();
      const executablePath = this.resolveChromeExecutablePath();
      if (!executablePath) {
        throw new ParserFailureError({
          code: 'KUAISHOU_CHROME_NOT_FOUND',
          message: '未找到可用 Chrome，请安装 Chrome 或配置 KUAISHOU_CHROME_PATH',
          category: 'parse_failed',
          retryable: false,
          platform: 'kuaishou',
        });
      }

      const browser = await puppeteer.launch({
        executablePath,
        headless: this.browserHeadless ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      browser.on('disconnected', () => {
        this.browser = null;
      });

      this.browser = browser;
      return browser;
    })();

    try {
      return await this.browserLaunchPromise;
    } finally {
      this.browserLaunchPromise = null;
    }
  }

  private scheduleBrowserIdleClose(): void {
    if (this.browserIdleTtlMs <= 0) {
      void this.closeBrowser();
      return;
    }

    if (this.browserIdleTimer) {
      clearTimeout(this.browserIdleTimer);
      this.browserIdleTimer = null;
    }

    this.browserIdleTimer = setTimeout(() => {
      void this.closeBrowser();
    }, this.browserIdleTtlMs);
  }

  private async closeBrowser(): Promise<void> {
    if (this.browserIdleTimer) {
      clearTimeout(this.browserIdleTimer);
      this.browserIdleTimer = null;
    }

    const current = this.browser;
    this.browser = null;
    if (!current) {
      return;
    }

    try {
      await current.close();
    } catch (_error) {
      // ignore close errors
    }
  }
}
