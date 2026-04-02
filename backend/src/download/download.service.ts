import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { DownloadHistory } from './entities/download-history.entity';
import { DownloadTask, DownloadTaskStatus } from './entities/download-task.entity';
import { ParsersService } from '../parsers/parsers.service';
import {
  VideoInfo,
  VideoDownloadOptions,
  VideoStreamCandidate,
} from '../parsers/base.interface';
import { DouyinProbeMode, VideoFormat, VideoQuality } from './dto/download.dto';
import { UsersService } from '../users/users.service';
import axios from 'axios';
import { execFile, spawn, spawnSync } from 'child_process';
import { Response } from 'express';
import { BilibiliAuthService } from '../bilibili-auth/bilibili-auth.service';
import { DouyinAuthService } from '../douyin-auth/douyin-auth.service';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve, sep } from 'path';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { ObservabilityService } from '../observability/observability.service';
import { RequestContextService } from '../observability/request-context.service';
import { RuntimeMonitorService } from '../runtime-monitor/runtime-monitor.service';
import { resolveYtDlpPath } from '../config/executable-paths';
import { DouyinOptimizationService } from '../douyin-optimization/douyin-optimization.service';
import { DownloadModeService } from '../download-mode/download-mode.service';
import { DownloadClientType } from '../download-mode/download-mode.types';
import type {
  RuntimeClientType,
  RuntimeTraceStage,
} from '../runtime-monitor/runtime-monitor.types';
import {
  normalizeRuntimeTraceId,
  normalizeRuntimePlatform,
} from '../runtime-monitor/runtime-monitor.utils';
import {
  detectObservedPlatformFromUrl,
  extractSourceHost,
  normalizeObservedErrorCode,
  normalizeObservedPlatform,
  type DownloadTaskMetricStatus,
  type ObservedPlatform,
} from '../observability/observability.utils';
import {
  resolveNativeSilentDownloadAuthPolicy,
  resolveNativeSilentDownloadQuality,
  shouldUseNativeSilentDownloadAsyncTask,
  shouldUseNativeSilentDownloadIosCompatibleFirstAttempt,
} from './native-silent-download-policy';

const execFileAsync = promisify(execFile);

/**
 * 视频信息接口（包含额外字段）
 */
export interface ExtendedVideoInfo extends VideoInfo {
  downloadOptions?: VideoDownloadOptions;
  qualities?: Record<string, { url: string; size?: string }>;
}

interface ResolvedStream {
  url: string;
  quality: string;
}

interface DownloadUrlResolution {
  downloadUrl: string;
  format: string;
  quality: string;
  fileExtension: string;
  actualQuality?: string;
  actualWidth?: number;
  actualHeight?: number;
}

interface DouyinStreamProbeResult {
  status: 'ok' | 'miss' | 'watermark_fallback_required';
  finalUrl?: string;
  actualUrl?: string;
  width?: number;
  height?: number;
  quality?: string;
  usedWatermarkFallback?: boolean;
}

interface DouyinProbeCandidateResult {
  stream: ResolvedStream | null;
  actualQuality?: string;
  actualWidth?: number;
  actualHeight?: number;
  usedWatermarkFallback?: boolean;
  watermarkFallbackRequired?: boolean;
}

interface DouyinDirectStreamSelectionResult {
  stream: ResolvedStream;
  actualQuality?: string;
  actualWidth?: number;
  actualHeight?: number;
}

interface MergeStrategyOptions {
  allowNonSegmented?: boolean;
}

interface CreateTaskResult {
  id: string;
  status: DownloadTaskStatus;
  progress: number;
}

interface TaskProgressSnapshot {
  id: string;
  status: DownloadTaskStatus;
  progress: number;
  message: string | null;
  title: string;
  format: string;
  quality: string;
  platform: string;
  fileExtension: string | null;
  downloadUrl: string | null;
  runtimeTraceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface QueryDownloadHistoryInput {
  limit?: number;
  offset?: number;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface CheckDownloadPermissionInput {
  userId: string;
  platform: VideoInfo['platform'];
  quality?: VideoQuality;
  entryType?: 'get-url' | 'create-task';
}

interface PrepareNativeSilentDownloadInput {
  userId: string;
  sourceUrl: string;
  clientType?: DownloadClientType;
  iosCompatible?: boolean | null;
  runtimeTraceId?: string | null;
}

export type NativeSilentDownloadPreparation =
  | {
      mode: 'direct';
      downloadUrl: string;
      fileExtension: string;
      fileName: string;
      quality: string;
      platform: VideoInfo['platform'];
      iosCompatible: boolean;
      authPolicy: 'none' | 'bearer';
      runtimeTraceId: string | null;
    }
  | {
      mode: 'serverTask';
      taskId: string;
      pollIntervalMs: number;
      fileName: string;
      quality: string;
      platform: VideoInfo['platform'];
      iosCompatible: boolean;
      authPolicy: 'none' | 'bearer';
      runtimeTraceId: string | null;
    };

/**
 * 下载服务
 */
@Injectable()
export class DownloadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DownloadService.name);
  private readonly ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  private readonly ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  private readonly ytDlpPath = this.resolveYtDlpPath();
  private readonly tasksDir = resolve(process.cwd(), 'tmp', 'download-tasks');
  private readonly downloadTaskRetentionMs = this.readPositiveIntEnv(
    'DOWNLOAD_TASK_RETENTION_MS',
    6 * 60 * 60 * 1000,
  );
  private readonly downloadTaskCleanupIntervalMs = this.readPositiveIntEnv(
    'DOWNLOAD_TASK_CLEANUP_INTERVAL_MS',
    10 * 60 * 1000,
  );
  private readonly downloadTaskCleanupBatchSize = this.readPositiveIntEnv(
    'DOWNLOAD_TASK_CLEANUP_BATCH_SIZE',
    100,
  );
  private readonly ytDlpConcurrentFragments = this.readPositiveIntEnv(
    'YTDLP_CONCURRENT_FRAGMENTS',
    4,
  );
  private readonly iosTranscodePreset = this.readStringEnv(
    'IOS_TRANSCODE_PRESET',
    'veryfast',
  );
  private readonly iosTranscodeCrf = this.readPositiveIntEnv(
    'IOS_TRANSCODE_CRF',
    23,
  );
  private readonly douyinProbeTimeoutMs = this.readPositiveIntEnv(
    'DOUYIN_DOWNLOAD_PROBE_TIMEOUT_MS',
    6000,
  );
  private readonly douyinProbeCacheTtlMs = this.readPositiveIntEnv(
    'DOUYIN_DOWNLOAD_PROBE_CACHE_TTL_MS',
    45 * 1000,
  );
  private readonly douyinProbeLines = this.parseDouyinProbeLines(
    process.env.DOUYIN_DOWNLOAD_PROBE_LINES || '4,3,2,1,0',
  );
  private readonly douyinStrictProbeConcurrency = this.readPositiveIntEnv(
    'DOUYIN_STRICT_PROBE_CONCURRENCY',
    2,
  );
  private readonly douyinStrictProbeBudgetMs = this.readPositiveIntEnv(
    'DOUYIN_STRICT_PROBE_BUDGET_MS',
    9000,
  );
  private readonly douyinSmartProbeBudgetMs = this.readPositiveIntEnv(
    'DOUYIN_SMART_PROBE_BUDGET_MS',
    1800,
  );
  private readonly douyinQualityAwaitMs = this.readPositiveIntEnv(
    'DOUYIN_QUALITY_AWAIT_MS',
    1200,
  );
  private readonly taskQueue: string[] = [];
  private readonly douyinProbeCache = new Map<
    string,
    {
      expiresAt: number;
      result: DouyinStreamProbeResult;
    }
  >();
  private readonly douyinProbeInflight = new Map<
    string,
    Promise<DouyinStreamProbeResult>
  >();
  private readonly douyinStrictWarmInflight = new Map<string, Promise<void>>();
  private isTaskWorkerRunning = false;
  private cleanupIntervalTimer: NodeJS.Timeout | null = null;
  private isCleanupRunning = false;

  constructor(
    @InjectRepository(DownloadHistory)
    private downloadHistoryRepository: Repository<DownloadHistory>,
    @InjectRepository(DownloadTask)
    private downloadTaskRepository: Repository<DownloadTask>,
    private parsersService: ParsersService,
    private usersService: UsersService,
    private bilibiliAuthService: BilibiliAuthService,
    @Optional() private readonly douyinAuthService?: DouyinAuthService,
    @Optional() private readonly observabilityService?: ObservabilityService,
    @Optional() private readonly requestContextService?: RequestContextService,
    @Optional() private readonly runtimeMonitorService?: RuntimeMonitorService,
    @Optional()
    private readonly douyinOptimizationService?: DouyinOptimizationService,
    @Optional()
    private readonly downloadModeService?: DownloadModeService,
  ) {
    mkdirSync(this.tasksDir, { recursive: true });
  }

  async onModuleInit(): Promise<void> {
    const statuses: DownloadTaskMetricStatus[] = [
      'queued',
      'downloading',
      'merging',
      'completed',
      'failed',
      'expired',
    ];
    const counts = await Promise.all(
      statuses.map(async (status) => ({
        status,
        count: await this.downloadTaskRepository.count({ where: { status } }),
      })),
    );
    this.observabilityService?.initializeDownloadTaskStatusCounts(
      counts.reduce(
        (acc, item) => {
          acc[item.status] = item.count;
          return acc;
        },
        {} as Record<DownloadTaskMetricStatus, number>,
      ),
    );

    void this.runCleanupCycle();
    this.cleanupIntervalTimer = setInterval(() => {
      void this.runCleanupCycle();
    }, this.downloadTaskCleanupIntervalMs);
    this.cleanupIntervalTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupIntervalTimer) {
      clearInterval(this.cleanupIntervalTimer);
      this.cleanupIntervalTimer = null;
    }
  }

  private hashValue(value: string | undefined | null): string | null {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  private logStructured(
    level: 'log' | 'warn' | 'error' | 'debug',
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const message = JSON.stringify({
      event,
      requestId: this.requestContextService?.getRequestId() || null,
      ...payload,
    });
    this.logger[level](message);
  }

  private recordUpstreamRequest(input: {
    upstream: 'proxy_fetch' | 'yt_dlp' | 'ffmpeg_merge' | 'ffmpeg_ios_merge';
    platform: ObservedPlatform;
    outcome: 'success' | 'business_error' | 'system_error';
    errorCode: string;
    durationMs: number;
    traceId?: string | null;
    taskId?: string | null;
    stage?: RuntimeTraceStage;
    clientType?: RuntimeClientType | null;
    interfaceName?: string;
  }): void {
    this.observabilityService?.recordUpstreamRequest(input);
    void this.runtimeMonitorService?.recordInterfaceEvent({
      traceId: normalizeRuntimeTraceId(input.traceId),
      taskId: input.taskId || null,
      platform: normalizeRuntimePlatform(input.platform),
      clientType: input.clientType || 'unknown',
      stage: input.stage || 'download',
      interfaceName:
        input.interfaceName || `upstream.${String(input.upstream || 'unknown')}`,
      outcome: input.outcome === 'success' ? 'success' : 'failure',
      latencyMs: input.durationMs,
      errorCode: input.errorCode,
    });
  }

  async checkDownloadPermission(
    input: CheckDownloadPermissionInput,
  ): Promise<{ allowed: boolean; message?: string; code?: string }> {
    const user = await this.usersService.findById(input.userId);
    if (!user) {
      return {
        allowed: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请重新登录',
      };
    }

    if (user.accountStatus === 'DISABLED') {
      return {
        allowed: false,
        code: 'ACCOUNT_DISABLED',
        message: '账号已被禁用，请联系管理员',
      };
    }

    return { allowed: true };
  }

  /**
   * 解析视频信息
   * @param url 视频URL
   * @param userId 可选的用户ID
   */
  async parseVideo(url: string, userId?: string): Promise<VideoInfo | null> {
    const normalizedUrl = this.extractFirstHttpUrl(url) || url.trim();
    this.logStructured('log', 'download_parse_started', {
      userType: userId ? 'authenticated' : 'anonymous',
      sourceHost: extractSourceHost(normalizedUrl),
      sourceHash: this.hashValue(normalizedUrl),
    });

    try {
      const videoInfo = await this.parsersService.parse(normalizedUrl);

      if (videoInfo) {
        this.logStructured('log', 'download_parse_succeeded', {
          platform: normalizeObservedPlatform(videoInfo.platform),
          sourceHost: extractSourceHost(normalizedUrl),
          sourceHash: this.hashValue(normalizedUrl),
          titleHash: this.hashValue(videoInfo.title),
        });
      }

      return videoInfo;
    } catch (error) {
      this.logStructured('error', 'download_parse_failed', {
        sourceHost: extractSourceHost(normalizedUrl),
        sourceHash: this.hashValue(normalizedUrl),
        errorCode: normalizeObservedErrorCode(error),
        message: (error as any)?.message || 'unknown',
      });
      throw error;
    }
  }

  private extractFirstHttpUrl(input: string): string {
    if (!input) {
      return '';
    }

    const normalized = input.trim();
    if (/^https?:\/\//i.test(normalized)) {
      return this.trimWrappedUrl(normalized);
    }

    const matches = normalized.match(/https?:\/\/[^\s]+/gi) || [];
    for (const match of matches) {
      const candidate = this.trimWrappedUrl(match);
      if (/^https?:\/\//i.test(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  private trimWrappedUrl(value: string): string {
    let result = value.trim();
    result = result.replace(/^[<>\(\)\[\]\{\}"'“”‘’]+/, '');
    result = result.replace(/[<>\(\)\[\]\{\}"'“”‘’，。！？、；：]+$/, '');
    return result;
  }

  /**
   * 获取下载链接
   * @param videoInfo 视频信息
   * @param format 视频格式
   * @param quality 视频质量
   */
  async getDownloadUrl(
    videoInfo: VideoInfo | string,
    format?: VideoFormat,
    quality?: string,
    iosCompatible = false,
    allowWatermarkFallback = true,
    probeMode: DouyinProbeMode | string = DouyinProbeMode.STRICT,
    runtimeTraceId?: string | null,
  ): Promise<DownloadUrlResolution> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    // 如果传入的是字符串（JSON），解析它
    let info: ExtendedVideoInfo;
    if (typeof videoInfo === 'string') {
      info = JSON.parse(videoInfo);
    } else {
      info = videoInfo as ExtendedVideoInfo;
    }

    const resolvedProbeMode = this.normalizeDouyinProbeMode(probeMode);
    this.logStructured('log', 'download_get_url_requested', {
      platform: normalizeObservedPlatform(info.platform),
      format: format || VideoFormat.MP4,
      quality: quality || VideoQuality.HD,
      iosCompatible,
      allowWatermarkFallback,
      probeMode: resolvedProbeMode,
      sourceHost: extractSourceHost(info.sourceUrl || info.videoUrl),
    });

    // 优先使用用户请求的格式和质量
    const selectedFormat = format || VideoFormat.MP4;
    const selectedQuality = quality || VideoQuality.HD;
    info = await this.awaitDouyinCompletedQualityIfNeeded(
      info,
      selectedFormat,
      selectedQuality,
    );

    // 兼容旧字段 qualities
    const legacyVideoMap = Object.entries(info.qualities || {}).reduce(
      (acc, [key, value]) => {
        if (value?.url) {
          acc[key] = value.url;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    const downloadOptions: VideoDownloadOptions = {
      merged: info.downloadOptions?.merged,
      video:
        info.downloadOptions?.video ||
        (Object.keys(legacyVideoMap).length > 0 ? legacyVideoMap : undefined),
      videoCandidates: info.downloadOptions?.videoCandidates,
      audio: info.downloadOptions?.audio,
    };
    const selectedVideoQualityMap = this.getVideoQualityMapForSelection(
      downloadOptions,
      info.platform,
      iosCompatible,
    );
    const shouldProbeDouyinHighQuality =
      info.platform === 'douyin' &&
      selectedFormat !== VideoFormat.AUDIO &&
      this.shouldProbeDouyinHighQuality(selectedQuality) &&
      resolvedProbeMode !== DouyinProbeMode.FAST;

    let downloadUrl = info.videoUrl;
    let resolvedQuality = selectedQuality;
    let fileExtension = 'mp4';
    let actualQuality: string | undefined;
    let actualWidth: number | undefined;
    let actualHeight: number | undefined;

    if (selectedFormat === VideoFormat.AUDIO) {
      const hasAudioOptions = this.hasPopulatedQualityMap(downloadOptions.audio);
      const hasIndependentAudioUrl = this.hasIndependentAudioSource(
        info.audioUrl || '',
        info.videoUrl || '',
      );

      if (!hasAudioOptions && !hasIndependentAudioUrl) {
        throw new BadRequestException(
          '当前平台未提供独立音频流，暂不支持音频下载',
        );
      }

      const resolvedAudio =
        this.pickAudioStreamByQuality(downloadOptions.audio, selectedQuality) ||
        this.toResolvedStream(info.audioUrl || '', selectedQuality);

      if (
        !resolvedAudio.url ||
        this.isSameMediaSource(resolvedAudio.url, info.videoUrl || '')
      ) {
        throw new BadRequestException(
          '当前平台未提供独立音频流，暂不支持音频下载',
        );
      }

      downloadUrl = resolvedAudio.url;
      resolvedQuality = resolvedAudio.quality;
      fileExtension = this.inferFileExtension(downloadUrl, 'm4a');
    } else if (selectedFormat === VideoFormat.WEBM) {
      let resolvedVideo =
        this.pickVideoStreamByQuality(selectedVideoQualityMap, selectedQuality) ||
        this.pickVideoStreamByQuality(downloadOptions.merged, selectedQuality) ||
        this.toResolvedStream(info.videoUrl, selectedQuality);

      if (shouldProbeDouyinHighQuality) {
        const douyinProbeQualityMap = {
          [resolvedVideo.quality]: resolvedVideo.url,
          ...(downloadOptions.merged || {}),
          ...(selectedVideoQualityMap || {}),
        };
        const probed = await this.resolveDouyinStreamForMode(
          douyinProbeQualityMap,
          selectedQuality,
          allowWatermarkFallback,
          resolvedProbeMode,
        );
        if (probed.watermarkFallbackRequired) {
          throw this.buildDouyinWatermarkFallbackRequiredError(selectedQuality);
        }
        if (probed.stream) {
          resolvedVideo = probed.stream;
          if (probed.actualQuality) {
            resolvedQuality = probed.actualQuality;
            actualQuality = probed.actualQuality;
          }
          if (typeof probed.actualWidth === 'number') {
            actualWidth = probed.actualWidth;
          }
          if (typeof probed.actualHeight === 'number') {
            actualHeight = probed.actualHeight;
          }
        }
      } else if (info.platform === 'douyin') {
        const selected = await this.resolveDouyinDirectStreamWithoutWatermarkFallback(
          resolvedVideo,
          selectedQuality,
          allowWatermarkFallback,
        );
        resolvedVideo = selected.stream;
        if (selected.actualQuality) {
          resolvedQuality = selected.actualQuality;
          actualQuality = selected.actualQuality;
        }
        if (typeof selected.actualWidth === 'number') {
          actualWidth = selected.actualWidth;
        }
        if (typeof selected.actualHeight === 'number') {
          actualHeight = selected.actualHeight;
        }
      }

      downloadUrl = resolvedVideo.url;
      resolvedQuality = actualQuality || resolvedVideo.quality;
      fileExtension = this.inferFileExtension(downloadUrl, 'webm');
    } else {
      // mp4 优先使用带音频的 merged 流，避免“下载后没声音”
      const resolvedMerged =
        info.platform === 'douyin'
          ? null
          : this.pickVideoStreamByQuality(
              downloadOptions.merged,
              selectedQuality,
              true,
            ) || null;
      const resolvedVideo =
        this.pickVideoStreamByQuality(selectedVideoQualityMap, selectedQuality) ||
        this.pickVideoStreamByQuality(downloadOptions.merged, selectedQuality) ||
        this.toResolvedStream(info.videoUrl, selectedQuality);
      const resolvedAudio =
        this.pickAudioStreamByQuality(downloadOptions.audio, '192k') ||
        this.toResolvedStream(info.audioUrl || '', '192k');

      const shouldUseServerMergeByDefault = this.shouldUseServerMerge(
        resolvedMerged,
        resolvedVideo,
        resolvedAudio,
        {
          allowNonSegmented: info.platform === 'youtube',
        },
      );
      const shouldForceIosCompatibleMerge =
        iosCompatible &&
        !!resolvedVideo.url &&
        !!resolvedAudio.url &&
        !this.isSameMediaSource(resolvedVideo.url, resolvedAudio.url);
      const shouldUseServerMerge =
        shouldForceIosCompatibleMerge || shouldUseServerMergeByDefault;

      if (shouldUseServerMerge) {
        downloadUrl = this.buildMergeEndpointUrl(
          resolvedVideo.url,
          resolvedAudio.url,
          info.title || 'video',
          shouldForceIosCompatibleMerge,
          traceId,
        );
        resolvedQuality = resolvedVideo.quality;
      } else {
        let finalVideo = resolvedMerged || resolvedVideo;

        if (shouldProbeDouyinHighQuality) {
          const douyinProbeQualityMap = {
            [finalVideo.quality]: finalVideo.url,
            ...(downloadOptions.merged || {}),
            ...(selectedVideoQualityMap || {}),
          };
          const probed = await this.resolveDouyinStreamForMode(
            douyinProbeQualityMap,
            selectedQuality,
            allowWatermarkFallback,
            resolvedProbeMode,
          );
          if (probed.watermarkFallbackRequired) {
            throw this.buildDouyinWatermarkFallbackRequiredError(selectedQuality);
          }
          if (probed.stream) {
            finalVideo = probed.stream;
            if (probed.actualQuality) {
              resolvedQuality = probed.actualQuality;
              actualQuality = probed.actualQuality;
            }
            if (typeof probed.actualWidth === 'number') {
              actualWidth = probed.actualWidth;
            }
          if (typeof probed.actualHeight === 'number') {
            actualHeight = probed.actualHeight;
          }
        }
        } else if (info.platform === 'douyin') {
          const selected = await this.resolveDouyinDirectStreamWithoutWatermarkFallback(
            finalVideo,
            selectedQuality,
            allowWatermarkFallback,
          );
          finalVideo = selected.stream;
          if (selected.actualQuality) {
            resolvedQuality = selected.actualQuality;
            actualQuality = selected.actualQuality;
          }
          if (typeof selected.actualWidth === 'number') {
            actualWidth = selected.actualWidth;
          }
          if (typeof selected.actualHeight === 'number') {
            actualHeight = selected.actualHeight;
          }
        }

        downloadUrl = finalVideo.url;
        resolvedQuality = actualQuality || finalVideo.quality;
      }

      fileExtension = this.inferFileExtension(downloadUrl, 'mp4');
    }

    if (!downloadUrl) {
      throw new Error('当前视频暂无可用下载链接');
    }

    this.logStructured('log', 'download_get_url_succeeded', {
      platform: normalizeObservedPlatform(info.platform),
      format: selectedFormat,
      quality: resolvedQuality,
      fileExtension,
      actualQuality: actualQuality || null,
      actualWidth: actualWidth || null,
      actualHeight: actualHeight || null,
      sourceHost: extractSourceHost(downloadUrl),
    });

    if (
      info.platform === 'douyin' &&
      selectedFormat !== VideoFormat.AUDIO &&
      !downloadUrl.startsWith('/api/') &&
      this.isDouyinPlayLikeUrl(downloadUrl)
    ) {
      downloadUrl = this.buildProxyFetchUrl(
        downloadUrl,
        'video',
        allowWatermarkFallback,
        traceId,
      );
    }

    return {
      downloadUrl,
      format: selectedFormat,
      quality: resolvedQuality,
      fileExtension,
      actualQuality,
      actualWidth,
      actualHeight,
    };
  }

  getDouyinQualityStatus(refreshKey: string): VideoInfo | null {
    return this.parsersService.getDouyinQualityStatus(refreshKey);
  }

  private resolveSilentDownloadPermissionQuality(quality?: string): VideoQuality {
    switch (quality) {
      case VideoQuality.SD:
        return VideoQuality.SD;
      case VideoQuality.FHD:
        return VideoQuality.FHD;
      case '1440p':
      case VideoQuality.QHD:
        return VideoQuality.QHD;
      case VideoQuality.UHD:
        return VideoQuality.UHD;
      case VideoQuality.HD:
      default:
        return VideoQuality.HD;
    }
  }

  async prepareNativeSilentDownload(
    input: PrepareNativeSilentDownloadInput,
  ): Promise<NativeSilentDownloadPreparation> {
    const normalizedSourceUrl =
      this.extractFirstHttpUrl(input.sourceUrl) || String(input.sourceUrl || '').trim();
    if (!normalizedSourceUrl) {
      throw new BadRequestException('请提供视频来源链接');
    }

    const parsedVideoInfo = await this.parseVideo(normalizedSourceUrl, input.userId);
    if (!parsedVideoInfo) {
      throw new BadRequestException('未检测到可解析的视频链接');
    }

    const quality = resolveNativeSilentDownloadQuality(parsedVideoInfo as ExtendedVideoInfo);
    const permission = await this.checkDownloadPermission({
      userId: input.userId,
      platform: parsedVideoInfo.platform,
      quality: this.resolveSilentDownloadPermissionQuality(quality),
      entryType: 'get-url',
    });

    if (!permission.allowed) {
      throw new ForbiddenException({
        code: permission.code,
        message: permission.message || '当前账号暂无下载权限',
      });
    }

    const heuristicIosCompatible =
      shouldUseNativeSilentDownloadIosCompatibleFirstAttempt({
        parsedVideo: parsedVideoInfo as ExtendedVideoInfo,
        targetQuality: quality,
      });
    const iosCompatibleFirstAttempt =
      typeof input.iosCompatible === 'boolean'
        ? input.iosCompatible
        : heuristicIosCompatible;

    if (
      shouldUseNativeSilentDownloadAsyncTask({
        platform: parsedVideoInfo.platform,
        quality,
        iosCompatible: iosCompatibleFirstAttempt,
      })
    ) {
      const task = await this.createDownloadTask(
        input.userId,
        normalizedSourceUrl,
        {
          ...parsedVideoInfo,
          sourceUrl: normalizedSourceUrl,
        },
        VideoFormat.MP4,
        quality,
        input.runtimeTraceId,
      );

      return {
        mode: 'serverTask',
        taskId: task.id,
        pollIntervalMs: 1200,
        fileName: parsedVideoInfo.title || 'vsave-video',
        quality,
        platform: parsedVideoInfo.platform,
        iosCompatible: iosCompatibleFirstAttempt,
        authPolicy: 'bearer',
        runtimeTraceId: normalizeRuntimeTraceId(input.runtimeTraceId),
      };
    }

    const resolvedPolicy = this.downloadModeService
      ? await this.downloadModeService.resolveGetUrlPolicy({
          clientType: input.clientType || DownloadClientType.MOBILE,
          videoInfo: parsedVideoInfo,
          format: VideoFormat.MP4,
          quality,
          overrides: {
            iosCompatible: iosCompatibleFirstAttempt,
            allowWatermarkFallback: false,
          },
        })
      : {
          iosCompatible: iosCompatibleFirstAttempt,
          allowWatermarkFallback: false,
          probeMode: DouyinProbeMode.STRICT,
        };

    const result = await this.getDownloadUrl(
      {
        ...parsedVideoInfo,
        sourceUrl: normalizedSourceUrl,
      },
      VideoFormat.MP4,
      quality,
      resolvedPolicy.iosCompatible,
      resolvedPolicy.allowWatermarkFallback,
      resolvedPolicy.probeMode,
      input.runtimeTraceId,
    );

    await this.recordDownload(
      input.userId,
      {
        ...parsedVideoInfo,
        sourceUrl: normalizedSourceUrl,
      },
      result.format,
      result.quality,
      result.downloadUrl,
    );

    return {
      mode: 'direct',
      downloadUrl: result.downloadUrl,
      fileExtension: result.fileExtension,
      fileName: parsedVideoInfo.title || 'vsave-video',
      quality: result.quality,
      platform: parsedVideoInfo.platform,
      iosCompatible: resolvedPolicy.iosCompatible,
      authPolicy: resolveNativeSilentDownloadAuthPolicy(result.downloadUrl),
      runtimeTraceId: normalizeRuntimeTraceId(input.runtimeTraceId),
    };
  }

  async createDownloadTask(
    userId: string,
    sourceUrl: string,
    videoInfo: VideoInfo | string,
    format?: VideoFormat,
    quality?: string,
    runtimeTraceId?: string | null,
  ): Promise<CreateTaskResult> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    let info: ExtendedVideoInfo;
    if (typeof videoInfo === 'string') {
      info = JSON.parse(videoInfo);
    } else {
      info = videoInfo as ExtendedVideoInfo;
    }

    const selectedFormat = format || VideoFormat.MP4;
    const selectedQuality = quality || VideoQuality.HD;

    if (info.platform !== 'youtube') {
      throw new Error('当前异步下载仅支持 YouTube 平台');
    }

    if (selectedFormat === VideoFormat.AUDIO) {
      throw new Error('当前异步任务仅用于视频下载');
    }

    const history = await this.recordDownload(
      userId,
      {
        ...info,
        sourceUrl,
      },
      selectedFormat,
      selectedQuality,
      undefined,
      {
        status: 'pending',
      },
    );

    const task = this.downloadTaskRepository.create({
      userId,
      sourceUrl,
      platform: info.platform,
      title: info.title || 'YouTube 视频',
      format: selectedFormat,
      quality: selectedQuality,
      downloadHistoryId: history.id,
      runtimeTraceId: traceId,
      status: 'queued',
      progress: 0,
      message: '任务已排队',
      outputPath: null,
      fileExtension: null,
      downloadUrl: null,
    });

    const savedTask = await this.downloadTaskRepository.save(task);
    this.observabilityService?.recordDownloadTaskTransition({
      fromStatus: null,
      toStatus: savedTask.status,
      platform: normalizeObservedPlatform(savedTask.platform),
    });
    this.logStructured('log', 'download_task_created', {
      taskId: savedTask.id,
      platform: normalizeObservedPlatform(savedTask.platform),
      quality: savedTask.quality,
      format: savedTask.format,
      sourceHost: extractSourceHost(sourceUrl),
      traceId,
    });
    this.enqueueTask(savedTask.id);

    return {
      id: savedTask.id,
      status: savedTask.status,
      progress: savedTask.progress,
    };
  }

  async getTaskProgress(
    userId: string,
    taskId: string,
  ): Promise<TaskProgressSnapshot | null> {
    const task = await this.downloadTaskRepository.findOne({
      where: { id: taskId, userId },
    });

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      status: task.status,
      progress: task.progress,
      message: task.message,
      title: task.title,
      format: task.format,
      quality: task.quality,
      platform: task.platform,
      fileExtension: task.fileExtension,
      downloadUrl: task.status === 'completed' ? this.buildTaskDownloadUrl(task.id) : null,
      runtimeTraceId: task.runtimeTraceId || null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async streamTaskFile(
    userId: string,
    taskId: string,
    res: Response,
    options?: {
      waitUntilReady?: boolean;
      timeoutMs?: number;
    },
  ): Promise<void> {
    let task = await this.downloadTaskRepository.findOne({
      where: { id: taskId, userId },
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    if (
      options?.waitUntilReady &&
      (task.status !== 'completed' || !task.outputPath)
    ) {
      task = await this.waitForTaskFile(userId, taskId, options.timeoutMs);
    }

    if (task.status === 'expired') {
      throw new Error('任务文件已过期，请重新创建下载任务');
    }

    if (task.status !== 'completed' || !task.outputPath) {
      throw new Error('任务尚未完成，暂不可下载');
    }

    if (!existsSync(task.outputPath)) {
      throw new Error('任务文件不存在，请重新创建下载任务');
    }

    const extension = task.fileExtension || 'mp4';
    const safeTitle = this.toSafeFilename(task.title || 'video');
    const filename = `${safeTitle}.${extension}`;

    const contentType = this.getContentTypeByExtension(extension);
    const fileSize = statSync(task.outputPath).size;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'no-store');

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(task.outputPath!);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  }

  private async waitForTaskFile(
    userId: string,
    taskId: string,
    timeoutMs = 15 * 60 * 1000,
  ): Promise<DownloadTask> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < Math.max(1_000, timeoutMs)) {
      const task = await this.downloadTaskRepository.findOne({
        where: { id: taskId, userId },
      });

      if (!task) {
        throw new Error('任务不存在');
      }

      if (task.status === 'completed' && task.outputPath) {
        return task;
      }

      if (task.status === 'failed') {
        throw new Error(task.message || '下载任务失败');
      }

      if (task.status === 'expired') {
        throw new Error(task.message || '任务文件已过期，请重新创建下载任务');
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('任务尚未完成，暂不可下载');
  }

  private enqueueTask(taskId: string): void {
    this.taskQueue.push(taskId);
    void this.runTaskWorker();
  }

  private async runCleanupCycle(): Promise<void> {
    if (this.isCleanupRunning) {
      return;
    }

    this.isCleanupRunning = true;
    try {
      const expireBefore = new Date(Date.now() - this.downloadTaskRetentionMs);
      await this.cleanupExpiredTaskFiles(expireBefore);
    } catch (error: any) {
      this.logStructured('warn', 'download_task_cleanup_failed', {
        errorCode: normalizeObservedErrorCode(error),
        message: error?.message || 'unknown',
      });
    } finally {
      this.isCleanupRunning = false;
    }
  }

  private async cleanupExpiredTaskFiles(expireBefore: Date): Promise<void> {
    const expiredTasks = await this.downloadTaskRepository.find({
      where: {
        status: In(['completed', 'failed']),
        updatedAt: LessThan(expireBefore),
      },
      order: {
        updatedAt: 'ASC',
      },
      take: this.downloadTaskCleanupBatchSize,
    });

    if (expiredTasks.length === 0) {
      return;
    }

    for (const task of expiredTasks) {
      await this.removeTaskOutput(task.id, task.outputPath);
      await this.downloadTaskRepository.update(
        { id: task.id },
        {
          status: 'expired',
          outputPath: null,
          downloadUrl: null,
          fileExtension: null,
          message: '文件已过期，请重新创建下载任务',
        },
      );
      this.observabilityService?.recordDownloadTaskTransition({
        fromStatus: task.status as DownloadTaskMetricStatus,
        toStatus: 'expired',
        platform: normalizeObservedPlatform(task.platform),
      });
    }
  }

  private async removeTaskOutput(
    taskId: string,
    outputPath: string | null,
  ): Promise<void> {
    const pathsToRemove = new Set<string>();

    if (taskId) {
      pathsToRemove.add(join(this.tasksDir, taskId));
    }

    if (outputPath) {
      const resolvedOutputPath = resolve(outputPath);
      if (this.isPathInTaskDirectory(resolvedOutputPath)) {
        pathsToRemove.add(resolvedOutputPath);
      }
    }

    for (const path of pathsToRemove) {
      if (!existsSync(path)) {
        continue;
      }
      rmSync(path, { recursive: true, force: true });
    }
  }

  private isPathInTaskDirectory(targetPath: string): boolean {
    const resolvedTaskDir = resolve(this.tasksDir);
    const resolvedTargetPath = resolve(targetPath);
    return (
      resolvedTargetPath === resolvedTaskDir ||
      resolvedTargetPath.startsWith(`${resolvedTaskDir}${sep}`)
    );
  }

  private async runTaskWorker(): Promise<void> {
    if (this.isTaskWorkerRunning) {
      return;
    }

    this.isTaskWorkerRunning = true;

    try {
      while (this.taskQueue.length > 0) {
        const taskId = this.taskQueue.shift();
        if (!taskId) {
          continue;
        }

        try {
          await this.processTask(taskId);
        } catch (error: any) {
          this.logStructured('error', 'download_task_worker_failed', {
            taskId,
            errorCode: normalizeObservedErrorCode(error),
            message: error?.message || 'unknown',
          });
        }
      }
    } finally {
      this.isTaskWorkerRunning = false;
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const task = await this.downloadTaskRepository.findOne({
      where: { id: taskId },
    });

    if (!task) {
      return;
    }

    if (task.status === 'completed') {
      return;
    }

    await this.updateTaskState(taskId, {
      status: 'downloading',
      progress: 1,
      message: '开始下载视频流',
    });

    try {
      const output = await this.downloadYoutubeTask(
        taskId,
        task.sourceUrl,
        task.quality,
        task.runtimeTraceId || null,
      );
      const downloadUrl = this.buildTaskDownloadUrl(taskId);

      await this.updateTaskState(taskId, {
        status: 'completed',
        progress: 100,
        message: '下载完成',
        outputPath: output.outputPath,
        fileExtension: output.fileExtension,
        downloadUrl,
      });

      if (task.downloadHistoryId) {
        await this.downloadHistoryRepository.update(
          { id: task.downloadHistoryId },
          {
            status: 'completed',
            downloadUrl,
          },
        );
      }
    } catch (error: any) {
      await this.updateTaskState(taskId, {
        status: 'failed',
        progress: 0,
        message: error?.message || '下载任务失败',
      });
      if (task.downloadHistoryId) {
        await this.downloadHistoryRepository.update(
          { id: task.downloadHistoryId },
          {
            status: 'failed',
          },
        );
      }
      throw error;
    }
  }

  private async downloadYoutubeTask(
    taskId: string,
    sourceUrl: string,
    requestedQuality: string,
    runtimeTraceId?: string | null,
  ): Promise<{ outputPath: string; fileExtension: string }> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    const taskDir = join(this.tasksDir, taskId);
    mkdirSync(taskDir, { recursive: true });

    const outputTemplate = join(taskDir, 'output.%(ext)s');
    const formatSelector = this.buildYoutubeFormatSelector(requestedQuality);
    const hasAria2c = this.hasAria2c();

    const args = [
      '--no-playlist',
      '--progress',
      '--newline',
      '--no-warnings',
      '--force-overwrites',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--concurrent-fragments',
      String(this.ytDlpConcurrentFragments),
      '--format',
      formatSelector,
      '--output',
      outputTemplate,
      '--merge-output-format',
      'mp4',
      '--print',
      'after_move:filepath',
    ];

    if (hasAria2c) {
      args.push(
        '--downloader',
        'aria2c',
        '--downloader-args',
        'aria2c:-x8 -s8 -k1M --file-allocation=none',
      );
    }

    args.push(sourceUrl);

    this.logStructured('log', 'yt_dlp_download_started', {
      taskId,
      platform: 'youtube',
      quality: requestedQuality,
      aria2c: hasAria2c,
      sourceHost: extractSourceHost(sourceUrl),
    });

    let lastPersistedProgress = 1;
    let finalOutputPath = '';
    let stderrTail = '';

    const runDownloadAttempt = async (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const attemptStartedAt = Date.now();
        const proc = spawn(this.ytDlpPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const onProgressLine = (line: string) => {
          if (!line) {
            return;
          }

          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }

          if (existsSync(trimmed) && !trimmed.endsWith('.part')) {
            finalOutputPath = trimmed;
          }

          const match = trimmed.match(/(\d{1,3}(?:\.\d+)?)%/);
          if (match) {
            const percent = Number.parseFloat(match[1]);
            if (Number.isFinite(percent)) {
              const mappedProgress = Math.min(89, Math.max(2, Math.round((percent / 100) * 85)));
              if (mappedProgress >= lastPersistedProgress + 2) {
                lastPersistedProgress = mappedProgress;
                void this.updateTaskState(taskId, {
                  status: 'downloading',
                  progress: mappedProgress,
                  message: `下载中 ${Math.round(percent)}%`,
                });
              }
            }
          }

          if (
            trimmed.includes('Merging formats into') ||
            trimmed.includes('[Merger]')
          ) {
            void this.updateTaskState(taskId, {
              status: 'merging',
              progress: 92,
              message: '正在合并音视频',
            });
          }
        };

        proc.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          this.splitProcessOutputLines(text).forEach(onProgressLine);
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          stderrTail = `${stderrTail}${text}`.slice(-1200);
          this.splitProcessOutputLines(text).forEach(onProgressLine);
        });

        proc.on('error', (error) => {
          this.recordUpstreamRequest({
            upstream: 'yt_dlp',
            platform: 'youtube',
            outcome: 'system_error',
            errorCode: normalizeObservedErrorCode(error, 'YTDLP_PROCESS_ERROR'),
            durationMs: Date.now() - attemptStartedAt,
            traceId,
            taskId,
          });
          reject(error);
        });
        proc.on('close', (code) => {
          if (code === 0) {
            this.recordUpstreamRequest({
              upstream: 'yt_dlp',
              platform: 'youtube',
              outcome: 'success',
              errorCode: 'NONE',
              durationMs: Date.now() - attemptStartedAt,
              traceId,
              taskId,
            });
            resolve();
            return;
          }
          const error = new Error(stderrTail || `yt-dlp 退出码 ${code}`);
          this.recordUpstreamRequest({
            upstream: 'yt_dlp',
            platform: 'youtube',
            outcome: 'system_error',
            errorCode: normalizeObservedErrorCode(error, `YTDLP_EXIT_${code ?? 'UNKNOWN'}`),
            durationMs: Date.now() - attemptStartedAt,
            traceId,
            taskId,
          });
          reject(error);
        });
      });

    const maxAttempts = 2;
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      stderrTail = '';
      finalOutputPath = '';

      try {
        await runDownloadAttempt();
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const shouldRetry = this.shouldRetryYtDlpAttempt(
          lastError.message,
          requestedQuality,
          attempt,
          maxAttempts,
        );
        if (!shouldRetry) {
          break;
        }

        this.logStructured('warn', 'yt_dlp_retry_scheduled', {
          taskId,
          platform: 'youtube',
          quality: requestedQuality,
          attempt,
          errorCode: normalizeObservedErrorCode(lastError, 'YTDLP_RETRY'),
          message: lastError.message,
        });
        await this.updateTaskState(taskId, {
          status: 'downloading',
          progress: Math.max(lastPersistedProgress, 5),
          message: '高画质流获取中，正在重试',
        });
        this.resetTaskDirectory(taskDir);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    if (lastError) {
      if (this.shouldUseParserMergeFallback(lastError.message, requestedQuality)) {
        this.logStructured('warn', 'yt_dlp_parser_merge_fallback', {
          taskId,
          platform: 'youtube',
          quality: requestedQuality,
        });
        this.resetTaskDirectory(taskDir);
        return this.downloadYoutubeByParsedStreams(taskId, sourceUrl, requestedQuality, taskDir);
      }
      throw lastError;
    }

    if (!finalOutputPath || !existsSync(finalOutputPath)) {
      finalOutputPath = this.findTaskOutputFile(taskDir);
    }

    if (!finalOutputPath || !existsSync(finalOutputPath)) {
      throw new Error('未找到任务输出文件');
    }

    const fileExtension = (finalOutputPath.split('.').pop() || 'mp4').toLowerCase();
    return {
      outputPath: finalOutputPath,
      fileExtension,
    };
  }

  private findTaskOutputFile(taskDir: string): string {
    if (!existsSync(taskDir)) {
      return '';
    }

    const files = readdirSync(taskDir)
      .filter((name) => !name.endsWith('.part'))
      .map((name) => join(taskDir, name))
      .filter((fullPath) => {
        try {
          return statSync(fullPath).isFile();
        } catch (_error) {
          return false;
        }
      });

    if (files.length === 0) {
      return '';
    }

    files.sort((a, b) => {
      try {
        return statSync(b).size - statSync(a).size;
      } catch (_error) {
        return 0;
      }
    });

    return files[0];
  }

  private buildYoutubeFormatSelector(requestedQuality: string): string {
    switch (requestedQuality) {
      case '4k':
        return 'bestvideo[ext=mp4][height>=2160][height<=3840][width<=3840]+bestaudio[ext=m4a]/bestvideo[height>=2160][height<=3840][width<=3840]+bestaudio';
      case '1080p':
        return 'bestvideo[ext=mp4][height>=1080][height<=1920][width<=1920]+bestaudio[ext=m4a]/bestvideo[height>=1080][height<=1920][width<=1920]+bestaudio';
      case '720p':
        return 'bestvideo[ext=mp4][height<=1280][width<=1280]+bestaudio[ext=m4a]/bestvideo[height<=1280][width<=1280]+bestaudio/best[height<=1280][width<=1280]/best';
      case '480p':
        return 'bestvideo[ext=mp4][height<=854][width<=854]+bestaudio[ext=m4a]/bestvideo[height<=854][width<=854]+bestaudio/best[height<=854][width<=854]/best';
      case '360p':
      default:
        return 'bestvideo[ext=mp4][height<=640][width<=640]+bestaudio[ext=m4a]/bestvideo[height<=640][width<=640]+bestaudio/best[height<=640][width<=640]/best';
    }
  }

  private splitProcessOutputLines(text: string): string[] {
    return text.split(/[\r\n]+/).filter(Boolean);
  }

  private shouldRetryYtDlpAttempt(
    errorMessage: string,
    requestedQuality: string,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    if (attempt >= maxAttempts) {
      return false;
    }

    if (!['1080p', '4k'].includes(requestedQuality)) {
      return false;
    }

    const lower = (errorMessage || '').toLowerCase();
    return (
      lower.includes('requested format is not available') ||
      lower.includes('unable to download video data') ||
      lower.includes('http error 403')
    );
  }

  private shouldUseParserMergeFallback(
    errorMessage: string,
    requestedQuality: string,
  ): boolean {
    if (!['1080p', '4k'].includes(requestedQuality)) {
      return false;
    }

    const lower = (errorMessage || '').toLowerCase();
    return lower.includes('requested format is not available');
  }

  private resetTaskDirectory(taskDir: string): void {
    rmSync(taskDir, { recursive: true, force: true });
    mkdirSync(taskDir, { recursive: true });
  }

  private async downloadYoutubeByParsedStreams(
    taskId: string,
    sourceUrl: string,
    requestedQuality: string,
    taskDir: string,
  ): Promise<{ outputPath: string; fileExtension: string }> {
    await this.updateTaskState(taskId, {
      status: 'merging',
      progress: 92,
      message: '高画质直链准备中，正在合并',
    });

    const parsedInfo = await this.parseVideo(sourceUrl);
    if (!parsedInfo) {
      throw new Error('回退解析失败，无法获取视频流信息');
    }

    const resolved = await this.getDownloadUrl(parsedInfo, VideoFormat.MP4, requestedQuality);
    const requestedRank = this.getVideoQualityRank(requestedQuality);
    const actualRank = this.getVideoQualityRank(resolved.quality);
    if (requestedRank >= 0 && actualRank >= 0 && actualRank < requestedRank) {
      throw new Error(`目标画质暂不可用（请求 ${requestedQuality}，可用 ${resolved.quality}）`);
    }

    if (!resolved.downloadUrl.includes('/api/download/merge?')) {
      throw new Error('回退链路未返回可合流音视频地址');
    }

    const mergeUrl = new URL(resolved.downloadUrl, 'http://localhost');
    const video = mergeUrl.searchParams.get('video') || '';
    const audio = mergeUrl.searchParams.get('audio') || '';
    if (!video || !audio) {
      throw new Error('回退链路缺少音视频流地址');
    }

    const outputPath = join(taskDir, 'output.mp4');
    await this.mergeRemoteStreamsToFile(video, audio, outputPath);

    return {
      outputPath,
      fileExtension: 'mp4',
    };
  }

  private async mergeRemoteStreamsToFile(
    videoUrl: string,
    audioUrl: string,
    outputPath: string,
  ): Promise<void> {
    const decodedVideoUrl = decodeURIComponent(videoUrl);
    const decodedAudioUrl = decodeURIComponent(audioUrl);
    const bilibiliCookie = await this.bilibiliAuthService.getCookieHeader();
    const headersForVideo = this.buildFfmpegHeaders(decodedVideoUrl, bilibiliCookie);
    const headersForAudio = this.buildFfmpegHeaders(decodedAudioUrl, bilibiliCookie);
    const audioCodec = this.shouldCopyAudioCodec(decodedAudioUrl) ? 'copy' : 'aac';

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-rw_timeout',
      '15000000',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '2',
      '-headers',
      headersForVideo,
      '-i',
      decodedVideoUrl,
      '-rw_timeout',
      '15000000',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '2',
      '-headers',
      headersForAudio,
      '-i',
      decodedAudioUrl,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      audioCodec,
      '-movflags',
      '+faststart',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderrOutput = '';
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        stderrOutput = `${stderrOutput}${chunk.toString()}`.slice(-1200);
      });

      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderrOutput || `ffmpeg 退出码 ${code}`));
      });
    });
  }

  private hasAria2c(): boolean {
    try {
      const result = spawnSync('aria2c', ['--version'], {
        stdio: 'ignore',
      });
      return result.status === 0;
    } catch (_error) {
      return false;
    }
  }

  private resolveYtDlpPath(): string {
    return resolveYtDlpPath(process.env.YTDLP_PATH?.trim());
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const rawValue = process.env[name];
    const parsed = Number.parseInt(rawValue || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readStringEnv(name: string, fallback: string): string {
    const rawValue = process.env[name];
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
    return normalized.length > 0 ? normalized : fallback;
  }

  private buildTaskDownloadUrl(taskId: string): string {
    return `/api/download/tasks/${taskId}/file`;
  }

  private toSafeFilename(name: string): string {
    const normalized = name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.slice(0, 120) || 'video';
  }

  private getContentTypeByExtension(ext: string): string {
    switch (ext.toLowerCase()) {
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'mkv':
        return 'video/x-matroska';
      default:
        return 'application/octet-stream';
    }
  }

  private async updateTaskState(
    taskId: string,
    patch: Partial<DownloadTask>,
  ): Promise<void> {
    let previousStatus: DownloadTaskMetricStatus | null = null;
    let platform: ObservedPlatform = 'unknown';

    if (patch.status) {
      const currentTask = await this.downloadTaskRepository.findOne({
        select: ['status', 'platform'],
        where: { id: taskId },
      });
      previousStatus = (currentTask?.status as DownloadTaskMetricStatus | undefined) || null;
      platform = normalizeObservedPlatform(currentTask?.platform);
    }

    await this.downloadTaskRepository.update({ id: taskId }, patch);

    if (patch.status) {
      this.observabilityService?.recordDownloadTaskTransition({
        fromStatus: previousStatus,
        toStatus: patch.status as DownloadTaskMetricStatus,
        platform,
      });
    }

    this.logStructured('log', 'download_task_state_updated', {
      taskId,
      fromStatus: previousStatus,
      toStatus: patch.status || null,
      progress: patch.progress ?? null,
      platform,
      message: patch.message || null,
    });
  }

  private pickVideoStreamByQuality(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
    exactMatchOnly = false,
  ): ResolvedStream | null {
    if (!qualityMap || Object.keys(qualityMap).length === 0) {
      return null;
    }

    if (exactMatchOnly) {
      if (!qualityMap[requestedQuality]) {
        return null;
      }
      return this.toResolvedStream(qualityMap[requestedQuality], requestedQuality);
    }

    if (qualityMap[requestedQuality]) {
      return this.toResolvedStream(qualityMap[requestedQuality], requestedQuality);
    }

    const fallbackOrder = this.getVideoQualityFallbackOrder(requestedQuality);
    for (const quality of fallbackOrder) {
      if (qualityMap[quality]) {
        return this.toResolvedStream(qualityMap[quality], quality);
      }
    }

    const [fallbackQuality, fallbackUrl] = Object.entries(qualityMap)[0] || [];
    if (!fallbackUrl) {
      return null;
    }

    return this.toResolvedStream(fallbackUrl, fallbackQuality || requestedQuality);
  }

  private getVideoQualityFallbackOrder(quality: string): string[] {
    switch (quality) {
      case VideoQuality.UHD:
        return ['4k', '1440p', '1080p', '720p', '540p', '480p', '360p'];
      case VideoQuality.QHD:
      case '1440p':
        return ['1440p', '1080p', '720p', '540p', '480p', '360p', '4k'];
      case VideoQuality.FHD:
        return ['1080p', '720p', '540p', '480p', '360p', '1440p', '4k'];
      case '540p':
        return ['540p', '480p', '360p', '720p', '1080p', '1440p', '4k'];
      case '480p':
        return ['480p', '360p', '540p', '720p', '1080p', '1440p', '4k'];
      case VideoQuality.SD:
        return ['360p', '480p', '540p', '720p', '1080p', '1440p', '4k'];
      case VideoQuality.HD:
      default:
        return ['720p', '540p', '480p', '360p', '1080p', '1440p', '4k'];
    }
  }

  private shouldProbeDouyinHighQuality(quality: string): boolean {
    const normalized = String(quality || '').trim().toLowerCase();
    return normalized === '1080p' || normalized === '1440p' || normalized === '4k';
  }

  private async resolveDouyinDirectStreamWithoutWatermarkFallback(
    stream: ResolvedStream,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
  ): Promise<DouyinDirectStreamSelectionResult> {
    if (
      allowWatermarkFallback ||
      !stream.url ||
      !this.isDouyinPlayLikeUrl(stream.url)
    ) {
      return { stream };
    }

    const qualityMap = {
      [stream.quality]: stream.url,
    };
    const cached = this.resolveCachedDouyinStreamForMode(
      qualityMap,
      requestedQuality,
      false,
      DouyinProbeMode.STRICT,
    );
    if (cached.watermarkFallbackRequired) {
      throw this.buildDouyinWatermarkFallbackRequiredError(requestedQuality);
    }
    if (cached.stream) {
      return {
        stream,
        actualQuality: cached.actualQuality,
        actualWidth: cached.actualWidth,
        actualHeight: cached.actualHeight,
      };
    }

    const probed = await this.resolveDouyinVerifiedStream(
      qualityMap,
      requestedQuality,
      false,
      this.douyinSmartProbeBudgetMs,
    );
    if (probed.watermarkFallbackRequired) {
      this.logStructured('warn', 'download_get_url_douyin_watermark_preflight_required', {
        platform: 'douyin',
        quality: requestedQuality,
        sourceHost: extractSourceHost(stream.url),
      });
      throw this.buildDouyinWatermarkFallbackRequiredError(requestedQuality);
    }
    if (!probed.stream) {
      return { stream };
    }
    return {
      stream,
      actualQuality: probed.actualQuality,
      actualWidth: probed.actualWidth,
      actualHeight: probed.actualHeight,
    };
  }

  private async awaitDouyinCompletedQualityIfNeeded(
    info: ExtendedVideoInfo,
    format: VideoFormat,
    quality: string,
  ): Promise<ExtendedVideoInfo> {
    if (
      info.platform !== 'douyin' ||
      format === VideoFormat.AUDIO ||
      info.qualityStatus !== 'enriching' ||
      !info.qualityRefreshKey
    ) {
      return info;
    }

    const enriched = await this.parsersService
      .awaitDouyinQualityStatus(info.qualityRefreshKey, this.douyinQualityAwaitMs)
      .catch(() => null);

    if (!enriched) {
      return info;
    }

    this.logStructured('debug', 'douyin_quality_status_awaited', {
      platform: 'douyin',
      quality,
      qualityStatus: enriched.qualityStatus || null,
      refreshKey: enriched.qualityRefreshKey || null,
    });

    return {
      ...(info as VideoInfo),
      ...(enriched as VideoInfo),
    } as ExtendedVideoInfo;
  }

  private normalizeDouyinProbeMode(
    value?: DouyinProbeMode | string,
  ): DouyinProbeMode {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === DouyinProbeMode.FAST) {
      return DouyinProbeMode.FAST;
    }
    if (normalized === DouyinProbeMode.SMART) {
      return DouyinProbeMode.SMART;
    }
    return DouyinProbeMode.STRICT;
  }

  private async resolveDouyinStreamForMode(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
    probeMode: DouyinProbeMode,
  ): Promise<DouyinProbeCandidateResult> {
    const cached = this.resolveCachedDouyinStreamForMode(
      qualityMap,
      requestedQuality,
      allowWatermarkFallback,
      probeMode,
    );
    if (cached.stream) {
      return cached;
    }

    if (probeMode === DouyinProbeMode.FAST) {
      return { stream: null };
    }

    if (probeMode === DouyinProbeMode.SMART) {
      const quick = await this.resolveDouyinVerifiedStream(
        qualityMap,
        requestedQuality,
        allowWatermarkFallback,
        this.douyinSmartProbeBudgetMs,
      );

      if (!quick.stream && !quick.watermarkFallbackRequired) {
        this.scheduleDouyinStrictWarmProbe(
          qualityMap,
          requestedQuality,
          allowWatermarkFallback,
        );
      }
      return quick;
    }

    return this.resolveDouyinVerifiedStream(
      qualityMap,
      requestedQuality,
      allowWatermarkFallback,
      this.douyinStrictProbeBudgetMs,
    );
  }

  private resolveCachedDouyinStreamForMode(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
    probeMode: DouyinProbeMode,
  ): DouyinProbeCandidateResult {
    if (!qualityMap || Object.keys(qualityMap).length === 0 || !this.douyinOptimizationService) {
      return { stream: null };
    }

    const streamId = this.extractDouyinStreamIdFromQualityMap(qualityMap);
    if (!streamId) {
      return { stream: null };
    }

    const qualityOrder = Array.from(
      new Set([
        requestedQuality,
        ...this.getVideoQualityFallbackOrder(requestedQuality),
        ...Object.keys(qualityMap),
      ]),
    )
      .map((item) => this.normalizeVideoQualityLabel(item))
      .filter(Boolean);
    const minimumActualQualityRank =
      probeMode === DouyinProbeMode.STRICT && !allowWatermarkFallback
        ? this.getVideoQualityRank(this.normalizeVideoQualityLabel(requestedQuality))
        : undefined;
    const fact = this.douyinOptimizationService.selectBestFact({
      videoStreamId: streamId,
      qualityOrder,
      availableRequestedQualities: Object.keys(qualityMap),
      availableCandidateUrlsByQuality: this.buildAvailableDouyinCandidateUrlsByQuality(
        qualityMap,
      ),
      allowWatermarkFallback,
      minimumActualQualityRank,
      getQualityRank: (value) => this.getVideoQualityRank(this.normalizeVideoQualityLabel(value)),
    });

    if (!fact) {
      return { stream: null };
    }

    const selectedUrl = fact.actualUrl || fact.finalUrl || fact.candidateUrl;
    if (!selectedUrl) {
      return { stream: null };
    }

    return {
      stream: this.toResolvedStream(
        selectedUrl,
        fact.actualQuality || fact.requestedQuality || requestedQuality,
      ),
      actualQuality: fact.actualQuality || fact.requestedQuality || requestedQuality,
      actualWidth: fact.actualWidth,
      actualHeight: fact.actualHeight,
      usedWatermarkFallback: fact.usedWatermarkFallback,
    };
  }

  private extractDouyinStreamIdFromQualityMap(
    qualityMap: Record<string, string>,
  ): string {
    for (const value of Object.values(qualityMap)) {
      const videoId = this.extractDouyinPlayParam(value, 'video_id');
      if (videoId) {
        return videoId;
      }
    }
    return '';
  }

  private buildAvailableDouyinCandidateUrlsByQuality(
    qualityMap: Record<string, string>,
  ): Record<string, string[]> {
    return Object.entries(qualityMap || {}).reduce(
      (acc, [quality, url]) => {
        const normalizedQuality = this.normalizeVideoQualityLabel(quality) || quality;
        const normalizedUrl = String(url || '').trim();
        if (!normalizedQuality || !normalizedUrl) {
          return acc;
        }
        acc[normalizedQuality] = [normalizedUrl];
        return acc;
      },
      {} as Record<string, string[]>,
    );
  }

  private normalizeVideoQualityLabel(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    if (normalized === 'uhd' || normalized === '4k' || normalized === '2160p') {
      return '4k';
    }
    if (normalized === 'qhd' || normalized === '1440p') {
      return '1440p';
    }
    if (normalized === 'fhd' || normalized === '1080p') {
      return '1080p';
    }
    if (normalized === 'hd' || normalized === '720p') {
      return '720p';
    }
    if (normalized === 'sd' || normalized === '360p') {
      return '360p';
    }
    if (normalized === '540p' || normalized === '480p') {
      return normalized;
    }

    const pMatched = normalized.match(/(\d{3,4})p/);
    if (pMatched?.[1]) {
      return `${pMatched[1]}p`;
    }

    return normalized;
  }

  private isExactRequestedQualityProbe(
    probe: DouyinStreamProbeResult,
    requestedRank: number,
  ): boolean {
    if (requestedRank < 0 || probe.status !== 'ok') {
      return false;
    }

    const actualQuality =
      probe.quality || this.mapResolutionToQuality(probe.width, probe.height);
    const actualRank = this.getVideoQualityRank(
      this.normalizeVideoQualityLabel(actualQuality || ''),
    );

    return actualRank === requestedRank && actualRank >= 0;
  }

  private compareDouyinProbePreference(
    left: DouyinStreamProbeResult,
    right: DouyinStreamProbeResult,
    requestedRank: number,
  ): number {
    const leftRank = this.getVideoQualityRank(
      this.normalizeVideoQualityLabel(
        left.quality || this.mapResolutionToQuality(left.width, left.height),
      ),
    );
    const rightRank = this.getVideoQualityRank(
      this.normalizeVideoQualityLabel(
        right.quality || this.mapResolutionToQuality(right.width, right.height),
      ),
    );

    const leftPreference = this.getDouyinProbePreference(leftRank, requestedRank);
    const rightPreference = this.getDouyinProbePreference(rightRank, requestedRank);
    if (leftPreference.tier !== rightPreference.tier) {
      return leftPreference.tier - rightPreference.tier;
    }
    if (leftPreference.distance !== rightPreference.distance) {
      return leftPreference.distance - rightPreference.distance;
    }

    const resolutionGap =
      this.getResolutionScore(right.width, right.height) -
      this.getResolutionScore(left.width, left.height);
    if (resolutionGap !== 0) {
      return resolutionGap;
    }

    return 0;
  }

  private getDouyinProbePreference(
    actualRank: number,
    requestedRank: number,
  ): { tier: number; distance: number } {
    if (requestedRank < 0 || actualRank < 0) {
      return { tier: 3, distance: Number.MAX_SAFE_INTEGER };
    }

    if (actualRank === requestedRank) {
      return { tier: 0, distance: 0 };
    }

    if (actualRank < requestedRank) {
      return { tier: 1, distance: requestedRank - actualRank };
    }

    return { tier: 2, distance: actualRank - requestedRank };
  }

  private async probeDouyinLineCandidates(
    lineCandidates: string[],
    requestedRank: number,
    allowWatermarkFallback: boolean,
    deadlineAt: number,
  ): Promise<{
    bestProbe: DouyinStreamProbeResult | null;
    watermarkFallbackRequired: boolean;
  }> {
    if (lineCandidates.length === 0) {
      return {
        bestProbe: null,
        watermarkFallbackRequired: false,
      };
    }

    const concurrency = Math.max(
      1,
      Math.min(this.douyinStrictProbeConcurrency, lineCandidates.length),
    );
    let cursor = 0;
    let stop = false;
    let bestProbe: DouyinStreamProbeResult | null = null;
    let watermarkFallbackRequired = false;

    const worker = async () => {
      while (!stop) {
        if (Date.now() >= deadlineAt) {
          stop = true;
          return;
        }

        const index = cursor;
        cursor += 1;
        if (index >= lineCandidates.length) {
          return;
        }

        const candidateUrl = lineCandidates[index];
        const probed = await this.probeDouyinStreamResolution(
          candidateUrl,
          allowWatermarkFallback,
        );
        if (probed.status === 'watermark_fallback_required') {
          watermarkFallbackRequired = true;
          continue;
        }
        if (probed.status !== 'ok') {
          continue;
        }

        if (
          !bestProbe ||
          this.compareDouyinProbePreference(
            probed,
            bestProbe,
            requestedRank,
          ) < 0
        ) {
          bestProbe = probed;
        }

        if (this.isExactRequestedQualityProbe(probed, requestedRank)) {
          stop = true;
          return;
        }
      }
    };

    await Promise.all(
      Array.from({ length: concurrency }, () => worker()),
    );

    return {
      bestProbe,
      watermarkFallbackRequired,
    };
  }

  private async resolveDouyinVerifiedStream(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
    budgetMs = this.douyinStrictProbeBudgetMs,
  ): Promise<DouyinProbeCandidateResult> {
    if (!qualityMap || Object.keys(qualityMap).length === 0) {
      return { stream: null };
    }

    const order = [
      requestedQuality,
      ...this.getVideoQualityFallbackOrder(requestedQuality),
      ...Object.keys(qualityMap),
    ];
    const dedupedOrder = Array.from(
      new Set(
        order
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
    const safeBudgetMs = Math.max(300, Number(budgetMs) || this.douyinStrictProbeBudgetMs);
    const deadlineAt = Date.now() + safeBudgetMs;
    const requestedRank = this.getVideoQualityRank(
      this.normalizeVideoQualityLabel(requestedQuality),
    );

    let watermarkFallbackRequired = false;

    for (const quality of dedupedOrder) {
      if (Date.now() >= deadlineAt) {
        break;
      }
      const baseUrl = qualityMap[quality];
      if (!baseUrl) {
        continue;
      }

      const probe = await this.probeDouyinStreamResolution(
        baseUrl,
        allowWatermarkFallback,
      );
      if (probe.status === 'watermark_fallback_required') {
        watermarkFallbackRequired = true;
        continue;
      }
      if (probe.status === 'ok') {
        const actualQuality =
          probe.quality || this.mapResolutionToQuality(probe.width, probe.height);
        return {
          stream: this.toResolvedStream(
            probe.actualUrl || probe.finalUrl || baseUrl,
            actualQuality || quality,
          ),
          actualQuality: actualQuality || quality,
          actualWidth: probe.width,
          actualHeight: probe.height,
          usedWatermarkFallback: probe.usedWatermarkFallback === true,
        };
      }
    }

    return {
      stream: null,
      watermarkFallbackRequired,
    };
  }

  private scheduleDouyinStrictWarmProbe(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
  ): void {
    if (!qualityMap || Object.keys(qualityMap).length === 0) {
      return;
    }

    const key = this.buildDouyinStrictWarmKey(
      qualityMap,
      requestedQuality,
      allowWatermarkFallback,
    );
    if (this.douyinStrictWarmInflight.has(key)) {
      return;
    }

    const task = (async () => {
      try {
        await this.resolveDouyinVerifiedStream(
          qualityMap,
          requestedQuality,
          allowWatermarkFallback,
          this.douyinStrictProbeBudgetMs,
        );
      } catch (error: any) {
        this.logStructured('debug', 'douyin_strict_probe_warm_failed', {
          platform: 'douyin',
          quality: requestedQuality,
          errorCode: normalizeObservedErrorCode(error, 'DOUYIN_STRICT_PROBE_WARM_FAILED'),
          message: error?.message || 'unknown',
        });
      }
    })();

    this.douyinStrictWarmInflight.set(key, task);
    void task.finally(() => {
      this.douyinStrictWarmInflight.delete(key);
    });
  }

  private buildDouyinStrictWarmKey(
    qualityMap: Record<string, string>,
    requestedQuality: string,
    allowWatermarkFallback: boolean,
  ): string {
    const normalizedEntries = Object.entries(qualityMap)
      .filter(([quality, url]) => {
        return (
          String(quality || '').trim().length > 0 &&
          String(url || '').trim().length > 0
        );
      })
      .map(([quality, url]) => {
        return `${this.normalizeVideoQualityLabel(quality) || quality}=${url.trim()}`;
      })
      .sort();
    return `${requestedQuality}|wm=${allowWatermarkFallback ? '1' : '0'}|${normalizedEntries.join('&')}`;
  }

  private buildDouyinWatermarkFallbackRequiredError(
    requestedQuality: string,
  ): BadRequestException {
    return new BadRequestException({
      code: 'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
      message:
        `当前抖音视频请求 ${requestedQuality} 仅检测到带水印可用线路，请确认是否允许带水印下载`,
      category: 'upstream',
      retryable: true,
    });
  }

  private buildDouyinLineCandidates(url: string): string[] {
    const normalized = String(url || '').trim();
    if (!normalized) {
      return [];
    }

    if (!this.isDouyinPlayLikeUrl(normalized)) {
      return [normalized];
    }

    const candidates = new Set<string>();
    const currentLine = this.extractDouyinPlayParam(normalized, 'line');
    if (currentLine) {
      candidates.add(this.applyDouyinPlayLine(normalized, currentLine));
    }

    this.douyinProbeLines.forEach((line) => {
      candidates.add(this.applyDouyinPlayLine(normalized, String(line)));
    });

    return Array.from(candidates);
  }

  private parseDouyinProbeLines(raw: string): number[] {
    const defaults = [4, 3, 2, 1, 0];
    const parsed = String(raw || '')
      .split(',')
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 9);

    if (parsed.length === 0) {
      return defaults;
    }

    return Array.from(new Set(parsed));
  }

  private buildProxyFetchUrl(
    targetUrl: string,
    type: 'video' | 'image',
    allowWatermarkFallback: boolean,
    runtimeTraceId?: string | null,
  ): string {
    const params = new URLSearchParams({
      url: targetUrl,
      type,
      allowWatermarkFallback: allowWatermarkFallback ? '1' : '0',
    });
    if (runtimeTraceId) {
      params.set('runtimeTraceId', runtimeTraceId);
    }
    params.set('runtimeStage', 'download');
    params.set('runtimeClientType', 'unknown');
    return `/api/proxy/fetch?${params.toString()}`;
  }

  private async probeDouyinStreamResolution(
    targetUrl: string,
    allowWatermarkFallback: boolean,
  ): Promise<DouyinStreamProbeResult> {
    const cacheKey = this.buildDouyinProbeCacheKey(targetUrl, allowWatermarkFallback);
    const cached = this.douyinProbeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
    const inflight = this.douyinProbeInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const task = (async (): Promise<DouyinStreamProbeResult> => {
      const primary = await this.probeDouyinStreamResolutionRaw(targetUrl);
      if (primary.status === 'ok') {
        this.captureDouyinOptimizationFact(targetUrl, primary);
        this.setDouyinProbeCache(cacheKey, primary);
        return primary;
      }

      const alternateUrl = this.resolveDouyinAlternatePlayUrl(targetUrl);
      const requiresPlaywmFallback = this.isDouyinPlayToPlaywmFallback(
        targetUrl,
        alternateUrl,
      );
      if (!alternateUrl) {
        this.setDouyinProbeCache(cacheKey, primary);
        return primary;
      }

      const alternate = await this.probeDouyinStreamResolutionRaw(alternateUrl);
      if (alternate.status !== 'ok') {
        this.setDouyinProbeCache(cacheKey, primary);
        return primary;
      }

      if (requiresPlaywmFallback && !allowWatermarkFallback) {
        const blocked: DouyinStreamProbeResult = {
          status: 'watermark_fallback_required',
        };
        this.setDouyinProbeCache(cacheKey, blocked);
        return blocked;
      }

      const merged: DouyinStreamProbeResult = {
        ...alternate,
        usedWatermarkFallback: requiresPlaywmFallback,
      };
      this.captureDouyinOptimizationFact(targetUrl, merged);
      this.setDouyinProbeCache(cacheKey, merged);
      return merged;
    })();

    this.douyinProbeInflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.douyinProbeInflight.delete(cacheKey);
    }
  }

  private setDouyinProbeCache(
    key: string,
    result: DouyinStreamProbeResult,
  ): void {
    this.douyinProbeCache.set(key, {
      expiresAt: Date.now() + this.douyinProbeCacheTtlMs,
      result,
    });
  }

  private captureDouyinOptimizationFact(
    candidateUrl: string,
    result: DouyinStreamProbeResult,
  ): void {
    if (result.status !== 'ok' || !this.douyinOptimizationService) {
      return;
    }

    const videoStreamId = this.extractDouyinPlayParam(candidateUrl, 'video_id');
    const requestedQuality = this.normalizeVideoQualityLabel(
      this.extractDouyinPlayParam(candidateUrl, 'ratio'),
    );
    const line = this.extractDouyinPlayParam(candidateUrl, 'line') || '0';
    const selectedUrl = result.actualUrl || result.finalUrl || candidateUrl;
    if (!videoStreamId || !requestedQuality || !selectedUrl) {
      return;
    }

    this.douyinOptimizationService.upsertFact({
      videoStreamId,
      requestedQuality,
      actualQuality: this.normalizeVideoQualityLabel(
        result.quality || requestedQuality,
      ),
      line,
      candidateUrl,
      finalUrl: result.finalUrl || candidateUrl,
      actualUrl: selectedUrl,
      actualWidth: result.width || 0,
      actualHeight: result.height || 0,
      usedWatermarkFallback: result.usedWatermarkFallback === true,
    });
  }

  private buildDouyinProbeCacheKey(
    url: string,
    allowWatermarkFallback: boolean,
  ): string {
    const videoId = this.extractDouyinPlayParam(url, 'video_id');
    const ratio = this.extractDouyinPlayParam(url, 'ratio');
    const line = this.extractDouyinPlayParam(url, 'line');
    if (videoId || ratio || line) {
      return `${videoId}|${ratio}|${line}|wm=${allowWatermarkFallback ? '1' : '0'}`;
    }
    return `${url}|wm=${allowWatermarkFallback ? '1' : '0'}`;
  }

  private extractDouyinPlayParam(url: string, key: 'video_id' | 'ratio' | 'line'): string {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get(key) || '';
    } catch (_error) {
      const matched = url.match(new RegExp(`[?&]${key}=([^&#]+)`, 'i'));
      return matched?.[1] || '';
    }
  }

  private extractDouyinCandidateIdentity(url: string): string {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      return '';
    }

    try {
      const parsed = new URL(normalizedUrl);
      return (
        parsed.searchParams.get('file_id') ||
        parsed.pathname.split('/').filter(Boolean).pop() ||
        parsed.toString()
      );
    } catch (_error) {
      const matched = normalizedUrl.match(/[?&]file_id=([^&#]+)/i);
      if (matched?.[1]) {
        return decodeURIComponent(matched[1]);
      }
      const pathMatched = normalizedUrl.match(/\/([^/?#]+)(?:\?|#|$)/);
      return pathMatched?.[1] || normalizedUrl;
    }
  }

  private applyDouyinPlayLine(url: string, line: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('line', line);
      return parsed.toString();
    } catch (_error) {
      if (/[?&]line=/i.test(url)) {
        return url.replace(/([?&]line=)[^&#]*/i, `$1${line}`);
      }
      return `${url}${url.includes('?') ? '&' : '?'}line=${line}`;
    }
  }

  private isDouyinPlayLikeUrl(url: string): boolean {
    return /\/aweme\/v1\/play(?:wm)?\//i.test(String(url || ''));
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

  private isDouyinPlayToPlaywmFallback(
    currentUrl: string,
    alternateUrl: string | null,
  ): boolean {
    return (
      currentUrl.includes('/aweme/v1/play/') &&
      String(alternateUrl || '').includes('/aweme/v1/playwm/')
    );
  }

  private async probeDouyinStreamResolutionRaw(
    targetUrl: string,
  ): Promise<DouyinStreamProbeResult> {
    const headers = await this.buildDouyinProbeHeaders();
    const ffprobeResult = await this.probeResolutionWithFfprobe(targetUrl, headers);
    if (!ffprobeResult) {
      return { status: 'miss' };
    }

    return {
      status: 'ok',
      finalUrl: targetUrl,
      actualUrl: ffprobeResult.finalUrl || targetUrl,
      width: ffprobeResult.width,
      height: ffprobeResult.height,
      quality: this.mapResolutionToQuality(ffprobeResult.width, ffprobeResult.height),
      usedWatermarkFallback: false,
    };
  }

  private async buildDouyinProbeHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      Referer: 'https://www.douyin.com/',
      Origin: 'https://www.douyin.com',
      Accept: '*/*',
      Range: 'bytes=0-131071',
    };

    const cookieHeader = this.douyinAuthService
      ? await this.douyinAuthService.getCookieHeader().catch(() => '')
      : '';
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return headers;
  }

  private async probeResolutionWithFfprobe(
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
      String(this.douyinProbeTimeoutMs * 1000),
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
        timeout: this.douyinProbeTimeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || '{}');
      const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
      const width = Number(stream?.width) || 0;
      const height = Number(stream?.height) || 0;
      if (width > 0 && height > 0) {
        return { width, height, finalUrl: targetUrl };
      }
    } catch (_error) {
      // fallback to lightweight probe below
    }

    try {
      const response = await axios.get(targetUrl, {
        headers,
        timeout: this.douyinProbeTimeoutMs,
        maxRedirects: 3,
        responseType: 'stream',
        validateStatus: () => true,
      });
      if (response?.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
      const finalUrl = response?.request?.res?.responseUrl || targetUrl;
      const width = Number(response.headers?.['x-video-width']) || 0;
      const height = Number(response.headers?.['x-video-height']) || 0;
      if (width > 0 && height > 0) {
        return { width, height, finalUrl };
      }
    } catch (_error) {
      // ignore
    }

    return null;
  }

  private getResolutionScore(width?: number, height?: number): number {
    const safeWidth = Number(width) || 0;
    const safeHeight = Number(height) || 0;
    return safeWidth * safeHeight;
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

  private getVideoQualityMapForSelection(
    downloadOptions: VideoDownloadOptions,
    platform: VideoInfo['platform'],
    iosCompatible: boolean,
  ): Record<string, string> | undefined {
    if (platform === 'douyin') {
      return this.buildDouyinPreferredVideoMap(
        downloadOptions.merged,
        downloadOptions.videoCandidates,
      );
    }

    const baseMap = downloadOptions.video;
    if (!(iosCompatible && platform === 'bilibili')) {
      return baseMap;
    }

    return this.buildIosCompatibleVideoMap(
      baseMap,
      downloadOptions.videoCandidates,
    );
  }

  private buildIosCompatibleVideoMap(
    baseMap: Record<string, string> | undefined,
    candidateMap?: Record<string, VideoStreamCandidate[]>,
  ): Record<string, string> | undefined {
    if (!candidateMap || Object.keys(candidateMap).length === 0) {
      return baseMap;
    }

    const mergedMap: Record<string, string> = {
      ...(baseMap || {}),
    };

    Object.entries(candidateMap).forEach(([quality, candidates]) => {
      const preferred = this.pickIosPreferredVideoCandidate(candidates);
      if (preferred?.url) {
        mergedMap[quality] = preferred.url;
      }
    });

    return Object.keys(mergedMap).length > 0 ? mergedMap : undefined;
  }

  private buildDouyinPreferredVideoMap(
    mergedMap: Record<string, string> | undefined,
    candidateMap?: Record<string, VideoStreamCandidate[]>,
  ): Record<string, string> | undefined {
    const nextMap: Record<string, string> = {};
    const qualities = Array.from(
      new Set([
        ...Object.keys(mergedMap || {}),
        ...Object.keys(candidateMap || {}),
      ]),
    );

    qualities.forEach((quality) => {
      const normalizedQuality = this.normalizeVideoQualityLabel(quality) || quality;
      const preferred = this.pickPreferredDouyinVideoCandidate(
        candidateMap?.[quality],
        mergedMap?.[quality],
      );
      if (preferred?.url) {
        nextMap[normalizedQuality] = preferred.url;
      }
    });

    return Object.keys(nextMap).length > 0 ? nextMap : undefined;
  }

  private pickPreferredDouyinVideoCandidate(
    candidates: VideoStreamCandidate[] | undefined,
    mergedUrl?: string,
  ): VideoStreamCandidate | null {
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .filter((item) => typeof item?.url === 'string' && item.url.trim().length > 0)
      .slice()
      .sort((left, right) => this.compareDouyinVideoCandidates(left, right));

    if (ranked.length > 0) {
      return ranked[0];
    }

    const normalizedMergedUrl = String(mergedUrl || '').trim();
    if (!normalizedMergedUrl) {
      return null;
    }

    return {
      url: normalizedMergedUrl,
      fileId: this.extractDouyinCandidateIdentity(normalizedMergedUrl),
      ratio: this.normalizeVideoQualityLabel(
        this.extractDouyinPlayParam(normalizedMergedUrl, 'ratio'),
      ),
      sourceKind: 'merged_fallback',
    };
  }

  private compareDouyinVideoCandidates(
    left: VideoStreamCandidate,
    right: VideoStreamCandidate,
  ): number {
    const sourceGap =
      this.getDouyinCandidateSourceRank(left.sourceKind) -
      this.getDouyinCandidateSourceRank(right.sourceKind);
    if (sourceGap !== 0) {
      return sourceGap;
    }

    const leftPixelCount = Number(left.width || 0) * Number(left.height || 0);
    const rightPixelCount = Number(right.width || 0) * Number(right.height || 0);
    if (rightPixelCount !== leftPixelCount) {
      return rightPixelCount - leftPixelCount;
    }

    const leftBandwidth = Number(left.bandwidth || 0);
    const rightBandwidth = Number(right.bandwidth || 0);
    if (rightBandwidth !== leftBandwidth) {
      return rightBandwidth - leftBandwidth;
    }

    const leftFrameRate = Number(left.frameRate || 0);
    const rightFrameRate = Number(right.frameRate || 0);
    if (rightFrameRate !== leftFrameRate) {
      return rightFrameRate - leftFrameRate;
    }

    return String(left.fileId || left.url).localeCompare(String(right.fileId || right.url));
  }

  private getDouyinCandidateSourceRank(sourceKind?: string): number {
    switch (String(sourceKind || '').trim()) {
      case 'bit_rate':
        return 0;
      case 'play_addr_h264':
        return 1;
      case 'play_addr_bytevc1':
        return 2;
      case 'play_addr':
        return 3;
      case 'merged_fallback':
        return 4;
      case 'default_preview':
        return 5;
      default:
        return 6;
    }
  }

  private pickIosPreferredVideoCandidate(
    candidates: VideoStreamCandidate[] | undefined,
  ): VideoStreamCandidate | null {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    const validCandidates = candidates.filter(
      (item) => typeof item?.url === 'string' && item.url.trim().length > 0,
    );
    if (validCandidates.length === 0) {
      return null;
    }

    validCandidates.sort((left, right) => {
      const leftPixelCount = Number(left.width || 0) * Number(left.height || 0);
      const rightPixelCount = Number(right.width || 0) * Number(right.height || 0);
      if (rightPixelCount !== leftPixelCount) {
        return rightPixelCount - leftPixelCount;
      }

      const leftCodecRank = this.getIosVideoCodecRank(left.codecid);
      const rightCodecRank = this.getIosVideoCodecRank(right.codecid);
      if (rightCodecRank !== leftCodecRank) {
        return rightCodecRank - leftCodecRank;
      }

      const leftFrameRate = Number(left.frameRate || 0);
      const rightFrameRate = Number(right.frameRate || 0);
      if (rightFrameRate !== leftFrameRate) {
        return rightFrameRate - leftFrameRate;
      }

      const leftBandwidth = Number(left.bandwidth || 0);
      const rightBandwidth = Number(right.bandwidth || 0);
      return rightBandwidth - leftBandwidth;
    });

    return validCandidates[0];
  }

  private getIosVideoCodecRank(codecid: number | undefined): number {
    if (!Number.isFinite(codecid)) {
      return 0;
    }

    if (codecid === 7) {
      return 100;
    }

    return 10;
  }

  private pickAudioStreamByQuality(
    qualityMap: Record<string, string> | undefined,
    requestedQuality: string,
  ): ResolvedStream | null {
    if (!qualityMap || Object.keys(qualityMap).length === 0) {
      return null;
    }

    if (qualityMap[requestedQuality]) {
      return this.toResolvedStream(qualityMap[requestedQuality], requestedQuality);
    }

    const entries = Object.entries(qualityMap)
      .map(([quality, url]) => ({
        quality,
        url,
        bitrate: this.parseAudioBitrate(quality),
      }))
      .filter((item) => !!item.url && item.bitrate > 0);

    if (entries.length === 0) {
      const [fallbackQuality, fallbackUrl] = Object.entries(qualityMap)[0] || [];
      if (!fallbackUrl) {
        return null;
      }
      return this.toResolvedStream(fallbackUrl, fallbackQuality || requestedQuality);
    }

    const targetBitrate = this.parseAudioBitrate(requestedQuality);
    if (targetBitrate <= 0) {
      const best = entries.reduce((prev, curr) =>
        curr.bitrate > prev.bitrate ? curr : prev,
      );
      return this.toResolvedStream(best.url, best.quality);
    }

    const best = entries.reduce((prev, curr) => {
      const prevGap = Math.abs(prev.bitrate - targetBitrate);
      const currGap = Math.abs(curr.bitrate - targetBitrate);

      if (currGap < prevGap) {
        return curr;
      }

      if (currGap === prevGap && curr.bitrate > prev.bitrate) {
        return curr;
      }

      return prev;
    });

    return this.toResolvedStream(best.url, best.quality);
  }

  private parseAudioBitrate(quality: string): number {
    const match = quality.toLowerCase().match(/(\d+)\s*k/);
    if (!match) {
      return 0;
    }

    return parseInt(match[1], 10);
  }

  private toResolvedStream(url: string, quality: string): ResolvedStream {
    return {
      url,
      quality,
    };
  }

  private hasPopulatedQualityMap(
    qualityMap?: Record<string, string>,
  ): boolean {
    if (!qualityMap) {
      return false;
    }

    return Object.values(qualityMap).some(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );
  }

  private hasIndependentAudioSource(audioUrl: string, videoUrl: string): boolean {
    if (!audioUrl) {
      return false;
    }

    if (!videoUrl) {
      return true;
    }

    return !this.isSameMediaSource(audioUrl, videoUrl);
  }

  private isSameMediaSource(urlA: string, urlB: string): boolean {
    const left = this.toMediaIdentity(urlA);
    const right = this.toMediaIdentity(urlB);
    if (!left || !right) {
      return false;
    }
    return left === right;
  }

  private toMediaIdentity(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }

    try {
      const parsed = new URL(normalized);
      return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    } catch (_error) {
      const raw = normalized.split('?')[0]?.split('#')[0] || '';
      return raw.toLowerCase();
    }
  }

  private isSegmentedVideoUrl(url: string): boolean {
    if (!url) {
      return false;
    }
    return /\.m4s(\?|$)/i.test(url);
  }

  private getVideoQualityRank(quality: string): number {
    const order = ['360p', '480p', '540p', '720p', '1080p', '1440p', '4k'];
    const index = order.indexOf(quality);
    return index === -1 ? -1 : index;
  }

  private shouldUseServerMerge(
    merged: ResolvedStream | null,
    video: ResolvedStream | null,
    audio: ResolvedStream | null,
    options: MergeStrategyOptions = {},
  ): boolean {
    if (!video || !audio || !video.url || !audio.url) {
      return false;
    }

    const allowNonSegmented = options.allowNonSegmented === true;
    const segmentedVideo = this.isSegmentedVideoUrl(video.url);

    if (!segmentedVideo && !allowNonSegmented) {
      return false;
    }

    if (!merged) {
      return true;
    }

    const mergedRank = this.getVideoQualityRank(merged.quality);
    const videoRank = this.getVideoQualityRank(video.quality);

    // 当分段流可用时，优先走服务端合流，规避部分 merged 直链 403。
    if (segmentedVideo && videoRank >= mergedRank) {
      return true;
    }

    // YouTube 高频场景下 merged 只有低清，允许使用 video+audio 合流拿到更高清晰度。
    if (allowNonSegmented && videoRank > mergedRank) {
      return true;
    }

    return false;
  }

  private buildMergeEndpointUrl(
    videoUrl: string,
    audioUrl: string,
    title: string,
    iosCompatible = false,
    runtimeTraceId?: string | null,
  ): string {
    const params = new URLSearchParams({
      video: videoUrl,
      audio: audioUrl,
      title,
    });
    if (iosCompatible) {
      params.set('iosCompatible', '1');
    }
    if (runtimeTraceId) {
      params.set('runtimeTraceId', runtimeTraceId);
    }
    return `/api/download/merge?${params.toString()}`;
  }

  async streamMergedVideo(
    videoUrl: string,
    audioUrl: string,
    res: Response,
    iosCompatible = false,
    runtimeTraceId?: string | null,
  ): Promise<void> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    const decodedVideoUrl = decodeURIComponent(videoUrl);
    const decodedAudioUrl = decodeURIComponent(audioUrl);

    if (!decodedVideoUrl || !decodedAudioUrl) {
      throw new Error('缺少音视频流地址');
    }

    if (iosCompatible) {
      await this.streamIosCompatibleMergedVideo(
        decodedVideoUrl,
        decodedAudioUrl,
        res,
        traceId,
      );
      return;
    }

    await this.streamStandardMergedVideo(
      decodedVideoUrl,
      decodedAudioUrl,
      res,
      traceId,
    );
  }

  private buildMergeInputArgs(
    decodedVideoUrl: string,
    decodedAudioUrl: string,
    headersForVideo: string,
    headersForAudio: string,
  ): string[] {
    return [
      '-rw_timeout',
      '15000000',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '2',
      '-headers',
      headersForVideo,
      '-i',
      decodedVideoUrl,
      '-rw_timeout',
      '15000000',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '2',
      '-headers',
      headersForAudio,
      '-i',
      decodedAudioUrl,
    ];
  }

  private buildStandardStreamMergeOutputArgs(decodedAudioUrl: string): string[] {
    const audioCodec = this.shouldCopyAudioCodec(decodedAudioUrl) ? 'copy' : 'aac';
    return [
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      audioCodec,
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ];
  }

  private buildIosCompatibleMergeOutputArgs(outputPath: string): string[] {
    return [
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      this.iosTranscodePreset,
      '-crf',
      String(this.iosTranscodeCrf),
      '-pix_fmt',
      'yuv420p',
      '-tag:v',
      'avc1',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      outputPath,
    ];
  }

  private async streamStandardMergedVideo(
    decodedVideoUrl: string,
    decodedAudioUrl: string,
    res: Response,
    runtimeTraceId?: string | null,
  ): Promise<void> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    const bilibiliCookie = await this.bilibiliAuthService.getCookieHeader();
    const headersForVideo = this.buildFfmpegHeaders(decodedVideoUrl, bilibiliCookie);
    const headersForAudio = this.buildFfmpegHeaders(decodedAudioUrl, bilibiliCookie);
    const audioCodec = this.shouldCopyAudioCodec(decodedAudioUrl) ? 'copy' : 'aac';

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...this.buildMergeInputArgs(
        decodedVideoUrl,
        decodedAudioUrl,
        headersForVideo,
        headersForAudio,
      ),
      ...this.buildStandardStreamMergeOutputArgs(decodedAudioUrl),
    ];

    const ffmpegStartedAt = Date.now();
    const mergePlatform = detectObservedPlatformFromUrl(decodedVideoUrl);
    this.logStructured('log', 'ffmpeg_merge_started', {
      platform: mergePlatform,
      sourceHost: extractSourceHost(decodedVideoUrl),
      audioCodec,
    });

    const ffmpeg = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    ffmpeg.stdout.pipe(res);

    let stderrOutput = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    let lastOutputAt = Date.now();
    ffmpeg.stdout.on('data', () => {
      lastOutputAt = Date.now();
    });

    let clientClosed = false;
    const cleanup = () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    };

    const hangCheckTimer = setInterval(() => {
      if (clientClosed || ffmpeg.killed) {
        return;
      }

      const now = Date.now();
      const inactiveFor = now - lastOutputAt;
      if (inactiveFor > 45000) {
        this.logStructured('error', 'ffmpeg_merge_idle_timeout', {
          platform: mergePlatform,
          sourceHost: extractSourceHost(decodedVideoUrl),
          errorCode: 'FFMPEG_IDLE_TIMEOUT',
          inactiveForMs: inactiveFor,
        });
        cleanup();
      }
    }, 10000);

    res.on('close', () => {
      clientClosed = true;
      cleanup();
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg.on('error', (error) => {
        clearInterval(hangCheckTimer);
        if (clientClosed) {
          resolve();
          return;
        }
        this.recordUpstreamRequest({
          upstream: 'ffmpeg_merge',
          platform: mergePlatform,
          outcome: 'system_error',
          errorCode: normalizeObservedErrorCode(error, 'FFMPEG_PROCESS_ERROR'),
          durationMs: Date.now() - ffmpegStartedAt,
          traceId,
        });
        this.logStructured('error', 'ffmpeg_merge_process_error', {
          platform: mergePlatform,
          sourceHost: extractSourceHost(decodedVideoUrl),
          errorCode: normalizeObservedErrorCode(error, 'FFMPEG_PROCESS_ERROR'),
          message: error.message,
        });
        reject(error);
      });

      ffmpeg.on('close', (code) => {
        clearInterval(hangCheckTimer);
        if (clientClosed && code === null) {
          resolve();
          return;
        }

        if (code === 0) {
          this.recordUpstreamRequest({
            upstream: 'ffmpeg_merge',
            platform: mergePlatform,
            outcome: 'success',
            errorCode: 'NONE',
            durationMs: Date.now() - ffmpegStartedAt,
            traceId,
          });
          this.logStructured('log', 'ffmpeg_merge_completed', {
            platform: mergePlatform,
            sourceHost: extractSourceHost(decodedVideoUrl),
            durationMs: Date.now() - ffmpegStartedAt,
          });
          resolve();
          return;
        }

        this.recordUpstreamRequest({
          upstream: 'ffmpeg_merge',
          platform: mergePlatform,
          outcome: 'system_error',
          errorCode: `FFMPEG_EXIT_${code ?? 'UNKNOWN'}`,
          durationMs: Date.now() - ffmpegStartedAt,
          traceId,
        });
        this.logStructured('error', 'ffmpeg_merge_failed', {
          platform: mergePlatform,
          sourceHost: extractSourceHost(decodedVideoUrl),
          errorCode: `FFMPEG_EXIT_${code ?? 'UNKNOWN'}`,
          stderrTail: stderrOutput.slice(-600),
        });
        reject(new Error(`视频合流失败，退出码: ${code}`));
      });
    });
  }

  private async streamIosCompatibleMergedVideo(
    decodedVideoUrl: string,
    decodedAudioUrl: string,
    res: Response,
    runtimeTraceId?: string | null,
  ): Promise<void> {
    const traceId = normalizeRuntimeTraceId(runtimeTraceId);
    const bilibiliCookie = await this.bilibiliAuthService.getCookieHeader();
    const headersForVideo = this.buildFfmpegHeaders(decodedVideoUrl, bilibiliCookie);
    const headersForAudio = this.buildFfmpegHeaders(decodedAudioUrl, bilibiliCookie);
    const tempDir = mkdtempSync(join(tmpdir(), 'vsave-ios-merge-'));
    const outputPath = join(tempDir, 'output.mp4');
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...this.buildMergeInputArgs(
        decodedVideoUrl,
        decodedAudioUrl,
        headersForVideo,
        headersForAudio,
      ),
      ...this.buildIosCompatibleMergeOutputArgs(outputPath),
    ];

    const ffmpegStartedAt = Date.now();
    const mergePlatform = detectObservedPlatformFromUrl(decodedVideoUrl);
    this.logStructured('log', 'ffmpeg_ios_merge_started', {
      platform: mergePlatform,
      sourceHost: extractSourceHost(decodedVideoUrl),
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(this.ffmpegPath, ffmpegArgs, {
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderrOutput = '';
        ffmpeg.stderr.on('data', (chunk: Buffer) => {
          stderrOutput = `${stderrOutput}${chunk.toString()}`.slice(-1200);
        });

        ffmpeg.on('error', (error) => {
          this.recordUpstreamRequest({
            upstream: 'ffmpeg_ios_merge',
            platform: mergePlatform,
            outcome: 'system_error',
            errorCode: normalizeObservedErrorCode(error, 'FFMPEG_IOS_PROCESS_ERROR'),
            durationMs: Date.now() - ffmpegStartedAt,
            traceId,
          });
          reject(error);
        });
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            this.recordUpstreamRequest({
              upstream: 'ffmpeg_ios_merge',
              platform: mergePlatform,
              outcome: 'success',
              errorCode: 'NONE',
              durationMs: Date.now() - ffmpegStartedAt,
              traceId,
            });
            resolve();
            return;
          }
          this.recordUpstreamRequest({
            upstream: 'ffmpeg_ios_merge',
            platform: mergePlatform,
            outcome: 'system_error',
            errorCode: `FFMPEG_IOS_EXIT_${code ?? 'UNKNOWN'}`,
            durationMs: Date.now() - ffmpegStartedAt,
            traceId,
          });
          reject(new Error(stderrOutput || `ffmpeg 退出码 ${code}`));
        });
      });

      if (!existsSync(outputPath)) {
        throw new Error('iOS 兼容合流产物不存在');
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', statSync(outputPath).size);
      res.setHeader('Accept-Ranges', 'bytes');

      await new Promise<void>((resolve, reject) => {
        const fileStream = createReadStream(outputPath);
        const onClose = () => {
          res.off('close', onClose);
          fileStream.destroy();
          resolve();
        };

        res.on('close', onClose);
        fileStream.on('error', (error) => {
          res.off('close', onClose);
          reject(error);
        });
        fileStream.on('end', () => {
          res.off('close', onClose);
          resolve();
        });
        fileStream.pipe(res);
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private buildFfmpegHeaders(url: string, bilibiliCookie?: string): string {
    const headers = [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept: */*',
    ];

    if (this.isLikelyBilibiliMediaUrl(url)) {
      headers.push('Referer: https://www.bilibili.com');
      headers.push('Origin: https://www.bilibili.com');
      if (bilibiliCookie) {
        headers.push(`Cookie: ${bilibiliCookie}`);
      }
    }

    if (this.isLikelyYoutubeMediaUrl(url)) {
      headers.push('Referer: https://www.youtube.com/');
      headers.push('Origin: https://www.youtube.com');
    }

    return `${headers.join('\r\n')}\r\n`;
  }

  private shouldCopyAudioCodec(audioUrl: string): boolean {
    if (!audioUrl) {
      return false;
    }

    const normalized = audioUrl.toLowerCase();
    if (normalized.includes('mime=audio%2fwebm') || normalized.includes('mime=audio/webm')) {
      return false;
    }
    if (normalized.includes('.webm') || normalized.includes('opus')) {
      return false;
    }

    if (
      normalized.includes('mime=audio%2fmp4') ||
      normalized.includes('mime=audio/mp4') ||
      normalized.includes('.m4a') ||
      normalized.includes('.m4s') ||
      normalized.includes('.aac')
    ) {
      return true;
    }

    return false;
  }

  private isLikelyBilibiliMediaUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
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
      const lower = url.toLowerCase();
      return (
        lower.includes('bilibili.com') ||
        lower.includes('bilivideo') ||
        lower.includes('upgcxcode') ||
        lower.includes('upsig=')
      );
    }
  }

  private isLikelyYoutubeMediaUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return hostname.includes('googlevideo.com') || hostname.includes('youtube.com');
    } catch (_error) {
      return false;
    }
  }

  private inferFileExtension(url: string, fallback: string): string {
    if (!url) {
      return fallback;
    }

    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || '';
      const ext = pathname.split('.').pop()?.toLowerCase() || '';

      if (!ext) {
        return fallback;
      }

      if (ext === 'm4s') {
        return fallback === 'm4a' ? 'm4a' : 'mp4';
      }

      if (['mp4', 'webm', 'm4a', 'mp3', 'flv', 'aac'].includes(ext)) {
        return ext;
      }
    } catch (_e) {
      // ignore invalid URL parse, fallback below
    }

    return fallback;
  }

  /**
   * 记录下载历史
   * @param userId 用户ID
   * @param videoInfo 视频信息
   * @param format 视频格式
   * @param quality 视频质量
   * @param downloadUrl 下载链接
   */
  async recordDownload(
    userId: string | undefined,
    videoInfo: VideoInfo | string,
    format?: string,
    quality?: string,
    downloadUrl?: string,
    options?: {
      status?: string;
    },
  ): Promise<DownloadHistory> {
    // 如果传入的是字符串（JSON），解析它
    let info: VideoInfo;
    if (typeof videoInfo === 'string') {
      info = JSON.parse(videoInfo);
    } else {
      info = videoInfo;
    }

    this.logStructured('log', 'download_history_record_started', {
      userType: userId ? 'authenticated' : 'anonymous',
      platform: normalizeObservedPlatform(info.platform),
      sourceHost: extractSourceHost(info.sourceUrl || info.videoUrl),
      titleHash: this.hashValue(info.title),
    });

    const downloadHistory = this.downloadHistoryRepository.create({
      videoTitle: info.title,
      videoUrl: info.videoUrl,
      sourceUrl: typeof info.sourceUrl === 'string' ? info.sourceUrl : null,
      platform: info.platform,
      coverUrl: info.cover,
      format: format || VideoFormat.MP4,
      quality: quality || VideoQuality.HD,
      downloadUrl: downloadUrl || info.videoUrl,
      status: options?.status || 'completed',
      hiddenAt: null,
      userId: userId || null,
    });

    const saved = await this.downloadHistoryRepository.save(downloadHistory);
    this.logStructured('log', 'download_history_record_succeeded', {
      historyId: saved.id,
      platform: normalizeObservedPlatform(saved.platform),
      quality: saved.quality || null,
      format: saved.format || null,
      status: saved.status,
    });

    if (userId) {
      await this.usersService.incrementDownloadCount(userId);
    }

    return saved;
  }

  /**
   * 获取用户下载历史
   * @param userId 用户ID
   * @param limit 限制数量
   * @param offset 偏移量
   */
  async getDownloadHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<DownloadHistory[]> {
    const result = await this.queryDownloadHistory(userId, { limit, offset });
    return result.items;
  }

  async queryDownloadHistory(
    userId: string,
    input: QueryDownloadHistoryInput = {},
  ): Promise<{ items: DownloadHistory[]; total: number }> {
    const parsedLimit = Number(input.limit || 20);
    const parsedOffset = Number(input.offset || 0);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, Math.floor(parsedLimit)))
      : 20;
    const offset = Number.isFinite(parsedOffset)
      ? Math.max(0, Math.floor(parsedOffset))
      : 0;
    const platform = String(input.platform || '').trim();
    const dateFrom = this.parseHistoryDate(input.dateFrom, 'start');
    const dateTo = this.parseHistoryDate(input.dateTo, 'end');

    this.logStructured('log', 'download_history_query_started', {
      userType: 'authenticated',
      platform: normalizeObservedPlatform(platform),
      limit,
      offset,
      dateFrom: input.dateFrom || null,
      dateTo: input.dateTo || null,
    });

    const qb = this.downloadHistoryRepository
      .createQueryBuilder('history')
      .where('history.userId = :userId', { userId })
      .andWhere('history.hiddenAt IS NULL');

    if (platform) {
      qb.andWhere('history.platform = :platform', { platform });
    }

    if (dateFrom) {
      qb.andWhere('history.createdAt >= :dateFrom', { dateFrom });
    }

    if (dateTo) {
      qb.andWhere('history.createdAt <= :dateTo', { dateTo });
    }

    qb.orderBy('history.createdAt', 'DESC');
    qb.skip(offset).take(limit);

    const [items, total] = await qb.getManyAndCount();

    this.logStructured('log', 'download_history_query_succeeded', {
      count: items.length,
      total,
      platform: normalizeObservedPlatform(platform),
      limit,
      offset,
    });

    return { items, total };
  }

  /**
   * 删除用户下载历史
   * @param userId 用户ID
   * @param historyId 历史记录ID
   */
  async deleteDownloadHistory(
    userId: string,
    historyId: string,
  ): Promise<boolean> {
    const result = await this.downloadHistoryRepository.update(
      {
        id: historyId,
        userId,
        hiddenAt: null,
      },
      {
        hiddenAt: new Date(),
      },
    );

    return (result.affected || 0) > 0;
  }

  async clearDownloadHistory(
    userId: string,
    input: Pick<QueryDownloadHistoryInput, 'platform' | 'dateFrom' | 'dateTo'> = {},
  ): Promise<number> {
    const platform = String(input.platform || '').trim();
    const dateFrom = this.parseHistoryDate(input.dateFrom, 'start');
    const dateTo = this.parseHistoryDate(input.dateTo, 'end');

    const qb = this.downloadHistoryRepository
      .createQueryBuilder()
      .update(DownloadHistory)
      .set({ hiddenAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('hiddenAt IS NULL');

    if (platform) {
      qb.andWhere('platform = :platform', { platform });
    }

    if (dateFrom) {
      qb.andWhere('createdAt >= :dateFrom', { dateFrom });
    }

    if (dateTo) {
      qb.andWhere('createdAt <= :dateTo', { dateTo });
    }

    const result = await qb.execute();
    return result.affected || 0;
  }

  async deleteDownloadHistories(
    userId: string,
    historyIds: string[] = [],
  ): Promise<number> {
    const normalizedIds = Array.from(
      new Set(
        (historyIds || [])
          .map((id) => String(id || '').trim())
          .filter((id) => !!id),
      ),
    );

    if (!normalizedIds.length) {
      return 0;
    }

    const result = await this.downloadHistoryRepository
      .createQueryBuilder()
      .update(DownloadHistory)
      .set({ hiddenAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('id IN (:...ids)', { ids: normalizedIds })
      .andWhere('hiddenAt IS NULL')
      .execute();
    return result.affected || 0;
  }

  private parseHistoryDate(
    value: string | undefined,
    boundary: 'start' | 'end',
  ): Date | null {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const suffix =
        boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
      const parsed = new Date(`${normalized}${suffix}`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  /**
   * 获取所有下载历史（管理员用）
   * @param limit 限制数量
   * @param offset 偏移量
   */
  async getAllDownloadHistory(
    limit: number = 20,
    offset: number = 0,
  ): Promise<DownloadHistory[]> {
    return this.downloadHistoryRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * 获取下载历史统计
   * @param userId 用户ID（可选）
   */
  async getDownloadStats(userId?: string): Promise<{
    total: number;
    byPlatform: { [key: string]: number };
  }> {
    const queryBuilder = this.downloadHistoryRepository.createQueryBuilder('history');

    if (userId) {
      queryBuilder.where('history.userId = :userId', { userId });
    }

    const total = await queryBuilder.getCount();

    const byPlatformRaw = await queryBuilder
      .select('history.platform', 'platform')
      .addSelect('COUNT(*)', 'count')
      .groupBy('history.platform')
      .getRawMany();

    const byPlatform: { [key: string]: number } = {};
    byPlatformRaw.forEach((item) => {
      byPlatform[item.platform] = parseInt(item.count, 10);
    });

    return { total, byPlatform };
  }
}
