import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '@/constants/theme';

interface SkeletonBlockProps {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({
  width = '100%',
  height,
  radius = 12,
  style,
}: SkeletonBlockProps) {
  return <View style={[styles.base, { width, height, borderRadius: radius }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.cardMuted,
    borderWidth: 1,
    borderColor: '#E4ECFA',
  },
});
