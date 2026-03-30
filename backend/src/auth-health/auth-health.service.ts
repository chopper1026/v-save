import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BilibiliAuthService } from '../bilibili-auth/bilibili-auth.service';
import { DouyinAuthService } from '../douyin-auth/douyin-auth.service';
import {
  NotificationLevel,
  NotificationsService,
} from '../notifications/notifications.service';
import {
  AuthHealthPlatform,
  AuthHealthState,
  AuthHealthStatus,
} from './entities/auth-health-status.entity';

type ParseFailureCategory =
  | 'invalid_input'
  | 'unsupported_platform'
  | 'risk_control'
  | 'video_unavailable'
  | 'upstream'
  | 'parse_failed'
  | string;

const AUTH_EXPIRED_SIGNAL_PATTERN =
  /cookie|登录|refresh|token|session|forbidden|unauthorized|403/i;

const NON_AUTH_FAILURE_CODES = new Set([
  'DOWNLOAD_URL_FAILED',
  'QUALITY_LIMIT_FOR_FREE',
  'FREE_PLATFORM_NOT_SUPPORTED',
  'FREE_LIMIT_REACHED',
  'DOUYIN_WATERMARK_FALLBACK_REQUIRED',
]);

interface ParseFailureLike {
  category?: ParseFailureCategory;
  code?: string;
  message?: string;
}

export interface AuthHealthView {
  platform: AuthHealthPlatform;
  status: AuthHealthState;
  consecutiveFailures: number;
  lastError: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

@Injectable()
export class AuthHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthHealthService.name);
  private readonly checkIntervalMs = this.readIntegerEnv(
    'AUTH_HEALTH_CHECK_INTERVAL_MS',
    10 * 60 * 1000,
  );
  private readonly invalidThreshold = this.readIntegerEnv(
    'AUTH_HEALTH_INVALID_THRESHOLD',
    3,
  );
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(
    @InjectRepository(AuthHealthStatus)
    private readonly authHealthRepository: Repository<AuthHealthStatus>,
    private readonly bilibiliAuthService: BilibiliAuthService,
    private readonly douyinAuthService: DouyinAuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runPeriodicHealthCheck('interval');
    }, this.checkIntervalMs);
    void this.runPeriodicHealthCheck('startup');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getHealthStatus(sync = false): Promise<{
    checkedAt: string;
    platforms: Record<AuthHealthPlatform, AuthHealthView>;
  }> {
    if (sync) {
      await this.runPeriodicHealthCheck('manual');
    }

    const rows = await this.authHealthRepository.find();
    const mapped = rows.reduce((acc, row) => {
      acc[row.platform] = {
        platform: row.platform,
        status: row.status,
        consecutiveFailures: row.consecutiveFailures,
        lastError: row.lastError || null,
        lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
        lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
        lastFailureAt: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
      };
      return acc;
    }, {} as Record<AuthHealthPlatform, AuthHealthView>);

    const defaults: Record<AuthHealthPlatform, AuthHealthView> = {
      bilibili: mapped.bilibili || {
        platform: 'bilibili',
        status: 'unknown',
        consecutiveFailures: 0,
        lastError: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      douyin: mapped.douyin || {
        platform: 'douyin',
        status: 'unknown',
        consecutiveFailures: 0,
        lastError: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
    };

    return {
      checkedAt: new Date().toISOString(),
      platforms: defaults,
    };
  }

  async reportParseSuccess(platform?: string | null): Promise<void> {
    if (!this.isSupportedPlatform(platform)) {
      return;
    }
    await this.markHealthy(platform);
  }

  async reportParseFailure(
    platform?: string | null,
    failure?: ParseFailureLike,
  ): Promise<void> {
    if (!this.isSupportedPlatform(platform)) {
      return;
    }
    const category = String(failure?.category || '').trim();
    const code = String(failure?.code || '').trim().toUpperCase();
    const message = String(failure?.message || '').trim() || '解析失败';

    // 无关登录态的输入错误不计入健康度
    if (category === 'invalid_input' || category === 'unsupported_platform') {
      return;
    }

    if (NON_AUTH_FAILURE_CODES.has(code)) {
      return;
    }

    if (platform === 'douyin' && category === 'risk_control') {
      await this.markFailure(platform, message, 'degraded', 'COOKIE_RISK');
      return;
    }

    if (AUTH_EXPIRED_SIGNAL_PATTERN.test(`${code} ${message}`)) {
      await this.markFailure(platform, message, 'invalid', 'COOKIE_EXPIRED');
    }
  }

  private async runPeriodicHealthCheck(trigger: 'startup' | 'interval' | 'manual') {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;
    try {
      await this.checkBilibili();
      await this.checkDouyin();
      this.logger.log(`登录态健康检查完成: trigger=${trigger}`);
    } catch (error: any) {
      this.logger.warn(`登录态健康检查失败: ${error?.message || 'unknown'}`);
    } finally {
      this.isChecking = false;
    }
  }

  private async checkBilibili() {
    const status = await this.bilibiliAuthService.getStatus(false);
    if (!status.hasCookie) {
      await this.markFailure(
        'bilibili',
        '未配置 B 站 Cookie，请重新扫码登录',
        'invalid',
        'COOKIE_EXPIRED',
      );
      return;
    }

    const refreshResult = await this.bilibiliAuthService
      .refreshCookieIfNeeded(false)
      .catch((error: any) => ({
        refreshed: false,
        needed: true,
        message: error?.message || 'B站 Cookie 检查失败',
      }));

    if (refreshResult.needed && !refreshResult.refreshed) {
      await this.markFailure(
        'bilibili',
        refreshResult.message || 'B站 Cookie 失效，请重新扫码',
        'invalid',
        'COOKIE_EXPIRED',
      );
      return;
    }

    await this.markHealthy('bilibili');
  }

  private async checkDouyin() {
    const status = await this.douyinAuthService.getStatus();
    if (!status.hasCookie) {
      await this.markFailure(
        'douyin',
        '未配置抖音 Cookie，请重新扫码或手动更新',
        'invalid',
        'COOKIE_EXPIRED',
      );
      return;
    }

    const cookieHeader = await this.douyinAuthService.getCookieHeader();
    const cookieMap = this.parseCookieHeader(cookieHeader);
    if (!cookieMap.sessionid && !cookieMap.sessionid_ss) {
      await this.douyinAuthService
        .recordCheckError('抖音 Cookie 缺少 sessionid，可能已失效')
        .catch(() => undefined);
      await this.markFailure(
        'douyin',
        '抖音 Cookie 缺少 sessionid，可能已失效',
        'invalid',
        'COOKIE_EXPIRED',
      );
      return;
    }

    if (status.lastError) {
      await this.douyinAuthService
        .recordCheckError(status.lastError)
        .catch(() => undefined);
      await this.markFailure(
        'douyin',
        status.lastError,
        'degraded',
        'COOKIE_RISK',
      );
      return;
    }

    await this.douyinAuthService
      .touchSessionCheckTime()
      .catch(() => undefined);
    await this.markHealthy('douyin');
  }

  private async markHealthy(platform: AuthHealthPlatform): Promise<void> {
    const current = await this.getOrCreateStatus(platform);
    const previousStatus = current.status;
    current.status = 'healthy';
    current.consecutiveFailures = 0;
    current.lastError = null;
    current.lastCheckedAt = new Date();
    current.lastSuccessAt = new Date();
    await this.authHealthRepository.save(current);

    if (previousStatus !== 'healthy') {
      const platformLabel = this.getPlatformLabel(platform);
      const day = new Date().toISOString().slice(0, 10);
      await this.notificationsService.createForSuperAdmins({
        type: 'AUTH_RECOVERED',
        level: 'success',
        source: 'auth',
        title: `${platformLabel}登录态已恢复`,
        content: `${platformLabel}登录态已恢复正常，可继续稳定解析与下载。`,
        actionUrl: '/admin?tab=auth',
        dedupKey: `auth-recovered:${platform}:${day}`,
      });
    }
  }

  private async markFailure(
    platform: AuthHealthPlatform,
    message: string,
    preferredState: 'degraded' | 'invalid',
    notifyType: 'COOKIE_RISK' | 'COOKIE_EXPIRED',
  ): Promise<void> {
    const current = await this.getOrCreateStatus(platform);

    const failures = (current.consecutiveFailures || 0) + 1;
    let nextStatus: AuthHealthState = preferredState;
    if (preferredState !== 'invalid' && failures >= this.invalidThreshold) {
      nextStatus = 'invalid';
    }

    current.status = nextStatus;
    current.consecutiveFailures = failures;
    current.lastError = String(message || '').trim().slice(0, 255);
    current.lastCheckedAt = new Date();
    current.lastFailureAt = new Date();
    await this.authHealthRepository.save(current);

    const platformLabel = this.getPlatformLabel(platform);
    const level: NotificationLevel = nextStatus === 'invalid' ? 'error' : 'warn';
    const bucket = Math.floor(Date.now() / (12 * 60 * 60 * 1000));
    const dedupType = nextStatus === 'invalid' ? 'COOKIE_EXPIRED' : notifyType;
    const dedupPrefix = `auth-problem:${platform}:${dedupType}:`;
    const dedupKey = `${dedupPrefix}${Date.now()}:${bucket}`;
    const defaultTitle =
      nextStatus === 'invalid'
        ? `${platformLabel}登录态可能已失效`
        : `${platformLabel}登录态出现异常`;

    await this.notificationsService.createForSuperAdmins({
      type: dedupType,
      level,
      source: 'auth',
      title: defaultTitle,
      content:
        current.lastError ||
          `${platformLabel}登录态检测异常，请前往登录态管理页面检查并重新登录。`,
      actionUrl: '/admin?tab=auth',
      dedupKey,
    }, {
      skipIfUnreadDedupKeyPrefix: dedupPrefix,
    });
  }

  private async getOrCreateStatus(
    platform: AuthHealthPlatform,
  ): Promise<AuthHealthStatus> {
    const existed = await this.authHealthRepository.findOne({
      where: { platform },
    });
    if (existed) {
      return existed;
    }
    return this.authHealthRepository.create({
      platform,
      status: 'unknown',
      consecutiveFailures: 0,
      lastError: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    });
  }

  private parseCookieHeader(cookieHeader: string): Record<string, string> {
    return String(cookieHeader || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((acc, item) => {
        const index = item.indexOf('=');
        if (index <= 0) {
          return acc;
        }
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1).trim();
        if (!key || !value) {
          return acc;
        }
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
  }

  private getPlatformLabel(platform: AuthHealthPlatform): string {
    return platform === 'bilibili' ? 'B站' : '抖音';
  }

  private isSupportedPlatform(platform?: string | null): platform is AuthHealthPlatform {
    return platform === 'bilibili' || platform === 'douyin';
  }

  private readIntegerEnv(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
