import { AuthHealthView } from '../auth-health/auth-health.service';
import { RuntimeFeatureEvent } from './entities/runtime-feature-event.entity';
import { RuntimeMonitorService } from './runtime-monitor.service';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

const createMockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

const createAuthHealthView = (
  platform: 'bilibili' | 'douyin',
  status: AuthHealthView['status'],
): AuthHealthView => ({
  platform,
  status,
  consecutiveFailures: status === 'healthy' ? 0 : 2,
  lastError: status === 'healthy' ? null : `${platform} auth degraded`,
  lastCheckedAt: '2026-03-20T08:00:00.000Z',
  lastSuccessAt: '2026-03-20T07:30:00.000Z',
  lastFailureAt: status === 'healthy' ? null : '2026-03-20T07:55:00.000Z',
});

describe('RuntimeMonitorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-20T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('deduplicates client events by eventKey', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'existing',
      eventKey: 'preview:web:attempt-1',
    });
    repo.save.mockImplementation(async (payload) => payload);

    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      {
        getHealthStatus: jest.fn(),
      } as any,
    );

    const created = await service.recordClientEvent({
      feature: 'preview',
      clientType: 'WEB',
      platform: 'douyin',
      outcome: 'success',
      latencyMs: 1200,
      eventKey: 'preview:web:attempt-1',
    });
    const duplicate = await service.recordClientEvent({
      feature: 'preview',
      clientType: 'WEB',
      platform: 'douyin',
      outcome: 'success',
      latencyMs: 1250,
      eventKey: 'preview:web:attempt-1',
    });

    expect(created).toEqual({ accepted: true, duplicate: false });
    expect(duplicate).toEqual({ accepted: true, duplicate: true });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'preview',
        clientType: 'WEB',
        platform: 'douyin',
        outcome: 'success',
        eventKey: 'preview:web:attempt-1',
      }),
    );
  });

  it('persists preview runtime context for candidate selection and failover analysis', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    repo.findOne.mockResolvedValueOnce(null);
    repo.save.mockImplementation(async (payload) => payload);

    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      {
        getHealthStatus: jest.fn(),
      } as any,
    );

    await service.recordClientEvent({
      feature: 'preview',
      clientType: 'MOBILE',
      platform: 'bilibili',
      outcome: 'success',
      latencyMs: 980,
      eventKey: 'preview:mobile:bilibili:ready-1',
      candidateCount: 4,
      selectedCandidateIndex: 1,
      failoverCount: 1,
      selectedCandidateKind: 'merged',
      selectedQuality: '720p',
    } as any);

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 4,
        selectedCandidateIndex: 1,
        failoverCount: 1,
        selectedCandidateKind: 'merged',
        selectedQuality: '720p',
      }),
    );
  });

  it('aggregates dashboard metrics, top errors and warnings', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    const authHealthService = {
      getHealthStatus: jest.fn().mockResolvedValue({
        checkedAt: '2026-03-20T10:00:00.000Z',
        platforms: {
          bilibili: createAuthHealthView('bilibili', 'degraded'),
          douyin: createAuthHealthView('douyin', 'healthy'),
        },
      }),
    };

    const recentParseEvents = Array.from({ length: 20 }, (_, index) => ({
      id: `parse-${index + 1}`,
      feature: 'parse',
      clientType: index < 14 ? 'WEB' : 'MOBILE',
      platform: index < 15 ? 'douyin' : 'bilibili',
      outcome: index < 18 ? 'success' : 'failure',
      latencyMs: index >= 18 ? 9100 + (index - 18) * 100 : 1400 + index * 10,
      errorCode: index === 18 ? 'DOUYIN_PARSE_FAILED' : index === 19 ? 'BILIBILI_PARSE_FAILED' : null,
      eventKey: null,
      createdAt: new Date(`2026-03-20T09:${String(index).padStart(2, '0')}:00.000Z`),
    })) satisfies Partial<RuntimeFeatureEvent>[];

    const recentPreviewEvents = Array.from({ length: 20 }, (_, index) => ({
      id: `preview-${index + 1}`,
      feature: 'preview',
      clientType: index < 12 ? 'WEB' : 'MOBILE',
      platform: index < 10 ? 'douyin' : 'youtube',
      outcome: 'success',
      latencyMs: index >= 18 ? 11000 + (index - 18) * 200 : 1800 + index * 50,
      errorCode: null,
      eventKey: `preview-${index + 1}`,
      createdAt: new Date(`2026-03-20T09:${String(index).padStart(2, '0')}:30.000Z`),
    })) satisfies Partial<RuntimeFeatureEvent>[];

    const recentDownloadEvents = Array.from({ length: 10 }, (_, index) => ({
      id: `download-${index + 1}`,
      feature: 'download',
      clientType: index < 6 ? 'WEB' : 'MOBILE',
      platform: index < 8 ? 'bilibili' : 'douyin',
      outcome: index < 8 ? 'success' : 'failure',
      latencyMs: index === 9 ? 98000 : 32000 + index * 2500,
      errorCode: index < 8 ? null : 'DOWNLOAD_TIMEOUT',
      eventKey: `download-${index + 1}`,
      createdAt: new Date(`2026-03-20T09:${String(index).padStart(2, '0')}:45.000Z`),
    })) satisfies Partial<RuntimeFeatureEvent>[];

    repo.find
      .mockResolvedValueOnce([
        ...recentParseEvents,
        ...recentPreviewEvents,
        ...recentDownloadEvents,
        {
          id: 'older-preview',
          feature: 'preview',
          clientType: 'WEB',
          platform: 'douyin',
          outcome: 'failure',
          latencyMs: 2500,
          errorCode: 'PREVIEW_BOOT_FAILED',
          eventKey: 'older-preview',
          createdAt: new Date('2026-03-19T16:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        ...recentParseEvents,
        ...recentPreviewEvents,
        ...recentDownloadEvents,
      ]);

    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      authHealthService as any,
    );

    const dashboard = await service.getRuntimeDashboard('24h');

    expect(dashboard.window).toBe('24h');
    expect(dashboard.summary.parse).toEqual(
      expect.objectContaining({
        total: 20,
        failureCount: 2,
        successRate: 90,
        p95LatencyMs: 9100,
      }),
    );
    expect(dashboard.summary.preview).toEqual(
      expect.objectContaining({
        total: 21,
        failureCount: 1,
      }),
    );
    expect(dashboard.summary.download).toEqual(
      expect.objectContaining({
        total: 10,
        failureCount: 2,
        successRate: 80,
        p95LatencyMs: 98000,
      }),
    );
    expect(dashboard.byClient).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientType: 'WEB',
          features: expect.objectContaining({
            parse: expect.objectContaining({ total: 14 }),
          }),
        }),
        expect.objectContaining({
          clientType: 'MOBILE',
          features: expect.objectContaining({
            download: expect.objectContaining({ total: 4 }),
          }),
        }),
      ]),
    );
    expect(dashboard.topErrors[0]).toEqual(
      expect.objectContaining({
        errorCode: 'DOWNLOAD_TIMEOUT',
        feature: 'download',
        count: 2,
      }),
    );
    expect(dashboard.authHealth.platforms.bilibili.status).toBe('degraded');
    expect(dashboard.trends.parse).toHaveLength(24);
    expect(dashboard.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'parse',
          severity: 'warning',
        }),
        expect.objectContaining({
          source: 'preview',
          severity: 'warning',
        }),
        expect.objectContaining({
          source: 'download',
          severity: 'critical',
        }),
        expect.objectContaining({
          source: 'auth',
          severity: 'warning',
          actionTab: 'auth',
        }),
      ]),
    );
  });

  it('builds hourly and daily trend buckets with zero-filled gaps', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    const authHealthService = {
      getHealthStatus: jest.fn().mockResolvedValue({
        checkedAt: '2026-03-20T10:00:00.000Z',
        platforms: {
          bilibili: createAuthHealthView('bilibili', 'healthy'),
          douyin: createAuthHealthView('douyin', 'healthy'),
        },
      }),
    };

    const hourlyEvents = [
      {
        id: 'parse-1',
        feature: 'parse',
        clientType: 'WEB',
        platform: 'douyin',
        outcome: 'success',
        latencyMs: 1400,
        errorCode: null,
        eventKey: null,
        createdAt: new Date('2026-03-20T09:05:00.000Z'),
      },
      {
        id: 'parse-2',
        feature: 'parse',
        clientType: 'WEB',
        platform: 'douyin',
        outcome: 'failure',
        latencyMs: 8900,
        errorCode: 'DOUYIN_PARSE_FAILED',
        eventKey: null,
        createdAt: new Date('2026-03-20T09:35:00.000Z'),
      },
      {
        id: 'download-1',
        feature: 'download',
        clientType: 'MOBILE',
        platform: 'bilibili',
        outcome: 'success',
        latencyMs: 42000,
        errorCode: null,
        eventKey: 'download-1',
        createdAt: new Date('2026-03-20T08:10:00.000Z'),
      },
    ] satisfies Partial<RuntimeFeatureEvent>[];

    const dailyEvents = [
      {
        id: 'preview-1',
        feature: 'preview',
        clientType: 'WEB',
        platform: 'youtube',
        outcome: 'success',
        latencyMs: 2400,
        errorCode: null,
        eventKey: 'preview-1',
        createdAt: new Date('2026-03-18T12:00:00.000Z'),
      },
      {
        id: 'preview-2',
        feature: 'preview',
        clientType: 'WEB',
        platform: 'youtube',
        outcome: 'failure',
        latencyMs: 6400,
        errorCode: 'PREVIEW_READY_FAILED',
        eventKey: 'preview-2',
        createdAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    ] satisfies Partial<RuntimeFeatureEvent>[];

    repo.find
      .mockResolvedValueOnce(hourlyEvents)
      .mockResolvedValueOnce(hourlyEvents)
      .mockResolvedValueOnce(dailyEvents)
      .mockResolvedValueOnce(dailyEvents);

    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      authHealthService as any,
    );

    const hourlyDashboard = await service.getRuntimeDashboard('24h');
    const dailyDashboard = await service.getRuntimeDashboard('7d');

    expect(hourlyDashboard.trends.parse).toHaveLength(24);
    expect(hourlyDashboard.trends.parse.at(-1)).toEqual(
      expect.objectContaining({
        bucketStart: '2026-03-20T09:00:00.000Z',
        total: 2,
        successRate: 50,
        p95LatencyMs: 8900,
      }),
    );
    expect(hourlyDashboard.trends.preview.at(-1)).toEqual(
      expect.objectContaining({
        bucketStart: '2026-03-20T09:00:00.000Z',
        total: 0,
        successRate: 0,
      }),
    );
    expect(dailyDashboard.trends.preview).toHaveLength(7);
    expect(dailyDashboard.trends.preview.at(-3)).toEqual(
      expect.objectContaining({
        bucketLabel: '03-18',
        total: 1,
        successRate: 100,
      }),
    );
    expect(dailyDashboard.trends.preview.at(-1)).toEqual(
      expect.objectContaining({
        bucketLabel: '03-20',
        total: 1,
        successRate: 0,
      }),
    );
  });

  it('cleans up expired runtime events', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      {
        getHealthStatus: jest.fn(),
      } as any,
    );

    await service.cleanupExpiredEvents();

    expect(repo.delete).toHaveBeenCalledWith({
      createdAt: expect.anything(),
    });
    expect(interfaceRepo.delete).toHaveBeenCalledWith({
      createdAt: expect.anything(),
    });
  });

  it('builds runtime chains and chain detail by trace id', async () => {
    const repo = createMockRepo();
    const interfaceRepo = createMockRepo();
    const authHealthService = {
      getHealthStatus: jest.fn().mockResolvedValue({
        checkedAt: '2026-03-20T10:00:00.000Z',
        platforms: {
          bilibili: createAuthHealthView('bilibili', 'healthy'),
          douyin: createAuthHealthView('douyin', 'healthy'),
        },
      }),
    };

    interfaceRepo.find
      .mockResolvedValueOnce([
        {
          traceId: 'trace-1',
          taskId: null,
          platform: 'douyin',
          clientType: 'WEB',
          stage: 'parse',
          interfaceName: 'download.parse',
          outcome: 'success',
          latencyMs: 230,
          errorCode: null,
          createdAt: new Date('2026-03-20T09:00:00.000Z'),
        },
        {
          traceId: 'trace-1',
          taskId: null,
          platform: 'douyin',
          clientType: 'WEB',
          stage: 'download',
          interfaceName: 'upstream.ffmpeg_merge',
          outcome: 'success',
          latencyMs: 640,
          errorCode: 'NONE',
          createdAt: new Date('2026-03-20T09:00:01.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          traceId: 'trace-1',
          taskId: null,
          platform: 'douyin',
          clientType: 'WEB',
          stage: 'parse',
          interfaceName: 'download.parse',
          outcome: 'success',
          latencyMs: 230,
          errorCode: null,
          createdAt: new Date('2026-03-20T09:00:00.000Z'),
        },
        {
          traceId: 'trace-1',
          taskId: null,
          platform: 'douyin',
          clientType: 'WEB',
          stage: 'download',
          interfaceName: 'upstream.ffmpeg_merge',
          outcome: 'success',
          latencyMs: 640,
          errorCode: 'NONE',
          createdAt: new Date('2026-03-20T09:00:01.000Z'),
        },
      ]);

    repo.find
      .mockResolvedValueOnce([
        {
          feature: 'parse',
          clientType: 'WEB',
          platform: 'douyin',
          outcome: 'success',
          latencyMs: 410,
          traceId: 'trace-1',
          eventKey: 'parse-1',
          createdAt: new Date('2026-03-20T09:00:00.100Z'),
        },
        {
          feature: 'preview',
          clientType: 'WEB',
          platform: 'douyin',
          outcome: 'success',
          latencyMs: 810,
          traceId: 'trace-1',
          eventKey: 'preview-1',
          createdAt: new Date('2026-03-20T09:00:00.600Z'),
        },
        {
          feature: 'download',
          clientType: 'MOBILE',
          platform: 'douyin',
          outcome: 'failure',
          latencyMs: 1200,
          errorCode: 'IOS_PHOTOS_INCOMPATIBLE_CODEC',
          traceId: 'trace-1',
          eventKey: 'download-1',
          createdAt: new Date('2026-03-20T09:00:02.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          feature: 'parse',
          clientType: 'WEB',
          platform: 'douyin',
          outcome: 'success',
          latencyMs: 410,
          traceId: 'trace-1',
          eventKey: 'parse-1',
          createdAt: new Date('2026-03-20T09:00:00.100Z'),
        },
        {
          feature: 'preview',
          clientType: 'WEB',
          platform: 'douyin',
          outcome: 'success',
          latencyMs: 810,
          traceId: 'trace-1',
          eventKey: 'preview-1',
          createdAt: new Date('2026-03-20T09:00:00.600Z'),
        },
        {
          feature: 'download',
          clientType: 'MOBILE',
          platform: 'douyin',
          outcome: 'failure',
          latencyMs: 1200,
          errorCode: 'IOS_PHOTOS_INCOMPATIBLE_CODEC',
          traceId: 'trace-1',
          eventKey: 'download-1',
          createdAt: new Date('2026-03-20T09:00:02.000Z'),
        },
      ]);

    const service = new RuntimeMonitorService(
      repo as any,
      interfaceRepo as any,
      authHealthService as any,
    );

    const chains = await service.getRuntimeChains({
      window: 'today',
      platform: 'douyin',
      limit: 5,
    });
    const detail = await service.getRuntimeChainDetail('trace-1');

    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual(
      expect.objectContaining({
        traceId: 'trace-1',
        hasFailure: true,
        interfaceLatencyMs: 870,
        clientLatencyMs: 2420,
        combinedLatencyMs: 3290,
        parseToPreviewReadyMs: 500,
        stageCounts: expect.objectContaining({
          parse: 2,
          preview: 1,
          download: 2,
        }),
      }),
    );

    expect(detail).toEqual(
      expect.objectContaining({
        traceId: 'trace-1',
        hasFailure: true,
        interfaceLatencyMs: 870,
        clientLatencyMs: 2420,
        combinedLatencyMs: 3290,
        parseToPreviewReadyMs: 500,
        stages: expect.objectContaining({
          parse: expect.arrayContaining([
            expect.objectContaining({
              interfaceName: 'client.parse',
              source: 'client',
            }),
            expect.objectContaining({
              interfaceName: 'download.parse',
              source: 'interface',
            }),
          ]),
          preview: expect.arrayContaining([
            expect.objectContaining({
              interfaceName: 'client.preview',
              source: 'client',
            }),
          ]),
          download: expect.arrayContaining([
            expect.objectContaining({
              interfaceName: 'upstream.ffmpeg_merge',
              source: 'interface',
              errorCode: null,
            }),
            expect.objectContaining({
              interfaceName: 'client.download',
              source: 'client',
              outcome: 'failure',
            }),
          ]),
        }),
      }),
    );

    expect(
      detail.stages.download.map((step) => ({
        interfaceName: step.interfaceName,
        source: step.source,
      })),
    ).toEqual([
      {
        interfaceName: 'client.download',
        source: 'client',
      },
      {
        interfaceName: 'upstream.ffmpeg_merge',
        source: 'interface',
      },
    ]);
  });
});
