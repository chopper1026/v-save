export interface SilentDownloadQueuePauseDecision {
  reason: 'photos_permission_required' | 'auth_required';
  message: string;
}

const extractErrorMessage = (error: any): string => {
  const payloadMessage = error?.response?.data?.message;
  if (typeof payloadMessage === 'string' && payloadMessage.trim()) {
    return payloadMessage.trim();
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return '';
};

export const resolveSilentDownloadQueuePause = (
  error: any,
): SilentDownloadQueuePauseDecision | null => {
  const message = extractErrorMessage(error);
  const status = Number(error?.response?.status || 0);

  if (message.includes('未获得相册权限')) {
    return {
      reason: 'photos_permission_required',
      message: '需要相册权限后才能继续执行静默下载队列，请授权后手动恢复队列。',
    };
  }

  if (status === 401 || status === 403) {
    return {
      reason: 'auth_required',
      message: '登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。',
    };
  }

  return null;
};
