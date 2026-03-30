import { PropsWithChildren, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/constants/theme';
import { resolveStableSafeAreaInsets } from '@/lib/screen-safe-area';

interface ScreenProps extends PropsWithChildren {
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  disableOrnaments?: boolean;
}

export const Screen = ({
  children,
  scroll = true,
  contentContainerStyle,
  bodyStyle,
  disableOrnaments = false,
}: ScreenProps) => {
  const liveInsets = useSafeAreaInsets();
  const fallbackInsets = initialWindowMetrics?.insets ?? null;
  const resolvedInsets = useMemo(
    () => resolveStableSafeAreaInsets(liveInsets, fallbackInsets),
    [fallbackInsets, liveInsets],
  );

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.body, bodyStyle]}>{children}</View>
  );

  return (
    <View
      style={[
        styles.safeArea,
        {
          paddingTop: resolvedInsets.top,
          paddingRight: resolvedInsets.right,
          paddingBottom: resolvedInsets.bottom,
          paddingLeft: resolvedInsets.left,
        },
      ]}
    >
      {!disableOrnaments && (
        <View pointerEvents="none" style={styles.ornaments}>
          <View style={[styles.orb, styles.orbTop]} />
          <View style={[styles.orb, styles.orbBottom]} />
        </View>
      )}
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
  },
  ornaments: {
    ...StyleSheet.absoluteFillObject,
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.65,
  },
  orbTop: {
    width: 320,
    height: 320,
    top: -120,
    right: -86,
    backgroundColor: '#DCE9FF',
  },
  orbBottom: {
    width: 260,
    height: 260,
    bottom: -120,
    left: -90,
    backgroundColor: '#E6F4FF',
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: 118,
  },
  body: {
    flex: 1,
    padding: spacing.md,
  },
});
