export const IOS_LAUNCH_SPLASH_IMAGE_WIDTH = 248;
export const IOS_LAUNCH_FAIL_OPEN_MS = 1500;
export const IOS_LAUNCH_MIN_DISPLAY_MS = 1200;

export interface LaunchTransitionSpec {
  totalMs: number;
  overlayHoldMs: number;
  revealMs: number;
  fadeMs: number;
  startScale: number;
  settleScale: number;
  endScale: number;
  reducedMotion: boolean;
}

export interface ShouldStartLaunchTransitionInput {
  platform: string;
  hydrated: boolean;
  appShellReady: boolean;
  reduceMotionKnown: boolean;
  hasCompleted: boolean;
}

export interface ShouldCompleteLaunchTransitionInput {
  overlayStartedAtMs: number | null;
  nowMs: number;
}

const STANDARD_LAUNCH_TRANSITION: LaunchTransitionSpec = {
  totalMs: IOS_LAUNCH_MIN_DISPLAY_MS,
  overlayHoldMs: 120,
  revealMs: 650,
  fadeMs: 430,
  startScale: 0.96,
  settleScale: 1,
  endScale: 1.03,
  reducedMotion: false,
};

const REDUCED_MOTION_TRANSITION: LaunchTransitionSpec = {
  totalMs: 180,
  overlayHoldMs: 0,
  revealMs: 0,
  fadeMs: 180,
  startScale: 1,
  settleScale: 1,
  endScale: 1,
  reducedMotion: true,
};

export const resolveLaunchTransitionSpec = (
  reduceMotionEnabled: boolean,
): LaunchTransitionSpec =>
  reduceMotionEnabled ? REDUCED_MOTION_TRANSITION : STANDARD_LAUNCH_TRANSITION;

export const shouldStartLaunchTransition = (
  input: ShouldStartLaunchTransitionInput,
): boolean => {
  const {
    platform,
    hydrated,
    appShellReady,
    reduceMotionKnown,
    hasCompleted,
  } = input;

  return (
    platform === 'ios' &&
    hydrated &&
    appShellReady &&
    reduceMotionKnown &&
    !hasCompleted
  );
};

export const shouldCompleteLaunchTransition = (
  input: ShouldCompleteLaunchTransitionInput,
): boolean => {
  const { overlayStartedAtMs, nowMs } = input;
  if (overlayStartedAtMs === null) {
    return false;
  }

  const elapsedMs = Math.max(0, nowMs - overlayStartedAtMs);
  return elapsedMs >= IOS_LAUNCH_MIN_DISPLAY_MS;
};
