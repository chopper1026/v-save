const isLocalhostLike = (value: string): boolean => {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const resolveNetworkErrorMessage = (
  error: any,
  apiBaseUrl: string,
): string | null => {
  const message = String(error?.message || '').trim();
  const code = String(error?.code || '').trim().toUpperCase();
  const hasResponse = Boolean(error?.response);
  if (hasResponse) {
    return null;
  }

  const isNetworkFailure =
    message === 'Network Error'
    || code === 'ERR_NETWORK'
    || code === 'ECONNABORTED';
  if (!isNetworkFailure) {
    return null;
  }

  const normalizedApiBaseUrl = String(apiBaseUrl || '').trim();
  if (isLocalhostLike(normalizedApiBaseUrl)) {
    return `无法连接到后端：当前 API 地址为 ${normalizedApiBaseUrl}。iOS 真机不能访问 localhost，请改成 http://<局域网IP>:3001/api 并重启 App。`;
  }

  return `无法连接到后端：请确认 ${normalizedApiBaseUrl || 'API 地址'} 可从当前设备访问，并确保后端服务已启动。`;
};

export const extractApiErrorMessage = (
  error: any,
  fallback = '请求失败，请稍后重试',
  options?: {
    apiBaseUrl?: string;
  }
): string => {
  const networkMessage = resolveNetworkErrorMessage(
    error,
    options?.apiBaseUrl || '',
  );
  if (networkMessage) {
    return networkMessage;
  }

  const payload = error?.response?.data;
  const message = payload?.message;

  if (Array.isArray(message)) {
    return message[0] || fallback;
  }
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
};

export const extractApiErrorCode = (error: any): string => {
  const payload = error?.response?.data;
  const directCode = payload?.code;
  if (typeof directCode === 'string' && directCode.trim()) {
    return directCode.trim();
  }

  const nestedCode = payload?.message?.code;
  if (typeof nestedCode === 'string' && nestedCode.trim()) {
    return nestedCode.trim();
  }

  return '';
};

export const extractApiDebugDetails = (error: any): string => {
  const method = String(error?.config?.method || 'GET').toUpperCase();
  const baseURL = String(error?.config?.baseURL || '').replace(/\/+$/, '');
  const requestPath = String(error?.config?.url || '');
  const requestUrl = requestPath.startsWith('http')
    ? requestPath
    : `${baseURL}${requestPath.startsWith('/') ? '' : '/'}${requestPath}`;
  const status = error?.response?.status;
  const code = error?.code;
  const payload = error?.response?.data;
  const payloadMessage = Array.isArray(payload?.message)
    ? payload.message[0]
    : payload?.message;

  const chunks = [
    `method=${method}`,
    requestUrl ? `url=${requestUrl}` : '',
    status ? `status=${status}` : '',
    code ? `code=${code}` : '',
    typeof payloadMessage === 'string' ? `api=${payloadMessage}` : '',
  ].filter(Boolean);

  return chunks.join(' | ');
};
