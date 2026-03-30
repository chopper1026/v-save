import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/theme';

interface ScrollToTopButtonProps {
  visible: boolean;
  onPress: () => void;
  bottom?: number;
}

export const ScrollToTopButton = ({
  visible,
  onPress,
  bottom = 104,
}: ScrollToTopButtonProps) => {
  const opacity = useSharedValue(visible ? 1 : 0);
  const translateY = useSharedValue(visible ? 0 : 12);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 180 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
    translateY.value = withTiming(visible ? 0 : 12, {
      duration: visible ? 220 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [opacity, translateY, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (Platform.OS !== 'ios') {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.wrap, { bottom }, animatedStyle]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="回到顶部"
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : null,
        ]}
        onPress={onPress}
      >
        <Ionicons name="arrow-up" size={15} color={colors.primaryDark} />
        <Text style={styles.label}>顶部</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 18,
  },
  button: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(191, 208, 244, 0.95)',
    backgroundColor: 'rgba(255,255,255,0.95)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  buttonPressed: {
    backgroundColor: 'rgba(239,245,255,0.98)',
    borderColor: 'rgba(96, 165, 250, 0.78)',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    transform: [{ scale: 0.97 }],
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primaryDark,
  },
});
