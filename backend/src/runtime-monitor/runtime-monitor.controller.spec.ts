import { AdminRuntimeDashboardController } from './runtime-dashboard.controller';
import { RuntimeClientEventsController } from './runtime-events.controller';

describe('RuntimeMonitor controllers', () => {
  const runtimeMonitorService = {
    getRuntimeDashboard: jest.fn(),
    getRuntimeChains: jest.fn(),
    getRuntimeChainDetail: jest.fn(),
    recordClientEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns admin runtime dashboard payload', async () => {
    runtimeMonitorService.getRuntimeDashboard.mockResolvedValue({
      window: 'today',
      summary: {
        parse: { total: 12 },
      },
    });

    const controller = new AdminRuntimeDashboardController(
      runtimeMonitorService as any,
    );
    const result = await controller.getDashboard({ window: '24h' } as any);

    expect(runtimeMonitorService.getRuntimeDashboard).toHaveBeenCalledWith('24h');
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        window: 'today',
      }),
    });
  });

  it('returns runtime chains for selected platform and window', async () => {
    runtimeMonitorService.getRuntimeChains.mockResolvedValue([
      {
        traceId: 'trace:demo',
        platform: 'douyin',
      },
    ]);

    const controller = new AdminRuntimeDashboardController(
      runtimeMonitorService as any,
    );
    const result = await controller.getChains({
      window: '7d',
      platform: 'douyin',
      limit: 10,
    } as any);

    expect(runtimeMonitorService.getRuntimeChains).toHaveBeenCalledWith({
      window: '7d',
      platform: 'douyin',
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          traceId: 'trace:demo',
        }),
      ],
    });
  });

  it('returns runtime chain detail by trace id', async () => {
    runtimeMonitorService.getRuntimeChainDetail.mockResolvedValue({
      traceId: 'trace:detail',
      stages: {
        parse: [],
        preview: [],
        download: [],
      },
    });

    const controller = new AdminRuntimeDashboardController(
      runtimeMonitorService as any,
    );
    const result = await controller.getChainDetail('trace:detail');

    expect(runtimeMonitorService.getRuntimeChainDetail).toHaveBeenCalledWith('trace:detail');
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        traceId: 'trace:detail',
      }),
    });
  });

  it('accepts client telemetry events', async () => {
    runtimeMonitorService.recordClientEvent.mockResolvedValue({
      accepted: true,
      duplicate: false,
    });

    const controller = new RuntimeClientEventsController(
      runtimeMonitorService as any,
    );
    const result = await controller.recordEvent({
      feature: 'download',
      clientType: 'MOBILE',
      platform: 'douyin',
      outcome: 'failure',
      latencyMs: 3420,
      errorCode: 'SAVE_FAILED',
      eventKey: 'download:mobile:test',
    } as any);

    expect(runtimeMonitorService.recordClientEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'download',
        clientType: 'MOBILE',
        platform: 'douyin',
        outcome: 'failure',
      }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        accepted: true,
        duplicate: false,
      },
    });
  });
});
