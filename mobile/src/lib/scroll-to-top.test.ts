// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCROLL_TO_TOP_VISIBILITY_OFFSET,
  resolveActiveTabSegment,
  shouldReleaseScrollToTopLock,
  shouldShowScrollToTopButton,
} from './scroll-to-top.ts';

test('shows the scroll-to-top button only after the list is meaningfully scrolled', () => {
  assert.equal(shouldShowScrollToTopButton(0), false);
  assert.equal(
    shouldShowScrollToTopButton(SCROLL_TO_TOP_VISIBILITY_OFFSET - 1),
    false
  );
  assert.equal(
    shouldShowScrollToTopButton(SCROLL_TO_TOP_VISIBILITY_OFFSET + 1),
    true
  );
});

test('resolves the active visible tab segment from expo-router segments', () => {
  assert.equal(resolveActiveTabSegment(['(tabs)', 'history']), 'history');
  assert.equal(resolveActiveTabSegment(['notifications']), 'notifications');
  assert.equal(resolveActiveTabSegment(['(tabs)']), null);
});

test('keeps the button hidden during an in-progress programmatic scroll-to-top until it is near the top', () => {
  assert.equal(
    shouldShowScrollToTopButton(SCROLL_TO_TOP_VISIBILITY_OFFSET + 120, undefined, true),
    false
  );
  assert.equal(shouldReleaseScrollToTopLock(80), false);
  assert.equal(shouldReleaseScrollToTopLock(12), true);
});
