const DEFAULT_API_BASE_URL = 'http://localhost:3001/api';
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

export const API_BASE_URL = configuredApiBaseUrl || DEFAULT_API_BASE_URL;

const isDevRuntime = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

if (isDevRuntime && !configuredApiBaseUrl) {
  console.warn(
    '[CONFIG] EXPO_PUBLIC_API_BASE_URL 未设置，当前使用默认地址 http://localhost:3001/api（真机通常无法访问）'
  );
}

export const APP_SCHEME = 'vsave';

export const API_ORIGIN = (() => {
  try {
    const parsed = new URL(API_BASE_URL);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://localhost:3001';
  }
})();
