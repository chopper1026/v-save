import { Platform } from 'react-native';
import { api, toProxyUrl } from '@/lib/api';
import { buildMobileDownloadGetUrlRequest } from '@/lib/download-request';
import {
  createRuntimeEventKey,
  createRuntimeTraceId,
  reportRuntimeClientEvent,
} from '@/lib/runtime-telemetry';
import { downloadToDevice } from '@/lib/media';
import { shouldUseIosCompatibleFirstAttempt } from '@/lib/ios-bilibili-smart-start';
import {
  shouldAttachAuthTokenToSilentDownloadUrl,
  shouldRetrySilentDownloadWithIosCompatibleFallback,
  shouldUseSilentDownloadAsyncTask,
} from '@/lib/silent-download-worker-policy';
import {
  buildSilentDownloadRuntimeFailureEvent,
  buildSilentDownloadRuntimeHeaders,
  buildSilentDownloadRuntimeSuccessEvent,
} from '@/lib/silent-download-worker-runtime';
import {
  createSilentDownloadWorkerProgressReporter,
  normalizeSilentDownloadWorkerError,
} from '@/lib/silent-download-worker-utils';
import type { DownloadGetUrlPayload, DownloadTaskPayload, ParsedVideo } from '@/types/api';
import { type FormatType, mapFormatToBackend, wait } from './download-flow';
import { SILENT_DOWNLOAD_FORMAT, buildSilentDownloadPlan } from './silent-download-planner';

const VIDEO_FILE_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);

const normalizeFileExt = (ext: string): string => {
  const normalized = String(ext || '')
    .replace('.', '')
    .trim()
    .toLowerCase();
  return VIDEO_FILE_EXTS.has(normalized) ? normalized : 'mp4';
};

const getTaskTerminalError = (task: DownloadTaskPayload): string | null => {
  if (task.status === 'failed') {
    return task.message?.trim() || '下载任务失败';
  }
  if (task.status === 'expired') {
    return task.message?.trim() || '任务文件已过期，请重新创建下载任务';
  }
  return null;
};

export interface SilentDownloadWorkerProgress {
  status?: 'parsing' | 'downloading' | 'saving';
  progress?: number;
  title?: string;
  quality?: string;
  platform?: ParsedVideo['platform'];
  runtimeTraceId?: string;
}

interface RunSilentDownloadTaskInput {
  sourceUrl: string;
  token: string;
  onProgress?: (progress: SilentDownloadWorkerProgress) => void;
}

export interface SilentDownloadWorkerResult {
  title: string;
  quality: string;
  platform: ParsedVideo['platform'];
  runtimeTraceId: string;
}

export const runSilentDownloadTask = async (
  input: RunSilentDownloadTaskInput
): Promise<SilentDownloadWorkerResult> => {
  const { sourceUrl, token, onProgress } = input;
  const parseStartedAt = Date.now();
  const parseTraceId = createRuntimeTraceId('parse');
  const parseEventKey = createRuntimeEventKey('parse');

  onProgress?.({
    status: 'parsing',
    progress: 1,
    runtimeTraceId: parseTraceId,
  });

  let parsed: ParsedVideo;
  try {
    const response = await api.post(
      '/download/parse',
      {
        url: sourceUrl,
        clientType: 'MOBILE',
      },
      {
        headers: {
          ...buildSilentDownloadRuntimeHeaders(parseTraceId),
        },
      }
    );

    parsed = response.data?.data as ParsedVideo;
    if (!parsed?.videoUrl) {
      throw new Error('解析结果为空');
    }

    reportRuntimeClientEvent(
      buildSilentDownloadRuntimeSuccessEvent({
        feature: 'parse',
        platform: parsed.platform,
        startedAt: parseStartedAt,
        eventKey: parseEventKey,
        traceId: parseTraceId,
      })
    );
  } catch (error) {
    reportRuntimeClientEvent(
      buildSilentDownloadRuntimeFailureEvent({
        feature: 'parse',
        platform: 'unknown',
        startedAt: parseStartedAt,
        eventKey: parseEventKey,
        traceId: parseTraceId,
        error,
        fallbackCode: 'PARSE_FAILED',
      })
    );
    throw error;
  }

  const downloadPlan = buildSilentDownloadPlan(parsed);
  const runtimeTraceId = parseTraceId;
  const downloadEventKey = createRuntimeEventKey('download');
  const downloadStartedAt = Date.now();

  const videoInfo = {
    title: parsed.title,
    cover: parsed.cover,
    duration: parsed.duration,
    platform: parsed.platform,
    author: parsed.author,
    sourceUrl,
    videoUrl: parsed.videoUrl,
    audioUrl: parsed.audioUrl || '',
    downloadOptions: parsed.downloadOptions || undefined,
    qualityStatus: parsed.qualityStatus,
    qualityRefreshKey: parsed.qualityRefreshKey,
    qualityMessage: parsed.qualityMessage,
  };

  const updateProgress = createSilentDownloadWorkerProgressReporter({
    title: parsed.title,
    quality: downloadPlan.quality,
    platform: parsed.platform,
    runtimeTraceId,
    onProgress,
  });

  const fetchDownloadPayload = async (
    iosCompatible: boolean
  ): Promise<DownloadGetUrlPayload | DownloadTaskPayload> => {
    if (
      shouldUseSilentDownloadAsyncTask({
        platform: parsed.platform,
        quality: downloadPlan.quality,
        iosCompatible,
      })
    ) {
      const taskResponse = await api.post(
        '/download/create-task',
        {
          sourceUrl,
          videoInfo: JSON.stringify(videoInfo),
          format: 'mp4',
          quality: downloadPlan.quality,
        },
        {
          headers: {
            ...buildSilentDownloadRuntimeHeaders(runtimeTraceId),
          },
        }
      );

      const taskId = taskResponse.data?.data?.id as string | undefined;
      if (!taskId) {
        throw new Error('创建下载任务失败');
      }

      for (let i = 0; i < 300; i += 1) {
        const taskResult = await api.get(`/download/tasks/${taskId}`, {
          headers: {
            ...buildSilentDownloadRuntimeHeaders(runtimeTraceId),
          },
        });
        const task = taskResult.data?.data as DownloadTaskPayload;
        if (!task) {
          throw new Error('下载任务不存在');
        }

        if (typeof task.progress === 'number') {
          updateProgress({
            status: 'downloading',
            progress: Math.max(1, Math.min(95, task.progress)),
          });
        }

        const terminalError = getTaskTerminalError(task);
        if (terminalError) {
          throw new Error(terminalError);
        }

        if (task.status === 'completed' && task.downloadUrl) {
          return task;
        }

        await wait(1200);
      }

      throw new Error('下载任务超时，请稍后重试');
    }

    const response = await api.post(
      '/download/get-url',
      buildMobileDownloadGetUrlRequest({
        videoInfo: JSON.stringify(videoInfo),
        format: mapFormatToBackend(SILENT_DOWNLOAD_FORMAT as FormatType),
        quality: downloadPlan.quality,
        iosCompatible,
        allowWatermarkFallback: false,
      }),
      {
        headers: {
          ...buildSilentDownloadRuntimeHeaders(runtimeTraceId),
        },
      }
    );

    const payload = response.data?.data as DownloadGetUrlPayload;
    if (!payload?.downloadUrl) {
      throw new Error('下载链接获取失败');
    }
    return payload;
  };

  const savePayload = async (payload: DownloadGetUrlPayload | DownloadTaskPayload) => {
    const rawDownloadUrl = payload.downloadUrl || '';
    const downloadUrl = toProxyUrl(rawDownloadUrl, 'video', {
      runtimeTraceId,
      runtimeStage: 'download',
      runtimeClientType: 'MOBILE',
    });
    const fileExtension = normalizeFileExt(payload.fileExtension || '');

    return downloadToDevice({
      url: downloadUrl,
      fileName: parsed.title || 'vsave-video',
      fallbackExt: fileExtension,
      authToken: shouldAttachAuthTokenToSilentDownloadUrl(downloadUrl) ? token : undefined,
      extraHeaders: {
        ...buildSilentDownloadRuntimeHeaders(runtimeTraceId),
      },
      onProgress: (progress) =>
        updateProgress({
          status: 'downloading',
          progress,
        }),
      onStageChange: (stage) =>
        updateProgress({
          status: stage,
          progress: stage === 'saving' ? 99 : undefined,
        }),
    });
  };

  updateProgress({
    status: 'downloading',
    progress: 5,
  });

  try {
    const shouldUseIosCompatFirstAttempt = shouldUseIosCompatibleFirstAttempt({
      parsedVideo: parsed,
      targetQuality: downloadPlan.quality,
      format: SILENT_DOWNLOAD_FORMAT,
      os: Platform.OS,
    });

    let payload = await fetchDownloadPayload(shouldUseIosCompatFirstAttempt);

    try {
      await savePayload(payload);
    } catch (error) {
      if (
        !shouldRetrySilentDownloadWithIosCompatibleFallback({
          os: Platform.OS,
          firstAttemptIosCompatible: shouldUseIosCompatFirstAttempt,
          error,
        })
      ) {
        throw error;
      }

      updateProgress({
        status: 'downloading',
        progress: 10,
      });
      payload = await fetchDownloadPayload(true);
      await savePayload(payload);
    }

    reportRuntimeClientEvent(
      buildSilentDownloadRuntimeSuccessEvent({
        feature: 'download',
        platform: parsed.platform,
        startedAt: downloadStartedAt,
        eventKey: downloadEventKey,
        traceId: runtimeTraceId,
      })
    );

    return {
      title: parsed.title || '未命名视频',
      quality: downloadPlan.quality,
      platform: parsed.platform,
      runtimeTraceId,
    };
  } catch (error) {
    reportRuntimeClientEvent(
      buildSilentDownloadRuntimeFailureEvent({
        feature: 'download',
        platform: parsed.platform,
        startedAt: downloadStartedAt,
        eventKey: downloadEventKey,
        traceId: runtimeTraceId,
        error,
        fallbackCode: 'DOWNLOAD_FAILED',
      })
    );
    throw normalizeSilentDownloadWorkerError(error);
  }
};
