// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IOS_LAUNCH_FAIL_OPEN_MS,
  IOS_LAUNCH_MIN_DISPLAY_MS,
  IOS_LAUNCH_SPLASH_IMAGE_WIDTH,
  resolveLaunchTransitionSpec,
  shouldCompleteLaunchTransition,
  shouldStartLaunchTransition,
} from './launch-transition-config.ts';

test('uses the premium launch animation spec by default', () => {
  const spec = resolveLaunchTransitionSpec(false);

  assert.deepEqual(spec, {
    totalMs: 1200,
    overlayHoldMs: 120,
    revealMs: 650,
    fadeMs: 430,
    startScale: 0.96,
    settleScale: 1,
    endScale: 1.03,
    reducedMotion: false,
  });
});

test('falls back to a short fade-only transition when reduce motion is enabled', () => {
  const spec = resolveLaunchTransitionSpec(true);

  assert.deepEqual(spec, {
    totalMs: 180,
    overlayHoldMs: 0,
    revealMs: 0,
    fadeMs: 180,
    startScale: 1,
    settleScale: 1,
    endScale: 1,
    reducedMotion: true,
  });
});

test('starts the launch transition only after iOS app shell is ready', () => {
  assert.equal(
    shouldStartLaunchTransition({
      platform: 'ios',
      hydrated: true,
      appShellReady: true,
      reduceMotionKnown: true,
      hasCompleted: false,
    }),
    true,
  );

  assert.equal(
    shouldStartLaunchTransition({
      platform: 'android',
      hydrated: true,
      appShellReady: true,
      reduceMotionKnown: true,
      hasCompleted: false,
    }),
    false,
  );

  assert.equal(IOS_LAUNCH_FAIL_OPEN_MS, 1500);
  assert.equal(IOS_LAUNCH_MIN_DISPLAY_MS, 1200);
  assert.equal(IOS_LAUNCH_SPLASH_IMAGE_WIDTH, 248);
});

test('keeps the launch overlay visible until minimum duration is satisfied', () => {
  assert.equal(
    shouldCompleteLaunchTransition({
      overlayStartedAtMs: 1_000,
      nowMs: 2_050,
    }),
    false,
  );

  assert.equal(
    shouldCompleteLaunchTransition({
      overlayStartedAtMs: 1_000,
      nowMs: 2_250,
    }),
    true,
  );
});
