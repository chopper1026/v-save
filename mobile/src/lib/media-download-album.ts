import type { Album, AssetRef } from 'expo-media-library';

export const DOWNLOAD_LIBRARY_ALBUM_NAME = 'V-SAVE';

export interface DownloadAlbumMediaLibrary {
  getAlbumAsync: (title: string) => Promise<Album | null>;
  addAssetsToAlbumAsync: (
    asset: AssetRef | AssetRef[],
    album: Album,
    copyAsset?: boolean
  ) => Promise<boolean>;
  createAlbumAsync: (
    title: string,
    asset: AssetRef,
    copyAsset?: boolean
  ) => Promise<unknown>;
}

export const persistAssetToDownloadAlbum = async (
  asset: AssetRef,
  mediaLibrary: DownloadAlbumMediaLibrary
): Promise<void> => {
  // On iOS, createAlbumAsync does not reuse an album with the same title.
  const album = await mediaLibrary
    .getAlbumAsync(DOWNLOAD_LIBRARY_ALBUM_NAME)
    .catch(() => null);

  if (album?.id) {
    await mediaLibrary.addAssetsToAlbumAsync(asset, album, false);
    return;
  }

  await mediaLibrary.createAlbumAsync(DOWNLOAD_LIBRARY_ALBUM_NAME, asset, false);
};
