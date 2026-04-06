const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeManagerPath = path.join(
  __dirname,
  '..',
  'ios',
  'VSAVE',
  'NativeSilentDownloadManager.swift'
);

const source = fs.readFileSync(nativeManagerPath, 'utf8');

const getFunctionBlock = (functionName) => {
  const signature = `private func ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `expected to find ${signature}`);

  const blockStart = source.indexOf('{', start);
  assert.notEqual(blockStart, -1, `expected ${functionName} to have a body`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`failed to parse ${functionName}`);
};

test('silent photo library save reuses the V-SAVE album when it exists', () => {
  const saveToPhotoLibraryBlock = getFunctionBlock('saveToPhotoLibrary');

  assert.match(saveToPhotoLibraryBlock, /let existingAlbum = self\.fetchDownloadAlbum\(\)/);
  assert.match(saveToPhotoLibraryBlock, /PHAssetCollectionChangeRequest\(for: existingAlbum\)/);
  assert.match(saveToPhotoLibraryBlock, /albumChangeRequest\.addAssets\(assetPlaceholders\)/);
});

test('silent photo library save creates V-SAVE only when no album exists', () => {
  const saveToPhotoLibraryBlock = getFunctionBlock('saveToPhotoLibrary');

  assert.match(
    saveToPhotoLibraryBlock,
    /PHAssetCollectionChangeRequest\.creationRequestForAssetCollection\(\s*withTitle: nativeSilentDownloadAlbumTitle\s*\)/
  );
});

test('native silent download manager keeps a dedicated album lookup helper', () => {
  const fetchDownloadAlbumBlock = getFunctionBlock('fetchDownloadAlbum');

  assert.match(fetchDownloadAlbumBlock, /localizedTitle = %@/);
  assert.match(fetchDownloadAlbumBlock, /nativeSilentDownloadAlbumTitle/);
  assert.match(fetchDownloadAlbumBlock, /PHAssetCollection\.fetchAssetCollections/);
});
