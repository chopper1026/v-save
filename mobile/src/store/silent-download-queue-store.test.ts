// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSilentDownloadTask,
  getSilentDownloadTaskSummary,
  getLatestFinishedSilentDownloadTasks,
  RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT,
  reduceSilentDownloadTasks,
  recoverInterruptedSilentDownloadTasks,
  useSilentDownloadQueueStore,
} from './silent-download-queue-store.ts';

test('dedupes queued and active silent download tasks by share auto-parse key', () => {
  const first = createSilentDownloadTask('https://www.douyin.com/video/123?share_source=a');
  const duplicate = createSilentDownloadTask('https://www.douyin.com/video/123?share_source=b');

  const added = reduceSilentDownloadTasks([], {
    type: 'enqueue',
    task: first,
  });
  const deduped = reduceSilentDownloadTasks(added, {
    type: 'enqueue',
    task: duplicate,
  });

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sourceUrl, first.sourceUrl);
});

test('allows re-enqueue after a previous task has already failed', () => {
  const failedTask = {
    ...createSilentDownloadTask('https://www.bilibili.com/video/BV1xx411c7mD'),
    status: 'failed',
    errorMessage: '下载失败',
  };
  const retriedTask = createSilentDownloadTask('https://www.bilibili.com/video/BV1xx411c7mD');

  const next = reduceSilentDownloadTasks([failedTask], {
    type: 'enqueue',
    task: retriedTask,
  });

  assert.equal(next.length, 2);
  assert.equal(next[1].status, 'queued');
});

test('updates task phase and progress for serial worker execution', () => {
  const task = createSilentDownloadTask('https://www.youtube.com/watch?v=demo');

  const parsing = reduceSilentDownloadTasks([task], {
    type: 'patch',
    taskId: task.id,
    patch: {
      status: 'parsing',
      progress: 5,
    },
  });
  assert.equal(parsing[0].status, 'parsing');
  assert.equal(parsing[0].progress, 5);

  const downloading = reduceSilentDownloadTasks(parsing, {
    type: 'patch',
    taskId: task.id,
    patch: {
      status: 'downloading',
      progress: 66,
    },
  });
  assert.equal(downloading[0].status, 'downloading');
  assert.equal(downloading[0].progress, 66);

  const completed = reduceSilentDownloadTasks(downloading, {
    type: 'patch',
    taskId: task.id,
    patch: {
      status: 'completed',
      progress: 100,
    },
  });
  assert.equal(completed[0].status, 'completed');
  assert.equal(completed[0].progress, 100);
});

test('recovers interrupted parsing and downloading tasks back into the queue on next app activation', () => {
  const parsing = {
    ...createSilentDownloadTask('https://www.douyin.com/video/1'),
    status: 'parsing',
    progress: 4,
  };
  const preparing = {
    ...createSilentDownloadTask('https://www.youtube.com/watch?v=preparing'),
    status: 'preparing',
    progress: 2,
  };
  const downloading = {
    ...createSilentDownloadTask('https://www.bilibili.com/video/BV1xx411c7mD'),
    status: 'downloading',
    progress: 61,
  };

  const recovered = recoverInterruptedSilentDownloadTasks([parsing, preparing, downloading]);

  assert.equal(recovered[0].status, 'queued');
  assert.equal(recovered[0].progress, 0);
  assert.equal(recovered[1].status, 'queued');
  assert.equal(recovered[1].progress, 0);
  assert.equal(recovered[2].status, 'queued');
  assert.equal(recovered[2].progress, 0);
});

test('requeues a failed task once when the queue is otherwise empty', () => {
  const task = createSilentDownloadTask('https://www.youtube.com/watch?v=demo');
  const failed = reduceSilentDownloadTasks([task], {
    type: 'patch',
    taskId: task.id,
    patch: {
      status: 'failed',
      progress: 0,
      retryCount: 0,
      errorMessage: '网络错误',
    },
  });

  const retried = reduceSilentDownloadTasks(failed, {
    type: 'requeue-failed-once',
    taskId: task.id,
  });

  assert.equal(retried[0].status, 'queued');
  assert.equal(retried[0].retryCount, 1);
  assert.equal(retried[0].errorMessage, '');
});

test('does not requeue a failed task when it has already retried once', () => {
  const task = {
    ...createSilentDownloadTask('https://www.youtube.com/watch?v=demo'),
    status: 'failed',
    retryCount: 1,
    errorMessage: 'still failing',
  };

  const retried = reduceSilentDownloadTasks([task], {
    type: 'requeue-failed-once',
    taskId: task.id,
  });

  assert.equal(retried[0].status, 'failed');
  assert.equal(retried[0].retryCount, 1);
});

test('shows the latest finished tasks in history view ordered by finished time', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    ...createSilentDownloadTask(`https://www.douyin.com/video/${index}`),
    title: `task-${index}`,
    status: index % 2 === 0 ? 'completed' : 'failed',
    createdAt: index + 1,
    updatedAt: 100 + (12 - index),
    finishedAt: 100 + (12 - index),
  }));

  const latest = getLatestFinishedSilentDownloadTasks(tasks);

  assert.equal(latest.length, 10);
  assert.equal(latest[0].title, 'task-0');
  assert.equal(latest[9].title, 'task-9');
});

test('computes summary counts using all finished tasks while keeping a separate in-flight count', () => {
  const tasks = [
    {
      ...createSilentDownloadTask('https://www.youtube.com/watch?v=preparing'),
      status: 'preparing',
    },
    {
      ...createSilentDownloadTask('https://www.douyin.com/video/active'),
      status: 'downloading',
    },
    {
      ...createSilentDownloadTask('https://www.douyin.com/video/queued'),
      status: 'queued',
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      ...createSilentDownloadTask(`https://www.douyin.com/video/${index}`),
      status: index % 2 === 0 ? 'completed' : 'failed',
    })),
  ];

  const summary = getSilentDownloadTaskSummary(tasks);

  assert.equal(summary.total, 15);
  assert.equal(summary.inFlight, 3);
  assert.equal(summary.finished, 12);
});

test('pauses and resumes queue execution state', () => {
  useSilentDownloadQueueStore.setState({
    tasks: [],
    hydrated: false,
    pausedReason: null,
    pauseMessage: null,
  });

  useSilentDownloadQueueStore
    .getState()
    .pauseQueue('photos_permission_required', '需要相册权限后才能继续执行队列');

  assert.equal(
    useSilentDownloadQueueStore.getState().pausedReason,
    'photos_permission_required',
  );
  assert.equal(
    useSilentDownloadQueueStore.getState().pauseMessage,
    '需要相册权限后才能继续执行队列',
  );

  useSilentDownloadQueueStore.getState().resumeQueue();

  assert.equal(useSilentDownloadQueueStore.getState().pausedReason, null);
  assert.equal(useSilentDownloadQueueStore.getState().pauseMessage, null);
});

test('hydrates persisted queue pause state', () => {
  useSilentDownloadQueueStore.setState({
    tasks: [],
    hydrated: false,
    pausedReason: null,
    pauseMessage: null,
  });

  useSilentDownloadQueueStore.getState().hydratePersistenceState({
    tasks: [
      createSilentDownloadTask('https://www.douyin.com/video/keep-me'),
    ],
    pausedReason: 'auth_required',
    pauseMessage: '登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。',
  });

  assert.equal(useSilentDownloadQueueStore.getState().tasks.length, 1);
  assert.equal(useSilentDownloadQueueStore.getState().pausedReason, 'auth_required');
  assert.equal(
    useSilentDownloadQueueStore.getState().pauseMessage,
    '登录态已失效，静默下载队列已暂停，请重新登录后手动恢复队列。',
  );
});

test('caps runtime finished history during hydrate while preserving active tasks', () => {
  const activeTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/active-keep'),
    id: 'active-keep',
    status: 'queued',
  };
  const finishedTasks = Array.from(
    { length: RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT + 3 },
    (_, index) => ({
      ...createSilentDownloadTask(`https://www.douyin.com/video/finished-${index}`),
      id: `finished-${index}`,
      status: index % 2 === 0 ? 'completed' : 'failed',
      createdAt: index + 1,
      updatedAt: index + 1,
      finishedAt: index + 1,
    }),
  );

  const hydrated = reduceSilentDownloadTasks([activeTask], {
    type: 'hydrate',
    tasks: [activeTask, ...finishedTasks],
  });

  assert.equal(hydrated.some((task) => task.id === 'active-keep'), true);
  assert.equal(
    hydrated.filter((task) => task.status === 'completed' || task.status === 'failed').length,
    RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT,
  );
  assert.equal(hydrated.some((task) => task.id === 'finished-0'), false);
  assert.equal(
    hydrated.some((task) => task.id === `finished-${RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT + 2}`),
    true,
  );
});

test('drops the oldest finished task when a new completion would exceed runtime history limit', () => {
  const finishedTasks = Array.from(
    { length: RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT },
    (_, index) => ({
      ...createSilentDownloadTask(`https://www.douyin.com/video/finished-${index}`),
      id: `finished-${index}`,
      status: index % 2 === 0 ? 'completed' : 'failed',
      createdAt: index + 1,
      updatedAt: index + 1,
      finishedAt: index + 1,
    }),
  );
  const queuedTask = {
    ...createSilentDownloadTask('https://www.douyin.com/video/new-finish'),
    id: 'new-finish',
    createdAt: 999,
    updatedAt: 999,
  };

  const next = reduceSilentDownloadTasks([...finishedTasks, queuedTask], {
    type: 'patch',
    taskId: queuedTask.id,
    patch: {
      status: 'completed',
      progress: 100,
      finishedAt: 1000,
    },
  });

  assert.equal(
    next.filter((task) => task.status === 'completed' || task.status === 'failed').length,
    RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT,
  );
  assert.equal(next.some((task) => task.id === 'new-finish'), true);
  assert.equal(next.some((task) => task.id === 'finished-0'), false);
});
