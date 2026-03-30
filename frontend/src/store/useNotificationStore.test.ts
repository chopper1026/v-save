import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationStore } from './useNotificationStore'

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().resetUnreadCount()
  })

  it('decrements unread count immediately and never drops below zero', () => {
    useNotificationStore.getState().setUnreadCount(3)
    useNotificationStore.getState().decrementUnreadCount()
    useNotificationStore.getState().decrementUnreadCount(5)

    expect(useNotificationStore.getState().unreadCount).toBe(0)
  })
})
