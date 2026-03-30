import { Alert } from 'react-native';
import { extractApiErrorCode } from '@/lib/error';
import type { Platform } from '@/types/api';

export const DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE =
  'DOUYIN_WATERMARK_FALLBACK_REQUIRED';

const USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_CODE =
  'USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK';
const USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_MESSAGE = '已取消下载';

interface DouyinWatermarkSession {
  enabled: boolean;
  consentGranted: boolean;
  setConsentGranted: (next: boolean) => void;
}

type RequestPayload<T> = (
  iosCompatible: boolean,
  allowWatermarkFallback?: boolean
) => Promise<T>;

const confirmDouyinWatermarkFallback = () =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      '检测到仅带水印线路',
      '当前无水印线路不可用，是否允许使用带水印线路继续下载？',
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: '继续下载', onPress: () => resolve(true) },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      }
    );
  });

const buildDouyinWatermarkFallbackCancelledError = (): Error & { code: string } => {
  const error = new Error(
    USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_MESSAGE
  ) as Error & { code: string };
  error.code = USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_CODE;
  return error;
};

const resolveInitialAllowWatermarkFallback = (
  session: DouyinWatermarkSession
): boolean | undefined => {
  if (!session.enabled) {
    return undefined;
  }
  return session.consentGranted ? true : false;
};

export const shouldUseDouyinWatermarkConfirmFlow = ({
  platform,
  isAudio,
  os,
}: {
  platform: Platform;
  isAudio: boolean;
  os: string;
}): boolean => {
  return os === 'ios' && platform === 'douyin' && !isAudio;
};

export const requestPayloadWithDouyinWatermarkPolicy = async <T>({
  iosCompatible,
  session,
  requestPayload,
}: {
  iosCompatible: boolean;
  session: DouyinWatermarkSession;
  requestPayload: RequestPayload<T>;
}): Promise<T> => {
  const allowWatermarkFallback = resolveInitialAllowWatermarkFallback(session);

  try {
    return await requestPayload(iosCompatible, allowWatermarkFallback);
  } catch (error) {
    if (
      !session.enabled ||
      session.consentGranted ||
      allowWatermarkFallback ||
      extractApiErrorCode(error) !== DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE
    ) {
      throw error;
    }

    const confirmed = await confirmDouyinWatermarkFallback();
    if (!confirmed) {
      throw buildDouyinWatermarkFallbackCancelledError();
    }

    session.setConsentGranted(true);
    return requestPayload(iosCompatible, true);
  }
};

export const recoverPayloadAfterLateDouyinWatermarkFailure = async <T>({
  iosCompatible,
  session,
  requestPayload,
}: {
  iosCompatible: boolean;
  session: DouyinWatermarkSession;
  requestPayload: RequestPayload<T>;
}): Promise<T | null> => {
  if (!session.enabled || session.consentGranted) {
    return null;
  }

  try {
    await requestPayload(iosCompatible, false);
    return null;
  } catch (error) {
    if (
      extractApiErrorCode(error) !== DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE
    ) {
      return null;
    }
  }

  const confirmed = await confirmDouyinWatermarkFallback();
  if (!confirmed) {
    throw buildDouyinWatermarkFallbackCancelledError();
  }

  session.setConsentGranted(true);
  return requestPayload(iosCompatible, true);
};

export const isDouyinWatermarkFallbackCancelled = (error: unknown): boolean => {
  return (
    (error as { code?: string } | null)?.code ===
      USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_CODE ||
    (error as { message?: string } | null)?.message ===
      USER_CANCELLED_DOUYIN_WATERMARK_FALLBACK_MESSAGE
  );
};
