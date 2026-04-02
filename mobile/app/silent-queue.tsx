import { useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { colors } from '@/constants/theme';
import { buildShareAutoParseKey, extractSupportedVideoUrl } from '@/lib/link';
import {
  clearFinishedSilentDownloadTasks,
  enqueueSilentDownloadSourceUrl,
  removeSilentDownloadTask,
  resumeSilentDownloadQueue,
} from '@/lib/native-silent-download-bridge';
import { showInAppTopToast } from '@/lib/in-app-toast';
import { logSilentDownloadDebug } from '@/lib/silent-download-debug';
import { resolveSilentDownloadTaskTimeMeta } from '@/lib/silent-download-task-presentation';
import { useAuthStore } from '@/store/auth-store';
import {
  getSilentDownloadTaskSummary,
  type SilentDownloadTask,
  getLatestFinishedSilentDownloadTasks,
  useSilentDownloadQueueStore,
} from '@/store/silent-download-queue-store';
import { useIntentStore } from '@/store/intent-store';
import { useSilentDownloadSettingsStore } from '@/store/silent-download-settings-store';

const statusLabel: Record<SilentDownloadTask['status'], string> = {
  queued: '排队中',
  preparing: '准备中',
  parsing: '解析中',
  downloading: '下载中',
  saving: '保存中',
  completed: '已完成',
  failed: '失败',
};

const statusColor: Record<SilentDownloadTask['status'], string> = {
  queued: colors.textSecondary,
  preparing: colors.primary,
  parsing: colors.primary,
  downloading: colors.primary,
  saving: colors.success,
  completed: colors.success,
  failed: colors.danger,
};

const formatTime = (value?: number): string => {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
};

const TaskCard = ({
  task,
  onRemove,
}: {
  task: SilentDownloadTask;
  onRemove: (taskId: string) => void;
}) => {
  const color = statusColor[task.status];
  const timeMeta = resolveSilentDownloadTaskTimeMeta(task);
  return (
    <View style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <View style={styles.taskStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.taskStatusText, { color }]}>{statusLabel[task.status]}</Text>
        </View>
        {(task.status === 'completed' || task.status === 'failed') && (
          <Pressable onPress={() => onRemove(task.id)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <Text style={styles.taskTitle} numberOfLines={2}>
        {task.title || task.sourceUrl}
      </Text>
      <Text style={styles.taskMeta}>
        {task.platform ? `${task.platform.toUpperCase()} · ` : ''}
        {task.quality ? `${task.quality.toUpperCase()} · ` : ''}
        {timeMeta.label} {formatTime(timeMeta.timestamp)}
      </Text>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.max(4, Math.min(100, task.progress || 0))}%`, backgroundColor: color },
          ]}
        />
      </View>

      {task.errorMessage ? (
        <Text style={styles.taskError} numberOfLines={3}>
          {task.errorMessage}
        </Text>
      ) : null}
    </View>
  );
};

export default function SilentQueueScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const enabled = useSilentDownloadSettingsStore((state) => state.enabled);
  const setEnabled = useSilentDownloadSettingsStore((state) => state.setEnabled);
  const incomingUrl = useIntentStore((state) => state.incomingUrl);
  const consumeIncomingUrl = useIntentStore((state) => state.consumeIncomingUrl);
  const setShareAutoParsePending = useIntentStore((state) => state.setShareAutoParsePending);
  const tryAcquireAutoParse = useIntentStore((state) => state.tryAcquireAutoParse);
  const tasks = useSilentDownloadQueueStore((state) => state.tasks);
  const pausedReason = useSilentDownloadQueueStore((state) => state.pausedReason);
  const pauseMessage = useSilentDownloadQueueStore((state) => state.pauseMessage);
  const handledShareIntentKeyRef = useRef<string | null>(null);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  const enqueueSilentTask = (raw: string, source: string) => {
    const target = extractSupportedVideoUrl(raw || '');
    setShareAutoParsePending(false);
    if (!target) {
      logSilentDownloadDebug('queue:skip-invalid-url', {
        source,
        raw,
      });
      return;
    }
    const dedupKey = buildShareAutoParseKey(target) || target;
    const acquired = tryAcquireAutoParse(dedupKey, 20000);
    if (!acquired) {
      logSilentDownloadDebug('queue:dedupe-guard-hit', {
        source,
        target,
        dedupKey,
      });
      return;
    }
    void enqueueSilentDownloadSourceUrl(target).then(({ accepted }) => {
      logSilentDownloadDebug('queue:enqueue', {
        source,
        target,
        dedupKey,
        accepted,
      });
      if (!accepted) {
        showInAppTopToast({
          title: '加入静默队列失败',
          message: '该链接已在静默下载队列中等待处理',
          level: 'warn',
        });
      }
    });
  };

  useEffect(() => {
    if (!enabled || !incomingUrl) return;
    const consumed = consumeIncomingUrl();
    if (consumed) {
      enqueueSilentTask(consumed, '系统分享');
    }
  }, [consumeIncomingUrl, enabled, incomingUrl]);

  useEffect(() => {
    if (!enabled) {
      handledShareIntentKeyRef.current = null;
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
      enqueueSilentTask(candidate, '分享扩展');
    }

    resetShareIntent();
  }, [enabled, hasShareIntent, resetShareIntent, shareIntent.text, shareIntent.webUrl]);

  const { activeTask, finishedTasks } = useMemo(() => {
    const activeTask =
      tasks.find(
        (task) =>
          task.status === 'preparing' ||
          task.status === 'parsing' ||
          task.status === 'downloading' ||
          task.status === 'saving'
      ) ||
      tasks.find((task) => task.status === 'queued') ||
      null;

    return {
      activeTask,
      finishedTasks: getLatestFinishedSilentDownloadTasks(tasks),
    };
  }, [tasks]);
  const summary = getSilentDownloadTaskSummary(tasks);

  return (
    <Screen>
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.headerTitle}>静默下载队列</Text>
            <Text style={styles.headerSubtitle}>分享后不进预览，自动解析并下载最高画质</Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchTitle}>开启静默下载</Text>
            <Text style={styles.switchHint}>
              开启后，分享跳转会直接进入队列并开始自动下载。
            </Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} />
        </View>
      </View>

      {!token ? (
        <View style={styles.noticeCard}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.warning} />
          <Text style={styles.noticeText}>当前未登录。登录后，静默队列会自动开始执行。</Text>
        </View>
      ) : null}

      {pausedReason ? (
        <View style={styles.noticeCard}>
          <Ionicons name="pause-circle-outline" size={18} color={colors.warning} />
          <View style={styles.pausedNoticeContent}>
            <Text style={styles.noticeText}>
              {pauseMessage || '静默下载队列已暂停，请处理问题后手动恢复。'}
            </Text>
            <Pressable
              style={styles.resumeBtn}
              onPress={() => {
                void resumeSilentDownloadQueue();
              }}
            >
              <Text style={styles.resumeBtnText}>恢复队列</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.total}</Text>
          <Text style={styles.summaryLabel}>总任务</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.inFlight}</Text>
          <Text style={styles.summaryLabel}>等待中</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{summary.finished}</Text>
          <Text style={styles.summaryLabel}>已结束</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>当前任务</Text>
        </View>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            onRemove={(taskId) => {
              void removeSilentDownloadTask(taskId);
            }}
          />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>当前没有正在执行的静默下载任务。</Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>历史与结果</Text>
          {finishedTasks.length > 0 && (
            <Pressable
              onPress={() => {
                void clearFinishedSilentDownloadTasks();
              }}
            >
              <Text style={styles.clearText}>清空已完成/失败</Text>
            </Pressable>
          )}
        </View>

        {finishedTasks.length > 0 ? (
          finishedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onRemove={(taskId) => {
                void removeSilentDownloadTask(taskId);
              }}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>静默下载结果会在这里保留，便于你回头查看。</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#C8D9FF',
    backgroundColor: '#EAF1FF',
    padding: 14,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  headerTextGroup: {
    flex: 1,
    gap: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  switchHint: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    maxWidth: 250,
  },
  noticeCard: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFF6DF',
    borderWidth: 1,
    borderColor: '#F7D58A',
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  pausedNoticeContent: {
    flex: 1,
    gap: 8,
  },
  resumeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E7B955',
  },
  resumeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  listContent: {
    gap: 12,
    paddingBottom: 48,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  clearText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  taskCard: {
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  taskStatusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  taskMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  taskError: {
    fontSize: 12,
    color: colors.danger,
    lineHeight: 18,
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
});
