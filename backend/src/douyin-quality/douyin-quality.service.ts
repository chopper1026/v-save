import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { DouyinAuthService } from '../douyin-auth/douyin-auth.service';
import type { VideoDownloadOptions, VideoInfo } from '../parsers/base.interface';

type QualityStatus =
  | 'complete'
  | 'enriching'
  | 'session_required'
  | 'source_single_quality';

interface CachedQualityState {
  refreshKey: string;
  sessionKey: string;
  info: VideoInfo;
  status: QualityStatus;
  message: string | null;
  updatedAt: number;
  expiresAt: number;
}

@Injectable()
export class DouyinQualityService {
  private readonly logger = new Logger(DouyinQualityService.name);
  private readonly statusTtlMs = this.readPositiveIntEnv(
    'DOUYIN_QUALITY_STATUS_TTL_MS',
    20 * 60 * 1000,
  );
  private readonly stateByRefreshKey = new Map<string, CachedQualityState>();
  private readonly refreshKeyBySessionKey = new Map<string, string>();

  constructor(
    @Optional() private readonly douyinAuthService?: DouyinAuthService,
  ) {}

  async prepareParseResult(videoId: string, info: VideoInfo): Promise<VideoInfo> {
    if (info.platform !== 'douyin') {
      return info;
    }

    this.pruneExpiredStates();

    const cookieHeader = this.douyinAuthService
      ? await this.douyinAuthService.getCookieHeader().catch(() => '')
      : '';
    const envCookie = String(process.env.DOUYIN_COOKIE || '').trim();
    const normalizedCookie = String(cookieHeader || envCookie || '').trim();
    const sessionFingerprint = normalizedCookie
      ? this.hash(normalizedCookie).slice(0, 16)
      : 'anonymous';
    const sessionKey = `${String(videoId || '').trim()}|${sessionFingerprint}`;
    const existing = this.getStateBySessionKey(sessionKey);

    const refreshKey = existing?.refreshKey || `dyq:${this.hash(sessionKey).slice(0, 20)}`;
    const candidate = this.buildState(refreshKey, sessionKey, info);
    const selected =
      existing && this.compareStates(existing, candidate) > 0
        ? {
            ...existing,
            info: this.mergeVideoInfo(candidate.info, existing.info),
            updatedAt: Date.now(),
          }
        : candidate;

    this.setState(selected, this.statusTtlMs);
    return this.decorate(
      selected.info,
      selected.status,
      selected.refreshKey,
      selected.message,
    );
  }

  getQualityStatus(refreshKey: string): VideoInfo | null {
    this.pruneExpiredStates();
    const state = this.stateByRefreshKey.get(String(refreshKey || '').trim());
    if (!state) {
      return null;
    }

    return this.decorate(state.info, state.status, state.refreshKey, state.message);
  }

  async awaitQualityStatus(
    refreshKey: string,
    _waitMs = 0,
  ): Promise<VideoInfo | null> {
    return this.getQualityStatus(refreshKey);
  }

  private buildState(
    refreshKey: string,
    sessionKey: string,
    info: VideoInfo,
  ): CachedQualityState {
    const cleanedInfo = this.stripQualityMeta(info);
    const qualityCount = this.collectAvailableVideoQualities(
      cleanedInfo.downloadOptions,
    ).length;
    const status: QualityStatus =
      qualityCount >= 2 ? 'complete' : 'source_single_quality';
    const message =
      status === 'source_single_quality' ? '源站当前仅返回单档画质' : null;

    return {
      refreshKey,
      sessionKey,
      info: cleanedInfo,
      status,
      message,
      updatedAt: Date.now(),
      expiresAt: Date.now() + this.statusTtlMs,
    };
  }

  private compareStates(
    left: CachedQualityState,
    right: CachedQualityState,
  ): number {
    const leftCount = this.collectAvailableVideoQualities(left.info.downloadOptions).length;
    const rightCount = this.collectAvailableVideoQualities(right.info.downloadOptions).length;
    if (leftCount !== rightCount) {
      return leftCount - rightCount;
    }

    const leftBest = this.getBestVideoQualityRank(left.info.downloadOptions);
    const rightBest = this.getBestVideoQualityRank(right.info.downloadOptions);
    if (leftBest !== rightBest) {
      return leftBest - rightBest;
    }

    return left.updatedAt - right.updatedAt;
  }

  private getStateBySessionKey(sessionKey: string): CachedQualityState | null {
    const refreshKey = this.refreshKeyBySessionKey.get(sessionKey);
    if (!refreshKey) {
      return null;
    }
    return this.stateByRefreshKey.get(refreshKey) || null;
  }

  private setState(state: CachedQualityState, ttlMs: number): void {
    const expiresAt = Date.now() + Math.max(1, ttlMs);
    const nextState: CachedQualityState = {
      ...state,
      expiresAt,
    };
    this.stateByRefreshKey.set(nextState.refreshKey, nextState);
    this.refreshKeyBySessionKey.set(nextState.sessionKey, nextState.refreshKey);
  }

  private pruneExpiredStates(): void {
    const now = Date.now();
    for (const [refreshKey, state] of this.stateByRefreshKey.entries()) {
      if (state.expiresAt > now) {
        continue;
      }

      this.stateByRefreshKey.delete(refreshKey);
      if (this.refreshKeyBySessionKey.get(state.sessionKey) === refreshKey) {
        this.refreshKeyBySessionKey.delete(state.sessionKey);
      }
    }
  }

  private decorate(
    info: VideoInfo,
    status: QualityStatus,
    refreshKey: string,
    message: string | null,
  ): VideoInfo {
    return {
      ...this.stripQualityMeta(info),
      qualityStatus: status,
      qualityRefreshKey: refreshKey,
      qualityMessage: message || undefined,
    };
  }

  private mergeVideoInfo(baseInfo: VideoInfo, incoming: VideoInfo): VideoInfo {
    const mergedDownloadOptions = this.mergeDownloadOptions(
      baseInfo.downloadOptions,
      incoming.downloadOptions,
    );

    return {
      ...baseInfo,
      ...incoming,
      title: incoming.title || baseInfo.title,
      cover: incoming.cover || baseInfo.cover,
      duration: incoming.duration || baseInfo.duration,
      platform: 'douyin',
      author: incoming.author || baseInfo.author,
      description: incoming.description || baseInfo.description,
      sourceUrl: incoming.sourceUrl || baseInfo.sourceUrl,
      videoUrl: incoming.videoUrl || baseInfo.videoUrl,
      audioUrl: incoming.audioUrl || baseInfo.audioUrl,
      downloadOptions: mergedDownloadOptions,
    };
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

  private stripQualityMeta(info: VideoInfo): VideoInfo {
    const { qualityStatus, qualityRefreshKey, qualityMessage, ...rest } = info;
    return rest as VideoInfo;
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

  private hash(value: string): string {
    return createHash('sha256').update(String(value || '')).digest('hex');
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
