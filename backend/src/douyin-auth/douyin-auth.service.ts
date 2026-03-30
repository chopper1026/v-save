import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  hasLoggedInCookieHeader,
  normalizeCookieHeader,
} from './douyin-auth-cookie.util';
import { UserAdminAuditLog } from '../admin/entities/user-admin-audit-log.entity';
import { CompleteDouyinBridgeAuthDto } from './dto/complete-douyin-bridge-auth.dto';
import { DouyinBridgeAuthService } from './douyin-bridge-auth.service';
import type {
  AuthSource,
  DouyinAuthStatus,
} from './douyin-auth.types';
import { DouyinAuthSession } from './entities/douyin-auth-session.entity';
import { DouyinBridgeAuthSessionStatus } from './entities/douyin-bridge-auth-session.entity';

interface SessionSnapshot {
  cookie: string;
  source: AuthSource;
  lastError: string | null;
  lastCheckAt: Date | null;
  entity?: DouyinAuthSession | null;
}

export interface DouyinBridgeStartInput {
  adminUserId?: string;
  adminEmail?: string;
}

export interface DouyinBridgeStartPayload {
  authSessionId: string;
  expiresAt: string;
  uploadToken: string;
  status: 'waiting_helper';
  loginUrl: string;
}

export interface DouyinBridgeStatusPayload {
  authSessionId: string;
  status: 'waiting_helper' | 'confirmed' | 'expired';
  expiresAt: string;
  completedAt: string | null;
  lastError: string | null;
}

export interface DouyinBridgeCompletePayload {
  authSessionId: string;
  status: 'confirmed';
  completedAt: string;
  initiatedByAdminUserId: string | null;
  initiatedByAdminEmail: string | null;
}

@Injectable()
export class DouyinAuthService {
  private readonly logger = new Logger(DouyinAuthService.name);

  constructor(
    @InjectRepository(DouyinAuthSession)
    private readonly sessionRepository: Repository<DouyinAuthSession>,
    private readonly bridgeAuthService: DouyinBridgeAuthService,
  ) {}

  async getStatus(): Promise<DouyinAuthStatus> {
    const snapshot = await this.getSessionSnapshot();
    return {
      hasCookie: !!snapshot.cookie,
      source: snapshot.source,
      lastError: snapshot.lastError,
      lastCheckAt: snapshot.lastCheckAt ? snapshot.lastCheckAt.toISOString() : null,
      updatedAt: snapshot.entity?.updatedAt
        ? snapshot.entity.updatedAt.toISOString()
        : null,
      cookiePreview: null,
    };
  }

  async getCookieHeader(): Promise<string> {
    const snapshot = await this.getSessionSnapshot();
    return snapshot.cookie;
  }

  async saveCookie(
    cookie: string,
    options: { invalidateBridgeSessions?: boolean } = {},
  ): Promise<void> {
    if (options.invalidateBridgeSessions !== false) {
      await this.bridgeAuthService.invalidateActiveSessions(
        '抖音登录态已更新，请重新发起桥接登录',
      );
    }
    await this.persistCookie(cookie);
  }

  async clearSession(): Promise<void> {
    await this.bridgeAuthService.invalidateActiveSessions(
      '抖音登录态已清空，请重新发起桥接登录',
    );
    await this.sessionRepository.delete({ platform: 'douyin' });
  }

  async startBridgeAuth(
    input: DouyinBridgeStartInput = {},
  ): Promise<DouyinBridgeStartPayload> {
    const session = await this.bridgeAuthService.createSession({
      initiatedByAdminUserId: input.adminUserId,
      initiatedByAdminEmail: input.adminEmail,
    });
    return {
      ...session,
      status: 'waiting_helper',
      loginUrl: 'https://www.douyin.com/',
    };
  }

  async getBridgeAuthStatus(
    authSessionId: string,
  ): Promise<DouyinBridgeStatusPayload> {
    const session = await this.bridgeAuthService.getSession(authSessionId);
    if (!session) {
      throw new BadRequestException('桥接登录会话不存在，请重新发起');
    }

    return {
      authSessionId: session.id,
      status: this.mapBridgeStatus(session.status),
      expiresAt: session.expireAt.toISOString(),
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      lastError: session.lastError || null,
    };
  }

  async completeBridgeAuth(
    payload: CompleteDouyinBridgeAuthDto,
  ): Promise<DouyinBridgeCompletePayload> {
    const cookieHeader = normalizeCookieHeader(payload.cookieHeader);
    if (!hasLoggedInCookieHeader(cookieHeader)) {
      throw new BadRequestException('缺少有效的抖音登录 Cookie');
    }
    const result: DouyinBridgeCompletePayload =
      await this.sessionRepository.manager.transaction(async (manager) => {
      const prepared = await this.bridgeAuthService.prepareSessionCompletion(
        {
          authSessionId: payload.authSessionId,
          uploadToken: payload.uploadToken,
        },
        { manager, lock: true },
      );
      if (!prepared.initiatedByAdminUserId) {
        throw new BadRequestException('桥接登录会话缺少发起管理员，请重新发起');
      }

      await this.persistCookieWithManager(manager, cookieHeader);
      await this.insertBridgeCompletionAudit(manager, prepared.authSessionId, {
        adminUserId: prepared.initiatedByAdminUserId,
        adminEmail: prepared.initiatedByAdminEmail,
      });
      const result = await this.bridgeAuthService.markSessionCompleted(
        prepared.authSessionId,
        { manager },
      );

      return {
        authSessionId: result.authSessionId,
        status: 'confirmed',
        completedAt: result.completedAt,
        initiatedByAdminUserId: result.initiatedByAdminUserId,
        initiatedByAdminEmail: result.initiatedByAdminEmail,
      };
      });
    return result;
  }

  async recordCheckError(message: string): Promise<void> {
    const snapshot = await this.getSessionSnapshot();
    if (
      snapshot.source !== 'database' ||
      !snapshot.entity ||
      !snapshot.cookie
    ) {
      return;
    }

    await this.upsertSession({
      cookie: snapshot.cookie,
      lastError: message.slice(0, 255),
      lastCheckAt: new Date(),
    });
  }

  async touchSessionCheckTime(): Promise<void> {
    const snapshot = await this.getSessionSnapshot();
    if (
      snapshot.source !== 'database' ||
      !snapshot.entity ||
      !snapshot.cookie
    ) {
      return;
    }

    await this.upsertSession({
      cookie: snapshot.cookie,
      lastError: null,
      lastCheckAt: new Date(),
    });
  }

  private async getSessionSnapshot(): Promise<SessionSnapshot> {
    const dbSession = await this.sessionRepository.findOne({
      where: { platform: 'douyin' },
    });

    if (dbSession?.cookie) {
      return {
        cookie: normalizeCookieHeader(dbSession.cookie),
        source: 'database',
        lastError: dbSession.lastError || null,
        lastCheckAt: dbSession.lastCheckAt || null,
        entity: dbSession,
      };
    }

    const envCookie = normalizeCookieHeader(process.env.DOUYIN_COOKIE || '');
    if (envCookie) {
      return {
        cookie: envCookie,
        source: 'environment',
        lastError: null,
        lastCheckAt: null,
        entity: null,
      };
    }

    return {
      cookie: '',
      source: 'none',
      lastError: null,
      lastCheckAt: null,
      entity: null,
    };
  }

  private async upsertSession(payload: {
    cookie: string;
    lastError: string | null;
    lastCheckAt: Date | null;
  }): Promise<void> {
    const current = await this.sessionRepository.findOne({
      where: { platform: 'douyin' },
    });

    if (current) {
      current.cookie = payload.cookie;
      current.lastError = payload.lastError;
      current.lastCheckAt = payload.lastCheckAt;
      await this.sessionRepository.save(current);
      return;
    }

    await this.sessionRepository.save(
      this.sessionRepository.create({
        platform: 'douyin',
        cookie: payload.cookie,
        lastError: payload.lastError,
        lastCheckAt: payload.lastCheckAt,
      }),
    );
  }

  private async persistCookie(cookie: string): Promise<void> {
    await this.upsertSession({
      cookie: normalizeCookieHeader(cookie),
      lastError: null,
      lastCheckAt: new Date(),
    });
  }

  private async persistCookieWithManager(
    manager: EntityManager,
    cookie: string,
  ): Promise<void> {
    await this.upsertSessionWithRepository(
      manager.getRepository(DouyinAuthSession),
      {
        cookie: normalizeCookieHeader(cookie),
        lastError: null,
        lastCheckAt: new Date(),
      },
    );
  }

  private async insertBridgeCompletionAudit(
    manager: EntityManager,
    authSessionId: string,
    admin: {
      adminUserId: string;
      adminEmail: string | null;
    },
  ): Promise<void> {
    const auditRepository = manager.getRepository(UserAdminAuditLog);
    await auditRepository.save(
      auditRepository.create({
        adminUserId: admin.adminUserId,
        adminEmail: admin.adminEmail,
        targetUserId: admin.adminUserId,
        targetEmail: admin.adminEmail,
        action: 'DOUYIN_BRIDGE_AUTH_CONFIRMED',
        module: 'AUTH',
        platform: 'DOUYIN',
        targetType: 'AUTH_SESSION',
        beforeState: null,
        afterState: {
          authSessionId,
          status: 'confirmed',
        },
        reason: '抖音桥接登录确认成功',
      }),
    );
  }

  private async upsertSessionWithRepository(
    repository: Repository<DouyinAuthSession>,
    payload: {
      cookie: string;
      lastError: string | null;
      lastCheckAt: Date | null;
    },
  ): Promise<void> {
    const current = await repository.findOne({
      where: { platform: 'douyin' },
    });

    if (current) {
      current.cookie = payload.cookie;
      current.lastError = payload.lastError;
      current.lastCheckAt = payload.lastCheckAt;
      await repository.save(current);
      return;
    }

    await repository.save(
      repository.create({
        platform: 'douyin',
        cookie: payload.cookie,
        lastError: payload.lastError,
        lastCheckAt: payload.lastCheckAt,
      }),
    );
  }

  private mapBridgeStatus(
    status: DouyinBridgeAuthSessionStatus,
  ): DouyinBridgeStatusPayload['status'] {
    if (status === DouyinBridgeAuthSessionStatus.Completed) {
      return 'confirmed';
    }

    if (status === DouyinBridgeAuthSessionStatus.Expired) {
      return 'expired';
    }

    return 'waiting_helper';
  }
}
