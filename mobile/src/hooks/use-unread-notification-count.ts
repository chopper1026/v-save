import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useUnreadNotificationStore } from '@/store/unread-notification-store';

export function useUnreadNotificationCount() {
  const token = useAuthStore((state) => state.token);
  const unreadCount = useUnreadNotificationStore((state) => state.count);
  const setUnreadCount = useUnreadNotificationStore((state) => state.setCount);
  const resetUnreadCount = useUnreadNotificationStore((state) => state.reset);

  useEffect(() => {
    if (!token) {
      resetUnreadCount();
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    const fetchUnread = async () => {
      try {
        const response = await api.get('/notifications/unread-count');
        if (active) {
          const count = Number(response.data?.data?.count || 0);
          setUnreadCount(count);
        }
      } catch {
        // Keep the last known unread count on transient failures.
      }
    };

    void fetchUnread();
    timer = setInterval(() => {
      void fetchUnread();
    }, 60000);

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [token]);

  return unreadCount;
}
