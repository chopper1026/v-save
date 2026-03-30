import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
  DouyinBridgeAuthSession,
  DouyinBridgeAuthSessionStatus,
} from './entities/douyin-bridge-auth-session.entity';
import type {
  DouyinBridgeAuthSessionPayload,
  DouyinBridgeCreateSessionInput,
  DouyinBridgeCompleteSessionInput,
  DouyinBridgeCompleteSessionPayload,
  DouyinBridgePreparedSessionPayload,
} from './douyin-auth.types';

const BRIDGE_SESSION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class DouyinBridgeAuthService {
  private readonly logger = new Logger(DouyinBridgeAuthService.name);
  private createSessionQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(DouyinBridgeAuthSession)
    private readonly sessionRepository: Repository<DouyinBridgeAuthSession>,
  ) {}

  async createSession(
    input: DouyinBridgeCreateSessionInput = {},
  ): Promise<DouyinBridgeAuthSessionPayload> {
    return this.runCreateSessionExclusive(async () => {
      await this.expireActiveSessions('已生成新的桥接登录会话，请使用最新上传令牌');

      const uploadToken = randomBytes(32).toString('hex');
      const entity = this.sessionRepository.create({
        id: randomUUID(),
        status: DouyinBridgeAuthSessionStatus.Pending,
        uploadTokenHash: this.hashUploadToken(uploadToken),
        activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
        lastError: null,
        initiatedByAdminUserId:
          String(input.initiatedByAdminUserId || '').trim() || null,
        initiatedByAdminEmail:
          String(input.initiatedByAdminEmail || '').trim() || null,
        expireAt: new Date(Date.now() + BRIDGE_SESSION_TTL_MS),
        completedAt: null,
      });
      await this.sessionRepository.save(entity);
      this.logger.log(`抖音桥接登录会话已创建: authSessionId=${entity.id}`);

      return {
        authSessionId: entity.id,
        expiresAt: entity.expireAt.toISOString(),
        uploadToken,
      };
    });
  }

  async completeSession(
    input: DouyinBridgeCompleteSessionInput,
  ): Promise<DouyinBridgeCompleteSessionPayload> {
    const prepared = await this.prepareSessionCompletion(input);
    return this.markSessionCompleted(prepared.authSessionId);
  }

  async prepareSessionCompletion(
    input: DouyinBridgeCompleteSessionInput,
    options: {
      manager?: EntityManager;
      lock?: boolean;
    } = {},
  ): Promise<DouyinBridgePreparedSessionPayload> {
    const authSessionId = String(input.authSessionId || '').trim();
    const uploadToken = String(input.uploadToken || '').trim();

    if (!authSessionId || !uploadToken) {
      throw new BadRequestException('桥接登录参数不完整');
    }

    const session = await this.getCurrentPendingSessionOrThrow(
      authSessionId,
      options.manager,
      options.lock,
    );

    if (!this.matchesUploadToken(session.uploadTokenHash, uploadToken)) {
      throw new BadRequestException('上传令牌无效');
    }

    return {
      authSessionId: session.id,
      initiatedByAdminUserId: session.initiatedByAdminUserId || null,
      initiatedByAdminEmail: session.initiatedByAdminEmail || null,
      session,
    };
  }

  async markSessionCompleted(
    authSessionId: string,
    options: {
      manager?: EntityManager;
    } = {},
  ): Promise<DouyinBridgeCompleteSessionPayload> {
    const session = await this.getCurrentPendingSessionOrThrow(
      authSessionId,
      options.manager,
      true,
    );
    session.status = DouyinBridgeAuthSessionStatus.Completed;
    session.activeKey = null;
    session.lastError = null;
    session.completedAt = new Date();
    await this.getRepository(options.manager).save(session);
    this.logger.log(`抖音桥接登录会话已完成: authSessionId=${session.id}`);

    return {
      authSessionId: session.id,
      status: DouyinBridgeAuthSessionStatus.Completed,
      completedAt: session.completedAt.toISOString(),
      initiatedByAdminUserId: session.initiatedByAdminUserId || null,
      initiatedByAdminEmail: session.initiatedByAdminEmail || null,
    };
  }

  async assertSessionCanBeCompleted(
    authSessionId: string,
    options: {
      manager?: EntityManager;
      lock?: boolean;
    } = {},
  ): Promise<void> {
    await this.getCurrentPendingSessionOrThrow(
      authSessionId,
      options.manager,
      options.lock,
    );
  }

  async invalidateActiveSessions(
    reason = '桥接登录会话已失效，请重新发起',
    manager?: EntityManager,
  ): Promise<void> {
    await this.expireActiveSessions(reason, manager);
  }

  async getSession(authSessionId: string): Promise<DouyinBridgeAuthSession | null> {
    const session = await this.getRepository().findOne({
      where: { id: String(authSessionId || '').trim() },
    });

    if (!session) {
      return null;
    }

    if (
      this.isExpired(session) &&
      session.status === DouyinBridgeAuthSessionStatus.Pending
    ) {
      await this.expireSession(session, '桥接登录会话已过期');
    }

    return session;
  }

  private async getSessionOrThrow(
    authSessionId: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<DouyinBridgeAuthSession> {
    const session = await this.getRepository(manager).findOne({
      where: { id: String(authSessionId || '').trim() },
      lock:
        manager && lock ? ({ mode: 'pessimistic_write' } as const) : undefined,
    });
    if (!session) {
      throw new BadRequestException('桥接登录会话不存在，请重新发起');
    }

    return session;
  }

  private async expireActiveSessions(
    reason: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.getRepository(manager).update(
      {
        status: DouyinBridgeAuthSessionStatus.Pending,
        activeKey: DOUYIN_BRIDGE_AUTH_ACTIVE_KEY,
      },
      {
        status: DouyinBridgeAuthSessionStatus.Expired,
        activeKey: null,
        lastError: reason.slice(0, 255),
      },
    );
  }

  private async expireSession(
    session: DouyinBridgeAuthSession,
    reason: string,
    manager?: EntityManager,
  ): Promise<void> {
    session.status = DouyinBridgeAuthSessionStatus.Expired;
    session.activeKey = null;
    session.lastError = reason.slice(0, 255);
    await this.getRepository(manager).save(session);
  }

  private isExpired(session: DouyinBridgeAuthSession): boolean {
    return Date.now() >= session.expireAt.getTime();
  }

  private async getCurrentPendingSessionOrThrow(
    authSessionId: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<DouyinBridgeAuthSession> {
    const session = await this.getSessionOrThrow(authSessionId, manager, lock);
    if (this.isExpired(session)) {
      await this.expireSession(session, '桥接登录会话已过期', manager);
      throw new BadRequestException('桥接登录会话已过期，请重新发起');
    }

    if (
      session.status !== DouyinBridgeAuthSessionStatus.Pending ||
      session.activeKey !== DOUYIN_BRIDGE_AUTH_ACTIVE_KEY
    ) {
      throw new BadRequestException('桥接登录会话不可用，请重新发起');
    }

    return session;
  }

  private getRepository(
    manager?: EntityManager,
  ): Repository<DouyinBridgeAuthSession> {
    return manager
      ? manager.getRepository(DouyinBridgeAuthSession)
      : this.sessionRepository;
  }

  private hashUploadToken(value: string): string {
    return createHash('sha256').update(String(value || '')).digest('hex');
  }

  private matchesUploadToken(expectedHash: string, uploadToken: string): boolean {
    const expected = Buffer.from(String(expectedHash || ''), 'hex');
    const actual = Buffer.from(this.hashUploadToken(uploadToken), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async runCreateSessionExclusive<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.createSessionQueue;
    let release!: () => void;
    this.createSessionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
    }
  }
}
