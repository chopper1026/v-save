import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  extractCookieHeaderFromSetCookie,
  getKuaishouUserId,
  hasLoggedInCookieHeader,
  normalizeCookieHeader,
  parseCookieHeader,
} from './kuaishou-auth-cookie.util';
import { KuaishouAuthSession } from './entities/kuaishou-auth-session.entity';

type AuthSource = 'database' | 'environment' | 'none';

interface SessionSnapshot {
  cookie: string;
  source: AuthSource;
  lastError: string | null;
  lastCheckAt: Date | null;
  entity?: KuaishouAuthSession | null;
}

export interface KuaishouQrCodePayload {
  qrLoginToken: string;
  qrLoginSignature: string;
  qrUrl: string;
  imageDataUrl: string;
  expireAt: string;
}

export interface KuaishouQrLoginResult {
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'failed';
  message: string;
}

export interface KuaishouAuthStatus {
  hasCookie: boolean;
  source: AuthSource;
  userId: string | null;
  lastError: string | null;
  lastCheckAt: string | null;
  updatedAt: string | null;
}

interface KuaishouPollState {
  status: KuaishouQrLoginResult['status'];
  message: string;
  callbackUrl: string | null;
}

@Injectable()
export class KuaishouAuthService {
  private readonly logger = new Logger(KuaishouAuthService.name);
  private readonly qrSid = 'kuaishou.server.webday7';
  private readonly userAgent =
    process.env.KUAISHOU_BROWSER_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

  constructor(
    @InjectRepository(KuaishouAuthSession)
    private readonly sessionRepository: Repository<KuaishouAuthSession>,
  ) {}

  async generateQrCode(): Promise<KuaishouQrCodePayload> {
    const response = await axios.post(
      'https://id.kuaishou.com/rest/c/infra/ks/qr/start',
      this.createFormBody({
        sid: this.qrSid,
        channelType: 'UNKNOWN',
        isWebSig4: true,
      }),
      {
        timeout: 15000,
        headers: this.createBaseHeaders(),
      },
    );

    const payload = response.data || {};
    if (
      !payload?.qrLoginToken ||
      !payload?.qrLoginSignature ||
      !payload?.qrUrl ||
      !payload?.imageData ||
      !payload?.expireTime
    ) {
      throw new BadRequestException('快手二维码生成失败，请稍后重试');
    }

    return {
      qrLoginToken: String(payload.qrLoginToken),
      qrLoginSignature: String(payload.qrLoginSignature),
      qrUrl: String(payload.qrUrl),
      imageDataUrl: `data:image/png;base64,${String(payload.imageData)}`,
      expireAt: new Date(Number(payload.expireTime)).toISOString(),
    };
  }

  async pollQrLogin(
    qrLoginToken: string,
    qrLoginSignature: string,
  ): Promise<KuaishouQrLoginResult> {
    try {
      const response = await axios.post(
        'https://id.kuaishou.com/rest/c/infra/ks/qr/scanResult',
        this.createFormBody({
          channelType: 'UNKNOWN',
          isWebSig4: true,
          qrLoginToken,
          qrLoginSignature,
        }),
        {
          timeout: 25000,
          headers: this.createBaseHeaders(),
          validateStatus: () => true,
        },
      );

      const payload = response.data || {};
      let cookieHeader = extractCookieHeaderFromSetCookie(
        response.headers?.['set-cookie'],
      );
      let pollState = this.resolvePollState(payload, cookieHeader);
      this.logger.debug(
        `快手扫码轮询响应: ${JSON.stringify({
          resultCodes: this.extractResultCodes(payload),
          message: pollState.message || null,
          status: pollState.status,
          hasCallback: !!pollState.callbackUrl,
          hasDirectCookie: hasLoggedInCookieHeader(cookieHeader),
          payload,
        })}`,
      );

      if (
        this.hasScannedUserInfo(payload) &&
        !hasLoggedInCookieHeader(cookieHeader)
      ) {
        const completion = await this.completeQrLoginAfterScan(
          qrLoginToken,
          qrLoginSignature,
          cookieHeader,
          pollState.callbackUrl,
        );
        cookieHeader = completion.cookieHeader;
        pollState = {
          status: completion.status,
          message: completion.message,
          callbackUrl: completion.callbackUrl,
        };
      }

      if (pollState.status === 'confirmed') {
        if (
          !hasLoggedInCookieHeader(cookieHeader) &&
          pollState.callbackUrl
        ) {
          try {
            cookieHeader = await this.fetchCookieFromCallback(
              pollState.callbackUrl,
            );
          } catch (error) {
            this.logger.warn(
              `快手扫码确认成功，但 callback 回跳取 Cookie 失败: ${String(
                error instanceof Error ? error.message : error,
              )}`,
            );
          }
        }

        if (!hasLoggedInCookieHeader(cookieHeader)) {
          this.logger.warn(
            `快手扫码确认成功，但响应中缺少可用登录 Cookie: ${JSON.stringify({
              result: payload?.result ?? null,
              message: pollState.message || null,
              hasCallback: !!pollState.callbackUrl,
            })}`,
          );
          return {
            status: 'failed',
            message: '扫码已确认，但未拿到有效快手 Cookie，请重试',
          };
        }

        await this.persistCookie(cookieHeader);
        return {
          status: 'confirmed',
          message: '登录成功，快手 Cookie 已保存',
        };
      }

      if (pollState.status === 'scanned') {
        return {
          status: 'scanned',
          message: pollState.message || '已扫码，请在快手 App 上确认登录',
        };
      }

      if (pollState.status === 'expired') {
        return {
          status: 'expired',
          message: this.getExpiredMessage(pollState.message),
        };
      }

      if (pollState.status === 'failed') {
        return {
          status: 'failed',
          message: pollState.message || '快手扫码登录失败',
        };
      }

      return {
        status: 'pending',
        message: pollState.message || '等待扫码确认',
      };
    } catch (error: any) {
      if (error?.code === 'ECONNABORTED') {
        return {
          status: 'pending',
          message: '等待扫码确认',
        };
      }
      throw error;
    }
  }

  async getStatus(): Promise<KuaishouAuthStatus> {
    const snapshot = await this.getSessionSnapshot();
    return {
      hasCookie: !!snapshot.cookie,
      source: snapshot.source,
      userId: getKuaishouUserId(snapshot.cookie),
      lastError: snapshot.lastError,
      lastCheckAt: snapshot.lastCheckAt ? snapshot.lastCheckAt.toISOString() : null,
      updatedAt: snapshot.entity?.updatedAt
        ? snapshot.entity.updatedAt.toISOString()
        : null,
    };
  }

  async getCookieHeader(): Promise<string> {
    const snapshot = await this.getSessionSnapshot();
    return snapshot.cookie;
  }

  async saveCookie(cookie: string): Promise<void> {
    const normalizedCookie = normalizeCookieHeader(cookie);
    if (!hasLoggedInCookieHeader(normalizedCookie)) {
      throw new BadRequestException('缺少有效的快手登录 Cookie');
    }

    await this.upsertSession({
      cookie: normalizedCookie,
      lastError: null,
      lastCheckAt: null,
    });
  }

  async clearSession(): Promise<void> {
    await this.sessionRepository.delete({ platform: 'kuaishou' });
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
      lastError: String(message || '').trim().slice(0, 255) || null,
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

  private createBaseHeaders(cookieHeader = ''): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': this.userAgent,
      Referer: 'https://www.kuaishou.com/',
      Origin: 'https://www.kuaishou.com',
    };

    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return headers;
  }

  private createFormBody(
    payload: Record<string, string | boolean | number | null | undefined>,
  ): URLSearchParams {
    const formData = new URLSearchParams();

    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) {
        continue;
      }
      formData.set(key, String(value));
    }

    return formData;
  }

  private resolvePollState(
    payload: any,
    cookieHeader: string,
  ): KuaishouPollState {
    const message = this.extractPollMessage(payload);
    const callbackUrl = this.extractCallbackUrl(payload);
    const resultCodes = this.extractResultCodes(payload);

    if (hasLoggedInCookieHeader(cookieHeader)) {
      return {
        status: 'confirmed',
        message,
        callbackUrl,
      };
    }

    const candidates = [
      payload?.status,
      payload?.qrStatus,
      payload?.loginStatus,
      payload?.scanStatus,
      payload?.state,
      payload?.data?.status,
      payload?.data?.qrStatus,
      payload?.data?.loginStatus,
      payload?.data?.scanStatus,
      payload?.data?.state,
    ]
      .map((item) => String(item || '').trim().toUpperCase())
      .filter(Boolean);

    if (
      candidates.some((value) =>
        ['CONFIRMED', 'SUCCESS', 'LOGGED_IN', 'PASSED'].includes(value),
      )
    ) {
      return {
        status: 'confirmed',
        message,
        callbackUrl,
      };
    }

    if (
      candidates.some((value) =>
        ['SCANNED', 'SCANNING', 'WAIT_CONFIRM', 'WAITING_CONFIRM'].includes(value),
      )
    ) {
      return {
        status: 'scanned',
        message: message || '已扫码，请在快手 App 上确认登录',
        callbackUrl,
      };
    }

    if (
      candidates.some((value) =>
        ['EXPIRED', 'TIMEOUT', 'QR_CODE_EXPIRED'].includes(value),
      )
    ) {
      return {
        status: 'expired',
        message: this.getExpiredMessage(message),
        callbackUrl,
      };
    }

    if (
      candidates.some((value) =>
        ['FAILED', 'CANCELLED', 'REJECTED', 'DENIED'].includes(value),
      )
    ) {
      return {
        status: 'failed',
        message,
        callbackUrl,
      };
    }

    if (
      this.looksLikeConfirmedMessage(message) ||
      (callbackUrl && resultCodes.includes(1))
    ) {
      return {
        status: 'confirmed',
        message,
        callbackUrl,
      };
    }

    if (resultCodes.includes(707) || this.looksLikeExpiredMessage(message)) {
      return {
        status: 'expired',
        message: this.getExpiredMessage(message),
        callbackUrl,
      };
    }

    if (this.looksLikeScannedMessage(message)) {
      return {
        status: 'scanned',
        message,
        callbackUrl,
      };
    }

    if (this.looksLikeFailedMessage(message)) {
      return {
        status: 'failed',
        message,
        callbackUrl,
      };
    }

    if (this.hasScannedUserInfo(payload)) {
      return {
        status: 'scanned',
        message: message || '已扫码，正在完成登录，请稍候',
        callbackUrl,
      };
    }

    return {
      status: 'pending',
      message,
      callbackUrl,
    };
  }

  private extractPollMessage(payload: any): string {
    const candidates = [
      payload?.msg,
      payload?.message,
      payload?.error_msg,
      payload?.errorMessage,
      payload?.errMsg,
      payload?.data?.msg,
      payload?.data?.message,
      payload?.data?.error_msg,
      payload?.data?.errorMessage,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) {
        return value;
      }
    }

    return '';
  }

  private extractCallbackUrl(payload: any): string | null {
    const candidates = [
      payload?.callback,
      payload?.callbackUrl,
      payload?.redirectUrl,
      payload?.redirectURL,
      payload?.data?.callback,
      payload?.data?.callbackUrl,
      payload?.data?.redirectUrl,
      payload?.data?.redirectURL,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) {
        return value;
      }
    }

    return null;
  }

  private extractResultCodes(payload: any): number[] {
    const rawCandidates = [
      payload?.result,
      payload?.code,
      payload?.errorCode,
      payload?.error_code,
      payload?.data?.result,
      payload?.data?.code,
      payload?.data?.errorCode,
      payload?.data?.error_code,
    ];

    return rawCandidates
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  private extractQrToken(payload: any): string | null {
    const candidates = [
      payload?.qrToken,
      payload?.qr_token,
      payload?.data?.qrToken,
      payload?.data?.qr_token,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) {
        return value;
      }
    }

    return null;
  }

  private hasScannedUserInfo(payload: any): boolean {
    const user = payload?.user || payload?.data?.user;
    return !!(
      user &&
      typeof user === 'object' &&
      Object.keys(user).length > 0
    );
  }

  private looksLikeConfirmedMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('登录成功') ||
      normalized.includes('已确认') ||
      normalized.includes('授权成功') ||
      normalized.includes('login success') ||
      normalized.includes('confirmed')
    );
  }

  private looksLikeScannedMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('已扫码') ||
      normalized.includes('待确认') ||
      normalized.includes('等待确认') ||
      normalized.includes('请确认') ||
      normalized.includes('scan success') ||
      normalized.includes('wait confirm')
    );
  }

  private looksLikeExpiredMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('过期') ||
      normalized.includes('失效') ||
      normalized.includes('expired') ||
      normalized.includes('timeout')
    );
  }

  private looksLikeFailedMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('失败') ||
      normalized.includes('拒绝') ||
      normalized.includes('取消') ||
      normalized.includes('denied') ||
      normalized.includes('failed') ||
      normalized.includes('cancel')
    );
  }

  private getExpiredMessage(message: string): string {
    if (this.looksLikeExpiredMessage(message)) {
      return '二维码已过期，请重新生成';
    }

    return message || '二维码已过期，请重新生成';
  }

  private async completeQrLoginAfterScan(
    qrLoginToken: string,
    qrLoginSignature: string,
    initialCookieHeader: string,
    fallbackCallbackUrl: string | null,
  ): Promise<KuaishouPollState & { cookieHeader: string }> {
    let cookieHeader = normalizeCookieHeader(initialCookieHeader);
    let callbackUrl = fallbackCallbackUrl;
    let message = '';

    try {
      const acceptResponse = await axios.post(
        'https://id.kuaishou.com/rest/c/infra/ks/qr/acceptResult',
        this.createFormBody({
          qrLoginToken,
          qrLoginSignature,
          sid: this.qrSid,
        }),
        {
          timeout: 25000,
          headers: this.createBaseHeaders(cookieHeader),
          validateStatus: () => true,
        },
      );

      const acceptPayload = acceptResponse.data || {};
      const acceptCookieHeader = extractCookieHeaderFromSetCookie(
        acceptResponse.headers?.['set-cookie'],
      );
      cookieHeader = this.mergeCookieHeaders(cookieHeader, acceptCookieHeader);
      callbackUrl = this.extractCallbackUrl(acceptPayload) || callbackUrl;

      const acceptState = this.resolvePollState(acceptPayload, cookieHeader);
      message = acceptState.message || message;
      this.logger.debug(
        `快手扫码 acceptResult 响应: ${JSON.stringify({
          resultCodes: this.extractResultCodes(acceptPayload),
          message: acceptState.message || null,
          status: acceptState.status,
          hasCallback: !!callbackUrl,
          hasQrToken: !!this.extractQrToken(acceptPayload),
          hasLoginCookie: hasLoggedInCookieHeader(cookieHeader),
          payload: acceptPayload,
        })}`,
      );

      if (hasLoggedInCookieHeader(cookieHeader)) {
        return {
          status: 'confirmed',
          message: message || '登录成功',
          callbackUrl,
          cookieHeader,
        };
      }

      if (acceptState.status === 'expired' || acceptState.status === 'failed') {
        return {
          status: acceptState.status,
          message: acceptState.message,
          callbackUrl,
          cookieHeader,
        };
      }

      const qrToken = this.extractQrToken(acceptPayload);
      if (qrToken) {
        const callbackResult = await this.completeQrCallback(
          qrToken,
          cookieHeader,
        );
        cookieHeader = this.mergeCookieHeaders(
          cookieHeader,
          callbackResult.cookieHeader,
        );
        callbackUrl = callbackResult.callbackUrl || callbackUrl;
        message = callbackResult.message || message;

        if (hasLoggedInCookieHeader(cookieHeader)) {
          return {
            status: 'confirmed',
            message: message || '登录成功',
            callbackUrl,
            cookieHeader,
          };
        }

        if (
          callbackResult.status === 'expired' ||
          callbackResult.status === 'failed'
        ) {
          return {
            status: callbackResult.status,
            message: callbackResult.message,
            callbackUrl,
            cookieHeader,
          };
        }
      }

      if (callbackUrl) {
        const callbackCookieHeader = await this.fetchCookieFromCallback(
          callbackUrl,
          cookieHeader,
        );
        cookieHeader = this.mergeCookieHeaders(cookieHeader, callbackCookieHeader);
      }

      return {
        status: hasLoggedInCookieHeader(cookieHeader) ? 'confirmed' : 'scanned',
        message:
          hasLoggedInCookieHeader(cookieHeader)
            ? message || '登录成功'
            : message || '已扫码，正在完成登录，请稍候',
        callbackUrl,
        cookieHeader,
      };
    } catch (error) {
      this.logger.warn(
        `快手扫码完成登录链路失败: ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
      return {
        status: 'scanned',
        message: message || '已扫码，正在完成登录，请稍候',
        callbackUrl,
        cookieHeader,
      };
    }
  }

  private async completeQrCallback(
    qrToken: string,
    initialCookieHeader: string,
  ): Promise<KuaishouPollState & { cookieHeader: string }> {
    const response = await axios.post(
      'https://id.kuaishou.com/pass/kuaishou/login/qr/callback',
      this.createFormBody({
        qrToken,
        sid: this.qrSid,
      }),
      {
        timeout: 15000,
        headers: this.createBaseHeaders(initialCookieHeader),
        maxRedirects: 0,
        validateStatus: () => true,
      },
    );

    const payload = response.data || {};
    let cookieHeader = this.mergeCookieHeaders(
      initialCookieHeader,
      extractCookieHeaderFromSetCookie(response.headers?.['set-cookie']),
    );
    const callbackUrl = String(response.headers?.location || '').trim() || null;
    cookieHeader = this.synthesizeCookieFromCallbackPayload(payload, cookieHeader);
    const callbackState = this.resolvePollState(payload, cookieHeader);
    const message = callbackState.message;

    this.logger.debug(
      `快手扫码 qr/callback 响应: ${JSON.stringify({
        statusCode: response.status,
        resultCodes: this.extractResultCodes(payload),
        message: message || null,
        location: callbackUrl,
        hasLoginCookie: hasLoggedInCookieHeader(cookieHeader),
        payload,
      })}`,
    );

    if (!hasLoggedInCookieHeader(cookieHeader) && callbackUrl) {
      const navigationCookieHeader = await this.fetchCookieFromCallback(
        callbackUrl,
        cookieHeader,
      );
      cookieHeader = this.mergeCookieHeaders(cookieHeader, navigationCookieHeader);
    }

    return {
      status: hasLoggedInCookieHeader(cookieHeader)
        ? 'confirmed'
        : callbackState.status,
      message,
      callbackUrl,
      cookieHeader,
    };
  }

  private async fetchCookieFromCallback(
    callbackUrl: string,
    initialCookieHeader = '',
  ): Promise<string> {
    let currentUrl = this.toAbsoluteCallbackUrl(callbackUrl);
    let cookieHeader = normalizeCookieHeader(initialCookieHeader);

    for (let index = 0; index < 5; index += 1) {
      const response = await axios.get(currentUrl, {
        timeout: 15000,
        headers: this.createNavigationHeaders(cookieHeader),
        maxRedirects: 0,
        validateStatus: () => true,
      });

      const responseCookieHeader = extractCookieHeaderFromSetCookie(
        response.headers?.['set-cookie'],
      );
      cookieHeader = normalizeCookieHeader(
        [cookieHeader, responseCookieHeader].filter(Boolean).join('; '),
      );
      this.logger.debug(
        `快手扫码 callback 响应: ${JSON.stringify({
          url: currentUrl,
          status: response.status,
          location: response.headers?.location || null,
          hasResponseCookie: !!responseCookieHeader,
          hasLoginCookie: hasLoggedInCookieHeader(cookieHeader),
        })}`,
      );

      if (hasLoggedInCookieHeader(cookieHeader)) {
        return cookieHeader;
      }

      const location = String(response.headers?.location || '').trim();
      const shouldFollowRedirect =
        response.status >= 300 && response.status < 400 && !!location;

      if (!shouldFollowRedirect) {
        break;
      }

      currentUrl = new URL(location, currentUrl).toString();
    }

    return cookieHeader;
  }

  private mergeCookieHeaders(...headers: string[]): string {
    return normalizeCookieHeader(headers.filter(Boolean).join('; '));
  }

  private synthesizeCookieFromCallbackPayload(
    payload: any,
    currentCookieHeader: string,
  ): string {
    const sid = String(payload?.sid || this.qrSid || '').trim();
    const authToken = this.extractCallbackToken(payload, [
      sid ? `${sid}.at` : '',
      'authToken',
      'token',
    ]);
    const serviceToken = this.extractCallbackToken(payload, [
      sid ? `${sid}_st` : '',
      'serviceToken',
    ]);
    const passToken = this.extractCallbackToken(payload, ['passToken']);
    const ssecurity = this.extractCallbackToken(payload, ['ssecurity']);
    const userId = this.extractCallbackToken(payload, [
      'userId',
      'userid',
      'user_id',
    ]);

    if (
      !authToken &&
      !serviceToken &&
      !passToken &&
      !ssecurity &&
      !userId
    ) {
      return currentCookieHeader;
    }

    const cookieMap = parseCookieHeader(currentCookieHeader);
    if (!cookieMap.did) {
      cookieMap.did = this.createSyntheticDid();
    }
    if (!cookieMap.clientid) {
      cookieMap.clientid = '3';
    }
    if (!cookieMap.kpf) {
      cookieMap.kpf = 'PC_WEB';
    }
    if (!cookieMap.kpn) {
      cookieMap.kpn = 'KUAISHOU_VISION';
    }

    if (sid && authToken) {
      cookieMap[`${sid}.at`] = authToken;
    }
    if (sid && serviceToken) {
      cookieMap[`${sid}_st`] = serviceToken;
    }
    if (authToken) {
      cookieMap['kuaishou.server.web_at'] = authToken;
    }
    if (serviceToken) {
      cookieMap['kuaishou.server.web_st'] = serviceToken;
    }
    if (passToken) {
      cookieMap.passToken = passToken;
    }
    if (ssecurity) {
      cookieMap.ssecurity = ssecurity;
    }
    if (userId) {
      cookieMap.userId = userId;
    }

    return normalizeCookieHeader(
      Object.entries(cookieMap)
        .map(([key, value]) => `${key}=${value}`)
        .join('; '),
    );
  }

  private extractCallbackToken(
    payload: any,
    keys: string[],
  ): string {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      const value = String(payload?.[key] || '').trim();
      if (value) {
        return value;
      }
    }

    return '';
  }

  private createSyntheticDid(): string {
    return `web_${randomUUID().replace(/-/g, '')}`;
  }

  private toAbsoluteCallbackUrl(callbackUrl: string): string {
    const value = String(callbackUrl || '').trim();
    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    const normalizedPath = value.startsWith('/') ? value : `/${value}`;
    return `https://www.kuaishou.com${normalizedPath}`;
  }

  private createNavigationHeaders(cookieHeader: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Referer: 'https://www.kuaishou.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    return headers;
  }

  private async getSessionSnapshot(): Promise<SessionSnapshot> {
    const dbSession = await this.sessionRepository.findOne({
      where: { platform: 'kuaishou' },
    });

    if (dbSession?.cookie) {
      const cookie = normalizeCookieHeader(dbSession.cookie);
      return {
        cookie,
        source: 'database',
        lastError: dbSession.lastError || null,
        lastCheckAt: dbSession.lastCheckAt || null,
        entity: dbSession,
      };
    }

    const envCookie = normalizeCookieHeader(process.env.KUAISHOU_COOKIE || '');
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

  private async persistCookie(cookie: string): Promise<void> {
    await this.upsertSession({
      cookie: normalizeCookieHeader(cookie),
      lastError: null,
      lastCheckAt: null,
    });
  }

  private async upsertSession(payload: {
    cookie: string;
    lastError: string | null;
    lastCheckAt: Date | null;
  }): Promise<void> {
    const current = await this.sessionRepository.findOne({
      where: { platform: 'kuaishou' },
    });

    if (current) {
      current.cookie = payload.cookie;
      current.lastError = payload.lastError;
      current.lastCheckAt = payload.lastCheckAt;
      await this.sessionRepository.save(current);
      return;
    }

    const created = this.sessionRepository.create({
      platform: 'kuaishou',
      cookie: payload.cookie,
      lastError: payload.lastError,
      lastCheckAt: payload.lastCheckAt,
    });
    await this.sessionRepository.save(created);
  }
}
