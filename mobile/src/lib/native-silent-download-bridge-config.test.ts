// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNativeSilentDownloadBridgePayload,
  resolveNativeSilentDownloadBridgeAuthToken,
  shouldConfigureNativeSilentDownloadBridge,
} from './native-silent-download-bridge-config.ts';

test('does not send auth token to native bridge before auth hydration completes', () => {
  assert.equal(
    resolveNativeSilentDownloadBridgeAuthToken({
      authHydrated: false,
      token: 'stale-token',
    }),
    undefined,
  );
});

test('normalizes auth token values once auth hydration completes', () => {
  assert.equal(
    resolveNativeSilentDownloadBridgeAuthToken({
      authHydrated: true,
      token: '  active-token  ',
    }),
    'active-token',
  );

  assert.equal(
    resolveNativeSilentDownloadBridgeAuthToken({
      authHydrated: true,
      token: null,
    }),
    null,
  );
});

test('only configures the native bridge after settings and auth hydration are both complete', () => {
  assert.equal(
    shouldConfigureNativeSilentDownloadBridge({
      useNativeEngine: true,
      settingsHydrated: true,
      authHydrated: false,
    }),
    false,
  );

  assert.equal(
    shouldConfigureNativeSilentDownloadBridge({
      useNativeEngine: true,
      settingsHydrated: true,
      authHydrated: true,
    }),
    true,
  );
});

test('omits authToken from native bridge payloads when auth state is still unresolved', () => {
  assert.deepEqual(
    buildNativeSilentDownloadBridgePayload({
      apiBaseUrl: 'https://api.example.com',
      enabled: true,
      authToken: undefined,
    }),
    {
      apiBaseUrl: 'https://api.example.com',
      enabled: true,
    },
  );

  assert.deepEqual(
    buildNativeSilentDownloadBridgePayload({
      apiBaseUrl: 'https://api.example.com',
      enabled: true,
      authToken: null,
    }),
    {
      apiBaseUrl: 'https://api.example.com',
      enabled: true,
      authToken: null,
    },
  );
});
