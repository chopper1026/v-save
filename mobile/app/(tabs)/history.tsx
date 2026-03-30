import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { ScrollToTopButton } from '@/components/scroll-to-top-button';
import { HistoryTabSkeleton } from '@/components/tab-first-render-skeletons';
import { colors } from '@/constants/theme';
import { api, toProxyUrl } from '@/lib/api';
import { buildMobileDownloadGetUrlRequest } from '@/lib/download-request';
import {
  DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE,
  isDouyinWatermarkFallbackCancelled,
  recoverPayloadAfterLateDouyinWatermarkFailure,
  requestPayloadWithDouyinWatermarkPolicy,
  shouldUseDouyinWatermarkConfirmFlow,
} from '@/lib/douyin-watermark-download';
import { showInAppTopToast } from '@/lib/in-app-toast';
import { shouldUseIosCompatibleFirstAttempt } from '@/lib/ios-bilibili-smart-start';
import { downloadToDevice, isIosPhotosIncompatibleError } from '@/lib/media';
import { createRuntimeTraceId } from '@/lib/runtime-telemetry';
import { showSystemBannerNotice } from '@/lib/system-banner-notice';
import { useTabScrollToTop } from '@/hooks/use-tab-scroll-to-top';
import { extractApiErrorCode, extractApiErrorMessage } from '@/lib/error';
import { useAuthStore } from '@/store/auth-store';
import type {
  DownloadGetUrlPayload,
  DownloadHistoryItem,
  HistoryListResponse,
  ParsedVideo,
} from '@/types/api';

const VIDEO_FILE_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const AUDIO_FILE_EXTS = new Set(['m4a', 'aac', 'mp3', 'wav', 'ogg', 'opus', 'flac']);
const HISTORY_PAGE_SIZE = 20;
const HISTORY_PLATFORM_FILTER_OPTIONS: Array<{
  value: 'all' | DownloadHistoryItem['platform'];
  label: string;
}> = [
  { value: 'all', label: '全部平台' },
  { value: 'douyin', label: '抖音' },
  { value: 'bilibili', label: 'B站' },
  { value: 'kuaishou', label: '快手' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'youtube', label: 'YouTube' },
];
const HISTORY_DATE_FILTER_OPTIONS = [
  { value: 'all', label: '全部日期' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
] as const;
type HistoryDateFilter = (typeof HISTORY_DATE_FILTER_OPTIONS)[number]['value'];

const PLATFORM_BADGE: Record<
  DownloadHistoryItem['platform'],
  {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    textColor: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  douyin: {
    label: '抖音',
    icon: 'musical-notes-outline',
    textColor: '#0F172A',
    bgColor: '#E2E8F0',
    borderColor: '#CBD5E1',
  },
  bilibili: {
    label: 'B站',
    icon: 'tv-outline',
    textColor: '#1D4ED8',
    bgColor: '#DBEAFE',
    borderColor: '#BFDBFE',
  },
  xiaohongshu: {
    label: '小红书',
    icon: 'heart-outline',
    textColor: '#BE123C',
    bgColor: '#FFE4E6',
    borderColor: '#FECDD3',
  },
  kuaishou: {
    label: '快手',
    icon: 'flash-outline',
    textColor: '#B45309',
    bgColor: '#FFEDD5',
    borderColor: '#FED7AA',
  },
  youtube: {
    label: 'YouTube',
    icon: 'logo-youtube',
    textColor: '#B91C1C',
    bgColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  unknown: {
    label: '其他',
    icon: 'globe-outline',
    textColor: '#334155',
    bgColor: '#E2E8F0',
    borderColor: '#CBD5E1',
  },
};

const normalizeExt = (ext: string, isAudio: boolean): string => {
  const normalized = String(ext || '')
    .replace('.', '')
    .trim()
    .toLowerCase();
  if (isAudio) {
    return AUDIO_FILE_EXTS.has(normalized) ? normalized : 'm4a';
  }
  return VIDEO_FILE_EXTS.has(normalized) ? normalized : 'mp4';
};

const toLocalDateString = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateRangeParams = (filter: HistoryDateFilter) => {
  const end = new Date();
  if (filter === 'all') {
    return {
      dateFrom: undefined,
      dateTo: undefined,
    };
  }

  if (filter === 'today') {
    const today = toLocalDateString(end);
    return {
      dateFrom: today,
      dateTo: today,
    };
  }

  const days = filter === '7d' ? 7 : 30;
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return {
    dateFrom: toLocalDateString(start),
    dateTo: toLocalDateString(end),
  };
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

const REDOWNLOAD_ERROR_MESSAGE_MAP: Record<string, string> = {
  [DOUYIN_WATERMARK_FALLBACK_REQUIRED_CODE]:
    '当前仅检测到带水印线路，请确认后继续下载。',
  ...MEMBERSHIP_RESTRICTION_MESSAGE_MAP,
  DOWNLOAD_TIMEOUT: '下载超时，请稍后重试。',
  TASK_FILE_NOT_FOUND: '下载文件已失效，请重新发起下载。',
  IOS_PHOTOS_INCOMPATIBLE_CODEC: '当前视频编码与 iOS 相册不兼容，请更换视频后重试。',
};

const resolveFriendlyRedownloadMessage = (error: any): string => {
  const code = String(extractApiErrorCode(error) || '').trim().toUpperCase();
  if (code && REDOWNLOAD_ERROR_MESSAGE_MAP[code]) {
    return REDOWNLOAD_ERROR_MESSAGE_MAP[code];
  }

  const rawMessage = extractApiErrorMessage(error, '重新下载失败，请稍后重试');
  if (
    rawMessage.includes('PHPhotosErrorDomain error 3301')
    || rawMessage.toUpperCase().includes('IOS_PHOTOS_INCOMPATIBLE_CODEC')
  ) {
    return REDOWNLOAD_ERROR_MESSAGE_MAP.IOS_PHOTOS_INCOMPATIBLE_CODEC;
  }
  if (
    /request failed with status code|network error|error domain|phphotoserrordomain/i.test(
      rawMessage
    )
  ) {
    return '重新下载失败，请稍后重试';
  }
  return rawMessage;
};

export default function HistoryScreen() {
  const router = useRouter();
  const { listRef, scrollToTop, handleScroll, handleScrollEnd, showScrollToTop } =
    useTabScrollToTop<DownloadHistoryItem>('history');
  const token = useAuthStore((state) => state.token);
  const douyinWatermarkConsentByHistoryIdRef = useRef<Record<string, boolean>>({});
  const [items, setItems] = useState<DownloadHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [bulkOperating, setBulkOperating] = useState(false);
  const [error, setError] = useState('');
  const [platformFilter, setPlatformFilter] = useState<
    'all' | DownloadHistoryItem['platform']
  >('all');
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchHistory = useCallback(async (offset: number, mode: 'initial' | 'refresh' | 'append') => {
    if (!token) return;

    const isInitial = mode === 'initial';
    const isRefresh = mode === 'refresh';
    const isAppend = mode === 'append';
    const dateRange = getDateRangeParams(dateFilter);

    try {
      setError('');
      if (isInitial) setLoading(true);
      if (isRefresh) setRefreshing(true);
      if (isAppend) setLoadingMore(true);

      const response = await api.get<HistoryListResponse>('/download/history', {
        params: {
          limit: HISTORY_PAGE_SIZE,
          offset,
          includeStats: false,
          platform: platformFilter !== 'all' ? platformFilter : undefined,
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
        },
      });
      const rows = (response.data?.data || []) as DownloadHistoryItem[];
      const meta = response.data?.meta;
      if (isAppend) {
        setItems((prev) => [...prev, ...rows]);
      } else {
        setItems(rows);
      }

      if (meta) {
        setNextOffset(meta.nextOffset);
        setHasMore(meta.hasMore);
      } else {
        setNextOffset(offset + rows.length);
        setHasMore(rows.length === HISTORY_PAGE_SIZE);
      }
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(typeof message === 'string' ? message : '获取下载历史失败');
    } finally {
      if (isInitial) setLoading(false);
      if (isRefresh) setRefreshing(false);
      if (isAppend) setLoadingMore(false);
    }
  }, [dateFilter, platformFilter, token]);

  useEffect(() => {
    if (!token) {
      setItems([]);
      setNextOffset(0);
      setHasMore(true);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setSelectionMode(false);
      setSelectedIds([]);
      return;
    }

    void fetchHistory(0, 'initial');
  }, [fetchHistory, token]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }

    setSelectedIds((prev) => {
      const next = prev.filter((id) => items.some((item) => item.id === id));
      if (!next.length) {
        setSelectionMode(false);
      }
      return next;
    });
  }, [items, selectionMode]);

  const onRefresh = useCallback(async () => {
    await fetchHistory(0, 'refresh');
  }, [fetchHistory]);

  const onLoadMore = useCallback(() => {
    if (!token || loading || refreshing || loadingMore || !hasMore || selectionMode) {
      return;
    }
    void fetchHistory(nextOffset, 'append');
  }, [fetchHistory, hasMore, loading, loadingMore, nextOffset, refreshing, selectionMode, token]);

  const onDelete = async (id: string) => {
    try {
      setOperatingId(id);
      await api.delete(`/download/history/${id}`);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setNextOffset((prev) => Math.max(prev - 1, 0));
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
    } catch (err: any) {
      Alert.alert('删除失败', err?.response?.data?.message || '请稍后重试');
    } finally {
      setOperatingId(null);
    }
  };

  const onClearAll = async () => {
    if (bulkOperating) {
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '清空历史记录',
        '确认清空当前账号的全部下载历史记录吗？该操作不可撤销。',
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '清空', style: 'destructive', onPress: () => resolve(true) },
        ],
        {
          cancelable: true,
          onDismiss: () => resolve(false),
        }
      );
    });

    if (!confirmed) {
      return;
    }

    try {
      setBulkOperating(true);
      await api.delete('/download/history');
      setSelectionMode(false);
      setSelectedIds([]);
      await fetchHistory(0, 'refresh');
    } catch (err: any) {
      Alert.alert('清空失败', err?.response?.data?.message || '请稍后重试');
    } finally {
      setBulkOperating(false);
    }
  };

  const startSelectionMode = (id: string) => {
    setSelectionMode(true);
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const existed = prev.includes(id);
      if (existed) {
        const next = prev.filter((itemId) => itemId !== id);
        if (!next.length) {
          setSelectionMode(false);
        }
        return next;
      }
      return [...prev, id];
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const selectAll = () => {
    if (!items.length) {
      return;
    }
    setSelectionMode(true);
    setSelectedIds(items.map((item) => item.id));
  };

  const deleteSelected = async () => {
    if (!selectedIds.length || bulkOperating) {
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '删除选中记录',
        `确认删除已选中的 ${selectedIds.length} 条记录吗？`,
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '删除', style: 'destructive', onPress: () => resolve(true) },
        ],
        {
          cancelable: true,
          onDismiss: () => resolve(false),
        }
      );
    });

    if (!confirmed) {
      return;
    }

    try {
      setBulkOperating(true);
      await api.delete('/download/history/batch', {
        data: {
          ids: selectedIds,
        },
      });
      setSelectionMode(false);
      setSelectedIds([]);
      await fetchHistory(0, 'refresh');
    } catch (err: any) {
      Alert.alert('批量删除失败', err?.response?.data?.message || '请稍后重试');
    } finally {
      setBulkOperating(false);
    }
  };

  const onRedownload = async (item: DownloadHistoryItem) => {
    try {
      setOperatingId(item.id);
      const runtimeTraceId = createRuntimeTraceId('download');
      let finalDownloadUrl = item.downloadUrl || '';
      const isAudio = item.format === 'audio';
      let extension = normalizeExt(item.format || '', isAudio);
      let parsedVideo: ParsedVideo | null = null;

      if (item.sourceUrl) {
        const parsedRes = await api.post(
          '/download/parse',
          { url: item.sourceUrl, clientType: 'MOBILE' },
          {
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          }
        );
        parsedVideo = parsedRes.data?.data as ParsedVideo;
        if (!parsedVideo?.videoUrl) {
          throw new Error('重新解析失败，未获取到有效视频信息');
        }
        const buildVideoInfoPayload = () =>
          JSON.stringify({
            title: parsedVideo!.title,
            cover: parsedVideo!.cover,
            duration: parsedVideo!.duration,
            platform: parsedVideo!.platform,
            author: parsedVideo!.author,
            sourceUrl: item.sourceUrl,
            videoUrl: parsedVideo!.videoUrl,
            audioUrl: parsedVideo!.audioUrl || '',
            downloadOptions: parsedVideo!.downloadOptions || undefined,
            qualityStatus: parsedVideo!.qualityStatus,
            qualityRefreshKey: parsedVideo!.qualityRefreshKey,
            qualityMessage: parsedVideo!.qualityMessage,
          });

        const requestDownloadUrl = async (
          iosCompatible = false,
          allowWatermarkFallback?: boolean,
        ) => {
          const getUrlRes = await api.post(
            '/download/get-url',
            buildMobileDownloadGetUrlRequest({
              videoInfo: buildVideoInfoPayload(),
              format: item.format === 'audio' ? 'audio' : 'mp4',
              quality: item.quality || '720p',
              iosCompatible,
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
          return getUrlRes.data?.data as DownloadGetUrlPayload;
        };

        const shouldUseIosCompatFirstAttempt = shouldUseIosCompatibleFirstAttempt({
          parsedVideo,
          targetQuality: item.quality || '720p',
          format: isAudio ? 'audio' : 'video',
          os: Platform.OS,
        });
        const shouldRunDouyinWatermarkConfirmFlow =
          shouldUseDouyinWatermarkConfirmFlow({
            platform: parsedVideo.platform,
            isAudio,
            os: Platform.OS,
          });

        const requestDouyinAwarePayload = async (
          iosCompatible: boolean,
        ) => {
          return requestPayloadWithDouyinWatermarkPolicy({
            iosCompatible,
            session: {
              enabled: shouldRunDouyinWatermarkConfirmFlow,
              consentGranted:
                douyinWatermarkConsentByHistoryIdRef.current[item.id] === true,
              setConsentGranted: (next) => {
                douyinWatermarkConsentByHistoryIdRef.current[item.id] = next;
              },
            },
            requestPayload: requestDownloadUrl,
          });
        };

        const payload = await requestDouyinAwarePayload(
          shouldUseIosCompatFirstAttempt
        );
        finalDownloadUrl = payload.downloadUrl || finalDownloadUrl;
        extension = normalizeExt(payload.fileExtension || extension || '', isAudio);

        const saveCurrentDownload = async () => {
          const absolute = toProxyUrl(finalDownloadUrl, 'video', {
            runtimeTraceId,
            runtimeStage: 'download',
            runtimeClientType: 'MOBILE',
          });
          const requiresAuth =
            absolute.includes('/api/download/merge') ||
            absolute.includes('/api/download/tasks/');

          await downloadToDevice({
            url: absolute,
            fileName: item.videoTitle,
            fallbackExt: extension || 'mp4',
            authToken: requiresAuth ? token || undefined : undefined,
            extraHeaders: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          });
        };

        try {
          await saveCurrentDownload();
        } catch (error) {
          if (
            shouldRunDouyinWatermarkConfirmFlow &&
            douyinWatermarkConsentByHistoryIdRef.current[item.id] !== true &&
            !isIosPhotosIncompatibleError(error)
          ) {
            const recoveredPayload = await recoverPayloadAfterLateDouyinWatermarkFailure(
              {
                iosCompatible: shouldUseIosCompatFirstAttempt,
                session: {
                  enabled: true,
                  consentGranted:
                    douyinWatermarkConsentByHistoryIdRef.current[item.id] === true,
                  setConsentGranted: (next) => {
                    douyinWatermarkConsentByHistoryIdRef.current[item.id] = next;
                  },
                },
                requestPayload: requestDownloadUrl,
              }
            );
            if (recoveredPayload) {
              finalDownloadUrl = recoveredPayload.downloadUrl || finalDownloadUrl;
              extension = normalizeExt(
                recoveredPayload.fileExtension || extension || '',
                isAudio
              );
              await saveCurrentDownload();
            } else {
              throw error;
            }
          } else {
            const shouldRetryIosCompatible =
              Platform.OS === 'ios' &&
              !isAudio &&
              isIosPhotosIncompatibleError(error) &&
              !!item.sourceUrl &&
              !!parsedVideo;
            if (!shouldRetryIosCompatible) {
              throw error;
            }

            if (shouldUseIosCompatFirstAttempt) {
              throw error;
            }

            const iosPayload = await requestDouyinAwarePayload(true);
            finalDownloadUrl = iosPayload.downloadUrl || finalDownloadUrl;
            extension = normalizeExt(iosPayload.fileExtension || extension || '', false);
            await saveCurrentDownload();
          }
        }
      } else {
        if (!finalDownloadUrl) {
          throw new Error('未找到可用下载地址');
        }

        const absolute = toProxyUrl(finalDownloadUrl, 'video', {
          runtimeTraceId,
          runtimeStage: 'download',
          runtimeClientType: 'MOBILE',
        });
        const requiresAuth =
          absolute.includes('/api/download/merge') ||
          absolute.includes('/api/download/tasks/');

        await downloadToDevice({
          url: absolute,
          fileName: item.videoTitle,
          fallbackExt: extension || 'mp4',
          authToken: requiresAuth ? token || undefined : undefined,
          extraHeaders: {
            'x-runtime-trace-id': runtimeTraceId,
          },
        });
      }

      const systemShown = await showSystemBannerNotice({
        title: '下载成功',
        message: '已重新下载并尝试保存到系统目录',
      });
      if (!systemShown) {
        showInAppTopToast({
          title: '下载成功',
          message: '已重新下载并尝试保存到系统目录',
          level: 'success',
        });
      }
    } catch (err: any) {
      if (isDouyinWatermarkFallbackCancelled(err)) {
        return;
      }
      if (isIosPhotosIncompatibleError(err) || isIosPhotos3301Message(err)) {
        showInAppTopToast({
          title: '保存失败',
          message: '当前视频编码与 iOS 相册不兼容，请更换视频后重试。',
          level: 'warn',
        });
        return;
      }
      const restrictionCode = String(extractApiErrorCode(err) || '').trim().toUpperCase();
      const friendlyMessage = resolveFriendlyRedownloadMessage(err);
      if (isMembershipRestrictionCode(restrictionCode)) {
        goToAccountWithRestriction(router, restrictionCode, friendlyMessage);
        return;
      }
      showInAppTopToast({
        title: '重新下载失败',
        message: friendlyMessage,
        level: 'error',
      });
    } finally {
      setOperatingId(null);
    }
  };

  const renderSwipeDelete = (item: DownloadHistoryItem) => (
    <View style={styles.swipeActionWrap}>
      <Pressable
        style={styles.swipeDeleteBtn}
        onPress={() => {
          void onDelete(item.id);
        }}
        disabled={operatingId === item.id}
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={styles.swipeDeleteText}>删除</Text>
      </Pressable>
    </View>
  );

  const renderItem = ({ item }: { item: DownloadHistoryItem }) => {
    const badge = PLATFORM_BADGE[item.platform] ?? PLATFORM_BADGE.unknown;
    const selected = selectedIds.includes(item.id);

    const card = (
      <Pressable
        style={[
          styles.card,
          selectionMode ? styles.selectionCard : null,
          selected ? styles.selectedCard : null,
        ]}
        onLongPress={() => {
          if (!selectionMode) {
            startSelectionMode(item.id);
          }
        }}
        delayLongPress={220}
        onPress={() => {
          if (selectionMode) {
            toggleSelected(item.id);
          }
        }}
      >
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.videoTitle}
          </Text>
          <View style={styles.titleRowEnd}>
            {selectionMode && (
              <View
                style={[
                  styles.selectionIndicator,
                  selected ? styles.selectionIndicatorActive : null,
                ]}
              >
                {selected ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : null}
              </View>
            )}
            <View
              style={[
                styles.platformTag,
                { backgroundColor: badge.bgColor, borderColor: badge.borderColor },
              ]}
            >
              <Ionicons name={badge.icon} size={11} color={badge.textColor} />
              <Text style={[styles.platformTagText, { color: badge.textColor }]}>
                {badge.label}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.meta}>
          格式：{item.format || '--'} · 质量：{item.quality || '--'}
        </Text>
        <Text style={styles.meta}>时间：{new Date(item.createdAt).toLocaleString()}</Text>

        {!selectionMode && (
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => onRedownload(item)}
            disabled={operatingId === item.id}
          >
            <Ionicons name="download-outline" size={15} color={colors.primaryDark} />
            <Text style={styles.secondaryText}>
              {operatingId === item.id ? '处理中...' : '重新下载'}
            </Text>
          </Pressable>
        )}
      </Pressable>
    );

    if (selectionMode) {
      return card;
    }

    return (
      <Swipeable
        overshootRight={false}
        rightThreshold={32}
        renderRightActions={() => renderSwipeDelete(item)}
      >
        {card}
      </Swipeable>
    );
  };

  if (loading && !items.length) {
    return <HistoryTabSkeleton />;
  }

  return (
    <Screen scroll={false} bodyStyle={styles.page}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.25}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={styles.title}>下载历史</Text>
            <Text style={styles.subtitle}>
              {selectionMode
                ? `已进入多选模式，当前已选 ${selectedIds.length} 条`
                : '下拉可刷新，左滑可删除记录，长按可多选'}
            </Text>

            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>平台</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.filterChipRow}>
                  {HISTORY_PLATFORM_FILTER_OPTIONS.map((option) => {
                    const active = platformFilter === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[styles.filterChip, active ? styles.filterChipActive : null]}
                        onPress={() => {
                          setPlatformFilter(option.value);
                          setSelectionMode(false);
                          setSelectedIds([]);
                        }}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            active ? styles.filterChipTextActive : null,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>日期</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.filterChipRow}>
                  {HISTORY_DATE_FILTER_OPTIONS.map((option) => {
                    const active = dateFilter === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[styles.filterChip, active ? styles.filterChipActive : null]}
                        onPress={() => {
                          setDateFilter(option.value);
                          setSelectionMode(false);
                          setSelectedIds([]);
                        }}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            active ? styles.filterChipTextActive : null,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            <View
              style={[
                styles.headerActionRow,
                !selectionMode ? styles.headerActionRowRight : null,
              ]}
            >
              {selectionMode ? (
                <>
                  <Pressable style={styles.smallActionBtn} onPress={selectAll}>
                    <Ionicons name="checkmark-done-outline" size={14} color={colors.primaryDark} />
                    <Text style={styles.smallActionText}>全选</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallActionBtn, styles.deleteActionBtn]}
                    onPress={() => {
                      void deleteSelected();
                    }}
                    disabled={!selectedIds.length || bulkOperating}
                  >
                    <Ionicons name="trash-outline" size={14} color="#fff" />
                    <Text style={styles.deleteActionText}>
                      {bulkOperating ? '处理中' : '删除选中'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.smallActionBtn}
                    onPress={exitSelectionMode}
                    disabled={bulkOperating}
                  >
                    <Ionicons name="close-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.smallActionText}>取消</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={[styles.smallActionBtn, styles.deleteActionBtn]}
                  onPress={() => {
                    void onClearAll();
                  }}
                  disabled={bulkOperating}
                >
                  <Ionicons name="trash-outline" size={14} color="#fff" />
                  <Text style={styles.deleteActionText}>
                    {bulkOperating ? '清空中' : '一键清空'}
                  </Text>
                </Pressable>
              )}
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="file-tray-outline" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>暂无历史记录</Text>
            <Text style={styles.emptyText}>先去首页解析一个链接吧</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerWrap}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.footerText}>加载更多中...</Text>
            </View>
          ) : !hasMore && items.length > 0 ? (
            <View style={styles.footerWrap}>
              <Text style={styles.footerText}>没有更多记录了</Text>
            </View>
          ) : null
        }
      />
      <ScrollToTopButton visible={showScrollToTop} onPress={scrollToTop} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 118,
  },
  headerWrap: {
    marginBottom: 12,
    gap: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  filterGroup: {
    marginTop: 8,
    gap: 6,
  },
  filterLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
  },
  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#EAF1FF',
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: colors.primaryDark,
  },
  headerActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerActionRowRight: {
    justifyContent: 'flex-end',
  },
  smallActionBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: '#F7FAFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallActionText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  deleteActionBtn: {
    borderColor: '#EF4444',
    backgroundColor: '#EF4444',
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  error: {
    marginTop: 4,
    color: colors.danger,
    fontSize: 13,
  },
  emptyCard: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 12,
    gap: 6,
  },
  selectionCard: {
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FBFF',
  },
  selectedCard: {
    borderColor: colors.primary,
    backgroundColor: '#EEF4FF',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  selectionIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionIndicatorActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  platformTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  platformTagText: {
    fontSize: 11,
    fontWeight: '800',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  secondaryBtn: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: '#F7FAFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 9,
  },
  secondaryText: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 13,
  },
  swipeActionWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 94,
  },
  swipeDeleteBtn: {
    width: 84,
    height: 86,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  footerWrap: {
    paddingTop: 12,
    paddingBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
