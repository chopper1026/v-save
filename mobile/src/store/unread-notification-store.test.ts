// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { useUnreadNotificationStore } from './unread-notification-store.ts';

test('updates unread notification count immediately from shared store actions', () => {
  useUnreadNotificationStore.getState().reset();

  useUnreadNotificationStore.getState().setCount(6);
  assert.equal(useUnreadNotificationStore.getState().count, 6);

  useUnreadNotificationStore.getState().decrement();
  assert.equal(useUnreadNotificationStore.getState().count, 5);

  useUnreadNotificationStore.getState().decrement(99);
  assert.equal(useUnreadNotificationStore.getState().count, 0);

  useUnreadNotificationStore.getState().setCount(0);
  assert.equal(useUnreadNotificationStore.getState().count, 0);
});
