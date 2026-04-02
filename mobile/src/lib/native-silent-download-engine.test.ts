// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNativeSilentDownloadLegacyMigration,
  shouldUseNativeSilentDownloadEngine,
} from './native-silent-download-engine.ts';

test('uses the native silent download engine only on iOS when the bridge exists', () => {
  assert.equal(
    shouldUseNativeSilentDownloadEngine({
      platformOs: 'ios',
      nativeModuleAvailable: true,
    }),
    true,
  );

  assert.equal(
    shouldUseNativeSilentDownloadEngine({
      platformOs: 'android',
      nativeModuleAvailable: true,
    }),
    false,
  );

  assert.equal(
    shouldUseNativeSilentDownloadEngine({
      platformOs: 'ios',
      nativeModuleAvailable: false,
    }),
    false,
  );
});

test('converts interrupted legacy silent download tasks into queued native-import tasks', () => {
  const migration = buildNativeSilentDownloadLegacyMigration({
    tasks: [
      {
        id: 'task-downloading',
        sourceUrl: 'https://example.com/a',
        dedupeKey: 'a',
        status: 'downloading',
        progress: 42,
        createdAt: 100,
        updatedAt: 120,
        title: 'A',
        runtimeTraceId: 'trace-a',
      },
      {
        id: 'task-completed',
        sourceUrl: 'https://example.com/b',
        dedupeKey: 'b',
        status: 'completed',
        progress: 100,
        createdAt: 200,
        updatedAt: 240,
        finishedAt: 240,
        title: 'B',
      },
    ],
    pausedReason: 'photo_permission_denied',
    pauseMessage: '需要相册权限',
  });

  assert.equal(migration.pausedReason, 'photo_permission_denied');
  assert.equal(migration.pauseMessage, '需要相册权限');
  assert.equal(migration.tasks.length, 2);
  assert.deepEqual(migration.tasks[0], {
    id: 'task-downloading',
    sourceUrl: 'https://example.com/a',
    dedupeKey: 'a',
    status: 'queued',
    progress: 0,
    createdAt: 100,
    updatedAt: 100,
    title: 'A',
    runtimeTraceId: undefined,
  });
  assert.equal(migration.tasks[1].status, 'completed');
  assert.equal(migration.tasks[1].runtimeTraceId, undefined);
});
