import type { EdgeInsets } from 'react-native-safe-area-context';

const resolveEdgeInset = (current: number, fallback: number): number =>
  current > 0 ? current : fallback;

export const resolveStableSafeAreaInsets = (
  currentInsets: EdgeInsets,
  fallbackInsets?: EdgeInsets | null,
): EdgeInsets => {
  if (!fallbackInsets) {
    return currentInsets;
  }

  return {
    top: resolveEdgeInset(currentInsets.top, fallbackInsets.top),
    right: resolveEdgeInset(currentInsets.right, fallbackInsets.right),
    bottom: resolveEdgeInset(currentInsets.bottom, fallbackInsets.bottom),
    left: resolveEdgeInset(currentInsets.left, fallbackInsets.left),
  };
};
