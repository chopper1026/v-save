// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOME_HERO_SUBTITLE,
  resolveHomeHeroSubtitle,
} from './home-hero-presentation.ts';

test('keeps the home hero subtitle stable across silent download mode changes', () => {
  assert.equal(resolveHomeHeroSubtitle(false), HOME_HERO_SUBTITLE);
  assert.equal(resolveHomeHeroSubtitle(true), HOME_HERO_SUBTITLE);
  assert.equal(
    resolveHomeHeroSubtitle(true),
    '分享链接一键解析，高清下载更顺滑'
  );
});
