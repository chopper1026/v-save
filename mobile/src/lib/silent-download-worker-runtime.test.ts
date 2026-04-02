// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSilentDownloadRuntimeFailureEvent,
  buildSilentDownloadRuntimeHeaders,
  buildSilentDownloadRuntimeSuccessEvent,
} from './silent-download-worker-runtime.ts';

test('builds silent-download runtime headers with trace id', () => {
  assert.deepEqual(buildSilentDownloadRuntimeHeaders('trace-1'), {
    'x-runtime-trace-id': 'trace-1',
  });
});

test('builds success runtime events with normalized platform and latency', () => {
  assert.deepEqual(
    buildSilentDownloadRuntimeSuccessEvent({
      feature: 'parse',
      platform: 'bilibili',
      startedAt: 1000,
      now: 1321,
      eventKey: 'event-1',
      traceId: 'trace-1',
    }),
    {
      feature: 'parse',
      clientType: 'MOBILE',
      platform: 'bilibili',
      outcome: 'success',
      latencyMs: 321,
      eventKey: 'event-1',
      traceId: 'trace-1',
    },
  );
});

test('builds failure runtime events with normalized fallback platform and error code', () => {
  assert.deepEqual(
    buildSilentDownloadRuntimeFailureEvent({
      feature: 'download',
      platform: 'not-a-platform',
      startedAt: 1000,
      now: 900,
      eventKey: 'event-2',
      traceId: 'trace-2',
      fallbackCode: 'DOWNLOAD_FAILED',
      error: {
        response: {
          data: {
            code: 'auth_expired',
          },
        },
      },
    }),
    {
      feature: 'download',
      clientType: 'MOBILE',
      platform: 'unknown',
      outcome: 'failure',
      latencyMs: 0,
      errorCode: 'AUTH_EXPIRED',
      eventKey: 'event-2',
      traceId: 'trace-2',
    },
  );
});
