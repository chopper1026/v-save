import { useMemo } from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSegments } from 'expo-router';
import { colors } from '@/constants/theme';
import { resolveActiveTabSegment } from '@/lib/scroll-to-top';
import { useUnreadNotificationCount } from '@/hooks/use-unread-notification-count';
import { useTabScrollToTopStore } from '@/store/tab-scroll-to-top-store';

const badgeText = (count: number): string => (count > 99 ? '99+' : String(count));

export default function IosTabsLayout() {
  const unread = useUnreadNotificationCount();
  const segments = useSegments();
  const requestScrollToTop = useTabScrollToTopStore((state) => state.requestScrollToTop);
  const activeTab = useMemo(() => resolveActiveTabSegment(segments), [segments]);

  return (
    <NativeTabs
      tintColor={colors.primary}
      iconColor={{
        default: colors.textMuted,
        selected: colors.primary,
      }}
      labelStyle={{
        fontSize: 11,
        fontWeight: '700',
      }}
      backgroundColor="rgba(255,255,255,0.10)"
      blurEffect="systemChromeMaterial"
      shadowColor="rgba(15,23,42,0.10)"
      minimizeBehavior="onScrollDown"
      disableTransparentOnScrollEdge={false}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'house',
            selected: 'house.fill',
          }}
        />
        <NativeTabs.Trigger.Label>首页</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="history"
        listeners={{
          tabPress: () => {
            if (activeTab === 'history') {
              requestScrollToTop('history');
            }
          },
        }}
      >
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'clock',
            selected: 'clock.fill',
          }}
        />
        <NativeTabs.Trigger.Label>历史</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="notifications"
        listeners={{
          tabPress: () => {
            if (activeTab === 'notifications') {
              requestScrollToTop('notifications');
            }
          },
        }}
      >
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bell',
            selected: 'bell.fill',
          }}
        />
        <NativeTabs.Trigger.Label>通知</NativeTabs.Trigger.Label>
        {unread > 0 ? (
          <NativeTabs.Trigger.Badge>{badgeText(unread)}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'person.circle',
            selected: 'person.circle.fill',
          }}
        />
        <NativeTabs.Trigger.Label>我的</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
