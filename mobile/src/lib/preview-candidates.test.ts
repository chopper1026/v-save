// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { planPreviewCandidates } from './preview-candidates.ts';

const proxyBuilder = (url: string) =>
  `https://proxy.local/fetch?url=${encodeURIComponent(url)}`;

test('prefers proxied progressive merged mp4 for bilibili preview on ios', () => {
  const candidates = planPreviewCandidates({
    platform: 'bilibili',
    originalVideoUrl:
      'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/sample-720-avc.m4s?upsig=test',
    downloadOptions: {
      merged: {
        '720p':
          'https://upos-sz-estgcos.bilivideo.com/upgcxcode/sample-720-progressive.mp4?upsig=test',
      },
      videoCandidates: {
        '720p': [
          {
            url: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/sample-720-hevc.m4s?upsig=test',
            codecid: 12,
            width: 720,
            height: 1280,
            bandwidth: 460000,
          },
          {
            url: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/sample-720-avc.m4s?upsig=test',
            codecid: 7,
            width: 720,
            height: 1280,
            bandwidth: 710000,
          },
        ],
      },
    },
    clientOs: 'ios',
    proxyBuilder,
  });

  assert.equal(
    candidates[0]?.url,
    'https://proxy.local/fetch?url=https%3A%2F%2Fupos-sz-estgcos.bilivideo.com%2Fupgcxcode%2Fsample-720-progressive.mp4%3Fupsig%3Dtest'
  );
  assert.equal(candidates[0]?.isProxy, true);
  assert.equal(candidates[0]?.quality, '720p');
  assert.equal(candidates[0]?.sourceKind, 'merged');
  assert.equal(candidates[0]?.priorityReason, 'bilibili_ios_progressive_merged');
  assert.ok(candidates.every((item) => item.isProxy === true));
  assert.equal(candidates[1]?.codecId, 7);
  assert.equal(candidates[1]?.sourceKind, 'video_candidate');
});

test('prefers non-watermark douyin candidates and keeps watermark fallback at the end on ios', () => {
  const candidates = planPreviewCandidates({
    platform: 'douyin',
    originalVideoUrl:
      'https://v26-web.douyinvod.com/default-preview.mp4?a=6383',
    downloadOptions: {
      merged: {
        '1080p': 'https://v26-web.douyinvod.com/merged-1080.mp4?a=6383',
      },
      videoCandidates: {
        '1080p': [
          {
            url: 'https://v26-web.douyinvod.com/watermark-1080.mp4?a=6383',
            sourceKind: 'download_addr',
            watermark: true,
            width: 720,
            height: 720,
          },
          {
            url: 'https://v26-web.douyinvod.com/non-watermark-1080.mp4?a=6383',
            sourceKind: 'bit_rate',
            watermark: false,
            width: 1440,
            height: 1080,
          },
        ],
      },
    },
    clientOs: 'ios',
    proxyBuilder,
  });

  assert.equal(
    candidates[0]?.url,
    'https://proxy.local/fetch?url=https%3A%2F%2Fv26-web.douyinvod.com%2Fnon-watermark-1080.mp4%3Fa%3D6383'
  );
  assert.equal(candidates[0]?.sourceKind, 'bit_rate');
  assert.equal(candidates[0]?.watermark, false);
  assert.equal(candidates[0]?.priorityReason, 'douyin_ios_non_watermark_candidate');
  assert.equal(candidates.at(-1)?.watermark, true);
  assert.equal(candidates.at(-1)?.sourceKind, 'download_addr');
  assert.ok(candidates.every((item) => item.isProxy === true));
});
