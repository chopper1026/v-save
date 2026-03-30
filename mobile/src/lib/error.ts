export const extractApiErrorMessage = (
  error: any,
  fallback = '请求失败，请稍后重试'
): string => {
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
