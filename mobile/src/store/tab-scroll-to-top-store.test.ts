// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { useTabScrollToTopStore } from './tab-scroll-to-top-store.ts';

test('increments the scroll request token only for the requested tab', () => {
  useTabScrollToTopStore.setState({
    requests: {
      history: 0,
      notifications: 0,
    },
  });

  useTabScrollToTopStore.getState().requestScrollToTop('history');
  assert.deepEqual(useTabScrollToTopStore.getState().requests, {
    history: 1,
    notifications: 0,
  });

  useTabScrollToTopStore.getState().requestScrollToTop('notifications');
  assert.deepEqual(useTabScrollToTopStore.getState().requests, {
    history: 1,
    notifications: 1,
  });
});
