import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

interface SystemBannerNoticeInput {
  title?: string;
  message: string;
}

let handlerReady = false;
let permissionReady = false;
let permissionGranted = false;
let permissionRequesting: Promise<boolean> | null = null;

const enableForegroundBannerHandler = () => {
  if (handlerReady || Platform.OS !== 'ios') {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerReady = true;
};

const isPermissionGranted = (status: Notifications.NotificationPermissionsStatus) =>
  status.granted ||
  status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

const ensureNotificationPermission = async () => {
  if (Platform.OS !== 'ios') {
    return false;
  }

  if (permissionReady) {
    return permissionGranted;
  }

  if (permissionRequesting) {
    return permissionRequesting;
  }

  permissionRequesting = (async () => {
    try {
      const current = await Notifications.getPermissionsAsync();
      if (isPermissionGranted(current)) {
        permissionGranted = true;
        permissionReady = true;
        return true;
      }

      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: false,
        },
      });
      permissionGranted = isPermissionGranted(requested);
      permissionReady = true;
      return permissionGranted;
    } catch {
      permissionGranted = false;
      permissionReady = true;
      return false;
    } finally {
      permissionRequesting = null;
    }
  })();

  return permissionRequesting;
};

export const prepareSystemBannerNotice = () => {
  enableForegroundBannerHandler();
};

export const showSystemBannerNotice = async (input: SystemBannerNoticeInput) => {
  if (Platform.OS !== 'ios') {
    return false;
  }

  const message = String(input.message || '').trim();
  if (!message) {
    return false;
  }

  enableForegroundBannerHandler();
  const allowed = await ensureNotificationPermission();
  if (!allowed) {
    return false;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: String(input.title || '').trim() || undefined,
        body: message,
        sound: false,
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
};
