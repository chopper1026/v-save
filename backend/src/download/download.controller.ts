import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Request,
  Res,
  Query,
  Param,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { DownloadService } from './download.service';
import {
  ParseVideoDto,
  GetDownloadUrlDto,
  CreateDownloadTaskDto,
  PrepareNativeSilentDownloadDto,
  QueryDownloadHistoryDto,
  DeleteDownloadHistoriesDto,
  VideoFormat,
  VideoQuality,
} from './dto/download.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isParserFailureError } from '../parsers/parser-failure.error';
import { AuthHealthService } from '../auth-health/auth-health.service';
import { VideoInfo } from '../parsers/base.interface';
import { DownloadModeService } from '../download-mode/download-mode.service';
import { DownloadClientType } from '../download-mode/download-mode.types';
import { RuntimeMonitorService } from '../runtime-monitor/runtime-monitor.service';
import type { RuntimePlatform } from '../runtime-monitor/runtime-monitor.types';
import {
  detectRuntimePlatformFromUrl,
  normalizeRuntimeErrorCode,
  normalizeRuntimePlatform,
  normalizeRuntimeTraceId,
} from '../runtime-monitor/runtime-monitor.utils';
import {
  resolvePublicApiOrigin,
  resolveRequestOrigin,
} from '../config/runtime-config';

/**
 * 请求用户接口
 */
interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * 下载控制器
 */
@Controller('download')
export class DownloadController {
  constructor(
    private readonly downloadService: DownloadService,
    private readonly authHealthService: AuthHealthService,
    private readonly downloadModeService: DownloadModeService,
    private readonly runtimeMonitorService: RuntimeMonitorService,
  ) {}

  private parseVideoInfoOrThrow(videoInfo: string): VideoInfo {
    try {
      return JSON.parse(videoInfo) as VideoInfo;
    } catch (_error) {
      throw new BadRequestException('视频信息格式不正确');
    }
  }

  private resolveRuntimeTraceId(req: RequestWithUser | undefined): string | null {
    const requestAny = req as any;
    return normalizeRuntimeTraceId(
      requestAny?.headers?.['x-runtime-trace-id'] ||
        requestAny?.headers?.['X-RUNTIME-TRACE-ID'] ||
        requestAny?.query?.runtimeTraceId ||
        requestAny?.query?.rtid,
    );
  }

  private resolveVideoQualityForPermission(
    format?: VideoFormat,
    quality?: string,
  ): VideoQuality {
    if (format === VideoFormat.AUDIO) {
      return VideoQuality.HD;
    }

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

  private normalizeApiDownloadUrl(
    downloadUrl: string | null | undefined,
    req: RequestWithUser | undefined,
  ): string | null | undefined {
    if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('/api/')) {
      return downloadUrl;
    }

    const origin = resolveRequestOrigin(req as any, resolvePublicApiOrigin(process.env.PUBLIC_API_ORIGIN));
    if (!origin) {
      return downloadUrl;
    }

    return `${origin}${downloadUrl}`;
  }

  /**
   * 解析视频
   * 公开接口，无需认证
   */
  @Post('parse')
  async parseVideo(
    @Body() parseVideoDto: ParseVideoDto,
    @Request() req?: RequestWithUser,
  ) {
    const startedAt = Date.now();
    const { url, clientType } = parseVideoDto;
    const fallbackPlatform = detectRuntimePlatformFromUrl(url);
    const traceId = this.resolveRuntimeTraceId(req);
    let interfacePlatform = fallbackPlatform;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;

    try {
      if (!url) {
        interfaceErrorCode = 'PARSE_URL_MISSING';
        throw new BadRequestException('请提供视频URL');
      }

      let videoInfo;
      try {
        videoInfo = await this.downloadService.parseVideo(url);
        if (videoInfo?.platform) {
          await this.authHealthService
            .reportParseSuccess(videoInfo.platform)
            .catch(() => undefined);
        }
      } catch (error: any) {
        if (isParserFailureError(error)) {
          interfaceErrorCode = error.code;
          await this.runtimeMonitorService.recordServerEvent({
            feature: 'parse',
            clientType,
            platform: error.platform || fallbackPlatform,
            outcome: 'failure',
            latencyMs: Date.now() - startedAt,
            errorCode: error.code,
            traceId,
          });
          await this.authHealthService
            .reportParseFailure(error.platform, {
              category: error.category,
              code: error.code,
              message: error.message,
            })
            .catch(() => undefined);
          throw new BadRequestException(error.toResponseBody());
        }
        await this.runtimeMonitorService.recordServerEvent({
          feature: 'parse',
          clientType,
          platform: fallbackPlatform,
          outcome: 'failure',
          latencyMs: Date.now() - startedAt,
          errorCode: normalizeRuntimeErrorCode(error, 'PARSE_FAILED'),
          traceId,
        });
        interfaceErrorCode = normalizeRuntimeErrorCode(error, 'PARSE_FAILED');
        throw error;
      }

      if (!videoInfo) {
        interfaceErrorCode = 'PARSE_URL_NOT_FOUND';
        await this.runtimeMonitorService.recordServerEvent({
          feature: 'parse',
          clientType,
          platform: fallbackPlatform,
          outcome: 'failure',
          latencyMs: Date.now() - startedAt,
          errorCode: 'PARSE_URL_NOT_FOUND',
          traceId,
        });
        throw new BadRequestException({
          code: 'PARSE_URL_NOT_FOUND',
          message: '未检测到可解析的视频链接，请粘贴完整分享链接或文案',
          category: 'invalid_input',
          retryable: false,
        });
      }

      await this.runtimeMonitorService.recordServerEvent({
        feature: 'parse',
        clientType,
        platform: normalizeRuntimePlatform(videoInfo.platform || fallbackPlatform),
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        traceId,
      });
      interfacePlatform = normalizeRuntimePlatform(videoInfo.platform || fallbackPlatform);
      interfaceOutcome = 'success';
      return {
        success: true,
        data: videoInfo,
      };
    } finally {
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: interfacePlatform,
        clientType,
        stage: 'parse',
        interfaceName: 'download.parse',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
    }
  }

  @Get('quality-status')
  async getDouyinQualityStatus(@Query('key') refreshKey: string) {
    const normalizedKey = String(refreshKey || '').trim();
    if (!normalizedKey) {
      throw new BadRequestException('请提供画质补全 key');
    }

    const result = this.downloadService.getDouyinQualityStatus(normalizedKey);
    if (!result) {
      throw new NotFoundException('画质补全状态不存在或已过期');
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 获取下载链接
   * 需要JWT认证
   */
  @Post('get-url')
  @UseGuards(JwtAuthGuard)
  async getDownloadUrl(
    @Body() getDownloadUrlDto: GetDownloadUrlDto,
    @Request() req: RequestWithUser,
  ) {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    const {
      videoInfo,
      clientType,
      format,
      quality,
      iosCompatible,
      allowWatermarkFallback,
      probeMode,
    } = getDownloadUrlDto;
    const userId = req.user?.id;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    let interfacePlatform: RuntimePlatform = 'unknown';
    let parsedVideoInfo: VideoInfo | null = null;
    let result: any;

    try {
      if (!videoInfo) {
        interfaceErrorCode = 'DOWNLOAD_VIDEO_INFO_MISSING';
        throw new BadRequestException('请提供视频信息');
      }

      if (!clientType) {
        interfaceErrorCode = 'DOWNLOAD_CLIENT_TYPE_MISSING';
        throw new BadRequestException('请提供客户端类型');
      }

      if (!userId) {
        interfaceErrorCode = 'USER_NOT_LOGGED_IN';
        throw new BadRequestException('用户未登录');
      }

      parsedVideoInfo = this.parseVideoInfoOrThrow(videoInfo);
      interfacePlatform = normalizeRuntimePlatform(parsedVideoInfo.platform);

      const permissionQuality = this.resolveVideoQualityForPermission(
        format as VideoFormat,
        quality,
      );

      const permission = await this.downloadService.checkDownloadPermission({
        userId,
        platform: parsedVideoInfo.platform,
        quality: permissionQuality,
        entryType: 'get-url',
      });

      if (!permission.allowed) {
        interfaceErrorCode = permission.code || 'DOWNLOAD_PERMISSION_DENIED';
        throw new ForbiddenException({
          code: permission.code,
          message: permission.message || '当前账号暂无下载权限',
        });
      }

      const resolvedPolicy = await this.downloadModeService.resolveGetUrlPolicy({
        clientType,
        videoInfo: parsedVideoInfo,
        format,
        quality,
        overrides: {
          iosCompatible,
          allowWatermarkFallback,
          probeMode,
        },
      });
      result = await this.downloadService.getDownloadUrl(
        videoInfo,
        format as VideoFormat,
        quality,
        resolvedPolicy.iosCompatible,
        resolvedPolicy.allowWatermarkFallback,
        resolvedPolicy.probeMode,
        traceId,
      );
      await this.authHealthService
        .reportParseSuccess(parsedVideoInfo.platform)
        .catch(() => undefined);

      result.downloadUrl = this.normalizeApiDownloadUrl(result.downloadUrl, req);

      await this.downloadService.recordDownload(
        userId,
        videoInfo,
        result.format,
        result.quality,
        result.downloadUrl,
      );

      interfaceOutcome = 'success';
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      interfaceErrorCode =
        interfaceErrorCode ||
        normalizeRuntimeErrorCode(error, 'DOWNLOAD_URL_FAILED');
      if (parsedVideoInfo) {
        interfacePlatform = normalizeRuntimePlatform(parsedVideoInfo.platform);
      }
      throw error;
    } finally {
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: interfacePlatform,
        clientType,
        stage: 'download',
        interfaceName: 'download.get_url',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
    }
  }

  /**
   * 创建异步下载任务
   * 需要JWT认证
   */
  @Post('create-task')
  @UseGuards(JwtAuthGuard)
  async createDownloadTask(
    @Body() createTaskDto: CreateDownloadTaskDto,
    @Request() req: RequestWithUser,
  ): Promise<{ success: boolean; data: any }> {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    const { sourceUrl, videoInfo, format, quality } = createTaskDto;
    const userId = req.user?.id;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    let interfacePlatform: RuntimePlatform = detectRuntimePlatformFromUrl(sourceUrl);

    try {
      if (!sourceUrl) {
        interfaceErrorCode = 'SOURCE_URL_MISSING';
        throw new BadRequestException('请提供视频来源链接');
      }

      if (!videoInfo) {
        interfaceErrorCode = 'VIDEO_INFO_MISSING';
        throw new BadRequestException('请提供视频信息');
      }

      if (!userId) {
        interfaceErrorCode = 'USER_NOT_LOGGED_IN';
        throw new BadRequestException('用户未登录');
      }

      const parsedVideoInfo = this.parseVideoInfoOrThrow(videoInfo);
      interfacePlatform = normalizeRuntimePlatform(
        parsedVideoInfo.platform || interfacePlatform,
      );

      const permissionQuality = this.resolveVideoQualityForPermission(
        format as VideoFormat,
        quality,
      );

      const permission = await this.downloadService.checkDownloadPermission({
        userId,
        platform: parsedVideoInfo.platform,
        quality: permissionQuality,
        entryType: 'create-task',
      });

      if (!permission.allowed) {
        interfaceErrorCode = permission.code || 'DOWNLOAD_PERMISSION_DENIED';
        throw new ForbiddenException({
          code: permission.code,
          message: permission.message || '当前账号暂无下载权限',
        });
      }

      const task = await this.downloadService.createDownloadTask(
        userId,
        sourceUrl,
        videoInfo,
        format as VideoFormat,
        quality,
        traceId,
      );

      interfaceOutcome = 'success';
      return {
        success: true,
        data: task,
      };
    } catch (error) {
      interfaceErrorCode =
        interfaceErrorCode ||
        normalizeRuntimeErrorCode(error, 'CREATE_TASK_FAILED');
      throw error;
    } finally {
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: interfacePlatform,
        clientType: 'unknown',
        stage: 'download',
        interfaceName: 'download.create_task',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
    }
  }

  @Post('prepare-native-silent')
  @UseGuards(JwtAuthGuard)
  async prepareNativeSilentDownload(
    @Body() prepareDto: PrepareNativeSilentDownloadDto,
    @Request() req: RequestWithUser,
  ): Promise<{ success: boolean; data: any }> {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    const userId = req.user?.id;
    const clientType = prepareDto.clientType || DownloadClientType.MOBILE;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    let interfacePlatform: RuntimePlatform = detectRuntimePlatformFromUrl(
      prepareDto.sourceUrl,
    );

    try {
      if (!prepareDto.sourceUrl) {
        interfaceErrorCode = 'SOURCE_URL_MISSING';
        throw new BadRequestException('请提供视频来源链接');
      }

      if (!userId) {
        interfaceErrorCode = 'USER_NOT_LOGGED_IN';
        throw new BadRequestException('用户未登录');
      }

      const result = await this.downloadService.prepareNativeSilentDownload({
        userId,
        sourceUrl: prepareDto.sourceUrl,
        clientType,
        iosCompatible: prepareDto.iosCompatible,
        runtimeTraceId: traceId,
      });

      interfacePlatform = normalizeRuntimePlatform(result.platform || interfacePlatform);
      interfaceOutcome = 'success';

      if (result.mode === 'direct') {
        result.downloadUrl = this.normalizeApiDownloadUrl(result.downloadUrl, req) || '';
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      interfaceErrorCode =
        interfaceErrorCode ||
        normalizeRuntimeErrorCode(error, 'PREPARE_NATIVE_SILENT_FAILED');
      throw error;
    } finally {
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: interfacePlatform,
        clientType,
        stage: 'download',
        interfaceName: 'download.prepare_native_silent',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
    }
  }

  /**
   * 查询异步下载任务状态
   * 需要JWT认证
   */
  @Get('tasks/:id')
  @UseGuards(JwtAuthGuard)
  async getDownloadTask(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ): Promise<{ success: boolean; data: any }> {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    const userId = req.user?.id;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    let interfacePlatform: RuntimePlatform = 'unknown';
    try {
      if (!userId) {
        interfaceErrorCode = 'USER_NOT_LOGGED_IN';
        throw new BadRequestException('用户未登录');
      }

      const task = await this.downloadService.getTaskProgress(userId, id);
      if (!task) {
        interfaceErrorCode = 'TASK_NOT_FOUND';
        throw new NotFoundException('任务不存在');
      }
      interfacePlatform = normalizeRuntimePlatform((task as any).platform);

      task.downloadUrl = this.normalizeApiDownloadUrl(task.downloadUrl, req) || null;

      interfaceOutcome = 'success';
      return {
        success: true,
        data: task,
      };
    } catch (error) {
      interfaceErrorCode =
        interfaceErrorCode ||
        normalizeRuntimeErrorCode(error, 'TASK_PROGRESS_FAILED');
      throw error;
    } finally {
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: interfacePlatform,
        clientType: 'unknown',
        stage: 'download',
        interfaceName: 'download.task_poll',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
    }
  }

  /**
   * 下载异步任务产物文件
   * 需要JWT认证
   */
  @Get('tasks/:id/file')
  @UseGuards(JwtAuthGuard)
  async downloadTaskFile(
    @Param('id') id: string,
    @Query('wait') wait: string,
    @Query('timeoutMs') timeoutMs: string,
    @Request() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    const userId = req.user?.id;
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    if (!userId) {
      interfaceErrorCode = 'USER_NOT_LOGGED_IN';
      ((res as any).locals ||= {}).observabilityErrorCode = 'USER_NOT_LOGGED_IN';
      res.status(400).json({ message: '用户未登录' });
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        stage: 'download',
        interfaceName: 'download.task_file',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
      return;
    }

    try {
      const waitUntilReady = wait === '1' || wait === 'true';
      const parsedTimeoutMs = Number.parseInt(timeoutMs, 10);
      await this.downloadService.streamTaskFile(userId, id, res, {
        waitUntilReady,
        timeoutMs:
          Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
            ? parsedTimeoutMs
            : undefined,
      });
      interfaceOutcome = 'success';
    } catch (error: any) {
      interfaceErrorCode = normalizeRuntimeErrorCode(error, 'DOWNLOAD_TASK_FILE_FAILED');
      if (res.headersSent) {
        res.end();
        await this.runtimeMonitorService.recordInterfaceEvent({
          traceId,
          stage: 'download',
          interfaceName: 'download.task_file',
          outcome: interfaceOutcome,
          latencyMs: Date.now() - startedAt,
          errorCode: interfaceErrorCode,
        });
        return;
      }
      const message = error?.message || '下载失败';
      const status = message.includes('不存在') ? 404 : 400;
      ((res as any).locals ||= {}).observabilityErrorCode =
        status === 404 ? 'TASK_FILE_NOT_FOUND' : 'DOWNLOAD_TASK_FILE_FAILED';
      res.status(status).json({ message });
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        stage: 'download',
        interfaceName: 'download.task_file',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
      return;
    }

    await this.runtimeMonitorService.recordInterfaceEvent({
      traceId,
      stage: 'download',
      interfaceName: 'download.task_file',
      outcome: interfaceOutcome,
      latencyMs: Date.now() - startedAt,
      errorCode: interfaceErrorCode,
    });
  }

  /**
   * 合流下载（需要JWT认证）
   */
  @Get('merge')
  @UseGuards(JwtAuthGuard)
  async mergeVideoAudio(
    @Query('video') video: string,
    @Query('audio') audio: string,
    @Query('iosCompatible') iosCompatible: string,
    @Request() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const startedAt = Date.now();
    const traceId = this.resolveRuntimeTraceId(req);
    let interfaceOutcome: 'success' | 'failure' = 'failure';
    let interfaceErrorCode: string | null = null;
    const mergePlatform = detectRuntimePlatformFromUrl(video);

    if (!video || !audio) {
      interfaceErrorCode = 'MERGE_INPUT_MISSING';
      ((res as any).locals ||= {}).observabilityErrorCode = 'MERGE_INPUT_MISSING';
      res.status(400).json({ message: '缺少音视频流地址' });
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: mergePlatform,
        stage: 'download',
        interfaceName: 'download.merge',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
      return;
    }

    try {
      const iosCompatEnabled = iosCompatible === '1' || iosCompatible === 'true';
      await this.downloadService.streamMergedVideo(
        video,
        audio,
        res,
        iosCompatEnabled,
        traceId,
      );
      interfaceOutcome = 'success';
    } catch (error: any) {
      interfaceErrorCode = normalizeRuntimeErrorCode(error, 'MERGE_FAILED');
      if (!res.headersSent) {
        ((res as any).locals ||= {}).observabilityErrorCode = 'MERGE_FAILED';
        res.status(500).json({
          message: error?.message || '视频合流失败',
        });
        await this.runtimeMonitorService.recordInterfaceEvent({
          traceId,
          platform: mergePlatform,
          stage: 'download',
          interfaceName: 'download.merge',
          outcome: interfaceOutcome,
          latencyMs: Date.now() - startedAt,
          errorCode: interfaceErrorCode,
        });
        return;
      }
      res.end();
      await this.runtimeMonitorService.recordInterfaceEvent({
        traceId,
        platform: mergePlatform,
        stage: 'download',
        interfaceName: 'download.merge',
        outcome: interfaceOutcome,
        latencyMs: Date.now() - startedAt,
        errorCode: interfaceErrorCode,
      });
      return;
    }

    await this.runtimeMonitorService.recordInterfaceEvent({
      traceId,
      platform: mergePlatform,
      stage: 'download',
      interfaceName: 'download.merge',
      outcome: interfaceOutcome,
      latencyMs: Date.now() - startedAt,
      errorCode: interfaceErrorCode,
    });
  }

  /**
   * 获取下载历史
   * 需要JWT认证
   */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getDownloadHistory(
    @Request() req: RequestWithUser,
    @Query() query: QueryDownloadHistoryDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('用户未登录');
    }

    const parsedLimit = Number.parseInt(String(query.limit ?? ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(50, Math.max(1, parsedLimit))
      : 20;

    const parsedOffset = Number.parseInt(String(query.offset ?? ''), 10);
    const offset =
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    const includeStatsRaw = String(query.includeStats ?? 'true').toLowerCase();
    const includeStats = !['0', 'false', 'no', 'off'].includes(includeStatsRaw);

    const platform = String(query.platform || '').trim() || undefined;
    const dateFrom = String(query.dateFrom || '').trim() || undefined;
    const dateTo = String(query.dateTo || '').trim() || undefined;

    const historyResult = await this.downloadService.queryDownloadHistory(
      userId,
      {
        limit,
        offset,
        platform,
        dateFrom,
        dateTo,
      },
    );
    const history = historyResult.items;
    const total = historyResult.total;
    const hasMore = offset + history.length < total;

    const response: {
      success: true;
      data: unknown;
      meta: {
        limit: number;
        offset: number;
        total: number;
        count: number;
        hasMore: boolean;
        nextOffset: number;
      };
      stats?: unknown;
    } = {
      success: true,
      data: history,
      meta: {
        limit,
        offset,
        total,
        count: history.length,
        hasMore,
        nextOffset: offset + history.length,
      },
    };

    if (includeStats) {
      response.stats = await this.downloadService.getDownloadStats(userId);
    }

    return response;
  }

  /**
   * 获取下载统计
   * 需要JWT认证
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getDownloadStats(@Request() req: RequestWithUser) {
    const userId = req.user?.id;
    const stats = await this.downloadService.getDownloadStats(userId);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * 清空下载历史（支持按筛选条件删除）
   * 需要JWT认证
   */
  @Delete('history')
  @UseGuards(JwtAuthGuard)
  async clearDownloadHistory(
    @Request() req: RequestWithUser,
    @Query() query: QueryDownloadHistoryDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('用户未登录');
    }

    const affected = await this.downloadService.clearDownloadHistory(userId, {
      platform: String(query.platform || '').trim() || undefined,
      dateFrom: String(query.dateFrom || '').trim() || undefined,
      dateTo: String(query.dateTo || '').trim() || undefined,
    });

    return {
      success: true,
      data: {
        affected,
      },
    };
  }

  /**
   * 批量删除下载历史
   * 需要JWT认证
   */
  @Delete('history/batch')
  @UseGuards(JwtAuthGuard)
  async deleteDownloadHistories(
    @Request() req: RequestWithUser,
    @Body() payload: DeleteDownloadHistoriesDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('用户未登录');
    }

    const ids = Array.isArray(payload?.ids) ? payload.ids : [];
    const affected = await this.downloadService.deleteDownloadHistories(
      userId,
      ids,
    );

    return {
      success: true,
      data: {
        affected,
      },
    };
  }

  /**
   * 删除下载历史
   * 需要JWT认证
   */
  @Delete('history/:id')
  @UseGuards(JwtAuthGuard)
  async deleteDownloadHistory(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('用户未登录');
    }

    const deleted = await this.downloadService.deleteDownloadHistory(userId, id);
    if (!deleted) {
      throw new NotFoundException('下载记录不存在');
    }

    return {
      success: true,
      message: '删除成功',
    };
  }
}
