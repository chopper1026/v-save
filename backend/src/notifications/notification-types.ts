export const NOTIFICATION_TYPES = {
  VIP_ACTIVATED: 'VIP_ACTIVATED',
  VIP_RENEWED: 'VIP_RENEWED',
  VIP_EXPIRE_SOON: 'VIP_EXPIRE_SOON',
  VIP_EXPIRED: 'VIP_EXPIRED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PHONE_CHANGED: 'PHONE_CHANGED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  MEMBERSHIP_UPDATED: 'MEMBERSHIP_UPDATED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_ENABLED: 'ACCOUNT_ENABLED',
  AUTH_RECOVERED: 'AUTH_RECOVERED',
  COOKIE_RISK: 'COOKIE_RISK',
  COOKIE_EXPIRED: 'COOKIE_EXPIRED',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationAudience = 'USER' | 'SUPER_ADMIN';

export const SUPER_ADMIN_ONLY_NOTIFICATION_TYPES: NotificationType[] = [
  NOTIFICATION_TYPES.AUTH_RECOVERED,
  NOTIFICATION_TYPES.COOKIE_RISK,
  NOTIFICATION_TYPES.COOKIE_EXPIRED,
];

const SUPER_ADMIN_ONLY_NOTIFICATION_TYPE_SET = new Set<string>(
  SUPER_ADMIN_ONLY_NOTIFICATION_TYPES,
);

export const isSuperAdminOnlyNotificationType = (type: string): boolean => {
  const normalized = String(type || '').trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  return SUPER_ADMIN_ONLY_NOTIFICATION_TYPE_SET.has(normalized);
};

export const resolveNotificationAudience = (
  type: string,
): NotificationAudience => {
  if (isSuperAdminOnlyNotificationType(type)) {
    return 'SUPER_ADMIN';
  }
  return 'USER';
};

