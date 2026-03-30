import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';
import type { Platform, PreviewCandidate } from '@/types/api';
import {
  resolvePreviewPlaybackAction,
  type PreviewPlayerStatus,
} from '@/lib/preview-playback-policy';

const previewSessionSuccessMap = new Map<string, number>();

interface PreviewCallbackContext {
  candidateCount: number;
  selectedCandidateIndex: number;
  failoverCount: number;
  selectedCandidateKind?: string;
  selectedQuality?: string;
}

interface Props {
  title: string;
  author: string;
  cover: string;
  candidates: PreviewCandidate[];
  duration?: string;
  platform?: Platform;
  onReady?: (context: PreviewCallbackContext) => void;
  onAllCandidatesFailed?: (context: PreviewCallbackContext) => void;
}

const isHlsUrl = (value: string): boolean => /\.m3u8(\?|$)/i.test(value || '');
const PLATFORM_LABELS: Record<Platform, string> = {
  douyin: '抖音',
  bilibili: 'B站',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  youtube: 'YouTube',
  unknown: '未知',
};

const normalizePreviewUrl = (value: string): string => String(value || '').trim();

const getPreviewCandidateKey = (candidate: PreviewCandidate | null | undefined): string =>
  String(candidate?.identity || normalizePreviewUrl(candidate?.url || '')).trim();

const sortPreviewCandidatesBySessionHistory = (
  items: PreviewCandidate[]
): PreviewCandidate[] => {
  return items
    .map((item, index) => ({
      item,
      index,
      score: previewSessionSuccessMap.get(getPreviewCandidateKey(item)) || 0,
    }))
    .filter(({ item }) => /^https?:\/\//i.test(normalizePreviewUrl(item?.url || '')))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
};

export const VideoPreview = memo(function VideoPreview({
  title,
  author,
  cover,
  candidates: inputCandidates,
  duration,
  platform = 'unknown',
  onReady,
  onAllCandidatesFailed,
}: Props) {
  const candidates = useMemo(
    () =>
      (inputCandidates || []).filter((item) =>
        /^https?:\/\//i.test(normalizePreviewUrl(item?.url || ''))
      ),
    [inputCandidates]
  );
  const orderedCandidates = useMemo(
    () => sortPreviewCandidatesBySessionHistory(candidates),
    [candidates]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const reportedReadyRef = useRef(false);
  const reportedFailureRef = useRef(false);
  const candidateHadReadyRef = useRef(false);
  const phaseStartedAtRef = useRef(Date.now());
  const lastStatusRef = useRef<PreviewPlayerStatus>('idle');

  useEffect(() => {
    setCandidateIndex(0);
    reportedReadyRef.current = false;
    reportedFailureRef.current = false;
    setTerminalFailure(false);
    candidateHadReadyRef.current = false;
    phaseStartedAtRef.current = Date.now();
    lastStatusRef.current = 'idle';
  }, [orderedCandidates.map((item) => getPreviewCandidateKey(item)).join('|')]);

  const activeCandidate = orderedCandidates[candidateIndex] || null;
  const activeUrl = normalizePreviewUrl(activeCandidate?.url || '');
  const hasVideo = !!activeUrl;
  const source = hasVideo
    ? isHlsUrl(activeUrl)
      ? { uri: activeUrl, contentType: 'hls' as const }
      : { uri: activeUrl, contentType: 'auto' as const }
    : null;

  const player = useVideoPlayer(source, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
    videoPlayer.pause();
  });
  const statusEvent = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });
  const currentStatus = (statusEvent?.status || player.status || 'idle') as PreviewPlayerStatus;

  const buildCallbackContext = (): PreviewCallbackContext => ({
    candidateCount: orderedCandidates.length,
    selectedCandidateIndex: candidateIndex,
    failoverCount: Math.max(0, candidateIndex),
    selectedCandidateKind: activeCandidate?.sourceKind,
    selectedQuality: activeCandidate?.quality,
  });

  useEffect(() => {
    candidateHadReadyRef.current = false;
    phaseStartedAtRef.current = Date.now();
    lastStatusRef.current = currentStatus;
  }, [activeUrl]);

  useEffect(() => {
    if (currentStatus === lastStatusRef.current) {
      return;
    }

    if (currentStatus === 'loading' || currentStatus === 'idle') {
      phaseStartedAtRef.current = Date.now();
    }
    if (currentStatus === 'readyToPlay') {
      candidateHadReadyRef.current = true;
      phaseStartedAtRef.current = Date.now();
    }
    lastStatusRef.current = currentStatus;
  }, [currentStatus]);

  const handlePlaybackAction = (
    reason: 'startup_timeout' | 'buffering_timeout' | 'player_error',
    action: 'advance' | 'fail'
  ) => {
    if (action === 'advance') {
      setTerminalFailure(false);
      if (__DEV__) {
        console.log('[PREVIEW_FALLBACK]', {
          reason,
          candidateIndex,
          activeUrl,
          candidateCount: orderedCandidates.length,
        });
      }
      setCandidateIndex((prev) => (prev === candidateIndex ? prev + 1 : prev));
      return;
    }

    if (!reportedFailureRef.current) {
      reportedFailureRef.current = true;
      setTerminalFailure(true);
      onAllCandidatesFailed?.(buildCallbackContext());
    }
  };

  useEffect(() => {
    if (currentStatus !== 'readyToPlay' || !activeUrl || !activeCandidate) {
      return;
    }

    const currentKey = getPreviewCandidateKey(activeCandidate);
    const currentScore = previewSessionSuccessMap.get(currentKey) || 0;
    previewSessionSuccessMap.set(currentKey, currentScore + 1);
    if (!reportedReadyRef.current) {
      reportedReadyRef.current = true;
      onReady?.(buildCallbackContext());
    }
  }, [activeCandidate, activeUrl, currentStatus, onReady, orderedCandidates.length, candidateIndex]);

  useEffect(() => {
    const action = resolvePreviewPlaybackAction({
      status: currentStatus,
      candidateIndex,
      candidateCount: orderedCandidates.length,
      hadReady: candidateHadReadyRef.current,
      phaseStartedAtMs: phaseStartedAtRef.current,
      nowMs: Date.now(),
    });

    if (action.type === 'advance' || action.type === 'fail') {
      handlePlaybackAction(action.reason, action.type);
    }
  }, [activeUrl, candidateIndex, currentStatus, orderedCandidates.length]);

  useEffect(() => {
    if (!hasVideo || currentStatus === 'readyToPlay' || currentStatus === 'error') {
      return;
    }

    const timer = setInterval(() => {
      const action = resolvePreviewPlaybackAction({
        status: currentStatus,
        candidateIndex,
        candidateCount: orderedCandidates.length,
        hadReady: candidateHadReadyRef.current,
        phaseStartedAtMs: phaseStartedAtRef.current,
        nowMs: Date.now(),
      });

      if (action.type === 'advance' || action.type === 'fail') {
        handlePlaybackAction(action.reason, action.type);
      }
    }, 350);

    return () => clearInterval(timer);
  }, [candidateIndex, currentStatus, hasVideo, orderedCandidates.length]);

  const hasFallback = candidateIndex < orderedCandidates.length - 1;

  return (
    <View style={styles.card}>
      {hasVideo ? (
        <>
          <VideoView
            style={styles.video}
            player={player}
            nativeControls
            contentFit="contain"
          />
          {(terminalFailure ||
            currentStatus === 'error' ||
            (currentStatus === 'loading' && candidateIndex > 0)) && (
            <View style={styles.videoNotice}>
              <Text style={styles.videoNoticeText}>
                {terminalFailure || !hasFallback ? '预览失败，可直接下载' : '预览线路切换中...'}
              </Text>
            </View>
          )}
        </>
      ) : (
        <Image source={{ uri: cover }} style={styles.video} resizeMode="cover" />
      )}

      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.tag}>平台 {PLATFORM_LABELS[platform] || '未知'}</Text>
          <Text style={styles.tag}>时长 {duration || '--'}</Text>
          <Text style={styles.tag}>作者 {author || '--'}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: 220,
    backgroundColor: '#0B1220',
  },
  videoNotice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
  },
  videoNoticeText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  meta: {
    padding: 12,
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.cardAccent,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
