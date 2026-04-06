// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOWNLOAD_LIBRARY_ALBUM_NAME,
  persistAssetToDownloadAlbum,
} from './media-download-album.ts';

// Regression: ISSUE-001 — iOS save flow created a new V-SAVE album for every video save
// Found by /qa on 2026-04-06
// Report: .gstack/qa-reports/qa-report-v-save-ios-save-flow-2026-04-06.md

test('reuses the existing V-SAVE album instead of creating a duplicate', async () => {
  const asset = { id: 'asset-1' };
  const album = { id: 'album-1', title: DOWNLOAD_LIBRARY_ALBUM_NAME };
  const calls: any[] = [];

  await persistAssetToDownloadAlbum(asset, {
    getAlbumAsync: async (title) => {
      calls.push(['getAlbumAsync', title]);
      return album;
    },
    addAssetsToAlbumAsync: async (inputAsset, inputAlbum, copyAsset) => {
      calls.push(['addAssetsToAlbumAsync', inputAsset, inputAlbum, copyAsset]);
      return true;
    },
    createAlbumAsync: async () => {
      calls.push(['createAlbumAsync']);
      return album;
    },
  });

  assert.deepEqual(calls, [
    ['getAlbumAsync', DOWNLOAD_LIBRARY_ALBUM_NAME],
    ['addAssetsToAlbumAsync', asset, album, false],
  ]);
});

test('creates the V-SAVE album on the first save', async () => {
  const asset = { id: 'asset-1' };
  const album = { id: 'album-1', title: DOWNLOAD_LIBRARY_ALBUM_NAME };
  const calls: any[] = [];

  await persistAssetToDownloadAlbum(asset, {
    getAlbumAsync: async (title) => {
      calls.push(['getAlbumAsync', title]);
      return null;
    },
    addAssetsToAlbumAsync: async (inputAsset, inputAlbum, copyAsset) => {
      calls.push(['addAssetsToAlbumAsync', inputAsset, inputAlbum, copyAsset]);
      return true;
    },
    createAlbumAsync: async (title, inputAsset, copyAsset) => {
      calls.push(['createAlbumAsync', title, inputAsset, copyAsset]);
      return album;
    },
  });

  assert.deepEqual(calls, [
    ['getAlbumAsync', DOWNLOAD_LIBRARY_ALBUM_NAME],
    ['createAlbumAsync', DOWNLOAD_LIBRARY_ALBUM_NAME, asset, false],
  ]);
});
