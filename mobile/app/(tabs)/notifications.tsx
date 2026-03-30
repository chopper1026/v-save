import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { ScrollToTopButton } from '@/components/scroll-to-top-button';
import { NotificationsTabSkeleton } from '@/components/tab-first-render-skeletons';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import {
  getNotificationActionPresentation,
  type PendingNotificationAction,
} from '@/lib/notification-action-presentation';
import { useTabScrollToTop } from '@/hooks/use-tab-scroll-to-top';
import { useUnreadNotificationStore } from '@/store/unread-notification-store';
import type { NotificationItem, NotificationListResponse } from '@/types/api';

const PAGE_SIZE = 20;

export default function NotificationsScreen() {
  const { listRef, scrollToTop, handleScroll, handleScrollEnd, showScrollToTop } =
    useTabScrollToTop<NotificationItem>('notifications');
  const unreadCount = useUnreadNotificationStore((state) => state.count);
  const setUnreadCount = useUnreadNotificationStore((state) => state.setCount);
  const decrementUnreadCount = useUnreadNotificationStore((state) => state.decrement);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingNotificationAction>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const hasMore = useMemo(() => page * PAGE_SIZE < total, [page, total]);
  const visibleUnreadCount = useMemo(
    () => items.reduce((count, item) => count + (item.isRead ? 0 : 1), 0),
    [items]
  );
  const effectiveUnreadCount = Math.max(unreadCount, visibleUnreadCount);

  const fetchPage = useCallback(async (nextPage: number, append = false) => {
    try {
      setError('');
      const response = await api.get<NotificationListResponse>('/notifications', {
        params: {
          page: nextPage,
          pageSize: PAGE_SIZE,
        },
      });

      const nextItems = (response.data?.data || []) as NotificationItem[];
      const nextTotal = Number(response.data?.meta?.total || 0);

      setTotal(nextTotal);
      setPage(nextPage);
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(typeof message === 'string' ? message : '通知加载失败');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await fetchPage(1);
      setLoading(false);
    })();
  }, [fetchPage]);

  useEffect(() => {
    if (visibleUnreadCount > unreadCount) {
      setUnreadCount(visibleUnreadCount);
    }
  }, [setUnreadCount, unreadCount, visibleUnreadCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPage(1);
    setRefreshing(false);
  }, [fetchPage]);

  const loadMore = async () => {
    if (!hasMore || paging || pendingAction || readingId) return;
    setPaging(true);
    await fetchPage(page + 1, true);
    setPaging(false);
  };

  const markOneRead = async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.isRead || pendingAction || readingId) {
      return;
    }

    try {
      setReadingId(id);
      setError('');
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                isRead: true,
                readAt: new Date().toISOString(),
              }
            : item
        )
      );
      decrementUnreadCount();
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(typeof message === 'string' ? message : '标记已读失败');
    } finally {
      setReadingId(null);
    }
  };

  const markAllRead = async () => {
    if (pendingAction || readingId || effectiveUnreadCount <= 0) {
      return;
    }

    try {
      setPendingAction('markAll');
      setError('');
      await api.patch('/notifications/read-all');
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt || new Date().toISOString(),
        }))
      );
      setUnreadCount(0);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(typeof message === 'string' ? message : '全部已读失败');
    } finally {
      setPendingAction(null);
    }
  };

  const clearAllNotifications = async () => {
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '清空通知',
        '确认清空当前账号的全部通知吗？该操作不可撤销。',
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
      setPendingAction('clearAll');
      setError('');
      await api.delete('/notifications/clear');
      setItems([]);
      setTotal(0);
      setPage(1);
      setUnreadCount(0);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(typeof message === 'string' ? message : '清空通知失败');
    } finally {
      setPendingAction(null);
    }
  };

  const isHeaderActionDisabled = Boolean(pendingAction || readingId || refreshing || paging);
  const markAllAction = getNotificationActionPresentation('markAll', pendingAction);
  const clearAllAction = getNotificationActionPresentation('clearAll', pendingAction);

  if (loading && !items.length) {
    return <NotificationsTabSkeleton />;
  }

  return (
    <Screen scroll={false} bodyStyle={styles.page}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        onEndReachedThreshold={0.6}
        onEndReached={loadMore}
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>通知中心</Text>
              <Text style={styles.subtitle}>系统事件和账号动态都会出现在这里</Text>
            </View>
            <View style={styles.actionRow}>
              <Pressable
                style={[
                  styles.actionBtn,
                  effectiveUnreadCount <= 0 && styles.disabledActionBtn,
                  isHeaderActionDisabled && styles.busyActionBtn,
                ]}
                onPress={markAllRead}
                disabled={isHeaderActionDisabled || effectiveUnreadCount <= 0}
              >
                <View style={styles.actionIconSlot}>
                  {markAllAction.busy ? (
                    <ActivityIndicator size="small" color={colors.primaryDark} />
                  ) : (
                    <Ionicons name="checkmark-done-outline" size={14} color={colors.primaryDark} />
                  )}
                </View>
                <Text style={styles.actionText}>{markAllAction.label}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.actionBtn,
                  styles.dangerActionBtn,
                  isHeaderActionDisabled && styles.busyDangerActionBtn,
                ]}
                onPress={clearAllNotifications}
                disabled={isHeaderActionDisabled}
              >
                <View style={styles.actionIconSlot}>
                  {clearAllAction.busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="trash-outline" size={14} color="#fff" />
                  )}
                </View>
                <Text style={styles.dangerActionText}>{clearAllAction.label}</Text>
              </Pressable>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="notifications-off-outline" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>暂无通知</Text>
            <Text style={styles.emptyText}>后续系统提醒会显示在这里</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, !item.isRead && styles.unreadCard]}
            onPress={() => {
              if (!item.isRead && !readingId && !pendingAction) {
                void markOneRead(item.id);
              }
            }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!item.isRead && <View style={styles.dot} />}
            </View>
            <Text style={styles.cardContent}>{item.content}</Text>
            <Text style={styles.meta}>
              {new Date(item.createdAt).toLocaleString()} · {item.source}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          hasMore ? (
            <View style={styles.footer}>
              {paging ? <ActivityIndicator color={colors.primary} size="small" /> : null}
              <Text style={styles.footerText}>{paging ? '加载更多中...' : '上滑加载更多'}</Text>
            </View>
          ) : items.length ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>已加载全部通知</Text>
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
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  muted: {
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 118,
  },
  headerRow: {
    marginBottom: 12,
    gap: 6,
  },
  headerTextWrap: {
    gap: 4,
  },
  actionRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    backgroundColor: '#EFF5FF',
    minWidth: 106,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionIconSlot: {
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 12,
  },
  disabledActionBtn: {
    opacity: 0.52,
  },
  busyActionBtn: {
    opacity: 0.86,
  },
  dangerActionBtn: {
    borderColor: '#EF4444',
    backgroundColor: '#EF4444',
  },
  busyDangerActionBtn: {
    opacity: 0.88,
  },
  dangerActionText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  error: {
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
    gap: 8,
  },
  unreadCard: {
    borderColor: '#BCD1FF',
    backgroundColor: '#F6F9FF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  cardContent: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
