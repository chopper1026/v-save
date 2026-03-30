import { useEffect } from 'react'
import { api } from '../lib/api'
import { useNotificationStore } from '../store/useNotificationStore'
import { useUserStore } from '../store/useUserStore'

export function useUnreadNotificationCount() {
  const isLoggedIn = useUserStore((state) => state.isLoggedIn)
  const unreadCount = useNotificationStore((state) => state.unreadCount)
  const setUnreadCount = useNotificationStore((state) => state.setUnreadCount)
  const resetUnreadCount = useNotificationStore((state) => state.resetUnreadCount)

  useEffect(() => {
    if (!isLoggedIn) {
      resetUnreadCount()
      return
    }

    let timer: number | null = null
    let cancelled = false

    const fetchUnreadCount = async () => {
      try {
        const response = await api.get('/notifications/unread-count')
        if (!cancelled && response.data?.success) {
          setUnreadCount(Number(response.data?.data?.count || 0))
        }
      } catch {
        // Keep the last known count on transient failures.
      }
    }

    void fetchUnreadCount()
    timer = window.setInterval(() => {
      void fetchUnreadCount()
    }, 60000)

    return () => {
      cancelled = true
      if (timer) {
        window.clearInterval(timer)
      }
    }
  }, [isLoggedIn, resetUnreadCount, setUnreadCount])

  return unreadCount
}
