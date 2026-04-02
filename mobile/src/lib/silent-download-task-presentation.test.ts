// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSilentDownloadTaskTimeMeta } from './silent-download-task-presentation.ts';

test('uses queued time meta for in-flight silent download tasks', () => {
  const meta = resolveSilentDownloadTaskTimeMeta({
    status: 'downloading',
    createdAt: 100,
    updatedAt: 200,
    finishedAt: 300,
  });

  assert.deepEqual(meta, {
    label: '入队',
    timestamp: 100,
  });
});

test('uses finished time meta for completed silent download tasks', () => {
  const meta = resolveSilentDownloadTaskTimeMeta({
    status: 'completed',
    createdAt: 100,
    updatedAt: 200,
    finishedAt: 300,
  });

  assert.deepEqual(meta, {
    label: '完成',
    timestamp: 300,
  });
});

test('falls back to latest known finished-like time for failed silent download tasks', () => {
  const meta = resolveSilentDownloadTaskTimeMeta({
    status: 'failed',
    createdAt: 100,
    updatedAt: 240,
  });

  assert.deepEqual(meta, {
    label: '失败',
    timestamp: 240,
  });
});
