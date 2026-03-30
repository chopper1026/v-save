// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { getNotificationActionPresentation } from './notification-action-presentation.ts';

test('keeps the all-read button label stable while it is loading', () => {
  assert.deepEqual(getNotificationActionPresentation('markAll', 'markAll'), {
    label: '全部已读',
    busy: true,
  });
});

test('keeps the clear-all button label stable while it is loading', () => {
  assert.deepEqual(getNotificationActionPresentation('clearAll', 'clearAll'), {
    label: '一键清空',
    busy: true,
  });
});
