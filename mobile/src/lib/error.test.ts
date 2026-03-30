// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { extractApiErrorMessage } from './error.ts';

test('returns actionable guidance when network error hits localhost api base', () => {
  const message = extractApiErrorMessage(
    {
      message: 'Network Error',
      code: 'ERR_NETWORK',
    },
    '请求失败',
    {
      apiBaseUrl: 'http://localhost:3001/api',
    }
  );

  assert.match(message, /localhost/);
  assert.match(message, /局域网IP/);
});

test('returns generic connectivity guidance when network error hits remote api base', () => {
  const message = extractApiErrorMessage(
    {
      message: 'Network Error',
      code: 'ERR_NETWORK',
    },
    '请求失败',
    {
      apiBaseUrl: 'http://192.168.1.10:3001/api',
    }
  );

  assert.match(message, /192\.168\.1\.10:3001\/api/);
  assert.doesNotMatch(message, /localhost/);
});
