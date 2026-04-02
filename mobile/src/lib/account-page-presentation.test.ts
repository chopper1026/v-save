// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAccountCoverPresentation,
  resolveAccountPagePresentation,
} from './account-page-presentation.ts';

test('uses a single-column account layout without the overview panel', () => {
  assert.deepEqual(resolveAccountPagePresentation(), {
    contentLayout: 'single-column',
    showOverviewPanel: false,
    detailFields: ['phone', 'email', 'status', 'downloads'],
  });
});

test('keeps the account cover lightweight and free of duplicated status metrics', () => {
  assert.deepEqual(resolveAccountCoverPresentation(), {
    avatarInteraction: 'press-avatar',
    nicknameInteraction: 'inline-edit-icon',
    showStatusBadge: false,
    showStatsRow: false,
  });
});
