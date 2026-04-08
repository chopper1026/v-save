import type { InAppToastInput } from '@/lib/in-app-toast';
import type { SilentDownloadTaskStatus } from '@/store/silent-download-queue-store';

export const resolveSilentQueueRetryPresentation = ({
  platformOs,
  taskStatus,
  retrying,
}: {
  platformOs: string;
  taskStatus: SilentDownloadTaskStatus;
  retrying: boolean;
}): {
  visible: boolean;
  disabled: boolean;
  label: string;
} => {
  const visible = String(platformOs || '').toLowerCase() === 'ios' && taskStatus === 'failed';
  const disabled = visible && retrying;

  return {
    visible,
    disabled,
    label: disabled ? '重试中...' : '重试',
  };
};

export const resolveSilentQueueRetryFeedback = ({
  accepted,
}: {
  accepted: boolean;
}): InAppToastInput => {
  if (accepted) {
    return {
      title: '已加入重试队列',
      message: '失败任务已重新加入静默下载队列。',
      level: 'success',
      durationMs: 2200,
    };
  }

  return {
    title: '暂无法重试',
    message: '该视频已在静默下载队列中，请稍后查看结果。',
    level: 'warn',
    durationMs: 2400,
  };
};
