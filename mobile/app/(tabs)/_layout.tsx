import { Platform, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useUnreadNotificationCount } from '@/hooks/use-unread-notification-count';

const iconByRoute: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'compass-outline',
  history: 'albums-outline',
  notifications: 'notifications-outline',
  account: 'person-circle-outline',
};

export default function TabsLayout() {
  const unread = useUnreadNotificationCount();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: {
          borderRadius: 12,
        },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={iconByRoute[route.name] || 'ellipse-outline'}
            size={size + 1}
            color={color}
          />
        ),
      })}
    >
      <Tabs.Screen name="home" options={{ title: '首页' }} />
      <Tabs.Screen name="history" options={{ title: '历史' }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: '通知',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
        }}
      />
      <Tabs.Screen name="account" options={{ title: '我的' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: 0,
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: Platform.OS === 'ios' ? 14 : 10,
    height: 66,
    paddingBottom: 8,
    paddingTop: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
});
