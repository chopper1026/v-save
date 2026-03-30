import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VideoDownloadOptions, VideoParser, VideoInfo } from './base.interface';
import { ParserFailureError } from './parser-failure.error';
import { resolveYtDlpPath } from '../config/executable-paths';

const execFileAsync = promisify(execFile);

type VideoQualityLabel = '360p' | '480p' | '540p' | '720p' | '1080p' | '4k';
type AudioQualityLabel = '64k' | '132k' | '192k';

interface XhsYtDlpFormat {
  url?: string;
  ext?: string;
  height?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  filesize_approx?: number;
}

interface XhsYtDlpPayload {
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  description?: string;
  webpage_url?: string;
  url?: string;
  formats?: XhsYtDlpFormat[];
}

interface XhsYtDlpStreamResult {
  downloadOptions?: VideoDownloadOptions;
  bestMergedUrl?: string;
  bestVideoUrl?: string;
  bestAudioUrl?: string;
}

/**
 * 小红书视频解析器
 * 目标：保证 parse 成功时一定返回可预览/下载的 videoUrl。
 */
@Injectable()
export class XiaohongshuParser implements VideoParser {
  private readonly logger = new Logger(XiaohongshuParser.name);
  private readonly maxAttempts = this.readIntegerEnv('XHS_PARSE_MAX_ATTEMPTS', 3);
  private readonly minParseIntervalMs = this.readIntegerEnv(
    'XHS_PARSE_MIN_INTERVAL_MS',
    1200,
  );
  private readonly cacheTtlMs = this.readIntegerEnv(
    'XHS_PARSE_CACHE_TTL_MS',
    20 * 60 * 1000,
  );
  private readonly failureCacheTtlMs = this.readIntegerEnv(
    'XHS_PARSE_FAILURE_CACHE_TTL_MS',
    30 * 1000,
  );
  private readonly retryBaseDelayMs = this.readIntegerEnv(
    'XHS_PARSE_RETRY_BASE_MS',
    700,
  );
  private readonly retryJitterMs = this.readIntegerEnv(
    'XHS_PARSE_RETRY_JITTER_MS',
    450,
  );
  private parseQueue: Promise<void> = Promise.resolve();
  private lastParseStartedAt = 0;
  private readonly parseCache = new Map<
    string,
    { expiresAt: number; info: VideoInfo }
  >();
  private readonly parseFailureCache = new Map<
    string,
    { expiresAt: number; error: ParserFailureError }
  >();
  platform: VideoInfo['platform'] = 'xiaohongshu';

  supports(url: string): boolean {
    const lower = String(url || '').toLowerCase();
    return (
      lower.includes('xiaohongshu.com') ||
      lower.includes('xiaohongshu.cn') ||
      lower.includes('xhsc.cn') ||
      lower.includes('xhslink.com')
    );
  }

  async parse(url: string): Promise<VideoInfo> {
    return this.runSerialized(async () => this.parseInternal(url));
  }

  private async parseInternal(url: string): Promise<VideoInfo> {
    const normalizedInput = this.extractFirstHttpUrl(url) || String(url || '').trim();
    if (!normalizedInput) {
      throw new ParserFailureError({
        code: 'XHS_INVALID_URL',
        message: '无法识别小红书链接，请粘贴完整分享链接后重试',
        category: 'invalid_input',
        retryable: false,
        platform: 'xiaohongshu',
      });
    }

    const resolvedUrl = await this.resolveShareUrl(normalizedInput);
    const noteId = this.extractNoteId(resolvedUrl) || this.extractNoteId(normalizedInput);
    const cacheKey = noteId || resolvedUrl || normalizedInput;

    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return cached;
    }
    const cachedFailure = this.getCachedFailure(cacheKey);
    if (cachedFailure) {
      throw cachedFailure;
    }

    await this.enforceRequestPacing();

    let lastParserError: ParserFailureError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const info = await this.parseOnce(resolvedUrl, noteId);
        this.setCachedResult(cacheKey, info);
        if (noteId && noteId !== cacheKey) {
          this.setCachedResult(noteId, info);
        }
        this.clearCachedFailure(cacheKey);
        if (noteId && noteId !== cacheKey) {
          this.clearCachedFailure(noteId);
        }
        return info;
      } catch (error: any) {
        const parserError = this.normalizeParseError(error, noteId);
        lastParserError = parserError;

        const shouldRetry = parserError.retryable && attempt < this.maxAttempts;
        if (!shouldRetry) {
          if (!parserError.retryable) {
            this.setCachedFailure(cacheKey, parserError);
            if (noteId && noteId !== cacheKey) {
              this.setCachedFailure(noteId, parserError);
            }
          }
          throw parserError;
        }

        const waitMs = this.computeRetryWaitMs(attempt);
        this.logger.warn(
          `小红书解析重试: attempt=${attempt}/${this.maxAttempts}, code=${parserError.code}, wait=${waitMs}ms`,
        );
        await this.sleep(waitMs);
      }
    }

    if (lastParserError) {
      throw lastParserError;
    }

    throw new ParserFailureError({
      code: 'XHS_PARSE_FAILED',
      message: '小红书视频解析失败，请稍后重试',
      category: 'parse_failed',
      retryable: true,
      platform: 'xiaohongshu',
    });
  }

  private async parseOnce(
    resolvedUrl: string,
    noteId: string | null,
  ): Promise<VideoInfo> {
    try {
      const ytDlpInfo = await this.getVideoInfoFromYtDlp(resolvedUrl);
      if (ytDlpInfo?.videoUrl) {
        return this.tryEnrichYtDlpMetadata(ytDlpInfo, resolvedUrl, noteId);
      }

      const webInfo = await this.getVideoInfoFromWeb(resolvedUrl, noteId);
      if (webInfo?.videoUrl) {
        return webInfo;
      }

      if (noteId) {
        const apiInfo = await this.getVideoInfoFromApi(noteId);
        if (apiInfo?.videoUrl) {
          return apiInfo;
        }
      }

      throw new ParserFailureError({
        code: 'XHS_VIDEO_UNAVAILABLE',
        message: '未获取到可播放的小红书视频地址，请稍后重试或更换笔记链接',
        category: 'video_unavailable',
        retryable: false,
        platform: 'xiaohongshu',
        details: {
          noteId: noteId || null,
        },
      });
    } catch (error: any) {
      throw this.normalizeParseError(error, noteId);
    }
  }

  private async tryEnrichYtDlpMetadata(
    baseInfo: VideoInfo,
    resolvedUrl: string,
    noteId: string | null,
  ): Promise<VideoInfo> {
    const shouldEnrich =
      !this.cleanText(baseInfo.author || '') ||
      this.isLikelyLowQualityCover(baseInfo.cover || '');
    if (!shouldEnrich) {
      return baseInfo;
    }

    try {
      const webInfo = await this.getVideoInfoFromWeb(resolvedUrl, noteId);
      if (!webInfo) {
        return baseInfo;
      }

      const mergedCover = this.selectBestCoverUrl([
        baseInfo.cover || '',
        webInfo.cover || '',
      ]);

      return {
        ...baseInfo,
        title: this.pickPreferredTitle(baseInfo.title, webInfo.title),
        cover: mergedCover,
        author: this.pickPreferredText(baseInfo.author, webInfo.author),
        description: this.pickPreferredDescription(
          baseInfo.description,
          webInfo.description,
        ),
        duration:
          baseInfo.duration && baseInfo.duration !== '00:00'
            ? baseInfo.duration
            : (webInfo.duration || baseInfo.duration),
      };
    } catch (_error) {
      return baseInfo;
    }
  }

  private pickPreferredText(primary?: string, secondary?: string): string {
    const first = this.cleanText(primary || '');
    const second = this.cleanText(secondary || '');
    return first || second;
  }

  private pickPreferredTitle(primary?: string, secondary?: string): string {
    const first = this.normalizeTitle(primary || '');
    const second = this.normalizeTitle(secondary || '');

    if (!first) {
      return second;
    }
    if (!second) {
      return first;
    }

    if (
      this.isLikelyPlaceholderTitle(first) &&
      !this.isLikelyPlaceholderTitle(second)
    ) {
      return second;
    }

    return first;
  }

  private pickPreferredDescription(primary?: string, secondary?: string): string {
    const first = this.cleanText(primary || '');
    const second = this.cleanText(secondary || '');
    if (!first) {
      return second;
    }
    if (!second) {
      return first;
    }
    return second.length > first.length ? second : first;
  }

  private isLikelyLowQualityCover(url: string): boolean {
    const normalized = this.normalizeEscapedUrl(url);
    if (!normalized) {
      return true;
    }
    const lower = normalized.toLowerCase();
    return (
      lower.includes('!nd_prv_') ||
      lower.includes('wb_prv') ||
      lower.includes('default') ||
      lower.includes('placeholder')
    );
  }

  private isLikelyPlaceholderTitle(title: string): boolean {
    const value = this.normalizeTitle(title);
    if (!value) {
      return true;
    }

    const lower = value.toLowerCase();
    return (
      /^xiaohongshu video #?[a-z0-9]+$/i.test(value) ||
      lower === 'xiaohongshu video' ||
      lower.includes('| 小红书 - 你的生活兴趣社区')
    );
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

  private getCachedResult(cacheKey: string): VideoInfo | null {
    const cache = this.parseCache.get(cacheKey);
    if (!cache) {
      return null;
    }

    if (cache.expiresAt <= Date.now()) {
      this.parseCache.delete(cacheKey);
      return null;
    }

    return cache.info;
  }

  private setCachedResult(cacheKey: string, info: VideoInfo): void {
    this.parseCache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      info,
    });

    if (this.parseCache.size <= 250) {
      return;
    }

    const now = Date.now();
    for (const [key, value] of this.parseCache.entries()) {
      if (value.expiresAt <= now) {
        this.parseCache.delete(key);
      }
    }
  }

  private getCachedFailure(cacheKey: string): ParserFailureError | null {
    const cache = this.parseFailureCache.get(cacheKey);
    if (!cache) {
      return null;
    }

    if (cache.expiresAt <= Date.now()) {
      this.parseFailureCache.delete(cacheKey);
      return null;
    }

    return cache.error;
  }

  private setCachedFailure(cacheKey: string, error: ParserFailureError): void {
    if (this.failureCacheTtlMs <= 0) {
      return;
    }

    this.parseFailureCache.set(cacheKey, {
      expiresAt: Date.now() + this.failureCacheTtlMs,
      error,
    });

    if (this.parseFailureCache.size <= 250) {
      return;
    }

    const now = Date.now();
    for (const [key, value] of this.parseFailureCache.entries()) {
      if (value.expiresAt <= now) {
        this.parseFailureCache.delete(key);
      }
    }
  }

  private clearCachedFailure(cacheKey: string): void {
    this.parseFailureCache.delete(cacheKey);
  }

  private async enforceRequestPacing(): Promise<void> {
    if (this.minParseIntervalMs <= 0) {
      this.lastParseStartedAt = Date.now();
      return;
    }

    const waitMs = this.minParseIntervalMs - (Date.now() - this.lastParseStartedAt);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    this.lastParseStartedAt = Date.now();
  }

  private computeRetryWaitMs(attempt: number): number {
    const exp = Math.max(0, attempt - 1);
    const backoff = this.retryBaseDelayMs * 2 ** exp;
    const jitter = Math.floor(Math.random() * this.retryJitterMs);
    return backoff + jitter;
  }

  private readIntegerEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private normalizeParseError(error: any, noteId: string | null): ParserFailureError {
    if (error instanceof ParserFailureError) {
      return error;
    }

    const status = error?.response?.status;
    const errorCode = String(error?.code || '').toUpperCase();
    const textPool = `${error?.message || ''} ${this.summarizeUnknownBody(error?.response?.data)}`
      .toLowerCase();

    if (
      status === 401 ||
      status === 403 ||
      status === 418 ||
      status === 429 ||
      this.containsAny(textPool, [
        'captcha',
        'human verification',
        'security check',
        '访问过于频繁',
        '网络环境异常',
        '请完成验证',
        '请通过验证',
      ])
    ) {
      return new ParserFailureError({
        code: 'XHS_RISK_CONTROL',
        message: '小红书触发风控校验，请稍后重试',
        category: 'risk_control',
        retryable: true,
        platform: 'xiaohongshu',
        details: {
          noteId: noteId || undefined,
          status,
          errorCode,
        },
      });
    }

    if (
      (typeof status === 'number' && status >= 500) ||
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'].includes(errorCode)
    ) {
      return new ParserFailureError({
        code: 'XHS_UPSTREAM_UNSTABLE',
        message: '小红书服务暂时不可用，请稍后重试',
        category: 'upstream',
        retryable: true,
        platform: 'xiaohongshu',
        details: {
          noteId: noteId || undefined,
          status,
          errorCode,
        },
      });
    }

    if (status === 404 || status === 410) {
      return new ParserFailureError({
        code: 'XHS_VIDEO_UNAVAILABLE',
        message: '该小红书视频当前不可访问（可能已删除、私密或地区限制）',
        category: 'video_unavailable',
        retryable: false,
        platform: 'xiaohongshu',
        details: {
          noteId: noteId || undefined,
          status,
          errorCode,
        },
      });
    }

    this.logger.error(`小红书解析失败: ${error?.message || 'unknown'}`);
    return new ParserFailureError({
      code: 'XHS_PARSE_FAILED',
      message: '小红书视频解析失败，请稍后重试',
      category: 'parse_failed',
      retryable: true,
      platform: 'xiaohongshu',
      details: {
        noteId: noteId || undefined,
        cause: error?.message || 'unknown',
      },
    });
  }

  private containsAny(text: string, patterns: string[]): boolean {
    if (!text) {
      return false;
    }
    return patterns.some((pattern) => text.includes(pattern));
  }

  private summarizeUnknownBody(data: unknown): string {
    if (typeof data === 'string') {
      return data.slice(0, 220);
    }
    if (data == null) {
      return '';
    }
    try {
      return JSON.stringify(data).slice(0, 220);
    } catch (_error) {
      return '';
    }
  }

  private isRetryableFetchFailure(error: ParserFailureError): boolean {
    return error.code === 'XHS_RISK_CONTROL' || error.code === 'XHS_UPSTREAM_UNSTABLE';
  }

  private looksLikeRiskControlHtml(html: string): boolean {
    const lowered = String(html || '').toLowerCase();
    return this.containsAny(lowered, [
      'captcha',
      'security check',
      'human verification',
      '请完成验证',
      '请通过验证',
      '访问过于频繁',
      '网络环境异常',
      '验证码',
    ]);
  }

  private extractFirstHttpUrl(input: string): string {
    const raw = String(input || '');
    if (!raw.trim()) {
      return '';
    }

    const direct = this.trimWrappedUrl(raw.trim());
    if (/^https?:\/\//i.test(direct)) {
      return direct;
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

  private isShortShareUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host.includes('xhsc.cn') || host.includes('xhslink.com');
    } catch (_error) {
      return false;
    }
  }

  private async resolveShareUrl(url: string): Promise<string> {
    if (!this.isShortShareUrl(url)) {
      return url;
    }

    try {
      const response = await axios.get(url, {
        headers: this.buildHeaders(),
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const location = response.headers?.location;
      if (typeof location === 'string' && location.trim()) {
        return new URL(location, url).toString();
      }

      const finalUrl = response?.request?.res?.responseUrl;
      if (typeof finalUrl === 'string' && finalUrl.trim()) {
        return finalUrl;
      }
    } catch (error: any) {
      const location = error?.response?.headers?.location;
      if (typeof location === 'string' && location.trim()) {
        try {
          return new URL(location, url).toString();
        } catch (_urlError) {
          return location;
        }
      }

      const finalUrl = error?.request?.res?.responseUrl;
      if (typeof finalUrl === 'string' && finalUrl.trim()) {
        return finalUrl;
      }

      this.logger.warn(`小红书短链展开失败，使用原始链接继续解析: ${error?.message || 'unknown'}`);
    }

    return url;
  }

  /**
   * 从 URL 中提取笔记 ID。
   */
  private extractNoteId(url: string): string | null {
    const value = String(url || '').trim();
    if (!value) {
      return null;
    }

    const patterns = [
      /\/discovery\/item\/([a-zA-Z0-9]+)/i,
      /\/explore\/([a-zA-Z0-9]+)/i,
      /\/item\/([a-zA-Z0-9]+)/i,
      /[?&](?:note_id|noteId)=([a-zA-Z0-9]+)/i,
    ];

    for (const pattern of patterns) {
      const matched = value.match(pattern);
      if (matched?.[1]) {
        return matched[1];
      }
    }

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (host.includes('xhsc.cn') || host.includes('xhslink.com')) {
        const segment = parsed.pathname.split('/').filter(Boolean)[0] || '';
        if (/^[a-zA-Z0-9]{8,}$/.test(segment)) {
          return segment;
        }
      }
    } catch (_error) {
      // ignore parse failure
    }

    return null;
  }

  private async getVideoInfoFromYtDlp(url: string): Promise<VideoInfo | null> {
    const ytDlpPath = resolveYtDlpPath(process.env.YTDLP_PATH?.trim());
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '-J',
      url,
    ];

    try {
      const { stdout } = await execFileAsync(ytDlpPath, args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const payload = JSON.parse(stdout) as XhsYtDlpPayload;
      const streamResult = this.buildDownloadOptionsFromYtDlpPayload(payload);
      const fallbackDirectUrl = this.extractPlayableUrl(payload.url || '');
      const videoUrl =
        streamResult.bestMergedUrl ||
        streamResult.bestVideoUrl ||
        fallbackDirectUrl;

      if (!videoUrl) {
        return null;
      }

      const result: VideoInfo = {
        title: this.normalizeTitle(payload.title || '小红书笔记'),
        cover: this.normalizeEscapedUrl(payload.thumbnail || ''),
        duration: this.formatDuration(payload.duration || 0),
        platform: 'xiaohongshu',
        author: payload.uploader || '',
        description: payload.description || '',
        videoUrl,
      };

      if (streamResult.bestAudioUrl) {
        result.audioUrl = streamResult.bestAudioUrl;
      }
      if (streamResult.downloadOptions) {
        result.downloadOptions = streamResult.downloadOptions;
      }

      return result;
    } catch (error: any) {
      this.logger.warn(`yt-dlp 解析小红书失败: ${error?.message || 'unknown'}`);
      return null;
    }
  }

  private buildDownloadOptionsFromYtDlpPayload(
    payload: XhsYtDlpPayload,
  ): XhsYtDlpStreamResult {
    const formats = Array.isArray(payload?.formats) ? payload.formats : [];
    if (formats.length === 0) {
      return {};
    }

    const mergedByQuality = new Map<VideoQualityLabel, XhsYtDlpFormat>();
    const videoByQuality = new Map<VideoQualityLabel, XhsYtDlpFormat>();
    const audioByQuality = new Map<AudioQualityLabel, XhsYtDlpFormat>();

    for (const format of formats) {
      const url = this.extractPlayableUrl(format.url || '');
      if (!url) {
        continue;
      }

      const withUrl: XhsYtDlpFormat = {
        ...format,
        url,
      };

      const hasVideo = this.hasMediaCodec(format.vcodec);
      const hasAudio = this.hasMediaCodec(format.acodec);

      if (hasVideo && hasAudio) {
        const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
        if (!quality) {
          continue;
        }

        const current = mergedByQuality.get(quality);
        if (this.shouldReplaceVideoCandidate(current, withUrl)) {
          mergedByQuality.set(quality, withUrl);
        }
        continue;
      }

      if (hasVideo && !hasAudio) {
        const quality = this.mapHeightToVideoQuality(Number(format.height) || 0);
        if (!quality) {
          continue;
        }

        const current = videoByQuality.get(quality);
        if (this.shouldReplaceVideoCandidate(current, withUrl)) {
          videoByQuality.set(quality, withUrl);
        }
        continue;
      }

      if (!hasVideo && hasAudio) {
        const quality = this.mapBitrateToAudioQuality(this.getYtDlpAudioBitrate(withUrl));
        if (!quality) {
          continue;
        }

        const current = audioByQuality.get(quality);
        if (this.shouldReplaceAudioCandidate(current, withUrl)) {
          audioByQuality.set(quality, withUrl);
        }
      }
    }

    const merged = this.mapFormatMapToUrlMap(mergedByQuality);
    const video = this.mapFormatMapToUrlMap(videoByQuality);
    const audio = this.mapFormatMapToUrlMap(audioByQuality);

    const downloadOptions: VideoDownloadOptions = {};
    if (Object.keys(merged).length > 0) {
      downloadOptions.merged = merged;
    }
    if (Object.keys(video).length > 0) {
      downloadOptions.video = video;
    }
    if (Object.keys(audio).length > 0) {
      downloadOptions.audio = audio;
    }

    return {
      downloadOptions: Object.keys(downloadOptions).length > 0 ? downloadOptions : undefined,
      bestMergedUrl: this.pickTopVideoUrl(merged),
      bestVideoUrl: this.pickTopVideoUrl(video),
      bestAudioUrl: this.pickTopAudioUrl(audio),
    };
  }

  private hasMediaCodec(codec?: string): boolean {
    if (!codec) {
      return false;
    }
    return String(codec).toLowerCase() !== 'none';
  }

  private shouldReplaceVideoCandidate(
    current: XhsYtDlpFormat | undefined,
    incoming: XhsYtDlpFormat,
  ): boolean {
    if (!current) {
      return true;
    }

    const currentIsMp4 = String(current.ext || '').toLowerCase() === 'mp4';
    const incomingIsMp4 = String(incoming.ext || '').toLowerCase() === 'mp4';
    if (incomingIsMp4 !== currentIsMp4) {
      return incomingIsMp4;
    }

    const currentBitrate = this.getYtDlpVideoBitrate(current);
    const incomingBitrate = this.getYtDlpVideoBitrate(incoming);
    if (incomingBitrate !== currentBitrate) {
      return incomingBitrate > currentBitrate;
    }

    const currentSize = this.getYtDlpFilesize(current);
    const incomingSize = this.getYtDlpFilesize(incoming);
    return incomingSize > currentSize;
  }

  private shouldReplaceAudioCandidate(
    current: XhsYtDlpFormat | undefined,
    incoming: XhsYtDlpFormat,
  ): boolean {
    if (!current) {
      return true;
    }

    const currentIsM4a = String(current.ext || '').toLowerCase() === 'm4a';
    const incomingIsM4a = String(incoming.ext || '').toLowerCase() === 'm4a';
    if (incomingIsM4a !== currentIsM4a) {
      return incomingIsM4a;
    }

    const currentBitrate = this.getYtDlpAudioBitrate(current);
    const incomingBitrate = this.getYtDlpAudioBitrate(incoming);
    if (incomingBitrate !== currentBitrate) {
      return incomingBitrate > currentBitrate;
    }

    const currentSize = this.getYtDlpFilesize(current);
    const incomingSize = this.getYtDlpFilesize(incoming);
    return incomingSize > currentSize;
  }

  private getYtDlpVideoBitrate(format: XhsYtDlpFormat): number {
    return Number(format.tbr || format.vbr) || 0;
  }

  private getYtDlpAudioBitrate(format: XhsYtDlpFormat): number {
    return Number(format.abr || format.tbr) || 0;
  }

  private getYtDlpFilesize(format: XhsYtDlpFormat): number {
    return Number(format.filesize || format.filesize_approx) || 0;
  }

  private mapHeightToVideoQuality(height: number): VideoQualityLabel | null {
    if (!height || height < 360) {
      return null;
    }
    if (height >= 2160) {
      return '4k';
    }
    if (height >= 1080) {
      return '1080p';
    }
    if (height >= 720) {
      return '720p';
    }
    if (height >= 540) {
      return '540p';
    }
    if (height >= 480) {
      return '480p';
    }
    return '360p';
  }

  private mapBitrateToAudioQuality(bitrate: number): AudioQualityLabel | null {
    if (!bitrate || bitrate <= 0) {
      return null;
    }
    if (bitrate >= 180) {
      return '192k';
    }
    if (bitrate >= 120) {
      return '132k';
    }
    return '64k';
  }

  private mapFormatMapToUrlMap<T extends string>(
    source: Map<T, XhsYtDlpFormat>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [quality, format] of source.entries()) {
      const url = this.extractPlayableUrl(format.url || '');
      if (!url) {
        continue;
      }
      result[quality] = url;
    }
    return result;
  }

  private pickTopVideoUrl(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order: VideoQualityLabel[] = ['4k', '1080p', '720p', '540p', '480p', '360p'];
    for (const quality of order) {
      if (qualityMap[quality]) {
        return qualityMap[quality];
      }
    }

    return '';
  }

  private pickTopAudioUrl(qualityMap?: Record<string, string>): string {
    if (!qualityMap) {
      return '';
    }

    const order: AudioQualityLabel[] = ['192k', '132k', '64k'];
    for (const quality of order) {
      if (qualityMap[quality]) {
        return qualityMap[quality];
      }
    }

    return '';
  }

  private extractPlayableUrl(url: string): string {
    const value = this.normalizeEscapedUrl(String(url || ''));
    if (!/^https?:\/\//i.test(value)) {
      return '';
    }
    return value;
  }

  private normalizeEscapedUrl(value: string): string {
    let url = String(value || '').trim();
    if (!url) {
      return '';
    }

    url = url
      .replace(/\\u002F/g, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/^"|"$/g, '')
      .replace(/^'|'$/g, '');

    return url;
  }

  private async getVideoInfoFromWeb(
    url: string,
    noteId: string | null,
  ): Promise<VideoInfo | null> {
    const pageUrl = this.resolveWebPageUrl(url, noteId);

    try {
      const response = await axios.get(pageUrl, {
        headers: this.buildHeaders(),
        timeout: 15000,
      });

      const html = typeof response.data === 'string' ? response.data : '';
      if (!html) {
        return null;
      }
      if (this.looksLikeRiskControlHtml(html)) {
        throw new ParserFailureError({
          code: 'XHS_RISK_CONTROL',
          message: '小红书触发风控校验，请稍后重试',
          category: 'risk_control',
          retryable: true,
          platform: 'xiaohongshu',
          details: {
            noteId: noteId || undefined,
            stage: 'web_html',
          },
        });
      }

      const $ = cheerio.load(html);
      const metaTitle = $('meta[property="og:title"]').attr('content') || '';
      const pageTitle = $('title').text() || '';
      const cover =
        $('meta[property="og:image"]').attr('content') ||
        $('meta[name="og:image"]').attr('content') ||
        '';
      const description =
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        '';
      const author = $('meta[name="author"]').attr('content') || '';

      const ogVideo =
        $('meta[property="og:video:url"]').attr('content') ||
        $('meta[property="og:video"]').attr('content') ||
        '';

      const noteData = this.extractNoteDataFromHtml(html, noteId || undefined);
      const videoUrl =
        this.extractPlayableUrl(ogVideo) ||
        this.extractPlayableUrl(noteData?.videoUrl || '') ||
        this.extractMediaUrlFromHtml(html);

      if (!videoUrl) {
        return null;
      }

      const result: VideoInfo = {
        title: this.normalizeTitle(
          noteData?.title || metaTitle || pageTitle || '小红书笔记',
        ),
        cover: this.selectBestCoverUrl([noteData?.cover || '', cover || '']),
        duration: noteData?.duration || '00:00',
        platform: 'xiaohongshu',
        author: this.cleanText(noteData?.author || author || ''),
        description: this.cleanText(description || noteData?.description || ''),
        videoUrl,
      };

      if (noteData?.audioUrl) {
        result.audioUrl = noteData.audioUrl;
      }
      if (noteData?.downloadOptions) {
        result.downloadOptions = noteData.downloadOptions;
      }

      return result;
    } catch (error: any) {
      const parserError = this.normalizeParseError(error, noteId);
      if (this.isRetryableFetchFailure(parserError)) {
        throw parserError;
      }
      this.logger.warn(`小红书网页解析失败: ${error?.message || 'unknown'}`);
      return null;
    }
  }

  private resolveWebPageUrl(url: string, noteId: string | null): string {
    const normalized = String(url || '').trim();
    if (normalized) {
      try {
        const parsed = new URL(normalized);
        const host = parsed.hostname.toLowerCase();
        const isXhsHost =
          host.includes('xiaohongshu.com') ||
          host.includes('xiaohongshu.cn') ||
          host.includes('xhsc.cn') ||
          host.includes('xhslink.com');
        const hasXsecToken =
          parsed.searchParams.has('xsec_token') ||
          parsed.searchParams.has('xsec_source');

        if (isXhsHost && (hasXsecToken || parsed.search.length > 1)) {
          return normalized;
        }
      } catch (_error) {
        // ignore invalid url and fallback to note id url
      }
    }

    if (noteId) {
      return `https://www.xiaohongshu.com/discovery/item/${noteId}`;
    }

    return normalized;
  }

  private cleanText(value: string): string {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeTitle(value: string): string {
    const cleaned = this.cleanText(value);
    if (!cleaned) {
      return '';
    }

    const shareMetaTrimmed = cleaned
      .replace(/^【\s*(.*?)\s*\|\s*小红书[^】]*】$/u, '$1')
      .replace(/\|\s*小红书\s*-\s*你的生活兴趣社区$/u, '')
      .trim();

    const topicTitleMatched = shareMetaTrimmed.match(
      /^#\s*([^#\[]+?)\s*\[话题\]\s*#?$/u,
    );
    if (topicTitleMatched?.[1]) {
      return this.cleanText(topicTitleMatched[1]);
    }

    return shareMetaTrimmed;
  }

  private extractMediaUrlFromHtml(html: string): string {
    const patterns = [
      /https?:\\\/\\\/[^"'\s]+(?:mp4|m3u8)[^"'\s]*/gi,
      /https?:\/\/[^"'\s]+(?:mp4|m3u8)[^"'\s]*/gi,
    ];

    for (const pattern of patterns) {
      const matches = html.match(pattern) || [];
      for (const raw of matches) {
        const url = this.extractPlayableUrl(raw);
        if (url && this.isLikelyVideoUrl(url)) {
          return url;
        }
      }
    }

    return '';
  }

  private isLikelyVideoUrl(url: string): boolean {
    const lower = String(url || '').toLowerCase();
    return (
      lower.includes('.mp4') ||
      lower.includes('.m3u8') ||
      lower.includes('mime=video') ||
      lower.includes('sns-video')
    );
  }

  private extractNoteDataFromHtml(
    html: string,
    noteId?: string,
  ): VideoInfo | null {
    const stateCandidates = [
      this.extractAssignedObject(html, 'window.__INITIAL_STATE__'),
      this.extractAssignedObject(html, 'window.__INITIAL_SSR_STATE__'),
      this.extractAssignedObject(html, 'window.__PRELOADED_STATE__'),
    ].filter(Boolean);

    for (const candidate of stateCandidates) {
      const note = this.findLikelyNoteObject(candidate, noteId);
      if (!note) {
        continue;
      }

      const info = this.extractNoteData(note, noteId);
      if (info?.videoUrl) {
        return info;
      }
    }

    return null;
  }

  private extractAssignedObject(source: string, variableName: string): any {
    const index = source.indexOf(variableName);
    if (index < 0) {
      return null;
    }

    const objectStart = source.indexOf('{', index);
    if (objectStart < 0) {
      return null;
    }

    const objectLiteral = this.extractBalancedBraces(source, objectStart);
    if (!objectLiteral) {
      return null;
    }

    try {
      return JSON.parse(objectLiteral);
    } catch (_error) {
      const normalizedObjectLiteral = this.normalizeStateObjectLiteral(objectLiteral);
      try {
        return JSON.parse(normalizedObjectLiteral);
      } catch (_fallbackError) {
        return null;
      }
    }
  }

  private normalizeStateObjectLiteral(objectLiteral: string): string {
    return objectLiteral
      .replace(/:\s*undefined\b/g, ':null')
      .replace(/:\s*NaN\b/g, ':null')
      .replace(/:\s*Infinity\b/g, ':null');
  }

  private extractBalancedBraces(source: string, start: number): string {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < source.length; i += 1) {
      const char = source[i];

      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, i + 1);
        }
      }
    }

    return '';
  }

  private findLikelyNoteObject(root: any, noteId?: string): any {
    if (!root || typeof root !== 'object') {
      return null;
    }

    const queue: any[] = [root];
    const visited = new Set<any>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) {
        continue;
      }
      visited.add(current);

      const currentId = String(
        current.noteId ||
          current.note_id ||
          current.id ||
          current.note?.id ||
          '',
      );
      const hasVideoFields =
        !!current.video ||
        !!current.videoInfo ||
        !!current.media ||
        !!current.noteCard?.video;

      if (hasVideoFields) {
        if (!noteId || currentId === noteId) {
          return current;
        }
      }

      for (const value of Object.values(current)) {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return null;
  }

  private extractNoteData(noteData: any, noteId?: string): VideoInfo | null {
    if (!noteData || typeof noteData !== 'object') {
      return null;
    }

    const title =
      noteData.title ||
      noteData.note?.title ||
      noteData.desc ||
      noteData.note?.desc ||
      '小红书笔记';

    const description =
      noteData.desc ||
      noteData.description ||
      noteData.note?.desc ||
      '';

    const author =
      noteData.user?.nickname ||
      noteData.creator?.nickname ||
      noteData.author?.nickname ||
      noteData.note?.user?.nickname ||
      noteData.noteCard?.user?.nickname ||
      noteData.noteCard?.user?.nickName ||
      '';

    const cover = this.selectBestCoverUrl([
      this.extractCoverFromImageItem(noteData.imageList?.[0]),
      this.extractCoverFromImageItem(noteData.note?.imageList?.[0]),
      this.extractCoverFromImageItem(noteData.noteCard?.imageList?.[0]),
      noteData.cover?.url || '',
      noteData.coverUrl || '',
      noteData.note?.cover?.url || '',
      noteData.noteCard?.cover?.url || '',
      noteData.video?.cover?.url || '',
      noteData.note?.video?.cover?.url || '',
      noteData.noteCard?.video?.cover?.url || '',
    ]);

    const videoSources = [
      noteData.video,
      noteData.videoInfo,
      noteData.media,
      noteData.note?.video,
      noteData.noteCard?.video,
    ].filter(Boolean);

    const durationRaw = this.extractDurationFromVideoSources(noteData, videoSources);

    const urls: string[] = [];
    for (const source of videoSources) {
      this.collectPlayableUrls(source).forEach((item) => urls.push(item));
    }

    const uniqueUrls = Array.from(new Set(urls));
    const videoUrl = uniqueUrls[0] || '';

    if (!videoUrl) {
      return null;
    }

    const explicitQuality = this.extractVideoQualityFromSources(videoSources);
    const qualityKey = explicitQuality || 'source';
    const downloadOptions: VideoDownloadOptions = {
      merged: {
        [qualityKey]: videoUrl,
      },
    };

    return {
      title: this.normalizeTitle(title),
      cover: this.normalizeEscapedUrl(cover),
      duration: this.normalizeDuration(durationRaw),
      platform: 'xiaohongshu',
      author: this.cleanText(author),
      description: this.cleanText(description),
      videoUrl,
      downloadOptions,
      ...(explicitQuality
        ? {}
        : {
            qualityStatus: 'source_single_quality' as const,
            qualityMessage:
              '小红书源站当前只返回单路视频，无法准确识别清晰度，将按原始线路下载。',
          }),
    };
  }

  private extractDurationFromVideoSources(noteData: any, videoSources: any[]): number {
    const directCandidates = [
      noteData.video?.duration,
      noteData.video?.durationMs,
      noteData.video?.duration_ms,
      noteData.videoInfo?.duration,
      noteData.videoInfo?.durationMs,
      noteData.videoInfo?.duration_ms,
      noteData.media?.duration,
      noteData.media?.durationMs,
      noteData.media?.duration_ms,
      noteData.note?.video?.duration,
      noteData.note?.video?.durationMs,
      noteData.note?.video?.duration_ms,
      noteData.noteCard?.video?.duration,
      noteData.noteCard?.video?.durationMs,
      noteData.noteCard?.video?.duration_ms,
    ];

    for (const candidate of directCandidates) {
      const normalized = this.toPositiveNumber(candidate);
      if (normalized > 0) {
        return normalized;
      }
    }

    for (const source of videoSources) {
      const nested = this.findNestedPositiveNumber(source, [
        'duration',
        'durationMs',
        'duration_ms',
        'videoDuration',
        'video_duration',
      ]);
      if (nested > 0) {
        return nested;
      }
    }

    return 0;
  }

  private extractVideoQualityFromSources(videoSources: any[]): VideoQualityLabel | null {
    for (const source of videoSources) {
      const height = this.findNestedPositiveNumber(source, [
        'height',
        'videoHeight',
        'video_height',
      ]);
      const width = this.findNestedPositiveNumber(source, [
        'width',
        'videoWidth',
        'video_width',
      ]);
      const qualityDimension = this.resolveVideoQualityDimension(width, height);
      if (qualityDimension < 360 || qualityDimension > 4320) {
        continue;
      }

      const quality = this.mapHeightToVideoQuality(qualityDimension);
      if (quality) {
        return quality;
      }
    }

    return null;
  }

  private resolveVideoQualityDimension(width: number, height: number): number {
    const normalizedWidth = width >= 360 && width <= 4320 ? width : 0;
    const normalizedHeight = height >= 360 && height <= 4320 ? height : 0;

    if (normalizedWidth && normalizedHeight) {
      return Math.min(normalizedWidth, normalizedHeight);
    }

    return normalizedHeight || normalizedWidth || 0;
  }

  private findNestedPositiveNumber(root: any, candidateKeys: string[]): number {
    if (!root || typeof root !== 'object') {
      return 0;
    }

    const normalizedKeys = new Set(
      candidateKeys.map((item) => String(item || '').toLowerCase()),
    );
    const queue: any[] = [root];
    const visited = new Set<any>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          queue.push(item);
        }
        continue;
      }

      for (const [key, value] of Object.entries(current)) {
        const normalizedKey = String(key || '').toLowerCase();
        if (normalizedKeys.has(normalizedKey)) {
          const parsed = this.toPositiveNumber(value);
          if (parsed > 0) {
            return parsed;
          }
        }

        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return 0;
  }

  private toPositiveNumber(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return parsed;
  }

  private extractCoverFromImageItem(imageItem: any): string {
    if (!imageItem || typeof imageItem !== 'object') {
      return '';
    }

    const infoList = Array.isArray(imageItem.infoList) ? imageItem.infoList : [];
    const preferredInfo =
      infoList.find((item: any) => String(item?.imageScene || '').toUpperCase() === 'WB_DFT') ||
      infoList.find((item: any) => String(item?.imageScene || '').toUpperCase() === 'WB_PRV') ||
      infoList[0];

    return this.selectBestCoverUrl([
      imageItem.urlDefault || '',
      imageItem.urlPre || '',
      imageItem.url || '',
      preferredInfo?.url || '',
    ]);
  }

  private selectBestCoverUrl(candidates: string[]): string {
    const normalizedCandidates = candidates
      .map((value) => this.normalizeEscapedUrl(value || ''))
      .filter(Boolean);

    if (normalizedCandidates.length === 0) {
      return '';
    }

    let best = normalizedCandidates[0];
    let bestScore = this.scoreCoverUrl(best);

    for (let i = 1; i < normalizedCandidates.length; i += 1) {
      const current = normalizedCandidates[i];
      const currentScore = this.scoreCoverUrl(current);
      if (currentScore > bestScore) {
        best = current;
        bestScore = currentScore;
      }
    }

    return best;
  }

  private scoreCoverUrl(url: string): number {
    const lower = String(url || '').toLowerCase();
    let score = 0;

    if (lower.includes('!nd_dft_')) {
      score += 8;
    }
    if (lower.includes('wb_dft')) {
      score += 4;
    }
    if (lower.includes('!nd_prv_')) {
      score -= 6;
    }
    if (lower.includes('wb_prv')) {
      score -= 3;
    }
    if (lower.startsWith('https://')) {
      score += 1;
    }

    score += Math.min(4, Math.floor(lower.length / 120));
    return score;
  }

  private collectPlayableUrls(root: any): string[] {
    if (!root) {
      return [];
    }

    const queue: any[] = [root];
    const visited = new Set<any>();
    const collected: string[] = [];

    while (queue.length > 0 && collected.length < 60) {
      const current = queue.shift();
      if (current == null) {
        continue;
      }

      if (typeof current === 'string') {
        const url = this.extractPlayableUrl(current);
        if (url && this.isLikelyVideoUrl(url)) {
          collected.push(url);
        }
        continue;
      }

      if (typeof current !== 'object' || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          queue.push(item);
        }
        continue;
      }

      for (const value of Object.values(current)) {
        if (value == null) {
          continue;
        }

        if (typeof value === 'string') {
          const url = this.extractPlayableUrl(value);
          if (url && this.isLikelyVideoUrl(url)) {
            collected.push(url);
          }
          continue;
        }

        if (typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return Array.from(new Set(collected));
  }

  private inferVideoQualityFromUrl(url: string): string {
    const lower = String(url || '').toLowerCase();
    const matched = lower.match(/(2160|1440|1080|720|540|480|360)p?/);
    if (!matched?.[1]) {
      return '720p';
    }

    switch (matched[1]) {
      case '2160':
      case '1440':
        return '4k';
      case '1080':
        return '1080p';
      case '720':
        return '720p';
      case '540':
        return '540p';
      case '480':
        return '480p';
      case '360':
      default:
        return '360p';
    }
  }

  private normalizeDuration(raw: any): string {
    const parsed = Number(raw) || 0;
    if (!parsed || parsed <= 0) {
      return '--:--';
    }

    const seconds = parsed > 1000 ? Math.round(parsed / 1000) : Math.round(parsed);
    return this.formatDuration(seconds);
  }

  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) {
      return '--:--';
    }

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  private async getVideoInfoFromApi(noteId: string): Promise<VideoInfo | null> {
    try {
      const response = await axios.get(
        `https://edith.xiaohongshu.com/api/sns/web/v1/notes/${noteId}`,
        {
          headers: this.buildHeaders(),
          timeout: 10000,
        },
      );

      const note = response.data?.data?.note || null;
      if (!note) {
        return null;
      }

      return this.extractNoteData(note, noteId);
    } catch (error: any) {
      const parserError = this.normalizeParseError(error, noteId);
      if (this.isRetryableFetchFailure(parserError)) {
        throw parserError;
      }
      this.logger.warn(`小红书 API 解析失败: ${error?.message || 'unknown'}`);
      return null;
    }
  }

  private buildHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://www.xiaohongshu.com',
      Origin: 'https://www.xiaohongshu.com',
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
  }

}
