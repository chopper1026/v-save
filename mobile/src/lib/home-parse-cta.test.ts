// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveHomeParseCtaState } from './home-parse-cta.ts';

test('shows auto parsing copy when silent download mode is off and share auto parse is pending', () => {
  const result = resolveHomeParseCtaState({
    parseLoading: false,
    autoParsing: false,
    shareAutoParsePending: true,
    incomingUrlPresent: false,
    hasShareIntent: false,
    silentDownloadEnabled: false,
  });

  assert.equal(result.parseBusy, true);
  assert.equal(result.loadingText, '自动解析中...');
});

test('does not show auto parsing copy when silent download mode is on', () => {
  const result = resolveHomeParseCtaState({
    parseLoading: false,
    autoParsing: false,
    shareAutoParsePending: true,
    incomingUrlPresent: true,
    hasShareIntent: true,
    silentDownloadEnabled: true,
  });

  assert.equal(result.parseBusy, false);
  assert.equal(result.loadingText, '解析中...');
});
