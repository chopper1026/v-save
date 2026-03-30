import { useState, useCallback } from 'react'
import axios from 'axios'
import { Platform } from '../components/VideoPreview'
import { api, toProxyUrl } from '../lib/api'
import {
  createRuntimeEventKey,
  createRuntimeTraceId,
  extractRuntimeEventErrorCode,
  normalizeRuntimePlatform,
  reportRuntimeClientEvent,
} from '../lib/runtime-monitor'

interface ParsedVideo {
  title: string
  cover: string
  duration: string
  platform: Platform
  author: string
  url: string
  audioUrl?: string
  // 原始URL（用于代理）
  originalCover?: string
  originalUrl?: string
  originalAudioUrl?: string
  downloadOptions?: {
    merged?: Record<string, string>
    video?: Record<string, string>
    audio?: Record<string, string>
  }
  qualityStatus?: 'complete' | 'enriching' | 'session_required' | 'source_single_quality'
  qualityRefreshKey?: string
  qualityMessage?: string
  runtimeTraceId?: string
}

interface UseVideoParserReturn {
  video: ParsedVideo | null
  isLoading: boolean
  error: string | null
  parse: (url: string) => Promise<void>
  reset: () => void
}

// 根据 URL 判断平台（用于前端显示平台标签）
const getPlatformFromUrl = (url: string): Platform => {
  if (url.includes('douyin') || url.includes('tiktok')) {
    return 'douyin'
  } else if (url.includes('bilibili')) {
    return 'bilibili'
  } else if (
    url.includes('xiaohongshu')
    || url.includes('xhsc.cn')
    || url.includes('xhslink.com')
  ) {
    return 'xiaohongshu'
  } else if (url.includes('kuaishou')) {
    return 'kuaishou'
  } else if (url.includes('youtube') || url.includes('youtu.be')) {
    return 'youtube'
  }
  return 'unknown'
}

const normalizeParseErrorMessage = (payload: any): string => {
  const rawMessage = payload?.message
  const detailMessage =
    typeof rawMessage === 'object' && rawMessage
      ? rawMessage.message
      : undefined

  const code =
    payload?.code
    || (typeof rawMessage === 'object' && rawMessage ? rawMessage.code : undefined)
  const retryAfterSeconds =
    payload?.details?.retryAfterSeconds
    || (typeof rawMessage === 'object' && rawMessage ? rawMessage?.details?.retryAfterSeconds : undefined)

  if (code === 'DOUYIN_RISK_CONTROL') {
    if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
      return `抖音风控冷却中，请在 ${retryAfterSeconds} 秒后重试，或更新抖音 Cookie。`
    }
    return '抖音触发风控校验，暂时无法解析。建议稍后重试，或更新服务端抖音 Cookie。'
  }

  if (code === 'DOUYIN_VIDEO_UNAVAILABLE') {
    return '该抖音视频当前不可访问（可能已删除、私密或地区限制）'
  }

  if (code === 'DOUYIN_SESSION_REQUIRED') {
    return '服务端抖音登录态已失效，请联系后台重新登录后再试'
  }

  if (code === 'XHS_VIDEO_UNAVAILABLE') {
    return '该小红书笔记暂未返回可播放视频地址，请稍后重试或更新链接'
  }

  if (typeof detailMessage === 'string' && detailMessage.trim()) {
    return detailMessage
  }

  if (typeof rawMessage === 'string' && rawMessage.trim()) {
    return rawMessage
  }

  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error
  }

  return '解析失败，请检查链接是否正确'
}

const isHlsManifestUrl = (value: string): boolean => /\.m3u8(\?|$)/i.test(value || '')

const toParsedVideo = (
  result: any,
  runtimeTraceId: string,
  sourceUrl: string,
): ParsedVideo => {
  const platform = result.platform ? result.platform as Platform : getPlatformFromUrl(sourceUrl)
  const originalCover = result.cover || ''
  const originalUrl = result.videoUrl || ''
  const originalAudioUrl = result.audioUrl || ''

  return {
    title: result.title || '',
    cover: originalCover
      ? toProxyUrl(originalCover, 'image', {
          runtimeTraceId,
          runtimeStage: 'preview',
          runtimeClientType: 'WEB',
        })
      : '',
    duration: result.duration || '',
    platform,
    author: result.author || '',
    url: originalUrl
      ? (
          isHlsManifestUrl(originalUrl)
            ? originalUrl
            : toProxyUrl(originalUrl, 'video', {
                runtimeTraceId,
                runtimeStage: 'preview',
                runtimeClientType: 'WEB',
              })
        )
      : '',
    audioUrl: originalAudioUrl
      ? toProxyUrl(originalAudioUrl, 'video', {
          runtimeTraceId,
          runtimeStage: 'preview',
          runtimeClientType: 'WEB',
        })
      : '',
    originalCover,
    originalUrl,
    originalAudioUrl,
    downloadOptions: result.downloadOptions || undefined,
    qualityStatus: result.qualityStatus || undefined,
    qualityRefreshKey: result.qualityRefreshKey || undefined,
    qualityMessage: result.qualityMessage || undefined,
    runtimeTraceId,
  }
}

// 解析视频 API
const parseVideoApi = async (
  url: string,
  runtimeTraceId: string,
): Promise<ParsedVideo> => {
  const response = await api.post('/download/parse', {
    url,
    clientType: 'WEB',
  }, {
    headers: {
      'x-runtime-trace-id': runtimeTraceId,
    },
  })

  return toParsedVideo(response.data.data, runtimeTraceId, url)
}

export function useVideoParser(): UseVideoParserReturn {
  const [video, setVideo] = useState<ParsedVideo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = useCallback(async (url: string) => {
    if (!url.trim()) {
      setError('请输入视频链接')
      return
    }

    setIsLoading(true)
    setError(null)
    setVideo(null)
    const startedAt = Date.now()
    const runtimeTraceId = createRuntimeTraceId('parse')
    const eventKey = createRuntimeEventKey('parse')
    const fallbackPlatform = normalizeRuntimePlatform(getPlatformFromUrl(url))

    try {
      const result = await parseVideoApi(url, runtimeTraceId)
      setVideo(result)
      reportRuntimeClientEvent({
        feature: 'parse',
        clientType: 'WEB',
        platform: normalizeRuntimePlatform(result.platform || fallbackPlatform),
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        eventKey,
        traceId: runtimeTraceId,
      })
    } catch (err) {
      reportRuntimeClientEvent({
        feature: 'parse',
        clientType: 'WEB',
        platform: fallbackPlatform,
        outcome: 'failure',
        latencyMs: Date.now() - startedAt,
        errorCode: extractRuntimeEventErrorCode(err, 'PARSE_FAILED'),
        eventKey,
        traceId: runtimeTraceId,
      })
      if (axios.isAxiosError(err)) {
        setError(normalizeParseErrorMessage(err.response?.data))
      } else {
        setError('解析失败，请检查链接是否正确')
      }
      console.error('Parse error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setVideo(null)
    setError(null)
    setIsLoading(false)
  }, [])

  return {
    video,
    isLoading,
    error,
    parse,
    reset,
  }
}

export type { ParsedVideo }
