import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRequestNativeSilentDownloadRuntimePermissions } from './native-silent-download-permission-policy';

test('requests runtime permissions when native engine becomes enabled for the first time', () => {
  assert.equal(
    shouldRequestNativeSilentDownloadRuntimePermissions({
      useNativeEngine: true,
      previousEnabled: false,
      nextEnabled: true,
    }),
    true,
  );
});

test('requests runtime permissions when persisted enabled state hydrates on first run', () => {
  assert.equal(
    shouldRequestNativeSilentDownloadRuntimePermissions({
      useNativeEngine: true,
      previousEnabled: null,
      nextEnabled: true,
    }),
    true,
  );
});

test('does not re-request runtime permissions during token or config refresh while enabled', () => {
  assert.equal(
    shouldRequestNativeSilentDownloadRuntimePermissions({
      useNativeEngine: true,
      previousEnabled: true,
      nextEnabled: true,
    }),
    false,
  );
});

test('does not request runtime permissions when native engine is unavailable', () => {
  assert.equal(
    shouldRequestNativeSilentDownloadRuntimePermissions({
      useNativeEngine: false,
      previousEnabled: false,
      nextEnabled: true,
    }),
    false,
  );
});

test('does not request runtime permissions when queue is disabled', () => {
  assert.equal(
    shouldRequestNativeSilentDownloadRuntimePermissions({
      useNativeEngine: true,
      previousEnabled: true,
      nextEnabled: false,
    }),
    false,
  );
});
