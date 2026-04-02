// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT,
  buildPersistedSilentDownloadQueueState,
  buildPersistedSilentDownloadTasks,
  normalizePersistedSilentDownloadQueueState,
} from './silent-download-persistence-snapshot.ts';

const createTask = (overrides = {}) => ({
  id: `task-${Math.random().toString(36).slice(2, 8)}`,
  sourceUrl: 'https://example.com/video',
  dedupeKey: 'example.com/video',
  status: 'queued',
  progress: 0,
  createdAt: 100,
  updatedAt: 100,
  retryCount: 0,
  ...overrides,
});

test('converts interrupted active tasks into recoverable queued snapshots', () => {
  const tasks = [
    createTask({
      id: 'active-1',
      status: 'preparing',
      progress: 12,
      updatedAt: 220,
      runtimeTraceId: 'trace-prepare',
      title: 'prepare-demo',
    }),
    createTask({
      id: 'active-2',
      status: 'downloading',
      progress: 64,
      updatedAt: 300,
      startedAt: 200,
      runtimeTraceId: 'trace-1',
      title: 'demo',
    }),
  ];

  const snapshot = buildPersistedSilentDownloadTasks(tasks);

  assert.deepEqual(snapshot, [
    createTask({
      id: 'active-1',
      status: 'queued',
      progress: 0,
      updatedAt: 100,
      runtimeTraceId: undefined,
      title: 'prepare-demo',
    }),
    createTask({
      id: 'active-2',
      status: 'queued',
      progress: 0,
      updatedAt: 100,
      runtimeTraceId: undefined,
      title: 'demo',
    }),
  ]);
  assert.equal('startedAt' in snapshot[0], false);
  assert.equal('finishedAt' in snapshot[0], false);
});

test('keeps only the latest finished tasks in persisted history by finished time', () => {
  const tasks = Array.from(
    { length: PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT + 5 },
    (_, index) =>
      createTask({
        id: `finished-${index}`,
        createdAt: index,
        updatedAt: 100 + (PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT + 5 - index),
        finishedAt: 100 + (PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT + 5 - index),
        status: index % 2 === 0 ? 'completed' : 'failed',
      }),
  );

  const snapshot = buildPersistedSilentDownloadTasks(tasks);

  assert.equal(snapshot.length, PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT);
  assert.equal(snapshot[0].id, 'finished-0');
  assert.equal(snapshot.at(-1)?.id, `finished-${PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT - 1}`);
});

test('produces the same persisted snapshot for progress-only changes on active tasks', () => {
  const before = [
    createTask({
      id: 'active-1',
      status: 'downloading',
      progress: 10,
      updatedAt: 110,
      startedAt: 105,
      title: 'same-task',
    }),
  ];
  const after = [
    createTask({
      id: 'active-1',
      status: 'downloading',
      progress: 80,
      updatedAt: 999,
      startedAt: 105,
      title: 'same-task',
    }),
  ];

  assert.deepEqual(
    buildPersistedSilentDownloadTasks(after),
    buildPersistedSilentDownloadTasks(before),
  );
});

test('includes queue pause state in the persisted snapshot', () => {
  const state = buildPersistedSilentDownloadQueueState({
    tasks: [
      createTask({
        id: 'active-1',
        status: 'downloading',
        progress: 72,
      }),
    ],
    pausedReason: 'photos_permission_required',
    pauseMessage: '需要相册权限后才能继续执行静默下载队列，请授权后手动恢复队列。',
  });

  assert.equal(state.pausedReason, 'photos_permission_required');
  assert.equal(
    state.pauseMessage,
    '需要相册权限后才能继续执行静默下载队列，请授权后手动恢复队列。',
  );
  assert.equal(state.tasks[0].status, 'queued');
});

test('normalizes legacy persisted queue payloads without pause state', () => {
  const state = normalizePersistedSilentDownloadQueueState({
    tasks: [
      createTask({
        id: 'active-1',
        status: 'saving',
        progress: 99,
      }),
    ],
  });

  assert.equal(state.pausedReason, null);
  assert.equal(state.pauseMessage, null);
  assert.equal(state.tasks[0].status, 'queued');
  assert.equal(state.tasks[0].progress, 0);
});
