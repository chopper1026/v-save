import { getSilentDownloadFinishedOrderValue } from '@/lib/silent-download-history-order';

interface SilentDownloadTaskPresentationLike {
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  finishedAt?: number;
}

export const resolveSilentDownloadTaskTimeMeta = (
  task: SilentDownloadTaskPresentationLike,
): {
  label: string;
  timestamp: number;
} => {
  if (task.status === 'completed') {
    return {
      label: '完成',
      timestamp: getSilentDownloadFinishedOrderValue(task),
    };
  }

  if (task.status === 'failed') {
    return {
      label: '失败',
      timestamp: getSilentDownloadFinishedOrderValue(task),
    };
  }

  return {
    label: '入队',
    timestamp: task.createdAt || 0,
  };
};
