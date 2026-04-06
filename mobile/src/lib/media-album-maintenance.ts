import type {
  Album,
  Asset,
  AssetRef,
  MediaTypeValue,
  PagedInfo,
  PermissionResponse,
} from 'expo-media-library';
import { DOWNLOAD_LIBRARY_ALBUM_NAME } from './media-download-album';

const DOWNLOAD_ALBUM_MEDIA_TYPES: MediaTypeValue[] = ['video', 'photo'];
const ALBUM_ASSETS_PAGE_SIZE = 200;

export interface DownloadAlbumMaintenanceMediaLibrary {
  requestPermissionsAsync: () => Promise<PermissionResponse>;
  getAlbumsAsync: (options?: { includeSmartAlbums?: boolean }) => Promise<Album[]>;
  getAssetsAsync: (options: {
    first: number;
    after?: AssetRef;
    album: Album;
    mediaType: MediaTypeValue[];
  }) => Promise<PagedInfo<Asset>>;
  addAssetsToAlbumAsync: (
    assets: AssetRef[] | AssetRef,
    album: Album,
    copyAsset?: boolean
  ) => Promise<boolean>;
  deleteAlbumsAsync: (albums: Album[] | Album, assetRemove?: boolean) => Promise<boolean>;
}

export interface CleanupDuplicateDownloadAlbumsResult {
  foundAlbums: number;
  deletedAlbums: number;
  mergedAssets: number;
  keptAlbumId: string | null;
}

const hasMediaLibraryAccess = (permission: PermissionResponse): boolean => {
  return permission.granted || permission.accessPrivileges === 'limited';
};

const sortDownloadAlbums = (albums: Album[]): Album[] => {
  return [...albums].sort((left, right) => {
    const assetCountDiff = (right.assetCount || 0) - (left.assetCount || 0);
    if (assetCountDiff !== 0) {
      return assetCountDiff;
    }
    return (left.startTime || 0) - (right.startTime || 0);
  });
};

const loadAllAlbumAssets = async (
  album: Album,
  mediaLibrary: DownloadAlbumMaintenanceMediaLibrary
): Promise<Asset[]> => {
  const assets: Asset[] = [];
  let after: AssetRef | undefined;

  while (true) {
    const page = await mediaLibrary.getAssetsAsync({
      first: ALBUM_ASSETS_PAGE_SIZE,
      after,
      album,
      mediaType: DOWNLOAD_ALBUM_MEDIA_TYPES,
    });

    assets.push(...page.assets);
    if (!page.hasNextPage || !page.endCursor) {
      return assets;
    }

    after = page.endCursor;
  }
};

export const cleanupDuplicateDownloadAlbums = async (
  mediaLibrary: DownloadAlbumMaintenanceMediaLibrary
): Promise<CleanupDuplicateDownloadAlbumsResult> => {
  const permission = await mediaLibrary.requestPermissionsAsync();
  if (!hasMediaLibraryAccess(permission)) {
    throw new Error('未获得相册权限，请到系统设置中允许 V-SAVE 访问照片后重试');
  }

  const matchedAlbums = sortDownloadAlbums(
    (await mediaLibrary.getAlbumsAsync({ includeSmartAlbums: false })).filter(
      (album) => album.title === DOWNLOAD_LIBRARY_ALBUM_NAME
    )
  );

  if (matchedAlbums.length === 0) {
    return {
      foundAlbums: 0,
      deletedAlbums: 0,
      mergedAssets: 0,
      keptAlbumId: null,
    };
  }

  const [keeper, ...duplicates] = matchedAlbums;
  if (duplicates.length === 0) {
    return {
      foundAlbums: 1,
      deletedAlbums: 0,
      mergedAssets: 0,
      keptAlbumId: keeper.id,
    };
  }

  const keeperAssets = await loadAllAlbumAssets(keeper, mediaLibrary);
  const knownAssetIds = new Set(keeperAssets.map((asset) => asset.id));
  const assetsToMerge: Asset[] = [];

  for (const album of duplicates) {
    const albumAssets = await loadAllAlbumAssets(album, mediaLibrary);
    for (const asset of albumAssets) {
      if (knownAssetIds.has(asset.id)) {
        continue;
      }
      knownAssetIds.add(asset.id);
      assetsToMerge.push(asset);
    }
  }

  if (assetsToMerge.length > 0) {
    await mediaLibrary.addAssetsToAlbumAsync(assetsToMerge, keeper, false);
  }

  await mediaLibrary.deleteAlbumsAsync(duplicates, false);

  return {
    foundAlbums: matchedAlbums.length,
    deletedAlbums: duplicates.length,
    mergedAssets: assetsToMerge.length,
    keptAlbumId: keeper.id,
  };
};
