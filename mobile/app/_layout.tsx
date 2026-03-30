import 'react-native-gesture-handler';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  ToastPosition,
  Toasts,
} from '@backpackapp-io/react-native-toast';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { ShareIntentProvider } from 'expo-share-intent';
import { LaunchTransition } from '@/components/launch-transition';
import { colors } from '@/constants/theme';
import { useAuthGuard } from '@/hooks/use-auth-guard';
import { useIntentStore } from '@/store/intent-store';
import {
  IOS_LAUNCH_FAIL_OPEN_MS,
  shouldCompleteLaunchTransition,
  shouldStartLaunchTransition,
} from '@/lib/launch-transition-config';
import { extractSharedUrlFromDeepLink } from '@/lib/link';
import { prepareSystemBannerNotice } from '@/lib/system-banner-notice';

const isIOS = Platform.OS === 'ios';

if (isIOS) {
  SplashScreen.setOptions({
    fade: false,
    duration: 0,
  });
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

function AppShell() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <ShareIntentProvider options={{ scheme: 'vsave', resetOnBackground: false }}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="preview" />
            <Stack.Screen name="share" />
          </Stack>
          <Toasts
            defaultPosition={ToastPosition.TOP}
            defaultDuration={3000}
            globalLimit={1}
          />
        </ShareIntentProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const { hydrated } = useAuthGuard();
  const setIncomingUrl = useIntentStore((state) => state.setIncomingUrl);
  const [appShellReady, setAppShellReady] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState<boolean | null>(
    isIOS ? null : false,
  );
  const [launchPhase, setLaunchPhase] = useState<'native' | 'overlay' | 'done'>(
    isIOS ? 'native' : 'done',
  );
  const [overlayStartedAtMs, setOverlayStartedAtMs] = useState<number | null>(null);
  const [launchCanExit, setLaunchCanExit] = useState(false);
  const splashHiddenRef = useRef(!isIOS);

  useEffect(() => {
    prepareSystemBannerNotice();
  }, []);

  useEffect(() => {
    if (!isIOS) {
      return;
    }

    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setReduceMotionEnabled(Boolean(enabled));
        }
      })
      .catch(() => {
        if (active) {
          setReduceMotionEnabled(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const consume = (raw: string | null) => {
      if (!raw) return;
      const extracted = extractSharedUrlFromDeepLink(raw);
      if (extracted) {
        setIncomingUrl(extracted);
      }
    };

    void Linking.getInitialURL().then(consume).catch(() => undefined);

    const subscription = Linking.addEventListener('url', (event) => {
      consume(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [setIncomingUrl]);

  useEffect(() => {
    if (
      !shouldStartLaunchTransition({
        platform: Platform.OS,
        hydrated,
        appShellReady,
        reduceMotionKnown: reduceMotionEnabled !== null,
        hasCompleted: launchPhase === 'done' || launchPhase === 'overlay',
      })
    ) {
      return;
    }

    setLaunchCanExit(false);
    setOverlayStartedAtMs(Date.now());
    setLaunchPhase('overlay');
  }, [appShellReady, hydrated, launchPhase, reduceMotionEnabled]);

  useEffect(() => {
    if (!isIOS || launchPhase !== 'overlay' || splashHiddenRef.current) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      splashHiddenRef.current = true;
      void SplashScreen.hideAsync().catch(() => undefined);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [launchPhase]);

  useEffect(() => {
    if (!isIOS || launchPhase !== 'overlay' || launchCanExit) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const evaluateExit = () => {
      if (
        shouldCompleteLaunchTransition({
          overlayStartedAtMs,
          nowMs: Date.now(),
        })
      ) {
        setLaunchCanExit(true);
        return;
      }

      timeoutId = setTimeout(evaluateExit, 40);
    };

    evaluateExit();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [launchCanExit, launchPhase, overlayStartedAtMs]);

  useEffect(() => {
    if (!isIOS || launchPhase !== 'native') {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!splashHiddenRef.current) {
        splashHiddenRef.current = true;
        void SplashScreen.hideAsync().catch(() => undefined);
      }
      setLaunchPhase('done');
    }, IOS_LAUNCH_FAIL_OPEN_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [launchPhase]);

  const shouldShowFallbackLoading = !hydrated && (!isIOS || launchPhase === 'done');

  return (
    <View style={styles.shellRoot}>
      {hydrated ? (
        <View style={styles.shellRoot} onLayout={() => setAppShellReady(true)}>
          <AppShell />
        </View>
      ) : shouldShowFallbackLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <View style={styles.loading} />
      )}
      {isIOS && launchPhase === 'overlay' && reduceMotionEnabled !== null ? (
        <LaunchTransition
          canExit={launchCanExit}
          onComplete={() => setLaunchPhase('done')}
          reduceMotionEnabled={reduceMotionEnabled}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shellRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
