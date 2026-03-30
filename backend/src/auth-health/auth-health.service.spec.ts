import { AuthHealthService } from './auth-health.service';

describe('AuthHealthService', () => {
  const createRepositoryMock = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((payload) => payload),
    save: jest.fn(async (payload) => payload),
  });

  const createNotificationsMock = () => ({
    createGlobal: jest.fn().mockResolvedValue(undefined),
    createForSuperAdmins: jest.fn().mockResolvedValue(undefined),
  });

  it('touches douyin session check time when periodic check is healthy', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const douyinAuthService = {
      getStatus: jest.fn().mockResolvedValue({
        hasCookie: true,
        lastError: null,
      }),
      getCookieHeader: jest.fn().mockResolvedValue('sessionid=abc; ttwid=xyz'),
      touchSessionCheckTime: jest.fn().mockResolvedValue(undefined),
      recordCheckError: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      douyinAuthService as any,
      notificationsService as any,
    );

    await (service as any).checkDouyin();

    expect(douyinAuthService.touchSessionCheckTime).toHaveBeenCalledTimes(1);
    expect(douyinAuthService.recordCheckError).not.toHaveBeenCalled();
  });

  it('records douyin session check error when required session cookie is missing', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const douyinAuthService = {
      getStatus: jest.fn().mockResolvedValue({
        hasCookie: true,
        lastError: null,
      }),
      getCookieHeader: jest.fn().mockResolvedValue('ttwid=xyz'),
      touchSessionCheckTime: jest.fn().mockResolvedValue(undefined),
      recordCheckError: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      douyinAuthService as any,
      notificationsService as any,
    );

    await (service as any).checkDouyin();

    expect(douyinAuthService.recordCheckError).toHaveBeenCalledWith(
      expect.stringContaining('sessionid'),
    );
    expect(douyinAuthService.touchSessionCheckTime).not.toHaveBeenCalled();
  });

  it('ignores non-auth parse failures', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await service.reportParseFailure('douyin', {
      category: 'upstream',
      code: 'QUALITY_LIMIT_FOR_FREE',
      message: '免费用户仅支持 720p',
    });

    expect(notificationsService.createForSuperAdmins).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('ignores generic upstream failures without auth signals', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await service.reportParseFailure('douyin', {
      category: 'upstream',
      code: 'PARSE_FAILED',
      message: '获取下载链接失败',
    });

    expect(notificationsService.createForSuperAdmins).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('maps douyin risk control failures to cookie risk notification', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await service.reportParseFailure('douyin', {
      category: 'risk_control',
      code: 'DOUYIN_RISK_CONTROL',
      message: '抖音触发风控',
    });

    expect(notificationsService.createForSuperAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COOKIE_RISK',
        source: 'auth',
        actionUrl: '/admin?tab=auth',
      }),
      expect.objectContaining({
        skipIfUnreadDedupKeyPrefix: 'auth-problem:douyin:COOKIE_RISK:',
      }),
    );
  });

  it('maps explicit auth expiry signals to cookie expired notification', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await service.reportParseFailure('douyin', {
      category: 'upstream',
      code: 'DOUYIN_SESSION_REQUIRED',
      message: 'session 已失效，请重新登录',
    });

    expect(notificationsService.createForSuperAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COOKIE_EXPIRED',
        source: 'auth',
        actionUrl: '/admin?tab=auth',
      }),
      expect.objectContaining({
        skipIfUnreadDedupKeyPrefix: 'auth-problem:douyin:COOKIE_EXPIRED:',
      }),
    );
  });

  it('sends auth failure notification to super admins with admin auth route', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await (service as any).markFailure(
      'douyin',
      '登录态异常',
      'degraded',
      'COOKIE_RISK',
    );

    expect(notificationsService.createForSuperAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COOKIE_RISK',
        source: 'auth',
        actionUrl: '/admin?tab=auth',
      }),
      expect.objectContaining({
        skipIfUnreadDedupKeyPrefix: 'auth-problem:douyin:COOKIE_RISK:',
      }),
    );
  });

  it('sends auth recovered notification to super admins with admin auth route', async () => {
    const repository = createRepositoryMock();
    const notificationsService = createNotificationsMock();

    const service = new AuthHealthService(
      repository as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    await (service as any).markHealthy('bilibili');

    expect(notificationsService.createForSuperAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUTH_RECOVERED',
        source: 'auth',
        actionUrl: '/admin?tab=auth',
      }),
    );
  });
});
