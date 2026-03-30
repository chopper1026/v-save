import { BadRequestException } from '@nestjs/common';
import { DouyinBridgeAuthService } from './douyin-bridge-auth.service';
import {
  DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
  DouyinBridgeAuthSession,
  DouyinBridgeAuthSessionStatus,
} from './entities/douyin-bridge-auth-session.entity';

describe('DouyinBridgeAuthService', () => {
  const createDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const flushPromises = () =>
    new Promise<void>((resolve) => setImmediate(resolve));

  const createRepositoryMock = () => ({
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(async () => ({ affected: 0 })),
    save: jest.fn(async (payload) => payload),
    create: jest.fn((payload) => payload),
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a bridge session with authSessionId, expiresAt, and uploadToken', async () => {
    const repository = createRepositoryMock();
    const service = new DouyinBridgeAuthService(repository as any);

    const result = await service.createSession({
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
    });

    expect(result.authSessionId).toBeTruthy();
    expect(result.uploadToken).toBeTruthy();
    expect(result.expiresAt).toEqual(expect.any(String));

    const savedSession = repository.save.mock.calls.at(-1)?.[0];
    expect(savedSession.status).toBe(DouyinBridgeAuthSessionStatus.Pending);
    expect(savedSession.activeKey).toBe(DOUYIN_BRIDGE_AUTH_ACTIVE_KEY);
    expect(savedSession.uploadTokenHash).toBeTruthy();
    expect(savedSession.initiatedByAdminUserId).toBe('admin-1');
    expect(savedSession.initiatedByAdminEmail).toBe('admin@example.com');
    expect(savedSession).not.toHaveProperty('cookie');
  });

  it('expires the previous active session when creating a new one', async () => {
    const repository = createRepositoryMock();
    const service = new DouyinBridgeAuthService(repository as any);

    await service.createSession();

    expect(repository.update).toHaveBeenCalledWith(
      {
        status: DouyinBridgeAuthSessionStatus.Pending,
        activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      },
      expect.objectContaining({
        status: DouyinBridgeAuthSessionStatus.Expired,
        activeKey: null,
        lastError: '已生成新的桥接登录会话，请使用最新上传令牌',
      }),
    );
  });

  it('hashes the upload token before persisting it', async () => {
    const repository = createRepositoryMock();
    const service = new DouyinBridgeAuthService(repository as any);

    const result = await service.createSession();

    const savedSession = repository.save.mock.calls.at(-1)?.[0];
    expect(savedSession.uploadTokenHash).toBeTruthy();
    expect(savedSession.uploadTokenHash).not.toBe(result.uploadToken);
    expect(savedSession.uploadTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serializes overlapping bridge session creation so the latest request wins cleanly', async () => {
    const repository = createRepositoryMock();
    const firstSave = createDeferred<any>();
    repository.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (payload) => payload);
    const service = new DouyinBridgeAuthService(repository as any);

    const firstRequest = service.createSession({
      initiatedByAdminUserId: 'admin-1',
    });
    await flushPromises();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);

    const secondRequest = service.createSession({
      initiatedByAdminUserId: 'admin-2',
    });
    await flushPromises();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);

    firstSave.resolve(repository.save.mock.calls[0][0]);
    await firstRequest;
    await secondRequest;

    expect(repository.update).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledTimes(2);
    const firstSavedSession = repository.save.mock.calls[0][0];
    const secondSavedSession = repository.save.mock.calls[1][0];
    expect(firstSavedSession.initiatedByAdminUserId).toBe('admin-1');
    expect(secondSavedSession.initiatedByAdminUserId).toBe('admin-2');
  });

  it('fails when completing an expired session', async () => {
    const repository = createRepositoryMock();
    repository.findOne.mockResolvedValue({
      id: 'expired-session',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash: 'a'.repeat(64),
      lastError: null,
      expireAt: new Date(Date.now() - 1_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession);
    const service = new DouyinBridgeAuthService(repository as any);

    await expect(
      service.completeSession({
        authSessionId: 'expired-session',
        uploadToken: 'plain-token',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const savedSession = repository.save.mock.calls.at(-1)?.[0];
    expect(savedSession.status).toBe(DouyinBridgeAuthSessionStatus.Expired);
    expect(savedSession.activeKey).toBeNull();
  });

  it('completes a valid session without persisting cookies', async () => {
    const repository = createRepositoryMock();
    repository.findOne.mockResolvedValue({
      id: 'session-1',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash:
        '23fb79e20d37abf2418d78115eb0cc8c74b52f4ed8b91dda7fc03a1d41fc15e3',
      lastError: null,
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      expireAt: new Date(Date.now() + 60_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession);
    const service = new DouyinBridgeAuthService(repository as any);

    const result = await service.completeSession({
      authSessionId: 'session-1',
      uploadToken: 'plain-token',
    });

    expect(result.status).toBe(DouyinBridgeAuthSessionStatus.Completed);
    expect(result.initiatedByAdminUserId).toBe('admin-1');
    expect(result.initiatedByAdminEmail).toBe('admin@example.com');
    const savedSession = repository.save.mock.calls.at(-1)?.[0];
    expect(savedSession.status).toBe(DouyinBridgeAuthSessionStatus.Completed);
    expect(savedSession.activeKey).toBeNull();
    expect(savedSession).not.toHaveProperty('cookie');
  });

  it('returns the current bridge session for status polling', async () => {
    const repository = createRepositoryMock();
    const session = {
      id: 'session-1',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash: 'a'.repeat(64),
      lastError: null,
      expireAt: new Date(Date.now() + 60_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession;
    repository.findOne.mockResolvedValue(session);
    const service = new DouyinBridgeAuthService(repository as any);

    await expect(service.getSession('session-1')).resolves.toBe(session);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('prepares a valid session completion without consuming the upload token', async () => {
    const repository = createRepositoryMock();
    const session = {
      id: 'session-1',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash:
        '23fb79e20d37abf2418d78115eb0cc8c74b52f4ed8b91dda7fc03a1d41fc15e3',
      lastError: null,
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      expireAt: new Date(Date.now() + 60_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession;
    repository.findOne.mockResolvedValue(session);
    const service = new DouyinBridgeAuthService(repository as any);

    const prepared = await service.prepareSessionCompletion({
      authSessionId: 'session-1',
      uploadToken: 'plain-token',
    });

    expect(prepared.authSessionId).toBe('session-1');
    expect(prepared.session).toBe(session);
    expect(prepared.initiatedByAdminUserId).toBe('admin-1');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('prevents an older prepared session from completing after a newer session replaces it', async () => {
    const repository = createRepositoryMock();
    const oldSession = {
      id: 'old-session',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash:
        '23fb79e20d37abf2418d78115eb0cc8c74b52f4ed8b91dda7fc03a1d41fc15e3',
      lastError: null,
      initiatedByAdminUserId: 'admin-1',
      initiatedByAdminEmail: 'admin@example.com',
      expireAt: new Date(Date.now() + 60_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession;
    repository.findOne
      .mockResolvedValueOnce(oldSession)
      .mockResolvedValueOnce({
        ...oldSession,
        status: DouyinBridgeAuthSessionStatus.Expired,
        activeKey: null,
      } as DouyinBridgeAuthSession);
    const service = new DouyinBridgeAuthService(repository as any);

    const prepared = await service.prepareSessionCompletion({
      authSessionId: 'old-session',
      uploadToken: 'plain-token',
    });

    await expect(
      service.markSessionCompleted(prepared.authSessionId as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expires a pending session when status is fetched after expiry', async () => {
    const repository = createRepositoryMock();
    const expiredSession = {
      id: 'expired-session',
      status: DouyinBridgeAuthSessionStatus.Pending,
      activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      uploadTokenHash: 'a'.repeat(64),
      lastError: null,
      expireAt: new Date(Date.now() - 1_000),
      completedAt: null,
    } as unknown as DouyinBridgeAuthSession;
    repository.findOne.mockResolvedValue(expiredSession);
    const service = new DouyinBridgeAuthService(repository as any);

    const result = await service.getSession('expired-session');

    expect(result).toBe(expiredSession);
    expect(expiredSession.status).toBe(DouyinBridgeAuthSessionStatus.Expired);
    expect(expiredSession.activeKey).toBeNull();
    expect(expiredSession.lastError).toBe('桥接登录会话已过期');
    expect(repository.save).toHaveBeenCalledWith(expiredSession);
  });

  it('invalidates active sessions with an atomic conditional update', async () => {
    const repository = createRepositoryMock();
    const service = new DouyinBridgeAuthService(repository as any);

    await service.invalidateActiveSessions('manual invalidation');

    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      {
        status: DouyinBridgeAuthSessionStatus.Pending,
        activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      },
      expect.objectContaining({
        status: DouyinBridgeAuthSessionStatus.Expired,
        activeKey: null,
        lastError: 'manual invalidation',
      }),
    );
  });
});
