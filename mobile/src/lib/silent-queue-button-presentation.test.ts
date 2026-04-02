// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SILENT_QUEUE_BUTTON_MIN_HEIGHT,
  SILENT_QUEUE_BUTTON_MIN_WIDTH,
  resolveSilentQueueButtonPresentation,
  resolveSilentQueueToggleFeedback,
} from './silent-queue-button-presentation.ts';

test('keeps the silent queue button stable while switching between idle and active states', () => {
  const idle = resolveSilentQueueButtonPresentation({
    enabled: false,
    count: 0,
  });
  const active = resolveSilentQueueButtonPresentation({
    enabled: true,
    count: 1,
  });

  assert.equal(idle.countVisible, false);
  assert.equal(idle.countLabel, null);
  assert.equal(idle.minHeight, SILENT_QUEUE_BUTTON_MIN_HEIGHT);
  assert.equal(idle.minWidth, SILENT_QUEUE_BUTTON_MIN_WIDTH);
  assert.equal(idle.iconName, 'moon-outline');
  assert.equal(idle.tone, 'idle');

  assert.equal(active.countVisible, true);
  assert.equal(active.countLabel, '1');
  assert.equal(active.minHeight, SILENT_QUEUE_BUTTON_MIN_HEIGHT);
  assert.equal(active.minWidth, SILENT_QUEUE_BUTTON_MIN_WIDTH);
  assert.equal(active.iconName, 'moon');
  assert.equal(active.tone, 'active');
});

test('caps large silent queue counts to 99+', () => {
  const presentation = resolveSilentQueueButtonPresentation({
    enabled: true,
    count: 120,
  });

  assert.equal(presentation.countVisible, true);
  assert.equal(presentation.countLabel, '99+');
});

test('builds toast feedback for long press toggle actions', () => {
  const enabled = resolveSilentQueueToggleFeedback(true);
  const disabled = resolveSilentQueueToggleFeedback(false);

  assert.deepEqual(enabled, {
    title: '静默下载已开启',
    message: '新的分享链接会直接加入静默下载队列。',
    level: 'success',
    durationMs: 2200,
  });
  assert.deepEqual(disabled, {
    title: '静默下载已关闭',
    message: '新的分享链接会回到首页解析，不再自动入队。',
    level: 'info',
    durationMs: 2200,
  });
});
