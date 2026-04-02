// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSilentDownloadWorkerProgressReporter,
  normalizeSilentDownloadWorkerError,
} from './silent-download-worker-utils.ts';

test('merges worker progress patches with stable task metadata', () => {
  const events: any[] = [];
  const report = createSilentDownloadWorkerProgressReporter({
    title: 'demo title',
    quality: '1080p',
    platform: 'bilibili',
    runtimeTraceId: 'trace-1',
    onProgress: (event) => {
      events.push(event);
    },
  });

  report({
    status: 'downloading',
    progress: 42,
  });

  assert.deepEqual(events, [
    {
      title: 'demo title',
      quality: '1080p',
      platform: 'bilibili',
      runtimeTraceId: 'trace-1',
      status: 'downloading',
      progress: 42,
    },
  ]);
});

test('normalizes blocking worker failures into queue-pausing errors', () => {
  const error = normalizeSilentDownloadWorkerError(
    new Error('未获得相册权限，请到系统设置中允许 V-SAVE 访问照片后重试'),
  );

  assert.equal(error.message, '未获得相册权限，请到系统设置中允许 V-SAVE 访问照片后重试');
  assert.equal(error.pauseQueue, true);
  assert.equal(error.pauseReason, 'photos_permission_required');
  assert.equal(error.pauseMessage, '需要相册权限后才能继续执行静默下载队列，请授权后手动恢复队列。');
});

test('normalizes generic worker failures without queue pause metadata', () => {
  const error = normalizeSilentDownloadWorkerError({
    response: {
      data: {
        message: '后端服务繁忙',
      },
    },
  });

  assert.equal(error.message, '后端服务繁忙');
  assert.equal(error.pauseQueue, undefined);
  assert.equal(error.pauseReason, undefined);
  assert.equal(error.pauseMessage, undefined);
});
