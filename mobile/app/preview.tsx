import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { VideoPreview } from '@/components/video-preview';
import { colors } from '@/constants/theme';
import {
  ASYNC_YOUTUBE_QUALITIES,
  type FormatType,
  getQualityList,
  getQualityOptionLabel,
  mapFormatToBackend,
  wait,
} from '@/lib/download-flow';
import { api, toProxyUrl } from '@/lib/api';
import { buildMobileDownloadGetUrlRequest } from '@/lib/download-request';
import {
  buildQualitySelectionKey,
  resolvePreferredQuality,
} from '@/lib/quality-selection';
import {
  DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE,
  isDouyinWatermarkFallbackCancelled,
  recoverPayloadAfterLateDouyinWatermarkFailure,
  requestPayloadWithDouyinWatermarkPolicy,
  shouldUseDouyinWatermarkConfirmFlow,
} from '@/lib/douyin-watermark-download';
import { shouldUseIosCompatibleFirstAttempt } from '@/lib/ios-bilibili-smart-start';
import { showInAppTopToast } from '@/lib/in-app-toast';
import { downloadToDevice, isIosPhotosIncompatibleError } from '@/lib/media';
import {
  createRuntimeTraceId,
  createRuntimeEventKey,
  normalizeRuntimeErrorCode,
  normalizeRuntimePlatform,
  reportRuntimeClientEvent,
} from '@/lib/runtime-telemetry';
import { showSystemBannerNotice } from '@/lib/system-banner-notice';
import { extractApiErrorCode, extractApiErrorMessage } from '@/lib/error';
import { useAuthStore } from '@/store/auth-store';
import { useParseStore } from '@/store/parse-store';
import type { DownloadGetUrlPayload, DownloadTaskPayload } from '@/types/api';

const QUALITY_HINT: Record<FormatType, string> = {
  video: '画质',
  audio: '音质',
  merge: '画质',
};
const VIDEO_FILE_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const AUDIO_FILE_EXTS = new Set(['m4a', 'aac', 'mp3', 'wav', 'ogg', 'opus', 'flac']);

const normalizeFileExt = (ext: string, format: FormatType): string => {
  const normalized = String(ext || '')
    .replace('.', '')
    .trim()
    .toLowerCase();

  if (format === 'audio') {
    return AUDIO_FILE_EXTS.has(normalized) ? normalized : 'm4a';
  }
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

const EXPIRED_TASK_HINTS = ['任务文件已过期', '文件已过期', '任务已过期'];

const isExpiredTaskMessage = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  return EXPIRED_TASK_HINTS.some((hint) => text.includes(hint));
};

const isIosPhotos3301Message = (error: any): boolean => {
  const text = String(error?.message || error || '');
  if (!text) {
    return false;
  }
  return (
    text.includes('PHPhotosErrorDomain error 3301') ||
    text.toUpperCase().includes('IOS_PHOTOS_INCOMPATIBLE_CODEC')
  );
};

const MEMBERSHIP_RESTRICTION_MESSAGE_MAP: Record<string, string> = {
  FREE_LIMIT_REACHED: '今日下载次数已用完，升级 VIP 可继续下载。',
  QUALITY_LIMIT_FOR_FREE: '免费用户最高支持 720P，请切换清晰度或升级 VIP。',
  FREE_PLATFORM_NOT_SUPPORTED: '免费用户当前仅支持抖音和哔哩哔哩，请升级 VIP 解锁全平台。',
};

const MEMBERSHIP_RESTRICTION_TITLE_MAP: Record<string, string> = {
  FREE_LIMIT_REACHED: '今日额度已用完',
  QUALITY_LIMIT_FOR_FREE: '当前画质受限',
  FREE_PLATFORM_NOT_SUPPORTED: '当前平台受限',
};

const isMembershipRestrictionCode = (code: string): boolean => Boolean(MEMBERSHIP_RESTRICTION_MESSAGE_MAP[code]);

const goToAccountWithRestriction = (
  router: ReturnType<typeof useRouter>,
  code: string,
  message: string,
) => {
  const title = MEMBERSHIP_RESTRICTION_TITLE_MAP[code] || '会员权益受限';
  showInAppTopToast({
    title,
    message,
    level: 'warn',
  });
  Alert.alert(title, message, [
    { text: '取消', style: 'cancel' },
    {
      text: '查看会员权益',
      onPress: () => router.push('/(tabs)/account'),
    },
  ]);
};

const DOWNLOAD_ERROR_MESSAGE_MAP: Record<string, string> = {
  [DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE]:
    '当前仅检测到带水印线路，请确认后继续下载。',
  ...MEMBERSHIP_RESTRICTION_MESSAGE_MAP,
  DOWNLOAD_TIMEOUT: '下载超时，请稍后重试。',
  TASK_FILE_NOT_FOUND: '下载文件已失效，请重新发起下载。',
  IOS_PHOTOS_INCOMPATIBLE_CODEC: '当前视频编码与 iOS 相册不兼容，请更换视频后重试。',
};

const resolveFriendlyDownloadMessage = (error: any): string => {
  const code = String(extractApiErrorCode(error) || '').trim().toUpperCase();
  if (code && DOWNLOAD_ERROR_MESSAGE_MAP[code]) {
    return DOWNLOAD_ERROR_MESSAGE_MAP[code];
  }

  const rawMessage = extractApiErrorMessage(error, '下载失败，请稍后重试');
  if (
    rawMessage.includes('PHPhotosErrorDomain error 3301')
    || rawMessage.toUpperCase().includes('IOS_PHOTOS_INCOMPATIBLE_CODEC')
  ) {
    return DOWNLOAD_ERROR_MESSAGE_MAP.IOS_PHOTOS_INCOMPATIBLE_CODEC;
  }
  if (
    /request failed with status code|network error|error domain|phphotoserrordomain/i.test(
      rawMessage
    )
  ) {
    return '下载失败，请稍后重试';
  }
  return rawMessage;
};

export default function PreviewScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const sourceUrl = useParseStore((state) => state.sourceUrl);
  const parsed = useParseStore((state) => state.parsedVideo);
  const clearParseResult = useParseStore((state) => state.clearParseResult);
  const suppressMissingParseDismissRef = useRef(false);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState('');
  const [format, setFormat] = useState<FormatType>('video');
  const [quality, setQuality] = useState('1080p');
  const previewStartedAtRef = useRef(Date.now());
  const previewEventKeyRef = useRef(createRuntimeEventKey('preview'));
  const previewOutcomeReportedRef = useRef(false);
  const douyinWatermarkConsentGrantedRef = useRef(false);
  const [manualQualitySelection, setManualQualitySelection] = useState<{
    key: string;
    value: string;
  } | null>(null);

  const qualityOptions = useMemo(() => getQualityList(parsed, format), [format, parsed]);
  const qualitySelectionKey = useMemo(
    () =>
      buildQualitySelectionKey({
        originalVideoUrl: parsed?.originalVideoUrl,
        qualityRefreshKey: parsed?.qualityRefreshKey,
        runtimeTraceId: parsed?.runtimeTraceId,
        format,
      }),
    [format, parsed?.originalVideoUrl, parsed?.qualityRefreshKey, parsed?.runtimeTraceId]
  );
  const selectedQuality = useMemo(
    () =>
      resolvePreferredQuality({
        qualityOptions,
        currentQuality:
          manualQualitySelection?.key === qualitySelectionKey
            ? manualQualitySelection.value
            : quality,
        autoSelectHighest: manualQualitySelection?.key !== qualitySelectionKey,
      }),
    [manualQualitySelection, quality, qualityOptions, qualitySelectionKey]
  );
  const canQuickRecreateTask = useMemo(
    () => !downloadLoading && !!parsed && isExpiredTaskMessage(error),
    [downloadLoading, error, parsed]
  );

  useEffect(() => {
    if (parsed?.originalVideoUrl) {
      suppressMissingParseDismissRef.current = false;
      return;
    }
    if (suppressMissingParseDismissRef.current) {
      return;
    }
    router.dismissTo('/(tabs)/home');
  }, [parsed?.originalVideoUrl, router]);

  useEffect(() => {
    if (!parsed?.originalVideoUrl) {
      return;
    }

    previewStartedAtRef.current = Date.now();
    previewEventKeyRef.current = createRuntimeEventKey('preview');
    previewOutcomeReportedRef.current = false;
    douyinWatermarkConsentGrantedRef.current = false;
  }, [parsed?.originalVideoUrl, parsed?.runtimeTraceId]);

  const reportPreviewOutcome = useCallback(
    (
      outcome: 'success' | 'failure',
      errorCode?: string,
      context?: {
        candidateCount?: number;
        selectedCandidateIndex?: number;
        failoverCount?: number;
        selectedCandidateKind?: string;
        selectedQuality?: string;
      }
    ) => {
      if (!parsed?.originalVideoUrl || previewOutcomeReportedRef.current) {
        return;
      }

      previewOutcomeReportedRef.current = true;
      reportRuntimeClientEvent({
        feature: 'preview',
        clientType: 'MOBILE',
        platform: normalizeRuntimePlatform(parsed.platform),
        outcome,
        latencyMs: Date.now() - previewStartedAtRef.current,
        errorCode,
        eventKey: previewEventKeyRef.current,
        traceId: parsed.runtimeTraceId,
        candidateCount: context?.candidateCount,
        selectedCandidateIndex: context?.selectedCandidateIndex,
        failoverCount: context?.failoverCount,
        selectedCandidateKind: context?.selectedCandidateKind,
        selectedQuality: context?.selectedQuality,
      });
    },
    [parsed?.originalVideoUrl, parsed?.platform, parsed?.runtimeTraceId]
  );

  const handleQualityChange = useCallback((nextQuality: string) => {
    setManualQualitySelection({
      key: qualitySelectionKey,
      value: nextQuality,
    });
    setQuality(nextQuality);
  }, [qualitySelectionKey]);

  const onDownload = useCallback(async () => {
    if (!token) {
      Alert.alert('请先登录', '登录后可继续下载', [
        { text: '取消', style: 'cancel' },
        { text: '去登录', onPress: () => router.replace('/(auth)/login') },
      ]);
      return;
    }

    if (!parsed?.originalVideoUrl) {
      setError('请先在首页完成解析');
      return;
    }
    const downloadStartedAt = Date.now();
    const runtimeTraceId =
      String(parsed.runtimeTraceId || '').trim() || createRuntimeTraceId('download');
    const downloadEventKey = createRuntimeEventKey('download');
    let hasReportedDownloadOutcome = false;
    const reportDownloadOutcome = (
      outcome: 'success' | 'failure',
      errorCode?: string
    ) => {
      if (hasReportedDownloadOutcome) {
        return;
      }
      hasReportedDownloadOutcome = true;
      reportRuntimeClientEvent({
        feature: 'download',
        clientType: 'MOBILE',
        platform: normalizeRuntimePlatform(parsed.platform),
        outcome,
        latencyMs: Date.now() - downloadStartedAt,
        errorCode,
        eventKey: downloadEventKey,
        traceId: runtimeTraceId,
      });
    };

    try {
      setDownloadLoading(true);
      setDownloadProgress(0);
      setError('');

      const downloadQuality = selectedQuality || qualityOptions[0] || '720p';
      const shouldUseIosCompatFirstAttempt = shouldUseIosCompatibleFirstAttempt({
        parsedVideo: parsed,
        targetQuality: downloadQuality,
        format,
        os: Platform.OS,
      });
      const videoInfo = {
        title: parsed.title,
        cover: parsed.originalCover,
        duration: parsed.duration,
        platform: parsed.platform,
        author: parsed.author,
        sourceUrl,
        videoUrl: parsed.originalVideoUrl,
        audioUrl: parsed.originalAudioUrl || '',
        downloadOptions: parsed.downloadOptions || undefined,
        qualityStatus: parsed.qualityStatus,
        qualityRefreshKey: parsed.qualityRefreshKey,
        qualityMessage: parsed.qualityMessage,
      };

      const fetchDownloadPayload = async ({
        targetQuality,
        iosCompatible,
        allowWatermarkFallback,
      }: {
        targetQuality: string;
        iosCompatible?: boolean;
        allowWatermarkFallback?: boolean;
      }): Promise<DownloadGetUrlPayload | DownloadTaskPayload> => {
        const preferIosCompatible = iosCompatible === true;
        const shouldUseAsyncYoutubeTask =
          parsed.platform === 'youtube' &&
          format !== 'audio' &&
          !preferIosCompatible &&
          ASYNC_YOUTUBE_QUALITIES.has(targetQuality);

        if (shouldUseAsyncYoutubeTask) {
          const taskResponse = await api.post(
            '/download/create-task',
            {
              sourceUrl,
              videoInfo: JSON.stringify(videoInfo),
              format: 'mp4',
              quality: targetQuality,
            },
            {
              headers: {
                'x-runtime-trace-id': runtimeTraceId,
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
                'x-runtime-trace-id': runtimeTraceId,
              },
            });
            const task = taskResult.data?.data as DownloadTaskPayload;

            if (!task) {
              throw new Error('下载任务不存在');
            }

            if (typeof task.progress === 'number') {
              setDownloadProgress(Math.max(1, Math.min(99, task.progress)));
            } else if (task.status === 'queued') {
              setDownloadProgress((prev) => Math.max(prev, 2));
            } else if (
              task.status === 'downloading' ||
              task.status === 'processing'
            ) {
              setDownloadProgress((prev) => Math.max(prev, 5));
            } else if (task.status === 'merging') {
              setDownloadProgress((prev) => Math.max(prev, 92));
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
            format: mapFormatToBackend(format),
            quality: targetQuality,
            iosCompatible: preferIosCompatible,
            ...(typeof allowWatermarkFallback === 'boolean'
              ? { allowWatermarkFallback }
              : {}),
          }),
          {
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          }
        );

        const payload = response.data?.data as DownloadGetUrlPayload;
        if (!payload?.downloadUrl) {
          throw new Error('下载链接获取失败');
        }
        return payload;
      };

      const saveByPayload = async (
        payload: DownloadGetUrlPayload | DownloadTaskPayload,
      ) => {
        const rawDownloadUrl = payload.downloadUrl || '';
        const downloadUrl = toProxyUrl(rawDownloadUrl, 'video', {
          runtimeTraceId,
          runtimeStage: 'download',
          runtimeClientType: 'MOBILE',
        });
        const fileExtension = normalizeFileExt(payload.fileExtension || '', format);
        const requiresAuthHeader =
          downloadUrl.includes('/api/download/merge') ||
          downloadUrl.includes('/api/download/tasks/');

        return downloadToDevice({
          url: downloadUrl,
          fileName: parsed.title || 'vsave-video',
          fallbackExt: fileExtension,
          authToken: requiresAuthHeader ? token : undefined,
          extraHeaders: {
            'x-runtime-trace-id': runtimeTraceId,
          },
          onProgress: (progress) => setDownloadProgress(progress),
        });
      };

      setDownloadProgress(0);
      const shouldRunDouyinWatermarkConfirmFlow =
        shouldUseDouyinWatermarkConfirmFlow({
          platform: parsed.platform,
          isAudio: format === 'audio',
          os: Platform.OS,
        });

      const requestDouyinAwarePayload = async (
        iosCompatible: boolean,
      ): Promise<DownloadGetUrlPayload | DownloadTaskPayload> => {
        return requestPayloadWithDouyinWatermarkPolicy({
          iosCompatible,
          session: {
            enabled: shouldRunDouyinWatermarkConfirmFlow,
            consentGranted: douyinWatermarkConsentGrantedRef.current,
            setConsentGranted: (next) => {
              douyinWatermarkConsentGrantedRef.current = next;
            },
          },
          requestPayload: (nextIosCompatible, allowWatermarkFallback) =>
            fetchDownloadPayload({
              targetQuality: downloadQuality,
              iosCompatible: nextIosCompatible,
              ...(typeof allowWatermarkFallback === 'boolean'
                ? { allowWatermarkFallback }
                : {}),
            }),
        });
      };

      const payload = await requestDouyinAwarePayload(
        shouldUseIosCompatFirstAttempt
      );

      let saveResult;
      try {
        saveResult = await saveByPayload(payload);
      } catch (error) {
        if (
          shouldRunDouyinWatermarkConfirmFlow &&
          !douyinWatermarkConsentGrantedRef.current &&
          !isIosPhotosIncompatibleError(error)
        ) {
          const recoveredPayload = await recoverPayloadAfterLateDouyinWatermarkFailure(
            {
              iosCompatible: shouldUseIosCompatFirstAttempt,
              session: {
                enabled: true,
                consentGranted: douyinWatermarkConsentGrantedRef.current,
                setConsentGranted: (next) => {
                  douyinWatermarkConsentGrantedRef.current = next;
                },
              },
              requestPayload: (nextIosCompatible, allowWatermarkFallback) =>
                fetchDownloadPayload({
                  targetQuality: downloadQuality,
                  iosCompatible: nextIosCompatible,
                  ...(typeof allowWatermarkFallback === 'boolean'
                    ? { allowWatermarkFallback }
                    : {}),
                }),
            }
          );
          if (recoveredPayload) {
            setDownloadProgress(0);
            saveResult = await saveByPayload(recoveredPayload);
          } else {
            throw error;
          }
        } else {
          const shouldRetryIosCompatible =
            Platform.OS === 'ios' &&
            format !== 'audio' &&
            isIosPhotosIncompatibleError(error);
          if (!shouldRetryIosCompatible) {
            throw error;
          }

          if (shouldUseIosCompatFirstAttempt) {
            throw error;
          }

          setDownloadProgress(0);
          const iosCompatiblePayload = await requestDouyinAwarePayload(true);
          saveResult = await saveByPayload(iosCompatiblePayload);
        }
      }

      setDownloadProgress(100);
      reportDownloadOutcome('success');
      let notice = '下载完成';
      if (saveResult.savedToLibrary) {
        notice = '下载成功，已保存到系统相册';
      } else if (saveResult.sharedToSystem) {
        notice = '下载完成，请在系统面板中保存到文件';
      } else {
        notice = '下载完成，文件保存在应用目录';
      }
      const systemShown = await showSystemBannerNotice({
        title: '下载成功',
        message: notice,
      });
      if (!systemShown) {
        showInAppTopToast({
          title: '下载成功',
          message: notice,
          level: 'success',
        });
      }
      suppressMissingParseDismissRef.current = true;
      clearParseResult();
      router.dismissTo('/(tabs)/home');
    } catch (err: any) {
      if (isDouyinWatermarkFallbackCancelled(err)) {
        setDownloadProgress(0);
        setError('');
        return;
      }
      if (isIosPhotosIncompatibleError(err) || isIosPhotos3301Message(err)) {
        reportDownloadOutcome('failure', 'IOS_PHOTOS_INCOMPATIBLE_CODEC');
        const friendlyMessage = '当前视频编码与 iOS 相册不兼容，请更换视频后重试。';
        setError(friendlyMessage);
        showInAppTopToast({
          title: '保存失败',
          message: friendlyMessage,
          level: 'warn',
        });
        return;
      }
      reportDownloadOutcome(
        'failure',
        normalizeRuntimeErrorCode(
          extractApiErrorCode(err) || err?.message,
          'DOWNLOAD_FAILED'
        )
      );
      const restrictionCode = String(extractApiErrorCode(err) || '').trim().toUpperCase();
      const friendlyMessage = resolveFriendlyDownloadMessage(err);
      setError(friendlyMessage);
      if (isMembershipRestrictionCode(restrictionCode)) {
        goToAccountWithRestriction(router, restrictionCode, friendlyMessage);
        return;
      }
      showInAppTopToast({
        title: '下载失败',
        message: friendlyMessage,
        level: 'error',
      });
    } finally {
      setDownloadLoading(false);
    }
  }, [
    clearParseResult,
    format,
    quality,
    qualitySelectionKey,
    selectedQuality,
    parsed,
    qualityOptions,
    router,
    sourceUrl,
    token,
  ]);

  if (!parsed) {
    return (
      <Screen scroll={false} bodyStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>正在返回首页...</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>预览与下载</Text>
        <Text style={styles.headerSubtitle}>选择格式和画质后，开始下载到相册</Text>
      </View>

      <VideoPreview
        title={parsed.title}
        platform={parsed.platform}
        author={parsed.author}
        duration={parsed.duration}
        cover={parsed.previewCoverUrl}
        candidates={parsed.previewVideoCandidates}
        onReady={(context) => reportPreviewOutcome('success', undefined, context)}
        onAllCandidatesFailed={(context) =>
          reportPreviewOutcome('failure', 'PREVIEW_READY_FAILED', context)
        }
      />

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>下载格式</Text>
        <View style={styles.row}>
          {(['video', 'audio', 'merge'] as FormatType[]).map((item) => (
            <Pressable
              key={item}
              style={[styles.optionBtn, format === item && styles.optionBtnActive]}
              onPress={() => setFormat(item)}
            >
              <Text style={[styles.optionText, format === item && styles.optionTextActive]}>
                {item === 'video' ? '视频' : item === 'audio' ? '音频' : '合并'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>{QUALITY_HINT[format]}</Text>
        {(parsed.qualityStatus === 'session_required' || parsed.qualityStatus === 'source_single_quality') && (
          <View style={styles.qualityNoticeMuted}>
            <Text style={styles.qualityNoticeMutedText}>
              {parsed.qualityMessage || (parsed.qualityStatus === 'source_single_quality'
                ? '小红书源站当前只返回单路视频，无法准确识别清晰度，将按原始线路下载。'
                : '服务端抖音登录态已失效，请联系后台重新登录。')}
            </Text>
          </View>
        )}
        <View style={styles.optionsWrap}>
          {qualityOptions.map((item) => (
            <Pressable
              key={item}
              style={[
                styles.optionChip,
                selectedQuality === item && styles.optionChipActive,
              ]}
              onPress={() => handleQualityChange(item)}
            >
              <Text
                style={[
                  styles.optionChipText,
                  selectedQuality === item && styles.optionChipTextActive,
                ]}
              >
                {getQualityOptionLabel(item)}
              </Text>
            </Pressable>
          ))}
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}
        {canQuickRecreateTask && (
          <Pressable style={styles.retryBtn} onPress={onDownload}>
            <Ionicons name="refresh-outline" size={15} color={colors.primaryDark} />
            <Text style={styles.retryBtnText}>一键重建下载任务</Text>
          </Pressable>
        )}

        <Pressable
          style={[
            styles.primaryBtn,
            { marginTop: 10 },
          ]}
          onPress={onDownload}
          disabled={downloadLoading}
        >
          {downloadLoading ? (
            <>
              <Ionicons name="cloud-download-outline" size={16} color="#fff" />
              <Text style={styles.primaryText}>下载中 {downloadProgress.toFixed(0)}%</Text>
            </>
          ) : (
            <>
              <Ionicons name="download-outline" size={16} color="#fff" />
              <Text style={styles.primaryText}>下载并保存到相册</Text>
            </>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  muted: {
    color: colors.textMuted,
  },
  headerCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C8D9FF',
    backgroundColor: '#EAF1FF',
    padding: 12,
    gap: 4,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  optionBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  optionTextActive: {
    color: colors.primaryDark,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  qualityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#C8D9FF',
    borderRadius: 12,
    backgroundColor: '#EEF4FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  qualityNoticeText: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
  qualityNoticeMuted: {
    borderWidth: 1,
    borderColor: '#F7D9B5',
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  qualityNoticeMutedText: {
    color: '#9A5B0F',
    fontSize: 12,
    fontWeight: '700',
  },
  optionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  optionChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  optionChipTextActive: {
    color: colors.primaryDark,
  },
  optionChipDisabled: {
    opacity: 0.55,
  },
  optionChipTextDisabled: {
    color: colors.textMuted,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  retryBtn: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  retryBtnText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '800',
  },
  primaryBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});
