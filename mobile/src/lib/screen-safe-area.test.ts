// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveStableSafeAreaInsets } from './screen-safe-area.ts';

test('falls back to initial window metrics when the current tab safe-area inset is still zero on first frame', () => {
  const resolved = resolveStableSafeAreaInsets(
    {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    {
      top: 59,
      right: 0,
      bottom: 34,
      left: 0,
    },
  );

  assert.deepEqual(resolved, {
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
  });
});

test('prefers the live safe-area inset once the nested provider has resolved', () => {
  const resolved = resolveStableSafeAreaInsets(
    {
      top: 59,
      right: 0,
      bottom: 34,
      left: 0,
    },
    {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  );

  assert.deepEqual(resolved, {
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
  });
});

test('resolves each edge independently so only missing insets fall back', () => {
  const resolved = resolveStableSafeAreaInsets(
    {
      top: 0,
      right: 12,
      bottom: 0,
      left: 8,
    },
    {
      top: 59,
      right: 0,
      bottom: 34,
      left: 0,
    },
  );

  assert.deepEqual(resolved, {
    top: 59,
    right: 12,
    bottom: 34,
    left: 8,
  });
});
