interface NotificationListItem {
  id: string
  isRead: boolean
  readAt?: string | null
}

interface ApplyNotificationReadOptions {
  id: string
  unreadOnly: boolean
  readAt: string
}

interface ApplyMarkAllNotificationsReadOptions {
  unreadOnly: boolean
  readAt: string
}

export const applyNotificationReadLocally = <T extends NotificationListItem>(
  items: T[],
  options: ApplyNotificationReadOptions,
): T[] => {
  if (options.unreadOnly) {
    return items.filter((item) => item.id !== options.id)
  }

  return items.map((item) =>
    item.id === options.id
      ? ({
          ...item,
          isRead: true,
          readAt: options.readAt,
        } as T)
      : item,
  )
}

export const applyMarkAllNotificationsReadLocally = <T extends NotificationListItem>(
  items: T[],
  options: ApplyMarkAllNotificationsReadOptions,
): T[] => {
  if (options.unreadOnly) {
    return []
  }

  return items.map((item) => ({
    ...item,
    isRead: true,
    readAt: item.readAt || options.readAt,
  }) as T)
}
