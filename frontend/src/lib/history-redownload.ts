import { toProxyUrl } from './api'

const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1'])

export interface HistoryRedownloadItem {
  sourceUrl?: string | null
  downloadUrl?: string | null
  format?: string | null
  quality?: string | null
}

export interface HistoryParsedVideo {
  title: string
  cover: string
  duration: string
  platform: string
  author?: string
  sourceUrl?: string
  videoUrl: string
  audioUrl?: string
  downloadOptions?: unknown
  qualityStatus?: string
  qualityRefreshKey?: string
  qualityMessage?: string
}

export interface HistoryGetDownloadUrlPayload {
  videoInfo: string
  clientType: 'WEB' | 'MOBILE'
  format: 'mp4' | 'audio'
  quality: string
}

interface ResolveHistoryRedownloadDownloadUrlOptions {
  item: HistoryRedownloadItem
  clientType: 'WEB' | 'MOBILE'
  parseVideo: (sourceUrl: string) => Promise<HistoryParsedVideo | null | undefined>
  getDownloadUrl: (
    payload: HistoryGetDownloadUrlPayload,
  ) => Promise<{ downloadUrl?: string | null } | null | undefined>
}

interface ResolveWebDownloadRequestUrlOptions {
  runtimeTraceId?: string
  currentOrigin?: string
  currentHostname?: string
}

const buildHistoryVideoInfoPayload = (
  sourceUrl: string,
  parsedVideo: HistoryParsedVideo,
): string => {
  return JSON.stringify({
    title: parsedVideo.title,
    cover: parsedVideo.cover,
    duration: parsedVideo.duration,
    platform: parsedVideo.platform,
    author: parsedVideo.author,
    sourceUrl,
    videoUrl: parsedVideo.videoUrl,
    audioUrl: parsedVideo.audioUrl || '',
    downloadOptions: parsedVideo.downloadOptions || undefined,
    qualityStatus: parsedVideo.qualityStatus,
    qualityRefreshKey: parsedVideo.qualityRefreshKey,
    qualityMessage: parsedVideo.qualityMessage,
  })
}

export const resolveHistoryRedownloadDownloadUrl = async ({
  item,
  clientType,
  parseVideo,
  getDownloadUrl,
}: ResolveHistoryRedownloadDownloadUrlOptions): Promise<string> => {
  const sourceUrl = String(item.sourceUrl || '').trim()
  if (!sourceUrl) {
    const existingDownloadUrl = String(item.downloadUrl || '').trim()
    if (!existingDownloadUrl) {
      throw new Error('未找到可用下载地址')
    }
    return existingDownloadUrl
  }

  const parsedVideo = await parseVideo(sourceUrl)
  if (!parsedVideo?.videoUrl) {
    throw new Error('重新解析失败，未获取到有效视频信息')
  }

  const refreshed = await getDownloadUrl({
    videoInfo: buildHistoryVideoInfoPayload(sourceUrl, parsedVideo),
    clientType,
    format: item.format === 'audio' ? 'audio' : 'mp4',
    quality: String(item.quality || '720p').trim() || '720p',
  })

  const refreshedDownloadUrl = String(refreshed?.downloadUrl || '').trim()
  if (!refreshedDownloadUrl) {
    throw new Error('下载链接获取失败')
  }

  return refreshedDownloadUrl
}

export const resolveWebDownloadRequestUrl = (
  rawDownloadUrl: string,
  options: ResolveWebDownloadRequestUrlOptions = {},
): string => {
  const downloadUrl = String(rawDownloadUrl || '').trim()
  if (!/^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl
  }

  try {
    const parsed = new URL(downloadUrl)
    const isApiPath = parsed.pathname.startsWith('/api/')
    if (isApiPath) {
      const currentHostname =
        String(options.currentHostname || '').trim().toLowerCase() ||
        (typeof window !== 'undefined'
          ? window.location.hostname.toLowerCase()
          : '')
      const currentOrigin =
        String(options.currentOrigin || '').trim() ||
        (typeof window !== 'undefined' ? window.location.origin : '')
      const host = parsed.hostname.toLowerCase()
      const isCurrentHost = host === currentHostname
      const isLocalApiHost = LOCAL_API_HOSTS.has(host)
      if (currentOrigin && (isCurrentHost || isLocalApiHost)) {
        return `${currentOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    }
  } catch {
    return toProxyUrl(downloadUrl, 'video', {
      runtimeTraceId: options.runtimeTraceId,
      runtimeStage: 'download',
      runtimeClientType: 'WEB',
    })
  }

  return toProxyUrl(downloadUrl, 'video', {
    runtimeTraceId: options.runtimeTraceId,
    runtimeStage: 'download',
    runtimeClientType: 'WEB',
  })
}
