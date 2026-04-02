// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SILENT_DOWNLOAD_DEFAULT_QUALITY,
  SILENT_DOWNLOAD_FORMAT,
  buildSilentDownloadPlan,
} from './silent-download-planner.ts';

test('selects the highest available merged-or-video quality for silent downloads', () => {
  const plan = buildSilentDownloadPlan({
    title: 'demo',
    cover: '',
    duration: '10',
    platform: 'bilibili',
    author: 'tester',
    videoUrl: 'https://video.example.com/source.mp4',
    downloadOptions: {
      merged: {
        '720p': 'https://video.example.com/720.mp4',
      },
      video: {
        '1080p': 'https://video.example.com/1080.mp4',
        '4k': 'https://video.example.com/4k.mp4',
      },
    },
  });

  assert.equal(plan.format, SILENT_DOWNLOAD_FORMAT);
  assert.equal(plan.quality, '4k');
});

test('falls back to default quality when parsed data does not provide quality options', () => {
  const plan = buildSilentDownloadPlan({
    title: 'demo',
    cover: '',
    duration: '10',
    platform: 'douyin',
    author: 'tester',
    videoUrl: 'https://video.example.com/source.mp4',
  });

  assert.equal(plan.quality, SILENT_DOWNLOAD_DEFAULT_QUALITY);
});
