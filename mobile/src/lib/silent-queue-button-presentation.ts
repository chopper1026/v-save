import type { InAppToastInput } from '@/lib/in-app-toast';

export const SILENT_QUEUE_BUTTON_MIN_HEIGHT = 36;
export const SILENT_QUEUE_BUTTON_MIN_WIDTH = 116;

export const resolveSilentQueueButtonPresentation = ({
  enabled,
  count,
}: {
  enabled: boolean;
  count: number;
}): {
  countVisible: boolean;
  countLabel: string | null;
  minHeight: number;
  minWidth: number;
  iconName: 'moon' | 'moon-outline';
  tone: 'active' | 'idle';
} => {
  const normalized = Math.max(0, Math.trunc(Number(count) || 0));
  const visible = normalized > 0;

  return {
    countVisible: visible,
    countLabel: visible ? (normalized > 99 ? '99+' : String(normalized)) : null,
    minHeight: SILENT_QUEUE_BUTTON_MIN_HEIGHT,
    minWidth: SILENT_QUEUE_BUTTON_MIN_WIDTH,
    iconName: enabled ? 'moon' : 'moon-outline',
    tone: enabled ? 'active' : 'idle',
  };
};

export const resolveSilentQueueToggleFeedback = (
  nextEnabled: boolean
): InAppToastInput => {
  if (nextEnabled) {
    return {
      title: '静默下载已开启',
      message: '新的分享链接会直接加入静默下载队列。',
      level: 'success',
      durationMs: 2200,
    };
  }

  return {
    title: '静默下载已关闭',
    message: '新的分享链接会回到首页解析，不再自动入队。',
    level: 'info',
    durationMs: 2200,
  };
};
