// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePreviewPlaybackAction } from './preview-playback-policy.ts';

test('advances to the next candidate when startup loading exceeds timeout', () => {
  const action = resolvePreviewPlaybackAction({
    status: 'loading',
    candidateIndex: 0,
    candidateCount: 3,
    hadReady: false,
    phaseStartedAtMs: 1000,
    nowMs: 4600,
  });

  assert.deepEqual(action, {
    type: 'advance',
    reason: 'startup_timeout',
  });
});

test('advances to the next candidate when post-ready loading lasts too long', () => {
  const action = resolvePreviewPlaybackAction({
    status: 'loading',
    candidateIndex: 1,
    candidateCount: 3,
    hadReady: true,
    phaseStartedAtMs: 1000,
    nowMs: 3200,
  });

  assert.deepEqual(action, {
    type: 'advance',
    reason: 'buffering_timeout',
  });
});

test('fails on the last candidate when the player reports an error', () => {
  const action = resolvePreviewPlaybackAction({
    status: 'error',
    candidateIndex: 2,
    candidateCount: 3,
    hadReady: false,
    phaseStartedAtMs: 1000,
    nowMs: 1200,
  });

  assert.deepEqual(action, {
    type: 'fail',
    reason: 'player_error',
  });
});
