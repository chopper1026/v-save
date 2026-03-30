import axios from 'axios';
import { API_BASE_URL, API_ORIGIN } from '@/lib/env';
import { useAuthStore } from '@/store/auth-store';
import type { RuntimeTraceStage } from '@/lib/runtime-telemetry';
import type { ApiUser, MobileUser } from '@/types/api';

const PROXY_FETCH_BASE_URL = `${API_BASE_URL.replace(/\/+$/, '')}/proxy/fetch`;
const API_BASE_HOST = API_BASE_URL.replace(/\/+$/, '');

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (__DEV__) {
      const method = String(error?.config?.method || 'GET').toUpperCase();
      const baseURL = String(error?.config?.baseURL || '').replace(/\/+$/, '');
      const requestPath = String(error?.config?.url || '');
      const requestUrl = requestPath.startsWith('http')
        ? requestPath
        : `${baseURL}${requestPath.startsWith('/') ? '' : '/'}${requestPath}`;
      const status = error?.response?.status;
      const payload = error?.response?.data;

      console.error('[API_ERROR]', {
        method,
        requestUrl,
        status,
        code: error?.code,
        message: error?.message,
        response: payload,
      });
    }

    if (error?.response?.status === 401) {
      useAuthStore.getState().forceLogout();
    }
    return Promise.reject(error);
  }
);

export const mapApiUserToMobileUser = (user: ApiUser): MobileUser => {
  return {
    id: user.id,
    name: user.nickname || user.email.split('@')[0],
    email: user.email,
    role: user.role || 'USER',
    accountStatus: user.accountStatus || 'ACTIVE',
    phone: user.phone || null,
    avatar: user.avatar || undefined,
    downloadCount: user.downloadCount ?? 0,
  };
};

export const toAbsoluteApiUrl = (targetUrl: string): string => {
  const value = String(targetUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/api/')) {
    return `${API_ORIGIN}${value}`;
  }
  if (value.startsWith('/')) {
    return `${API_ORIGIN}${value}`;
  }
  return `${API_BASE_URL.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
};

export const toProxyUrl = (
  targetUrl: string,
  type: 'video' | 'image' = 'video',
  runtime?: {
    runtimeTraceId?: string;
    runtimeStage?: RuntimeTraceStage;
    runtimeClientType?: 'WEB' | 'MOBILE' | 'unknown';
  }
): string => {
  const value = String(targetUrl || '').trim();
  if (!value) return '';

  const appendRuntimeParams = (inputUrl: string): string => {
    const traceId = String(runtime?.runtimeTraceId || '').trim();
    const stage = String(runtime?.runtimeStage || '').trim();
    const clientType = String(runtime?.runtimeClientType || '').trim();
    if (!traceId && !stage && !clientType) {
      return inputUrl;
    }

    try {
      const parsed = new URL(inputUrl, API_ORIGIN);
      if (!parsed.pathname.includes('/proxy/fetch')) {
        return inputUrl;
      }
      if (traceId) {
        parsed.searchParams.set('runtimeTraceId', traceId);
      }
      if (stage) {
        parsed.searchParams.set('runtimeStage', stage);
      }
      if (clientType) {
        parsed.searchParams.set('runtimeClientType', clientType);
      }
      if (/^https?:\/\//i.test(inputUrl)) {
        return parsed.toString();
      }
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return inputUrl;
    }
  };

  if (value.includes('/api/proxy/fetch?')) {
    return appendRuntimeParams(value);
  }

  if (value.startsWith('/api/')) {
    return toAbsoluteApiUrl(value);
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (
        parsed.origin === API_ORIGIN &&
        parsed.pathname.startsWith('/api/')
      ) {
        return appendRuntimeParams(value);
      }
    } catch {
      // keep default proxy path for invalid absolute URLs
    }

    const params = new URLSearchParams({
      url: value,
      type,
    });
    const traceId = String(runtime?.runtimeTraceId || '').trim();
    const stage = String(runtime?.runtimeStage || '').trim();
    const clientType = String(runtime?.runtimeClientType || '').trim();
    if (traceId) {
      params.set('runtimeTraceId', traceId);
    }
    if (stage) {
      params.set('runtimeStage', stage);
    }
    if (clientType) {
      params.set('runtimeClientType', clientType);
    }

    return `${PROXY_FETCH_BASE_URL}?${params.toString()}`;
  }

  const absolute = `${API_BASE_HOST}/${value.replace(/^\/+/, '')}`;
  return appendRuntimeParams(absolute);
};
