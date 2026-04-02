// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSilentDownloadTask } from '@/store/silent-download-queue-store.ts';
import {
  resolveSilentDownloadCoordinatorAction,
  shouldPersistSilentDownloadQueueSnapshot,
  shouldRecoverInterruptedSilentDownloadTasks,
  shouldRetryFailedSilentDownloadTask,
  shouldStartSilentDownloadTask,
} from './silent-download-runtime-policy.ts';

test('recovers interrupted tasks only after queue hydration on active app state with no running task', () => {
  const interruptedTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/recover-me'),
    status: 'downloading',
    progress: 64,
  };

  assert.equal(
    shouldRecoverInterruptedSilentDownloadTasks({
      queueHydrated: true,
      appState: 'active',
      hasRunningTask: false,
      tasks: [interruptedTask],
    }),
    true,
  );

  assert.equal(
    shouldRecoverInterruptedSilentDownloadTasks({
      queueHydrated: true,
      appState: 'background',
      hasRunningTask: false,
      tasks: [interruptedTask],
    }),
    false,
  );

  assert.equal(
    shouldRecoverInterruptedSilentDownloadTasks({
      queueHydrated: true,
      appState: 'active',
      hasRunningTask: true,
      tasks: [interruptedTask],
    }),
    false,
  );
});

test('starts the next queued task only when execution gates are open', () => {
  const queuedTask = createSilentDownloadTask('https://www.bilibili.com/video/BV1xx411c7mD');

  assert.equal(
    shouldStartSilentDownloadTask({
      queueHydrated: true,
      token: 'token',
      appState: 'active',
      pausedReason: null,
      hasRunningTask: false,
      nextTask: queuedTask,
    }),
    true,
  );

  assert.equal(
    shouldStartSilentDownloadTask({
      queueHydrated: true,
      token: 'token',
      appState: 'active',
      pausedReason: 'auth_required',
      hasRunningTask: false,
      nextTask: queuedTask,
    }),
    false,
  );

  assert.equal(
    shouldStartSilentDownloadTask({
      queueHydrated: true,
      token: '',
      appState: 'active',
      pausedReason: null,
      hasRunningTask: false,
      nextTask: queuedTask,
    }),
    false,
  );
});

test('retries a failed task only once when the queue is otherwise empty and not paused', () => {
  assert.equal(
    shouldRetryFailedSilentDownloadTask({
      shouldPauseQueue: false,
      remainingQueuedTaskCount: 0,
      retryCount: 0,
    }),
    true,
  );

  assert.equal(
    shouldRetryFailedSilentDownloadTask({
      shouldPauseQueue: true,
      remainingQueuedTaskCount: 0,
      retryCount: 0,
    }),
    false,
  );

  assert.equal(
    shouldRetryFailedSilentDownloadTask({
      shouldPauseQueue: false,
      remainingQueuedTaskCount: 1,
      retryCount: 0,
    }),
    false,
  );

  assert.equal(
    shouldRetryFailedSilentDownloadTask({
      shouldPauseQueue: false,
      remainingQueuedTaskCount: 0,
      retryCount: 1,
    }),
    false,
  );
});

test('persists queue snapshots only after hydration and when the normalized snapshot changes', () => {
  assert.equal(
    shouldPersistSilentDownloadQueueSnapshot({
      queueHydrated: false,
      previousSnapshot: null,
      nextSnapshot: '{"tasks":[],"pausedReason":null,"pauseMessage":null}',
    }),
    false,
  );

  assert.equal(
    shouldPersistSilentDownloadQueueSnapshot({
      queueHydrated: true,
      previousSnapshot: '{"tasks":[],"pausedReason":null,"pauseMessage":null}',
      nextSnapshot: '{"tasks":[],"pausedReason":null,"pauseMessage":null}',
    }),
    false,
  );

  assert.equal(
    shouldPersistSilentDownloadQueueSnapshot({
      queueHydrated: true,
      previousSnapshot: '{"tasks":[],"pausedReason":null,"pauseMessage":null}',
      nextSnapshot:
        '{"tasks":[{"id":"queued-1","status":"queued"}],"pausedReason":null,"pauseMessage":null}',
    }),
    true,
  );
});

test('prioritizes interrupted-task recovery ahead of starting another queued task', () => {
  const recoveringTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/recover-first'),
    id: 'recover-first',
    status: 'downloading',
    progress: 72,
  };
  const queuedTask = {
    ...createSilentDownloadTask('https://www.bilibili.com/video/BV1xx411c7mD'),
    id: 'queued-next',
  };

  const action = resolveSilentDownloadCoordinatorAction({
    queueHydrated: true,
    token: 'token',
    appState: 'active',
    pausedReason: null,
    hasRunningTask: false,
    tasks: [recoveringTask, queuedTask],
  });

  assert.deepEqual(action, {
    type: 'recover',
    taskIds: ['recover-first'],
  });
});

test('starts the first queued task once recovery is no longer pending', () => {
  const firstQueuedTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/first'),
    id: 'queued-first',
  };
  const secondQueuedTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/second'),
    id: 'queued-second',
  };

  const action = resolveSilentDownloadCoordinatorAction({
    queueHydrated: true,
    token: 'token',
    appState: 'active',
    pausedReason: null,
    hasRunningTask: false,
    tasks: [firstQueuedTask, secondQueuedTask],
  });

  assert.equal(action.type, 'start');
  assert.equal(action.task.id, 'queued-first');
});
