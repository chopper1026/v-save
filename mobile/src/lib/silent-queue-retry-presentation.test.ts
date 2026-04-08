// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveSilentQueueRetryFeedback,
  resolveSilentQueueRetryPresentation,
} from './silent-queue-retry-presentation.ts';

test('shows retry action only for failed iOS silent download tasks', () => {
  assert.equal(
    resolveSilentQueueRetryPresentation({
      platformOs: 'ios',
      taskStatus: 'failed',
      retrying: false,
    }).visible,
    true,
  );

  assert.equal(
    resolveSilentQueueRetryPresentation({
      platformOs: 'android',
      taskStatus: 'failed',
      retrying: false,
    }).visible,
    false,
  );

  assert.equal(
    resolveSilentQueueRetryPresentation({
      platformOs: 'ios',
      taskStatus: 'completed',
      retrying: false,
    }).visible,
    false,
  );
});

test('switches retry button copy while retry request is in progress', () => {
  const idle = resolveSilentQueueRetryPresentation({
    platformOs: 'ios',
    taskStatus: 'failed',
    retrying: false,
  });
  const busy = resolveSilentQueueRetryPresentation({
    platformOs: 'ios',
    taskStatus: 'failed',
    retrying: true,
  });

  assert.equal(idle.label, '重试');
  assert.equal(idle.disabled, false);
  assert.equal(busy.label, '重试中...');
  assert.equal(busy.disabled, true);
});

test('builds retry feedback for accepted and duplicate retry actions', () => {
  assert.deepEqual(resolveSilentQueueRetryFeedback({ accepted: true }), {
    title: '已加入重试队列',
    message: '失败任务已重新加入静默下载队列。',
    level: 'success',
    durationMs: 2200,
  });

  assert.deepEqual(resolveSilentQueueRetryFeedback({ accepted: false }), {
    title: '暂无法重试',
    message: '该视频已在静默下载队列中，请稍后查看结果。',
    level: 'warn',
    durationMs: 2400,
  });
});
