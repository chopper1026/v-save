import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE,
  isIosPhotosIncompatibleError as isIosPhotosIncompatibleMediaError,
} from './media-error-codes';
import { persistAssetToDownloadAlbum } from './media-download-album';

const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);
const AUDIO_EXTS = new Set(['m4a', 'aac', 'mp3', 'wav', 'ogg', 'opus', 'flac']);
const KNOWN_EXTS = new Set([...VIDEO_EXTS, ...AUDIO_EXTS]);
const IOS_PHOTOS_VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v']);

const sanitizeFileName = (value: string): string => {
  const trimmed = String(value || 'vsave').trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|#%]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return sanitized.slice(0, 120) || 'vsave';
};

const inferExtFromUrl = (url: string, fallback: string): string => {
  const normalizedFallback = String(fallback || 'mp4')
    .replace('.', '')
    .trim()
    .toLowerCase();
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '';
    const ext = path.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (ext && KNOWN_EXTS.has(ext)) {
      return ext;
    }
    return normalizedFallback || 'mp4';
  } catch {
    return normalizedFallback || 'mp4';
  }
};

const getUriExtension = (uri: string): string => {
  const safeUri = String(uri || '').trim();
  const match = safeUri.match(/\.([a-z0-9]+)(?:$|[?#])/i);
  if (!match?.[1]) return '';
  return match[1].toLowerCase();
};

const normalizeUriForMediaLibrary = (uri: string): string => {
  const safeUri = String(uri || '');
  if (!safeUri.startsWith('file://')) {
    return safeUri;
  }
  return safeUri.replace(/#/g, '%23').replace(/\?/g, '%3F');
};

const normalizeMediaLibraryError = (error: any): string => {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return '保存到系统相册失败';
  if (raw.includes('PHPhotosErrorDomain error 3301')) {
    return '当前视频编码与 iOS 相册不兼容';
  }
  return raw;
};

const createCodedError = (message: string, code: string): Error & { code: string } => {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
};

export const isIosPhotosIncompatibleError = (error: any): boolean => {
  return isIosPhotosIncompatibleMediaError(error);
};

const ensureUriHasExtension = async (
  uri: string,
  fallbackExt: string
): Promise<string> => {
  const currentExt = getUriExtension(uri);
  if (currentExt) return uri;

  const safeExt = String(fallbackExt || 'mp4')
    .replace('.', '')
    .trim()
    .toLowerCase() || 'mp4';
  const fixedUri = `${uri}.${safeExt}`;

  await FileSystem.deleteAsync(fixedUri, { idempotent: true }).catch(() => undefined);

  try {
    await FileSystem.moveAsync({ from: uri, to: fixedUri });
    return fixedUri;
  } catch {
    await FileSystem.copyAsync({ from: uri, to: fixedUri });
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    return fixedUri;
  }
};

export interface DownloadToDeviceInput {
  url: string;
  fileName: string;
  fallbackExt?: string;
  authToken?: string;
  extraHeaders?: Record<string, string>;
  onProgress?: (progress: number) => void;
  onStageChange?: (stage: 'downloading' | 'saving') => void;
}

export interface DownloadToDeviceResult {
  localUri: string;
  savedToLibrary: boolean;
  sharedToSystem: boolean;
}

export async function downloadToDevice(
  input: DownloadToDeviceInput
): Promise<DownloadToDeviceResult> {
  const {
    url,
    fileName,
    fallbackExt = 'mp4',
    authToken,
    extraHeaders,
    onProgress,
    onStageChange,
  } = input;

  const directory = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(
    () => undefined
  );

  const ext = inferExtFromUrl(url, fallbackExt).replace('.', '').toLowerCase();
  const targetName = `${sanitizeFileName(fileName)}.${ext}`;
  const localUri = `${directory}${targetName}`;
  let lastReportedProgress = 0;

  const emitProgress = (progress: number) => {
    if (!onProgress) return;
    const clamped = Math.max(0, Math.min(100, progress));
    const monotonic = Math.max(lastReportedProgress, clamped);
    if (monotonic === lastReportedProgress) return;
    lastReportedProgress = monotonic;
    onProgress(monotonic);
  };

  const resumable = FileSystem.createDownloadResumable(
    url,
    localUri,
    {
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(extraHeaders || {}),
      },
    },
    (event) => {
      if (!onProgress) return;

      const totalBytesExpected = event.totalBytesExpectedToWrite;
      const totalBytesWritten = event.totalBytesWritten;

      if (totalBytesExpected > 0) {
        const progress = (totalBytesWritten / totalBytesExpected) * 100;
        emitProgress(progress);
        return;
      }

      if (totalBytesWritten > 0) {
        // unknown total size (chunked/streamed): provide smooth pseudo progress
        const loadedMb = totalBytesWritten / (1024 * 1024);
        const pseudoProgress = Math.min(95, 5 + Math.log2(loadedMb + 1) * 16);
        emitProgress(pseudoProgress);
      }
    }
  );

  onStageChange?.('downloading');

  const result = await resumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('下载失败：未获取到本地文件');
  }

  let persistedUri = result.uri;
  if (__DEV__) {
    // Helps diagnose iOS save failures where result.uri may lose extension.
    console.log('[DOWNLOAD_FILE]', {
      url,
      target: localUri,
      resultUri: result.uri,
      ext,
    });
  }

  const isVideo = VIDEO_EXTS.has(ext);
  if (isVideo) {
    persistedUri = await ensureUriHasExtension(persistedUri, ext || fallbackExt || 'mp4');
    const persistedExt = getUriExtension(persistedUri);
    if (!persistedExt) {
      throw new Error('下载成功但文件扩展名为空，无法保存到相册');
    }

    if (Platform.OS === 'ios' && !IOS_PHOTOS_VIDEO_EXTS.has(persistedExt)) {
      throw createCodedError(
        '当前视频格式不兼容 iOS 相册',
        IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE
      );
    }

    const permission = await MediaLibrary.requestPermissionsAsync();
    const granted =
      permission.granted || (permission as any).accessPrivileges === 'limited';
    if (!granted) {
      throw new Error(
        '未获得相册权限，请到系统设置中允许 V-SAVE 访问照片后重试'
      );
    }

    try {
      onStageChange?.('saving');
      const mediaLibraryUri = normalizeUriForMediaLibrary(persistedUri);
      const asset = await MediaLibrary.createAssetAsync(mediaLibraryUri);
      await persistAssetToDownloadAlbum(asset, MediaLibrary).catch(() => undefined);
      return {
        localUri: persistedUri,
        savedToLibrary: true,
        sharedToSystem: false,
      };
    } catch (error) {
      const normalizedMessage = normalizeMediaLibraryError(error);
      if (normalizedMessage.includes('iOS 相册不兼容')) {
        throw createCodedError(
          '当前视频编码不兼容 iOS 相册',
          IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE
        );
      }
      throw new Error(normalizedMessage);
    }
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(persistedUri, {
      dialogTitle: '导出下载文件',
      UTI: isVideo ? 'public.movie' : 'public.data',
      mimeType: isVideo ? 'video/mp4' : 'application/octet-stream',
    });
    return {
      localUri: persistedUri,
      savedToLibrary: false,
      sharedToSystem: true,
    };
  }

  return {
    localUri: persistedUri,
    savedToLibrary: false,
    sharedToSystem: false,
  };
}
