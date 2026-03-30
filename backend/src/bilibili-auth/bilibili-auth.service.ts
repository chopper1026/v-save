import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { constants, createPublicKey, publicEncrypt } from 'crypto';
import { Repository } from 'typeorm';
import { BilibiliAuthSession } from './entities/bilibili-auth-session.entity';

const QRCODE_GENERATE_API =
  'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const QRCODE_POLL_API =
  'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const COOKIE_INFO_API =
  'https://passport.bilibili.com/x/passport-login/web/cookie/info';
const COOKIE_REFRESH_API =
  'https://passport.bilibili.com/x/passport-login/web/cookie/refresh';
const COOKIE_CONFIRM_API =
  'https://passport.bilibili.com/x/passport-login/web/confirm/refresh';

const BILIBILI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDcZNRHhQi7eR8UhOSzos5KfV4U
bz4nGRKgUYGMRFhVfCB3zuB4egBfG7fF/N75ehmbmbE53duh4toSGcdY5Q6E57ac
n4fM9QmclSsN1onhH4IecNpA9WnER9p/V0zSx8xjCH8h32P+8i9xArlln+vWfM6C
l7XQvLofM3uQ9vN7VwIDAQAB
-----END PUBLIC KEY-----`;

type AuthSource = 'database' | 'environment' | 'none';

interface SessionSnapshot {
  cookie: string;
  refreshToken: string | null;
  source: AuthSource;
  lastError: string | null;
  lastCheckAt: Date | null;
  lastRefreshAt: Date | null;
  entity?: BilibiliAuthSession | null;
}

export interface BilibiliAuthStatus {
  hasCookie: boolean;
  source: AuthSource;
  refreshTokenPresent: boolean;
  csrfPresent: boolean;
  userId: string | null;
  lastError: string | null;
  lastCheckAt: string | null;
  lastRefreshAt: string | null;
}

export interface QrCodePayload {
  qrcodeKey: string;
  qrUrl: string;
  expireAt: string;
}

export interface QrPollPayload {
  status: 'pending' | 'confirmed' | 'expired';
  message: string;
}

export interface RefreshPayload {
  refreshed: boolean;
  needed: boolean;
  message: string;
}

@Injectable()
export class BilibiliAuthService {
  private readonly logger = new Logger(BilibiliAuthService.name);
  private readonly autoCheckIntervalMs = 5 * 60 * 1000;
  private lastAutoCheckAt = 0;

  constructor(
    @InjectRepository(BilibiliAuthSession)
    private readonly sessionRepository: Repository<BilibiliAuthSession>,
  ) {}

  async getStatus(sync: boolean = false): Promise<BilibiliAuthStatus> {
    if (sync) {
      await this.refreshCookieIfNeeded(false).catch((error) => {
        this.logger.warn(`同步检查 B 站登录态失败: ${error.message}`);
      });
    }

    const snapshot = await this.getSessionSnapshot();
    const cookieMap = this.parseCookieHeader(snapshot.cookie);

    return {
      hasCookie: this.hasRequiredCookieFields(cookieMap),
      source: snapshot.source,
      refreshTokenPresent: !!snapshot.refreshToken,
      csrfPresent: !!cookieMap.bili_jct,
      userId: cookieMap.DedeUserID || null,
      lastError: snapshot.lastError || null,
      lastCheckAt: snapshot.lastCheckAt ? snapshot.lastCheckAt.toISOString() : null,
      lastRefreshAt: snapshot.lastRefreshAt ? snapshot.lastRefreshAt.toISOString() : null,
    };
  }

  async getCookieHeader(): Promise<string> {
    const snapshot = await this.getSessionSnapshot();
    if (!snapshot.cookie) {
      return '';
    }

    const now = Date.now();
    if (now - this.lastAutoCheckAt >= this.autoCheckIntervalMs) {
      this.lastAutoCheckAt = now;
      await this.refreshCookieIfNeeded(false).catch((error) => {
        this.logger.warn(`自动检查 B 站 Cookie 失败: ${error.message}`);
      });
    }

    const latest = await this.getSessionSnapshot();
    return latest.cookie || snapshot.cookie;
  }

  async clearSession(): Promise<void> {
    await this.sessionRepository.delete({ platform: 'bilibili' });
  }

  async generateQrCode(): Promise<QrCodePayload> {
    const response = await axios.get(QRCODE_GENERATE_API, {
      headers: this.buildHeaders(),
      timeout: 10000,
    });

    if (response.data?.code !== 0) {
      throw new Error(response.data?.message || 'B站二维码生成失败');
    }

    const qrcodeKey = response.data?.data?.qrcode_key;
    const qrUrl = response.data?.data?.url;
    if (!qrcodeKey || !qrUrl) {
      throw new Error('B站二维码数据缺失');
    }

    return {
      qrcodeKey,
      qrUrl,
      expireAt: new Date(Date.now() + 180000).toISOString(),
    };
  }

  async pollQrLogin(qrcodeKey: string): Promise<QrPollPayload> {
    if (!qrcodeKey?.trim()) {
      throw new Error('二维码 key 不能为空');
    }

    const response = await axios.get(QRCODE_POLL_API, {
      params: {
        qrcode_key: qrcodeKey.trim(),
      },
      headers: this.buildHeaders(),
      timeout: 10000,
    });

    if (response.data?.code !== 0) {
      throw new Error(response.data?.message || 'B站二维码轮询失败');
    }

    const pollCode = response.data?.data?.code;
    const pollMessage = response.data?.data?.message || '';

    if (pollCode === 86101 || pollCode === 86090) {
      return {
        status: 'pending',
        message: pollMessage || '等待扫码确认',
      };
    }

    if (pollCode === 86038) {
      return {
        status: 'expired',
        message: pollMessage || '二维码已过期，请重新获取',
      };
    }

    if (pollCode !== 0) {
      throw new Error(pollMessage || `B站二维码登录失败，状态码: ${pollCode}`);
    }

    const setCookieMap = this.parseSetCookieHeader(response.headers?.['set-cookie']);
    const redirectCookieMap = this.extractCookieFromLoginRedirect(
      response.data?.data?.url || '',
    );
    const mergedCookieMap = {
      ...redirectCookieMap,
      ...setCookieMap,
    };

    const cookie = this.stringifyCookieMap(mergedCookieMap);
    if (!this.hasRequiredCookieFields(mergedCookieMap)) {
      throw new Error('扫码成功但未拿到完整 Cookie，请重试');
    }

    const refreshToken =
      response.data?.data?.refresh_token ||
      redirectCookieMap.refresh_token ||
      redirectCookieMap.ac_time_value ||
      null;

    await this.upsertSession({
      cookie,
      refreshToken,
      lastError: null,
      lastCheckAt: new Date(),
      lastRefreshAt: null,
    });

    return {
      status: 'confirmed',
      message: '登录成功，B站 Cookie 已保存',
    };
  }

  async refreshCookieIfNeeded(force: boolean = false): Promise<RefreshPayload> {
    const snapshot = await this.getSessionSnapshot();
    if (!snapshot.cookie) {
      return {
        refreshed: false,
        needed: false,
        message: '未配置 B 站 Cookie',
      };
    }

    const cookieMap = this.parseCookieHeader(snapshot.cookie);
    if (!this.hasRequiredCookieFields(cookieMap)) {
      await this.persistError('Cookie 字段不完整，请重新扫码登录');
      return {
        refreshed: false,
        needed: true,
        message: 'Cookie 字段不完整，请重新扫码登录',
      };
    }

    const infoResponse = await axios.get(COOKIE_INFO_API, {
      headers: this.buildHeaders(snapshot.cookie),
      timeout: 10000,
    });

    if (infoResponse.data?.code !== 0) {
      const message = infoResponse.data?.message || 'B站 Cookie 状态检查失败';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }

    const refreshRequired = !!infoResponse.data?.data?.refresh;
    const timestamp = Number(infoResponse.data?.data?.timestamp || Date.now());

    if (!refreshRequired) {
      await this.touchSessionCheckTime(snapshot);
      return {
        refreshed: false,
        needed: false,
        message: '当前 Cookie 无需刷新',
      };
    }

    if (!snapshot.refreshToken) {
      await this.persistError('缺少 refresh token，请重新扫码登录');
      return {
        refreshed: false,
        needed: true,
        message: '缺少 refresh token，请重新扫码登录',
      };
    }

    const csrf = cookieMap.bili_jct || '';
    if (!csrf) {
      await this.persistError('Cookie 缺少 bili_jct，无法自动刷新');
      return {
        refreshed: false,
        needed: true,
        message: 'Cookie 缺少 bili_jct，无法自动刷新',
      };
    }

    const correspondPath = this.buildCorrespondPath(timestamp);
    let correspondResponse: any;
    try {
      correspondResponse = await axios.get(
        `https://www.bilibili.com/correspond/1/${correspondPath}`,
        {
          headers: this.buildHeaders(snapshot.cookie),
          timeout: 10000,
        },
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const message =
        status === 404
          ? '刷新校验接口不可用，请稍后重试或重新扫码登录'
          : error?.message || '刷新校验请求失败，请稍后重试';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }
    const refreshCsrf = this.extractRefreshCsrf(correspondResponse.data || '');
    if (!refreshCsrf) {
      await this.persistError('获取 refresh_csrf 失败，请重新扫码');
      return {
        refreshed: false,
        needed: true,
        message: '获取 refresh_csrf 失败，请重新扫码',
      };
    }

    const refreshForm = new URLSearchParams({
      csrf,
      refresh_csrf: refreshCsrf,
      source: 'main_web',
      refresh_token: snapshot.refreshToken,
    });
    let refreshResponse: any;
    try {
      refreshResponse = await axios.post(
        COOKIE_REFRESH_API,
        refreshForm.toString(),
        {
          headers: {
            ...this.buildHeaders(snapshot.cookie),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        },
      );
    } catch (error: any) {
      const message = error?.message || 'Cookie 刷新请求失败';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }

    if (refreshResponse.data?.code !== 0) {
      const message = refreshResponse.data?.message || 'Cookie 刷新失败';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }

    const refreshedSetCookieMap = this.parseSetCookieHeader(
      refreshResponse.headers?.['set-cookie'],
    );
    const mergedAfterRefresh = {
      ...cookieMap,
      ...refreshedSetCookieMap,
    };
    const refreshedCookie = this.stringifyCookieMap(mergedAfterRefresh);
    const refreshedCookieMap = this.parseCookieHeader(refreshedCookie);
    const newRefreshToken =
      refreshResponse.data?.data?.refresh_token || snapshot.refreshToken;
    const confirmCsrf = refreshedCookieMap.bili_jct || csrf;

    const confirmForm = new URLSearchParams({
      csrf: confirmCsrf,
      refresh_token: snapshot.refreshToken,
    });
    let confirmResponse: any;
    try {
      confirmResponse = await axios.post(
        COOKIE_CONFIRM_API,
        confirmForm.toString(),
        {
          headers: {
            ...this.buildHeaders(refreshedCookie),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        },
      );
    } catch (error: any) {
      const message = error?.message || 'Cookie 刷新确认请求失败';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }

    if (confirmResponse.data?.code !== 0) {
      const message = confirmResponse.data?.message || 'Cookie 刷新确认失败';
      await this.persistError(message);
      return {
        refreshed: false,
        needed: true,
        message,
      };
    }

    await this.upsertSession({
      cookie: refreshedCookie,
      refreshToken: newRefreshToken,
      lastError: null,
      lastCheckAt: new Date(),
      lastRefreshAt: new Date(),
    });

    return {
      refreshed: true,
      needed: true,
      message: 'Cookie 已自动刷新',
    };
  }

  private async getSessionSnapshot(): Promise<SessionSnapshot> {
    const dbSession = await this.sessionRepository.findOne({
      where: { platform: 'bilibili' },
    });

    if (dbSession?.cookie) {
      return {
        cookie: this.normalizeCookieHeader(dbSession.cookie),
        refreshToken: dbSession.refreshToken || null,
        source: 'database',
        lastError: dbSession.lastError || null,
        lastCheckAt: dbSession.lastCheckAt || null,
        lastRefreshAt: dbSession.lastRefreshAt || null,
        entity: dbSession,
      };
    }

    const envCookie = this.getCookieFromEnv();
    const envRefreshToken =
      process.env.BILIBILI_REFRESH_TOKEN?.trim() ||
      process.env.BILIBILI_AC_TIME_VALUE?.trim() ||
      null;
    if (envCookie) {
      return {
        cookie: envCookie,
        refreshToken: envRefreshToken,
        source: 'environment',
        lastError: null,
        lastCheckAt: null,
        lastRefreshAt: null,
        entity: null,
      };
    }

    return {
      cookie: '',
      refreshToken: null,
      source: 'none',
      lastError: null,
      lastCheckAt: null,
      lastRefreshAt: null,
      entity: null,
    };
  }

  private async touchSessionCheckTime(snapshot: SessionSnapshot): Promise<void> {
    if (snapshot.source !== 'database' || !snapshot.entity) {
      return;
    }

    await this.upsertSession({
      cookie: snapshot.cookie,
      refreshToken: snapshot.refreshToken,
      lastError: null,
      lastCheckAt: new Date(),
      lastRefreshAt: snapshot.lastRefreshAt,
    });
  }

  private async persistError(message: string): Promise<void> {
    const snapshot = await this.getSessionSnapshot();
    if (!snapshot.cookie) {
      return;
    }

    await this.upsertSession({
      cookie: snapshot.cookie,
      refreshToken: snapshot.refreshToken,
      lastError: message,
      lastCheckAt: new Date(),
      lastRefreshAt: snapshot.lastRefreshAt,
    });
  }

  private async upsertSession(payload: {
    cookie: string;
    refreshToken: string | null;
    lastError: string | null;
    lastCheckAt: Date | null;
    lastRefreshAt: Date | null;
  }): Promise<void> {
    const current = await this.sessionRepository.findOne({
      where: { platform: 'bilibili' },
    });

    if (current) {
      current.cookie = this.normalizeCookieHeader(payload.cookie);
      current.refreshToken = payload.refreshToken;
      current.lastError = payload.lastError;
      current.lastCheckAt = payload.lastCheckAt;
      current.lastRefreshAt = payload.lastRefreshAt;
      await this.sessionRepository.save(current);
      return;
    }

    const entity = this.sessionRepository.create({
      platform: 'bilibili',
      cookie: this.normalizeCookieHeader(payload.cookie),
      refreshToken: payload.refreshToken,
      lastError: payload.lastError,
      lastCheckAt: payload.lastCheckAt,
      lastRefreshAt: payload.lastRefreshAt,
    });
    await this.sessionRepository.save(entity);
  }

  private buildHeaders(cookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Referer: 'https://www.bilibili.com',
      Origin: 'https://www.bilibili.com',
      Accept: 'application/json, text/plain, */*',
    };

    if (cookie) {
      headers.Cookie = cookie;
    }

    return headers;
  }

  private parseSetCookieHeader(setCookieHeader?: string[] | string): Record<string, string> {
    if (!setCookieHeader) {
      return {};
    }

    const lines = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];

    return lines.reduce((acc, line) => {
      const firstPair = line.split(';')[0];
      const index = firstPair.indexOf('=');
      if (index <= 0) {
        return acc;
      }
      const key = firstPair.slice(0, index).trim();
      const value = firstPair.slice(index + 1).trim();
      if (!key || !value) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
  }

  private parseCookieHeader(cookieHeader: string): Record<string, string> {
    if (!cookieHeader) {
      return {};
    }

    return cookieHeader.split(';').reduce((acc, chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) {
        return acc;
      }

      const index = trimmed.indexOf('=');
      if (index <= 0) {
        return acc;
      }

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!key || !value) {
        return acc;
      }

      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
  }

  private stringifyCookieMap(cookieMap: Record<string, string>): string {
    const blockedKeys = new Set([
      'refresh_token',
      'gourl',
      'Expires',
      'Domain',
      'Path',
      'Max-Age',
      'SameSite',
      'Secure',
      'HttpOnly',
    ]);

    return Object.entries(cookieMap)
      .filter(([key, value]) => {
        if (!key || !value) {
          return false;
        }

        if (blockedKeys.has(key)) {
          return false;
        }

        return true;
      })
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  private extractCookieFromLoginRedirect(url: string): Record<string, string> {
    if (!url) {
      return {};
    }

    try {
      const parsed = new URL(url);
      const result: Record<string, string> = {};
      parsed.searchParams.forEach((value, key) => {
        if (!value) {
          return;
        }
        result[key] = value;
      });
      return result;
    } catch (_error) {
      return {};
    }
  }

  private normalizeCookieHeader(cookieHeader: string): string {
    const cookieMap = this.parseCookieHeader(cookieHeader);
    return this.stringifyCookieMap(cookieMap);
  }

  private hasRequiredCookieFields(cookieMap: Record<string, string>): boolean {
    return !!(
      cookieMap.SESSDATA &&
      cookieMap.bili_jct &&
      cookieMap.DedeUserID
    );
  }

  private getCookieFromEnv(): string {
    const fullCookie = process.env.BILIBILI_COOKIE?.trim();
    if (fullCookie) {
      return this.normalizeCookieHeader(fullCookie);
    }

    const sessData = process.env.BILIBILI_SESSDATA?.trim();
    if (!sessData) {
      return '';
    }

    const cookieMap: Record<string, string> = {
      SESSDATA: sessData,
    };

    const biliJct = process.env.BILIBILI_BILI_JCT?.trim();
    const dedeUserId = process.env.BILIBILI_DEDEUSERID?.trim();
    const dedeUserIdMd5 = process.env.BILIBILI_DEDEUSERID_CKMD5?.trim();

    if (biliJct) {
      cookieMap.bili_jct = biliJct;
    }
    if (dedeUserId) {
      cookieMap.DedeUserID = dedeUserId;
    }
    if (dedeUserIdMd5) {
      cookieMap.DedeUserID__ckMd5 = dedeUserIdMd5;
    }

    return this.stringifyCookieMap(cookieMap);
  }

  private buildCorrespondPath(timestamp: number): string {
    const payload = Buffer.from(`refresh_${timestamp}`);
    const encrypted = publicEncrypt(
      {
        key: createPublicKey(BILIBILI_PUBLIC_KEY),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      payload,
    );
    return encrypted.toString('hex');
  }

  private extractRefreshCsrf(html: string): string {
    const matched = html.match(/<div id="1-name">(.+?)<\/div>/);
    return matched?.[1]?.trim() || '';
  }
}
