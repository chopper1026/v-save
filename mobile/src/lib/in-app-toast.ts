import {
  ToastPosition,
  toast,
} from '@backpackapp-io/react-native-toast';
import { colors } from '@/constants/theme';

export type InAppToastLevel = 'success' | 'info' | 'warn' | 'error';

export interface InAppToastInput {
  title?: string;
  message: string;
  level?: InAppToastLevel;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 3000;

const levelPalette: Record<
  InAppToastLevel,
  {
    accent: string;
    border: string;
    background: string;
  }
> = {
  success: {
    accent: colors.success,
    border: '#CCE8DB',
    background: 'rgba(245,252,248,0.96)',
  },
  info: {
    accent: colors.primary,
    border: '#CADCFF',
    background: 'rgba(246,250,255,0.96)',
  },
  warn: {
    accent: colors.warning,
    border: '#F4DEBF',
    background: 'rgba(255,251,243,0.96)',
  },
  error: {
    accent: colors.danger,
    border: '#F2CACA',
    background: 'rgba(255,246,247,0.96)',
  },
};

const buildText = (title?: string, message?: string): string => {
  const safeTitle = String(title || '').trim();
  const safeMessage = String(message || '').trim();
  if (!safeTitle) {
    return safeMessage;
  }
  return `${safeTitle}\n${safeMessage}`;
};

export const dismissInAppTopToast = (): void => {
  toast.dismiss();
};

export const showInAppTopToast = (input: InAppToastInput): void => {
  const level = input.level || 'info';
  const text = buildText(input.title, input.message);
  if (!text) {
    return;
  }

  const durationMs =
    typeof input.durationMs === 'number' && input.durationMs > 0
      ? input.durationMs
      : DEFAULT_DURATION_MS;
  const palette = levelPalette[level];

  dismissInAppTopToast();

  const options = {
    duration: durationMs,
    position: ToastPosition.TOP,
    isSwipeable: true,
    maxWidth: 430,
    disableShadow: false,
    animationType: 'spring' as const,
    animationConfig: {
      damping: 21,
      stiffness: 260,
      mass: 0.85,
      flingPositionReturnDuration: 260,
    },
    styles: {
      pressable: {
        borderRadius: 18,
      },
      view: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: palette.border,
        borderLeftWidth: 4,
        borderLeftColor: palette.accent,
        backgroundColor: palette.background,
        shadowColor: '#0F172A',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
      },
      text: {
        color: colors.textPrimary,
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '600' as const,
        paddingVertical: 2,
      },
      indicator: {
        width: 0,
        marginRight: 0,
        backgroundColor: 'transparent',
      },
    },
  };

  if (level === 'success') {
    toast.success(text, options);
    return;
  }

  if (level === 'error') {
    toast.error(text, options);
    return;
  }

  if (level === 'warn') {
    toast(text, options);
    return;
  }

  toast(text, options);
};
