export type NotificationActionKind = 'markAll' | 'clearAll'
export type PendingNotificationAction = NotificationActionKind | null

const ACTION_LABELS: Record<NotificationActionKind, string> = {
  markAll: '全部已读',
  clearAll: '一键清空',
}

export const getNotificationActionPresentation = (
  action: NotificationActionKind,
  pendingAction: PendingNotificationAction,
) => ({
  label: ACTION_LABELS[action],
  busy: pendingAction === action,
})
