// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSilentDownloadQueuePause } from './silent-download-failure-policy.ts';

test('pauses the queue when photo permission is missing', () => {
  const result = resolveSilentDownloadQueuePause(
    new Error('未获得相册权限，请到系统设置中允许 V-SAVE 访问照片后重试'),
  );

  assert.deepEqual(result, {
    reason: 'photos_permission_required',
    message: '需要相册权限后才能继续执行静默下载队列，请授权后手动恢复队列。',
  });
});

test('pauses the queue when backend auth has expired', () => {
  const result = resolveSilentDownloadQueuePause({
    response: {
      status: 401,
      data: {
        message: '登录已失效',
      },
    },
  });

  assert.deepEqual(result, {
    reason: 'auth_required',
    message: '登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。',
  });
});

test('does not pause the queue for generic transient failures', () => {
  const result = resolveSilentDownloadQueuePause(
    new Error('静默下载失败，请稍后重试'),
  );

  assert.equal(result, null);
});
