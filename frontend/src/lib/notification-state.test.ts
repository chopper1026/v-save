import { describe, expect, it } from 'vitest'
import {
  applyMarkAllNotificationsReadLocally,
  applyNotificationReadLocally,
} from './notification-state'

const buildItems = () => [
  {
    id: 'notification-1',
    title: '通知 1',
    content: '内容 1',
    isRead: false,
    readAt: null,
  },
  {
    id: 'notification-2',
    title: '通知 2',
    content: '内容 2',
    isRead: false,
    readAt: null,
  },
]

describe('notification state helpers', () => {
  it('removes a notification from the current list when unread-only view marks it as read', () => {
    const updated = applyNotificationReadLocally(buildItems(), {
      id: 'notification-1',
      unreadOnly: true,
      readAt: '2026-03-22T12:00:00.000Z',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe('notification-2')
  })

  it('keeps the notification in place and marks it as read outside unread-only view', () => {
    const updated = applyNotificationReadLocally(buildItems(), {
      id: 'notification-1',
      unreadOnly: false,
      readAt: '2026-03-22T12:00:00.000Z',
    })

    expect(updated).toHaveLength(2)
    expect(updated[0]).toMatchObject({
      id: 'notification-1',
      isRead: true,
      readAt: '2026-03-22T12:00:00.000Z',
    })
  })

  it('clears the visible list when unread-only view marks all notifications as read', () => {
    const updated = applyMarkAllNotificationsReadLocally(buildItems(), {
      unreadOnly: true,
      readAt: '2026-03-22T12:00:00.000Z',
    })

    expect(updated).toEqual([])
  })
})
