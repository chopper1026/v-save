import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/theme';
import {
  IOS_LAUNCH_SPLASH_IMAGE_WIDTH,
  resolveLaunchTransitionSpec,
} from '@/lib/launch-transition-config';

const launchLogoSource = require('../../assets/ios-splash-tech-frosted-play-transparent.png');

interface LaunchTransitionProps {
  reduceMotionEnabled: boolean;
  canExit: boolean;
  onComplete: () => void;
}

export function LaunchTransition({
  canExit,
  reduceMotionEnabled,
  onComplete,
}: LaunchTransitionProps) {
  const overlayOpacity = useSharedValue(1);
  const logoScale = useSharedValue(1);
  const glowScale = useSharedValue(0.94);
  const glowOpacity = useSharedValue(0.12);
  const sheenOpacity = useSharedValue(0);
  const sheenTranslateX = useSharedValue(-180);
  const onCompleteRef = useRef(onComplete);
  const startedExitRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotionEnabled);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    reduceMotionRef.current = reduceMotionEnabled;
  }, [reduceMotionEnabled]);

  useEffect(() => {
    const spec = resolveLaunchTransitionSpec(reduceMotionEnabled);
    overlayOpacity.value = 1;
    glowScale.value = spec.reducedMotion ? 1 : 0.94;
    glowOpacity.value = spec.reducedMotion ? 0.08 : 0.12;
    sheenOpacity.value = 0;
    sheenTranslateX.value = -180;
    logoScale.value = spec.reducedMotion ? 1 : spec.startScale;

    if (spec.reducedMotion) {
      return;
    }

    logoScale.value = withDelay(
      spec.overlayHoldMs,
      withTiming(spec.settleScale, {
        duration: spec.revealMs,
        easing: Easing.out(Easing.cubic),
      }),
    );

    glowScale.value = withDelay(
      spec.overlayHoldMs,
      withTiming(1.05, {
        duration: spec.revealMs,
        easing: Easing.out(Easing.cubic),
      }),
    );

    glowOpacity.value = withDelay(
      spec.overlayHoldMs,
      withTiming(0.18, {
        duration: Math.min(280, spec.revealMs),
        easing: Easing.out(Easing.quad),
      }),
    );

    sheenOpacity.value = withSequence(
      withTiming(0, { duration: 0 }),
      withDelay(
        spec.overlayHoldMs + 70,
        withTiming(0.2, {
          duration: 140,
          easing: Easing.out(Easing.quad),
        }),
      ),
      withTiming(0, {
        duration: 220,
        easing: Easing.inOut(Easing.quad),
      }),
    );
    sheenTranslateX.value = withDelay(
      spec.overlayHoldMs + 70,
      withTiming(180, {
        duration: 420,
        easing: Easing.inOut(Easing.quad),
      }),
    );
  }, [
    glowOpacity,
    glowScale,
    logoScale,
    overlayOpacity,
    reduceMotionEnabled,
    sheenOpacity,
    sheenTranslateX,
  ]);

  useEffect(() => {
    if (!canExit || startedExitRef.current) {
      return;
    }

    startedExitRef.current = true;
    const spec = resolveLaunchTransitionSpec(reduceMotionRef.current);
    const finish = () => {
      onCompleteRef.current();
    };

    if (!spec.reducedMotion) {
      logoScale.value = withTiming(spec.endScale, {
        duration: spec.fadeMs,
        easing: Easing.inOut(Easing.quad),
      });
      glowScale.value = withTiming(1.12, {
        duration: spec.fadeMs,
        easing: Easing.out(Easing.quad),
      });
      glowOpacity.value = withTiming(0.06, {
        duration: spec.fadeMs,
        easing: Easing.out(Easing.cubic),
      });
      sheenOpacity.value = withTiming(0, {
        duration: Math.min(220, spec.fadeMs),
        easing: Easing.out(Easing.quad),
      });
    }

    overlayOpacity.value = withTiming(
      0,
      {
        duration: spec.fadeMs,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(finish)();
        }
      },
    );
  }, [canExit, glowOpacity, glowScale, logoScale, overlayOpacity, sheenOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  const sheenStyle = useAnimatedStyle(() => ({
    opacity: sheenOpacity.value,
    transform: [
      { translateX: sheenTranslateX.value },
      { rotate: '18deg' },
    ],
  }));

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, overlayStyle]}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <Animated.View style={[styles.logoFrame, logoStyle]}>
        <Animated.Image
          resizeMode="contain"
          source={launchLogoSource}
          style={styles.logo}
        />
        <Animated.View style={[styles.sheen, sheenStyle]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  glow: {
    position: 'absolute',
    width: IOS_LAUNCH_SPLASH_IMAGE_WIDTH + 56,
    height: IOS_LAUNCH_SPLASH_IMAGE_WIDTH + 56,
    borderRadius: (IOS_LAUNCH_SPLASH_IMAGE_WIDTH + 56) / 2,
    backgroundColor: 'rgba(88, 200, 247, 0.26)',
  },
  logoFrame: {
    width: IOS_LAUNCH_SPLASH_IMAGE_WIDTH,
    height: IOS_LAUNCH_SPLASH_IMAGE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  sheen: {
    position: 'absolute',
    top: -48,
    left: -120,
    width: 68,
    height: IOS_LAUNCH_SPLASH_IMAGE_WIDTH + 120,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.34)',
  },
});
