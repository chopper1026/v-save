// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE } from './media-error-codes.ts';
import {
  shouldAttachAuthTokenToSilentDownloadUrl,
  shouldRetrySilentDownloadWithIosCompatibleFallback,
  shouldUseSilentDownloadAsyncTask,
} from './silent-download-worker-policy.ts';

test('uses async task mode for youtube hd qualities on non-ios-compatible attempts', () => {
  assert.equal(
    shouldUseSilentDownloadAsyncTask({
      platform: 'youtube',
      quality: '1080p',
      iosCompatible: false,
    }),
    true,
  );
  assert.equal(
    shouldUseSilentDownloadAsyncTask({
      platform: 'youtube',
      quality: '1080p',
      iosCompatible: true,
    }),
    false,
  );
  assert.equal(
    shouldUseSilentDownloadAsyncTask({
      platform: 'bilibili',
      quality: '1080p',
      iosCompatible: false,
    }),
    false,
  );
});

test('retries ios-compatible fallback only on ios photos incompatibility after a non-compatible first attempt', () => {
  const incompatibleError = new Error('当前格式无法保存到 iOS 系统相册，请切换兼容模式后重试') as Error & {
    code?: string;
  };
  incompatibleError.code = IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE;

  assert.equal(
    shouldRetrySilentDownloadWithIosCompatibleFallback({
      os: 'ios',
      firstAttemptIosCompatible: false,
      error: incompatibleError,
    }),
    true,
  );
  assert.equal(
    shouldRetrySilentDownloadWithIosCompatibleFallback({
      os: 'android',
      firstAttemptIosCompatible: false,
      error: incompatibleError,
    }),
    false,
  );
  assert.equal(
    shouldRetrySilentDownloadWithIosCompatibleFallback({
      os: 'ios',
      firstAttemptIosCompatible: true,
      error: incompatibleError,
    }),
    false,
  );
});

test('attaches auth token only for proxied merge and task download urls', () => {
  assert.equal(
    shouldAttachAuthTokenToSilentDownloadUrl('https://example.com/api/download/merge?id=1'),
    true,
  );
  assert.equal(
    shouldAttachAuthTokenToSilentDownloadUrl('https://example.com/api/download/tasks/task-1/file'),
    true,
  );
  assert.equal(
    shouldAttachAuthTokenToSilentDownloadUrl('https://cdn.example.com/video.mp4'),
    false,
  );
});
