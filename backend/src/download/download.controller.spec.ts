import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DownloadController } from './download.controller';
import { ParserFailureError } from '../parsers/parser-failure.error';

describe('DownloadController parseVideo', () => {
  let controller: DownloadController;
  const downloadService = {
    parseVideo: jest.fn(),
    prepareNativeSilentDownload: jest.fn(),
    getDouyinQualityStatus: jest.fn(),
    checkDownloadPermission: jest.fn(),
    createDownloadTask: jest.fn(),
    getDownloadUrl: jest.fn(),
    getTaskProgress: jest.fn(),
    recordDownload: jest.fn(),
    queryDownloadHistory: jest.fn(),
    clearDownloadHistory: jest.fn(),
    deleteDownloadHistories: jest.fn(),
  };
  const authHealthService = {
    reportParseSuccess: jest.fn().mockResolvedValue(undefined),
    reportParseFailure: jest.fn().mockResolvedValue(undefined),
  };
  const downloadModeService = {
    resolveGetUrlPolicy: jest.fn(),
  };
  const runtimeMonitorService = {
    recordServerEvent: jest.fn().mockResolvedValue(undefined),
    recordInterfaceEvent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DownloadController(
      downloadService as any,
      authHealthService as any,
      downloadModeService as any,
      runtimeMonitorService as any,
    );
  });

  it('returns structured parser failure when parser throws classified error', async () => {
    downloadService.parseVideo.mockRejectedValue(
      new ParserFailureError({
        code: 'DOUYIN_RISK_CONTROL',
        message: '抖音触发风控',
        category: 'risk_control',
        retryable: true,
        platform: 'douyin',
      }),
    );

    try {
      await controller.parseVideo({ url: 'https://v.douyin.com/test/' } as any);
      fail('expected parseVideo to throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: 'DOUYIN_RISK_CONTROL',
          message: '抖音触发风控',
          category: 'risk_control',
          retryable: true,
          platform: 'douyin',
        }),
      );
      expect(runtimeMonitorService.recordServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'parse',
          platform: 'douyin',
          outcome: 'failure',
          errorCode: 'DOUYIN_RISK_CONTROL',
        }),
      );
    }
  });

  it('returns friendly invalid input message when parser returns null', async () => {
    downloadService.parseVideo.mockResolvedValue(null);

    try {
      await controller.parseVideo({ url: 'not-a-video' } as any);
      fail('expected parseVideo to throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: 'PARSE_URL_NOT_FOUND',
          category: 'invalid_input',
          retryable: false,
        }),
      );
      expect(runtimeMonitorService.recordServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'parse',
          outcome: 'failure',
          errorCode: 'PARSE_URL_NOT_FOUND',
        }),
      );
    }
  });

  it('records parse success with client type', async () => {
    downloadService.parseVideo.mockResolvedValue({
      title: 'test',
      platform: 'douyin',
    });

    const result = await controller.parseVideo({
      url: 'https://v.douyin.com/test/',
      clientType: 'WEB',
    } as any);

    expect(runtimeMonitorService.recordServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'parse',
        clientType: 'WEB',
        platform: 'douyin',
        outcome: 'success',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        platform: 'douyin',
      }),
    });
  });

  it('returns douyin quality status payload by refresh key', async () => {
    downloadService.getDouyinQualityStatus.mockReturnValue({
      title: 'test',
      platform: 'douyin',
      videoUrl: 'https://example.com/video.mp4',
      qualityStatus: 'complete',
      qualityRefreshKey: 'dyq:test',
      downloadOptions: {
        merged: {
          '4k': 'https://example.com/video-4k.mp4',
        },
      },
    });

    const result = await controller.getDouyinQualityStatus('dyq:test');

    expect(downloadService.getDouyinQualityStatus).toHaveBeenCalledWith('dyq:test');
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        qualityStatus: 'complete',
        qualityRefreshKey: 'dyq:test',
      }),
    });
  });

  it('requires clientType for getDownloadUrl', async () => {
    const req = {
      user: { id: 'user-1' },
      protocol: 'http',
      get: () => 'localhost:3001',
    } as any;

    await expect(
      controller.getDownloadUrl({
        videoInfo: JSON.stringify({ title: 't', platform: 'douyin', videoUrl: 'https://example.com/source.mp4' }),
      } as any, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards resolved download mode policy to download service in getDownloadUrl', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({ allowed: true });
    downloadService.getDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://example.com/video.mp4',
      format: 'mp4',
      quality: '1080p',
      fileExtension: 'mp4',
    });

    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      clientType: 'WEB',
      mode: 'SPEED_FIRST',
      source: 'database',
      iosCompatible: false,
      allowWatermarkFallback: true,
      probeMode: 'fast',
    });

    const payload = {
      videoInfo: JSON.stringify({
        title: 't',
        platform: 'douyin',
        videoUrl: 'https://example.com/source.mp4',
      }),
      clientType: 'WEB',
      format: 'mp4',
      quality: '1080p',
      allowWatermarkFallback: true,
      probeMode: 'fast',
    };

    const req = {
      user: { id: 'user-1' },
      protocol: 'http',
      get: () => 'localhost:3001',
    } as any;

    const result = await controller.getDownloadUrl(payload as any, req);

    expect(downloadModeService.resolveGetUrlPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientType: 'WEB',
        videoInfo: expect.objectContaining({ platform: 'douyin' }),
        overrides: {
          iosCompatible: undefined,
          allowWatermarkFallback: true,
          probeMode: 'fast',
        },
      }),
    );
    expect(downloadService.checkDownloadPermission).toHaveBeenCalledWith({
      userId: 'user-1',
      platform: 'douyin',
      quality: '1080p',
      entryType: 'get-url',
    });
    expect(downloadService.getDownloadUrl).toHaveBeenCalledWith(
      payload.videoInfo,
      payload.format,
      payload.quality,
      false,
      true,
      'fast',
      null,
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
  });

  it('prepares a native silent download direct payload for iOS background engine', async () => {
    downloadService.prepareNativeSilentDownload.mockResolvedValue({
      mode: 'direct',
      downloadUrl: 'https://api.example.com/api/download/merge?video=test',
      fileExtension: 'mp4',
      fileName: '测试视频',
      quality: '1080p',
      platform: 'bilibili',
      authPolicy: 'bearer',
      runtimeTraceId: 'rt-download',
    });

    const req = {
      user: { id: 'user-1' },
      protocol: 'https',
      get: () => 'api.example.com',
      headers: {
        'x-runtime-trace-id': 'rt-download',
      },
    } as any;

    const result = await controller.prepareNativeSilentDownload(
      {
        sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        clientType: 'MOBILE',
      } as any,
      req,
    );

    expect(downloadService.prepareNativeSilentDownload).toHaveBeenCalledWith({
      userId: 'user-1',
      sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      clientType: 'MOBILE',
      runtimeTraceId: 'rt-download',
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        mode: 'direct',
        authPolicy: 'bearer',
      }),
    });
  });

  it('prepares a native silent download task payload for high-quality youtube background engine', async () => {
    downloadService.prepareNativeSilentDownload.mockResolvedValue({
      mode: 'serverTask',
      taskId: 'task-1',
      pollIntervalMs: 1200,
      fileName: 'YouTube 视频',
      quality: '4k',
      platform: 'youtube',
      authPolicy: 'bearer',
      runtimeTraceId: 'rt-youtube',
    });

    const req = {
      user: { id: 'user-1' },
      protocol: 'https',
      get: () => 'api.example.com',
    } as any;

    const result = await controller.prepareNativeSilentDownload(
      {
        sourceUrl: 'https://www.youtube.com/watch?v=test',
        clientType: 'MOBILE',
      } as any,
      req,
    );

    expect(downloadService.prepareNativeSilentDownload).toHaveBeenCalledWith({
      userId: 'user-1',
      sourceUrl: 'https://www.youtube.com/watch?v=test',
      clientType: 'MOBILE',
      runtimeTraceId: null,
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        mode: 'serverTask',
        taskId: 'task-1',
        authPolicy: 'bearer',
      }),
    });
  });

  it('uses forwarded host headers when normalizing api download urls', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({ allowed: true });
    downloadService.getDownloadUrl.mockResolvedValue({
      downloadUrl: '/api/download/tasks/task-1/file',
      format: 'mp4',
      quality: '1080p',
      fileExtension: 'mp4',
    });
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      clientType: 'WEB',
      mode: 'SPEED_FIRST',
      source: 'database',
      iosCompatible: false,
      allowWatermarkFallback: true,
      probeMode: 'fast',
    });

    const req = {
      user: { id: 'user-1' },
      protocol: 'http',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'open.example.com',
      },
      get: jest.fn((name: string) => {
        if (name === 'host') {
          return 'localhost:3001';
        }
        return undefined;
      }),
    } as any;

    const result = await controller.getDownloadUrl(
      {
        videoInfo: JSON.stringify({
          title: 't',
          platform: 'douyin',
          videoUrl: 'https://example.com/source.mp4',
        }),
        clientType: 'WEB',
        format: 'mp4',
        quality: '1080p',
      } as any,
      req,
    );

    expect(downloadService.checkDownloadPermission).toHaveBeenCalledWith({
      userId: 'user-1',
      platform: 'douyin',
      quality: '1080p',
      entryType: 'get-url',
    });
    expect(result.data.downloadUrl).toBe('https://open.example.com/api/download/tasks/task-1/file');
  });

  it('keeps relative api download urls when request host and public origin are both unavailable', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({ allowed: true });
    downloadService.getDownloadUrl.mockResolvedValue({
      downloadUrl: '/api/download/tasks/task-2/file',
      format: 'mp4',
      quality: '1080p',
      fileExtension: 'mp4',
    });
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      clientType: 'WEB',
      mode: 'SPEED_FIRST',
      source: 'database',
      iosCompatible: false,
      allowWatermarkFallback: true,
      probeMode: 'fast',
    });

    const originalEnv = process.env.PUBLIC_API_ORIGIN;
    delete process.env.PUBLIC_API_ORIGIN;

    try {
      const req = {
        user: { id: 'user-1' },
        protocol: 'http',
      } as any;

      const result = await controller.getDownloadUrl(
        {
          videoInfo: JSON.stringify({
            title: 't',
            platform: 'douyin',
            videoUrl: 'https://example.com/source.mp4',
          }),
          clientType: 'WEB',
          format: 'mp4',
          quality: '1080p',
        } as any,
        req,
      );

      expect(result.data.downloadUrl).toBe('/api/download/tasks/task-2/file');
    } finally {
      process.env.PUBLIC_API_ORIGIN = originalEnv;
    }
  });

  it('does not report auth failure when membership gate denies getDownloadUrl', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({
      allowed: false,
      code: 'QUALITY_LIMIT_FOR_FREE',
      message: '免费用户仅支持 720p',
    });

    const req = {
      user: { id: 'user-1' },
      protocol: 'http',
      get: () => 'localhost:3001',
    } as any;

    await expect(
      controller.getDownloadUrl(
        {
          videoInfo: JSON.stringify({
            title: 't',
            platform: 'douyin',
            videoUrl: 'https://example.com/source.mp4',
          }),
          clientType: 'WEB',
          format: 'mp4',
          quality: '1080p',
        } as any,
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authHealthService.reportParseFailure).not.toHaveBeenCalled();
    expect(authHealthService.reportParseSuccess).not.toHaveBeenCalled();
  });

  it('does not report auth failure when getDownloadUrl throws generic upstream error', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({ allowed: true });
    downloadModeService.resolveGetUrlPolicy.mockResolvedValue({
      clientType: 'WEB',
      mode: 'SPEED_FIRST',
      source: 'database',
      iosCompatible: false,
      allowWatermarkFallback: true,
      probeMode: 'fast',
    });
    downloadService.getDownloadUrl.mockRejectedValue(new Error('下载链接获取失败'));

    const req = {
      user: { id: 'user-1' },
      protocol: 'http',
      get: () => 'localhost:3001',
    } as any;

    await expect(
      controller.getDownloadUrl(
        {
          videoInfo: JSON.stringify({
            title: 't',
            platform: 'douyin',
            videoUrl: 'https://example.com/source.mp4',
          }),
          clientType: 'WEB',
          format: 'mp4',
          quality: '1080p',
        } as any,
        req,
      ),
    ).rejects.toThrow('下载链接获取失败');

    expect(authHealthService.reportParseFailure).not.toHaveBeenCalled();
    expect(authHealthService.reportParseSuccess).not.toHaveBeenCalled();
  });

  it('checks membership gate before creating async download task', async () => {
    downloadService.checkDownloadPermission.mockResolvedValue({ allowed: true });
    downloadService.createDownloadTask.mockResolvedValue({
      id: 'task-1',
      status: 'queued',
      progress: 0,
    });

    const req = {
      user: { id: 'user-1' },
    } as any;

    const result = await controller.createDownloadTask(
      {
        sourceUrl: 'https://youtube.com/watch?v=test',
        videoInfo: JSON.stringify({
          title: 'yt',
          platform: 'youtube',
          videoUrl: 'https://example.com/source.mp4',
        }),
        format: 'mp4',
        quality: '1080p',
      } as any,
      req,
    );

    expect(downloadService.checkDownloadPermission).toHaveBeenCalledWith({
      userId: 'user-1',
      platform: 'youtube',
      quality: '1080p',
      entryType: 'create-task',
    });
    expect(downloadService.createDownloadTask).toHaveBeenCalledWith(
      'user-1',
      'https://youtube.com/watch?v=test',
      expect.any(String),
      'mp4',
      '1080p',
      null,
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: 'task-1',
        status: 'queued',
        progress: 0,
      },
    });
  });


  it('queries download history with platform and date filters', async () => {
    downloadService.queryDownloadHistory.mockResolvedValue({
      items: [
        { id: 'h1', userId: 'user-1', createdAt: new Date() },
      ],
      total: 1,
    });

    const req = {
      user: { id: 'user-1' },
    } as any;

    const result = await controller.getDownloadHistory(
      req,
      {
        limit: '20',
        offset: '0',
        platform: 'douyin',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        includeStats: 'false',
      } as any,
    );

    expect(downloadService.queryDownloadHistory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        limit: 20,
        offset: 0,
        platform: 'douyin',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        meta: expect.objectContaining({
          total: 1,
        }),
      }),
    );
  });

  it('clears all history by filters for current user', async () => {
    downloadService.clearDownloadHistory.mockResolvedValue(3);
    const req = {
      user: { id: 'user-1' },
    } as any;

    const result = await controller.clearDownloadHistory(
      req,
      {
        platform: 'bilibili',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      } as any,
    );

    expect(downloadService.clearDownloadHistory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        platform: 'bilibili',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        affected: 3,
      },
    });
  });

  it('deletes selected histories by ids for current user', async () => {
    downloadService.deleteDownloadHistories.mockResolvedValue(2);
    const req = {
      user: { id: 'user-1' },
    } as any;

    const result = await controller.deleteDownloadHistories(
      req,
      { ids: ['a', 'b', 'c'] } as any,
    );

    expect(downloadService.deleteDownloadHistories).toHaveBeenCalledWith(
      'user-1',
      ['a', 'b', 'c'],
    );
    expect(result).toEqual({
      success: true,
      data: {
        affected: 2,
      },
    });
  });
});
