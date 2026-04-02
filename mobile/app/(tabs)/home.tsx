import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useShareIntentContext } from 'expo-share-intent';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { colors } from '@/constants/theme';
import { buildParsedVideoView } from '@/lib/download-flow';
import { api } from '@/lib/api';
import { resolveHomeParseCtaState } from '@/lib/home-parse-cta';
import { showInAppTopToast } from '@/lib/in-app-toast';
import { buildShareAutoParseKey, extractSupportedVideoUrl } from '@/lib/link';
import {
  createRuntimeTraceId,
  createRuntimeEventKey,
  detectRuntimePlatformFromUrl,
  normalizeRuntimeErrorCode,
  normalizeRuntimePlatform,
  reportRuntimeClientEvent,
} from '@/lib/runtime-telemetry';
import { useIntentStore } from '@/store/intent-store';
import { useParseStore } from '@/store/parse-store';
import {
  getSilentDownloadTaskSummary,
  useSilentDownloadQueueStore,
} from '@/store/silent-download-queue-store';
import { useSilentDownloadSettingsStore } from '@/store/silent-download-settings-store';
import type { ParsedVideo } from '@/types/api';

const AUTO_PARSING_HINT_MIN_MS = 900;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeParseError = (error: any): { code?: string; message: string } => {
  const payload = error?.response?.data;
  const message = payload?.message;
  const code =
    payload?.code ||
    (typeof message === 'object' && message ? message.code : undefined);

  if (code === 'DOUYIN_NOTE_UNSUPPORTED') {
    return {
      code,
      message: '这是抖音图文链接，当前仅支持视频链接解析',
    };
  }

  if (code === 'DOUYIN_SESSION_REQUIRED') {
    return {
      code,
      message: '服务端抖音登录态已失效，请联系后台重新登录后再试',
    };
  }

  if (Array.isArray(message)) {
    return {
      code,
      message: message[0] || '解析失败',
    };
  }

  if (typeof message === 'string') {
    return {
      code,
      message,
    };
  }

  if (typeof message?.message === 'string') {
    return {
      code,
      message: message.message,
    };
  }

  return {
    code,
    message: '解析失败，请检查链接后重试',
  };
};

const PLATFORM_CHIPS = ['抖音', 'B站', '小红书', '快手', 'YouTube'];

export default function HomeScreen() {
  const router = useRouter();
  const [inputUrl, setInputUrl] = useState('');
  const [parseLoading, setParseLoading] = useState(false);
  const [autoParsing, setAutoParsing] = useState(false);
  const [error, setError] = useState('');
  const parseLockRef = useRef(false);
  const handledShareIntentKeyRef = useRef<string | null>(null);
  const silentQueuePulseAnim = useRef(new Animated.Value(0)).current;
  const silentDownloadEnabled = useSilentDownloadSettingsStore((state) => state.enabled);
  const silentDownloadSettingsHydrated = useSilentDownloadSettingsStore((state) => state.hydrated);
  const silentDownloadQueueHydrated = useSilentDownloadQueueStore((state) => state.hydrated);
  const enqueueSourceUrl = useSilentDownloadQueueStore((state) => state.enqueueSourceUrl);
  const silentQueueTasks = useSilentDownloadQueueStore((state) => state.tasks);

  const incomingUrl = useIntentStore((state) => state.incomingUrl);
  const shareAutoParsePending = useIntentStore((state) => state.shareAutoParsePending);
  const consumeIncomingUrl = useIntentStore((state) => state.consumeIncomingUrl);
  const setShareAutoParsePending = useIntentStore((state) => state.setShareAutoParsePending);
  const tryAcquireAutoParse = useIntentStore((state) => state.tryAcquireAutoParse);
  const setParseResult = useParseStore((state) => state.setParseResult);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  const parseFromInput = useCallback(
    async (raw: string, auto = false): Promise<boolean> => {
      const target = extractSupportedVideoUrl(raw || '');
      if (!target) {
        const hint = '未检测到可解析的视频链接，请粘贴视频作品链接';
        setError(hint);
        showInAppTopToast({
          title: '链接无效',
          message: hint,
          level: 'warn',
        });
        return false;
      }

      if (parseLockRef.current) {
        if (auto) {
          setShareAutoParsePending(false);
        }
        return false;
      }
      parseLockRef.current = true;
      const parseStartedAt = Date.now();
      const runtimeTraceId = createRuntimeTraceId('parse');
      const parseEventKey = createRuntimeEventKey('parse');

      try {
        setParseLoading(true);
        setAutoParsing(auto);
        setShareAutoParsePending(auto);
        setError('');

        const response = await api.post(
          '/download/parse',
          {
            url: target,
            clientType: 'MOBILE',
          },
          {
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          }
        );
        const data = response.data?.data as ParsedVideo;
        setParseResult(
          target,
          buildParsedVideoView(data, {
            runtimeTraceId,
            runtimeStage: 'preview',
            clientOs: Platform.OS,
          })
        );
        reportRuntimeClientEvent({
          feature: 'parse',
          clientType: 'MOBILE',
          platform: normalizeRuntimePlatform(data?.platform),
          outcome: 'success',
          latencyMs: Date.now() - parseStartedAt,
          eventKey: parseEventKey,
          traceId: runtimeTraceId,
        });
        router.push('/preview');
        return true;
      } catch (err: any) {
        reportRuntimeClientEvent({
          feature: 'parse',
          clientType: 'MOBILE',
          platform: detectRuntimePlatformFromUrl(target),
          outcome: 'failure',
          latencyMs: Date.now() - parseStartedAt,
          errorCode: normalizeRuntimeErrorCode(
            normalizeParseError(err).code || err?.message,
            'PARSE_FAILED'
          ),
          eventKey: parseEventKey,
          traceId: runtimeTraceId,
        });
        if (auto) {
          const elapsed = Date.now() - parseStartedAt;
          const remaining = AUTO_PARSING_HINT_MIN_MS - elapsed;
          if (remaining > 0) {
            await sleep(remaining);
          }
        }
        const normalized = normalizeParseError(err);
        const displayMessage = auto
          ? `自动解析失败：${normalized.message}`
          : normalized.message;
        setError(displayMessage);
        showInAppTopToast({
          title: auto ? '自动解析失败' : '解析失败',
          message: normalized.message,
          level: 'error',
        });
        return false;
      } finally {
        parseLockRef.current = false;
        setParseLoading(false);
        setAutoParsing(false);
        setShareAutoParsePending(false);
      }
    },
    [router, setParseResult, setShareAutoParsePending]
  );

  const triggerAutoParse = useCallback(
    (raw: string, source: string) => {
      const target = extractSupportedVideoUrl(raw || '');
      if (!target) {
        setShareAutoParsePending(false);
        return;
      }

      setInputUrl(target);

      const dedupKey = buildShareAutoParseKey(target) || target;
      const acquired = tryAcquireAutoParse(dedupKey, 20000);
      if (!acquired) {
        return;
      }

      setError('');
      setShareAutoParsePending(true);
      void parseFromInput(target, true);
    },
    [parseFromInput, setShareAutoParsePending, tryAcquireAutoParse]
  );

  const triggerSilentQueue = useCallback(
    (raw: string, source: string) => {
      const target = extractSupportedVideoUrl(raw || '');
      setShareAutoParsePending(false);
      if (!target) {
        return;
      }

      const { accepted } = enqueueSourceUrl(target);
      if (accepted) {
        silentQueuePulseAnim.stopAnimation();
        silentQueuePulseAnim.setValue(0);
        Animated.timing(silentQueuePulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          silentQueuePulseAnim.setValue(0);
        });
      } else {
        showInAppTopToast({
          title: '加入静默队列失败',
          message: '该链接已在静默下载队列中等待处理',
          level: 'warn',
        });
      }
    },
    [enqueueSourceUrl, setShareAutoParsePending, silentQueuePulseAnim]
  );

  useEffect(() => {
    if (!silentDownloadSettingsHydrated || !silentDownloadQueueHydrated) return;
    if (!incomingUrl) return;
    const consumed = consumeIncomingUrl();
    if (consumed) {
      if (silentDownloadEnabled) {
        triggerSilentQueue(consumed, '系统分享');
      } else {
        triggerAutoParse(consumed, '系统分享');
      }
    }
  }, [
    consumeIncomingUrl,
    incomingUrl,
    silentDownloadEnabled,
    silentDownloadQueueHydrated,
    silentDownloadSettingsHydrated,
    triggerAutoParse,
    triggerSilentQueue,
  ]);

  useEffect(() => {
    if (!silentDownloadSettingsHydrated || !silentDownloadQueueHydrated) {
      return;
    }
    if (!hasShareIntent) {
      handledShareIntentKeyRef.current = null;
      return;
    }

    const candidate =
      extractSupportedVideoUrl(shareIntent.webUrl || '') ||
      extractSupportedVideoUrl(shareIntent.text || '');

    const shareCycleKey = candidate
      ? buildShareAutoParseKey(candidate) || candidate
      : '__empty_share_intent__';

    if (handledShareIntentKeyRef.current === shareCycleKey) {
      return;
    }

    handledShareIntentKeyRef.current = shareCycleKey;

    if (candidate) {
      if (silentDownloadEnabled) {
        triggerSilentQueue(candidate, '分享扩展');
      } else {
        triggerAutoParse(candidate, '分享扩展');
      }
    }

    resetShareIntent();
  }, [
    hasShareIntent,
    resetShareIntent,
    shareIntent.text,
    shareIntent.webUrl,
    silentDownloadEnabled,
    silentDownloadQueueHydrated,
    silentDownloadSettingsHydrated,
    triggerAutoParse,
    triggerSilentQueue,
  ]);

  const { parseBusy, loadingText } = resolveHomeParseCtaState({
    parseLoading,
    autoParsing,
    shareAutoParsePending,
    incomingUrlPresent: Boolean(incomingUrl),
    hasShareIntent,
    silentDownloadEnabled,
  });

  const pulseOpacity = silentQueuePulseAnim.interpolate({
    inputRange: [0, 0.15, 0.75, 1],
    outputRange: [0, 1, 1, 0],
  });
  const pulseTranslateY = silentQueuePulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, -18],
  });
  const pulseScale = silentQueuePulseAnim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.7, 1, 1.05],
  });
  const silentQueueSummary = getSilentDownloadTaskSummary(silentQueueTasks);

  const doParse = useCallback(async () => {
    if (parseLockRef.current || parseLoading || shareAutoParsePending) {
      return;
    }
    const target = extractSupportedVideoUrl(inputUrl || '');
    if (!target) {
      const hint = '未检测到可解析的视频链接，请粘贴视频作品链接';
      setError(hint);
      showInAppTopToast({
        title: '链接无效',
        message: hint,
        level: 'warn',
      });
      return;
    }
    void parseFromInput(target, false);
  }, [inputUrl, parseFromInput, parseLoading, shareAutoParsePending]);

  const pasteFromClipboard = useCallback(async () => {
    if (parseLockRef.current || parseLoading || shareAutoParsePending) {
      return;
    }
    const text = await Clipboard.getStringAsync();
    if (!text?.trim()) {
      setError('剪贴板为空');
      return;
    }
    setInputUrl(text.trim());
    setError('');
  }, [parseLoading, shareAutoParsePending]);

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroBadge}>
            <Ionicons name="sparkles" size={12} color={colors.primaryDark} />
            <Text style={styles.heroBadgeText}>iOS 优先体验版</Text>
          </View>
          <Pressable
            style={[
              styles.silentQueueBtn,
              silentDownloadEnabled && styles.silentQueueBtnActive,
            ]}
            onPress={() => router.push('/silent-queue')}
          >
            <View style={styles.silentQueueBtnInner}>
            <Ionicons
              name={silentDownloadEnabled ? 'moon' : 'moon-outline'}
              size={13}
              color={silentDownloadEnabled ? '#fff' : colors.textPrimary}
            />
            <Text
              style={[
                styles.silentQueueBtnText,
                silentDownloadEnabled && styles.silentQueueBtnTextActive,
              ]}
            >
              静默下载
            </Text>
              {silentQueueSummary.inFlight > 0 ? (
                <View style={[styles.silentQueueCountPill, silentDownloadEnabled && styles.silentQueueCountPillActive]}>
                  <Text
                    style={[
                      styles.silentQueueCountText,
                      silentDownloadEnabled && styles.silentQueueCountTextActive,
                    ]}
                  >
                    {silentQueueSummary.inFlight}
                  </Text>
                </View>
              ) : null}
            </View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.silentQueuePulse,
                {
                  opacity: pulseOpacity,
                  transform: [
                    { translateY: pulseTranslateY },
                    { scale: pulseScale },
                  ],
                },
              ]}
            >
              <Text style={styles.silentQueuePulseText}>+1</Text>
            </Animated.View>
          </Pressable>
        </View>
        <Text style={styles.heroTitle}>V-SAVE</Text>
        <Text style={styles.heroSubtitle}>
          {silentDownloadEnabled
            ? '分享跳转后仍进入首页，但会自动加入静默队列并下载最高画质'
            : '分享链接一键解析，高清下载更顺滑'}
        </Text>

        <View style={styles.chipsWrap}>
          {PLATFORM_CHIPS.map((item) => (
            <View key={item} style={styles.chip}>
              <Text style={styles.chipText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.parseCard}>
        <View style={styles.parseHeader}>
          <Text style={styles.parseTitle}>智能解析</Text>
          <Text style={styles.parseHint}>支持分享文案自动提取链接</Text>
        </View>

        <TextInput
          value={inputUrl}
          onChangeText={setInputUrl}
          editable={!parseBusy}
          multiline
          placeholder="粘贴抖音/B站/小红书/快手/YouTube 链接"
          placeholderTextColor={colors.textMuted}
          style={styles.urlInput}
        />

        <View style={styles.row} pointerEvents={parseBusy ? 'none' : 'auto'}>
          <Pressable
            style={[styles.ghostBtn, styles.flex1, parseBusy && styles.btnDisabled]}
            onPress={pasteFromClipboard}
            disabled={parseBusy}
          >
            <Ionicons name="clipboard-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.ghostText}>粘贴</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, styles.flex1, parseBusy && styles.btnDisabled]}
            onPress={doParse}
            disabled={parseBusy}
          >
            {parseBusy ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.primaryText}>{loadingText}</Text>
              </View>
            ) : (
              <>
                <Ionicons name="rocket-outline" size={15} color="#fff" />
                <Text style={styles.primaryText}>解析链接</Text>
              </>
            )}
          </Pressable>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.tipsRow}>
        <View style={styles.tipCard}>
          <Ionicons name="flash-outline" size={18} color={colors.primary} />
          <Text style={styles.tipTitle}>自动去重</Text>
          <Text style={styles.tipText}>同一分享短时间内不会重复触发解析</Text>
        </View>
        <View style={styles.tipCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
          <Text style={styles.tipTitle}>稳定下载</Text>
          <Text style={styles.tipText}>保持用户选择画质，不自动降档</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 22,
    backgroundColor: '#DCEAFF',
    borderWidth: 1,
    borderColor: '#C4D8FF',
    padding: 16,
    shadowColor: colors.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    gap: 8,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#CCDCFF',
    alignItems: 'center',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  heroBadgeText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 12,
  },
  silentQueueBtn: {
    position: 'relative',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B5C9F5',
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  silentQueueBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  silentQueueBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  silentQueueBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  silentQueueBtnTextActive: {
    color: '#fff',
  },
  silentQueueCountPill: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D9E6FF',
  },
  silentQueueCountPillActive: {
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  silentQueueCountText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.primaryDark,
  },
  silentQueueCountTextActive: {
    color: '#fff',
  },
  silentQueuePulse: {
    position: 'absolute',
    right: -6,
    top: -8,
    borderRadius: 999,
    backgroundColor: colors.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  silentQueuePulseText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
  },
  heroTitle: {
    fontSize: 34,
    letterSpacing: 0.5,
    color: colors.primaryDark,
    fontWeight: '900',
  },
  heroSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: '#D0DEFB',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  parseCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  parseHeader: {
    gap: 4,
  },
  parseTitle: {
    fontSize: 20,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  parseHint: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  urlInput: {
    minHeight: 94,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.cardMuted,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  flex1: {
    flex: 1,
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
  ghostBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ghostText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.65,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  tipsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tipCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: '#FFFFFFCC',
    padding: 12,
    gap: 6,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  tipText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
