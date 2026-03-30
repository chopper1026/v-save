import { DouyinAuthService } from './douyin-auth.service';
import { DouyinAuthSession } from './entities/douyin-auth-session.entity';
import { UserAdminAuditLog } from '../admin/entities/user-admin-audit-log.entity';

describe('DouyinAuthService', () => {
  const originalEnv = process.env;

  const createRepositoryMock = () => {
    const transactionSessionRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (payload) => payload),
      create: jest.fn((payload) => payload),
    };
    const transactionAuditRepository = {
      save: jest.fn(async (payload) => payload),
      create: jest.fn((payload) => payload),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === DouyinAuthSession) {
          return transactionSessionRepository;
        }
        if (entity === UserAdminAuditLog) {
          return transactionAuditRepository;
        }
        throw new Error(`Unexpected repository request: ${entity?.name}`);
      }),
      transaction: jest.fn(async (handler) => handler(manager)),
    };

    return {
      findOne: jest.fn(),
      save: jest.fn(async (payload) => payload),
      create: jest.fn((payload) => payload),
      delete: jest.fn(async () => ({ affected: 1 })),
      manager,
      __tx: {
        sessionRepository: transactionSessionRepository,
        auditRepository: transactionAuditRepository,
      },
    };
  };

  const createBridgeAuthServiceMock = () => ({
    createSession: jest.fn(),
    getSession: jest.fn(),
    completeSession: jest.fn(),
    prepareSessionCompletion: jest.fn(),
    assertSessionCanBeCompleted: jest.fn(),
    markSessionCompleted: jest.fn(),
    invalidateActiveSessions: jest.fn(async () => undefined),
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads cookie from environment when database session is missing', async () => {
    process.env.DOUYIN_COOKIE = 'sessionid=abc; ttwid=xyz;';
    const repository = createRepositoryMock();
    repository.findOne.mockResolvedValue(null);

    const service = new DouyinAuthService(
      repository as any,
      createBridgeAuthServiceMock() as any,
    );
    const status = await service.getStatus();

    expect(status.source).toBe('environment');
    expect(status.hasCookie).toBe(true);
    expect(status.cookiePreview).toBeNull();
  });

  it('saves cookie into database session and exposes database source', async () => {
    const repository = createRepositoryMock();
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'session-1',
        platform: 'douyin',
        cookie: 'sessionid=saved; ttwid=saved;',
        lastError: null,
        lastCheckAt: new Date('2026-03-15T09:00:00.000Z'),
        updatedAt: new Date('2026-03-15T09:00:00.000Z'),
      } as DouyinAuthSession);

    const service = new DouyinAuthService(
      repository as any,
      createBridgeAuthServiceMock() as any,
    );
    await service.saveCookie('sessionid=saved; ttwid=saved; path=/');

    const status = await service.getStatus();

    expect(
      (service as any).bridgeAuthService.invalidateActiveSessions,
    ).toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalled();
    expect(status.source).toBe('database');
    expect(status.hasCookie).toBe(true);
  });

  it('clears saved session and active bridge sessions', async () => {
    const repository = createRepositoryMock();
    const service = new DouyinAuthService(
      repository as any,
      createBridgeAuthServiceMock() as any,
    );

    await service.clearSession();

    expect(
      (service as any).bridgeAuthService.invalidateActiveSessions,
    ).toHaveBeenCalled();
    expect(repository.delete).toHaveBeenCalledWith({ platform: 'douyin' });
  });

  it('starts bridge auth and returns helper-facing payload', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    bridgeAuthService.createSession.mockResolvedValue({
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      expiresAt: '2026-03-23T06:10:00.000Z',
    });

    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(service.startBridgeAuth()).resolves.toEqual({
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      expiresAt: '2026-03-23T06:10:00.000Z',
      status: 'waiting_helper',
      loginUrl: 'https://www.douyin.com/',
    });
    expect(bridgeAuthService.createSession).toHaveBeenCalledWith({
      initiatedByAdminUserId: undefined,
      initiatedByAdminEmail: undefined,
    });
  });

  it('passes initiating admin identity into bridge session creation', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    bridgeAuthService.createSession.mockResolvedValue({
      authSessionId: 'bridge-1',
      uploadToken: 'upload-token',
      expiresAt: '2026-03-23T06:10:00.000Z',
    });

    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await service.startBridgeAuth({
      adminUserId: 'admin-1',
      adminEmail: 'admin@example.com',
    });

    expect(bridgeAuthService.createSession).toHaveBeenCalledWith({
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });
  });

  it('maps bridge session state for status polling', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    bridgeAuthService.getSession.mockResolvedValue({
      id: 'bridge-1',
      status: 'completed',
      expireAt: new Date('2026-03-23T06:10:00.000Z'),
      completedAt: new Date('2026-03-23T06:02:00.000Z'),
      lastError: null,
    });

    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(service.getBridgeAuthStatus('bridge-1')).resolves.toEqual({
      authSessionId: 'bridge-1',
      status: 'confirmed',
      expiresAt: '2026-03-23T06:10:00.000Z',
      completedAt: '2026-03-23T06:02:00.000Z',
      lastError: null,
    });
  });

  it('completes bridge auth after validating token and reuses saveCookie', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    const preparedSession = {
      id: 'bridge-1',
      status: 'pending',
      activeKey: 'active',
      uploadTokenHash: 'hash',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      lastError: null,
      expireAt: new Date('2026-03-23T06:10:00.000Z'),
      completedAt: null,
    };
    bridgeAuthService.prepareSessionCompletion.mockResolvedValue({
      authSessionId: 'bridge-1',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      session: preparedSession,
    });
    bridgeAuthService.markSessionCompleted.mockResolvedValue({
      authSessionId: 'bridge-1',
      status: 'completed',
      completedAt: '2026-03-23T06:02:00.000Z',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });

    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'bridge-1',
        uploadToken: 'upload-token',
        cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
      }),
    ).resolves.toEqual({
      authSessionId: 'bridge-1',
      status: 'confirmed',
      completedAt: '2026-03-23T06:02:00.000Z',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });

    expect(bridgeAuthService.prepareSessionCompletion).toHaveBeenCalledWith(
      {
        authSessionId: 'bridge-1',
        uploadToken: 'upload-token',
      },
      expect.objectContaining({
        manager: repository.manager,
        lock: true,
      }),
    );
    expect(bridgeAuthService.markSessionCompleted).toHaveBeenCalledWith(
      'bridge-1',
      expect.objectContaining({
        manager: repository.manager,
      }),
    );
    expect(repository.__tx.sessionRepository.save).toHaveBeenCalled();
    expect(repository.__tx.auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'DOUYIN_BRIDGE_AUTH_CONFIRMED',
      }),
    );
  });

  it('rejects bridge auth completion when cookieHeader is not a logged-in douyin cookie', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'bridge-1',
        uploadToken: 'upload-token',
        cookieHeader: 'ttwid=helper-only;',
      }),
    ).rejects.toThrow('缺少有效的抖音登录 Cookie');

    expect(bridgeAuthService.prepareSessionCompletion).not.toHaveBeenCalled();
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });

  it('keeps bridge completion retryable when cookie save fails before finalization', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    const preparedSession = {
      id: 'bridge-1',
      status: 'pending',
      activeKey: 'active',
      uploadTokenHash: 'hash',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      lastError: null,
      expireAt: new Date('2026-03-23T06:10:00.000Z'),
      completedAt: null,
    };
    bridgeAuthService.prepareSessionCompletion.mockResolvedValue({
      authSessionId: 'bridge-1',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      session: preparedSession,
    });
    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );
    repository.__tx.sessionRepository.save.mockRejectedValue(new Error('save failed'));

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'bridge-1',
        uploadToken: 'upload-token',
        cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
      }),
    ).rejects.toThrow('save failed');

    expect(bridgeAuthService.markSessionCompleted).not.toHaveBeenCalled();
    expect(repository.__tx.auditRepository.save).not.toHaveBeenCalled();
  });

  it('keeps bridge completion retryable when a newer session has replaced the prepared one', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    bridgeAuthService.prepareSessionCompletion.mockRejectedValue(
      new Error('桥接登录会话不可用，请重新发起'),
    );
    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'bridge-old',
        uploadToken: 'upload-token',
        cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
      }),
    ).rejects.toThrow('桥接登录会话不可用，请重新发起');

    expect(repository.__tx.sessionRepository.save).not.toHaveBeenCalled();
    expect(repository.__tx.auditRepository.save).not.toHaveBeenCalled();
    expect(bridgeAuthService.markSessionCompleted).not.toHaveBeenCalled();
  });

  it('does not persist any auth state when bridge completion token validation fails', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    bridgeAuthService.prepareSessionCompletion.mockRejectedValue(
      new Error('桥接登录会话不存在，请重新发起'),
    );
    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'missing-session',
        uploadToken: 'bad-token',
        cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
      }),
    ).rejects.toThrow('桥接登录会话不存在，请重新发起');

    expect(repository.__tx.sessionRepository.save).not.toHaveBeenCalled();
    expect(repository.__tx.auditRepository.save).not.toHaveBeenCalled();
    expect(bridgeAuthService.markSessionCompleted).not.toHaveBeenCalled();
  });

  it('keeps bridge completion successful without any post-commit qrcode cleanup dependency', async () => {
    const repository = createRepositoryMock();
    const bridgeAuthService = createBridgeAuthServiceMock();
    const preparedSession = {
      id: 'bridge-1',
      status: 'pending',
      activeKey: 'active',
      uploadTokenHash: 'hash',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      lastError: null,
      expireAt: new Date('2026-03-23T06:10:00.000Z'),
      completedAt: null,
    };
    bridgeAuthService.prepareSessionCompletion.mockResolvedValue({
      authSessionId: 'bridge-1',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      session: preparedSession,
    });
    bridgeAuthService.markSessionCompleted.mockResolvedValue({
      authSessionId: 'bridge-1',
      status: 'completed',
      completedAt: '2026-03-23T06:02:00.000Z',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });
    const service = new DouyinAuthService(
      repository as any,
      bridgeAuthService as any,
    );

    await expect(
      service.completeBridgeAuth({
        authSessionId: 'bridge-1',
        uploadToken: 'upload-token',
        cookieHeader: 'sessionid=bridge-cookie; ttwid=helper;',
      }),
    ).resolves.toEqual({
      authSessionId: 'bridge-1',
      status: 'confirmed',
      completedAt: '2026-03-23T06:02:00.000Z',
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });

    expect(repository.__tx.sessionRepository.save).toHaveBeenCalled();
    expect(repository.__tx.auditRepository.save).toHaveBeenCalled();
    expect(bridgeAuthService.markSessionCompleted).toHaveBeenCalled();
  });
});
