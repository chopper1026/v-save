// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

// Node's TS test runner needs the explicit extension here.
import {
  buildQualitySelectionKey,
  resolvePreferredQuality,
} from './quality-selection.ts';

test('defaults to the highest available quality when auto-select is enabled', () => {
  assert.equal(
    resolvePreferredQuality({
      qualityOptions: ['4k', '1080p', '720p'],
      currentQuality: '1080p',
      autoSelectHighest: true,
    }),
    '4k',
  );
});

test('keeps the user-selected quality when it is still available', () => {
  assert.equal(
    resolvePreferredQuality({
      qualityOptions: ['4k', '1080p', '720p'],
      currentQuality: '720p',
      autoSelectHighest: false,
    }),
    '720p',
  );
});

test('falls back to the highest available quality when the current quality is missing', () => {
  assert.equal(
    resolvePreferredQuality({
      qualityOptions: ['4k', '1080p', '720p'],
      currentQuality: '540p',
      autoSelectHighest: false,
    }),
    '4k',
  );
});

test('treats a new parse runtime trace as a new auto-selection session', () => {
  assert.notEqual(
    buildQualitySelectionKey({
      originalVideoUrl: 'https://www.douyin.com/aweme/v1/play/?video_id=test',
      qualityRefreshKey: '',
      runtimeTraceId: 'trace-a',
      format: 'video',
    }),
    buildQualitySelectionKey({
      originalVideoUrl: 'https://www.douyin.com/aweme/v1/play/?video_id=test',
      qualityRefreshKey: '',
      runtimeTraceId: 'trace-b',
      format: 'video',
    }),
  );
});
