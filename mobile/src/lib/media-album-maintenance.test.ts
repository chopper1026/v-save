// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import { DOWNLOAD_LIBRARY_ALBUM_NAME } from './media-download-album.ts';
import { cleanupDuplicateDownloadAlbums } from './media-album-maintenance.ts';

// Regression: ISSUE-002 — users need in-app cleanup for duplicated V-SAVE albums
// Found by /qa on 2026-04-06
// Report: .gstack/qa-reports/qa-report-v-save-ios-save-flow-2026-04-06.md

test('merges assets into one V-SAVE album and deletes duplicate albums', async () => {
  const keeper = {
    id: 'album-keeper',
    title: DOWNLOAD_LIBRARY_ALBUM_NAME,
    assetCount: 2,
    startTime: 10,
    endTime: 10,
  };
  const duplicateA = {
    id: 'album-a',
    title: DOWNLOAD_LIBRARY_ALBUM_NAME,
    assetCount: 1,
    startTime: 20,
    endTime: 20,
  };
  const duplicateB = {
    id: 'album-b',
    title: DOWNLOAD_LIBRARY_ALBUM_NAME,
    assetCount: 0,
    startTime: 30,
    endTime: 30,
  };

  const calls: any[] = [];

  const result = await cleanupDuplicateDownloadAlbums({
    requestPermissionsAsync: async () => ({ granted: true }),
    getAlbumsAsync: async () => [duplicateA, keeper, duplicateB],
    getAssetsAsync: async ({ album }) => {
      if (album.id === keeper.id) {
        return {
          assets: [
            { id: 'asset-1' },
            { id: 'asset-2' },
          ],
          endCursor: 'keeper-end',
          hasNextPage: false,
          totalCount: 2,
        };
      }

      if (album.id === duplicateA.id) {
        return {
          assets: [
            { id: 'asset-2' },
            { id: 'asset-3' },
          ],
          endCursor: 'dup-a-end',
          hasNextPage: false,
          totalCount: 2,
        };
      }

      return {
        assets: [],
        endCursor: 'dup-b-end',
        hasNextPage: false,
        totalCount: 0,
      };
    },
    addAssetsToAlbumAsync: async (assets, album, copyAsset) => {
      calls.push(['addAssetsToAlbumAsync', assets, album, copyAsset]);
      return true;
    },
    deleteAlbumsAsync: async (albums, assetRemove) => {
      calls.push(['deleteAlbumsAsync', albums, assetRemove]);
      return true;
    },
  });

  assert.deepEqual(result, {
    foundAlbums: 3,
    deletedAlbums: 2,
    mergedAssets: 1,
    keptAlbumId: keeper.id,
  });
  assert.deepEqual(calls, [
    ['addAssetsToAlbumAsync', [{ id: 'asset-3' }], keeper, false],
    ['deleteAlbumsAsync', [duplicateA, duplicateB], false],
  ]);
});

test('returns early when there is only one V-SAVE album', async () => {
  const keeper = {
    id: 'album-keeper',
    title: DOWNLOAD_LIBRARY_ALBUM_NAME,
    assetCount: 1,
    startTime: 10,
    endTime: 10,
  };

  const result = await cleanupDuplicateDownloadAlbums({
    requestPermissionsAsync: async () => ({ granted: true }),
    getAlbumsAsync: async () => [keeper],
    getAssetsAsync: async () => {
      throw new Error('should not read assets for single album');
    },
    addAssetsToAlbumAsync: async () => true,
    deleteAlbumsAsync: async () => true,
  });

  assert.deepEqual(result, {
    foundAlbums: 1,
    deletedAlbums: 0,
    mergedAssets: 0,
    keptAlbumId: keeper.id,
  });
});

test('throws when photo library permission is denied', async () => {
  await assert.rejects(
    cleanupDuplicateDownloadAlbums({
      requestPermissionsAsync: async () => ({ granted: false, accessPrivileges: 'none' }),
      getAlbumsAsync: async () => [],
      getAssetsAsync: async () => ({
        assets: [],
        endCursor: '',
        hasNextPage: false,
        totalCount: 0,
      }),
      addAssetsToAlbumAsync: async () => true,
      deleteAlbumsAsync: async () => true,
    }),
    /未获得相册权限/
  );
});
